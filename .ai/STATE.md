# Yoke — Current State

> Volatile snapshot of the project. Updated after significant sessions.
> Run `.ai/staleness-check.sh` to detect drift.

**Last updated:** 2026-06-01

## Versions

| Component | Version | Source |
|-----------|---------|--------|
| Worker (service) | 2.0.0 | `YOKE_VERSION` in `worker/src/helpers.ts` |
| CLI | 1.5.0 | `cli/` GoReleaser tag `cli/v1.5.0` |
| MCP Server | 1.0.1 | `mcp-server/package.json` |
| Chrome Extension | — | `extension/manifest.json` |

## Scoring

| Metric | Value |
|--------|-------|
| Scoring model | Deductive (budget-based, start at 100) |
| Axes | 6: Security, Speed, Foundations, Reputation, Discoverability, Email |
| Signal count | 155 |
| Composite method | Weighted arithmetic mean + outlier floor cap |
| Tier labels | Excellent, Strong, Moderate, Weak, Critical |
| Absent penalty | 0.15 |
| Site archetypes | 7 |
| AI model | DeepSeek V3 (via OpenRouter) |

## Tests

| Metric | Value |
|--------|-------|
| Total tests | 505 |
| Test files | 11 |
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
| API endpoints | 18 (documented at `/api/docs`) |

## Recent Significant Commits

| Hash | Description |
|------|-------------|
| `52f1586` | Second fix sprint — 20 fixes (scoring, double-emits, dead code, CSS split) |
| `30ded08` | First fix sprint — 15 review findings fixed |
| `92205b1` | Scoring model rewrite: anchor-and-adjust → deductive |
| `47d27d3` | Composite: geometric mean → weighted arithmetic mean |
| `e1d0154` | Context-aware normalization + Level-Up opportunities |

## Open / Known Issues

- **Fly proxy deploy**: Requires manual `cd fly-proxy && fly deploy` by Kurt (no `FLY_API_TOKEN` in CI env). Affects desktop PageSpeed and MTA-STS self-scan.
- **`docs/internal/` exposure**: Decision pending on whether internal docs directory should exist in public repo.
- **OG Worker not in CI**: The `og-worker/` has its own `wrangler.toml` but no CI pipeline.
- **External uptime monitoring**: Not set up yet.

## Launch

- **Target date:** June 23, 2026
- **Show HN framing:** Lead with `curl yoke.lol/stripe.com`, MCP server as secondary hook.
