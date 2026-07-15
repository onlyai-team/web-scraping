import { SearchEngine, type SearchConfig, type SearchResponse, type SearchResult } from "../types.ts";
import { parseHTML } from "linkedom";

/** User-Agent pool for rotation */
const UA_POOL = [
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
];

/** Region cookie pool */
const KL_POOL = ["wt-wt", "vn-en", "us-en", "au-en", "sg-en", "jp-jp"];

/** Min delay between requests (ms) */
const MIN_DELAY_MS = 2000;

/**
 * DuckDuckGo Lite search engine
 * Scrapes the lite HTML version of DuckDuckGo
 */
export class DuckDuckGoEngine extends SearchEngine {
	readonly name = "duckduckgo-lite";
	private requestCount = 0;
	private lastRequestTime = 0;

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();

		// Rate limiting: enforce minimum delay between requests
		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < MIN_DELAY_MS) {
			await sleep(MIN_DELAY_MS - elapsed);
		}
		this.lastRequestTime = Date.now();

		// Rotate fingerprint per request
		const ua = UA_POOL[this.requestCount % UA_POOL.length]!;
		const kl = KL_POOL[this.requestCount % KL_POOL.length]!;
		this.requestCount++;

		const encodedQuery = encodeURIComponent(query);
		const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

		const response = await fetch(url, {
			headers: {
				"User-Agent": ua,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				"Cache-Control": "no-cache",
				Cookie: `kl=${kl}`,
			},
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
		});

		if (response.status === 403) {
			throw new Error(
				`DuckDuckGo blocked (403): rate limited or IP banned. Wait before retrying.`,
			);
		}

		if (!response.ok) {
			throw new Error(`DuckDuckGo search failed: ${response.status}`);
		}

		const html = await response.text();

		// Detect empty/blocked response (202 = captcha/blocked)
		if (response.status === 202 || !html.includes("result-link")) {
			throw new Error(
				`DuckDuckGo returned no results (possible CAPTCHA/block)`,
			);
		}

		const results = this.parseResults(html);
		const duration = performance.now() - startTime;

		return {
			query,
			results,
			engine: this.name,
			duration,
		};
	}

	private parseResults(html: string): SearchResult[] {
		const { document } = parseHTML(html);
		const results: SearchResult[] = [];

		// DuckDuckGo Lite uses table-based layout
		const resultLinks = document.querySelectorAll("a.result-link");

		let rank = 0;
		for (let i = 0; i < resultLinks.length; i++) {
			const link = resultLinks[i];
			if (!link) continue;

			const title = link.textContent?.trim() || "";
			const rawUrl = link.getAttribute("href") || "";

			// Find the snippet in the next row
			const parentRow = link.closest("tr");
			const snippetRow = parentRow?.nextElementSibling;
			const snippet =
				snippetRow?.querySelector(".result-snippet")?.textContent?.trim() || "";

			const url = this.cleanUrl(rawUrl);

			// Skip ad results (y.js URLs)
			if (url.includes("duckduckgo.com/y.js")) continue;

			rank++;
			results.push({
				title,
				url,
				snippet,
				rank,
			});
		}

		return results;
	}

	private cleanUrl(url: string): string {
		// Handle protocol-relative URLs
		if (url.startsWith("//")) {
			url = `https:${url}`;
		}

		// Extract real URL from DuckDuckGo redirect
		try {
			const parsed = new URL(url);
			const uddg = parsed.searchParams.get("uddg");
			if (uddg) {
				return decodeURIComponent(uddg);
			}
		} catch {
			// Invalid URL, return as-is
		}

		return url;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
