// Shared route utilities — JSON helpers, auth, rate limiting
// Extracted from index.ts to be shared across route modules.

import type { Env } from "../helpers";
import { CORS_HEADERS } from "../helpers";
import { logError } from "../logger";
import { shardKeyFromIP } from "../rate-limiter-do";

// ─── JSON Response Helpers ──────────────────────────────────────────

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** Standardized error response: always { error, code, status } */
export function jsonError(error: string, code: string, status: number): Response {
  return json({ error, code, status }, status);
}

/** Clone a response with additional headers (used for rate-limit metadata) */
export function addHeaders(resp: Response, extra: Record<string, string>): Response {
  if (!Object.keys(extra).length) return resp;
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

/** JSON response without broad CORS — used for admin-only endpoints.
 *  Still includes CORS allow-origin so authenticated cross-origin requests work. */
export function adminJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

// ─── Auth ───────────────────────────────────────────────────────────

/** Constant-time string comparison to prevent timing side-channels. */
export function timingSafeEq(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  if (maxLen === 0) return true;
  const aPadded = new Uint8Array(maxLen);
  const bPadded = new Uint8Array(maxLen);
  aPadded.set(aBytes);
  bPadded.set(bBytes);
  // Constant-time compare — then check lengths match
  let mismatch = aBytes.length !== bBytes.length ? 1 : 0;
  for (let i = 0; i < maxLen; i++) mismatch |= aPadded[i] ^ bPadded[i];
  return mismatch === 0;
}

/** Verify admin Basic auth. Returns null if valid, or a Response to return if invalid. */
export function checkAdminAuth(request: Request, adminKey: string | undefined): Response | null {
  if (!adminKey) return jsonError("Admin key not configured", "ADMIN_KEY_MISSING", 503);
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Basic ")) {
    const resp = jsonError("Unauthorized", "AUTH_REQUIRED", 401);
    resp.headers.set("WWW-Authenticate", 'Basic realm="Admin"');
    return resp;
  }
  let pass: string;
  try {
    const decoded = atob(authHeader.slice(6));
    [, pass] = decoded.split(":");
  } catch {
    const resp = jsonError("Malformed credentials", "AUTH_MALFORMED", 401);
    resp.headers.set("WWW-Authenticate", 'Basic realm="Admin"');
    return resp;
  }
  if (!pass || !timingSafeEq(pass, adminKey)) {
    const resp = jsonError("Invalid credentials", "AUTH_INVALID", 401);
    resp.headers.set("WWW-Authenticate", 'Basic realm="Admin"');
    return resp;
  }
  return null; // auth passed
}

// ─── Rate Limiting ──────────────────────────────────────────────────

function getRateLimits(env: Env): Record<string, { limit: number; windowSecs: number }> {
  return {
    "/api/analyze": { limit: parseInt(env.RATE_LIMIT_ANALYZE || "20", 10), windowSecs: 3600 },
    "/api/compare": { limit: parseInt(env.RATE_LIMIT_COMPARE || "20", 10), windowSecs: 3600 },
    "/api/subdomain-scan": { limit: parseInt(env.RATE_LIMIT_SUBDOMAIN || "15", 10), windowSecs: 3600 },
    "/api/subdomains": { limit: 30, windowSecs: 3600 },
    "/api/company": { limit: 30, windowSecs: 3600 },
    "/api/news": { limit: 30, windowSecs: 3600 },
    "/api/social": { limit: 30, windowSecs: 3600 },
    "/api/reverse-ip": { limit: 30, windowSecs: 3600 },
    "/api/availability": { limit: parseInt(env.RATE_LIMIT_AVAILABILITY || "30", 10), windowSecs: 3600 },
    "/api/js-audit": { limit: 10, windowSecs: 3600 },
    "/api/track-tab": { limit: 200, windowSecs: 3600 },
    "/api/suggestions": { limit: 10, windowSecs: 3600 },
    "/api/ai-prompt": { limit: 10, windowSecs: 3600 },
    "/report": { limit: 10, windowSecs: 3600 },
  };
}

let rateLimitTableReady = false;

async function ensureRateLimitTable(db: D1Database): Promise<void> {
  if (rateLimitTableReady) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS endpoint_rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, endpoint TEXT NOT NULL, ts INTEGER NOT NULL)",
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_endpoint_rate_ip_ts ON endpoint_rate_limits(ip, endpoint, ts)"),
  ]);
  rateLimitTableReady = true;
}

// In-memory block cache: skip D1 queries for IPs already known to be rate-limited.
// Key: "ip:endpoint", Value: unix timestamp when the block expires.
// Lives only within a single Worker isolate — no cross-isolate leakage.
// Capped at 1024 entries with LRU eviction to prevent unbounded growth.
const BLOCK_CACHE_MAX = 1024;
const blockCache = new Map<string, number>();

function blockCacheSet(key: string, value: number): void {
  // Delete first so re-insertion moves key to end (Map preserves insertion order)
  blockCache.delete(key);
  blockCache.set(key, value);
  // Evict oldest entries if over capacity
  if (blockCache.size > BLOCK_CACHE_MAX) {
    const first = blockCache.keys().next().value;
    if (first !== undefined) blockCache.delete(first);
  }
}

