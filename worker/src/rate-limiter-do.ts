/**
 * Durable Object–based rate limiter.
 *
 * Replaces per-request D1 reads/writes with in-memory sliding-window
 * counters that live inside a Durable Object. Sharded by hashed-IP
 * prefix so no single DO becomes a bottleneck.
 *
 * State is persisted to durable storage so counters survive DO eviction
 * and redeployment. On wake, the DO hydrates from storage (one list()
 * call), then serves entirely from RAM. Writes are fire-and-forget
 * (storage.put without await in the hot path) — the in-memory map is
 * authoritative for the lifetime of the DO instance.
 *
 * An alarm fires periodically to garbage-collect expired windows
 * from both RAM and storage.
 */

// ─── Types ──────────────────────────────────────────────────────────

interface CheckRequest {
  ip: string;
  endpoint: string;
  limit: number;
  windowSecs: number;
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

/** Storage key prefix for window entries. */
const SK = "w:";

export class RateLimiterDO {
  private state: DurableObjectState;

  /**
   * Sliding-window timestamps per key.
   * Key: `${hashedIP}:${endpoint}`, Value: sorted array of unix-second timestamps.
   */
  private windows = new Map<string, number[]>();

  /** Whether we've hydrated from durable storage this wake cycle. */
  private hydrated = false;

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

  /** Hydrate in-memory windows from durable storage (once per DO wake). */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const entries = await this.state.storage.list<number[]>({ prefix: SK });
    for (const [storageKey, timestamps] of entries) {
      this.windows.set(storageKey.slice(SK.length), timestamps);
    }
    this.hydrated = true;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/check" && request.method === "POST") {
      try {
        await this.hydrate();
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
      await this.hydrate();
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
    await this.hydrate();
    this.gc();
    // Reschedule
    this.state.storage.setAlarm(Date.now() + RateLimiterDO.GC_INTERVAL_MS);
  }

  // ─── Core Logic ─────────────────────────────────────────────────

  private checkLimit(req: CheckRequest): CheckResponse {
    const { ip, endpoint, limit, windowSecs } = req;
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
          this.state.storage.delete(`${SK}${key}`);
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

    // Record this request
    if (!timestamps) {
      this.windows.set(key, [now]);
    } else {
      timestamps.push(now);
    }
    // Persist to durable storage (fire-and-forget — RAM is authoritative)
    const val = this.windows.get(key); if (val !== undefined) this.state.storage.put(`${SK}${key}`, val);
    this.maybeEvictColdKeys();

    const remaining = limit - count - 1;
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

  /** Garbage-collect all fully-expired windows from RAM and storage. */
  private gc(): void {
    const now = Math.floor(Date.now() / 1000);
    // Most generous window is 3600s, but GC anything older than 2h to be safe
    const cutoff = now - 7200;
    const toDelete: string[] = [];
    const toUpdate: Record<string, number[]> = {};

    for (const [key, timestamps] of this.windows) {
      // If the newest timestamp is older than cutoff, the entire key is dead
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.windows.delete(key);
        toDelete.push(`${SK}${key}`);
        continue;
      }
      // Trim stale entries from the front
      const idx = this.bisectRight(timestamps, cutoff);
      if (idx > 0) {
        const trimmed = timestamps.slice(idx);
        if (trimmed.length === 0) {
          this.windows.delete(key);
          toDelete.push(`${SK}${key}`);
        } else {
          this.windows.set(key, trimmed);
          toUpdate[`${SK}${key}`] = trimmed;
        }
      }
    }

    // Batch storage operations (fire-and-forget)
    if (toDelete.length > 0) {
      this.state.storage.delete(toDelete);
    }
    if (Object.keys(toUpdate).length > 0) {
      this.state.storage.put(toUpdate);
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
    const storageDeletes: string[] = [];
    for (let i = 0; i < toEvict; i++) {
      this.windows.delete(entries[i][0]);
      storageDeletes.push(`${SK}${entries[i][0]}`);
    }
    if (storageDeletes.length > 0) {
      this.state.storage.delete(storageDeletes);
    }
  }
}
