// Server-rendered admin dashboard — zero client JS, admin-only
// Shows OUR operational data, not user data. No IPs, no PII.

import { readBudgetStats } from "./analysis-budget";
import { readDailyCounter } from "./daily-counters";
import { CORS_HEADERS, type Env } from "./helpers";
import { getRequestAnalytics } from "./request-tracking";
import { getUsageStats } from "./usage-tracking";

function n(v: number | undefined | null): string {
  return (v ?? 0).toLocaleString();
}

function tierColor(t: string): string {
  return (
    { Excellent: "#22c55e", Strong: "#3b82f6", Moderate: "#f59e0b", Weak: "#f97316", Critical: "#ef4444" }[t] ||
    "#737373"
  );
}

// Country code → flag emoji
function flag(cc: string): string {
  if (!cc || cc === "XX" || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Client type → icon
function clientIcon(t: string): string {
  return { web: "🌐", extension: "🧩", cli: "⌨️", api: "🔌" }[t] || "❓";
}

export async function renderUsagePage(
  db: D1Database | undefined,
  days = 30,
  siteName = "Yoke",
  env?: Env,
): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  const [
    stats,
    rq,
    budget,
    badgeRefreshesToday,
    whoisCallsToday,
    pagespeedCallsToday,
    cacheHitsToday,
    cacheMissesToday,
  ] = await Promise.all([
    getUsageStats(db, days),
    getRequestAnalytics(db, days),
    env ? readBudgetStats(env) : Promise.resolve(null),
    readDailyCounter(db, "badge_refreshes", today),
    readDailyCounter(db, "whoisfreaks_calls", today),
    readDailyCounter(db, "pagespeed_calls", today),
    readDailyCounter(db, "cache_hits", today),
    readDailyCounter(db, "cache_misses", today),
  ]);

  // Cost & Budget figures (live from the budget DO; falls back to "—" when unbound)
  const budgetLimit = budget?.limit ?? null;
  const budgetCount = budget?.count ?? null;
  const budgetPct =
    budgetLimit && budgetCount != null ? Math.min(100, Math.round((budgetCount / budgetLimit) * 100)) : 0;
  const budgetColor = budgetPct >= 90 ? "var(--red)" : budgetPct >= 70 ? "var(--accent)" : "var(--green)";
  const budgetBreakdown = budget?.breakdown ?? null;

  // Paid-API success counts + cache hit-rate. The budget DO holds the live
  // current-day metrics; daily_counters (flushed hourly) is the fallback for
  // when the DO is unbound or evicted mid-day.
  const m = budget?.metrics ?? null;
  const whoisCalls = m ? m.whoisfreaks_calls : whoisCallsToday;
  const pagespeedCalls = m ? m.pagespeed_calls : pagespeedCallsToday;
  const cacheHits = m ? m.cache_hits : cacheHitsToday;
  const cacheMisses = m ? m.cache_misses : cacheMissesToday;
  const cacheTotal = cacheHits + cacheMisses;
  const cacheHitRate = cacheTotal > 0 ? Math.round((cacheHits / cacheTotal) * 100) : null;

  // Endpoint traffic
  const dayTotals: Record<string, number> = {};
  for (const row of stats.by_day) {
    dayTotals[row.day] = (dayTotals[row.day] || 0) + row.hits;
  }
  const sortedDays = Object.keys(dayTotals).sort();
  const maxDaily = Math.max(...Object.values(dayTotals), 1);
  const endpoints = Object.entries(stats.by_endpoint).sort((a, b) => b[1] - a[1]);
  const endpointDays: Record<string, Record<string, number>> = {};
  for (const row of stats.by_day) {
    if (!endpointDays[row.endpoint]) endpointDays[row.endpoint] = {};
    endpointDays[row.endpoint][row.day] = row.hits;
  }
  const recentDays = sortedDays.slice(-14);
  const ss = stats.score_stats;
  const es = stats.error_stats;

  // Request analytics charts
  const maxVisitors = Math.max(...rq.visitors_per_day.map((d) => d.count), 1);
  const maxDomains = Math.max(...rq.domains_per_day.map((d) => d.count), 1);
  const maxRequests = Math.max(...rq.requests_per_day.map((d) => d.count), 1);
  const maxHourly = Math.max(...rq.by_hour, 1);
  const totalClientType = Object.values(rq.by_client_type).reduce((a, b) => a + b, 0) || 1;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${siteName} Admin Dashboard</title>
<style>
  :root { --bg: #0a0a0a; --surface: #141414; --border: #262626; --text: #e5e5e5; --muted: #737373; --accent: #f59e0b; --cyan: #00d2eb; --green: #22c55e; --red: #ef4444; --purple: #a855f7; --blue: #3b82f6; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); padding: 1.5rem; max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.2rem; }
  h2 { font-size: 1rem; font-weight: 600; color: var(--cyan); margin: 1.75rem 0 0.6rem; border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; }
  .sub { color: var(--muted); font-size: 0.8rem; margin-bottom: 1.25rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.6rem; margin-bottom: 0.75rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; }
  .cl { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .cv { font-size: 1.35rem; font-weight: 700; margin-top: 0.1rem; font-variant-numeric: tabular-nums; }
  .cs { font-size: 0.65rem; color: var(--muted); margin-top: 0.1rem; }
  .chart { display: flex; align-items: flex-end; gap: 2px; height: 72px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem; }
  .bar { flex: 1; border-radius: 2px 2px 0 0; min-width: 3px; position: relative; }
  .bar:hover { opacity: 0.75; }
  .bar .tip { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); font-size: 9px; color: var(--muted); white-space: nowrap; display: none; background: var(--surface); padding: 2px 5px; border-radius: 3px; border: 1px solid var(--border); z-index: 5; }
  .bar:hover .tip { display: block; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 0.75rem; }
  th, td { padding: 0.35rem 0.5rem; text-align: right; border-bottom: 1px solid var(--border); }
  th { background: var(--bg); color: var(--muted); font-weight: 500; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; position: sticky; top: 0; }
  td:first-child, th:first-child { text-align: left; }
  tr:last-child td { border-bottom: none; }
  .mono { font-family: "SF Mono", "Fira Code", monospace; font-size: 0.7rem; }
  .hits { font-variant-numeric: tabular-nums; }
  .zero { color: var(--muted); opacity: 0.4; }
  .nav { display: flex; gap: 0.4rem; margin-bottom: 1.25rem; }
  .nav a { color: var(--muted); text-decoration: none; font-size: 0.75rem; padding: 0.2rem 0.6rem; border: 1px solid var(--border); border-radius: 4px; }
  .nav a.active { color: var(--accent); border-color: var(--accent); }
  .nav a:hover { border-color: var(--muted); }
  .pct-bar { display: inline-block; height: 8px; border-radius: 2px; margin-right: 0.4rem; vertical-align: middle; opacity: 0.7; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
  @media (max-width: 900px) { .row2, .row3 { grid-template-columns: 1fr; } }
  .tier-bar { display: flex; height: 22px; border-radius: 4px; overflow: hidden; gap: 1px; margin-top: 0.4rem; }
  .tier-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #111; }
  .heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; }
  .hm-cell { aspect-ratio: 1; border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; color: var(--muted); position: relative; }
  .hm-cell .tip { position: absolute; bottom: calc(100% + 2px); font-size: 9px; white-space: nowrap; display: none; background: var(--surface); padding: 1px 4px; border-radius: 3px; border: 1px solid var(--border); z-index: 5; }
  .hm-cell:hover .tip { display: block; }
  .err-msg { color: var(--red); font-size: 0.7rem; word-break: break-all; }
  .err-time { color: var(--muted); font-size: 0.65rem; white-space: nowrap; }
  footer { margin-top: 2rem; padding-top: 0.75rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.7rem; text-align: center; }
  footer a { color: var(--cyan); text-decoration: none; }
</style>
</head>
<body>
<h1>⚡ ${siteName} Admin Dashboard</h1>
<p class="sub">Operational metrics · Last ${days} days · No user data · No IPs</p>

<div class="nav">
  <a href="/usage?days=7" ${days === 7 ? 'class="active"' : ""}>7d</a>
  <a href="/usage?days=14" ${days === 14 ? 'class="active"' : ""}>14d</a>
  <a href="/usage?days=30" ${days === 30 ? 'class="active"' : ""}>30d</a>
  <a href="/usage?days=90" ${days === 90 ? 'class="active"' : ""}>90d</a>
</div>

<!-- ═══ HERO KPIs ═══ -->
<div class="cards">
  <div class="card">
    <div class="cl">Total Requests</div>
    <div class="cv" style="color:var(--accent)">${n(rq.total_requests || stats.total)}</div>
  </div>
  <div class="card">
    <div class="cl">Unique Visitors</div>
    <div class="cv" style="color:var(--cyan)">${n(rq.unique_visitors)}</div>
    <div class="cs">daily-hashed, no IPs</div>
  </div>
  <div class="card">
    <div class="cl">Unique Domains</div>
    <div class="cv" style="color:var(--purple)">${n(rq.unique_domains)}</div>
  </div>
  <div class="card">
    <div class="cl">Avg Latency</div>
    <div class="cv">${rq.avg_latency_ms}<span style="font-size:0.6rem;color:var(--muted)">ms</span></div>
  </div>
  <div class="card">
    <div class="cl">Error Rate</div>
    <div class="cv" style="color:${rq.error_rate_pct > 5 ? "var(--red)" : rq.error_rate_pct > 1 ? "var(--accent)" : "var(--green)"}">${rq.error_rate_pct}%</div>
  </div>
  <div class="card">
    <div class="cl">Repeat Scan %</div>
    <div class="cv">${rq.repeat_analysis_rate}%</div>
    <div class="cs">domains re-analyzed</div>
  </div>
</div>

<!-- ═══ COST & BUDGET ═══ -->
<h2>💰 Cost &amp; Budget <span style="font-size:0.65rem;color:var(--muted);font-weight:400">(today, UTC)</span></h2>
<div class="cards">
  <div class="card">
    <div class="cl">Analyses Today</div>
    <div class="cv" style="color:${budgetColor}">${budgetCount != null ? n(budgetCount) : "—"}${budgetLimit != null ? ` <span style="font-size:0.7rem;color:var(--muted)">/ ${n(budgetLimit)}</span>` : ""}</div>
    <div class="cs">${budget ? `${budgetPct}% of global daily budget` : "budget DO not bound"}</div>
  </div>
  <div class="card">
    <div class="cl">curl / JSON</div>
    <div class="cv" style="color:var(--cyan)">${budgetBreakdown ? n(budgetBreakdown.curl) : "—"}</div>
  </div>
  <div class="card">
    <div class="cl">/api/analyze</div>
    <div class="cv" style="color:var(--cyan)">${budgetBreakdown ? n(budgetBreakdown.analyze) : "—"}</div>
  </div>
  <div class="card">
    <div class="cl">/api/compare</div>
    <div class="cv" style="color:var(--cyan)">${budgetBreakdown ? n(budgetBreakdown.compare) : "—"}</div>
  </div>
  <div class="card">
    <div class="cl">Badge Refreshes</div>
    <div class="cv" style="color:var(--purple)">${budgetBreakdown ? n(budgetBreakdown.badge) : n(badgeRefreshesToday)}</div>
  </div>
  <div class="card">
    <div class="cl">Other</div>
    <div class="cv">${budgetBreakdown ? n(budgetBreakdown.other) : "—"}</div>
  </div>
  <div class="card">
    <div class="cl">Cache Hit-Rate</div>
    <div class="cv" style="color:var(--green)">${cacheHitRate != null ? `${cacheHitRate}%` : "—"}</div>
    <div class="cs">${cacheTotal > 0 ? `${n(cacheHits)} hit / ${n(cacheMisses)} miss` : "no lookups yet"}</div>
  </div>
  <div class="card">
    <div class="cl">WhoisFreaks Calls</div>
    <div class="cv" style="color:var(--accent)">${n(whoisCalls)}</div>
    <div class="cs">paid API (today)</div>
  </div>
  <div class="card">
    <div class="cl">PageSpeed Calls</div>
    <div class="cv" style="color:var(--accent)">${n(pagespeedCalls)}</div>
    <div class="cs">paid API (today)</div>
  </div>
</div>
${
  budgetLimit != null
    ? `<div style="margin-top:0.4rem;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
  <div style="height:100%;width:${budgetPct}%;background:${budgetColor};border-radius:4px"></div>
</div>`
    : ""
}

<!-- ═══ TRAFFIC OVER TIME ═══ -->
<h2>📈 Traffic Over Time</h2>
<div class="row3">
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Requests / Day</div>
    <div class="chart">
      ${rq.requests_per_day
        .map((d) => {
          const pct = Math.max((d.count / maxRequests) * 100, 3);
          return `<div class="bar" style="height:${pct}%;background:var(--accent)"><span class="tip">${d.date.slice(5)} · ${n(d.count)}</span></div>`;
        })
        .join("")}
    </div>
  </div>
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Unique Visitors / Day</div>
    <div class="chart">
      ${rq.visitors_per_day
        .map((d) => {
          const pct = Math.max((d.count / maxVisitors) * 100, 3);
          return `<div class="bar" style="height:${pct}%;background:var(--cyan)"><span class="tip">${d.date.slice(5)} · ${n(d.count)}</span></div>`;
        })
        .join("")}
    </div>
  </div>
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Unique Domains / Day</div>
    <div class="chart">
      ${rq.domains_per_day
        .map((d) => {
          const pct = Math.max((d.count / maxDomains) * 100, 3);
          return `<div class="bar" style="height:${pct}%;background:var(--purple)"><span class="tip">${d.date.slice(5)} · ${n(d.count)}</span></div>`;
        })
        .join("")}
    </div>
  </div>
</div>
<!-- ═══ TRAFFIC SOURCES + GEO + HOURLY ═══ -->
<h2>🌍 Traffic Breakdown</h2>
<div class="row3">
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">By Client Type</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.6rem">
      ${Object.entries(rq.by_client_type)
        .map(([type, cnt]) => {
          const pct = (cnt / totalClientType) * 100;
          return `<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
          <span style="font-size:14px">${clientIcon(type)}</span>
          <span style="font-size:0.75rem;min-width:55px">${type}</span>
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px"></div>
          </div>
          <span style="font-size:0.7rem;color:var(--muted);min-width:42px;text-align:right">${n(cnt)}</span>
          <span style="font-size:0.65rem;color:var(--muted);min-width:32px;text-align:right">${pct.toFixed(0)}%</span>
        </div>`;
        })
        .join("")}
    </div>
  </div>
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Top Countries</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.6rem;max-height:200px;overflow-y:auto">
      ${
        rq.by_country.length > 0
          ? rq.by_country
              .map((c) => {
                const maxReq = rq.by_country[0]?.requests || 1;
                const pct = (c.requests / maxReq) * 100;
                return `<div style="display:flex;align-items:center;gap:0.35rem;margin-bottom:0.35rem">
          <span style="font-size:13px">${flag(c.country)}</span>
          <span style="font-size:0.7rem;min-width:22px">${c.country}</span>
          <div style="flex:1;height:5px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--cyan);border-radius:2px"></div>
          </div>
          <span style="font-size:0.65rem;color:var(--muted)">${n(c.requests)} / ${n(c.visitors)}v</span>
        </div>`;
              })
              .join("")
          : '<span style="font-size:0.7rem;color:var(--muted)">No data yet</span>'
      }
    </div>
  </div>
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Hourly Distribution (UTC)</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.6rem">
      <div class="heatmap">
        ${rq.by_hour
          .map((cnt, h) => {
            const intensity = maxHourly > 0 ? cnt / maxHourly : 0;
            const bg =
              intensity > 0.75
                ? "var(--accent)"
                : intensity > 0.5
                  ? "#b45309"
                  : intensity > 0.25
                    ? "#78350f"
                    : intensity > 0
                      ? "#451a03"
                      : "var(--border)";
            return `<div class="hm-cell" style="background:${bg}"><span class="tip">${String(h).padStart(2, "0")}:00 · ${n(cnt)}</span>${h % 6 === 0 ? h : ""}</div>`;
          })
          .join("")}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--muted);margin-top:3px;padding:0 2px">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  </div>
</div>

<!-- ═══ STATUS CODES ═══ -->
${
  Object.keys(rq.by_status).length > 0
    ? `
<div style="margin-top:0.75rem">
  <div class="row2">
    <div>
      <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Response Status Codes</div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:0.6rem;display:flex;flex-wrap:wrap;gap:0.5rem">
        ${Object.entries(rq.by_status)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([code, cnt]) => {
            const c = Number(code);
            const color = c < 300 ? "var(--green)" : c < 400 ? "var(--blue)" : c < 500 ? "var(--accent)" : "var(--red)";
            return `<div style="text-align:center;min-width:50px">
            <div style="font-size:0.85rem;font-weight:700;color:${color}">${code}</div>
            <div style="font-size:0.65rem;color:var(--muted)">${n(cnt)}</div>
          </div>`;
          })
          .join("")}
      </div>
    </div>
    <div></div>
  </div>
</div>
`
    : ""
}

<!-- ═══ API TRAFFIC (LEGACY COUNTERS) ═══ -->
<h2>📡 Endpoint Traffic</h2>
<div class="cards" style="grid-template-columns: repeat(auto-fit, minmax(110px, 1fr))">
  <div class="card">
    <div class="cl">Total Hits</div>
    <div class="cv" style="color:var(--accent)">${n(stats.total)}</div>
  </div>
  <div class="card">
    <div class="cl">Endpoints</div>
    <div class="cv">${endpoints.length}</div>
  </div>
  <div class="card">
    <div class="cl">Active Days</div>
    <div class="cv">${sortedDays.length}</div>
  </div>
  <div class="card">
    <div class="cl">Avg / Day</div>
    <div class="cv">${sortedDays.length ? n(Math.round(stats.total / sortedDays.length)) : "—"}</div>
  </div>
</div>
<div class="chart">
  ${sortedDays
    .map((d) => {
      const h = dayTotals[d];
      const pct = Math.max((h / maxDaily) * 100, 2);
      return `<div class="bar" style="height:${pct}%;background:var(--accent)"><span class="tip">${d.slice(5)} · ${h}</span></div>`;
    })
    .join("")}
</div>
<div style="margin-top:0.6rem">
<table>
  <thead><tr><th>Endpoint</th><th>Hits</th><th>%</th><th></th></tr></thead>
  <tbody>
    ${endpoints
      .map(([ep, total]) => {
        const pct = stats.total ? (total / stats.total) * 100 : 0;
        return `<tr><td class="mono">${ep}</td><td class="hits">${n(total)}</td><td class="hits">${pct.toFixed(1)}%</td><td><span class="pct-bar" style="width:${Math.max(pct, 1)}px;background:var(--accent)"></span></td></tr>`;
      })
      .join("")}
  </tbody>
</table>
</div>

<!-- ═══ SCORING INTELLIGENCE ═══ -->
${
  ss
    ? `
<h2>🎯 Scoring Intelligence</h2>
<div class="cards">
  <div class="card">
    <div class="cl">Total Scores</div>
    <div class="cv" style="color:var(--cyan)">${n(ss.total_scores)}</div>
  </div>
  <div class="card">
    <div class="cl">Unique Scored</div>
    <div class="cv" style="color:var(--cyan)">${n(ss.unique_domains)}</div>
  </div>
  <div class="card">
    <div class="cl">Avg Composite</div>
    <div class="cv" style="color:${ss.avg_composite >= 80 ? "var(--green)" : ss.avg_composite >= 60 ? "var(--accent)" : "var(--red)"}">${ss.avg_composite}/100</div>
  </div>
  <div class="card">
    <div class="cl">Daily Snapshots</div>
    <div class="cv">${n(stats.daily_snapshot_count)}</div>
    <div class="cs">longitudinal</div>
  </div>
</div>

${
  Object.keys(ss.tier_breakdown).length > 0
    ? `
<div class="row2">
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.2rem">Tier Distribution</div>
    <div class="tier-bar">
      ${["Excellent", "Strong", "Moderate", "Weak", "Critical"]
        .map((t) => {
          const cnt = ss.tier_breakdown[t] || 0;
          const pct = ss.total_scores ? (cnt / ss.total_scores) * 100 : 0;
          if (pct < 1) return "";
          return `<div class="tier-seg" style="flex:${pct};background:${tierColor(t)}">${t} ${Math.round(pct)}%</div>`;
        })
        .join("")}
    </div>
  </div>
  <div>
    <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.2rem">Archetype Breakdown</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden">
    <table style="margin:0"><tbody>
      ${Object.entries(ss.archetype_breakdown)
        .map(([arch, cnt]) => {
          const pct = ss.total_scores ? (cnt / ss.total_scores) * 100 : 0;
          return `<tr><td>${arch}</td><td class="hits">${n(cnt)}</td><td class="hits">${pct.toFixed(0)}%</td></tr>`;
        })
        .join("")}
    </tbody></table>
    </div>
  </div>
</div>
`
    : ""
}

${
  ss.daily_scores.length > 0
    ? `
<div style="margin-top:0.6rem">
  <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.3rem">Scores / Day (volume + avg composite)</div>
  <div class="chart">
    ${(() => {
      const maxCnt = Math.max(...ss.daily_scores.map((d) => d.count), 1);
      return ss.daily_scores
        .map((d) => {
          const pct = Math.max((d.count / maxCnt) * 100, 3);
          return `<div class="bar" style="height:${pct}%;background:var(--cyan)"><span class="tip">${d.date.slice(5)} · ${d.count} scores · avg ${d.avg}</span></div>`;
        })
        .join("");
    })()}
  </div>
</div>
`
    : ""
}
`
    : ""
}

<!-- ═══ TAB ENGAGEMENT ═══ -->
${
  stats.tab_views && Object.keys(stats.tab_views).length > 0
    ? `
<h2>📊 Tab Engagement <span style="font-size:0.65rem;color:var(--muted);font-weight:400">(7d)</span></h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:0.4rem">
  ${Object.entries(stats.tab_views)
    .map(
      ([tab, cnt]) => `
    <div class="card" style="text-align:center;padding:0.5rem">
      <div class="cl">${tab}</div>
      <div style="font-size:1.1rem;font-weight:700;margin-top:0.1rem">${n(cnt)}</div>
    </div>
  `,
    )
    .join("")}
</div>
`
    : ""
}

<!-- ═══ API ERRORS ═══ -->
${
  es && es.total > 0
    ? `
<h2>🔴 API Errors</h2>
<div class="cards" style="grid-template-columns: repeat(auto-fit, minmax(100px, 1fr))">
  <div class="card">
    <div class="cl">Total Errors</div>
    <div class="cv" style="color:var(--red)">${n(es.total)}</div>
  </div>
  ${Object.entries(es.by_api)
    .slice(0, 4)
    .map(
      ([api, cnt]) => `
  <div class="card">
    <div class="cl">${api}</div>
    <div class="cv" style="color:var(--red)">${n(cnt)}</div>
  </div>
  `,
    )
    .join("")}
</div>
${
  es.recent.length > 0
    ? `
<table>
  <thead><tr><th>Time</th><th>API</th><th>Error</th></tr></thead>
  <tbody>
    ${es.recent
      .map(
        (r) => `<tr>
      <td class="err-time">${new Date(r.ts).toISOString().slice(0, 16).replace("T", " ")}</td>
      <td class="mono">${r.api}</td>
      <td class="err-msg">${r.error}</td>
    </tr>`,
      )
      .join("")}
  </tbody>
</table>
`
    : ""
}
`
    : ""
}

<!-- ═══ DAILY BREAKDOWN ═══ -->
${
  recentDays.length > 0
    ? `
<h2>📅 Daily Breakdown <span style="font-size:0.65rem;color:var(--muted);font-weight:400">(last ${recentDays.length}d)</span></h2>
<div style="overflow-x:auto">
<table>
  <thead><tr><th>Endpoint</th>${recentDays.map((d) => `<th>${d.slice(5)}</th>`).join("")}</tr></thead>
  <tbody>
    ${endpoints
      .map(
        ([ep]) => `<tr>
      <td class="mono">${ep}</td>
      ${recentDays
        .map((d) => {
          const v = endpointDays[ep]?.[d] || 0;
          return `<td class="hits ${v === 0 ? "zero" : ""}">${v || "·"}</td>`;
        })
        .join("")}
    </tr>`,
      )
      .join("")}
    <tr style="font-weight:600">
      <td>Total</td>
      ${recentDays.map((d) => `<td class="hits">${dayTotals[d] || 0}</td>`).join("")}
    </tr>
  </tbody>
</table>
</div>
`
    : ""
}

<footer>
  <a href="/api/usage">JSON API</a> · <a href="/status">Status</a> · <a href="/api/cleanup">Run Cleanup</a> · All data aggregated — no IPs, no PII stored
</footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store", ...CORS_HEADERS },
  });
}
