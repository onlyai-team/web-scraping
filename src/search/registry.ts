import type { SearchEngine } from "./types.ts";
import type { SearchResponse } from "./types.ts";
import { EngineScorer } from "./engine-scorer.ts";
import { SCORING_CONFIG } from "./scoring.ts";
import { createLogger } from "../common/logger.ts";

const logger = createLogger("registry");

/**
 * Registry and pool manager for search engines.
 *
 * Supports:
 * - Score-based selection: pick the engine with the highest health score
 * - Automatic fallback: if engine fails, tries the next best one
 * - Performance tracking: tracks success rate, response time, reliability
 * - Time-based decay: scores decay if engine is not used for a while
 * - Round-robin fallback: if scores are equal, rotate among engines
 */
export class SearchEngineRegistry {
	private engines: SearchEngine[] = [];
	private currentIndex = 0;
	private scorer: EngineScorer;
	private decayInterval: ReturnType<typeof setInterval> | null = null;

	constructor() {
		this.scorer = new EngineScorer();
	}

	/**
	 * Register a new search engine and start tracking its score
	 */
	register(engine: SearchEngine): void {
		this.engines.push(engine);
		this.scorer.initialize(engine.name);
		logger.info("registered engine", { name: engine.name });

		// Start decay timer if this is the first engine
		if (this.engines.length === 1) {
			this.startDecayTimer();
		}
	}

	/**
	 * Get engine by name
	 */
	getEngine(name: string): SearchEngine | null {
		return this.engines.find((e) => e.name === name) || null;
	}

	/**
	 * Get all registered engines
	 */
	getAll(): SearchEngine[] {
		return [...this.engines];
	}

	/**
	 * Get the next engine using round-robin (no fallback)
	 */
	getNext(): SearchEngine | null {
		if (this.engines.length === 0) return null;
		const engine = this.engines[this.currentIndex] ?? null;
		this.currentIndex = (this.currentIndex + 1) % this.engines.length;
		return engine;
	}

	/**
	 * Get engines sorted by current score (best first)
	 */
	getEnginesByScore(): SearchEngine[] {
		return [...this.engines].sort((a, b) => {
			return this.scorer.getScore(b.name) - this.scorer.getScore(a.name);
		});
	}

	/**
	 * Search with score-based selection and automatic fallback.
	 * Picks the engine with the highest score that is healthy enough.
	 * Falls back to next best engine if one fails.
	 */
	async searchWithRoundRobin(query: string, preferredEngine?: string): Promise<SearchResponse> {
		if (this.engines.length === 0) {
			throw new Error("No search engines registered");
		}

		// Build ordered list: preferred engine first, then by score
		const ordered = this.getEnginesByScore();
		if (preferredEngine) {
			const preferred = ordered.find(e => e.name === preferredEngine);
			if (preferred) {
				const idx = ordered.indexOf(preferred);
				ordered.splice(idx, 1);
				ordered.unshift(preferred);
			}
		}

		let lastError: Error | null = null;

		for (const engine of ordered) {
			// Skip engines below healthy threshold if we have better options
			const score = this.scorer.getScore(engine.name);
			if (score < SCORING_CONFIG.minHealthyScore && ordered.filter(e => this.scorer.getScore(e.name) >= SCORING_CONFIG.minHealthyScore).length > 0) {
				logger.info("skipping unhealthy engine", {
					engine: engine.name,
					score,
				});
				continue;
			}

			const startTime = performance.now();
			try {
				logger.info("trying engine", {
					engine: engine.name,
					score,
				});
				const result = await engine.search(query);
				const duration = performance.now() - startTime;

				// Record success
				this.scorer.recordSuccess(engine.name, duration);

				logger.info("search success", {
					engine: engine.name,
					results: result.results.length,
					duration: `${duration.toFixed(0)}ms`,
					newScore: this.scorer.getScore(engine.name),
				});

				return result;
			} catch (error) {
				const duration = performance.now() - startTime;
				const errMsg = error instanceof Error ? error.message : String(error);
				
				// Record failure
				this.scorer.recordFailure(engine.name, duration, errMsg);

				logger.warn("engine failed", {
					engine: engine.name,
					error: errMsg,
					duration: `${duration.toFixed(0)}ms`,
					newScore: this.scorer.getScore(engine.name),
				});

				lastError = error as Error;
				continue;
			}
		}

		throw lastError || new Error("All search engines failed");
	}

	/**
	 * Get health summary for all engines
	 */
	getHealthSummary(): string {
		return this.scorer.getHealthSummary();
	}

	/**
	 * Get rankings for API response
	 */
	getRankings() {
		return this.scorer.getRankings().map(r => ({
			engine: r.engine,
			score: r.score,
			successRate: r.metrics.totalRequests > 0
				? Math.round((r.metrics.successfulRequests / r.metrics.totalRequests) * 100)
				: 100,
			avgResponseTime: Math.round(r.metrics.averageResponseTime),
			totalRequests: r.metrics.totalRequests,
			consecutiveFailures: r.metrics.consecutiveFailures,
			lastSuccess: r.metrics.lastSuccessTime,
			lastFailure: r.metrics.lastFailureTime,
			healthy: r.score >= SCORING_CONFIG.minHealthyScore,
		}));
	}

	/**
	 * Get the current score for an engine
	 */
	getScore(engineName: string): number {
		return this.scorer.getScore(engineName);
	}

	/**
	 * Start periodic decay timer (every 60 seconds)
	 */
	private startDecayTimer(): void {
		if (this.decayInterval) return;
		this.decayInterval = setInterval(() => {
			this.scorer.applyDecay();
			logger.debug("applied score decay", {
				rankings: this.scorer.getRankings().map(r => `${r.engine}:${r.score.toFixed(0)}`).join(", "),
			});
		}, 60 * 1000);
	}

	/**
	 * Stop decay timer (for cleanup)
	 */
	stopDecayTimer(): void {
		if (this.decayInterval) {
			clearInterval(this.decayInterval);
			this.decayInterval = null;
		}
	}

	/**
	 * Registry status
	 */
	getStatus(): { total: number; engines: string[]; nextIndex: number } {
		return {
			total: this.engines.length,
			engines: this.engines.map((e) => e.name),
			nextIndex: this.currentIndex,
		};
	}
}
