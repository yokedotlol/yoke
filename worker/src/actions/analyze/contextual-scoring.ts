// ─── Contextual Domain Scoring System ─────────────────────────────────
// Implements the 6-axis radar scoring with archetype-based contextual weighting.
// See workspace/yoke-research/scoring-system-design.md for full design doc.

import {
  CLS,
  FCP,
  INP,
  LCP,
  PERF_SCORE,
  resolveSeverity,
  SEVERITY_SCORES,
  TBT,
  TTFB,
} from "../../config/scoring-thresholds";
import {
  AXIS_MAX_GOOD_WEIGHT,
  computeEffectiveMaxGoodWeight,
  AXIS_WEIGHTS as REGISTRY_AXIS_WEIGHTS,
  tierFromComposite as registryTierFromComposite,
  type ScoringContext,
  SIGNAL_REGISTRY,
} from "../../config/signal-registry";
import { analyzeNsDiversity } from "../../data/ns-providers";
import { scanForVulnerableLibraries } from "../../data/vulnerable-libraries";
import type { BreachResult } from "../breaches";
import type { WordPressDetails } from "../wordpress";
import type { AssetCdnResult } from "./asset-cdn";
import type { NetworkHealth } from "./network-health";
import type {
  AccessibilityResult,
  BlocklistResult,
  CacheAnalysis,
  CertTransparencyResult,
  CompressionResult,
  CookieConsentResult,
  CookieSecurityResult,
  CruxResult,
  DnssecResult,
  EmailAuthResult,
  GreynoiseResult,
  HostingResult,
  JsonLdItem,
  LegalResult,
  MetaResult,
  OgTwitterResult,
  PerformanceResult,
  RedirectHop,
  RobotsParsed,
  SecurityHeaderCheck,
  SecurityTxtResult,
  ShodanResult,
  SslResult,
  TechItem,
  ThirdPartyScriptsResult,
  TrustSignals,
  WafDetection,
  WellKnownResult,
} from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export type Axis = "security" | "speed" | "foundations" | "reputation" | "discoverability" | "email";
export type Severity = "critical" | "high" | "medium" | "low" | "info" | "good";

import type { ArchetypeName as _ArchetypeName } from "../../config/contextual-scoring-types";
export type ArchetypeName = _ArchetypeName;

export interface Finding {
  signal: string;
  axis: Axis;
  severity: Severity;
  label: string;
  tradeoff: string | null;
  weight: number; // relative importance within axis (1-5)
  source?: string; // citation/rationale for the threshold
}

export interface ArchetypeResult {
  detected: ArchetypeName;
  confidence: number;
  secondary: ArchetypeName | null;
  signals: string[];
  platform: string | null; // managed platform if detected
  weights: Record<Axis, number>; // single fixed axis weights (all archetypes use the same)
}

/** Detail about an individual absent signal (returned inside the _absent deduction). */
export interface AbsentSignalDetail {
  signal: string;
  label: string;
  weight: number;
  /** Per-signal deduction (IDF-weighted) */
  deduction?: number;
  fixDescription?: string;
  /** Clean label for when signal is absent (e.g., "CDN not detected") */
  absentLabel?: string;
  effort?: string;
  actionable: boolean;
}

/** Itemized deduction explaining where points were lost in an axis. */
export interface AxisDeduction {
  signal: string;
  label: string;
  severity: string;
  weight: number;
  /** Signal's share of the axis budget (% of 100) */
  share: number;
  /** Actual points deducted from the axis score */
  deduction: number;
  /** Category for Level-Up grouping */
  category: "fixable" | "time_dependent" | "infrastructure" | "not_detected";
  /** For _absent deductions: the individual signals that were not detected */
  absentSignals?: AbsentSignalDetail[];
}

export interface AxisScore {
  score: number | null;
  weight: number;
  findings: Finding[];
  /** Itemized deductions explaining the gap from 100 */
  deductions?: AxisDeduction[];
  not_measured?: boolean;
}

export interface DomainScoreResult {
  composite: number;
  tier: string;
  axes: Record<Axis, AxisScore>;
  archetype: ArchetypeResult;
  /** Detected context flags — signals gated by requiresContext only count when their context is present */
  scoringContext?: ScoringContext;
  /** Full scored signal vector for D1 storage — enables retrospective re-weighting analysis */
  signalDetails?: string;
}

// ─── Severity → Score mapping ────────────────────────────────────────
// SEVERITY_SCORES maps severity to a 0-100 numeric score. Still used by
// CrUX/PageSpeed metric resolution (converting metric values to severities)
// and the /api/scoring transparency endpoint. NOT used for axis scoring
// (anchor-and-adjust uses penalty/bonus directly).

// ─── Budget-Based Deductive Scoring Model ────────────────────────────
// Each axis starts at 100 and loses points for issues. Every applicable
// signal has a "budget share" proportional to its weight. Severity
// determines what fraction of that share is deducted. The gap from 100
// is always exactly the sum of visible deductions — no phantom points.

/** Fraction of a signal's budget share deducted per severity level. */
const SEVERITY_DEDUCTION_FACTOR: Record<Severity, number> = {
  critical: 1.5, // punitive — deduct more than the signal's share
  high: 1.0, // lose full share
  medium: 0.75, // moderate issue
  low: 0.5, // minor issue
  info: 0, // neutral observation
  good: 0, // passed — keep your points
};

/** Deduction factor for applicable "canBeGood" signals that didn't fire at all. */
const ABSENT_DEDUCTION_FACTOR = 0.3;

// ─── Expected Baselines (Absence Penalties) ──────────────────────────
// ─── Exported Scoring Helpers ────────────────────────────────────────
// Pure functions extracted for testability. Used by calculateDomainScore below.

/** Signals whose deductions are time-dependent (user can't fix, must wait). */
const TIME_DEPENDENT_SIGNALS = new Set([
  "domain_age_trust",
  "tranco_rank",
  "wayback_history",
  "breach_found",
  "breach_severity",
]);

/** Classify a deduction for Level-Up grouping. */
function classifyDeduction(signal: string, severity: string): AxisDeduction["category"] {
  if (TIME_DEPENDENT_SIGNALS.has(signal)) return "time_dependent";
  if (severity === "good" || severity === "info") return "not_detected"; // shouldn't happen for real deductions
  // Non-actionable signals (blocklist from shared IP, DNS resolution, domain age, etc.)
  // are infrastructure issues the user can't directly fix.
  const reg = SIGNAL_REGISTRY[signal as keyof typeof SIGNAL_REGISTRY];
  if (reg && !reg.actionable) return "infrastructure";
  return "fixable";
}

/**
 * Budget-based deductive axis scoring.
 *
 * Each axis starts at 100. Every applicable signal gets a proportional
 * "share" of the budget. Issues deduct a fraction of that share based
 * on severity. The gap from 100 is always exactly the sum of deductions.
 *
 * When called WITHOUT an axis (standalone), operates in legacy-compatible
 * mode: raw deductions without normalization to 100 budget.
 */
export function computeAxisScore(findings: Finding[], axis?: Axis, scoringCtx?: ScoringContext): number {
  if (findings.length === 0) return 100; // no findings = perfect by default

  // Without axis context, fall back to simple deduction from 100
  if (!axis) {
    let deductions = 0;
    for (const f of findings) {
      const factor = SEVERITY_DEDUCTION_FACTOR[f.severity];
      deductions += factor * Math.max(f.weight, 1) * 2; // scale factor for standalone mode
    }
    return Math.max(0, Math.min(100, Math.round(100 - deductions)));
  }

  // Get total applicable good weight for this axis (denominator)
  const effectiveMaxGoodWeight = scoringCtx ? computeEffectiveMaxGoodWeight(scoringCtx) : AXIS_MAX_GOOD_WEIGHT;
  const totalGoodWeight = effectiveMaxGoodWeight[axis];

  if (totalGoodWeight <= 0) return 100; // no signals = nothing to deduct

  // Compute deductions from findings that fired
  let totalDeduction = 0;

  // Collect signals suppressed from the absent pool by fired bad-variant signals.
  // E.g. referrer_policy_unsafe fires → referrer_policy excluded from absent.
  const suppressedFromAbsent = new Set<string>();

  for (const f of findings) {
    const share = (Math.max(f.weight, 1) / totalGoodWeight) * 100;
    const factor = SEVERITY_DEDUCTION_FACTOR[f.severity];
    totalDeduction += share * factor;

    const reg = SIGNAL_REGISTRY[f.signal as keyof typeof SIGNAL_REGISTRY];
    // If this finding suppresses good-variants from the absent pool, track them
    if (reg?.suppressesAbsent) {
      const targets = Array.isArray(reg.suppressesAbsent) ? reg.suppressesAbsent : [reg.suppressesAbsent];
      for (const t of targets) suppressedFromAbsent.add(t);
    }
  }

  // Absent signals: canBeGood signals that didn't fire at all.
  // IDF-influenced: absent_penalty = weight_share × ABSENT_DEDUCTION_FACTOR × (1 + goodPrevalence)
  // Missing common signals costs more than missing rare ones.
  const firedSignalIds = new Set(findings.map((f) => f.signal));
  let absentDeductionTotal = 0;
  for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
    if (def.axis !== axis || !def.canBeGood) continue;
    if (firedSignalIds.has(id)) continue;
    if (suppressedFromAbsent.has(id)) continue;
    if (def.requiresContext && scoringCtx && !scoringCtx[def.requiresContext as keyof typeof scoringCtx]) continue;
    if (def.requiresHttpAccess && scoringCtx?.httpBlocked) continue;
    const w = def.weightRange[1];
    const share = (w / totalGoodWeight) * 100;
    const prevalenceFactor = 1 + (def.goodPrevalence ?? 0);
    absentDeductionTotal += share * ABSENT_DEDUCTION_FACTOR * prevalenceFactor;
  }
  totalDeduction += absentDeductionTotal;

  return Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
}

/**
 * Compute itemized deductions for an axis (for API response / Level-Up).
 * Returns the same score as computeAxisScore plus a breakdown of each deduction.
 */
export function computeAxisScoreWithDeductions(
  findings: Finding[],
  axis: Axis,
  scoringCtx?: ScoringContext,
): { score: number; deductions: AxisDeduction[] } {
  const effectiveMaxGoodWeight = scoringCtx ? computeEffectiveMaxGoodWeight(scoringCtx) : AXIS_MAX_GOOD_WEIGHT;
  const totalGoodWeight = effectiveMaxGoodWeight[axis];

  if (totalGoodWeight <= 0 || findings.length === 0) {
    return { score: findings.length === 0 ? 100 : computeAxisScore(findings, axis, scoringCtx), deductions: [] };
  }

  const deductions: AxisDeduction[] = [];
  let totalDeduction = 0;

  // Collect signals suppressed from the absent pool by fired bad-variant signals.
  // E.g. referrer_policy_unsafe fires → referrer_policy excluded from absent.
  const suppressedFromAbsent = new Set<string>();

  for (const f of findings) {
    const share = (Math.max(f.weight, 1) / totalGoodWeight) * 100;
    const factor = SEVERITY_DEDUCTION_FACTOR[f.severity];
    const deduction = share * factor;

    if (deduction > 0) {
      deductions.push({
        signal: f.signal,
        label: f.label,
        severity: f.severity,
        weight: f.weight,
        share: Math.round(share * 10) / 10,
        deduction: Math.round(deduction * 10) / 10,
        category: classifyDeduction(f.signal, f.severity),
      });
    }
    totalDeduction += deduction;

    const reg = SIGNAL_REGISTRY[f.signal as keyof typeof SIGNAL_REGISTRY];
    // If this finding suppresses good-variants from the absent pool, track them
    if (reg?.suppressesAbsent) {
      const targets = Array.isArray(reg.suppressesAbsent) ? reg.suppressesAbsent : [reg.suppressesAbsent];
      for (const t of targets) suppressedFromAbsent.add(t);
    }
  }

  // Absent signals: canBeGood signals that didn't fire at all
  // IDF-influenced: per-signal penalty scaled by goodPrevalence
  const firedSignals = new Set(findings.map((f) => f.signal));
  {
    const absentSignals: AbsentSignalDetail[] = [];
    let absentDeduction = 0;
    let absentWeightTotal = 0;
    for (const [id, def] of Object.entries(SIGNAL_REGISTRY)) {
      if (def.axis !== axis || !def.canBeGood) continue;
      if (firedSignals.has(id)) continue;
      if (suppressedFromAbsent.has(id)) continue;
      if (def.requiresContext && scoringCtx && !scoringCtx[def.requiresContext as keyof typeof scoringCtx]) continue;
      if (def.requiresHttpAccess && scoringCtx?.httpBlocked) continue;
      const w = def.weightRange[1];
      const share = (w / totalGoodWeight) * 100;
      const prevalenceFactor = 1 + (def.goodPrevalence ?? 0);
      const signalDeduction = share * ABSENT_DEDUCTION_FACTOR * prevalenceFactor;
      absentDeduction += signalDeduction;
      absentWeightTotal += w;
      absentSignals.push({
        signal: id,
        label: def.label,
        weight: w,
        deduction: Math.round(signalDeduction * 10) / 10,
        fixDescription: def.fixDescription,
        absentLabel: def.absentLabel,
        effort: def.effort,
        actionable: def.actionable,
      });
    }

    if (absentDeduction > 0) {
      const absentShare = (absentWeightTotal / totalGoodWeight) * 100;
      deductions.push({
        signal: "_absent",
        label: `${absentSignals.length} signal${absentSignals.length === 1 ? "" : "s"} not detected in scan`,
        severity: "absent",
        weight: absentWeightTotal,
        share: Math.round(absentShare * 10) / 10,
        deduction: Math.round(absentDeduction * 10) / 10,
        category: "not_detected",
        absentSignals,
      });
      totalDeduction += absentDeduction;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));
  return { score, deductions };
}

export function computeComposite(axisScores: Record<Axis, number>, _archetype: ArchetypeName): number {
  // Weighted arithmetic mean — straightforward, predictable, no log/exp surprises.
  let sum = 0;
  for (const axis of Object.keys(AXIS_WEIGHTS) as Axis[]) {
    sum += AXIS_WEIGHTS[axis] * axisScores[axis];
  }
  let score = Math.max(0, Math.min(100, Math.round(sum)));

  // Outlier floor: if ANY axis < 40, cap tier at Moderate (score ≤ 74).
  // Replaces geometric mean's implicit outlier punishment with one explicit rule.
  const hasLowOutlier = (Object.keys(AXIS_WEIGHTS) as Axis[]).some((a) => axisScores[a] < 40);
  if (hasLowOutlier && score > 74) {
    score = 74;
  }

  return score;
}

// ─── Signal Details Builder ──────────────────────────────────────────
// Builds a JSON blob capturing the full scored signal vector for a scan.
// Stored in D1 `domain_scores.signal_details` to enable retrospective
// re-weighting analysis, prevalence studies, and correlation checks.

/** Shape of the signal_details JSON blob stored in D1. */
export interface SignalDetailsBlob {
  /** Schema version for forward compatibility */
  v: 1;
  composite: number;
  archetype: string;
  archetypeConfidence: number;
  scoringContext?: ScoringContext;
  axes: Record<
    string,
    {
      score: number | null;
      maxGoodWeight: number;
      notMeasured?: boolean;
      findings: Array<{
        signal: string;
        severity: string;
        weight: number;
        share: number;
        deduction: number;
      }>;
      absent: Array<{
        signal: string;
        weight: number;
        share: number;
        deduction: number;
      }>;
      absentDeduction: number;
    }
  >;
}

export function buildSignalDetails(
  axisScores: Record<Axis, AxisScore>,
  composite: number,
  archetype: ArchetypeResult,
  scoringCtx?: ScoringContext,
): string {
  const effectiveMaxGoodWeight = scoringCtx ? computeEffectiveMaxGoodWeight(scoringCtx) : AXIS_MAX_GOOD_WEIGHT;
  const axes: SignalDetailsBlob["axes"] = {};

  for (const axis of Object.keys(AXIS_WEIGHTS) as Axis[]) {
    const as = axisScores[axis];
    const maxGoodWeight = effectiveMaxGoodWeight[axis];

    // Build findings array from deductions (fired signals with actual deductions)
    const findings: SignalDetailsBlob["axes"][string]["findings"] = [];
    const absent: SignalDetailsBlob["axes"][string]["absent"] = [];
    let absentDeduction = 0;

    if (as.deductions) {
      for (const d of as.deductions) {
        if (d.signal === "_absent") {
          // Expand individual absent signals
          absentDeduction = d.deduction;
          if (d.absentSignals) {
            // Distribute the total absent deduction proportionally by weight
            const totalAbsentWeight = d.absentSignals.reduce((sum, s) => sum + s.weight, 0);
            for (const s of d.absentSignals) {
              const share = totalAbsentWeight > 0 ? (s.weight / maxGoodWeight) * 100 : 0;
              const ded = totalAbsentWeight > 0 ? (s.weight / totalAbsentWeight) * d.deduction : 0;
              absent.push({
                signal: s.signal,
                weight: s.weight,
                share: Math.round(share * 10) / 10,
                deduction: Math.round(ded * 10) / 10,
              });
            }
          }
        } else {
          findings.push({
            signal: d.signal,
            severity: d.severity,
            weight: d.weight,
            share: d.share,
            deduction: d.deduction,
          });
        }
      }
    }

    // Also include findings that fired with severity good/info (deduction = 0)
    // These won't be in deductions[] but are in findings[] — they represent passed checks
    if (as.findings) {
      const deductionSignals = new Set(findings.map((f) => f.signal));
      for (const f of as.findings) {
        if (deductionSignals.has(f.signal)) continue; // already captured via deductions
        if (f.signal.startsWith("http_blocked_") || f.signal.startsWith("site_unreachable_")) continue;
        const share = maxGoodWeight > 0 ? (Math.max(f.weight, 1) / maxGoodWeight) * 100 : 0;
        findings.push({
          signal: f.signal,
          severity: f.severity,
          weight: f.weight,
          share: Math.round(share * 10) / 10,
          deduction: 0,
        });
      }
    }

    axes[axis] = {
      score: as.score,
      maxGoodWeight,
      findings,
      absent,
      absentDeduction,
    };
    if (as.not_measured) {
      axes[axis].notMeasured = true;
    }
  }

  const blob: SignalDetailsBlob = {
    v: 1,
    composite,
    archetype: archetype.detected,
    archetypeConfidence: archetype.confidence,
    axes,
  };
  if (scoringCtx) {
    blob.scoringContext = scoringCtx;
  }

  return JSON.stringify(blob);
}

export function tierFromComposite(score: number): string {
  return registryTierFromComposite(score);
}

// ─── Per-Category Hard Caps ──────────────────────────────────────────
// Hard caps removed — severity penalties + outlier floor provide sufficient
// downward pressure. Caps created confusing score/grade paradoxes and
// triple-penalized findings. The breach grade cap below (in calculateDomainScore)
// is retained as a separate, specific mechanism for catastrophic data breaches.

