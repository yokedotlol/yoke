// ─── Shared post-analysis result enrichment ──────────────────────────
// Called by both the JSON path (api-core.ts) and the SSE path (analyze-stream.ts)
// after runAnalysis() returns. All post-analysis side effects live here:
//   1. share_url → _meta
//   2. pdf_url → _meta
//   3. badge_url → _meta
//   4. percentiles injection
//   5. badge cache write (background, non-blocking)
//
// Adding a new post-analysis enrichment? Add it HERE, not in the route handlers.

import { writeBadgeCache } from "../../badge-cache";
import type { Env } from "../../helpers";
import { backgroundWork, getBaseUrl } from "../../helpers";
import { buildPdfUrl } from "../../pdf-route";
import { injectPercentiles } from "../../percentiles";
import { buildShareUrl } from "../../share";

/**
 * Enrich an analysis result with share URLs, percentiles, and badge cache.
 * Mutates `resultData` in place (adds/extends `_meta`, injects percentiles).
 */
export async function finalizeResult(
  domain: string,
  resultData: Record<string, unknown>,
  request: Request,
  env: Env,
): Promise<void> {
  const ds = resultData.domain_score as
    | { composite?: number; tier?: string; axes?: Record<string, { score?: number }> }
    | undefined;

  if (ds?.composite != null && ds.tier && ds.axes) {
    const analyzedAt = (resultData.analyzed_at as string) || new Date().toISOString();
    const baseUrl = getBaseUrl(request, env);

    // 1. share_url
    const shareUrl = await buildShareUrl(domain, ds.composite, ds.tier, ds.axes, analyzedAt, baseUrl, env);

    // 2. pdf_url
    const pdfUrl = await buildPdfUrl(domain, analyzedAt, baseUrl, env);

    // 3. badge_url + badge_json_url
    const badgeUrl = `${baseUrl}/badge/${domain}.svg`;
    const badgeJsonUrl = `${baseUrl}/badge/${domain}.json`;

    // Merge into _meta
    const existingMeta = (resultData._meta as Record<string, unknown>) || {};
    resultData._meta = {
      ...existingMeta,
      ...(shareUrl ? { share_url: shareUrl } : {}),
      ...(pdfUrl ? { pdf_url: pdfUrl } : {}),
      badge_url: badgeUrl,
      badge_json_url: badgeJsonUrl,
    };

    // 5. Badge cache write (non-blocking background work).
    // Thread the SSL cert expiry (notAfter) through so the badge serve path can
    // use it as a staleness trigger (NOT a verdict — see routes/api-badge.ts).
    const ssl = resultData.ssl as { valid_to?: string | null } | null | undefined;
    const certNotAfter = ssl?.valid_to ?? null;
    backgroundWork(
      env,
      writeBadgeCache(domain, { composite: ds.composite, tier: ds.tier, axes: ds.axes }, env, certNotAfter),
    );
  }

  // 4. Percentiles (always, even without domain_score)
  await injectPercentiles(resultData, env);
}
