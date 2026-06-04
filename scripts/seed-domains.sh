#!/usr/bin/env bash
# seed-domains.sh — Populate a Yoke instance with pre-analyzed domains.
#
# Reads domain names from the SEED_DOMAINS array in
# client/src/components/RecentLookups.tsx and fires an analysis for each
# one against the target Yoke instance. Results are cached by the
# instance, populating its D1 scores and KV cache.
#
# Usage:
#   ./scripts/seed-domains.sh                       # defaults to https://yoke.lol
#   ./scripts/seed-domains.sh https://my-yoke.example.com
#   CONCURRENCY=5 ./scripts/seed-domains.sh         # parallel requests (default: 3)
#
# Requirements: curl, grep, sed

set -euo pipefail

BASE_URL="${1:-https://yoke.lol}"
CONCURRENCY="${CONCURRENCY:-3}"

# Extract domains from the SEED_DOMAINS array in RecentLookups.tsx
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$REPO_ROOT/client/src/components/RecentLookups.tsx"

if [[ ! -f "$SOURCE" ]]; then
  echo "Error: Cannot find $SOURCE" >&2
  echo "Run this script from the repository root or its scripts/ directory." >&2
  exit 1
fi

# Parse domains from the TypeScript array literal
DOMAINS=$(grep -oP '"\K[a-zA-Z0-9][-a-zA-Z0-9.]+\.[a-zA-Z]{2,}(?=")' "$SOURCE" | sort -u)
TOTAL=$(echo "$DOMAINS" | wc -l)

echo "🌱 Seeding $TOTAL domains into $BASE_URL (concurrency: $CONCURRENCY)"
echo ""

DONE=0
FAILED=0

seed_domain() {
  local domain="$1"
  local idx="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$BASE_URL/api/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"domain\":\"$domain\"}" \
    --max-time 120)

  if [[ "$status" == "200" || "$status" == "304" ]]; then
    echo "  ✅ [$idx/$TOTAL] $domain ($status)"
  else
    echo "  ❌ [$idx/$TOTAL] $domain (HTTP $status)"
    return 1
  fi
}

export -f seed_domain
export BASE_URL TOTAL

# Run with controlled concurrency using xargs
IDX=0
echo "$DOMAINS" | while read -r domain; do
  IDX=$((IDX + 1))
  echo "$domain $IDX"
done | xargs -P "$CONCURRENCY" -L 1 bash -c 'seed_domain "$1" "$2"' _ || true

echo ""
echo "✅ Seeding complete. Domains are now cached in the target instance."
echo "   Re-run to refresh expired cache entries (24h TTL)."
