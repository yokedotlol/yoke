# Yoke — Decision Log

> Append-only record of significant decisions. Never edit or remove entries.
> Include `Rejected:` to prevent re-exploring dead ends, `Directive:` to guide future work.

---

### 2026-05-22 — Project created

Yoke registered at yoke.lol. Initial architecture: Cloudflare Worker + Vite SPA + Fly.io proxy.

---

### 2026-05-25 — Yahoo Finance removed

**What changed:** Removed all Yahoo Finance data sources and references.
**Why:** Terms of Service violation risk. Yahoo Finance explicitly prohibits scraping.
**Rejected:** Using a paid Yahoo Finance API → cost not justified for the data it provides.
**Directive:** Do not re-add any Yahoo Finance integration. If financial data is needed, find a ToS-compliant source.

---

### 2026-05-25 — SSL Labs removed

**What changed:** Removed SSL Labs API integration.
**Why:** Qualys ToS violation — their API terms prohibit use in competing products.
**Replaced with:** Direct SSL probing via the Fly proxy, deep link to SSL Labs for users who want the full report.
**Directive:** Do not call the SSL Labs API. The deep link in the UI is fine.

---

### 2026-05-27 — /api/recent endpoint deleted

**What changed:** Removed the `/api/recent` endpoint entirely. The site ticker (showing recent lookups) remains, backed by KV.
**Why:** Privacy concern (exposes what domains users are looking up), low value, attack surface.
**Rejected:** Keep endpoint but add rate limiting → still a privacy issue regardless of rate limits.
**Directive:** The KV write for the site ticker is the only remnant. Do not re-create a public recent-lookups API.

---

### 2026-05-27 — Health endpoint split into public and admin

**What changed:** `/api/health` shows status/version/uptime publicly. Full error details require `X-Admin-Key` header.
**Why:** Exposing internal errors publicly is an information leak.
**Directive:** Never add diagnostic details to the public health response.

---

### 2026-05-27 — WordPress signal weights finalized

**What changed:** `wp_user_enumeration` gets scoring weight `[1, 1]`. `wp_xmlrpc_enabled` and `wp_version_exposed` stay at weight `[0, 0]`.
**Why:** xmlrpc detection is unreliable (many hosts disable it at the server level, not WordPress level). Version exposure detection is flaky. User enumeration is a real, testable security concern.
**Directive:** If adding WP signals, default to weight 0 unless the detection is highly reliable and the security impact is clear.

---

### 2026-05-29 — D1 yoke-cache fully decommissioned

**What changed:** All caching moved from D1 `yoke-cache` to KV `REFERENCE_DATA`. D1 binding removed from wrangler.toml.
**Why:** KV is better suited for cache workloads (no row limits, TTL-based expiry, no schema management).
**Directive:** There is exactly ONE D1 database: `yoke-stats`. Do not create or reference a second D1. All caching goes through KV.

---

### 2026-05-29 — Recursive DNS panel removed

**What changed:** Removed `/api/recursive-dns` endpoint and the recursive DNS UI panel.
**Why:** Low value to users, potential attack vector (could be used to probe internal DNS infrastructure).
**Directive:** Do not re-add. If DNS resolver information is needed, fold it into existing DNS checks.

---

### 2026-05-31 — Scoring model: anchor-and-adjust → deductive

**What changed:** Replaced anchor-and-adjust scoring (BASELINE=55, add/subtract) with deductive scoring (start at 100, subtract deductions).
**Replaced:** `BASELINE = 55` constant and all adjustment logic.
**Why:** Anchor-and-adjust was opaque — hard to explain why a score was what it was. Deductive is intuitive: "you start perfect, here's what's costing you points."
**Rejected:** Keep anchor-and-adjust with better calibration → fundamental UX problem, not a calibration problem.
**Directive:** Scoring ALWAYS starts at 100 and subtracts. If you see any reference to BASELINE, an additive scoring model, or anchor-and-adjust, it's stale code that must be removed.

---

### 2026-05-31 — Composite: geometric mean → weighted arithmetic mean

**What changed:** Composite score uses weighted arithmetic mean of axis scores (with axis weights summing to 1.0), plus an outlier floor cap.
**Why:** Geometric mean punished single low axes too aggressively, making scores hard to explain.
**Outlier floor cap:** If ANY axis < 40, composite is capped at 74 (Moderate maximum). This preserves the "one terrible axis drags you down" principle without the geometric mean's opacity.
**Directive:** Do not use geometric mean for composite calculation. The arithmetic mean + floor cap is the current model.

---

### 2026-05-31 — Letter grades → descriptive tiers

**What changed:** Replaced A+/A/B+/B/C+/C/D+/D/F with Excellent/Strong/Moderate/Weak/Critical.
**Why:** Letter grades implied an academic testing metaphor that didn't match what we're measuring. Descriptive tiers communicate meaning directly.
**Directive:** Use "tier" (not "grade") everywhere — API responses, UI labels, documentation, test names. "Level-Up" (not "Grade-Up") for the improvement plan.

---

### 2026-05-31 — MCP server published to npm

