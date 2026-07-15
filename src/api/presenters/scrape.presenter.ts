import type { ScrapeResult } from "../../scraper/types.ts";

export function presentScrapeResult(result: ScrapeResult) {
	return {
		url: result.url,
		markdown: result.markdown,
		metadata: result.metadata,
		timing: {
			total: Math.round(result.timing.total),
			navigation: Math.round(result.timing.navigation),
			extraction: Math.round(result.timing.extraction),
			conversion: Math.round(result.timing.conversion),
		},
		...(result.error ? { error: result.error } : {}),
	};
}
