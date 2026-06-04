#!/usr/bin/env bash
set -euo pipefail

# ─── Yoke Self-Host Setup ────────────────────────────────────────────
# Run as a user with sudo access on a fresh Ubuntu 22.04+ / Debian 12+
# Usage: bash setup-selfhost.sh
# ─────────────────────────────────────────────────────────────────────

DOMAIN="${YOKE_DOMAIN:-yoke-test.lol}"
WORKERD_PORT=8787
YOKE_USER="yoke"
YOKE_DIR="/opt/yoke"
LOG_DIR="/var/log/caddy"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
step() { echo -e "\n${GREEN}═══ $* ═══${NC}"; }

# ─── Pre-flight ──────────────────────────────────────────────────────

if [[ $EUID -eq 0 ]]; then
  err "Don't run as root — run as a user with sudo access."
  exit 1
fi

step "1/9: System Update"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git jq unzip build-essential libssl-dev pkg-config

# ─── Firewall ────────────────────────────────────────────────────────

step "2/9: Firewall (ufw)"
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
echo "y" | sudo ufw enable
log "Firewall active — SSH, HTTP, HTTPS only"

# ─── Bun ─────────────────────────────────────────────────────────────

step "3/9: Bun"
if command -v bun &>/dev/null; then
  log "Bun already installed: $(bun --version)"
else
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  log "Bun installed: $(bun --version)"
fi

# Make sure bun is on PATH for the rest of the script
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"

# ─── Go (for xcaddy + Coraza build) ─────────────────────────────────

step "4/9: Go + Caddy with Coraza WAF"
if command -v go &>/dev/null; then
  log "Go already installed: $(go version)"
else
  GO_VERSION="1.23.4"
  wget -q "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf /tmp/go.tar.gz
  rm /tmp/go.tar.gz
  log "Go ${GO_VERSION} installed"
fi

export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"

# Build Caddy with Coraza WAF plugin
if command -v caddy &>/dev/null && caddy list-modules 2>/dev/null | grep -q coraza; then
  log "Caddy with Coraza already installed"
else
  log "Building Caddy with Coraza WAF plugin (this takes a minute)..."
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  xcaddy build --with github.com/corazawaf/coraza-caddy/v2 --output /tmp/caddy
  sudo mv /tmp/caddy /usr/bin/caddy
  sudo chmod +x /usr/bin/caddy
  log "Caddy with Coraza built and installed"
fi

# ─── workerd ─────────────────────────────────────────────────────────

step "5/9: workerd"
if command -v workerd &>/dev/null; then
  log "workerd already installed: $(workerd --version 2>&1 | head -1)"
else
  # Get latest workerd release
  WORKERD_URL=$(curl -s https://api.github.com/repos/cloudflare/workerd/releases/latest \
    | jq -r '.assets[] | select(.name | test("linux-64")) | .browser_download_url' | head -1)
  
  if [[ -z "$WORKERD_URL" || "$WORKERD_URL" == "null" ]]; then
    warn "Could not find workerd binary release — trying npm install"
    sudo npm install -g workerd || {
      err "Failed to install workerd. Install manually: https://github.com/cloudflare/workerd/releases"
      exit 1
    }
  else
    wget -q "$WORKERD_URL" -O /tmp/workerd.gz
    if file /tmp/workerd.gz | grep -q gzip; then
      gunzip -f /tmp/workerd.gz
    else
      mv /tmp/workerd.gz /tmp/workerd
    fi
    chmod +x /tmp/workerd
    sudo mv /tmp/workerd /usr/local/bin/workerd
    log "workerd installed"
  fi
fi

# ─── Clone + Build Yoke ─────────────────────────────────────────────

step "6/9: Clone and Build Yoke"
sudo mkdir -p "$YOKE_DIR"
sudo chown "$USER:$USER" "$YOKE_DIR"

if [[ -d "$YOKE_DIR/.git" ]]; then
  cd "$YOKE_DIR" && git pull
  log "Yoke repo updated"
else
  git clone https://github.com/yokedotlol/yoke.git "$YOKE_DIR"
  log "Yoke repo cloned"
fi

cd "$YOKE_DIR"

# Client build
cd client && bun install && bun run build.ts && cd ..
log "Client built"

# Worker build
cd worker && bun install && bun run build && cd ..
log "Worker built"

# ─── Generate secrets ────────────────────────────────────────────────

SECRETS_FILE="$YOKE_DIR/.env.secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
  SHARE_SECRET=$(openssl rand -hex 32)
  ADMIN_KEY=$(openssl rand -hex 32)
  cat > "$SECRETS_FILE" <<EOF
SHARE_SECRET=$SHARE_SECRET
ADMIN_KEY=$ADMIN_KEY
# Add API keys below:
# OPENROUTER_API_KEY=
# GOOGLE_PAGESPEED_API_KEY=
# WHOISFREAKS_API_KEY=
# FLY_PROBE_URL=
# FLY_AUTH_SECRET=
EOF
  chmod 600 "$SECRETS_FILE"
  log "Secrets generated at $SECRETS_FILE"
  echo ""
  echo "  ADMIN_KEY: $ADMIN_KEY"
  echo "  (save this — you'll need it for /usage and admin endpoints)"
  echo ""
else
  log "Secrets file already exists at $SECRETS_FILE"
fi

source "$SECRETS_FILE"

# ─── Caddy config ───────────────────────────────────────────────────

