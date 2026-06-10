// Badge cache helper tests
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // biome-ignore lint/suspicious/noExplicitAny: polyfill for test environment
    (globalThis as any).crypto = webcrypto;
  }
});

import { type BadgeCacheEntry, readBadgeCache, writeBadgeCache } from "@worker/badge-cache";
import type { Env } from "@worker/helpers";

/** Create a stub KV that stores data in a Map */
function stubKV(): KVNamespace & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async () => {},
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    REFERENCE_DATA: stubKV(),
    ...overrides,
  } as Env;
}

const SAMPLE_SCORE = {
  composite: 87,
  tier: "Strong",
  axes: {
    security: { score: 91 },
    speed: { score: 78 },
    foundations: { score: 85 },
    reputation: { score: 92 },
    discoverability: { score: 88 },
    email: { score: 95 },
  },
};

describe("Badge Cache", () => {
  describe("writeBadgeCache", () => {
    it("writes correct KV key and payload shape", async () => {
      const env = mockEnv();
      await writeBadgeCache("stripe.com", SAMPLE_SCORE, env);

      const kv = env.REFERENCE_DATA as ReturnType<typeof stubKV>;
      const raw = kv._store.get("badge:stripe.com");
      expect(raw).toBeDefined();

      const entry = JSON.parse(raw as string) as BadgeCacheEntry;
      expect(entry.composite).toBe(87);
      expect(entry.tier).toBe("Strong");
      expect(entry.axes.sec).toBe(91);
      expect(entry.axes.spd).toBe(78);
      expect(entry.axes.fnd).toBe(85);
      expect(entry.axes.rep).toBe(92);
      expect(entry.axes.dsc).toBe(88);
      expect(entry.axes.eml).toBe(95);
      expect(entry.analyzedAt).toBeDefined();
    });

    it("produces compact payload (< 300 bytes)", async () => {
      const env = mockEnv();
      await writeBadgeCache("stripe.com", SAMPLE_SCORE, env);

      const kv = env.REFERENCE_DATA as ReturnType<typeof stubKV>;
      const raw = kv._store.get("badge:stripe.com") as string;
      expect(raw.length).toBeLessThan(300);
    });

    it("is no-op when REFERENCE_DATA is missing", async () => {
      const env = mockEnv({ REFERENCE_DATA: undefined as unknown as KVNamespace });
      // Should not throw
      await writeBadgeCache("stripe.com", SAMPLE_SCORE, env);
    });

    it("does not throw on KV failure", async () => {
      const failKV = {
        get: async () => null,
        put: async () => {
          throw new Error("KV write error");
        },
        delete: async () => {},
        list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
        getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
      } as unknown as KVNamespace;

      const env = mockEnv({ REFERENCE_DATA: failKV });
      // Should not throw
      await writeBadgeCache("stripe.com", SAMPLE_SCORE, env);
    });

    it("stores certNotAfter when provided, and omits it when absent", async () => {
      const env = mockEnv();
      const notAfter = "2027-01-01T00:00:00.000Z";
      await writeBadgeCache("with-cert.com", SAMPLE_SCORE, env, notAfter);
      await writeBadgeCache("no-cert.com", SAMPLE_SCORE, env);

      const kv = env.REFERENCE_DATA as ReturnType<typeof stubKV>;
      const withCert = JSON.parse(kv._store.get("badge:with-cert.com") as string) as BadgeCacheEntry;
      const noCert = JSON.parse(kv._store.get("badge:no-cert.com") as string) as BadgeCacheEntry;

      expect(withCert.certNotAfter).toBe(notAfter);
      // Absent (null/undefined) cert stays OUT of the payload — backward compatible.
      expect("certNotAfter" in noCert).toBe(false);
    });

    it("omits certNotAfter when passed null", async () => {
      const env = mockEnv();
      await writeBadgeCache("null-cert.com", SAMPLE_SCORE, env, null);
      const kv = env.REFERENCE_DATA as ReturnType<typeof stubKV>;
      const entry = JSON.parse(kv._store.get("badge:null-cert.com") as string) as BadgeCacheEntry;
      expect("certNotAfter" in entry).toBe(false);
    });

    it("handles missing axis scores gracefully", async () => {
      const env = mockEnv();
      const partialScore = {
        composite: 50,
        tier: "Moderate",
        axes: {
          security: { score: 60 },
          // Missing other axes
        } as Record<string, { score?: number }>,
      };
      await writeBadgeCache("example.com", partialScore, env);

      const kv = env.REFERENCE_DATA as ReturnType<typeof stubKV>;
      const raw = kv._store.get("badge:example.com");
      expect(raw).toBeDefined();
      const entry = JSON.parse(raw as string) as BadgeCacheEntry;
      expect(entry.axes.sec).toBe(60);
      expect(entry.axes.spd).toBe(0); // default for missing
    });
  });

  describe("readBadgeCache", () => {
    it("returns null for missing key", async () => {
      const env = mockEnv();
      const result = await readBadgeCache("nonexistent.com", env);
      expect(result).toBeNull();
    });

    it("returns typed data for valid key", async () => {
      const env = mockEnv();
      await writeBadgeCache("stripe.com", SAMPLE_SCORE, env);
      const result = await readBadgeCache("stripe.com", env);

      expect(result).not.toBeNull();
      expect(result?.composite).toBe(87);
      expect(result?.tier).toBe("Strong");
      expect(result?.axes.sec).toBe(91);
    });

    it("returns null when REFERENCE_DATA is missing", async () => {
      const env = mockEnv({ REFERENCE_DATA: undefined as unknown as KVNamespace });
      const result = await readBadgeCache("stripe.com", env);
      expect(result).toBeNull();
    });

    it("returns null on corrupt data", async () => {
      const kv = stubKV();
      kv._store.set("badge:corrupt.com", "not-json");
      const env = mockEnv({ REFERENCE_DATA: kv });
      const result = await readBadgeCache("corrupt.com", env);
      expect(result).toBeNull();
    });
  });
});
