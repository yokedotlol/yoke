import { fingerprints } from "../../fingerprints";
import type { Env } from "../../helpers";
import { boundedText, fetchWithTimeout, flyProbeFetch, getFlyProbeUrl, isBlockedUrl } from "../../helpers";
import { getHtmlSecurityHeaders } from "../../spa";
import type { HttpAnalysis, MetaResult, RedirectHop, SecurityHeaderCheck, TechItem } from "./types";

// ─── HTTP Fetch + Headers + Tech + Meta ──────────────────────────────

export function auditSecurityHeaders(headers: Record<string, string>): { audit: SecurityHeaderCheck[]; grade: string } {
  const checks: SecurityHeaderCheck[] = [];
  const headerDefs = [
    // Core security headers — these define your grade
    {
      name: "Strict-Transport-Security",
      key: "strict-transport-security",
      weight: 20,
      recommend: "Add HSTS header with max-age of at least 31536000",
    },
    {
      name: "Content-Security-Policy",
      key: "content-security-policy",
      weight: 20,
      recommend: "Implement CSP to prevent XSS and injection attacks",
    },
    {
      name: "X-Content-Type-Options",
      key: "x-content-type-options",
      weight: 15,
      recommend: 'Set to "nosniff" to prevent MIME-type sniffing',
    },
    {
      name: "X-Frame-Options",
      key: "x-frame-options",
      weight: 15,
      recommend: 'Set to "DENY" or "SAMEORIGIN" to prevent clickjacking',
    },
    // Recommended — good practice, minor weight
    {
      name: "Referrer-Policy",
      key: "referrer-policy",
      weight: 10,
      recommend: 'Set to "strict-origin-when-cross-origin" or stricter',
    },
    {
      name: "Permissions-Policy",
      key: "permissions-policy",
      weight: 5,
      recommend: "Restrict browser features with Permissions-Policy",
    },
    // Situational — shown for awareness, zero scoring weight
    { name: "X-XSS-Protection", key: "x-xss-protection", weight: 0, recommend: "Deprecated — modern CSP is preferred" },
    {
      name: "Cross-Origin-Opener-Policy",
      key: "cross-origin-opener-policy",
      weight: 0,
      recommend: 'Set to "same-origin" if using cross-origin isolation',
    },
    {
      name: "Cross-Origin-Resource-Policy",
      key: "cross-origin-resource-policy",
      weight: 0,
      recommend: 'Set to "same-origin" if using cross-origin isolation',
    },
  ];

  let score = 0;
  let maxScore = 0;
  for (const def of headerDefs) {
    maxScore += def.weight;
    const val = headers[def.key] ?? null;
    const isCoreOrRecommended = def.weight >= 10;
    if (val) {
      checks.push({ header: def.name, status: "pass", value: val, recommendation: null });
      score += def.weight;
    } else {
      checks.push({
        header: def.name,
        status: isCoreOrRecommended ? "fail" : "warning",
        value: null,
        recommendation: def.recommend,
      });
    }
  }

  // Thresholds calibrated so:
  //   0 headers       =  0% → F
  //   HSTS only       = 23% → D
  //   HSTS + XCTO     = 41% → C
  //   3 of 4 core     = 65% → B
  //   4 core headers  = 82% → A
  //   4 core + extras = 94% → A+
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const grade = pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 60 ? "B" : pct >= 40 ? "C" : pct >= 20 ? "D" : "F";
  return { audit: checks, grade };
}

