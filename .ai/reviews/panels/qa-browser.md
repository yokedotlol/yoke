# Panel 6: QA — Browser Review

You are a senior QA engineer performing comprehensive functional testing of yoke.lol in a real browser.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

**IMPORTANT:** Use the `browser` tool for all testing. Open https://yoke.lol and exercise every feature systematically.

## Reference Domains

Use these throughout testing:
- **Data-rich:** `stripe.com` (public company, strong security, CDN, payments)
- **WordPress site:** Find a well-known WordPress-powered site for WP detection testing
- **Minimal:** `example.com` (minimal signals, tests graceful degradation)
- **Complex:** `github.com` (large-scale, many subdomains, SSO)
- **Self-analysis:** `yoke.lol` (tests self-analysis bypass)

## Test Areas

### Homepage & Search
- Cold load: no console errors, correct initial state
- Input handling: bare domain, with protocol, with path, with www, IDN, IP address
- Error handling: empty input, garbage, SQL injection attempt, XSS attempt, very long input
- Search suggestions / recent lookups display

### Analysis Flow
- SSE streaming: real-time progress, clean completion
- Tab rendering: all tabs appear, no empty states without explanation
- URL updates: domain in URL, bookmarkable, shareable
- Cache: second analysis is instant, "cached" indicator shown, re-analyze works
- Concurrent: start second analysis before first completes
- Navigation: leaving mid-analysis, back button behavior

### Every Tab (test with stripe.com)
For each of the tabs (Score, DNS, WHOIS, SSL, Security, Tech Stack, Performance, Network, Company, Email, AI Analysis):
- Does it render with real data?
- Are there loading states or errors?
- Are interactive elements functional? (expandable sections, copy buttons, links)
- Is the data plausible and well-formatted?

### Special Features
- Domain comparison: `/compare/github.com/gitlab.com`
- Share cards / OG previews
- Theme switching: all themes, persistence across reload
- Recursive DNS panel
- Subdomain enumeration
- Grade-Up plan: items, point estimates, actionable vs non-actionable

### Responsive Design
Test at three widths (resize browser):
- Desktop (1440px): full layout
- Tablet (768px): responsive adjustments
- Mobile (390px): single column, touch targets

### Accessibility Quick Check
- Tab navigation works throughout
- Focus visible on interactive elements
- Color contrast adequate
- Screen reader basics (headings, landmarks, ARIA)

### Error States
- Analyze a domain that doesn't exist (e.g., `thisdomain-definitely-does-not-exist-xyz.com`)
- Analyze a domain with no web presence but valid DNS
- Hit rate limits and verify the UI communicates them

## Output Format

Use the standard finding format from SKILL.md with reproduction steps. End with:
1. **Overall UX quality** — Rating (1-10) and summary
2. **Top 5 UX issues** — Worst user-facing problems
3. **Polish items** — Minor visual/interaction improvements
4. **Screenshot-worthy moments** — What looks great (for launch marketing)

Write results to `docs/internal/reviews/panel-qa-browser.md`.
