# Changelog

All notable changes to Yoke are documented here.

## [2.0.0] — 2026-05-31

### Breaking Changes
- **Letter grades replaced with descriptive tiers** — composite score display now uses Excellent (≥90), Strong (≥75), Moderate (≥60), Weak (≥40), Critical (<40) instead of A+/A/B+/B/C+/C/D+/D/F. API field `grade` → `tier`, CLI JSON output field `grade` → `tier`. SSL grades, security header grades, and AI readiness grades remain as letter grades.
- **API response field changes** — `domain_score.grade` → `domain_score.tier`, `comparison.composite.grade1/grade2` → `tier1/tier2`, `recent.lookups[].grade` → `tier`, `/api/scoring` returns `tier_thresholds` instead of `grade_thresholds`
- **CLI v2.0.0 required** — reads `tier` field from API, old CLI versions will show empty grades

### UI Changes
- **Pill-shaped tier badges** — composite score badges now use pill-shaped badges with dynamic width to accommodate tier names
- **"Grade-Up Simulator" → "Level-Up Plan"** — renamed with updated tier-based UI
- **Tier Distribution chart** — usage page shows tier distribution instead of grade distribution

## [1.5.0] — 2026-05-29

### Removed
- **Mozilla Observatory integration** — removed redundant Observatory check; Yoke's native security header analysis (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, CORS) covers the same ground

### Features
- **Permissions-Policy header detection** — parses and evaluates browser feature permissions
- **Referrer-Policy analysis** — detects and scores referrer policy configuration
- **Resource Hints detection** — dns-prefetch, preconnect, preload, prefetch, modulepreload signals
- **Recursive DNS enumeration** — zone-walking and brute-force subdomain discovery endpoint
- **llms.txt self-analysis bypass** — Yoke no longer flags its own llms.txt as missing
- **AI prompt calibration** — domain expertise expanded for social verification, cookie security, server version, permissions/referrer policy, security.txt, redirect chains, PWA, robots.txt
- **Grade-Up Simulator improvements** — clean blocklist severity fixed (info → good), non-actionable signals filtered, org page labels show which page is missing
- **API version headers** — `X-Yoke-Version` and `X-Yoke-Min-Client` on all API responses; CLI warns when outdated
- **API docs expansion** — `/api/docs` now documents all 18 endpoints with rate limits and request formats

### Bug Fixes
- **TSC type errors resolved** — missing imports, ProgressState reset, ActionItem/GradeUpItem type compatibility, ArchetypeData weights type
- **SHARE_SECRET hardening** — removed dev fallback secret; worker now fails explicitly if SHARE_SECRET is not configured
- **ip-api.com HTTPS** — GeoIP fallback chain now prefers HTTPS sources (ipwho.is before ip-api.com)
- **Dead code removal** — removed legacy HealthScoreData type definitions

### Maintenance
- **Version sync** — all components aligned to 1.5.0
- **178 tests passing** — no regressions

## [1.4.0] — 2026-05-27

### Scoring Overhaul
- **106 detection signals** — expanded from 83 with 23 new signals: mixed content detection, canonical URL validation, subresource integrity checks, form action security, mobile app deep links, MTA-STS/BIMI email auth, DMARC policy granularity, RSS/Atom feeds, hreflang international targeting, favicon/title/meta description presence, ads.txt, CSP report-only detection
- **Scoring calibration** — steepened severity curve (info 92→85, low 80→70, medium 65→50, high 30→20), raised A threshold to ≥90, grade distribution now 35% A / 57% B / 4% C / 4% D (was 93% A / 7% B)
- **Fixed axis weights** — single weight set for all archetypes: Security (0.25), Infrastructure (0.25), Trust (0.20), Performance (0.18), Visibility (0.12)
- **Breach grade cap** — >100M breached accounts caps grade at B

