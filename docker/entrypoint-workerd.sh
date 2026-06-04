#!/bin/bash
set -euo pipefail

# ── Copy client build to shared volume ────────────────────────────
echo "Copying client assets to shared volume..."
cp -a /app/client-dist-src/. /app/client-dist/

# ── Patch domain references ───────────────────────────────────────
YOKE_DOMAIN="${YOKE_DOMAIN:-yoke-test.lol}"
if [ "$YOKE_DOMAIN" != "yoke.lol" ]; then
  echo "Patching domain references: yoke.lol → $YOKE_DOMAIN"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://yoke.lol|https://${YOKE_DOMAIN}|g" {} +
fi

# ── Ensure data directories exist ─────────────────────────────────
mkdir -p /data/kv /data/d1

echo "Starting Yoke with miniflare for $YOKE_DOMAIN..."
exec node /app/server.mjs
