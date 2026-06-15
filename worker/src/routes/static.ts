// Static content routes: well-known files, robots, sitemap, llms.txt, manifest, status

import { CORS_HEADERS } from "../helpers";
import { renderStatusPage } from "../status-page";
import type { RouteContext } from "./shared";

export function handle(rc: RouteContext): Response | Promise<Response> | null {
  const { url, path, method, env, baseUrl, host, brand } = rc;

  // ── MTA-STS policy file (served from mta-sts.yoke.lol) ──────────
  if (url.hostname === "mta-sts.yoke.lol" && path === "/.well-known/mta-sts.txt") {
    return new Response(
      [
        "version: STSv1",
        "mode: enforce",
        "mx: route1.mx.cloudflare.net",
        "mx: route2.mx.cloudflare.net",
        "mx: route3.mx.cloudflare.net",
        "max_age: 86400",
      ].join("\n"),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  }

  // security.txt — vulnerability disclosure contact
  if (method === "GET" && (path === "/.well-known/security.txt" || path === "/security.txt")) {
    return new Response(
      `Contact: https://github.com/yokedotlol/yoke/issues\nExpires: 2027-06-01T00:00:00.000Z\nPreferred-Languages: en\nCanonical: ${baseUrl}/.well-known/security.txt`,
      {
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "Cache-Control": "public, max-age=86400",
          ...CORS_HEADERS,
        },
      },
    );
  }

  if (method === "GET" && path === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml`, {
      headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=86400", ...CORS_HEADERS },
    });
  }

  if (method === "GET" && path === "/sitemap.xml") {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${baseUrl}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${baseUrl}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n  <url><loc>${baseUrl}/api/docs</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>\n  <url><loc>${baseUrl}/status</loc><changefreq>hourly</changefreq><priority>0.5</priority></url>\n  <url><loc>${baseUrl}/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n  <url><loc>${baseUrl}/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n</urlset>`,
      {
        headers: {
          "Content-Type": "application/xml;charset=UTF-8",
          "Cache-Control": "public, max-age=86400",
          ...CORS_HEADERS,
        },
      },
    );
  }

  if (method === "GET" && path === "/llms.txt") {
    return new Response(
      `# ${brand.name} — Free Domain Intelligence & OSINT Tool\n\n> ${brand.name} is a free, open-source domain intelligence tool at ${baseUrl}\n\n## What ${brand.name} Does\n\n${brand.name} provides instant, comprehensive analysis of any internet domain. Enter a domain name and get detailed intelligence across security, infrastructure, technology, performance, and business dimensions.\n\n## Key Capabilities\n\n- DNS Analysis: A, AAAA, MX, NS, TXT, CNAME, SOA records with DNSSEC validation\n- SSL/TLS: Certificate details, chain validation, TLS configuration grading, CAA records\n- WHOIS/RDAP: Registrar, registration and expiry dates, domain age\n- Security Audit: HTTP security headers, cookie security\n- Data Breaches: HIBP breach detection with time-decay scoring\n- Threat Intelligence: Shodan port/vulnerability data, GreyNoise IP classification\n- Technology Detection: Frameworks, CMS, CDN, WAF, deep WordPress fingerprinting\n- Email Authentication: SPF, DKIM, DMARC validation\n- Performance: Google PageSpeed, Core Web Vitals (mobile-first 60/40 blend), compression\n- Certificate Transparency: CT log monitoring for subdomain discovery\n- Business Intelligence: Company enrichment via Wikidata, Brandfetch, Crunchbase\n- AI Analysis: LLM-powered analysis from 6 expert personas\n\n## Free JSON API\n\nNo authentication required.\n\ncurl -s https://${host}/stripe.com | jq\ncurl -s "https://${host}/stripe.com?pretty"\ncurl -s https://${host}/stripe.com | jq '.ssl'\n\n## Links\n\n- Web UI: ${baseUrl}\n- API Docs: ${baseUrl}/api/docs\n- Source: ${brand.repoUrl}\n- License: MIT`,
      {
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "Cache-Control": "public, max-age=86400",
          ...CORS_HEADERS,
        },
      },
    );
  }

  // Status page — server-rendered, public
  if (method === "GET" && path === "/status") {
    return renderStatusPage(env.STATS_DB, baseUrl, brand.name, brand.repoUrl, env.UPTIME_URL);
  }

  // GET /manifest.json — PWA manifest for installability
  if (method === "GET" && path === "/manifest.json") {
    const manifest = {
      name: `${brand.name} — Domain Intelligence`,
      short_name: brand.name,
      description: "Free domain intelligence tool. Analyze any domain instantly.",
      start_url: "/",
      display: "standalone",
      background_color: "#0f1419",
      theme_color: "#0f1419",
      icons: [
        { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    };
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=86400",
        ...CORS_HEADERS,
      },
    });
  }

  return null; // not handled
}
