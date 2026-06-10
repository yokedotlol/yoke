// AnalysisBudgetDO unit tests — direct charge/over-budget/stats + day rollover.

import { AnalysisBudgetDO } from "@worker/analysis-budget-do";
import { describe, expect, it } from "vitest";

/** In-memory DurableObjectState.storage stub (get/put only). */
function stubState(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      delete: async (key: string) => store.delete(key),
    },
  } as unknown as DurableObjectState;
}

function chargeReq(path: string, limit: number): Request {
  return new Request("https://do/charge", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Budget-Limit": String(limit) },
    body: JSON.stringify({ path }),
  });
}

function statsReq(limit: number): Request {
  return new Request("https://do/stats", { method: "GET", headers: { "X-Budget-Limit": String(limit) } });
}

function bumpReq(metric: string): Request {
  return new Request("https://do/bump", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metric }),
  });
}

function endpointReq(endpoint: string): Request {
  return new Request("https://do/endpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

describe("AnalysisBudgetDO", () => {
  it("increments count + per-path breakdown on charge", async () => {
    const obj = new AnalysisBudgetDO(stubState());

    const r1 = await (await obj.fetch(chargeReq("curl", 10))).json();
    expect(r1).toMatchObject({ allowed: true, count: 1, limit: 10 });

    await obj.fetch(chargeReq("analyze", 10));
    const r3 = await (await obj.fetch(chargeReq("curl", 10))).json();
    expect(r3.count).toBe(3);

    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.count).toBe(3);
    expect(stats.limit).toBe(10);
    expect(stats.breakdown.curl).toBe(2);
    expect(stats.breakdown.analyze).toBe(1);
    expect(stats.breakdown.compare).toBe(0);
  });

  it("buckets unknown paths into 'other'", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    await obj.fetch(chargeReq("something-weird", 10));
    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.breakdown.other).toBe(1);
  });

  it("denies once the limit is reached", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const allowed1 = await (await obj.fetch(chargeReq("analyze", 2))).json();
    const allowed2 = await (await obj.fetch(chargeReq("analyze", 2))).json();
    const denied = await (await obj.fetch(chargeReq("analyze", 2))).json();

    expect(allowed1.allowed).toBe(true);
    expect(allowed2.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.count).toBe(2);
    expect(denied.limit).toBe(2);
  });

  it("persists count across DO instances (storage survives eviction)", async () => {
    const state = stubState();
    const obj1 = new AnalysisBudgetDO(state);
    await obj1.fetch(chargeReq("curl", 100));
    await obj1.fetch(chargeReq("curl", 100));

    // New instance backed by the same storage — simulates eviction + revival.
    const obj2 = new AnalysisBudgetDO(state);
    const stats = await (await obj2.fetch(statsReq(100))).json();
    expect(stats.count).toBe(2);
  });

  it("resets the count when the UTC day rolls over", async () => {
    const state = stubState();
    // Seed yesterday's state directly in storage.
    await state.storage.put("budget", {
      day: "2000-01-01",
      count: 42,
      breakdown: { curl: 42, analyze: 0, compare: 0, badge: 0, other: 0 },
    });
    const obj = new AnalysisBudgetDO(state);
    const stats = await (await obj.fetch(statsReq(100))).json();
    // Day mismatch → reset to 0 for today.
    expect(stats.count).toBe(0);
    expect(stats.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("starts with zeroed auxiliary metrics in stats", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.metrics).toEqual({ whoisfreaks_calls: 0, pagespeed_calls: 0, cache_hits: 0, cache_misses: 0 });
  });

  it("bumps auxiliary metrics WITHOUT counting against the budget", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    await obj.fetch(bumpReq("whoisfreaks_calls"));
    await obj.fetch(bumpReq("whoisfreaks_calls"));
    await obj.fetch(bumpReq("pagespeed_calls"));
    await obj.fetch(bumpReq("cache_hits"));
    await obj.fetch(bumpReq("cache_hits"));
    await obj.fetch(bumpReq("cache_misses"));

    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.metrics.whoisfreaks_calls).toBe(2);
    expect(stats.metrics.pagespeed_calls).toBe(1);
    expect(stats.metrics.cache_hits).toBe(2);
    expect(stats.metrics.cache_misses).toBe(1);
    // Budget count untouched by bumps.
    expect(stats.count).toBe(0);
  });

  it("rejects an unknown bump metric with 400", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const resp = await obj.fetch(bumpReq("not-a-real-metric"));
    expect(resp.status).toBe(400);
  });

  it("persists metrics across DO instances and back-fills legacy state without metrics", async () => {
    const state = stubState();
    // Seed today's state in the PRE-metrics shape (no `metrics` key).
    await state.storage.put("budget", {
      day: new Date().toISOString().slice(0, 10),
      count: 3,
      breakdown: { curl: 3, analyze: 0, compare: 0, badge: 0, other: 0 },
    });
    const obj = new AnalysisBudgetDO(state);
    await obj.fetch(bumpReq("cache_hits"));
    const stats = await (await obj.fetch(statsReq(100))).json();
    expect(stats.count).toBe(3); // budget preserved
    expect(stats.metrics.cache_hits).toBe(1); // metrics back-filled + bumped
  });

  it("starts with empty per-endpoint counts in stats", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.endpoints).toEqual({});
  });

  it("counts per-endpoint hits WITHOUT counting against the budget", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    await obj.fetch(endpointReq("analyze"));
    await obj.fetch(endpointReq("analyze"));
    await obj.fetch(endpointReq("compare"));

    const stats = await (await obj.fetch(statsReq(10))).json();
    expect(stats.endpoints.analyze).toBe(2);
    expect(stats.endpoints.compare).toBe(1);
    // Budget count untouched by endpoint hits.
    expect(stats.count).toBe(0);
  });

  it("rejects an endpoint hit with no endpoint name (400)", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const resp = await obj.fetch(
      new Request("https://do/endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(resp.status).toBe(400);
  });

  it("resets per-endpoint counts when the UTC day rolls over", async () => {
    const state = stubState();
    await state.storage.put("budget", {
      day: "2000-01-01",
      count: 5,
      breakdown: { curl: 5, analyze: 0, compare: 0, badge: 0, other: 0 },
      metrics: { whoisfreaks_calls: 0, pagespeed_calls: 0, cache_hits: 0, cache_misses: 0 },
      endpoints: { analyze: 99 },
    });
    const obj = new AnalysisBudgetDO(state);
    const stats = await (await obj.fetch(statsReq(100))).json();
    expect(stats.endpoints).toEqual({});
    expect(stats.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("persists per-endpoint counts across DO instances and back-fills legacy state", async () => {
    const state = stubState();
    // Seed today's state in the PRE-endpoints shape (no `endpoints` key).
    await state.storage.put("budget", {
      day: new Date().toISOString().slice(0, 10),
      count: 2,
      breakdown: { curl: 2, analyze: 0, compare: 0, badge: 0, other: 0 },
      metrics: { whoisfreaks_calls: 0, pagespeed_calls: 0, cache_hits: 0, cache_misses: 0 },
    });
    const obj = new AnalysisBudgetDO(state);
    await obj.fetch(endpointReq("news"));
    const stats = await (await obj.fetch(statsReq(100))).json();
    expect(stats.count).toBe(2); // budget preserved
    expect(stats.endpoints.news).toBe(1); // endpoints back-filled + counted
  });

  it("returns a 500 JSON error on malformed charge body (caller fails open)", async () => {
    const obj = new AnalysisBudgetDO(stubState());
    const resp = await obj.fetch(
      new Request("https://do/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Budget-Limit": "10" },
        body: "not-json",
      }),
    );
    expect(resp.status).toBe(500);
  });
});