export interface RateLimitResult {
  blocked: Response | null;
  headers: Record<string, string>;
  /** @deprecated Hits are now recorded eagerly on check. This is always a no-op. */
  record: () => Promise<void>;
}

export const rateLimitNoop = async () => {};

export async function checkRateLimit(
  db: D1Database | undefined,
  ip: string,
  endpoint: string,
  env: Env,
): Promise<RateLimitResult> {
  if (!db) return { blocked: null, headers: {}, record: rateLimitNoop };
  const limits = getRateLimits(env);
  const config = limits[endpoint];
  if (!config || config.limit === 0) return { blocked: null, headers: {}, record: rateLimitNoop };

  // Fast path: if this IP+endpoint is in the block cache, return 429 without touching D1
  const cacheKey = `${ip}:${endpoint}`;
  const now = Math.floor(Date.now() / 1000);
  const cachedResetAt = blockCache.get(cacheKey);
  if (cachedResetAt && cachedResetAt > now) {
    const secsLeft = cachedResetAt - now;
    const rlHeaders = {
      "X-RateLimit-Limit": String(config.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(cachedResetAt),
      "Retry-After": String(secsLeft),
    };
    return {
      blocked: new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          status: 429,
          limit: config.limit,
          remaining: 0,
          reset: cachedResetAt,
          window: `${config.windowSecs / 3600} hour`,
          retry_after: secsLeft,
          self_host: "https://github.com/yokedotlol/yoke#self-hosting",
          message: "For heavy usage, self-host with no limits. See our setup guide.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
            ...rlHeaders,
          },
        },
      ),
      headers: rlHeaders,
      record: rateLimitNoop,
    };
  } else if (cachedResetAt) {
    blockCache.delete(cacheKey); // expired, clean up
  }

  try {
    await ensureRateLimitTable(db);
    const cutoff = now - config.windowSecs;
    // Get count + oldest request in window (to calculate real reset time)
    const [countRow, oldestRow] = await db.batch([
      db
        .prepare("SELECT COUNT(*) as cnt FROM endpoint_rate_limits WHERE ip = ? AND endpoint = ? AND ts > ?")
        .bind(ip, endpoint, cutoff),
      db
        .prepare("SELECT MIN(ts) as oldest FROM endpoint_rate_limits WHERE ip = ? AND endpoint = ? AND ts > ?")
        .bind(ip, endpoint, cutoff),
    ]);
    const count = (countRow.results?.[0] as { cnt: number } | undefined)?.cnt ?? 0;
    const oldest = (oldestRow.results?.[0] as { oldest: number | null } | undefined)?.oldest;
    // Reset = when the oldest request in the window expires (sliding window)
    const resetAt = oldest ? oldest + config.windowSecs : now + config.windowSecs;

    if (count >= config.limit) {
      // Cache the block so subsequent requests skip D1 entirely
      blockCacheSet(cacheKey, resetAt);
      const rlHeaders = {
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetAt),
        "Retry-After": String(Math.max(1, resetAt - now)),
      };
      return {
        blocked: new Response(
          JSON.stringify({
            error: "Rate limit exceeded",
            code: "RATE_LIMITED",
            status: 429,
            limit: config.limit,
            remaining: 0,
            reset: resetAt,
            window: `${config.windowSecs / 3600} hour`,
            retry_after: config.windowSecs,
            self_host: "https://github.com/yokedotlol/yoke#self-hosting",
            message: "For heavy usage, self-host with no limits. See our setup guide.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS,
              ...rlHeaders,
            },
          },
        ),
        headers: rlHeaders,
        record: rateLimitNoop,
      };
    }
    // Record the hit immediately — all requests count against the limit
    try {
      await db
        .prepare("INSERT INTO endpoint_rate_limits (ip, endpoint, ts) VALUES (?, ?, ?)")
        .bind(ip, endpoint, now)
        .run();
      // Probabilistic cleanup: 2% chance, delete entries older than 2 hours
      if (Math.random() < 0.02) {
        const old = now - 7200;
        await db
          .prepare("DELETE FROM endpoint_rate_limits WHERE ts < ?")
          .bind(old)
          .run()
          .catch(() => {});
      }
    } catch {
      // Best-effort — don't fail the request if recording fails
    }
    const remaining = config.limit - count - 1;
    return {
      blocked: null,
      headers: {
        "X-RateLimit-Limit": String(config.limit),
        "X-RateLimit-Remaining": String(Math.max(0, remaining)),
        "X-RateLimit-Reset": String(resetAt),
      },
      record: rateLimitNoop,
    };
  } catch (err) {
    logError("rate limit DB error", { error: err instanceof Error ? err.message : String(err) });
    // Fail-open for general endpoints (they don't cost money)
  }
  return { blocked: null, headers: {}, record: rateLimitNoop };
}

// ─── Durable Object Rate Limiting ───────────────────────────────────

/**
 * DO-backed rate limit check. Zero D1 reads/writes — all state lives
 * in the Durable Object's RAM. Falls open on any DO error.
 */
