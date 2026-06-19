// Cloudflare Worker environment bindings
export interface Env {
  STATS_DB: D1Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Self-hosted font data bindings (workerd data embeds) — used when KV is unavailable */
  FONT_INTER_REGULAR?: ArrayBuffer;
  FONT_INTER_MEDIUM?: ArrayBuffer;
  FONT_INTER_SEMIBOLD?: ArrayBuffer;
  FONT_INTER_BOLD?: ArrayBuffer;
  FONT_JETBRAINS_MONO?: ArrayBuffer;
  OPENROUTER_API_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  GOOGLE_PAGESPEED_API_KEY?: string;
  WHOISFREAKS_API_KEY?: string;
  ADMIN_KEY?: string;
  /** Shared key for .lol family service bindings */
  SERVICE_KEY?: string;
  BASE_URL?: string;
  FLY_PROBE_URL?: string;
  FLY_AUTH_SECRET?: string;
  /** Rate limit overrides (set to "0" to disable a specific limit) */
  RATE_LIMIT_ANALYZE?: string;
  RATE_LIMIT_COMPARE?: string;
  RATE_LIMIT_SUBDOMAIN?: string;
  RATE_LIMIT_AVAILABILITY?: string;
  RATE_LIMIT_RECURSIVE_DNS?: string;
  /** Secret salt for IP hashing (GDPR pseudonymization) */
  IP_HASH_SALT?: string;
  /** HMAC secret for signing share card URLs */
  SHARE_SECRET?: string;
  /** KV namespace for reference data (retire.js DB, third-party patterns, etc.) */
  REFERENCE_DATA: KVNamespace;
  /** Analysis cache TTL override in hours (default: 1) */
  CACHE_TTL_HOURS?: string;
  /** Rate limit backend: "do" (Durable Object) or "d1". Default: "do" when the
   *  RATE_LIMITER binding is present, else "d1". Set to "d1" to force the D1
   *  path even when the DO is bound. */
  RATE_LIMIT_BACKEND?: string;
  /** Durable Object namespace for rate limiting (required when RATE_LIMIT_BACKEND=do) */
  RATE_LIMITER?: DurableObjectNamespace;
  /** Durable Object namespace for the global daily analysis budget (single instance). */
  ANALYSIS_BUDGET?: DurableObjectNamespace;
  /** Global daily analysis (cache-miss) ceiling. Default: 3000. Resets 00:00 UTC. */
  GLOBAL_ANALYSIS_BUDGET?: string;
  /** Hours before a legitimately-analyzed badge triggers a refresh-on-view. Default: 6. */
  BADGE_REFRESH_INTERVAL_HRS?: string;
  /** Days after which a badge is served as "stale — re-scan". Default: 30. */
  BADGE_STALE_DAYS?: string;
  /** Retention window (days) for request_meta rows in the cleanup path. Default: 90. */
  REQUEST_META_RETENTION_DAYS?: string;
  /** Comma-separated list of self-hosted domain names (for self-fetch bypass). Defaults to yoke.lol. */
  SELF_DOMAINS?: string;
  /** Custom site name for self-hosted instances (default: "Yoke") */
  SITE_NAME?: string;
  /** Custom tagline for self-hosted instances (default: "open-source domain intelligence") */
  SITE_TAGLINE?: string;
  /** Custom repo URL for source/issues links (default: yokedotlol/yoke GitHub) */
  REPO_URL?: string;
  /** Custom feedback/issue URL (default: repo issues) */
  FEEDBACK_URL?: string;
  UPTIME_URL?: string;
  /** Custom Chrome extension URL (default: Yoke extension) */
  EXTENSION_URL?: string;
  /** Set "true" to hide Chrome extension links */
  HIDE_EXTENSION?: string;
  /** Set "true" to hide CLI links */
  HIDE_CLI?: string;
  /** Set "true" to hide GitHub repo links in footer */
  HIDE_GITHUB?: string;
  /** Set "true" to disable endpoint usage tracking and tab view analytics (self-hosted) */
  DISABLE_ANALYTICS?: string;
  /** Execution context for ctx.waitUntil — set per-request from the Worker fetch handler */
  _ctx?: ExecutionContext;
}

// ─── Shared Helpers ──────────────────────────────────────────────────

// Re-export from centralized config for backward compatibility
import { getAnalysisCacheTtlMs } from "./config/cache";

export { getAnalysisCacheTtlMs };

