# Yoke — Gotchas

> Lessons learned the hard way. Every "don't" is paired with a "do."
> Append new entries when a mistake is discovered. Never remove entries.

---

### Client-side scoring diverged from server

**What happened:** After switching the server to deductive scoring (start at 100, subtract), the client-side scoring code still used `BASELINE = 55` with anchor-and-adjust logic. Scores displayed in the browser didn't match API responses.

**Don't:** Change the scoring model in one place and assume the other is in sync.
**Do:** When changing scoring logic, always update BOTH `contextual-scoring.ts` (server) AND the client-side scoring in `client/src/`. Search the entire codebase for the old pattern before closing the task.

---

### Internal docs committed to public repo

**What happened:** `SCORING-CALIBRATION.md` (containing internal scoring methodology and calibration notes) was committed to the public repo at least 4 times across different sprints.

**Don't:** `git add` any `.md` file without asking: "Is this code documentation or internal work product?"
**Do:** Code docs (README, API docs, CHANGELOG, CONTRIBUTING, .ai/ files) go in the repo. Everything else (calibration methodology, audit reports, scoring rationale, planning notes) goes to `~/workspace/yoke-internal/`, never committed. When in doubt, it's internal.

---

### Signals double-emitting

**What happened:** `bimi_record` and `mta_sts` were each emitting their signal twice in a single scan, causing inflated deductions and incorrect axis scores.

**Don't:** Copy-paste signal emission blocks without checking for duplicates.
**Do:** The signal uniqueness CI test (`signal-registry.test.ts`) now catches this automatically. Always run `npx vitest run` after adding or modifying signal emissions.

---

### presentWeight counted all signals instead of canBeGood only

**What happened:** The denominator for "how much weight is actually being assessed" included signals that can never be `good` (penalty-only signals). This inflated the possible-points pool and deflated scores.

**Don't:** Include non-canBeGood signals in weight budget calculations.
**Do:** `presentWeight` must only sum weights for signals where `canBeGood: true`. The `AXIS_MAX_GOOD_WEIGHT` constant in signal-registry.ts handles this correctly now.

---

### email_trust used as a positive signal

**What happened:** `email_trust` was being treated as a signal that could contribute positively to the Email axis score. In reality, it should only penalize — it's a drag signal, not an achievement.

**Don't:** Assume every signal can swing both ways.
**Do:** Check `canBeGood` and `canBeNonGood` flags in the signal registry when working with scoring logic. Penalty-only signals have `canBeGood: false`.

---

### WordPress signals with zero weight

**What happened:** `wp_user_enumeration` was in the signal registry with `weightRange: [0, 0]`, meaning it was detected and displayed but had zero scoring impact. Users saw it flagged but it didn't affect their score — confusing.

**Don't:** Add signals to the registry with zero weight unless they're explicitly display-only (and documented as such).
**Do:** If a signal matters enough to flag, give it a non-zero weight. If detection is unreliable, leave it at `[0, 0]` but document why (see `wp_xmlrpc_enabled` and `wp_version_exposed`).

---

### Dead code accumulates silently

**What happened:** After removing `/api/recent`, the `RecentLookups` component and `recent:index` KV writes remained. After removing anchor-and-adjust scoring, ~110 lines of `applyAbsencePenalties` stayed. Dead code confuses future agents who see it and assume it's active.

**Don't:** Leave dead code after removing features.
**Do:** When removing a feature, grep the entire codebase for references: function calls, imports, component references, KV keys, D1 queries, API routes, test mocks. Remove them all in the same commit.

---

### Canny links survived platform migration

**What happened:** After switching from Canny to GitHub Issues for feedback, Canny links remained in the footer and About page. Users clicking "Feedback" got a 404 on Canny.

**Don't:** Migrate platforms and only update the obvious references.
**Do:** `grep -r "canny\|feedback\.yoke" --include="*.ts" --include="*.tsx" --include="*.html"` after any platform migration. Same applies to any external service change.

---

### console.log left in production code

**What happened:** Debug `console.log` statements were committed and deployed. They clutter CF Worker logs and can leak internal state.

**Don't:** Use `console.log` for debugging and forget to remove it.
**Do:** Use the structured logger (`worker/src/logger.ts`) for intentional logging. The Biome linter config should catch bare `console.log` — if it doesn't, that's a config bug.

