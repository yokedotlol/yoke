#!/bin/bash
set -e
cd "$(dirname "$0")"

# ── Usage ────────────────────────────────────────────────────────────
usage() {
  echo "Usage: bash deploy.sh [target]"
  echo ""
  echo "Targets (default: deploy everything):"
  echo "  --all   Deploy Cloudflare Worker + Fly probe (same as no args)"
  echo "  --cf    Deploy Cloudflare Worker only"
  echo "  --fly   Deploy Fly.io probe only"
  echo ""
  echo "Examples:"
  echo "  bash deploy.sh --all"
  echo "  bash deploy.sh --cf"
  echo "  bash deploy.sh --fly"
  exit 1
}

# ── Parse flags ──────────────────────────────────────────────────────
DEPLOY_CF=false
DEPLOY_FLY=false

if [[ $# -eq 0 ]]; then
  # Default: deploy everything (keep them in sync)
  DEPLOY_CF=true
  DEPLOY_FLY=true
fi

for arg in "$@"; do
  case "$arg" in
    --all) DEPLOY_CF=true; DEPLOY_FLY=true ;;
    --cf)  DEPLOY_CF=true ;;
    --fly) DEPLOY_FLY=true ;;
    *)     echo "Unknown flag: $arg"; echo ""; usage ;;
  esac
done

# ── Cloudflare Worker ────────────────────────────────────────────────
if $DEPLOY_CF; then
  if [[ ! -f worker/wrangler.toml ]]; then
    echo "❌ worker/wrangler.toml not found."
    echo "   Copy worker/wrangler.toml.example to worker/wrangler.toml and fill in your values."
    exit 1
  fi

  echo "🔨 Building client..."
  cd client && bun run build.ts && cd ..

  # ── Deploy Main Worker ──
  echo "🔨 Building worker..."
  cd worker && bun run build && cd ..

  echo "🚀 Deploying to Cloudflare..."
  cd worker
  if ! bun x wrangler deploy; then
    echo "❌ Cloudflare Worker deploy failed"
    exit 1
  fi
  cd ..

  echo "✅ Cloudflare Worker deployed"
fi

# ── Fly.io Probe ─────────────────────────────────────────────────────
if $DEPLOY_FLY; then
  if [[ ! -f fly-proxy/fly.toml ]]; then
    echo "❌ fly-proxy/fly.toml not found."
    echo "   Copy fly-proxy/fly.toml.example to fly-proxy/fly.toml and fill in your values."
    exit 1
  fi

  if ! command -v fly &>/dev/null; then
    echo "❌ fly CLI not found. Install it: curl -L https://fly.io/install.sh | sh"
    exit 1
  fi

  echo "🚀 Deploying Fly probe..."
  FLY_APP=$(grep '^app' fly-proxy/fly.toml | head -1 | sed 's/app *= *"\(.*\)"/\1/')

  # Pass MaxMind license key as build arg if available
  BUILD_ARGS=""
  if [ -n "${MAXMIND_LICENSE_KEY:-}" ]; then
    BUILD_ARGS="--build-arg MAXMIND_LICENSE_KEY=$MAXMIND_LICENSE_KEY"
  fi

  if ! fly deploy -a "$FLY_APP" -c fly-proxy/fly.toml $BUILD_ARGS fly-proxy/; then
    echo "❌ Fly probe deploy failed"
    exit 1
  fi

  echo "✅ Fly probe deployed"
fi

echo ""
echo "🐂 Done."
