import type { RequestHandler } from "express";
import { presentScrapeResult } from "../presenters/scrape.presenter.ts";
import type { ScraperApi } from "../types.ts";
import {
	parseBatchScrapeRequest,
	parseSingleScrapeRequest,
} from "../validation/scrape-request.ts";

export function createScrapeController(scraper: ScraperApi) {
	const scrape: RequestHandler = async (req, res) => {
		const { url, format, config } = parseSingleScrapeRequest(req.body);
		const result = await scraper.scrape(url, config);

		if (format === "markdown") {
			res
				.status(result.error ? 422 : 200)
				.type("text/markdown")
				.set({
					"X-Scrape-Title": encodeURIComponent(result.metadata.title || ""),
					"X-Scrape-Words": String(result.metadata.wordCount),
					"X-Scrape-Time-Ms": String(Math.round(result.timing.total)),
				})
				.send(result.markdown);
			return;
		}

		res.status(result.error ? 422 : 200).json(presentScrapeResult(result));
	};

	const batch: RequestHandler = async (req, res) => {
		const { urls, config } = parseBatchScrapeRequest(req.body);
		const results = await scraper.scrapeMany(urls, config);
		res.json({
			total: results.length,
			succeeded: results.filter((result) => !result.error).length,
			failed: results.filter((result) => result.error).length,
			results: results.map(presentScrapeResult),
		});
	};

	const stream: RequestHandler = async (req, res) => {
		const { urls, config } = parseBatchScrapeRequest(req.body);
		res.set({
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
		res.flushHeaders();

		let count = 0;
		try {
			for await (const result of scraper.scrapeStream(urls, config)) {
				count++;
				res.write(`data: ${JSON.stringify(presentScrapeResult(result))}\n\n`);
			}
			res.write(`event: done\ndata: ${JSON.stringify({ total: count })}\n\n`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Stream error";
			res.write(
				`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
			);
		} finally {
			res.end();
		}
	};

	return { scrape, batch, stream };
}