/** @deprecated Hard caps removed. Kept as pass-through for API compatibility. */
export function applyHardCaps(composite: number, _allFindings: Finding[], _axisScores: Record<Axis, number>): number {
  return composite;
}

export function contextualSeverity(
  baseSeverity: Severity,
  archetype: ArchetypeName,
  overrides: Partial<Record<ArchetypeName, Severity>>,
): Severity {
  return overrides[archetype] ?? baseSeverity;
}

// ─── Fixed Axis Weights ──────────────────────────────────────────────
// Re-exported from signal-registry.ts (single source of truth).
// Security weighted highest; Reputation de-emphasized until axis has more diverse signals;
// visibility and performance boosted for better discrimination.

export const AXIS_WEIGHTS: Record<Axis, number> = REGISTRY_AXIS_WEIGHTS;

// ARCHETYPE_WEIGHTS removed — all archetypes use AXIS_WEIGHTS.
// Use AXIS_WEIGHTS as the single source of truth.

// ─── Archetype Detection ─────────────────────────────────────────────

export function detectArchetype(opts: {
  techStack: TechItem[] | null;
  headers: Record<string, string> | null;
  jsonLd: JsonLdItem[] | null;
  domain: string;
  html: string;
  hosting: HostingResult | null;
}): ArchetypeResult {
  const scores: Record<ArchetypeName, { score: number; signals: string[] }> = {
    commerce: { score: 0, signals: [] },
    content: { score: 0, signals: [] },
    application: { score: 0, signals: [] },
    corporate: { score: 0, signals: [] },
    infrastructure: { score: 0, signals: [] },
    institutional: { score: 0, signals: [] },
    general: { score: 0, signals: [] },
  };

  const tech = opts.techStack ?? [];
  const headers = opts.headers ?? {};
  const jsonLd = opts.jsonLd ?? [];
  const domain = opts.domain.toLowerCase();
  const html = opts.html.toLowerCase();

  // Commerce signals
  const commerceTech = ["shopify", "woocommerce", "magento", "bigcommerce", "prestashop", "opencart", "saleor"];
  for (const t of tech) {
    if (commerceTech.some((c) => t.name.toLowerCase().includes(c))) {
      scores.commerce.score += 0.4;
      scores.commerce.signals.push(`${t.name} detected`);
    }
  }
  if (jsonLd.some((j) => j.type === "Product" || j.type === "Offer")) {
    scores.commerce.score += 0.3;
    scores.commerce.signals.push("Product schema found");
  }
  if (headers["x-shopify-stage"] || headers["x-woo-version"]) {
    scores.commerce.score += 0.3;
    scores.commerce.signals.push("Commerce platform headers");
  }
  if (html.includes("/cart") || html.includes("/checkout") || html.includes("add-to-cart")) {
    scores.commerce.score += 0.2;
    scores.commerce.signals.push("Cart/checkout paths detected");
  }

  // Content signals
  const contentTech = [
    "wordpress",
    "ghost",
    "hugo",
    "jekyll",
    "gatsby",
    "eleventy",
    "pelican",
    "hexo",
    "drupal",
    "joomla",
    "squarespace",
  ];
  for (const t of tech) {
    if (contentTech.some((c) => t.name.toLowerCase().includes(c))) {
      scores.content.score += 0.35;
      scores.content.signals.push(`${t.name} (CMS)`);
    }
  }
  if (jsonLd.some((j) => ["Article", "BlogPosting", "NewsArticle", "WebPage"].includes(j.type))) {
    scores.content.score += 0.3;
    scores.content.signals.push("Article/Blog schema found");
  }
  if (html.includes('type="application/rss+xml"') || html.includes("/feed") || html.includes("/rss")) {
    scores.content.score += 0.2;
    scores.content.signals.push("RSS feed detected");
  }

  // Application signals
  const appTech = ["react", "vue", "angular", "svelte", "next.js", "nuxt", "remix"];
  for (const t of tech) {
    if (appTech.some((c) => t.name.toLowerCase().includes(c))) {
      scores.application.score += 0.2;
      scores.application.signals.push(`${t.name} (SPA framework)`);
    }
  }
  if (html.includes('id="root"') || html.includes('id="app"') || html.includes('id="__next"')) {
    scores.application.score += 0.15;
    scores.application.signals.push("SPA root element");
  }
  if (headers["x-powered-by"]?.includes("Express") || headers["x-api-version"]) {
    scores.application.score += 0.2;
    scores.application.signals.push("API/app server headers");
  }
  if (html.includes("/login") || html.includes("/signin") || html.includes("/auth") || html.includes("/oauth")) {
    scores.application.score += 0.2;
    scores.application.signals.push("Auth endpoints detected");
  }

  // Corporate signals
  if (jsonLd.some((j) => j.type === "Organization" || j.type === "Corporation")) {
    scores.corporate.score += 0.3;
    scores.corporate.signals.push("Organization schema found");
  }
  if (html.includes("/careers") || html.includes("/jobs") || html.includes("/about-us") || html.includes("/investor")) {
    scores.corporate.score += 0.25;
    scores.corporate.signals.push("Corporate pages detected");
  }
  if (html.includes("/press") || html.includes("/newsroom") || html.includes("/media-kit")) {
    scores.corporate.score += 0.15;
    scores.corporate.signals.push("Press/media pages");
  }

  // Infrastructure signals
  if (!html || html.length < 500) {
    scores.infrastructure.score += 0.3;
    scores.infrastructure.signals.push("Minimal/no HTML (API-only)");
  }
  if (headers["content-type"]?.includes("application/json") && !html.includes("<html")) {
    scores.infrastructure.score += 0.3;
    scores.infrastructure.signals.push("JSON-only response");
  }
  if (html.includes("/docs") && html.includes("/api") && html.includes("sdk")) {
    scores.infrastructure.score += 0.2;
    scores.infrastructure.signals.push("Developer documentation");
  }

  // Institutional signals
  if (/\.(gov|edu|mil)$/i.test(domain)) {
    scores.institutional.score += 0.7;
    scores.institutional.signals.push(`.${domain.split(".").pop()} TLD`);
  }
  if (headers["x-frame-options"] === "DENY" && headers["x-xss-protection"]) {
    scores.institutional.score += 0.1;
    scores.institutional.signals.push("Strict security headers");
  }

  // Detect managed platform
  let platform: string | null = null;
  const platformChecks: [RegExp, string][] = [
    [/shopify/i, "Shopify"],
    [/wix/i, "Wix"],
    [/squarespace/i, "Squarespace"],
    [/wordpress\.com/i, "WordPress.com"],
    [/vercel/i, "Vercel"],
    [/netlify/i, "Netlify"],
    [/cloudflare pages/i, "Cloudflare Pages"],
  ];
  const hostProvider = opts.hosting?.provider ?? "";
  const cdn = opts.hosting?.cdn ?? "";
  for (const [re, name] of platformChecks) {
    if (re.test(hostProvider) || re.test(cdn) || tech.some((t) => re.test(t.name))) {
      platform = name;
      break;
    }
  }

  // Find top archetype
  const ranked = (Object.entries(scores) as [ArchetypeName, { score: number; signals: string[] }][])
    .filter(([k]) => k !== "general")
    .sort((a, b) => b[1].score - a[1].score);

  const top = ranked[0];
  const second = ranked[1];

  if (!top || top[1].score < 0.3) {
    return {
      detected: "general",
      confidence: 1.0,
      secondary: null,
      signals: ["No strong archetype signals"],
      platform,
      weights: AXIS_WEIGHTS,
    };
  }

  const confidence = Math.min(1.0, top[1].score);
  const secondary = second && second[1].score > 0.25 && top[1].score - second[1].score < 0.15 ? second[0] : null;

  return { detected: top[0], confidence, secondary, signals: top[1].signals, platform, weights: AXIS_WEIGHTS };
}

// ─── Scoring Engine ──────────────────────────────────────────────────

