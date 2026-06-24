# Yoke Review System

A multi-expert review framework for auditing the Yoke codebase and product. Designed to run with any AI coding agent — Claude Code, Codex, OpenCode, Cursor, Aider, or similar.

## Quick Start

### With Claude Code

```bash
# Run a single panel
claude "Run the Yoke HN Heckler review panel. Follow .context/reviews/panels/hn-heckler.md"

# Run a full review
claude "Run a full Yoke pre-launch review. See .context/reviews/SKILL.md for the process and .context/reviews/panels/ for all panel prompts."

# Audit a specific domain's scoring
claude "Run a domain scoring audit on example.com. Follow .context/reviews/panels/domain-scoring-audit.md"
```

### With OpenAI Codex

```bash
codex "Run the Yoke security review panel following .context/reviews/panels/security-privacy.md"
```

### With OpenCode / Aider / Any Agent

Point your agent at a panel prompt file and ask it to follow the instructions:

```
Read .context/reviews/panels/scoring-signals.md and execute that review against the current codebase.
```

### Running Multiple Panels in Parallel

Most agents support spawning subagents or running tasks concurrently. Split the 20 panels into two batches:

**Batch A (code-focused):** System Design, Code Quality, Scoring & Signals, Security & Privacy, FOSS Legal, CI/CD, Documentation, Accessibility, Performance, Privacy — these read the codebase only.

**Batch B (live-site + product):** QA Browser, QA CLI/API, HN Heckler, r/selfhosted Heckler, WP & Consultant, Business & Product, Self-Hosting Operator, Ground Truth Validator — these hit yoke.lol and/or evaluate the product holistically.

Domain Scoring Audit runs independently on a per-domain basis.

## What's Here

```
.context/reviews/
├── README.md          ← You are here
├── SKILL.md           ← Full review process, panel list, execution flow
└── panels/
    ├── system-design.md
    ├── platform-best-practices.md
    ├── scoring-signals.md
    ├── code-quality.md
    ├── security-privacy.md
    ├── qa-browser.md
    ├── qa-cli-api.md
    ├── business-product.md
    ├── foss-legal.md
    ├── hn-heckler.md
    ├── selfhosted-heckler.md
    ├── cicd-release.md
    ├── wordpress-web-consultant.md
    ├── documentation.md
    ├── accessibility.md
    ├── self-hosting-operator.md
    ├── ground-truth-validator.md
    ├── domain-scoring-audit.md
    ├── performance-load.md
    └── data-privacy.md
```

Each panel is self-contained: it describes the expert persona, what to review, how to structure findings, and where to write output. No external dependencies.

## Finding Format

All panels use the same structure:

```
[SEVERITY] | [CATEGORY] | Location

What: Precise description.
Why it matters: Impact if unfixed.
Evidence: Code snippet, URL, or reproduction steps.
Recommendation: Concrete fix with tradeoffs.
Status: new | recurring (seen in review on YYYY-MM-DD)
```

Severities: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🔵 LOW, ⚪ NOTE, ✅ STRENGTH

## Writing Review Output

Panel results should go to a gitignored location — they're internal work product, not part of the public repo. Recommended: `docs/internal/reviews/` (already gitignored via `docs/internal/`).

## Tips

- **Start with HN Heckler** if you want a fast gut-check before launch.
- **Start with Scoring & Signals + Ground Truth** if you're calibrating scores.
- **Start with Security + FOSS Legal** if you're worried about liability.
- **Domain Scoring Audit** is the only panel that takes a domain as input — run it against domains that surfaced unexpected scores.
- Each panel ends with **Questions for the maintainer** — decisions that depend on product direction, not code.
