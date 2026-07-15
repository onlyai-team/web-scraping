import PQueue from "p-queue";
import { BrowserPool } from "./browser-pool.ts";
import { extractContent, extractFullPage } from "./extractor.ts";
import { htmlToMarkdown } from "./html-to-markdown.ts";
import { createLogger, formatMs } from "../common/logger.ts";
import {
	DEFAULT_CONFIG,
	type PageMetadata,
	type ScrapeConfig,
	type ScrapeJob,
	type ScrapeResult,
} from "./types.ts";

const log = createLogger("scraper");

export class Scraper {
	private pool: BrowserPool;
	private queue: PQueue;
	private config: ScrapeConfig;
	private initialized = false;
	private domainLastRequest: Map<string, number> = new Map();

	constructor(config?: Partial<ScrapeConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.pool = new BrowserPool(this.config);
		this.queue = new PQueue({
			concurrency: this.config.concurrency,
		});
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.pool.initialize();
		this.initialized = true;
	}

	/**
	 * Scrape a single URL. Initializes browser on first call.
	 */
	async scrape(
		url: string,
		config?: Partial<ScrapeConfig>,
	): Promise<ScrapeResult> {
		await this.initialize();

		const job: ScrapeJob = {
			url,
			id: newJobId(),
			config,
		};

		return this.processJob(job);
	}

	/**
	 * Scrape multiple URLs concurrently through the queue.
	 * Returns results in completion order.
	 */
	async scrapeMany(
		urls: string[],
		config?: Partial<ScrapeConfig>,
	): Promise<ScrapeResult[]> {
		await this.initialize();

		const jobs: ScrapeJob[] = urls.map((url, i) => ({
			url,
			id: newJobId(),
			priority: i, // preserve input order for priority
			config,
		}));

		const promises = jobs.map((job) =>
			this.queue.add(() => this.processJob(job), {
				priority: job.priority,
			}),
		);

		const results = await Promise.allSettled(promises);

		return results.map((r, i) => {
			if (r.status === "fulfilled" && r.value) return r.value;

			const job = jobs[i];
			const url = job?.url ?? "";
			const id = job?.id ?? newJobId();

			return {
				id,
				url,
				markdown: "",
				metadata: emptyMetadata(url),
				timing: { total: 0, navigation: 0, extraction: 0, conversion: 0 },
				error: r.status === "rejected" ? String(r.reason) : "Unknown error",
			};
		});
	}

	/**
	 * Stream results as they complete via async generator.
	 */
	async *scrapeStream(
		urls: string[],
		config?: Partial<ScrapeConfig>,
	): AsyncGenerator<ScrapeResult> {
		await this.initialize();

		// Channel pattern: push results as they complete
		const results: ScrapeResult[] = [];
		let resolve: (() => void) | null = null;
		let done = false;
		let pending = urls.length;

		const notify = () => {
			if (resolve) {
				const fn = resolve;
				resolve = null;
				fn();
			}
		};

		for (const url of urls) {
			const job: ScrapeJob = { url, id: newJobId(), config };
			this.queue
				.add(async () => {
					const result = await this.processJob(job);
					results.push(result);
					notify();
					return result;
				})
				.catch((err) => {
					results.push({
						id: job.id,
						url: job.url,
						markdown: "",
						metadata: emptyMetadata(job.url),
						timing: { total: 0, navigation: 0, extraction: 0, conversion: 0 },
						error: String(err),
					});
					notify();
				})
				.finally(() => {
					pending--;
					if (pending === 0) {
						done = true;
						notify();
					}
				});
		}

		while (!done || results.length > 0) {
			if (results.length > 0) {
				const next = results.shift();
				if (next) yield next;
			} else if (!done) {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	}

	/**
	 * Attempt a plain HTTP fetch for static sites.
	 * Returns {html, finalUrl} on success, null if the page looks dynamic or fetch fails.
	 */
	private async tryStaticFetch(
		url: string,
		config: ScrapeConfig,
	): Promise<{ html: string; finalUrl: string } | null> {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10_000);

			const response = await fetch(url, {
				headers: {
					"User-Agent": config.userAgent,
					Accept:
						"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					"Accept-Language": "en-US,en;q=0.9",
				},
				redirect: "follow",
				signal: controller.signal,
			});

			clearTimeout(timeout);

			if (!response.ok) return null;

			const contentType = response.headers.get("content-type") || "";
			if (
				!contentType.includes("text/html") &&
				!contentType.includes("application/xhtml")
			) {
				return null;
			}

			const html = await response.text();
			const finalUrl = response.url || url;

			if (this.looksLikeSPA(html)) return null;

			return { html, finalUrl };
		} catch {
			return null;
		}
	}

