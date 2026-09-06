import { webcrypto } from "node:crypto";
import type { Env } from "@worker/helpers";
import { trackRequest } from "@worker/request-tracking";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

interface CapturedDb {
  sql: string[];
  runs: Array<{ sql: string; binds: unknown[] }>;
  batches: number;
}

function memoryD1(captured: CapturedDb): D1Database {
  function stmt(sql: string, binds: unknown[] = []): D1PreparedStatement {
    captured.sql.push(sql);
    const empty = {
      results: [],
      success: true,
      meta: { changes: 0, duration: 0, last_row_id: 0, rows_read: 0, rows_written: 0 },
    } as unknown as D1Result;
    return {
      bind: (...args: unknown[]) => stmt(sql, args),
      run: async () => {
        captured.runs.push({ sql, binds });
        return empty;
      },
      first: async () => null,
      all: async () => ({ results: [], success: true, meta: {} }) as unknown as D1Result,
      raw: async () => [],
    } as unknown as D1PreparedStatement;
  }

  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      captured.batches += 1;
      const out: D1Result[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function waitUntilCtx(promises: Promise<unknown>[]): ExecutionContext {
  return {
    waitUntil: (promise: Promise<unknown>) => promises.push(promise),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

describe("request tracking analytics opt-out", () => {
  it("does not schedule or write request counters when DISABLE_ANALYTICS is set", () => {
    const captured = { sql: [], runs: [], batches: 0 } satisfies CapturedDb;
    const waitUntil: Promise<unknown>[] = [];
    const env = {
      STATS_DB: memoryD1(captured),
      DISABLE_ANALYTICS: "true",
      _ctx: waitUntilCtx(waitUntil),
    } as unknown as Env;

    trackRequest(env, new Request("https://yoke.lol/api/analyze"), {
      endpoint: "analyze",
      domain: "example.com",
      status: 200,
      latencyMs: 12,
    });

    expect(waitUntil).toHaveLength(0);
    expect(captured.sql).toHaveLength(0);
    expect(captured.runs).toHaveLength(0);
    expect(captured.batches).toBe(0);
  });

  it("stores only aggregate request counters when analytics are enabled", async () => {
    const captured = { sql: [], runs: [], batches: 0 } satisfies CapturedDb;
    const waitUntil: Promise<unknown>[] = [];
    const env = {
      STATS_DB: memoryD1(captured),
      IP_HASH_SALT: "test-salt",
      _ctx: waitUntilCtx(waitUntil),
    } as unknown as Env;

    trackRequest(
      env,
      new Request("https://yoke.lol/api/analyze", {
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          "cf-ipcountry": "US",
          "user-agent": "curl/8.0.0",
        },
      }),
      { endpoint: "analyze", domain: "example.com", status: 200, latencyMs: 12 },
    );

    expect(waitUntil).toHaveLength(1);
    await Promise.all(waitUntil);

    const insert = captured.runs.find((r) => r.sql.startsWith("INSERT INTO request_aggregates"));
    expect(insert).toBeDefined();
    expect(insert?.binds).toHaveLength(7);
    expect(insert?.binds[2]).toBe("analyze");
    expect(insert?.binds[3]).toBe("cli");
    expect(insert?.binds[4]).toBe("US");
    expect(insert?.binds[5]).toBe(200);
    expect(insert?.binds[6]).toBe(12);
    expect(insert?.binds).not.toContain("example.com");
    expect(insert?.binds).not.toContain("203.0.113.10");
    expect(captured.runs.some((r) => r.sql === "DROP TABLE IF EXISTS request_meta")).toBe(true);
  });
});
