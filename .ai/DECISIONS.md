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


---

### 2026-06-03 — Email axis applies to ALL domains, not just email-sending domains

**What changed:** No code change — this is a rationale decision to NOT add an "email domain" gating check.
**Why:** Email security (SPF, DKIM, DMARC) protects EVERY domain, not just domains that actively send email. Without SPF/DMARC, anyone can spoof `From: ceo@yourdomain.com` and send phishing emails that damage your domain's reputation. Spoofed emails from unprotected domains can get the domain blocklisted by email providers. Blocklists typically operate on sender IP ranges, but domain reputation scoring by ESPs (Gmail, Outlook) also factors in the From domain's authentication posture.
**Rejected:** Skipping email axis scoring for "no-email domains" → this would leave domains unprotected and unaware of the spoofing risk. A domain with no MX records but also no SPF `v=spf1 -all` is MORE vulnerable, not less.
**Directive:** The email axis scores all domains. The absence of email infrastructure (no MX, no SPF, no DMARC) is a real security gap, not a "not applicable" condition.

---

### 2026-06-04 — User IPs hashed with secret salt (GDPR compliance)

**What changed:** All user IP addresses from `cf-connecting-ip` are SHA-256 hashed with a secret salt (`IP_HASH_SALT`) before being stored in D1 rate-limit tables (`endpoint_rate_limits`, `ai_rate_limits`). Shared `hashIp()` helper in `helpers.ts` uses a static salt for rate-limit key stability across day boundaries. The `hashVisitor()` function in `request-tracking.ts` uses the same secret salt plus a daily-rotating component for analytics visitor counting.
**Why:** Raw IP addresses are personal data under GDPR (Breyer v. Germany, EU Court of Justice). Rate limiting only needs "same requester = same key" within a window — a salted hash achieves this without storing reversible identifiers.
**Rejected:** Moving rate limiting entirely to KV with auto-expiring TTL keys → cleaner but bigger refactor, not needed since hashing solves the legal issue. Storing IPs with consent → no accounts, no consent mechanism, unnecessary complexity.
**Directive:** No raw user IP addresses may be stored in any database table. Use `hashIp()` from `helpers.ts` for any IP-keyed storage. Server IPs from DNS lookups (analyzed domain infrastructure) are public data and don't require hashing.

---

### 2026-06-04 — `/_/showcase` killed → client-side domain suggestion pills

**What changed:** Removed the `/_/showcase` server-side endpoint entirely. Replaced with a static list of 250+ curated seed domains in `client/src/components/RecentLookups.tsx`. The client picks 10 randomly (Fisher-Yates shuffle) on each page load and renders them as clickable pills. Also removed the KV write to `showcase:index` that ran on every analysis (saving a read+parse+sort+write per scan), and the `SHOWCASE_FEED` env var.
**Why:** The showcase feed was popularity-based, but at low traffic all domains have `scan_count=1`, making it functionally identical to a random/chronological feed. A client-side curated list works at any traffic level, requires zero server infrastructure, and doubles as a seed domain list for self-hosters (`scripts/seed-domains.sh`).
**Rejected:** Keeping showcase with synthetic boosted counts — artificial and unnecessary complexity for a feature that's purely cosmetic.
**Directive:** Homepage domain suggestions are 100% client-side. No server endpoint, no KV state. The domain list in `RecentLookups.tsx` IS the seed list. `seed-domains.sh` reads from it directly. Any domain additions go in that file.

---

### 2026-06-04 — Brandfetch is the official Brand Search API (false alarm)

**What changed:** No integration change — confirmed the endpoint we use (`api.brandfetch.io/v2/search/`) IS Brandfetch's documented Brand Search API. Updated User-Agent from spoofed `Mozilla/YokeBot/1.0` to proper `Yoke/2.0 (+https://yoke.lol)`.
**Why:** Initial concern was that we were using an undocumented internal API. Research confirmed it's their official free tier (500K req/mo, no key required). The only issue was the misleading UA string.
**Directive:** Brandfetch usage is legitimate. Do not add API key authentication — the free tier is sufficient. Keep the UA string honest: `Yoke/2.0 (+https://yoke.lol)`.

