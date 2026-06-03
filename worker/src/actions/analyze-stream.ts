// ─── SSE Streaming Domain Analysis ───────────────────────────────────
// Streams analysis results as Server-Sent Events as each check completes.
// Delegates all analysis logic to the shared core pipeline.

import { CORS_HEADERS, type Env, getBaseUrl, normalizeDomain } from "../helpers";
import { buildPdfUrl } from "../pdf-route";
import { injectPercentiles } from "../percentiles";
import { buildShareUrl } from "../share";
import { type AnalysisCallbacks, runAnalysis } from "./analyze/core";

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

      const result = await runAnalysis(domain, env, skipCache, callbacks);

      // Inject _meta (share_url, pdf_url) into the final result
      const resultData = result.data as Record<string, unknown>;
      const ds = resultData.domain_score as
        | { composite?: number; tier?: string; axes?: Record<string, { score?: number }> }
        | undefined;
      if (ds?.composite != null && ds.tier && ds.axes) {
        const analyzedAt = (resultData.analyzed_at as string) || new Date().toISOString();
        const baseUrl = getBaseUrl(request, env);
        const shareUrl = await buildShareUrl(domain, ds.composite, ds.tier, ds.axes, analyzedAt, baseUrl, env);
        const pdfUrl = await buildPdfUrl(domain, analyzedAt, baseUrl, env);
        if (shareUrl || pdfUrl) {
          resultData._meta = {
            ...((resultData._meta as Record<string, unknown>) || {}),
            ...(shareUrl ? { share_url: shareUrl } : {}),
            ...(pdfUrl ? { pdf_url: pdfUrl } : {}),
          };
        }
      }

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
