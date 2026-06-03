// PDF report route handler — GET /report/:domain?sig=...&t=...
// Generates a downloadable PDF from cached analysis data

import type { Env } from "./helpers";
import { loadPdfFonts } from "./pdf-fonts";
import { generatePdfReport } from "./pdf-report";
import { signPayload, verifyPayload } from "./share";

const REPORT_PATH_RE = /^\/report\/([a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,})$/;

export function matchReportPath(path: string): string | null {
  const m = REPORT_PATH_RE.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Build a signed PDF report URL for a given domain + analyzed_at timestamp.
 * Returns null if SHARE_SECRET is not configured.
 */
export async function buildPdfUrl(
  domain: string,
  analyzedAt: string,
  baseUrl: string,
  env: Env,
): Promise<string | null> {
  if (!env.SHARE_SECRET) return null;
  try {
    const ts = Math.floor(new Date(analyzedAt).getTime() / 1000);
    const payload = `pdf:${domain}:${ts}`;
    const sig = await signPayload(payload, env);
    return `${baseUrl}/report/${domain}?sig=${encodeURIComponent(sig)}&t=${ts}`;
  } catch {
    return null;
  }
}

/** Escape HTML special characters to prevent XSS */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Branded HTML error page for missing/expired reports */
function reportErrorPage(domain: string, baseUrl: string): Response {
  const safeDomain = escapeHtml(domain);
  const safeBaseUrl = escapeHtml(baseUrl);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Report Unavailable — Yoke</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
           display: flex; align-items: center; justify-content: center; min-height: 100vh;
           background: #f6f8fa; color: #1f2328; }
    .card { background: #fff; border: 1px solid #d1d9e0; border-radius: 12px; padding: 48px;
            max-width: 480px; text-align: center; }
    h1 { font-size: 20px; font-weight: 600; color: #1e3a5f; margin-bottom: 12px; }
    p { font-size: 14px; color: #59636e; line-height: 1.6; margin-bottom: 24px; }
    a.btn { display: inline-block; background: #1e3a5f; color: #fff; padding: 10px 24px;
            border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; }
    a.btn:hover { background: #2a4f7a; }
    .brand { font-size: 12px; color: #6e7781; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Report Not Available</h1>
    <p>This report hasn't been generated yet or has expired.<br>
       Run a fresh analysis to generate a downloadable PDF.</p>
    <a class="btn" href="${safeBaseUrl}/${safeDomain}">Analyze ${safeDomain}</a>
    <div class="brand">yoke.lol — open-source domain intelligence</div>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleReportDownload(request: Request, env: Env, domain: string): Promise<Response> {
  const url = new URL(request.url);
  const baseUrl = env.BASE_URL || url.origin;
  const sig = url.searchParams.get("sig");
  const tStr = url.searchParams.get("t");

  // Validate signature params
  if (!sig || !tStr) {
    return reportErrorPage(domain, baseUrl);
  }

  const ts = parseInt(tStr, 10);
  if (Number.isNaN(ts) || ts <= 0) {
    return reportErrorPage(domain, baseUrl);
  }

  // Verify HMAC signature
  const payload = `pdf:${domain}:${ts}`;
  const valid = await verifyPayload(payload, sig, env);
  if (!valid) {
    return reportErrorPage(domain, baseUrl);
  }

  // Look up cached analysis data
  if (!env.REFERENCE_DATA) {
    return reportErrorPage(domain, baseUrl);
  }

  const raw = await env.REFERENCE_DATA.get(`cache:analysis:${domain}`, "text");
  if (!raw) {
    return reportErrorPage(domain, baseUrl);
  }

  let data: Record<string, unknown>;
  try {
    const envelope = JSON.parse(raw) as { data: Record<string, unknown>; cached_at: number };
    data = envelope.data;
  } catch {
    return reportErrorPage(domain, baseUrl);
  }

  // Generate PDF
  try {
    const fontData = await loadPdfFonts(env);
    const pdfBytes = await generatePdfReport(data, fontData);
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="yoke-report-${domain}.pdf"`,
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("[yoke:pdf] PDF generation failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "PDF generation failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
