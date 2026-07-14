import { SearchEngine, type SearchConfig, type SearchResponse, type SearchResult } from "../types.ts";
import { parseHTML } from "linkedom";

/**
 * Brave Search engine implementation
 */
export class BraveSearchEngine extends SearchEngine {
	readonly name = "brave";

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();
		const encodedQuery = encodeURIComponent(query);
		const url = `https://search.brave.com/search?q=${encodedQuery}`;

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
			throw new Error(`Brave search failed: ${response.status}`);
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

	private parseResults(html: string): SearchResult[] {
		const { document } = parseHTML(html);
		const results: SearchResult[] = [];

		// Brave uses snippet class for search results
		const snippets = document.querySelectorAll(".snippet");

		for (let i = 0; i < snippets.length; i++) {
			const snippet = snippets[i];
			if (!snippet) continue;

			const titleEl = snippet.querySelector(".snippet-title");
			const linkEl = snippet.querySelector("a");
			const descEl = snippet.querySelector(".snippet-description");

			const title = titleEl?.textContent?.trim() || "";
			const url = linkEl?.getAttribute("href") || "";
			const description = descEl?.textContent?.trim() || "";

			if (title && url) {
				results.push({
					title,
					url: this.cleanUrl(url),
					snippet: description,
					rank: i + 1,
				});
			}
		}

		return results;
	}

	private cleanUrl(url: string): string {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return url;
		}
		if (url.startsWith("/")) {
			return `https://search.brave.com${url}`;
		}
		return url;
	}
}
