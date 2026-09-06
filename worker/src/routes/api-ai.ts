// AI API routes: ai-analysis, ai-prompt
import { buildAIPrompt, getAIAnalysis } from "../actions/ai-analysis";
import { recordEndpointHit } from "../analysis-budget";
import { cleanDomain, getAnalysisCacheTtlMs, getFromCache } from "../helpers";
import { addHeaders, checkRateLimitAuto, json, jsonError, parseBody, type RouteContext } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env, ctx, clientIP, track: _track } = rc;

  // POST /api/ai-analysis — AI-powered domain analysis (10/hr per IP)
  if (method === "POST" && path === "/api/ai-analysis") {
    const body = await parseBody<{ domain?: string; stream?: boolean; model?: string; custom_prompt?: string }>(
      request,
    );
    if (!body.domain || typeof body.domain !== "string") return jsonError("domain is required", "MISSING_DOMAIN", 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    if (body.model !== undefined && typeof body.model !== "string") {
      return jsonError("model must be a string", "INVALID_MODEL", 400);
    }
    if (body.custom_prompt !== undefined && typeof body.custom_prompt !== "string") {
      return jsonError("custom_prompt must be a string", "INVALID_CUSTOM_PROMPT", 400);
    }
    if (body.custom_prompt && body.custom_prompt.length > 100_000) {
      return jsonError("custom_prompt must be 100000 characters or fewer", "CUSTOM_PROMPT_TOO_LONG", 400);
    }
    // BYO model and prompt customization use the caller's OpenRouter key, never the shared service key.
    const byoKey = request.headers.get("X-OpenRouter-Key") || undefined;
    if ((body.model || body.custom_prompt) && !byoKey) {
      return jsonError("An OpenRouter key is required to customize the model or prompt", "BYO_KEY_REQUIRED", 403);
    }
    // Track usage only after validation succeeds
    recordEndpointHit(env, "ai-analysis");
    const byoModel = body.model || undefined;
    const aiResp = await getAIAnalysis(domain, env, {
      clientIP,
      stream: !!body.stream,
      ctx,
      byoKey,
      byoModel,
      customPrompt: body.custom_prompt,
    });
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
