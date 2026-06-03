// ─── Dynamic AI Prompt Builder ──────────────────────────────────────
// Composes the system prompt at runtime based on detected archetype
// and present signals, replacing the static ai-analysis.txt approach.

import type { ArchetypeResult } from "../actions/analyze/contextual-scoring";
import type { ArchetypeName } from "../config/contextual-scoring-types";
import { AXIS_WEIGHTS, SIGNAL_REGISTRY, TIER_THRESHOLDS } from "../config/signal-registry";

// ─── Prompt Fragments (build-time inlined) ──────────────────────────

import CORE_RULES from "../../../prompts/core-rules.txt";
import CROSS_SIGNAL_EXAMPLES from "../../../prompts/cross-signal-examples.txt";
import META_RULES from "../../../prompts/meta-rules.txt";
import OUTPUT_SCHEMA from "../../../prompts/output-schema.txt";

// ─── Axis Descriptions ─────────────────────────────────────────────

const AXIS_DESCRIPTIONS: Record<string, string> = {
  security: "Security measures protocol safety, header hardening, and vulnerability exposure.",
  speed:
    "Speed measures page speed, Core Web Vitals, and loading optimization. When both mobile and desktop data are available, the score blends mobile (60%) and desktop (40%) to match Google's mobile-first ranking approach.",
  foundations:
    "Foundations measures DNS hygiene, configuration quality, nameserver setup, network health, protocol modernity (HTTP/2+, CDN), and operational maturity. It does NOT measure uptime or reliability — a site with 100% uptime can still score low on foundations if DNS configuration follows poor practices.",
  reputation:
    "Reputation measures domain credibility, age, data breach history, organizational transparency, privacy compliance, and cookie consent practices.",
  discoverability:
    "Discoverability measures search engine discoverability, structured data, social sharing readiness, accessibility, and mobile-friendliness.",
  email:
    "Email measures email authentication maturity (SPF, DKIM, DMARC), email transport security (MTA-STS), brand indicators (BIMI), and mail infrastructure redundancy.",
};

// ─── Archetype Context ──────────────────────────────────────────────

const ARCHETYPE_CONTEXT: Record<ArchetypeName, string> = {
  commerce:
    "This is an e-commerce/commerce site. Payment security is paramount — HSTS, CSP, and cookie security directly protect transactions. Third-party scripts are often business-critical (payment processors, analytics, support). COEP/CORP will likely break the site. Performance directly impacts conversion rates. OG tags and structured data (Product/Offer schema) drive traffic.",
  content:
    "This is a content/publishing site. SEO and visibility signals are critical — structured data, sitemaps, canonical URLs, and social meta directly impact traffic. Performance affects Google ranking via Core Web Vitals. Security headers matter for sites with user comments or logins. RSS feeds are valuable for syndication.",
  application:
    "This is a web application/SPA. Security headers (CSP, HSTS, CORS) are highest priority — the app handles user data and authentication. SPAs have structural TBT/INP challenges. 'Reduce JavaScript' is rarely actionable advice for SPAs. CSP may need 'unsafe-inline' for style-src with styled-components. COEP is impractical if third-party scripts are present. Visibility signals (OG tags, sitemap) are less relevant for authenticated apps.",
  corporate:
    "This is a corporate/business site. Professional presentation matters — complete OG tags, organizational schema, and legal pages are expected. Security headers should be present but CSP is lower priority without user input. Email authentication protects brand reputation.",
  infrastructure:
    "This is an infrastructure/API domain. Traditional web metrics (OG tags, social meta, sitemaps, accessibility) are irrelevant. DNS configuration, TLS, and CORS matter most. Robots blocking crawlers is intentional and correct. MX records are unnecessary. PageSpeed scores are not meaningful.",
  institutional:
    "This is an institutional site (government, education, or similar). Higher standards apply: EV/OV certificates expected, DNSSEC important, accessibility has legal obligations (Section 508, ADA, EAA). Email authentication should be complete. Security headers should be comprehensive.",
  general:
    "No strong archetype detected — apply standard calibration across all axes. Evaluate each signal on its own merits without domain-type assumptions.",
};

// ─── Builder ────────────────────────────────────────────────────────

