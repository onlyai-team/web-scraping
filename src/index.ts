// Scraping module
export { extractContent, extractFullPage } from "./scraper/extractor.js";
export { htmlToMarkdown } from "./scraper/html-to-markdown.js";
export { Scraper } from "./scraper/scraper.js";
export type {
	PageMetadata,
	ScrapeConfig,
	ScrapeJob,
	ScrapeResult,
} from "./scraper/types.js";
export { DEFAULT_CONFIG } from "./scraper/types.js";

// Search module
export { SearchEngineRegistry } from "./search/registry.js";
export { DuckDuckGoEngine } from "./search/index.js";
export type {
	SearchEngine,
	SearchResult,
	SearchResponse,
	SearchConfig,
} from "./search/types.js";
