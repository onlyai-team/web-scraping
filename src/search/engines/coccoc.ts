import { createLogger } from "../../common/logger.ts";
import {
	type SearchConfig,
	SearchEngine,
	type SearchResponse,
	type SearchResult,
} from "../types.ts";

const logger = createLogger("coccoc-engine");

/** User-Agent pool */
const UA_POOL = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

/**
 * Cốc Cốc search engine
 * Uses SSR page to get results from window.composerResponse
 */
export class CoccocEngine extends SearchEngine {
	readonly name = "coccoc";
	private requestCount = 0;

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();

		// Rotate User-Agent
		const ua = nextUserAgent(UA_POOL, this.requestCount);
		this.requestCount++;

		const encodedQuery = encodeURIComponent(query);
		const url = `https://coccoc.com/search?query=${encodedQuery}`;

		const response = await fetch(url, {
			headers: {
				"User-Agent": ua,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
				"Cache-Control": "no-cache",
			},
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
		});

		if (!response.ok) {
			throw new Error(`Cốc Cốc search failed: ${response.status}`);
		}

		const html = await response.text();

		// Extract window.composerResponse - greedy match to get full JSON
		const startMarker = "window.composerResponse = ";
		const startIndex = html.indexOf(startMarker);

		if (startIndex === -1) {
			throw new Error("Cốc Cốc: composerResponse not found");
		}

		const jsonStart = startIndex + startMarker.length;

		// Find end: look for </script> or next window. assignment
		const scriptEnd = html.indexOf("</script>", jsonStart);
		const windowEnd = html.indexOf("\nwindow.", jsonStart);

		let endIndex = html.length;
		if (scriptEnd !== -1 && scriptEnd < endIndex) endIndex = scriptEnd;
		if (windowEnd !== -1 && windowEnd < endIndex) endIndex = windowEnd;

		let jsonStr = html.substring(jsonStart, endIndex).trim();

		// Remove trailing semicolon if present
		if (jsonStr.endsWith(";")) {
			jsonStr = jsonStr.slice(0, -1).trim();
		}

		let data: unknown;
		try {
			data = JSON.parse(jsonStr);
		} catch (e) {
			throw new Error(
				`Cốc Cốc: failed to parse composerResponse: ${String(e)}`,
			);
		}

		// Check for captcha
		if (
			isRecord(data) &&
			(data.captcha !== undefined || data.verification !== undefined)
		) {
			throw new Error("provider_verification_required");
		}

		const results = this.parseResults(data);
		const duration = performance.now() - startTime;

		logger.info("Cốc Cốc search completed", {
			query,
			resultCount: results.length,
			duration: `${duration.toFixed(0)}ms`,
		});

		return {
			query,
			results,
			engine: this.name,
			duration,
		};
	}

	/**
	 * Parse Cốc Cốc composerResponse to standard format
	 */
	private parseResults(data: unknown): SearchResult[] {
		const results: SearchResult[] = [];

		// search.search_results is an array of direct results
		const search = isRecord(data) ? data.search : undefined;
		const searchResults = isRecord(search) ? search.search_results : undefined;
		if (!Array.isArray(searchResults)) return results;

		for (const item of searchResults) {
			if (!isRecord(item)) continue;
			// Skip ads (they have advert_id or type === 'ad')
			if (item.advert_id || item.type === "ad") continue;

			const title = typeof item.title === "string" ? item.title : "";
			const url = typeof item.url === "string" ? item.url : "";
			const snippet = typeof item.content === "string" ? item.content : "";

			if (title && url) {
				// Clean HTML tags from title and snippet
				const cleanTitle = title.replace(/<\/?[^>]+>/g, "");
				const cleanSnippet = snippet.replace(/<\/?[^>]+>/g, "");

				results.push({
					title: cleanTitle,
					url,
					snippet: cleanSnippet,
					rank: results.length + 1,
				});
			}
		}

		return results;
	}
}

function nextUserAgent(pool: readonly string[], requestCount: number): string {
	const userAgent = pool[requestCount % pool.length];
	if (!userAgent) throw new Error("User-Agent pool is empty");
	return userAgent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
