<div align="center">

# 🔗 Yoke

**Free, open-source domain intelligence — DNS, WHOIS, SSL, security, tech stack, performance, breaches, AI analysis, and more. Web, API, CLI, and Chrome extension.**

[![CI](https://github.com/yokedotlol/yoke/actions/workflows/ci.yml/badge.svg)](https://github.com/yokedotlol/yoke/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-2.3.0-blue)](https://github.com/yokedotlol/yoke/blob/main/docs/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/fghkhjlelidaepapcdfjifnlcjmkgpcj?label=Chrome%20Extension)](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)
[![Yoke](https://yoke.lol/badge/yoke.lol.svg)](https://yoke.lol/yoke.lol)

**[Try it → yoke.lol](https://yoke.lol)** · **[API Docs](https://yoke.lol/api/docs)** · **[CLI](#cli)** · **[Chrome Extension](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)** · **[Status](https://yoke.lol/status)**

</div>

---

## What is Yoke?

Yoke pulls 157 scoring signals for any domain and presents them in a clean tabbed interface with a contextual scoring system. Think `dig` + `whois` + `nmap` + `curl` + BuiltWith + SecurityTrails — in one tool, no account required.

```bash
curl -s https://yoke.lol/stripe.com | jq
```

## Scoring

6-axis contextual scoring: **Security** (0.24), **Speed** (0.18), **Foundations** (0.18), **Reputation** (0.15), **Discoverability** (0.13), **Email** (0.12).

Each axis starts at 100 and takes deductions per signal severity — budget-based deductive scoring, not additive. Tiers: **Excellent** ≥90, **Strong** ≥78, **Moderate** ≥60, **Weak** ≥40, **Critical** <40. An outlier floor cap prevents strong axes from masking a single weak one.

Sites are auto-classified into 7 archetypes (commerce, content, application, corporate, infrastructure, institutional, general) to adjust finding severity contextually. [Compare domains side-by-side →](https://yoke.lol/compare/github.com/gitlab.com)

## What It Checks

| Area | Highlights |
|------|-----------|
| **DNS** | A/AAAA/MX/NS/TXT/CNAME/CAA/SOA, TTLs, provider detection |
| **WHOIS / RDAP** | 4-tier resolution (RDAP → IANA → WhoisFreaks → raw), registrar, dates, age |
| **SSL/TLS** | Grade, issuer, protocols, key exchange, OCSP, CT logs, SSL Labs deep link |
| **Security Headers** | CSP, HSTS, X-Frame-Options, Permissions-Policy, Referrer-Policy, cookie audit |
| **Email Auth** | SPF, DKIM, DMARC, BIMI, MTA-STS, TLS-RPT |
| **Performance** | Lighthouse (mobile-first 60/40 blend), Core Web Vitals, CrUX, cache analysis |
| **Tech Stack** | 256 fingerprints — CMS, frameworks, CDNs, analytics, 25+ cookie consent platforms |
| **WordPress** | Version, theme, 100+ plugins, page builder, hosting |
| **Breaches** | HIBP lookup with time-decay severity weighting |
| **Subdomains** | 130 curated prefixes + CT log discovery via CertSpotter |
| **Accessibility** | 9 WCAG quick checks (labels, alt text, contrast, headings, landmarks) |
| **Network** | Global availability, TCP timing, BGP routing, WAF detection (29 providers) |
| **Company** | Wikidata + Brandfetch + Crunchbase enrichment, stock ticker |
| **AI Analysis** | Score Waterfall (deterministic) + Cross-Signal Insights (LLM, DeepSeek V3) |

Full signal registry: `GET https://yoke.lol/api/scoring`

## API

No auth required. Content-negotiated — JSON for programmatic clients, HTML for browsers.

```bash
curl -s https://yoke.lol/stripe.com | jq              # Full analysis
curl -s https://yoke.lol/stripe.com | jq '.ssl'       # Specific section
curl -s https://yoke.lol/stripe.com | jq '.domain_score'  # Scoring breakdown
```

Rate limits: 50 analyses/hr per IP (cached results don't count). [Full API docs →](https://yoke.lol/api/docs)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/:domain` | Full analysis (JSON) |
| `POST` | `/api/analyze` | Analysis (JSON or SSE via `Accept: text/event-stream`) |
| `POST` | `/api/compare` | Side-by-side domain comparison |
| `POST` | `/api/subdomains` | CT log subdomain discovery |
| `POST` | `/api/subdomain-scan` | Active subdomain enumeration |
| `POST` | `/api/ai-analysis` | AI deep analysis (Cross-Signal Insights) |
| `GET` | `/api/scoring` | Scoring methodology + full signal registry |
| `GET` | `/api/health` | Service health |
| `GET` | `/api/docs` | API documentation (JSON) |

Additional endpoints: `/api/company`, `/api/news`, `/api/social`, `/api/suggestions`, `/api/reverse-ip`, `/api/availability`. See [API docs](https://yoke.lol/api/docs) for details.

## CLI

Fast Go-based CLI for terminal domain analysis.

```bash
# Install
brew install yokedotlol/tap/yoke         # Homebrew
curl -sSL https://yoke.lol/install.sh | bash  # Shell script

# Use
yoke stripe.com                   # Full analysis card
yoke stripe.com --json | jq       # Raw JSON
yoke score stripe.com             # Quick score
yoke compare github.com gitlab.com  # Side-by-side
yoke ai stripe.com                # AI analysis

# Point at your own instance
yoke config --set-base-url https://your-instance.com
```

The CLI auto-checks for updates via `X-Yoke-Min-Client` header.

## Chrome Extension

**[Install from Web Store →](https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj)**

Click the Yoke icon on any site to open a side panel with full analysis. To load from source: `chrome://extensions/` → Developer mode → Load unpacked → select `extension/`.

## MCP Server

For AI coding agents. 3 tools: `yoke_analyze`, `yoke_score_summary`, `yoke_compare`.

```bash
npm install -g @yokedotlol/mcp-server
```

See [mcp/README.md](mcp/README.md) for configuration.

## Badges

Embed a live domain score badge in your README, docs, or website. Badges are auto-refreshed — scores stay within 24 hours of the latest analysis.

**Direct SVG** (standalone, no external dependencies):
```markdown
![Yoke Score](https://yoke.lol/badge/stripe.com.svg)
```

**Shields.io endpoint** (use shields.io's rendering):
```markdown
![Yoke](https://img.shields.io/endpoint?url=https://yoke.lol/badge/stripe.com.json)
```

**Options:**
| Parameter | Example | Description |
|-----------|---------|-------------|
| `axis` | `?axis=security` | Show a specific axis score |
| `label` | `?label=My+Site` | Override badge label |
| `style` | `?style=flat-square` | Sharp corners |

Self-hosters: badges work out of the box. See [Self-Hosting docs](docs/SELF-HOSTING.md) for pre-warm cron setup.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   yoke.lol                       │
│                                                  │
│  ┌───────────┐       ┌────────────────────────┐ │
│  │ React SPA │──────▶│  Cloudflare Worker     │ │
│  │ (Tailwind,│       │  (zero-dep router)     │ │
│  │  RQ,      │       │                        │ │
│  │  Leaflet) │       │  ┌──────┐  ┌────────┐  │ │
│  └───────────┘       │  │  D1  │  │   KV   │  │ │
│                      │  │stats │  │ cache  │  │ │
│  ┌───────────┐       │  └──────┘  └────────┘  │ │
│  │Chrome Ext.│─iframe─┘                        │ │
│  └───────────┘                                 │ │
└──────────────────────────┼─────────────────────┘
                           │
          ┌────────────────┘
          │           ┌─────────────────────┐
          │           │  Fly.io Proxy (Go)  │
          │           │  HTTP probes, GeoIP │
          │           └─────────────────────┘
          │
          └── 20+ external APIs (DNS, RDAP, SSL Labs,
              HIBP, Shodan, PageSpeed, Wikidata, etc.)
```

| Layer | Tech | Size |
|-------|------|------|
| Frontend | React 19, Tailwind v4, React Query, Leaflet | ~213KB initial JS |
| Backend | Cloudflare Worker (TypeScript, zero deps) | ~214KB bundled |
| Database | Cloudflare D1 (stats) + KV (cache, rate limits) | — |
| Proxy | Go on Fly.io (HTTP probes, MaxMind GeoIP) | — |
| Build | Bun + Vite, Node.js 22+ for Wrangler | — |

## Self-Hosting

Yoke is designed to be self-hosted. Three deployment options:

| Option | Best For | Cost |
|--------|----------|------|
| **Cloudflare Workers** | Managed hosting, global edge | ~$5–11/mo |
| **Docker Compose** | VPS self-hosting, one command | ~$5–18/mo |
| **Bare Metal** | Full control, no containers | ~$5–18/mo |

**[Full self-hosting guide →](docs/SELF-HOSTING.md)**

Quick start (Cloudflare Workers):

```bash
git clone https://github.com/yokedotlol/yoke.git && cd yoke
cd client && bun install && cd ..
cd worker && bun install && cd ..
npx wrangler d1 create yoke-stats
npx wrangler kv namespace create REFERENCE_DATA
cp worker/wrangler.toml.example worker/wrangler.toml   # edit with your IDs
bash deploy.sh --cf
```

Quick start (Docker Compose):

```bash
git clone https://github.com/yokedotlol/yoke.git && cd yoke
cp .env.example .env   # edit with your domain + secrets
docker compose up -d --build
```

## Contributing

Contributions welcome — the easiest entry point is adding a new analysis check (one file, standard interface). See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

### AI Contributors

Start with **[CLAUDE.md](CLAUDE.md)** for technical context. The **[.ai/](.ai/)** directory has structured project context (architecture, invariants, decisions, gotchas). Run `bash .ai/staleness-check.sh` to verify docs match the codebase.

The **[.ai/reviews/](.ai/reviews/)** directory contains a 20-panel expert review system you can run with any AI agent harness — see [.ai/reviews/README.md](.ai/reviews/README.md).

## License

[MIT](LICENSE) · [Third-Party Notices](docs/THIRD-PARTY-NOTICES.md) · [Data Sources](docs/DATA-SOURCES.md)
