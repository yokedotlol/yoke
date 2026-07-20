// Admin & utility API routes: health, stats, cache, cleanup, rescore, share-sign, track-tab, js-audit, scoring, docs, usage
import {
  type ArchetypeResult,
  AXIS_WEIGHTS,
  type Axis,
  type AxisScore,
  buildSignalDetails,
  computeAxisScoreWithDeductions,
  computeComposite,
  type Finding,
  type SignalDetailsBlob,
} from "../actions/analyze/contextual-scoring";
import { getApiHealth } from "../api-errors";
import { ALL_THRESHOLDS, SEVERITY_SCORES } from "../config/scoring-thresholds";
import {
  EFFORT_MAP,
  FIX_DESC_MAP,
  NON_ACTIONABLE_SIGNALS,
  SIGNAL_REGISTRY,
  TIER_THRESHOLDS,
} from "../config/signal-registry";
import { requestMetaRetentionDays } from "../daily-counters";
import { loadData } from "../data/kv-loader";
import type { VulnerableLibrary } from "../data/vulnerable-libraries";
import { scanForVulnerableLibraries, VULNERABLE_LIBRARIES } from "../data/vulnerable-libraries";
import { boundedText, CORS_HEADERS, cleanDomain, safeFetchWithRedirects, YOKE_VERSION } from "../helpers";
import { getApiDocsHtml } from "../pages";
import { handleShareSign } from "../share";
import { getHtmlSecurityHeaders } from "../spa";
import { renderUsagePage } from "../usage-page";
import { getUsageStats } from "../usage-tracking";
import {
  addHeaders,
  adminJson,
  checkAdminAuth,
  checkRateLimitAuto,
  json,
  jsonError,
  parseBody,
  type RouteContext,
  rateLimitNoop,
  timingSafeEq,
} from "./shared";