	/**
	 * Heuristic: detect SPA shell pages that need JS rendering.
	 */
	private looksLikeSPA(html: string): boolean {
		// Check for empty root containers typical of SPAs
		if (
			/<div\s+id=["'](?:root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(html)
		) {
			return true;
		}

		// Strip script tags and check remaining body content
		const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
		if (bodyMatch) {
			const bodyContent = bodyMatch[1]!
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, "")
				.trim();

			if (bodyContent.length < 200) return true;
		}

		return false;
	}

	/**
	 * Per-domain rate limiting.
	 * Sleeps if the last request to the same domain was too recent.
	 */
	private async throttleDomain(url: string): Promise<void> {
		if (this.config.perDomainDelayMs <= 0) return;

		let hostname: string;
		try {
			hostname = new URL(url).hostname;
		} catch {
			return;
		}

		const now = Date.now();
		const last = this.domainLastRequest.get(hostname);

		if (last !== undefined) {
			const elapsed = now - last;
			if (elapsed < this.config.perDomainDelayMs) {
				await new Promise((r) =>
					setTimeout(r, this.config.perDomainDelayMs - elapsed),
				);
			}
		}

		this.domainLastRequest.set(hostname, Date.now());

		// Prune stale entries (older than 60s) to prevent unbounded growth
		if (this.domainLastRequest.size > 100) {
			const cutoff = Date.now() - 60_000;
			for (const [domain, ts] of this.domainLastRequest) {
				if (ts < cutoff) this.domainLastRequest.delete(domain);
			}
		}
	}

