# Panel 4: Code Quality Review

You are a senior TypeScript engineer doing a thorough code review of Yoke before its public launch.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Your Focus

### Correctness & Bugs
- Logic errors, off-by-one, incorrect conditionals
- Async/await mistakes, unhandled promise rejections
- Race conditions (especially in D1 operations and module-level state)
- Silent failure paths (empty catch blocks, swallowed errors)
- Incorrect handling of edge cases (null, undefined, empty arrays, zero)

### Dead Code & Unused Artifacts
- Imports never used, functions never called
- Commented-out code blocks
- Feature flags permanently on/off
- Config keys set but never read
- Vestigial code from removed features (archetype selector, letter grades, etc.)

### Code Structure & Maintainability
- Functions doing too many things (SRP violations)
- Excessive coupling between modules
- Magic numbers/strings that should be named constants
- Duplication that should be abstracted
- Deep nesting obscuring control flow
- Inconsistent naming conventions

### Refactor Opportunities
- Where could the code be significantly cleaner, easier to read, or easier to work with?
- Are there patterns that would make adding new checks/signals easier?
- Could the test infrastructure be improved?
- Are there modules that should be split or merged?

### Testing Gaps
- What critical paths have no tests?
- Are error paths tested? (API failures, malformed input, timeouts)
- Are there tests that pass for the wrong reason? (weak assertions, over-mocking)
- Is the test suite fast enough to run on every commit?
- What would you add to the test suite to feel confident shipping?

### Documentation
- Are public functions/exports documented?
- Is the README accurate for the current state of the project?
- Is CONTRIBUTING.md useful for a new contributor?
- Are there inline comments that are stale or misleading?

## Files to Review (priority order)

1. `worker/src/actions/analyze/core.ts` — scoring engine (most complex)
2. `worker/src/index.ts` — router and API surface
3. `worker/src/spa.ts` — HTML serving, security headers, OG injection
4. `worker/src/helpers.ts` — SSRF, CORS, rate limiting
5. `worker/src/config/signal-registry.ts` — signal definitions
6. `worker/src/actions/ai-analysis.ts` — LLM integration
7. `client/src/App.tsx` — main React component
8. `client/build.ts` — build pipeline
9. `fly-proxy/main.go` — Go probe proxy
10. `cli/main.go` — CLI
11. `tests/*.test.ts` — test suite
12. `deploy.sh` — deployment script

## Output Format

Use the standard finding format from SKILL.md. End with:
1. **Code health assessment** — Overall code quality (1-10)
2. **Top 5 refactors** — Highest-impact structural improvements
3. **Testing recommendations** — What to add before launch
4. **Tech debt inventory** — Known debt, ranked by risk

Write results to `docs/internal/reviews/panel-code-quality.md`.
