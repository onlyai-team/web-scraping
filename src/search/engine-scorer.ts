import type { EngineMetrics } from "./scoring.ts";
import { SCORING_CONFIG, SCORING_WEIGHTS } from "./scoring.ts";

/**
 * Scoring system for search engines
 * Tracks performance metrics in memory and calculates health scores
 */
export class EngineScorer {
	private metrics: Map<string, EngineMetrics> = new Map();

	/**
	 * Initialize metrics for a new engine
	 */
	initialize(engineName: string): void {
		if (!this.metrics.has(engineName)) {
			this.metrics.set(engineName, {
				engineName,
				score: SCORING_CONFIG.initialScore,
				totalRequests: 0,
				successfulRequests: 0,
				failedRequests: 0,
				totalResponseTime: 0,
				averageResponseTime: 0,
				recentRequests: [],
				lastSuccessTime: null,
				lastFailureTime: null,
				consecutiveFailures: 0,
				lastRequestTime: null,
				requestsPerMinute: 0,
			});
		}
	}

	/**
	 * Record a successful request
	 */
	recordSuccess(engineName: string, responseTime: number): void {
		const metrics = this.getOrCreateMetrics(engineName);
		const now = Date.now();

		metrics.totalRequests++;
		metrics.successfulRequests++;
		metrics.totalResponseTime += responseTime;
		metrics.averageResponseTime =
			metrics.totalResponseTime / metrics.successfulRequests;
		metrics.lastSuccessTime = now;
		metrics.consecutiveFailures = 0;
		metrics.lastRequestTime = now;

		// Add to recent requests
		metrics.recentRequests.push({
			timestamp: now,
			success: true,
			responseTime,
		});

		// Keep only recent window
		this.pruneRecentRequests(metrics);

		// Update requests per minute
		this.updateRequestsPerMinute(metrics);

		// Recalculate score
		this.recalculateScore(metrics);
	}

	/**
	 * Record a failed request
	 */
	recordFailure(engineName: string, responseTime: number, error: string): void {
		const metrics = this.getOrCreateMetrics(engineName);
		const now = Date.now();

		metrics.totalRequests++;
		metrics.failedRequests++;
		metrics.totalResponseTime += responseTime;
		metrics.averageResponseTime =
			metrics.totalResponseTime / metrics.totalRequests;
		metrics.lastFailureTime = now;
		metrics.consecutiveFailures++;
		metrics.lastRequestTime = now;

		// Add to recent requests
		metrics.recentRequests.push({
			timestamp: now,
			success: false,
			responseTime,
			error,
		});

		// Keep only recent window
		this.pruneRecentRequests(metrics);

		// Update requests per minute
		this.updateRequestsPerMinute(metrics);

		// Recalculate score
		this.recalculateScore(metrics);
	}

	/**
	 * Get current score for an engine (0-100)
	 */
	getScore(engineName: string): number {
		const metrics = this.metrics.get(engineName);
		if (!metrics) return SCORING_CONFIG.initialScore;
		return metrics.score;
	}

	/**
	 * Get all metrics for an engine
	 */
	getMetrics(engineName: string): EngineMetrics | null {
		return this.metrics.get(engineName) || null;
	}

	private getOrCreateMetrics(engineName: string): EngineMetrics {
		this.initialize(engineName);
		const metrics = this.metrics.get(engineName);
		if (!metrics)
			throw new Error(`Metrics unavailable for engine: ${engineName}`);
		return metrics;
	}

	/**
	 * Get all engines sorted by score (highest first)
	 */
	getRankings(): Array<{
		engine: string;
		score: number;
		metrics: EngineMetrics;
	}> {
		return Array.from(this.metrics.entries())
			.map(([engine, metrics]) => ({
				engine,
				score: metrics.score,
				metrics,
			}))
			.sort((a, b) => b.score - a.score);
	}

	/**
	 * Get the best available engine based on score
	 */
	getBestEngine(): string | null {
		const rankings = this.getRankings();
		const best = rankings.find(
			(r) => r.score >= SCORING_CONFIG.minHealthyScore,
		);
		return best ? best.engine : null;
	}

	/**
	 * Check if an engine is healthy (score >= threshold)
	 */
	isHealthy(engineName: string): boolean {
		return this.getScore(engineName) >= SCORING_CONFIG.minHealthyScore;
	}

