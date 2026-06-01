<div align="center">

# 🔗 Yoke

**Free, open-source domain intelligence — DNS, WHOIS, SSL, security, tech stack, performance, breaches, AI analysis, and more. Web, API, CLI, and Chrome extension.**

[![CI](https://github.com/yokedotlol/yoke/actions/workflows/ci.yml/badge.svg)](https://github.com/yokedotlol/yoke/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/yokedotlol/yoke/blob/main/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fghkhjlelidaepapcdfjifnlcjmkgpcj?label=Chrome%20Extension)](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)

**[Try it → yoke.lol](https://yoke.lol)** · **[API Docs](https://yoke.lol/api/docs)** · **[CLI](#cli)** · **[Chrome Extension](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)** · **[Status](https://yoke.lol/status)**

</div>

---

## What is Yoke?

Yoke pulls 155 scoring signals for any domain and presents them in a clean tabbed interface with a contextual scoring system. Think `dig` + `whois` + `nmap` + `curl` + BuiltWith + SecurityTrails — in one tool, no account required.

```bash
curl -s https://yoke.lol/stripe.com | jq
```

## Features

### 📊 Contextual Scoring
6-axis scoring (Security, Speed, Foundations, Reputation, Discoverability, Email) with radar visualization. Fixed axis weights: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12). Tiers: Excellent ≥90, Strong ≥75, Moderate ≥60, Weak ≥40, Critical <40. Performance scoring is mobile-first (60% mobile + 40% desktop blending). Breach reputation impact uses time decay — recent breaches weigh more heavily, while breaches older than 10 years have minimal impact. Auto-classifies sites into 7 archetypes (commerce, content, application, corporate, infrastructure, institutional, general) to adjust individual finding severity — missing HSTS is critical for e-commerce, low-priority for a blog. [Compare domains side-by-side](https://yoke.lol/compare/github.com/gitlab.com) with overlaid radar and per-axis deltas.

### 🔍 Core Analysis
- **DNS** — A, AAAA, MX, NS, TXT, CNAME, CAA, SOA with TTL and provider detection
- **WHOIS / RDAP** — 4-tier resolution: RDAP bootstrap → IANA fallback → WhoisFreaks → raw WHOIS. Registrar, dates, domain age, nameservers
- **SSL/TLS** — Grade, issuer, validity, protocols, key exchange. SSL Labs deep link
- **HTTP** — Redirect chain, response times, HTTP/2 and HTTP/3 detection
- **Network Health** — Global availability (check-host.net), TCP timing breakdown, BGP routing (RIPE RIS)

### 🛡️ Security
- **Headers Audit** — CSP, HSTS, X-Frame-Options, Permissions-Policy, Referrer-Policy, and more with pass/fail grading
- **Email Auth** — SPF, DKIM, DMARC, BIMI, MTA-STS, TLS-RPT
- **DNSSEC** — DNSKEY and DS record verification
- **Breach Detection** — HIBP database lookup with time-decay weighting
- **Subdomain Scan** — 157 common prefixes across 12 categories + CT log discovery via CertSpotter
- **Cookie Security** — Secure, HttpOnly, SameSite audit
- **WAF Detection** — 11+ providers (Cloudflare, Sucuri, Imperva, Akamai, etc.)
- **GreyNoise Intel** — Noise/RIOT IP classification
- **Trust Signals** — HSTS preload, CAA with CT cross-reference, security.txt, bug bounty, status pages, and more

### ⚙️ Tech Stack
- **Technology Detection** — 100+ fingerprints: CMS, frameworks, CDNs, analytics
- **WordPress Deep Detection** — Theme, 100+ plugins, version, page builder, hosting
- **Structured Data** — JSON-LD validation against schema.org for 20+ types
- **Third-Party Scripts** — 100+ patterns across 9 categories with render-blocking detection
- **Cookie Consent** — 13+ CMP platforms detected
- **Accessibility** — 9 WCAG quick checks (labels, alt text, contrast, headings, landmarks)

### 📊 Performance & Business
- **PageSpeed** — Lighthouse scores (mobile-first 60/40 blend), Core Web Vitals (FCP, LCP, TBT, CLS), CrUX field data, cache analysis
- **Company Intel** — Wikidata + Brandfetch + Crunchbase enrichment
- **News & Social** — Bing News, Hacker News, social account discovery with rel="me" verification badges across 12+ platforms

### 🤖 AI Analysis
**Level-Up Plan** (deterministic, no LLM) — calculates the exact score impact of fixing each finding, prioritized by effort vs. gain. Shows projected grade and score after fixes.

**Cross-Signal Insights** (LLM) — AI-powered analysis that finds correlations across findings, explains their combined impact, and provides strategic recommendations. Powered by DeepSeek V3 via OpenRouter. BYO API key to bypass rate limits — your key is passed through to OpenRouter and never logged or stored. Includes model picker and prompt editor.

### 🔗 API & Sharing
- **JSON API** — `curl -s https://yoke.lol/stripe.com | jq` — content-negotiated, no auth required
- **SSE Streaming** — Real-time per-check progress
- **Share Bar** — Copy link, X, LinkedIn, Reddit, native Web Share
- **Dynamic OG Tags** — Rich previews when sharing analysis URLs
- **Chrome Extension** — [Install from Web Store](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj) — one-click side panel analysis
- **Agent Discovery** — ANS (`_ans.` TXT), DNS-AID (`_agents.` TXT), `/.well-known/agent.json`
- **12 Themes** — Dark, Light, Arcade, Deep Blue, Enterprise, Newsprint, LCARS, Synthwave, Botanical, Slate, Rosé, High Contrast

---

## API

No auth required. JSON by default for programmatic clients, HTML for browsers.

```bash
# Full analysis
curl -s https://yoke.lol/stripe.com | jq

# Pretty-printed (no jq needed)
curl -s "https://yoke.lol/stripe.com?pretty"

# Specific fields
curl -s https://yoke.lol/stripe.com | jq '.ssl'
curl -s https://yoke.lol/stripe.com | jq '.domain_score'
curl -s https://yoke.lol/stripe.com | jq '.tech_stack'

# Compare two domains
curl -s https://yoke.lol/api/compare -X POST \
  -H "Content-Type: application/json" \
  -d '{"domain1":"github.com","domain2":"gitlab.com"}' | jq '.comparison'

# Health / status
curl -s https://yoke.lol/api/health | jq

# Scoring methodology
curl -s https://yoke.lol/api/scoring | jq
```

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| Analyze | 50/hr per IP |
| Compare | 50/hr per IP |
| Subdomain Scan | 30/hr per IP |
| Availability | 60/hr per IP |
| AI Analysis (platform key) | 10/hr per IP |
| AI Analysis (BYO key) | Unlimited |

All limits use a rolling 1-hour window. Self-hosted instances can override or disable limits via environment variables (set any to `0` to disable).

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:domain` | Full analysis (JSON) |
| `POST` | `/api/analyze` | Analysis (JSON or SSE via `Accept: text/event-stream`) |
| `POST` | `/api/compare` | Side-by-side domain comparison |
| `POST` | `/api/subdomains` | CT log subdomain discovery |
| `POST` | `/api/subdomain-scan` | Active subdomain enumeration |
| `POST` | `/api/availability` | Global HTTP availability check |
| `POST` | `/api/company` | Company enrichment + stock data |
| `POST` | `/api/news` | News aggregation |
| `POST` | `/api/social` | Social account discovery |
| `POST` | `/api/suggestions` | Related domain suggestions |
| `POST` | `/api/reverse-ip` | Reverse IP lookup |
| `POST` | `/api/ai-analysis` | AI deep analysis (Cross-Signal Insights) |
| `GET` | `/api/health` | Service health |
| `GET` | `/api/scoring` | Scoring methodology + signal registry |
| `GET` | `/api/docs` | API documentation (JSON) |

---

## CLI

Yoke includes a fast Go-based CLI for terminal domain analysis.

### Install

**Homebrew (macOS/Linux):**
```bash
brew install yokedotlol/tap/yoke
```

**Shell script:**
```bash
curl -sSL https://yoke.lol/install.sh | bash
```

**From source:**
```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke/cli && go build -o yoke .
```

### Usage

```bash
# Analyze a domain
yoke stripe.com
yoke stripe.com --json | jq .ssl
yoke score stripe.com
yoke compare github.com gitlab.com

# AI-powered analysis
yoke ai stripe.com

# Configure (for self-hosting)
yoke config --set-base-url https://your-instance.com
export YOKE_BASE_URL=https://your-instance.com  # ephemeral override

# Commands
yoke <domain>                    # Full analysis card
yoke <domain> --json             # Raw JSON output
yoke score <domain>              # Quick score (e.g., "92/100 A")
yoke compare <d1> <d2>           # Side-by-side comparison
yoke ai <domain>                 # AI-powered analysis
yoke config                      # Show current config
yoke config --set-base-url <url> # Set custom API endpoint
yoke --version                   # Print version info
```

The CLI uses the same API as the web app and supports custom endpoints via config file (`~/.yoke.toml`) or `YOKE_BASE_URL` env var.

The CLI auto-checks for required updates — if the server's `X-Yoke-Min-Client` header indicates your CLI version is too old, you'll see a warning with the upgrade command.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    yoke.lol                        │
│                                                    │
│  ┌─────────────┐       ┌──────────────────────┐   │
│  │ React SPA   │──────▶│  Cloudflare Worker    │   │
│  │ (Tailwind,  │       │  (zero-dep router)    │   │
│  │  React Query│       │                       │   │
│  │  Leaflet)   │       │  ┌───────┐ ┌───────┐  │   │
│  └─────────────┘       │  │  D1   │ │  KV   │  │   │
│                         │  │(stats)│ │(cache)│  │   │
│  ┌─────────────┐       │  └───────┘ └───────┘  │   │
│  │Chrome Ext.  │─ iframe ──────┘       │            │
│  └─────────────┘                       │            │
└────────────────────────────────┼───────┼────────────┘
                                 │       │
            ┌────────────────────┘       │
            │                    ┌───────┴──────────┐
            │                    │  Fly.io Proxy     │
            │                    │  (Go — probes,    │
            │                    │   GeoIP, relay)   │
            │                    └──────────────────┘
            │
            └───── 20+ external APIs (DNS, RDAP, SSL Labs,
                   HIBP, Shodan, PageSpeed, Wikidata, etc.)
```

| Layer | Tech | Details |
|-------|------|---------|
| **Frontend** | React 19, Tailwind v4, React Query, Leaflet | 21 lazy chunks, ~213KB initial JS |
| **Backend** | Cloudflare Worker (TypeScript) | Zero dependencies, ~214KB bundled |
| **Database** | Cloudflare D1 + KV | D1 for stats/analytics; KV for cache + rate limiting + reference data |
| **Proxy** | Go on Fly.io | HTTP probes, MaxMind GeoIP, check-host.net relay |
| **Extension** | Chrome Manifest V3 | Side panel, zero dependencies |
| **Build** | Bun + Vite | Node.js 22+ for Wrangler deploy |

### Check Registry

Analysis checks use a registry pattern — each check is a self-contained file under `worker/src/checks/` that exports a standard interface. The orchestrator iterates the registry, runs checks in parallel, and handles errors uniformly. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add new checks.

---

## Self-Hosting

Yoke is designed to be self-hosted on Cloudflare's free/paid tiers. You'll need a **Workers Paid plan** ($5/mo).

> **Why not the free tier?** The free plan caps CPU time at 10ms per request. A single domain analysis runs ~30 external API calls, parses HTML, scores 155 signals, and writes results to KV/D1 — that needs hundreds of milliseconds of CPU time minimum. The free tier also limits subrequests to 50/request (compare mode alone exceeds that) and KV writes to 1,000/day (a few hundred analyses would exhaust it). The $5/mo paid plan removes all three constraints.

### Prerequisites

- [Bun](https://bun.sh/) — client + worker builds
- [Node.js 22+](https://nodejs.org/) — Wrangler CLI requires it
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — `npm install -g wrangler`
- [Cloudflare account](https://dash.cloudflare.com/) — Workers Paid plan ($5/mo)
- A domain on Cloudflare (for custom domain routing)

Optional (only for Fly proxy):
- [Go 1.22+](https://go.dev/) — building from source
- [Fly CLI](https://fly.io/docs/flyctl/install/) — `curl -L https://fly.io/install.sh | sh`

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke

# Client (React SPA)
cd client && bun install && cd ..

# Worker (Cloudflare Worker)
cd worker && bun install && cd ..

# OG Worker (share card image renderer) — uses npm, not bun
cd og-worker && npm install && cd ..

# Enable pre-commit hooks (recommended)
git config core.hooksPath .githooks
```

### Step 2: Create Cloudflare resources

```bash
# Authenticate with Cloudflare
npx wrangler login

# Create D1 database (stores historical scores + analytics)
npx wrangler d1 create yoke-stats
# → Save the database_id from the output

# Create KV namespace (analysis cache + rate limiting + reference data)
npx wrangler kv namespace create REFERENCE_DATA
# → Save the id from the output
```

### Step 3: Configure wrangler.toml files

**OG Worker** (deploy this first — the main worker depends on it via service binding):

```bash
cp og-worker/wrangler.toml.example og-worker/wrangler.toml
```

Edit `og-worker/wrangler.toml`:
```toml
name = "yoke-og"
main = "dist/worker.js"
compatibility_date = "2024-12-01"
account_id = "your-cloudflare-account-id"   # ← Find at dash.cloudflare.com → any zone → Overview sidebar
```

**Main Worker:**

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
```

Edit `worker/wrangler.toml`:
```toml
name = "yoke"
main = "dist/worker.js"
compatibility_date = "2024-12-01"
account_id = "your-cloudflare-account-id"

[vars]
BASE_URL = "https://yourdomain.com"

[assets]
directory = "../client/dist"
binding = "ASSETS"

# D1 — historical scores + analytics
[[d1_databases]]
binding = "STATS_DB"
database_name = "yoke-stats"
database_id = "paste-database-id-from-step-2"

# KV — analysis cache + rate limiting + reference data
[[kv_namespaces]]
binding = "REFERENCE_DATA"
id = "paste-kv-namespace-id-from-step-2"

# Custom domain routing
[[routes]]
pattern = "yourdomain.com/*"
zone_name = "yourdomain.com"

# OG image rendering (service binding to the OG worker you deployed above)
[[services]]
binding = "OG_WORKER"
service = "yoke-og"
```

> Both `worker/wrangler.toml` and `og-worker/wrangler.toml` are gitignored — `git pull` will never overwrite your config.

### Step 4: Run migrations

```bash
# Only yoke-stats needs migrations (cache is KV-based, no schema needed)
npx wrangler d1 execute yoke-stats --file=worker/migrations/0002_domain_scores.sql
```

> **Note:** `0001_init.sql` is deprecated — it created tables for the old D1 cache layer that was replaced by KV. Skip it.

### Step 5: Set secrets

Wrangler secrets are encrypted and injected at runtime. Each command prompts for the value interactively.

**Required:**

```bash
# HMAC key for signed share card URLs. Generate one:
#   openssl rand -hex 32
# Share cards will error without this.
npx wrangler secret put SHARE_SECRET

# Admin key — protects /usage dashboard, /api/cleanup, /api/cache endpoints.
# Generate one: openssl rand -hex 32
npx wrangler secret put ADMIN_KEY
```

**Recommended:**

```bash
# Your instance URL — required for self-analysis and share card URLs.
# Example: https://yoke-test.lol
# Can also be set as [vars] BASE_URL in wrangler.toml instead.
npx wrangler secret put BASE_URL

# Enables AI Analysis (Cross-Signal Insights).
# Get a key at: https://openrouter.ai/keys
# Uses DeepSeek V3 by default (~$0.27/$1.10 per 1M tokens).
npx wrangler secret put OPENROUTER_API_KEY

# Lighthouse scores + Core Web Vitals.
# Free: 25,000 requests/day.
# 1. Go to: https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com
# 2. Enable the "PageSpeed Insights API"
# 3. Go to: https://console.cloud.google.com/apis/credentials
# 4. Create Credentials → API Key
npx wrangler secret put GOOGLE_PAGESPEED_API_KEY

# WHOIS fallback for ccTLDs that don't support RDAP.
# Free: 100 requests/month.
# Sign up at: https://whoisfreaks.com/
npx wrangler secret put WHOISFREAKS_API_KEY
```

**Optional (only if using Fly proxy):**

```bash
# Shared secret between Worker and Fly proxy for authenticated relay requests.
# Must match on both sides. Generate: openssl rand -hex 32
npx wrangler secret put FLY_AUTH_SECRET
```

### Step 6: Build and deploy

Deploy order matters — OG worker first, then main worker (the main worker has a service binding to the OG worker).

```bash
# Option A: Deploy everything with the deploy script
bash deploy.sh --cf

# Option B: Manual deployment
cd og-worker && bun run build && npx wrangler deploy && cd ..
cd worker && bun run build && npx wrangler deploy && cd ..
```

Visit `https://yourdomain.com` — you should see the Yoke UI. Try analyzing a domain.

### Step 7 (Optional): Fly.io Proxy

The Go proxy provides:
- **HTTP probes from non-Cloudflare IPs** — some sites block Cloudflare's IP ranges, making direct availability checks fail
- **MaxMind GeoIP enrichment** — city/country/ISP/ASN data for target IPs
- **check-host.net relay** — global availability checks from 10+ locations

**Without the proxy**, everything still works — sites that block CF IPs show as `RESTRICTED` instead of `UP`, and GeoIP falls back to [ipwho.is](https://ipwho.is) (HTTPS). DNS, SSL, scoring, and all other checks are unaffected.

**Setup:**

```bash
cd fly-proxy

# Authenticate with Fly
fly auth login

# Launch a new Fly app (first time only)
fly launch --no-deploy
# → This creates fly.toml. Edit the app name if desired.

# Set the shared auth secret (must match WORKER's FLY_AUTH_SECRET)
fly secrets set FLY_AUTH_SECRET=your-shared-secret

# Deploy
fly deploy

# (Optional) MaxMind GeoIP — free license at https://www.maxmind.com/en/geolite2/signup
# 1. Create an account → Generate a License Key
# 2. Deploy with the key as a build arg:
MAXMIND_LICENSE_KEY=your_key fly deploy

cd ..
```

Then set `FLY_PROBE_URL` in your main worker so it knows where to reach the proxy:

```bash
# In worker/wrangler.toml under [vars]:
# FLY_PROBE_URL = "https://your-fly-app.fly.dev"
```

### Environment Variables

All set via `npx wrangler secret put <NAME>` or as `[vars]` in `wrangler.toml` (non-sensitive values only).

| Variable | Required | Description |
|----------|----------|-------------|
| `SHARE_SECRET` | **Yes** | HMAC-SHA256 key for signed share card URLs. Generate: `openssl rand -hex 32` |
| `ADMIN_KEY` | **Yes** | Protects `/usage`, `/api/cleanup`, `/api/cache`. Generate: `openssl rand -hex 32` |
| `BASE_URL` | Recommended | Instance URL (e.g., `https://yoke-test.lol`). Enables self-analysis + share cards |
| `OPENROUTER_API_KEY` | Recommended | Enables AI Analysis. [Get key →](https://openrouter.ai/keys) |
| `GOOGLE_PAGESPEED_API_KEY` | Recommended | Lighthouse scores. [Enable API →](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com) |
| `WHOISFREAKS_API_KEY` | Optional | WHOIS fallback for ccTLDs. [100 free/mo →](https://whoisfreaks.com/) |
| `FLY_PROBE_URL` | Optional | Fly proxy URL (e.g., `https://yoke-probe.fly.dev`) |
| `FLY_AUTH_SECRET` | Optional | Shared secret for Worker↔Fly proxy auth |
| `RATE_LIMIT_ANALYZE` | Optional | Max analyze requests/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_COMPARE` | Optional | Max compare requests/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_SUBDOMAIN` | Optional | Max subdomain-scan requests/hr per IP (default: 30, 0 = disable) |
| `RATE_LIMIT_AVAILABILITY` | Optional | Max availability requests/hr per IP (default: 60, 0 = disable) |
| `CACHE_TTL_HOURS` | Optional | Analysis cache TTL in hours (default: 1, 0 = disable) |

### Updating

```bash
git pull
bash deploy.sh --cf    # or --all to include Fly proxy
```

---

## Maintenance

### Admin Endpoints

Three endpoints are protected by `ADMIN_KEY`. Auth uses HTTP Basic — any username, password is your key:

```bash
# Usage dashboard (also available at /usage in the browser)
curl -u admin:YOUR_KEY https://your-instance.com/usage

# D1 cleanup — old stats, expired rate limits (cache cleanup is automatic via KV TTL)
curl -u admin:YOUR_KEY https://your-instance.com/api/cleanup

# Purge cached analysis for a specific domain
curl -u admin:YOUR_KEY -X DELETE https://your-instance.com/api/cache/example.com

# Purge all AI analysis cache
curl -u admin:YOUR_KEY -X DELETE "https://your-instance.com/api/cache?type=ai_analysis"
```

Run `/api/cleanup` periodically (daily or weekly) to keep D1 stats lean. Cache cleanup is automatic via KV TTL expiry.

### Rate Limit Bypass

For batch analysis, internal tooling, or CI pipelines, pass `X-Admin-Key` to skip per-IP rate limits on `/api/analyze`:

```bash
curl -X POST https://your-instance.com/api/analyze \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_KEY" \
  -d '{"domain": "example.com"}'
```

Uses the same `ADMIN_KEY` secret. All other endpoints (compare, subdomain-scan, AI, etc.) remain rate-limited as normal.

### Worker-to-Fly Proxy Auth

```bash
# Generate a shared secret
openssl rand -hex 32

# Set on both sides — must match
npx wrangler secret put FLY_AUTH_SECRET
fly secrets set FLY_AUTH_SECRET=your-shared-secret -a your-fly-app
```

### Share Card URLs

Share cards generate signed URLs for social sharing with OG image previews. The payload (domain, score, grade, axis scores) is base64url-encoded and signed with HMAC-SHA256 using `SHARE_SECRET`.

URL patterns:
- `/r/{payload}.{sig}` — Report card HTML page (human-viewable)
- `/og/{payload}.{sig}.png` — Dynamic OG image (PNG, 1200×630, rendered via resvg-wasm)

---

## Chrome Extension

Install from the **[Chrome Web Store](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)** — click the Yoke icon on any site to open a side panel with full analysis.

**Load from source** (development):
1. `chrome://extensions/` → Enable "Developer mode"
2. "Load unpacked" → select the `extension/` directory
3. Click the Yoke icon on any site

---

## Contributing

Contributions welcome! The easiest way to contribute is adding a new analysis check — one file, standard interface, instant impact. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide.

```bash
# Quick start
cd client && bun install && cd ..
cd worker && bun install && cd ..
bun test
```

### AI Contributors

If you're an AI agent working on this codebase, start with **[CLAUDE.md](CLAUDE.md)** for technical context. The **[.ai/](.ai/)** directory contains structured project context:

- **[.ai/CONSTITUTION.md](.ai/CONSTITUTION.md)** — Architecture, scoring philosophy, red lines
- **[.ai/INVARIANTS.md](.ai/INVARIANTS.md)** — Things that must always be true
- **[.ai/DECISIONS.md](.ai/DECISIONS.md)** — Why things are the way they are
- **[.ai/STATE.md](.ai/STATE.md)** — Current project snapshot (versions, counts)
- **[.ai/GOTCHAS.md](.ai/GOTCHAS.md)** — Lessons learned, common mistakes

Run `bash .ai/staleness-check.sh` to verify docs match the codebase.

---

## Versioning

Yoke uses **independent versioning** across its components:

| Component | Version | Tag format | Release mechanism |
|-----------|---------|------------|-------------------|
| **Service** (Worker + Client) | `YOKE_VERSION` in `helpers.ts` | Bumps with each deploy | `wrangler deploy` |
| **CLI** | Set by GoReleaser at build time | `cli/v*` (e.g. `cli/v1.5.0`) | GoReleaser via GitHub Actions |
| **MCP Server** | `mcp-server/package.json` | `mcp/v*` (e.g. `mcp/v1.0.1`) | npm publish via GitHub Actions |
| **Extension** | `manifest.json` version | `ext/v*` | Chrome Web Store via GitHub Actions |

Components share the same major version for API compatibility. The service returns `X-Yoke-Version` and `X-Yoke-Min-Client` headers on every API response — the CLI checks these to warn when an update is needed.

---

## Support

If Yoke saves you time, consider ⭐ [starring the repo](https://github.com/yokedotlol/yoke). GitHub Sponsors coming soon.

## License

[MIT](LICENSE)
