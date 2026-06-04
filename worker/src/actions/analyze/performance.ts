import { logApiError } from "../../api-errors";
import { PERF_CACHE_TTL_MS } from "../../config/cache";
import { fetchWithTimeout } from "../../helpers";
import type { CompressionResult, CruxResult, PerformanceResult } from "./types";

// ─── PageSpeed ───────────────────────────────────────────────────────

type Strategy = "mobile" | "desktop";

export async function checkPageSpeed(
  domain: string,
  ttfbFallback: number | null,
  kv?: KVNamespace,
  apiKey?: string,
  flyAuthSecret?: string,
  statsDb?: D1Database,
  strategy: Strategy = "mobile",
  flyProbeUrl?: string,
): Promise<PerformanceResult> {
  const cacheType = strategy === "desktop" ? "performance_desktop" : "performance";
  const kvKey = `cache:${cacheType}:${domain}`;

  // Check KV cache (24h TTL)
  if (kv) {
    try {
      const raw = await kv.get(kvKey, "text");
      if (raw) {
        const envelope = JSON.parse(raw) as { data: PerformanceResult; cached_at: number };
        if (Date.now() - envelope.cached_at < PERF_CACHE_TTL_MS) {
          return envelope.data;
        }
      }
    } catch {
      /* cache miss */
    }
  }

  // Try Fly proxy first (more reliable, avoids CF egress issues)
  try {
    const flyUrl = `${flyProbeUrl || "https://yoke-probe.fly.dev"}/pagespeed?domain=${encodeURIComponent(domain)}&strategy=${strategy}`;
    const headers: Record<string, string> = {};
    if (flyAuthSecret) {
      headers.Authorization = `Bearer ${flyAuthSecret}`;
    }
    const res = await fetchWithTimeout(flyUrl, { timeout: 65000, headers });
    if (res.ok) {
      const result = (await res.json()) as PerformanceResult;
      // Ensure strategy field reflects what we asked for
      result.strategy = strategy;
      if (result.score != null) {
        // Cache successful results for 24h
        if (kv) {
          try {
            const envelope = { data: result, cached_at: Date.now() };
            await kv.put(kvKey, JSON.stringify(envelope), { expirationTtl: Math.ceil(PERF_CACHE_TTL_MS / 1000) });
          } catch {
            /* ignore */
          }
        }
        return result;
      }
      // Fly proxy returned error (e.g., rate limited), fall through
    } else if (statsDb) {
      logApiError(statsDb, {
        api: "fly-probe",
        status: res.status,
        message: `PageSpeed ${strategy} proxy failed`,
        domain,
      });
    }
  } catch (e) {
    console.error(`[PageSpeed/${strategy}] Fly proxy error:`, e instanceof Error ? e.message : String(e));
    if (statsDb)
      logApiError(statsDb, {
        api: "fly-probe",
        status: 0,
        message: `PageSpeed ${strategy} proxy: ${String(e).slice(0, 150)}`,
        domain,
      });
  }

  // Fallback to direct API
  const directResult = await tryPageSpeedDirect(domain, ttfbFallback, kv, apiKey, statsDb, strategy);
  if (kv && directResult.score != null) {
    try {
      const envelope = { data: directResult, cached_at: Date.now() };
      await kv.put(kvKey, JSON.stringify(envelope), { expirationTtl: Math.ceil(PERF_CACHE_TTL_MS / 1000) });
    } catch {
      /* ignore */
    }
  }
  return directResult;
}

