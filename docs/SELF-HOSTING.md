# Self-Hosting Yoke

Run your own Yoke instance — same analysis engine, your infrastructure, your data. Three deployment options:

| Option | Best For | Cost | Difficulty |
|--------|----------|------|------------|
| **[A: Cloudflare Workers](#option-a-cloudflare-workers)** | Managed hosting, global edge | ~$5–11/mo | Easy |
| **[B: Docker Compose](#option-b-docker-compose)** | Self-hosted on a VPS | ~$5–18/mo | Moderate |
| **[C: Bare Metal](#option-c-bare-metal)** | Full control, no containers | ~$5–18/mo | Advanced |

All three run the same Worker code and produce identical results.

---

## Table of Contents

- [Option A: Cloudflare Workers](#option-a-cloudflare-workers)
- [Option B: Docker Compose](#option-b-docker-compose)
- [Option C: Bare Metal](#option-c-bare-metal)
- [White-Labeling](#white-labeling)
- [Email Security](#email-security)
- [Security Hardening (VPS)](#security-hardening-vps)
- [Default Security Posture](#default-security-posture)
- [Scoring on Self-Hosted Instances](#scoring-on-self-hosted-instances)
- [Fly.io Probe Proxy (Optional)](#flyio-probe-proxy-optional)
- [Environment Variables](#environment-variables)
- [Admin Endpoints](#admin-endpoints)
- [Seeding Initial Data](#seeding-initial-data)
- [CLI Configuration](#cli-configuration)
- [Updating](#updating)
- [Share Cards](#share-cards)
- [Troubleshooting](#troubleshooting)

---

## Option A: Cloudflare Workers

The simplest path. Cloudflare handles TLS, DDoS protection, edge caching, and global distribution.

### Running Costs

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Cloudflare Workers Paid | ~$5 | 10M requests, 1M KV reads, 25M D1 rows |
| Fly.io proxy (optional) | ~$6 | HTTP probes + MaxMind GeoIP |
| All external APIs | $0 | PageSpeed, WHOIS, Shodan, etc. — free tiers |
| **Total** | **~$5–11/mo** | |

> **Why not the free tier?** The free plan caps CPU time at 10ms/request. A single analysis runs ~30 external API calls, scores 150+ signals, and writes results to KV/D1 — needs hundreds of ms minimum. The free tier also limits subrequests (50/request) and KV writes (1,000/day).

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

#### Disable Bot Fight Mode

**Security → Bots → Bot Fight Mode → Off.**

Yoke is API-first — the CLI, MCP server, Chrome extension, and CI tests all make automated requests. Bot Fight Mode challenges anything that isn't a browser, returning 403 JS challenge pages that break the JSON API and CI pipelines. Your instance is already protected by per-IP rate limiting and SSRF guards.

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

Migrations are hand-targeted at a specific D1 by database name (there is no
`wrangler d1 migrations apply` step). Run, against **yoke-stats**:

```bash
npx wrangler d1 execute yoke-stats --file=worker/migrations/0002_domain_scores.sql
npx wrangler d1 execute yoke-stats --file=worker/migrations/0003_badge_domains.sql
```

> `0001_init.sql` is deprecated (old D1 cache layer, replaced by KV). Skip it.
>
> `0004_drop_domain_cache.sql` only matters if you previously ran `0001_init.sql`
> against a **yoke-cache** DB; it drops the now-unused `domain_cache` table.
> Fresh self-hosters who skipped `0001` can ignore it.

### Step 5: Secrets

**Required:**

```bash
npx wrangler secret put SHARE_SECRET       # HMAC key for share URLs (openssl rand -hex 32)
npx wrangler secret put ADMIN_KEY          # Admin endpoint auth (openssl rand -hex 32)
npx wrangler secret put IP_HASH_SALT       # GDPR-safe IP hashing salt (openssl rand -hex 32)
```

**Recommended:**

```bash
npx wrangler secret put OPENROUTER_API_KEY          # AI Analysis — https://openrouter.ai/keys
npx wrangler secret put GOOGLE_PAGESPEED_API_KEY    # Lighthouse + CrUX — free, 25K req/day
npx wrangler secret put WHOISFREAKS_API_KEY         # WHOIS fallback for ccTLDs — free, 100/mo
```

### Step 6: Build and Deploy

```bash
bash deploy.sh --cf

# Or manually:
cd client && bun run build.ts && cd ..
cd worker && bun run build && npx wrangler deploy && cd ..
```

Visit `https://yourdomain.com` — try analyzing a domain.

---

## Option B: Docker Compose

Three containers, one command. Recommended for VPS self-hosting.

```
Internet → Caddy (:443, auto-TLS) → workerd (:8787) → probe (:8788)
```

### Running Costs

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| VPS (Linode/Hetzner/DigitalOcean) | ~$5–12 | 1 vCPU, 2 GB RAM, 40 GB disk |
| Domain + DNS | ~$10/yr | Any registrar |
| All external APIs | $0 | Free tiers |
| **Total** | **~$5–12/mo** | |

### Prerequisites

| Item | Notes |
|------|-------|
| **VPS** | 1 vCPU, 2 GB RAM minimum. Idle footprint is ~500MB. |
| **OS** | Ubuntu 22.04+ or Debian 12+. |
| **Domain** | A record pointed at your VPS IP. |
| **Docker** | Docker Engine + Docker Compose v2. [Install guide](https://docs.docker.com/engine/install/). |

### Step 1: Clone and Configure

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke
cp .env.example .env
```

Edit `.env`:
```bash
YOKE_DOMAIN=yoke.example.com
SHARE_SECRET=$(openssl rand -hex 32)
ADMIN_KEY=$(openssl rand -hex 32)
IP_HASH_SALT=$(openssl rand -hex 32)
PROBE_SECRET=$(openssl rand -hex 32)

# Optional — enables the Speed axis with real Lighthouse/CrUX data
# Free at https://console.cloud.google.com (enable PageSpeed Insights API)
# PAGESPEED_API_KEY=AIza...
```

### Step 2: Build and Start

```bash
docker compose up -d --build
```

Caddy auto-provisions a TLS certificate via Let's Encrypt. Give it ~30 seconds for the first cert.

### Step 3: Verify

```bash
docker compose ps

curl -s https://YOUR_DOMAIN/api/analyze \
  -X POST -H "Content-Type: application/json" \
  -d '{"domain":"example.com"}' | jq '.domain_score'
```

### What's Different from the Hosted Version

- **No Tranco percentile data** — percentile badges won't appear
- **Local KV + D1** — miniflare provides persistent KV and D1 backed by SQLite on disk (`/data`), so caching, rate limiting, and admin stats all work. Data lives in Docker volumes and survives restarts.
- **No pre-seeded reference data** — the 5K domain corpus and Tranco rankings from yoke.lol aren't included. Your instance builds its own cache organically as domains are scanned. See [Seeding Initial Data](#seeding-initial-data).

### Updating

```bash
cd yoke
git pull
docker compose up -d --build
```

### Logs

```bash
docker compose logs -f           # all services
docker compose logs -f workerd   # just the analysis engine
docker compose logs -f probe     # SSL/TLS probe
```

---

## Option C: Bare Metal

Run Yoke directly on your server using [workerd](https://github.com/cloudflare/workerd) behind [Caddy](https://caddyserver.com/).

> Docker Compose (Option B) is the tested and maintained path for VPS deployments. Bare metal is for operators who prefer to manage services directly.

### Running Costs

Same as Docker Compose — the containers are just packaging.

### Step 1: Install Dependencies

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git jq unzip

# Bun (JS runtime — for building)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Go 1.22+ (for the SSL/TLS probe)
wget -q https://go.dev/dl/go1.22.12.linux-amd64.tar.gz -O /tmp/go.tar.gz
sudo tar -C /usr/local -xzf /tmp/go.tar.gz && rm /tmp/go.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc && source ~/.bashrc

# Caddy (reverse proxy + automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# workerd — check https://github.com/cloudflare/workerd/releases for latest
curl -fsSL "https://github.com/nicholasgasior/build-workerd/releases/download/LATEST/workerd-linux-64.gz" -o /tmp/workerd.gz
gunzip /tmp/workerd.gz && chmod +x /tmp/workerd && sudo mv /tmp/workerd /usr/local/bin/workerd
```

### Step 2: Clone and Build

```bash
sudo mkdir -p /opt/yoke && sudo chown $USER:$USER /opt/yoke
git clone https://github.com/yokedotlol/yoke.git /opt/yoke
cd /opt/yoke

cd client && bun install && bun run build.ts && cd ..
cd worker && bun install && bun run build && cd ..
cd fly-proxy && go build -o yoke-probe . && cd ..
bash generate-assets-shim.sh
```

### Step 3: Generate Secrets

```bash
SHARE_SECRET=$(openssl rand -hex 32)
ADMIN_KEY=$(openssl rand -hex 32)
IP_HASH_SALT=$(openssl rand -hex 32)
PROBE_SECRET=$(openssl rand -hex 32)

echo "SHARE_SECRET=$SHARE_SECRET"
echo "ADMIN_KEY=$ADMIN_KEY"
echo "IP_HASH_SALT=$IP_HASH_SALT"
echo "PROBE_SECRET=$PROBE_SECRET"
# Save these!
```

### Step 4: Configure workerd

Create `/opt/yoke/workerd.capnp` — replace `YOUR_DOMAIN` and secrets:

```capnp
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "yoke", worker = .yokeWorker),
    (name = "assets", worker = .assetsWorker),
    (name = "internet", network = (allow = ["public", "private"], tlsOptions = (trustBrowserCas = true))),
  ],
  sockets = [
    (name = "http", address = "127.0.0.1:8787", http = (), service = "yoke"),
  ],
);

const yokeWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "worker/dist/worker.js"),
    (name = "resvg_bg.wasm", wasm = embed "worker/dist/resvg_bg.wasm"),
  ],
  compatibilityDate = "2024-12-01",
  globalOutbound = "internet",
  bindings = [
    (name = "ASSETS", service = "assets"),
    (name = "BASE_URL", text = "https://YOUR_DOMAIN"),
    (name = "SHARE_SECRET", text = "YOUR_SHARE_SECRET"),
    (name = "ADMIN_KEY", text = "YOUR_ADMIN_KEY"),
    (name = "IP_HASH_SALT", text = "YOUR_IP_HASH_SALT"),
    (name = "SELF_DOMAINS", text = "YOUR_DOMAIN,www.YOUR_DOMAIN"),
    (name = "FLY_PROBE_URL", text = "http://127.0.0.1:8788"),
    (name = "FLY_AUTH_SECRET", text = "YOUR_PROBE_SECRET"),
    (name = "FONT_INTER_REGULAR", data = embed "worker/src/fonts/Inter-Regular.ttf"),
    (name = "FONT_INTER_MEDIUM", data = embed "worker/src/fonts/Inter-Medium.ttf"),
    (name = "FONT_INTER_SEMIBOLD", data = embed "worker/src/fonts/Inter-SemiBold.ttf"),
    (name = "FONT_INTER_BOLD", data = embed "worker/src/fonts/Inter-Bold.ttf"),
    (name = "FONT_JETBRAINS_MONO", data = embed "worker/src/fonts/JetBrainsMono-Regular.ttf"),
    # Optional:
    # (name = "PAGESPEED_API_KEY", text = "YOUR_GOOGLE_API_KEY"),
    # (name = "OPENROUTER_API_KEY", text = "YOUR_OPENROUTER_KEY"),
  ],
);

const assetsWorker :Workerd.Worker = (
  modules = [
    (name = "assets", esModule = embed "assets-shim.js"),
  ],
  compatibilityDate = "2024-12-01",
);
```

Bind to **127.0.0.1 only** — Caddy handles all external traffic.

> **Note:** workerd's local KV and D1 support is evolving. Check the [workerd releases](https://github.com/cloudflare/workerd/releases) for the latest binding syntax. The Worker code is identical — only the binding configuration differs from Cloudflare's managed platform.

### Step 5: Prevent Call-Home

```bash
echo '# Null routes — self-hosted Yoke does not call home' | sudo tee -a /etc/hosts
echo '127.0.0.1 yoke.lol www.yoke.lol yoke-probe.fly.dev' | sudo tee -a /etc/hosts
```

### Step 6: Configure Caddy

```caddyfile
# /etc/caddy/Caddyfile
YOUR_DOMAIN {
    log {
        output file /var/log/caddy/access.log {
            roll_size 100mb
            roll_keep 5
            roll_keep_for 720h
        }
        format json
    }

    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        -Server
    }

    handle /assets/* {
        root * /opt/yoke/client/dist
        file_server
    }
    handle /fonts/* {
        root * /opt/yoke/client/dist
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:8787 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }
}
```

### Step 7: Set Up systemd Services

**workerd** (`/etc/systemd/system/yoke-workerd.service`):
```ini
[Unit]
Description=Yoke workerd
After=network.target

[Service]
Type=simple
User=yoke
Group=yoke
WorkingDirectory=/opt/yoke
ExecStart=/usr/local/bin/workerd serve /opt/yoke/workerd.capnp
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/yoke/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

**SSL/TLS probe** (`/etc/systemd/system/yoke-probe.service`):
```ini
[Unit]
Description=Yoke SSL/TLS Probe
After=network.target

[Service]
Type=simple
User=yoke
Group=yoke
WorkingDirectory=/opt/yoke/fly-proxy
Environment=PORT=8788
Environment=FLY_AUTH_SECRET=YOUR_PROBE_SECRET
Environment=ALLOW_OPEN_PROXY=false
ExecStart=/opt/yoke/fly-proxy/yoke-probe
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Step 8: Start Everything

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yoke-probe yoke-workerd
sudo systemctl restart caddy
```

### Step 9: Verify

```bash
curl -I https://YOUR_DOMAIN
curl -s https://YOUR_DOMAIN/stripe.com | jq '.domain_score'
curl -u admin:YOUR_ADMIN_KEY https://YOUR_DOMAIN/usage
```

---

## White-Labeling

Yoke supports full white-labeling through environment variables (Docker Compose and bare metal).

Add to your `.env` (Docker) or workerd bindings (bare metal):

```bash
# Branding
SITE_NAME=MyPerf                             # Replaces "Yoke" throughout the UI
SITE_TAGLINE=internal domain intelligence    # Shown on the homepage

# Hide Yoke-specific links
HIDE_GITHUB=true
HIDE_EXTENSION=true
HIDE_CLI=true

# Custom URLs
FEEDBACK_URL=https://yoursite.com/feedback
```

After changing branding variables, rebuild:

```bash
# Docker
docker compose up -d --build workerd
docker compose restart caddy

# Bare metal
cd client && bun run build.ts && cd ..
sudo systemctl restart yoke-workerd
```

The Docker entrypoint patches client assets at startup — domain references, site name, and runtime config are applied automatically.

---

## Email Security

Even if your Yoke instance doesn't send email, **your domain can be spoofed unless you explicitly prevent it**. Since February 2024, Google, Yahoo, and Microsoft all require SPF, DKIM, and DMARC. As of 2025, Microsoft rejects non-compliant email outright.

### Non-mail domains

Set these DNS records to say "nobody is authorized to send email from this domain":

| Record | Type | Name | Value |
|--------|------|------|-------|
| **SPF** | TXT | `@` | `v=spf1 -all` |
| **DMARC** | TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;` |

Two minutes. Protects your domain from phishing spoofing.

### Mail-enabled domains

If your domain handles email, also add:

- **DKIM** — cryptographic signatures. Your email provider generates these keys.
- **MTA-STS** — forces TLS for inbound mail. Requires a policy file at `https://mta-sts.yourdomain/.well-known/mta-sts.txt`. The Docker Caddyfile includes an MTA-STS block you can enable.
- **TLSRPT** — TLS delivery failure reports: `v=TLSRPTv1; rua=mailto:tls-reports@yourdomain`
- **CAA** — restricts which CAs can issue certs for your domain.

### Resources

- [MXToolbox SuperTool](https://mxtoolbox.com/SuperTool.aspx) — check SPF, DKIM, DMARC, MX
- [Google Postmaster Tools](https://postmaster.google.com/) — domain reputation with Gmail
- [Cloudflare Email Security](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-security-records/) — email security DNS guide
- [learndmarc.com](https://learndmarc.com/) — interactive DMARC learning tool

---

## Security Hardening (VPS)

On Cloudflare Workers, you get DDoS protection, edge TLS, and bot management for free. On a VPS (Docker or bare metal), you're responsible for your own perimeter.

### Layer 1: OS Hardening

```bash
# Firewall — only expose 80, 443, and SSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# SSH key auth only, no root login
sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

References:
- [Linode: How to Secure Your Server](https://www.linode.com/docs/products/compute/compute-instances/guides/set-up-and-secure/)
- [DigitalOcean: Initial Server Setup with Ubuntu](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu)

### Layer 2: WAF — Coraza + OWASP CRS (Recommended)

[Coraza](https://coraza.io/) is a Go-native WAF that integrates with Caddy as a plugin. It runs the OWASP Core Rule Set — the same rules used by ModSecurity.

```bash
# Build Caddy with Coraza
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
xcaddy build --with github.com/corazawaf/coraza-caddy/v2
sudo mv caddy /usr/bin/caddy
```

Add to your Caddyfile:

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
            SecRequestBodyLimit 131072
            SecRequestBodyNoFilesLimit 131072
            SecAction "id:900000, phase:1, pass, t:none, nolog, setvar:tx.blocking_paranoia_level=1"
        `
    }
}
```

### Layer 3: Behavioral Detection — CrowdSec (Recommended)

[CrowdSec](https://crowdsec.net/) is a modern fail2ban replacement with crowd-sourced threat intelligence. It parses Caddy's JSON access logs, detects attack patterns, and blocks offending IPs at the firewall level.

```bash
curl -s https://install.crowdsec.net | sudo sh
sudo apt install -y crowdsec crowdsec-firewall-bouncer-nftables

sudo cscli collections install crowdsecurity/caddy-logs
sudo cscli collections install crowdsecurity/http-cve
sudo cscli collections install crowdsecurity/base-http-scenarios

cat <<'EOF' | sudo tee /etc/crowdsec/acquis.d/caddy.yaml
filenames:
  - /var/log/caddy/access.log
labels:
  type: caddy
EOF

sudo systemctl reload crowdsec
```

### Security Stack Summary

| Layer | Tool | What It Does | Required? |
|-------|------|-------------|-----------|
| OS | ufw + SSH hardening | Firewall + access control | **Yes** |
| WAF | Coraza + OWASP CRS | Block injection / XSS / scanners | Recommended |
| Behavioral | CrowdSec | Ban repeat offenders, crowd intel | Recommended |
| TLS | Caddy (auto) | Let's Encrypt certificates | **Yes** |
| App | Yoke built-in | Per-IP rate limits, SSRF guards, CORS | Built in |

On Cloudflare Workers, Cloudflare's edge provides the first three layers automatically.

---

## Default Security Posture

Every Yoke instance — managed or self-hosted — ships with these protections built into the Worker code:

- **Per-IP rate limiting** — configurable per-endpoint limits stored in D1 (default: 20 analyses/hr, 20 compares/hr, 15 subdomain scans/hr, 30 availability checks/hr). Set to `0` to disable.
- **SSRF protection** — all outbound fetches are checked against private/reserved IP ranges. Redirect chains are followed manually with SSRF checks at each hop.
- **CORS policy** — `Access-Control-Allow-Origin: *` for GET/POST/OPTIONS (public API by design). Admin endpoints require Basic auth.
- **Content-Security-Policy** — `frame-ancestors 'self'` prevents clickjacking.
- **HMAC-SHA256 signed share URLs** — share cards can't be forged.
- **Admin auth** — `/usage`, `/api/cleanup`, `/api/cache` behind HTTP Basic auth with timing-safe comparison.
- **Cache-aware rate limiting** — cached results don't count against per-IP limits.
- **IP hashing** — user IPs are SHA-256 hashed with a daily-rotating salt before storage. No raw IPs are persisted.

### What Self-Hosters Don't Get (vs. Cloudflare)

| Feature | Cloudflare | VPS | Mitigation |
|---------|-----------|-----|------------|
| DDoS protection | ✅ Edge-level | ❌ | CrowdSec + ufw + VPS provider DDoS |
| Global CDN | ✅ 300+ PoPs | ❌ Single origin | Acceptable for single-operator use |
| Managed TLS | ✅ Automatic | ✅ Caddy auto-HTTPS | Equivalent |
| Bot management | ✅ (disabled for Yoke) | ❌ | Coraza scanner detection rules |
| Edge caching | ✅ | ❌ | Yoke's KV cache handles this at the app layer |
| WAF | ✅ CF WAF | ✅ Coraza | Equivalent (same OWASP CRS) |

---

## Scoring on Self-Hosted Instances

Some signals depend on infrastructure a self-hosted instance naturally won't have. This is expected and doesn't mean your instance is broken.

### Signals that won't apply to your own domain

- **CDN Detected / Asset CDN** — you're serving from a single origin. These are `canBeGood` signals with small deductions (~0.30× weight). Expected for a self-hosted tool.
- **WAF Detected** — Coraza runs locally and doesn't advertise itself via headers. Your WAF is there, it's just invisible to Yoke's detection. (Good OpSec.)

The `SELF_DOMAINS` environment variable tells Yoke which domains belong to this instance:

```toml
# wrangler.toml
[vars]
SELF_DOMAINS = "yourdomain.com,www.yourdomain.com"
```

```bash
# .env (Docker)
SELF_DOMAINS=yourdomain.com,www.yourdomain.com
```

---

## Fly.io Probe Proxy (Optional)

The proxy provides HTTP probes from non-server IPs (some sites block datacenter ranges), MaxMind GeoIP enrichment, and check-host.net relay for global availability.

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
npx wrangler secret put FLY_AUTH_SECRET

# Docker: add to .env
# FLY_PROBE_URL=https://your-fly-app.fly.dev
# FLY_AUTH_SECRET=your-shared-secret

# Bare metal: add to workerd config bindings
# (name = "FLY_PROBE_URL", text = "https://your-fly-app.fly.dev"),
# (name = "FLY_AUTH_SECRET", text = "your-shared-secret"),
```

---

## Environment Variables

Set via `npx wrangler secret put` (Cloudflare), `.env` (Docker), or workerd config bindings (bare metal).

| Variable | Required | Description |
|----------|----------|-------------|
| `SHARE_SECRET` | **Yes** | HMAC key for share card URLs |
| `ADMIN_KEY` | **Yes** | Protects admin endpoints |
| `IP_HASH_SALT` | **Yes** | Secret salt for GDPR-safe IP hashing |
| `BASE_URL` | Recommended | Instance URL for self-analysis + share cards |
| `SELF_DOMAINS` | Recommended | Comma-separated list of your instance's domains (default: yoke.lol) |
| `OPENROUTER_API_KEY` | Recommended | AI Analysis (Cross-Signal Insights) |
| `GOOGLE_PAGESPEED_API_KEY` | Recommended | Lighthouse scores + Core Web Vitals |
| `WHOISFREAKS_API_KEY` | Optional | WHOIS fallback for ccTLDs (100 free/mo) |
| `FLY_PROBE_URL` | Optional | Fly proxy URL |
| `FLY_AUTH_SECRET` | Optional | Worker ↔ Fly proxy shared secret |
| `PROBE_SECRET` | Optional | Docker probe container auth |
| `RATE_LIMIT_ANALYZE` | Optional | Max analyses/hr per IP (default: 20, 0 = disable) |
| `RATE_LIMIT_COMPARE` | Optional | Max compares/hr per IP (default: 20, 0 = disable) |
| `RATE_LIMIT_SUBDOMAIN` | Optional | Max subdomain scans/hr per IP (default: 15, 0 = disable) |
| `RATE_LIMIT_AVAILABILITY` | Optional | Max availability checks/hr per IP (default: 30, 0 = disable) |
| `RATE_LIMIT_BACKEND` | Optional | `do` (Durable Objects, default) or `d1`. DO uses in-memory counters — faster and avoids D1 read/write costs |
| `CACHE_TTL_HOURS` | Optional | Analysis cache TTL in hours (default: 24, 0 = disable) |
| `SITE_NAME` | Optional | White-label: replaces "Yoke" in the UI |
| `SITE_TAGLINE` | Optional | White-label: homepage tagline |
| `HIDE_GITHUB` | Optional | White-label: remove GitHub link |
| `HIDE_EXTENSION` | Optional | White-label: remove extension link |
| `HIDE_CLI` | Optional | White-label: remove CLI link |
| `FEEDBACK_URL` | Optional | White-label: custom feedback URL |
| `DISABLE_ANALYTICS` | Optional | Set `true` to skip endpoint usage tracking and tab view analytics |

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

Populate your instance with domain data for the recents feed and score histograms:

```bash
bash scripts/seed-domains.sh https://yourdomain.com

# With admin key to bypass rate limits
ADMIN_KEY=your-key bash scripts/seed-domains.sh https://yourdomain.com
```

Default concurrency is 5. Adjust with `CONCURRENCY` env var.

---

## CLI Configuration

Point the Yoke CLI at your instance:

```bash
# Install
brew install yokedotlol/tap/yoke
# or: go install github.com/yokedotlol/yoke/cli@latest

# Configure
yoke config set base_url https://YOUR_DOMAIN

# Test
yoke stripe.com
```

---

## Updating

```bash
# Cloudflare Workers
git pull
bash deploy.sh --cf
# Include Fly proxy: bash deploy.sh --all

# Docker Compose
git pull
docker compose up -d --build

# Bare metal
git pull
cd client && bun run build.ts && cd ..
cd worker && bun run build && cd ..
cd fly-proxy && go build -o yoke-probe . && cd ..
sudo systemctl restart yoke-probe yoke-workerd
```

---

## Share Cards

Share cards use HMAC-SHA256 signed URLs for social sharing with OG image previews:
- `/r/{payload}.{sig}` — Report card HTML page
- `/og/{payload}.{sig}.png` — Dynamic OG image (1200×630, rendered via resvg-wasm)

---

## Badges

Embeddable badges work out of the box — every analysis automatically writes badge cache data. No extra setup required.

**Refresh model:** Badges refresh lazily on-view — there is no pre-warm cron to configure (the old timer-based sweep and its `POST /api/admin/badge-sweep` endpoint were removed). A badge served from cache is refreshed in the background once it ages past `BADGE_REFRESH_INTERVAL_HRS` (default 6h), staying under the global daily analysis budget. A badge older than `BADGE_STALE_DAYS` (default 30d) — or one whose cached SSL cert expiry (`notAfter`) has passed — is demoted to a neutral "stale — re-scan" rendering and re-scanned on demand. The hourly cron now only flushes cost counters and prunes stale rows.

**White-label:** Badge label text uses the `SITE_NAME` environment variable (defaults to "Yoke").

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSL grade shows "Valid" instead of letter grade | Probe unreachable | Check probe logs; verify `FLY_PROBE_URL` and `FLY_AUTH_SECRET` match |
| `connect() blocked by restrictPeers()` | workerd blocking localhost | Ensure `globalOutbound = "internet"` with `"private"` in allow list |
| PageSpeed "Rate limited" | Missing API key or quota exhausted | Add key to **both** workerd config and probe service |
| No scores at all | workerd not running | Check for capnp parse errors in logs |
| Share URLs return 404 | Wrong `SHARE_SECRET` | Secrets must match between generation and verification |
| Caddy won't start | Port 80/443 in use | `sudo lsof -i :80` — stop conflicting service |
| Bot Fight Mode breaking API | Cloudflare BFM enabled | Disable in Security → Bots → Bot Fight Mode |
| Docker data lost on restart | Volumes not mounted | Check `docker compose` volume configuration |
