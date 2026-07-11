#!/bin/bash
# Seed reference data into Cloudflare KV namespace REFERENCE_DATA
# Usage: bash scripts/seed-kv.sh [--retire-js] [--all]
#
# Data sources:
#   retire.js DB — community-maintained JS vulnerability database from GitHub
#   (other sources will be added as KV-offloaded data grows)

set -euo pipefail
cd "$(dirname "$0")/.."

# Load Cloudflare credentials (skip if already in env, e.g. CI)
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  WRANGLER_ENV="${HOME}/.wrangler/.env"
  if [ ! -f "$WRANGLER_ENV" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN not set and $WRANGLER_ENV not found" >&2; exit 1
  fi
  set -a && source "$WRANGLER_ENV" && set +a
fi
export PATH="${HOME}/.local/node22/bin:$PATH"

WRANGLER="npx wrangler"
CONFIG="--config worker/wrangler.toml"

do_retire_js() {
  echo "=== Fetching retire.js vulnerability database ==="
  local tmpfile="/tmp/retirejs-db.json"
  
  # Canonical source first, fork as fallback
  curl -sSL "https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository.json" \
    -o "$tmpfile" 2>/dev/null || {
    echo "⚠️  Canonical repo failed — trying fork"
    curl -sSL "https://raw.githubusercontent.com/nicksam112/retire.js/master/repository/jsrepository.json" \
      -o "$tmpfile" || { echo "❌ All retire.js sources failed"; return 1; }
  }
  
  # Validate it's valid JSON
  if ! python3 -c "import json; json.load(open('$tmpfile'))" 2>/dev/null; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$tmpfile','utf8'))" 2>/dev/null; then
      echo "❌ Downloaded file is not valid JSON"
      return 1
    fi
  fi
  
  local size=$(wc -c < "$tmpfile" | tr -d ' ')
  echo "   Downloaded: ${size} bytes"
  
  # Write to KV
  $WRANGLER kv key put "vulnerable-libraries-retirejs" --path "$tmpfile" \
    --binding REFERENCE_DATA $CONFIG 2>/dev/null
  echo "✅ retire.js DB written to KV (key: vulnerable-libraries-retirejs)"
  
  # Write metadata
  local meta="{\"source\":\"github.com/RetireJS/retire.js\",\"updated\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"size_bytes\":${size}}"
  echo "$meta" | $WRANGLER kv key put "vulnerable-libraries-retirejs-meta" --path /dev/stdin \
    --binding REFERENCE_DATA $CONFIG 2>/dev/null
  echo "✅ Metadata written"
  
  rm -f "$tmpfile"
}

case "${1:-all}" in
  --retire-js) do_retire_js ;;
  --all|all)
    do_retire_js
    echo ""
    echo "=== KV seed complete ==="
    ;;
  *)
    echo "Usage: $0 [--retire-js] [--all]"
    exit 1
    ;;
esac
