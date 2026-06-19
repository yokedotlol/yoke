# Yoke — Invariants

> Things that must ALWAYS be true. Adding or removing an invariant requires explicit human approval.
> Each invariant includes a verification method where possible.

## Scoring Model

- [ ] **Deductive scoring only.** Every axis starts at 100 and subtracts. Never starts at a baseline and adds.
  - _Verify:_ `contextual-scoring.ts` must not contain `BASELINE` or additive scoring logic.

- [ ] **ABSENT_DEDUCTION_FACTOR = 0.30.** The penalty for absent (unassessable) signals.
  - _Verify:_ `grep 'ABSENT_DEDUCTION_FACTOR' worker/src/actions/analyze/contextual-scoring.ts` → must show `0.30`.

- [ ] **Severity deduction factors: good=0, info=0, low=0.5, medium=0.75, high=1.0, critical=1.5.**
  - _Verify:_ Check `SEVERITY_DEDUCTION_FACTOR` in `contextual-scoring.ts`.

- [ ] **Axis weights sum to 1.0:** Security 0.24, Speed 0.18, Foundations 0.18, Reputation 0.15, Discoverability 0.13, Email 0.12.
  - _Verify:_ `AXIS_WEIGHTS` in `signal-registry.ts`. Sum must equal 1.00.

- [ ] **Composite = weighted arithmetic mean**, NOT geometric mean.
  - _Verify:_ `contextual-scoring.ts` must not contain geometric mean logic.

- [ ] **Outlier floor cap:** Any axis < 40 → composite capped at ≤ 74 (Moderate maximum).
  - _Verify:_ Search for `hasLowOutlier` in `contextual-scoring.ts`.

- [ ] **Tier thresholds:** Excellent ≥90, Strong ≥78, Moderate ≥60, Weak ≥40, Critical <40.
  - _Verify:_ `TIER_THRESHOLDS` in `signal-registry.ts`.

- [ ] **All-green-signals = 100.** A domain with every assessed signal at `good` must score exactly 100.
  - _Verify:_ Calibration test: "all-green = perfect 100 on every axis".

- [ ] **Score–suggestion consistency.** Every axis with score < 100 must have its full deficit accounted for in the Score Breakdown waterfall. `sum(displayed items + opportunities + not-detected) = 100 - axis_score`. No silent deductions.
  - _Verify:_ For any domain, check that axes with only `_absent` deductions still surface those absent signals as enumerated opportunities or not-detected items in the Score Breakdown UI.

## Signal Integrity

- [ ] **Signals emit exactly once.** No signal ID may appear twice in a scan's findings.
  - _Verify:_ CI test exists in `signal-registry.test.ts`.

- [ ] **Weight budget per axis sums correctly.** Each signal's `weightRange` contributes to its axis budget.
  - _Verify:_ CI test exists.

- [ ] **presentWeight counts only canBeGood signals.** Signals that can't be `good` don't inflate the possible-points denominator.
  - _Verify:_ Check `presentWeight` calculation in `contextual-scoring.ts`.

- [ ] **Context-aware denominator.** Inapplicable signals (e.g., `cookie_security` on cookieless sites) are excluded from normalization.
  - _Verify:_ Check `requiresContext` and `DetectedContext` in signal-registry.ts / contextual-scoring.ts.

## Credibility

- [ ] **No visible double-counting.** A single missing feature (e.g., HSTS) must never appear as multiple separate line items in the Score Breakdown. When a parent signal fires, all dependent child signals must be suppressed from the absent pool via `suppressesAbsent`.
  - _Verify:_ For every `_missing` signal that has corresponding `canBeGood` siblings, confirm `suppressesAbsent` is set. `grep -A5 'suppressesAbsent' worker/src/config/signal-registry.ts` should cover HSTS, CSP, canonical_url, and all other families.

- [ ] **Customer-facing output never looks broken.** If a reasonable non-technical user would look at the scores, waterfall, or AI analysis and think "this tool is wrong," that's a bug — even if the math is correct.
  - _Verify:_ Manual spot-check. Pick 5 domains across tiers. For each, read the waterfall as a first-time user. Flag anything that looks like double-counting, contradictory labels, or unexplained gaps.

## Naming & Terminology

- [ ] **"tier" not "grade"** in all API responses, UI, and documentation.
  - _Verify:_ `grep -ri "grade" --include="*.ts" --include="*.tsx" worker/src/ client/src/` — should find only legacy D1 column names and comments, never user-facing strings.

- [ ] **"Score Breakdown" not "Level-Up" or "Grade-Up"** everywhere. (Formerly "Level-Up Plan", renamed to "Score Breakdown" / "Score Waterfall" in June 2026.)
  - _Verify:_ `grep -ri "grade.up\|gradeup\|grade_up\|level.up" --include="*.ts" --include="*.tsx"` — should return zero results in user-facing strings.

