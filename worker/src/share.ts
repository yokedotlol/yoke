// Share card system — payload encoding, OG tags, dynamic OG image, report card page
// Route handlers for /r/:payload.:sig and /og/:payload.:sig.png (was .svg)
// Compare share handlers: /c/:payload.:sig and /cog/:payload.:sig.png

import type { Branding, Env } from "./helpers";
import { getBaseUrl, getBranding } from "./helpers";
import { svgToPng } from "./og/png-render";
import { getHtmlSecurityHeaders } from "./spa";

// ─── Shield Logo (base64 PNG) ───────────────────────────────────────
const SHIELD_LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAAAAAAAAPlDu38AAAAHdElNRQfqBgcBIANk00ByAAAEaUlEQVRo3uWaW4hVVRjHf0cdL1gjZpZWUo6jWJKXJIsiSupBIiLopZ566K0Iid4KInqvDCKi5yCCrvQkDZl2MUtH0QwvaQpaSmk5mTS38+thrcPZHveZc87ae2aM/rA5e6+91rf+/3X71rf2gf84KmUaU2s2p8Vranw1CozEy0qlvGqTLGWIzgYWAIuBHuBG4Drg6vhueiwyCJwHzgC/AseBn4BjwGng71RhbZWIhAFmRpJrgbuAVZH8PGBGBw1iFPU78DOwB9gO7IriBgHaEdQ0R4Z0F9AL3A9sANYA11IfHmVhFDgF9AObgc8JvTQ8lphLUjPE5wPrgUeBeyLpKSWTbtp+Ucw24H1gC2H4jd0rau1ap36tDjn5GFK3qqtr/FoJmKV+Otmsc/CeOr1RQN6QmAMsm6Ch0gmWA1c2JuYJqFCyfygJuZwmalKOG1IEjBJWibJhtD3uAg4TnE/ZOJJiN0WAwIvAd0C1BOKjwDfASyT0bIqA3vj7EPAssJuEro9ldgEbgYcJW5GeQk0R/cBC9VCLNblfXRrzL1A3qgfaXM+r6n71GfWaaOMWdW+LcnvVebbhyNoRoPqFusK6916iblLPjlHmjPqKujhTbqXB67dC6QJUd6irMmSmqQ9EcY2t3qeuj3lq+dfG3mwH4yJAdad6a4YUao+6L5Pne/WGhjy3qbs7qCdXQBmObC3wNhdvP44CH2eePwJOZJ5XAG8Bq4tWnidglM5XlTuB14GFmbTPCFHYn0BfJn0R8AZwe4d1VMlZZvMEDAEXEhpjA/AC9TDyR4JjOgwcjGkzCev9fQn2/yJGaq0EDAIDCRUAPBGFAJyNIvYB52LaI8DjibbPE6OzVgKGCwi4AniasO2tAj8A++O7ucBTwKxE2+cIpxotBYwQw7dE3E2YEwAHqA+fe4F1Bez+Rs7WpdkqdLJARbOpD6MjhKMTgAcJ24VUnMhLnJZ9qFQqtZjzaIGKIBy5dMeGqBLOie4oYK9aa4jGoL5ZDxwizPpU9AI3ESbyH9QPvVJxjnDEcgmaCThKky5rE3MJjm2E4FNuJvRIKo5RH4ptCThN2KOnYiqwJPO8lGJx9jaaLCzNBFQJ7j/FodWwKHN/fQE7A1y8LRlbQGaSbCWciKVifrTfFe9TsRn4toFbcwEZnAdeI90ndBNWuS5yznPaxClgE/BPswy5AjJKtxA2Ximx72zCXOiK951iJJLf3sCptYBMgSphl/lBAoGrCJN3WbzvFO8Cb1Lkg0gm+FisftlB8KE6op5Uf4n3naAvGwAVQkbEqg4jqFTsUJeXQj5HxDpbnx4UwU7bOUYvQcSecWr58SGfI2K1+lWJ5Psse9i0IaJH/VAdLUB8WH3HsiZsgoh56qvqhQTyA+rLaveEEW8iZIb6pHq8A/KH1ceMh1yTCi+e3Jsde80fVj8xc5p3WaBhSD1vcGCNOK4+p84pk/x4/FdiCrCS8H15DSGg6SdsR/ZzOfxXok0hEDZy0OJr+/8a/wLbgeqeGFQuqQAAAABJRU5ErkJggg==";

// ─── Types ───────────────────────────────────────────────────────────

interface SharePayload {
  d: string; // domain
  s: number; // composite score
  g: string; // tier (was grade)
  a: number[]; // axis scores [security, foundations, reputation, speed, discoverability, email]
  t: number; // unix timestamp (seconds)
}

interface CompareSharePayload {
  d1: string; // domain 1
  d2: string; // domain 2
  s1: number; // composite score 1
  s2: number; // composite score 2
  g1: string; // tier 1 (was grade 1)
  g2: string; // tier 2 (was grade 2)
  a1: number[]; // axis scores 1 [security, foundations, reputation, speed, discoverability, email]
  a2: number[]; // axis scores 2
  t: number; // unix timestamp (seconds)
}

// ─── Base64url helpers ───────────────────────────────────────────────

