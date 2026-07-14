import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { TRACKING_PARAMS } from "./types.ts";

/**
 * Converts raw HTML to clean, LLM-ready markdown.
 * Based on AnyCrawl's html-to-markdown with additional
 * LLM-optimized post-processing.
 */
export function htmlToMarkdown(html: string, baseUrl?: string): string {
    // Protect preformatted content before whitespace normalization
    const preBlocks: string[] = [];
    html = html.replace(
        /<(pre|code)([\s\S]*?)>([\s\S]*?)<\/\1>/gi,
        (full, _tag: string, _attrs: string, _content: string) => {
            const idx = preBlocks.length;
            preBlocks.push(full);
            return `<!--PRE_BLOCK_${idx}-->`;
        },
    );

    // Pre-process: collapse whitespace between tags
    html = html.replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();

    // Restore preformatted blocks
    html = html.replace(
        /<!--PRE_BLOCK_(\d+)-->/g,
        (_, idx: string) => preBlocks[Number(idx)] || "",
    );

    const td = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        preformattedCode: false,
    });

    // GFM support: tables, strikethrough, task lists
    td.use(gfm);

    // Strip noise elements
    td.remove(["script", "style", "noscript", "meta", "link", "svg", "iframe"]);

    // -- Custom rules ported from AnyCrawl reference --

    td.addRule("paragraphs", {
        filter: "p",
        replacement(content: string, node: Node) {
            const trimmed = content.trim();
            if (!trimmed) return "";
            // Inline if inside an anchor
            let cursor: Node | null = node;
            while (cursor) {
                if (cursor.nodeName === "A") return trimmed;
                cursor = cursor.parentNode;
            }
            return `\n\n${trimmed}\n\n`;
        },
    });

    td.addRule("divs", {
        filter: "div",
        replacement(content: string, node: Node) {
            const trimmed = content.trim();
            if (!trimmed) return "";
            const el = node as HTMLElement;
            const hasBlock = el.querySelector?.(
                "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table",
            );
            // Inline if inside anchor
            let cursor: Node | null = node;
            while (cursor) {
                if (cursor.nodeName === "A") return trimmed;
                cursor = cursor.parentNode;
            }
            return hasBlock ? `\n\n${trimmed}\n\n` : `${trimmed} `;
        },
    });

    td.addRule("spans", {
        filter: "span",
        replacement(content: string, node: Node) {
            const trimmed = content.trim();
            if (!trimmed) return "";
            const prev = node.previousSibling;
            const next = node.nextSibling;
            let prefix = "";
            if (
                prev &&
                ((prev.nodeType === 3 && prev.textContent?.trim()) ||
                    (prev.nodeName === "SPAN" && prev.textContent?.trim()))
            ) {
                prefix = " ";
            }
            let suffix = "";
            if (
                next &&
                ((next.nodeType === 3 && next.textContent?.trim()) ||
                    (next.nodeName === "SPAN" && next.textContent?.trim()))
            ) {
                suffix = " ";
            }
            return prefix + trimmed + suffix;
        },
    });

    td.addRule("linkedImages", {
        filter(node: Node) {
            const el = node as HTMLElement;
            if (!el || el.nodeName !== "A") return false;
            const children = Array.from(el.childNodes).filter(
                (n) => !(n.nodeType === 3 && !n.textContent?.trim()),
            );
            if (children.length !== 1) return false;
            return children[0]?.nodeName === "IMG";
        },
        replacement(content: string, node: Node) {
            const a = node as HTMLAnchorElement;
            const href = (a.getAttribute?.("href") || "").trim();
            const bad = !href || href === "#" || href.toLowerCase().startsWith("javascript:");
            const img = content.trim();
            return bad ? img : `[${img}](${href})`;
        },
    });

    td.addRule("figureWrapper", {
        filter: ["figure", "picture"],
        replacement(content: string) {
            const inner = content.trim();
            return inner ? `\n\n${inner}\n\n` : "";
        },
    });

    td.addRule("figcaption", {
        filter: "figcaption",
        replacement(content: string) {
            const t = content.trim();
            return t ? `\n\n${t}\n\n` : "";
        },
    });

    td.addRule("emphasis", {
        filter: ["em", "i", "strong", "b"],
        replacement(content: string, node: Node) {
            const c = content.trim();
            if (!c) return "";
            const n = node.nodeName.toLowerCase();
            if (n === "em" || n === "i") return `*${c}*`;
            if (n === "strong" || n === "b") return `**${c}**`;
            return c;
        },
    });

    td.addRule("lineBreaks", {
        filter: "br",
        replacement() {
            return "\n";
        },
    });

    // -- Convert --
    let md = td.turndown(html);

    // -- Post-processing --
    md = normalizeBracketWrappedImages(md);
    md = normalizeLinkTextWhitespace(md);

    if (baseUrl) {
        md = resolveRelativeUrls(md, baseUrl);
    }
    md = stripTrackingParams(md);
    md = cleanForLLM(md);

    return md;
}