---

### Stale CLAUDE.md causes agent confusion

**What happened:** CLAUDE.md referenced "5 axes" and "~136 signals" long after the project had 6 axes and 156 signals. Agents reading it as authoritative context produced work based on outdated assumptions.

**Don't:** Treat CLAUDE.md as a write-once file.
**Do:** Update CLAUDE.md when the project state changes significantly. Run `.ai/staleness-check.sh` to detect drift. The `.ai/STATE.md` file is the volatile snapshot; CLAUDE.md should point agents there.

---

### Subagents don't inherit context files

**What happened:** Spawned subagents have transcript context but don't automatically read MEMORY.md, CLAUDE.md, or `.ai/` files. They make decisions based on incomplete context, sometimes reverting agreed-upon changes.

**Don't:** Assume subagents know project invariants or recent decisions.
**Do:** When spawning subagents for Yoke work, explicitly include relevant invariants and recent decisions in the task instructions. At minimum, summarize the key points from `.ai/INVARIANTS.md`.

---

### compositeDelta filter creates unexplained score gaps

**What happened:** The Level-Up plan filters out items where `compositeDelta < 0.1`. When absent signals are spread across many individual signals, each one's composite impact falls below the threshold — but their combined axis deduction is clearly visible (e.g., 7 points on Security). The user sees a score of 93 with zero suggestions. This happened repeatedly because fixes targeted symptoms (adjusting factors, tweaking thresholds) without establishing the structural invariant that scoring and suggestions must stay in sync.

**Don't:** Apply display-threshold filters without a fallback that accounts for the residual gap. Don't assume that because individual items are small, the aggregate is invisible.
**Do:** Enforce the invariant: `sum(displayed_items) = 100 - axis_score` for every axis. If filtering removes items, show a grouped residual entry that explains the remaining points. Server must return enriched absent data (which signals, why absent) so the client can explain every deducted point.

---

### Informational signals must not affect the scoring budget

**What happened:** Signals like ads_txt, pwa_ready, hreflang, and mobile_app_links were canBeGood: true with non-zero weights, causing them to inflate the absent-signal pool. Sites were penalized for not having features irrelevant to their type (e.g., ads.txt on a security tool, hreflang on an English-only site, PWA on a dashboard).

**Don't:** Add canBeGood: true to signals that are only relevant to specific site types without requiresContext gating.
**Do:** When adding a new signal, ask: "Does every website need this?" If not, either gate with requiresContext or make it informational (canBeGood: false, weightRange: [0, 0]). The industry pattern: score on universals, inform on niche features.

---

### Two IP hash functions exist — use the right one

**What happened:** `request-tracking.ts` has `hashVisitor(ip, day)` (private, takes explicit day param) and `helpers.ts` has `hashIp(ip)` (exported, derives day internally). Both produce SHA-256 hashes with daily salt, but they're separate implementations. Using the wrong one or adding a third would fragment rate limiting (same IP → different hashes → rate limit bypass).

**Don't:** Create new IP hash functions. Don't use `hashVisitor()` outside of `request-tracking.ts`.
**Do:** Use `hashIp()` from `helpers.ts` for all new IP-keyed storage. `hashVisitor()` in `request-tracking.ts` predates `hashIp()` and is functionally equivalent — it stays as-is to avoid touching the analytics pipeline.

---

### detectHosting() and detectManagedHosting() are separate detection paths

**What happened:** WordPress VIP tests called `detectHosting()` with an HTML string as the first param, but `detectHosting()` takes `IpInfo | null` — it only checks headers, rDNS, and org. HTML-based hosting detection lives in `detectManagedHosting()` in `wordpress.ts`. Tests passed locally (test suite failed to load due to tslib issue) but broke in CI where the test actually ran.

**Don't:** Assume `detectHosting()` checks HTML content. Don't skip CI verification because tests pass locally.
**Do:** `detectHosting()` = headers/IP/rDNS patterns in `HOSTING_PATTERNS` (security.ts). `detectManagedHosting()` = deep detection with HTML patterns (wordpress.ts). Both run during analysis, but they're separate functions with separate inputs. Test the right one.

---