function base64urlEncode(data: Uint8Array): string {
  let b64 = "";
  const bytes = data;
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;
    b64 += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(triplet >> 18) & 0x3f];
    b64 += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(triplet >> 12) & 0x3f];
    b64 += i + 1 < len ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[(triplet >> 6) & 0x3f] : "";
    b64 += i + 2 < len ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[triplet & 0x3f] : "";
  }
  // Convert to URL-safe: + → -, / → _, strip =
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  // Restore standard base64
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return bytes;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ─── HMAC ────────────────────────────────────────────────────────────

async function getHmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.SHARE_SECRET;
  if (!secret) {
    throw new Error("SHARE_SECRET environment variable is not configured — share feature is unavailable");
  }
  return crypto.subtle.importKey("raw", textToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signPayload(payload: string, env: Env): Promise<string> {
  const key = await getHmacKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, textToBytes(payload));
  return base64urlEncode(new Uint8Array(sig));
}

export async function verifyPayload(payload: string, signature: string, env: Env): Promise<boolean> {
  const key = await getHmacKey(env);
  try {
    const sigBytes = base64urlDecode(signature);
    return crypto.subtle.verify("HMAC", key, sigBytes, textToBytes(payload));
  } catch {
    return false;
  }
}

// ─── Payload parsing ─────────────────────────────────────────────────

function parseShareToken(token: string): { payload: string; signature: string; data: SharePayload } | null {
  // Token format: PAYLOAD.SIGNATURE (both base64url)
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 1) return null;
  const payload = token.substring(0, dotIdx);
  const signature = token.substring(dotIdx + 1);
  try {
    const jsonStr = bytesToText(base64urlDecode(payload));
    const data = JSON.parse(jsonStr) as SharePayload;
    if (
      !data.d ||
      typeof data.s !== "number" ||
      !data.g ||
      !Array.isArray(data.a) ||
      data.a.length < 5 ||
      data.a.length > 6
    ) {
      return null;
    }
    return { payload, signature, data };
  } catch {
    return null;
  }
}

function parseCompareShareToken(
  token: string,
): { payload: string; signature: string; data: CompareSharePayload } | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 1) return null;
  const payload = token.substring(0, dotIdx);
  const signature = token.substring(dotIdx + 1);
  try {
    const jsonStr = bytesToText(base64urlDecode(payload));
    const data = JSON.parse(jsonStr) as CompareSharePayload;
    if (
      !data.d1 ||
      !data.d2 ||
      typeof data.s1 !== "number" ||
      typeof data.s2 !== "number" ||
      !data.g1 ||
      !data.g2 ||
      !Array.isArray(data.a1) ||
      data.a1.length < 5 ||
      data.a1.length > 6 ||
      !Array.isArray(data.a2) ||
      data.a2.length < 5 ||
      data.a2.length > 6
    ) {
      return null;
    }
    return { payload, signature, data };
  } catch {
    return null;
  }
}

// ─── Server-side share URL builder ───────────────────────────────────

const AXIS_ORDER = ["security", "foundations", "reputation", "speed", "discoverability", "email"] as const;

/**
 * Build a signed share URL from analysis result data.
 * Returns null if SHARE_SECRET is not configured or data is incomplete.
 */
export async function buildShareUrl(
  domain: string,
  composite: number,
  tier: string,
  axes: Record<string, { score?: number }>,
  analyzedAt: string,
  baseUrl: string,
  env: Env,
): Promise<string | null> {
  if (!env.SHARE_SECRET) return null;
  try {
    const axisScores = AXIS_ORDER.map((a) => axes[a]?.score ?? 0);
    const ts = Math.floor(new Date(analyzedAt).getTime() / 1000);
    const obj = { d: domain, s: composite, g: tier, a: axisScores, t: ts };
    const payload = base64urlEncode(textToBytes(JSON.stringify(obj)));
    const sig = await signPayload(payload, env);
    return `${baseUrl}/r/${payload}.${sig}`;
  } catch {
    return null;
  }
}

// ─── Signing endpoint ────────────────────────────────────────────────

