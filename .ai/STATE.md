# Yoke — Current State

> Volatile snapshot of the project. Updated after significant sessions.
> Run `.ai/staleness-check.sh` to detect drift.

**Last updated:** 2026-06-04

## Versions

| Component | Version | Source |
|-----------|---------|--------|
| Worker (service) | 2.1.0 | `YOKE_VERSION` in `worker/src/helpers.ts` |
| CLI | 1.5.0 | `cli/` GoReleaser tag `cli/v1.5.0` |
| MCP Server | 1.0.0 | `mcp/package.json` |
| Chrome Extension | — | `extension/manifest.json` |

## Scoring

| Metric | Value |
|--------|-------|
| Scoring model | Deductive (budget-based, start at 100) |
| Axes | 6: Security, Speed, Foundations, Reputation, Discoverability, Email |
| Signal count | 156 |
| Composite method | Weighted arithmetic mean + outlier floor cap |
| Tier labels | Excellent, Strong, Moderate, Weak, Critical |
| Absent penalty | 0.30 × (1 + goodPrevalence) per signal (IDF-influenced) |
| Site archetypes | 7 |
| AI model | DeepSeek V3 (via OpenRouter) |

## Tests

| Metric | Value |
|--------|-------|
| Total tests | 548 |
| Test files | 13 |
| Calibration tests | 293 (in `scoring-calibration.test.ts`) |

## Infrastructure

| Resource | Details |
|----------|---------|
| Domain | yoke.lol |
| GitHub | yokedotlol/yoke |
| KV namespace | `REFERENCE_DATA` (all caching) |
| D1 database | `yoke-stats` (analytics/rate limits only) |
| Fly proxy | Auto-deploys via GitHub Actions |
| Chrome Extension ID | fghkhjlelidaepapcdfjifnlcjmkgpcj |
| Themes | 12 |
| API endpoints | 21 total (11 public documented at `/api/docs`) |

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
| `a8da63f` | seed-domains.sh for self-hosters, 250+ curated domains |
| `9c01216` | Client-side domain pills replace `/_/showcase` |
| `1c03e4b` | WordPress VIP in HOSTING_PATTERNS + test fix |
| `a1ab990` | Hash user IPs, Brandfetch UA, news cache TTL |
| `ebf7bae` | Comprehensive a11y fixes (skip link, WCAG AA, keyboard nav, ARIA) |
| `f430b0a` | SECURITY.md with vulnerability reporting + data handling |

## Open / Known Issues

- **Fly proxy deploy**: Requires manual `cd fly-proxy && fly deploy` by Kurt (no `FLY_API_TOKEN` in CI env).
- **External uptime monitoring**: UptimeRobot planned — reminder set for Saturday June 6.
- **Chrome extension**: v1.5.0 ready, not yet submitted to Chrome Web Store — reminder set for Saturday June 6.
- **Fly proxy rate limiting**: Researched (50 global, 10/IP/s, 2/s PageSpeed) but not yet implemented (~30-45 min Go work).
- **Self-hosting on Linode**: Planned for Saturday June 6 — workerd + Caddy + Let's Encrypt on yoke-test.lol.

## Launch

- **Target date:** June 23, 2026
- **Framing:** LinkedIn portfolio piece, NOT HN launch. Lead with `curl -s https://yoke.lol/stripe.com`, MCP server as secondary hook.
