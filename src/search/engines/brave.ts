import {
	type SearchConfig,
	SearchEngine,
	type SearchResponse,
	type SearchResult,
} from "../types.ts";

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveSearchConfig extends SearchConfig {
	apiKey: string;
}

interface BraveApiResult {
	title?: string;
	url?: string;
	description?: string;
}

interface BraveApiResponse {
	web?: {
		results?: BraveApiResult[];
	};
}

/**
 * Brave Web Search API integration.
 *
 * An API key is required and is supplied through BRAVE_SEARCH_API_KEY by the
 * server entry point.
 */
export class BraveSearchEngine extends SearchEngine {
	readonly name = "brave";
	private readonly apiKey: string;

	constructor(config: BraveSearchConfig) {
		super(config);
		this.apiKey = config.apiKey;
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();
		const url = new URL(BRAVE_WEB_SEARCH_URL);
		url.searchParams.set("q", query);

		const response = await fetch(url, {
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": this.apiKey,
			},
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
		});

		if (!response.ok) {
			const detail = (await response.text()).trim();
			throw new Error(
				`Brave Search API failed: ${response.status}${detail ? ` ${detail}` : ""}`,
			);
		}

		let body: BraveApiResponse;
		try {
			body = (await response.json()) as BraveApiResponse;
		} catch {
			throw new Error("Brave Search API returned an invalid JSON response");
		}

		return {
			query,
			results: this.toSearchResults(body.web?.results ?? []),
			engine: this.name,
			duration: performance.now() - startTime,
		};
	}

	private toSearchResults(results: BraveApiResult[]): SearchResult[] {
		const searchResults: SearchResult[] = [];

		for (const result of results) {
			if (!result.title || !result.url) continue;

			searchResults.push({
				title: result.title,
				url: result.url,
				snippet: result.description ?? "",
				rank: searchResults.length + 1,
			});
		}

		return searchResults;
	}
}