---

### 2026-06-04 — Google News RSS: keep with 4h cache TTL

**What changed:** News RSS cache TTL bumped from 1h to 4h.
**Why:** Google's ToS technically says "personal, non-commercial" for RSS, but thousands of tools consume Google News RSS without issue. Real risk is operational (CF IP ranges getting blocked), not legal. Longer cache TTL reduces upstream request volume and the risk of triggering automated blocks.
**Rejected:** Replacing RSS with Bing News Search API → adds Azure dependency and API key management for marginal benefit. May add as fallback later.
**Directive:** RSS is the primary news source. Cache aggressively (4h minimum). If Google starts blocking CF IPs, evaluate Bing News API (1K free req/mo via Azure) as fallback.

---

### 2026-06-04 — Privacy policy rewritten for accuracy

**What changed:** Complete rewrite of `/privacy` page. New sections: Rate Limiting & IP Handling, Anonymous Analytics, Data Retention, GDPR. Updated "What We Collect" to honestly describe hashed IP storage for rate limiting and anonymous request metadata.
**Why:** The old policy said "we collect only the domain name you submit" which was inaccurate — we also store hashed IPs for rate limiting and anonymous analytics metadata. For a security/privacy tool, an inaccurate privacy policy is a credibility problem. The new policy is thorough and honest.
**Directive:** Keep the privacy policy in sync with actual data handling. Any new data collection must be reflected in `/privacy` before shipping.

### 2026-06-04 — Legal/trust probes run independently of main HTTP probe

**What changed:** Removed the `httpProbeSucceeded` gate on `detectLegalPages()` and `checkTrustSignals()` in `core.ts`. Both now always run. When the main HTTP probe fails, empty HTML and null headers are passed so link-extraction yields nothing, but the HEAD→GET path probes still fire against well-known URLs (`/privacy`, `/about`, `/terms`, etc.).
**Why:** Sites behind WAFs (Akamai, Cloudflare, etc.) may return 403 on `/` while specific legal/trust paths remain accessible. Gating these probes on the main probe meant losing signal unnecessarily.
**Implementation:** `probeHeadWithFallback()` already uses GET with `body.cancel()` when HEAD fails — status + content-type only, no payload downloaded.
**Directive:** Legal and trust probes are independent of the main HTTP probe. Don't re-gate them.

---

### 2026-06-04 — Docker Compose is the official self-hosting path

