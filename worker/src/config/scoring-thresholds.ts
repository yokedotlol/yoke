// ─── Scoring Thresholds Configuration ────────────────────────────────
// Centralized thresholds for all domain score findings.
// Every threshold is documented with source/rationale.
// Exposed via /api/scoring to make scoring transparent in the UX.

import type { Severity } from "./contextual-scoring-types";

export interface ThresholdBand {
  min?: number; // >= this value (inclusive)
  max?: number; // <= this value (inclusive); first matching band wins
  severity: Severity;
  label?: string; // template with {value} placeholder
}

export interface ThresholdConfig {
  signal: string;
  axis: string;
  description: string;
  source?: string; // citation/rationale
  unit?: string;
  bands: ThresholdBand[];
  weight: number;
}

// ─── Severity → Score mapping ────────────────────────────────────────
// Re-exported from signal-registry.ts (single source of truth).
export { SEVERITY_SCORES } from "./signal-registry";

// ─── Speed ─────────────────────────────────────────────────────

export const PERF_SCORE: ThresholdConfig = {
  signal: "perf_score",
  axis: "speed",
  weight: 5,
  description: "Google PageSpeed Insights overall performance score (mobile)",
  source: "Google Lighthouse scoring: 90+ green, 50-89 orange, <50 red",
  unit: "points",
  bands: [
    { min: 90, severity: "good", label: "Performance score {value}/100" },
    { min: 70, severity: "info", label: "Performance score {value}/100" },
    { min: 50, severity: "low", label: "Performance score {value}/100" },
    { min: 30, severity: "medium", label: "Performance score {value}/100" },
    { min: 0, severity: "high", label: "Low performance score {value}/100" },
  ],
};

export const LCP: ThresholdConfig = {
  signal: "lcp",
  axis: "speed",
  weight: 4,
  description: "Largest Contentful Paint — time until the largest visible element renders",
  source: "Web Vitals: ≤2.5s good, ≤4.0s needs improvement, >4.0s poor (web.dev/lcp)",
  unit: "seconds",
  bands: [
    { max: 2.5, severity: "good", label: "LCP: {value}s" },
    { max: 4.0, severity: "low", label: "LCP: {value}s" },
    { max: 6.0, severity: "medium", label: "LCP: {value}s" },
    { min: 6.0, severity: "high", label: "LCP: {value}s" },
  ],
};

export const CLS: ThresholdConfig = {
  signal: "cls",
  axis: "speed",
  weight: 3,
  description: "Cumulative Layout Shift — visual stability of the page",
  source: "Web Vitals: ≤0.1 good, ≤0.25 needs improvement, >0.25 poor (web.dev/cls)",
  unit: "score",
  bands: [
    { max: 0.1, severity: "good", label: "CLS: {value}" },
    { max: 0.25, severity: "low", label: "CLS: {value}" },
    { max: 0.5, severity: "medium", label: "CLS: {value}" },
    { min: 0.5, severity: "high", label: "CLS: {value}" },
  ],
};

export const TTFB: ThresholdConfig = {
  signal: "ttfb",
  axis: "speed",
  weight: 3,
  description: "Time to First Byte — server response time",
  source: "Web Vitals: ≤800ms good, ≤1800ms needs improvement, >1800ms poor (web.dev/ttfb)",
  unit: "ms",
  bands: [
    { max: 800, severity: "good", label: "TTFB: {value}ms" },
    { max: 1800, severity: "low", label: "TTFB: {value}ms" },
    { max: 3000, severity: "medium", label: "TTFB: {value}ms" },
    { min: 3000, severity: "high", label: "TTFB: {value}ms" },
  ],
};

// ─── Security ────────────────────────────────────────────────────────

export const SSL_GRADE: ThresholdConfig = {
  signal: "ssl_grade",
  axis: "security",
  weight: 3,
  description: "SSL Labs server test grade",
  source: "Qualys SSL Labs grading: A+/A are best practice, B has minor issues, C+ has configuration problems",
  bands: [
    { min: 0, severity: "good", label: "SSL grade {value}" }, // A+, A
    // B, C etc handled by string matching in scoring engine
  ],
};

export const BLOCKLIST: ThresholdConfig = {
  signal: "blocklist",
  axis: "security",
  weight: 5,
  description: "IP presence on DNS blocklists (Spamhaus, SURBL, etc.)",
  source: "Industry standard DNSBL providers",
  bands: [
    { min: 3, severity: "critical", label: "Listed on {value} blocklists" },
    { min: 2, severity: "high", label: "Listed on {value} blocklists" },
    { min: 1, severity: "medium", label: "Listed on {value} blocklist" },
    { min: 0, max: 1, severity: "good", label: "Not on any blocklists" },
  ],
};

// ─── Reputation ───────────────────────────────────────────────────────────

