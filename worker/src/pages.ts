// Static page content — ported from build_combined.py
// NOTE: Privacy, Terms, and About pages are now React components in client/src/components/.
// Only security.txt, API docs, and other server-rendered content remain here.

import { YOKE_VERSION } from "./helpers";

export const SECURITY_TXT = `Contact: https://github.com/yokedotlol/yoke/issues
Expires: 2027-05-24T00:00:00.000Z
Preferred-Languages: en`;

export function getApiDocsHtml(host: string): string {
  const docsUrl = host.startsWith("http") ? host : `https://${host}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Documentation - Yoke</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0d1117;color:#c9d1d9;font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:2rem;line-height:1.7}h1{color:#58a6ff;margin-bottom:.5rem;font-size:2rem}h2{color:#8b949e;margin-top:2.5rem;margin-bottom:1rem;font-size:1.3rem;border-bottom:1px solid #21262d;padding-bottom:.5rem}h3{color:#c9d1d9;margin-top:1.5rem;margin-bottom:.5rem;font-size:1.1rem}.subtitle{color:#8b949e;margin-bottom:2rem;font-size:1.1rem}a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}code{background:#161b22;padding:2px 6px;border-radius:4px;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.9em;color:#79c0ff}pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem 1.2rem;overflow-x:auto;margin:.8rem 0;font-family:'SF Mono',Monaco,Consolas,monospace;font-size:.85rem;line-height:1.6;color:#c9d1d9}pre code{background:none;padding:0;color:inherit}.endpoint{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1rem 1.2rem;margin:.8rem 0}.method{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:700;font-size:.8rem;margin-right:.5rem}.method.get{background:#238636;color:#fff}.method.post{background:#1f6feb;color:#fff}.path{color:#79c0ff;font-family:'SF Mono',Monaco,Consolas,monospace;font-weight:600}.desc{color:#8b949e;margin-top:.4rem;font-size:.9rem}.tip{background:#0d1117;border:1px solid #1f6feb;border-radius:8px;padding:.8rem 1rem;margin:1rem 0;font-size:.9rem}.tip::before{content:"💡 ";font-size:1.1em}.back{margin-top:3rem;padding-top:1rem;border-top:1px solid #21262d}</style></head><body><h1>⚡ Yoke API</h1><p class="subtitle">Domain intelligence from your terminal. Free, no auth required.</p><h2>Quick Start</h2><pre><span style="color:#8b949e"># Full domain analysis</span>
curl -s https://${host}/stripe.com | jq

<span style="color:#8b949e"># Pretty-printed (no jq needed)</span>
curl -s "https://${host}/stripe.com?pretty"

<span style="color:#8b949e"># Extract specific fields</span>
curl -s https://${host}/stripe.com | jq '.ssl'
curl -s https://${host}/stripe.com | jq '.dns'
curl -s https://${host}/stripe.com | jq '.tech_stack'
curl -s https://${host}/stripe.com | jq '.email_auth'

<span style="color:#8b949e"># Compare two domains</span>
curl -s -X POST https://${host}/api/compare \\
  -H "Content-Type: application/json" \\
  -d '{"domain1":"stripe.com","domain2":"shopify.com"}' | jq

<span style="color:#8b949e"># Check if a domain is registered</span>
curl -s https://${host}/thisdomaindoesnotexist.com | jq '.not_registered'</pre><h2>How It Works</h2><p>Yoke uses <strong>content negotiation</strong>. The same URL serves JSON to API clients and HTML to browsers:</p><div class="endpoint"><span class="method get">GET</span> <span class="path">${host}/{domain}</span><div class="desc">Returns JSON when called from <code>curl</code>, <code>wget</code>, or any client that doesn't send <code>Accept: text/html</code>. Returns the web app when opened in a browser.</div></div><h2>Endpoints</h2><h3>Analysis</h3><div class="endpoint"><span class="method get">GET</span> <span class="path">/{domain}</span><div class="desc">Full domain analysis with content negotiation. Add <code>?pretty</code> for formatted output. Add <code>?summary=true</code> for a compact ~500-byte response with just scores, tier, and archetype.</div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/analyze</span><div class="desc">Full domain analysis. Body: <code>{"domain": "example.com"}</code>. Add <code>?summary=true</code> to the URL for a compact ~500-byte summary.</div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/compare</span><div class="desc">Head-to-head domain comparison. Returns both analyses plus a comparison summary with per-axis deltas. Body: <code>{"domain1": "stripe.com", "domain2": "shopify.com"}</code></div></div><h3>Enrichment</h3><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/subdomains</span><div class="desc">Subdomain enumeration via certificate transparency logs. Body: <code>{"domain": "example.com"}</code></div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/company</span><div class="desc">Company &amp; business info (Wikidata, Brandfetch, Crunchbase, stock ticker). Body: <code>{"domain": "example.com"}</code></div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/news</span><div class="desc">Recent news articles mentioning the domain. Body: <code>{"domain": "example.com"}</code></div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/social</span><div class="desc">Social media accounts associated with the domain. Body: <code>{"domain": "example.com"}</code></div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/reverse-ip</span><div class="desc">Reverse IP / co-hosted domains. Body: <code>{"ip": "1.2.3.4"}</code></div></div><h3>Domain Discovery</h3><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/suggestions</span><div class="desc">Related domain suggestions (alternative TLDs, typos, variations). Body: <code>{"domain": "example.com"}</code></div></div><div class="endpoint"><span class="method post">POST</span> <span class="path">/api/availability</span><div class="desc">Global domain availability check. Body: <code>{"domain": "example.com"}</code></div></div><h3>Scoring &amp; Stats</h3><div class="endpoint"><span class="method get">GET</span> <span class="path">/api/scoring</span><div class="desc">Full scoring methodology: axis weights, severity multipliers, tier thresholds, effort ratings, and fix descriptions. Machine-readable transparency — this is the same data that drives live scoring.</div></div><div class="endpoint"><span class="method get">GET</span> <span class="path">/api/stats</span><div class="desc">Aggregate platform stats: total scans, unique domains, score tier distribution, and 24-hour activity.</div></div><div class="endpoint"><span class="method get">GET</span> <span class="path">/api/health</span><div class="desc">Health check. Returns <code>{"status": "ok"}</code>.</div></div><h2>Response Format</h2><p>Every analysis response includes these top-level fields (grouped by category):</p><pre>{
  <span style="color:#8b949e">// ── Core ──</span>
  "domain": "stripe.com",
  "analyzed_at": "2026-06-04T01:30:17Z",
  "cached": false,
  "cached_at": 1717462217000,          <span style="color:#8b949e">// epoch ms, present when cached=true</span>
  "http_probe_blocked": false,
  "is_subdomain": false,
  "status": { "code": 200, "label": "UP", ... },
  "redirects": [...],

  <span style="color:#8b949e">// ── DNS &amp; Infrastructure ──</span>
  "dns": { "a": [...], "aaaa": [...], "mx": [...], "ns": [...], "txt": [...], "cname": [...], "soa": {...} },
  "dnssec": { "enabled": true, ... },
  "rdap": { "registrar": "...", "registration_date": "...", "expiration_date": "...", "domain_age_days": ... },
  "ip_info": { "ip": "...", "isp": "...", "org": "...", "asn": "...", "country": "..." },
  "hosting": { "provider": "...", "cdn": "...", "waf": "..." },
  "network_health": { ... },

  <span style="color:#8b949e">// ── SSL &amp; Security ──</span>
  "ssl": { "grade": "A+", "issuer": "...", "valid_from": "...", "valid_to": "...", "protocols": [...] },
  "headers": { "security_audit": [...], "security_grade": "B", ... },
  "caa_analysis": { ... },
  "cert_transparency": { ... },
  "security_txt": { ... },
  "cookie_security": { ... },
  "waf": { ... },

  <span style="color:#8b949e">// ── Threat Intelligence ──</span>
  "shodan": { "ports": [...], "vulns": [...], "tags": [...] },
  "greynoise": { ... },
  "blocklists": [...],
  "breaches": { "found": true, "total": 3, "entries": [...], ... },
  "trust_signals": { ... },

  <span style="color:#8b949e">// ── Performance ──</span>
  "performance": { "score": 85, "fcp": ..., "lcp": ..., "cls": ..., "inp": ... },
  "performance_desktop": { ... },
  "performance_crux": { ... },                <span style="color:#8b949e">// Chrome UX Report data, null if unavailable</span>
  "compression": { ... },
  "cache_analysis": { ... },
  "http_protocols": { "http2": true, "http3": false, ... },

  <span style="color:#8b949e">// ── Tech Stack &amp; Content ──</span>
  "tech_stack": [{ "category": "...", "name": "...", "version": "..." }],
  "wordpress": { "version": "...", "theme": {...}, "plugins": [...] },  <span style="color:#8b949e">// null if not WordPress</span>
  "meta": { "title": "...", "description": "...", "generator": "...", ... },
  "json_ld": [...],
  "structured_data": { ... },
  "third_party_scripts": { ... },
  "resource_hints": { ... },
  "cookie_consent": { ... },
  "well_known": { ... },

  <span style="color:#8b949e">// ── Email ──</span>
  "email_auth": { "spf": {...}, "dmarc": {...}, "dkim": {...}, ... },

  <span style="color:#8b949e">// ── Reputation &amp; Discovery ──</span>
  "tranco_rank": 242,                         <span style="color:#8b949e">// null if unranked</span>
  "social_meta": { "og": {...}, "twitter": {...}, ... },
  "social_accounts": { ... },
  "legal": { "privacy": true, "terms": true, ... },
  "robots_parsed": { ... },
  "llms_txt": { ... },
  "wayback": { ... },
  "accessibility": { ... },

  <span style="color:#8b949e">// ── AI Readiness ──</span>
  "ai_readiness": { "score": 45, "grade": "C", ... },

  <span style="color:#8b949e">// ── Scoring ──</span>
  "domain_score": {
    "composite": 87, "tier": "Strong",
    "axes": {
      "security":       { "score": 91, "weight": 0.24, "findings": [...] },
      "speed":          { "score": 78, "weight": 0.18, "findings": [...] },
      "foundations":    { "score": 85, "weight": 0.18, "findings": [...] },
      "reputation":     { "score": 92, "weight": 0.15, "findings": [...] },
      "discoverability": { "score": 88, "weight": 0.13, "findings": [...] },
      "email":          { "score": 95, "weight": 0.12, "findings": [...] }
    },
    "archetype": { "detected": "application", "confidence": 0.85 },
    "modifier": null
  },
  "percentiles": {
    "composite": 96,
    "axes": { "security": 75, "speed": 87, "foundations": 56, "reputation": 88, "discoverability": 82, "email": null },
    "sample_size": 7520,
    "computed_at": "..."
  },

  <span style="color:#8b949e">// ── Extras ──</span>
  "carbon": null,                              <span style="color:#8b949e">// green hosting / carbon data</span>
  "green_hosting": { ... },

  <span style="color:#8b949e">// ── Meta ──</span>
  "_meta": {
    "api_version": "${YOKE_VERSION}",
    "analyzed_at": "...",
    "source": "${host}",
    "docs": "${docsUrl}/api/docs",
    "share_url": "https://${host}/r/...",      <span style="color:#8b949e">// shareable report link</span>
    "pdf_url": "https://${host}/report/..."    <span style="color:#8b949e">// downloadable PDF report</span>
  }
}</pre><div class="tip">Results are cached for up to 24 hours. The <code>cached</code> field indicates whether you got a cached result. Pass <code>"force": true</code> in the POST body to bypass the cache. Cache hits do not count against rate limits.</div><h2>Response Headers</h2><pre>Content-Type: application/json
Access-Control-Allow-Origin: *
X-Yoke-Cache: HIT or MISS
X-Yoke-Version: ${YOKE_VERSION}</pre><h2>Rate Limits</h2><p>No authentication required. Per-IP rate limits are applied to ensure fair access. Cache hits are free — they don't count against your limit. Analysis involves multiple upstream API calls (DNS, Shodan, PageSpeed, etc.), so each lookup takes a few seconds on cache miss.</p><h2>Scoring</h2><p>Composite score across 6 axes: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12). Each axis starts at 100 and loses points for detected issues, weighted by severity. Speed uses mobile-first blending (60% mobile + 40% desktop). Breach reputation impact uses time decay — recent breaches weigh more, older ones fade. If any single axis drops below 40, the composite is capped at 74 (Moderate). Full machine-readable methodology at <a href="/api/scoring"><code>/api/scoring</code></a>.</p><h2>Percentiles</h2><p>Analysis responses include a <code>percentiles</code> block that ranks the domain against all unique domains scanned in the last 90 days. Composite and per-axis percentiles are provided (0–100).</p><pre>curl -s https://${host}/stripe.com | jq '.percentiles'</pre><h2>PDF Reports</h2><p>Every analysis includes a <code>_meta.pdf_url</code> link to a downloadable PDF report with radar chart, per-axis scores, and key findings. You can also construct the URL directly:</p><pre>curl -s https://${host}/stripe.com | jq '._meta.pdf_url'</pre><h2>Examples</h2><h3>Check domain score</h3><pre>curl -s https://${host}/stripe.com | jq '.domain_score | {composite, tier, archetype: .archetype.detected}'</pre><h3>Compare two domains</h3><pre>curl -s -X POST https://${host}/api/compare \\
  -H "Content-Type: application/json" \\
  -d '{"domain1":"stripe.com","domain2":"shopify.com"}' | jq '.comparison'</pre><h3>Check SSL details</h3><pre>curl -s https://${host}/github.com | jq '{grade: .ssl.grade, issuer: .ssl.issuer, expires: .ssl.valid_to}'</pre><h3>Get DNS records</h3><pre>curl -s https://${host}/example.com | jq '.dns.mx'</pre><h3>Check email authentication</h3><pre>curl -s https://${host}/google.com | jq '.email_auth | {spf: .spf.record, dmarc: .dmarc.record}'</pre><h3>List tech stack</h3><pre>curl -s https://${host}/nytimes.com | jq '[.tech_stack[] | .name]'</pre><h3>Breach history</h3><pre>curl -s https://${host}/linkedin.com | jq '.breaches'</pre><h3>AI Readiness</h3><pre>curl -s https://${host}/stripe.com | jq '.ai_readiness | {score, grade}'</pre><h3>WordPress details</h3><pre>curl -s https://${host}/techcrunch.com | jq '.wordpress'</pre><h3>Get the scoring methodology</h3><pre>curl -s https://${host}/api/scoring | jq '.axis_weights'</pre><h3>Scripting: check multiple domains</h3><pre>for d in stripe.com github.com notion.so; do
  echo "=== $d ==="
  curl -s "https://${host}/$d" | jq '{domain: .domain, score: .domain_score.composite, tier: .domain_score.tier, ssl: .ssl.grade}'
done</pre><p class="back"><a href="/">← Back</a></p></body></html>`;
}