// ─── Domain Validation ───────────────────────────────────────────────

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidDomain(domain: string): boolean {
  // Reject obvious injection chars early (DOMAIN_RE also rejects, but be explicit)
  if (/[<>'"]/.test(domain)) return false;
  return DOMAIN_RE.test(domain) && domain.includes(".");
}

/** Normalize and validate a domain string. Returns the cleaned domain or null if invalid. */
export function cleanDomain(raw: string): string | null {
  const d = normalizeDomain(raw);
  // Reject IP literals (IPv4 and IPv6)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(d)) return null;
  if (/^\[.*\]$/.test(d) || d === "::1" || d.includes(":")) return null;
  return isValidDomain(d) ? d : null;
}

export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/.*$/, "");
  // Strip www. prefix — www.github.com and github.com are the same site
  d = d.replace(/^www\./, "");
  // Convert IDN (Unicode) domains to punycode via the URL API
  try {
    const url = new URL(`http://${d}`);
    d = url.hostname;
  } catch {
    /* not a valid URL, keep as-is for downstream validation */
  }
  // Strip www. again in case the URL constructor re-added it
  d = d.replace(/^www\./, "");
  return d;
}

export async function fetchWithTimeout(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 8000, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Self-Domain Detection ───────────────────────────────────────────

const DEFAULT_SELF_DOMAINS = ["yoke.lol", "www.yoke.lol"];

/** True when the domain being analyzed is Yoke itself (CF Workers can't subrequest own routes). */
export function isSelfDomain(domain: string, envSelfDomains?: string): boolean {
  const domains = envSelfDomains ? envSelfDomains.split(",").map((d) => d.trim().toLowerCase()) : DEFAULT_SELF_DOMAINS;
  return domains.includes(domain.toLowerCase());
}

// ─── Proxy-Aware HEAD Probe ──────────────────────────────────────────

export interface HeadProbeResult {
  ok: boolean;
  status: number;
  contentType: string;
}

/**
 * HEAD-probe a URL with automatic Fly proxy fallback.
 * - Self-domain: always routes through Fly (CF Workers can't self-fetch).
 * - Other domains: tries direct first, falls back to Fly on failure
 *   (catches sites that block CF Workers, e.g. GoDaddy).
 */
export async function probeHeadWithFallback(
  url: string,
  env: Env,
  opts?: { timeout?: number },
): Promise<HeadProbeResult> {
  const timeout = opts?.timeout ?? 10_000;
  const parsedUrl = new URL(url);
  const forceFly = isSelfDomain(parsedUrl.hostname, env.SELF_DOMAINS);

  // Try direct HEAD first (unless self-domain)
  if (!forceFly) {
    try {
      const resp = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow", timeout });
      if (resp.ok && resp.status === 200) {
        return { ok: true, status: resp.status, contentType: resp.headers.get("content-type") ?? "" };
      }
      // HEAD returned non-200 (e.g. Akamai 403) — retry with GET.
      // Many WAFs block HEAD but allow GET. We only need status + content-type,
      // so cancel the body immediately to stay light.
      try {
        const getResp = await fetchWithTimeout(url, { redirect: "follow", timeout });
        getResp.body?.cancel().catch(() => {});
        return {
          ok: getResp.ok && getResp.status === 200,
          status: getResp.status,
          contentType: getResp.headers.get("content-type") ?? "",
        };
      } catch {
        // GET also failed — return the original HEAD result
        return { ok: false, status: resp.status, contentType: resp.headers.get("content-type") ?? "" };
      }
    } catch {
      // Direct fetch failed (timeout, network error, CF block) — fall through to Fly
    }
  }

  // Route through Fly proxy
  try {
    const flyUrl = getFlyProbeUrl(env);
    const resp = await flyProbeFetch(`${flyUrl}/probe-fetch?url=${encodeURIComponent(url)}`, env, {
      timeout,
    });
    if (!resp) {
      return { ok: false, status: 0, contentType: "" };
    }
    const data = (await resp.json()) as { status?: number; headers?: Record<string, string[]>; error?: string };
    if (data.error || !data.status) {
      return { ok: false, status: data.status ?? 0, contentType: "" };
    }
    const ct = data.headers?.["Content-Type"]?.[0] ?? "";
    return { ok: data.status >= 200 && data.status < 300, status: data.status, contentType: ct };
  } catch {
    return { ok: false, status: 0, contentType: "" };
  }
}

// ─── Version ─────────────────────────────────────────────────────────

export const YOKE_VERSION = "2.4.0";

/** Minimum CLI version required. Bump when shipping breaking API changes. */
export const MIN_CLIENT_VERSION = "2.0.0";

// ─── Shared Constants ────────────────────────────────────────────────

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // Intentionally omit DELETE from CORS methods — admin DELETE endpoints
  // (e.g., DELETE /api/cache) should not be callable cross-origin from browsers.
  // Non-browser clients (curl, scripts) ignore CORS and can still use DELETE with auth.
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-OpenRouter-Key, Authorization",
  "Access-Control-Expose-Headers": "X-Yoke-Version, X-Yoke-Min-Client",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'self' https://*.chromiumapp.org chrome-extension://*",
  "X-Yoke-Version": YOKE_VERSION,
  "X-Yoke-Min-Client": MIN_CLIENT_VERSION,
};

