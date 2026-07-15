#!/usr/bin/env bun

import { createLogger, formatMs } from "./common/logger.ts";
import { Scraper } from "./scraper/index.ts";
import { DEFAULT_CONFIG, type ScrapeConfig, type ScrapeResult } from "./scraper/types.ts";
import { SearchEngineRegistry } from "./search/registry.ts";
import { DuckDuckGoEngine } from "./search/engines/duckduckgo.ts";
import { CoccocEngine } from "./search/engines/coccoc.ts";

const log = createLogger("server");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Initialize scraper
const config: Partial<ScrapeConfig> = {
    concurrency: Number(process.env.CONCURRENCY) || DEFAULT_CONFIG.concurrency,
    timeout: Number(process.env.TIMEOUT) || DEFAULT_CONFIG.timeout,
};

const scraper = new Scraper(config);
await scraper.initialize();

// Initialize search engine registry with round-robin
const searchRegistry = new SearchEngineRegistry();
searchRegistry.register(new DuckDuckGoEngine());
searchRegistry.register(new CoccocEngine());

log.info("server starting", { host: HOST, port: PORT, concurrency: config.concurrency, timeout: config.timeout });

const server = Bun.serve({
    port: PORT,
    hostname: HOST,

    async fetch(req) {
        const start = performance.now();
        const url = new URL(req.url);
        const method = req.method;

        // CORS headers
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        if (method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        let response: Response;
        try {
            // Health check
            if (url.pathname === "/health" && method === "GET") {
                response = json({ status: "ok", stats: scraper.stats }, 200, corsHeaders);
            }
            // Single scrape
            else if (url.pathname === "/scrape" && method === "POST") {
                response = await handleScrape(req, corsHeaders);
            }
            // Batch scrape
            else if (url.pathname === "/scrape/batch" && method === "POST") {
                response = await handleBatch(req, corsHeaders);
            }
            // Streaming batch scrape (SSE)
            else if (url.pathname === "/scrape/stream" && method === "POST") {
                response = await handleStream(req, corsHeaders);
            }
            // Search API
            else if (url.pathname === "/search" && method === "POST") {
                response = await handleSearch(req, corsHeaders);
            }
            else if (url.pathname === "/search" && method === "GET") {
                response = await handleSearchGet(url, corsHeaders);
            } else {
                response = json({ error: "Not found" }, 404, corsHeaders);
            }
        } catch (err) {
            log.error("unhandled error", {
                method,
                path: url.pathname,
                error: err instanceof Error ? err.message : String(err),
            });
            response = json(
                { error: err instanceof Error ? err.message : "Internal server error" },
                500,
                corsHeaders,
            );
        }

        log.info("request", {
            method,
            path: url.pathname,
            status: response.status,
            duration: formatMs(performance.now() - start),
        });

        return response;
    },
});

log.info("server ready", { url: `http://${HOST}:${server.port}` });

// --- Handlers ---

async function handleScrape(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await parseBody(req);
    if (!body.url || typeof body.url !== "string") {
        return json({ error: "Missing required field: url" }, 400, corsHeaders);
    }

    const jobConfig = extractJobConfig(body);
    const result = await scraper.scrape(body.url, jobConfig);

    if (body.format === "markdown") {
        return new Response(result.markdown, {
            status: result.error ? 422 : 200,
            headers: {
                ...corsHeaders,
                "Content-Type": "text/markdown; charset=utf-8",
                "X-Scrape-Title": encodeURIComponent(result.metadata.title || ""),
                "X-Scrape-Words": String(result.metadata.wordCount),
                "X-Scrape-Time-Ms": String(Math.round(result.timing.total)),
            },
        });
    }

    return json(formatResult(result), result.error ? 422 : 200, corsHeaders);
}

async function handleBatch(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await parseBody(req);
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
        return json({ error: "Missing required field: urls (string[])" }, 400, corsHeaders);
    }

    if (body.urls.length > 100) {
        return json({ error: "Maximum 100 URLs per batch" }, 400, corsHeaders);
    }

    const jobConfig = extractJobConfig(body);
    const results = await scraper.scrapeMany(body.urls, jobConfig);

    return json(
        {
            total: results.length,
            succeeded: results.filter((r) => !r.error).length,
            failed: results.filter((r) => r.error).length,
            results: results.map(formatResult),
        },
        200,
        corsHeaders,
    );
}

