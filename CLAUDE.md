# CLAUDE.md

Project context for AI coding assistants (Claude Code, Cursor, Copilot, Codex, Hatch, etc.).

## ⚡ Start Here: .context/ Context Framework

**Before working on this project, read these files in `.context/`:**

| File | When to read | What it contains |
|------|-------------|------------------|
| `.context/CONSTITUTION.md` | **Always** | Architecture, scoring philosophy, red lines |
| `.context/INVARIANTS.md` | **Always** | Things that must always be true — check before any change |
| `.context/PATTERNS.md` | **Always** | Key patterns, anti-patterns, build/deploy, file reference |
| `.context/STATE.md` | **Always** | Current versions, signal counts, test counts |
| `.context/DECISIONS.md` | Before modifying scoring, signals, or architecture | Why things are the way they are |
| `.context/GOTCHAS.md` | Before modifying scoring, signals, or client code | Mistakes we've made and how to avoid them |

Run `bash .context/base/audit.sh yoke --live` to verify invariants and live deployment state.

## What This Is

Yoke is a domain intelligence / OSINT tool. Users enter a domain → get a comprehensive multi-tab analysis (DNS, WHOIS, SSL, security, tech stack, performance, breaches, AI insights). Served as a web SPA, a JSON API (`curl -s https://yoke.lol/stripe.com`), and a Chrome extension.

## Quick Reference

```bash
# Build & deploy
bash deploy.sh --cf

# Dev
cd worker && bun run dev
cd client && bun run dev

# Test & lint
npx vitest run
npx @biomejs/biome check .
cd worker && bun run typecheck
```

See `.context/PATTERNS.md` for full build/deploy docs, coding patterns, and file reference.

## Badges

Embeddable shields-style domain score badges:

- **`/badge/<domain>.svg`** — Direct SVG badge (standalone, no external deps)
- **`/badge/<domain>.json`** — Shields.io endpoint protocol

Badges refresh lazily on-view (demand-gated): cold-start is a pure read, already-analyzed domains refresh after `BADGE_REFRESH_INTERVAL_HRS` (under the global budget), and a badge older than `BADGE_STALE_DAYS` — or one whose cached SSL cert `notAfter` has passed — demotes to a neutral "stale — re-scan". The old timer-based pre-warm sweep and its `POST /api/admin/badge-sweep` endpoint were removed.

KV key: `badge:<domain>` (48h TTL, ~200 bytes). D1 table: `badge_domains` (tracks requested domains). Badge cache is written as a side effect of every analysis via `finalizeResult()` in `worker/src/actions/analyze/finalize.ts`.

Post-analysis enrichment (share_url, pdf_url, badge_url, percentiles, badge cache write) is centralized in `finalizeResult()` — never duplicate across code paths. See `.context/GOTCHAS.md`.
