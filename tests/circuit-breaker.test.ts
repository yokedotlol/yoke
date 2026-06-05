import { beforeEach, describe, expect, test, vi } from "vitest";
import { getDegradedProviders, isCircuitOpen, recordFailure, recordSuccess } from "../worker/src/circuit-breaker";

// ─── Mock KV Namespace ──────────────────────────────────────────────

function createMockKV(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
  } as unknown as KVNamespace & { store: Map<string, string> };
}

describe("Circuit Breaker", () => {
  let kv: ReturnType<typeof createMockKV>;

  beforeEach(() => {
    kv = createMockKV();
  });

  describe("isCircuitOpen", () => {
    test("returns false for unknown provider (default closed)", async () => {
      expect(await isCircuitOpen(kv, "pagespeed")).toBe(false);
    });

    test("returns false when circuit is explicitly closed", async () => {
      kv.store.set(
        "circuit:pagespeed",
        JSON.stringify({ state: "closed", failures: [], trippedAt: null, lastProbeAt: null }),
      );
      expect(await isCircuitOpen(kv, "pagespeed")).toBe(false);
    });

    test("returns true when circuit is open and reset timeout has not elapsed", async () => {
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "open",
          failures: [Date.now()],
          trippedAt: Date.now(),
          lastProbeAt: null,
        }),
      );
      expect(await isCircuitOpen(kv, "test")).toBe(true);
    });

    test("transitions to half-open when reset timeout has elapsed", async () => {
      const old = Date.now() - 200_000; // well past default 120s reset
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "open",
          failures: [old],
          trippedAt: old,
          lastProbeAt: null,
        }),
      );
      expect(await isCircuitOpen(kv, "test")).toBe(false);
      // Verify state was updated to half_open
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("half_open");
    });

    test("returns false when circuit is half-open (allow probe)", async () => {
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "half_open",
          failures: [],
          trippedAt: Date.now() - 200_000,
          lastProbeAt: Date.now(),
        }),
      );
      expect(await isCircuitOpen(kv, "test")).toBe(false);
    });

    test("handles KV read failure gracefully (defaults to closed)", async () => {
      kv.get = vi.fn(async () => {
        throw new Error("KV unavailable");
      });
      expect(await isCircuitOpen(kv, "test")).toBe(false);
    });
  });

  describe("recordSuccess", () => {
    test("does nothing when circuit is already closed (no KV write)", async () => {
      await recordSuccess(kv, "test");
      expect(kv.put).not.toHaveBeenCalled();
    });

    test("closes an open circuit on success", async () => {
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "open",
          failures: [Date.now()],
          trippedAt: Date.now(),
          lastProbeAt: null,
        }),
      );
      await recordSuccess(kv, "test");
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("closed");
      expect(state.failures).toEqual([]);
    });

    test("closes a half-open circuit on success", async () => {
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "half_open",
          failures: [],
          trippedAt: Date.now() - 200_000,
          lastProbeAt: Date.now(),
        }),
      );
      await recordSuccess(kv, "test");
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("closed");
    });
  });

  describe("recordFailure", () => {
    test("accumulates failures without tripping below threshold", async () => {
      // Default threshold is 5 — record 3 failures
      for (let i = 0; i < 3; i++) {
        await recordFailure(kv, "test");
      }
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("closed");
      expect(state.failures.length).toBe(3);
    });

    test("trips the circuit at threshold", async () => {
      // Record 5 failures (default threshold)
      for (let i = 0; i < 5; i++) {
        await recordFailure(kv, "test");
      }
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("open");
      expect(state.trippedAt).toBeGreaterThan(0);
    });

    test("reopens circuit on half-open probe failure", async () => {
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "half_open",
          failures: [],
          trippedAt: Date.now() - 200_000,
          lastProbeAt: Date.now(),
        }),
      );
      await recordFailure(kv, "test");
      const state = JSON.parse(kv.store.get("circuit:test")!);
      expect(state.state).toBe("open");
    });

    test("prunes old failures outside the window", async () => {
      const old = Date.now() - 120_000; // 2 minutes ago — outside 60s default window
      kv.store.set(
        "circuit:test",
        JSON.stringify({
          state: "closed",
          failures: [old, old, old],
          trippedAt: null,
          lastProbeAt: null,
        }),
      );
      await recordFailure(kv, "test");
      const state = JSON.parse(kv.store.get("circuit:test")!);
      // Old failures pruned, only the new one remains
      expect(state.failures.length).toBe(1);
      expect(state.state).toBe("closed");
    });

    test("respects per-provider config overrides", async () => {
      // PageSpeed has threshold of 8 per PROVIDER_CONFIGS
      for (let i = 0; i < 7; i++) {
        await recordFailure(kv, "performance");
      }
      const state7 = JSON.parse(kv.store.get("circuit:performance")!);
      expect(state7.state).toBe("closed"); // 7 < 8 threshold

      await recordFailure(kv, "performance");
      const state8 = JSON.parse(kv.store.get("circuit:performance")!);
      expect(state8.state).toBe("open"); // 8 >= 8 threshold
    });
  });

  describe("getDegradedProviders", () => {
    test("returns empty array when no circuits are open", async () => {
      const result = await getDegradedProviders(kv, ["test1", "test2"]);
      expect(result).toEqual([]);
    });

    test("returns only open circuits", async () => {
      kv.store.set(
        "circuit:test1",
        JSON.stringify({ state: "open", failures: [], trippedAt: Date.now(), lastProbeAt: null }),
      );
      kv.store.set(
        "circuit:test2",
        JSON.stringify({ state: "closed", failures: [], trippedAt: null, lastProbeAt: null }),
      );
      kv.store.set(
        "circuit:test3",
        JSON.stringify({ state: "open", failures: [], trippedAt: Date.now(), lastProbeAt: null }),
      );
      const result = await getDegradedProviders(kv, ["test1", "test2", "test3"]);
      expect(result).toEqual(["test1", "test3"]);
    });
  });

  describe("integration: full lifecycle", () => {
    test("closed → open → half-open → closed on recovery", async () => {
      // 1. Accumulate failures to trip
      for (let i = 0; i < 5; i++) {
        await recordFailure(kv, "lifecycle");
      }
      expect(await isCircuitOpen(kv, "lifecycle")).toBe(true);

      // 2. Wait for reset timeout (simulate by backdating trippedAt)
      const state = JSON.parse(kv.store.get("circuit:lifecycle")!);
      state.trippedAt = Date.now() - 200_000;
      kv.store.set("circuit:lifecycle", JSON.stringify(state));

      // 3. isCircuitOpen transitions to half-open, allows probe
      expect(await isCircuitOpen(kv, "lifecycle")).toBe(false);
      const halfOpen = JSON.parse(kv.store.get("circuit:lifecycle")!);
      expect(halfOpen.state).toBe("half_open");

      // 4. Probe succeeds — circuit closes
      await recordSuccess(kv, "lifecycle");
      const closed = JSON.parse(kv.store.get("circuit:lifecycle")!);
      expect(closed.state).toBe("closed");
    });

    test("half-open probe failure reopens circuit", async () => {
      // Trip it
      for (let i = 0; i < 5; i++) {
        await recordFailure(kv, "flaky");
      }

      // Backdate and transition to half-open
      const state = JSON.parse(kv.store.get("circuit:flaky")!);
      state.trippedAt = Date.now() - 200_000;
      kv.store.set("circuit:flaky", JSON.stringify(state));
      await isCircuitOpen(kv, "flaky"); // triggers half-open transition

      // Probe fails — goes back to open
      await recordFailure(kv, "flaky");
      const reopened = JSON.parse(kv.store.get("circuit:flaky")!);
      expect(reopened.state).toBe("open");
    });
  });
});
