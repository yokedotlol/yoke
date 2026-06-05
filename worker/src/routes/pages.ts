// Page routes: SPA, domain pages, share/report cards, OG images, PDF reports

import { hashIp } from "../helpers";
import { handleReportDownload, matchReportPath } from "../pdf-route";
import { trackRequest } from "../request-tracking";
import {
  handleCompareOgImage,
  handleCompareSharePage,
  handleOgImage,
  handleSharePage,
  matchCompareOgImagePath,
  matchCompareSharePath,
  matchOgImagePath,
  matchSharePath,
} from "../share";
import { handleSPARoute, matchDomainPath } from "../spa";
import { checkRateLimit, jsonError, type RouteContext } from "./shared";

/** Handle page-level routes (share cards, reports, SPA).
 *  Returns a Response if matched, null otherwise. */
export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, path, method, env } = rc;

  // ── Share card routes ──
  // GET /r/:token — report card page with OG tags
  const shareMatch = method === "GET" ? matchSharePath(path) : null;
  if (shareMatch) {
    return handleSharePage(request, env, shareMatch);
  }
  // GET /og/:token.svg — dynamic OG image
  const ogMatch = method === "GET" ? matchOgImagePath(path) : null;
  if (ogMatch) {
    return handleOgImage(request, env, ogMatch);
  }

  // ── Compare share card routes ──
  // GET /c/:token — compare report card page with OG tags
  const compareShareMatch = method === "GET" ? matchCompareSharePath(path) : null;
  if (compareShareMatch) {
    return handleCompareSharePage(request, env, compareShareMatch);
  }
  // GET /cog/:token.png — dynamic compare OG image
  const compareOgMatch = method === "GET" ? matchCompareOgImagePath(path) : null;
  if (compareOgMatch) {
    return handleCompareOgImage(request, env, compareOgMatch);
  }

  // GET /report/:domain — PDF report download
  const reportDomain = method === "GET" ? matchReportPath(path) : null;
  if (reportDomain) {
    const reportIP = await hashIp(
      request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown",
      env,
    );
    const rl = await checkRateLimit(env.STATS_DB, reportIP, "/report", env);
    if (rl.blocked) {
      trackRequest(env, request, { endpoint: "report", domain: reportDomain, status: 429, latencyMs: 0 });
      return rl.blocked;
    }
    const reportResponse = await handleReportDownload(request, env, reportDomain);
    // Only consume rate-limit credit when a PDF was actually generated (200)
    if (reportResponse.status === 200) {
      await rl.record();
    }
    trackRequest(env, request, {
      endpoint: "report",
      domain: reportDomain,
      status: reportResponse.status,
      latencyMs: 0,
    });
    return reportResponse;
  }

  // ── Method guard: reject DELETE/PUT/PATCH on domain paths ──
  if ((method === "DELETE" || method === "PUT" || method === "PATCH") && matchDomainPath(path)) {
    return jsonError("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  // ── SPA routes: static pages, domain paths with content negotiation, compare paths ──
  const spaResponse = await handleSPARoute(request, env, path);
  if (spaResponse) return spaResponse;

  return null; // not handled
}
