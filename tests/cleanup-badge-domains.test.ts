// GET /api/cleanup badge_domains prune — verifies the cleanup path DELETEs
// cold-start junk rows (badge_domains with no matching domain_scores row).

import type { Env } from "@worker/helpers";
import worker from "@worker/index";
import { describe, expect, it } from "vitest";

/** D1 stub that records every executed SQL string (for prune assertions). */
function recordingD1(executed: string[]): D1Database {
  const result = {
    results: [],
    success: true,
    meta: { duration: 0, changes: 3, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 },
  };
  const stmt = (sql: string): D1PreparedStatement =>
    ({
      bind: (..._a: unknown[]) => stmt(sql),
      first: async () => null,
      all: async () => result,
      run: async () => {
        executed.push(sql);
        return result;
      },
      raw: async () => [],
    }) as unknown as D1PreparedStatement;

  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (_s: D1PreparedStatement[]) => [result],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function stubKV(): KVNamespace {
  return {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

function authedCleanupReq(adminKey: string): Request {
  return new Request("https://yoke.lol/api/cleanup", {
    headers: { Authorization: `Basic ${btoa(`admin:${adminKey}`)}` },
  });
}

describe("GET /api/cleanup badge_domains prune", () => {
  it("DELETEs badge_domains rows with no matching domain_scores row", async () => {
    const executed: string[] = [];
    const env = {
      STATS_DB: recordingD1(executed),
      REFERENCE_DATA: stubKV(),
      BASE_URL: "https://yoke.lol",
      ADMIN_KEY: "secret123",
    } as unknown as Env;

    const resp = await worker.fetch(authedCleanupReq("secret123"), env);
    expect(resp.status).toBe(200);
    const data = (await resp.json()) as { ok: boolean; results: Record<string, string> };
    expect(data.ok).toBe(true);

    const prune = executed.find((s) => s.startsWith("DELETE FROM badge_domains"));
    expect(prune).toBeDefined();
    // Only prune rows that were never analyzed (no domain_scores row).
    expect(prune).toContain("NOT IN (SELECT domain FROM domain_scores)");
    expect(data.results.badge_domains).toContain("rows deleted");
  });
});
