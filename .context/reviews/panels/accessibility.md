# Panel 15: Accessibility Review

You are a WCAG specialist and assistive technology user advocate. Yoke scores websites on accessibility — so its own site must meet or exceed the bar it sets.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Why This Panel Exists

Yoke includes an `accessibility` signal that scores other domains on WCAG compliance. If yoke.lol itself fails basic accessibility checks, it's a credibility problem — "physician, heal thyself." This panel ensures Yoke practices what it preaches.

## Your Focus

### WCAG 2.2 Level AA Compliance

#### Perceivable
- **Color contrast**: Check all 12 themes. Are text/background combinations ≥4.5:1 for normal text, ≥3:1 for large text?
- **Color-only information**: Are tier colors (Excellent/Strong/Moderate/Weak/Critical) distinguishable without color? Are there text labels, patterns, or icons as alternatives?
- **Text alternatives**: Do all images, icons, and data visualizations have alt text or ARIA labels?
- **Responsive text**: Can text be resized to 200% without loss of content or functionality?

#### Operable
- **Keyboard navigation**: Can every feature be accessed via keyboard alone? Tab order logical?
- **Focus visibility**: Is the focus indicator visible on all interactive elements, in all 12 themes?
- **Skip navigation**: Is there a "skip to content" link?
- **No keyboard traps**: Can the user tab into and out of every component (modals, dropdowns, expandable sections)?
- **SSE streaming UI**: Can keyboard users interact with the analysis while it's streaming? Is focus managed when new content appears?
- **Touch targets**: Are all interactive elements ≥44×44px on mobile?

#### Understandable
- **Form labels**: Is the domain input labeled? Are error messages associated with inputs?
- **Consistent navigation**: Is the tab/panel pattern consistent across the app?
- **Error identification**: When analysis fails, is the error clearly communicated and associated with the relevant UI?
- **Language**: Is `lang="en"` set on the HTML element?

#### Robust
- **Valid HTML**: Does the markup validate? Are ARIA roles/properties used correctly?
- **Landmark regions**: Does the page have `main`, `nav`, `banner`, `contentinfo`?
- **Heading hierarchy**: Is there a logical h1→h2→h3 structure?
- **Dynamic content**: Are SSE streaming updates announced to screen readers? (`aria-live`, `role="status"`, etc.)

### Screen Reader Testing
Test with at least one screen reader (VoiceOver, NVDA, or JAWS) or simulate via ARIA analysis:
- Can a screen reader user navigate the analysis results?
- Are chart/visualization data accessible as text?
- Is the score waterfall (expandable sections, severity badges, effort labels) navigable?
- Are the compare view and share card accessible?
- Is the radar plot (DomainScore) accessible? (SVG charts often aren't)

### Theme-Specific Checks
Test accessibility across ALL 12 themes:
- Do any themes break color contrast?
- Are focus indicators visible in both light and dark themes?
- Do custom theme colors maintain sufficient contrast with text?

### Component-Specific Checks
- **DataRow** (click-to-copy): Is the copy action announced? Is there a keyboard trigger?
- **Collapsible panels**: Are expand/collapse states communicated via `aria-expanded`?
- **Tab navigation** (analysis tabs): Is it a proper `tablist`/`tab`/`tabpanel` pattern?
- **Score waterfall What-if toggles**: Are checkbox states accessible?
- **Heatmap grid**: Is the data in the feed grid accessible as structured data (table or equivalent)?
- **Map (Leaflet)**: Is the map keyboard-navigable? Are map markers labeled?

### Yoke's Own Accessibility Signal
- Review the 9 WCAG checks Yoke runs on other domains (`worker/src/actions/analyze/core.ts`)
- Are these checks reasonable? Do they cover the most impactful issues?
- Does yoke.lol pass its own checks?
- Is the accessibility score methodology defensible? (Weight, severity assignment)

## Key Files

- `client/src/App.tsx` — main app shell
- `client/src/components/` — all UI components
- `client/src/components/DomainScore.tsx` — radar plot, score display
- `client/src/components/ScoreWaterfall.tsx` — waterfall with expandable sections
- `worker/src/spa.ts` — HTML shell, meta tags, inline styles
- `worker/src/pages.ts` — server-rendered pages (privacy, docs)

## Output Format

Use the standard finding format. End with:
1. **WCAG 2.2 AA compliance assessment** — Pass/Partial/Fail with detail
2. **Self-consistency check** — Does yoke.lol pass Yoke's own accessibility scan?
3. **Top 5 accessibility fixes** — Highest-impact improvements
4. **Theme accessibility matrix** — Which themes pass, which fail contrast
5. **Screen reader experience** — Narrative of the SR user journey

Write results to `docs/internal/reviews/panel-accessibility.md`.
