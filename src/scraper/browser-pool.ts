import { type Browser, type BrowserContext, chromium } from "playwright";
import { createLogger } from "../common/logger.ts";
import type { BrowserPoolContext, ScrapeConfig } from "./types.ts";
import {
	ACCEPT_LANGUAGE_POOL,
	BLOCKED_DOMAINS,
	USER_AGENT_POOL,
	VIEWPORT_POOL,
} from "./types.ts";

const log = createLogger("pool");

function randomItem<T>(arr: readonly T[]): T {
	const item = arr[Math.floor(Math.random() * arr.length)];
	if (item === undefined) throw new Error("Cannot select from an empty array");
	return item;
}

export class BrowserPool {
	private browser: Browser | null = null;
	private contexts: Map<number, BrowserPoolContext> = new Map();
	private available: BrowserPoolContext[] = [];
	private waiters: Array<(ctx: BrowserPoolContext) => void> = [];
	private config: ScrapeConfig;
	private poolSize: number;
	private nextContextId = 0;

	constructor(config: ScrapeConfig) {
		this.config = config;
		this.poolSize = config.concurrency;
	}

	async initialize(): Promise<void> {
		log.info("launching browser", { poolSize: this.poolSize });
		this.browser = await chromium.launch({
			args: [
				"--disable-gpu",
				"--disable-dev-shm-usage",
				"--disable-background-networking",
				"--disable-default-apps",
				"--disable-extensions",
				"--disable-sync",
				"--disable-translate",
				"--no-first-run",
				"--disable-component-update",
				"--disable-backgrounding-occluded-windows",
				"--disable-renderer-backgrounding",
				"--disable-ipc-flooding-protection",
			],
		});

		// Pre-create all contexts
		for (let i = 0; i < this.poolSize; i++) {
			const poolCtx = await this.createPoolContext();
			this.contexts.set(poolCtx.id, poolCtx);
			this.available.push(poolCtx);
		}
		log.info("pool ready", { contexts: this.poolSize });
	}

	private async createPoolContext(): Promise<BrowserPoolContext> {
		const ctx = await this.createBrowserContext();
		const id = this.nextContextId++;
		return {
			context: ctx,
			busy: false,
			createdAt: Date.now(),
			useCount: 0,
			id,
		};
	}

	private async createBrowserContext(): Promise<BrowserContext> {
		if (!this.browser) throw new Error("Browser not initialized");

		const userAgent = this.config.rotateFingerprints
			? randomItem(USER_AGENT_POOL)
			: this.config.userAgent;
		const viewport = this.config.rotateFingerprints
			? randomItem(VIEWPORT_POOL)
			: this.config.viewport;
		const acceptLanguage = this.config.rotateFingerprints
			? randomItem(ACCEPT_LANGUAGE_POOL)
			: "en-US,en;q=0.9";

		const ctx = await this.browser.newContext({
			userAgent,
			viewport,
			extraHTTPHeaders: {
				"Accept-Language": acceptLanguage,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				...this.config.headers,
			},
			ignoreHTTPSErrors: true,
			javaScriptEnabled: true,
		});

		// Block resources at route level for all pages in this context
		if (this.config.blockResources) {
			await ctx.route("**/*", (route) => {
				const request = route.request();
				const resourceType = request.resourceType();
				const url = request.url();

				// Block by resource type
				if (this.config.blockedResourceTypes.includes(resourceType)) {
					return route.abort();
				}

				// Block known tracking/ad domains
				if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
					return route.abort();
				}

				return route.continue();
			});
		}

		return ctx;
	}

	async acquire(): Promise<BrowserContext> {
		const poolCtx = this.available.pop();
		if (poolCtx) {
			// Health check: verify context is still alive
			try {
				await poolCtx.context.pages();
			} catch {
				log.warn("context unhealthy, recycling", { contextId: poolCtx.id });
				await this.recycleContext(poolCtx);
				const fresh = this.contexts.get(poolCtx.id);
				if (fresh) {
					fresh.useCount++;
					fresh.busy = true;
					return fresh.context;
				}
			}
			poolCtx.useCount++;
			poolCtx.busy = true;
			log.debug("acquired context", {
				contextId: poolCtx.id,
				useCount: poolCtx.useCount,
			});
			return poolCtx.context;
		}

		log.debug("no context available, queuing waiter", {
			waiting: this.waiters.length + 1,
		});
		// Wait for one to become available
		return new Promise<BrowserContext>((resolve) => {
			this.waiters.push((poolCtx: BrowserPoolContext) => {
				poolCtx.useCount++;
				poolCtx.busy = true;
				resolve(poolCtx.context);
			});
		});
	}

	release(ctx: BrowserContext): void {
		// Find the BrowserPoolContext by matching the context reference
		let poolCtx: BrowserPoolContext | undefined;
		for (const entry of this.contexts.values()) {
			if (entry.context === ctx) {
				poolCtx = entry;
				break;
			}
		}

		if (!poolCtx) return;
		poolCtx.busy = false;

		// Check if context needs recycling
		const needsRecycle =
			this.config.contextMaxUses > 0 &&
			poolCtx.useCount >= this.config.contextMaxUses;

		if (needsRecycle) {
			const contextId = poolCtx.id;
			log.info("recycling context", {
				contextId,
				useCount: poolCtx.useCount,
			});
			this.recycleContext(poolCtx).then(() => {
				const fresh = this.contexts.get(contextId);
				if (!fresh) return;
				const waiter = this.waiters.shift();
				if (waiter) {
					waiter(fresh);
				} else {
					this.available.push(fresh);
				}
			});
			return;
		}

		const waiter = this.waiters.shift();
		if (waiter) {
			waiter(poolCtx);
		} else {
			this.available.push(poolCtx);
		}
	}

	private async recycleContext(oldCtx: BrowserPoolContext): Promise<void> {
		await oldCtx.context.close().catch(() => {});
		const fresh = await this.createPoolContext();
		// Reuse the same id slot
		fresh.id = oldCtx.id;
		this.contexts.set(oldCtx.id, fresh);
	}

	async shutdown(): Promise<void> {
		log.info("shutting down pool", { contexts: this.contexts.size });
		for (const poolCtx of this.contexts.values()) {
			await poolCtx.context.close().catch(() => {});
		}
		this.contexts.clear();
		this.available = [];

		if (this.browser) {
			await this.browser.close().catch(() => {});
			this.browser = null;
		}
		log.info("pool shutdown complete");
	}

	get stats() {
		const contextDetails: Array<{
			id: number;
			useCount: number;
			age: number;
			busy: boolean;
		}> = [];
		for (const poolCtx of this.contexts.values()) {
			contextDetails.push({
				id: poolCtx.id,
				useCount: poolCtx.useCount,
				age: Date.now() - poolCtx.createdAt,
				busy: poolCtx.busy,
			});
		}

		return {
			total: this.contexts.size,
			available: this.available.length,
			busy: this.contexts.size - this.available.length,
			waiting: this.waiters.length,
			contexts: contextDetails,
		};
	}
}
