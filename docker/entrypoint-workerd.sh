#!/bin/bash
set -euo pipefail

# ── Copy client build to shared volume ────────────────────────────
echo "Copying client assets to shared volume..."
cp -a /app/client-dist-src/. /app/client-dist/

# ── Resolve env vars with defaults ────────────────────────────────
YOKE_DOMAIN="${YOKE_DOMAIN:-yoke-test.lol}"
SITE_NAME="${SITE_NAME:-Yoke}"
REPO_URL="${REPO_URL:-https://github.com/yokedotlol/yoke}"
FEEDBACK_URL="${FEEDBACK_URL:-${REPO_URL}/issues/new/choose}"
EXTENSION_URL="${EXTENSION_URL:-https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj}"
HIDE_EXTENSION="${HIDE_EXTENSION:-false}"
HIDE_CLI="${HIDE_CLI:-false}"

# ── Patch domain references ───────────────────────────────────────
if [ "$YOKE_DOMAIN" != "yoke.lol" ]; then
  echo "Patching domain references: yoke.lol → $YOKE_DOMAIN"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://yoke.lol|https://${YOKE_DOMAIN}|g" {} +
fi

# ── Patch site name ───────────────────────────────────────────────
if [ "$SITE_NAME" != "Yoke" ]; then
  echo "Patching site name: Yoke → $SITE_NAME"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|Yoke|${SITE_NAME}|g" {} +
fi

# ── Patch GitHub/repo links ───────────────────────────────────────
if [ "$REPO_URL" != "https://github.com/yokedotlol/yoke" ]; then
  echo "Patching repo URL → $REPO_URL"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://github.com/yokedotlol/yoke|${REPO_URL}|g" {} +
fi

# ── Patch feedback/issue URL ──────────────────────────────────────
# Replace the specific "Report it on GitHub" text + link with generic "Report it"
if [ "$FEEDBACK_URL" != "https://github.com/yokedotlol/yoke/issues/new/choose" ]; then
  echo "Patching feedback URL → $FEEDBACK_URL"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://github.com/yokedotlol/yoke/issues/new/choose|${FEEDBACK_URL}|g; s|https://github.com/yokedotlol/yoke/issues/new?template=false-positive.yml|${FEEDBACK_URL}|g; s|Report it on GitHub|Report it|g" {} +
fi

# ── Patch extension URL ──────────────────────────────────────────
if [ "$EXTENSION_URL" != "https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj" ]; then
  echo "Patching extension URL → $EXTENSION_URL"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i "s|https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj|${EXTENSION_URL}|g" {} +
fi

# ── Hide extension references if requested ────────────────────────
# This removes the extension link elements by replacing them with empty strings
if [ "$HIDE_EXTENSION" = "true" ]; then
  echo "Hiding extension references"
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i 's|Chrome Extension||g; s|extension||g; s|chromewebstore.google.com[^"]*||g' {} +
fi

# ── Hide CLI references if requested ──────────────────────────────
if [ "$HIDE_CLI" = "true" ]; then
  echo "Hiding CLI references"
  # Remove "CLI" from display text but keep the page functional
  find /app/client-dist -type f \( -name '*.html' -o -name '*.js' \) \
    -exec sed -i 's|CLI, API client, or extension|API client|g; s|CLI at your instance|API at your instance|g; s|CLI at it:|API at it:|g' {} +
fi

# ── Ensure data directories exist ─────────────────────────────────
mkdir -p /data/kv /data/d1

echo "Starting ${SITE_NAME} with miniflare for $YOKE_DOMAIN..."
exec node /app/server.mjs