### Features
- **Social verification advice** — AI prompt, Top Priorities panel, and scoring now surface rel="me" verification guidance when social accounts are found but not verified
- **AI prompt calibration** — 10 new domain expertise entries covering social verification, cookie security, server version disclosure, referrer/permissions policy, security.txt, redirect chains, PWA, robots.txt
- **Homebrew tap** — `brew install yokedotlol/tap/yoke` via GoReleaser-managed releases
- **CLI version flag** — `yoke --version` prints version, commit, and build date

### Bug Fixes
- **CSP double-count** — CSP was scored twice (security audit + raw headers); removed duplicate
- **Client weight sync** — DomainScore.tsx fallback weights and summary text now match fixed weights
- **Stale archetype note** — `/api/scoring` endpoint text updated for fixed weights
- **www. prefix** — stripped during domain normalization (worker + CLI)
- **Path in URL** — `/github.com/kurtpayne` now 301-redirects to `/github.com`
- **/cli route** — browsers get SPA shell instead of 400 JSON error
- **Duplicate /install.sh** — removed dead route from index.ts
- **Title reset** — document title resets on logo click / home navigation
- **Fly proxy nil check** — PageSpeed response parsing guarded against malformed API responses
- **CLI exit codes** — API errors now consistently exit non-zero
- **CLI score --json** — outputs minimal `{domain, score, grade}` instead of full 55-key response
- **CLI good findings cap** — capped at 5 with "+N more passing" overflow
- **CLI compare errors** — failed domains show "Error" instead of "0/100 F"
- **Dead code** — removed deprecated `initFlyProbeUrl` function

### Developer Experience
- **Scoring integration tests** — 8 new tests covering grade boundaries, breach caps, CSP dedup, empty inputs
- **159 tests** passing (up from 151)
- **Check registry** — 26 Phase 2 checks extracted to individual files under `worker/src/checks/`

## [1.3.0] — 2026-05-23

### Features
- **Network Health panel** — Infrastructure tab gains DNS propagation (multi-resolver consistency), TCP connection timing (DNS/TCP/TLS breakdown via Fly probe), RIPE RIS routing data (ASN, prefix, BGP visibility & stability), and outage monitoring links (Downdetector, IsItDownRightNow). Surfaces DNS inconsistency and routing instability as domain signals and scoring findings. Compare view shows connection timing and routing stability differences. New external links to bgp.tools, HE BGP, and Downdetector on the Infrastructure tab.
- **Top Priorities engine** — replaced Key Findings with a ranked, actionable fix-it list with effort estimates and cross-axis insights
- **BYO API Key panel** — gear icon on AI tab opens advanced settings: API key input, model picker (Claude Sonnet 4, Opus 4, GPT-4o, o3, Gemini 2.5 Pro, Llama 4 Maverick), and live prompt editor; controls visible but disabled without a key to improve discoverability
- **BYO key UX copy** — clear "Why?" and "Privacy:" explanations in the panel; expanded `/privacy` page with full BYO key data handling details
- **Re-analyze button** — force a fresh analysis bypassing cache with one click
- **Social verification badges** — green (verified on homepage) and yellow (probe-discovered) indicators for discovered social accounts
- **RFC / documentation links** — AI Readiness checklist items link to specs (llmstxt.org, OpenAI crawler docs, schema.org, ANS spec); security headers link to MDN docs
- **Cache analysis panel** — Performance tab shows parsed Cache-Control directives, CDN cache status (Cloudflare/Vercel/CloudFront/Fastly), ETag/Last-Modified, Vary, effective TTL, and a verdict with issues
- **WAF detection** — identifies 11+ WAF providers (Cloudflare, Sucuri, Imperva, Akamai, AWS WAF, Barracuda, F5, DDoS-Guard, StackPath, Wordfence, ModSecurity) from headers, cookies, and HTML with confidence scoring
- **Trust signals** — aggregated trust hallmarks across security (HSTS preload, CSP, CAA, DNSSEC, WAF), identity (OV/EV certs, security.txt, bug bounty, DMARC enforcement), transparency (humans.txt, ads.txt, open source), and operational maturity (status pages, uptime monitoring, feedback tools, changelog widgets, trust badges)
- **SSL Labs deep link** — every SSL panel links directly to the full SSL Labs report
- **6 themes** — Dark (default), Light, Midnight, Nord, Solarized, High Contrast
- **Wildcard DNS detection** — random subdomain probe prevents false positives for ANS/DNS-AID agent discovery on domains with `*.domain` records
- **D1 cleanup endpoint** — `GET /api/cleanup` (admin-gated) clears stale cache, rate limits, and error logs
- **Domain comparison** — side-by-side scoring at `/compare/domain1/domain2` with overlaid radar, per-axis deltas, and key differences
- **83 detection signals** — expanded from 70 with 13 new signals extracted from existing data: open ports (Shodan), known vulnerabilities, cookie security, server version disclosure, referrer policy, permissions policy, HTTP-to-HTTPS redirect, redirect chain length, site unreachable, HTTP error response, security.txt, restrictive robots, PWA readiness
- **Fixed axis weights** — Security (0.25), Infrastructure (0.25), Trust (0.20), Performance (0.18), Visibility (0.12) replace per-archetype weight profiles for more consistent scoring
- **Breach grade cap** — domains with >100M breached accounts capped at B grade
- **Social verification** — Instagram and Threads added to rel="me" verification and footer links (7 platforms total)
- **Threads detection fix** — Threads accounts no longer misidentified as Mastodon due to generic Mastodon URL pattern