**What changed:** `@yokedotlol/mcp-server` v1.0.1 published. TypeScript-based Model Context Protocol server for AI agent integration.
**Directive:** Version in `mcp-server/package.json`, released via `mcp/v*` tags.

---

### 2026-06-01 — ABSENT_DEDUCTION_FACTOR reduced 0.25 → 0.15

**What changed:** The penalty applied when a signal is absent (can't be assessed) reduced from 25% of its potential deduction to 15%.
**Why:** 0.25 was too harsh for Discoverability-heavy domains (e.g., google.com scored 69 on Discoverability). Many absent signals are genuinely not applicable, not a sign of poor configuration.
**Directive:** The current value is 0.15. Changes to this constant affect ALL scores and must be validated with calibration tests.

---

### 2026-06-01 — ip-api.com removed, replaced by ipwho.is + MaxMind

**What changed:** Removed ip-api.com geolocation. Primary: MaxMind GeoIP via Fly proxy. Fallback: ipwho.is (HTTPS).
**Why:** ip-api.com is HTTP-only — a security concern for a security tool.
**Directive:** Do not use HTTP-only APIs for any data source.

---

### 2026-06-01 — Level-Up Plan shows both penalties and opportunities

**What changed:** Level-Up Plan expanded to show penalty removals (fix bad things) AND positive canBeGood signal opportunities (add good things). Previously only showed penalties.
**Why:** Users need to see both "what's hurting you" and "what you're missing" to prioritize improvements effectively.
**Directive:** Level-Up must surface both dimensions. The `presentWeight` calculation only counts `canBeGood` signals.

---

### 2026-06-01 — .ai/ context framework added

**What changed:** Added `.ai/` directory with CONSTITUTION.md, DECISIONS.md, INVARIANTS.md, STATE.md, GOTCHAS.md, and staleness-check.sh.
**Why:** AI agents working on the project need persistent, structured context about decisions, invariants, and current state to avoid reverting agreed-upon changes or violating project principles.
**Directive:** Keep these files updated. See CONSTITUTION.md for the maintenance protocol.

---

### 2026-06-01: Restored recent domains ticker

- **What:** Re-added KV write for recent:index and homepage ticker display
- **Why:** Cleanup sprints accidentally removed both the write and display when removing /api/recent
- **Directive:** The ticker is an internal SPA feature. /api/recent remains removed as a public API endpoint.

---

### 2026-06-01: Canonical curl format is `curl -s https://`

- **What:** Updated all curl examples across README, CLAUDE.md, .ai/, CurlShowcase, API docs, MCP content, and meta tags to use `curl -s https://yoke.lol/...` format
- **Why:** Bare `curl yoke.lol/...` hits HTTP and doesn't follow the 301 redirect to HTTPS. Adding `-s` suppresses progress bars for cleaner piping to jq.
- **Directive:** All curl examples referencing yoke.lol must use explicit `https://` and `-s` flag.

---

### 2026-06-01: Score–suggestion consistency enforced as core directive

- **What:** Every axis score deficit from 100 must be fully accounted for in the Level-Up plan. Absent signals must be enumerated individually with reasons (e.g., "probe failed", "not detected in scan"). The `compositeDelta < 0.1` filter must not create unexplained gaps.
- **Why:** Axes scoring 93/98/97/99 with zero suggestions destroyed user trust — the product told users something was wrong without explaining what. Root cause: scoring engine deducted in aggregate (all absent signals pooled) while Level-Up evaluated individually (each below display threshold). The structural mismatch persisted across multiple fix attempts because the fundamental sync invariant was never established.
- **Rejected:** Option 2 (don't deduct what you can't explain — inflates scores artificially), Option 3 (show all opportunities regardless of threshold — too much noise).
- **Directive:** `sum(displayed_items) = 100 - axis_score` for every axis. Added as invariant in INVARIANTS.md and core directive in CONSTITUTION.md. Server must return enriched absent-signal data (which signals, why absent). Client must display them.

---

### 2026-06-01: Scoring fairness overhaul — 10 signals reclassified, 2 detection bugs fixed

**What:** Reclassified 10 signals from scoring to informational (non-scoring): ads_txt, greynoise_riot, ns_provider_diversity, http_to_https_redirect, pwa_ready, mobile_app_links, hreflang, rss_feed, crux_field_data, inp. Fixed 2 detection bugs: render_blocking_scripts and subresource_integrity now emit "good" when zero third-party scripts are present.
**Why:** These signals penalized sites for things that are either not applicable (ads.txt on non-ad sites, hreflang on English-only sites), architectural choices (PWA), traffic-dependent (CrUX/INP), redundant with other signals (GreyNoise RIOT overlaps CDN detection), or UX rather than security (HTTP→HTTPS redirect when TLS+HSTS present). Industry pattern (Lighthouse, Mozilla Observatory, SecurityHeaders) is clear: score on universals, inform on niche features.
**Rejected:** Archetype-specific weighting (too complex, maintainability risk). Removing signals entirely (they're still useful as informational indicators). cookie_consent_cmp was NOT reclassified — it already had requiresContext: "cookies" gating, which is the correct behavior (score when cookies present, exclude when absent).
**Directive:** Score on universals, inform on niche features. Use `canBeGood: false` + `weightRange: [0, 0]` for informational signals. Use `requiresContext` when a signal is valid only in specific contexts. Informational signals are still detected and displayed — they just don't affect scores.

---

### 2026-06-01: ABSENT_DEDUCTION_FACTOR increased 0.15 → 0.30

**What changed:** The penalty applied when a signal is absent (can't be assessed) increased from 15% to 30% of its potential deduction.
**Why:** After adding null axis imputation at 35, the 0.15 factor was too lenient — domains with many absent signals weren't penalized enough. The higher factor combined with NULL_AXIS_IMPUTE = 35 gives a more honest score for domains where the scanner couldn't assess many signals.
**Directive:** The current value is 0.30. Changes to this constant affect ALL scores and must be validated with calibration tests.

---

### 2026-06-01: Level-Up composite delta filter replaced with axis-deduction threshold

**What changed:** The `compositeDelta < 0.1` filter that dropped Level-Up items was replaced with an axis-deduction threshold (`signalGain < 0.5`). Composite delta is now computed with unrounded precision for display/sorting, with a 0.1-point floor.
**Why:** Integer rounding of composites caused small-but-real deductions (1-2 points on an axis) to round to 0 composite delta, dropping legitimate items. The core invariant (`sum(displayed_items) = 100 - axis_score`) was violated because the filter operated at the wrong granularity — composite-level instead of axis-level.
**Directive:** Every deduction ≥ 0.5 axis points must appear in the Level-Up plan. The score–suggestion consistency invariant is non-negotiable.

---

### 2026-06-02: Scoring model recalibration — IDF absent penalties, threshold shift, foundations rebalance

**What changed:**
1. **IDF-influenced absent penalty**: `absent_penalty = ABSENT_DEDUCTION_FACTOR × (1 + goodPrevalence)` per signal, replacing the flat `ABSENT_DEDUCTION_FACTOR = 0.30` applied uniformly. Each canBeGood signal now carries a `goodPrevalence` field (0–1) based on corpus analysis of 3,329 domains. Missing common signals (HSTS at 100% prevalence → factor 0.60) cost more than missing rare ones (security.txt at 100% prevalence gets the same max factor, but MTA-STS at 55.6% → factor 0.467). Signals without prevalence data default to factor 0.30 (unchanged).
2. **Strong tier threshold 75 → 78**: Combined with IDF penalties, projects ~55% Strong (was ~71%), ~39% Moderate (was ~21%). Much healthier distribution — Strong now means something.
3. **http3 weight 3 → 1**: Still emerging tech (33.5% adoption). Weight-3 absent penalty was too aggressive for a non-hygiene signal. Bonus signal, low weight.
4. **tcp_connection_time and dns_resolution_time weight 3 → 2**: Single probe location, 99%+ pass rate. These don't differentiate — they just punish the rare outlier disproportionately.
5. **http2 set canBeGood: true** (was false/informational): 95%+ adoption means absence is meaningful — penalizes the ~5% still on HTTP/1.1 only. Severity changed from info to good.
6. **lb weight → 0, canBeGood → false**: Weak heuristic — just A record count, conflates CDN anycast with real load balancing. Demoted to informational.
**Why:** Analysis showed 71% of domains landing in Strong (75-89). The scoring system barely differentiated between enterprise sites and basic blogs. Root cause: flat absent penalty treated missing HSTS (52% prevalence) the same as missing MTA-STS (3.2%). Foundations axis mean 90.4 was too generous due to commodity signals (dns_consistent 100%, ns_redundancy 100%) and aggressive http3 penalty.
**Simulated impact (IDF + threshold 78):** Strong drops 71% → ~55%, Moderate rises 21% → ~39%. Mean composite shifts -1.9 points. No signal is penalized less than before — only more for highly-prevalent missing signals.
**Rejected:** Threshold 80 (too aggressive — 46% Strong / 47% Moderate is a near-even split), axis reweighting (current axis correlations are healthy), removing commodity signals (their value is in the absent penalty).
**Directive:** The `goodPrevalence` values are static snapshots from 2026-06-02 corpus analysis. They should be refreshed periodically (quarterly or when the signal mix changes significantly). The ABSENT_DEDUCTION_FACTOR constant (0.30) is the baseline multiplier; the IDF factor (1 + goodPrevalence) scales it per-signal. Changes to either affect ALL scores.

---

### 2026-06-02 — Credibility Principle codified

**What changed:** Added "Credibility Principle" to CONSTITUTION.md and two credibility invariants to INVARIANTS.md.
**Why:** The HSTS/CSP triple-dip bug (missing `suppressesAbsent` wiring) produced technically-correct math that looked completely wrong to users — three line items for one missing header. The underlying math was valid, but the presentation destroyed trust. This principle codifies that user perception of correctness is as important as actual correctness. If it looks broken, it is broken.
**Directive:** Every new signal, UI change, or scoring adjustment must be stress-tested against: "Would a skeptical first-time user trust this output?"

