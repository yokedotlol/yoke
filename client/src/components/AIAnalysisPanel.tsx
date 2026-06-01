import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Lock,
  RotateCcw,
  Settings,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AXIS_WEIGHTS,
  FIX_DESC_MAP,
  NON_ACTIONABLE_SIGNALS,
  SCORE_DRAG_SIGNALS,
  SIGNAL_REGISTRY,
  TIER_THRESHOLDS,
} from "../../../worker/src/config/signal-registry";
import type { AbsentSignalDetailData, Axis, ScoreFinding, Severity } from "../api";
import { severityBg, severityColor, severityIcon } from "../utils/severity";
import type { AnalysisResult } from "../utils/types";
import { findReferenceLink } from "./DomainSignals";

// ─── Types ──────────────────────────────────────────────────────────

interface CrossSignalInsight {
  insight: string;
  signals_cited: string[];
  severity: "info" | "low" | "medium" | "high";
  actionable: boolean;
}

interface AIAnalysisResult {
  summary: string;
  posture: string;
  key_findings: Array<{ category: string; finding: string; severity: string; action: string }>;
  cross_signal_insights: CrossSignalInsight[];
  attack_surface: string[];
  recommendations: Array<{ priority: number; action: string; impact: string; effort: string; tool?: string }>;
  _usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface AIAnalysisResponse {
  result: AIAnalysisResult;
  analyzed_at: string;
  domain: string;
  cached: boolean;
  error?: string;
}

interface RateLimitResponse {
  rate_limited: true;
  limit: number;
  used: number;
  reset: string;
  diy_prompt: string;
  model_suggestion: string;
  instructions: string;
}

// ─── Top Priorities Engine ──────────────────────────────────────────

interface ActionItem {
  title: string;
  reason: string;
  effort: string;
  axis: string;
  severity: "critical" | "high" | "medium" | "low";
  impact: number; // 0-100, used for sorting
}

type AxisName = "security" | "speed" | "foundations" | "reputation" | "discoverability" | "email";

function generateActionItems(data: AnalysisResult): ActionItem[] {
  const items: ActionItem[] = [];
  const axes = data.domain_score?.axes;

  // ─── Critical: Site down ──────────────────────────────────────────
  if (data.status && !data.status.is_up) {
    items.push({
      title: "Site appears to be down",
      reason: "Users and search engines can't reach your site. Everything else is secondary until this is resolved.",
      effort: "Investigate immediately",
      axis: "foundations",
      severity: "critical",
      impact: 100,
    });
  }

  // ─── Critical: Blocklisted ────────────────────────────────────────
  if (data.blocklists) {
    const listed = data.blocklists.filter((b) => b.listed);
    if (listed.length > 0) {
      items.push({
        title: `Listed on ${listed.length} blocklist${listed.length > 1 ? "s" : ""}`,
        reason: "Blocklist presence can cause email rejection and browser warnings. Investigate and request delisting.",
        effort: "Varies — may take days",
        axis: "reputation",
        severity: "critical",
        impact: 95,
      });
    }
  }

  // ─── Critical: SSL expired or expiring ────────────────────────────
  if (data.ssl) {
    if (data.ssl.valid_to) {
      const daysLeft = Math.floor((new Date(data.ssl.valid_to).getTime() - Date.now()) / 86400000);
      if (daysLeft < 0) {
        items.push({
          title: "Renew expired SSL certificate",
          reason: "Browsers are showing security warnings to every visitor. Enable auto-renewal to prevent recurrence.",
          effort: "~15 min with your cert provider",
          axis: "security",
          severity: "critical",
          impact: 98,
        });
      } else if (daysLeft <= 14) {
        items.push({
          title: `Renew SSL certificate — expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          reason:
            "An expired cert will trigger browser warnings and break trust. Check auto-renewal or renew manually.",
          effort: "~15 min",
          axis: "security",
          severity: "critical",
          impact: 92,
        });
      } else if (daysLeft <= 30) {
        items.push({
          title: `SSL certificate expires in ${daysLeft} days`,
          reason: "Coming up soon — make sure auto-renewal is configured or renew manually.",
          effort: "~15 min",
          axis: "security",
          severity: "high",
          impact: 70,
        });
      }
    }
    if (data.ssl.grade === "T") {
      items.push({
        title: "Fix SSL certificate trust chain",
        reason:
          "The certificate has trust issues — browsers may show warnings. Usually means a missing intermediate certificate.",
        effort: "~30 min — reconfigure cert chain",
        axis: "security",
        severity: "critical",
        impact: 90,
      });
    } else if (data.ssl.grade && !data.ssl.grade.startsWith("A") && data.ssl.grade !== "T") {
      items.push({
        title: "Upgrade TLS configuration for grade A",
        reason:
          "Enable TLS 1.3 and modern cipher suites. Improves both security and performance (TLS 1.3 has faster handshakes).",
        effort: "Server config change, ~30 min",
        axis: "security",
        severity: "medium",
        impact: 40,
      });
    }
  }

  // ─── Critical: Domain expiring ────────────────────────────────────
  if (data.rdap?.days_until_expiry != null) {
    if (data.rdap.days_until_expiry <= 30) {
      items.push({
        title: `Renew domain — expires in ${data.rdap.days_until_expiry} day${data.rdap.days_until_expiry === 1 ? "" : "s"}`,
        reason: "If the domain expires, someone else can register it. Enable auto-renewal with your registrar.",
        effort: "~5 min at your registrar",
        axis: "reputation",
        severity: "critical",
        impact: 96,
      });
    } else if (data.rdap.days_until_expiry <= 90) {
      items.push({
        title: `Domain registration expires in ${data.rdap.days_until_expiry} days`,
        reason: "Consider renewing early and enabling auto-renewal to avoid any risk of losing the domain.",
        effort: "~5 min",
        axis: "reputation",
        severity: "high",
        impact: 55,
      });
    }
  }

  // ─── High: Email authentication gaps ──────────────────────────────
  if (data.email_auth) {
    const missingSpf = !data.email_auth.spf?.found;
    const missingDkim = data.email_auth.dkim_selectors_found?.length === 0;
    const missingDmarc = !data.email_auth.dmarc?.found;
    const dmarcNone = data.email_auth.dmarc?.found && data.email_auth.dmarc.policy === "none";

    if (missingSpf && missingDkim && missingDmarc) {
      items.push({
        title: "Set up email authentication (SPF + DKIM + DMARC)",
        reason:
          "Without any email auth, anyone can send emails pretending to be your domain. This hurts deliverability and enables phishing.",
        effort: "~1 hour — DNS records + email provider config",
        axis: "security",
        severity: "high",
        impact: 75,
      });
    } else {
      if (missingDkim) {
        items.push({
          title: "Add DKIM to email authentication",
          reason:
            "You have SPF" +
            (data.email_auth.dmarc?.found ? " and DMARC" : "") +
            " but without DKIM, emails can still be spoofed. Most email providers have a setup wizard.",
          effort: "~30 min with your email provider",
          axis: "security",
          severity: "high",
          impact: 60,
        });
      }
      if (missingDmarc) {
        items.push({
          title: "Add a DMARC policy",
          reason:
            "DMARC tells receiving servers what to do with unauthenticated email from your domain. Start with p=none to monitor.",
          effort: "~15 min — one DNS TXT record",
          axis: "reputation",
          severity: "high",
          impact: 55,
        });
      }
      if (missingSpf) {
        items.push({
          title: "Add SPF record",
          reason:
            "SPF lists which servers can send email for your domain. Without it, spam filters are more likely to reject your mail.",
          effort: "~10 min — one DNS TXT record",
          axis: "security",
          severity: "high",
          impact: 50,
        });
      }
      if (dmarcNone) {
        items.push({
          title: 'Strengthen DMARC policy from "none" to "quarantine" or "reject"',
          reason:
            "DMARC p=none only monitors — it doesn't actually protect against spoofing. Upgrade once you've verified legitimate senders.",
          effort: "~5 min DNS change, but audit senders first",
          axis: "reputation",
          severity: "medium",
          impact: 35,
        });
      }
    }
  }

  // ─── High: Missing critical security headers ──────────────────────
  if (data.headers) {
    const failedHeaders = data.headers.security_audit
      .filter((h) => h.status === "fail")
      .map((h) => h.header.toLowerCase());
    if (failedHeaders.includes("strict-transport-security") && !failedHeaders.includes("content-security-policy")) {
      items.push({
        title: "Enable HSTS (HTTP Strict Transport Security)",
        reason:
          "Forces browsers to use HTTPS. Without it, users can be downgraded to insecure HTTP via man-in-the-middle attacks.",
        effort: "One response header — ~10 min",
        axis: "security",
        severity: "high",
        impact: 55,
      });
    }
    if (failedHeaders.includes("content-security-policy")) {
      items.push({
        title: "Add a Content Security Policy",
        reason:
          "CSP is the strongest defense against cross-site scripting (XSS). Start with report-only mode to avoid breaking anything.",
        effort: "Moderate — requires auditing your scripts and styles",
        axis: "security",
        severity: "medium",
        impact: 45,
      });
    }
    if (failedHeaders.includes("x-content-type-options")) {
      items.push({
        title: "Add X-Content-Type-Options: nosniff",
        reason:
          "Prevents browsers from MIME-sniffing responses, blocking a class of attacks. Trivial to add, no risk of breakage.",
        effort: "One-line header — ~5 min",
        axis: "security",
        severity: "low",
        impact: 15,
      });
    }
  }

  // ─── High: Performance issues ─────────────────────────────────────
  if (data.performance) {
    if (data.performance.score != null && data.performance.score < 50) {
      items.push({
        title: `Improve page performance (currently ${data.performance.score}/100)`,
        reason:
          "Below 50 means significant loading issues. Affects user experience, bounce rates, and search rankings.",
        effort: "Run Lighthouse for specific recommendations",
        axis: "speed",
        severity: "high",
        impact: 70,
      });
    } else if (data.performance.score != null && data.performance.score < 80) {
      items.push({
        title: `Tune page performance (currently ${data.performance.score}/100)`,
        reason: "Moderate performance — optimizing images, scripts, and server response time would help.",
        effort: "Varies — check Lighthouse report",
        axis: "speed",
        severity: "medium",
        impact: 35,
      });
    }
    if (data.performance.lcp != null && data.performance.lcp > 4000) {
      const lcpSec = (data.performance.lcp / 1000).toFixed(1);
      items.push({
        title: `Reduce Largest Contentful Paint (${lcpSec}s → under 2.5s)`,
        reason:
          "LCP above 4s means the main content takes too long to appear. Usually caused by large images, slow fonts, or server delay.",
        effort: "Image optimization + lazy loading — ~1-2 hours",
        axis: "speed",
        severity: "high",
        impact: 60,
      });
    }
  }

  // ─── Medium: Third-party script bloat ─────────────────────────────
  if (data.third_party_scripts && data.third_party_scripts.third_party > 30) {
    items.push({
      title: `Reduce third-party scripts (${data.third_party_scripts.third_party} detected)`,
      reason:
        "Each external script adds latency, privacy risk, and potential breakage. Audit and remove unused ones, lazy-load the rest.",
      effort: "~2-3 hours to audit and optimize",
      axis: "speed",
      severity: "medium",
      impact: 40,
    });
  }

  // ─── Medium: No compression ───────────────────────────────────────
  if (data.compression && !data.compression.encoding && !data.compression.vary_accept_encoding) {
    items.push({
      title: "Enable response compression (gzip or brotli)",
      reason:
        "Uncompressed responses waste bandwidth and slow page loads. Most servers and CDNs support this with a config toggle.",
      effort: "~15 min — server/CDN config",
      axis: "speed",
      severity: "medium",
      impact: 35,
    });
  }

  // ─── Medium: HTTP/1.1 only ────────────────────────────────────────
  if (data.http_protocols && !data.http_protocols.http2 && !data.http_protocols.http3) {
    items.push({
      title: "Upgrade to HTTP/2 or HTTP/3",
      reason:
        "HTTP/1.1 can't multiplex requests — browsers open 6+ connections instead. HTTP/2 is a server config change with no code impact.",
      effort: "Server/CDN config — ~30 min",
      axis: "speed",
      severity: "medium",
      impact: 30,
    });
  }

  // ─── Medium: DNSSEC ───────────────────────────────────────────────
  if (data.dnssec && !data.dnssec.enabled) {
    items.push({
      title: "Enable DNSSEC",
      reason:
        "Prevents DNS spoofing attacks that can redirect your users to malicious sites. Most registrars offer one-click setup.",
      effort: "~30 min through your registrar",
      axis: "security",
      severity: "low",
      impact: 25,
    });
  }

  // ─── Low: No IPv6 ─────────────────────────────────────────────────
  if (data.dns?.records) {
    const hasAAAA = data.dns.records.some((r) => r.type === "AAAA");
    if (!hasAAAA) {
      items.push({
        title: "Add IPv6 (AAAA) records",
        reason: "A growing share of mobile and international users connect over IPv6. Some networks are IPv6-only.",
        effort: "DNS config — ~15 min",
        axis: "foundations",
        severity: "low",
        impact: 15,
      });
    }
  }

  // ─── Low: No CAA records ──────────────────────────────────────────
  if (data.caa_analysis && (!data.caa_analysis.records || data.caa_analysis.records.length === 0)) {
    items.push({
      title: "Add CAA DNS records",
      reason:
        "CAA restricts which Certificate Authorities can issue certs for your domain, preventing unauthorized issuance.",
      effort: "~10 min — DNS records",
      axis: "security",
      severity: "low",
      impact: 15,
    });
  }

  // ─── Medium: Pre-consent cookies ──────────────────────────────────
  if (data.cookie_consent && data.cookie_consent.pre_consent_cookies > 0) {
    items.push({
      title: `Review ${data.cookie_consent.pre_consent_cookies} pre-consent tracking cookie${data.cookie_consent.pre_consent_cookies > 1 ? "s" : ""}`,
      reason:
        "Cookies set before user consent can violate GDPR/CCPA. Review your cookie implementation and consent flow.",
      effort: "~1-2 hours to audit",
      axis: "reputation",
      severity: "medium",
      impact: 35,
    });
  }

  // ─── Visibility quick wins ────────────────────────────────────────
  if (data.json_ld && data.json_ld.length === 0) {
    items.push({
      title: "Add structured data (JSON-LD)",
      reason:
        "Organization or WebSite schema helps search engines understand your site and enables rich results in search.",
      effort: "~15 min — copy-paste template",
      axis: "discoverability",
      severity: "low",
      impact: 25,
    });
  }

  if (data.social_meta) {
    const sm = data.social_meta as { og_complete?: boolean; twitter_complete?: boolean; score?: number };
    if (sm.score != null && sm.score < 30) {
      items.push({
        title: "Add Open Graph and Twitter Card meta tags",
        reason: "Without social meta, shared links won't show rich previews on social media — just a bare URL.",
        effort: "~10 min — a few <meta> tags",
        axis: "discoverability",
        severity: "low",
        impact: 20,
      });
    }
  }

  // Social verification via rel="me"
  if (data.domain_score?.axes?.discoverability?.findings) {
    const visFindings = data.domain_score.axes.discoverability.findings as Array<{
      signal?: string;
      severity?: string;
      label?: string;
    }>;
    const notVerified = visFindings.find((f) => f.signal === "social_not_verified");
    const socialInfo = visFindings.find((f) => f.signal === "social_accounts" && f.severity === "info");
    if (notVerified) {
      items.push({
        title: 'Add rel="me" links for social account verification',
        reason:
          'Your social accounts are detected but not verified. Adding <link rel="me" href="..."> tags to your HTML head takes 5 minutes and proves you own those profiles — turning yellow "linked" badges green.',
        effort: "~5 min — add link tags to <head>",
        axis: "discoverability" as AxisName,
        severity: "low",
        impact: 15,
      });
    } else if (socialInfo) {
      items.push({
        title: 'Verify social accounts with rel="me" links',
        reason:
          'Social accounts were found by username matching but aren\'t verified. Add <link rel="me" href="..."> tags to prove ownership and strengthen your identity signals.',
        effort: "~5 min — add link tags to <head>",
        axis: "discoverability" as AxisName,
        severity: "low",
        impact: 12,
      });
    }
  }

  if (data.meta && !data.meta.sitemap_detected) {
    items.push({
      title: "Add a sitemap.xml",
      reason: "Sitemaps help search engines discover and index all your pages. Most frameworks can auto-generate one.",
      effort: "~15 min",
      axis: "discoverability",
      severity: "low",
      impact: 15,
    });
  }

  if (data.accessibility) {
    const score = (data.accessibility as { score?: number }).score;
    if (score != null && score < 50) {
      items.push({
        title: `Improve accessibility (score: ${score}/100)`,
        reason:
          "Low accessibility limits your audience and may create legal exposure. Focus on alt text, contrast, and keyboard navigation.",
        effort: "Ongoing — start with automated fixes",
        axis: "discoverability",
        severity: "high",
        impact: 55,
      });
    } else if (score != null && score < 70) {
      items.push({
        title: `Improve accessibility (score: ${score}/100)`,
        reason:
          "Room for improvement on WCAG compliance. Common fixes: add alt text, improve contrast ratios, ensure keyboard navigation.",
        effort: "~2-4 hours for quick wins",
        axis: "discoverability",
        severity: "medium",
        impact: 30,
      });
    }
  }

  // ─── Data breaches ────────────────────────────────────────────────
  if (data.breaches?.items && data.breaches.items.length > 0) {
    items.push({
      title: `${data.breaches.items.length} known data breach${data.breaches.items.length > 1 ? "es" : ""} on record`,
      reason: "Past breaches affect user trust. Ensure affected users were notified and credentials were reset.",
      effort: "Review breach details in Security tab",
      axis: "reputation",
      severity: "medium",
      impact: 30,
    });
  }

  // ─── Cross-axis insights (the differentiator) ─────────────────────
  if (axes) {
    const measured = (Object.entries(axes) as [AxisName, (typeof axes)[AxisName]][]).filter(
      ([, v]) => !v.not_measured && v.score != null,
    );

    if (measured.length >= 2) {
      const sorted = [...measured].sort((a, b) => (a[1].score ?? 0) - (b[1].score ?? 0));
      const weakest = sorted[0];
      const strongest = sorted[sorted.length - 1];

      const axisLabels: Record<AxisName, string> = {
        security: "Security",
        speed: "Speed",
        foundations: "Foundations",
        reputation: "Reputation",
        discoverability: "Discoverability",
        email: "Email",
      };
      const axisAdvice: Record<AxisName, string> = {
        security: "headers, email auth, and TLS configuration",
        speed: "page speed, compression, and script optimization",
        foundations: "DNS, networking, and hosting health",
        reputation: "email authentication, domain registration, and compliance",
        discoverability: "structured data, social meta, and accessibility",
        email: "SPF, DKIM, DMARC, and email transport security",
      };

      if (weakest[1].score != null && strongest[1].score != null && strongest[1].score - weakest[1].score >= 15) {
        items.push({
          title: `Biggest opportunity: ${axisLabels[weakest[0]]}`,
          reason: `${axisLabels[weakest[0]]} (${weakest[1].score}) is your lowest axis while ${axisLabels[strongest[0]]} (${strongest[1].score}) is strong. Focus on ${axisAdvice[weakest[0]]} for the most impact on your overall score.`,
          effort: "See recommendations above",
          axis: weakest[0],
          severity: "medium",
          impact: 80,
        });
      }

      const secScore = axes.security?.score ?? 0;
      const perfScore = axes.speed?.score ?? 0;
      if (secScore >= 85 && perfScore < 70 && weakest[0] !== "speed") {
        items.push({
          title: "Security is solid — performance is the bottleneck",
          reason: `Security scores well (${secScore}) but performance (${perfScore}) is holding back the overall grade. Optimization effort here has the best ROI.`,
          effort: "Focus on performance items above",
          axis: "speed",
          severity: "medium",
          impact: 65,
        });
      }

      if (axes.security?.score != null && axes.reputation?.score != null) {
        const secFindings = axes.security.findings || [];
        const repFindings = axes.reputation.findings || [];
        const emailSecIssue = secFindings.some(
          (f) =>
            f.severity !== "good" &&
            (f.signal?.includes("email") ||
              f.label?.toLowerCase().includes("dkim") ||
              f.label?.toLowerCase().includes("spf")),
        );
        const emailRepIssue = repFindings.some(
          (f) =>
            f.severity !== "good" &&
            (f.label?.toLowerCase().includes("email") || f.label?.toLowerCase().includes("authentication")),
        );
        if (emailSecIssue && emailRepIssue) {
          items.push({
            title: "Email auth impacts both security and reputation scores",
            reason:
              "Incomplete email authentication is dragging down two categories at once. Completing SPF + DKIM + DMARC is the highest-leverage single fix.",
            effort: "~1 hour total",
            axis: "security",
            severity: "medium",
            impact: 72,
          });
        }
      }
    }

    const notMeasured = (Object.entries(axes) as [AxisName, (typeof axes)[AxisName]][]).filter(
      ([, v]) => v.not_measured,
    );
    if (notMeasured.length > 0) {
      const names = notMeasured.map(([k]) => k).join(", ");
      items.push({
        title: "Some checks couldn't complete",
        reason: `${names} could not be measured — results may be incomplete. This can happen when the site blocks automated requests.`,
        effort: "",
        axis: "info",
        severity: "low",
        impact: 10,
      });
    }
  }

  // ─── Sort by impact, dedup by axis-severity ───────────────────────
  items.sort((a, b) => b.impact - a.impact);

  if (items.length > 5) {
    const top5 = items.slice(0, 5);
    const hasCrossAxis = top5.some(
      (i) =>
        i.title.startsWith("Biggest opportunity") ||
        i.title.startsWith("Security is solid") ||
        i.title.startsWith("Email auth impacts"),
    );
    if (!hasCrossAxis) {
      const crossIdx = items.findIndex(
        (i) =>
          i.title.startsWith("Biggest opportunity") ||
          i.title.startsWith("Security is solid") ||
          i.title.startsWith("Email auth impacts"),
      );
      if (crossIdx >= 5) {
        const [crossItem] = items.splice(crossIdx, 1);
        items.splice(4, 0, crossItem);
      }
    }
  }

  return items;
}

// ─── Level-Up Plan Engine ────────────────────────────────────────────
// TIER_THRESHOLDS, SEVERITY_SCORES, AXIS_WEIGHTS imported from signal-registry (single source of truth)

interface LevelUpItem {
  signal: string;
  label: string;
  axis: Axis;
  currentSeverity: Severity;
  weight: number;
  pointGain: number; // estimated composite score improvement
  fixDescription: string;
  fixLink: { url: string; label: string } | null;
}

/** Missing canBeGood signal that the site could earn */
interface LevelUpOpportunity {
  signal: string;
  label: string;
  axis: Axis;
  weight: number;
  pointGain: number; // estimated composite score improvement if earned
  description: string;
  effort?: string;
}

interface ScoreDragItem {
  signal: string;
  label: string;
  axis: Axis;
  currentSeverity: Severity;
  weight: number;
  pointCost: number; // how much this drags composite score down
}

/** Residual score factor that explains an unexplained gap in an axis score. */
interface ScoreFactorItem {
  axis: Axis;
  /** Points of the axis score accounted for by this factor */
  axisDeduction: number;
  /** Composite impact (axis deduction × axis weight / total weight) */
  compositeImpact: number;
  /** Human-readable reason */
  reason: string;
  /** Absent signals that make up this factor */
  signals: Array<{
    signal: string;
    label: string;
    weight: number;
    fixDescription?: string;
    effort?: string;
    actionable: boolean;
  }>;
}

function getNextTier(currentTier: string): { tier: string; min: number } | null {
  const idx = TIER_THRESHOLDS.findIndex((t) => t.tier === currentTier);
  if (idx <= 0) return null; // already Excellent or unknown
  return TIER_THRESHOLDS[idx - 1];
}

// ─── Server-aligned scoring ──────────────────────────────────────────
// The server uses budget-based deductive scoring (start at 100, subtract).
// The client uses server-returned deductions[] per axis for Level-Up
// simulations, eliminating any client-side scoring divergence.

// Estimate axis score improvement from fixing a signal, using server deductions.
// For an existing finding with a known deduction, gain = that deduction.
// For absent signals becoming "good", estimate from the absent pool share reduction.
function estimateSignalGain(
  axisData: {
    score: number | null;
    deductions?: Array<{
      signal: string;
      deduction: number;
      share: number;
      weight: number;
    }>;
  },
  signalId: string,
): number {
  if (!axisData.deductions) return 0;
  const ded = axisData.deductions.find((d) => d.signal === signalId);
  return ded ? ded.deduction : 0;
}

function generateLevelUpPlan(data: AnalysisResult): {
  items: LevelUpItem[];
  opportunities: LevelUpOpportunity[];
  drags: ScoreDragItem[];
  scoreFactors: ScoreFactorItem[];
  currentScore: number;
  currentTier: string;
  targetTier: string;
  targetThreshold: number;
  pointsNeeded: number;
  projectedComposite: number;
} | null {
  const score = data.domain_score;
  if (!score) return null;

  const currentScore = score.composite;
  const currentTier = score.tier;
  const next = getNextTier(currentTier);

  // For Excellent-tier domains, target score 100 instead of a tier threshold
  const isExcellent = !next;
  const targetThreshold = isExcellent ? 100 : next!.min;
  const targetTier = isExcellent ? "Excellent" : next!.tier;
  const pointsNeeded = targetThreshold - currentScore;
  if (pointsNeeded <= 0 && isExcellent) {
    // Perfect score — nothing to improve
    // Still continue to collect items for display
  } else if (pointsNeeded <= 0) {
    return null;
  }

  const items: LevelUpItem[] = [];

  // Build current axis scores map for composite simulation
  const currentAxisScores: Record<string, number> = {};
  // Track which axes are assessed (not not_measured) for weight renormalization
  const assessedAxes: string[] = [];
  // Build deduction lookup per axis for signal gain estimation
  const axisDeductions: Record<
    string,
    Array<{
      signal: string;
      deduction: number;
      share: number;
      weight: number;
      absentSignals?: AbsentSignalDetailData[];
    }>
  > = {};
  for (const [axisName, axisData] of Object.entries(score.axes) as [Axis, (typeof score.axes)[Axis]][]) {
    if (axisData.not_measured || axisData.score == null) {
      // Exclude not_measured axes from composite calculation (matches server)
      continue;
    }
    assessedAxes.push(axisName);
    currentAxisScores[axisName] = axisData.score;
    axisDeductions[axisName] = (axisData as any).deductions ?? [];
  }

  // Helper: compute weighted arithmetic mean from axis scores with outlier floor cap.
  // Only includes assessed axes with renormalized weights (matches server behavior).
  function compositeFromAxes(axisScoresMap: Record<string, number>): number {
    if (assessedAxes.length === 0) return 0;
    const totalWeight = assessedAxes.reduce((sum, a) => sum + (AXIS_WEIGHTS[a as Axis] ?? 0), 0);
    let weightedSum = 0;
    for (const axis of assessedAxes) {
      const normalizedWeight = (AXIS_WEIGHTS[axis as Axis] ?? 0) / totalWeight;
      weightedSum += normalizedWeight * (axisScoresMap[axis] ?? 0);
    }
    let score = Math.max(0, Math.min(100, Math.round(weightedSum)));
    // Outlier floor: if ANY assessed axis < 40, cap at 74 (Moderate ceiling)
    const hasLowOutlier = assessedAxes.some((a) => (axisScoresMap[a] ?? 0) < 40);
    if (hasLowOutlier && score > 74) {
      score = 74;
    }
    return score;
  }

  // For each axis, find non-good findings and compute what fixing each one would do
  for (const [axisName, axisData] of Object.entries(score.axes) as [Axis, (typeof score.axes)[Axis]][]) {
    if (axisData.not_measured || !axisData.findings) continue;

    for (const finding of axisData.findings) {
      if (finding.severity === "good") continue;

      // Skip non-actionable signals — derived from signal-registry (single source of truth)
      if (NON_ACTIONABLE_SIGNALS.includes(finding.signal)) continue;

      // Use server-returned deductions to determine score gain from fixing this signal
      const signalGain = estimateSignalGain(
        { score: axisData.score, deductions: axisDeductions[axisName] },
        finding.signal,
      );
      const newAxisScore = Math.max(0, Math.min(100, Math.round((axisData.score ?? 0) + signalGain)));

      // Compute composite delta using weighted arithmetic mean
      const simScores = { ...currentAxisScores, [axisName]: newAxisScore };
      const newComposite = compositeFromAxes(simScores);
      const compositeDelta = Math.round((newComposite - currentScore) * 10) / 10;

      if (compositeDelta < 0.1) continue; // negligible impact

      // Fix description from signal-registry (single source of truth)
      const signalKey = finding.signal.toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const fixDescription = FIX_DESC_MAP[signalKey] || finding.label;

      items.push({
        signal: finding.signal,
        label: finding.label,
        axis: axisName,
        currentSeverity: finding.severity,
        weight: finding.weight,
        pointGain: compositeDelta,
        fixDescription,
        fixLink: getFixLink(finding, data),
      });
    }
  }

  // Sort by biggest impact first
  items.sort((a, b) => b.pointGain - a.pointGain);

  // ── Positive Opportunities ──────────────────────────────────────
  // Surface canBeGood signals that didn't fire — actionable improvements
  // the user could earn that aren't in the current findings.
  const opportunities: LevelUpOpportunity[] = [];
  {
    // Build set of all signals that fired (any severity)
    const firedSignals = new Set<string>();
    for (const [, axisData] of Object.entries(score.axes) as [Axis, (typeof score.axes)[Axis]][]) {
      if (!axisData.findings) continue;
      for (const f of axisData.findings) {
        firedSignals.add(f.signal);
      }
    }

    // Get the scoring context from the score result (cookies, wordpress detection)
    const scoringCtx = score.scoringContext;

    for (const [signalId, def] of Object.entries(SIGNAL_REGISTRY)) {
      if (!def.canBeGood) continue;
      if (firedSignals.has(signalId)) continue; // already present
      if (def.weightRange[1] === 0) continue; // zero-weight signals don't affect score
      if (!def.actionable) continue; // non-actionable signals aren't user-fixable

      // Skip signals whose required context isn't present
      if (def.requiresContext && !scoringCtx?.[def.requiresContext as keyof typeof scoringCtx]) continue;

      // Simulate adding this signal as "good" to its axis
      const axisName = def.axis;
      const axisData = score.axes[axisName];
      if (!axisData || axisData.not_measured) continue;

      // Estimate gain: adding a new good signal reduces the _absent deduction pool
      // proportional to this signal's weight / total absent weight
      const deds = axisDeductions[axisName] || [];
      const absentDed = deds.find((d) => d.signal === "_absent");
      let signalGain = 0;
      if (absentDed && absentDed.weight > 0) {
        signalGain = (def.weightRange[1] / absentDed.weight) * absentDed.deduction;
      }
      const newAxisScore = Math.max(0, Math.min(100, Math.round((axisData.score ?? 0) + signalGain)));
      const simScores = { ...currentAxisScores, [axisName]: newAxisScore };
      const newComposite = compositeFromAxes(simScores);
      const compositeDelta = Math.round((newComposite - currentScore) * 10) / 10;

      if (compositeDelta < 0.1) continue; // negligible impact

      opportunities.push({
        signal: signalId,
        label: def.label,
        axis: axisName,
        weight: def.weightRange[1],
        pointGain: compositeDelta,
        description: def.fixDescription || def.label,
        effort: def.effort,
      });
    }

    opportunities.sort((a, b) => b.pointGain - a.pointGain);
  }

  // Collect non-actionable score drags — things hurting the score that can't be fixed
  const drags: ScoreDragItem[] = [];
  for (const [axisName, axisData] of Object.entries(score.axes) as [Axis, (typeof score.axes)[Axis]][]) {
    if (axisData.not_measured || !axisData.findings) continue;

    for (const finding of axisData.findings) {
      if (finding.severity === "good" || finding.severity === "info") continue;
      if (!SCORE_DRAG_SIGNALS.includes(finding.signal)) continue;

      // Use server deductions to determine the score cost of this drag
      const signalGain = estimateSignalGain(
        { score: axisData.score, deductions: axisDeductions[axisName] },
        finding.signal,
      );
      const newAxisScore = Math.max(0, Math.min(100, Math.round((axisData.score ?? 0) + signalGain)));
      const simScores = { ...currentAxisScores, [axisName]: newAxisScore };
      const newComposite = compositeFromAxes(simScores);
      const costDelta = Math.round((newComposite - currentScore) * 10) / 10;

      if (costDelta < 0.1) continue;

      drags.push({
        signal: finding.signal,
        label: finding.label,
        axis: axisName,
        currentSeverity: finding.severity,
        weight: finding.weight,
        pointCost: costDelta,
      });
    }
  }

  drags.sort((a, b) => b.pointCost - a.pointCost);

  // ── Score Factors: account for 100% of the gap ─────────────────
  // For every axis, compute how much of the (100 − score) gap is
  // already explained by items + opportunities + drags. Any residual
  // comes from absent-signal deductions that individually fell below
  // the composite threshold. Surface those as grouped "score factor" entries
  // so no axis has an unexplained deficit.
  const scoreFactors: ScoreFactorItem[] = [];
  {
    // Build lookup of explained deduction per axis
    const explainedPerAxis: Record<string, number> = {};
    for (const item of items) {
      const deds = axisDeductions[item.axis] || [];
      const ded = deds.find((d) => d.signal === item.signal);
      explainedPerAxis[item.axis] = (explainedPerAxis[item.axis] ?? 0) + (ded?.deduction ?? 0);
    }
    for (const opp of opportunities) {
      const deds = axisDeductions[opp.axis] || [];
      const absentDed = deds.find((d) => d.signal === "_absent");
      if (absentDed && absentDed.weight > 0) {
        const oppGain = (opp.weight / absentDed.weight) * absentDed.deduction;
        explainedPerAxis[opp.axis] = (explainedPerAxis[opp.axis] ?? 0) + oppGain;
      }
    }
    for (const drag of drags) {
      const deds = axisDeductions[drag.axis] || [];
      const ded = deds.find((d) => d.signal === drag.signal);
      explainedPerAxis[drag.axis] = (explainedPerAxis[drag.axis] ?? 0) + (ded?.deduction ?? 0);
    }

    // Compute total axis weight for composite impact estimation
    const totalAssessedWeight = assessedAxes.reduce((sum, a) => sum + (AXIS_WEIGHTS[a as Axis] ?? 0), 0);

    for (const axisName of assessedAxes) {
      const axisData = score.axes[axisName as Axis];
      if (!axisData || axisData.not_measured || axisData.score == null) continue;
      const axisGap = 100 - axisData.score;
      if (axisGap <= 0) continue;

      const explained = explainedPerAxis[axisName] ?? 0;
      const residual = axisGap - explained;
      if (residual < 0.5) continue; // close enough

      // Pull absent signal details from the _absent deduction
      const deds = axisDeductions[axisName] || [];
      const absentDed = deds.find((d) => d.signal === "_absent");
      const absentSignalDetails = absentDed?.absentSignals;

      // Filter out signals already surfaced as opportunities
      const opportunitySignals = new Set(opportunities.filter((o) => o.axis === axisName).map((o) => o.signal));
      const residualSignals = (absentSignalDetails ?? []).filter((s) => !opportunitySignals.has(s.signal));

      const axisWeight = AXIS_WEIGHTS[axisName as Axis] ?? 0;
      const compositeImpact =
        totalAssessedWeight > 0 ? Math.round(residual * (axisWeight / totalAssessedWeight) * 10) / 10 : 0;

      const signalCount = residualSignals.length;
      const reason =
        signalCount > 0
          ? `${signalCount} signal${signalCount === 1 ? "" : "s"} not detected in scan`
          : "Signals not detected in scan";

      scoreFactors.push({
        axis: axisName as Axis,
        axisDeduction: Math.round(residual * 10) / 10,
        compositeImpact,
        reason,
        signals: residualSignals,
      });
    }
    scoreFactors.sort((a, b) => b.compositeImpact - a.compositeImpact);
  }

  // If Excellent and nothing to show at all, return null
  if (
    isExcellent &&
    items.length === 0 &&
    opportunities.length === 0 &&
    drags.length === 0 &&
    scoreFactors.length === 0
  )
    return null;

  // Compute projected composite by simulating ALL fixes at once via compositeFromAxes.
  // Individual pointGain values are computed independently (each assumes only that
  // one fix), so summing them double-counts the interaction effect.
  // Instead: for each axis, sum the deductions for all actionable findings
  // plus the proportion of the absent pool that would be recovered by opportunities.
  const allFixedAxisScores = { ...currentAxisScores };
  for (const [axisName, axisData] of Object.entries(score.axes) as [Axis, (typeof score.axes)[Axis]][]) {
    if (axisData.not_measured || axisData.score == null) continue;
    const actionableSignals = new Set(items.filter((i) => i.axis === axisName).map((i) => i.signal));
    const axisOpportunities = opportunities.filter((o) => o.axis === axisName);
    if (actionableSignals.size === 0 && axisOpportunities.length === 0) continue;

    // Sum deductions for all actionable signals being fixed
    const deds = axisDeductions[axisName] || [];
    let totalGain = 0;
    for (const ded of deds) {
      if (actionableSignals.has(ded.signal)) {
        totalGain += ded.deduction;
      }
    }
    // Add opportunity gains from reducing absent pool
    const absentDed = deds.find((d) => d.signal === "_absent");
    if (absentDed && absentDed.weight > 0) {
      const oppWeightSum = axisOpportunities.reduce((sum, o) => sum + o.weight, 0);
      totalGain += (Math.min(oppWeightSum, absentDed.weight) / absentDed.weight) * absentDed.deduction;
    }
    allFixedAxisScores[axisName] = Math.max(0, Math.min(100, Math.round(axisData.score + totalGain)));
  }
  const projectedComposite = compositeFromAxes(allFixedAxisScores);

  return {
    items,
    opportunities,
    drags,
    scoreFactors,
    currentScore,
    currentTier,
    targetTier,
    targetThreshold,
    pointsNeeded,
    projectedComposite,
  };
}

// ─── Resources / How-to-Fix Links ───────────────────────────────────

function detectTechStack(data: AnalysisResult): {
  isWordPress: boolean;
  isCloudflare: boolean;
  cdn: string | null;
  server: string | null;
} {
  const isWordPress = !!data.wordpress?.detected;
  const isCloudflare = !!(
    data.hosting?.cdn?.toLowerCase().includes("cloudflare") ||
    data.hosting?.provider?.toLowerCase().includes("cloudflare")
  );
  const cdn = data.hosting?.cdn || null;
  const server = data.hosting?.provider || null;
  return { isWordPress, isCloudflare, cdn, server };
}

function getFixLink(finding: ScoreFinding, data: AnalysisResult): { url: string; label: string } | null {
  const { isWordPress, isCloudflare } = detectTechStack(data);
  const sig = finding.signal.toLowerCase();

  // HSTS
  if (sig.includes("hsts") || sig === "strict-transport-security" || finding.label.toLowerCase().includes("hsts")) {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/",
        label: "Cloudflare HSTS docs",
      };
    if (isWordPress)
      return {
        url: "https://developer.wordpress.org/advanced-administration/security/hsts/",
        label: "WordPress HSTS guide",
      };
    return {
      url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security",
      label: "MDN HSTS reference",
    };
  }

  // CSP
  if (sig.includes("csp") || sig.includes("content_security") || sig === "content-security-policy") {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/workers/examples/security-headers/",
        label: "Cloudflare security headers",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP", label: "MDN CSP guide" };
  }

  // DMARC
  if (sig.includes("dmarc") || sig === "dmarc_policy") {
    return { url: "https://dmarc.org/overview/", label: "DMARC setup guide" };
  }

  // SPF
  if (sig.includes("spf") || sig === "email_spf") {
    return { url: "https://www.cloudflare.com/learning/dns/dns-records/dns-spf-record/", label: "SPF record guide" };
  }

  // DKIM
  if (sig.includes("dkim") || sig === "email_dkim") {
    return { url: "https://www.cloudflare.com/learning/dns/dns-records/dns-dkim-record/", label: "DKIM setup guide" };
  }

  // Structured data
  if (sig.includes("structured") || sig.includes("json_ld") || sig === "structured_data") {
    if (isWordPress)
      return { url: "https://yoast.com/structured-data-schema-ultimate-guide/", label: "Yoast structured data guide" };
    return {
      url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
      label: "Google structured data guide",
    };
  }

  // Compression
  if (sig.includes("compression") || sig === "compression") {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/speed/optimization/content/brotli/",
        label: "Cloudflare Brotli compression",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Compression", label: "MDN compression guide" };
  }

  // HTTP/2
  if (sig.includes("http2") || sig.includes("http_protocol") || sig === "http2") {
    if (isCloudflare)
      return {
        url: "https://developers.cloudflare.com/speed/optimization/protocol/http2/",
        label: "Cloudflare HTTP/2 docs",
      };
    return { url: "https://developer.mozilla.org/en-US/docs/Glossary/HTTP_2", label: "MDN HTTP/2 reference" };
  }

  // DNSSEC
  if (sig.includes("dnssec")) {
    if (isCloudflare) return { url: "https://developers.cloudflare.com/dns/dnssec/", label: "Cloudflare DNSSEC docs" };
    return {
      url: "https://www.icann.org/resources/pages/dnssec-what-is-it-why-is-it-important-2019-03-05-en",
      label: "DNSSEC overview",
    };
  }

  // CAA
  if (sig.includes("caa")) {
    return {
      url: "https://blog.qualys.com/product-tech/2017/03/13/caa-mandated-by-cabrowser-forum",
      label: "CAA records guide",
    };
  }

  // Accessibility
  if (sig.includes("accessibility") || sig.includes("a11y")) {
    return { url: "https://www.w3.org/WAI/tips/developing/", label: "W3C accessibility tips" };
  }

  // Security.txt
  if (sig.includes("security_txt")) {
    return { url: "https://securitytxt.org/", label: "security.txt generator" };
  }

  // Social meta
  if (sig.includes("social_meta") || sig.includes("og_") || sig.includes("twitter_")) {
    return { url: "https://ogp.me/", label: "Open Graph protocol docs" };
  }

  // rel="me" verification
  if (sig.includes("social_verified") || sig.includes("social_not_verified")) {
    return { url: "https://indieweb.org/rel-me", label: 'rel="me" verification guide' };
  }

  // Sitemap
  if (sig.includes("sitemap")) {
    return {
      url: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
      label: "Google sitemap guide",
    };
  }

  // SSL/TLS
  if (sig.includes("ssl") || sig.includes("tls")) {
    if (isCloudflare)
      return { url: "https://developers.cloudflare.com/ssl/edge-certificates/", label: "Cloudflare SSL docs" };
    return { url: "https://www.ssllabs.com/ssltest/", label: "SSL Labs test" };
  }

  return null;
}

// ─── Quick Wins Filter ──────────────────────────────────────────────

/** Unified quick win classification — used by both the Quick Wins section and the ⚡ badge */
function isQuickWinItem(item: { effort: string; severity?: string }): boolean {
  const effort = item.effort.toLowerCase();
  const isQuickEffort =
    effort.includes("5 min") ||
    effort.includes("10 min") ||
    effort.includes("15 min") ||
    effort.includes("30 min") ||
    effort.includes("one-line") ||
    effort.includes("one response header");
  const isHighImpact = item.severity === "high" || item.severity === "critical";
  return isQuickEffort || (isHighImpact && effort.includes("min"));
}

function getQuickWins(actionItems: ActionItem[]): ActionItem[] {
  return actionItems.filter(isQuickWinItem).slice(0, 6);
}

// ─── BYO Key helpers ────────────────────────────────────────────────

const STORAGE_KEY = "yoke_openrouter_key";
const MODEL_STORAGE_KEY = "yoke_openrouter_model";
const CUSTOM_PROMPT_KEY = "yoke_custom_prompt";
const SETTINGS_OPEN_KEY = "yoke_settings_open";

const AVAILABLE_MODELS = [
  { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3", provider: "DeepSeek" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "anthropic/claude-opus-4", label: "Claude Opus 4", provider: "Anthropic" },
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "OpenAI" },
  { id: "openai/o3", label: "o3", provider: "OpenAI" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "Google" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick", provider: "Meta" },
];

function getSavedKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
function saveKey(key: string) {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
function getSavedModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE_KEY) || "deepseek/deepseek-chat-v3-0324";
  } catch {
    return "deepseek/deepseek-chat-v3-0324";
  }
}
function saveModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    /* noop */
  }
}
function getCustomPrompt(): string {
  try {
    return localStorage.getItem(CUSTOM_PROMPT_KEY) || "";
  } catch {
    return "";
  }
}
function saveCustomPrompt(prompt: string) {
  try {
    if (prompt) localStorage.setItem(CUSTOM_PROMPT_KEY, prompt);
    else localStorage.removeItem(CUSTOM_PROMPT_KEY);
  } catch {
    /* noop */
  }
}
function getSettingsOpen(): boolean {
  try {
    return localStorage.getItem(SETTINGS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}
function saveSettingsOpen(open: boolean) {
  try {
    localStorage.setItem(SETTINGS_OPEN_KEY, String(open));
  } catch {
    /* noop */
  }
}

// ─── Advanced Settings Panel ────────────────────────────────────────

function AdvancedSettings({
  domain,
  onKeyChange,
  onModelChange,
}: {
  domain: string;
  onKeyChange: (key: string) => void;
  onModelChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(getSettingsOpen);
  const [keyValue, setKeyValue] = useState(getSavedKey);
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [model, setModel] = useState(getSavedModel);
  const [promptText, setPromptText] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptEdited, setPromptEdited] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const hasKey = !!getSavedKey();

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    saveSettingsOpen(next);
    if (next && !promptText && domain) {
      loadPrompt();
    }
  };

  // Load prompt when panel starts open (e.g. persisted in localStorage)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only re-run on domain change to avoid infinite loops
  useEffect(() => {
    if (open && !promptText && domain) {
      loadPrompt();
    }
  }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPrompt = async () => {
    setPromptLoading(true);
    try {
      const res = await fetch("/api/ai-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (res.ok) {
        const data = (await res.json()) as { system: string; user: string };
        const fullPrompt = `${data.system}\n\n---\n\n${data.user}`;
        setDefaultPrompt(fullPrompt);
        const custom = getCustomPrompt();
        setPromptText(custom || fullPrompt);
        setPromptEdited(!!custom);
      }
    } catch {
      /* noop */
    }
    setPromptLoading(false);
  };

  const handleKeySave = () => {
    const trimmed = keyValue.trim();
    saveKey(trimmed);
    onKeyChange(trimmed);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const handleKeyRemove = () => {
    setKeyValue("");
    saveKey("");
    onKeyChange("");
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    saveModel(newModel);
    onModelChange(newModel);
  };

  const handlePromptChange = (newText: string) => {
    setPromptText(newText);
    setPromptEdited(newText !== defaultPrompt);
    saveCustomPrompt(newText === defaultPrompt ? "" : newText);
  };

  const handlePromptReset = () => {
    setPromptText(defaultPrompt);
    setPromptEdited(false);
    saveCustomPrompt("");
  };

  const handlePromptCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  return (
    <div style={{ width: open ? "100%" : "auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={toggleOpen}
          title="Advanced AI settings"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "4px 10px",
            borderRadius: "6px",
            border: `1px solid ${hasKey ? "var(--success)" : "var(--border)"}`,
            background: hasKey ? "rgba(46,160,67,0.08)" : open ? "rgba(88,166,255,0.08)" : "transparent",
            color: hasKey ? "var(--success)" : open ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            fontSize: "11px",
            transition: "all 0.15s",
          }}
        >
          <Settings size={12} style={{ transition: "transform 0.3s", transform: open ? "rotate(90deg)" : "none" }} />
          {hasKey ? "BYO Key ✓" : "Advanced"}
          {hasKey && (
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "var(--success)",
                display: "inline-block",
              }}
            />
          )}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: "10px",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {/* API Key Section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Key size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>OpenRouter API Key</span>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "10px",
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                Get a free key <ExternalLink size={9} />
              </a>
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)", margin: "0 0 8px 0", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 6px 0" }}>
                <strong style={{ color: "var(--text)" }}>Why?</strong> Yoke's AI analysis uses{" "}
                <a
                  href="https://openrouter.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  OpenRouter
                </a>{" "}
                to access models like DeepSeek, Claude, GPT-4o, and Gemini. Without a key, you get 10 analyses/hr on our
                shared key. With your own, you get unlimited access, model selection, and prompt editing.
              </p>
              <p style={{ margin: "0" }}>
                <strong style={{ color: "var(--text)" }}>Privacy:</strong> Your key is stored in your browser's
                localStorage and sent to Yoke's server when you request an AI analysis. We don't log or store your key —
                it's used only for that single API call to OpenRouter and then discarded.{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  Privacy policy →
                </a>
              </p>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleKeySave();
                  }}
                  placeholder="sk-or-v1-..."
                  style={{
                    width: "100%",
                    padding: "7px 32px 7px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: "12px",
                    outline: "none",
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  title={showKey ? "Hide key" : "Show key"}
                  style={{
                    position: "absolute",
                    right: "6px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--muted)",
                    padding: "2px",
                    display: "flex",
                  }}
                >
                  {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
              <button
                type="button"
                onClick={handleKeySave}
                style={{
                  padding: "7px 14px",
                  borderRadius: "6px",
                  border: "1px solid var(--accent)",
                  background: "rgba(88,166,255,0.1)",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {keySaved ? "Saved!" : "Save"}
              </button>
            </div>
            {hasKey && (
              <button
                type="button"
                onClick={handleKeyRemove}
                style={{
                  marginTop: "6px",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  border: "none",
                  background: "transparent",
                  color: "var(--danger)",
                  cursor: "pointer",
                  fontSize: "11px",
                }}
              >
                Remove key
              </button>
            )}
          </div>

          {/* Model Selector */}
          <div style={{ opacity: hasKey ? 1 : 0.45, pointerEvents: hasKey ? "auto" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Sparkles size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Model</span>
              {!hasKey && (
                <span style={{ fontSize: "10px", color: "var(--muted)", fontStyle: "italic" }}>requires API key</span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
              {AVAILABLE_MODELS.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => handleModelChange(m.id)}
                  disabled={!hasKey}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    border: `1px solid ${model === m.id ? "var(--accent)" : "var(--border)"}`,
                    background: model === m.id ? "rgba(88,166,255,0.12)" : "var(--bg)",
                    color: model === m.id ? "var(--accent)" : "var(--muted)",
                    cursor: hasKey ? "pointer" : "default",
                    fontSize: "11px",
                    fontWeight: model === m.id ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {m.label}
                  <span style={{ fontSize: "9px", opacity: 0.6, marginLeft: "4px" }}>{m.provider}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Editor */}
          <div style={{ opacity: hasKey ? 1 : 0.45, pointerEvents: hasKey ? "auto" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <Sparkles size={12} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Prompt</span>
              {!hasKey && (
                <span style={{ fontSize: "10px", color: "var(--muted)", fontStyle: "italic" }}>requires API key</span>
              )}
              {promptEdited && (
                <span
                  style={{
                    fontSize: "9px",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    background: "rgba(210,153,34,0.15)",
                    color: "var(--warning)",
                  }}
                >
                  edited
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
                {promptEdited && (
                  <button
                    type="button"
                    onClick={handlePromptReset}
                    title="Reset to default"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "10px",
                    }}
                  >
                    <RotateCcw size={9} /> Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePromptCopy}
                  title="Copy prompt"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: "10px",
                  }}
                >
                  {promptCopied ? <Check size={9} /> : <Copy size={9} />}
                  {promptCopied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: "10px", color: "var(--muted)", margin: "0 0 6px 0", lineHeight: 1.4 }}>
              This is the exact prompt sent to the AI. Edit it to focus the analysis on what matters to you.
            </p>
            {promptLoading ? (
              <div
                style={{
                  height: "200px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  background: "var(--bg)",
                }}
              >
                <Loader2 size={14} style={{ color: "var(--muted)", animation: "spin 1s linear infinite" }} />
                <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "8px" }}>Loading prompt…</span>
              </div>
            ) : (
              <textarea
                value={promptText}
                onChange={(e) => handlePromptChange(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  height: "240px",
                  padding: "10px",
                  borderRadius: "6px",
                  border: `1px solid ${promptEdited ? "var(--warning)" : "var(--border)"}`,
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "11px",
                  fontFamily: "'SF Mono', Monaco, Consolas, monospace",
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            )}
          </div>

          {/* Status footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "8px",
              borderTop: "1px solid var(--border)",
              fontSize: "10px",
              color: "var(--muted)",
            }}
          >
            <span>
              {hasKey ? (
                <>
                  Using your key · <span style={{ color: "var(--success)" }}>Unlimited analysis</span>
                </>
              ) : (
                <>Platform key · 10 analyses/hr</>
              )}
            </span>
            <span style={{ opacity: 0.6 }}>
              {hasKey ? AVAILABLE_MODELS.find((m) => m.id === model)?.label || model : "DeepSeek V3"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rate Limit UI ──────────────────────────────────────────────────

function RateLimitView({ data, onKeySet }: { data: RateLimitResponse; onKeySet: (key: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.diy_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* fallback */
    }
  };

  const handleKeySave = () => {
    const trimmed = keyInput.trim();
    if (trimmed) {
      saveKey(trimmed);
      onKeySet(trimmed);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "14px",
          background: "rgba(210,153,34,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "16px",
        }}
      >
        <Zap size={24} style={{ color: "var(--warning)" }} />
      </div>
      <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>
        Daily AI limit reached ({data.used}/{data.limit})
      </h3>
      <p style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "440px", lineHeight: 1.6, marginBottom: "20px" }}>
        Yoke is free and open source — we rate-limit AI calls to manage costs, not knowledge.
      </p>

      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "16px",
          marginBottom: "14px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "8px" }}>
          Run it yourself
        </div>
        <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          Copy the analysis prompt and paste it into ChatGPT, Claude, Gemini, or any AI assistant.
        </p>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            margin: "0 auto",
            padding: "8px 18px",
            borderRadius: "8px",
            border: "1px solid var(--accent)",
            background: "rgba(88,166,255,0.1)",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy analysis prompt"}
        </button>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "460px",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "16px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            justifyContent: "center",
          }}
        >
          <Key size={14} /> Unlock unlimited analysis
        </div>
        <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
          Enter your own{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)" }}
          >
            OpenRouter API key
          </a>{" "}
          — stored locally in your browser.
        </p>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-v1-..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleKeySave();
            }}
            style={{
              flex: 1,
              padding: "7px 10px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: "12px",
              outline: "none",
              fontFamily: "monospace",
            }}
          />
          <button
            type="button"
            onClick={handleKeySave}
            style={{
              padding: "7px 14px",
              borderRadius: "6px",
              border: "1px solid var(--accent)",
              background: "rgba(88,166,255,0.1)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Save & retry
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AI Loading Indicator ───────────────────────────────────────────

const ESTIMATED_SECONDS = 45;

const LOADING_PHASES = [
  { at: 0, msg: "Preparing analysis data…" },
  { at: 3, msg: "Sending to AI model…" },
  { at: 6, msg: "Finding cross-signal correlations…" },
  { at: 14, msg: "Synthesizing insights across data points…" },
  { at: 25, msg: "Formatting structured results…" },
  { at: 38, msg: "Still working — complex domains take longer…" },
  { at: 55, msg: "Almost there…" },
];

function AILoadingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const progress = Math.min(elapsed / ESTIMATED_SECONDS, 0.95);
  const phase = [...LOADING_PHASES].reverse().find((p) => elapsed >= p.at) || LOADING_PHASES[0];

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Loader2 size={14} style={{ color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: "12px", color: "var(--text)" }}>{phase.msg}</span>
        <span
          style={{
            fontSize: "10px",
            color: "var(--muted)",
            marginLeft: "auto",
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {elapsed}s
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
      <div style={{ height: "3px", borderRadius: "2px", background: "var(--border)", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            borderRadius: "2px",
            background: "var(--accent)",
            width: `${progress * 100}%`,
            transition: "width 1s linear",
          }}
        />
      </div>
      <span style={{ fontSize: "10px", color: "var(--muted)" }}>
        Cross-signal analysis typically takes 30–45s — feel free to explore other tabs while you wait
      </span>
    </div>
  );
}

// ─── Level-Up Plan UI ────────────────────────────────────────────────

function LevelUpPlan({ data }: { data: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const plan = generateLevelUpPlan(data);

  const hasContent =
    plan &&
    (plan.items.length > 0 || plan.opportunities.length > 0 || plan.drags.length > 0 || plan.scoreFactors.length > 0);

  if (!hasContent) {
    if (data.domain_score?.composite === 100) {
      return (
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <ArrowUp size={14} style={{ color: "var(--success)" }} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>Level-Up Plan</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 0",
              fontSize: "13px",
              color: "var(--success)",
            }}
          >
            <CheckCircle2 size={14} />
            <span>Perfect score! Nothing to improve.</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const hasMore = plan.items.length > 3;

  // Use the properly-computed projected composite instead of
  // arithmetically summing individual item gains (which double-counts interaction).
  const projectedScore = plan.projectedComposite;
  // Tier thresholds from signal-registry (single source of truth)
  const projectedTier = (
    TIER_THRESHOLDS.find((t) => projectedScore >= t.min) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]
  ).tier;

  const progressPct = Math.min(
    ((plan.currentScore - (TIER_THRESHOLDS.find((t) => t.tier === plan.currentTier)?.min ?? 0)) /
      (plan.targetThreshold - (TIER_THRESHOLDS.find((t) => t.tier === plan.currentTier)?.min ?? 0))) *
      100,
    100,
  );

  const axisLabels: Record<string, string> = {
    security: "Security",
    speed: "Speed",
    foundations: "Foundations",
    reputation: "Reputation",
    discoverability: "Discoverability",
    email: "Email",
  };
  const axisColors: Record<string, string> = {
    security: "#f85149",
    speed: "#58a6ff",
    foundations: "#7ee787",
    reputation: "#d2a221",
    discoverability: "#bc8cff",
    email: "#f778ba",
  };

  // ─── Cluster items by category, each group sorted by impact ─────
  // Category groups ordered by their highest-impact item
  const groupMap = new Map<string, typeof plan.items>();
  for (const item of plan.items) {
    const group = groupMap.get(item.axis) || [];
    group.push(item);
    groupMap.set(item.axis, group);
  }
  const categoryGroups = Array.from(groupMap.entries())
    .map(([axis, groupItems]) => ({ axis: axis as Axis, items: groupItems }))
    .sort((a, b) => b.items[0].pointGain - a.items[0].pointGain);

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <ArrowUp size={14} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>Level-Up Plan</span>
        <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>
          {plan.pointsNeeded > 0
            ? `${plan.currentTier} → ${plan.targetTier}`
            : "Already Excellent — here's what would push the score higher"}
        </span>
      </div>

      {/* Progress bar toward next grade */}
      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {plan.currentScore} pts ({plan.currentTier})
          </span>
          <span style={{ color: "var(--muted)" }}>
            {plan.pointsNeeded > 0 ? `${plan.targetThreshold} pts (${plan.targetTier})` : "100 pts"}
          </span>
        </div>
        <div style={{ height: "6px", borderRadius: "3px", background: "var(--border)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              borderRadius: "3px",
              background: "linear-gradient(90deg, var(--accent), #7ee787)",
              width: `${Math.max(5, progressPct)}%`,
              transition: "width 0.5s ease",
            }}
          />
        </div>
        <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "3px" }}>
          {plan.items.length > 0 || plan.opportunities.length > 0
            ? plan.pointsNeeded > 0
              ? `Need +${plan.pointsNeeded} points · addressing all items below → ${projectedScore} pts (${projectedTier})`
              : `Addressing all items below → ${projectedScore} pts (${projectedTier})`
            : `Score breakdown for this domain`}
        </div>
      </div>

      {/* Fix items — clustered by category */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {categoryGroups.map(({ axis, items: groupItems }) => {
          const visibleGroupItems = expanded ? groupItems : groupItems.slice(0, 3);
          return (
            <div key={axis}>
              {/* Category header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "6px",
                  paddingBottom: "4px",
                  borderBottom: `2px solid ${axisColors[axis] || "var(--border)"}`,
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: axisColors[axis] || "var(--muted)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text)" }}>
                  {axisLabels[axis] || axis}
                </span>
                <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                  {groupItems.length} {groupItems.length === 1 ? "item" : "items"} · +
                  {groupItems.reduce((s, it) => s + it.pointGain, 0).toFixed(1)} pts
                </span>
              </div>
              <ol
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {visibleGroupItems.map((item, i) => (
                  <li
                    key={`${item.signal}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      background: "rgba(88,166,255,0.03)",
                      border: "1px solid rgba(88,166,255,0.08)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
                          {item.fixDescription}
                        </span>
                        {item.fixLink && (
                          <a
                            href={item.fixLink.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={item.fixLink.label}
                            style={{
                              color: "var(--accent)",
                              display: "flex",
                              alignItems: "center",
                              opacity: 0.6,
                              transition: "opacity 0.15s",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                          >
                            <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          marginTop: "3px",
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            borderRadius: "3px",
                            background: severityBg(item.currentSeverity),
                            color: severityColor(item.currentSeverity),
                            fontWeight: 600,
                          }}
                        >
                          {item.currentSeverity}
                        </span>
                        <span style={{ fontSize: "10px", color: "var(--success)", fontWeight: 600 }}>
                          +{item.pointGain.toFixed(1)} pts
                        </span>
                      </div>
                      {item.label !== item.fixDescription && (
                        <div style={{ fontSize: "10px", color: "var(--dim)", marginTop: "2px" }}>
                          Current: {item.label}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 0 0",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "11px",
            color: "var(--muted)",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Show all recommendations
            </>
          )}
        </button>
      )}

      {/* Non-actionable score drags */}
      {plan.opportunities.length > 0 && (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <Zap size={11} style={{ color: "var(--green)" }} />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)" }}>Additional opportunities</span>
            <span style={{ fontSize: "10px", color: "var(--green)" }}>
              +{plan.opportunities.reduce((s, o) => s + o.pointGain, 0).toFixed(1)} pts
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {plan.opportunities.map((opp, i) => (
              <div
                key={`${opp.signal}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "5px 8px",
                  borderRadius: "4px",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: axisColors[opp.axis] || "var(--muted)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {opp.description}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  {opp.effort && <span style={{ fontSize: "9px", color: "var(--dim)" }}>{opp.effort}</span>}
                  <span style={{ fontSize: "10px", color: "var(--green)", fontWeight: 600 }}>
                    +{opp.pointGain.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Beyond your control */}
      {plan.drags.length > 0 && (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <Lock size={11} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)" }}>Beyond your control</span>
            <span style={{ fontSize: "10px", color: "var(--dim)" }}>
              −{plan.drags.reduce((s, d) => s + d.pointCost, 0).toFixed(1)} pts
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {plan.drags.map((drag, i) => (
              <div
                key={`${drag.signal}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "5px 8px",
                  borderRadius: "4px",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: axisColors[drag.axis] || "var(--muted)",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {drag.label}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 5px",
                      borderRadius: "3px",
                      background: severityBg(drag.currentSeverity),
                      color: severityColor(drag.currentSeverity),
                      fontWeight: 600,
                    }}
                  >
                    {drag.currentSeverity}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--dim)" }}>−{drag.pointCost.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Factors — residual gap explained */}
      {plan.scoreFactors.length > 0 && (
        <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <Eye size={11} style={{ color: "var(--muted)" }} />
            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)" }}>Score factors</span>
            <span style={{ fontSize: "10px", color: "var(--dim)" }}>
              −{plan.scoreFactors.reduce((s, f) => s + f.compositeImpact, 0).toFixed(1)} pts
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {plan.scoreFactors.map((factor) => (
              <div
                key={factor.axis}
                style={{
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: axisColors[factor.axis] || "var(--muted)",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>{factor.reason}</span>
                  </div>
                  <span style={{ fontSize: "10px", color: "var(--dim)", flexShrink: 0 }}>
                    −{factor.axisDeduction.toFixed(1)} on {axisLabels[factor.axis] || factor.axis}
                  </span>
                </div>
                {factor.signals.length > 0 && (
                  <div
                    style={{
                      marginTop: "4px",
                      paddingLeft: "12px",
                      fontSize: "10px",
                      color: "var(--dim)",
                      lineHeight: "1.5",
                    }}
                  >
                    {factor.signals.map((s) => (
                      <div key={s.signal} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span>{s.fixDescription || s.label}</span>
                        {s.effort && <span style={{ opacity: 0.5, marginLeft: "2px" }}>({s.effort})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quick Wins UI ──────────────────────────────────────────────────

function _QuickWinsPanel({ actionItems, data }: { actionItems: ActionItem[]; data: AnalysisResult }) {
  const quickWins = getQuickWins(actionItems);
  if (quickWins.length === 0) return null;

  // Estimate total point gain from quick wins using the level-up plan
  const plan = generateLevelUpPlan(data);
  const _quickWinSignals = new Set(quickWins.map((q) => q.title.toLowerCase()));

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid rgba(210,153,34,0.2)",
        borderRadius: "10px",
        padding: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <Zap size={14} style={{ color: "var(--warning)" }} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>Quick Wins</span>
        <span style={{ fontSize: "10px", color: "var(--muted)" }}>— do these in under 30 minutes</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {quickWins.map((item, i) => {
          const ref = findReferenceLink(item.title);
          // Try to find matching fix link from the level-up plan
          const levelUpMatch = plan?.items.find(
            (g) =>
              g.fixDescription.toLowerCase().includes(item.title.toLowerCase().slice(0, 20)) ||
              item.title.toLowerCase().includes(g.fixDescription.toLowerCase().slice(0, 20)),
          );
          const fixLink = levelUpMatch?.fixLink || null;

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                paddingLeft: "8px",
                borderLeft: "2px solid var(--warning)",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--warning)", fontWeight: 700, paddingTop: "1px" }}>
                {i + 1}.
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{item.title}</span>
                  {(ref || fixLink) && (
                    <a
                      href={(fixLink || ref)?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={(fixLink || ref)?.label}
                      style={{ color: "var(--dim)", opacity: 0.5, transition: "opacity 0.15s", display: "flex" }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
                    >
                      <ExternalLink size={10} />
                    </a>
                  )}
                  <span style={{ fontSize: "10px", color: "var(--muted)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                    {item.effort}
                  </span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.3 }}>{item.reason}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Cross-Signal Insights UI ───────────────────────────────────────

function CrossSignalInsightsCard({ insights }: { insights: CrossSignalInsight[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // severityColor and severityIcon imported from ../utils/severity (single source of truth)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {insights.map((insight, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: expandable insight card
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard support handled by parent
        <div
          key={i}
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "12px",
            cursor: "pointer",
            borderLeftColor: severityColor(insight.severity),
            borderLeftWidth: "3px",
          }}
          onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <span style={{ fontSize: "11px", flexShrink: 0, paddingTop: "1px" }}>{severityIcon(insight.severity)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.5 }}>{insight.insight}</div>
              {(expandedIdx === i || true) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
                  {insight.signals_cited.map((sig, j) => (
                    <span
                      key={j}
                      style={{
                        fontSize: "9px",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: "rgba(88,166,255,0.1)",
                        color: "var(--accent)",
                        fontFamily: "monospace",
                      }}
                    >
                      {sig}
                    </span>
                  ))}
                  {insight.actionable && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        background: "rgba(46,160,67,0.1)",
                        color: "var(--success)",
                      }}
                    >
                      actionable
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

// Module-level cache so results survive tab switches
const _insightsCache: Record<string, AIAnalysisResult> = {};
const _metadataCache: Record<string, { analyzed_at: string; cached: boolean }> = {};

// Module-level stream state — survives component unmount/remount during tab switches.
// The fetch reader loop keeps running in the background; when the component remounts
// it picks up the current streaming state and re-subscribes to updates.
interface InFlightStream {
  domain: string;
  loading: boolean;
  isStreaming: boolean;
  streamingText: string;
  streamProgress: number;
  error: string | null;
  // Subscribers: the mounted component registers its state setters here.
  // When unmounted, subscribers is empty and updates go to the cache only.
  subscribers: Set<{
    setLoading: (v: boolean) => void;
    setIsStreaming: (v: boolean) => void;
    setStreamingText: (v: string) => void;
    setStreamProgress: (v: number) => void;
    setError: (v: string | null) => void;
    setInsightsResult: (v: AIAnalysisResult | null) => void;
    setAnalysisMetadata: (v: { analyzed_at: string; cached: boolean } | null) => void;
  }>;
}
const _inFlightStreams: Record<string, InFlightStream> = {};

function notifySubscribers(stream: InFlightStream) {
  for (const sub of stream.subscribers) {
    sub.setLoading(stream.loading);
    sub.setIsStreaming(stream.isStreaming);
    sub.setStreamingText(stream.streamingText);
    sub.setStreamProgress(stream.streamProgress);
    sub.setError(stream.error);
  }
}

export function AIAnalysisPanel({
  domain,
  analysisData,
  streaming,
}: {
  domain: string;
  analysisData?: AnalysisResult;
  streaming?: boolean;
}) {
  // Initialize state from module-level caches and in-flight streams
  const inFlight = _inFlightStreams[domain];
  const [insightsResult, setInsightsResult] = useState<AIAnalysisResult | null>(_insightsCache[domain] || null);
  const [loading, setLoading] = useState(inFlight?.loading || false);
  const [error, setError] = useState<string | null>(inFlight?.error || null);
  const [rateLimited, setRateLimited] = useState<RateLimitResponse | null>(null);
  const [analysisMetadata, setAnalysisMetadata] = useState<{ analyzed_at: string; cached: boolean } | null>(
    _metadataCache[domain] || null,
  );
  const [, setKeyVersion] = useState(0);
  const [selectedModel, setSelectedModel] = useState(getSavedModel);
  const [_prioritiesExpanded, _setPrioritiesExpanded] = useState(false);
  const [streamingText, setStreamingText] = useState(inFlight?.streamingText || "");
  const [isStreaming, setIsStreaming] = useState(inFlight?.isStreaming || false);
  const [streamProgress, setStreamProgress] = useState(inFlight?.streamProgress || 0);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const progressAnimRef = useRef<number | null>(null);
  const lastSignpostRef = useRef(-1);

  // Subscribe to in-flight stream updates on mount, unsubscribe on unmount
  useEffect(() => {
    const sub = {
      setLoading,
      setIsStreaming,
      setStreamingText,
      setStreamProgress,
      setError,
      setInsightsResult,
      setAnalysisMetadata,
    };
    const stream = _inFlightStreams[domain];
    if (stream) {
      stream.subscribers.add(sub);
      // Sync current state on subscribe (in case it changed between render and effect)
      setLoading(stream.loading);
      setIsStreaming(stream.isStreaming);
      setStreamingText(stream.streamingText);
      setError(stream.error);
      // Recalculate progress from streaming text signposts (animation was lost on unmount)
      if (stream.isStreaming && stream.streamingText) {
        const signposts: [string, number][] = [
          ['"summary"', 10],
          ['"posture"', 16],
          ['"key_findings"', 32],
          ['"cross_signal_insights"', 58],
          ['"attack_surface"', 80],
          ['"recommendations"', 92],
        ];
        let progress = stream.streamProgress;
        for (let i = signposts.length - 1; i >= 0; i--) {
          if (stream.streamingText.includes(signposts[i][0])) {
            progress = Math.max(progress, signposts[i][1]);
            lastSignpostRef.current = i;
            break;
          }
        }
        setStreamProgress(progress);
      } else {
        setStreamProgress(stream.streamProgress);
      }
    }
    return () => {
      const s = _inFlightStreams[domain];
      if (s) s.subscribers.delete(sub);
    };
  }, [domain]);

  // Signpost targets — when we see a JSON key, we know where we are
  const SIGNPOSTS: [string, number][] = useMemo(
    () => [
      ['"summary"', 10],
      ['"posture"', 16],
      ['"key_findings"', 32],
      ['"cross_signal_insights"', 58],
      ['"attack_surface"', 80],
      ['"recommendations"', 92],
    ],
    [],
  );

  // Animate progress smoothly between signposts using ease-out cubic
  const startProgressAnimation = useCallback(
    (base: number, target: number, durationMs = 12000) => {
      if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
      const startTime = performance.now();

      const tick = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        // Ease-out cubic — fast start, slows near target so it never looks stuck
        const eased = 1 - (1 - t) ** 3;
        const current = Math.round(base + (target - base) * eased);
        setStreamProgress(current);
        // Keep module-level stream in sync so remount gets the right value
        const s = _inFlightStreams[domain];
        if (s) s.streamProgress = current;
        if (t < 1) {
          progressAnimRef.current = requestAnimationFrame(tick);
        }
      };
      progressAnimRef.current = requestAnimationFrame(tick);
    },
    [domain],
  );

  // When streaming text updates, check for signposts and advance animation
  const updateProgressFromText = useCallback(
    (text: string) => {
      let hitIdx = -1;
      for (let i = SIGNPOSTS.length - 1; i >= 0; i--) {
        if (text.includes(SIGNPOSTS[i][0])) {
          hitIdx = i;
          break;
        }
      }
      if (hitIdx > lastSignpostRef.current) {
        lastSignpostRef.current = hitIdx;
        const reached = SIGNPOSTS[hitIdx][1];
        const nextTarget = hitIdx < SIGNPOSTS.length - 1 ? SIGNPOSTS[hitIdx + 1][1] : 98;
        // Animate from the reached signpost toward the next one
        startProgressAnimation(reached, nextTarget, 12000);
      }
    },
    [SIGNPOSTS, startProgressAnimation],
  );

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
    };
  }, []);

  const _actionItems = analysisData ? generateActionItems(analysisData) : [];

  // Auto-scroll streaming container to bottom as new text arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamingText is an intentional trigger to re-scroll on each text update
  useEffect(() => {
    if (streamContainerRef.current && isStreaming) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [isStreaming, streamingText]);

  const generateInsights = useCallback(async () => {
    if (insightsResult) return;
    if (loading) return;
    // Don't start a new stream if one is already in flight for this domain
    if (_inFlightStreams[domain]) return;

    setLoading(true);
    setError(null);
    setStreamingText("");
    setIsStreaming(false);
    setStreamProgress(0);

    // Register in-flight stream at module level
    const sub = {
      setLoading,
      setIsStreaming,
      setStreamingText,
      setStreamProgress,
      setError,
      setInsightsResult,
      setAnalysisMetadata,
    };
    const stream: InFlightStream = {
      domain,
      loading: true,
      isStreaming: false,
      streamingText: "",
      streamProgress: 0,
      error: null,
      subscribers: new Set([sub]),
    };
    _inFlightStreams[domain] = stream;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const savedKey = getSavedKey();
      if (savedKey) headers["X-OpenRouter-Key"] = savedKey;

      const bodyObj: Record<string, unknown> = { domain, stream: true };
      if (savedKey && selectedModel) bodyObj.model = selectedModel;

      let res: Response | null = null;
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        res = await fetch("/api/ai-analysis", {
          method: "POST",
          headers,
          body: JSON.stringify(bodyObj),
        });
        if (res.status !== 503) break;
      }
      if (!res) throw new Error("No response from AI API");

      if (res.status === 429) {
        const rl = (await res.json()) as RateLimitResponse;
        if (rl.rate_limited) {
          setRateLimited(rl);
          stream.loading = false;
          notifySubscribers(stream);
          delete _inFlightStreams[domain];
          return;
        }
      }

      // If response is JSON (cached result or error), handle normally
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = (await res.json()) as AIAnalysisResponse;
        if (!res.ok || json.error) {
          stream.error = json.error || `API error ${res.status}`;
          stream.loading = false;
          notifySubscribers(stream);
        } else if (json.result) {
          if (json.result.cross_signal_insights && json.result.cross_signal_insights.length > 0) {
            _insightsCache[domain] = json.result;
            for (const s of stream.subscribers) s.setInsightsResult(json.result);
            if (json.analyzed_at) {
              const meta = { analyzed_at: json.analyzed_at, cached: !!json.cached };
              _metadataCache[domain] = meta;
              for (const s of stream.subscribers) s.setAnalysisMetadata(meta);
            }
          }
          stream.loading = false;
          notifySubscribers(stream);
        }
        delete _inFlightStreams[domain];
        return;
      }

      // SSE streaming response
      if (!res.body) throw new Error("No response body for streaming");

      stream.isStreaming = true;
      stream.streamProgress = 0;
      notifySubscribers(stream);
      lastSignpostRef.current = -1;
      startProgressAnimation(0, 8, 10000);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed?.startsWith("data: ")) continue;

          try {
            const evt = JSON.parse(trimmed.slice(6));
            if (evt.error) {
              stream.error = evt.error;
              stream.loading = false;
              stream.isStreaming = false;
              notifySubscribers(stream);
              delete _inFlightStreams[domain];
              return;
            }
            if (evt.chunk) {
              accumulated += evt.chunk;
              stream.streamingText = accumulated;
              for (const s of stream.subscribers) s.setStreamingText(accumulated);
              updateProgressFromText(accumulated);
            }
            if (evt.done) {
              // Parse the complete JSON
              let jsonStr = accumulated.trim();
              const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (jsonMatch) jsonStr = jsonMatch[1].trim();
              // Handle truncated output: strip opening fence if closing ``` is missing
              else if (jsonStr.startsWith("```")) {
                jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").trim();
              }
              jsonStr = jsonStr.replace(/^\uFEFF/, "").trim();

              // Try direct parse, then salvage truncated JSON
              let parsed: AIAnalysisResult | null = null;
              try {
                parsed = JSON.parse(jsonStr) as AIAnalysisResult;
              } catch {
                // Salvage truncated JSON by closing open structures
                try {
                  let salvaged = jsonStr;
                  const quoteCount = (salvaged.match(/(?<!\\)"/g) || []).length;
                  if (quoteCount % 2 !== 0) salvaged += '"';
                  const openBraces = (salvaged.match(/{/g) || []).length;
                  const closeBraces = (salvaged.match(/}/g) || []).length;
                  const openBrackets = (salvaged.match(/\[/g) || []).length;
                  const closeBrackets = (salvaged.match(/]/g) || []).length;
                  salvaged = salvaged.replace(/,\s*$/, "");
                  for (let i = 0; i < openBrackets - closeBrackets; i++) salvaged += "]";
                  for (let i = 0; i < openBraces - closeBraces; i++) salvaged += "}";
                  parsed = JSON.parse(salvaged) as AIAnalysisResult;
                } catch {
                  /* salvage failed */
                }
              }
              if (parsed?.cross_signal_insights && parsed.cross_signal_insights.length > 0) {
                _insightsCache[domain] = parsed;
                for (const s of stream.subscribers) s.setInsightsResult(parsed);
                const meta = { analyzed_at: new Date().toISOString(), cached: false };
                _metadataCache[domain] = meta;
                for (const s of stream.subscribers) s.setAnalysisMetadata(meta);
              } else if (!parsed) {
                stream.error = "Failed to parse AI response";
                for (const s of stream.subscribers) s.setError(stream.error);
              }
              if (progressAnimRef.current) cancelAnimationFrame(progressAnimRef.current);
              stream.streamProgress = 100;
              stream.streamingText = "";
              stream.isStreaming = false;
              notifySubscribers(stream);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      stream.error = err instanceof Error ? err.message : "Failed to generate analysis";
      for (const s of stream.subscribers) s.setError(stream.error);
    } finally {
      stream.loading = false;
      stream.isStreaming = false;
      notifySubscribers(stream);
      delete _inFlightStreams[domain];
    }
  }, [domain, insightsResult, selectedModel, loading, updateProgressFromText, startProgressAnimation]);

  const handleKeyChange = (key: string) => {
    setKeyVersion((v) => v + 1);
    if (key && rateLimited) {
      setRateLimited(null);
    }
  };

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    setInsightsResult(null);
    setStreamingText("");
    setStreamProgress(0);
    delete _insightsCache[domain];
    delete _inFlightStreams[domain];
  };

  // Rate limited
  if (rateLimited) {
    return <RateLimitView data={rateLimited} onKeySet={handleKeyChange} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Advanced Settings */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <AdvancedSettings domain={domain} onKeyChange={handleKeyChange} onModelChange={handleModelChange} />
      </div>

      {/* 1. Level-Up Plan (deterministic) */}
      {analysisData && <LevelUpPlan data={analysisData} />}

      {/* 2. Cross-Signal Insights (LLM) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <Sparkles size={14} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--muted)",
            }}
          >
            Cross-Signal Insights
          </span>
          <span style={{ fontSize: "10px", color: "var(--muted)", marginLeft: "4px" }}>
            — AI-powered correlations across your data
          </span>
        </div>

        {/* Analysis timestamp */}
        {analysisMetadata && insightsResult && (
          <div
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {analysisMetadata.cached ? "Cached" : "Generated"}{" "}
            {new Date(analysisMetadata.analyzed_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        )}

        {/* Loading / Streaming state */}
        {loading && !isStreaming && <AILoadingIndicator />}
        {isStreaming && (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Loader2
                size={14}
                style={{ color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }}
              />
              <span style={{ fontSize: "12px", color: "var(--text)" }}>Generating insights…</span>
              <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "auto" }}>{streamProgress}%</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
            <div
              style={{
                height: "3px",
                borderRadius: "2px",
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: "2px",
                  background: "var(--accent)",
                  width: `${streamProgress}%`,
                }}
              />
            </div>
            <div
              ref={streamContainerRef}
              style={{
                maxHeight: "300px",
                overflow: "auto",
                fontFamily: "monospace",
                fontSize: "11px",
                lineHeight: 1.6,
                color: "var(--muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                padding: "8px",
                borderRadius: "4px",
                background: "rgba(0,0,0,0.15)",
              }}
            >
              {streamingText}
              <span style={{ opacity: 0.5, animation: "blink 1s step-end infinite" }}>▊</span>
              <style>{`@keyframes blink { 0%,100% { opacity: 0.5 } 50% { opacity: 0 } }`}</style>
            </div>
          </div>
        )}

        {/* Results */}
        {insightsResult?.cross_signal_insights && (
          <CrossSignalInsightsCard insights={insightsResult.cross_signal_insights} />
        )}

        {/* Error display */}
        {error && (
          <div
            style={{
              background: "rgba(248,81,73,0.1)",
              border: "1px solid rgba(248,81,73,0.3)",
              borderRadius: "8px",
              padding: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <XCircle size={14} style={{ color: "var(--danger)" }} />
            <span style={{ fontSize: "12px", color: "var(--danger)" }}>{error}</span>
            <button
              type="button"
              onClick={() => {
                setInsightsResult(null);
                setStreamingText("");
                setStreamProgress(0);
                delete _insightsCache[domain];
                delete _inFlightStreams[domain];
                generateInsights();
              }}
              style={{
                marginLeft: "auto",
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Generate button */}
        {!insightsResult && !loading && !error && (
          <div
            style={{
              textAlign: "center",
              padding: "20px",
              background: "var(--card)",
              border: "1px dashed var(--border)",
              borderRadius: "8px",
            }}
          >
            {streaming ? (
              <>
                <Loader2
                  size={20}
                  style={{
                    color: "var(--accent)",
                    opacity: 0.6,
                    margin: "0 auto 8px",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: 0 }}>
                  Waiting for analysis to complete before generating AI insights...
                </p>
              </>
            ) : (
              <>
                <p style={{ fontSize: "12px", color: "var(--muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                  AI finds non-obvious correlations between your signals — things like mismatched DMARC/DKIM configs,
                  SSL/HSTS conflicts, or redundant third-party scripts.
                </p>
                <button
                  type="button"
                  onClick={generateInsights}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "1px solid var(--accent)",
                    background: "rgba(88,166,255,0.1)",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  <Sparkles size={14} />
                  Generate Cross-Signal Insights
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