	/**
	 * Remove old requests from recentRequests array
	 */
	private pruneRecentRequests(metrics: EngineMetrics): void {
		const cutoff = Date.now() - SCORING_CONFIG.recentTimeWindow;
		metrics.recentRequests = metrics.recentRequests.filter(
			(r) => r.timestamp > cutoff,
		);

		// Also limit by count
		if (metrics.recentRequests.length > SCORING_CONFIG.recentWindow) {
			metrics.recentRequests = metrics.recentRequests.slice(
				-SCORING_CONFIG.recentWindow,
			);
		}
	}

	/**
	 * Update requests per minute metric
	 */
	private updateRequestsPerMinute(metrics: EngineMetrics): void {
		const oneMinuteAgo = Date.now() - 60 * 1000;
		const recentCount = metrics.recentRequests.filter(
			(r) => r.timestamp > oneMinuteAgo,
		).length;
		metrics.requestsPerMinute = recentCount;
	}

	/**
	 * Recalculate the overall score based on all metrics
	 */
	private recalculateScore(metrics: EngineMetrics): void {
		// Factor 1: Success Rate (0-100)
		const successRate =
			metrics.totalRequests > 0
				? (metrics.successfulRequests / metrics.totalRequests) * 100
				: 100;

		// Factor 2: Response Time Score (0-100)
		// Assume 500ms is perfect, 5000ms is worst
		const responseTimeScore = Math.max(
			0,
			100 - (metrics.averageResponseTime - 500) / 45,
		);

		// Factor 3: Recent Performance (0-100)
		const recentSuccessRate =
			metrics.recentRequests.length > 0
				? (metrics.recentRequests.filter((r) => r.success).length /
						metrics.recentRequests.length) *
					100
				: 100;

		// Factor 4: Reliability (0-100)
		// Based on consecutive failures
		let reliabilityScore = 100;
		if (metrics.consecutiveFailures > 0) {
			reliabilityScore =
				SCORING_CONFIG.consecutiveFailurePenalty **
					metrics.consecutiveFailures *
				100;
		}

		// Apply rate limit penalty
		let rateLimitPenalty = 1;
		if (metrics.requestsPerMinute > SCORING_CONFIG.maxRequestsPerMinute) {
			const overage =
				metrics.requestsPerMinute - SCORING_CONFIG.maxRequestsPerMinute;
			rateLimitPenalty = Math.max(
				0.5,
				1 - overage / SCORING_CONFIG.maxRequestsPerMinute,
			);
		}

		// Calculate weighted score
		const weightedScore =
			successRate * SCORING_WEIGHTS.successRate +
			responseTimeScore * SCORING_WEIGHTS.responseTime +
			recentSuccessRate * SCORING_WEIGHTS.recentPerformance +
			reliabilityScore * SCORING_WEIGHTS.reliability;

		// Apply rate limit penalty
		metrics.score = Math.round(weightedScore * rateLimitPenalty);

		// Clamp to 0-100
		metrics.score = Math.max(0, Math.min(100, metrics.score));
	}

	/**
	 * Apply time-based decay to scores
	 * Call this periodically (e.g., every minute) to decay old metrics
	 */
	applyDecay(): void {
		const now = Date.now();
		const allMetrics = Array.from(this.metrics.values());
		for (const metrics of allMetrics) {
			// Decay score if no recent activity
			if (metrics.lastRequestTime) {
				const timeSinceLastRequest = now - metrics.lastRequestTime;
				const minutesSinceLastRequest = timeSinceLastRequest / 60000;

				// Apply decay if more than 5 minutes since last request
				if (minutesSinceLastRequest > 5) {
					const decayMultiplier =
						SCORING_CONFIG.decayFactor **
						Math.floor(minutesSinceLastRequest / 5);
					metrics.score = Math.round(metrics.score * decayMultiplier);
					metrics.score = Math.max(0, metrics.score);
				}
			}

			// Prune old requests
			this.pruneRecentRequests(metrics);
		}
	}

	/**
	 * Reset metrics for an engine (useful for testing)
	 */
	reset(engineName: string): void {
		this.metrics.delete(engineName);
	}

	/**
	 * Get a summary of all engine health
	 */
	getHealthSummary(): string {
		const rankings = this.getRankings();
		return rankings
			.map((r) => {
				const status = r.score >= 80 ? "🟢" : r.score >= 50 ? "🟡" : "🔴";
				return `${status} ${r.engine}: ${r.score.toFixed(0)} (${r.metrics.successfulRequests}/${r.metrics.totalRequests} success, avg ${r.metrics.averageResponseTime.toFixed(0)}ms)`;
			})
			.join("\n");
	}
}