### Security
- **Worker-to-Fly auth** — optional `FLY_AUTH_SECRET` shared secret between the CF Worker and Fly probe; graceful degradation when unset
- **SSRF protection** — private IP blocking on redirect chains
- **Rate limiting** — per-endpoint D1-backed rate limits (30/hr analyze, 15/hr compare, 10/day AI)
- **Cache upsert** — `INSERT OR REPLACE` prevents UNIQUE constraint races on concurrent writes

### Performance
- **Code splitting** — React.lazy with 21 lazy chunks; initial JS reduced from 646KB to 213KB (67% reduction)
- **Clean landing page** — no auto-analyze on bare homepage load
- **`ctx.waitUntil`** — non-blocking background cache writes and analytics inserts
- **Go proxy timeouts** — read (10s), write (30s), idle (120s) server timeouts on the Fly probe
- **Timeout tuning** — per-check 30s timeout, Phase 2 deadline 50s, optimized for Cloudflare Workers paid plan
- **Port classification** — 8080/8443 removed from dangerous ports list (standard HTTP alternate ports)

### Infrastructure
- **Shared analysis core** — merged `analyze.ts` and `analyze-stream.ts` into a single `analyze/core.ts` pipeline; JSON and SSE endpoints are now thin wrappers with zero logic duplication
- **DoH fallback** — DNS resolution falls back from dns.google to cloudflare-dns.com on failure
- **Self-hosting support** — all URLs dynamic via `getBaseUrl(request, env)`; `BASE_URL` and `FLY_PROBE_URL` env vars for custom deployments
- **Zero `as any`** — full type safety across the entire codebase

### Bug Fixes
- **Browser title** — document title now resets when navigating home via logo click

### Developer Experience
- **Homebrew tap** — `brew install yokedotlol/tap/yoke` via GoReleaser-managed releases
- **CLI version flag** — `yoke --version` prints version, commit, and build date (injected by GoReleaser at release time)
- **`deploy.sh` in repo** — no longer gitignored; clean build + deploy in one command
- **Retired `build_combined.py`** — all SPA routing ported to TypeScript (`worker/src/spa.ts`)
- **Retired `QUICKSTART.md`** — self-hosting guide consolidated into README
- **151 tests** — scoring, detection, helpers, WHOIS, structured data
- **CHANGELOG.md** — you're reading it

## [1.0.0] — 2026-05-21

Initial release. 9-tab domain intelligence dashboard with 50+ data points.
