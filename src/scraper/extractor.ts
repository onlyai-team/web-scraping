import Defuddle from "defuddle";
import { parseHTML } from "linkedom";
import type { PageMetadata } from "./types.ts";

/** Noise selectors to strip before extraction */
const NOISE_SELECTORS = [
    "nav",
    "footer",
    "header:not(article header)",
    "aside",
    "[role='navigation']",
    "[role='banner']",
    "[role='complementary']",
    "[role='contentinfo']",
    "[aria-hidden='true']",
    ".sidebar",
    ".nav",
    ".navigation",
    ".menu",
    ".advertisement",
    ".ad",
    ".ads",
    ".advert",
    ".social-share",
    ".social-links",
    ".share-buttons",
    ".cookie-banner",
    ".cookie-notice",
    ".cookie-consent",
    ".gdpr",
    ".popup",
    ".modal",
    ".overlay",
    ".newsletter",
    ".subscribe",
    ".related-posts",
    ".related-articles",
    ".comments",
    ".comment-section",
    "#comments",
    ".breadcrumb",
    ".breadcrumbs",
    ".pagination",
    ".footer",
    ".site-footer",
    ".site-header",
    ".site-nav",
    ".wp-block-latest-posts",
];

export interface ExtractionResult {
    content: string;
    metadata: PageMetadata;
}

/**
 * Extracts main content from raw HTML using Defuddle.
 * Falls back to cleaned full-page HTML if Defuddle fails.
 */
export function extractContent(html: string, url: string): ExtractionResult {
    const { document } = parseHTML(html);
    const metadata = extractMetadata(document, url);

    // Remove noise before Defuddle (complementary)
    removeNoiseElements(document);

    // Shim getComputedStyle for linkedom (Defuddle uses it to detect hidden elements)
    shimGetComputedStyle(document);

    // Defuddle extraction (handles code block normalization internally)
    try {
        const result = new Defuddle(document as unknown as Document, {
            url,
        }).parse();

        if (result.content) {
            metadata.title = result.title || metadata.title;
            if (result.author) metadata.author = result.author;
            if (result.published) metadata.publishedDate = result.published;
            if (result.description)
                metadata.description = result.description || metadata.description;
            if (result.domain) metadata.domain = result.domain;
            const wordCount =
                result.wordCount || countWords(result.content.replace(/<[^>]+>/g, ""));
            metadata.wordCount = wordCount;
            return { content: result.content, metadata };
        }
    } catch {
        // Defuddle failed — fall through to fallback
    }

    // Fallback: cleaned body HTML
    normalizeCodeBlocks(document);
    const body = document.querySelector("body");
    const fallbackHtml = body?.innerHTML || html;
    metadata.wordCount = countWords(body?.textContent || "");
    return { content: fallbackHtml, metadata };
}

/**
 * Returns cleaned full-page HTML (no Readability extraction).
 * Useful when you want the complete page content.
 */
export function extractFullPage(html: string, url: string): ExtractionResult {
    const { document } = parseHTML(html);
    const metadata = extractMetadata(document, url);

    normalizeCodeBlocks(document);

    removeNoiseElements(document);

    const body = document.querySelector("body");
    const content = body?.innerHTML || html;
    metadata.wordCount = countWords(body?.textContent || "");

    return { content, metadata };
}

function extractMetadata(document: Document, url: string): PageMetadata {
    const get = (sel: string, attr?: string): string => {
        const el = document.querySelector(sel);
        if (!el) return "";
        return attr ? el.getAttribute(attr) || "" : el.textContent?.trim() || "";
    };

    let domain = "";
    try {
        domain = new URL(url).hostname;
    } catch {}

    return {
        title: get("title") || get('meta[property="og:title"]', "content") || "",
        description:
            get('meta[name="description"]', "content") ||
            get('meta[property="og:description"]', "content") ||
            "",
        url,
        domain,
        language: document.documentElement?.getAttribute("lang") || undefined,
        author: get('meta[name="author"]', "content") || get('[rel="author"]') || undefined,
        publishedDate:
            get('meta[property="article:published_time"]', "content") ||
            get("time", "datetime") ||
            undefined,
        wordCount: 0,
    };
}

