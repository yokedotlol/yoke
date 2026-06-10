// analysis-budget client wrapper: fail-open behavior + over-budget throw.

import {
  BudgetExceededError,
  chargeBudget,
  readBudgetStats,
  recordApiCall,
  recordCacheHit,
  recordCacheMiss,
  resolveBudgetLimit,
} from "@worker/analysis-budget";
import type { Env } from "@worker/helpers";
import { describe, expect, it } from "vitest";

/** Stub ANALYSIS_BUDGET namespace whose single DO replies with `reply`. */
function stubBudgetNs(reply: { status?: number; body: unknown }): DurableObjectNamespace {
  const stub = {
    fetch: async () =>
      new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
  return {
    idFromName: () => ({}) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

/** Stub namespace whose DO fetch throws (infra error). */
function throwingBudgetNs(): DurableObjectNamespace {
  const stub = {
    fetch: async () => {
      throw new Error("DO unreachable");
    },
  };
  return {
    idFromName: () => ({}) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

describe("analysis-budget client", () => {
  it("resolveBudgetLimit honors env override and defaults to 3000", () => {
    expect(resolveBudgetLimit({} as Env)).toBe(3000);
    expect(resolveBudgetLimit({ GLOBAL_ANALYSIS_BUDGET: "500" } as Env)).toBe(500);
    expect(resolveBudgetLimit({ GLOBAL_ANALYSIS_BUDGET: "garbage" } as Env)).toBe(3000);
  });

  it("fails OPEN (resolves) when ANALYSIS_BUDGET is not bound", async () => {
    await expect(chargeBudget({} as Env, "analyze")).resolves.toBeUndefined();
  });

  it("resolves when the DO allows the charge", async () => {
    const env = { ANALYSIS_BUDGET: stubBudgetNs({ body: { allowed: true, count: 1, limit: 3000 } }) } as unknown as Env;
    await expect(chargeBudget(env, "curl")).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError when the DO denies the charge", async () => {
    const env = {
      ANALYSIS_BUDGET: stubBudgetNs({ body: { allowed: false, count: 3000, limit: 3000 } }),
    } as unknown as Env;
    await expect(chargeBudget(env, "compare")).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("fails OPEN on a DO infra error (does not throw)", async () => {
    const env = { ANALYSIS_BUDGET: throwingBudgetNs() } as unknown as Env;
    await expect(chargeBudget(env, "badge")).resolves.toBeUndefined();
  });

  it("fails OPEN on a non-OK DO response", async () => {
    const env = { ANALYSIS_BUDGET: stubBudgetNs({ status: 500, body: { error: "boom" } }) } as unknown as Env;
    await expect(chargeBudget(env, "analyze")).resolves.toBeUndefined();
  });

  it("readBudgetStats returns null when unbound", async () => {
    expect(await readBudgetStats({} as Env)).toBeNull();
  });

  it("readBudgetStats returns parsed stats from the DO", async () => {
    const env = {
      ANALYSIS_BUDGET: stubBudgetNs({
        body: {
          day: "2026-06-10",
          count: 5,
          limit: 3000,
          breakdown: { curl: 5, analyze: 0, compare: 0, badge: 0, other: 0 },
          metrics: { whoisfreaks_calls: 2, pagespeed_calls: 3, cache_hits: 10, cache_misses: 4 },
        },
      }),
    } as unknown as Env;
    const stats = await readBudgetStats(env);
    expect(stats?.count).toBe(5);
    expect(stats?.breakdown.curl).toBe(5);
    expect(stats?.metrics.whoisfreaks_calls).toBe(2);
    expect(stats?.metrics.cache_hits).toBe(10);
  });

  it("recordApiCall POSTs the correct /bump metric (fire-and-forget)", async () => {
    const bumped: string[] = [];
    const ns = {
      idFromName: () => ({}) as unknown as DurableObjectId,
      get: () =>
        ({
          fetch: async (req: Request) => {
            const body = (await req.json()) as { metric?: string };
            if (body.metric) bumped.push(body.metric);
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        }) as unknown as DurableObjectStub,
    } as unknown as DurableObjectNamespace;
    // backgroundWork runs the promise synchronously (no _ctx) but does not await it.
    const env = { ANALYSIS_BUDGET: ns } as unknown as Env;

    recordApiCall(env, "whoisfreaks");
    recordApiCall(env, "pagespeed");
    recordCacheHit(env);
    recordCacheMiss(env);
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget bumps settle

    expect(bumped).toEqual(["whoisfreaks_calls", "pagespeed_calls", "cache_hits", "cache_misses"]);
  });

  it("record* helpers are no-ops (do not throw) when the DO is unbound", async () => {
    const env = {} as Env;
    expect(() => {
      recordApiCall(env, "whoisfreaks");
      recordCacheHit(env);
      recordCacheMiss(env);
    }).not.toThrow();
  });
});
