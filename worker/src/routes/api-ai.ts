// AI API routes: ai-analysis, ai-prompt
import { buildAIPrompt, getAIAnalysis } from "../actions/ai-analysis";
import { cleanDomain, getFromCache } from "../helpers";
import { trackUsage } from "../usage-tracking";
import { addHeaders, checkRateLimit, json, jsonError, parseBody, type RouteContext } from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env, ctx, clientIP, track: _track } = rc;

  // POST /api/ai-analysis — AI-powered domain analysis (10/hr per IP)
  if (method === "POST" && path === "/api/ai-analysis") {
    const body = await parseBody<{ domain?: string; stream?: boolean; model?: string }>(request);
    if (!body.domain || typeof body.domain !== "string")
      return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
    // Track usage only after validation succeeds
    await trackUsage(env.STATS_DB, "ai-analysis", !!env.DISABLE_ANALYTICS);
    // BYO API key passthrough — when present, use the client's OpenRouter key
    const byoKey = request.headers.get("X-OpenRouter-Key") || undefined;
    const byoModel = body.model || undefined;
    const aiResp = await getAIAnalysis(domain, env, { clientIP, stream: !!body.stream, ctx, byoKey, byoModel });
    _track("ai-analysis", aiResp.status, domain);
    return aiResp;
  }

  // POST /api/ai-prompt — returns the assembled prompt for the prompt editor (no LLM call)
  if (method === "POST" && path === "/api/ai-prompt") {
    const rl = await checkRateLimit(env.STATS_DB, clientIP, "/api/ai-prompt", env);
    if (rl.blocked) return rl.blocked;
    const body = await parseBody<{ domain?: string }>(request);
    if (!body.domain || typeof body.domain !== "string")
      return json({ error: "domain is required", code: "MISSING_DOMAIN" }, 400);
    const domain = cleanDomain(body.domain);
    if (!domain) return json({ error: "Invalid domain format", code: "INVALID_DOMAIN" }, 400);
    const normalized = domain.toLowerCase();
    const analysisCache = (await getFromCache(env.REFERENCE_DATA!, normalized, "analysis", 60 * 60 * 1000)) as Record<
      string,
      unknown
    > | null;
    if (!analysisCache) {
      return jsonError("Domain not yet analyzed. Run a standard analysis first.", "NOT_ANALYZED", 400);
    }
    const prompt = buildAIPrompt(analysisCache);
    await rl.record();
    return addHeaders(json(prompt), rl.headers);
  }

  return null; // not handled
}