export const MULTI_PART_TLDS = ["co.uk", "com.au", "co.nz", "co.jp", "com.br", "co.in", "org.uk", "net.au", "ac.uk"];

// ─── External Service URLs ───────────────────────────────────────────

const DEFAULT_FLY_PROBE_URL = "https://yoke-probe.fly.dev";

/** Derive the Fly probe URL from env, without module-level mutation. */
export function getFlyProbeUrl(env: Env): string {
  return env.FLY_PROBE_URL || DEFAULT_FLY_PROBE_URL;
}

/**
 * Fetch from the Fly probe with auth + 429 retry.
 * On rate limit (429), waits 2s and retries once. Returns null if both attempts fail.
 */
export async function flyProbeFetch(
  url: string,
  env: Env,
  opts: RequestInit & { timeout?: number } = {},
): Promise<Response | null> {
  const authSecret = env.FLY_AUTH_SECRET;
  const headers = new Headers(opts.headers || {});
  if (authSecret) headers.set("Authorization", `Bearer ${authSecret}`);
  const fetchOpts = { ...opts, headers };

  let resp = await fetchWithTimeout(url, fetchOpts);
  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 2000));
    resp = await fetchWithTimeout(url, fetchOpts);
    if (resp.status === 429) return null;
  }
  return resp;
}

/** SHA-256 hash of IP + static salt — privacy-safe rate-limit key.
 *  Truncated to 16 hex chars: enough for uniqueness, not reversible.
 *  Uses a static salt (no daily rotation) so rate-limit state is stable
 *  across UTC day boundaries. */
