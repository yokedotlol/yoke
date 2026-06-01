// ─── SSE Streaming Domain Analysis ───────────────────────────────────
// Streams analysis results as Server-Sent Events as each check completes.
// Delegates all analysis logic to the shared core pipeline.

import { CORS_HEADERS, type Env, normalizeDomain } from "../helpers";
import { type AnalysisCallbacks, runAnalysis } from "./analyze/core";

// SSE helper: format an event
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function analyzeDomainStream(
  domain: string,
  env: Env,
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

      const result = await runAnalysis(domain, env, skipCache, callbacks);

      // For cached results, just send the done event
      if (result.kind === "cached") {
        await send("done", result.data);
      } else {
        // Send final assembled result
        await send("done", result.data);
      }
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
