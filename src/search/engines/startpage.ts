import { createLogger } from "../../common/logger.ts";
import {
	type SearchConfig,
	SearchEngine,
	type SearchResponse,
	type SearchResult,
} from "../types.ts";

const logger = createLogger("startpage-engine");

/** User-Agent pool */
const UA_POOL = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

/**
 * Startpage search engine
 *
 * Flow:
 * 1. GET / -> receive cookie jar + hidden `sc` token
 * 2. POST /sp/search -> HTML results
 * 3. Parse a.result-link -> organic results
 */
export class StartpageEngine extends SearchEngine {
	readonly name = "startpage";
	private requestCount = 0;

	constructor(config: SearchConfig = {}) {
		super(config);
	}

	async search(query: string): Promise<SearchResponse> {
		const startTime = performance.now();

		// Rotate User-Agent
		const ua = nextUserAgent(UA_POOL, this.requestCount);
		this.requestCount++;

		// Step 1: Get session + sc token
		const { cookies, sc } = await this.getSession(ua);

		// Step 2: POST search
		const html = await this.postSearch(query, sc, cookies, ua);

		// Step 3: Parse results
		const results = this.parseResults(html);

		const duration = performance.now() - startTime;

		logger.info("search completed", {
			query,
			results: results.length,
			duration: `${duration.toFixed(0)}ms`,
		});

		return {
			query,
			results,
			engine: this.name,
			duration,
		};
	}

	/**
	 * Get session cookies and sc token from homepage
	 */
	private async getSession(
		ua: string,
	): Promise<{ cookies: string; sc: string }> {
		const response = await fetch("https://www.startpage.com/", {
			headers: {
				"User-Agent": ua,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
			},
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
			redirect: "follow",
		});

		if (!response.ok) {
			throw new Error(`Startpage homepage failed: ${response.status}`);
		}

		const html = await response.text();

		// Extract cookies from Set-Cookie headers
		const setCookieHeaders = response.headers.getSetCookie?.() || [];
		const cookies = setCookieHeaders.map((c) => c.split(";")[0]).join("; ");

		// Extract sc token from form
		const scMatch = html.match(/name="sc"\s+value="([^"]+)"/);
		if (!scMatch) {
			throw new Error("Startpage: sc token not found");
		}

		const sc = scMatch[1];
		if (!sc) throw new Error("Startpage: sc token not found");
		return { cookies, sc };
	}

	/**
	 * POST search request with form data
	 */
	private async postSearch(
		query: string,
		sc: string,
		cookies: string,
		ua: string,
	): Promise<string> {
		const formData = new URLSearchParams();
		formData.append("query", query);
		formData.append("sc", sc);
		formData.append("lui", "english");
		formData.append("language", "english");
		formData.append("t", "device");
		formData.append("cat", "web");
		formData.append("segment", "startpage.udog");
		formData.append("abd", "0");
		formData.append("abe", "0");
		formData.append("qsr", "all");
		formData.append("qadf", "moderate");
		formData.append("with_date", "");

		const response = await fetch("https://www.startpage.com/sp/search", {
			method: "POST",
			headers: {
				"User-Agent": ua,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
				Referer: "https://www.startpage.com/",
				Cookie: cookies,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: formData.toString(),
			signal: this.config.timeout
				? AbortSignal.timeout(this.config.timeout)
				: undefined,
			redirect: "follow",
		});

		if (!response.ok) {
			throw new Error(`Startpage search failed: ${response.status}`);
		}

		const html = await response.text();

		// Check for captcha block
		if (html.includes("/sp/captcha-block")) {
			throw new Error("Startpage: captcha block detected");
		}

		return html;
	}

	/**
	 * Parse organic results from HTML
	 * Only <a class="...result-link..."> elements are organic results
	 */
	private parseResults(html: string): SearchResult[] {
		const results: SearchResult[] = [];

		// Match <a ...> tags that contain "result-link" in their class attribute
		// Use a two-step approach: find all <a> tags, then filter by class
		const anchorRegex = /<a\s([^>]*)>([\s\S]*?)<\/a>/g;

		let rank = 0;

		for (const match of html.matchAll(anchorRegex)) {
			const attrs = match[1] ?? "";
			const innerHtml = match[2] ?? "";

			// Check if this anchor has "result-link" in its class
			if (!/\bclass="[^"]*\bresult-link\b/.test(attrs)) continue;

			// Extract href
			const hrefMatch = attrs.match(/href="([^"]+)"/);
			if (!hrefMatch) continue;
			const url = hrefMatch[1] ?? "";

			// Clean title: remove <style>, tags, comments, entities
			const title = innerHtml
				.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/<!--[\s\S]*?-->/g, "")
				.replace(/&(?:amp|nbsp|lt|gt|quot);/g, " ")
				.replace(/\s+/g, " ")
				.trim();

			if (title && url) {
				results.push({
					title,
					url,
					snippet: "", // Startpage doesn't show snippet in result-link
					rank: ++rank,
				});
			}
		}

		return results;
	}
}

function nextUserAgent(pool: readonly string[], requestCount: number): string {
	const userAgent = pool[requestCount % pool.length];
	if (!userAgent) throw new Error("User-Agent pool is empty");
	return userAgent;
}
