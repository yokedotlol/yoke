// ── Yoke Self-Hosted Server (Miniflare Runtime) ─────────────────────
// Replaces raw workerd with miniflare, which wraps workerd and provides
// local KV (SQLite-backed) and D1 database support with disk persistence.
//
// Miniflare is Cloudflare's official local simulator for Workers, used
// by wrangler dev under the hood. It runs the same workerd binary but
// adds storage bindings that raw workerd doesn't support standalone.

import { Miniflare, Log, LogLevel } from "miniflare";
import { readFileSync, existsSync } from "node:fs";

// ── Validate required env vars ───────────────────────────────────
const YOKE_DOMAIN = process.env.YOKE_DOMAIN;
if (!YOKE_DOMAIN) {
  console.error("ERROR: YOKE_DOMAIN is required");
  process.exit(1);
}

// ── Build bindings map ───────────────────────────────────────────
const bindings = {
  BASE_URL: `https://${YOKE_DOMAIN}`,
  SHARE_SECRET: process.env.SHARE_SECRET || "",
  ADMIN_KEY: process.env.ADMIN_KEY || "",
  SELF_DOMAINS: `${YOKE_DOMAIN},www.${YOKE_DOMAIN}`,
  FLY_PROBE_URL: "http://probe:8788",
  FLY_AUTH_SECRET: process.env.PROBE_SECRET || "",
  SITE_NAME: process.env.SITE_NAME || "Yoke",
  SITE_TAGLINE: process.env.SITE_TAGLINE || "open-source domain intelligence",
};

// Note: the worker code reads env.GOOGLE_PAGESPEED_API_KEY (not PAGESPEED_API_KEY)
if (process.env.PAGESPEED_API_KEY) {
  bindings.GOOGLE_PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY;
}

// ── Cache index.html for ASSETS service binding ──────────────────
const indexPath = "/app/client-dist/index.html";
if (!existsSync(indexPath)) {
  console.error(`ERROR: ${indexPath} not found — entrypoint should copy client assets first`);
  process.exit(1);
}
const INDEX_HTML = readFileSync(indexPath, "utf-8");

// ── Font binding paths ───────────────────────────────────────────
const FONT_DIR = "/app/worker/src/fonts";
const fontBindings = {};
const fonts = {
  FONT_INTER_REGULAR: "Inter-Regular.ttf",
  FONT_INTER_MEDIUM: "Inter-Medium.ttf",
  FONT_INTER_SEMIBOLD: "Inter-SemiBold.ttf",
  FONT_INTER_BOLD: "Inter-Bold.ttf",
  FONT_JETBRAINS_MONO: "JetBrainsMono-Regular.ttf",
};
for (const [binding, file] of Object.entries(fonts)) {
  const fontPath = `${FONT_DIR}/${file}`;
  if (existsSync(fontPath)) {
    fontBindings[binding] = fontPath;
  } else {
    console.warn(`WARN: Font not found: ${fontPath}`);
  }
}

// ── Start Miniflare ──────────────────────────────────────────────
console.log(`Initializing miniflare for ${YOKE_DOMAIN}...`);

const mf = new Miniflare({
  // ── Server ─────────────────────────────────────────────────────
  host: "0.0.0.0",
  port: 8787,

  // ── Worker module ──────────────────────────────────────────────
  // modules: true enables auto-resolution of imports (including .wasm)
  modules: true,
  scriptPath: "/app/worker/dist/worker.js",
  modulesRules: [
    { type: "CompiledWasm", include: ["**/*.wasm"] },
  ],
  compatibilityDate: "2024-12-01",

  // ── JSON/string bindings ───────────────────────────────────────
  bindings,

  // ── Font data bindings (ArrayBuffer) ───────────────────────────
  dataBlobBindings: fontBindings,

  // ── KV namespace (SQLite-backed, persistent) ───────────────────
  kvNamespaces: ["REFERENCE_DATA"],
  kvPersist: "/data/kv",

  // ── D1 database (SQLite-backed, persistent) ────────────────────
  d1Databases: ["STATS_DB"],
  d1Persist: "/data/d1",

  // ── ASSETS service binding (SPA fallback) ──────────────────────
  serviceBindings: {
    ASSETS: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(INDEX_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  },

  // ── Outbound network (public internet + Docker internal) ───────
  outboundService: {
    network: {
      allow: ["public", "private"],
      tlsOptions: { trustBrowserCas: true },
    },
  },

  // ── Logging ────────────────────────────────────────────────────
  log: new Log(LogLevel.INFO),
  verbose: true,
});

const url = await mf.ready;
console.log(`✅ Yoke running at ${url} for ${YOKE_DOMAIN}`);
console.log(`   KV persistence: /data/kv`);
console.log(`   D1 persistence: /data/d1`);

// ── Graceful shutdown ────────────────────────────────────────────
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await mf.dispose();
    process.exit(0);
  });
}