export async function checkRateLimitDO(
  rateLimiter: DurableObjectNamespace | undefined,
  ip: string,
  endpoint: string,
  env: Env,
): Promise<RateLimitResult> {
  if (!rateLimiter) return { blocked: null, headers: {}, record: rateLimitNoop };
  const limits = getRateLimits(env);
  const config = limits[endpoint];
  if (!config || config.limit === 0) return { blocked: null, headers: {}, record: rateLimitNoop };

  // Fast path: in-memory block cache (shared with D1 path — avoids DO round-trip for known blocks)
  const cacheKey = `${ip}:${endpoint}`;
  const now = Math.floor(Date.now() / 1000);
  const cachedResetAt = blockCache.get(cacheKey);
  if (cachedResetAt && cachedResetAt > now) {
    const secsLeft = cachedResetAt - now;
    const rlHeaders = {
      "X-RateLimit-Limit": String(config.limit),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(cachedResetAt),
      "Retry-After": String(secsLeft),
    };
    return {
      blocked: new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          status: 429,
          limit: config.limit,
          remaining: 0,
          reset: cachedResetAt,
          window: `${config.windowSecs / 3600} hour`,
          retry_after: secsLeft,
          self_host: "https://github.com/yokedotlol/yoke#self-hosting",
          message: "For heavy usage, self-host with no limits. See our setup guide.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
            ...rlHeaders,
          },
        },
      ),
      headers: rlHeaders,
      record: rateLimitNoop,
    };
  } else if (cachedResetAt) {
    blockCache.delete(cacheKey);
  }

  try {
    const shardKey = shardKeyFromIP(ip);
    const doId = rateLimiter.idFromName(shardKey);
    const stub = rateLimiter.get(doId);

    // Record eagerly — no dry-run. Every check counts against the limit.
    const resp = await stub.fetch(
      new Request("https://do/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip,
          endpoint,
          limit: config.limit,
          windowSecs: config.windowSecs,
          dryRun: false,
        }),
      }),
    );

    if (!resp.ok) {
      // DO returned an error — fail open
      logError("rate limit DO error", { status: resp.status });
      return { blocked: null, headers: {}, record: rateLimitNoop };
    }

    const result = (await resp.json()) as { allowed: boolean; limit: number; remaining: number; resetAt: number };

    if (!result.allowed) {
      blockCacheSet(cacheKey, result.resetAt);
      const rlHeaders = {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetAt),
        "Retry-After": String(Math.max(1, result.resetAt - now)),
      };
      return {
        blocked: new Response(
          JSON.stringify({
            error: "Rate limit exceeded",
            code: "RATE_LIMITED",
            status: 429,
            limit: result.limit,
            remaining: 0,
            reset: result.resetAt,
            window: `${config.windowSecs / 3600} hour`,
            retry_after: Math.max(1, result.resetAt - now),
            self_host: "https://github.com/yokedotlol/yoke#self-hosting",
            message: "For heavy usage, self-host with no limits. See our setup guide.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS,
              ...rlHeaders,
            },
          },
        ),
        headers: rlHeaders,
        record: rateLimitNoop,
      };
    }

    return {
      blocked: null,
      headers: {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.resetAt),
      },
      record: rateLimitNoop,
    };
  } catch (err) {
    logError("rate limit DO error", { error: err instanceof Error ? err.message : String(err) });
    // Fail-open — same policy as D1 path
  }
  return { blocked: null, headers: {}, record: rateLimitNoop };
}

// ─── Unified Rate Limit Dispatcher ──────────────────────────────────

/**
 * Feature-flagged rate limit check.
 *
 * The Durable Object backend (cheaper than D1 — no per-request reads/writes) is
 * the default *whenever the RATE_LIMITER binding exists*. Set
 * RATE_LIMIT_BACKEND = "d1" to force the D1 path even with the DO bound.
 *
 * If RATE_LIMITER is not bound (e.g. a deployment that hasn't enabled the DO),
 * this safely falls back to the D1 limiter regardless of RATE_LIMIT_BACKEND.
 */
export async function checkRateLimitAuto(
  db: D1Database | undefined,
  ip: string,
  endpoint: string,
  env: Env,
): Promise<RateLimitResult> {
  const backend = env.RATE_LIMIT_BACKEND ?? "do";
  if (backend === "do" && env.RATE_LIMITER) {
    return checkRateLimitDO(env.RATE_LIMITER, ip, endpoint, env);
  }
  return checkRateLimit(db, ip, endpoint, env);
}

// ─── Route Handler Context ──────────────────────────────────────────

/** Common context passed to every route handler */
export interface RouteContext {
  request: Request;
  url: URL;
  path: string;
  method: string;
  env: Env;
  ctx?: ExecutionContext;
  /** Hashed client IP for rate limiting */
  clientIP: string;
  /** Base URL derived from request origin */
  baseUrl: string;
  /** Host derived from baseUrl */
  host: string;
  /** Branding config */
  brand: { name: string; repoUrl: string };
  /** Track a request for analytics */
  track: (endpoint: string, status: number, domain?: string) => void;
}
