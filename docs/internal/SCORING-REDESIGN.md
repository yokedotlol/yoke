# Scoring Redesign v2 — Final

**Decision date:** 2026-05-30
**Status:** Implemented

## Summary

Replaced the 5-axis weighted-average model with a 6-category anchor-and-adjust model using weighted geometric mean for the composite tier.

## Categories

| Old | New | Signals | Weight |
|-----|-----|---------|--------|
| Security | **Security** | ~43 | 0.24 |
| Performance | **Speed** | 16 | 0.18 |
| Infrastructure | **Foundations** | 18 | 0.18 |
| Trust → split | **Reputation** | ~20 | 0.15 |
| Visibility | **Discoverability** | ~18 | 0.13 |
| *(new)* | **Email** | 15 | 0.12 |

### Signal Assignment Rules

**Primary-only.** Each signal belongs to exactly one category. No dual-scoring.

### Key Reclassifications

| Signal | Old Axis | New Category | Rationale |
|--------|----------|-------------|-----------|
| dnssec | security | **Security** | Prevents DNS spoofing — security objective |
| caa, caa_records, caa_wildcard_unrestricted, caa_iodef | infrastructure/security | **Security** | Certificate issuance restriction = security |
| ct_caa_mismatch | trust | **Security** | CT/CAA divergence = security concern |
| cdn | performance | **Foundations** | Platform choice, not speed outcome |
| http2, http3, http1_only | performance | **Foundations** | Protocol modernity = infrastructure |
| slow_connection | performance | **Foundations** | Network quality, not user-perceived speed |
| ops_transparency | trust | **Foundations** | Operational maturity |
| cert_validation_type | trust | **Foundations** | PKI maturity |
| email_auth, email_auth_incomplete, email_trust | security | **Email** | Standalone category |
| spf_without_dmarc | security | **Email** | Email auth |
| dmarc_reject | trust | **Email** | Email policy enforcement |
| mta_sts | security | **Email** | Email transport security |
| bimi_record | trust | **Email** | Email brand indicator |
| mx_redundancy | infrastructure | **Email** | Mail infrastructure |
| script_privacy, third_party_scripts | security | **Reputation** | Privacy posture |
| referrer_policy, referrer_policy_missing, referrer_policy_unsafe | security | **Security** | Header defense (stays) |
| permissions_policy, permissions_policy_missing, permissions_policy_unrestricted | security | **Security** | Header defense (stays) |
| cookie_consent_cmp, cookie_consent_missing, cookie_compliance, pre_consent_cookies | trust | **Reputation** | Privacy/compliance |
| organizational_identity | trust | **Reputation** | Org transparency |
| domain_age_trust, registration_length | trust | **Reputation** | Domain credibility |
| breaches | trust | **Reputation** | Breach history |
| tranco_rank, domain_popularity | trust/visibility | **Reputation** | Domain credibility |
| blocklist_listed, blocklist_trust | security/trust | **Reputation** | Domain reputation |
| greynoise_noise, greynoise_riot | trust | **Reputation** | IP reputation |
| legal_pages | visibility | **Reputation** | Org legitimacy |
| accessibility | visibility | **Discoverability** | WCAG/reach |
| social_meta, og_completeness | visibility | **Discoverability** | Social sharing |

## Scoring Model: Anchor-and-Adjust

### Baseline

**BASELINE = 55** — neutral starting point. Raised from initial proposal of 50 to prevent excessive D grades on sparse axes.

### Severity Penalties

Each non-good finding subtracts `penalty × max(weight, 1)`:

| Severity | Penalty per weight unit |
|----------|----------------------|
| critical | -4 |
| high | -2.5 |
| medium | -1.25 |
| low | -0.5 |
| info | 0 |

These values are significantly lower than the original proposal (which had critical=-15, high=-10, etc.) to prevent single findings from having outsized impact.

### Good Bonus

```
goodBonus(weight) = 2 × weight
```

| Weight | Bonus |
|--------|-------|
| 1 | +2 |
| 2 | +4 |
| 3 | +6 |
| 4 | +8 |
| 5 | +10 |

No cap — bonus scales linearly with weight. Original proposal had a fixed table (w1→+2 through w5→+6); simplified to `2×weight` for clarity.

### Formula

```
category_score = clamp(55 + good_bonuses - severity_penalties - absence_penalties, 0, 100)
```

### Expected Baselines (Absence Penalties)

Each category defines signals a competent site should produce. If none of the listed signals fired, a mild penalty applies.

| Category | Signal | Penalty | Condition |
|----------|--------|---------|-----------|
| Security | hsts | -3 | requiresHttp |
| Security | http_to_https_redirect | -3 | requiresHttp |
| Email | email_auth | -4 | — |
| Email | dmarc_reject | -3 | — |
| Foundations | cdn | -4 | requiresHttp |
| Foundations | http2 (or http3) | -3 | requiresHttp |
| Foundations | ipv6 | -2 | — |
| Reputation | organizational_identity | -2 | requiresHttp |
| Speed | *(none)* | — | CWV signals always fire if PageSpeed runs |
| Discoverability | *(none)* | — | Handled by signal-level findings |

