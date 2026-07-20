# Yoke — Key Patterns & Anti-Patterns

> Operational coding guide. Follow these when working in the codebase.

## Signal Registry (`worker/src/config/signal-registry.ts`)

Single source of truth for every scoring signal. Every signal declares its axis, actionability, effort, fix description, and weight range. Derived constants (`NON_ACTIONABLE`, `EFFORT_MAP`, `FIX_DESC_MAP`, etc.) are exported for use across server and client.

When adding a signal:
1. Add it to `signal-registry.ts`
2. Add the scoring logic in `contextual-scoring.ts` (`findings.push(...)`)
3. Run `npx vitest run` — the registry enforcement tests will catch gaps

## Check Registry (`worker/src/checks/`)

Analysis checks are individual files with a standard interface. See `worker/src/checks/types.ts`:

```typescript
interface Check {
  key: string;       // result object key
  label: string;     // streaming progress label
  default: unknown;  // fallback on failure
  run: (ctx: CheckContext) => Promise<unknown>;
}
```

**To add a check:** create a file in `checks/`, export a `Check` object, register in `checks/registry.ts`. Append to the end — order matters for streaming.

## Client Build

The client SPA is built by `client/build.ts`, which generates `client/dist/index.html` from a **hardcoded template literal** — NOT from `client/index.html`. If you need to change the HTML shell (meta tags, footer links, inline scripts), edit the template in `build.ts`, not `client/index.html`.

## External Fetches

Always use helpers from `worker/src/helpers.ts`:

- **`fetchWithTimeout(url, init, timeoutMs)`** — every external call needs a timeout
- **`boundedText(response, maxBytes)`** — caps response body reads (default 2MB). Use for any response you `.text()`
- **`safeFetchWithRedirects(url, init, maxRedirects)`** — follows redirects with SSRF checks at each hop
- **`isBlockedUrl(url)`** — SSRF check. Always validate URLs from user input or redirects

Never use bare `fetch()` for external calls. Never use `.text()` without `boundedText()`.

## Caching

Use `getFromCache()` and `setCache()` from `helpers.ts`. Both operate on the KV namespace (`env.REFERENCE_DATA`). Cache keys follow the pattern `cache:{type}:{domain}`. TTL is handled by KV expiry — no manual pruning needed.

## Error Handling