export function buildSystemPrompt(archetype: ArchetypeResult, signalIds: string[]): string {
  const sections: string[] = [];

  // (a) Core rules
  sections.push(CORE_RULES.trim());

  // (b) Scoring context — auto-generated from registry constants
  const tierStr = TIER_THRESHOLDS.map((t) => `${t.tier} ≥${t.min}`).join(", ");
  const axisStr = (Object.keys(AXIS_WEIGHTS) as Array<keyof typeof AXIS_WEIGHTS>)
    .map((a) => `${a.charAt(0).toUpperCase() + a.slice(1)} (${Math.round(AXIS_WEIGHTS[a] * 100)}%)`)
    .join(", ");

  sections.push(
    `SCORING CONTEXT:\nComposite scoring: Yoke scores 0-100 using budget-based deductive scoring across 6 categories: ${axisStr}.\nScoring model: each axis starts at 100. Issues deduct points proportional to signal weight share (signal_weight / total_good_weight × 100). Severity multipliers: good=0, info=0, low=0.5, medium=0.75, high=1.0, critical=1.5. Absent signal penalty: signals expected but not detected deduct ABSENT_DEDUCTION_FACTOR (0.30) × (1 + goodPrevalence) × their share. goodPrevalence (0-1) is how commonly the signal appears across the web — missing a near-universal signal like HSTS (prevalence ~1.0) costs more (0.30 × 2.0 = 0.60× share) than missing a rare signal like MTA-STS (prevalence ~0.56, costs 0.30 × 1.56 = 0.47× share). Composite = weighted arithmetic mean of axis scores. Floor cap: any axis below 40 caps composite at 74.\nTiers: ${tierStr}.`,
  );

  // Axis descriptions
  const axisDescLines = Object.entries(AXIS_DESCRIPTIONS)
    .map(([axis, desc]) => `- ${axis.charAt(0).toUpperCase() + axis.slice(1)}: ${desc}`)
    .join("\n");
  sections.push(`AXIS DEFINITIONS:\n${axisDescLines}`);

  // (c) Signal calibration — grouped by axis
  const signalsByAxis: Record<string, string[]> = {};
  for (const id of signalIds) {
    const def = SIGNAL_REGISTRY[id];
    if (!def) continue;
    if (!def.promptGuidance && !def.archetypeNotes) continue;

    const lines: string[] = [];
    if (def.promptGuidance) {
      lines.push(`  ${id} (${def.label}): ${def.promptGuidance}`);
    }
    // Inject archetype-specific note if applicable
    if (def.archetypeNotes) {
      const note = def.archetypeNotes[archetype.detected];
      if (note) {
        lines.push(`    [${archetype.detected} context]: ${note}`);
      }
    }

    if (lines.length > 0) {
      const axis = def.axis;
      if (!signalsByAxis[axis]) signalsByAxis[axis] = [];
      signalsByAxis[axis].push(lines.join("\n"));
    }
  }

  if (Object.keys(signalsByAxis).length > 0) {
    const calibrationLines: string[] = ["SIGNAL CALIBRATION:"];
    for (const axis of ["security", "speed", "foundations", "reputation", "discoverability", "email"]) {
      const signals = signalsByAxis[axis];
      if (signals && signals.length > 0) {
        calibrationLines.push(`\n[${axis.toUpperCase()}]`, ...signals);
      }
    }
    sections.push(calibrationLines.join("\n"));
  }

  // (d) Archetype context
  const archContext = ARCHETYPE_CONTEXT[archetype.detected];
  if (archContext) {
    sections.push(
      `SITE ARCHETYPE: ${archetype.detected} (confidence: ${(archetype.confidence * 100).toFixed(0)}%)${archetype.secondary ? ` — secondary: ${archetype.secondary}` : ""}${archetype.platform ? ` — platform: ${archetype.platform}` : ""}\n${archContext}`,
    );
  }

  // (e) Managed platform caveat
  if (archetype.platform) {
    sections.push(
      `MANAGED PLATFORM: This site runs on ${archetype.platform}. Users have limited control over security headers, DNS configuration, server settings, and robots.txt. Recommend "contact ${archetype.platform} support" instead of direct server/header changes. Focus recommendations on what the platform allows (content, DNS records at registrar, email auth).`,
    );
  }

  // (f-h) Additional context sections
  sections.push(
    "SPEED CONTEXT:\n- Mobile/desktop blending: when both are available, speed score = 60% mobile + 40% desktop, matching Google's mobile-first approach.\n- CrUX vs lab: CrUX field data reflects real user experience and is MORE authoritative than lab scores. When they diverge, anchor analysis on CrUX. CrUX good + lab poor = CDN/caching benefits real users. CrUX poor + lab good = real users face conditions lab doesn't simulate.\n- Core Web Vitals thresholds: LCP ≤2.5s good / ≤4.0s needs-improvement / >4.0s poor; CLS ≤0.1 / ≤0.25; TTFB ≤800ms; INP ≤200ms / ≤500ms; FCP ≤1.8s / ≤3.0s; TBT ≤200ms / ≤600ms.",
  );

  // (i) Meta-rules
  sections.push(META_RULES.trim());

  // (j) Cross-signal examples
  sections.push(CROSS_SIGNAL_EXAMPLES.trim());

  // Output schema
  sections.push(OUTPUT_SCHEMA.trim());

  return sections.join("\n\n");
}
