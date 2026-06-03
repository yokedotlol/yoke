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
- **Tiers** (not grades): Excellent ≥90, Strong ≥78, Moderate ≥60, Weak ≥40, Critical <40
- **Severity deduction factors**: good=0, info=0, low=0.5, medium=0.75, high=1.0, critical=1.5
- **Context-aware**: 7 archetypes adjust severity per domain type. Denominator excludes inapplicable signals.
- **Score Breakdown (Waterfall)**: Unified view showing penalty removals AND positive canBeGood opportunities, grouped by axis with deduction bars, effort badges, tooltips, and "What if?" simulation mode. Formerly "Level-Up Plan" — merged into Score Waterfall June 2026.

### Credibility Principle

**A customer should never look at Yoke's output and think the tool is broken or the score is wrong.** If the presentation creates that impression — even when the underlying math is technically correct — that's a product failure. Credibility is the product.

This means:
- **No visible double-counting.** If a concept (HSTS, CSP, etc.) appears in multiple signals, the user must never see it penalized more than once. Use `suppressesAbsent` to collapse dependent signals when the parent is missing.
- **Labels must read correctly to non-experts.** "X not detected" must not sound like "the problem X wasn't found" (good). If a signal is absent, the label should convey absence, not successful detection.
- **Sections must be self-explanatory.** A user should understand why an item is in "Issues" vs "Improvements" vs "Not Assessed" without reading documentation.
- **Scores should match intuition.** A site with one real problem shouldn't score like a site with five. If the math produces a result that looks wrong to a reasonable person, the math needs to change.

Every feature, signal addition, and UI change should be stress-tested against: "Would a skeptical first-time user trust this output?"

### Score–Suggestion Consistency (Core Directive)

**Every point deducted must be explained to the user.** If an axis scores less than 100, the Score Breakdown waterfall must account for every point of the deficit. A score of 93 with no suggestions is a broken product — it tells the user they're doing something wrong and refuses to say what.

This means:
- The scoring engine and the Score Breakdown must stay in sync. If the engine deducts points, the waterfall must surface those deductions as issues (fired findings with deductions), opportunities (absent actionable signals), or not-detected items (informational absent signals).
- Absent-signal deductions in particular must be enumerated — the user must see WHICH signals were absent and WHY (e.g., "probe failed", "not detected in scan", "requires [feature] not present").
- Filtering thresholds (e.g., `compositeDelta < 0.1`) must never create unexplained gaps. If filtering removes items, a residual explanation must cover the remainder.
- **The invariant: for every axis, `sum(displayed_items) = 100 - axis_score`.** No silent deductions.

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
