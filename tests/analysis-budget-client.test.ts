// analysis-budget client wrapper: fail-open behavior + over-budget throw.

import { BudgetExceededError, chargeBudget, readBudgetStats, resolveBudgetLimit } from "@worker/analysis-budget";
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
        },
      }),
    } as unknown as Env;
    const stats = await readBudgetStats(env);
    expect(stats?.count).toBe(5);
    expect(stats?.breakdown.curl).toBe(5);
  });
});
