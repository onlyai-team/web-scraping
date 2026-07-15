import { HttpError } from "../errors/http-error.ts";

export function parseSearchRequest(body: unknown) {
	const data = toBody(body);
	return {
		query: requiredString(data.query, "query"),
		engine: optionalString(data.engine, "engine"),
	};
}

export function parseSearchQuery(query: Record<string, unknown>) {
	return {
		query: requiredString(query.q, "q", "parameter"),
		engine: optionalString(query.engine, "engine"),
	};
}

function toBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function requiredString(
	value: unknown,
	field: string,
	location = "field",
): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new HttpError(`Missing required ${location}: ${field}`, 400);
	}
	return value;
}

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string")
		throw new HttpError(`${field} must be a string`, 400);
	return value || undefined;
}
