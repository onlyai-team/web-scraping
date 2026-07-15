import { DEFAULT_CONFIG, type ScrapeConfig } from "../scraper/types.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface RuntimeConfig {
	server: {
		host: string;
		port: number;
	};
	scraper: Pick<ScrapeConfig, "concurrency" | "timeout">;
	search: {
		brave: {
			apiKey?: string;
		};
	};
	logLevel: LogLevel;
}

type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * Builds the process configuration once, with validation at the application seam.
 * Pass an environment object in tests instead of mutating process.env.
 */
export function loadRuntimeConfig(
	env: RuntimeEnvironment = process.env,
): RuntimeConfig {
	const logLevel = env.LOG_LEVEL?.trim() || "info";
	if (!isLogLevel(logLevel)) {
		throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}`);
	}

	return {
		server: {
			host: env.HOST?.trim() || "0.0.0.0",
			port: parsePositiveInteger(env.PORT, "PORT", 3000, 65_535),
		},
		scraper: {
			concurrency: parsePositiveInteger(
				env.CONCURRENCY,
				"CONCURRENCY",
				DEFAULT_CONFIG.concurrency,
			),
			timeout: parsePositiveInteger(
				env.TIMEOUT,
				"TIMEOUT",
				DEFAULT_CONFIG.timeout,
			),
		},
		search: {
			brave: {
				apiKey: optionalString(env.BRAVE_SEARCH_API_KEY),
			},
		},
		logLevel,
	};
}

export const runtimeConfig = loadRuntimeConfig();

function optionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function parsePositiveInteger(
	value: string | undefined,
	name: string,
	fallback: number,
	maximum = Number.MAX_SAFE_INTEGER,
): number {
	const raw = value?.trim();
	if (!raw) return fallback;

	if (!/^\d+$/.test(raw)) {
		throw new Error(`${name} must be a positive integer`);
	}

	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
		throw new Error(`${name} must be between 1 and ${maximum}`);
	}

	return parsed;
}

function isLogLevel(value: string): value is LogLevel {
	return LOG_LEVELS.includes(value as LogLevel);
}
