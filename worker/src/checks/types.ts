// ─── Check Interface & Context ──────────────────────────────────────
// Standard interface for all parallel analysis checks.
// Each check is a self-contained module that describes itself and runs independently.

import type { DnsRecord, HttpAnalysis } from "../actions/analyze/types";
import type { Env } from "../helpers";

/** Resolved result of the HTTP probe, available via CheckContext.httpProbePromise. */
export interface HttpProbeResult {
  /** Raw HTML body from the HTTP probe (empty string if probe failed). */
  html: string;
  /** Response headers (null if probe failed). */
  headers: Record<string, string> | null;
  /** Whether the HTTP probe returned a 2xx/3xx status. */
  httpProbeSucceeded: boolean;
  /** The full HTTP analysis result (null if probe failed). */
  httpAnalysis: HttpAnalysis | null;
}

/**
 * Context passed to every analysis check.
 * Contains everything a check might need from Phase 1 results and the environment.
 */
export interface CheckContext {
  /** Normalized domain being analyzed */
  domain: string;
  /** Cloudflare Worker environment bindings */
  env: Env;
  /** Instance hostname for self-analysis bypass (e.g., "yoke.lol") */
  instanceHost?: string;
  /** DNS records resolved in Phase 1 */
  dnsRecords: DnsRecord[];
  /** First A-record IP, if any */
  ip?: string;
  /** HTTP response time from Phase 1 probe (ms), or null if probe failed */
  httpResponseTimeMs: number | null;
  /** Skip D1 cache (force fresh analysis) */
  skipCache?: boolean;
  /**
   * Promise that resolves when the HTTP probe completes (typically 1-5s).
   * Checks that need HTML or response headers can `await` this without
   * being gated on slower checks like PageSpeed.
   * Always resolves (never rejects) — failed probes yield empty html/headers.
   */
  httpProbePromise?: Promise<HttpProbeResult>;
}

/**
 * A single analysis check in the parallel pipeline.
 *
 * ## Adding a new check
 *
 * 1. Create `worker/src/checks/your-check.ts`
 * 2. Export a `Check` object: `{ key, label, default, run }`
 * 3. Import and add it to the `registry` array in `worker/src/checks/registry.ts`
 * 4. Run `bun test` — the registry order test will catch any issues
 *
 * Checks that need HTML or response headers from the HTTP probe should
 * `await ctx.httpProbePromise` inside their `run()` function. This resolves
 * in 1-5 seconds (when the HTTP probe finishes), independent of slower checks.
 */
export interface Check {
  /** Result object key (e.g., "ssl", "rdap"). Must be unique across all checks. */
  key: string;
  /** Human-readable label for streaming progress (e.g., "SSL / TLS"). */
  label: string;
  /** Fallback value used when the check throws or rejects. */
  default: unknown;
  /** Execute the check. Receives the shared context; returns the result value. */
  run: (ctx: CheckContext) => Promise<unknown>;
  /** Per-check timeout in ms. Overrides the default PER_CHECK_TIMEOUT_MS when set. */
  timeout?: number;
}
