// ─── SSE Streaming Domain Analysis ───────────────────────────────────
// Streams analysis results as Server-Sent Events as each check completes.
// Delegates all analysis logic to the shared core pipeline.

import { CORS_HEADERS, type Env, normalizeDomain } from "../helpers";
import { getPercentiles } from "../percentiles";
import { type AnalysisCallbacks, runAnalysis } from "./analyze/core";

// SSE helper: format an event
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Inject percentile data into the result (non-blocking, swallows errors)
async function injectPercentiles(data: Record<string, unknown>, env: Env): Promise<void> {
  try {
    const ds = data.domain_score as { composite?: number; axes?: Record<string, { score?: number }> } | undefined;
    if (ds?.composite != null && ds.axes) {
      const pctile = await getPercentiles(env, {
        composite: ds.composite,
        security: ds.axes.security?.score,
        speed: ds.axes.speed?.score,
        foundations: ds.axes.foundations?.score,
        reputation: ds.axes.reputation?.score,
        discoverability: ds.axes.discoverability?.score,
      });
      if (pctile) {
        data.percentiles = pctile;
      }
    }
  } catch {
    /* percentile injection is non-critical */
  }
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
        await injectPercentiles(result.data, env);
        await send("done", result.data);
      } else {
        // Send final assembled result
        await injectPercentiles(result.data, env);
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
