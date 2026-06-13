// RateLimiterDO unit tests — sliding window, durable storage persistence, GC, cold key eviction.

import { RateLimiterDO } from "@worker/rate-limiter-do";
import { describe, expect, it } from "vitest";

/** In-memory DurableObjectState.storage stub with list/put/delete/getAlarm/setAlarm. */
function stubState() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    store, // expose for assertions
    state: {
      storage: {
        get: async (key: string) => store.get(key),
        put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
          if (typeof keyOrEntries === "string") {
            store.set(keyOrEntries, value);
          } else {
            for (const [k, v] of Object.entries(keyOrEntries)) {
              store.set(k, v);
            }
          }
        },
        delete: async (keyOrKeys: string | string[]) => {
          if (typeof keyOrKeys === "string") {
            return store.delete(keyOrKeys);
          }
          for (const k of keyOrKeys) store.delete(k);
          return true;
        },
        list: async <T>(opts?: { prefix?: string }) => {
          const prefix = opts?.prefix ?? "";
          const result = new Map<string, T>();
          for (const [k, v] of store) {
            if (k.startsWith(prefix)) result.set(k, v as T);
          }
          return result;
        },
        getAlarm: async () => alarm,
        setAlarm: (ts: number) => {
          alarm = ts;
        },
      },
    } as unknown as DurableObjectState,
  };
}

function checkReq(ip: string, endpoint: string, limit: number, windowSecs = 3600): Request {
  return new Request("https://do/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip, endpoint, limit, windowSecs }),
  });
}

function statsReq(): Request {
  return new Request("https://do/stats", { method: "GET" });
}

describe("RateLimiterDO", () => {
  it("allows requests within limit and decrements remaining", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    const r1 = await (await obj.fetch(checkReq("ip1", "/api/analyze", 3))).json();
    expect(r1).toMatchObject({ allowed: true, limit: 3, remaining: 2 });

    const r2 = await (await obj.fetch(checkReq("ip1", "/api/analyze", 3))).json();
    expect(r2).toMatchObject({ allowed: true, limit: 3, remaining: 1 });

    const r3 = await (await obj.fetch(checkReq("ip1", "/api/analyze", 3))).json();
    expect(r3).toMatchObject({ allowed: true, limit: 3, remaining: 0 });
  });

  it("blocks when limit is exhausted", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    for (let i = 0; i < 3; i++) {
      await obj.fetch(checkReq("ip1", "/api/analyze", 3));
    }

    const blocked = await (await obj.fetch(checkReq("ip1", "/api/analyze", 3))).json();
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
  });

  it("tracks endpoints independently", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    // Exhaust /api/analyze
    for (let i = 0; i < 2; i++) {
      await obj.fetch(checkReq("ip1", "/api/analyze", 2));
    }
    const blocked = await (await obj.fetch(checkReq("ip1", "/api/analyze", 2))).json();
    expect(blocked.allowed).toBe(false);

    // /api/compare should still work for same IP
    const r = await (await obj.fetch(checkReq("ip1", "/api/compare", 2))).json();
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it("tracks IPs independently", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    // Exhaust ip1
    for (let i = 0; i < 2; i++) {
      await obj.fetch(checkReq("ip1", "/api/analyze", 2));
    }
    const blocked = await (await obj.fetch(checkReq("ip1", "/api/analyze", 2))).json();
    expect(blocked.allowed).toBe(false);

    // ip2 should still work
    const r = await (await obj.fetch(checkReq("ip2", "/api/analyze", 2))).json();
    expect(r.allowed).toBe(true);
  });

  it("persists state to durable storage", async () => {
    const { state, store } = stubState();
    const obj = new RateLimiterDO(state);

    await obj.fetch(checkReq("ip1", "/api/analyze", 5));
    await obj.fetch(checkReq("ip1", "/api/analyze", 5));

    // Storage should have the timestamps under the w: prefix
    const storedKey = "w:ip1:/api/analyze";
    expect(store.has(storedKey)).toBe(true);
    const timestamps = store.get(storedKey) as number[];
    expect(timestamps).toHaveLength(2);
  });

  it("survives DO eviction by hydrating from storage", async () => {
    const { state } = stubState();

    // First DO instance — record 3 hits
    const obj1 = new RateLimiterDO(state);
    for (let i = 0; i < 3; i++) {
      await obj1.fetch(checkReq("ip1", "/api/analyze", 5));
    }
    const r1 = await (await obj1.fetch(checkReq("ip1", "/api/analyze", 5))).json();
    expect(r1.remaining).toBe(1); // 5 - 4 = 1

    // Simulate DO eviction: create a new instance with the SAME storage
    const obj2 = new RateLimiterDO(state);

    // New instance should hydrate from storage and know about the 4 prior hits
    const r2 = await (await obj2.fetch(checkReq("ip1", "/api/analyze", 5))).json();
    expect(r2).toMatchObject({ allowed: true, remaining: 0 }); // 5th hit, 0 remaining

    // 6th hit should be blocked
    const r3 = await (await obj2.fetch(checkReq("ip1", "/api/analyze", 5))).json();
    expect(r3.allowed).toBe(false);
  });

  it("reports stats via /stats endpoint", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    await obj.fetch(checkReq("ip1", "/api/analyze", 10));
    await obj.fetch(checkReq("ip2", "/api/compare", 10));

    const stats = await (await obj.fetch(statsReq())).json();
    expect(stats.keys).toBe(2);
    expect(stats.totalEntries).toBe(2);
  });

  it("returns 404 for unknown routes", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    const resp = await obj.fetch(new Request("https://do/unknown"));
    expect(resp.status).toBe(404);
  });

  it("returns resetAt based on oldest timestamp in window", async () => {
    const { state } = stubState();
    const obj = new RateLimiterDO(state);

    const r1 = await (await obj.fetch(checkReq("ip1", "/api/analyze", 5, 3600))).json();
    // resetAt should be ~now + 3600
    const now = Math.floor(Date.now() / 1000);
    expect(r1.resetAt).toBeGreaterThanOrEqual(now + 3599);
    expect(r1.resetAt).toBeLessThanOrEqual(now + 3601);
  });

  it("cleans expired entries during GC alarm", async () => {
    const { state, store } = stubState();
    const obj = new RateLimiterDO(state);

    // Manually inject an old timestamp (3 hours ago = well past 2h GC cutoff)
    const oldTs = Math.floor(Date.now() / 1000) - 10800;
    store.set("w:old-ip:/api/analyze", [oldTs]);

    // Hydrate + GC via alarm
    await obj.alarm();

    // Old entry should be cleaned from storage
    expect(store.has("w:old-ip:/api/analyze")).toBe(false);
  });
});
