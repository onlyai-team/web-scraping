import type { RequestHandler } from "express";
import { createLogger } from "../../common/logger.ts";
import type { SearchRegistryApi } from "../types.ts";
import {
	parseSearchQuery,
	parseSearchRequest,
} from "../validation/search-request.ts";

const log = createLogger("search-api");

export function createSearchController(searchRegistry: SearchRegistryApi) {
	const search: RequestHandler = async (req, res) => {
		const input = parseSearchRequest(req.body);
		res.json(await runSearch(searchRegistry, input.query, input.engine));
	};

	const searchGet: RequestHandler = async (req, res) => {
		const input = parseSearchQuery(req.query);
		res.json(await runSearch(searchRegistry, input.query, input.engine));
	};

	const health: RequestHandler = (_req, res) => {
		res.json(searchRegistry.getRankings());
	};

	return { search, searchGet, health };
}

async function runSearch(
	searchRegistry: SearchRegistryApi,
	query: string,
	engine?: string,
) {
	try {
		return await searchRegistry.searchWithRoundRobin(query, engine);
	} catch (error) {
		log.error("search error", {
			query,
			engine: engine || "round-robin",
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
