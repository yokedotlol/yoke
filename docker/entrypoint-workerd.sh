#!/bin/bash
set -euo pipefail

# ── Copy client build to shared volume ────────────────────────────
echo "Copying client assets to shared volume..."
cp -a /app/client-dist-src/. /app/client-dist/

# ── Patch domain references ───────────────────────────────────────
YOKE_DOMAIN="${YOKE_DOMAIN:-yoke-test.lol}"
SITE_NAME="${SITE_NAME:-Yoke}"
if [ "$YOKE_DOMAIN" != "yoke.lol" ]; then
  echo "Patching domain references: yoke.lol → $YOKE_DOMAIN"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://yoke.lol|https://${YOKE_DOMAIN}|g" {} +
fi

if [ "$SITE_NAME" != "Yoke" ]; then
  echo "Patching site name: Yoke → $SITE_NAME"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|— Yoke|— ${SITE_NAME}|g; s|\"Yoke\"|\"${SITE_NAME}\"|g; s|alt=\"Yoke\"|alt=\"${SITE_NAME}\"|g; s|content=\"Yoke\"|content=\"${SITE_NAME}\"|g" {} +
fi

# ── Ensure data directories exist ─────────────────────────────────
mkdir -p /data/kv /data/d1

echo "Starting Yoke with miniflare for $YOKE_DOMAIN..."
exec node /app/server.mjs
