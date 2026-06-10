// Minimal Cloudflare Worker — thin route dispatcher
// Route handlers live in ./routes/; this file handles CORS, HEAD conversion, and dispatch.

import type { Env } from "./helpers";
import { CORS_HEADERS, getBaseUrl, getBranding, hashIp } from "./helpers";
import { trackRequest } from "./request-tracking";
import * as apiAdmin from "./routes/api-admin";
import * as apiAi from "./routes/api-ai";
import * as apiBadge from "./routes/api-badge";
import * as apiCore from "./routes/api-core";
import * as apiEnrichment from "./routes/api-enrichment";
import * as pages from "./routes/pages";
import type { RouteContext } from "./routes/shared";
import { jsonError } from "./routes/shared";
import * as staticRoutes from "./routes/static";
import { handleScheduled } from "./scheduled";
import { serveAssetOrFallback, wantsJSON } from "./spa";

// Re-export the Durable Object classes so wrangler can find them
export { AnalysisBudgetDO } from "./analysis-budget-do";
export { RateLimiterDO } from "./rate-limiter-do";

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    // HEAD → GET conversion: process as GET, return headers only
    if (request.method === "HEAD") {
      const getReq = new Request(request.url, {
        method: "GET",
        headers: request.headers,
        redirect: "follow",
      });
      const response = await this.fetch(getReq, env, ctx);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Thread execution context for background work
    if (ctx) env._ctx = ctx;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // ── Build route context shared by all handlers ──
    const baseUrl = getBaseUrl(request, env);
    const host = new URL(baseUrl).hostname;
    const brand = getBranding(request, env);
    const _t0 = Date.now();

    const rc: RouteContext = {
      request,
      url,
      path,
      method,
      env,
      ctx,
      clientIP: "", // populated lazily below for API routes
      baseUrl,
      host,
      brand,
      track: (endpoint: string, status: number, domain?: string) => {
        trackRequest(env, request, { endpoint, domain, status, latencyMs: Date.now() - _t0 });
      },
    };

    // ── Static content routes (robots, sitemap, llms.txt, manifest, status, mta-sts) ──
    const staticResp = staticRoutes.handle(rc);
    if (staticResp) return staticResp instanceof Promise ? await staticResp : staticResp;

    // ── Page routes (share cards, reports, SPA, domain pages) ──
    // Checked before API routes so /r/:token and /report/:domain match first
    const pageResp = await pages.handle(rc);
    if (pageResp) return pageResp;

    // ── Badge routes (/badge/<domain>.svg, /badge/<domain>.json) ──
    // Before API routes — badges are non-API, public, no /api/ prefix
    const badgeResp = await apiBadge.handle(rc);
    if (badgeResp) return badgeResp;

    // ── API routes ──
    if (path.startsWith("/api/") || path === "/usage") {
      // Hash client IP once for all API rate limiting
      rc.clientIP = await hashIp(
        request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown",
        env,
      );

      try {
        // Core analysis endpoints
        const coreResp = await apiCore.handle(rc);
        if (coreResp) return coreResp;

        // Enrichment endpoints
        const enrichResp = await apiEnrichment.handle(rc);
        if (enrichResp) return enrichResp;

        // AI endpoints
        const aiResp = await apiAi.handle(rc);
        if (aiResp) return aiResp;

        // Admin, utility, and docs endpoints (also handles /usage)
        const adminResp = await apiAdmin.handle(rc);
        if (adminResp) return adminResp;

        // No API route matched
        return jsonError("Not found", "NOT_FOUND", 404);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Internal server error";
        // Return 400 for JSON parse errors (malformed request body)
        const status = err instanceof SyntaxError ? 400 : 500;
        const code = err instanceof SyntaxError ? "BAD_REQUEST" : "INTERNAL_ERROR";
        return jsonError(msg, code, status);
      }
    }

    // ── Non-API routes: serve static assets or SPA fallback ──
    // With ASSETS binding, all requests come through the worker.
    // Try serving the exact asset; fall back to index.html for client-side routing.

    // Catch-all: if a non-browser client hits an unrecognized path that doesn't look like a static asset,
    // return a JSON error instead of SPA HTML (helps curl users who mistype domains)
    const isStaticAsset = /\.(js|css|map|ico|png|svg|woff2?|json|webp|jpg|jpeg|gif|wasm|txt|xml)$/i.test(path);
    if (wantsJSON(request) && !isStaticAsset) {
      return jsonError("Invalid domain format", "INVALID_DOMAIN", 400);
    }

    return serveAssetOrFallback(request, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await handleScheduled(event, env, ctx);
  },
};
