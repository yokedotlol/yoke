// ─── SSE Streaming Domain Analysis ───────────────────────────────────
// Streams analysis results as Server-Sent Events as each check completes.
// Delegates all analysis logic to the shared core pipeline.
//
// SSE Protocol Reference
// ──────────────────────
// Endpoint: POST /api/analyze with Accept: text/event-stream
//
// Events emitted (in order):
//
//   event: phase
//   data:  { phase: string, status: "start"|"done", label: string,
//            total?: number, checks?: string[] }
//   — Marks the start/end of each analysis phase (dns, http, ssl, etc.).
//     `total` is the check count for that phase; `checks` lists check names.
//
//   event: result
//   data:  { key: string, value: unknown, completed?: number, total?: number,
//            label?: string, error?: boolean }
//   — Emitted as each individual check completes. `key` is the result field
//     name (e.g. "dns", "ssl", "headers"). `error: true` means the check
//     failed but analysis continues.
//
//   event: done
//   data:  <full AnalysisResult JSON>
//   — Final assembled result, identical in shape to the JSON API response.
//     Includes domain_score, _meta (share_url, pdf_url), and percentiles.
//     Sent for both fresh and cached results.
//
//   event: error
//   data:  { message: string }
//   — Terminal error — the stream closes after this event.
//
// The browser client (client/src/api.ts) is the primary consumer.
// External integrators should use the JSON API (POST /api/analyze without
// the Accept: text/event-stream header).

import { CORS_HEADERS, type Env, normalizeDomain } from "../helpers";
import { type AnalysisCallbacks, runAnalysis } from "./analyze/core";
import { finalizeResult } from "./analyze/finalize";

// SSE helper: format an event
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function analyzeDomainStream(
  domain: string,
  env: Env,
  request: Request,
  skipCache = false,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  domain = normalizeDomain(domain);
  if (!domain?.includes(".")) {
    return new Response(JSON.stringify({ error: "Invalid domain" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Use a TransformStream for streaming SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = (event: string, data: unknown) => writer.write(encoder.encode(sseEvent(event, data)));

  // Run the analysis in background, streaming results
  const doAnalysis = async () => {
    try {
      const callbacks: AnalysisCallbacks = {
        onPhase: async (phase, status, label, total, checks) => {
          await send("phase", {
            phase,
            status,
            label,
            ...(total !== undefined ? { total } : {}),
            ...(checks ? { checks } : {}),
          });
        },
        onResult: async (key, value, completed, total, label, error) => {
          await send("result", {
            key,
            value,
            ...(completed !== undefined ? { completed } : {}),
            ...(total !== undefined ? { total } : {}),
            ...(label !== undefined ? { label } : {}),
            ...(error ? { error: true } : {}),
          });
        },
      };

      const result = await runAnalysis(domain, env, skipCache, callbacks, "analyze");

      // Shared enrichment: share_url, pdf_url, badge_url, percentiles, badge cache
      const resultData = result.data as Record<string, unknown>;
      await finalizeResult(domain, resultData, request, env);

      // Send final assembled result
      await send("done", result.data);
    } catch (err) {
      try {
        await send("error", { message: err instanceof Error ? err.message : "Analysis failed" });
      } catch {
        /* writer may be closed */
      }
    } finally {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
    }
  };

  // Start analysis (don't await — let it stream)
  doAnalysis();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      ...CORS_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}