export function detectTechStack(headers: Record<string, string>, html: string): TechItem[] {
  const found: TechItem[] = [];
  const seenNames = new Set<string>();

  for (const fp of fingerprints) {
    let matched = false;
    let version: string | null = null;
    let confidenceScore = 0;

    if (fp.patterns.headers) {
      for (const [key, regex] of Object.entries(fp.patterns.headers)) {
        const val = headers[key];
        if (val && regex.test(val)) {
          matched = true;
          confidenceScore += 3;
        }
      }
    }
    if (fp.patterns.meta) {
      for (const [, regex] of Object.entries(fp.patterns.meta)) {
        const metaMatch = html.match(/<meta[^>]+(?:name|property)=["']generator["'][^>]+content=["']([^"']+)["']/i);
        if (metaMatch?.[1] && regex.test(metaMatch[1])) {
          matched = true;
          confidenceScore += 3;
        }
      }
    }
    if (fp.patterns.scriptUrls) {
      for (const regex of fp.patterns.scriptUrls) {
        if (regex.test(html)) {
          matched = true;
          confidenceScore += 2;
        }
      }
    }
    if (fp.patterns.cssUrls) {
      for (const regex of fp.patterns.cssUrls) {
        if (regex.test(html)) {
          matched = true;
          confidenceScore += 1;
        }
      }
    }
    if (fp.patterns.htmlPatterns) {
      for (const regex of fp.patterns.htmlPatterns) {
        if (regex.test(html)) {
          matched = true;
          confidenceScore += 2;
        }
      }
    }

    if (matched && !seenNames.has(fp.name)) {
      seenNames.add(fp.name);
      if (fp.versionExtract) {
        if (fp.versionExtract.source === "meta") {
          const metaMatch = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*>/gi);
          if (metaMatch) {
            for (const m of metaMatch) {
              const vMatch = m.match(fp.versionExtract.pattern);
              if (vMatch?.[1]) {
                version = vMatch[1];
                break;
              }
            }
          }
        } else if (fp.versionExtract.source === "header") {
          for (const val of Object.values(headers)) {
            const vMatch = val.match(fp.versionExtract.pattern);
            if (vMatch?.[1]) {
              version = vMatch[1];
              break;
            }
          }
        } else if (fp.versionExtract.source === "script") {
          const vMatch = html.match(fp.versionExtract.pattern);
          if (vMatch?.[1]) version = vMatch[1];
        }
      }
      found.push({
        category: fp.category,
        name: fp.name,
        version,
        confidence: confidenceScore >= 5 ? "high" : confidenceScore >= 2 ? "medium" : "low",
      });
    }
  }
  return found;
}

export async function analyzeHttp(domain: string, instanceHost?: string, env?: Env): Promise<HttpAnalysis | null> {
  // ─── Self-analysis bypass ────────────────────────────────────────────
  // CF Workers can't fetch their own domain (recursive request protection).
  // Synthesize HTTP analysis from known security headers + real HTML from ASSETS.
  if (instanceHost && domain === instanceHost) {
    // Use build-time globals if available, otherwise fall back to runtime security headers
    const runtimeHeaders = getHtmlSecurityHeaders(`https://${instanceHost}`);
    const selfHeaders: Record<string, string> = {
      ...Object.fromEntries(Object.entries(runtimeHeaders).map(([k, v]) => [k.toLowerCase(), v])),
      "content-type": "text/html;charset=utf-8",
      "cache-control": "public, max-age=3600",
      server: "cloudflare",
      vary: "Accept-Encoding",
      "content-encoding": "br",
      "alt-svc": 'h3=":443"; ma=86400',
      "cf-ray": "self-analysis",
    };
    // Prefer build-time HTML, then fetch from ASSETS at runtime, then empty fallback
    let html = "";
    if (env?.ASSETS) {
      try {
        const resp = await env.ASSETS.fetch(new Request(`https://${instanceHost}/index.html`));
        if (resp.ok) html = await resp.text();
      } catch {
        /* ignore — fall through to empty */
      }
    }
    const { audit, grade } = auditSecurityHeaders(selfHeaders);
    const techStack = html
      ? detectTechStack(selfHeaders, html)
      : [{ category: "Web Server", name: "Cloudflare Workers", version: null, confidence: "high" }];
    const ogTitle =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
      null;
    const ogDesc =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] ??
      null;
    const ogImage =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
      null;
    let faviconUrl = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    if (faviconUrl && !faviconUrl.startsWith("http")) faviconUrl = new URL(faviconUrl, `https://${instanceHost}`).href;
    return {
      redirects: [{ url: `https://${instanceHost}`, status_code: 200, server: "cloudflare", response_time_ms: 1 }],
      headers: { raw: selfHeaders, security_audit: audit, security_grade: grade },
      tech_stack: techStack,
      meta: {
        robots_txt: null,
        robots_txt_exists: false,
        sitemap_detected: false,
        sitemap_url: null,
        sitemap_page_count: null,
        og_title: ogTitle,
        og_description: ogDesc,
        og_image: ogImage,
        favicon_url: faviconUrl,
      }, // robots/sitemap populated by Phase 2 _robots_sitemap check
      final_url: `https://${instanceHost}`,
      html,
      status_code: 200,
      response_time_ms: 1,
    };
  }

  const redirects: RedirectHop[] = [];
  let currentUrl = `https://${domain}`;
  let finalHeaders: Record<string, string> = {};
  let html = "";
  let finalStatusCode = 0;
  let totalTime = 0;

  for (let i = 0; i < 10; i++) {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(currentUrl, {
        redirect: "manual",
        timeout: 8000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      const elapsed = Date.now() - start;
      totalTime += elapsed;
      redirects.push({
        url: currentUrl,
        status_code: res.status,
        server: res.headers.get("server"),
        response_time_ms: elapsed,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location) {
          const nextUrl = location.startsWith("http") ? location : new URL(location, currentUrl).href;
          if (isBlockedUrl(nextUrl)) break; // SSRF protection: don't follow redirects to private IPs
          currentUrl = nextUrl;
          continue;
        }
      }
      finalStatusCode = res.status;
      finalHeaders = {};
      res.headers.forEach((v, k) => {
        finalHeaders[k.toLowerCase()] = v;
      });
      try {
        html = await boundedText(res);
      } catch {
        html = "";
      }
      break;
    } catch {
      /* redirect or network error */
      if (i === 0 && currentUrl.startsWith("https://")) {
        currentUrl = `http://${domain}`;
        continue;
      }
      break;
    }
  }

  if (redirects.length === 0) return null;

  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
    null;
  const ogDesc =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] ??
    null;
  const ogImage =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
    null;
  let faviconUrl = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
  if (faviconUrl && !faviconUrl.startsWith("http")) faviconUrl = new URL(faviconUrl, `https://${domain}`).href;

  const { audit, grade } = auditSecurityHeaders(finalHeaders);
  const techStack = detectTechStack(finalHeaders, html);

  return {
    redirects,
    headers: { raw: finalHeaders, security_audit: audit, security_grade: grade },
    tech_stack: techStack,
    meta: {
      robots_txt: null,
      robots_txt_exists: false,
      sitemap_detected: false,
      sitemap_url: null,
      sitemap_page_count: null,
      og_title: ogTitle,
      og_description: ogDesc,
      og_image: ogImage,
      favicon_url: faviconUrl,
    },
    final_url: currentUrl,
    html,
    status_code: finalStatusCode,
    response_time_ms: totalTime,
  };
}

// ─── Robots & Sitemap ────────────────────────────────────────────────

export async function checkRobotsSitemap(
  domain: string,
  instanceHost?: string,
  _env?: Env,
): Promise<
  Pick<MetaResult, "robots_txt" | "robots_txt_exists" | "sitemap_detected" | "sitemap_url" | "sitemap_page_count">
> {
  const result = {
    robots_txt: null as string | null,
    robots_txt_exists: false,
    sitemap_detected: false,
    sitemap_url: null as string | null,
    sitemap_page_count: null as number | null,
  };
  const isSelf = instanceHost && domain === instanceHost;

  // ─── robots.txt ────────────────────────────────────────────────────
  try {
    let text: string | null = null;
    if (isSelf) {
      // CF Workers can't fetch their own zone — synthesize from known route handler content
      const baseUrl = `https://${instanceHost}`;
      text = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml`;
    } else {
      const res = await fetchWithTimeout(`https://${domain}/robots.txt`, { timeout: 5000 });
      if (res.ok) {
        const body = await boundedText(res);
        const lower = body.toLowerCase();
        if (body && !lower.includes("<!doctype") && !lower.includes("<html")) text = body;
      }
    }
    if (text) {
      result.robots_txt = text.slice(0, 2000);
      result.robots_txt_exists = true;
    }
  } catch {
    /* ignore */
  }

  // ─── sitemap.xml ───────────────────────────────────────────────────
  try {
    let text: string | null = null;
    if (isSelf) {
      // Synthesize from known route handler content
      const baseUrl = `https://${instanceHost}`;
      text = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${baseUrl}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${baseUrl}/api/docs</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n  <url><loc>${baseUrl}/status</loc><changefreq>hourly</changefreq><priority>0.5</priority></url>\n  <url><loc>${baseUrl}/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n  <url><loc>${baseUrl}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n  <url><loc>${baseUrl}/tools</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>\n</urlset>`;
    } else {
      const res = await fetchWithTimeout(`https://${domain}/sitemap.xml`, { timeout: 5000 });
      if (res.ok) text = await boundedText(res);
    }
    if (text && (text.includes("<urlset") || text.includes("<sitemapindex"))) {
      result.sitemap_detected = true;
      result.sitemap_url = `https://${domain}/sitemap.xml`;
      const urlMatches = text.match(/<url>/gi);
      const sitemapMatches = text.match(/<sitemap>/gi);
      if (urlMatches) result.sitemap_page_count = urlMatches.length;
      else if (sitemapMatches) result.sitemap_page_count = sitemapMatches.length;
    }
  } catch {
    /* ignore */
  }
  return result;
}

// ─── HTTP Fallback via Fly Proxy ─────────────────────────────────────
// When the Worker's direct fetch fails (CF IP blocks, WAF blocks), retry
// through Fly's infrastructure which has different IPs.

const WAF_BLOCK_SIGNATURES = [
  "attention required",
  "access denied",
  "cloudflare",
  "please wait",
  "checking your browser",
  "blocked by",
  "security check",
];

function isLikelyBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 503) {
    const lower = html.toLowerCase().slice(0, 2000);
    return WAF_BLOCK_SIGNATURES.some((sig) => lower.includes(sig));
  }
  return false;
}