async function handleStream(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await parseBody(req);
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
        return json({ error: "Missing required field: urls (string[])" }, 400, corsHeaders);
    }

    if (body.urls.length > 100) {
        return json({ error: "Maximum 100 URLs per batch" }, 400, corsHeaders);
    }

    const jobConfig = extractJobConfig(body);

    const stream = new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            let count = 0;

            try {
                for await (const result of scraper.scrapeStream(body.urls, jobConfig)) {
                    count++;
                    const event = `data: ${JSON.stringify(formatResult(result))}\n\n`;
                    controller.enqueue(encoder.encode(event));
                }
                controller.enqueue(
                    encoder.encode(`event: done\ndata: ${JSON.stringify({ total: count })}\n\n`),
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Stream error";
                controller.enqueue(
                    encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`),
                );
            } finally {
                controller.close();
            }
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}

// --- Utilities ---

interface ScrapeRequestBody {
    url?: string;
    urls?: string[];
    format?: string;
    timeout?: number;
    waitAfterLoad?: number;
    extractMainContent?: boolean;
    fullPage?: boolean;
    includeMetadata?: boolean;
    blockResources?: boolean;
}

async function parseBody(req: Request): Promise<ScrapeRequestBody> {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
        return req.json();
    }
    // Support form-urlencoded for simpler clients
    if (ct.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        const params = new URLSearchParams(text);
        const url = params.get("url") || undefined;
        const urls = params.getAll("urls");
        return { url, urls: urls.length > 0 ? urls : undefined };
    }
    // Fallback: try JSON
    try {
        return await req.json();
    } catch {
        return {};
    }
}

function extractJobConfig(body: ScrapeRequestBody): Partial<ScrapeConfig> | undefined {
    const c: Partial<ScrapeConfig> = {};
    let hasConfig = false;

    if (body.timeout != null) {
        c.timeout = Number(body.timeout);
        hasConfig = true;
    }
    if (body.waitAfterLoad != null) {
        c.waitAfterLoad = Number(body.waitAfterLoad);
        hasConfig = true;
    }
    if (body.extractMainContent === false || body.fullPage === true) {
        c.extractMainContent = false;
        hasConfig = true;
    }
    if (body.includeMetadata === false) {
        c.includeMetadata = false;
        hasConfig = true;
    }
    if (body.blockResources === false) {
        c.blockResources = false;
        hasConfig = true;
    }

    return hasConfig ? c : undefined;
}

function formatResult(r: ScrapeResult) {
    return {
        url: r.url,
        markdown: r.markdown,
        metadata: r.metadata,
        timing: {
            total: Math.round(r.timing.total),
            navigation: Math.round(r.timing.navigation),
            extraction: Math.round(r.timing.extraction),
            conversion: Math.round(r.timing.conversion),
        },
        ...(r.error ? { error: r.error } : {}),
    };
}

function json(data: unknown, status: number, extraHeaders: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...extraHeaders,
        },
    });
}

// --- Search Handlers ---

async function handleSearch(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await parseBody(req);
    const query = body.query as string | undefined;
    
    if (!query || typeof query !== "string") {
        return json({ error: "Missing required field: query" }, 400, corsHeaders);
    }

    const engineName = body.engine as string | undefined;
    
    try {
        let result;
        if (engineName) {
            // Use specific engine
            const engine = searchRegistry.getEngine(engineName);
            if (!engine) {
                return json({ error: `Engine not found: ${engineName}` }, 404, corsHeaders);
            }
            result = await engine.search(query);
        } else {
            // Use round-robin
            result = await searchRegistry.searchWithRoundRobin(query);
        }

        return json(result, 200, corsHeaders);
    } catch (err) {
        log.error("search error", {
            query,
            engine: engineName || "round-robin",
            error: err instanceof Error ? err.message : String(err),
        });
        return json(
            { error: err instanceof Error ? err.message : "Search failed" },
            500,
            corsHeaders,
        );
    }
}

async function handleSearchGet(url: URL, corsHeaders: Record<string, string>): Promise<Response> {
    const query = url.searchParams.get("q");
    const engineName = url.searchParams.get("engine") || undefined;

    if (!query) {
        return json({ error: "Missing required parameter: q" }, 400, corsHeaders);
    }

    try {
        let result;
        if (engineName) {
            const engine = searchRegistry.getEngine(engineName);
            if (!engine) {
                return json({ error: `Engine not found: ${engineName}` }, 404, corsHeaders);
            }
            result = await engine.search(query);
        } else {
            result = await searchRegistry.searchWithRoundRobin(query);
        }

        return json(result, 200, corsHeaders);
    } catch (err) {
        log.error("search error", {
            query,
            engine: engineName || "round-robin",
            error: err instanceof Error ? err.message : String(err),
        });
        return json(
            { error: err instanceof Error ? err.message : "Search failed" },
            500,
            corsHeaders,
        );
    }
}

// Graceful shutdown
process.on("SIGINT", async () => {
    log.info("shutting down (SIGINT)");
    await scraper.shutdown();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    log.info("shutting down (SIGTERM)");
    await scraper.shutdown();
    process.exit(0);
});