- Checks **must not throw**. Return `check.default` on failure.
- Use `log('warn', ...)` from `worker/src/logger.ts` in catch blocks — not bare `console.log` and never empty `catch {}`.
- Fail-open for non-critical checks (one failed check shouldn't block the analysis).
- Fail-closed for security checks (SSRF protection, admin auth).

## Logging

Use the structured logger (`worker/src/logger.ts`), not `console.log`:

```typescript
import { log } from '../logger';
log('info', 'analysis started', { domain: 'stripe.com' });
log('warn', 'RDAP timeout', { domain, elapsed: 5000 });
log('error', 'KV write failed', { domain, error: String(e) });
```

## CORS

CORS headers are applied by the `json()` helper in `helpers.ts` for public endpoints. Admin endpoints (`/api/cleanup`, `/api/cache`, `/usage`) use `adminJson()` which includes CORS headers (needed for the dashboard UI) but requires authentication via `X-Admin-Key`. The admin CORS is safe because authentication gates access, not origin restrictions.

## Rate Limiting

- Endpoint rate limits: D1-backed (`STATS_DB`), per-hashed-IP, checked via `checkRateLimit()`. IPs are hashed via `hashIp()` from `helpers.ts` (SHA-256 + static salt) before being passed to the rate limiter — raw IPs never touch D1.
- AI analysis: separate rate limit table in `STATS_DB`, same hashed-IP approach, slot reserved before API call, refunded on failure using the specific row ID (not `ORDER BY id DESC LIMIT 1` — that's racy).
- Anonymous analytics: `request-tracking.ts` uses its own `hashVisitor()` with a secret salt + daily-rotating component. Writes to `request_meta` table with visitor_hash, country, client_type, endpoint, status, latency. Callers skip the rate-limit check for cache hits (see `api-core.ts`).

## Anti-Patterns — Don't Do These

- **No `as any`** — the codebase is fully typed, keep it that way
- **No bare `console.log`** — use the structured logger
- **No module-level `let`** for per-request state — pass through params
- **No unbounded response reads** — always use `boundedText()`
- **No `io.Copy` without `io.LimitReader`** in the Go proxy — cap at 1MB
- **No raw error messages to clients** in the Go proxy — log details server-side, return generic errors
- **No `__HTML__` / `__ROBOTS_TXT__` build-time globals** — use `env.ASSETS.fetch()`
- **Admin endpoints require authentication** — `adminJson()` includes CORS (for dashboard) but gates access via `X-Admin-Key`
- **No editing `client/index.html` for the HTML shell** — edit the template in `client/build.ts`
- **No inline `<script>` for config injection** — CSP blocks inline; use external `/assets/config.js`
- **No hardcoded mail provider MX hosts** — use `MTA_STS_MX_*` env vars

## Fly Proxy Patterns (`fly-proxy/main.go`)

- **Auth on everything:** All endpoints require `Authorization: Bearer <FLY_AUTH_SECRET>`. No public surface.
- **Rate limiting:** Global token bucket (`golang.org/x/time/rate`) at 1000 req/s. 429 + `Retry-After: 1` on exhaustion.
- **Health tiers:** Rolling 60s counters → green/yellow/red. No raw numbers exposed externally.
- **Worker-side helper:** Use `flyProbeFetch()` from `helpers.ts` for all probe calls — handles auth header injection and 429 retry (2s backoff, 1 retry). Degrades gracefully when probe is unreachable.
- **Go version:** Pinned to 1.22 in Dockerfile. Don't let `go get` bump `go.mod` past this.

## Self-Hosting Patterns

Docker Compose is the maintained path. Key patterns:

- **Runtime config via env vars:** White-label settings (`SITE_NAME`, `HIDE_*`, etc.) are injected by `entrypoint.sh` into `/assets/config.js` at container start. Never bake config into the image.
- **External config script:** Client reads `window.__YOKE_CONFIG__` from `/assets/config.js` (external `<script src>`). CSP `script-src 'self'` allows this. Never use inline scripts.
- **MTA-STS templating:** MX hosts are env vars (`MTA_STS_MX_1/2/3`). Caddyfile uses `{env.*}` placeholders. Self-hosters set their own mail provider's MX records.
- **Persistent storage:** KV and D1 are SQLite files in Docker volumes. Don't put them in the image layer.
- **Probe container:** Same Go binary as Fly proxy, runs SSL/TLS checks + PageSpeed proxying. Worker points to it via `FLY_PROXY_URL=http://probe:8080`.

## Testing

```bash
npx vitest run        # 438 tests, all should pass
cd fly-proxy && go test -v   # Go proxy unit tests
```

Tests cover: scoring thresholds, signal registry enforcement, detection fingerprints, WHOIS parsing, helpers, registry order, content negotiation, structured data, scoring integration, scoring calibration. No D1 mocking or integration tests — tests are pure functions only.

When adding a check, add a test for its expected output shape and a test for graceful failure.

## Build & Deploy

```bash
bun install && cd client && bun install && cd ../worker && bun install && cd ..
bash deploy.sh --cf              # builds client + worker, deploys to CF
cd worker && bun run dev         # local Worker dev (needs wrangler.toml)
cd client && bun run dev         # local Vite dev server
```

Type checking: `cd worker && bun run typecheck` (must pass with zero errors — CI enforces this).

Linting: `npx @biomejs/biome check .` (must pass with zero errors — CI enforces this). Auto-fix: `npx @biomejs/biome check --write .`. Config in `biome.json`.

Secrets (OpenRouter, WhoisFreaks, PageSpeed API keys, ADMIN_KEY, SHARE_SECRET) are CF Worker secrets — never in code or wrangler.toml. `SHARE_SECRET` hard-fails if missing (no dev fallback).

## File Quick Reference

| Task | File |
|------|------|
| Add an analysis check | `worker/src/checks/` + `registry.ts` |
| Add/modify a scoring signal | `worker/src/config/signal-registry.ts` + `contextual-scoring.ts` |
| Change scoring logic/axes | `worker/src/actions/analyze/contextual-scoring.ts` + `config/` |
| Change routing / add endpoint | `worker/src/index.ts` |
| Modify analysis orchestration | `worker/src/actions/analyze/core.ts` |
| Edit AI analysis prompt | `prompts/ai-analysis.txt` |
| Edit the HTML shell / footer | `client/build.ts` (NOT `client/index.html`) |
| SSRF / CORS / fetch / cache helpers | `worker/src/helpers.ts` |
| OG tags / CSP / SPA serving | `worker/src/spa.ts` |
| Share cards / signed URLs | `worker/src/share.ts` |
| Fly proxy (SSL, GeoIP) | `fly-proxy/main.go` |
| Chrome extension | `extension/` |
| CLI | `cli/` |
| Tests | `tests/*.test.ts` |