export async function analyzeHttpWithFallback(
  domain: string,
  instanceHost: string | undefined,
  env: Env,
): Promise<HttpAnalysis | null> {
  // Try Worker's direct fetch first
  const directResult = await analyzeHttp(domain, instanceHost, env);

  // If direct fetch succeeded with real content, use it
  if (directResult) {
    const status = directResult.status_code ?? 0;
    const html = directResult.html ?? "";
    if (status >= 200 && status < 400) return directResult;
    // Check for WAF/block page — if so, try Fly fallback
    if (!isLikelyBlocked(status, html)) return directResult;
  }

  // Direct fetch failed or was blocked — try Fly proxy fallback
  try {
    const probeUrl = getFlyProbeUrl(env);
    if (!probeUrl) return directResult;

    const probeRes = await flyProbeFetch(`${probeUrl}/probe-http?domain=${encodeURIComponent(domain)}`, env, {
      timeout: 20000,
    });
    if (!probeRes?.ok) return directResult;

    const data = (await probeRes.json()) as {
      status_code: number;
      headers: Record<string, string>;
      body_preview: string;
      response_time_ms: number;
      redirect_chain: string[];
      final_url: string;
      error: string | null;
    };

    if (data.error || !data.status_code) return directResult;
    if (data.status_code < 200 || data.status_code >= 400) return directResult;

    // Build HttpAnalysis from Fly probe response
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.headers ?? {})) {
      headers[k.toLowerCase()] = v;
    }

    const { audit, grade } = auditSecurityHeaders(headers);
    const techStack = detectTechStack(headers, data.body_preview);

    const redirects: RedirectHop[] = (data.redirect_chain ?? []).map((url, i) => ({
      url,
      status_code: i < (data.redirect_chain?.length ?? 0) - 1 ? 301 : data.status_code,
      server: null,
      response_time_ms: 0,
    }));
    if (redirects.length === 0) {
      redirects.push({
        url: `https://${domain}`,
        status_code: data.status_code,
        server: headers.server ?? null,
        response_time_ms: data.response_time_ms,
      });
    }

    const ogTitle =
      data.body_preview.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      data.body_preview.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ??
      null;
    const ogDesc =
      data.body_preview.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      data.body_preview.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i)?.[1] ??
      null;
    const ogImage =
      data.body_preview.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      data.body_preview.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
      null;
    let faviconUrl =
      data.body_preview.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? null;
    if (faviconUrl && !faviconUrl.startsWith("http")) {
      try {
        faviconUrl = new URL(faviconUrl, `https://${domain}`).href;
      } catch {
        /* ignore */
      }
    }

    return {
      redirects,
      headers: { raw: headers, security_audit: audit, security_grade: grade },
      tech_stack: techStack,
      meta: {
        robots_txt: null,
        robots_txt_exists: false,
        sitemap_detected: false,
        sitemap_url: null,
        sitemap_page_count: null,
        og_title: ogTitle,
        og_description: ogDesc,
        og_image: ogImage,
        favicon_url: faviconUrl,
      },
      final_url: data.final_url || `https://${domain}`,
      html: data.body_preview,
      status_code: data.status_code,
      response_time_ms: data.response_time_ms,
    };
  } catch {
    return directResult;
  }
}
