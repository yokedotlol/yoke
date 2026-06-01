# Yoke — Project Constitution

> Stable identity, architecture, and red lines. Changes here are rare and require discussion.

## What Yoke Is

Open-source domain intelligence tool at [yoke.lol](https://yoke.lol). Users enter a domain → get a comprehensive multi-axis analysis with contextual scoring. MIT license, public repo at [yokedotlol/yoke](https://github.com/yokedotlol/yoke).

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Worker | Cloudflare Workers (TypeScript, zero-framework) | `worker/src/` |
| Client | React SPA (Vite + TypeScript + Tailwind v4) | `client/src/` |
| Proxy | Go HTTP proxy on Fly.io (SSL probing, GeoIP) | `fly-proxy/` |
| Extension | Chrome Manifest V3, side panel | `extension/` |
| CLI | Go, goreleaser, Homebrew tap | `cli/` |
| MCP Server | TypeScript, npm package | `mcp-server/` |

### Storage

- **KV `REFERENCE_DATA`** — all caching. Domain results, recent lookups, subdomain scans, AI analysis. TTL-based.
- **D1 `yoke-stats`** — durable stats only. Rate limits, endpoint usage, domain scores, daily snapshots. Never wipe.
- There is NO second D1 database. The old `yoke-cache` D1 was fully decommissioned.

## Scoring Philosophy

**Deductive model** — every axis starts at 100 and subtracts deductions based on findings. Never starts at a baseline and adds.

- **6 axes**: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12)
- **Composite**: Weighted arithmetic mean with outlier floor cap (any axis < 40 → composite capped at Moderate max)
- **Tiers** (not grades): Excellent ≥90, Strong ≥75, Moderate ≥60, Weak ≥40, Critical <40
- **Severity deduction factors**: good=0, info=0, low=0.5, medium=0.75, high=1.0, critical=1.5
- **Context-aware**: 7 archetypes adjust severity per domain type. Denominator excludes inapplicable signals.
- **Level-Up Plan**: Shows both penalty removals AND positive canBeGood opportunities, prioritized by effort vs. gain.

## Red Lines

- **No internal docs in the public repo.** Calibration methodology, scoring rationale, planning notes, audit reports → `~/workspace/yoke-internal/` locally, never committed.
- **No Yahoo Finance** (ToS risk), **no SSL Labs** (Qualys ToS violation), **no ip-api.com** (HTTP-only, replaced).
- **No `as any`**, no bare `console.log`, no module-level mutable state.
- **No `--no-verify`** on commits. Pre-commit hooks exist for a reason.
- **Secrets never in code or wrangler.toml.** `SHARE_SECRET` hard-fails if missing (no dev fallback).

## Module Boundaries

- Signal definitions: `worker/src/config/signal-registry.ts` (single source of truth)
- Scoring engine: `worker/src/actions/analyze/contextual-scoring.ts`
- Check registry: `worker/src/checks/registry.ts` (ordered, append new checks at end)
- HTML shell: `client/build.ts` template literal (NOT `client/index.html`)
- External fetches: always `fetchWithTimeout()` + `boundedText()`, never bare `fetch()`

---

## .ai/ Maintenance Protocol

These files are maintained by AI agents **with human approval**:

- **CONSTITUTION.md** — Changes are rare. Always discuss before editing.
- **DECISIONS.md** — Append-only. Entries are never edited or removed. Add after each significant decision.
- **INVARIANTS.md** — Adding or removing an invariant requires explicit human approval.
- **STATE.md** — Can be updated more freely; agent proposes changes, human confirms.
- **GOTCHAS.md** — Append when a new lesson is learned. Pair every "don't" with a "do."

**Update cadence:** After significant sessions (~10 commits or a major decision), the agent should propose: _"About to update `.ai/` with: [changes]. Approve?"_ — then wait for confirmation before writing.

Run `.ai/staleness-check.sh` periodically to detect drift between these docs and the actual codebase.
