// ─── Trust Signal Detection ─────────────────────────────────────────
// Evaluates trust hallmarks from already-captured analysis data.
// Probes common operational-transparency paths via HEAD when HTML scanning misses them.

import { type Env, probeHeadWithFallback } from "../../helpers";

export interface TrustSignal {
  name: string;
  category: "security" | "identity" | "reputation" | "transparency" | "operational";
  present: boolean;
  value: string | null;
  severity: "good" | "info" | "low" | "medium";
  importance?: "core" | "extra";
}

export interface TrustSignals {
  signals: TrustSignal[];
  trust_score_factors: {
    positive: string[];
    negative: string[];
    neutral: string[];
  };
}

/** Minimal shapes from the pipeline that trust checks need. */
interface TrustInput {
  headers: Record<string, string> | null;
  securityTxt: { found: boolean; has_bug_bounty: boolean; bug_bounty_platform: string | null } | null;
  emailAuth: {
    dmarc: { found: boolean; policy: string | null };
    dkim_selectors_found: string[];
    bimi: { found: boolean } | null;
    mta_sts: { policy_found: boolean; mode: string | null } | null;
  } | null;
  dnssec: { enabled: boolean; validated: boolean } | null;
  ssl: { grade: string | null; issuer: string | null; subject: string | null } | null;
  caaRecords: Array<{ tag: string; value: string }> | null;
  wellKnown: { endpoints: Array<{ path: string; name: string; found: boolean }>; pwa_ready: boolean } | null;
  waf: { detected: boolean; provider: string | null; confidence: string } | null;
  html: string;
  hosting: { provider: string | null; cdn: string | null } | null;
  domain: string;
  env: Env;
}