### CSP silently blocks inline scripts — blank page, no error

**What happened:** Self-hosted instance showed a blank white page. Config was injected as `<script>window.__CONFIG__={...}</script>` inline. CSP `script-src 'self'` silently blocked it — no console error, config was just `undefined`, and the React app rendered nothing because it couldn't read feature flags.

**Don't:** Inject runtime config as inline `<script>` tags.
**Do:** Serve config as an external script file (`/assets/config.js`) loaded via `<script src="/assets/config.js">`. CSP allows scripts from `'self'` — which means same-origin external files, not inline blocks. When debugging blank-page issues, check CSP headers first.

---

### Docker workerd needs volume-mounted config, not baked-in

**What happened:** First Docker build baked the worker bundle + config into the image. White-label env vars had no effect because config was frozen at build time.

**Don't:** Bake runtime config into Docker images. Self-hosters can't rebuild.
**Do:** Mount config as a volume or generate it at container startup from env vars. The `entrypoint.sh` pattern (generate `config.js` from env, then exec workerd) keeps images generic and config dynamic.

---

### Fly proxy Go module version bumped by `go get`

**What happened:** Running `go get golang.org/x/time@v0.5.0` in `fly-proxy/` also bumped `go.mod` from `go 1.22` to `go 1.25`. The Dockerfile uses `golang:1.22-alpine`, so the build failed with a version mismatch.

**Don't:** Run `go get` without checking the go.mod diff afterward.
**Do:** After any `go get`, verify `go.mod` still declares the Go version matching your Dockerfile. If it auto-bumps, manually revert the `go` directive line. Pin to the version in your build toolchain.

---

### Post-analysis enrichment was duplicated across two code paths

**What happened:** The JSON path (`api-core.ts`) and SSE path (`analyze-stream.ts`) both independently injected `share_url`, `pdf_url`, and percentiles after analysis. Adding a new side effect (badge cache write) to only one path would silently miss the other. This is the same class of bug as the percentile injection issue from June 1.

**Don't:** Add post-analysis side effects directly to `api-core.ts` or `analyze-stream.ts`. Don't duplicate enrichment logic across code paths.
**Do:** All post-analysis enrichment goes through the shared `finalizeResult()` function in `worker/src/actions/analyze/finalize.ts`. Both paths call it once. New side effects are added in one place and automatically apply to both JSON and SSE responses.

---

### D1 row writes are expensive at scale — know your per-request write budget

**What happened:** open-distance.com wrote 1.38 billion rows to D1 (map tile data, done twice). At $1/million rows written beyond the 50M free tier, this cost ~$1,330. The CF dashboard showed $500/day in usage but the billing panel showed $0 — the usage view shows gross operations before the free tier is applied, while billing shows net charges. The discrepancy delayed the realization.

**Don't:** Assume D1 is free. Don't write per-request analytics/tracking/rate-limiting rows to D1 without calculating the monthly write budget at 10x/100x/1000x traffic. Don't trust the CF usage dashboard for billing — always check the actual billing panel.
**Do:** Calculate your per-request D1 write count and multiply by expected monthly requests. For Yoke specifically: each uncached analysis does ~5-7 D1 writes (rate limit record, score insert, daily snapshot, usage tracking, request meta). At 100K requests/day that's ~15-21M writes/month — still within free tier. At 1M requests/day it's $150-210/month just for D1 writes. Consider Durable Objects for ephemeral state like rate limiting (in-memory, no per-write cost). Batch D1 writes where possible using `db.batch()`.

---

### Cloudflare free-tier thresholds are per-month, not per-day

**What happened:** Confusion between CF free plan (daily limits) and CF paid plan (monthly limits with different thresholds). The $5/mo Workers Paid plan changes the billing model entirely.

**Don't:** Assume free-plan thresholds when on the paid plan, or vice versa.
**Do:** Know exactly which plan you're on and the corresponding limits:
- **Workers Paid ($5/mo):** 10M requests/month, D1: 25B reads + 50M writes/month, KV: 10M reads + 1M writes/month
- **Workers Free:** 100K requests/day, D1: 5M reads/day + 100K writes/day, KV: 100K reads/day + 1K writes/day
Track which threshold you'll hit first at your growth rate.
