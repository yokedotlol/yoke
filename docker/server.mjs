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
  RATE_LIMIT_BACKEND: process.env.RATE_LIMIT_BACKEND || "do",
  FLY_PROBE_URL: "http://probe:8788",
  FLY_AUTH_SECRET: process.env.PROBE_SECRET || "",
  SITE_NAME: process.env.SITE_NAME || "Yoke",
  SITE_TAGLINE: process.env.SITE_TAGLINE || "open-source domain intelligence",
  REPO_URL: process.env.REPO_URL || "https://github.com/yokedotlol/yoke",
  FEEDBACK_URL: process.env.FEEDBACK_URL || "",
  EXTENSION_URL: process.env.EXTENSION_URL || "https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj",
  HIDE_EXTENSION: process.env.HIDE_EXTENSION || "false",
  HIDE_CLI: process.env.HIDE_CLI || "false",
  HIDE_GITHUB: process.env.HIDE_GITHUB || "false",
  IP_HASH_SALT: process.env.IP_HASH_SALT || "",
};

// Note: the worker code reads env.GOOGLE_PAGESPEED_API_KEY (not PAGESPEED_API_KEY)
if (process.env.PAGESPEED_API_KEY) {
  bindings.GOOGLE_PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY;
}

// Optional API keys — only set binding if env var is present
if (process.env.OPENROUTER_API_KEY) {
  bindings.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
}
if (process.env.WHOISFREAKS_API_KEY) {
  bindings.WHOISFREAKS_API_KEY = process.env.WHOISFREAKS_API_KEY;
}

// Analytics opt-out
if (process.env.DISABLE_ANALYTICS) {
  bindings.DISABLE_ANALYTICS = process.env.DISABLE_ANALYTICS;
}

// Cache TTL override (worker reads as string, parses to number)
if (process.env.CACHE_TTL_HOURS) {
  bindings.CACHE_TTL_HOURS = process.env.CACHE_TTL_HOURS;
}

// Rate limit overrides — worker reads these as strings
for (const key of [
  "RATE_LIMIT_ANALYZE",
  "RATE_LIMIT_COMPARE",
  "RATE_LIMIT_SUBDOMAIN",
  "RATE_LIMIT_AVAILABILITY",
  "RATE_LIMIT_RECURSIVE_DNS",
]) {
  if (process.env[key]) {
    bindings[key] = process.env[key];
  }
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

  // ── Durable Objects (in-memory rate limiter) ───────────────────
  // Eliminates D1 reads/writes for rate limiting. State is ephemeral —
  // if the DO is evicted, counters reset (acceptable for rate limiting).
  durableObjects: {
    RATE_LIMITER: "RateLimiterDO",
  },

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