### Absence Detection

An "absent" signal means no finding was emitted for that signal key at all. Different from `info` severity ("we checked and it's neutral"). Absence means "we expected this signal and it didn't fire."

After all findings are collected for a category, check whether expected baseline signal keys (or their `alsoSatisfiedBy` alternatives) appear. If not, and the relevant checks ran (HTTP/SSL available), apply the absence penalty.

## "Not Assessed" Threshold

Categories with **fewer than 3 scoreable findings** get `score: null, not_measured: true` instead of a numeric score.

**Excluded from count:** Meta-signals (`http_blocked_*`, `site_unreachable_*`) that indicate checks couldn't run.

**Effect on composite:** "Not Assessed" axes are excluded from the geometric mean, and weights are re-normalized over assessed axes only.

**Client display:** Shows "N/A" badge and "Not Assessed" text instead of a numeric score.

## Composite: Weighted Geometric Mean

```ts
function computeComposite(axisScores: Record<Axis, number>): number {
  // Only include assessed axes (score != null)
  // Re-normalize weights so they sum to 1.0 over assessed axes
  const totalWeight = assessedAxes.reduce((sum, a) => sum + AXIS_WEIGHTS[a], 0);
  let logSum = 0;
  for (const axis of assessedAxes) {
    const s = Math.max(axisScores[axis], 1); // floor at 1 to prevent log(0)
    const normalizedWeight = AXIS_WEIGHTS[axis] / totalWeight;
    logSum += normalizedWeight * Math.log(s);
  }
  return Math.round(Math.exp(logSum));
}
```

Weights sum to 1.0 (after re-normalization over assessed axes).

## Hard Caps — Removed

The original proposal included per-category hard caps (critical→D max, high→C+ max, etc.). These were **removed** because:

1. Severity penalties + geometric mean already provide sufficient downward pressure
2. Caps created confusing score/grade paradoxes
3. Caps triple-penalized findings (per-axis penalty + geometric mean drag + cap)

The `applyHardCaps` function is kept as a pass-through for API compatibility.

### Breach Tier Cap — Retained

A separate, specific mechanism for catastrophic data breaches:

| Condition | Max Tier |
|-----------|-----------|
| Recent breach with >500M weighted pwned records | B |
| Recent breach with >100M weighted pwned records | B |

Breaches >3 years old no longer trigger the cap (time decay).

## Domain Age / NRD Severity

Updated from original proposal:

| Age | Severity |
|-----|----------|
| >5 years | good |
| >3 years | info |
| >1 year | low |
| 91-365 days | medium |
| 31-90 days | medium |
| ≤30 days | **high** |

Key change from original: NRD ≤30d is **high** (not critical), and 31-90d is **medium** (not high). Prevents newly registered domains from being unfairly crushed.

## Tier Thresholds

> **Updated 2026-05-31:** Letter grades replaced with descriptive tiers to avoid school-grade anchoring.

| Tier | Threshold |
|------|-----------|
| Excellent | ≥ 90 |
| Strong | ≥ 75 |
| Moderate | ≥ 60 |
| Weak | ≥ 40 |
| Critical | < 40 |

## Level-Up Recommendations

- **Priority sort:** Items sorted by `pointGain` (impact) within each category group
- **Category clustering:** Items grouped by category with color-coded headers showing point totals
- **No effort assumptions:** `effort` field removed from `GradeUpItem` interface — effort estimation was unreliable and misleading
- **Severity badges:** Visual severity indicators with color-coded backgrounds

## Client Updates

- **6-spoke hexagonal radar chart** — `AXES.length` used for dynamic angle calculation
- **Email tab** — `EmailTab.tsx` with EmailAuthPanel and EmailExtrasPanel, between Speed and Business
- **Share cards / OG images** — bar spacing reduced for 6 bars (50px single, 47px compare)
- **Weight summary** — `weightSummary()` dynamically computes from actual weights table
- **"Not Assessed" display** — N/A badge and "Not Assessed" text instead of N/M / "Not measured"

## AI Prompt Updates

- All prompt files use correct 6-category names
- Scoring context updated: baseline 55, penalty/bonus values, "Not Assessed" mention
- Dimension lists updated throughout `content.ts` and `prompt-builder.ts`
- Archetype note in `index.ts` updated with accurate scoring description

## Archetype Handling

Archetypes (content, commerce, application, infrastructure, institutional, community, personal) still apply. They modify severity of individual signals contextually. The category a signal belongs to doesn't change by archetype.

**Email category + infrastructure archetype:** API/infrastructure domains that don't send email can have Email scored as "Not Assessed" instead of penalizing.

## Reference Domains for Calibration

Mix of well-known sites across quality spectrum:
- **Expected A-tier:** cloudflare.com, github.com, google.com, stripe.com
- **Expected B-tier:** nytimes.com, shopify.com, reddit.com
- **Expected C-tier:** Small business sites, basic WordPress installs
- **Expected D/F-tier:** Sites with known security issues, abandoned domains
- **Self-test:** yoke.lol
