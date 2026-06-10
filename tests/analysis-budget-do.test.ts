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