function removeNoiseElements(document: Document): void {
    for (const selector of NOISE_SELECTORS) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                el.remove();
            }
        } catch {
            // Skip invalid selectors
        }
    }

    // Remove images with inline SVG data URIs (produces garbage in markdown)
    const imgs = document.querySelectorAll("img");
    for (const img of imgs) {
        const src = img.getAttribute("src") || "";
        if (src.startsWith("data:image/svg")) {
            img.remove();
        }
    }

    // Remove hidden elements
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
        const style = el.getAttribute("style") || "";
        if (
            style.includes("display:none") ||
            style.includes("display: none") ||
            style.includes("visibility:hidden") ||
            style.includes("visibility: hidden")
        ) {
            el.remove();
        }
    }
}

/**
 * Normalize <pre>/<code> blocks so inner content has real newlines.
 * Many sites render code with <div> per line or <span> tokens,
 * relying on CSS for visual newlines. This converts them to plain
 * text with \n so Turndown produces proper fenced code blocks.
 */
function normalizeCodeBlocks(document: Document): void {
    const pres = document.querySelectorAll("pre");
    for (const pre of pres) {
        // Detect language from class="language-xxx" on pre or child code
        let lang = "";
        const code = pre.querySelector("code");
        const langSource = code || pre;
        const cls = langSource.getAttribute?.("class") || "";
        const langMatch = cls.match(/(?:language-|lang-)(\w+)/);
        if (langMatch) lang = langMatch[1];

        // Extract text line-by-line, respecting block elements as newlines
        const lines = extractCodeLines(pre);
        const text = lines.join("\n");

        // Replace inner HTML with clean text
        if (code) {
            code.textContent = text;
            // Remove all other children of pre (keep only the code element)
            while (pre.firstChild && pre.firstChild !== code) {
                pre.removeChild(pre.firstChild);
            }
            while (code.nextSibling) {
                pre.removeChild(code.nextSibling);
            }
        } else {
            pre.textContent = text;
        }

        // Set language hint as data attribute for Turndown
        if (lang) {
            (code || pre).setAttribute("class", `language-${lang}`);
        }
    }
}

function extractCodeLines(node: Node): string[] {
    const lines: string[] = [];
    let currentLine = "";

    function walk(n: Node) {
        if (n.nodeType === 3) {
            // Text node
            const text = n.textContent || "";
            // Split on existing newlines
            const parts = text.split("\n");
            for (let i = 0; i < parts.length; i++) {
                currentLine += parts[i];
                if (i < parts.length - 1) {
                    lines.push(currentLine);
                    currentLine = "";
                }
            }
        } else if (n.nodeType === 1) {
            // Element node
            const tag = n.nodeName.toLowerCase();
            const isBlock = tag === "div" || tag === "br" || tag === "p" || tag === "tr";

            if (tag === "br") {
                lines.push(currentLine);
                currentLine = "";
                return;
            }

            for (const child of n.childNodes) {
                walk(child);
            }

            if (isBlock && currentLine !== "") {
                lines.push(currentLine);
                currentLine = "";
            }
        }
    }

    walk(node);
    if (currentLine) lines.push(currentLine);

    // Remove trailing empty lines but preserve internal structure
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
        lines.pop();
    }

    return lines;
}

/**
 * Linkedom doesn't implement several DOM APIs that Defuddle expects.
 * Shim them so Defuddle can run without throwing or logging errors.
 *
 * - getComputedStyle: used to detect hidden elements
 * - document.styleSheets: used by _evaluateMediaQueries
 */
function shimGetComputedStyle(document: Document): void {
    const win = (document as unknown as { defaultView?: Record<string, unknown> }).defaultView;
    if (win && typeof win.getComputedStyle !== "function") {
        win.getComputedStyle = () =>
            new Proxy({} as CSSStyleDeclaration, {
                get(_target, prop) {
                    if (prop === "getPropertyValue") return () => "";
                    return "";
                },
            });
    }

    // Linkedom doesn't expose styleSheets; Defuddle iterates it for media query evaluation
    const doc = document as unknown as Record<string, unknown>;
    if (!doc.styleSheets) {
        doc.styleSheets = [];
    }
}

function countWords(text: string): number {
    return text
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
}
