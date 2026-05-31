// ─── Cache Header Analysis ──────────────────────────────────────────
// Parses cache-related HTTP headers and produces a structured verdict.
// Pure analysis — no HTTP requests. Operates on already-captured headers.

export interface CacheAnalysis {
  cache_control: {
    raw: string | null;
    directives: Record<string, string | true>;
    effective_ttl_seconds: number | null;
    ttl_human: string | null;
  };
  cdn_cache: {
    status: string | null;
    provider: string | null;
    age_seconds: number | null;
  };
  conditional: {
    etag: boolean;
    last_modified: boolean;
    varies_on: string[];
  };
  verdict: "excellent" | "good" | "fair" | "poor" | "none";
  verdict_label: string;
  issues: string[];
}

/** Format seconds into a human-readable duration. */
function humanTtl(seconds: number): string {
  if (seconds <= 0) return "no caching";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute${seconds >= 120 ? "s" : ""}`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hour${seconds >= 7200 ? "s" : ""}`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)} day${seconds >= 172800 ? "s" : ""}`;
  if (seconds < 2592000) return `${Math.round(seconds / 604800)} week${seconds >= 1209600 ? "s" : ""}`;
  return `${Math.round(seconds / 2592000)} month${seconds >= 5184000 ? "s" : ""}`;
}

/** Parse Cache-Control header into a map of directives. */
function parseCacheControl(raw: string): Record<string, string | true> {
  const directives: Record<string, string | true> = {};
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      directives[trimmed] = true;
    } else {
      directives[trimmed.slice(0, eqIdx).trim()] = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^"|"$/g, "");
    }
  }
  return directives;
}

/** Detect CDN provider from response headers. */
function detectCdn(headers: Record<string, string>): { status: string | null; provider: string | null } {
  // Cloudflare
  const cfStatus = headers["cf-cache-status"];
  if (cfStatus) return { status: cfStatus.toUpperCase(), provider: "Cloudflare" };

  // Vercel
  const vercelCache = headers["x-vercel-cache"];
  if (vercelCache) return { status: vercelCache.toUpperCase(), provider: "Vercel" };

  // Fastly
  if (headers["x-fastly-request-id"] || headers["x-served-by"]?.includes("cache-")) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Fastly" };
  }

  // CloudFront
  if (headers["x-amz-cf-pop"] || headers["x-amz-cf-id"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "CloudFront" };
  }

  // Akamai
  if (headers["x-akamai-transformed"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Akamai" };
  }

  // BunnyCDN — server header starts with "BunnyCDN" or cdn-pullzone header present
  if (headers["server"]?.toLowerCase().startsWith("bunnycdn") || headers["cdn-pullzone"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "BunnyCDN" };
  }

  // KeyCDN — server: keycdn or x-edge-location header
  if (headers["server"]?.toLowerCase() === "keycdn" || headers["x-edge-location"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "KeyCDN" };
  }

  // Azure Front Door / Azure CDN — x-azure-ref header
  if (headers["x-azure-ref"] || headers["x-msedge-ref"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Azure CDN" };
  }

  // Google Cloud CDN — via header containing "google"
  const via = headers["via"];
  if (via && /\bgoogle\b/i.test(via)) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Google Cloud CDN" };
  }

  // StackPath / MaxCDN — x-hw header
  if (headers["x-hw"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "StackPath" };
  }

  // Netlify — x-nf-request-id or server: Netlify
  if (headers["x-nf-request-id"] || headers["server"]?.toLowerCase() === "netlify") {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Netlify" };
  }

  // Fly.io — fly-request-id header
  if (headers["fly-request-id"]) {
    const xCache = headers["x-cache"];
    return { status: xCache?.toUpperCase() ?? null, provider: "Fly.io" };
  }

  // Generic x-cache (many CDNs)
  const xCache = headers["x-cache"];
  if (xCache) return { status: xCache.toUpperCase(), provider: null };

  return { status: null, provider: null };
}

/** Analyze cache-related headers from an HTTP response. */
export function checkCacheHeaders(headers: Record<string, string> | null): CacheAnalysis | null {
  if (!headers) return null;

  // Normalize header keys to lowercase
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    h[k.toLowerCase()] = v;
  }

  const issues: string[] = [];

  // ── Cache-Control ──
  const ccRaw = h["cache-control"] ?? null;
  const directives = ccRaw ? parseCacheControl(ccRaw) : {};

  // Effective TTL: s-maxage takes precedence (CDN/shared cache), then max-age
  let effectiveTtl: number | null = null;
  if (directives["s-maxage"] && typeof directives["s-maxage"] === "string") {
    effectiveTtl = parseInt(directives["s-maxage"], 10);
    if (Number.isNaN(effectiveTtl)) effectiveTtl = null;
  }
  if (effectiveTtl === null && directives["max-age"] && typeof directives["max-age"] === "string") {
    effectiveTtl = parseInt(directives["max-age"], 10);
    if (Number.isNaN(effectiveTtl)) effectiveTtl = null;
  }

  // no-store / no-cache override TTL semantics
  const hasNoStore = directives["no-store"] === true;
  const hasNoCache = directives["no-cache"] === true;
  const _hasMustRevalidate = directives["must-revalidate"] === true;
  const hasImmutable = directives.immutable === true;
  const _hasStaleWhileRevalidate = typeof directives["stale-while-revalidate"] !== "undefined";
  const hasPublic = directives.public === true;
  const hasPrivate = directives.private === true;

  if (hasNoStore) {
    effectiveTtl = 0;
    issues.push("no-store prevents all caching");
  }

  // ── CDN Cache ──
  const cdn = detectCdn(h);
  const ageRaw = h.age;
  const ageSeconds = ageRaw ? parseInt(ageRaw, 10) : null;

  // ── Conditional request support ──
  const hasEtag = !!h.etag;
  const hasLastModified = !!h["last-modified"];
  const varyRaw = h.vary;
  const variesOn = varyRaw
    ? varyRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

  if (varyRaw?.trim() === "*") {
    issues.push("Vary: * disables all caching");
  }

  // ── Issue detection ──
  if (!ccRaw) {
    issues.push("No Cache-Control header");
  } else {
    if (effectiveTtl !== null && effectiveTtl > 0 && effectiveTtl < 300 && !hasNoCache && !hasNoStore) {
      issues.push(`Short max-age (${effectiveTtl}s) — consider longer TTLs for static content`);
    }
    if (hasNoCache && !hasEtag && !hasLastModified) {
      issues.push("no-cache set but no ETag or Last-Modified for revalidation");
    }
    if (hasPublic && hasPrivate) {
      issues.push("Conflicting public and private directives");
    }
  }
  if (!hasEtag && !hasLastModified && !hasNoStore) {
    issues.push("No ETag or Last-Modified for conditional requests");
  }

  // ── Verdict ──
  let verdict: CacheAnalysis["verdict"];
  let verdictLabel: string;
  const varyDisablesCaching = varyRaw?.trim() === "*";

  if (hasNoStore || varyDisablesCaching) {
    verdict = "poor";
    verdictLabel = hasNoStore
      ? "Caching disabled — no-store prevents browsers and CDNs from caching"
      : "Vary: * effectively disables caching";
  } else if (!ccRaw) {
    verdict = "none";
    verdictLabel = "No cache headers — browsers use heuristic caching";
  } else if (
    effectiveTtl !== null &&
    effectiveTtl >= 86400 &&
    (hasEtag || hasLastModified) &&
    (cdn.status === "HIT" || cdn.status === "MISS" || hasPublic || hasImmutable)
  ) {
    verdict = "excellent";
    verdictLabel = `Well-configured caching — ${humanTtl(effectiveTtl)} TTL with conditional request support`;
  } else if (effectiveTtl !== null && effectiveTtl >= 3600) {
    verdict = "good";
    verdictLabel = `Good caching — ${humanTtl(effectiveTtl)} TTL`;
  } else if ((effectiveTtl !== null && effectiveTtl > 0) || hasNoCache || hasEtag || hasLastModified) {
    verdict = "fair";
    verdictLabel =
      effectiveTtl && effectiveTtl > 0
        ? `Short cache TTL — ${humanTtl(effectiveTtl)}`
        : "Revalidation only — every request checks with the server";
  } else {
    verdict = "poor";
    verdictLabel = "Cache headers present but not effectively caching";
  }

  return {
    cache_control: {
      raw: ccRaw,
      directives,
      effective_ttl_seconds: hasNoStore ? 0 : effectiveTtl,
      ttl_human: hasNoStore ? "no caching" : effectiveTtl !== null ? humanTtl(effectiveTtl) : null,
    },
    cdn_cache: {
      status: cdn.status,
      provider: cdn.provider,
      age_seconds: Number.isNaN(ageSeconds as number) ? null : ageSeconds,
    },
    conditional: {
      etag: hasEtag,
      last_modified: hasLastModified,
      varies_on: variesOn,
    },
    verdict,
    verdict_label: verdictLabel,
    issues,
  };
}