## Security & Operations

- [ ] **No raw user IPs in storage.** All user IP addresses must be hashed via `hashIp()` (SHA-256 + daily salt) before being written to any D1 table, KV key, or log. Server IPs from DNS lookups are public data and exempt.
  - _Verify:_ `grep -n 'cf-connecting-ip' worker/src/index.ts worker/src/actions/*.ts` — every extraction must be wrapped in `await hashIp(...)` before storage. `request-tracking.ts` uses its own `hashVisitor()` which is equivalent.

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

## Self-Hosting

- [ ] **Config injection is always external.** Runtime config delivered via `/assets/config.js` external script, never inline `<script>`. CSP `script-src 'self'` must not break.
  - _Verify:_ `grep -r 'window.__YOKE_CONFIG__' worker/src/index.ts` — must generate as external route, not inline in HTML.

- [ ] **All infrastructure references are env-configurable.** No hardcoded MX hosts, mail providers, or domain-specific values in Docker/Caddy config.
  - _Verify:_ `grep -r 'aspmx\|google\|gmail' docker-compose.yml Caddyfile` — should return zero hardcoded Google MX references.

- [ ] **White-label env vars are optional with sensible defaults.** Missing `SITE_NAME` defaults to "Yoke", missing `HIDE_*` defaults to showing everything.
  - _Verify:_ Check `config.js` generation in `index.ts` — all white-label vars must have fallback values.

- [ ] **Self-hosted instances have zero rate limits.** Rate limiting is a hosted-service concern, not a self-hosting concern. Self-hosters control their own traffic.
  - _Verify:_ Docker Compose and self-hosting docs must not impose rate limits.

- [ ] **Self-hosted instances must not phone home.** No analytics, telemetry, or API calls to yoke.lol from self-hosted instances.
  - _Verify:_ `grep -r 'yoke.lol' worker/src/` — any references must be in white-label defaults, not in runtime API calls.

- [ ] **Docker Compose is the maintained self-hosting path.** Three containers: Caddy (TLS + reverse proxy + MTA-STS), workerd (miniflare), probe (SSL/PageSpeed Go binary). Bare-metal is community-maintained.
  - _Verify:_ `docker-compose.yml` exists and defines all three services.

## Billing & Cost

- [ ] **Per-request D1 write budget stays under 10.** No feature may add more than 2 D1 writes per request without explicit cost justification.
  - _Verify:_ Count INSERT/UPDATE statements in the hot path for each endpoint.

- [ ] **Ephemeral state avoids D1.** Rate limiting, session tracking, and other short-lived data should use Durable Objects (in-memory) or KV with TTL, not D1 row inserts.
  - _Verify:_ Rate limiter implementation does not INSERT into D1 on every request (once DO migration is complete).

- [ ] **Cache hits must not incur D1 writes.** The `record()` deferred-write pattern must be skipped for cached responses.
  - _Verify:_ In api-core.ts, `record()` is only called when `!cached`.

- [ ] **Badge requests are read-only at the edge.** `/badge/*` endpoints read from KV cache only. D1 writes for `badge_domains` tracking happen via `backgroundWork()`, never synchronously.
  - _Verify:_ Badge handler does not `await` any D1 operation in the response path.

- [ ] **Fly proxy has zero public endpoints.** Every route requires `FLY_AUTH_SECRET` auth.
  - _Verify:_ `curl -s https://yoke-probe.fly.dev/health` without auth header must return 401.

## Badges

- [ ] **Badge endpoint is a pure cache read.** `/badge/*` routes must never trigger synchronous analysis. Response time must be <500ms under all conditions. Analysis is triggered only via `backgroundWork()` (non-blocking).
  - _Verify:_ `grep -n 'await runAnalysis' worker/src/routes/api-badge.ts` — must return zero results. All `runAnalysis` calls must be inside `backgroundWork()`.

- [ ] **Badge cache is a separate derived key.** `badge:<domain>` in KV, not the analysis cache `cache:analysis:<domain>`. Never modify analysis cache logic for badge purposes.
  - _Verify:_ `grep -n 'cache:analysis' worker/src/badge-cache.ts` — must return zero results.

- [ ] **Post-analysis enrichment is never duplicated.** All post-analysis side effects (share_url, pdf_url, badge_url, percentiles, badge cache write) live in the shared `finalizeResult()` function. Neither `api-core.ts` nor `analyze-stream.ts` should contain inline share_url/pdf_url/percentile injection.
  - _Verify:_ `grep -n 'buildShareUrl\|buildPdfUrl\|injectPercentiles' worker/src/routes/api-core.ts worker/src/actions/analyze-stream.ts` — must return zero results (all moved to `finalize.ts`).
