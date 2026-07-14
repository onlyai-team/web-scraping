import type { BrowserContext } from "playwright";

export interface ScrapeConfig {
    /** Max concurrent browser contexts */
    concurrency: number;
    /** Navigation timeout in ms */
    timeout: number;
    /** Wait for network idle before extracting */
    waitForNetworkIdle: boolean;
    /** Block images, fonts, stylesheets for speed */
    blockResources: boolean;
    /** Extra resource types to block */
    blockedResourceTypes: string[];
    /** Use Readability to extract main content (vs full page) */
    extractMainContent: boolean;
    /** Include page metadata (title, description, etc.) in output */
    includeMetadata: boolean;
    /** Custom headers to send */
    headers: Record<string, string>;
    /** User agent string */
    userAgent: string;
    /** Viewport dimensions */
    viewport: { width: number; height: number };
    /** Additional wait time after page load (ms) */
    waitAfterLoad: number;
    /** Custom JavaScript to execute before extraction */
    preExtractScript?: string;
    /** Rotate UA/viewport/language per context */
    rotateFingerprints: boolean;
    /** Force browser rendering (skip HTTP fast path) */
    skipStaticDetection: boolean;
    /** Recycle context after N uses (0 = never) */
    contextMaxUses: number;
    /** Min delay between same-domain requests (ms) */
    perDomainDelayMs: number;
    /** Wrap output in <document> tags */
    documentDelimiters: boolean;
}

export interface ScrapeJob {
    url: string;
    id: string;
    priority?: number;
    config?: Partial<ScrapeConfig>;
}

export interface ScrapeResult {
    id: string;
    url: string;
    markdown: string;
    metadata: PageMetadata;
    timing: {
        total: number;
        navigation: number;
        extraction: number;
        conversion: number;
    };
    error?: string;
}

export interface PageMetadata {
    title: string;
    description: string;
    url: string;
    domain: string;
    language?: string;
    author?: string;
    publishedDate?: string;
    wordCount: number;
}

export interface BrowserPoolContext {
    context: BrowserContext;
    busy: boolean;
    createdAt: number;
    useCount: number;
    id: number;
}

export const DEFAULT_CONFIG: ScrapeConfig = {
    concurrency: 5,
    timeout: 30_000,
    waitForNetworkIdle: true,
    blockResources: true,
    blockedResourceTypes: ["image", "stylesheet", "font", "media"],
    extractMainContent: true,
    includeMetadata: true,
    headers: {},
    userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    waitAfterLoad: 0,
    rotateFingerprints: true,
    skipStaticDetection: false,
    contextMaxUses: 50,
    perDomainDelayMs: 1000,
    documentDelimiters: false,
};

/** Ad / tracking domains to block at network level */
export const BLOCKED_DOMAINS = [
    "googletagmanager.com",
    "google-analytics.com",
    "doubleclick.net",
    "facebook.net",
    "facebook.com/tr",
    "analytics.",
    "hotjar.com",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    "sentry.io",
    "newrelic.com",
    "optimizely.com",
    "crazyegg.com",
    "fullstory.com",
    "intercom.io",
    "drift.com",
    "hubspot.com",
    "clarity.ms",
];

/** URL tracking params to strip from links */
export const TRACKING_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "gclsrc",
    "dclid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "ref",
    "source",
    "gs_lcrp",
    "sxsrf",
    "_ga",
    "_gl",
    "yclid",
    "twclid",
];

export const USER_AGENT_POOL: string[] = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
];

export const VIEWPORT_POOL: Array<{ width: number; height: number }> = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
];

export const ACCEPT_LANGUAGE_POOL: string[] = [
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,es;q=0.8",
    "en-GB,en;q=0.9,en-US;q=0.8",
    "en-US,en;q=0.9,fr;q=0.8",
    "en-US,en;q=0.9,de;q=0.8",
];
