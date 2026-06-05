// ─── Domain Analysis Orchestrator ────────────────────────────────────
// JSON endpoint — delegates all analysis logic to the shared core pipeline.

import { CORS_HEADERS, type Env, normalizeDomain } from "../helpers";
import { runAnalysis } from "./analyze/core";

export async function analyzeDomain(domain: string, env: Env, skipCache = false): Promise<Response> {
  domain = normalizeDomain(domain);
  if (!domain?.includes(".")) {
    return new Response(JSON.stringify({ error: "Invalid domain", code: "INVALID_DOMAIN", status: 400 }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const result = await runAnalysis(domain, env, skipCache);

  // NXDOMAIN — domain doesn't exist, return 422
  if (result.kind === "nxdomain") {
    return new Response(
      JSON.stringify({
        error: `Domain not registered (NXDOMAIN): ${domain}`,
        code: "DOMAIN_NOT_FOUND",
        status: 422,
        domain,
        not_registered: true,
      }),
      {
        status: 422,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      },
    );
  }

  // All other result kinds return JSON with 200
  return new Response(JSON.stringify(result.data), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
