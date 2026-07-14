import type { SearchEngine } from "./types.ts";
import type { SearchResponse } from "./types.ts";

/**
 * Registry and pool manager for search engines.
 *
 * Supports:
 * - Round-robin selection across registered engines
 * - Fallback: if the chosen engine fails, tries the next one
 * - Named lookup: get a specific engine by name
 */
export class SearchEngineRegistry {
	private engines: SearchEngine[] = [];
	private currentIndex = 0;

	/**
	 * Register a new search engine
	 */
	register(engine: SearchEngine): void {
		this.engines.push(engine);
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
	 * Search with round-robin and automatic fallback on failure.
	 * Tries each engine starting from the current round-robin position.
	 */
	async searchWithRoundRobin(query: string): Promise<SearchResponse> {
		if (this.engines.length === 0) {
			throw new Error("No search engines registered");
		}

		const startIndex = this.currentIndex;
		let lastError: Error | null = null;

		for (let i = 0; i < this.engines.length; i++) {
			const engineIndex = (startIndex + i) % this.engines.length;
			const engine = this.engines[engineIndex];
			if (!engine) continue;

			try {
				const result = await engine.search(query);
				// Advance round-robin counter on success
				this.currentIndex = (engineIndex + 1) % this.engines.length;
				return result;
			} catch (error) {
				lastError = error as Error;
				continue;
			}
		}

		throw lastError || new Error("All search engines failed");
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
