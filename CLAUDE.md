# CLAUDE.md

Project context for AI coding assistants (Claude Code, Cursor, Copilot, Codex, Hatch, etc.).

## ⚡ Start Here: .ai/ Context Framework

**Before working on this project, read these files in `.ai/`:**

| File | When to read | What it contains |
|------|-------------|------------------|
| `.ai/CONSTITUTION.md` | **Always** | Architecture, scoring philosophy, red lines |
| `.ai/INVARIANTS.md` | **Always** | Things that must always be true — check before any change |
| `.ai/PATTERNS.md` | **Always** | Key patterns, anti-patterns, build/deploy, file reference |
| `.ai/STATE.md` | **Always** | Current versions, signal counts, test counts |
| `.ai/DECISIONS.md` | Before modifying scoring, signals, or architecture | Why things are the way they are |
| `.ai/GOTCHAS.md` | Before modifying scoring, signals, or client code | Mistakes we've made and how to avoid them |

Run `bash .ai/staleness-check.sh` to verify docs match the codebase.

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

See `.ai/PATTERNS.md` for full build/deploy docs, coding patterns, and file reference.