**What changed:** Published comprehensive Docker Compose setup with three containers (Caddy + workerd + probe) as the maintained self-hosting deployment. Bare-metal documented as "advanced/community-maintained." Tested on Linode VPS (4GB/2vCPU) at yoke-test.lol.
**Why:** Docker Compose gives reproducible, single-command deploys with TLS out of the box (Caddy + Let's Encrypt). Bare workerd/Caddy is fine but harder to maintain for end users.
**Rejected:** Kubernetes (overkill for a single-instance tool), plain workerd without a container (too many manual steps for users).
**Directive:** Docker Compose is the primary self-hosting path. All new infrastructure features (env vars, probe config, TLS) must work in Docker Compose first. Bare-metal is community-maintained.

---

### 2026-06-04 — White-label branding via environment variables

**What changed:** Added `SITE_NAME`, `SITE_TAGLINE`, `REPO_URL`, `FEEDBACK_URL`, `HIDE_EXTENSION`, `HIDE_CLI`, `HIDE_GITHUB` env vars to support rebrandable self-hosted instances. Config injected via external `/assets/config.js` (not inline `<script>`).
**Why:** Self-hosters (MSPs, agencies, consultants) need to rebrand the tool for their clients. Env vars keep it zero-code.
**Rejected:** Inline `<script>` for config injection → violates CSP. Build-time branding → requires self-hosters to rebuild the client.
**Directive:** All white-label config must be injectable at runtime via env vars. No self-hoster should need to rebuild the client or worker to rebrand. Config script must be external (CSP-compliant), never inline.

---

### 2026-06-04 — CSP config injection via external script, not inline

**What changed:** Client config (`SITE_NAME`, feature flags) is injected as `/assets/config.js` served by the worker/Caddy, referenced via `<script src="/assets/config.js">`. Not via inline `<script>window.__CONFIG__=...</script>`.
**Why:** CSP `script-src 'self'` blocks inline scripts. Early self-hosting had a blank page because inline config was silently blocked — no console error, just undefined config. External script is CSP-clean.
**Directive:** Never inject config as an inline script. Always use the external `/assets/config.js` pattern. If new config vars are needed, add them to the `config.js` generation in `index.ts` and the Docker env template.

---

### 2026-06-04 — MTA-STS MX hosts templatized

**What changed:** MTA-STS policy endpoint (`/.well-known/mta-sts.txt`) now reads MX hosts from `MTA_STS_MX_1`, `MTA_STS_MX_2`, `MTA_STS_MX_3` env vars instead of hardcoding Google Workspace MX records. Caddyfile and docker-compose.yml both support the env vars.
**Why:** Self-hosters use different mail providers. Hardcoded Google MX makes MTA-STS fail for non-Google mail.
**Directive:** All mail infrastructure references (MX hosts, DKIM selectors) must be configurable via env vars for self-hosters. No hardcoded mail provider assumptions.

---

### 2026-06-04 — Fly proxy rate limiting: global token bucket

**What changed:** Added global 1000 req/s token bucket to the Go Fly proxy using `golang.org/x/time/rate` v0.5.0. Returns 429 + `Retry-After: 1` when exhausted. Rolling 60s window counters feed health tiers (green/yellow/red).
**Why:** Safety ceiling to prevent runaway or abusive request volume from degrading probe performance. 1000 req/s is intentionally high — protective, not restrictive.
**Rejected:** Per-IP rate limiting at the proxy level → adds state management complexity, already handled at the Worker layer. WAF-style rate limiting → overkill, Fly already has DDoS protection at the edge.
**Directive:** Rate limiting at the proxy is a blunt safety valve. Fine-grained per-IP limits remain the Worker's responsibility. The proxy just prevents the aggregate from going out of control.

---

### 2026-06-04 — Fly health endpoint requires auth

**What changed:** `/health` on the Fly proxy now requires `Authorization: Bearer <FLY_AUTH_SECRET>`. Returns 401 without it. Exposes health tier (green/yellow/red) but no raw metrics.
**Why:** The maintainer's directive: "Nobody touches the proxy. It's an abstraction not an entry point." Health data (even coarse tiers) reveals operational state — no reason to expose it publicly.
**Rejected:** Public health endpoint with sanitized output → still reveals operational state, no benefit for a non-user-facing service.
**Directive:** All Fly proxy endpoints require `FLY_AUTH_SECRET` auth. No public endpoints on the proxy.

---

### 2026-06-04 — UptimeRobot integration: link on /status, no embedded widget

**What changed:** UptimeRobot monitors set up for yoke.lol. Link to UptimeRobot status page added to `/status` footer via `UPTIME_URL` env var. No embedded iframe or widget.
**Why:** Free tier of UptimeRobot doesn't include custom subdomain. A footer link is lightweight and avoids maintaining two status pages.
**Rejected:** Embedding UptimeRobot widget inline → adds external JS dependency, CORS/CSP concerns. Custom subdomain → paid feature, not worth it.
**Directive:** `UPTIME_URL` is optional. When set, shows "Uptime History" link in `/status` footer. Self-hosters can point it at their own monitoring.

---

### 2026-06-05 — Embeddable badges: shields-style pip badges with 4-layer cache warming

**What changed:** Added embeddable domain score badges at `/badge/<domain>.svg` (direct SVG) and `/badge/<domain>.json` (Shields.io endpoint protocol). Badge endpoint is a pure KV read — never triggers synchronous analysis, always responds in <500ms.

**Badge cache strategy — 4 layers:**
1. **Natural traffic** — every analysis writes a `badge:<domain>` KV entry (~200 bytes, 48h TTL) as a side effect. Most badge domains stay warm from normal Yoke usage.
2. **Stale-while-revalidate** — badge request checks `analyzedAt`; if >20h old, serves current data immediately and kicks off background re-analysis via `waitUntil`.
3. **Pre-warm cron (hourly)** — CF Workers scheduled handler sweeps `badge_domains` D1 table, re-analyzes only domains with missing or expired cache entries.
4. **Cold start** — first-ever badge request for an unscanned domain returns a neutral gray "not yet scanned" badge and triggers background analysis.

**Infrastructure:**
- Separate `badge:<domain>` KV key (NOT retrofitted into the analysis cache — different TTL, different payload)
- `badge_domains` D1 table in existing `yoke-stats` database for tracking domains with badge requests
- CF Workers `scheduled` event handler for the pre-warm cron
- `POST /api/admin/badge-sweep` admin endpoint for self-hosters to trigger sweeps without CF cron
  - **Superseded (2026-06):** the timer-based pre-warm sweep was a cost-model hole (re-analyzed every tracked domain on a timer). It was removed along with the `POST /api/admin/badge-sweep` endpoint and the `badgeSweep()` helper. Badges now refresh lazily on-view (demand-gated, under the global budget), and a cached badge whose SSL cert `notAfter` has passed demotes to a neutral "stale — re-scan" (a staleness trigger, never an "expired" verdict). The hourly cron now only flushes cost counters + prunes.

**Prerequisite refactor:** Extracted duplicated post-analysis enrichment (share_url, pdf_url, percentiles injection) from both JSON path (`api-core.ts`) and SSE path (`analyze-stream.ts`) into a shared `finalizeResult()` function in `worker/src/actions/analyze/finalize.ts`. Badge cache write and badge_url injection added to this shared function, eliminating the dual-path divergence bug class entirely.

**Rejected:** Fast-path scoring without PageSpeed (run 5 of 6 axes in ~8s for quicker cold start) — adds scoring complexity, and the neutral "not yet scanned" badge handles cold starts cleanly. Making cache warming solely the user's responsibility (provide a GitHub Action) — reduces adoption; offered as an optional extra instead. Retrofitting stale-while-revalidate into the analysis cache (inflate TTL, embed internal freshness timestamp) — requires changing cache read logic everywhere; a separate badge cache key is much simpler.

**Directive:** Badge endpoints (`/badge/*`) must never trigger synchronous analysis — always a pure KV read + optional background work. Badge cache is always a separate derived key (`badge:<domain>`), never part of the analysis cache (`cache:analysis:<domain>`). All post-analysis enrichment (share_url, pdf_url, badge_url, percentiles, badge cache write) must go through the shared `finalizeResult()` function — never duplicated across code paths.

---

### 2026-06-08 — Rate limits tightened for DO cost ceiling

**What changed:** All per-IP rate limits reduced to prevent Durable Objects request overage on the $5/mo Workers Paid plan. New defaults:
- `/api/analyze`: 50 → **20**/hr
- `/api/compare`: 50 → **20**/hr
- `/api/subdomain-scan`: 30 → **15**/hr
- `/api/subdomains`: 50 → **30**/hr
- `/api/company`, `/api/news`, `/api/social`, `/api/reverse-ip`: 50 → **30**/hr
- `/api/availability`: 60 → **30**/hr
- `/api/js-audit`, `/api/suggestions`, `/api/ai-prompt`, `/report`: 20 → **10**/hr
- `/api/track-tab`: 100 → **200**/hr (cheap telemetry, loosened)

**Why:** Cost modeling showed DO requests are the binding constraint at 1M included/month on the Paid plan ($0.15/M overage). Each full scan (all tabs + AI) consumes ~16 DO requests (2 per rate-limited endpoint: dry-run check + record). At old limits, one heavy user maxing out analyze + all enrichments = 800 DO/hr. 100 concurrent heavy users = 80K DO/hr → would blow past 1M in 12 hours. New limits cap worst-case per-user DO consumption at ~200/hr. Need 500+ concurrent heavy users/hour to hit the 1M ceiling.

**Rejected:** Removing rate limiting from track-tab entirely → still useful as a safety valve even for cheap endpoints. Keeping old limits and accepting overage → overage is cheap ($0.15/M) but unnecessary risk for a pre-launch project.

**Directive:** Rate limit defaults are set for the $5/mo Workers Paid plan's included DO tier. Env var overrides (`RATE_LIMIT_*`) let self-hosters or future plan upgrades adjust without code changes. The 4 configurable limits (analyze, compare, subdomain, availability) are the only ones exposed as env vars — the rest are hardcoded in `shared.ts`.


---

### 2026-06-17 — Null MX scoring: requiresInboundEmail flag

**What changed:** Added `requiresInboundEmail` flag to the signal registry. Signals tagged `requiresInboundEmail: true` (`mta_sts`, `tls_rpt`, `bimi_record`) are excluded from both the absent pool and the effective max weight denominator when a domain has null MX (RFC 7505 — intentional no-mail declaration).
**Why:** Null MX domains don't receive inbound email, so penalizing them for missing MTA-STS/TLS-RPT/BIMI is architecturally wrong. These signals only matter for domains that accept mail.
**DKIM excluded from the flag:** DKIM is about signing outbound email, not receiving. A null MX domain might still send email and should still have DKIM.
**Detection:** Null MX detected via regex matching `0 .` in MX records.
**Rejected:** Skipping the entire email axis for null MX domains → email axis applies to ALL domains (see 2026-06-03 decision). SPF/DMARC/DKIM remain scored.
**Directive:** Signals with `requiresInboundEmail: true` are excluded from scoring when null MX is detected. The flag is per-signal, not per-axis.

---

### 2026-06-17 — "Level-Up Plan" renamed to "Score Breakdown" / "Score Waterfall"

**What changed:** Renamed the "Level-Up Plan" feature to "Score Breakdown" (UI label) and "Score Waterfall" (internal/technical name). The feature shows per-signal deductions and opportunities for each axis.
**Why:** "Level-Up" implied gamification that didn't match the tool's professional positioning. "Score Breakdown" is descriptive and neutral. "Waterfall" describes the visual pattern (start at 100, each deduction cascades down).
**Directive:** Use "Score Breakdown" in user-facing UI/docs. Use "waterfall" in code identifiers and technical docs. Historical DECISIONS entries referencing "Level-Up" are append-only and preserved as-is.

---

### 2026-06-18 — Service binding architecture: production yes, self-hosting A/B/C framework

**What changed:** Clarified service binding strategy across two independent dimensions:

1. **Production service bindings (yoke → satellites via CF Service Bindings):** YES. Yoke calls satellite workers (certs, ns, xhttp, vrfy) directly via CF bindings — perf win, no egress, no public HTTP round-trip. vrfy binding already exists (email auth cache, clean fallback). Other satellites to follow.

2. **Self-hosting architecture — three options identified:**
   - **A) Yoke-only self-host (ship now):** Satellites are OSS, best-effort docs. Yoke is the supported self-host target.
   - **B) Full white-label stack (north star):** Dedicated domain (e.g. yoke-test.lol), subdomains per tool (ns.yoke-test.lol, certs.yoke-test.lol, etc.), fully self-hostable and white-labelable.
   - **C) Separate codebase versions for self-hosting:** Rejected — "gross, yuck, boo hiss, bad."

**Constraint:** Nothing deployed now can be fundamentally incompatible with B. Satellite integrations must be modular — binding vs HTTP call vs localhost swappable by config, not by code change. B should be additive, not a rewrite.

**Directive:** Ship A now. Build toward B. Every satellite integration must be behind an interface where the backing implementation is swappable by config. Production CF bindings are internal to the deployment and invisible to self-hosters.
