import type { ScrapeConfig } from "../../scraper/types.ts";
import { HttpError } from "../errors/http-error.ts";

const MAX_BATCH_SIZE = 100;

type RequestBody = Record<string, unknown>;

export function parseSingleScrapeRequest(body: unknown) {
	const data = toBody(body);
	return {
		url: requiredString(data.url, "url"),
		format: optionalString(data.format),
		config: extractScrapeConfig(data),
	};
}

export function parseBatchScrapeRequest(body: unknown) {
	const data = toBody(body);
	const urls = data.urls;
	if (
		!Array.isArray(urls) ||
		urls.length === 0 ||
		!urls.every(isNonEmptyString)
	) {
		throw new HttpError("Missing required field: urls (string[])", 400);
	}
	if (urls.length > MAX_BATCH_SIZE) {
		throw new HttpError(`Maximum ${MAX_BATCH_SIZE} URLs per batch`, 400);
	}

	return { urls, config: extractScrapeConfig(data) };
}

function extractScrapeConfig(
	body: RequestBody,
): Partial<ScrapeConfig> | undefined {
	const config: Partial<ScrapeConfig> = {};

	const timeout = optionalNonNegativeNumber(body.timeout, "timeout");
	if (timeout !== undefined) config.timeout = timeout;

	const waitAfterLoad = optionalNonNegativeNumber(
		body.waitAfterLoad,
		"waitAfterLoad",
	);
	if (waitAfterLoad !== undefined) config.waitAfterLoad = waitAfterLoad;

	const extractMainContent = optionalBoolean(
		body.extractMainContent,
		"extractMainContent",
	);
	const fullPage = optionalBoolean(body.fullPage, "fullPage");
	if (extractMainContent === false || fullPage === true) {
		config.extractMainContent = false;
	}

	const includeMetadata = optionalBoolean(
		body.includeMetadata,
		"includeMetadata",
	);
	if (includeMetadata === false) config.includeMetadata = false;

	const blockResources = optionalBoolean(body.blockResources, "blockResources");
	if (blockResources === false) config.blockResources = false;

	return Object.keys(config).length > 0 ? config : undefined;
}

function toBody(value: unknown): RequestBody {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as RequestBody;
}

function requiredString(value: unknown, field: string): string {
	if (!isNonEmptyString(value)) {
		throw new HttpError(`Missing required field: ${field}`, 400);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string")
		throw new HttpError("format must be a string", 400);
	return value;
}

function optionalNonNegativeNumber(value: unknown, field: string) {
	if (value === undefined) return undefined;
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number) || number < 0) {
		throw new HttpError(`${field} must be a non-negative number`, 400);
	}
	return number;
}

function optionalBoolean(value: unknown, field: string) {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		throw new HttpError(`${field} must be a boolean`, 400);
	}
	return value;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