	private async processJob(job: ScrapeJob): Promise<ScrapeResult> {
		const jobConfig = { ...this.config, ...job.config };
		const totalStart = performance.now();

		log.debug("job start", { jobId: job.id, url: job.url });

		// Per-domain rate limiting (applies to both static and browser paths)
		await this.throttleDomain(job.url);

		// Static fast path: try plain HTTP fetch for static sites
		if (!jobConfig.skipStaticDetection && !jobConfig.preExtractScript) {
			const staticResult = await this.tryStaticFetch(job.url, jobConfig);
			if (staticResult) {
				log.debug("static fast path hit", { url: job.url });
				const extractStart = performance.now();
				const { content, metadata } = jobConfig.extractMainContent
					? extractContent(staticResult.html, staticResult.finalUrl)
					: extractFullPage(staticResult.html, staticResult.finalUrl);
				const extractTime = performance.now() - extractStart;

				const convertStart = performance.now();
				const markdown = htmlToMarkdown(content, staticResult.finalUrl);
				const convertTime = performance.now() - convertStart;

				let output = "";
				if (jobConfig.includeMetadata) {
					output += formatMetadataHeader(metadata);
				}
				output += markdown;

				if (jobConfig.documentDelimiters) {
					output = `<document source="${job.url}" domain="${metadata.domain || ""}">\n${output}\n</document>`;
				}

				const total = performance.now() - totalStart;
				log.info("job done", {
					jobId: job.id,
					url: job.url,
					path: "static",
					words: metadata.wordCount,
					duration: formatMs(total),
				});

				return {
					id: job.id,
					url: job.url,
					markdown: output,
					metadata,
					timing: {
						total,
						navigation: extractStart - totalStart,
						extraction: extractTime,
						conversion: convertTime,
					},
				};
			}
		}

		// Browser path
		log.debug("using browser path", { url: job.url });
		const ctx = await this.pool.acquire();

		try {
			const page = await ctx.newPage();

			try {
				// Navigate
				const navStart = performance.now();
				const waitUntil = jobConfig.waitForNetworkIdle
					? "networkidle"
					: "domcontentloaded";

				await page.goto(job.url, {
					timeout: jobConfig.timeout,
					waitUntil,
				});

				// Wait for SPA hydration: ensure meaningful content is present
				await page
					.waitForFunction(
						() => {
							const body = document.body;
							if (!body) return false;
							const text = body.innerText || "";
							// Wait until we have at least some real text content
							return text.trim().length > 100;
						},
						{ timeout: 10_000 },
					)
					.catch(() => {
						// Timeout is fine — proceed with whatever we have
					});

				// Auto-dismiss common cookie/consent banners
				await page
					.evaluate(() => {
						// Click common accept/dismiss buttons
						const selectors = [
							'[id*="cookie"] button',
							'[class*="cookie"] button',
							'[id*="consent"] button',
							'[class*="consent"] button',
							'[class*="gdpr"] button',
							'[aria-label*="accept"]',
							'[aria-label*="Accept"]',
							'[aria-label*="agree"]',
							'[aria-label*="close"]',
							'button[id*="accept"]',
							'button[class*="accept"]',
						];
						for (const sel of selectors) {
							const btn = document.querySelector<HTMLElement>(sel);
							if (btn && btn.offsetParent !== null) {
								btn.click();
								break;
							}
						}
					})
					.catch(() => {});

				// Optional extra wait (for lazy-loaded content)
				if (jobConfig.waitAfterLoad > 0) {
					await page.waitForTimeout(jobConfig.waitAfterLoad);
				}

				// Run pre-extract script if provided
				if (jobConfig.preExtractScript) {
					await page.evaluate(jobConfig.preExtractScript);
				}

				const navTime = performance.now() - navStart;

				// Extract HTML
				const extractStart = performance.now();
				const html = await page.content();
				const finalUrl = page.url();

				const { content, metadata } = jobConfig.extractMainContent
					? extractContent(html, finalUrl)
					: extractFullPage(html, finalUrl);

				const extractTime = performance.now() - extractStart;

				// Convert to markdown
				const convertStart = performance.now();
				const markdown = htmlToMarkdown(content, finalUrl);
				const convertTime = performance.now() - convertStart;

				// Build output
				let output = "";
				if (jobConfig.includeMetadata) {
					output += formatMetadataHeader(metadata);
				}
				output += markdown;

				if (jobConfig.documentDelimiters) {
					output = `<document source="${job.url}" domain="${metadata.domain || ""}">\n${output}\n</document>`;
				}

				const total = performance.now() - totalStart;
				log.info("job done", {
					jobId: job.id,
					url: job.url,
					path: "browser",
					words: metadata.wordCount,
					duration: formatMs(total),
					nav: formatMs(navTime),
					extract: formatMs(extractTime),
					convert: formatMs(convertTime),
				});

				return {
					id: job.id,
					url: job.url,
					markdown: output,
					metadata,
					timing: {
						total,
						navigation: navTime,
						extraction: extractTime,
						conversion: convertTime,
					},
				};
			} finally {
				await page.close();
			}
		} catch (err) {
			const total = performance.now() - totalStart;
			log.error("job failed", {
				jobId: job.id,
				url: job.url,
				duration: formatMs(total),
				error: err instanceof Error ? err.message : String(err),
			});
			return {
				id: job.id,
				url: job.url,
				markdown: "",
				metadata: emptyMetadata(job.url),
				timing: {
					total,
					navigation: 0,
					extraction: 0,
					conversion: 0,
				},
				error: err instanceof Error ? err.message : String(err),
			};
		} finally {
			this.pool.release(ctx);
		}
	}

	/** Queue stats */
	get stats() {
		return {
			queue: {
				size: this.queue.size,
				pending: this.queue.pending,
			},
			pool: this.pool.stats,
		};
	}

	async shutdown(): Promise<void> {
		this.queue.clear();
		await this.pool.shutdown();
		this.initialized = false;
	}
}

function formatMetadataHeader(meta: PageMetadata): string {
	const lines: string[] = [];
	if (meta.title) lines.push(`# ${meta.title}`);
	lines.push("");
	const details: string[] = [];
	if (meta.description) details.push(`\n\n${meta.description}`);
	if (details.length > 0) {
		lines.push(...details);
		lines.push("");
		lines.push("---");
		lines.push("");
	}
	return lines.join("\n");
}

function emptyMetadata(url: string): PageMetadata {
	let domain = "";
	try {
		domain = new URL(url).hostname;
	} catch {}
	return {
		title: "",
		description: "",
		url,
		domain,
		wordCount: 0,
	};
}

function newJobId(): string {
	return Bun.randomUUIDv7();
}