async function tryPageSpeedDirect(
  domain: string,
  ttfbFallback: number | null,
  _kv?: KVNamespace,
  apiKey?: string,
  statsDb?: D1Database,
  strategy: Strategy = "mobile",
): Promise<PerformanceResult> {
  const empty: PerformanceResult = {
    score: null,
    fcp: null,
    lcp: null,
    tbt: null,
    cls: null,
    si: null,
    ttfb: ttfbFallback,
    strategy,
    error: null,
    screenshot: null,
  };
  try {
    const keyParam = apiKey ? `&key=${apiKey}` : "";
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${encodeURIComponent(domain)}&strategy=${strategy}&category=performance${keyParam}`,
      { timeout: 60000 },
    );
    if (res.status === 429) {
      if (statsDb)
        logApiError(statsDb, { api: "pagespeed", status: 429, message: `Rate limited (${strategy})`, domain });
      return { ...empty, error: "Rate limited — try again later" };
    }
    if (!res.ok) {
      if (statsDb)
        logApiError(statsDb, { api: "pagespeed", status: res.status, message: `API error (${strategy})`, domain });
      return { ...empty, error: `API error (${res.status})` };
    }
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { numericValue?: number; details?: { data?: string } }>;
      };
    };
    const lr = data.lighthouseResult;
    const audits = lr?.audits ?? {};
    const perfScore = lr?.categories?.performance?.score;
    const screenshotData = audits["final-screenshot"]?.details?.data ?? null;
    const result: PerformanceResult = {
      score: perfScore != null ? Math.round(perfScore * 100) : null,
      fcp: audits["first-contentful-paint"]?.numericValue ?? null,
      lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
      tbt: audits["total-blocking-time"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      si: audits["speed-index"]?.numericValue ?? null,
      ttfb: audits["server-response-time"]?.numericValue ?? ttfbFallback,
      strategy,
      error: null,
      screenshot: screenshotData,
    };
    return result;
  } catch (e) {
    console.error(`[PageSpeed/${strategy}] Direct API error:`, e instanceof Error ? e.message : String(e));
    return { ...empty, error: `PageSpeed ${strategy} timed out — analysis may take up to 60s` };
  }
}

// ─── CrUX API ────────────────────────────────────────────────────────

export async function checkCrux(
  domain: string,
  apiKey?: string,
  kv?: KVNamespace,
  statsDb?: D1Database,
): Promise<CruxResult | null> {
  if (!apiKey) return null;

  // Check cache (24h TTL)
  if (kv) {
    try {
      const raw = await kv.get(`cache:crux:${domain}`, "text");
      if (raw) {
        const envelope = JSON.parse(raw) as { data: CruxResult | null; cached_at: number };
        if (Date.now() - envelope.cached_at < PERF_CACHE_TTL_MS) {
          return envelope.data;
        }
      }
    } catch {
      /* cache miss */
    }
  }

  try {
    // Try bare domain first, then www. fallback — CrUX indexes by canonical origin
    // e.g. godaddy.com has no data but www.godaddy.com does
    const origins = domain.startsWith("www.") ? [`https://${domain}`] : [`https://${domain}`, `https://www.${domain}`];

    for (const origin of origins) {
      const res = await fetchWithTimeout(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${apiKey}`, {
        timeout: 10000,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin }),
      });

      if (res.status === 404 || res.status === 400) {
        // No CrUX data for this origin — try next
        continue;
      }

      if (res.status === 403) {
        console.error("[CrUX] API not enabled (403). Enable 'Chrome UX Report API' in Google Cloud Console.");
        if (statsDb)
          logApiError(statsDb, {
            api: "crux",
            status: 403,
            message: "CrUX API not enabled — enable in Cloud Console",
            domain,
          });
        return null;
      }

      if (!res.ok) {
        if (statsDb) logApiError(statsDb, { api: "crux", status: res.status, message: "CrUX API error", domain });
        return null;
      }

      const data = (await res.json()) as CruxApiResponse;
      const result = parseCruxResponse(data);

      // Cache result
      if (kv) {
        try {
          const envelope = { data: result, cached_at: Date.now() };
          await kv.put(`cache:crux:${domain}`, JSON.stringify(envelope), {
            expirationTtl: Math.ceil(PERF_CACHE_TTL_MS / 1000),
          });
        } catch {
          /* ignore */
        }
      }

      return result;
    }

    // No CrUX data for any origin variant — cache the null result
    if (kv) {
      try {
        const envelope = { data: null, cached_at: Date.now() };
        await kv.put(`cache:crux:${domain}`, JSON.stringify(envelope), {
          expirationTtl: Math.ceil(PERF_CACHE_TTL_MS / 1000),
        });
      } catch {
        /* ignore */
      }
    }
    return null;
  } catch (e) {
    console.error("[CrUX] API error:", e instanceof Error ? e.message : String(e));
    if (statsDb) logApiError(statsDb, { api: "crux", status: 0, message: `CrUX: ${String(e).slice(0, 150)}`, domain });
    return null;
  }
}

// ─── CrUX Response Parsing ──────────────────────────────────────────

interface CruxMetricValue {
  percentiles?: { p75?: number };
  histogram?: Array<{ start: number; end?: number; density: number }>;
}

interface CruxApiResponse {
  record?: {
    key?: { origin?: string };
    metrics?: Record<string, CruxMetricValue>;
    collectionPeriod?: {
      firstDate?: { year: number; month: number; day: number };
      lastDate?: { year: number; month: number; day: number };
    };
  };
}

function cruxDateStr(d?: { year: number; month: number; day: number }): string | null {
  if (!d) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function parseCruxResponse(data: CruxApiResponse): CruxResult {
  const metrics = data.record?.metrics ?? {};
  const period = data.record?.collectionPeriod;

  // Extract p75 values
  const lcp = metrics.largest_contentful_paint?.percentiles?.p75 ?? null;
  const fcp = metrics.first_contentful_paint?.percentiles?.p75 ?? null;
  const cls = metrics.cumulative_layout_shift?.percentiles?.p75 ?? null;
  const inp = metrics.interaction_to_next_paint?.percentiles?.p75 ?? null;
  const ttfb = metrics.experimental_time_to_first_byte?.percentiles?.p75 ?? null;
  const rtt = metrics.round_trip_time?.percentiles?.p75 ?? null;

  // Extract form factor fractions
  const ffMetric = metrics.form_factors;
  const formFactors: CruxResult["form_factors"] = null;
  if (ffMetric?.histogram) {
    // CrUX form_factors metric uses histogram with density fractions
    // But typically form_factors is in a different structure
    // The fractions come from the record.key.formFactor aggregation
  }
  // Try the newer fractions format from the main record
  const recordAny = data.record as Record<string, unknown> | undefined;
  if (recordAny) {
    // Form factors come via a separate query or from the metrics
    // When querying without formFactor filter, fractions aren't directly available
    // We'd need separate per-formFactor queries. For now, set null.
  }

  return {
    lcp_p75: lcp ?? null,
    fcp_p75: fcp ?? null,
    cls_p75: cls != null ? Number(cls) : null, // CrUX returns CLS as string (e.g., "0.05") — coerce to number
    inp_p75: inp ?? null,
    ttfb_p75: ttfb ?? null,
    rtt_p75: rtt ?? null,
    form_factors: formFactors,
    collection_period: period
      ? {
          first_date: cruxDateStr(period.firstDate) ?? "",
          last_date: cruxDateStr(period.lastDate) ?? "",
        }
      : null,
    has_data: lcp != null || fcp != null || cls != null || inp != null,
  };
}

// ─── Compression Detection ──────────────────────────────────────────

export function detectCompression(headers: Record<string, string> | null): CompressionResult | null {
  if (!headers) return null;
  const encoding = headers["content-encoding"] ?? null;
  const varyAE = (headers.vary ?? "").toLowerCase().includes("accept-encoding");
  // CF Workers auto-decompress, stripping content-encoding. If vary: accept-encoding is set,
  // the origin supports compression even if we can't see the encoding header.
  return {
    encoding: encoding ?? (varyAE ? "gzip (inferred from Vary)" : null),
    vary_accept_encoding: varyAE,
  };
}

// ─── Website Carbon ─────────────────────────────────────────────────

export async function checkCarbon(
  domain: string,
): Promise<{ co2_per_view: number | null; cleaner_than: number | null; green: boolean } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.websitecarbon.com/site?url=https://${encodeURIComponent(domain)}`, {
      timeout: 10000,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      cleanerThan?: number;
      statistics?: { co2?: { grid?: { grams?: number } } };
      green?: boolean | string;
    };
    return {
      co2_per_view: data.statistics?.co2?.grid?.grams ?? null,
      cleaner_than: data.cleanerThan ?? null,
      green: data.green === true || data.green === "true",
    };
  } catch {
    return null;
  }
}
