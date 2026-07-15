import { expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { ScraperApi } from "./api/types.ts";
import { createApp } from "./app.ts";
import type { ScrapeResult } from "./scraper/types.ts";

const scrapeResult: ScrapeResult = {
	id: "job-1",
	url: "https://example.com",
	markdown: "# Example",
	metadata: {
		title: "Example",
		description: "",
		url: "https://example.com",
		domain: "example.com",
		wordCount: 1,
	},
	timing: { total: 12.6, navigation: 8.1, extraction: 2.2, conversion: 2.3 },
};

test("Express app exposes documented routes with validation and CORS", async () => {
	const app = createApp({
		scraper: createFakeScraper(),
		searchRegistry: {
			getRankings: () => [{ engine: "fake", score: 100 }],
			searchWithRoundRobin: async (query, engine) => ({
				query,
				engine: engine || "fake",
				results: [],
				duration: 1,
			}),
		},
	});
	const server = app.listen(0);
	await once(server, "listening");

	try {
		const { port } = server.address() as AddressInfo;
		const baseUrl = `http://127.0.0.1:${port}`;

		const health = await fetch(`${baseUrl}/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({
			status: "ok",
			stats: { queue: { size: 0 } },
		});

		const invalid = await fetch(`${baseUrl}/scrape`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toEqual({
			error: "Missing required field: url",
		});

		const markdown = await fetch(`${baseUrl}/scrape`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com", format: "markdown" }),
		});
		expect(markdown.status).toBe(200);
		expect(markdown.headers.get("content-type")).toContain("text/markdown");
		expect(await markdown.text()).toBe("# Example");

		const search = await fetch(`${baseUrl}/search?q=express&engine=fake`);
		expect(search.status).toBe(200);
		expect(await search.json()).toMatchObject({
			query: "express",
			engine: "fake",
		});
	} finally {
		await close(server);
	}
});

function createFakeScraper(): ScraperApi {
	return {
		stats: { queue: { size: 0 } },
		scrape: async () => scrapeResult,
		scrapeMany: async () => [scrapeResult],
		async *scrapeStream() {
			yield scrapeResult;
		},
	};
}

function once(
	server: ReturnType<ReturnType<typeof createApp>["listen"]>,
	event: string,
) {
	return new Promise<void>((resolve, reject) => {
		server.once(event, resolve);
		server.once("error", reject);
	});
}

function close(server: ReturnType<ReturnType<typeof createApp>["listen"]>) {
	return new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