export const DOMAIN_AGE: ThresholdConfig = {
  signal: "domain_age_trust",
  axis: "reputation",
  weight: 3,
  description: "Domain registration age — newer domains are higher risk",
  source: "NextDNS NRD: domains <30 days are newly registered; industry treats <1 year as young",
  unit: "days",
  bands: [
    { min: 1825, severity: "good", label: "Established domain ({value} days)" }, // 5+ years
    { min: 1095, severity: "info", label: "Mature domain ({value} days)" }, // 3-5 years
    { min: 365, severity: "low", label: "Domain age: {value} days" }, // 1-3 years
    { min: 90, severity: "medium", label: "Young domain ({value} days)" }, // 90d-1yr
    { min: 30, severity: "high", label: "Recently registered ({value} days)" }, // 30-90d
    { min: 0, severity: "critical", label: "Newly registered domain ({value} days) — high risk NRD" }, // <30d
  ],
};

export const DOMAIN_EXPIRY: ThresholdConfig = {
  signal: "domain_expiry",
  axis: "reputation",
  weight: 2,
  description: "Domain registration expiry — short registrations may indicate low commitment",
  unit: "days",
  bands: [
    { min: 365, severity: "good", label: "Domain expires in {value} days" },
    { min: 90, severity: "info", label: "Domain expires in {value} days" },
    { min: 30, severity: "low", label: "Domain expires in {value} days" },
    { min: 0, severity: "medium", label: "Domain expires in {value} days" },
  ],
};

// ─── Foundations ─────────────────────────────────────────────────────

export const NS_COUNT: ThresholdConfig = {
  signal: "ns_count",
  axis: "foundations",
  weight: 2, // Aligned with contextual-scoring ns_redundancy weight (M1)
  description: "Number of authoritative nameservers — more = better redundancy",
  bands: [
    { min: 4, severity: "good", label: "{value} nameservers" },
    { min: 2, severity: "info", label: "{value} nameservers" },
    { min: 0, severity: "medium", label: "Only {value} nameserver" },
  ],
};

// ─── Discoverability ──────────────────────────────────────────────────────

export const INP: ThresholdConfig = {
  signal: "inp",
  axis: "speed",
  weight: 3,
  description: "Interaction to Next Paint — responsiveness to user interactions",
  source: "Web Vitals: ≤200ms good, ≤500ms needs improvement, >500ms poor (web.dev/inp)",
  unit: "ms",
  bands: [
    { max: 200, severity: "good", label: "INP: {value}ms" },
    { max: 500, severity: "low", label: "INP: {value}ms" },
    { min: 500, severity: "medium", label: "INP: {value}ms" },
  ],
};

export const FCP: ThresholdConfig = {
  signal: "fcp",
  axis: "speed",
  weight: 2,
  description: "First Contentful Paint — time until first content renders",
  source: "Web Vitals: ≤1.8s good, ≤3.0s needs improvement, >3.0s poor (web.dev/fcp)",
  unit: "seconds",
  bands: [
    { max: 1.8, severity: "good", label: "FCP: {value}s" },
    { max: 3.0, severity: "low", label: "FCP: {value}s" },
    { min: 3.0, severity: "medium", label: "FCP: {value}s" },
  ],
};

export const TBT: ThresholdConfig = {
  signal: "tbt",
  axis: "speed",
  weight: 2,
  description: "Total Blocking Time — JS execution blocking the main thread",
  source: "Lighthouse: <200ms good, <600ms needs improvement, ≥600ms poor",
  unit: "ms",
  bands: [
    { max: 200, severity: "good", label: "TBT: {value}ms" },
    { max: 600, severity: "low", label: "TBT: {value}ms" },
    { min: 600, severity: "medium", label: "TBT: {value}ms — excessive JS blocking" },
  ],
};

// ─── Discoverability ──────────────────────────────────────────────────────

export const A11Y_SCORE: ThresholdConfig = {
  signal: "accessibility",
  axis: "discoverability",
  weight: 1,
  description: "WCAG accessibility quick scan score",
  source: "9 WCAG 2.1 Level A/AA automated checks",
  unit: "points",
  bands: [
    { min: 80, severity: "good", label: "Accessibility score {value}/100" },
    { min: 50, severity: "low", label: "Accessibility score {value}/100" },
    { min: 0, severity: "medium", label: "Accessibility score {value}/100" },
  ],
};

// ─── All configs for API export ──────────────────────────────────────

export const ALL_THRESHOLDS: ThresholdConfig[] = [
  PERF_SCORE,
  LCP,
  CLS,
  TTFB,
  INP,
  FCP,
  TBT,
  SSL_GRADE,
  BLOCKLIST,
  DOMAIN_AGE,
  DOMAIN_EXPIRY,
  NS_COUNT,
  A11Y_SCORE,
];

// ─── Helper: resolve severity from a numeric value ───────────────────

export function resolveSeverity(config: ThresholdConfig, value: number): { severity: Severity; label: string } {
  for (const band of config.bands) {
    const aboveMin = band.min == null || value >= band.min;
    const belowMax = band.max == null || value <= band.max;
    if (aboveMin && belowMax) {
      return {
        severity: band.severity,
        label: (band.label ?? config.signal).replace("{value}", String(Math.round(value * 100) / 100)),
      };
    }
  }
  // Fallback
  return { severity: "info", label: `${config.signal}: ${value}` };
}
