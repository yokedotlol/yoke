# Yoke — Invariants

> Things that must ALWAYS be true. Adding or removing an invariant requires explicit human approval.
> Each invariant includes a verification method where possible.

## Scoring Model

- [ ] **Deductive scoring only.** Every axis starts at 100 and subtracts. Never starts at a baseline and adds.
  - _Verify:_ `contextual-scoring.ts` must not contain `BASELINE` or additive scoring logic.

- [ ] **ABSENT_DEDUCTION_FACTOR = 0.15.** The penalty for absent (unassessable) signals.
  - _Verify:_ `grep 'ABSENT_DEDUCTION_FACTOR' worker/src/actions/analyze/contextual-scoring.ts` → must show `0.15`.

- [ ] **Severity deduction factors: good=0, info=0, low=0.5, medium=0.75, high=1.0, critical=1.5.**
  - _Verify:_ Check `SEVERITY_DEDUCTION_FACTOR` in `contextual-scoring.ts`.

- [ ] **Axis weights sum to 1.0:** Security 0.24, Speed 0.18, Foundations 0.18, Reputation 0.15, Discoverability 0.13, Email 0.12.
  - _Verify:_ `AXIS_WEIGHTS` in `signal-registry.ts`. Sum must equal 1.00.

- [ ] **Composite = weighted arithmetic mean**, NOT geometric mean.
  - _Verify:_ `contextual-scoring.ts` must not contain geometric mean logic.

- [ ] **Outlier floor cap:** Any axis < 40 → composite capped at ≤ 74 (Moderate maximum).
  - _Verify:_ Search for `hasLowOutlier` in `contextual-scoring.ts`.

- [ ] **Tier thresholds:** Excellent ≥90, Strong ≥75, Moderate ≥60, Weak ≥40, Critical <40.
  - _Verify:_ `TIER_THRESHOLDS` in `signal-registry.ts`.

- [ ] **All-green-signals = 100.** A domain with every assessed signal at `good` must score exactly 100.
  - _Verify:_ Calibration test: "all-green = perfect 100 on every axis".

## Signal Integrity

- [ ] **Signals emit exactly once.** No signal ID may appear twice in a scan's findings.
  - _Verify:_ CI test exists in `signal-registry.test.ts`.

- [ ] **Weight budget per axis sums correctly.** Each signal's `weightRange` contributes to its axis budget.
  - _Verify:_ CI test exists.

- [ ] **presentWeight counts only canBeGood signals.** Signals that can't be `good` don't inflate the possible-points denominator.
  - _Verify:_ Check `presentWeight` calculation in `contextual-scoring.ts`.

- [ ] **Context-aware denominator.** Inapplicable signals (e.g., `cookie_security` on cookieless sites) are excluded from normalization.
  - _Verify:_ Check `requiresContext` and `DetectedContext` in signal-registry.ts / contextual-scoring.ts.

## Naming & Terminology

- [ ] **"tier" not "grade"** in all API responses, UI, and documentation.
  - _Verify:_ `grep -ri "grade" --include="*.ts" --include="*.tsx" worker/src/ client/src/` — should find only legacy D1 column names and comments, never user-facing strings.

- [ ] **"Level-Up" not "Grade-Up"** everywhere.
  - _Verify:_ `grep -ri "grade.up\|gradeup\|grade_up" --include="*.ts" --include="*.tsx"` — should return zero results.

## Security & Operations

- [ ] **API responses include X-Yoke-Version header.**
  - _Verify:_ `curl -sI https://yoke.lol/api/health | grep X-Yoke-Version`.

- [ ] **SHARE_SECRET hard-fails if missing.** No dev fallback, no empty-string bypass.
  - _Verify:_ Check `share.ts` for `SHARE_SECRET` usage — must throw/reject if undefined.

- [ ] **No internal docs in the public repo.** Calibration methodology, audit reports, scoring rationale, planning notes stay in `~/workspace/yoke-internal/`.
  - _Verify:_ `find . -name "SCORING-CALIBRATION*" -o -name "*audit*" -o -name "*internal*" | grep -v node_modules | grep -v .ai/` — should be empty.

- [ ] **Cache hits don't count against rate limits.** This is intentional, not a bug.
  - _Verify:_ Rate-limit check happens after cache lookup in the request flow.

- [ ] **One D1 database: `yoke-stats`.** No second D1. All caching is KV `REFERENCE_DATA`.
  - _Verify:_ `grep -c 'd1_databases' worker/wrangler.toml` — should show exactly one binding.

## Build & Deploy

- [ ] **Pre-commit hooks active.** `core.hooksPath` = `.githooks`.
  - _Verify:_ `git config core.hooksPath` → `.githooks`.

- [ ] **CI must pass before declaring victory.** Typecheck + lint + all tests green.
  - _Verify:_ `npx vitest run && cd worker && bun run typecheck && npx @biomejs/biome check .`
