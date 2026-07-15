import type { RequestHandler } from "express";
import type { ScraperApi } from "../types.ts";

export function getHealth(scraper: ScraperApi): RequestHandler {
	return (_req, res) => {
		res.json({ status: "ok", stats: scraper.stats });
	};
}
