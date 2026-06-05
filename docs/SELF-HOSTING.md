# Self-Hosting Yoke

Yoke can run on **Cloudflare Workers** (managed) or on your own **bare-metal / VPS** using workerd behind a reverse proxy. This guide covers both paths.

---

## Table of Contents

- [Option A: Cloudflare Workers (Managed)](#option-a-cloudflare-workers-managed)
- [Option B: Bare-Metal / VPS (workerd + Caddy)](#option-b-bare-metal--vps-workerd--caddy)
- [Security Hardening (Bare-Metal)](#security-hardening-bare-metal)
- [Default Security Posture](#default-security-posture)
- [Scoring on Self-Hosted Instances](#scoring-on-self-hosted-instances)
- [Fly.io Probe Proxy (Optional)](#flyio-probe-proxy-optional)
- [Environment Variables](#environment-variables)
- [Admin Endpoints](#admin-endpoints)
- [Seeding Initial Data](#seeding-initial-data)
- [Updating](#updating)
- [Share Cards](#share-cards)

---

## Option A: Cloudflare Workers (Managed)

The simplest path. Cloudflare handles TLS, DDoS protection, edge caching, and global distribution.

### Running Costs

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Cloudflare Workers Paid | ~$5 | 10M requests, 1M KV reads, 25M D1 rows |
| Fly.io proxy (optional) | ~$6 | HTTP probes + MaxMind GeoIP |
| All external APIs | $0 | PageSpeed, WHOIS, Shodan, etc. — free tiers |
| **Total** | **~$5–11/mo** | |

> **Why not the free tier?** The free plan caps CPU time at 10ms/request. A single analysis runs ~30 external API calls, scores 156 signals, and writes results to KV/D1 — needs hundreds of ms minimum. The free tier also limits subrequests (50/request) and KV writes (1,000/day).

### Prerequisites

- [Bun](https://bun.sh/) — client + worker builds
- [Node.js 22+](https://nodejs.org/) — Wrangler CLI
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — `npm install -g wrangler`
- [Cloudflare account](https://dash.cloudflare.com/) — Workers Paid plan ($5/mo)
- A domain on Cloudflare (for custom domain routing)

### Step 1: Clone and Install

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke

cd client && bun install && cd ..
cd worker && bun install && cd ..

# Enable pre-commit hooks (recommended)
git config core.hooksPath .githooks
```

### Step 2: Create Cloudflare Resources

```bash
npx wrangler login

# D1 database (historical scores + analytics)
npx wrangler d1 create yoke-stats
# → Save the database_id

# KV namespace (analysis cache + rate limiting + reference data)
npx wrangler kv namespace create REFERENCE_DATA
# → Save the id
```

### Cloudflare Bot Fight Mode

**Disable Bot Fight Mode** (Security → Bots → Bot Fight Mode → Off).

Yoke is an API-first product — the CLI, MCP server, Chrome extension, and CI smoke tests all make automated requests. Bot Fight Mode challenges anything that isn't a browser, returning 403 JS challenge pages that automated clients can't solve. This breaks the JSON API, CI pipelines (GitHub Actions runners use Azure IPs, which BFM flags), and any headless consumer of your instance.

Your instance is already protected by per-IP rate limiting and SSRF guards — BFM adds nothing useful here.

### Step 3: Configure

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

[[d1_databases]]
binding = "STATS_DB"
database_name = "yoke-stats"
database_id = "paste-database-id-from-step-2"

[[kv_namespaces]]
binding = "REFERENCE_DATA"
id = "paste-kv-namespace-id-from-step-2"

[[routes]]
pattern = "yourdomain.com/*"
zone_name = "yourdomain.com"
```

The wrangler.toml file is gitignored.

### Step 4: Migrations

```bash
npx wrangler d1 execute yoke-stats --file=worker/migrations/0002_domain_scores.sql
```

> `0001_init.sql` is deprecated (old D1 cache layer, replaced by KV). Skip it.

### Step 5: Secrets

**Required:**

```bash
# HMAC key for signed share card URLs (openssl rand -hex 32)
npx wrangler secret put SHARE_SECRET

# Admin key — protects /usage, /api/cleanup, /api/cache (openssl rand -hex 32)
npx wrangler secret put ADMIN_KEY

# Secret salt for GDPR-safe IP hashing (openssl rand -hex 32)
npx wrangler secret put IP_HASH_SALT
```

**Recommended:**

```bash
# AI Analysis — get a key at https://openrouter.ai/keys
npx wrangler secret put OPENROUTER_API_KEY

# Lighthouse + Core Web Vitals — free, 25K req/day
# Enable at: https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com
npx wrangler secret put GOOGLE_PAGESPEED_API_KEY

# WHOIS fallback for ccTLDs — free, 100 req/month — https://whoisfreaks.com/
npx wrangler secret put WHOISFREAKS_API_KEY
```

### Step 6: Build and Deploy

Deploy order matters — build the client first, then deploy the worker.

```bash
# Everything at once
bash deploy.sh --cf

# Or manually
cd client && bun run build.ts && cd ..
cd worker && bun run build && npx wrangler deploy && cd ..
```

Visit `https://yourdomain.com` — try analyzing a domain.

---

## Option B: Bare-Metal / VPS (workerd + Caddy)

Run Yoke on your own server using [workerd](https://github.com/cloudflare/workerd) (the open-source Cloudflare Workers runtime) behind [Caddy](https://caddyserver.com/) as a reverse proxy with automatic TLS.

### Architecture

```
Internet → Caddy (TLS + WAF + rate limiting) → workerd (:8787) → Yoke worker
```

Caddy handles:
- **TLS termination** — automatic Let's Encrypt / ZeroSSL certificates
- **WAF** — OWASP CRS via Coraza plugin (optional but recommended)
- **Reverse proxy** — forwards to workerd on localhost
- **Access logging** — structured JSON logs for CrowdSec / fail2ban

workerd handles:
- The Yoke Worker runtime (same code as Cloudflare)
- KV and D1 bindings (local SQLite-backed)

### Running Costs

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| VPS (Linode/Hetzner/DigitalOcean) | ~$5–12 | 1GB+ RAM, 1 vCPU minimum |
| Fly.io proxy (optional) | ~$6 | HTTP probes from non-server IPs |
| Domain + DNS | ~$10/yr | Any registrar |
| All external APIs | $0 | Free tiers |
| **Total** | **~$5–18/mo** | |

### Prerequisites

- A VPS with Ubuntu 22.04+ / Debian 12+
- A domain pointing to your server's IP (A/AAAA records)
- [Bun](https://bun.sh/) — builds
- [Caddy](https://caddyserver.com/docs/install) — reverse proxy + TLS
- [workerd](https://github.com/cloudflare/workerd) — Workers runtime

### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install workerd
# See https://github.com/cloudflare/workerd/releases for latest
# Or build from source with Bazel
```

### Step 2: Clone and Build

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke

cd client && bun install && bun run build.ts && cd ..
cd worker && bun install && bun run build && cd ..
```

### Step 3: Configure workerd

Create a workerd config (e.g., `/etc/yoke/config.capnp` or `workerd.capnp` in your project):

```capnp
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "yoke", worker = .yokeWorker),
  ],
  sockets = [
    (name = "http", address = "127.0.0.1:8787", http = (), service = "yoke"),
  ],
);

const yokeWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "dist/worker.js"),
  ],
  compatibilityDate = "2024-12-01",
  bindings = [
    (name = "BASE_URL", text = "https://yourdomain.com"),
    (name = "SHARE_SECRET", text = "your-hmac-secret"),
    (name = "ADMIN_KEY", text = "your-admin-key"),
    (name = "IP_HASH_SALT", text = "your-ip-hash-salt"),
    (name = "SELF_DOMAINS", text = "yourdomain.com,www.yourdomain.com"),
    # Add API keys as needed:
    # (name = "OPENROUTER_API_KEY", text = "..."),
    # (name = "GOOGLE_PAGESPEED_API_KEY", text = "..."),
  ],
  # KV and D1 bindings vary by workerd version — check workerd docs for local SQLite-backed KV/D1
);
```

> **Note:** workerd's local KV and D1 support is evolving. Check the [workerd releases](https://github.com/cloudflare/workerd/releases) for the latest binding syntax. The Worker code is identical — only the binding configuration differs from Cloudflare's managed platform.

Bind to **127.0.0.1 only** — Caddy handles all external traffic.

### Step 4: Configure Caddy

Install Caddy with the Coraza WAF plugin (see [Security Hardening](#security-hardening-bare-metal) below for details):

Basic `/etc/caddy/Caddyfile`:

```caddyfile
yourdomain.com {
    # Structured JSON logging for CrowdSec / fail2ban
    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }

    # Security headers (supplements what the Worker already sets)
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    reverse_proxy localhost:8787 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Step 5: systemd Services

**workerd service** (`/etc/systemd/system/yoke-workerd.service`):

```ini
[Unit]
Description=Yoke workerd
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/workerd serve /etc/yoke/config.capnp
Restart=on-failure
RestartSec=5
User=yoke
Group=yoke
WorkingDirectory=/opt/yoke
# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/yoke/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caddy
sudo systemctl enable --now yoke-workerd
```

### Step 6: Verify

```bash
# Check TLS + WAF
curl -I https://yourdomain.com

# Analyze a domain
curl -s https://yourdomain.com/stripe.com | jq '.composite'

# Check admin access
curl -u admin:YOUR_KEY https://yourdomain.com/usage
```

---

## Security Hardening (Bare-Metal)

On Cloudflare Workers, you get DDoS protection, edge TLS, and bot management for free. On bare metal, you're responsible for your own perimeter. Here's the recommended security stack:

### Layer 1: OS Hardening

```bash
# Firewall — only expose 80, 443, and SSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Disable root SSH, enforce key-only auth
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### Layer 2: WAF — Coraza + OWASP CRS (Recommended)

[Coraza](https://coraza.io/) is a Go-native WAF that integrates directly with Caddy as a plugin. It runs the OWASP Core Rule Set (CRS) — the same rules used by ModSecurity, but lighter and faster.

**What it protects against:**
- SQL injection (SQLi)
- Cross-site scripting (XSS)
- Local/remote file inclusion (LFI/RFI)
- Command injection
- Path traversal
- Scanner/bot fingerprinting

**Build Caddy with Coraza:**

```bash
# Install xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

# Build Caddy with Coraza WAF plugin
xcaddy build --with github.com/corazawaf/coraza-caddy/v2
sudo mv caddy /usr/bin/caddy
```

**Caddyfile with WAF:**

```caddyfile
{
    order coraza_waf first

    coraza_waf {
        load_owasp_crs
        directives `
            Include @coraza.conf-recommended
            Include @crs-setup.conf.example
            Include @owasp_crs/*.conf
            SecRuleEngine On

            # Yoke-specific tuning: allow long JSON bodies for /api/analyze
            SecRequestBodyLimit 131072
            SecRequestBodyNoFilesLimit 131072

            # Lower paranoia level to reduce false positives on API traffic
            # CRS default is 1; increase to 2 if you see attacks getting through
            SecAction "id:900000, phase:1, pass, t:none, nolog, setvar:tx.blocking_paranoia_level=1"
        `
    }

    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }
}

yourdomain.com {
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    route {
        coraza_waf
        reverse_proxy localhost:8787 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }
}
```

### Layer 3: Behavioral Detection — CrowdSec (Recommended)

[CrowdSec](https://crowdsec.net/) is a modern fail2ban replacement with crowd-sourced threat intelligence. It parses Caddy's JSON access logs, detects attack patterns (brute force, scanning, credential stuffing), and blocks offending IPs via firewall rules.

**Why CrowdSec over fail2ban:**
- Crowd-sourced IP reputation — you benefit from the entire community's blocklist
- Native Caddy log parser
- nftables/iptables integration (blocks at kernel level, before Caddy even sees the request)
- Dashboard and metrics built in

```bash
# Install CrowdSec
curl -s https://install.crowdsec.net | sudo sh
sudo apt install -y crowdsec crowdsec-firewall-bouncer-nftables

# Install Caddy log parser + HTTP scenarios
sudo cscli collections install crowdsecurity/caddy-logs
sudo cscli collections install crowdsecurity/http-cve
sudo cscli collections install crowdsecurity/base-http-scenarios

# Point CrowdSec at Caddy logs
cat <<'EOF' | sudo tee /etc/crowdsec/acquis.d/caddy.yaml
filenames:
  - /var/log/caddy/access.log
labels:
  type: caddy
EOF

sudo systemctl reload crowdsec
```

**Verify:**

```bash
# Check parsing is working
sudo cscli metrics show acquisition

# View active decisions (blocked IPs)
sudo cscli decisions list

# Test with a simulated attack
curl 'https://yourdomain.com/?q=../../etc/passwd'
# → Coraza blocks immediately (403)
# → CrowdSec bans the IP after repeated attempts
```

### Layer 4: Caddy Rate Limiting (Optional)

For Caddy-level rate limiting (in addition to Yoke's built-in per-IP D1 rate limits), you can use the [caddy-ratelimit](https://github.com/mholt/caddy-ratelimit) plugin:

```bash
xcaddy build \
  --with github.com/corazawaf/coraza-caddy/v2 \
  --with github.com/mholt/caddy-ratelimit
```

This adds network-level rate limiting before requests even reach workerd — useful for stopping volumetric abuse that Yoke's application-level limits aren't designed to handle.

### Security Stack Summary

| Layer | Tool | What It Does | Required? |
|-------|------|-------------|-----------|
| OS | ufw + ssh hardening | Firewall + access control | **Yes** |
| WAF | Coraza + OWASP CRS | Block injection / XSS / scanners | **Recommended** |
| Behavioral | CrowdSec | Ban repeat offenders, crowd intel | **Recommended** |
| TLS | Caddy (auto) | Let's Encrypt certificates | **Yes** |
| App | Yoke built-in | Per-IP rate limits, SSRF guards, CORS | **Built in** |

On Cloudflare Workers, Cloudflare's edge provides the first three layers for you. On bare metal, you set them up yourself.

---

## Default Security Posture

Every Yoke instance — managed or self-hosted — ships with these protections built into the Worker code:

### Built-In (No Configuration Required)

- **Per-IP rate limiting** — configurable per-endpoint limits stored in D1 (default: 50 analyses/hr, 50 compares/hr, 30 subdomain scans/hr, 60 availability checks/hr). Set to `0` to disable.
- **SSRF protection** — all outbound fetches are checked against private/reserved IP ranges (RFC1918, loopback, link-local, carrier-grade NAT). Redirect chains are followed manually with SSRF checks at each hop.
- **CORS policy** — `Access-Control-Allow-Origin: *` for GET/POST/OPTIONS (public API by design). DELETE is intentionally excluded from CORS methods. Admin endpoints require Basic auth.
- **Content-Security-Policy** — `frame-ancestors 'self'` prevents clickjacking (allows Chrome extension iframes).
- **X-Content-Type-Options: nosniff** — on all responses.
- **HMAC-SHA256 signed share URLs** — share cards can't be forged.
- **Admin auth** — `/usage`, `/api/cleanup`, `/api/cache` are all behind HTTP Basic auth with `ADMIN_KEY`.
- **Timing-safe comparison** — admin key checks use constant-time comparison to prevent timing attacks.
- **Cache-aware rate limiting** — cached results don't count against per-IP limits.

### Added by Caddy (Bare-Metal Only)

These headers are set at the Caddy layer for bare-metal deployments. On Cloudflare Workers, equivalent protections come from Cloudflare's edge:

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS, prevent downgrade |
| `X-Frame-Options` | `DENY` | Prevent framing (belt + suspenders with CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable unused browser APIs |
| `Server` | *(removed)* | Don't advertise server software |

### What Self-Hosters Don't Get (vs. Cloudflare)

| Feature | Cloudflare | Bare Metal | Mitigation |
|---------|-----------|------------|------------|
| DDoS protection | ✅ Edge-level | ❌ | CrowdSec + ufw + VPS provider DDoS (most include basic) |
| Global CDN | ✅ 300+ PoPs | ❌ Single origin | Acceptable for single-operator use |
| Managed TLS | ✅ Automatic | ✅ Caddy auto-HTTPS | Equivalent |
| Bot management | ✅ (disabled for Yoke) | ❌ | Coraza scanner detection rules |
| Edge caching | ✅ | ❌ | Yoke's KV cache handles this at the app layer |
| WAF | ✅ CF WAF | ✅ Coraza | Equivalent (same OWASP CRS) |

---

## Scoring on Self-Hosted Instances

When Yoke scans a domain, some signals depend on infrastructure that a self-hosted instance naturally won't have. This is expected and doesn't mean your instance is broken — it means you're running a lean origin server, not a global edge network.

### Signals That Won't Apply to Your Instance's Own Domain

If you analyze your own self-hosted domain:

- **CDN Detected** (`cdn`) — you're serving from a single origin, not a CDN. This is a `canBeGood` signal on the Foundations axis; its absence costs a small deduction (~0.30× weight). For a self-hosted tool, this is expected and not worth "fixing" with a CDN you don't need.
- **Asset CDN** (`asset_cdn`) — same reasoning. Your static assets are served from your origin.
- **WAF Detected** (`waf_detected`) — Coraza runs locally and doesn't advertise itself via headers the way Cloudflare/Sucuri/Imperva do. Yoke detects WAFs via response headers and cookies. Your WAF is there, it's just invisible to Yoke's detection. (This is actually good operational security.)

### No Code Changes Needed

These signals use the standard absent-signal deduction (0.30× weight) — they're designed for the general case where a site _should_ consider a CDN/WAF but hasn't. For a single-operator OSINT tool, the small scoring impact is negligible and correct: you're not running a production web app that needs global edge caching.

The `SELF_DOMAINS` environment variable tells Yoke which domains belong to this instance (default: `yoke.lol`). Set it to your domain so self-analysis features work correctly:

```toml
[vars]
SELF_DOMAINS = "yourdomain.com,www.yourdomain.com"
```

---

## Fly.io Probe Proxy (Optional)

The proxy provides HTTP probes from non-server IPs (some sites block specific IP ranges), MaxMind GeoIP enrichment, and check-host.net relay for global availability.

**Without it**, everything works — blocked sites show as `RESTRICTED` instead of `UP`, and GeoIP falls back to ipwho.is.

```bash
cd fly-proxy
fly auth login
fly launch --no-deploy
fly secrets set FLY_AUTH_SECRET=<generate-a-secret>
fly deploy

# Optional: MaxMind GeoIP (free license at maxmind.com/en/geolite2/signup)
MAXMIND_LICENSE_KEY=your_key fly deploy
cd ..
```

Then configure the main worker:
```bash
# Cloudflare: add to wrangler.toml [vars]
# FLY_PROBE_URL = "https://your-fly-app.fly.dev"
npx wrangler secret put FLY_AUTH_SECRET   # must match Fly side

# Bare metal: add to workerd config bindings
# (name = "FLY_PROBE_URL", text = "https://your-fly-app.fly.dev"),
# (name = "FLY_AUTH_SECRET", text = "your-shared-secret"),
```

---

## Environment Variables

Set via `npx wrangler secret put` (Cloudflare), workerd config bindings (bare metal), or `[vars]` in wrangler.toml (non-sensitive only).

| Variable | Required | Description |
|----------|----------|-------------|
| `SHARE_SECRET` | **Yes** | HMAC key for share card URLs |
| `ADMIN_KEY` | **Yes** | Protects admin endpoints |
| `IP_HASH_SALT` | **Yes** | Secret salt for GDPR-safe IP hashing |
| `BASE_URL` | Recommended | Instance URL for self-analysis + share cards |
| `SELF_DOMAINS` | Recommended | Comma-separated list of your instance's own domains (default: yoke.lol) |
| `OPENROUTER_API_KEY` | Recommended | AI Analysis (Cross-Signal Insights) |
| `GOOGLE_PAGESPEED_API_KEY` | Recommended | Lighthouse scores + Core Web Vitals |
| `WHOISFREAKS_API_KEY` | Optional | WHOIS fallback for ccTLDs (100 free/mo) |
| `FLY_PROBE_URL` | Optional | Fly proxy URL |
| `FLY_AUTH_SECRET` | Optional | Worker ↔ Fly proxy shared secret |
| `RATE_LIMIT_ANALYZE` | Optional | Max analyses/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_COMPARE` | Optional | Max compares/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_SUBDOMAIN` | Optional | Max subdomain scans/hr per IP (default: 30, 0 = disable) |
| `RATE_LIMIT_AVAILABILITY` | Optional | Max availability checks/hr per IP (default: 60, 0 = disable) |
| `CACHE_TTL_HOURS` | Optional | Analysis cache TTL in hours (default: 24, 0 = disable) |
| `MTA_STS_MX_1` | Optional | MTA-STS MX host #1 (default: `route1.mx.cloudflare.net`) |
| `MTA_STS_MX_2` | Optional | MTA-STS MX host #2 (default: `route2.mx.cloudflare.net`) |
| `MTA_STS_MX_3` | Optional | MTA-STS MX host #3 (default: `route3.mx.cloudflare.net`) |

---

## Admin Endpoints

Protected by `ADMIN_KEY` via HTTP Basic auth (any username, password = key):

```bash
# Usage dashboard (also at /usage in browser)
curl -u admin:YOUR_KEY https://your-instance.com/usage

# D1 cleanup — old stats, expired rate limits
curl -u admin:YOUR_KEY https://your-instance.com/api/cleanup

# Purge cached analysis for a domain
curl -u admin:YOUR_KEY -X DELETE https://your-instance.com/api/cache/example.com

# Purge all AI analysis cache
curl -u admin:YOUR_KEY -X DELETE "https://your-instance.com/api/cache?type=ai_analysis"
```

Run `/api/cleanup` periodically (daily/weekly) to keep D1 lean. Cache cleanup is automatic via KV TTL.

### Rate Limit Bypass

For batch analysis or CI, pass `X-Admin-Key` to skip per-IP rate limits:

```bash
curl -X POST https://your-instance.com/api/analyze \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_KEY" \
  -d '{"domain": "example.com"}'
```

---

## Seeding Initial Data

After deploying, seed your instance with domain data to populate the recents feed and build score histograms:

```bash
# Uses the curated seed list from RecentLookups.tsx
# Default: 5 concurrent, adjust with CONCURRENCY env var
bash scripts/seed-domains.sh https://yourdomain.com

# With admin key to bypass rate limits
ADMIN_KEY=your-key bash scripts/seed-domains.sh https://yourdomain.com
```

---

## Updating

```bash
git pull
bash deploy.sh --cf    # Cloudflare Workers
# or
bash deploy.sh --all   # Include Fly proxy

# Bare metal:
git pull
cd client && bun run build.ts && cd ..
cd worker && bun run build && cd ..
sudo systemctl restart yoke-workerd
```

---

## Share Cards

Share cards use HMAC-SHA256 signed URLs for social sharing with OG image previews:
- `/r/{payload}.{sig}` — Report card HTML page
- `/og/{payload}.{sig}.png` — Dynamic OG image (1200×630, rendered via resvg-wasm)
