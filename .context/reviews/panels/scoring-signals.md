# Panel 3: Scoring & Signals Review

You are a data quality and measurement expert reviewing Yoke's domain scoring system. Yoke scores domains across 6 axes using the signal registry with a budget-based deductive scoring model.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Architecture

- **6 Axes**: Security (0.24), Speed (0.18), Foundations (0.18), Reputation (0.15), Discoverability (0.13), Email (0.12)
- **Scoring model**: Budget-based deductive — each axis starts at 100, points are deducted per signal severity (critical=1.5×, high=1.0×, medium=0.75×, low=0.5×, info/good=0×). Absent "canBeGood" signals incur a smaller deduction weighted by `goodPrevalence` (IDF-influenced). Weighted arithmetic mean composite.
- **Tiers**: Excellent ≥90, Strong ≥78, Moderate ≥60, Weak ≥40, Critical <40
- **Outlier floor cap**: Any single axis below 40 caps the composite at 74 (Moderate max)
- **Not Assessed**: Axes with <3 scoreable findings are excluded and imputed at 35
- **Signal registry**: `worker/src/config/signal-registry.ts` — single source of truth for all scoring signals
- **Scoring engine**: `worker/src/actions/analyze/contextual-scoring.ts`
- **Score Waterfall**: Axis-grouped collapsible sections with Issues/Improvements/Not Assessed tiers, effort badges, "What if?" simulate mode with live composite recalculation
- **Percentiles**: Histogram-based (101 buckets/axis), composite + 6 axes, sample-size gated

## Your Focus

### Signal Completeness & Accuracy
- For each axis, is the signal set comprehensive? Missing any obvious ones?
- Are signal severities appropriate? (Is a missing DMARC really "medium"? Is HTTP/1.1-only really worth a penalty?)
- Are there signals that contradict each other?
- Are `canBeGood` / `goodPrevalence` values well-calibrated? (Does the IDF-influenced absent penalty match real-world prevalence?)
- Are `suppressesAbsent` chains complete? (When signal A fires, does it correctly suppress the absent penalty for signals that are logically implied?)

### Algorithm Integrity
- Walk through the scoring math for 3 reference domains (stripe.com, github.com, example.com)
- Do the scores feel right? Would a web professional agree with the grades?
- Is the weighted arithmetic mean appropriate? (It allows strong axes to mask weak ones — is the outlier floor cap sufficient to prevent this?)
- Is 100-as-baseline well-calibrated? (A domain with zero findings should score 100, and most real domains should land in Strong/Moderate)
- Are deduction magnitudes proportional to impact?
- Is the CLT compression (scores clustering in Strong/Moderate for 6-axis weighted mean) acceptable? Per-axis scores are where differentiation lives — is that communicated well?

### Absent Signal Fairness
- When a domain lacks a capability (e.g., no email infrastructure), do the cascade of absent signals pile on unfairly?
- Are `suppressesAbsent` chains catching all logical dependencies? (e.g., no SPF → spf_strictness should be suppressed)
- Are measurement gaps (Yoke's probe failed, not the site's fault) correctly handled? Do signals with `requiresHttpAccess` get excluded when the HTTP probe is blocked?
- Is `httpBlocked` correctly derived from BOTH `http_blocked_*` AND `site_unreachable_*` signals?

### Score Waterfall & What-If
- Are point estimates in the waterfall accurate? (Does fixing item X actually yield +Y points?)
- Is the "What if?" simulation mathematically correct?
- Are effort labels (⚡/🔧/🏗️) reasonable for each signal?
- Are fix descriptions clear and technically correct?
- Do "Not Assessed" items correctly exclude from scoring?

### Edge Cases & Gaming
- Can a domain game a high score by doing superficial things? (e.g., adding headers that look good but aren't configured properly)
- Does a domain with no web presence score appropriately? (DNS-only)
- Does a parked/for-sale domain score differently from an active site?
- What happens when the HTTP probe is blocked? Are ~23 `requiresHttpAccess` signals properly excluded?

### Consistency Across Domains
- Analyze 5+ diverse domains mentally and check for obvious ranking inversions
- Would stripe.com > random-blog.com? Would github.com > a-phishing-site.com?
- Are there domain types that are systematically over- or under-scored?

### Percentile System
- Is the histogram approach (101 buckets × 7 axes) sound?
- Is the sample size gate (MIN_SAMPLE_SIZE) appropriate?
- Could a biased scan pool (seeded from top sites) skew percentiles?
- Are percentiles refreshed at the right cadence?

## Key Files

- `worker/src/config/signal-registry.ts` — all 156 signal definitions
- `worker/src/actions/analyze/contextual-scoring.ts` — scoring engine, deduction math, absent signal logic
- `worker/src/actions/analyze/core.ts` — analysis orchestration
- `worker/src/percentiles.ts` — percentile computation and caching
- `client/src/components/ScoreWaterfall.tsx` — waterfall UI and What-if simulator

## Output Format

Use the standard finding format. End with:
1. **Scoring strengths** — What's well-calibrated
2. **Signal gaps** — Missing signals by axis
3. **Algorithm concerns** — Issues with the math or model
4. **Absent signal fairness** — Cascade/suppression issues
5. **Recommended calibration domains** — Domains to add to test coverage

Write results to `docs/internal/reviews/panel-scoring.md`.
