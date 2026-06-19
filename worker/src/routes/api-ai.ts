// AI API routes: ai-analysis, ai-prompt
import { buildAIPrompt, getAIAnalysis } from "../actions/ai-analysis";
import { recordEndpointHit } from "../analysis-budget";
import { cleanDomain, getAnalysisCacheTtlMs, getFromCache } from "../helpers";
import { addHeaders, checkRateLimitAuto, json, jsonError, parseBody, type RouteContext } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env, ctx, clientIP, track: _track } = rc;

  // POST /api/ai-analysis — AI-powered domain analysis (10/hr per IP)
  if (method === "POST" && path === "/api/ai-analysis") {
    const body = await parseBody<{ domain?: string; stream?: boolean; model?: string }>(request);
    if (!body.domain || typeof body.domain !== "string") return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    // Track usage only after validation succeeds
    recordEndpointHit(env, "ai-analysis");
    // BYO API key passthrough — when present, use the client's OpenRouter key
    const byoKey = request.headers.get("X-OpenRouter-Key") || undefined;
    const byoModel = body.model || undefined;
    const aiResp = await getAIAnalysis(domain, env, { clientIP, stream: !!body.stream, ctx, byoKey, byoModel });
    _track("ai-analysis", aiResp.status, domain);
    return aiResp;
  }

  // POST /api/ai-prompt — returns the assembled prompt for the prompt editor (no LLM call)
  if (method === "POST" && path === "/api/ai-prompt") {
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/ai-prompt", env);
    if (rl.blocked) return rl.blocked;
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain || typeof body.domain !== "string") return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    const normalized = domain.toLowerCase();
    const analysisCache = (await getFromCache(
      env.REFERENCE_DATA,
      normalized,
      "analysis",
      getAnalysisCacheTtlMs(env),
    )) as Record<string, unknown> | null;
    if (!analysisCache) {
      return jsonError("Domain not yet analyzed. Run a standard analysis first.", "NOT_ANALYZED", 400);
    }
    const prompt = buildAIPrompt(analysisCache);
    return addHeaders(json(prompt), rl.headers);
  }

  return null; // not handled
}
