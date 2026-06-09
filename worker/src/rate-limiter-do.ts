/**
 * Durable Object–based rate limiter.
 *
 * Replaces per-request D1 reads/writes with in-memory sliding-window
 * counters that live inside a Durable Object. Sharded by hashed-IP
 * prefix so no single DO becomes a bottleneck.
 *
 * State is ephemeral by design — if the DO is evicted, counters reset
 * and clients get a free window. This is acceptable for rate limiting.
 *
 * The DO stores nothing in durable storage; all state lives in RAM.
 * An alarm fires periodically to garbage-collect expired windows.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface CheckRequest {
  ip: string;
  endpoint: string;
  limit: number;
  windowSecs: number;
  /** If true, just check — don't record. Used for cache-hit paths. */
  dryRun?: boolean;
}

interface CheckResponse {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

// ─── Durable Object ─────────────────────────────────────────────────

/** Number of DO shards — client IPs are distributed across these. */
export const RATE_LIMITER_SHARD_COUNT = 256;

/**
 * Derive the shard key from a hashed IP string.
 * Takes the first 2 hex chars (0x00–0xFF) mod SHARD_COUNT.
 */
export function shardKeyFromIP(hashedIP: string): string {
  const byte = parseInt(hashedIP.slice(0, 2), 16) || 0;
  return `shard-${byte % RATE_LIMITER_SHARD_COUNT}`;
}

export class RateLimiterDO {
  private state: DurableObjectState;

  /**
   * Sliding-window timestamps per key.
   * Key: `${hashedIP}:${endpoint}`, Value: sorted array of unix-second timestamps.
   */
  private windows = new Map<string, number[]>();

  /** GC alarm interval — every 60 seconds. */
  private static readonly GC_INTERVAL_MS = 60_000;

  /** Maximum entries before forced eviction of coldest keys. */
  private static readonly MAX_KEYS = 10_000;

  constructor(state: DurableObjectState) {
    this.state = state;
    // Schedule the first GC alarm
    this.state.storage.getAlarm().then((alarm) => {
      if (!alarm) {
        this.state.storage.setAlarm(Date.now() + RateLimiterDO.GC_INTERVAL_MS);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/check" && request.method === "POST") {
      try {
        const body = (await request.json()) as CheckRequest;
        const result = this.checkLimit(body);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        // Return a structured error so the caller can fail-open
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "DO internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          keys: this.windows.size,
          totalEntries: Array.from(this.windows.values()).reduce((s, a) => s + a.length, 0),
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    this.gc();
    // Reschedule
    this.state.storage.setAlarm(Date.now() + RateLimiterDO.GC_INTERVAL_MS);
  }

  // ─── Core Logic ─────────────────────────────────────────────────

  private checkLimit(req: CheckRequest): CheckResponse {
    const { ip, endpoint, limit, windowSecs, dryRun } = req;
    const key = `${ip}:${endpoint}`;
    const now = Math.floor(Date.now() / 1000);
    const cutoff = now - windowSecs;

    let timestamps = this.windows.get(key);

    if (timestamps) {
      // Evict expired entries (timestamps are sorted, so binary-search the cutoff)
      const idx = this.bisectRight(timestamps, cutoff);
      if (idx > 0) {
        timestamps = timestamps.slice(idx);
        if (timestamps.length === 0) {
          this.windows.delete(key);
        } else {
          this.windows.set(key, timestamps);
        }
      }
    }

    const count = timestamps?.length ?? 0;
    const oldest = timestamps?.[0] ?? now;
    const resetAt = oldest + windowSecs;

    if (count >= limit) {
      return { allowed: false, limit, remaining: 0, resetAt };
    }

    if (!dryRun) {
      // Record this request
      if (!timestamps) {
        this.windows.set(key, [now]);
      } else {
        timestamps.push(now);
      }
      this.maybeEvictColdKeys();
    }

    const remaining = limit - count - (dryRun ? 0 : 1);
    return { allowed: true, limit, remaining: Math.max(0, remaining), resetAt };
  }

  /**
   * Find the index of the first element > value (all elements <= value are before it).
   * Used to efficiently trim expired timestamps from the sorted array.
   */
  private bisectRight(arr: number[], value: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Garbage-collect all fully-expired windows. */
  private gc(): void {
    const now = Math.floor(Date.now() / 1000);
    // Most generous window is 3600s, but GC anything older than 2h to be safe
    const cutoff = now - 7200;

    for (const [key, timestamps] of this.windows) {
      // If the newest timestamp is older than cutoff, the entire key is dead
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.windows.delete(key);
        continue;
      }
      // Trim stale entries from the front
      const idx = this.bisectRight(timestamps, cutoff);
      if (idx > 0) {
        const trimmed = timestamps.slice(idx);
        if (trimmed.length === 0) {
          this.windows.delete(key);
        } else {
          this.windows.set(key, trimmed);
        }
      }
    }
  }

  /**
   * If the map exceeds MAX_KEYS, evict the keys with the oldest latest-timestamp
   * (i.e., the "coldest" clients get dropped first).
   */
  private maybeEvictColdKeys(): void {
    if (this.windows.size <= RateLimiterDO.MAX_KEYS) return;

    // Sort keys by their most recent timestamp ascending (coldest first)
    const entries = Array.from(this.windows.entries());
    entries.sort((a, b) => {
      const aLast = a[1][a[1].length - 1] ?? 0;
      const bLast = b[1][b[1].length - 1] ?? 0;
      return aLast - bLast;
    });

    // Evict 10% of keys
    const toEvict = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toEvict; i++) {
      this.windows.delete(entries[i][0]);
    }
  }
}