export async function checkTrustSignals(input: TrustInput): Promise<TrustSignals> {
  const signals: TrustSignal[] = [];
  const positive: string[] = [];
  const negative: string[] = [];
  const neutral: string[] = [];

  // ── Security hallmarks ──────────────────────────────────────────

  // HSTS with long max-age
  const hstsHeader = input.headers?.["strict-transport-security"] ?? null;
  if (hstsHeader) {
    const maxAgeMatch = hstsHeader.match(/max-age\s*=\s*(\d+)/i);
    const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0;
    const hasSubdomains = /includesubdomains/i.test(hstsHeader);
    const hasPreload = /preload/i.test(hstsHeader);

    if (maxAge >= 31536000 && hasSubdomains) {
      signals.push({
        name: "HSTS (strong)",
        category: "security",
        present: true,
        value: `max-age=${maxAge}${hasSubdomains ? "; includeSubDomains" : ""}${hasPreload ? "; preload" : ""}`,
        severity: "good",
        importance: "core",
      });
      positive.push("Strong HSTS policy with includeSubDomains");
    } else if (maxAge > 0) {
      signals.push({
        name: "HSTS",
        category: "security",
        present: true,
        value: `max-age=${maxAge}`,
        severity: "info",
        importance: "core",
      });
      neutral.push("HSTS present but could be stronger");
    } else {
      signals.push({
        name: "HSTS",
        category: "security",
        present: false,
        value: null,
        severity: "low",
        importance: "core",
      });
      negative.push("No HSTS header");
    }

    // HSTS Preload
    if (hasPreload && maxAge >= 31536000 && hasSubdomains) {
      signals.push({
        name: "HSTS Preload",
        category: "security",
        present: true,
        value: "Eligible for browser preload list",
        severity: "good",
        importance: "extra",
      });
      positive.push("HSTS preload eligible");
    }
  } else {
    signals.push({
      name: "HSTS",
      category: "security",
      present: false,
      value: null,
      severity: "low",
      importance: "core",
    });
    negative.push("No HSTS header");
  }

  // Content Security Policy
  const csp = input.headers?.["content-security-policy"] ?? null;
  if (csp) {
    signals.push({
      name: "Content Security Policy",
      category: "security",
      present: true,
      value: csp.length > 80 ? `${csp.slice(0, 77)}…` : csp,
      severity: "good",
      importance: "core",
    });
    positive.push("CSP header configured");
  } else {
    signals.push({
      name: "Content Security Policy",
      category: "security",
      present: false,
      value: null,
      severity: "low",
      importance: "core",
    });
    negative.push("No Content Security Policy");
  }

  // Permissions-Policy
  const permPolicy = input.headers?.["permissions-policy"] ?? null;
  if (permPolicy) {
    signals.push({
      name: "Permissions Policy",
      category: "security",
      present: true,
      value: permPolicy.length > 80 ? `${permPolicy.slice(0, 77)}…` : permPolicy,
      severity: "good",
      importance: "extra",
    });
    positive.push("Permissions-Policy header set");
  } else {
    signals.push({
      name: "Permissions Policy",
      category: "security",
      present: false,
      value: null,
      severity: "info",
      importance: "extra",
    });
    neutral.push("No Permissions-Policy header");
  }

  // DNSSEC
  if (input.dnssec?.enabled) {
    signals.push({
      name: "DNSSEC",
      category: "security",
      present: true,
      value: input.dnssec.validated ? "Validated" : "Enabled",
      severity: "good",
      importance: "extra",
    });
    positive.push("DNSSEC enabled");
  } else {
    signals.push({
      name: "DNSSEC",
      category: "security",
      present: false,
      value: null,
      severity: "info",
      importance: "extra",
    });
    neutral.push("DNSSEC not enabled");
  }

  // CAA records
  if (input.caaRecords && input.caaRecords.length > 0) {
    const issuers = input.caaRecords.filter((r) => r.tag === "issue" || r.tag === "issuewild").map((r) => r.value);
    signals.push({
      name: "CAA Records",
      category: "security",
      present: true,
      value: issuers.length > 0 ? `Restricts CAs to: ${issuers.slice(0, 3).join(", ")}` : "Present",
      severity: "good",
      importance: "extra",
    });
    positive.push("CAA DNS records restrict certificate issuance");
  } else {
    signals.push({
      name: "CAA Records",
      category: "security",
      present: false,
      value: null,
      severity: "info",
      importance: "extra",
    });
    neutral.push("No CAA DNS records");
  }

  // WAF — extra credit, not a requirement
  if (input.waf?.detected) {
    signals.push({
      name: "Web Application Firewall",
      category: "security",
      present: true,
      value: input.waf.provider,
      severity: "good",
      importance: "extra",
    });
    positive.push(`WAF detected: ${input.waf.provider}`);
  } else {
    signals.push({
      name: "Web Application Firewall",
      category: "security",
      present: false,
      value: null,
      severity: "info",
      importance: "extra",
    });
  }

  // ── Identity hallmarks ──────────────────────────────────────────

  // SSL certificate quality (EV/OV from issuer/org info)
  const sslGrade = input.ssl?.grade;
  const sslIssuer = input.ssl?.issuer;
  if (sslGrade === "A+" || sslGrade === "A") {
    signals.push({
      name: "SSL Grade",
      category: "identity",
      present: true,
      value: `Grade ${sslGrade}${sslIssuer ? ` (${sslIssuer})` : ""}`,
      severity: "good",
      importance: "core",
    });
    positive.push(`SSL grade ${sslGrade}`);
  } else if (sslGrade) {
    signals.push({
      name: "SSL Grade",
      category: "identity",
      present: true,
      value: `Grade ${sslGrade}`,
      severity: "info",
      importance: "core",
    });
    neutral.push(`SSL grade ${sslGrade}`);
  }

  // Certificate validation type (EV/OV/DV)
  const sslSubject = input.ssl?.subject ?? "";
  if (sslSubject) {
    const hasOrg = /,?\s*O\s*=/.test(sslSubject);
    const isEV =
      hasOrg &&
      (/SERIALNUMBER\s*=/.test(sslSubject) ||
        /2\.5\.4\.15/.test(sslSubject) ||
        /1\.3\.6\.1\.4\.1\.311\.60\.2\.1/.test(sslSubject));
    const orgMatch = sslSubject.match(/,?\s*O\s*=\s*([^,]+)/);
    const orgName = orgMatch ? orgMatch[1].replace(/\\+/g, "").trim() : null;

    if (isEV && orgName) {
      signals.push({
        name: "Certificate Type",
        category: "identity",
        present: true,
        value: `Extended Validation (EV) — ${orgName}`,
        severity: "good",
        importance: "extra",
      });
      positive.push(`EV certificate issued to ${orgName}`);
    } else if (hasOrg && orgName) {
      signals.push({
        name: "Certificate Type",
        category: "identity",
        present: true,
        value: `Organization Validated (OV) — ${orgName}`,
        severity: "good",
        importance: "extra",
      });
      positive.push(`OV certificate issued to ${orgName}`);
    } else {
      signals.push({
        name: "Certificate Type",
        category: "identity",
        present: true,
        value: "Domain Validated (DV)",
        severity: "info",
        importance: "extra",
      });
      neutral.push("DV certificate (domain-only validation)");
    }
  }

  // security.txt
  if (input.securityTxt?.found) {
    signals.push({
      name: "security.txt",
      category: "identity",
      present: true,
      value: "Published",
      severity: "good",
      importance: "extra",
    });
    positive.push("security.txt published");
  } else {
    signals.push({
      name: "security.txt",
      category: "identity",
      present: false,
      value: null,
      severity: "info",
      importance: "extra",
    });
    neutral.push("No security.txt");
  }

  // Bug bounty program
  if (input.securityTxt?.has_bug_bounty) {
    signals.push({
      name: "Bug Bounty",
      category: "identity",
      present: true,
      value: input.securityTxt.bug_bounty_platform ?? "Mentioned in security.txt",
      severity: "good",
      importance: "extra",
    });
    positive.push("Bug bounty program");
  }

  // DMARC with reject/quarantine policy
  if (input.emailAuth?.dmarc?.found) {
    const policy = input.emailAuth.dmarc.policy;
    if (policy === "reject") {
      signals.push({
        name: "DMARC Enforcement",
        category: "identity",
        present: true,
        value: "policy=reject",
        severity: "good",
        importance: "core",
      });
      positive.push("DMARC policy=reject (strongest email auth)");
    } else if (policy === "quarantine") {
      signals.push({
        name: "DMARC Enforcement",
        category: "identity",
        present: true,
        value: "policy=quarantine",
        severity: "good",
        importance: "core",
      });
      positive.push("DMARC policy=quarantine");
    } else {
      signals.push({
        name: "DMARC Enforcement",
        category: "identity",
        present: true,
        value: `policy=${policy ?? "none"}`,
        severity: "info",
        importance: "core",
      });
      neutral.push("DMARC present but not enforcing");
    }
  }

  // BIMI
  if (input.emailAuth?.bimi?.found) {
    signals.push({
      name: "BIMI",
      category: "identity",
      present: true,
      value: "Brand logo verified for email",
      severity: "good",
      importance: "extra",
    });
    positive.push("BIMI brand indicator for email");
  }

  // MTA-STS
  if (input.emailAuth?.mta_sts?.policy_found && input.emailAuth.mta_sts.mode === "enforce") {
    signals.push({
      name: "MTA-STS",
      category: "identity",
      present: true,
      value: "mode=enforce",
      severity: "good",
      importance: "extra",
    });
    positive.push("MTA-STS enforcing TLS for email");
  }

  // ── Transparency hallmarks ──────────────────────────────────────

  // humans.txt
  const hasHumansTxt = input.wellKnown?.endpoints?.some((e) => e.path.includes("humans.txt") && e.found);
  if (hasHumansTxt) {
    signals.push({
      name: "humans.txt",
      category: "transparency",
      present: true,
      value: "Published",
      severity: "info",
      importance: "extra",
    });
    neutral.push("humans.txt present");
  }

  // ads.txt
  const hasAdsTxt = input.wellKnown?.endpoints?.some((e) => e.path.includes("ads.txt") && e.found);
  if (hasAdsTxt) {
    signals.push({
      name: "ads.txt",
      category: "transparency",
      present: true,
      value: "Published",
      severity: "info",
      importance: "extra",
    });
    neutral.push("ads.txt present (ad transparency)");
  }

  // Open source link
  const htmlSnippet = input.html.slice(0, 10000);
  const hasOssLink = /github\.com\/[a-z0-9_-]+\/[a-z0-9_-]+|gitlab\.com\/[a-z0-9_-]+\/[a-z0-9_-]+/i.test(htmlSnippet);
  if (hasOssLink) {
    signals.push({
      name: "Open Source Link",
      category: "transparency",
      present: true,
      value: "GitHub/GitLab link in page",
      severity: "info",
      importance: "extra",
    });
    neutral.push("Links to source code repository");
  }

  // ── Operational transparency (scripts, widgets, badges in HTML + HEAD probes) ──

  // Scan first 50KB for embedded third-party operational tool references
  const opsHtml = input.html.slice(0, 50000);

  const OPS_SIGNATURES: Array<{ name: string; group: string; pattern: RegExp }> = [
    // Status pages (third-party)
    { name: "Statuspage", group: "Status Page", pattern: /statuspage\.io/i },
    { name: "Better Uptime", group: "Status Page", pattern: /betteruptime\.com/i },
    { name: "Instatus", group: "Status Page", pattern: /instatus\.com/i },
    { name: "Cachet", group: "Status Page", pattern: /cachethq\.io/i },
    { name: "Hund", group: "Status Page", pattern: /hund\.io/i },
    { name: "Sorry", group: "Status Page", pattern: /sorryapp\.com/i },
    { name: "Freshstatus", group: "Status Page", pattern: /freshstatus\.io/i },
    // Status pages (self-hosted — links to /status, /health, /uptime in the HTML)
    { name: "Status Page", group: "Status Page", pattern: /href=["'][^"']*\/status\b/i },
    { name: "Health Endpoint", group: "Status Page", pattern: /href=["'][^"']*\/health\b/i },
    { name: "Uptime Page", group: "Status Page", pattern: /href=["'][^"']*\/uptime\b/i },
    // Uptime monitoring badges (img src patterns)
    { name: "UptimeRobot", group: "Uptime Monitoring", pattern: /uptimerobot\.com/i },
    { name: "Pingdom", group: "Uptime Monitoring", pattern: /pingdom\.com/i },
    { name: "StatusCake", group: "Uptime Monitoring", pattern: /statuscake\.com/i },
    { name: "Updown", group: "Uptime Monitoring", pattern: /updown\.io/i },
    { name: "Oh Dear", group: "Uptime Monitoring", pattern: /ohdear\.app/i },
    // Feedback & roadmap widgets
    { name: "Canny", group: "Feedback & Roadmap", pattern: /canny\.io/i },
    { name: "UserVoice", group: "Feedback & Roadmap", pattern: /uservoice\.com/i },
    { name: "Productboard", group: "Feedback & Roadmap", pattern: /productboard\.com/i },
    { name: "Nolt", group: "Feedback & Roadmap", pattern: /nolt\.io/i },
    // Changelog widgets
    { name: "Beamer", group: "Changelog Widget", pattern: /getbeamer\.com/i },
    { name: "Headway", group: "Changelog Widget", pattern: /headwayapp\.co/i },
    { name: "AnnounceKit", group: "Changelog Widget", pattern: /announcekit\.app/i },
    { name: "Released", group: "Changelog Widget", pattern: /released\.so/i },
    // Changelog / release notes / roadmap links in HTML
    { name: "Changelog Page", group: "Changelog", pattern: /href=["'][^"']*\/changelog\b/i },
    { name: "Release Notes", group: "Changelog", pattern: /href=["'][^"']*\/releases?\b/i },
    { name: "What's New", group: "Changelog", pattern: /href=["'][^"']*\/whats-new\b/i },
    { name: "Roadmap Page", group: "Roadmap", pattern: /href=["'][^"']*\/roadmap\b/i },
    // Trust badges
    { name: "Trustpilot", group: "Trust Badge", pattern: /trustpilot\.com/i },
    { name: "BBB", group: "Trust Badge", pattern: /bbb\.org/i },
    { name: "G2", group: "Trust Badge", pattern: /g2\.com\/products/i },
  ];

  let opsCount = 0;
  const opsGroupsSeen = new Set<string>();
  for (const sig of OPS_SIGNATURES) {
    if (sig.pattern.test(opsHtml)) {
      signals.push({
        name: sig.name,
        category: "operational",
        present: true,
        value: sig.group,
        severity: "info",
        importance: "extra",
      });
      neutral.push(`${sig.name} (${sig.group}) detected`);
      opsCount++;
      opsGroupsSeen.add(sig.group);
    }
  }

  // HEAD-probe fallback: for SPAs and server-rendered pages that don't expose
  // ops links in the raw HTML, probe common operational-transparency paths.
  const OPS_PROBE_PATHS: Array<{ name: string; group: string; paths: string[] }> = [
    { name: "Status Page", group: "Status Page", paths: ["/status", "/system-status"] },
    { name: "Health Endpoint", group: "Status Page", paths: ["/health", "/healthz", "/healthcheck"] },
    { name: "Changelog", group: "Changelog", paths: ["/changelog", "/releases", "/whats-new"] },
    { name: "Roadmap", group: "Roadmap", paths: ["/roadmap"] },
  ];

  // Only probe groups we haven't already detected via HTML scanning
  const probesToRun = OPS_PROBE_PATHS.filter((p) => !opsGroupsSeen.has(p.group));

  if (probesToRun.length > 0) {
    const probeResults = await Promise.allSettled(
      probesToRun.map(async (probe) => {
        for (const path of probe.paths) {
          try {
            const url = `https://${input.domain}${path}`;
            const result = await probeHeadWithFallback(url, input.env, { timeout: 5_000 });
            if (
              result.ok &&
              (result.contentType.includes("text/html") || result.contentType.includes("application/json"))
            ) {
              return probe; // Found
            }
          } catch {
            /* timeout or network error — skip */
          }
        }
        return null; // Not found
      }),
    );

    for (const result of probeResults) {
      if (result.status === "fulfilled" && result.value) {
        const probe = result.value;
        signals.push({
          name: probe.name,
          category: "operational",
          present: true,
          value: probe.group,
          severity: "info",
          importance: "extra",
        });
        neutral.push(`${probe.name} (${probe.group}) detected via probe`);
        opsCount++;
        opsGroupsSeen.add(probe.group);
      }
    }
  }

  if (opsCount >= 1) {
    positive.push(`${opsCount} operational transparency tool${opsCount > 1 ? "s" : ""} detected`);
  }

  return { signals, trust_score_factors: { positive, negative, neutral } };
}
