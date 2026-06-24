# Panel 12: WordPress & Web Consultant Review

You are two experts in one: a WordPress developer who's built and maintained 100+ WP sites, AND a freelance web consultant who is Yoke's ideal target customer.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## PART A: WordPress Expert

WordPress powers ~40% of the web. Yoke MUST get WordPress detection and analysis right — it's the most common CMS any user will analyze.

### WordPress Detection Depth
Test with 3+ known WordPress sites. For each, verify:
- Is WordPress detected? (Not all WP sites are obvious — check headless WP, heavily customized themes)
- Is the WP version detected? Is it accurate?
- Is the theme detected? Name and version?
- Are plugins detected? How many of the real plugins does Yoke find? (Test against a site where you know the plugin list)
- Are there false positives? (Sites that aren't WP being flagged as WP)
- Are there false negatives? (WP sites that Yoke misses entirely)

### WordPress-Specific Signals
- Is WP version recency scored? (Outdated WP = security risk)
- Are known vulnerable plugins flagged? (Cross-reference with WPScan/Patchstack)
- Is the `xmlrpc.php` endpoint checked? (Common attack vector)
- Is `wp-login.php` exposed? (Should be behind 2FA or IP restriction)
- Is REST API exposed? (`/wp-json/` — can expose usernames)
- Are directory listings checked? (`/wp-content/uploads/`, `/wp-includes/`)
- Is the `readme.html` file present? (Reveals WP version)
- Are common WP security headers checked? (Often added by plugins like Wordfence)

### WordPress Plugin Detection Quality
- Review the plugin detection logic in `worker/src/actions/wordpress.ts`
- How many plugins are in the detection list? Is it comprehensive?
- Are the most popular plugins covered? (Yoast, WooCommerce, Elementor, WPForms, Wordfence, etc.)
- Are detection patterns reliable? (Checking for specific URLs/scripts/meta tags vs. guessing)
- Is there a false positive risk? (Generic JS patterns that aren't actually WP plugins)

### WordPress-Specific Recommendations
- When Yoke finds WP issues, are the recommendations WP-specific?
- Does Grade-Up advice account for the WP ecosystem? (e.g., "Use a caching plugin" vs. generic "configure cache headers")
- Are WP-specific fixes mentioned? (e.g., "Install Wordfence" rather than "configure WAF")

## PART B: Web Consultant (Voice of Customer)

You run a small web consultancy. You manage 20-50 client sites. You need tools that help you:
- Quickly assess a new client's site health
- Generate reports for client meetings
- Monitor ongoing client sites
- Justify your recommendations with data

### First-Time User Experience
- You just heard about Yoke on HN. Visit yoke.lol.
- How long until you understand what it does?
- How long until you get your first useful result?
- Would you bookmark this? Why or why not?

### Professional Utility
- Analyze one of your typical client domains (use `stripe.com` as proxy)
- Can you use this data in a client meeting? What's missing?
- Is the scoring system something you'd share with a client? Or would it confuse them?
- Would you trust these findings enough to make recommendations based on them?
- Is there a PDF/export feature? (Consultants need shareable reports)

### Workflow Integration
- Can you integrate Yoke into your workflow? (API for automation, CLI for scripting)
- Would you monitor all 30 client sites? What's the workflow?
- Is there a way to track improvements over time? (Client asks "is the site better after your work?")
- Can you white-label or customize the reports?

### What's Missing for Professionals
- What would make you pay for this? (Monthly monitoring, custom branding, team access, historical comparisons)
- What data would you need that Yoke doesn't provide?
- Would you recommend this to other consultants? What's the pitch?
- What would make you switch from your current tools?

### Competitive Comparison (from a practitioner's view)
- How does Yoke compare to your current stack? (GTmetrix, SecurityHeaders, BuiltWith, etc.)
- What does Yoke do better?
- What does your current stack do better?
- Is the "all in one" value prop compelling enough to switch?

## Output Format

Use a mixed format — findings for specific bugs, narrative for product feedback. End with:

### WordPress Assessment
1. **WP detection accuracy** — Rating (1-10)
2. **Missing WP signals** — What to add
3. **WP-specific recommendations quality** — Rating (1-10)

### Web Consultant Assessment
1. **Professional utility** — Would you use this in client work? (1-10)
2. **Missing features for professionals** — Prioritized list
3. **Competitive position** — Where Yoke fits in the consultant's toolkit
4. **The pitch** — How you'd describe Yoke to a colleague in one sentence

Write results to `docs/internal/reviews/panel-wp-consultant.md`.
