#!/bin/sh
set -e

# ── Validate required env vars ────────────────────────────────────
for var in YOKE_DOMAIN SHARE_SECRET ADMIN_KEY PROBE_SECRET; do
  eval val="\$$var"
  if [ -z "$val" ]; then
    echo "ERROR: $var is required but not set" >&2
    exit 1
  fi
done

# ── Publish client assets to shared volume (for Caddy) ────────────
# Always overwrite so rebuilds propagate fresh assets
echo "Copying client assets to shared volume..."
rm -rf /app/client-dist/*
cp -r /app/client-dist-src/* /app/client-dist/

# ── Fix hardcoded yoke.lol references in index.html ───────────────
sed -i "s|https://yoke.lol|https://${YOKE_DOMAIN}|g" /app/client-dist/index.html

# ── Generate assets-shim.js (SPA fallback for workerd) ────────────
INDEX_B64=$(base64 -w0 /app/client-dist/index.html)
cat > /app/assets-shim.js << SHIMEOF
const INDEX_B64 = "${INDEX_B64}";
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
const INDEX_HTML = b64decode(INDEX_B64);
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, {
        status: 200,
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
SHIMEOF
echo "Generated assets-shim.js"

# ── Optional PageSpeed binding ────────────────────────────────────
PAGESPEED_BINDING=""
if [ -n "${PAGESPEED_API_KEY:-}" ]; then
  PAGESPEED_BINDING="    (name = \"PAGESPEED_API_KEY\", text = \"${PAGESPEED_API_KEY}\"),"
fi

# ── Generate workerd.capnp from env vars ──────────────────────────
cat > /app/workerd.capnp << EOF
using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "yoke", worker = .yokeWorker),
    (name = "assets", worker = .assetsWorker),
    (name = "internet", network = (allow = ["public", "private"], tlsOptions = (trustBrowserCas = true))),
  ],
  sockets = [
    (name = "http", address = "0.0.0.0:8787", http = (), service = "yoke"),
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
    (name = "BASE_URL", text = "https://${YOKE_DOMAIN}"),
    (name = "SHARE_SECRET", text = "${SHARE_SECRET}"),
    (name = "ADMIN_KEY", text = "${ADMIN_KEY}"),
    (name = "SELF_DOMAINS", text = "${YOKE_DOMAIN},www.${YOKE_DOMAIN}"),
    (name = "FLY_PROBE_URL", text = "http://probe:8788"),
    (name = "FLY_AUTH_SECRET", text = "${PROBE_SECRET}"),
${PAGESPEED_BINDING}
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

echo "Generated workerd.capnp for ${YOKE_DOMAIN}"
exec workerd serve /app/workerd.capnp
