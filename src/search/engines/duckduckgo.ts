import { SearchEngine, type SearchConfig, type SearchResponse } from "../types.ts";
import { parseHTML } from "linkedom";

/**
 * DuckDuckGo Lite search engine
 * Scrapes the lite HTML version of DuckDuckGo
 */
export class DuckDuckGoEngine extends SearchEngine {
	readonly name = "duckduckgo-lite";

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();
		const encodedQuery = encodeURIComponent(query);
		const url = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;

		const response = await fetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
		});

		if (!response.ok) {
			throw new Error(`DuckDuckGo search failed: ${response.status}`);
		}

		const html = await response.text();
		const results = this.parseResults(html);
		const duration = performance.now() - startTime;

		return {
			query,
			results,
			engine: this.name,
			duration,
		};
	}

	private parseResults(html: string): any[] {
		const { document } = parseHTML(html);
		const results: any[] = [];

		// DuckDuckGo Lite uses table-based layout
		const resultLinks = document.querySelectorAll("a.result-link");

		for (let i = 0; i < resultLinks.length; i++) {
			const link = resultLinks[i];
			if (!link) continue;

			const title = link.textContent?.trim() || "";
			const url = link.getAttribute("href") || "";

			// Find the snippet in the next row
			const parentRow = link.closest("tr");
			const snippetRow = parentRow?.nextElementSibling;
			const snippet = snippetRow?.querySelector(".result-snippet")?.textContent?.trim() || "";

			if (title && url) {
				results.push({
					title,
					url: this.cleanUrl(url),
					snippet,
					rank: i + 1,
				});
			}
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
