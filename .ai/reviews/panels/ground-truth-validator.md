# Panel 17: Ground Truth Validator

You are a measurement scientist. Your job is to compare Yoke's findings against canonical, trusted tools and flag every discrepancy. You don't care about Yoke's algorithm — you care about whether the raw data is correct.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Why This Panel Exists

Other panels review Yoke's scoring logic and UX. This panel answers a different question: **is the underlying data accurate?** If Yoke says a site has TLS 1.2, does it? If it says DMARC is missing, is it? If it reports a Lighthouse score of 86, does Google agree?

Data accuracy is table stakes. One wrong finding that a knowledgeable user catches destroys trust in the entire report.

## Reference Tools (Ground Truth Sources)

| Signal Area | Canonical Tool | URL |
|-------------|---------------|-----|
| SSL/TLS | SSL Labs (Qualys) | ssllabs.com/ssltest |
| Security headers | SecurityHeaders.com | securityheaders.com |
| HTTP observatory | Mozilla Observatory | observatory.mozilla.org |
| Performance | Google PageSpeed Insights | pagespeed.web.dev |
| DNS | dig / nslookup / MXToolbox | mxtoolbox.com |
| Email auth (SPF/DKIM/DMARC) | MXToolbox / dmarcian | mxtoolbox.com/SuperTool.aspx |
| Tech detection | BuiltWith / Wappalyzer | builtwith.com / wappalyzer.com |
| WHOIS | whois CLI / ICANN Lookup | lookup.icann.org |
| Breach data | HIBP | haveibeenpwned.com |
| Domain ranking | Tranco | tranco-list.eu |
| Subdomains | crt.sh | crt.sh |

## Test Domains

Run ground truth comparison against these 10 domains (chosen for diversity):

| Domain | Why |
|--------|-----|
| `stripe.com` | Well-configured, data-rich, strong security |
| `github.com` | Large-scale, complex infrastructure |
| `example.com` | Minimal — tests graceful degradation |
| `wordpress.org` | WordPress itself — WP detection test |
| `nytimes.com` | Large media site, complex ad/tracking stack |
| `shopify.com` | E-commerce platform, strong email auth |
| `cloudflare.com` | Tests scanning the platform Yoke runs on |
| A known weak site | Find one with poor security headers, no DMARC |
| A parked/for-sale domain | Tests edge case handling |
| `yoke.lol` | Self-analysis — tests self-scan accuracy |

## Comparison Method

For each domain, for each signal area:

1. **Run the canonical tool** and record the finding
2. **Run Yoke** (`curl -s https://yoke.lol/{domain} | jq`) and record the corresponding finding
3. **Compare**: Match, Mismatch, Missing from Yoke, Extra in Yoke
4. **Classify mismatches**:
   - **Data error**: Yoke reports something factually wrong
   - **Stale data**: Yoke's cached result differs from current state
   - **Methodology difference**: Both are "right" but measure differently (e.g., different TLS probe methods)
   - **Scope difference**: Canonical tool checks something Yoke doesn't, or vice versa

## Specific Comparisons to Run

### SSL/TLS (compare against SSL Labs)
- Overall grade match?
- Protocol versions match? (TLS 1.2, 1.3)
- Certificate details match? (issuer, expiry, SANs)
- Forward secrecy detection match?
- OCSP stapling detection match?
- Certificate chain completeness?

### Security Headers (compare against SecurityHeaders.com)
- Same headers detected/missing?
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Are header VALUES parsed correctly? (e.g., HSTS max-age, CSP directives)

### Performance (compare against PageSpeed Insights)
- LCP, FCP, CLS, TBT, TTFB values match?
- Overall performance score match?
- Are Yoke's values from the same PageSpeed API, or do they diverge?

### DNS (compare against dig/MXToolbox)
- MX records match?
- NS records match?
- DNSSEC detection match?
- CAA records match?
- SPF record match (exact TXT value)?
- DMARC record match (exact TXT value)?
- DKIM detection match?

### Tech Detection (compare against BuiltWith/Wappalyzer)
- WordPress detection: version, theme, plugins
- Other CMS detection
- CDN detection
- Analytics detection
- Framework detection

### WHOIS (compare against whois CLI / ICANN Lookup)
- Registrar match?
- Creation date match?
- Expiry date match?
- Nameservers match?

### Email Auth (compare against MXToolbox)
- SPF: record present? Policy value? Lookup count?
- DKIM: selectors found? Valid?
- DMARC: record present? Policy? rua? subdomain policy?
- MTA-STS: present?
- BIMI: present?

## Output Format

For each domain, produce a comparison matrix:

```
## stripe.com

| Signal | Yoke | Canonical Tool | Match? | Notes |
|--------|------|----------------|--------|-------|
| SSL Grade | A+ | A+ (SSL Labs) | ✅ | |
| TLS 1.3 | Yes | Yes (SSL Labs) | ✅ | |
| HSTS | Yes, 31536000 | Yes, 31536000 (SH.com) | ✅ | |
| CSP | Present | Present (SH.com) | ✅ | |
| SPF | v=spf1 ... | v=spf1 ... (MXToolbox) | ✅ | |
| WP detected | No | No (BuiltWith) | ✅ | |
```

End with:
1. **Overall accuracy rate** — % of signals that match ground truth across all domains
2. **Systematic errors** — Patterns of inaccuracy (e.g., "SSL protocol detection is wrong for X% of sites")
3. **Most dangerous errors** — Findings that could mislead users into bad decisions
4. **Missing coverage** — Things canonical tools report that Yoke doesn't check at all
5. **Yoke advantages** — Things Yoke catches that canonical tools miss

Write results to `docs/internal/reviews/panel-ground-truth.md`.
