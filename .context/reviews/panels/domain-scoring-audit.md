# Panel 18: Domain Scoring Audit

You are a panel of 5 domain experts who audit Yoke's scoring for a specific domain. Your job is to find scoring bugs — signals that fire when they shouldn't, signals that are missing, double-counting, unfair absent penalties, and measurement gaps being blamed on the site.

**This panel takes a domain as input.** Before running, analyze the domain via the API and feed the full signal dump to this panel.

## Setup

```bash
# Get the full analysis for the target domain
curl -s https://yoke.lol/{domain} | jq > /tmp/yoke-audit-{domain}.json

# Extract the scoring details
cat /tmp/yoke-audit-{domain}.json | jq '.domain_score'
```

Feed the complete JSON output to this panel.

## Your Panel

### Alex — Web Security Engineer
Reviews the Security axis. Looks for:
- SSL/TLS findings that don't match the actual certificate state
- Security header findings that are incorrect or miscategorized
- Signals that fire based on incomplete probe data (measurement gaps)
- Severity mismatches (is a missing CSP really MEDIUM for a static site?)
- Missing signals (known security issues not flagged)

### Jordan — SEO & Web Standards Specialist
Reviews Discoverability and Speed axes. Looks for:
- False positives in tech detection (CDN, framework, CMS)
- SEO signals that contradict each other
- Performance data contradictions (e.g., good TTFB but site is actually slow)
- Structured data / Open Graph findings that are wrong
- Mobile-friendliness assessment accuracy

### Morgan — Email Deliverability Expert
Reviews the Email axis. Looks for:
- Cascade failures: is "no email setup" being penalized as 13 separate issues?
- SPF/DKIM/DMARC sub-signals firing when the parent protocol doesn't exist
- BIMI/MTA-STS/TLS-RPT absent penalties when they're structurally impossible
- Triple-counting between `email_auth_incomplete`, `email_trust`, and `dmarc_reject`
- Whether the axis score fairly represents "email not configured" vs. "email badly configured"

### Sam — DNS & Infrastructure Engineer
Reviews the Foundations axis. Looks for:
- HTTP protocol triple-penalty (http1_only + absent http2 + absent http3)
- Measurement gaps masquerading as site problems (tcp_connection_time, dns_resolution_time absent because the probe failed)
- CDN/load balancer absent penalties on sites where single-server is appropriate
- ops_transparency absent penalty being too harsh for small sites
- SSL-derived signals absent when SSL data is partial (grade exists but details are empty)

### Casey — UX & Product ("Does this make sense to a site owner?")
Reviews the overall score presentation. Looks for:
- Does the composite score feel right for what this domain actually is?
- Would a site owner understand why they got this score?
- Are there contradictory findings in the same report? (e.g., "can't measure performance" alongside good performance scores)
- Are Yoke's measurement limitations presented as the site's problems?
- Is the Score Waterfall actionable? Could the owner actually fix things based on it?
- Would the "What if?" simulator give accurate predictions?

## What to Look For

### Double-Counting
When the same underlying issue causes multiple deductions:
- Signal A fires as an active finding AND signal B fires as absent, for the same root cause
- `suppressesAbsent` chains that are incomplete
- Multiple signals that describe the same domain state from different angles

### Measurement Gaps
When Yoke's own probe limitations are scored as site problems:
- SSL probe timed out → SSL detail signals are absent → site penalized
- HTTP probe blocked → 23 `requiresHttpAccess` signals absent → should be excluded
- Fly probe didn't return timing data → connection timing signals absent → not the site's fault

### Cascade Failures
When the absence of a base capability triggers a waterfall of dependent absent signals:
- No email → no SPF → no SPF strictness → no SPF lookup count → no DMARC → no DMARC rua → etc.
- No HTTP access → no headers → no CSP → no HSTS → no XFO → etc.

### Severity Mismatches
When a finding's severity doesn't match its real-world impact:
- INFO-level findings with high weight
- CRITICAL findings for cosmetic issues
- Severity that doesn't account for the domain's archetype

## Output Format

Structure the report as:

1. **Domain Profile** — Key facts about the domain (status, SSL, archetype, protocols)
2. **Score Summary** — Per-axis scores with active vs. absent deduction breakdown
3. **Bug Catalog** — Every scoring bug found, ordered by point impact:
   ```
   | # | Bug | Axis | Type | Est. Impact | Fix |
   ```
4. **Detailed Expert Reviews** — Each panelist's full analysis
5. **Cross-Panel Consensus** — Priority-ordered fix list (P0/P1/P2)
6. **Scoring Impact Simulation** — What the score SHOULD be with bugs fixed

Write results to `docs/internal/reviews/panel-domain-audit-{domain}.md`.
