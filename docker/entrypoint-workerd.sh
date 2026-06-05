#!/bin/bash
set -euo pipefail

# ── Copy client build to shared volume ────────────────────────────
echo "Copying client assets to shared volume..."
cp -a /app/client-dist-src/. /app/client-dist/

# ── Resolve env vars with defaults ────────────────────────────────
YOKE_DOMAIN="${YOKE_DOMAIN:-yoke-test.lol}"
SITE_NAME="${SITE_NAME:-Yoke}"
REPO_URL="${REPO_URL:-https://github.com/yokedotlol/yoke}"
FEEDBACK_URL="${FEEDBACK_URL:-${REPO_URL}/issues}"
EXTENSION_URL="${EXTENSION_URL:-https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj}"
HIDE_EXTENSION="${HIDE_EXTENSION:-false}"
HIDE_CLI="${HIDE_CLI:-false}"
HIDE_GITHUB="${HIDE_GITHUB:-false}"

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

# ── Inject runtime config ─────────────────────────────────────────
# Write config as an external JS file so it's allowed by CSP (script-src 'self').
# Inline <script> injection would be blocked by the SHA-256 allowlist.
CONFIG_JSON=$(cat <<JSEOF
{"repoUrl":"${REPO_URL}","feedbackUrl":"${FEEDBACK_URL}","extensionUrl":"${EXTENSION_URL}","hideGithub":${HIDE_GITHUB},"hideExtension":${HIDE_EXTENSION},"hideCli":${HIDE_CLI}}
JSEOF
)
echo "Injecting runtime config"
echo "window.__YOKE_CONFIG__=${CONFIG_JSON};" > /app/client-dist/assets/config.js
find /app/client-dist -name '*.html' \
  -exec sed -i 's|</head>|<script src="/assets/config.js"></script></head>|' {} +

# ── Remove social rel="me" links when white-labeling ──────────────
if [ "$SITE_NAME" != "Yoke" ]; then
  find /app/client-dist -name '*.html' \
    -exec sed -i '/rel="me".*yokedotlol/d' {} +
fi

# ── Ensure data directories exist ─────────────────────────────────
mkdir -p /data/kv /data/d1

echo "Starting ${SITE_NAME} with miniflare for $YOKE_DOMAIN..."
exec node /app/server.mjs
