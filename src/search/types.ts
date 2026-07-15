/**
 * Abstract types for search engines
 */

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	rank: number;
}

export interface SearchResponse {
	query: string;
	results: SearchResult[];
	engine: string;
	duration: number;
}

export interface SearchConfig {
	timeout?: number;
}

/**
 * Abstract base class for all search engines
 */
export abstract class SearchEngine {
	abstract readonly name: string;
	protected config: SearchConfig;

	constructor(config: SearchConfig = {}) {
		this.config = config;
	}

	/**
	 * Perform a search query
	 */
	abstract search(query: string): Promise<SearchResponse>;

	/**
	 * Test if engine is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			await this.search("test");
			return true;
		} catch {
			return false;
		}
	}
}