export function calculateDomainScore(opts: {
  ssl: SslResult | null;
  securityGrade: string | null;
  securityAudit: SecurityHeaderCheck[];
  dnssec: DnssecResult | null;
  blocklists: BlocklistResult[];
  emailAuth: EmailAuthResult | null;
  performance: PerformanceResult | null;
  performanceDesktop: PerformanceResult | null;
  crux: CruxResult | null;
  compression: CompressionResult | null;
  httpProtocols: { http2: boolean; http3: boolean } | null;
  hosting: HostingResult | null;
  dnsRecords: Array<{ type: string; data: string; ttl: number }>;
  rdap: { domain_age_days: number | null; days_until_expiry: number | null } | null;
  socialMeta: OgTwitterResult | null;
  jsonLd: JsonLdItem[] | null;
  meta: MetaResult | null;
  legal: LegalResult | null;
  resourceHints: {
    total: number;
    preload: string[];
    preconnect: string[];
    prefetch: string[];
    dns_prefetch: string[];
    modulepreload: string[];
  } | null;
  wayback: { total_snapshots: number | null } | null;
  certTransparency: CertTransparencyResult | null;
  greynoise: GreynoiseResult | null;
  techStack: TechItem[] | null;
  headers: Record<string, string> | null;
  domain: string;
  html: string;
  httpBlocked: boolean;
  accessibility: AccessibilityResult | null;
  thirdPartyScripts: ThirdPartyScriptsResult | null;
  cookieConsent: CookieConsentResult | null;
  cacheAnalysis: CacheAnalysis | null;
  waf: WafDetection | null;
  trustSignals: TrustSignals | null;
  networkHealth: NetworkHealth | null;
  breaches: BreachResult | null;
  trancoRank: number | null;
  socialAccounts: { accounts: Array<{ platform: string; url: string; found_via: string }> } | null;
  // Phase 1 new signals
  shodan: ShodanResult | null;
  cookieSecurity: CookieSecurityResult | null;
  securityTxt: SecurityTxtResult | null;
  wellKnown: WellKnownResult | null;
  redirects: RedirectHop[];
  statusResult: { is_up: boolean; status_code: number | null; http_blocked?: boolean; status_label?: string } | null;
  robotsParsed: RobotsParsed | null;
  wordpress: WordPressDetails | null;
  assetCdn: AssetCdnResult | null;
  /** Internal: set during breach analysis for grade cap logic */
  _recentBreachCount?: number;
  _weightedPwned?: number;
}): DomainScoreResult {
  // Step 1: Detect archetype
  const archetype = detectArchetype({
    techStack: opts.techStack,
    headers: opts.headers,
    jsonLd: opts.jsonLd,
    domain: opts.domain,
    html: opts.html,
    hosting: opts.hosting,
  });

  const arch = archetype.detected;
  const findings: Finding[] = [];

  // ─── Security Axis Findings ──────────────────────────────────────

  // SSL grade
  const sslGrade = opts.ssl?.grade;
  const sslError = opts.ssl?.error;
  if (sslGrade) {
    if (sslGrade === "Valid") {
      // Fallback confirmed HTTPS works but Fly probe didn't provide a letter grade
      findings.push({
        signal: "ssl_grade",
        axis: "security",
        severity: "good",
        label: "SSL certificate verified",
        tradeoff: null,
        weight: 3,
      });
    } else if (sslGrade.startsWith("A")) {
      findings.push({
        signal: "ssl_grade",
        axis: "security",
        severity: "good",
        label: `SSL grade ${sslGrade}`,
        tradeoff: null,
        weight: 3,
      });
    } else if (sslGrade.startsWith("B")) {
      findings.push({
        signal: "ssl_grade",
        axis: "security",
        severity: contextualSeverity("low", arch, { commerce: "medium", institutional: "medium" }),
        label: `SSL grade ${sslGrade} — room for improvement`,
        tradeoff: null,
        weight: 3,
      });
    } else if (sslGrade.startsWith("C")) {
      findings.push({
        signal: "ssl_grade",
        axis: "security",
        severity: contextualSeverity("medium", arch, { commerce: "high", institutional: "high" }),
        label: `SSL grade ${sslGrade} — weak configuration`,
        tradeoff: "Tightening SSL config may drop support for older clients.",
        weight: 3,
      });
    } else {
      findings.push({
        signal: "ssl_grade",
        axis: "security",
        severity: contextualSeverity("high", arch, { commerce: "critical", institutional: "critical" }),
        label: `SSL grade ${sslGrade} — significant weaknesses`,
        tradeoff: null,
        weight: 3,
      });
    }
  } else if (sslError && !opts.httpBlocked) {
    // Fly probe couldn't assess but the site was successfully fetched over HTTPS — don't penalize
    findings.push({
      signal: "ssl_grade",
      axis: "security",
      severity: "info",
      label: "SSL present (grade assessment unavailable)",
      tradeoff: null,
      weight: 3,
    });
  } else if (!opts.httpBlocked) {
    findings.push({
      signal: "ssl_missing",
      axis: "security",
      severity: contextualSeverity("high", arch, { content: "medium" }),
      label: "No SSL certificate detected",
      tradeoff: null,
      weight: 3,
    });
  }

  // SSL expansion signals: cipher suites, OCSP, forward secrecy, SCTs
  if (opts.ssl?.ciphers && opts.ssl.ciphers.length > 0) {
    const weakCiphers = opts.ssl.ciphers.filter((c) => c.strength === "weak" || c.strength === "insecure");
    if (weakCiphers.length > 0) {
      findings.push({
        signal: "ssl_weak_ciphers",
        axis: "security",
        severity: contextualSeverity("medium", arch, { commerce: "high", institutional: "high" }),
        label: `${weakCiphers.length} weak/insecure cipher suite${weakCiphers.length > 1 ? "s" : ""} offered`,
        tradeoff: "Disabling weak ciphers may drop support for very old clients (IE 10, Android 4.x).",
        weight: 2,
      });
    }
  }

  if (opts.ssl?.ocsp_stapling != null) {
    findings.push({
      signal: "ssl_ocsp_stapling",
      axis: "security",
      severity: opts.ssl.ocsp_stapling ? "good" : "low",
      label: opts.ssl.ocsp_stapling ? "OCSP stapling enabled" : "OCSP stapling not detected",
      tradeoff: null,
      weight: 1,
    });
  }

  if (opts.ssl?.forward_secrecy != null) {
    findings.push({
      signal: "ssl_forward_secrecy",
      axis: "security",
      severity: opts.ssl.forward_secrecy ? "good" : contextualSeverity("medium", arch, { commerce: "high" }),
      label: opts.ssl.forward_secrecy
        ? "Forward secrecy enabled"
        : "No forward secrecy — past sessions vulnerable if key compromised",
      tradeoff: null,
      weight: 2,
    });
  }

  if (opts.ssl?.has_scts != null) {
    findings.push({
      signal: "ssl_certificate_transparency",
      axis: "security",
      severity: opts.ssl.has_scts ? "good" : "info",
      label: opts.ssl.has_scts
        ? `Certificate Transparency: ${opts.ssl.sct_count} SCT${(opts.ssl.sct_count ?? 0) > 1 ? "s" : ""} present`
        : "No Certificate Transparency SCTs found",
      tradeoff: null,
      weight: 1,
    });
  }

  // HSTS
  const hasHsts = !!opts.headers?.["strict-transport-security"];
  if (!opts.httpBlocked) {
    if (hasHsts) {
      findings.push({
        signal: "hsts",
        axis: "security",
        severity: "good",
        label: "HSTS enabled",
        tradeoff: null,
        weight: 4,
      });
    } else {
      findings.push({
        signal: "hsts_missing",
        axis: "security",
        severity: contextualSeverity("medium", arch, {
          commerce: "critical",
          application: "high",
          content: "low",
          corporate: "medium",
        }),
        label: arch === "commerce" ? "No HSTS — payment flows vulnerable to downgrade attacks" : "No HSTS header",
        tradeoff:
          arch === "content" ? "Adding HSTS is low-effort. But if you serve mixed content, HSTS will break it." : null,
        weight: 4, // Highest security weight — HSTS prevents protocol downgrade attacks, the most impactful single header
      });
    }
  }

  // CSP
  const hasCsp = opts.securityAudit.some(
    (a) => a.header.toLowerCase().includes("content-security-policy") && a.status === "pass",
  );
  if (!opts.httpBlocked) {
    if (hasCsp) {
      findings.push({
        signal: "csp",
        axis: "security",
        severity: "good",
        label: "Content Security Policy present",
        tradeoff: null,
        weight: 3,
      });
    } else {
      findings.push({
        signal: "csp_missing",
        axis: "security",
        severity: contextualSeverity("medium", arch, { application: "high", content: "medium", corporate: "low" }),
        label: arch === "application" ? "No CSP — XSS risk for interactive app" : "No Content Security Policy",
        tradeoff: arch === "application" ? "CSP is hard to retrofit. Start with report-only mode." : null,
        weight: 3,
      });
    }
  }

  // X-Frame-Options — skip if CSP frame-ancestors supersedes it (I1 audit fix)
  const hasXfo = opts.securityAudit.some(
    (a) => a.header.toLowerCase().includes("x-frame-options") && a.status === "pass",
  );
  const cspHeaderXfo = opts.headers?.["content-security-policy"] ?? "";
  const hasFrameAncestors = /frame-ancestors/i.test(cspHeaderXfo);
  if (!opts.httpBlocked) {
    if (hasXfo || hasFrameAncestors) {
      findings.push({
        signal: "xfo",
        axis: "security",
        severity: "good",
        label: hasXfo ? "X-Frame-Options set" : "CSP frame-ancestors set (supersedes X-Frame-Options)",
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "xfo",
        axis: "security",
        severity: contextualSeverity("low", arch, { commerce: "medium", application: "medium" }),
        label: "No clickjacking protection (X-Frame-Options or CSP frame-ancestors)",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // X-Content-Type-Options
  const hasXcto = opts.securityAudit.some(
    (a) => a.header.toLowerCase().includes("x-content-type-options") && a.status === "pass",
  );
  if (!opts.httpBlocked) {
    findings.push({
      signal: "xcto",
      axis: "security",
      severity: hasXcto ? "good" : "low",
      label: hasXcto ? "X-Content-Type-Options set" : "No X-Content-Type-Options",
      tradeoff: null,
      weight: 1,
    });
  }

  // DNSSEC — bonus when present, minimal penalty when absent for most archetypes
  if (opts.dnssec) {
    findings.push({
      signal: "dnssec",
      axis: "security",
      severity: opts.dnssec.enabled
        ? "good"
        : contextualSeverity("info", arch, {
            institutional: "medium",
            infrastructure: "medium",
            commerce: "low",
            corporate: "low",
            application: "info",
            content: "info",
            general: "info",
          }),
      label: opts.dnssec.enabled ? "DNSSEC enabled" : "DNSSEC not enabled",
      tradeoff: opts.dnssec.enabled
        ? null
        : "DNSSEC adds DNS-level authenticity but can complicate DNS management. Most sites work fine without it.",
      weight: opts.dnssec.enabled ? 2 : 1, // Asymmetric: rewards presence (weight 2) but barely penalizes absence (weight 1) because DNSSEC adoption is low and most sites work fine without it
      source: "DNSSEC adds DNS-level authenticity. Weighted asymmetrically: present=bonus, absent=minimal penalty.",
    });
  }

  // Blocklist status
  const listedCount = (opts.blocklists ?? []).filter((b) => b.listed).length;
  if (listedCount > 0) {
    // CDN IPs are shared infrastructure — blocklist hits reflect neighbors, not this domain (I4)
    const isBehindCdn = !!opts.hosting?.cdn;
    if (isBehindCdn) {
      findings.push({
        signal: "blocklist_listed",
        axis: "reputation",
        severity: "info",
        label: `Listed on ${listedCount} blocklist${listedCount > 1 ? "s" : ""} (shared CDN IP: ${opts.hosting?.cdn})`,
        tradeoff: "Blocklist hits on CDN IPs reflect shared infrastructure, not this domain specifically.",
        weight: 1,
      });
    } else {
      findings.push({
        signal: "blocklist_listed",
        axis: "reputation",
        severity: listedCount >= 3 ? "critical" : listedCount >= 2 ? "high" : "medium",
        label: `Listed on ${listedCount} blocklist${listedCount > 1 ? "s" : ""}`,
        tradeoff: null,
        weight: 3,
      });
    }
  }

  // Email auth (SPF + DKIM + DMARC)
  if (opts.emailAuth) {
    const hasSpf = opts.emailAuth.spf.found;
    const hasDmarc = opts.emailAuth.dmarc.found;
    const hasDkim = opts.emailAuth.dkim_selectors_found.length > 0;
    const dmarcPolicy = opts.emailAuth.dmarc.policy;
    const emailComplete = hasSpf && hasDmarc && hasDkim;

    if (emailComplete && dmarcPolicy === "reject") {
      findings.push({
        signal: "email_auth",
        axis: "email",
        severity: "good",
        label: "Full email auth (SPF+DKIM+DMARC reject)",
        tradeoff: null,
        weight: 3,
      });
    } else if (emailComplete) {
      findings.push({
        signal: "email_auth",
        axis: "email",
        severity: "info",
        label: `Email auth present (DMARC: ${dmarcPolicy || "none"})`,
        tradeoff: null,
        weight: 3,
      });
    } else {
      // SPF and DMARC are deterministic lookups; DKIM uses arbitrary selectors
      // that can't always be discovered externally — treat them differently
      const missing = [!hasSpf && "SPF", !hasDmarc && "DMARC"].filter(Boolean);
      if (missing.length > 0) {
        findings.push({
          signal: "email_auth_incomplete",
          axis: "email",
          severity: contextualSeverity("medium", arch, { corporate: "high" }),
          label: `Missing email auth: ${missing.join(", ")}`,
          tradeoff: null,
          weight: 3,
        });
      }
      if (!hasDkim && (hasSpf || hasDmarc)) {
        // DKIM absence is too noisy — external detection is limited; skip
      }
      // SPF without DMARC — trivially spoofable since there's no enforcement policy
      if (hasSpf && !hasDmarc) {
        findings.push({
          signal: "spf_without_dmarc",
          axis: "email",
          severity: contextualSeverity("low", arch, { corporate: "medium" }),
          label: "SPF without DMARC — spoofing protection incomplete without enforcement policy",
          tradeoff: "Add a DMARC record (start with p=none) to enforce SPF alignment.",
          weight: 2,
        });
      }
    }

    // ── SPF Strictness ──────────────────────────────────────────────
    const qualifier = opts.emailAuth.spf.all_qualifier;
    if (qualifier) {
      const q = qualifier.charAt(0);
      if (q === "-") {
        findings.push({
          signal: "spf_strictness",
          axis: "email",
          severity: "good",
          label: "SPF hardfail (-all) — strongest enforcement",
          tradeoff: null,
          weight: 2,
        });
      } else if (q === "~") {
        // ~all (softfail) is the dominant convention — neutral, no penalty
        findings.push({
          signal: "spf_strictness",
          axis: "email",
          severity: "info",
          label: "SPF softfail (~all) — acceptable but weaker than hardfail",
          tradeoff: "Consider switching to -all (hardfail) if all senders are known.",
          weight: 2,
        });
      } else if (q === "?") {
        findings.push({
          signal: "spf_strictness",
          axis: "email",
          severity: "medium",
          label: "SPF neutral (?all) — provides no protection",
          tradeoff: "Switch to ~all or -all for meaningful spoofing protection.",
          weight: 2,
        });
      } else if (q === "+") {
        findings.push({
          signal: "spf_strictness",
          axis: "email",
          severity: "high",
          label: "SPF pass-all (+all) — authorizes all senders, actively dangerous",
          tradeoff: "Remove +all immediately and replace with ~all or -all.",
          weight: 2,
        });
      }
    }

    // ── SPF Multiple Records ────────────────────────────────────────
    const spfRecordCount = opts.dnsRecords.filter(
      (r) => r.type === "TXT" && r.data.replace(/^"|"$/g, "").startsWith("v=spf1"),
    ).length;
    if (spfRecordCount > 1) {
      findings.push({
        signal: "spf_multiple_records",
        axis: "email",
        severity: "high",
        label: `${spfRecordCount} SPF records — RFC violation, causes PermError`,
        tradeoff: "Merge all SPF records into a single TXT record.",
        weight: 3,
      });
    }

    // ── SPF Lookup Count ────────────────────────────────────────────
    if (opts.emailAuth.spf.found && opts.emailAuth.spf.mechanisms.length > 0) {
      // Count DNS-querying mechanisms: include, a, mx, ptr, exists, redirect
      const lookupMechs = opts.emailAuth.spf.mechanisms.filter((m) =>
        /^(include:|a:|a$|mx:|mx$|ptr:|ptr$|exists:|redirect=)/i.test(m),
      );
      const lookupCount = lookupMechs.length;
      if (lookupCount > 10) {
        findings.push({
          signal: "spf_lookup_count",
          axis: "email",
          severity: "high",
          label: `SPF exceeds 10-lookup limit (${lookupCount} mechanisms) — SPF is broken`,
          tradeoff: "Flatten SPF record or reduce includes. Use an SPF flattening service.",
          weight: 2,
        });
      } else if (lookupCount === 10) {
        findings.push({
          signal: "spf_lookup_count",
          axis: "email",
          severity: "low",
          label: "SPF at exact 10-lookup limit — any addition will break it",
          tradeoff: "Consider SPF flattening to create headroom.",
          weight: 2,
        });
      } else if (lookupCount >= 8) {
        findings.push({
          signal: "spf_lookup_count",
          axis: "email",
          severity: "info",
          label: `SPF near lookup limit (${lookupCount}/10 mechanisms)`,
          tradeoff: null,
          weight: 2,
        });
      } else if (lookupCount >= 1) {
        findings.push({
          signal: "spf_lookup_count",
          axis: "email",
          severity: "good",
          label: `SPF well within lookup limit (${lookupCount}/10 mechanisms)`,
          tradeoff: null,
          weight: 2,
        });
      }
    }

    // ── DMARC Reporting (rua=) ──────────────────────────────────────
    if (opts.emailAuth.dmarc.found) {
      if (opts.emailAuth.dmarc.rua) {
        findings.push({
          signal: "dmarc_rua",
          axis: "email",
          severity: "good",
          label: "DMARC aggregate reporting (rua) configured",
          tradeoff: null,
          weight: 2,
        });
      } else {
        findings.push({
          signal: "dmarc_rua",
          axis: "email",
          severity: "medium",
          label: "DMARC without reporting — no visibility into spoofing attempts",
          tradeoff: "Add rua=mailto:dmarc-reports@yourdomain.com to your DMARC record.",
          weight: 2,
        });
      }
    }

    // ── DMARC Subdomain Policy (sp=) ────────────────────────────────
    if (opts.emailAuth.dmarc.found && opts.emailAuth.dmarc.subdomain_policy) {
      const sp = opts.emailAuth.dmarc.subdomain_policy;
      if (sp === "reject") {
        findings.push({
          signal: "dmarc_subdomain_policy",
          axis: "email",
          severity: "good",
          label: "DMARC subdomain policy: reject — subdomains protected",
          tradeoff: null,
          weight: 1,
        });
      } else if (sp === "quarantine") {
        findings.push({
          signal: "dmarc_subdomain_policy",
          axis: "email",
          severity: "info",
          label: "DMARC subdomain policy: quarantine",
          tradeoff: null,
          weight: 1,
        });
      }
      // sp=none → no finding (don't penalize, inheriting parent is standard)
    }

    // ── DKIM Discovered ─────────────────────────────────────────────
    const dkimCount = opts.emailAuth.dkim_selectors_found.length;
    if (dkimCount > 0) {
      findings.push({
        signal: "dkim_discovered",
        axis: "email",
        severity: "good",
        label: `DKIM verified (${dkimCount} selector${dkimCount !== 1 ? "s" : ""} found)`,
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.emailAuth.spf.found || opts.emailAuth.dmarc.found) {
      // Only penalize DKIM absence if domain has other email auth (indicates it sends email)
      // Don't penalize hard — selector enumeration has inherent false negatives
      findings.push({
        signal: "dkim_discovered",
        axis: "email",
        severity: "info",
        label: "No DKIM selectors discovered (may use non-standard selectors)",
        tradeoff: "Configure DKIM signing via your email provider.",
        weight: 2,
      });
    }

    // ── TLS-RPT ─────────────────────────────────────────────────────
    if (opts.emailAuth.tls_rpt?.found) {
      findings.push({
        signal: "tls_rpt",
        axis: "email",
        severity: "good",
        label: "TLS-RPT configured — TLS delivery failure reporting enabled",
        tradeoff: null,
        weight: 1,
      });
    }

    // ── MTA-STS ─────────────────────────────────────────────────────
    if (opts.emailAuth.mta_sts?.policy_found && opts.emailAuth.mta_sts.mode === "enforce") {
      findings.push({
        signal: "mta_sts",
        axis: "email",
        severity: "good",
        label: "MTA-STS enforcing TLS for inbound email",
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.emailAuth.mta_sts?.policy_found && opts.emailAuth.mta_sts.mode === "testing") {
      findings.push({
        signal: "mta_sts",
        axis: "email",
        severity: "info",
        label: "MTA-STS in testing mode",
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.emailAuth.mta_sts?.dns_found && !opts.emailAuth.mta_sts.policy_found) {
      findings.push({
        signal: "mta_sts",
        axis: "email",
        severity: "low",
        label: "MTA-STS DNS record exists but policy file missing",
        tradeoff: null,
        weight: 2,
      });
    }

    // BIMI: handled in Phase 3 below (distinguishes VMC)
  }

  // WAF detection
  if (opts.waf?.detected) {
    if (opts.waf.confidence === "high") {
      findings.push({
        signal: "waf_detected",
        axis: "security",
        severity: "good",
        label: `WAF detected: ${opts.waf.provider}`,
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.waf.confidence === "medium") {
      findings.push({
        signal: "waf_detected",
        axis: "security",
        severity: "good",
        label: `WAF likely: ${opts.waf.provider}`,
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "waf_detected",
        axis: "security",
        severity: "good",
        label: `WAF possible: ${opts.waf.provider}`,
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // CSP header — already scored via securityAudit ("csp" signal above); skip to avoid double-count

  // HSTS preload
  if (opts.headers && !opts.httpBlocked) {
    const hsts = opts.headers["strict-transport-security"] ?? "";
    if (/preload/i.test(hsts) && /max-age\s*=\s*(\d{8,})/i.test(hsts) && /includesubdomains/i.test(hsts)) {
      findings.push({
        signal: "hsts_preload",
        axis: "security",
        severity: "good",
        label: "HSTS preload eligible",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // CAA records — detailed parsing
  const caaRecords = opts.dnsRecords.filter((r) => r.type === "CAA");
  if (caaRecords.length > 0) {
    // Parse CAA directives for detail
    const issueDirectives: string[] = [];
    const issuewildDirectives: string[] = [];
    let hasIodef = false;
    for (const rec of caaRecords) {
      const match = rec.data.match(/^\d+\s+(\w+)\s+"?([^"]*)"?$/);
      if (!match) continue;
      const tag = match[1].toLowerCase();
      const value = match[2];
      if (tag === "issue") issueDirectives.push(value);
      else if (tag === "issuewild") issuewildDirectives.push(value);
      else if (tag === "iodef") hasIodef = true;
    }
    if (issueDirectives.length > 0) {
      const caNames = issueDirectives
        .filter((v) => v !== ";")
        .slice(0, 3)
        .join(", ");
      findings.push({
        signal: "caa_records",
        axis: "security",
        severity: "good",
        label: `CAA restricts issuance to: ${caNames || "none (issuance blocked)"}`,
        tradeoff: null,
        weight: 1,
      });
    } else {
      findings.push({
        signal: "caa_records",
        axis: "security",
        severity: "good",
        label: "CAA records restrict certificate issuance",
        tradeoff: null,
        weight: 1,
      });
    }
    // Flag if issue is set but issuewild is not — wildcards can be issued by any CA
    if (issueDirectives.length > 0 && issuewildDirectives.length === 0) {
      findings.push({
        signal: "caa_wildcard_unrestricted",
        axis: "security",
        severity: "info",
        label: "CAA: no issuewild restriction — wildcard certs unrestricted",
        tradeoff: "Consider adding issuewild CAA records to restrict which CAs can issue wildcard certificates.",
        weight: 0,
      });
    }
    // Credit iodef (violation reporting configured)
    if (hasIodef) {
      findings.push({
        signal: "caa_iodef",
        axis: "security",
        severity: "good",
        label: "CAA: violation reporting configured (iodef)",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // Certificate Transparency
  if (opts.certTransparency && !opts.certTransparency.error) {
    const ct = opts.certTransparency;
    // Wildcard certificates — increased attack surface
    if (ct.has_wildcard) {
      findings.push({
        signal: "cert_wildcard",
        axis: "security",
        severity: contextualSeverity("info", arch, { institutional: "low", commerce: "low" }),
        label: "Wildcard certificate in use",
        tradeoff: "Wildcards simplify cert management but increase blast radius if the key is compromised.",
        weight: 1,
      });
    }
    // Certificate volume — removed: 306/306 identical, zero discrimination
  }

  // ─── CT-CAA Cross-Reference ──────────────────────────────────────
  // Compare Certificate Transparency log issuers against CAA records.
  // Info-only, zero penalty — flags potential oversight without penalizing.
  if (opts.certTransparency && !opts.certTransparency.error && opts.certTransparency.certs.length > 0) {
    const caaRecords = opts.dnsRecords.filter((r) => r.type === "CAA");
    // Only run if CAA records exist (can't mismatch against nothing)
    if (caaRecords.length > 0) {
      // Parse CAA issue/issuewild directives → set of authorized CA domains
      const authorizedCAs = new Set<string>();
      for (const caa of caaRecords) {
        // CAA data format: "0 issue \"letsencrypt.org\"" or "0 issuewild \"digicert.com; cansignhttpexchanges=yes\""
        const match = caa.data.match(/\b(?:issue|issuewild)\s+"([^"]+)"/i);
        if (match) {
          // Strip optional parameters (e.g., "; cansignhttpexchanges=yes") — keep only the domain
          const domain = match[1].split(";")[0].trim().toLowerCase();
          if (domain) authorizedCAs.add(domain);
        }
      }

      if (authorizedCAs.size > 0) {
        // Filter CT certs to last 2 years only (by not_before date)
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const recentCerts = opts.certTransparency.certs.filter((c) => {
          const notBefore = new Date(c.not_before);
          return notBefore >= twoYearsAgo;
        });

        // Find issuers not authorized by CAA
        // Normalize issuer names: extract the CA organization from the issuer DN
        const unauthorizedCAs = new Set<string>();
        let unauthorizedCertCount = 0;
        for (const cert of recentCerts) {
          // Issuer is a friendly name like "Sectigo" or "DigiCert" (from CertSpotter expand=issuer),
          // or a full DN like "C=US, O=Let's Encrypt, CN=R3" as fallback — extract org for matching
          const orgMatch = cert.issuer.match(/O=([^,]+)/i);
          const issuerOrg = orgMatch ? orgMatch[1].trim().toLowerCase() : cert.issuer.toLowerCase();
          // Check if any authorized CA domain appears in the issuer org name
          const isAuthorized = [...authorizedCAs].some((ca) => {
            const caDomain = ca.replace(/\.$/, "").toLowerCase(); // strip trailing dot
            const caName = caDomain.split(".")[0]; // e.g., "letsencrypt" from "letsencrypt.org"

            // Known CA domain → issuer org name mappings (CAA domains often don't match CT issuer names)
            const CA_ALIASES: Record<string, string[]> = {
              "letsencrypt.org": ["let's encrypt", "lets encrypt", "isrg", "r3", "r4", "e1", "e2"],
              "pki.goog": ["google trust services", "google internet authority", "gts ca"],
              "comodoca.com": ["comodo", "sectigo"],
              "sectigo.com": ["sectigo", "comodo"],
              "digicert.com": ["digicert", "geotrust", "rapidssl", "thawte", "encryption everywhere"],
              "godaddy.com": ["godaddy", "go daddy", "starfield"],
              "amazontrust.com": ["amazon", "starfield services"],
              "globalsign.com": ["globalsign"],
              "entrust.net": ["entrust"],
              "buypass.com": ["buypass"],
              "ssl.com": ["ssl.com"],
              "zerossl.com": ["zerossl"],
            };

            // Check aliases first (most reliable)
            const aliases = CA_ALIASES[caDomain];
            if (aliases?.some((alias) => issuerOrg.includes(alias))) return true;

            // Fallback: simple substring matching
            return issuerOrg.includes(caName) || issuerOrg.includes(caDomain);
          });
          if (!isAuthorized) {
            unauthorizedCAs.add(orgMatch ? orgMatch[1].trim() : cert.issuer);
            unauthorizedCertCount++;
          }
        }

        if (unauthorizedCAs.size > 0) {
          const caList = [...unauthorizedCAs].slice(0, 5).join(", ");
          findings.push({
            signal: "ct_caa_mismatch",
            axis: "security",
            severity: "info",
            label: `${unauthorizedCertCount} cert${unauthorizedCertCount !== 1 ? "s" : ""} from CA${unauthorizedCAs.size !== 1 ? "s" : ""} not in CAA: ${caList}`,
            tradeoff:
              "Certificates from CAs not listed in CAA records may predate CAA deployment or indicate a policy gap. This is informational only.",
            weight: 0, // zero penalty — informational
          });
        }
      }
    }
  }

  // ─── NEW: Shodan Open Ports (attack surface) ─────────────────────
  if (opts.shodan) {
    const dangerousPorts = [3306, 5432, 6379, 27017, 9200, 11211, 5984, 1433, 3389, 2379, 2380, 9090, 3000, 5601, 8500];
    const exposedDangerous = opts.shodan.ports.filter((p) => dangerousPorts.includes(p));
    if (exposedDangerous.length > 0) {
      findings.push({
        signal: "open_ports",
        axis: "security",
        severity: "high",
        label: `Dangerous port${exposedDangerous.length > 1 ? "s" : ""} exposed: ${exposedDangerous.join(", ")}`,
        tradeoff: null,
        weight: 3,
      });
    }
    // Non-standard port count removed — complex infrastructure legitimately
    // runs many ports; count alone isn't a security signal
  }

  // ─── NEW: Shodan Known Vulnerabilities ───────────────────────────
  if (opts.shodan) {
    if (opts.shodan.vulns.length > 0) {
      findings.push({
        signal: "known_vulnerabilities",
        axis: "security",
        severity: opts.shodan.vulns.length >= 5 ? "critical" : "high",
        label: `${opts.shodan.vulns.length} known CVE${opts.shodan.vulns.length > 1 ? "s" : ""} detected (Shodan)`,
        tradeoff: "CVEs are based on detected service versions and may include patched vulnerabilities.",
        weight: 5,
      });
    }
    // no_known_vulnerabilities removed — zero discrimination (328/328 = good)
  }

  // ─── NEW: Cookie Security ────────────────────────────────────────
  if (opts.cookieSecurity && !opts.httpBlocked) {
    const issues = opts.cookieSecurity.issues;
    const cookieCount = opts.cookieSecurity.cookies.length;
    if (cookieCount > 0) {
      if (issues.length === 0) {
        findings.push({
          signal: "cookie_security",
          axis: "security",
          severity: "good",
          label: "All cookies have Secure/HttpOnly flags",
          tradeoff: null,
          weight: 3,
        });
      } else if (issues.length >= 3) {
        findings.push({
          signal: "cookie_security",
          axis: "security",
          severity: "medium",
          label: `${issues.length} cookie security issues (missing Secure/HttpOnly)`,
          tradeoff: null,
          weight: 3,
        });
      } else {
        findings.push({
          signal: "cookie_security",
          axis: "security",
          severity: "low",
          label: `${issues.length} cookie security issue${issues.length > 1 ? "s" : ""}`,
          tradeoff: null,
          weight: 3,
        });
      }
    }
  }

  // ─── NEW: Server Version Disclosure ──────────────────────────────
  if (opts.headers && !opts.httpBlocked) {
    const serverHeader = opts.headers.server ?? "";
    const poweredBy = opts.headers["x-powered-by"] ?? "";
    const versionPattern = /\/[\d.]+/;
    const serverLeaks = versionPattern.test(serverHeader);
    const poweredByLeaks = versionPattern.test(poweredBy);
    if (serverLeaks || poweredByLeaks) {
      const leaked = [serverLeaks && serverHeader, poweredByLeaks && poweredBy].filter(Boolean).join(", ");
      findings.push({
        signal: "server_version_disclosure",
        axis: "security",
        severity: poweredByLeaks ? "medium" : "low",
        label: `Server version disclosed: ${leaked}`,
        tradeoff: "Version info helps attackers target known vulnerabilities.",
        weight: poweredByLeaks ? 2 : 1,
      });
    }
  }

  // ─── Referrer-Policy Value Parsing ───────────────────────────────
  if (opts.headers && !opts.httpBlocked) {
    const referrerPolicy = (opts.headers["referrer-policy"] ?? "").toLowerCase().trim();
    const goodPolicies = [
      "no-referrer",
      "strict-origin-when-cross-origin",
      "same-origin",
      "strict-origin",
      "origin-when-cross-origin",
    ];
    if (referrerPolicy === "unsafe-url") {
      findings.push({
        signal: "referrer_policy_unsafe",
        axis: "security",
        severity: "high",
        label: "Referrer-Policy: unsafe-url leaks full URL including path and query to all origins",
        tradeoff: "This is the least secure policy. Switch to strict-origin-when-cross-origin or no-referrer.",
        weight: 2,
      });
    } else if (referrerPolicy === "no-referrer-when-downgrade") {
      findings.push({
        signal: "referrer_policy_unsafe",
        axis: "security",
        severity: "medium",
        label: "Referrer-Policy: no-referrer-when-downgrade leaks full URL to HTTP targets",
        tradeoff:
          "Leaks full URL (path + query) on HTTPS→HTTP navigations. Use strict-origin-when-cross-origin instead.",
        weight: 2,
      });
    } else if (referrerPolicy === "origin") {
      findings.push({
        signal: "referrer_policy",
        axis: "security",
        severity: "info",
        label: "Referrer-Policy: origin (safe but limited)",
        tradeoff:
          "Sends only the origin, never the path. Safe but prevents analytics from seeing referrer paths. Consider strict-origin-when-cross-origin for a balance.",
        weight: 1,
      });
    } else if (goodPolicies.includes(referrerPolicy)) {
      findings.push({
        signal: "referrer_policy",
        axis: "security",
        severity: "good",
        label: `Referrer-Policy: ${referrerPolicy}`,
        tradeoff: null,
        weight: 1,
      });
    } else if (!referrerPolicy) {
      findings.push({
        signal: "referrer_policy_missing",
        axis: "security",
        severity: "low",
        label: "No Referrer-Policy header",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── NEW: Permissions-Policy ─────────────────────────────────────
  if (opts.headers && !opts.httpBlocked) {
    const permPolicy = opts.headers["permissions-policy"] ?? opts.headers["feature-policy"] ?? "";
    if (permPolicy) {
      // Parse directive values: "camera=(), microphone=(), geolocation=(self)"
      const directives = permPolicy
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean);
      let restrictedCount = 0;
      const unrestrictedFeatures: string[] = [];
      for (const directive of directives) {
        const eqIdx = directive.indexOf("=");
        if (eqIdx === -1) continue;
        const feature = directive.slice(0, eqIdx).trim();
        const value = directive.slice(eqIdx + 1).trim();
        if (value === "()" || value === "(self)" || value === "self" || value === "none") {
          restrictedCount++;
        } else if (value === "*" || value.includes("*")) {
          unrestrictedFeatures.push(feature);
        }
      }
      if (unrestrictedFeatures.length > 0) {
        findings.push({
          signal: "permissions_policy_unrestricted",
          axis: "security",
          severity: "medium",
          label: `Permissions-Policy allows unrestricted access to ${unrestrictedFeatures.join(", ")}`,
          tradeoff: null,
          weight: 2,
        });
      }
      if (restrictedCount >= 4) {
        findings.push({
          signal: "permissions_policy",
          axis: "security",
          severity: "good",
          label: `Permissions-Policy restricts ${restrictedCount} features`,
          tradeoff: null,
          weight: 2,
        });
      } else if (restrictedCount > 0 && unrestrictedFeatures.length === 0) {
        findings.push({
          signal: "permissions_policy",
          axis: "security",
          severity: "good",
          label: `Permissions-Policy restricts ${restrictedCount} feature${restrictedCount > 1 ? "s" : ""}`,
          tradeoff: null,
          weight: 2,
        });
      } else if (restrictedCount === 0 && unrestrictedFeatures.length === 0) {
        // Header present but no parseable directives — still acknowledge it
        findings.push({
          signal: "permissions_policy",
          axis: "security",
          severity: "good",
          label: "Permissions-Policy header set",
          tradeoff: null,
          weight: 1,
        });
      }
    } else {
      findings.push({
        signal: "permissions_policy_missing",
        axis: "security",
        severity: "low",
        label: "No Permissions-Policy header",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── NEW: HTTP→HTTPS Redirect ────────────────────────────────────
  if (opts.redirects.length > 0 && !opts.httpBlocked) {
    const firstUrl = opts.redirects[0]?.url ?? "";
    const lastUrl = opts.redirects[opts.redirects.length - 1]?.url ?? "";
    const startsHttp = firstUrl.startsWith("http://");
    const endsHttps = lastUrl.startsWith("https://");
    if (startsHttp && endsHttps) {
      findings.push({
        signal: "http_to_https_redirect",
        axis: "security",
        severity: "good",
        label: "HTTP→HTTPS redirect in place",
        tradeoff: null,
        weight: 3,
      });
    } else if (opts.ssl?.grade && !startsHttp) {
      // Site has SSL but we can't confirm redirect (probe may have started on HTTPS)
      // No finding — don't penalize when we can't test
    } else if (opts.ssl?.grade && startsHttp && !endsHttps) {
      findings.push({
        signal: "no_http_to_https_redirect",
        axis: "security",
        severity: contextualSeverity("low", arch, { commerce: "medium", application: "medium" }),
        label: "No HTTP→HTTPS redirect detected",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── Phase 2: Mixed Content Detection ───────────────────────────
  if (opts.html && !opts.httpBlocked && opts.ssl?.grade) {
    // Only relevant for HTTPS sites — check for http:// resources
    const httpResourcePattern = /(?:src|href)\s*=\s*["']http:\/\/(?!schema\.org|www\.w3\.org|xmlns\.com)[^"']+/gi;
    const httpResources = opts.html.match(httpResourcePattern) ?? [];
    if (httpResources.length > 0) {
      const activePattern = /<(?:script|iframe)[^>]+src\s*=\s*["']http:\/\/(?!schema\.org|www\.w3\.org)[^"']+/gi;
      const hasActive = activePattern.test(opts.html);
      if (hasActive) {
        findings.push({
          signal: "mixed_content",
          axis: "security",
          severity: contextualSeverity("medium", arch, { commerce: "high", application: "high" }),
          label: "Active mixed content — scripts or iframes loaded over HTTP",
          tradeoff: null,
          weight: 3,
        });
      } else {
        findings.push({
          signal: "mixed_content",
          axis: "security",
          severity: "low",
          label: `Passive mixed content — ${httpResources.length} resource(s) loaded over HTTP`,
          tradeoff: null,
          weight: 2,
        });
      }
    }
  }

  // ─── Phase 2: Subresource Integrity ──────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const scriptSrcPattern = /<script[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
    const domainLowerSri = opts.domain.toLowerCase();
    let thirdPartyTotal = 0;
    let thirdPartyWithSri = 0;
    let sriMatch: RegExpExecArray | null;
    while ((sriMatch = scriptSrcPattern.exec(opts.html)) !== null) {
      const src = sriMatch[1];
      try {
        const srcHost = new URL(src, `https://${opts.domain}`).hostname.toLowerCase();
        if (srcHost !== domainLowerSri && !srcHost.endsWith(`.${domainLowerSri}`)) {
          thirdPartyTotal++;
          if (/integrity\s*=\s*["']sha/i.test(sriMatch[0])) {
            thirdPartyWithSri++;
          }
        }
      } catch {
        /* skip malformed URLs */
      }
    }
    if (thirdPartyTotal === 0) {
      // No third-party scripts — better than having them with SRI
      findings.push({
        signal: "subresource_integrity",
        axis: "security",
        severity: "good",
        label: "No third-party scripts — SRI not needed",
        tradeoff: null,
        weight: 2,
      });
    } else if (thirdPartyTotal >= 3) {
      if (thirdPartyWithSri === thirdPartyTotal) {
        findings.push({
          signal: "subresource_integrity",
          axis: "security",
          severity: "good",
          label: `All ${thirdPartyTotal} third-party scripts have SRI`,
          tradeoff: null,
          weight: 2,
        });
      } else if (thirdPartyWithSri === 0) {
        findings.push({
          signal: "subresource_integrity_missing",
          axis: "security",
          severity: contextualSeverity("info", arch, { commerce: "low", application: "low" }),
          label: `${thirdPartyTotal} third-party scripts without SRI`,
          tradeoff: "SRI ensures CDN-hosted scripts haven't been tampered with.",
          weight: 1,
        });
      } else {
        findings.push({
          signal: "subresource_integrity_partial",
          axis: "security",
          severity: "info",
          label: `${thirdPartyWithSri}/${thirdPartyTotal} third-party scripts have SRI`,
          tradeoff: null,
          weight: 1,
        });
      }
    }
  }

  // ─── Phase 2: Form Action Security ──────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const formActionPattern = /<form[^>]+action\s*=\s*["']http:\/\/[^"']+["']/gi;
    const insecureForms = opts.html.match(formActionPattern) ?? [];
    if (insecureForms.length > 0) {
      findings.push({
        signal: "form_action_security",
        axis: "security",
        severity: contextualSeverity("medium", arch, { commerce: "high", application: "high" }),
        label: `${insecureForms.length} form(s) post to HTTP — data sent in plaintext`,
        tradeoff: null,
        weight: 3,
      });
    }
  }

  // CSP report-only removed — only 6 domains, zero discrimination

  // MTA-STS: handled in email auth section above (more complete, covers all states)

  // ─── Security Headers Completeness (meta-signal) ────────────────
  if (!opts.httpBlocked && opts.headers) {
    const secHeaders = [
      "strict-transport-security",
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
    ];
    const deployedCount = secHeaders.filter((h) => !!opts.headers?.[h]).length;
    const sev: Severity =
      deployedCount >= 6
        ? "good"
        : deployedCount >= 4
          ? "info"
          : deployedCount >= 2
            ? contextualSeverity("low", arch, { infrastructure: "info", content: "info" })
            : contextualSeverity("medium", arch, { infrastructure: "low", content: "low" });
    findings.push({
      signal: "security_headers_completeness",
      axis: "security",
      severity: sev,
      label: `${deployedCount}/6 security headers deployed`,
      tradeoff: null,
      weight: 2,
    });
  }

  // ─── CSP Quality Gradation ──────────────────────────────────────
  // Parse CSP directives properly to avoid false positives (e.g., unsafe-inline
  // in style-src is common and acceptable; only flag it in script-src/default-src).
  if (!opts.httpBlocked && opts.headers) {
    const cspHeader = opts.headers["content-security-policy"] ?? "";
    const cspReportOnly = opts.headers["content-security-policy-report-only"] ?? "";
    if (cspHeader) {
      // Parse directives into a map: directive-name → values string
      const directives: Record<string, string> = {};
      for (const part of cspHeader.split(";")) {
        const trimmed = part.trim();
        const spaceIdx = trimmed.indexOf(" ");
        if (spaceIdx > 0) {
          directives[trimmed.slice(0, spaceIdx).toLowerCase()] = trimmed.slice(spaceIdx + 1);
        } else if (trimmed) {
          directives[trimmed.toLowerCase()] = "";
        }
      }

      // The effective script policy comes from script-src, or falls back to default-src
      const scriptSrc = directives["script-src"] ?? directives["default-src"] ?? "";
      const hasDefaultSrc = "default-src" in directives;
      const hasScriptSrc = "script-src" in directives;
      const hasObjectSrc = "object-src" in directives;
      const hasBaseUri = "base-uri" in directives;

      // Check for dangerous patterns in the script policy only
      const scriptUnsafeInline = /('unsafe-inline'|unsafe-inline)/i.test(scriptSrc);
      const scriptUnsafeEval = /('unsafe-eval'|unsafe-eval)/i.test(scriptSrc);
      const scriptWildcard = /(?:^|\s)\*(?:\s|$)/.test(scriptSrc);

      const issues: string[] = [];
      if (scriptUnsafeInline) issues.push("'unsafe-inline' in scripts");
      if (scriptUnsafeEval) issues.push("'unsafe-eval' in scripts");
      if (scriptWildcard) issues.push("wildcard script source");

      if (issues.length > 0) {
        findings.push({
          signal: "csp_quality",
          axis: "security",
          severity: contextualSeverity("medium", arch, { content: "low", infrastructure: "low" }),
          label: `CSP present but permissive (${issues.join(", ")})`,
          tradeoff:
            "Tightening CSP may break inline scripts or third-party integrations. Consider using nonces or hashes instead of 'unsafe-inline'.",
          weight: 3,
        });
      } else if (hasDefaultSrc || hasScriptSrc) {
        findings.push({
          signal: "csp_quality",
          axis: "security",
          severity: "good",
          label: "CSP is restrictive (no unsafe-* or wildcards in script policy)",
          tradeoff: null,
          weight: 3,
        });
      } else {
        findings.push({
          signal: "csp_quality",
          axis: "security",
          severity: "info",
          label: "CSP present but missing default-src and script-src directives",
          tradeoff: null,
          weight: 2,
        });
      }

      // Missing object-src (allows Flash/plugin exploits via default-src fallback)
      if (!hasObjectSrc) {
        const defaultSrc = directives["default-src"] ?? "";
        const defaultSrcRestrictive = /('none'|'self')/i.test(defaultSrc);
        if (!defaultSrcRestrictive) {
          findings.push({
            signal: "csp_missing_object_src",
            axis: "security",
            severity: contextualSeverity("info", arch, { application: "low", commerce: "low" }),
            label: "CSP missing object-src directive (plugin injection risk)",
            tradeoff: "Add object-src 'none' to block Flash and plugin-based attacks.",
            weight: 1,
          });
        }
      }

      // Missing base-uri (allows <base> tag injection for relative URL hijacking)
      if (!hasBaseUri) {
        findings.push({
          signal: "csp_missing_base_uri",
          axis: "security",
          severity: contextualSeverity("info", arch, { application: "low" }),
          label: "CSP missing base-uri directive",
          tradeoff: "Add base-uri 'self' or 'none' to prevent <base> tag injection.",
          weight: 1,
        });
      }
    } else if (cspReportOnly && !cspHeader) {
      // Report-Only without enforcing CSP — monitoring but not protective
      findings.push({
        signal: "csp_report_only",
        axis: "security",
        severity: "info",
        label: "CSP in report-only mode (monitoring but not enforcing)",
        tradeoff: "Report-only is a good first step. Switch to enforcing mode once you've resolved violations.",
        weight: 1,
      });
    }
    // No CSP at all = skip (handled by csp_missing above)
  }

  // ─── CORS Misconfiguration Detection ────────────────────────────
  if (!opts.httpBlocked && opts.headers) {
    const acao = (opts.headers["access-control-allow-origin"] ?? "").trim();
    const acac = (opts.headers["access-control-allow-credentials"] ?? "").trim().toLowerCase();

    if (acao) {
      if (acao === "*" && acac === "true") {
        // Wildcard origin + credentials = dangerous: allows any site to make credentialed requests
        findings.push({
          signal: "cors_wildcard_credentials",
          axis: "security",
          severity: contextualSeverity("high", arch, {
            infrastructure: "critical",
            application: "critical",
            commerce: "critical",
          }),
          label: "CORS misconfiguration: wildcard origin with credentials allowed",
          tradeoff:
            "This allows any website to make authenticated requests to your API. Restrict Access-Control-Allow-Origin to specific trusted origins.",
          weight: 4,
        });
      } else if (acao === "null") {
        // null origin is exploitable via sandboxed iframes and data: URIs
        findings.push({
          signal: "cors_null_origin",
          axis: "security",
          severity: contextualSeverity("medium", arch, { application: "high", commerce: "high" }),
          label: "CORS allows null origin (exploitable via sandboxed iframes)",
          tradeoff: "The 'null' origin can be forged. Use specific origins instead.",
          weight: 2,
        });
      } else if (acao === "*") {
        // Wildcard without credentials — common for public APIs, usually intentional
        findings.push({
          signal: "cors_wildcard",
          axis: "security",
          severity: "info",
          label: "CORS allows any origin (Access-Control-Allow-Origin: *)",
          tradeoff:
            "Common for public APIs and CDN-hosted resources. Ensure no sensitive data is exposed without authentication.",
          weight: 1,
        });
      }
    }
  }

  // ─── HPKP Deprecated Header Detection ──────────────────────────
  if (!opts.httpBlocked && opts.headers) {
    const hasHpkp = !!opts.headers["public-key-pins"];
    const hasHpkpRo = !!opts.headers["public-key-pins-report-only"];
    if (hasHpkp) {
      findings.push({
        signal: "hpkp_deprecated",
        axis: "security",
        severity: "medium",
        label: "HPKP (Public-Key-Pins) is deprecated — can permanently DoS your domain",
        tradeoff:
          "Chrome removed HPKP support in 2018. If pins are rotated incorrectly, the domain becomes permanently inaccessible to pinned clients. Remove this header.",
        weight: 2,
      });
    } else if (hasHpkpRo) {
      findings.push({
        signal: "hpkp_deprecated",
        axis: "security",
        severity: "info",
        label: "HPKP-Report-Only header present (deprecated, no browsers enforce)",
        tradeoff: "Safe but useless — no browser implements HPKP anymore. Consider removing to reduce header bloat.",
        weight: 1,
      });
    }
  }

  // ─── Vulnerable JavaScript Libraries ────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const vulnResults = scanForVulnerableLibraries(opts.html);
    if (vulnResults.length > 0) {
      const hasHighSev = vulnResults.some((v) => v.severity === "high" || v.severity === "critical");
      const labels = vulnResults
        .slice(0, 3)
        .map((v) => `${v.library} ${v.version}${v.eol ? " (EOL)" : ""}${v.cves.length ? ` — ${v.cves[0]}` : ""}`);
      const extra = vulnResults.length > 3 ? ` (+${vulnResults.length - 3} more)` : "";
      findings.push({
        signal: "vulnerable_js_libraries",
        axis: "security",
        severity: vulnResults.length >= 3 ? "high" : hasHighSev ? "medium" : "medium",
        label: `Vulnerable JS: ${labels.join("; ")}${extra}`,
        tradeoff: "Upgrading libraries may require code changes for breaking API differences.",
        weight: 3,
      });
    } else {
      findings.push({
        signal: "vulnerable_js_libraries",
        axis: "security",
        severity: "good",
        label: "No known vulnerable JavaScript libraries detected",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── TLS Protocol Version ──────────────────────────────────────
  if (opts.ssl?.protocols && opts.ssl.protocols.length > 0) {
    const protocols = opts.ssl.protocols.map((p) => p.toLowerCase());
    const hasTls13 = protocols.some((p) => p.includes("1.3"));
    const hasTls12 = protocols.some((p) => p.includes("1.2"));
    const hasOldTls = protocols.some((p) => p.includes("1.0") || p.includes("1.1") || p.includes("ssl"));

    if (hasOldTls) {
      findings.push({
        signal: "tls_version",
        axis: "security",
        severity: "high",
        label: "Legacy TLS (1.0/1.1) still supported — vulnerable to downgrade attacks",
        tradeoff: "Disabling old TLS may drop support for very old clients.",
        weight: 3,
      });
    } else if (hasTls13 && !hasTls12) {
      findings.push({
        signal: "tls_version",
        axis: "security",
        severity: "good",
        label: "TLS 1.3 only — best available encryption",
        tradeoff: null,
        weight: 2,
      });
    } else if (hasTls13) {
      findings.push({
        signal: "tls_version",
        axis: "security",
        severity: "good",
        label: "TLS 1.3 + 1.2 supported",
        tradeoff: null,
        weight: 2,
      });
    } else if (hasTls12) {
      findings.push({
        signal: "tls_version",
        axis: "security",
        severity: "info",
        label: "TLS 1.2 only (no TLS 1.3)",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── HSTS Max-Age Strength ──────────────────────────────────────
  if (opts.headers && !opts.httpBlocked) {
    const hstsHeader = opts.headers["strict-transport-security"] ?? "";
    const maxAgeMatch = hstsHeader.match(/max-age\s*=\s*(\d+)/i);
    if (maxAgeMatch) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      if (maxAge >= 31536000) {
        // 1 year
        findings.push({
          signal: "hsts_max_age",
          axis: "security",
          severity: "good",
          label: `HSTS max-age ≥1 year (${Math.floor(maxAge / 86400)}d)`,
          tradeoff: null,
          weight: 1,
        });
      } else if (maxAge >= 15768000) {
        // ~6 months
        findings.push({
          signal: "hsts_max_age",
          axis: "security",
          severity: "info",
          label: `HSTS max-age ~6 months`,
          tradeoff: null,
          weight: 1,
        });
      } else if (maxAge >= 86400) {
        // 1 day
        findings.push({
          signal: "hsts_max_age",
          axis: "security",
          severity: "low",
          label: `HSTS max-age too short (${Math.floor(maxAge / 86400)}d)`,
          tradeoff: null,
          weight: 1,
        });
      } else {
        findings.push({
          signal: "hsts_max_age",
          axis: "security",
          severity: "medium",
          label: `HSTS max-age extremely short (${maxAge}s)`,
          tradeoff: null,
          weight: 2,
        });
      }
    }
  }

  // ─── Certificate Expiry Proximity ───────────────────────────────
  if (opts.ssl?.valid_to) {
    try {
      const expiryDate = new Date(opts.ssl.valid_to);
      const now = new Date();
      const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry < 1) {
        findings.push({
          signal: "cert_expiry_proximity",
          axis: "security",
          severity: "critical",
          label: "SSL certificate expired or expiring today",
          tradeoff: null,
          weight: 4,
        });
      } else if (daysUntilExpiry < 7) {
        findings.push({
          signal: "cert_expiry_proximity",
          axis: "security",
          severity: "high",
          label: `SSL certificate expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`,
          tradeoff: null,
          weight: 3,
        });
      } else if (daysUntilExpiry < 14) {
        findings.push({
          signal: "cert_expiry_proximity",
          axis: "security",
          severity: "medium",
          label: `SSL certificate expires in ${daysUntilExpiry} days`,
          tradeoff: null,
          weight: 2,
        });
      } else if (daysUntilExpiry < 30) {
        findings.push({
          signal: "cert_expiry_proximity",
          axis: "security",
          severity: "low",
          label: `SSL certificate expires in ${daysUntilExpiry} days`,
          tradeoff: null,
          weight: 2,
        });
      } else {
        findings.push({
          signal: "cert_expiry_proximity",
          axis: "security",
          severity: "good",
          label: `SSL certificate valid for ${daysUntilExpiry}+ days`,
          tradeoff: null,
          weight: 1,
        });
      }
    } catch {
      /* invalid date — skip */
    }
  }

  // ─── Cross-Origin Isolation Headers ─────────────────────────────
  if (opts.headers && !opts.httpBlocked) {
    const hasCoop = !!opts.headers["cross-origin-opener-policy"];
    const hasCoep = !!opts.headers["cross-origin-embedder-policy"];
    const hasCorp = !!opts.headers["cross-origin-resource-policy"];
    const coiCount = [hasCoop, hasCoep, hasCorp].filter(Boolean).length;
    if (coiCount === 3) {
      findings.push({
        signal: "cross_origin_isolation",
        axis: "security",
        severity: "good",
        label: "Full cross-origin isolation (COOP+COEP+CORP)",
        tradeoff: null,
        weight: 1,
      });
    } else if (coiCount >= 1) {
      findings.push({
        signal: "cross_origin_isolation",
        axis: "security",
        severity: "info",
        label: `Partial cross-origin isolation (${coiCount}/3 headers)`,
        tradeoff: null,
        weight: 1,
      });
    }
    // None = skip (too rare to penalize)
  }

  // Trust meta-signals removed — trust_strong/trust_moderate were double-counting
  // underlying signals already scored individually, inflating Reputation axis by ~15 points.
  if (opts.trustSignals) {
    // DMARC enforcement — bidirectional: reward reject, penalize weak/absent
    const dmarcRejecting = opts.trustSignals.signals.some(
      (s) => s.name === "DMARC Enforcement" && s.present && s.value?.includes("reject"),
    );
    if (dmarcRejecting) {
      findings.push({
        signal: "dmarc_reject",
        axis: "email",
        severity: "good",
        label: "DMARC policy=reject prevents email spoofing",
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.emailAuth?.dmarc?.found) {
      const policy = opts.emailAuth.dmarc.policy;
      if (policy === "quarantine") {
        findings.push({
          signal: "dmarc_reject",
          axis: "email",
          severity: "info",
          label: "DMARC policy=quarantine — partial email protection",
          tradeoff: "Upgrade to p=reject for full spoofing prevention.",
          weight: 2,
        });
      } else {
        // p=none or unrecognized
        findings.push({
          signal: "dmarc_reject",
          axis: "email",
          severity: "low",
          label: "DMARC policy=none — monitoring only, no protection",
          tradeoff: "Move to quarantine/reject once reports look clean.",
          weight: 2,
        });
      }
    } else {
      // No DMARC at all
      findings.push({
        signal: "dmarc_reject",
        axis: "email",
        severity: "medium",
        label: "No DMARC — domain vulnerable to email spoofing",
        tradeoff: null,
        weight: 2,
      });
    }

    // Operational transparency bonus
    const opsSignals = opts.trustSignals.signals.filter((s) => s.category === "operational" && s.present);
    if (opsSignals.length >= 1) {
      findings.push({
        signal: "ops_transparency",
        axis: "foundations",
        severity: "good",
        label: `${opsSignals.length} operational transparency tools (status page, monitoring, etc.)`,
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── Speed Axis Findings ───────────────────────────────────

  const perf = opts.performance; // PSI mobile (always present)
  const perfDesktop = opts.performanceDesktop; // PSI desktop (new)
  const crux = opts.crux; // CrUX field data (new)

  // Determine the primary performance score source
  // Priority: CrUX field data > blended lab > mobile-only lab
  const hasCrux = crux?.has_data;
  const hasMobile = perf && perf.score != null;
  const hasDesktop = perfDesktop && perfDesktop.score != null;

  if (hasCrux) {
    // ── CrUX field data available — use real user metrics ──
    findings.push({
      signal: "crux_field_data",
      axis: "speed",
      severity: "good",
      label: "Real-user field data available (Chrome UX Report)",
      tradeoff: null,
      weight: 1,
    });

    // Derive a synthetic performance score from CrUX p75 values using ThresholdConfig bands.
    // Each metric is resolved via resolveSeverity() then mapped to a numeric score via SEVERITY_SCORES,
    // keeping CrUX scoring aligned with the centralized threshold definitions (C9).
    const cruxScores: number[] = [];
    if (crux.lcp_p75 != null) cruxScores.push(SEVERITY_SCORES[resolveSeverity(LCP, crux.lcp_p75 / 1000).severity]);
    if (crux.fcp_p75 != null) cruxScores.push(SEVERITY_SCORES[resolveSeverity(FCP, crux.fcp_p75 / 1000).severity]);
    if (crux.cls_p75 != null) cruxScores.push(SEVERITY_SCORES[resolveSeverity(CLS, crux.cls_p75).severity]);
    if (crux.inp_p75 != null) cruxScores.push(SEVERITY_SCORES[resolveSeverity(INP, crux.inp_p75).severity]);
    if (crux.ttfb_p75 != null) cruxScores.push(SEVERITY_SCORES[resolveSeverity(TTFB, crux.ttfb_p75).severity]);

    if (cruxScores.length > 0) {
      const avgScore = Math.round(cruxScores.reduce((a, b) => a + b, 0) / cruxScores.length);
      const ps = resolveSeverity(PERF_SCORE, avgScore);
      const psSev =
        avgScore >= 80 ? ps.severity : contextualSeverity(ps.severity, arch, avgScore >= 50 ? { content: "high" } : {});
      findings.push({
        signal: PERF_SCORE.signal,
        axis: "speed",
        severity: psSev,
        label: `Performance score ${avgScore}/100 (field data)`,
        tradeoff: null,
        weight: PERF_SCORE.weight,
        source: "Chrome UX Report (real users)",
      });
    }

    // Individual CrUX metrics
    if (crux.lcp_p75 != null) {
      const lcpSec = crux.lcp_p75 / 1000;
      const lcp = resolveSeverity(LCP, lcpSec);
      findings.push({
        signal: LCP.signal,
        axis: "speed",
        severity: lcp.severity,
        label: `LCP: ${lcpSec.toFixed(1)}s (p75 field)`,
        tradeoff: null,
        weight: LCP.weight,
        source: "CrUX",
      });
    }
    if (crux.cls_p75 != null) {
      const cls = resolveSeverity(CLS, crux.cls_p75);
      findings.push({
        signal: CLS.signal,
        axis: "speed",
        severity: cls.severity,
        label: `CLS: ${crux.cls_p75.toFixed(3)} (p75 field)`,
        tradeoff: null,
        weight: CLS.weight,
        source: "CrUX",
      });
    }
    if (crux.ttfb_p75 != null) {
      const ttfb = resolveSeverity(TTFB, crux.ttfb_p75);
      findings.push({
        signal: TTFB.signal,
        axis: "speed",
        severity: ttfb.severity,
        label: `TTFB: ${Math.round(crux.ttfb_p75)}ms (p75 field)`,
        tradeoff: null,
        weight: TTFB.weight,
        source: "CrUX",
      });
    }
    if (crux.fcp_p75 != null) {
      const fcpSec = crux.fcp_p75 / 1000;
      const fcpResult = resolveSeverity(FCP, fcpSec);
      findings.push({
        signal: FCP.signal,
        axis: "speed",
        severity: fcpResult.severity,
        label: `FCP: ${fcpSec.toFixed(1)}s (p75 field)`,
        tradeoff: null,
        weight: FCP.weight,
        source: "CrUX",
      });
    }
    if (crux.inp_p75 != null) {
      // INP (Interaction to Next Paint) — Core Web Vital, only from CrUX
      const inpResult = resolveSeverity(INP, crux.inp_p75);
      findings.push({
        signal: INP.signal,
        axis: "speed",
        severity: inpResult.severity,
        label: `INP: ${Math.round(crux.inp_p75)}ms (p75 field)`,
        tradeoff: null,
        weight: INP.weight,
        source: "CrUX — Interaction to Next Paint",
      });
    }
  } else if (hasMobile || hasDesktop) {
    // ── No CrUX — use lab data ──
    // Blend mobile (60%) + desktop (40%) — mobile-first to match Google's ranking
    // and the reality that 60%+ of web traffic is mobile
    let blendedScore: number;
    let sourceLabel: string;
    if (hasMobile && hasDesktop) {
      blendedScore = Math.round((perf?.score ?? 0) * 0.6 + (perfDesktop?.score ?? 0) * 0.4);
      sourceLabel = "Lighthouse lab (mobile 60% + desktop 40%)";
    } else if (hasMobile) {
      blendedScore = perf?.score ?? 0;
      sourceLabel = "Lighthouse lab (mobile)";
    } else {
      blendedScore = perfDesktop?.score ?? 0;
      sourceLabel = "Lighthouse lab (desktop)";
    }

    const ps = resolveSeverity(PERF_SCORE, blendedScore);
    const psSev =
      blendedScore >= 80
        ? ps.severity
        : contextualSeverity(ps.severity, arch, blendedScore >= 50 ? { content: "high" } : {});
    findings.push({
      signal: PERF_SCORE.signal,
      axis: "speed",
      severity: psSev,
      label: `Performance score ${blendedScore}/100`,
      tradeoff: null,
      weight: PERF_SCORE.weight,
      source: sourceLabel,
    });

    // Use mobile metrics as primary when available (mobile-first), fallback to desktop
    const primaryPerf = hasMobile ? perf! : perfDesktop!;

    // LCP
    if (primaryPerf.lcp != null) {
      const lcpSec = primaryPerf.lcp / 1000;
      const lcp = resolveSeverity(LCP, lcpSec);
      findings.push({
        signal: LCP.signal,
        axis: "speed",
        severity: lcp.severity,
        label: `LCP: ${lcpSec.toFixed(1)}s`,
        tradeoff: null,
        weight: LCP.weight,
        source: LCP.source,
      });
    }

    // CLS
    if (primaryPerf.cls != null) {
      const cls = resolveSeverity(CLS, primaryPerf.cls);
      findings.push({
        signal: CLS.signal,
        axis: "speed",
        severity: cls.severity,
        label: `CLS: ${primaryPerf.cls.toFixed(3)}`,
        tradeoff: null,
        weight: CLS.weight,
        source: CLS.source,
      });
    }

    // TTFB
    if (primaryPerf.ttfb != null) {
      const ttfb = resolveSeverity(TTFB, primaryPerf.ttfb);
      findings.push({
        signal: TTFB.signal,
        axis: "speed",
        severity: ttfb.severity,
        label: `TTFB: ${Math.round(primaryPerf.ttfb)}ms`,
        tradeoff: null,
        weight: TTFB.weight,
        source: TTFB.source,
      });
    }

    // TBT (Total Blocking Time) — JS execution blocking metric (lab only)
    if (primaryPerf.tbt != null) {
      const tbtResult = resolveSeverity(TBT, primaryPerf.tbt);
      findings.push({
        signal: TBT.signal,
        axis: "speed",
        severity: tbtResult.severity,
        label: tbtResult.label,
        tradeoff: null,
        weight: TBT.weight,
        source: TBT.source,
      });
    }

    // FCP (First Contentful Paint) — initial rendering speed
    if (primaryPerf.fcp != null) {
      const fcpSec = primaryPerf.fcp / 1000;
      const fcpResult = resolveSeverity(FCP, fcpSec);
      findings.push({
        signal: FCP.signal,
        axis: "speed",
        severity: fcpResult.severity,
        label: `FCP: ${fcpSec.toFixed(1)}s`,
        tradeoff: null,
        weight: FCP.weight,
        source: FCP.source,
      });
    }
  } else if (perf?.error) {
    // PageSpeed unavailable — don't penalize, but acknowledge the gap
    // This prevents score inflation when PageSpeed data is missing
    findings.push({
      signal: "pagespeed_unavailable",
      axis: "speed",
      severity: "low",
      label: "PageSpeed Insights unavailable",
      tradeoff: null,
      weight: 2,
    });
  }

  // Compression — removed: 275/275 = good, zero discrimination
  // Keep no_compression penalty only
  if (opts.compression) {
    if (!opts.compression.encoding && !opts.httpBlocked) {
      findings.push({
        signal: "no_compression",
        axis: "speed",
        severity: "low",
        label: "No compression detected",
        tradeoff:
          "Compression check is header-based and may not reflect actual server behavior (e.g., Cloudflare decompresses for Workers).",
        weight: 1,
      });
    }
  }

  // Cache headers
  if (opts.cacheAnalysis && !opts.httpBlocked) {
    const cv = opts.cacheAnalysis.verdict;
    if (cv === "excellent" || cv === "good") {
      findings.push({
        signal: "cache_headers",
        axis: "speed",
        severity: "good",
        label: opts.cacheAnalysis.verdict_label,
        tradeoff: null,
        weight: 3,
      });
    } else if (cv === "fair") {
      findings.push({
        signal: "cache_headers",
        axis: "speed",
        severity: "info",
        label: opts.cacheAnalysis.verdict_label,
        tradeoff: null,
        weight: 3,
      });
    } else if (cv === "poor") {
      findings.push({
        signal: "cache_headers",
        axis: "speed",
        severity: contextualSeverity("low", arch, { commerce: "medium", content: "medium" }),
        label: opts.cacheAnalysis.verdict_label,
        tradeoff: "Aggressive caching may serve stale content to users.",
        weight: 3,
      });
    } else if (cv === "none") {
      findings.push({
        signal: "cache_headers",
        axis: "speed",
        severity: contextualSeverity("low", arch, { commerce: "medium", content: "medium" }),
        label: "No cache headers — browsers use heuristic caching",
        tradeoff: null,
        weight: 3,
      });
    }
  }

  // HTTP/2 and HTTP/3 are independent signals — a site can (and usually does) support both
  if (opts.httpProtocols) {
    if (opts.httpProtocols.http2 || opts.httpProtocols.http3) {
      // HTTP/3 implies HTTP/2 fallback; emit both when either is true
      findings.push({
        signal: "http2",
        axis: "foundations",
        severity: "good",
        label: "HTTP/2 supported",
        tradeoff: null,
        weight: 2,
      });
      if (opts.httpProtocols.http3) {
        findings.push({
          signal: "http3",
          axis: "foundations",
          severity: "good",
          label: "HTTP/3 supported",
          tradeoff: null,
          weight: 1,
        });
      }
    } else {
      findings.push({
        signal: "http1_only",
        axis: "foundations",
        severity: "medium",
        label: "HTTP/1.1 only",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // CDN
  if (opts.hosting?.cdn) {
    findings.push({
      signal: "cdn",
      axis: "foundations",
      severity: "good",
      label: `CDN: ${opts.hosting.cdn}`,
      tradeoff: null,
      weight: 3,
    });
  }

  // Asset CDN — fires as good if detected without full-site CDN,
  // or as info if full-site CDN already covers asset delivery
  if (opts.assetCdn?.detected && !opts.hosting?.cdn) {
    const providerNames = opts.assetCdn.providers.map((p) => p.name).join(", ");
    findings.push({
      signal: "asset_cdn",
      axis: "speed",
      severity: "good",
      label: providerNames ? `Assets served via CDN: ${providerNames}` : "Assets served via CDN subdomain",
      tradeoff: null,
      weight: 2,
    });
  } else if (opts.hosting?.cdn) {
    // Full-site CDN already covers asset delivery — mark as info so it's
    // excluded from the absent-signal penalty pool
    findings.push({
      signal: "asset_cdn",
      axis: "speed",
      severity: "info",
      label: `Asset delivery covered by ${opts.hosting.cdn}`,
      tradeoff: null,
      weight: 0,
    });
  }

  // ─── NEW: Redirect Chain Length ──────────────────────────────────
  if (opts.redirects.length > 0) {
    const hops = opts.redirects.length;
    if (hops >= 4) {
      findings.push({
        signal: "redirect_chain_length",
        axis: "speed",
        severity: "medium",
        label: `${hops} redirect hops — excessive latency`,
        tradeoff: null,
        weight: 2,
      });
    } else if (hops >= 2) {
      findings.push({
        signal: "redirect_chain_length",
        axis: "speed",
        severity: "info",
        label: `${hops} redirect hops`,
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Foundations Axis Findings ───────────────────────────────────

  const dns = opts.dnsRecords;

  // NS count (informational only — 2 is the registrar-enforced minimum per RFC 1035)
  const nsCount = dns.filter((r) => r.type === "NS").length;
  findings.push({
    signal: "ns_redundancy",
    axis: "foundations",
    severity: "good",
    label: `${nsCount} nameserver${nsCount !== 1 ? "s" : ""}`,
    tradeoff: null,
    weight: 0,
  });

  // MX records
  const mxCount = dns.filter((r) => r.type === "MX").length;
  if (mxCount >= 2) {
    findings.push({
      signal: "mx_redundancy",
      axis: "email",
      severity: "good",
      label: `${mxCount} MX records (redundant email delivery)`,
      tradeoff: null,
      weight: 2,
    });
  } else if (mxCount === 1) {
    findings.push({
      signal: "mx_redundancy",
      axis: "email",
      severity: "info",
      label: "1 MX record (no redundancy)",
      tradeoff: null,
      weight: 2,
    });
  } else {
    // No MX records — only penalize if domain appears to send email (has SPF or DMARC)
    const hasEmailAuth = opts.emailAuth?.spf?.found || opts.emailAuth?.dmarc?.found;
    if (hasEmailAuth) {
      findings.push({
        signal: "mx_redundancy",
        axis: "email",
        severity: "medium",
        label: "No MX records despite having email authentication — relies on A record fallback",
        tradeoff: "Add MX records pointing to your mail server.",
        weight: 2,
      });
    }
  }

  // IPv6 — informational only, IPv4-only sites are fully reachable
  const hasIpv6 = dns.some((r) => r.type === "AAAA");
  findings.push({
    signal: "ipv6",
    axis: "foundations",
    severity: hasIpv6 ? "good" : "info",
    label: hasIpv6 ? "IPv6 supported" : "No IPv6 (AAAA) records",
    tradeoff: null,
    weight: 1,
  });

  // Multiple A records (DNS redundancy) — IP-level resilience indicator
  const aCount = dns.filter((r) => r.type === "A").length;
  if (aCount >= 2) {
    findings.push({
      signal: "lb",
      axis: "foundations",
      severity: "good",
      label: `DNS redundancy (${aCount} A records)`,
      tradeoff: null,
      weight: 1,
    });
  }

  // CAA records
  const hasCaa = dns.some((r) => r.type === "CAA");
  findings.push({
    signal: "caa",
    axis: "foundations",
    severity: hasCaa ? "good" : "info",
    label: hasCaa ? "CAA records present" : "No CAA records",
    tradeoff: null,
    weight: 1,
  });

  // DNS TTL health — very low TTLs may indicate instability or aggressive failover
  const aRecords = dns.filter((r) => r.type === "A" || r.type === "AAAA");
  if (aRecords.length > 0) {
    const minTtl = Math.min(...aRecords.map((r) => r.ttl));
    if (minTtl < 60) {
      findings.push({
        signal: "low_ttl",
        axis: "foundations",
        severity: "info",
        label: `Low DNS TTL (${minTtl}s) — high resolver query volume`,
        tradeoff: "Low TTLs increase DNS query volume. Only beneficial with DNS-based failover or traffic management.",
        weight: 1,
      });
    }
    // stable_ttl removed — only 24 domains, good-only, no discrimination
  }

  // soa_present removed — 361/361 = good, every domain has SOA, zero discrimination

  // ─── TCP Connection Time ────────────────────────────────────────
  // Note: timing measured from a single probe location; distance to server affects results
  if (opts.networkHealth?.connection_timing) {
    const tcpMs = opts.networkHealth.connection_timing.tcp_ms;
    if (tcpMs < 300) {
      findings.push({
        signal: "tcp_connection_time",
        axis: "foundations",
        severity: "good",
        label: `TCP connect: ${Math.round(tcpMs)}ms`,
        tradeoff: null,
        weight: 2,
      });
    } else if (tcpMs < 500) {
      findings.push({
        signal: "tcp_connection_time",
        axis: "foundations",
        severity: "info",
        label: `TCP connect: ${Math.round(tcpMs)}ms`,
        tradeoff: null,
        weight: 2,
      });
    } else if (tcpMs < 1000) {
      findings.push({
        signal: "tcp_connection_time",
        axis: "foundations",
        severity: "low",
        label: `TCP connect: ${Math.round(tcpMs)}ms — above average`,
        tradeoff: "Connection timing depends on server location relative to probe.",
        weight: 2,
      });
    } else {
      findings.push({
        signal: "tcp_connection_time",
        axis: "foundations",
        severity: "medium",
        label: `TCP connect: ${Math.round(tcpMs)}ms — very slow`,
        tradeoff: "Connection timing depends on server location relative to probe.",
        weight: 2,
      });
    }
  }

  // ─── DNS Resolution Time ────────────────────────────────────────
  // Note: timing measured from a single probe location
  if (opts.networkHealth?.connection_timing) {
    const dnsMs = opts.networkHealth.connection_timing.dns_ms;
    if (dnsMs < 100) {
      findings.push({
        signal: "dns_resolution_time",
        axis: "foundations",
        severity: "good",
        label: `DNS resolution: ${Math.round(dnsMs)}ms`,
        tradeoff: null,
        weight: 2,
      });
    } else if (dnsMs < 200) {
      findings.push({
        signal: "dns_resolution_time",
        axis: "foundations",
        severity: "info",
        label: `DNS resolution: ${Math.round(dnsMs)}ms`,
        tradeoff: null,
        weight: 2,
      });
    } else if (dnsMs < 500) {
      findings.push({
        signal: "dns_resolution_time",
        axis: "foundations",
        severity: "low",
        label: `DNS resolution: ${Math.round(dnsMs)}ms — slow`,
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "dns_resolution_time",
        axis: "foundations",
        severity: "medium",
        label: `DNS resolution: ${Math.round(dnsMs)}ms — very slow`,
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── NS Provider Diversity ──────────────────────────────────────
  {
    const nsRecords = dns.filter((r) => r.type === "NS").map((r) => r.data);
    if (nsRecords.length >= 2) {
      const nsDiversity = analyzeNsDiversity(nsRecords);
      if (nsDiversity.isMultiProvider) {
        findings.push({
          signal: "ns_provider_diversity",
          axis: "foundations",
          severity: "good",
          label: `Multi-provider DNS (${nsDiversity.providers.join(", ")})`,
          tradeoff: null,
          weight: 1,
        });
      }
      // Single provider = no finding. Major providers (Cloudflare, Google, AWS Route53)
      // run massive anycast networks — single provider doesn't imply single point of failure.
      // Unrecognized providers = skip
    }
  }

  // ─── NEW: Site Unreachable ───────────────────────────────────────
  // DNS resolves but no HTTP server responds — fundamentally broken
  const dnsResolves = dns.some((r) => r.type === "A" || r.type === "AAAA");
  if (opts.statusResult) {
    if (!opts.statusResult.is_up && dnsResolves && !opts.statusResult.http_blocked) {
      findings.push({
        signal: "site_unreachable",
        axis: "foundations",
        severity: "high",
        label: "Site unreachable — DNS resolves but no HTTP response",
        tradeoff: null,
        weight: 5,
      });
      // Also tank Discoverability — an unreachable site has zero web visibility
      findings.push({
        signal: "site_unreachable_visibility",
        axis: "discoverability",
        severity: "critical",
        label: "Site unreachable — zero web visibility",
        tradeoff: null,
        weight: 5,
      });
      // Also tank Speed — cannot measure performance of an unreachable site
      findings.push({
        signal: "site_unreachable_performance",
        axis: "speed",
        severity: "critical",
        label: "Site unreachable — cannot measure performance",
        tradeoff: null,
        weight: 5,
      });
    }
  }

  // ─── HTTP Blocked (RESTRICTED) — analysis is incomplete ──────────
  // The site is up but blocked our probe, so we can't assess headers, content, etc.
  if (opts.statusResult?.http_blocked) {
    findings.push({
      signal: "http_blocked_infrastructure",
      axis: "foundations",
      severity: "info",
      label: "HTTP probe blocked — analysis is limited",
      tradeoff: "Site may be blocking automated requests. Scoring is based on DNS/WHOIS/SSL data only.",
      weight: 0,
    });
    // Can't trust performance data if we couldn't fetch the page
    if (!opts.performance) {
      findings.push({
        signal: "http_blocked_performance",
        axis: "speed",
        severity: "info",
        label: "Cannot measure performance — HTTP blocked",
        tradeoff: null,
        weight: 0,
      });
    }
    // Security headers are unknown
    findings.push({
      signal: "http_blocked_security",
      axis: "security",
      severity: "info",
      label: "Security headers unknown — HTTP blocked",
      tradeoff: "Cannot audit CSP, HSTS, or other headers without HTTP access.",
      weight: 0,
    });
  }

  // ─── NEW: HTTP Error Response ────────────────────────────────────
  // Server responds but with error codes
  if (opts.statusResult && opts.statusResult.status_code != null && opts.statusResult.status_code >= 400) {
    const code = opts.statusResult.status_code;
    const isWafBlock = (code === 403 || code === 429) && opts.waf?.detected;
    if (!isWafBlock) {
      if (code >= 500) {
        findings.push({
          signal: "http_error_response",
          axis: "foundations",
          severity: "medium",
          label: `Server error (HTTP ${code})`,
          tradeoff: null,
          weight: 2,
        });
      } else {
        findings.push({
          signal: "http_error_response",
          axis: "foundations",
          severity: "low",
          label: `Client error response (HTTP ${code})`,
          tradeoff: "Some sites return 4xx to automated probes while working fine in browsers.",
          weight: 1,
        });
      }
    }
  }

  // ─── Reputation Axis Findings ─────────────────────────────────────────

  // Domain age (trust signal — graduated thresholds, 5yr+ for "good")
  // Palo Alto: ≤32d = NRD; CF Email: 7d malicious, 30-45d suspicious; NextDNS: 30d block
  const ageDays = opts.rdap?.domain_age_days;
  if (ageDays != null) {
    const severity =
      ageDays > 365 * 5
        ? "good"
        : ageDays > 365 * 3
          ? "info"
          : ageDays > 365
            ? "low"
            : ageDays > 90
              ? "medium"
              : ageDays > 30
                ? "medium"
                : "high";
    const label =
      ageDays > 365 * 5
        ? `Established domain (${Math.floor(ageDays / 365)}+ years)`
        : ageDays > 365 * 3
          ? `Mature domain (${Math.floor(ageDays / 365)}+ years)`
          : ageDays > 365
            ? `Domain age: ${Math.floor(ageDays / 365)}+ years`
            : ageDays > 90
              ? `Young domain (${ageDays} days)`
              : ageDays > 30
                ? `Recently registered (${ageDays} days)`
                : `Newly registered domain (${ageDays} days) — high risk NRD`;
    findings.push({
      signal: "domain_age_trust",
      axis: "reputation",
      severity,
      label,
      tradeoff: null,
      weight: 4,
    });
  }

  // Registration length remaining — 1 year is normal/neutral, only reward long or flag near-expiry
  const expiryDays = opts.rdap?.days_until_expiry;
  if (expiryDays != null) {
    const years = Math.floor(expiryDays / 365);
    findings.push({
      signal: "registration_length",
      axis: "reputation",
      severity: expiryDays > 365 ? "good" : expiryDays > 90 ? "info" : expiryDays > 30 ? "low" : "medium",
      label:
        expiryDays > 730
          ? `Registration good for ${years}+ years`
          : expiryDays > 365
            ? `Registration renewed (${expiryDays} days remaining)`
            : expiryDays > 90
              ? `Expires in ${expiryDays} days`
              : `Expiring soon (${expiryDays} days)`,
      tradeoff: null,
      weight: 2,
    });
  }

  // Blocklist clean (also trust) — clean record is a positive; listed is critical
  if (listedCount === 0) {
    findings.push({
      signal: "blocklist_trust",
      axis: "reputation",
      severity: "good",
      label: "Clean blocklist record",
      tradeoff: null,
      weight: 3,
    });
  } else {
    findings.push({
      signal: "blocklist_trust",
      axis: "reputation",
      severity: listedCount >= 2 ? "critical" : "high",
      label: `On ${listedCount} blocklist(s)`,
      tradeoff: null,
      weight: 3,
    });
  }

  // GreyNoise — skip when behind known CDN (shared IP doesn't reflect domain trust)
  if (opts.greynoise) {
    const isBehindCdn = !!opts.hosting?.cdn;
    if (opts.greynoise.noise && !isBehindCdn) {
      findings.push({
        signal: "greynoise_noise",
        axis: "reputation",
        severity: "medium",
        label: "IP flagged as internet noise by GreyNoise",
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.greynoise.noise && isBehindCdn) {
      // CDN IP noise is about the shared infrastructure, not this domain
      findings.push({
        signal: "greynoise_noise",
        axis: "reputation",
        severity: "info",
        label: `IP flagged as noise by GreyNoise (shared CDN IP: ${opts.hosting?.cdn})`,
        tradeoff: "GreyNoise noise on CDN IPs reflects shared infrastructure, not this domain.",
        weight: 1,
      });
    } else if (opts.greynoise.riot && !isBehindCdn) {
      findings.push({
        signal: "greynoise_riot",
        axis: "reputation",
        severity: "good",
        label: "IP is a known service (GreyNoise RIOT)",
        tradeoff: null,
        weight: 2,
      });
    }
    // RIOT on CDN = skip (every Cloudflare domain would get a free trust bonus)
  }

  // Data breaches (HIBP) — major trust signal with time decay
  // Breaches lose relevance over time as organizations remediate and rebuild.
  if (opts.breaches?.found && !opts.breaches.check_failed) {
    const bc = opts.breaches.count;
    const hasVerified = opts.breaches.items.some((b) => b.is_verified);

    // Apply time decay based on breach age
    // < 1 year: 1.0×, 1-3 years: 0.75×, 3-5 years: 0.50×, 5-10 years: 0.25×, > 10 years: 0.10×
    const now = new Date();
    let weightedPwned = 0;
    let recentBreachCount = 0; // breaches < 3 years old
    for (const breach of opts.breaches.items) {
      const breachDate = breach.breach_date ? new Date(breach.breach_date) : null;
      const ageYears = breachDate ? (now.getTime() - breachDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000) : null;
      // Unknown-date breaches get 0.5× — most missing dates are older breaches; 0.5 balances uncertainty.
      const decay =
        ageYears == null
          ? 0.5
          : ageYears > 10
            ? 0.1
            : ageYears > 5
              ? 0.25
              : ageYears > 3
                ? 0.5
                : ageYears > 1
                  ? 0.75
                  : 1.0;
      weightedPwned += (breach.pwn_count ?? 0) * decay;
      if (ageYears != null && ageYears < 3) recentBreachCount++;
    }

    if (weightedPwned > 10_000_000) {
      findings.push({
        signal: "breaches",
        axis: "reputation",
        severity: "high",
        label: `${bc} data breach${bc !== 1 ? "es" : ""} (~${(weightedPwned / 1_000_000).toFixed(0)}M weighted accounts)`,
        tradeoff:
          "Historical breaches reflect past security incidents, not necessarily current posture. Older breaches are weighted lower.",
        weight: 4,
      });
    } else if (weightedPwned > 1_000_000 || (bc >= 3 && hasVerified)) {
      findings.push({
        signal: "breaches",
        axis: "reputation",
        severity: "medium",
        label: `${bc} data breach${bc !== 1 ? "es" : ""} (~${Math.round(weightedPwned).toLocaleString()} weighted accounts)`,
        tradeoff:
          "Historical breaches reflect past security incidents, not necessarily current posture. Older breaches are weighted lower.",
        weight: 3,
      });
    } else if (bc >= 1 && hasVerified) {
      findings.push({
        signal: "breaches",
        axis: "reputation",
        severity: "low",
        label: `${bc} verified data breach${bc !== 1 ? "es" : ""}`,
        tradeoff: "Historical breaches reflect past security incidents, not necessarily current posture.",
        weight: 2,
      });
    } else if (bc >= 1) {
      findings.push({
        signal: "breaches",
        axis: "reputation",
        severity: "info",
        label: `${bc} unverified data breach report${bc !== 1 ? "s" : ""}`,
        tradeoff: null,
        weight: 1,
      });
    }

    // Store recentBreachCount for grade cap logic below
    opts._recentBreachCount = recentBreachCount;
    opts._weightedPwned = weightedPwned;
  }

  // Tranco web ranking — popularity/reputation signal
  if (opts.trancoRank != null) {
    if (opts.trancoRank <= 1000) {
      findings.push({
        signal: "tranco_rank",
        axis: "reputation",
        severity: "good",
        label: `Tranco top 1K (#${opts.trancoRank.toLocaleString()})`,
        tradeoff: null,
        weight: 3,
      });
    } else if (opts.trancoRank <= 10000) {
      findings.push({
        signal: "tranco_rank",
        axis: "reputation",
        severity: "good",
        label: `Tranco top 10K (#${opts.trancoRank.toLocaleString()})`,
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.trancoRank <= 100000) {
      findings.push({
        signal: "tranco_rank",
        axis: "reputation",
        severity: "info",
        label: `Tranco top 100K (#${opts.trancoRank.toLocaleString()})`,
        tradeoff: null,
        weight: 1,
      });
    }
    // Unranked = no finding (neutral, no penalty)
  } else {
    // No Tranco rank — neutral, no penalty (most legitimate domains aren't top 1M)
  }

  // Email auth completeness (trust signal — penalty-only; email_auth handles the reward)
  if (opts.emailAuth) {
    const hasSpf = opts.emailAuth.spf.found;
    const hasDmarc = opts.emailAuth.dmarc.found;
    const hasDkim = opts.emailAuth.dkim_selectors_found.length > 0;
    const complete = hasSpf && hasDmarc && hasDkim;
    if (!complete) {
      if (!hasSpf && !hasDmarc && !hasDkim) {
        findings.push({
          signal: "email_trust",
          axis: "email",
          severity: "high",
          label: "No email authentication (missing SPF, DKIM, DMARC)",
          tradeoff: null,
          weight: 1,
        });
      } else {
        const missing: string[] = [];
        if (!hasSpf) missing.push("SPF");
        // DKIM absence is too noisy for Trust axis too — external detection is limited.
        // Only flag SPF and DMARC absence in Trust.
        if (!hasDmarc) missing.push("DMARC");
        if (missing.length > 0) {
          findings.push({
            signal: "email_trust",
            axis: "email",
            severity: "medium",
            label: `Incomplete email auth (missing ${missing.join(", ")})`,
            tradeoff: null,
            weight: 1,
          });
        } else {
          // Only DKIM missing — treat as mostly complete
          findings.push({
            signal: "email_trust",
            axis: "email",
            severity: "info",
            label: "Email auth present (SPF + DMARC) — DKIM not externally detected",
            tradeoff: null,
            weight: 1,
          });
        }
      }
    }
  }

  // ─── NEW: security.txt Trust Signal ──────────────────────────────
  if (opts.securityTxt) {
    if (opts.securityTxt.found && opts.securityTxt.has_bug_bounty) {
      findings.push({
        signal: "security_txt",
        axis: "security",
        severity: "good",
        label: `security.txt with bug bounty${opts.securityTxt.bug_bounty_platform ? ` (${opts.securityTxt.bug_bounty_platform})` : ""}`,
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.securityTxt.found) {
      findings.push({
        signal: "security_txt",
        axis: "security",
        severity: "good",
        label: "security.txt present (responsible disclosure)",
        tradeoff: null,
        weight: 1,
      });
    }
    // Absent = no finding (don't penalize for absence of nice-to-have)
  }

  // ─── Phase 3: BIMI Record (email brand identity) ────────────────
  if (opts.emailAuth?.bimi?.found) {
    const hasVmc = !!opts.emailAuth.bimi.authority_url;
    findings.push({
      signal: "bimi_record",
      axis: "email",
      severity: "good",
      label: hasVmc
        ? "BIMI record with VMC — verified brand logo in email clients"
        : "BIMI record present — email brand verification",
      tradeoff: null,
      weight: 2,
    });
  }

  // dmarc_policy_strength removed — now handled by bidirectional dmarc_reject signal above

  // ─── Phase 3: ads.txt (publisher transparency) ──────────────────
  if (opts.wellKnown && arch === "content") {
    const hasAdsTxt = opts.wellKnown.endpoints.some((e) => e.path.includes("ads.txt") && e.found);
    if (hasAdsTxt) {
      findings.push({
        signal: "ads_txt",
        axis: "reputation",
        severity: "good",
        label: "ads.txt present — authorized ad sellers declared",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // wayback removed — weight=0 dead code, no scoring impact

  // ─── EV/OV Certificate Detection (Trust) ────────────────────────
  if (opts.ssl?.subject) {
    const sslSubject = opts.ssl.subject;
    const hasOrg = /,?\s*O\s*=/.test(sslSubject);
    const isEV =
      hasOrg &&
      (/SERIALNUMBER\s*=/.test(sslSubject) ||
        /2\.5\.4\.15/.test(sslSubject) ||
        /1\.3\.6\.1\.4\.1\.311\.60\.2\.1/.test(sslSubject));
    const orgMatch = sslSubject.match(/,?\s*O\s*=\s*([^,]+)/);
    const orgName = orgMatch ? orgMatch[1].replace(/\\+/g, "").trim() : null;
    if (isEV && orgName) {
      findings.push({
        signal: "cert_validation_type",
        axis: "foundations",
        severity: "good",
        label: `Extended Validation (EV) certificate — ${orgName}`,
        tradeoff: null,
        weight: 3,
      });
    } else if (hasOrg && orgName) {
      findings.push({
        signal: "cert_validation_type",
        axis: "foundations",
        severity: "good",
        label: `Organization Validated (OV) certificate — ${orgName}`,
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "cert_validation_type",
        axis: "foundations",
        severity: "info",
        label: "Domain Validated (DV) certificate only",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Organizational Identity (Trust) ────────────────────────────
  if (opts.legal && !opts.httpBlocked) {
    const pages = opts.legal.pages_found ?? [];
    const hasPrivacy = pages.some((p: any) => /privacy/i.test(p.name ?? p));
    const hasTerms = pages.some((p: any) => /terms|tos|conditions/i.test(p.name ?? p));
    const hasAbout = pages.some((p: any) => /about|company|team/i.test(p.name ?? p));
    const orgCount = [hasPrivacy, hasTerms, hasAbout].filter(Boolean).length;
    if (orgCount >= 3) {
      findings.push({
        signal: "organizational_identity",
        axis: "reputation",
        severity: "good",
        label: "Privacy policy, terms, and about page found",
        tradeoff: null,
        weight: 3,
      });
    } else if (orgCount >= 1) {
      const missing: string[] = [];
      if (!hasPrivacy) missing.push("privacy policy");
      if (!hasTerms) missing.push("terms of service");
      if (!hasAbout) missing.push("about page");
      findings.push({
        signal: "organizational_identity",
        axis: "reputation",
        severity: "info",
        label: `${orgCount}/3 organizational pages found (missing: ${missing.join(", ")})`,
        tradeoff: null,
        weight: 3,
      });
    } else {
      findings.push({
        signal: "organizational_identity",
        axis: "reputation",
        severity: "low",
        label: "No organizational identity pages (privacy, terms, about)",
        tradeoff: null,
        weight: 3,
      });
    }
  }

  // ─── Cookie Consent Bidirectional (Trust) ───────────────────────
  if (opts.cookieConsent && !opts.httpBlocked) {
    if (!opts.cookieConsent.cmp_detected && opts.cookieSecurity && opts.cookieSecurity.cookies.length > 0) {
      // Has cookies but no consent management = mild trust concern
      findings.push({
        signal: "cookie_consent_missing",
        axis: "reputation",
        severity: "low",
        label: `${opts.cookieSecurity.cookies.length} cookies set without consent management`,
        tradeoff: null,
        weight: 2,
      });
    }
    // CMP detected is already scored as cookie_consent_cmp above
  }

  // ─── Discoverability Axis Findings ────────────────────────────────────

  // Domain popularity (Tranco rank) — direct visibility measure
  if (opts.trancoRank != null) {
    if (opts.trancoRank <= 1000) {
      findings.push({
        signal: "domain_popularity",
        axis: "discoverability",
        severity: "good",
        label: `Tranco top 1K (#${opts.trancoRank.toLocaleString()}) — elite web presence`,
        tradeoff: null,
        weight: 3,
      });
    } else if (opts.trancoRank <= 10000) {
      findings.push({
        signal: "domain_popularity",
        axis: "discoverability",
        severity: "good",
        label: `Tranco top 10K (#${opts.trancoRank.toLocaleString()}) — high traffic`,
        tradeoff: null,
        weight: 2,
      });
    } else if (opts.trancoRank <= 100000) {
      findings.push({
        signal: "domain_popularity",
        axis: "discoverability",
        severity: "info",
        label: `Tranco top 100K (#${opts.trancoRank.toLocaleString()})`,
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "domain_popularity",
        axis: "discoverability",
        severity: "low",
        label: `Tranco rank #${opts.trancoRank.toLocaleString()} — low traffic`,
        tradeoff: null,
        weight: 1,
      });
    }
  } else {
    findings.push({
      signal: "domain_popularity",
      axis: "discoverability",
      severity: "info",
      label: "Not ranked in Tranco top 1M",
      tradeoff: null,
      weight: 1,
    });
  }

  // Structured data
  const jsonLdTypes = (opts.jsonLd ?? []).map((j) => j.type);
  if (jsonLdTypes.length > 0) {
    findings.push({
      signal: "structured_data",
      axis: "discoverability",
      severity: "good",
      label: `Structured data: ${jsonLdTypes.slice(0, 3).join(", ")}`,
      tradeoff: null,
      weight: 2,
    });
  } else if (!opts.httpBlocked) {
    findings.push({
      signal: "no_structured_data",
      axis: "discoverability",
      severity: contextualSeverity("info", arch, { content: "low", commerce: "low" }),
      label: "No structured data (JSON-LD) found",
      tradeoff: null,
      weight: 2,
    });
  }

  // Social meta (OG + Twitter)
  if (opts.socialMeta && !opts.httpBlocked) {
    const score = opts.socialMeta.score;
    findings.push({
      signal: "social_meta",
      axis: "discoverability",
      severity: score >= 80 ? "good" : score >= 50 ? "info" : score >= 30 ? "low" : "medium",
      label: score >= 80 ? "Complete social meta (OG + Twitter)" : `Social meta score: ${score}/100`,
      tradeoff: null,
      weight: 3,
    });
  }

  // Robots.txt
  if (opts.meta) {
    findings.push({
      signal: "robots_txt",
      axis: "discoverability",
      severity: opts.meta.robots_txt_exists ? "good" : "info",
      label: opts.meta.robots_txt_exists ? "robots.txt present" : "No robots.txt",
      tradeoff: null,
      weight: 2,
    });
  }

  // Sitemap
  if (opts.meta) {
    findings.push({
      signal: "sitemap",
      axis: "discoverability",
      severity: opts.meta.sitemap_detected ? "good" : contextualSeverity("low", arch, { content: "medium" }),
      label: opts.meta.sitemap_detected ? "Sitemap detected" : "No sitemap found",
      tradeoff: null,
      weight: 2,
    });
  }

  // Legal pages
  if (opts.legal && !opts.httpBlocked) {
    const pageCount = opts.legal.pages_found.length;
    findings.push({
      signal: "legal_pages",
      axis: "reputation",
      severity: pageCount >= 2 ? "good" : pageCount >= 1 ? "info" : "low",
      label:
        pageCount >= 2
          ? `Legal pages found (${pageCount})`
          : pageCount === 1
            ? "1 legal page found"
            : "No legal pages detected",
      tradeoff: null,
      weight: 1,
    });
  }

  // Social account presence — visibility signal
  if (opts.socialAccounts) {
    const accts = opts.socialAccounts.accounts;
    const verifiedCount = accts.filter((a) => a.found_via === "rel-me").length;
    const linkedCount = accts.filter((a) => a.found_via === "homepage").length;
    const totalCount = accts.length;

    if (verifiedCount >= 2) {
      findings.push({
        signal: "social_accounts",
        axis: "discoverability",
        severity: "good",
        label: `${verifiedCount} verified social accounts (rel=me)`,
        tradeoff: null,
        weight: 3,
      });
    } else if (verifiedCount >= 1 || linkedCount >= 2) {
      findings.push({
        signal: "social_accounts",
        axis: "discoverability",
        severity: "good",
        label: `${totalCount} social account${totalCount !== 1 ? "s" : ""} detected`,
        tradeoff: null,
        weight: 2,
      });
    } else if (totalCount >= 1) {
      findings.push({
        signal: "social_accounts",
        axis: "discoverability",
        severity: "info",
        label: `${totalCount} social account${totalCount !== 1 ? "s" : ""} detected`,
        tradeoff: null,
        weight: 1,
      });
    }
    // social_not_verified removed — 341/341 = info, 93% of domains, zero discrimination
    if (!opts.httpBlocked && totalCount === 0) {
      // No social presence — mild visibility concern for content/corporate sites
      findings.push({
        signal: "no_social_accounts",
        axis: "discoverability",
        severity: contextualSeverity("info", arch, { content: "low", corporate: "low" }),
        label: "No social accounts detected",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── NEW: Restrictive robots.txt ─────────────────────────────────
  if (opts.robotsParsed?.is_restrictive) {
    findings.push({
      signal: "restrictive_robots",
      axis: "discoverability",
      severity: contextualSeverity("low", arch, { infrastructure: "info", application: "info" }),
      label: "robots.txt blocks all crawlers — site won't appear in search results",
      tradeoff: "May be intentional for private/internal sites.",
      weight: 2,
    });
  }

  // ─── NEW: PWA Ready ──────────────────────────────────────────────
  if (opts.wellKnown?.pwa_ready) {
    findings.push({
      signal: "pwa_ready",
      axis: "discoverability",
      severity: "good",
      label: "Progressive Web App ready (manifest + service worker)",
      tradeoff: null,
      weight: arch === "application" || arch === "commerce" ? 2 : 1,
    });
  }

  // ─── Phase 2: Canonical URL ──────────────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const canonicalMatch =
      opts.html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["']/i) ??
      opts.html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']canonical["']/i);
    if (canonicalMatch) {
      const canonicalUrl = canonicalMatch[1];
      try {
        const canonicalHost = new URL(canonicalUrl).hostname.toLowerCase();
        const domainLowerCan = opts.domain.toLowerCase();
        if (
          canonicalHost === domainLowerCan ||
          canonicalHost.endsWith(`.${domainLowerCan}`) ||
          domainLowerCan.endsWith(`.${canonicalHost}`)
        ) {
          findings.push({
            signal: "canonical_url",
            axis: "discoverability",
            severity: "good",
            label: "Canonical URL set correctly",
            tradeoff: null,
            weight: 2,
          });
        } else {
          findings.push({
            signal: "canonical_url",
            axis: "discoverability",
            severity: "info",
            label: `Canonical URL points to different domain (${canonicalHost})`,
            tradeoff: "May be intentional for cross-domain canonical consolidation.",
            weight: 1,
          });
        }
      } catch {
        findings.push({
          signal: "canonical_url",
          axis: "discoverability",
          severity: "info",
          label: "Canonical URL present but malformed",
          tradeoff: null,
          weight: 1,
        });
      }
    } else {
      findings.push({
        signal: "canonical_url_missing",
        axis: "discoverability",
        severity: contextualSeverity("info", arch, { content: "low", corporate: "low" }),
        label: "No canonical URL — risk of duplicate content in search results",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Phase 3: Mobile App Links ───────────────────────────────────
  if (opts.wellKnown?.has_mobile_apps) {
    findings.push({
      signal: "mobile_app_links",
      axis: "discoverability",
      severity: "good",
      label: "Mobile app deep links configured",
      tradeoff: null,
      weight: 1,
    });
  }

  // ─── Phase 3: RSS/Atom Feed ──────────────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const hasRss = /type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(opts.html);
    if (hasRss) {
      findings.push({
        signal: "rss_feed",
        axis: "discoverability",
        severity: "good",
        label: "RSS/Atom feed available",
        tradeoff: null,
        weight: arch === "content" ? 2 : 1,
      });
    }
  }

  // ─── Phase 3: Hreflang (international targeting) ─────────────────
  if (opts.html && !opts.httpBlocked) {
    const hasHreflang = /hreflang\s*=\s*["'][^"']+["']/i.test(opts.html);
    if (hasHreflang) {
      findings.push({
        signal: "hreflang",
        axis: "discoverability",
        severity: "good",
        label: "Hreflang tags present — international targeting configured",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Phase 3: Favicon ────────────────────────────────────────────
  if (opts.meta && !opts.httpBlocked) {
    if (!opts.meta.favicon_url) {
      if (arch === "content" || arch === "corporate") {
        findings.push({
          signal: "favicon_missing",
          axis: "discoverability",
          severity: "low",
          label: "No favicon detected",
          tradeoff: null,
          weight: 1,
        });
      }
    }
  }

  // ─── Phase 3: Title Tag ──────────────────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const titleMatch = opts.html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const titleText = titleMatch ? titleMatch[1].trim() : "";
    if (!titleText) {
      findings.push({
        signal: "title_tag_missing",
        axis: "discoverability",
        severity: "low",
        label: "Missing page title",
        tradeoff: null,
        weight: 1,
      });
    } else if (titleText.length < 5 || /^(untitled|home|welcome|index)$/i.test(titleText)) {
      findings.push({
        signal: "title_tag_generic",
        axis: "discoverability",
        severity: "info",
        label: `Generic page title: "${titleText}"`,
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Phase 3: Meta Description ───────────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const hasMetaDesc = /name\s*=\s*["']description["']/i.test(opts.html);
    const hasOgDesc = !!opts.socialMeta?.og?.description;
    if (!hasMetaDesc && !hasOgDesc) {
      findings.push({
        signal: "meta_description_missing",
        axis: "discoverability",
        severity: contextualSeverity("info", arch, { content: "low" }),
        label: "No meta description — search engines will generate their own snippet",
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Mobile Friendly ───────────────────────────────────────────
  if (opts.html && !opts.httpBlocked) {
    const viewportMatch =
      opts.html.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]+content\s*=\s*["']([^"']+)["']/i) ??
      opts.html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']viewport["']/i);
    if (viewportMatch) {
      const viewportContent = viewportMatch[1].toLowerCase();
      if (viewportContent.includes("width=device-width")) {
        findings.push({
          signal: "mobile_friendly",
          axis: "discoverability",
          severity: "good",
          label: "Mobile-friendly viewport configured",
          tradeoff: null,
          weight: 2,
        });
      } else {
        findings.push({
          signal: "mobile_friendly",
          axis: "discoverability",
          severity: "low",
          label: "Viewport set but not responsive (missing width=device-width)",
          tradeoff: null,
          weight: 2,
        });
      }
    } else {
      findings.push({
        signal: "mobile_friendly",
        axis: "discoverability",
        severity: contextualSeverity("medium", arch, { infrastructure: "info", application: "low" }),
        label: "No viewport meta tag — not mobile-friendly",
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── OG Tag Completeness ───────────────────────────────────────
  if (opts.socialMeta && !opts.httpBlocked) {
    const og = opts.socialMeta.og;
    const ogChecks = [og?.title, og?.description, og?.image, og?.url, og?.type];
    const ogPresent = ogChecks.filter(Boolean).length;
    const hasTwitterCard = !!opts.socialMeta.twitter?.card;
    if (ogPresent >= 5) {
      findings.push({
        signal: "og_completeness",
        axis: "discoverability",
        severity: "good",
        label: `Complete OG tags (${ogPresent}/5)${hasTwitterCard ? " + Twitter Card" : ""}`,
        tradeoff: null,
        weight: 2,
      });
    } else if (ogPresent >= 3) {
      findings.push({
        signal: "og_completeness",
        axis: "discoverability",
        severity: "info",
        label: `${ogPresent}/5 OG tags present`,
        tradeoff: null,
        weight: 2,
      });
    } else if (ogPresent >= 1) {
      findings.push({
        signal: "og_completeness",
        axis: "discoverability",
        severity: "low",
        label: `Only ${ogPresent}/5 OG tags — social sharing will look incomplete`,
        tradeoff: null,
        weight: 2,
      });
    } else {
      findings.push({
        signal: "og_completeness",
        axis: "discoverability",
        severity: contextualSeverity("medium", arch, {
          infrastructure: "info",
          application: "info",
          institutional: "info",
        }),
        label: "No Open Graph tags — social sharing will use browser defaults",
        tradeoff: null,
        weight: 2,
      });
    }
  }
  if (opts.accessibility) {
    const a11yScore = opts.accessibility.score;
    if (a11yScore >= 80) {
      findings.push({
        signal: "accessibility",
        axis: "discoverability",
        severity: "good",
        label: `Accessibility score ${a11yScore}/100`,
        tradeoff: null,
        weight: 1,
      });
    } else if (a11yScore >= 50) {
      findings.push({
        signal: "accessibility",
        axis: "discoverability",
        severity: contextualSeverity("low", arch, { institutional: "medium", corporate: "medium" }),
        label: `Accessibility score ${a11yScore}/100 — improvements needed`,
        tradeoff: null,
        weight: 1,
      });
    } else {
      findings.push({
        signal: "accessibility",
        axis: "discoverability",
        severity: contextualSeverity("medium", arch, { institutional: "high", corporate: "medium" }),
        label: `Low accessibility score ${a11yScore}/100`,
        tradeoff: null,
        weight: 1,
      });
    }
  }

  // ─── Third-Party Scripts → Speed Axis ────────────────────
  if (opts.thirdPartyScripts) {
    const tps = opts.thirdPartyScripts;
    // Render-blocking scripts impact
    if (tps.render_blocking > 0) {
      findings.push({
        signal: "render_blocking_scripts",
        axis: "speed",
        severity: tps.render_blocking > 5 ? "high" : tps.render_blocking > 2 ? "medium" : "low",
        label: `${tps.render_blocking} render-blocking script${tps.render_blocking !== 1 ? "s" : ""}`,
        tradeoff: "Adding async/defer may cause timing issues for scripts that depend on load order.",
        weight: 3,
      });
    } else {
      // Zero render-blocking scripts — whether zero 3P scripts or all non-blocking
      findings.push({
        signal: "render_blocking_scripts",
        axis: "speed",
        severity: "good",
        label:
          tps.third_party > 0
            ? "No render-blocking third-party scripts"
            : "No third-party scripts — no render-blocking risk",
        tradeoff: null,
        weight: 3,
      });
    }

    // High third-party script count impacts performance
    if (tps.third_party > 15) {
      findings.push({
        signal: "third_party_count",
        axis: "speed",
        severity: "high",
        label: `${tps.third_party} third-party scripts — significant performance overhead`,
        tradeoff: null,
        weight: 2,
      });
    } else if (tps.third_party > 8) {
      findings.push({
        signal: "third_party_count",
        axis: "speed",
        severity: "medium",
        label: `${tps.third_party} third-party scripts loaded`,
        tradeoff: null,
        weight: 2,
      });
    }

    // Privacy concerns → Security axis
    if (tps.privacy_concerns.length > 0) {
      findings.push({
        signal: "script_privacy",
        axis: "reputation",
        severity: contextualSeverity("medium", arch, { commerce: "high", institutional: "high" }),
        label: `${tps.privacy_concerns.length} privacy concern(s) from third-party scripts`,
        tradeoff: null,
        weight: 3,
      });
    }
  }

  // ─── Cookie Consent → Security/Trust Axes ─────────────────────
  if (opts.cookieConsent) {
    const cc = opts.cookieConsent;

    // CMP presence — important for trust
    if (cc.cmp_detected) {
      findings.push({
        signal: "cookie_consent_cmp",
        axis: "reputation",
        severity: cc.cmp_detected.confidence >= 0.5 ? "good" : "info",
        label: `Consent platform: ${cc.cmp_detected.name}`,
        tradeoff: null,
        weight: 3,
      });
    }

    // Pre-consent tracking cookies — security concern
    if (cc.pre_consent_cookies > 0) {
      findings.push({
        signal: "pre_consent_cookies",
        axis: "reputation",
        severity: contextualSeverity("medium", arch, { commerce: "high", institutional: "critical" }),
        label: `${cc.pre_consent_cookies} potential tracking cookie(s) set before consent`,
        tradeoff: null,
        weight: 3,
      });
    }

    // Compliance flags count → trust
    if (cc.compliance_flags.length > 0) {
      findings.push({
        signal: "cookie_compliance",
        axis: "reputation",
        severity: cc.compliance_flags.length >= 3 ? "medium" : "low",
        label: `${cc.compliance_flags.length} cookie compliance flag(s)`,
        tradeoff: null,
        weight: 2,
      });
    }
  }

  // ─── Network Health ──────────────────────────────────────────────
  if (opts.networkHealth) {
    const nh = opts.networkHealth;

    // DNS inconsistency — suppress when the site is actually reachable or behind a CDN.
    // CDN anycast, geo-DNS, and multi-datacenter hosting all intentionally return
    // different IPs to different resolvers. If the site is up, the DNS is working.
    const isBehindCdn = !!opts.hosting?.cdn;
    const siteIsUp = !!opts.statusResult?.is_up;
    const hasMultipleIps = (nh.dns_propagation?.unique_ips?.length ?? 0) >= 2;
    if (nh.dns_propagation && !nh.dns_propagation.consistent) {
      if (isBehindCdn) {
        findings.push({
          signal: "dns_consistent",
          axis: "foundations",
          severity: "good",
          label: `DNS varies across resolvers (expected: ${opts.hosting!.cdn} anycast)`,
          tradeoff: null,
          weight: 1,
        });
      } else if (siteIsUp && hasMultipleIps) {
        // Site responds and has multiple IPs — this is geo-DNS / distributed hosting
        findings.push({
          signal: "dns_consistent",
          axis: "foundations",
          severity: "good",
          label: "DNS varies across resolvers (distributed hosting)",
          tradeoff: null,
          weight: 1,
        });
      } else {
        findings.push({
          signal: "dns_inconsistent",
          axis: "foundations",
          severity: contextualSeverity("low", arch, { commerce: "medium", application: "medium" }),
          label: "DNS records inconsistent across resolvers",
          tradeoff: "DNS propagation may still be in progress, or you're using geo-DNS.",
          weight: 3,
        });
      }
    } else if (nh.dns_propagation?.consistent) {
      findings.push({
        signal: "dns_consistent",
        axis: "foundations",
        severity: "good",
        label: "DNS records consistent across all resolvers",
        tradeoff: null,
        weight: 1,
      });
    }

    // BGP stability — demote to info if the site is actually reachable,
    // since BGP churn on a responding site is traffic engineering, not instability
    if (nh.ripe_routing?.routing_stability === "unstable") {
      const siteIsUp = opts.statusResult?.is_up === true;
      findings.push({
        signal: "bgp_unstable",
        axis: "foundations",
        severity: siteIsUp ? "info" : contextualSeverity("medium", arch, { commerce: "high", institutional: "high" }),
        label: siteIsUp
          ? `BGP route churn (${nh.ripe_routing.bgp_updates_24h} updates in 24h — site responding normally)`
          : `BGP route unstable (${nh.ripe_routing.bgp_updates_24h} updates in 24h)`,
        tradeoff: null,
        weight: siteIsUp ? 1 : 3,
      });
    }
    // bgp_stable removed — only 3 domains ever, unreliable data asymmetry

    // Route visibility
    if (nh.ripe_routing?.visibility) {
      const vis = nh.ripe_routing.visibility.percentage;
      if (vis < 70) {
        findings.push({
          signal: "low_visibility",
          axis: "foundations",
          severity: contextualSeverity("low", arch, { commerce: "medium" }),
          label: `Low route visibility (${vis}% of peers)`,
          tradeoff:
            "Route visibility is measured from RIPE RIS vantage points, which are concentrated in Europe/US. APAC/LATAM-hosted sites may appear to have lower visibility.",
          weight: 2,
        });
      }
    }

    // Slow connection
    if (nh.connection_timing && nh.connection_timing.total_ms > 1000) {
      findings.push({
        signal: "slow_connection",
        axis: "foundations",
        severity: "info",
        label: `Slow connection setup (${Math.round(nh.connection_timing.total_ms)}ms total)`,
        tradeoff:
          "Connection timing depends on server location relative to the probe. A single probe location cannot reflect global latency.",
        weight: 2,
      });
    }
  }

  // ─── Resource Hints ───────────────────────────────────────────────
  if (opts.resourceHints && opts.resourceHints.total > 0) {
    const rh = opts.resourceHints;
    const parts: string[] = [];
    if (rh.preload.length > 0) parts.push(`${rh.preload.length} preload`);
    if (rh.preconnect.length > 0) parts.push(`${rh.preconnect.length} preconnect`);
    if (rh.prefetch.length > 0) parts.push(`${rh.prefetch.length} prefetch`);
    if (rh.dns_prefetch.length > 0) parts.push(`${rh.dns_prefetch.length} dns-prefetch`);
    if (rh.modulepreload.length > 0) parts.push(`${rh.modulepreload.length} modulepreload`);
    findings.push({
      signal: "resource_hints",
      axis: "speed",
      severity: "good",
      label: `Resource hints detected: ${parts.join(", ")}`,
      tradeoff: null,
      weight: 1,
    });
  }

  // ─── WordPress Security Signals (display-only, weight 0) ────────
  // These appear in findings/domain_signals but do NOT affect scores.

  if (opts.wordpress) {
    const wp = opts.wordpress;

    // REST API exposure
    if (wp.api_exposed) {
      findings.push({
        signal: "wp_api_exposed",
        axis: "security",
        severity: "info",
        label: "WordPress REST API publicly accessible",
        tradeoff: "Many themes and plugins require the REST API — disable only if not needed",
        weight: 0,
      });
    }

    // User enumeration via REST API
    if (wp.user_enumeration) {
      findings.push({
        signal: "wp_user_enumeration",
        axis: "security",
        severity: "info",
        label: "WordPress user enumeration possible via REST API",
        tradeoff: "Usernames discoverable at /wp-json/wp/v2/users — aids brute-force attacks",
        weight: 0,
      });
    }

    // XML-RPC accessible
    if (wp.xmlrpc_accessible) {
      findings.push({
        signal: "wp_xmlrpc_exposed",
        axis: "security",
        severity: "info",
        label: "WordPress XML-RPC endpoint accessible",
        tradeoff:
          "Enables brute-force login attempts and pingback DDoS amplification — disable unless needed for Jetpack or mobile publishing",
        weight: 0,
      });
    }

    // Login page exposed
    if (wp.login_accessible) {
      findings.push({
        signal: "wp_login_exposed",
        axis: "security",
        severity: "info",
        label: "WordPress login page publicly accessible",
        tradeoff: "Consider hiding with WPS Hide Login or restricting by IP — mitigate with 2FA and rate limiting",
        weight: 0,
      });
    }

    // Directory listing
    if (wp.directory_listing) {
      findings.push({
        signal: "wp_directory_listing",
        axis: "security",
        severity: "info",
        label: "WordPress uploads directory listing enabled",
        tradeoff: "Exposes uploaded files and server structure — add 'Options -Indexes' to .htaccess",
        weight: 0,
      });
    }

    // Security plugin status
    if (wp.security_plugin) {
      findings.push({
        signal: "wp_security_plugin_detected",
        axis: "security",
        severity: "good",
        label: `WordPress security plugin: ${wp.security_plugin}`,
        tradeoff: null,
        weight: 0,
      });
    } else {
      findings.push({
        signal: "wp_no_security_plugin",
        axis: "security",
        severity: "info",
        label: "No WordPress security plugin detected",
        tradeoff: "Consider Wordfence, Sucuri, or Solid Security for firewall and brute-force protection",
        weight: 0,
      });
    }

    // Caching plugin status
    if (wp.caching_plugin) {
      findings.push({
        signal: "wp_caching_plugin_detected",
        axis: "speed",
        severity: "good",
        label: `WordPress caching plugin: ${wp.caching_plugin}`,
        tradeoff: null,
        weight: 0,
      });
    } else if (!wp.managed_hosting) {
      // Only flag missing caching if not on managed hosting (which typically has built-in caching)
      findings.push({
        signal: "wp_no_caching_plugin",
        axis: "speed",
        severity: "info",
        label: "No WordPress caching plugin detected",
        tradeoff: "Consider WP Rocket, LiteSpeed Cache, or WP Super Cache for improved page load times",
        weight: 0,
      });
    }
  }

  // ─── Compute Axis Scores ─────────────────────────────────────────

  const axes: Axis[] = ["security", "speed", "foundations", "reputation", "discoverability", "email"];
  const axisScores: Record<Axis, AxisScore> = {} as Record<Axis, AxisScore>;

  // Build scoring context for context-aware normalization.
  // Excludes inapplicable signals from the max achievable score denominator.
  // Detect HTTP-blocked scans (403/etc.) — scanner limitation, not site fault.
  const httpBlocked = findings.some(
    (f) =>
      f.signal === "http_blocked_security" ||
      f.signal === "http_blocked_performance" ||
      f.signal === "http_error_response",
  );

  const scoringCtx: ScoringContext = {
    cookies: !!(opts.cookieSecurity && opts.cookieSecurity.cookies.length > 0),
    wordpress: !!opts.wordpress,
    httpBlocked,
  };

  for (const axis of axes) {
    const axisFindings = findings.filter((f) => f.axis === axis);

    // Count scoreable findings — exclude meta-signals that just indicate checks couldn't run
    const scoreableFindings = axisFindings.filter(
      (f) => !f.signal.startsWith("http_blocked_") && !f.signal.startsWith("site_unreachable_"),
    );

    if (scoreableFindings.length < 3) {
      // "Not Assessed" — too few findings to produce a meaningful score.
      // Prevents sparse axes from inflating or deflating unfairly.
      axisScores[axis] = { score: null, weight: AXIS_WEIGHTS[axis], findings: axisFindings, not_measured: true };
      continue;
    }

    // Budget-based deductive scoring with itemized deductions.
    // Absence penalties are integrated into the model via the "absent" deduction
    // (canBeGood signals that didn't fire), so applyAbsencePenalties is no longer needed.
    const { score, deductions } = computeAxisScoreWithDeductions(axisFindings, axis, scoringCtx);

    axisScores[axis] = { score, weight: AXIS_WEIGHTS[axis], findings: axisFindings, deductions };
  }

  // ─── Compute Composite Score ─────────────────────────────────────
  // Weighted arithmetic mean with outlier floor cap.
  // Null axes are imputed at a below-average floor (35 = "Weak") rather than
  // excluded, because unassessable axes are themselves a negative signal.
  // This prevents domains from dodging their weakest areas by being unobservable.

  const NULL_AXIS_IMPUTE = 35;
  const rawAxisScores: Record<Axis, number> = {} as Record<Axis, number>;
  const assessedAxes: Axis[] = [];
  for (const axis of axes) {
    if (axisScores[axis].score != null) {
      rawAxisScores[axis] = axisScores[axis].score as number;
    } else {
      rawAxisScores[axis] = NULL_AXIS_IMPUTE;
    }
    assessedAxes.push(axis);
  }

  let rawComposite: number;
  if (assessedAxes.length === 0) {
    rawComposite = 0;
  } else {
    // Re-normalize weights for assessed axes only
    const totalWeight = assessedAxes.reduce((sum, a) => sum + AXIS_WEIGHTS[a], 0);
    let weightedSum = 0;
    for (const axis of assessedAxes) {
      const normalizedWeight = AXIS_WEIGHTS[axis] / totalWeight;
      weightedSum += normalizedWeight * rawAxisScores[axis];
    }
    rawComposite = Math.max(0, Math.min(100, Math.round(weightedSum)));

    // Outlier floor: if ANY assessed axis < 40, cap at 74 (Moderate ceiling)
    const hasLowOutlier = assessedAxes.some((a) => rawAxisScores[a] < 40);
    if (hasLowOutlier && rawComposite > 74) {
      rawComposite = 74;
    }
  }

  // ─── Hard Caps ───────────────────────────────────────────────────
  // Apply hard caps to the composite SCORE, then derive tier from capped score.
  // This eliminates score/tier paradoxes.
  const composite = applyHardCaps(rawComposite, findings, rawAxisScores);

  let tier = tierFromComposite(composite);

  // ─── Breach tier cap ─────────────────────────────────────────────
  // Domains with catastrophic RECENT data breaches should not earn top tiers.
  // Breaches > 3 years old no longer trigger the cap (time decay).
  if (opts.breaches?.found && !opts.breaches.check_failed) {
    const recentBreachCount = opts._recentBreachCount ?? 0;
    const weightedPwned = opts._weightedPwned ?? 0;
    if (recentBreachCount > 0) {
      if (weightedPwned > 100_000_000 && tier === "Excellent") {
        tier = "Strong";
      }
    }
  }

  const signalDetails = buildSignalDetails(axisScores, composite, archetype, scoringCtx);

  return { composite, tier, axes: axisScores, archetype, scoringContext: scoringCtx, signalDetails };
}
