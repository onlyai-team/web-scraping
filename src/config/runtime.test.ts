import { expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../scraper/types.ts";
import { loadRuntimeConfig } from "./runtime.ts";

test("uses documented defaults when runtime settings are absent", () => {
	expect(loadRuntimeConfig({})).toEqual({
		server: { host: "0.0.0.0", port: 3000 },
		scraper: {
			concurrency: DEFAULT_CONFIG.concurrency,
			timeout: DEFAULT_CONFIG.timeout,
		},
		search: { brave: {} },
		logLevel: "info",
	});
});

test("parses runtime overrides and keeps the Brave key optional", () => {
	expect(
		loadRuntimeConfig({
			HOST: "127.0.0.1",
			PORT: "8080",
			CONCURRENCY: "8",
			TIMEOUT: "10000",
			BRAVE_SEARCH_API_KEY: "  key  ",
			LOG_LEVEL: "debug",
		}),
	).toMatchObject({
		server: { host: "127.0.0.1", port: 8080 },
		scraper: { concurrency: 8, timeout: 10_000 },
		search: { brave: { apiKey: "key" } },
		logLevel: "debug",
	});

	expect(
		loadRuntimeConfig({ BRAVE_SEARCH_API_KEY: "  " }).search.brave.apiKey,
	).toBeUndefined();
});

test("rejects invalid runtime values at startup", () => {
	expect(() => loadRuntimeConfig({ PORT: "0" })).toThrow(
		"PORT must be between 1 and 65535",
	);
	expect(() => loadRuntimeConfig({ CONCURRENCY: "many" })).toThrow(
		"CONCURRENCY must be a positive integer",
	);
	expect(() => loadRuntimeConfig({ LOG_LEVEL: "verbose" })).toThrow(
		"LOG_LEVEL must be one of: debug, info, warn, error",
	);
});