export async function handleShareSign(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { payload?: string };
  if (!body.payload || typeof body.payload !== "string") {
    return new Response(JSON.stringify({ error: "payload is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  // Validate the payload is well-formed before signing
  try {
    const jsonStr = bytesToText(base64urlDecode(body.payload));
    const data = JSON.parse(jsonStr);
    // Accept single-domain payload (has 'd') or compare payload (has 'd1')
    const isSingle = data.d && typeof data.s === "number" && data.g;
    const isCompare =
      data.d1 && data.d2 && typeof data.s1 === "number" && typeof data.s2 === "number" && data.g1 && data.g2;
    if (!isSingle && !isCompare) {
      throw new Error("Invalid payload shape");
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid payload format" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  const sig = await signPayload(body.payload, env);
  return new Response(JSON.stringify({ signature: sig }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ─── HTML helpers ────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function tierColor(tier: string): string {
  if (tier === "Excellent") return "#3fb950";
  if (tier === "Strong") return "#58a6ff";
  if (tier === "Moderate") return "#d29922";
  if (tier === "Weak") return "#ffa198";
  return "#f85149"; // Critical
}

function scoreColor(score: number): string {
  if (score >= 80) return "#3fb950"; // green (matches --success)
  if (score >= 60) return "#d29922"; // amber (matches --warning)
  return "#f85149"; // red (matches --danger)
}

const AXIS_LABELS = ["Security", "Foundations", "Reputation", "Speed", "Discoverability", "Email"];
const AXIS_ABBR_OG = ["SEC", "FND", "REP", "SPD", "DSC", "EML"];

// ─── OG Image (SVG) ─────────────────────────────────────────────────

function generateOgSvg(data: SharePayload, brand?: Branding): string {
  const brandName = brand?.nameUpper || "YOKE";
  const brandDomain = brand?.domain || "yoke.lol";
  const domain = esc(data.d);
  const score = data.s;
  const tier = data.g;
  const gc = tierColor(tier);
  const sc = scoreColor(score);
  const dateStr = new Date(data.t * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Build axis pills
  const pillWidth = 108;
  const pillGap = 12;
  const totalPillsWidth = 6 * pillWidth + 5 * pillGap;
  const pillStartX = (1200 - totalPillsWidth) / 2;

  const axisPills = data.a
    .map((val, i) => {
      const x = pillStartX + i * (pillWidth + pillGap);
      const y = 430;
      const color = scoreColor(val);
      return `
      <rect x="${x}" y="${y}" width="${pillWidth}" height="${70}" rx="8" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.25" stroke-width="1"/>
      <text x="${x + pillWidth / 2}" y="${y + 24}" fill="#94a3b8" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="11" font-weight="700" text-anchor="middle" letter-spacing="0.8">${AXIS_ABBR_OG[i] ?? ""}</text>
      <text x="${x + pillWidth / 2}" y="${y + 52}" fill="${color}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="22" font-weight="700" text-anchor="middle">${val}</text>
    `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Border -->
  <rect x="0.5" y="0.5" width="1199" height="629" rx="0" fill="none" stroke="#334155" stroke-width="1"/>

  <!-- Yoke branding top-left -->
  <text x="48" y="56" fill="#818cf8" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="22" font-weight="800" letter-spacing="1.5">${brandName}</text>

  <!-- Domain name centered -->
  <text x="600" y="170" fill="#f1f5f9" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="42" font-weight="700" text-anchor="middle" letter-spacing="-0.5">${domain.length > 30 ? `${domain.substring(0, 30)}…` : domain}</text>

  <!-- Big score number centered -->
  <text x="600" y="300" fill="${sc}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="96" font-weight="800" text-anchor="middle" letter-spacing="-2">${score}</text>

  <!-- Tier pill centered -->
  <rect x="${600 - 70}" y="325" width="140" height="38" rx="19" fill="${gc}" fill-opacity="0.15" stroke="${gc}" stroke-opacity="0.35" stroke-width="1.5"/>
  <text x="600" y="350" fill="${gc}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="15" font-weight="700" text-anchor="middle" letter-spacing="1.5">${esc(tier).toUpperCase()}</text>

  <!-- Axis pills -->
  ${axisPills}

  <!-- Footer date -->
  <text x="1152" y="595" fill="#475569" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="13" text-anchor="end">Scanned ${dateStr}</text>
  <text x="48" y="595" fill="#475569" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="13">${brandDomain}</text>
</svg>`;
}

// ─── Report card page ────────────────────────────────────────────────

function generateReportPage(data: SharePayload, baseUrl: string, token: string, brand?: Branding): string {
  const brandName = brand?.name || "Yoke";
  const brandNameUpper = brand?.nameUpper || "YOKE";
  const domain = esc(data.d);
  const score = data.s;
  const tier = data.g;
  const gc = tierColor(tier);
  const sc = scoreColor(score);
  const analyzedDate = new Date(data.t * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const ogImageUrl = `${baseUrl}/og/${esc(token)}.png`;
  const shareUrl = `${baseUrl}/r/${esc(token)}`;

  const axisBarsHtml = data.a
    .map((val, i) => {
      const color = scoreColor(val);
      return `
      <div class="axis-row">
        <span class="axis-label">${AXIS_LABELS[i]}</span>
        <div class="axis-bar-track">
          <div class="axis-bar-fill" style="width:${Math.max(2, val)}%;background:${color}"></div>
        </div>
        <span class="axis-val" style="color:${color}">${val}</span>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${domain} scored ${score} (${esc(tier)}) — ${brandName}</title>
  <meta name="description" content="Security ${data.a[0]} · Foundations ${data.a[1]} · Reputation ${data.a[2]} · Speed ${data.a[3]} · Discoverability ${data.a[4]} · Email ${data.a[5] ?? "N/A"} — Free domain intelligence report"/>
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="${domain} scored ${score} (${esc(tier)}) — ${brandName}"/>
  <meta property="og:description" content="Security ${data.a[0]} · Foundations ${data.a[1]} · Reputation ${data.a[2]} · Speed ${data.a[3]} · Discoverability ${data.a[4]} · Email ${data.a[5] ?? "N/A"} — Free domain intelligence report"/>
  <meta property="og:image" content="${ogImageUrl}"/>
  <meta property="og:image:type" content="image/png"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${shareUrl}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${domain} scored ${score} (${esc(tier)}) — ${brandName}"/>
  <meta name="twitter:description" content="Security ${data.a[0]} · Foundations ${data.a[1]} · Reputation ${data.a[2]} · Speed ${data.a[3]} · Discoverability ${data.a[4]} · Email ${data.a[5] ?? "N/A"}"/>
  <meta name="twitter:image" content="${ogImageUrl}"/>
  <link rel="canonical" href="${shareUrl}"/>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:16px;max-width:560px;width:100%;padding:40px;position:relative;overflow:hidden}
    .card::before{content:"";position:absolute;top:0;left:0;right:0;height:120px;background:linear-gradient(180deg,${gc}11 0%,transparent 100%);pointer-events:none}
    .brand{display:flex;align-items:center;gap:8px;margin-bottom:28px;position:relative}
    .brand-name{color:#8b949e;font-size:14px;font-weight:600;letter-spacing:2px}
    .brand-sub{color:#484f58;font-size:12px}
    .domain{font-size:28px;font-weight:700;color:#e6edf3;word-break:break-all;margin-bottom:8px;position:relative}
    .timestamp{font-size:13px;color:#484f58;margin-bottom:32px;position:relative}
    .score-section{display:flex;align-items:center;gap:32px;margin-bottom:32px;position:relative}
    .score-ring{position:relative;width:140px;height:140px;flex-shrink:0}
    .score-ring svg{width:140px;height:140px}
    .score-num{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
    .score-num .val{font-size:48px;font-weight:700;color:${sc};line-height:1}
    .score-num .unit{font-size:14px;color:#8b949e;margin-top:2px}
    .tier-badge{min-width:auto;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:${gc};background:${gc}1a;border:2px solid ${gc}33;flex-shrink:0;padding:0 16px}
    .axes{display:flex;flex-direction:column;gap:12px;margin-bottom:36px;position:relative}
    .axis-row{display:flex;align-items:center;gap:12px}
    .axis-label{width:100px;font-size:13px;color:#8b949e;text-align:right;flex-shrink:0}
    .axis-bar-track{flex:1;height:20px;background:#21262d;border-radius:4px;overflow:hidden}
    .axis-bar-fill{height:100%;border-radius:4px;transition:width 0.6s ease}
    .axis-val{width:32px;font-size:14px;font-weight:600;text-align:right;flex-shrink:0}
    .cta{display:block;text-align:center;padding:14px 24px;background:${gc};color:#0d1117;font-size:15px;font-weight:600;border-radius:10px;text-decoration:none;transition:opacity 0.15s;position:relative}
    .cta:hover{opacity:0.85}
    .footer{margin-top:24px;text-align:center;font-size:12px;color:#484f58}
    .footer a{color:#8b949e;text-decoration:none}
    .footer a:hover{text-decoration:underline}
    @media(max-width:480px){
      .card{padding:24px}
      .domain{font-size:22px}
      .score-section{gap:20px}
      .score-ring{width:110px;height:110px}
      .score-ring svg{width:110px;height:110px}
      .score-num .val{font-size:36px}
      .tier-badge{min-width:auto;height:44px;font-size:18px;padding:0 12px}
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="${SHIELD_LOGO_DATA_URI}" alt="${brandName}" width="22" height="22" style="opacity:0.7"/>
      <span class="brand-name">${brandNameUpper}</span>
      <span class="brand-sub">DOMAIN INTELLIGENCE</span>
    </div>
    <div class="domain">${domain}</div>
    <div class="timestamp">Analyzed on ${esc(analyzedDate)}</div>
    <div class="score-section">
      <div class="score-ring">
        <svg viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="58" fill="none" stroke="#21262d" stroke-width="8"/>
          <circle cx="70" cy="70" r="58" fill="none" stroke="${sc}" stroke-width="8" stroke-dasharray="${(score / 100) * 364.4} 364.4" stroke-linecap="round" transform="rotate(-90 70 70)" opacity="0.8"/>
        </svg>
        <div class="score-num">
          <div class="val">${score}</div>
          <div class="unit"></div>
        </div>
      </div>
      <div class="tier-badge">${esc(tier)}</div>
    </div>
    <div class="axes">${axisBarsHtml}</div>
    <a class="cta" href="${baseUrl}/${esc(data.d)}">🔍 Analyze ${domain} now</a>
  </div>
  <div class="footer">
    <a href="${baseUrl}">${new URL(baseUrl).hostname}</a> — Free domain intelligence for everyone
  </div>
</body>
</html>`;
}

// ─── Bot detection ───────────────────────────────────────────────────

function isBotUA(ua: string): boolean {
  const lower = ua.toLowerCase();
  return (
    lower.includes("twitterbot") ||
    lower.includes("facebookexternalhit") ||
    lower.includes("facebot") ||
    lower.includes("linkedinbot") ||
    lower.includes("slackbot") ||
    lower.includes("slack-imgproxy") ||
    lower.includes("discordbot") ||
    lower.includes("telegrambot") ||
    lower.includes("whatsapp") ||
    lower.includes("signal") ||
    lower.includes("applebot") ||
    lower.includes("googlebot") ||
    lower.includes("bingbot") ||
    lower.includes("redditbot") ||
    lower.includes("pinterestbot") ||
    lower.includes("embedly") ||
    lower.includes("iframely") ||
    lower.includes("preview")
  );
}

// ─── Route handlers ──────────────────────────────────────────────────

const SHARE_PATH_RE = /^\/r\/(.+)$/;
const OG_IMAGE_PATH_RE = /^\/og\/(.+)\.png$/;

export function matchSharePath(path: string): string | null {
  const m = SHARE_PATH_RE.exec(path);
  return m ? m[1] : null;
}

export function matchOgImagePath(path: string): string | null {
  const m = OG_IMAGE_PATH_RE.exec(path);
  return m ? m[1] : null;
}

/** Handle GET /r/:token — report card page or OG-only HTML for bots */
export async function handleSharePage(request: Request, env: Env, token: string): Promise<Response> {
  const parsed = parseShareToken(token);
  if (!parsed) {
    return new Response("Invalid share link", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const valid = await verifyPayload(parsed.payload, parsed.signature, env);
  if (!valid) {
    return new Response("Invalid or tampered share link", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const baseUrl = getBaseUrl(request, env);
  const brand = getBranding(request, env);
  const brandName = brand.name;
  const _brandNameUpper = brand.nameUpper;
  const ua = request.headers.get("User-Agent") || "";

  if (isBotUA(ua)) {
    // Minimal HTML with OG tags for crawlers
    const ogImageUrl = `${baseUrl}/og/${token}.png`;
    const shareUrl = `${baseUrl}/r/${token}`;
    const d = parsed.data;
    const domain = esc(d.d);
    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>${domain} scored ${d.s} (${esc(d.g)}) — ${brandName}</title>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${domain} scored ${d.s} (${esc(d.g)}) — ${brandName}"/>
<meta property="og:description" content="Security ${d.a[0]} · Foundations ${d.a[1]} · Reputation ${d.a[2]} · Speed ${d.a[3]} · Discoverability ${d.a[4]} · Email ${d.a[5] ?? "N/A"} — Free domain intelligence report"/>
<meta property="og:image" content="${esc(ogImageUrl)}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(shareUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${domain} scored ${d.s} (${esc(d.g)}) — ${brandName}"/>
<meta name="twitter:description" content="Security ${d.a[0]} · Foundations ${d.a[1]} · Reputation ${d.a[2]} · Speed ${d.a[3]} · Discoverability ${d.a[4]} · Email ${d.a[5] ?? "N/A"}"/>
<meta name="twitter:image" content="${esc(ogImageUrl)}"/>
<link rel="canonical" href="${esc(shareUrl)}"/>
</head><body></body></html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=86400",
        ...getHtmlSecurityHeaders(baseUrl),
      },
    });
  }

  // Browser: full report card page
  const html = generateReportPage(parsed.data, baseUrl, token, brand);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=86400",
      ...getHtmlSecurityHeaders(baseUrl),
    },
  });
}

/** Handle GET /og/:token.png — dynamic OG image as PNG */
export async function handleOgImage(_request: Request, env: Env, token: string): Promise<Response> {
  const parsed = parseShareToken(token);
  if (!parsed) {
    return new Response("Invalid token", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const valid = await verifyPayload(parsed.payload, parsed.signature, env);
  if (!valid) {
    return new Response("Invalid token", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const brand = getBranding(_request, env);
  const svg = generateOgSvg(parsed.data, brand);

  // Render SVG→PNG inline (resvg-wasm)
  try {
    const png = await svgToPng(svg);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown rendering error";
    console.error("[yoke:og] OG render failed:", message);
    return new Response("OG image rendering failed", { status: 500 });
  }
}

// ─── Compare share routes ────────────────────────────────────────────

const COMPARE_SHARE_PATH_RE = /^\/c\/(.+)$/;
const COMPARE_OG_IMAGE_PATH_RE = /^\/cog\/(.+)\.png$/;

export function matchCompareSharePath(path: string): string | null {
  const m = COMPARE_SHARE_PATH_RE.exec(path);
  return m ? m[1] : null;
}

export function matchCompareOgImagePath(path: string): string | null {
  const m = COMPARE_OG_IMAGE_PATH_RE.exec(path);
  return m ? m[1] : null;
}

// ─── Compare OG SVG ──────────────────────────────────────────────────

function generateCompareOgSvg(data: CompareSharePayload, brand?: Branding): string {
  const brandName = brand?.nameUpper || "YOKE";
  const brandDomain = brand?.domain || "yoke.lol";
  const d1 = esc(data.d1.length > 24 ? `${data.d1.substring(0, 24)}…` : data.d1);
  const d2 = esc(data.d2.length > 24 ? `${data.d2.substring(0, 24)}…` : data.d2);
  const gc1 = tierColor(data.g1);
  const gc2 = tierColor(data.g2);
  const sc1 = scoreColor(data.s1);
  const sc2 = scoreColor(data.s2);

  // Use higher-scoring domain's tier color for the ambient glow
  const glowColor = data.s1 >= data.s2 ? gc1 : gc2;

  // Axis comparison bars — two bars per axis, matching single-domain bar style
  const axisBars = AXIS_LABELS.map((label, i) => {
    const v1 = data.a1[i];
    const v2 = data.a2[i];
    const c1 = scoreColor(v1);
    const c2 = scoreColor(v2);
    const y = 235 + i * 47;
    const barMax = 400;
    const w1 = Math.max(4, (v1 / 100) * barMax);
    const w2 = Math.max(4, (v2 / 100) * barMax);
    return `
      <text x="570" y="${y + 16}" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="15" text-anchor="end">${label}</text>
      <rect x="590" y="${y}" width="${barMax}" height="20" rx="4" fill="#21262d"/>
      <rect x="590" y="${y}" width="${w1}" height="20" rx="4" fill="${c1}" opacity="0.85"/>
      <text x="1000" y="${y + 15}" fill="${c1}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="14" font-weight="600" text-anchor="start">${v1}</text>
      <rect x="590" y="${y + 24}" width="${barMax}" height="20" rx="4" fill="#21262d"/>
      <rect x="590" y="${y + 24}" width="${w2}" height="20" rx="4" fill="${c2}" opacity="0.7"/>
      <text x="1000" y="${y + 39}" fill="${c2}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="14" font-weight="600" text-anchor="start">${v2}</text>
    `;
  }).join("");

  // Score circle helper — same style as single-domain (stroke-width, inner fill, score text)
  const scoreCircle = (cx: number, cy: number, score: number, sc: string, tierName: string, gc: string, r: number) => {
    const circum = 2 * Math.PI * r;
    const tierBadgeW = Math.max(80, tierName.length * 14 + 20);
    return `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#21262d" stroke-width="8"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${sc}" stroke-width="8" stroke-dasharray="${(score / 100) * circum} ${circum}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" opacity="0.7"/>
      <circle cx="${cx}" cy="${cy}" r="${r - 16}" fill="#0d1117" opacity="0.5"/>
      <text x="${cx}" y="${cy}" fill="${sc}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="52" font-weight="700" text-anchor="middle" dominant-baseline="central">${score}</text>
      <rect x="${cx - tierBadgeW / 2}" y="${cy + r + 14}" width="${tierBadgeW}" height="38" rx="10" fill="${gc}" opacity="0.15" stroke="${gc}" stroke-width="2"/>
      <text x="${cx}" y="${cy + r + 33}" fill="${gc}" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="18" font-weight="700" text-anchor="middle" dominant-baseline="central">${esc(tierName)}</text>
    `;
  };

  // Legend Y — right after last axis bar row
  const legendY = 235 + 6 * 47 + 8;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${glowColor}" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="${glowColor}" stop-opacity="0"/>
    </linearGradient>
    <filter id="invert">
      <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="200" fill="url(#glow)"/>

  <!-- Border -->
  <rect x="0.5" y="0.5" width="1199" height="629" rx="0" fill="none" stroke="#30363d" stroke-width="1"/>

  <!-- Yoke branding — same position as single-domain -->
  <image x="56" y="50" width="28" height="28" href="${SHIELD_LOGO_DATA_URI}" opacity="0.7"/>
  <text x="92" y="72" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="18" font-weight="600" letter-spacing="2">${brandName}</text>
  <text x="170" y="72" fill="#484f58" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="14">DOMAIN COMPARISON</text>

  <!-- Domain 1 name -->
  <text x="60" y="130" fill="#e6edf3" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="34" font-weight="700">${d1}</text>

  <!-- vs -->
  <text x="60" y="160" fill="#484f58" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="16" font-weight="400" font-style="italic">vs</text>

  <!-- Domain 2 name -->
  <text x="60" y="192" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="34" font-weight="700">${d2}</text>

  <!-- Divider -->
  <line x1="60" y1="210" x2="520" y2="210" stroke="#30363d" stroke-width="1"/>

  <!-- Score circle — Domain 1 -->
  ${scoreCircle(150, 380, data.s1, sc1, data.g1, gc1, 85)}
  <text x="150" y="${380 + 85 + 62}" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="12" text-anchor="middle">${d1}</text>

  <!-- vs between circles -->
  <text x="270" y="385" fill="#484f58" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="16" font-weight="400" font-style="italic" text-anchor="middle">vs</text>

  <!-- Score circle — Domain 2 -->
  ${scoreCircle(390, 380, data.s2, sc2, data.g2, gc2, 85)}
  <text x="390" y="${380 + 85 + 62}" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="12" text-anchor="middle">${d2}</text>

  <!-- Axis comparison bars -->
  ${axisBars}

  <!-- Legend -->
  <rect x="590" y="${legendY}" width="12" height="12" rx="3" fill="${sc1}" opacity="0.85"/>
  <text x="608" y="${legendY + 10}" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="12">${d1}</text>
  <rect x="780" y="${legendY}" width="12" height="12" rx="3" fill="${sc2}" opacity="0.7"/>
  <text x="798" y="${legendY + 10}" fill="#8b949e" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="12">${d2}</text>

  <!-- Footer — same position as single-domain -->
  <text x="60" y="585" fill="#484f58" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="13">${brandDomain} — Free domain intelligence comparison</text>
  <text x="1140" y="585" fill="#484f58" font-family="Inter,system-ui,-apple-system,sans-serif" font-size="13" text-anchor="end">Analyzed ${new Date(data.t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</text>
</svg>`;
}

// ─── Compare report card page ────────────────────────────────────────

function generateCompareReportPage(
  data: CompareSharePayload,
  baseUrl: string,
  token: string,
  brand?: Branding,
): string {
  const brandName = brand?.name || "Yoke";
  const brandNameUpper = brand?.nameUpper || "YOKE";
  const d1 = esc(data.d1);
  const d2 = esc(data.d2);
  const gc1 = tierColor(data.g1);
  const gc2 = tierColor(data.g2);
  const sc1 = scoreColor(data.s1);
  const sc2 = scoreColor(data.s2);
  const delta = data.s1 - data.s2;
  const analyzedDate = new Date(data.t * 1000).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const ogImageUrl = `${baseUrl}/cog/${esc(token)}.png`;
  const shareUrl = `${baseUrl}/c/${esc(token)}`;

  const axisBarsHtml = AXIS_LABELS.map((label, i) => {
    const v1 = data.a1[i];
    const v2 = data.a2[i];
    const c1 = scoreColor(v1);
    const c2 = scoreColor(v2);
    return `
      <div class="axis-row">
        <span class="axis-label">${label}</span>
        <div class="axis-bars">
          <div class="axis-bar-track"><div class="axis-bar-fill" style="width:${Math.max(2, v1)}%;background:${c1}"></div></div>
          <div class="axis-bar-track"><div class="axis-bar-fill" style="width:${Math.max(2, v2)}%;background:${c2};opacity:0.7"></div></div>
        </div>
        <span class="axis-vals">
          <span style="color:${c1}">${v1}</span>
          <span style="color:#484f58"> / </span>
          <span style="color:${c2}">${v2}</span>
        </span>
      </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${d1} vs ${d2} — ${brandName} Comparison</title>
  <meta name="description" content="${d1} (${data.s1}/${esc(data.g1)}) vs ${d2} (${data.s2}/${esc(data.g2)}) — Domain intelligence comparison"/>
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="${d1} vs ${d2} — ${brandName} Comparison"/>
  <meta property="og:description" content="${d1} scored ${data.s1} (${esc(data.g1)}) · ${d2} scored ${data.s2} (${esc(data.g2)}) — Domain intelligence comparison"/>
  <meta property="og:image" content="${ogImageUrl}"/>
  <meta property="og:image:type" content="image/png"/>
  <meta property="og:image:width" content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url" content="${shareUrl}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${d1} vs ${d2} — ${brandName} Comparison"/>
  <meta name="twitter:description" content="${d1} scored ${data.s1} (${esc(data.g1)}) · ${d2} scored ${data.s2} (${esc(data.g2)})"/>
  <meta name="twitter:image" content="${ogImageUrl}"/>
  <link rel="canonical" href="${shareUrl}"/>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
    .card{background:#161b22;border:1px solid #30363d;border-radius:16px;max-width:600px;width:100%;padding:40px;position:relative;overflow:hidden}
    .brand{display:flex;align-items:center;gap:8px;margin-bottom:28px;position:relative}
    .brand-name{color:#8b949e;font-size:14px;font-weight:600;letter-spacing:2px}
    .brand-sub{color:#484f58;font-size:12px}
    .vs-header{text-align:center;margin-bottom:8px;position:relative}
    .vs-header .domain{font-size:24px;font-weight:700;color:#e6edf3}
    .vs-header .vs{font-size:14px;color:#484f58;font-style:italic;margin:4px 0}
    .timestamp{font-size:13px;color:#484f58;margin-bottom:28px;text-align:center;position:relative}
    .scores{display:flex;justify-content:center;gap:40px;margin-bottom:32px;position:relative}
    .score-col{display:flex;flex-direction:column;align-items:center;gap:8px}
    .score-ring{position:relative;width:100px;height:100px}
    .score-ring svg{width:100px;height:100px}
    .score-num{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;font-weight:700;line-height:1}
    .tier-badge{min-width:auto;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;padding:0 8px}
    .score-domain{font-size:11px;color:#8b949e;max-width:120px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .delta-badge{text-align:center;margin-bottom:28px;position:relative}
    .delta-badge span{font-size:13px;font-weight:600;padding:4px 12px;border-radius:8px;background:#21262d}
    .axes{display:flex;flex-direction:column;gap:10px;margin-bottom:32px;position:relative}
    .axis-row{display:flex;align-items:center;gap:10px}
    .axis-label{width:90px;font-size:12px;color:#8b949e;text-align:right;flex-shrink:0}
    .axis-bars{flex:1;display:flex;flex-direction:column;gap:2px}
    .axis-bar-track{height:8px;background:#21262d;border-radius:3px;overflow:hidden}
    .axis-bar-fill{height:100%;border-radius:3px}
    .axis-vals{width:68px;font-size:12px;font-weight:600;text-align:right;flex-shrink:0;font-family:monospace}
    .cta{display:block;text-align:center;padding:14px 24px;background:var(--cta-bg,#3fb950);color:#0d1117;font-size:15px;font-weight:600;border-radius:10px;text-decoration:none;transition:opacity 0.15s;position:relative}
    .cta:hover{opacity:0.85}
    .footer{margin-top:24px;text-align:center;font-size:12px;color:#484f58}
    .footer a{color:#8b949e;text-decoration:none}
    .footer a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <img src="${SHIELD_LOGO_DATA_URI}" alt="${brandName}" width="22" height="22" style="opacity:0.7"/>
      <span class="brand-name">${brandNameUpper}</span>
      <span class="brand-sub">DOMAIN COMPARISON</span>
    </div>
    <div class="vs-header">
      <div class="domain">${d1}</div>
      <div class="vs">vs</div>
      <div class="domain">${d2}</div>
    </div>
    <div class="timestamp">Analyzed on ${esc(analyzedDate)}</div>
    <div class="scores">
      <div class="score-col">
        <div class="score-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#21262d" stroke-width="6"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="${sc1}" stroke-width="6" stroke-dasharray="${(data.s1 / 100) * 251.3} 251.3" stroke-linecap="round" transform="rotate(-90 50 50)" opacity="0.8"/>
          </svg>
          <div class="score-num" style="color:${sc1}">${data.s1}</div>
        </div>
        <div class="tier-badge" style="color:${gc1};background:${gc1}1a;border:1.5px solid ${gc1}33">${esc(data.g1)}</div>
        <div class="score-domain">${d1}</div>
      </div>
      <div class="score-col">
        <div class="score-ring">
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#21262d" stroke-width="6"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="${sc2}" stroke-width="6" stroke-dasharray="${(data.s2 / 100) * 251.3} 251.3" stroke-linecap="round" transform="rotate(-90 50 50)" opacity="0.8"/>
          </svg>
          <div class="score-num" style="color:${sc2}">${data.s2}</div>
        </div>
        <div class="tier-badge" style="color:${gc2};background:${gc2}1a;border:1.5px solid ${gc2}33">${esc(data.g2)}</div>
        <div class="score-domain">${d2}</div>
      </div>
    </div>
    <div class="delta-badge"><span style="color:${delta > 0 ? "#3fb950" : delta < 0 ? "#f85149" : "#8b949e"}">${delta > 0 ? "+" : ""}${delta} point delta</span></div>
    <div class="axes">${axisBarsHtml}</div>
    <a class="cta" href="${baseUrl}/compare/${esc(data.d1)}/${esc(data.d2)}" style="--cta-bg:${gc1}">⚡ Full comparison on ${brandName}</a>
  </div>
  <div class="footer">
    <a href="${baseUrl}">${new URL(baseUrl).hostname}</a> — Free domain intelligence for everyone
  </div>
</body>
</html>`;
}

// ─── Compare route handlers ──────────────────────────────────────────

/** Handle GET /c/:token — compare report card page */
export async function handleCompareSharePage(request: Request, env: Env, token: string): Promise<Response> {
  const parsed = parseCompareShareToken(token);
  if (!parsed) {
    return new Response("Invalid compare share link", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const valid = await verifyPayload(parsed.payload, parsed.signature, env);
  if (!valid) {
    return new Response("Invalid or tampered compare share link", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const baseUrl = getBaseUrl(request, env);
  const brand = getBranding(request, env);
  const brandName = brand.name;
  const _brandNameUpper = brand.nameUpper;
  const ua = request.headers.get("User-Agent") || "";

  if (isBotUA(ua)) {
    const d = parsed.data;
    const ogImageUrl = `${baseUrl}/cog/${token}.png`;
    const shareUrl = `${baseUrl}/c/${token}`;
    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>${esc(d.d1)} vs ${esc(d.d2)} — ${brandName} Comparison</title>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(d.d1)} vs ${esc(d.d2)} — ${brandName} Comparison"/>
<meta property="og:description" content="${esc(d.d1)} scored ${d.s1} (${esc(d.g1)}) · ${esc(d.d2)} scored ${d.s2} (${esc(d.g2)}) — Domain intelligence comparison"/>
<meta property="og:image" content="${esc(ogImageUrl)}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${esc(shareUrl)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(d.d1)} vs ${esc(d.d2)} — ${brandName} Comparison"/>
<meta name="twitter:description" content="${esc(d.d1)} scored ${d.s1} (${esc(d.g1)}) · ${esc(d.d2)} scored ${d.s2} (${esc(d.g2)})"/>
<meta name="twitter:image" content="${esc(ogImageUrl)}"/>
<link rel="canonical" href="${esc(shareUrl)}"/>
</head><body></body></html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=86400",
        ...getHtmlSecurityHeaders(baseUrl),
      },
    });
  }

  const html = generateCompareReportPage(parsed.data, baseUrl, token, brand);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html;charset=UTF-8",
      "Cache-Control": "public, max-age=86400",
      ...getHtmlSecurityHeaders(baseUrl),
    },
  });
}

/** Handle GET /cog/:token.png — compare OG image as PNG */
export async function handleCompareOgImage(_request: Request, env: Env, token: string): Promise<Response> {
  const parsed = parseCompareShareToken(token);
  if (!parsed) {
    return new Response("Invalid token", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const valid = await verifyPayload(parsed.payload, parsed.signature, env);
  if (!valid) {
    return new Response("Invalid token", { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const brand = getBranding(_request, env);
  const svg = generateCompareOgSvg(parsed.data, brand);

  try {
    const png = await svgToPng(svg);
    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown rendering error";
    console.error("[yoke:og] Compare OG render failed:", message);
    return new Response("OG image rendering failed", { status: 500 });
  }
}
