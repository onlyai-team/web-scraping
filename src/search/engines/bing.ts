import {
	type SearchConfig,
	SearchEngine,
	type SearchResponse,
} from "../types.ts";

/**
 * Bing search engine (stub - not yet implemented)
 */
export class BingSearchEngine extends SearchEngine {
	readonly name = "bing";

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(_query: string): Promise<SearchResponse> {
		// TODO: Implement Bing search
		throw new Error("BingSearchEngine.search() not yet implemented");
	}
}
