# Yoke Review System

Comprehensive, multi-expert review process for the Yoke codebase and product. Run before any launch, after major changes, or on a regular cadence.

## Review Panels

This system uses **20 expert panels**, each with a dedicated prompt in `panels/`. Panels are designed to run as parallel tasks in any AI agent harness.

| # | Panel | Prompt | Focus |
|---|-------|--------|-------|
| 1 | System Design | `system-design.md` | Architecture, resilience, rate limiting, caching, API hygiene |
| 2 | Platform Best Practices | `platform-best-practices.md` | CF Workers, SPA patterns, TypeScript, web standards |
| 3 | Scoring & Signals | `scoring-signals.md` | All 6 axes, 156 signals, budget-based deductive algorithm |
| 4 | Code Quality | `code-quality.md` | Correctness, dead code, structure, refactor opportunities, testing gaps |
| 5 | Security & Privacy | `security-privacy.md` | SSRF, injection, auth, key handling, data exposure, CSP |
| 6 | QA — Browser | `qa-browser.md` | Full functional QA of live site at multiple viewports |
| 7 | QA — CLI & API | `qa-cli-api.md` | JSON API surface, CLI binary, curl workflows, error shapes |
| 8 | Business & Product | `business-product.md` | Market positioning, competitive analysis, growth vectors |
| 9 | FOSS Legal | `foss-legal.md` | Licenses, attributions, API ToS compliance |
| 10 | HN Heckler | `hn-heckler.md` | Adversarial critique from a Hacker News commenter |
| 11 | r/selfhosted Heckler | `selfhosted-heckler.md` | Adversarial critique from r/selfhosted perspective |
| 12 | CI/CD & Release | `cicd-release.md` | Pipeline, safety gates, deploy process, rollback, versioning |
| 13 | WordPress & Web Consultant | `wordpress-web-consultant.md` | WP detection depth, target customer voice, consultant UX |
| 14 | Documentation | `documentation.md` | README, API docs, self-hosting guide, CONTRIBUTING, DX |
| 15 | Accessibility | `accessibility.md` | WCAG 2.2, screen reader, keyboard nav, color contrast, all themes |
| 16 | Self-Hosting Operator | `self-hosting-operator.md` | Fresh clone → deploy experience, dependency docs, operator UX |
| 17 | Ground Truth Validator | `ground-truth-validator.md` | Compare Yoke findings against canonical tools for accuracy |
| 18 | Domain Scoring Audit | `domain-scoring-audit.md` | Per-domain scoring fairness with 5 expert personas |
| 19 | Performance & Load | `performance-load.md` | Cold starts, bundle size, D1 latency, concurrent load |
| 20 | Data Privacy & Regulatory | `data-privacy.md` | GDPR, CCPA, data retention, consent, privacy policy |

## How to Run

### Full Pre-Launch Review
```
Run the full Yoke pre-launch review. Use all 20 panels from .ai/reviews/panels/.
Present results section by section.
```

### Single Panel
```
Run the Yoke [panel name] review panel. Follow .ai/reviews/panels/[filename].md.
```

### Domain Scoring Audit (takes a domain as input)
```
Run a Yoke domain scoring audit on [domain]. Follow .ai/reviews/panels/domain-scoring-audit.md.
First analyze the domain via the API, then feed the full signal dump to the panel.
```

### Re-Review (check previous findings)
```
Re-check all open findings from the last Yoke review in docs/internal/reviews/.
```

## Execution Flow

1. **Check for prior findings** — Look in `docs/internal/reviews/` for previous review output
2. **Spawn panels** — Run in two batches:
   - **Batch A (code-focused):** System Design, Code Quality, Scoring & Signals, Security & Privacy, FOSS Legal, CI/CD, Documentation, Accessibility, Performance, Privacy
   - **Batch B (live-site + product):** QA Browser, QA CLI/API, HN Heckler, r/selfhosted Heckler, WP & Consultant, Business & Product, Self-Hosting Operator, Ground Truth Validator, Platform Best Practices
   - **Standalone:** Domain Scoring Audit (per-domain, run separately)
3. **Collect results** — Each panel writes findings to `docs/internal/reviews/panel-[name].md`
4. **Cross-panel synthesis** — Look for patterns spanning multiple panels. Deduplicate and note reinforcement.
5. **Present findings** — Walk through each section: what's good, what's bad, recommendations, and open questions

## Panel Output Format

Every panel uses this finding structure:

```
[SEVERITY] | [CATEGORY] | Location

What: Precise description.
Why it matters: Impact if unfixed.
Evidence: Code snippet, URL, or reproduction steps.
Recommendation: Concrete fix with tradeoffs.
Status: new | recurring (seen in review on YYYY-MM-DD)
```

Severities: 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🔵 LOW, ⚪ NOTE, ✅ STRENGTH

Each panel should end with a **Questions for the maintainer** section — places where the recommendation depends on a product decision, business constraint, or assumption the reviewer had to make.

## Key File Locations

- Worker entry: `worker/src/index.ts`
- Analysis core: `worker/src/actions/analyze/core.ts`
- Scoring engine: `worker/src/actions/analyze/contextual-scoring.ts`
- Signal registry: `worker/src/config/signal-registry.ts` (156 signals)
- Client SPA: `client/src/App.tsx`, `client/src/api.ts`
- SPA serving + security headers: `worker/src/spa.ts`
- SSRF protection: `worker/src/helpers.ts`, `fly-proxy/main.go`
- AI analysis: `worker/src/actions/ai-analysis.ts`
- PDF reports: `worker/src/pdf-report.ts`, `worker/src/pdf-route.ts`
- CLI: `cli/main.go`
- Extension: `extension/`
- MCP server: `mcp/`
- CI/CD: `.github/workflows/ci.yml`
- Tests: `tests/*.test.ts`
- Deploy: `deploy.sh`
- Licenses: `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`

## Evolution

After each review cycle:
1. Update panel prompts based on what was missed or what changed
2. Log findings to `docs/internal/reviews/` (gitignored — internal work product)
3. Update this SKILL.md if panels need to be added, merged, or split
