import { expect, test } from "bun:test";
import { BraveSearchEngine } from "./brave.ts";

test("calls the Brave Web Search API and maps web results", async () => {
	const originalFetch = globalThis.fetch;
	let request: Request | undefined;

	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		request = new Request(input, init);
		return Response.json({
			web: {
				results: [
					{ title: "First", url: "https://example.com/1", description: "One" },
					{ title: "Second", url: "https://example.com/2" },
				],
			},
		});
	}) as unknown as typeof fetch;

	try {
		const engine = new BraveSearchEngine({ apiKey: "test-key" });
		const result = await engine.search("bun test");

		expect(request?.url).toBe(
			"https://api.search.brave.com/res/v1/web/search?q=bun+test",
		);
		expect(request?.headers.get("X-Subscription-Token")).toBe("test-key");
		expect(result).toMatchObject({
			query: "bun test",
			engine: "brave",
			results: [
				{
					title: "First",
					url: "https://example.com/1",
					snippet: "One",
					rank: 1,
				},
				{ title: "Second", url: "https://example.com/2", snippet: "", rank: 2 },
			],
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