export async function hashIp(ip: string, env?: { IP_HASH_SALT?: string }): Promise<string> {
  const salt = env?.IP_HASH_SALT || "yoke-default-salt";
  const data = new TextEncoder().encode(`${ip}:${salt}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** Derive the instance base URL from a request, with optional env override. */
export function getBaseUrl(request: Request, env?: Env): string {
  if (env?.BASE_URL) return env.BASE_URL.replace(/\/$/, "");
  return new URL(request.url).origin;
}

/** Branding config resolved from env vars (supports white-labeling for self-hosted). */
export interface Branding {
  name: string; // "Yoke" or custom
  domain: string; // "yoke.lol" or custom
  tagline: string; // "open-source domain intelligence" or custom
  nameUpper: string; // "YOKE" or custom uppercase
  repoUrl: string; // GitHub repo URL (for source/issues links)
  feedbackUrl: string; // Feedback/issue reporting URL
  extensionUrl: string; // Chrome extension URL (empty = hidden)
  showExtension: boolean; // Whether to show extension links
  showCli: boolean; // Whether to show CLI links
}

/** Resolve branding from env vars + request context. */
export function getBranding(request: Request, env?: Env): Branding {
  const domain = getBaseUrl(request, env).replace(/^https?:\/\//, "");
  const name = env?.SITE_NAME || "Yoke";
  const tagline = env?.SITE_TAGLINE || "open-source domain intelligence";
  const repoUrl = env?.REPO_URL || "https://github.com/yokedotlol/yoke";
  const feedbackUrl = env?.FEEDBACK_URL || `${repoUrl}/issues/new/choose`;
  const extensionUrl =
    env?.EXTENSION_URL || "https://chromewebstore.google.com/detail/yoke/fghkhjlelidaepapcdfjifnlcjmkgpcj";
  const showExtension = env?.HIDE_EXTENSION !== "true";
  const showCli = env?.HIDE_CLI !== "true";
  return {
    name,
    domain,
    tagline,
    nameUpper: name.toUpperCase(),
    repoUrl,
    feedbackUrl,
    extensionUrl,
    showExtension,
    showCli,
  };
}

// ─── SSRF Protection ─────────────────────────────────────────────────
// Block fetches to private/reserved IP ranges from the Worker.
// The Fly probe has its own Go-level IP check; this protects Worker-side fetches.

const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local
  /^0\./, // unspecified
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^192\.0\.0\./, // IETF protocol
  /^192\.0\.2\./, // documentation (TEST-NET-1)
  /^198\.51\.100\./, // documentation (TEST-NET-2)
  /^203\.0\.113\./, // documentation (TEST-NET-3)
  /^198\.1[89]\./, // benchmarking
  /^2[45]\d\./, // multicast + reserved (240-255)
];

/** Check if a URL points to a private/reserved IP or localhost. */
export function isBlockedUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    // Block localhost variants
    if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
    // Block IPv6 private/link-local/multicast — only actual IPv6 literals (contain colons)
    if (
      host.includes(":") &&
      (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("ff"))
    )
      return true;
    // Block IPv4 private
    for (const pat of PRIVATE_IP_PATTERNS) {
      if (pat.test(host)) return true;
    }
    return false;
  } catch {
    return true; // malformed URL = block
  }
}

/**
 * Follow redirects manually with SSRF protection.
 * Checks each redirect Location against private IP ranges before following.
 * Returns the final response. Max 5 hops.
 */
export async function safeFetchWithRedirects(
  url: string,
  opts: RequestInit & { timeout?: number; maxRedirects?: number } = {},
): Promise<Response> {
  const { maxRedirects = 5, ...fetchOpts } = opts;
  let currentUrl = url;

  for (let i = 0; i <= maxRedirects; i++) {
    if (isBlockedUrl(currentUrl)) {
      throw new Error(`Blocked: private/reserved IP in URL ${currentUrl}`);
    }
    const res = await fetchWithTimeout(currentUrl, { ...fetchOpts, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && i < maxRedirects) {
      const location = res.headers.get("location");
      if (location) {
        currentUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
        continue;
      }
    }
    return res;
  }
  throw new Error("Too many redirects");
}

// ─── Bounded Text Reader ─────────────────────────────────────────────
// Reads response body up to maxBytes to prevent unbounded memory usage
// from malicious or oversized target-controlled responses.

export async function boundedText(response: Response, maxBytes: number = 2 * 1024 * 1024): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } catch {
    // Read error — return what we have
  }
  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

// ─── KV Cache Helpers ────────────────────────────────────────────────

/** Build a KV cache key from domain + cache type. */
function cacheKey(domain: string, cacheType: string): string {
  return `cache:${cacheType}:${domain}`;
}

/** Convert a TTL in milliseconds to whole seconds (minimum 60 for KV). */
function ttlSeconds(ttlMs: number): number {
  return Math.max(60, Math.ceil(ttlMs / 1000));
}

export async function getFromCache(
  kv: KVNamespace,
  domain: string,
  cacheType: string,
  ttlMs: number,
): Promise<unknown | null> {
  try {
    const raw = await kv.get(cacheKey(domain, cacheType), "text");
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { data: unknown; cached_at: number };
    // Double-check TTL in case KV expiry is lagging (eventual consistency)
    if (Date.now() - envelope.cached_at > ttlMs) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

export async function setCache(
  kv: KVNamespace,
  domain: string,
  cacheType: string,
  data: unknown,
  ttlMs?: number,
): Promise<void> {
  const envelope = { data, cached_at: Date.now() };
  const expirationTtl = ttlMs ? ttlSeconds(ttlMs) : 86400; // default 24h
  try {
    await kv.put(cacheKey(domain, cacheType), JSON.stringify(envelope), { expirationTtl });
  } catch (e) {
    console.warn(`[yoke:cache] KV write failed for ${cacheType}:${domain}:`, e instanceof Error ? e.message : e);
  }
}

// ─── Background Work Helper ──────────────────────────────────────────
// Wraps a promise in ctx.waitUntil() if ExecutionContext is available,
// so the work continues after the response is sent without blocking it.

export function backgroundWork(env: Env, work: Promise<unknown>): void {
  if (env._ctx) {
    env._ctx.waitUntil(work.catch(() => {}));
  }
  // If no ctx, the promise just runs — caller doesn't await it anyway
}