step "7/9: Caddy Configuration"
sudo mkdir -p "$LOG_DIR"

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
{
    order coraza_waf first

    coraza_waf {
        load_owasp_crs
        directives \`
            Include @coraza.conf-recommended
            Include @crs-setup.conf.example
            Include @owasp_crs/*.conf
            SecRuleEngine On

            # Yoke-specific: allow JSON request bodies for /api/analyze
            SecRequestBodyLimit 131072
            SecRequestBodyNoFilesLimit 131072

            # Paranoia level 1 — good baseline, low false positives on API traffic
            SecAction "id:900000, phase:1, pass, t:none, nolog, setvar:tx.blocking_paranoia_level=1"
        \`
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

${DOMAIN} {
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
        reverse_proxy localhost:${WORKERD_PORT} {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }
}
EOF

log "Caddyfile written for ${DOMAIN}"

# ─── workerd config ──────────────────────────────────────────────────

# Read secrets for the capnp config
SHARE_SECRET_VAL="${SHARE_SECRET:-$(openssl rand -hex 32)}"
ADMIN_KEY_VAL="${ADMIN_KEY:-$(openssl rand -hex 32)}"

sudo mkdir -p /etc/yoke /opt/yoke/data

# For now, use a minimal worker config — workerd local KV/D1 support
# varies by version, so we start with environment vars and iterate
cat > "$YOKE_DIR/workerd.capnp" <<EOF
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "yoke", worker = .yokeWorker),
  ],
  sockets = [
    (name = "http", address = "127.0.0.1:${WORKERD_PORT}", http = (), service = "yoke"),
  ],
);

const yokeWorker :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "worker/dist/worker.js"),
  ],
  compatibilityDate = "2024-12-01",
  bindings = [
    (name = "BASE_URL", text = "https://${DOMAIN}"),
    (name = "SHARE_SECRET", text = "${SHARE_SECRET_VAL}"),
    (name = "ADMIN_KEY", text = "${ADMIN_KEY_VAL}"),
    (name = "SELF_DOMAINS", text = "${DOMAIN},www.${DOMAIN}"),
  ],
);
EOF

log "workerd config written"

# ─── systemd services ───────────────────────────────────────────────

step "8/9: systemd Services"

# Yoke workerd service
sudo tee /etc/systemd/system/yoke-workerd.service > /dev/null <<EOF
[Unit]
Description=Yoke workerd
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/workerd serve ${YOKE_DIR}/workerd.capnp
Restart=on-failure
RestartSec=5
User=${USER}
WorkingDirectory=${YOKE_DIR}
Environment=HOME=/home/${USER}
# Security hardening
NoNewPrivileges=true
ProtectHome=read-only
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Caddy service (if not already managed by apt)
if [[ ! -f /etc/systemd/system/caddy.service ]] && [[ ! -f /lib/systemd/system/caddy.service ]]; then
  sudo tee /etc/systemd/system/caddy.service > /dev/null <<'EOF'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
fi

sudo systemctl daemon-reload
log "systemd units configured"

# ─── CrowdSec ───────────────────────────────────────────────────────

step "9/9: CrowdSec"
if command -v cscli &>/dev/null; then
  log "CrowdSec already installed"
else
  curl -s https://install.crowdsec.net | sudo sh
  sudo apt install -y crowdsec crowdsec-firewall-bouncer-nftables 2>/dev/null || \
    sudo apt install -y crowdsec crowdsec-firewall-bouncer-iptables
  
  # Install Caddy log parser + HTTP scenarios
  sudo cscli collections install crowdsecurity/caddy-logs
  sudo cscli collections install crowdsecurity/http-cve
  sudo cscli collections install crowdsecurity/base-http-scenarios
  
  # Point at Caddy logs
  sudo mkdir -p /etc/crowdsec/acquis.d
  sudo tee /etc/crowdsec/acquis.d/caddy.yaml > /dev/null <<EOF
filenames:
  - /var/log/caddy/access.log
labels:
  type: caddy
EOF

  sudo systemctl reload crowdsec
  log "CrowdSec installed and configured"
fi

# ─── Start services ─────────────────────────────────────────────────

step "Starting services"

echo ""
warn "Before starting, verify workerd can parse the config:"
echo "  workerd validate ${YOKE_DIR}/workerd.capnp"
echo ""
warn "Then start everything:"
echo "  sudo systemctl enable --now yoke-workerd"
echo "  sudo systemctl enable --now caddy"
echo ""
warn "Check status:"
echo "  sudo systemctl status yoke-workerd"
echo "  sudo systemctl status caddy"
echo "  curl -I https://${DOMAIN}"
echo "  curl -s https://${DOMAIN}/api/health | jq"
echo ""

# ─── Summary ─────────────────────────────────────────────────────────

step "Setup Complete"
echo ""
echo "  Domain:     https://${DOMAIN}"
echo "  workerd:    localhost:${WORKERD_PORT}"
echo "  WAF:        Coraza + OWASP CRS (paranoia level 1)"
echo "  Behavioral: CrowdSec + Caddy log parsing"
echo "  Firewall:   ufw (SSH + HTTP + HTTPS only)"
echo "  TLS:        Caddy auto-HTTPS (Let's Encrypt)"
echo ""
echo "  Secrets:    ${SECRETS_FILE}"
echo "  Logs:       ${LOG_DIR}/access.log"
echo "  Config:     /etc/caddy/Caddyfile"
echo "  Worker:     ${YOKE_DIR}/workerd.capnp"
echo ""
echo "  Admin URL:  https://${DOMAIN}/usage"
echo "  Seed data:  bash ${YOKE_DIR}/scripts/seed-domains.sh https://${DOMAIN}"
echo ""
warn "Next: add API keys to ${SECRETS_FILE} and update workerd.capnp bindings"
warn "Then restart: sudo systemctl restart yoke-workerd"
echo ""
