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
  
  # Fetch the canonical generated database. Fail on HTTP errors so an error page
  # can never reach KV as reference data.
  curl -fsSL "https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository.json" \
    -o "$tmpfile" || { echo "❌ retire.js source fetch failed"; return 1; }

  # Validate the object shape, not just JSON syntax. Each library entry must
  # provide extractors and a vulnerability list.
  if ! python3 - "$tmpfile" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

if not isinstance(data, dict) or not data:
    raise ValueError("retire.js database must be a non-empty object")

for name, entry in data.items():
    if not isinstance(entry, dict):
        raise ValueError(f"{name}: entry must be an object")
    if not isinstance(entry.get("extractors"), dict):
        raise ValueError(f"{name}: missing extractors object")
    if not isinstance(entry.get("vulnerabilities"), list):
        raise ValueError(f"{name}: missing vulnerabilities list")
PY
  then
    echo "❌ Downloaded retire.js database has an invalid structure"
    return 1
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