// -- Post-processing helpers --

function normalizeBracketWrappedImages(input: string): string {
    let output = input;
    const collapse = (s: string) => s.replace(/\[\s*(!\[[^\]]*\]\([^)]+\))\s*\]/g, "[$1]");
    const strip = (s: string) => s.replace(/\[\s*(!\[[^\]]*\]\([^)]+\))\s*\](?!\s*[([])/, "$1");
    let prev: string;
    do {
        prev = output;
        output = collapse(output);
        output = strip(output);
    } while (output !== prev);
    return output;
}

function normalizeLinkTextWhitespace(input: string): string {
    return input.replace(/\[\s*([\s\S]*?)\s*\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
        const cleaned = text
            .replace(/[\t\r\n]+/g, " ")
            .replace(/\s{2,}/g, " ")
            .trim();
        return `[${cleaned}](${href})`;
    });
}

function resolveRelativeUrls(md: string, baseUrl: string): string {
    let base: URL;
    try {
        base = new URL(baseUrl);
    } catch {
        return md;
    }
    // Resolve markdown links: [text](url) and ![alt](url)
    return md.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (full, prefix: string, href: string) => {
        const h = href.trim();
        if (
            h.startsWith("http://") ||
            h.startsWith("https://") ||
            h.startsWith("data:") ||
            h.startsWith("mailto:")
        ) {
            return full;
        }
        try {
            const resolved = new URL(h, base).href;
            return `${prefix}(${resolved})`;
        } catch {
            return full;
        }
    });
}

function stripTrackingParams(md: string): string {
    return md.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (full, prefix: string, href: string) => {
        try {
            const url = new URL(href.trim());
            let changed = false;
            for (const p of TRACKING_PARAMS) {
                if (url.searchParams.has(p)) {
                    url.searchParams.delete(p);
                    changed = true;
                }
            }
            return changed ? `${prefix}(${url.href})` : full;
        } catch {
            return full;
        }
    });
}

function cleanForLLM(md: string): string {
    let out = md;

    // Remove zero-width and non-breaking spaces
    out = out.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "");
    out = out.replace(/\u00A0/g, " ");

    // Remove HTML comments that survived conversion
    out = out.replace(/<!--[\s\S]*?-->/g, "");

    // Remove images with data URIs (inline SVGs, base64 blobs)
    out = out.replace(/!\[[^\]]*\]\(data:[^)]+\)/g, "");

    // Remove empty links
    out = out.replace(/\[\s*\]\([^)]*\)/g, "");

    // Remove self-referential anchors [text](#)
    out = out.replace(/\[([^\]]+)\]\(#\)/g, "$1");

    // Collapse 3+ blank lines to max 2
    out = out.replace(/\n{3,}/g, "\n\n");

    // Remove trailing whitespace per line
    out = out.replace(/[ \t]+$/gm, "");

    // Remove common boilerplate text that survives extraction
    const boilerplatePatterns = [
        /^[\s]*(?:Share this (?:article|post|page|story)|Share on)[\s]*$/gim,
        /^[\s]*(?:Related (?:posts?|articles?|stories?|content))[\s:]*$/gim,
        /^[\s]*(?:You (?:may|might) also (?:like|enjoy))[\s:]*$/gim,
        /^[\s]*(?:Read (?:more|next|also))[\s:]*$/gim,
        /^[\s]*Copyright\s.*$/gim,
        /^[\s]*All rights reserved[\s.]*$/gim,
        /^[\s]*(?:Follow us|Subscribe|Newsletter|Sign up)[\s:]*$/gim,
        /^[\s]*(?:Leave a (?:comment|reply))[\s.]*$/gim,
        /^[\s]*(?:Comments? (?:are )?(?:closed|disabled))[\s.]*$/gim,
        /^[\s]*(?:Previous|Next) (?:article|post)[\s:]*$/gim,
    ];
    for (const pattern of boilerplatePatterns) {
        out = out.replace(pattern, "");
    }

    return out.trim();
}
