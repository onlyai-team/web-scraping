import type { ScrapeConfig, ScrapeResult } from "../scraper/types.ts";
import type { SearchResponse } from "../search/types.ts";

export interface AppDependencies {
	scraper: ScraperApi;
	searchRegistry: SearchRegistryApi;
}

export interface ScraperApi {
	stats: unknown;
	scrape(url: string, config?: Partial<ScrapeConfig>): Promise<ScrapeResult>;
	scrapeMany(
		urls: string[],
		config?: Partial<ScrapeConfig>,
	): Promise<ScrapeResult[]>;
	scrapeStream(
		urls: string[],
		config?: Partial<ScrapeConfig>,
	): AsyncGenerator<ScrapeResult>;
}

export interface SearchRegistryApi {
	getRankings(): unknown;
	searchWithRoundRobin(
		query: string,
		preferredEngine?: string,
	): Promise<SearchResponse>;
}
