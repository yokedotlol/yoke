# Yoke — Current State

> Volatile snapshot of the project. Updated after significant sessions.
> Run `.ai/staleness-check.sh` to detect drift.

**Last updated:** 2026-06-05

## Versions

| Component | Version | Source |
|-----------|---------|--------|
| Worker (service) | 2.3.1 | `YOKE_VERSION` in `worker/src/helpers.ts` |
| CLI | 1.5.0 | `cli/` GoReleaser tag `cli/v1.5.0` |
| MCP Server | 1.0.0 | `mcp/package.json` |
| Chrome Extension | 1.5.0 | `extension/manifest.json` (submitted + live on CWS) |

## Scoring

| Metric | Value |
|--------|-------|
| Scoring model | Deductive (budget-based, start at 100) |
| Axes | 6: Security, Speed, Foundations, Reputation, Discoverability, Email |
| Signal count | 156 |
| Composite method | Weighted arithmetic mean + outlier floor cap |
| Tier labels | Excellent, Strong, Moderate, Weak, Critical |
| Absent penalty | 0.30 × (1 + goodPrevalence) per signal (IDF-influenced) |
| Balance badge | σ<8 balanced, 8-15 uneven, >15 lopsided |
| Site archetypes | 7 |
| AI model | DeepSeek V3 (via OpenRouter) |

## Tests

| Metric | Value |
|--------|-------|
| Total tests | 362 |
| Test files | 24 |
| Calibration tests | 33 (in `scoring-calibration.test.ts`) |
| Total expect() calls | 713 |

## Infrastructure

| Resource | Details |
|----------|---------|
| Domain | yoke.lol |
| GitHub | yokedotlol/yoke |
| KV namespace | `REFERENCE_DATA` (all caching) |
| D1 database | `yoke-stats` (analytics/rate limits only) |
| Fly proxy | Auto-deploys via GitHub Actions (push to main) |
| Chrome Extension ID | fghkhjlelidaepapcdfjifnlcjmkgpcj |
| Themes | 12 |
| API endpoints | 24 total (13 public documented at `/api/docs`) |
| Cron triggers | Badge pre-warm hourly (`0 */1 * * *`) |
| UptimeRobot | Monitoring `/api/health`, status page linked from `/status` footer |

### Self-Hosted Instance (yoke-test.lol)

| Resource | Details |
|----------|---------|
| Server | Linode VPS, 4GB RAM, 2 vCPU, Ubuntu 24.04, `172.236.249.233` |
| Stack | Docker Compose: Caddy (TLS/reverse proxy) + workerd (miniflare engine) + probe (SSL/PageSpeed) |
| Domain | yoke-test.lol (Cloudflare DNS, unproxied) |
| White-label | "MyPerf" branding via `SITE_NAME`, `HIDE_*` env vars |
| Score | 91 Excellent (self-scan) |
| Email security | SPF hardfail, DMARC reject, DKIM, MTA-STS enforce, DNSSEC, CAA |

## Self-Hosting Architecture

Docker Compose is the maintained deployment path. Three containers:

- **caddy** — TLS termination (Let's Encrypt), static asset serving, reverse proxy to workerd. MTA-STS policy endpoint via env-templated MX hosts.
- **workerd** — miniflare-based analysis engine with persistent KV (SQLite) + D1 (SQLite). Runtime config injected as external `/assets/config.js` (not inline script — CSP blocks inline).
- **probe** — SSL/TLS probe + PageSpeed proxy (same Go binary as Fly proxy, self-contained).

White-label branding: `SITE_NAME`, `SITE_TAGLINE`, `REPO_URL`, `FEEDBACK_URL`, `HIDE_EXTENSION`, `HIDE_CLI`, `HIDE_GITHUB` env vars. All optional with sensible defaults.

Bare-metal is documented as "advanced/community-maintained" in `docs/SELF-HOSTING.md`.

## Fly Proxy

| Aspect | Details |
|--------|---------|
| Rate limiting | Global token bucket at 1000 req/s (`golang.org/x/time/rate`) |
| Over-limit response | 429 + `Retry-After: 1` header |
| Health endpoint | `GET /health` (authed) → `{"status":"ok","service":"yoke-probe","health":"green\|yellow\|red"}` |
| Health tiers | green <50% utilization, yellow 50-80%, red >80% (or >5% rejections) |
| Auth | `FLY_AUTH_SECRET` required on ALL endpoints including `/health` |

Worker-side: `flyProbeFetch()` helper in `helpers.ts` handles auth + 429 retry (2s backoff, 1 retry). Existing call sites degrade gracefully on probe failure.

## Privacy & Data Handling

| Aspect | Implementation |
|--------|---------------|
| User IP storage | SHA-256 hashed with daily-rotating salt — raw IPs never persisted |
| Rate limiting | D1 `endpoint_rate_limits` + `ai_rate_limits` tables store hashed IPs |
| Anonymous analytics | `request_meta` table: visitor_hash, country, client_type, endpoint, status, latency |
| BYO API keys | Client `localStorage` only, ephemeral on server (single-request memory, never logged) |
| Cookies/trackers | None |

## Homepage Domain Suggestions

| Aspect | Implementation |
|--------|---------------|
| Approach | 100% client-side — 250+ curated seed domains in `RecentLookups.tsx` |
| Behavior | Picks 10 randomly (Fisher-Yates) on each page load, renders as clickable pills |
| Server endpoint | None — `/_/showcase` and `/_/recent` both removed |
| Self-hosting | `scripts/seed-domains.sh` reads from the same domain list, fires `/api/analyze` with concurrency control |

## Recent Significant Commits

| Hash | Description |
|------|-------------|
| `0d13237` | Remove old og-banner-v3 asset |
| `5f943e2` | Badge fallback to analysis cache, embed UI in ShareBar, OG banner v4 |
| `609f597` | Time-budgeted sweep, hourly cron, badge dogfooding |
| `b04d9e7` | Extract shared finalizeResult(), add badge-cache module |
| `d7c8e2d` | Embeddable badge routes, SVG renderer, scheduled handler |
| `7ab6bff` | Extract route handlers from index.ts into route modules |
| `0282c60` | Ungate legal/trust probes from main HTTP probe |
| `9c01216` | Client-side domain pills replace `/_/showcase` |

## Panel Review Status

| Run | Launch Readiness | Critical | Improved | Steady | Regressed |
|-----|-----------------|----------|----------|--------|-----------|
| #1 (Jun 3) | ~6.5/10 | 2 | — | — | — |
| #2 (Jun 4 AM) | 8/10 | 0 | 10 | 10 | 0 |
| #3 (Jun 4 PM) | 9/10 | 0 | 11 | 9 | 0 |

All 9 batched decisions resolved. All product panels unanimous: ready for LinkedIn launch June 23.

## Open / Known Issues

_No open issues._

## Closed Issues

- **#3 Embeddable score badge:** Shipped in v2.3.1. Badge SVG/JSON endpoints, embed UI in ShareBar, hourly sweep cron, analysis cache fallback.
- **BYOK system prompt:** Fixed — BYO key AI analysis now includes system prompt.

## Launch

- **Target date:** June 23, 2026
- **Framing:** LinkedIn portfolio piece, NOT HN launch. Lead with `curl -s https://yoke.lol/stripe.com`, MCP server as secondary hook.
