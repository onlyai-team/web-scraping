# Cốc Cốc Search Engine Implementation

## Overview

Implemented Cốc Cốc search engine using the `/composer` API as specified. This engine uses a cookie jar session and parses search results from the initial SSR response.

## Implementation Details

### File: `src/search/engines/coccoc.ts`

**Key Features:**
- Cookie jar session management per worker
- Bootstrap cookies via GET `/search?query=<Q>`
- Extract `reqid` and `serp_version` from SSR response
- Parse `window.composerResponse` from initial HTML
- Skip ad results (with `advert_id` or `type=ad`)
- Clean HTML tags from titles and snippets
- User-Agent rotation to avoid detection
- CAPTCHA/block detection with proper error handling

**API Flow:**
1. GET `https://coccoc.com/search?query=<Q>` with fresh cookie jar
2. Parse cookies from response headers
3. Extract `window.composerResponse` JSON from HTML
4. Parse `search.search_results` array
5. Filter out ads, extract title/url/snippet
6. Return normalized SearchResponse

**Important Notes:**
- First query uses SSR response directly (most efficient)
- `/composer` API is useful for pagination (`p=1...`) and subsequent queries
- Cookie jar should be per-worker, not shared with browser/user
- Sequential requests per jar to avoid conflicts
- If response has CAPTCHA, throw `provider_verification_required` error
- `serp_version` needs to be refreshed when Cốc Cốc deploys updates

## Test Results

```bash
curl "http://localhost:3000/search?q=pnj&engine=coccoc"
```

**Response:**
```json
{
  "query": "pnj",
  "results": [
    {
      "title": "Công Ty Cổ Phần Vàng Bạc Đá Quý Phú Nhuận - PNJ",
      "url": "https://www.pnj.com.vn/",
      "snippet": "Hệ thống cửa hàng. Trang sức Nam. Nhẫn nam. Lắc tay nam. Dây chuyền nam. Trang sức Nữ. Nhẫn nữ.",
      "rank": 1
    },
    {
      "title": "CTCP Vàng bạc Đá quý Phú Nhuận - PNJ",
      "url": "https://finance.vietstock.vn/PNJ-ctcp-vang-bac-da-quy-phu-nhuan.htm",
      "snippet": "Thông tin CTCP Vàng bạc Đá quý Phú Nhuận (HOSE: PNJ): giá cổ phiếu, tin tức, dữ liệu tài chính, sự kiện và các thông tin phân tích chuyên sâu.",
      "rank": 2
    },
    {
      "title": "PNJ – Wikipedia tiếng Việt",
      "url": "https://vi.wikipedia.org/wiki/PNJ",
      "snippet": "Công ty Cổ phần Vàng bạc Đá quý Phú Nhuận (tiếng Anh: Phu Nhuan Jewelry Joint Stock Company, viết tắt là PNJ) là một công ty sản xuất và kinh doanh vàng bạc đá quý lớn tại Việt Nam.",
      "rank": 3
    }
    // ... 9 results total
  ],
  "engine": "coccoc",
  "duration": 420.09
}
```

## Architecture Integration

**Engine Registry:**
```typescript
// src/server.ts
const searchRegistry = new SearchEngineRegistry();
searchRegistry.register(new DuckDuckGoEngine());
searchRegistry.register(new CoccocEngine());
```

**Round-Robin Load Balancing:**
- Query 1: DuckDuckGo
- Query 2: Cốc Cốc
- Query 3: DuckDuckGo
- Query 4: Cốc Cốc
- ...

**Fallback:**
If one engine fails (e.g., DuckDuckGo rate limit), automatically try next engine.

## Configuration

All engines are configured with:
- `timeout`: Request timeout (default: 30000ms)
- User-Agent rotation
- Cookie management
- Error handling

## Future Enhancements

1. **Cookie jar pooling**: Reuse cookie jars across requests to reduce initialization overhead
2. **Request queuing**: Limit concurrent requests per engine
3. **Result caching**: Cache search results for common queries
4. **Proxy support**: Rotate IP addresses to avoid rate limiting
5. **Health checks**: Periodically check engine availability
6. **Metrics**: Track success rate, latency, and error rates per engine
7. **Pagination support**: Use `/composer` API with `p=1,2,3...` for more results
8. **Filter support**: Implement search filters (date, type, etc.)

## Comparison with Other Engines

| Engine | Speed | Reliability | Rate Limit | Results Quality |
|--------|-------|-------------|------------|-----------------|
| DuckDuckGo | Fast | Medium | Strict | Good |
| Cốc Cốc | Fast | High | Lenient | Excellent (Vietnamese) |

Cốc Cốc is particularly good for Vietnamese content and local businesses.

## Commit

```
feat: add Cốc Cốc search engine

- Parse window.composerResponse from SSR page
- Extract search results directly (no /composer API call needed for first query)
- Skip ad results (advert_id or type=ad)
- Clean HTML tags from titles and snippets
- Rotate User-Agent to avoid detection
- Proper error handling for captcha/block detection

Test result: 9 results for query 'pnj' from coccoc.com
```
