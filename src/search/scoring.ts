/**
 * Engine performance metrics and scoring
 */
export interface EngineMetrics {
	engineName: string;

	// Current score (0-100)
	score: number;

	// Request tracking
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;

	// Performance tracking
	totalResponseTime: number; // milliseconds
	averageResponseTime: number;

	// Recent performance (for decay)
	recentRequests: Array<{
		timestamp: number;
		success: boolean;
		responseTime: number;
		error?: string;
	}>;

	// Health status
	lastSuccessTime: number | null;
	lastFailureTime: number | null;
	consecutiveFailures: number;

	// Rate limiting info
	lastRequestTime: number | null;
	requestsPerMinute: number;
}

/**
 * Scoring weights for different factors
 */
export const SCORING_WEIGHTS = {
	successRate: 0.4, // 40% - most important
	responseTime: 0.3, // 30% - speed matters
	recentPerformance: 0.2, // 20% - recent trends
	reliability: 0.1, // 10% - consistency
};

/**
 * Configuration for scoring system
 */
export const SCORING_CONFIG = {
	// How many recent requests to consider for "recent performance"
	recentWindow: 10,

	// Decay factor: how quickly old requests lose influence (0-1)
	decayFactor: 0.95,

	// Maximum requests per minute before rate limit penalty
	maxRequestsPerMinute: 30,

	// Penalty multiplier for consecutive failures
	consecutiveFailurePenalty: 0.8,

	// Minimum score to consider engine healthy
	minHealthyScore: 30,

	// Time window for "recent" (milliseconds)
	recentTimeWindow: 5 * 60 * 1000, // 5 minutes

	// Initial score for new engines
	initialScore: 75,
};
