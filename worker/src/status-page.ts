// ─── Public Status Page ──────────────────────────────────────────────
// Server-rendered HTML status page showing external API dependency health.
// Served at /status — no client JS bundle needed.

import { type ApiStatusRow, getStatusPageData } from "./api-errors";
import { CORS_HEADERS } from "./helpers";

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function statusColor(errors24h: number): string {
  if (errors24h === 0) return "#22c55e"; // green
  if (errors24h <= 3) return "#eab308"; // yellow
  return "#ef4444"; // red
}

function statusLabel(errors24h: number): string {
  if (errors24h === 0) return "Operational";
  if (errors24h <= 3) return "Degraded";
  return "Errors";
}

function barColor(errors: number): string {
  if (errors === 0) return "var(--bar-ok)";
  if (errors <= 2) return "var(--bar-warn)";
  return "var(--bar-err)";
}

function renderRow(api: ApiStatusRow): string {
  const bars = api.hourly
    .map((h) => {
      const c = barColor(h.errors);
      const title = `${h.hour} UTC — ${h.errors} error${h.errors !== 1 ? "s" : ""}`;
      return `<div class="bar" style="background:${c}" title="${title}"></div>`;
    })
    .join("");

  const sc = statusColor(api.errors_24h);
  const sl = statusLabel(api.errors_24h);

  const lastErr = api.last_error_ts
    ? `<div class="last-err">Last error: ${timeAgo(api.last_error_ts)} — HTTP ${api.last_error_status || "timeout"}: ${escHtml(api.last_error_message ?? "")}</div>`
    : "";

  return `
    <div class="api-row">
      <div class="api-header">
        <div class="api-name">
          <span class="dot" style="background:${sc}"></span>
          <strong>${escHtml(api.label)}</strong>
          <span class="api-url">${escHtml(api.url)}</span>
        </div>
        <div class="api-status" style="color:${sc}">${sl}</div>
      </div>
      <div class="bars">${bars}</div>
      <div class="bar-labels"><span>24h ago</span><span>now</span></div>
      ${api.errors_7d > 0 ? `<div class="api-stats">${api.errors_24h} errors (24h) · ${api.errors_7d} errors (7d)${lastErr}</div>` : ""}
    </div>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function renderStatusPage(
  db: D1Database | undefined,
  baseUrl = "https://yoke.lol",
  siteName = "Yoke",
  repoUrl = "https://github.com/yokedotlol/yoke",
): Promise<Response> {
  const data = await getStatusPageData(db);

  const totalErrors24h = data.apis.reduce((s, a) => s + a.errors_24h, 0);
  const overallColor = statusColor(totalErrors24h);
  const overallLabel =
    totalErrors24h === 0
      ? "All Systems Operational"
      : totalErrors24h <= 5
        ? "Some Services Degraded"
        : "Service Disruptions Detected";

  const rows = data.apis.map(renderRow).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName} Status</title>
  <meta name="description" content="Real-time status of ${siteName}'s external API dependencies.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=optional" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0a; --surface: #141414; --border: #262626;
      --text: #e5e5e5; --muted: #737373; --accent: #a78bfa;
      --bar-ok: #22c55e33; --bar-warn: #eab308; --bar-err: #ef4444;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #fafafa; --surface: #ffffff; --border: #e5e5e5;
        --text: #171717; --muted: #737373; --accent: #7c3aed;
        --bar-ok: #22c55e44; --bar-warn: #eab308; --bar-err: #ef4444;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem; }
    header { margin-bottom: 2rem; }
    .logo { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.02em; }
    .logo a { color: var(--text); text-decoration: none; }
    .logo span { color: var(--accent); }
    h1 { font-size: 1.5rem; font-weight: 600; margin: 1rem 0 0.25rem; }
    .overall { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem; }
    .overall .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .subtitle { color: var(--muted); font-size: 0.875rem; }
    .api-row { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 0.75rem; }
    .api-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .api-name { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
    .api-name .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .api-url { color: var(--muted); font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; }
    .api-status { font-size: 0.8rem; font-weight: 500; }
    .bars { display: flex; gap: 2px; height: 24px; align-items: stretch; }
    .bar { flex: 1; border-radius: 2px; min-width: 3px; transition: opacity 0.15s; cursor: default; }
    .bar:hover { opacity: 0.7; }
    .bar-labels { display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--muted); margin-top: 2px; }
    .api-stats { font-size: 0.75rem; color: var(--muted); margin-top: 0.4rem; }
    .last-err { font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; margin-top: 0.2rem; color: var(--bar-err); }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); font-size: 0.75rem; color: var(--muted); display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
    footer a { color: var(--accent); text-decoration: none; }
    .json-link { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }
    @media (max-width: 600px) {
      .api-url { display: none; }
      .container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo"><a href="${baseUrl}">⚡ ${escHtml(siteName.toLowerCase())}</a></div>
      <h1>API Status</h1>
      <div class="overall"><span class="dot" style="background:${overallColor}"></span>${escHtml(overallLabel)}</div>
      <p class="subtitle">Real-time health of external APIs that ${siteName} depends on. Each bar = 1 hour over the last 24h. <a href="/api/health" class="json-link">JSON</a></p>
    </header>
    ${rows}
    <footer>
      <span>Updated ${escHtml(data.generated_at)} · Errors auto-prune after 7 days</span>
      <span><a href="${baseUrl}">${escHtml(new URL(baseUrl).hostname)}</a>${repoUrl ? ` · <a href="${escHtml(repoUrl)}">Source</a>` : ""}</span>
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=60",
      ...CORS_HEADERS,
    },
  });
}
