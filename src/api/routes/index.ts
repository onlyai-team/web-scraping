import { Router } from "express";
import { getHealth } from "../controllers/health.controller.ts";
import { createScrapeController } from "../controllers/scrape.controller.ts";
import { createSearchController } from "../controllers/search.controller.ts";
import type { AppDependencies } from "../types.ts";

export function createRouter({ scraper, searchRegistry }: AppDependencies) {
	const router = Router();
	const scrape = createScrapeController(scraper);
	const search = createSearchController(searchRegistry);

	router.get("/health", getHealth(scraper));
	router.post("/scrape", scrape.scrape);
	router.post("/scrape/batch", scrape.batch);
	router.post("/scrape/stream", scrape.stream);
	router.post("/search", search.search);
	router.get("/search", search.searchGet);
	router.get("/search/health", search.health);

	return router;
}
