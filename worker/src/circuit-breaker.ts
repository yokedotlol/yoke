// ─── Circuit Breaker for Upstream APIs ──────────────────────────────
// Lightweight circuit breaker pattern using KV for state persistence.
// Tracks failure rates per provider and fails fast when an upstream is down.
//
// Three states:
//   CLOSED  — normal operation, requests pass through, failures counted
//   OPEN    — upstream is down, requests fail fast immediately
//   HALF_OPEN — one probe request allowed through to test recovery
//
// KV writes happen only on state transitions and failure counts (not on
// every success), keeping write costs low.

// ─── Types ──────────────────────────────────────────────────────────

export interface CircuitConfig {
  /** Number of failures within the window to trip the circuit (default: 5) */
  failureThreshold?: number;
  /** Time window in ms for counting failures (default: 60_000) */
  failureWindow?: number;
  /** How long to stay open before allowing a probe (default: 120_000) */
  resetTimeout?: number;
}

interface CircuitState {
  /** Current state */
  state: "closed" | "open" | "half_open";
  /** Recent failure timestamps (within the failure window) */
  failures: number[];
  /** When the circuit was tripped (epoch ms) */
  trippedAt: number | null;
  /** When the last half-open probe was attempted */
  lastProbeAt: number | null;
}

/** Returned when a circuit is open — the check was skipped entirely */
export interface CircuitOpenResult {
  circuitOpen: true;
  provider: string;
}

// ─── Defaults ───────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<CircuitConfig> = {
  failureThreshold: 5,
  failureWindow: 60_000,
  resetTimeout: 120_000,
};

/** KV TTL for circuit state entries (1 hour) — auto-cleanup */
const STATE_TTL_SECONDS = 3600;

// ─── Per-provider configuration overrides ───────────────────────────
// Some upstream APIs are slower or more tolerant of errors than others.

const PROVIDER_CONFIGS: Record<string, CircuitConfig> = {
  // PageSpeed is known to be slow and rate-limited; use a higher threshold
  performance: { failureThreshold: 8, resetTimeout: 180_000 },
  performance_desktop: { failureThreshold: 8, resetTimeout: 180_000 },
  // crt.sh can be slow but usually recovers
  cert_transparency: { failureThreshold: 5, resetTimeout: 90_000 },
  // Tranco gets 429s frequently
  tranco_rank: { failureThreshold: 6 },
};

// ─── Core Circuit Breaker ───────────────────────────────────────────

function kvKey(provider: string): string {
  return `circuit:${provider}`;
}

function resolveConfig(provider: string, overrides?: CircuitConfig): Required<CircuitConfig> {
  return {
    ...DEFAULT_CONFIG,
    ...(PROVIDER_CONFIGS[provider] ?? {}),
    ...(overrides ?? {}),
  };
}

/**
 * Read circuit state from KV. Returns default closed state on miss or error.
 */
async function getState(kv: KVNamespace, provider: string): Promise<CircuitState> {
  try {
    const raw = await kv.get(kvKey(provider), "text");
    if (raw) return JSON.parse(raw) as CircuitState;
  } catch {
    /* KV read failed — treat as closed */
  }
  return { state: "closed", failures: [], trippedAt: null, lastProbeAt: null };
}

/**
 * Write circuit state to KV. Non-critical — swallows errors.
 */
async function setState(kv: KVNamespace, provider: string, state: CircuitState): Promise<void> {
  try {
    await kv.put(kvKey(provider), JSON.stringify(state), {
      expirationTtl: STATE_TTL_SECONDS,
    });
  } catch {
    /* KV write failed — non-critical */
  }
}

/**
 * Check if a circuit is open for the given provider.
 * Used at the start of analysis to know which providers to skip.
 *
 * Returns true if the circuit is OPEN (should skip), false otherwise.
 * When the circuit has been open long enough, transitions to HALF_OPEN
 * and returns false (allow one probe through).
 */
export async function isCircuitOpen(kv: KVNamespace, provider: string, config?: CircuitConfig): Promise<boolean> {
  const cfg = resolveConfig(provider, config);
  const state = await getState(kv, provider);
  const now = Date.now();

  if (state.state === "closed") return false;

  if (state.state === "open") {
    // Check if reset timeout has elapsed — transition to half-open
    if (state.trippedAt && now - state.trippedAt >= cfg.resetTimeout) {
      // Allow one probe through. Mark as half_open so concurrent requests
      // don't all probe simultaneously — only one gets through.
      const updated: CircuitState = {
        ...state,
        state: "half_open",
        lastProbeAt: now,
      };
      await setState(kv, provider, updated);
      return false; // Let the probe through
    }
    return true; // Still open — fail fast
  }

  // half_open — let requests through (one probe at a time)
  return false;
}

/**
 * Record a successful call. If the circuit was half-open, close it.
 * Does nothing when already closed (no KV write on every success).
 */
export async function recordSuccess(kv: KVNamespace, provider: string): Promise<void> {
  const state = await getState(kv, provider);
  // Only write on state transition — not on every success
  if (state.state !== "closed") {
    await setState(kv, provider, {
      state: "closed",
      failures: [],
      trippedAt: null,
      lastProbeAt: null,
    });
  }
}

/**
 * Record a failure. May trip the circuit if threshold is exceeded.
 */
export async function recordFailure(kv: KVNamespace, provider: string, config?: CircuitConfig): Promise<void> {
  const cfg = resolveConfig(provider, config);
  const state = await getState(kv, provider);
  const now = Date.now();

  if (state.state === "half_open") {
    // Probe failed — reopen the circuit
    await setState(kv, provider, {
      state: "open",
      failures: [now],
      trippedAt: now,
      lastProbeAt: state.lastProbeAt,
    });
    return;
  }

  // Prune old failures outside the window
  const recentFailures = [...state.failures.filter((ts) => now - ts < cfg.failureWindow), now];

  if (recentFailures.length >= cfg.failureThreshold) {
    // Trip the circuit
    await setState(kv, provider, {
      state: "open",
      failures: recentFailures,
      trippedAt: now,
      lastProbeAt: null,
    });
  } else {
    // Update failure count but stay closed
    await setState(kv, provider, {
      ...state,
      failures: recentFailures,
    });
  }
}

/**
 * Get a summary of all tripped circuits. Used for the degraded[] array in API responses.
 * Reads KV keys for all provided check keys.
 */
export async function getDegradedProviders(kv: KVNamespace, checkKeys: string[]): Promise<string[]> {
  const degraded: string[] = [];
  // Batch KV reads — they're cheap
  const reads = checkKeys.map(async (key) => {
    const state = await getState(kv, key);
    if (state.state === "open") {
      degraded.push(key);
    }
  });
  await Promise.all(reads);
  return degraded;
}
