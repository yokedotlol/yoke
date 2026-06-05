# Self-Hosting Yoke

Run your own Yoke instance — same analysis engine, your infrastructure, your data.

## What You Get

A fully independent Yoke server that:
- Runs the complete domain analysis pipeline (DNS, HTTP, SSL/TLS, email auth, scoring)
- Serves the web UI and API on your domain
- Does **not** phone home to yoke.lol or any external Yoke infrastructure
- Optionally integrates PageSpeed Insights with your own Google API key

What's different from the hosted version:
- **No Tranco percentile data** — percentile badges won't appear
- **Local KV + D1** — miniflare provides persistent KV and D1 backed by SQLite on disk (`/data`), so caching, rate limiting, and admin stats all work. Data lives in Docker volumes and survives restarts.
- **No pre-seeded reference data** — the 5K domain corpus and Tranco rankings from yoke.lol aren't included. Your instance builds its own cache organically as domains are scanned.

---

## Prerequisites

| Item | Notes |
|------|-------|
| **VPS** | 1 vCPU, 2 GB RAM, 40 GB disk (~$12/mo). Linode Shared 2GB, DigitalOcean Basic 2GB, Hetzner CX22. 4GB is unnecessary — idle footprint is ~500MB. |
| **OS** | Ubuntu 22.04+ or Debian 12+. |
| **Domain** | A domain (or subdomain) with an A record pointed at your VPS IP. |
| **Docker** (recommended) | Docker Engine + Docker Compose v2. [Install guide](https://docs.docker.com/engine/install/). |

### Server Hardening (Do This First)

Don't skip this. A public-facing server needs basic hygiene:

- [Linode: How to Secure Your Server](https://www.linode.com/docs/products/compute/compute-instances/guides/set-up-and-secure/) — SSH keys, firewall, fail2ban
- [DigitalOcean: Initial Server Setup with Ubuntu](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu) — similar, DO-flavored
- [Ubuntu Server Security Guide](https://ubuntu.com/server/docs/security-introduction) — official Ubuntu docs

The essentials:
```bash
# SSH key auth only, no root login
sudo sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Firewall
sudo ufw allow ssh && sudo ufw allow http && sudo ufw allow https && sudo ufw enable

# Automatic security updates
sudo apt install -y unattended-upgrades
```

---

## Option A: Docker Compose (Recommended)

Three containers, one command.

```
Internet → Caddy (:443, auto-TLS) → workerd (:8787) → probe (:8788)
```

### 1. Clone and Configure

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

### 2. Build and Start

```bash
docker compose up -d --build
```

That's it. Caddy auto-provisions a TLS certificate via Let's Encrypt. Give it ~30 seconds for the first cert, then:

### 3. Verify

```bash
# Check services
docker compose ps

# Test the API
curl -s https://YOUR_DOMAIN/api/analyze \
  -X POST -H "Content-Type: application/json" \
  -d '{"domain":"example.com"}' | jq '.domain_score'

# Or just:
curl -s https://YOUR_DOMAIN/example.com | jq '.domain_score'
```

### 4. White-Labeling

Yoke supports full white-labeling through environment variables. Add these to your `.env`:

```bash
# ── Branding ──────────────────────────────────────────────────────
SITE_NAME=MyPerf                             # Replaces "Yoke" throughout the UI
SITE_TAGLINE=internal domain intelligence    # Shown on the homepage

# ── Hide Yoke-specific links ─────────────────────────────────────
HIDE_GITHUB=true       # Remove GitHub star link from footer
HIDE_EXTENSION=true    # Remove Chrome Extension link from footer
HIDE_CLI=true          # Remove CLI link from footer

# ── Custom URLs ───────────────────────────────────────────────────
FEEDBACK_URL=https://yoursite.com/feedback   # Replaces the default GitHub issues link
# REPO_URL=                                  # Override the repo link (hidden if HIDE_GITHUB=true)
# EXTENSION_URL=                             # Override the Chrome Web Store link
```

After changing branding variables, rebuild the workerd container:

```bash
docker compose up -d --build workerd
docker compose restart caddy
```

The entrypoint patches the client assets at container startup — domain references, site name, and the runtime config are all applied automatically.

### 5. Configure the CLI

Point the Yoke CLI at your instance:

```bash
# Install (pick one)
brew tap yokedotlol/tap && brew install yoke   # Homebrew
go install github.com/yokedotlol/yoke/cli@latest  # Go

# Point at your server
yoke config set base_url https://YOUR_DOMAIN

# Test
yoke stripe.com
```

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

## Security Considerations

Yoke ships a secure default without requiring additional infrastructure:

- **TLS** — Caddy auto-provisions and renews certificates via Let's Encrypt
- **Security headers** — CSP, X-Frame-Options, and other headers are set by the worker on every response
- **Rate limiting** — per-IP, per-endpoint rate limiting is built into the application layer
- **SSRF protection** — internal network requests are blocked; domain input is validated
- **CORS policy** — configured for same-origin by default
- **No stored user data** — Yoke doesn't handle authentication, passwords, or PII. The only user input is a domain name string.

**Do I need a WAF?** Probably not. A WAF blocks exploit patterns (SQL injection, XSS payloads, path traversal) targeting attack surfaces that Yoke doesn't have. The application's attack surface is a single text input (a domain name), and all analysis is read-only.

For production deployments expecting high traffic or targeted attacks, consider placing Yoke behind [Cloudflare in proxied mode](https://developers.cloudflare.com/fundamentals/concepts/how-cloudflare-works/) (free tier includes WAF rules, DDoS protection, and caching) or your existing reverse proxy.

## Protecting Your Domain's Email Reputation

Even if your Yoke instance doesn't send email, **your domain can be spoofed by anyone unless you explicitly prevent it**. An unprotected domain is a gift to phishers — they can send email that appears to come from your domain, and receiving mail servers have no way to know it's fake. If that happens, your domain ends up on blocklists, and your legitimate email (if you ever send any) stops being delivered.

This isn't theoretical. Since February 2024, Google, Yahoo, and Microsoft all require SPF, DKIM, and DMARC for bulk senders. As of 2025, Microsoft rejects non-compliant email outright. Even for domains that don't send bulk email, missing authentication records signal to mail servers that you haven't secured your domain.

### The minimum

Set these DNS records to tell the world "nobody is authorized to send email from this domain":

| Record | Type | Name | Value |
|--------|------|------|-------|
| **SPF** | TXT | `@` | `v=spf1 -all` |
| **DMARC** | TXT | `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s;` |

This takes two minutes and protects your domain from being used in phishing attacks. The SPF record says "no servers are authorized to send mail for this domain" and the DMARC policy tells receivers to reject anything that tries.

### If your domain handles email

If you route email through your domain (even just for receiving), add:

- **DKIM** — cryptographic signatures proving messages weren't tampered with. Your email provider generates these keys.
- **MTA-STS** — forces TLS encryption for inbound mail delivery. Requires serving a policy file at `https://mta-sts.yourdomain/.well-known/mta-sts.txt`. The Docker Caddyfile includes an MTA-STS block you can enable.
- **TLSRPT** — delivery failure reports for TLS issues: `v=TLSRPTv1; rua=mailto:tls-reports@yourdomain`
- **CAA** — restricts which certificate authorities can issue certs for your domain.

### Resources

- [MXToolbox SuperTool](https://mxtoolbox.com/SuperTool.aspx) — check your SPF, DKIM, DMARC, and MX records
- [Google Postmaster Tools](https://postmaster.google.com/) — monitor your domain's reputation with Gmail
- [Cloudflare Email Security](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-security-records/) — guide to adding email security DNS records
- [learndmarc.com](https://learndmarc.com/) — interactive DMARC learning tool

---

## Option B: Bare Metal (Advanced)

> **Note:** Docker Compose (Option A) is the tested and maintained deployment path. Bare metal is documented for operators who prefer to manage services directly. The general approach is sound, but you may need to adapt paths and configurations to your environment.

### 1. Install Dependencies

```bash
# System packages
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git jq unzip

# Bun (JS runtime — for building)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Go 1.22 (for the SSL/TLS probe)
wget -q https://go.dev/dl/go1.22.12.linux-amd64.tar.gz -O /tmp/go.tar.gz
sudo tar -C /usr/local -xzf /tmp/go.tar.gz && rm /tmp/go.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc && source ~/.bashrc

# Caddy (reverse proxy + automatic HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy

# workerd — check https://github.com/nicholasgasior/build-workerd/releases for latest
WORKERD_VERSION="2026-06-04"
curl -fsSL "https://github.com/nicholasgasior/build-workerd/releases/download/${WORKERD_VERSION}/workerd-linux-64.gz" -o /tmp/workerd.gz
gunzip /tmp/workerd.gz && chmod +x /tmp/workerd && sudo mv /tmp/workerd /usr/local/bin/workerd
```

### 2. Clone and Build

```bash
sudo mkdir -p /opt/yoke && sudo chown $USER:$USER /opt/yoke
git clone https://github.com/yokedotlol/yoke.git /opt/yoke
cd /opt/yoke

# Build the client
cd client && bun install && bun run build && cd ..

# Build the worker
cd worker && bun install && bun run build && cd ..

# Build the SSL probe
cd fly-proxy && go build -o yoke-probe . && cd ..

# Generate the assets shim
bash generate-assets-shim.sh
```

### 3. Generate Secrets

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

### 4. Configure workerd

Replace `YOUR_DOMAIN` and the three secrets with your values:

```bash
cat > /opt/yoke/workerd.capnp << 'EOF'
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
    # Optional: (name = "PAGESPEED_API_KEY", text = "YOUR_GOOGLE_API_KEY"),
    (name = "FLY_PROBE_URL", text = "http://127.0.0.1:8788"),
    (name = "FLY_AUTH_SECRET", text = "YOUR_PROBE_SECRET"),
    (name = "FONT_INTER_REGULAR", data = embed "worker/src/fonts/Inter-Regular.ttf"),
    (name = "FONT_INTER_MEDIUM", data = embed "worker/src/fonts/Inter-Medium.ttf"),
    (name = "FONT_INTER_SEMIBOLD", data = embed "worker/src/fonts/Inter-SemiBold.ttf"),
    (name = "FONT_INTER_BOLD", data = embed "worker/src/fonts/Inter-Bold.ttf"),
    (name = "FONT_JETBRAINS_MONO", data = embed "worker/src/fonts/JetBrainsMono-Regular.ttf"),
  ],
);

const assetsWorker :Workerd.Worker = (
  modules = [
    (name = "assets", esModule = embed "assets-shim.js"),
  ],
  compatibilityDate = "2024-12-01",
);
EOF
```

### 5. Prevent Call-Home

```bash
echo '# Null routes — self-hosted Yoke does not call home' | sudo tee -a /etc/hosts
echo '127.0.0.1 yoke.lol www.yoke.lol yoke-probe.fly.dev' | sudo tee -a /etc/hosts
```

### 6. Set Up Systemd Services

**workerd:**
```bash
sudo tee /etc/systemd/system/yoke-workerd.service > /dev/null << EOF
[Unit]
Description=Yoke workerd
After=network.target
[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/yoke
ExecStart=/usr/local/bin/workerd serve /opt/yoke/workerd.capnp
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
```

**SSL/TLS probe:**
```bash
sudo tee /etc/systemd/system/yoke-probe.service > /dev/null << EOF
[Unit]
Description=Yoke SSL/TLS Probe
After=network.target
[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/yoke/fly-proxy
Environment=PORT=8788
Environment=FLY_AUTH_SECRET=YOUR_PROBE_SECRET
Environment=ALLOW_OPEN_PROXY=false
# Optional: Environment=GOOGLE_PAGESPEED_API_KEY=YOUR_KEY
ExecStart=/opt/yoke/fly-proxy/yoke-probe
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
```

**Caddy:**
```bash
sudo tee /etc/caddy/Caddyfile > /dev/null << EOF
YOUR_DOMAIN {
    handle /assets/* {
        root * /opt/yoke/client/dist
        file_server
    }
    handle /fonts/* {
        root * /opt/yoke/client/dist
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:8787
    }
}
EOF
```

### 7. Start Everything

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yoke-probe yoke-workerd
sudo systemctl restart caddy
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSL grade shows "Valid" instead of letter grade | Probe unreachable | Check probe logs; verify `FLY_PROBE_URL` and `FLY_AUTH_SECRET` match |
| `connect() blocked by restrictPeers()` | workerd blocking localhost | Ensure `globalOutbound = "internet"` with `"private"` in allow list |
| PageSpeed "Rate limited" | Missing API key or quota exhausted | Add key to **both** workerd config and probe service |
| No scores at all | workerd not running | Check for capnp parse errors in logs |
| Share URLs return 404 | Wrong `SHARE_SECRET` | Secrets must match between generation and verification |
| Caddy won't start | Port 80/443 in use | `sudo lsof -i :80` — stop conflicting service or use a different port |
