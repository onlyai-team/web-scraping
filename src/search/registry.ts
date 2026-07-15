import { createLogger } from "../common/logger.ts";
import { EngineScorer } from "./engine-scorer.ts";
import { SCORING_CONFIG } from "./scoring.ts";
import type { SearchEngine, SearchResponse } from "./types.ts";

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
	 * Search with tier-based round-robin and automatic fallback.
	 * Tier 1 (75-100): round-robin among healthy engines
	 * Tier 2 (50-75):  fallback tier if tier 1 all fail
	 * Tier 3 (0-50):   last resort
	 */
	async searchWithRoundRobin(
		query: string,
		preferredEngine?: string,
	): Promise<SearchResponse> {
		if (this.engines.length === 0) {
			throw new Error("No search engines registered");
		}

		const tiers = [
			{ min: 75, max: 100, label: "healthy" },
			{ min: 50, max: 74, label: "degraded" },
			{ min: 0, max: 49, label: "unhealthy" },
		];

		for (const tier of tiers) {
			const tierEngines = [...this.engines].filter((e) => {
				const score = this.scorer.getScore(e.name);
				return score >= tier.min && score <= tier.max;
			});

			if (tierEngines.length === 0) continue;

			// Build round-robin order for this tier
			const ordered = this.buildTierRoundRobin(tierEngines);
			if (preferredEngine && ordered.some((e) => e.name === preferredEngine)) {
				const preferred = ordered.find((e) => e.name === preferredEngine);
				if (preferred) {
					const idx = ordered.indexOf(preferred);
					ordered.splice(idx, 1);
					ordered.unshift(preferred);
				}
			}

			logger.info("trying tier", {
				tier: tier.label,
				minScore: tier.min,
				engines: ordered.map(
					(e) => `${e.name}(${this.scorer.getScore(e.name)})`,
				),
			});

			let lastError: Error | null = null;

			for (const engine of ordered) {
				const startTime = performance.now();
				try {
					logger.info("trying engine", {
						engine: engine.name,
						score: this.scorer.getScore(engine.name),
					});
					const result = await engine.search(query);
					const duration = performance.now() - startTime;

					this.scorer.recordSuccess(engine.name, duration);

					logger.info("search success", {
						engine: engine.name,
						tier: tier.label,
						results: result.results.length,
						duration: `${duration.toFixed(0)}ms`,
						newScore: this.scorer.getScore(engine.name),
					});

					return result;
				} catch (error) {
					const duration = performance.now() - startTime;
					const errMsg = error instanceof Error ? error.message : String(error);

					this.scorer.recordFailure(engine.name, duration, errMsg);

					logger.warn("engine failed", {
						engine: engine.name,
						error: errMsg,
						duration: `${duration.toFixed(0)}ms`,
						newScore: this.scorer.getScore(engine.name),
					});

					lastError = error as Error;
				}
			}

			// If this tier had engines but all failed, try next tier
			if (lastError) {
				logger.warn("tier exhausted, falling back", {
					tier: tier.label,
					nextTier: tiers[tiers.indexOf(tier) + 1]?.label || "none",
				});
			}
		}

		throw new Error("All search engines failed");
	}

	/**
	 * Round-robin within a tier using a per-tier counter.
	 */
	private tierRoundRobinIndex = 0;

	private buildTierRoundRobin(engines: SearchEngine[]): SearchEngine[] {
		// Sort by score descending for deterministic ordering
		const sorted = [...engines].sort(
			(a, b) => this.scorer.getScore(b.name) - this.scorer.getScore(a.name),
		);
		// Rotate based on tier round-robin counter
		const startIdx = this.tierRoundRobinIndex % sorted.length;
		this.tierRoundRobinIndex++;
		return [...sorted.slice(startIdx), ...sorted.slice(0, startIdx)];
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
		return this.scorer.getRankings().map((r) => ({
			engine: r.engine,
			score: r.score,
			successRate:
				r.metrics.totalRequests > 0
					? Math.round(
							(r.metrics.successfulRequests / r.metrics.totalRequests) * 100,
						)
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
				rankings: this.scorer
					.getRankings()
					.map((r) => `${r.engine}:${r.score.toFixed(0)}`)
					.join(", "),
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
