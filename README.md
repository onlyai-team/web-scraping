# mozy-scrape

Web scraper and search engine aggregator with modular architecture

## Features

### Web Scraper
- Single URL and batch scraping
- Markdown output optimized for LLM consumption
- Main content extraction (Readability) or full-page mode
- Browser fingerprint rotation (user agent, viewport, language)
- Ad/tracker domain blocking (GA, Facebook, Hotjar, etc.)
- Browser context pooling with configurable recycling
- Per-domain request delay throttling

### Search Engine
- Modular search engine architecture
- DuckDuckGo Lite integration
- Round-robin load balancing across multiple engines
- Automatic fallback on engine failure
- Extensible design for adding new search engines

## Architecture

```
src/
├── scraper/          # Web scraping module
│   ├── scraper.ts    # Main scraper logic
│   ├── browser-pool.ts
│   ├── extractor.ts
│   ├── html-to-markdown.ts
│   └── types.ts
├── search/           # Search engine module
│   ├── engines/      # Search engine implementations
│   │   ├── duckduckgo.ts
│   │   ├── brave.ts  # Brave Web Search API
│   │   └── bing.ts   # (stub)
│   ├── registry.ts   # Engine registry & round-robin
│   └── types.ts      # Abstract SearchEngine interface
└── common/           # Shared utilities
    └── logger.ts
```

## Stack

| Library | Purpose |
|---------|---------|
| [rebrowser-playwright](https://github.com/nicepkg/rebrowser-playwright) | Anti-detect headless Chromium automation |
| [defuddle](https://github.com/nicepkg/defuddle) | Readability-based content extraction |
| [linkedom](https://github.com/nicepkg/linkedom) | Server-side DOM parser |
| [turndown](https://github.com/nicepkg/turndown) | HTML-to-Markdown conversion |
| [turndown-plugin-gfm](https://github.com/nicepkg/turndown-plugin-gfm) | GFM support (tables, strikethrough) |
| [p-queue](https://github.com/nicepkg/p-queue) | Concurrency queue |
| [bun](https://bun.sh) | Runtime, HTTP server, bundler |

## Usage

### CLI

```bash
bun run start https://example.com
bun run start --json https://example.com
bun run start -c 10 url1 url2 url3
bun run start --output result.md https://example.com
bun run start --full-page https://example.com
```

**Options:** `-c` concurrency (default 5), `--timeout` ms (default 30000), `--wait` ms after load, `--output` file, `--json`, `--full-page`, `--no-metadata`, `--no-block`

### HTTP Server

```bash
bun run serve     # start on :3000
bun run dev       # start with hot reload
```

**Endpoints:**

### Web Scraping
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + stats |
| `POST` | `/scrape` | Scrape single URL |
| `POST` | `/scrape/batch` | Scrape up to 100 URLs |
| `POST` | `/scrape/stream` | SSE stream of results |

```bash
curl -X POST http://localhost:3000/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

**Request body options:** `url`, `urls`, `format` (`"markdown"`), `timeout`, `waitAfterLoad`, `extractMainContent`, `fullPage`, `includeMetadata`, `blockResources`

### Search Engine
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/search` | Search with round-robin |
| `GET` | `/search` | Search with query parameters |

```bash
# Round-robin across all registered engines
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "typescript web scraping"}'

# Use specific engine
curl -X POST http://localhost:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "typescript web scraping", "engine": "duckduckgo"}'

# GET request with query parameters
curl "http://localhost:3000/search?q=typescript&engine=duckduckgo"
```

**Request body options:** `query` (required), `engine` (optional, defaults to round-robin)

All runtime settings are centralised in `src/config/runtime.ts`. Copy the example environment file and configure only the values you need:

```bash
cp .env.example .env
# Set BRAVE_SEARCH_API_KEY in .env
bun run serve
```

Brave is registered in the round-robin pool only when `BRAVE_SEARCH_API_KEY` is set. You can select it directly with `"engine": "brave"`.

**Response:**
```json
{
  "query": "typescript",
  "results": [
    {
      "title": "TypeScript: JavaScript With Syntax For Types",
      "url": "https://www.typescriptlang.org/",
      "description": "TypeScript extends JavaScript by adding types to the language..."
    }
  ],
  "engine": "duckduckgo",
  "duration": 1234.5
}
```

### Docker

```bash
docker build -t mozy-scrape .
docker run -p 3000:3000 mozy-scrape
```

**Env vars:** `PORT`, `HOST`, `CONCURRENCY`, `TIMEOUT`, `BRAVE_SEARCH_API_KEY`, `LOG_LEVEL`