export async function handle(rc: RouteContext): Promise<Response | null> {
  const { request, url, path, method, env, clientIP, baseUrl, host, brand, track: _track } = rc;

  // Usage dashboard — admin-only, basic auth with ADMIN_KEY secret
  if (path === "/usage" || path === "/api/usage") {
    const authErr = checkAdminAuth(request, env.ADMIN_KEY);
    if (authErr) return authErr;
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const stats = await getUsageStats(env.STATS_DB, days);
    if (path === "/api/usage") return adminJson(stats);
    return renderUsagePage(env.STATS_DB, days, brand.name, env);
  }

  // GET /api/health — basic health always public; detailed errors require admin auth
  if (method === "GET" && path === "/api/health") {
    const isAdmin = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
    if (isAdmin) {
      // Full health including error metrics
      const health = await getApiHealth(env.STATS_DB);
      return json(health);
    }
    // Public: basic health status only
    return json({
      status: "ok",
      version: YOKE_VERSION,
      uptime: "healthy",
    });
  }

  // GET /api/stats — public aggregate stats for dashboards
  if (method === "GET" && path === "/api/stats") {
    // Serve from KV cache if fresh (15 min TTL)
    const STATS_CACHE_KEY = "api:stats:v1";
    if (env.REFERENCE_DATA) {
      const cached = await env.REFERENCE_DATA.get(STATS_CACHE_KEY, "text");
      if (cached) {
        return new Response(cached, {
          headers: {
            "Content-Type": "application/json",
            "X-Yoke-Cache": "HIT",
            "Cache-Control": "public, max-age=900",
            ...CORS_HEADERS,
          },
        });
      }
    }
    if (!env.STATS_DB) return adminJson({ ok: false, error: "STATS_DB not configured (self-hosted)" }, 501);
    try {
      const [totals, last24h, tiers] = await Promise.all([
        env.STATS_DB.prepare(
          "SELECT COUNT(*) as total_scans, COUNT(DISTINCT domain) as unique_domains FROM domain_scores",
        ).first<{ total_scans: number; unique_domains: number }>(),
        env.STATS_DB.prepare(
          "SELECT COUNT(*) as scans, COUNT(DISTINCT domain) as uniq, AVG(composite_score) as avg_score FROM domain_scores WHERE scored_at >= datetime('now', '-1 day')",
        ).first<{ scans: number; uniq: number; avg_score: number | null }>(),
        env.STATS_DB.prepare(
          `SELECT
            CASE
              WHEN composite_score >= 90 THEN 'Excellent'
              WHEN composite_score >= 78 THEN 'Strong'
              WHEN composite_score >= 60 THEN 'Moderate'
              WHEN composite_score >= 40 THEN 'Weak'
              ELSE 'Critical'
            END as tier,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM domain_scores WHERE scored_at >= datetime('now', '-7 days')), 0) as pct
          FROM domain_scores WHERE scored_at >= datetime('now', '-7 days') GROUP BY tier`,
        ).all<{ tier: string; pct: number }>(),
      ]);
      const tierDist: Record<string, number> = {
        Excellent: 0,
        Strong: 0,
        Moderate: 0,
        Weak: 0,
        Critical: 0,
      };
      for (const row of tiers.results) {
        if (row.tier in tierDist) tierDist[row.tier] = row.pct;
      }
      const stats = {
        total_scans: totals?.total_scans ?? 0,
        unique_domains: totals?.unique_domains ?? 0,
        last_24h: {
          scans: last24h?.scans ?? 0,
          unique: last24h?.uniq ?? 0,
          avg_score: last24h?.avg_score != null ? Math.round(last24h.avg_score * 10) / 10 : null,
        },
        tier_distribution: tierDist,
        updated_at: new Date().toISOString(),
      };
      const body = JSON.stringify(stats);
      // Cache in KV for 15 minutes
      if (env.REFERENCE_DATA) {
        await env.REFERENCE_DATA.put(STATS_CACHE_KEY, body, { expirationTtl: 900 });
      }
      return new Response(body, {
        headers: {
          "Content-Type": "application/json",
          "X-Yoke-Cache": "MISS",
          "Cache-Control": "public, max-age=900",
          ...CORS_HEADERS,
        },
      });
    } catch {
      return jsonError("Stats temporarily unavailable", "STATS_UNAVAILABLE", 503);
    }
  }

  // POST /api/share-sign — sign a share card payload
  if (method === "POST" && path === "/api/share-sign") {
    return handleShareSign(request, env);
  }

  // POST /api/track-tab — anonymous tab view analytics
  // Daily-aggregated: one row per (tab, day) incremented via UPSERT, mirroring
  // endpoint_usage. The old per-call INSERT was a write-amp hole (one row per
  // tab click); we only ever read aggregate counts, so per-event rows were waste.
  if (method === "POST" && path === "/api/track-tab") {
    if (!env.STATS_DB || env.DISABLE_ANALYTICS) return json({ ok: true });
    const rl = await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/track-tab", env);
    if (rl.blocked) return rl.blocked;
    const body = await parseBody<{ domain?: string; tab?: string }>(request);
    if (!body.tab) return jsonError("tab required", "MISSING_TAB", 400);
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const upsertSql = `INSERT INTO tab_views (tab, day, views) VALUES (?, ?, 1)
       ON CONFLICT(tab, day) DO UPDATE SET views = views + 1`;
    try {
      await env.STATS_DB.prepare(upsertSql).bind(body.tab, day).run();
    } catch (e: unknown) {
      if (e instanceof Error && e.message?.includes("no such table")) {
        await env.STATS_DB.exec(
          "CREATE TABLE IF NOT EXISTS tab_views (tab TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tab, day))",
        );
        await env.STATS_DB.exec("CREATE INDEX IF NOT EXISTS idx_tab_views_day ON tab_views(day)");
        await env.STATS_DB.prepare(upsertSql).bind(body.tab, day).run();
      }
    }
    return json({ ok: true });
  }

  // GET /api/js-audit?domain=x — deep JS vulnerability scan
  // POST /api/js-audit {domain} — deep JS vulnerability scan
  if ((method === "GET" || method === "POST") && path === "/api/js-audit") {
    const adminBypass = env.ADMIN_KEY && timingSafeEq(request.headers.get("X-Admin-Key") ?? "", env.ADMIN_KEY);
    const rl = adminBypass
      ? { blocked: null, headers: {}, record: rateLimitNoop }
      : await checkRateLimitAuto(env.STATS_DB, clientIP, "/api/js-audit", env);
    if (rl.blocked) {
      _track("js-audit", 429);
      return rl.blocked;
    }

    let domain: string | null = null;
    if (method === "GET") {
      domain = url.searchParams.get("domain");
    } else {
      const body = await parseBody<{ domain?: string }>(request);
      domain = body.domain ?? null;
    }
    if (!domain || typeof domain !== "string") {
      return jsonError("domain is required", "MISSING_DOMAIN", 400);
    }
    domain = cleanDomain(domain);

    // Fetch the page HTML
    let html = "";
    try {
      const resp = await safeFetchWithRedirects(`https://${domain}`, {
        headers: { "User-Agent": "YokeBot/1.0 (+https://yoke.lol)" },
        timeout: 10_000,
      });
      if (resp.ok) {
        html = await boundedText(resp, 5 * 1024 * 1024);
      }
    } catch (_) {
      // Site unreachable — return empty scan
    }

    if (!html) {
      return addHeaders(
        json({
          domain,
          error: null,
          libraries_found: [],
          total_scripts_scanned: 0,
          scan_date: new Date().toISOString(),
          database: "inline-curated",
          note: "Could not fetch page HTML — site may be unreachable",
        }),
        rl.headers,
      );
    }

    // Try KV for extended vulnerability DB, fall back to inline
    let dbSource = "inline-curated";
    const kvLibs = env.REFERENCE_DATA
      ? await loadData<VulnerableLibrary[]>(env.REFERENCE_DATA, "vulnerable-libraries")
      : null;
    if (kvLibs) dbSource = "kv-reference";

    // Scan using the inline curated library scanner
    const results = scanForVulnerableLibraries(html);

    _track("js-audit", 200);
    return addHeaders(
      json({
        domain,
        libraries_found: results.map((r) => ({
          name: r.library,
          version: r.version,
          vulnerable: r.cves.length > 0,
          cves: r.cves,
          severity: r.severity,
          eol: r.eol || false,
        })),
        total_libraries_checked: VULNERABLE_LIBRARIES.length,
        scan_date: new Date().toISOString(),
        database: dbSource,
      }),
      rl.headers,
    );
  }

  // GET /api/scoring — transparent scoring methodology
  if (method === "GET" && path === "/api/scoring") {
    return json(
      {
        description: `${brand.name} domain scoring methodology. All thresholds, weights, and severity mappings used to calculate the 6-category composite score.`,
        axis_weights: AXIS_WEIGHTS,
        severity_scores: SEVERITY_SCORES,
        tier_thresholds: TIER_THRESHOLDS,
        non_actionable_signals: NON_ACTIONABLE_SIGNALS,
        effort_map: EFFORT_MAP,
        fix_desc_map: FIX_DESC_MAP,
        thresholds: ALL_THRESHOLDS,
        archetype_note:
          "Budget-based deductive scoring: each axis starts at 100 and loses points for issues. Signal share = signal_weight / total_good_weight × 100. Severity multipliers: good=0, info=0, low=0.5×share, medium=0.75×share, high=1.0×share, critical=1.5×share. Absent canBeGood signals deduct 0.30×share. Composite = weighted arithmetic mean. Floor cap: any axis below 40 caps composite at 74 (Moderate). Categories: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12).",
      },
      200,
    );
  }

  // DELETE /api/cache/:domain — purge cached analysis for a domain (admin-only)
  // DELETE /api/cache?type=ai_analysis — purge all AI analysis cache (admin-only)
  if (method === "DELETE" && (path.startsWith("/api/cache/") || path === "/api/cache")) {
    const authErr = checkAdminAuth(request, env.ADMIN_KEY);
    if (authErr) return authErr;

    // Bulk type-based purge: DELETE /api/cache?type=ai_analysis
    const cacheType = url.searchParams.get("type");
    if (path === "/api/cache" && cacheType && env.REFERENCE_DATA) {
      try {
        // KV: list all keys with the cache type prefix and delete them
        const prefix = `cache:${cacheType}:`;
        let cursor: string | undefined;
        let deleted = 0;
        do {
          const list = await env.REFERENCE_DATA.list({ prefix, cursor, limit: 1000 });
          for (const key of list.keys) {
            await env.REFERENCE_DATA.delete(key.name);
            deleted++;
          }
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        return adminJson({ ok: true, type: cacheType, deleted });
      } catch (_e) {
        return adminJson({ error: "Failed to clear cache" }, 500);
      }
    }

    const domain = cleanDomain(path.replace("/api/cache/", ""));
    if (!domain) return adminJson({ error: "Invalid domain" }, 400);
    if (env.REFERENCE_DATA) {
      try {
        // Delete all cache entries for this domain
        const prefix = "cache:";
        let cursor: string | undefined;
        let deleted = 0;
        do {
          const list = await env.REFERENCE_DATA.list({ prefix, cursor, limit: 1000 });
          for (const key of list.keys) {
            if (key.name.endsWith(`:${domain}`)) {
              await env.REFERENCE_DATA.delete(key.name);
              deleted++;
            }
          }
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        return adminJson({ ok: true, domain, message: `Cache cleared (${deleted} keys)` });
      } catch (_e) {
        return adminJson({ error: "Failed to clear cache" }, 500);
      }
    }
    return adminJson({ ok: true, domain, message: "No KV namespace available" });
  }

  // GET /api/cleanup — scheduled D1 cleanup (admin-only)
  // Deletes old cache entries (>7 days) and expired rate limit records.
  // Can be called via cron or manually.
  if (method === "GET" && path === "/api/cleanup") {
    const authErr = checkAdminAuth(request, env.ADMIN_KEY);
    if (authErr) return authErr;
    if (!env.STATS_DB) return adminJson({ ok: false, error: "STATS_DB not configured (self-hosted)" }, 501);
    const cutoff1d = Date.now() - 24 * 60 * 60 * 1000;
    const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const results: Record<string, string> = {};
    // KV cache: TTL handles expiry automatically — no manual cleanup needed
    results.domain_cache = "KV TTL handles expiry automatically";
    results.domain_lookups = "Recent lookups maintained as KV JSON array";
    try {
      const rlRes = await env.STATS_DB.prepare("DELETE FROM ai_rate_limits WHERE ts < ?").bind(cutoff1d).run();
      results.ai_rate_limits = `${rlRes.meta?.changes ?? "?"} expired rows deleted`;
    } catch (e) {
      results.ai_rate_limits = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const drlRes = await env.STATS_DB.prepare("DELETE FROM ai_domain_rate_limits WHERE ts < ?").bind(cutoff1d).run();
      results.ai_domain_rate_limits = `${drlRes.meta?.changes ?? "?"} expired rows deleted`;
    } catch (e) {
      results.ai_domain_rate_limits = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const rlRes2 = await env.STATS_DB.prepare("DELETE FROM endpoint_rate_limits WHERE ts < ?").bind(cutoff1d).run();
      results.endpoint_rate_limits = `${rlRes2.meta?.changes ?? "?"} expired rows deleted`;
    } catch (e) {
      results.endpoint_rate_limits = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const errRes = await env.STATS_DB.prepare("DELETE FROM api_errors WHERE ts < ?").bind(cutoff7d).run();
      const errDomainRes = await env.STATS_DB.prepare(
        "UPDATE api_errors SET domain = NULL WHERE domain IS NOT NULL",
      ).run();
      results.api_errors = `${errRes.meta?.changes ?? "?"} rows deleted (>7 days old); ${errDomainRes.meta?.changes ?? "?"} legacy domain values cleared`;
    } catch (e) {
      results.api_errors = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    // request_meta: enforce retention (default 90 days) — previously unbounded.
    try {
      const retentionDays = requestMetaRetentionDays(env);
      const rmCutoffDay = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10);
      const rmRes = await env.STATS_DB.prepare("DELETE FROM request_meta WHERE day < ?").bind(rmCutoffDay).run();
      const rmDomainRes = await env.STATS_DB.prepare(
        "UPDATE request_meta SET domain = NULL WHERE domain IS NOT NULL",
      ).run();
      results.request_meta = `${rmRes.meta?.changes ?? "?"} rows deleted (>${retentionDays} days old); ${rmDomainRes.meta?.changes ?? "?"} legacy domain values cleared`;
    } catch (e) {
      results.request_meta = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    // badge_domains: prune pre-#12 cold-start junk. Since #12, cold-starts no
    // longer seed badge_domains and the cron no longer sweeps it, but stale rows
    // for domains that were never actually analyzed (no domain_scores row) may
    // linger. Delete those — keep rows that correspond to a real analysis.
    try {
      const bdRes = await env.STATS_DB.prepare(
        "DELETE FROM badge_domains WHERE domain NOT IN (SELECT domain FROM domain_scores)",
      ).run();
      results.badge_domains = `${bdRes.meta?.changes ?? "?"} unanalyzed (cold-start) rows deleted`;
    } catch (e) {
      results.badge_domains = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    return adminJson({ ok: true, cleaned_at: new Date().toISOString(), results });
  }

  // POST /api/rescore — batch re-score all domains from stored signal_details (admin-only)
  // Replays current scoring model (weights, IDF penalties, thresholds) without external fetches.
  if (method === "POST" && path === "/api/rescore") {
    const authErr = checkAdminAuth(request, env.ADMIN_KEY);
    if (authErr) return authErr;
    if (!env.STATS_DB) return adminJson({ ok: false, error: "STATS_DB not configured (self-hosted)" }, 501);

    const startMs = Date.now();
    let total = 0;
    let rescored = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    try {
      // Fetch all domains with signal_details
      const allRows = await env.STATS_DB.prepare(
        "SELECT domain, signal_details, archetype, archetype_confidence, scored_at FROM domain_scores",
      ).all();

      const rows = allRows.results ?? [];
      total = rows.length;

      // Process in batches to respect D1 limits
      const BATCH_SIZE = 50;
      for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
        const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
        const stmts: D1PreparedStatement[] = [];

        for (const row of batch) {
          const r = row as Record<string, unknown>;
          const domain = r.domain as string;
          const rawDetails = r.signal_details as string | null;

          if (!rawDetails) {
            skipped++;
            continue;
          }

          try {
            const blob: SignalDetailsBlob = JSON.parse(rawDetails);
            if (blob.v !== 1) {
              skipped++;
              continue;
            }

            const scoringCtx = blob.scoringContext;
            const archetypeName = blob.archetype || (r.archetype as string) || "unknown";
            const archetypeConf = blob.archetypeConfidence ?? (r.archetype_confidence as number) ?? 0;

            // Reconstruct ArchetypeResult (minimal — only fields scoring needs)
            const archetype: ArchetypeResult = {
              detected: archetypeName as ArchetypeResult["detected"],
              confidence: archetypeConf,
              secondary: null,
              signals: [],
              platform: null,
              weights: { ...AXIS_WEIGHTS },
            };

            // Rebuild findings per axis from stored signal data with CURRENT weights
            const axisScores: Record<string, AxisScore> = {};
            const axes = Object.keys(AXIS_WEIGHTS) as Axis[];

            for (const axis of axes) {
              const axisData = blob.axes[axis];
              if (!axisData || axisData.notMeasured) {
                axisScores[axis] = { score: null, weight: AXIS_WEIGHTS[axis], findings: [], not_measured: true };
                continue;
              }

              // Rebuild Finding[] from stored findings with current registry weights
              const findings: Finding[] = [];
              for (const f of axisData.findings) {
                const reg = SIGNAL_REGISTRY[f.signal];
                const currentWeight = reg?.weightRange?.[1] ?? f.weight;
                findings.push({
                  signal: f.signal,
                  axis,
                  severity: f.severity as Finding["severity"],
                  label: reg?.label ?? f.signal,
                  tradeoff: null,
                  weight: currentWeight,
                });
              }

              // Re-score this axis with current model
              const result = computeAxisScoreWithDeductions(findings, axis, scoringCtx);
              axisScores[axis] = {
                score: result.score,
                weight: AXIS_WEIGHTS[axis],
                findings,
                deductions: result.deductions,
              };
            }

            // Compute new composite
            const numericScores: Record<string, number> = {};
            for (const axis of axes) {
              numericScores[axis] = axisScores[axis].score ?? 0;
            }
            const composite = computeComposite(numericScores as Record<Axis, number>, archetype.detected);

            // Build new signal_details
            const newDetails = buildSignalDetails(
              axisScores as Record<Axis, AxisScore>,
              composite,
              archetype,
              scoringCtx,
            );

            // Prepare UPDATE statement
            stmts.push(
              env.STATS_DB.prepare(
                `UPDATE domain_scores SET composite_score = ?, security_score = ?, performance_score = ?,
                 reliability_score = ?, trust_score = ?, visibility_score = ?, email_score = ?,
                 signal_details = ? WHERE domain = ?`,
              ).bind(
                composite,
                axisScores.security?.score ?? 0,
                axisScores.speed?.score ?? 0,
                axisScores.foundations?.score ?? 0,
                axisScores.reputation?.score ?? 0,
                axisScores.discoverability?.score ?? 0,
                axisScores.email?.score ?? 0,
                newDetails,
                domain,
              ),
            );

            rescored++;
          } catch (e) {
            errors++;
            if (errorDetails.length < 10) {
              errorDetails.push(`${domain}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }

        // Execute batch
        if (stmts.length > 0 && env.STATS_DB) {
          await env.STATS_DB.batch(stmts);
        }
      }

      // Invalidate percentile cache so it recomputes from new scores
      if (env.REFERENCE_DATA) {
        try {
          await env.REFERENCE_DATA.delete("percentiles:distribution");
        } catch {
          /* non-critical */
        }
      }
    } catch (e) {
      return adminJson({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }

    const elapsedMs = Date.now() - startMs;
    return adminJson({
      ok: true,
      total,
      rescored,
      skipped,
      errors,
      elapsed_ms: elapsedMs,
      ...(errorDetails.length > 0 ? { error_samples: errorDetails } : {}),
    });
  }

  // GET /api/docs — serve HTML for browsers, JSON for API clients
  if (method === "GET" && path === "/api/docs") {
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("text/html")) {
      return new Response(getApiDocsHtml(host, brand.name), {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "public, max-age=3600",
          ...getHtmlSecurityHeaders(baseUrl),
        },
      });
    }
    return json({
      name: `${brand.name} Domain Intelligence API`,
      version: YOKE_VERSION,
      endpoints: {
        "GET /{domain}": {
          description: "Full domain analysis (content negotiation: JSON for curl/API clients, HTML for browsers)",
          rate_limit: "20 req/hr",
        },
        "GET /api/quick/{domain}": {
          description:
            "Quick scan — DNS, HTTP probe, WHOIS, SSL, email auth, IP info. No scoring or grade. Returns in ~1-3s.",
          rate_limit: "20 req/hr (shared with analyze)",
        },
        "POST /api/analyze": {
          description: "Full domain analysis. Supports SSE streaming (Accept: text/event-stream) or JSON response.",
          body: '{"domain": "example.com"}',
          rate_limit: "20 req/hr",
        },
        "POST /api/compare": {
          description: "Compare two domains side-by-side",
          body: '{"domain1": "a.com", "domain2": "b.com"}',
          rate_limit: "20 req/hr",
        },
        "POST /api/subdomains": {
          description: "Subdomain enumeration via certificate transparency logs",
          body: '{"domain": "example.com"}',
          rate_limit: "30 req/hr",
        },
        "GET /api/subdomains?domain=example.com": {
          description: "Subdomain enumeration (GET variant)",
          rate_limit: "30 req/hr",
        },
        "POST /api/subdomain-scan": {
          description: "Active subdomain DNS scan — resolves discovered subdomains",
          body: '{"domain": "example.com"}',
          rate_limit: "15 req/hr",
        },
        "POST /api/ai-analysis": {
          description:
            "AI-powered domain analysis from 6 expert personas. Requires OpenRouter API key via X-OpenRouter-Key header or server-side config.",
          body: '{"domain": "example.com", "model": "optional-model-id"}',
          rate_limit: "none (API-key gated)",
        },
        "POST /api/company": {
          description: "Company/business info via Wikidata, Brandfetch, Crunchbase",
          body: '{"domain": "example.com"}',
          rate_limit: "30 req/hr",
        },
        "POST /api/news": {
          description: "Recent news articles about the domain",
          body: '{"domain": "example.com"}',
          rate_limit: "30 req/hr",
        },
        "POST /api/social": {
          description: "Social media account discovery",
          body: '{"domain": "example.com"}',
          rate_limit: "30 req/hr",
        },
        "POST /api/suggestions": {
          description: "Domain suggestions based on analysis",
          body: '{"domain": "example.com"}',
          rate_limit: "10 req/hr",
        },
        "POST /api/availability": {
          description: "Global availability check from multiple regions",
          body: '{"domain": "example.com"}',
          rate_limit: "30 req/hr",
        },
        "POST /api/reverse-ip": {
          description: "Reverse IP lookup — other domains on the same IP",
          body: '{"ip": "1.2.3.4"}',
          rate_limit: "30 req/hr",
        },
        "GET /api/js-audit?domain=example.com": {
          description: "Deep JS vulnerability scan — detects outdated/vulnerable client-side libraries",
          rate_limit: "10 req/hr",
        },
        "GET /api/health": {
          description: "Health check — basic status. Admin auth returns detailed error metrics.",
          rate_limit: "none",
        },
        "GET /api/stats": {
          description:
            "Aggregate scan statistics — total scans, unique domains, 24h activity, tier distribution. Cached for 15 minutes.",
          rate_limit: "none",
        },
        "GET /api/scoring": {
          description: "Scoring methodology — all thresholds, weights, and severity bands",
          rate_limit: "none",
          note: "Cache hits do not count against rate limits.",
        },
        "GET /badge/{domain}.svg": {
          description:
            "Embeddable SVG badge showing domain score. Query params: ?axis=security|speed|foundations|reputation|discoverability|email (specific axis), ?label=Custom (override label), ?style=flat-square (sharp corners). Cached 5 min, background refresh.",
          rate_limit: "none",
        },
        "GET /badge/{domain}.json": {
          description:
            "Shields.io-compatible endpoint JSON for domain score badges. Same query params as the SVG endpoint. Use with https://img.shields.io/endpoint?url=...",
          rate_limit: "none",
        },
      },
      rate_limiting: {
        note: "Rate limits are per-IP, per-endpoint. Cached responses (analysis results served from cache) do not count against rate limits — only requests that trigger fresh computation are counted. Self-hosted instances have no rate limits.",
        headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
      },
      examples: {
        curl_simple: `curl -s https://${host}/stripe.com`,
        curl_pretty: `curl -s 'https://${host}/stripe.com?pretty' | less`,
        curl_jq: `curl -s https://${host}/stripe.com | jq '.ssl'`,
        curl_post: `curl -s -X POST https://${host}/api/analyze -H 'Content-Type: application/json' -d '{"domain":"stripe.com"}'`,
      },
      source: baseUrl,
    });
  }

  return null; // not handled
}
