import { AlertTriangle, CheckCircle2, ExternalLink, Info, XCircle } from "lucide-react";
import type { AnalysisResult } from "../utils/types";
import { Tooltip } from "./Tooltip";

// ─── Reference Links for Findings ───
// Maps signal keywords to authoritative documentation
const REFERENCE_LINKS: Record<string, { url: string; label: string }> = {
  hsts: {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security",
    label: "MDN: HSTS",
  },
  "strict-transport-security": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security",
    label: "MDN: HSTS",
  },
  "content security policy": { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP", label: "MDN: CSP" },
  csp: { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP", label: "MDN: CSP" },
  dmarc: { url: "https://datatracker.ietf.org/doc/html/rfc7489", label: "RFC 7489" },
  spf: { url: "https://datatracker.ietf.org/doc/html/rfc7208", label: "RFC 7208" },
  dkim: { url: "https://datatracker.ietf.org/doc/html/rfc6376", label: "RFC 6376" },
  dnssec: { url: "https://www.cloudflare.com/dns/dnssec/how-dnssec-works/", label: "DNSSEC Guide" },
  "certificate transparency": { url: "https://datatracker.ietf.org/doc/html/rfc6962", label: "RFC 6962" },
  "x-content-type-options": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options",
    label: "MDN: X-Content-Type-Options",
  },
  "x-frame-options": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options",
    label: "MDN: X-Frame-Options",
  },
  "referrer-policy": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy",
    label: "MDN: Referrer-Policy",
  },
  "permissions-policy": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy",
    label: "MDN: Permissions-Policy",
  },
  "http/2": { url: "https://developer.mozilla.org/en-US/docs/Glossary/HTTP_2", label: "MDN: HTTP/2" },
  "http/3": { url: "https://developer.mozilla.org/en-US/docs/Glossary/HTTP_3", label: "MDN: HTTP/3" },
  ssl: { url: "https://www.ssllabs.com/projects/documentation/", label: "SSL Labs Docs" },
  tls: { url: "https://datatracker.ietf.org/doc/html/rfc8446", label: "RFC 8446 (TLS 1.3)" },
  caa: { url: "https://datatracker.ietf.org/doc/html/rfc8659", label: "RFC 8659" },
  "security.txt": { url: "https://datatracker.ietf.org/doc/html/rfc9116", label: "RFC 9116" },
  bimi: { url: "https://bimigroup.org/implementation-guide/", label: "BIMI Guide" },
  "robots.txt": {
    url: "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
    label: "Google: robots.txt",
  },
  sitemap: { url: "https://www.sitemaps.org/protocol.html", label: "Sitemaps Protocol" },
  "json-ld": {
    url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    label: "Google: Structured Data",
  },
  "structured data": {
    url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    label: "Google: Structured Data",
  },
  "open graph": { url: "https://ogp.me/", label: "Open Graph Protocol" },
  pagespeed: { url: "https://developer.chrome.com/docs/lighthouse/overview", label: "Lighthouse Docs" },
  ipv6: { url: "https://www.google.com/intl/en/ipv6/statistics.html", label: "IPv6 Adoption" },
  "mta-sts": { url: "https://datatracker.ietf.org/doc/html/rfc8461", label: "RFC 8461" },
  "permissions policy": {
    url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy",
    label: "MDN: Permissions-Policy",
  },
  "web application firewall": {
    url: "https://www.cloudflare.com/learning/ddos/glossary/web-application-firewall-waf/",
    label: "Cloudflare: What is a WAF?",
  },
  waf: {
    url: "https://www.cloudflare.com/learning/ddos/glossary/web-application-firewall-waf/",
    label: "Cloudflare: What is a WAF?",
  },
  "certificate type": {
    url: "https://www.digicert.com/difference-between-dv-ov-and-ev-ssl-certificates",
    label: "DigiCert: DV vs OV vs EV",
  },
  "bug bounty": {
    url: "https://www.hackerone.com/vulnerability-management/what-bug-bounty",
    label: "HackerOne: What is a Bug Bounty?",
  },
  "humans.txt": { url: "https://humanstxt.org/", label: "humanstxt.org" },
  "ads.txt": { url: "https://iabtechlab.com/ads-txt/", label: "IAB: ads.txt" },
  blocklist: { url: "https://www.dnsbl.info/", label: "DNSBL Info" },
  xmlrpc: { url: "https://developer.wordpress.org/apis/xml-rpc/", label: "WordPress: XML-RPC" },
  "xml-rpc": { url: "https://developer.wordpress.org/apis/xml-rpc/", label: "WordPress: XML-RPC" },
  "wp-login": {
    url: "https://developer.wordpress.org/advanced-administration/security/brute-force-attacks/",
    label: "WordPress: Brute Force Protection",
  },
  "rest api": { url: "https://developer.wordpress.org/rest-api/", label: "WordPress: REST API" },
  "user enumeration": {
    url: "https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/03-Identity_Management_Testing/04-Testing_for_Account_Enumeration_and_Guessable_User_Account",
    label: "OWASP: User Enumeration",
  },
  wordfence: { url: "https://www.wordfence.com/", label: "Wordfence" },
  "directory listing": {
    url: "https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information",
    label: "OWASP: Directory Listing",
  },
};

export function findReferenceLink(text: string): { url: string; label: string } | null {
  const lower = text.toLowerCase();
  for (const [keyword, ref] of Object.entries(REFERENCE_LINKS)) {
    if (lower.includes(keyword)) return ref;
  }
  return null;
}

interface Signal {
  type: "strength" | "notice" | "issue" | "info";
  text: string;
  detail?: string;
}

function buildSignals(data: AnalysisResult, streaming?: boolean): Signal[] {
  const signals: Signal[] = [];
  const httpBlocked = data.http_probe_blocked === true;

  // ─── SSL ───
  const sslGrade = data.ssl?.grade;
  if (sslGrade) {
    if (sslGrade.startsWith("A"))
      signals.push({
        type: "strength",
        text: `SSL Grade ${sslGrade}`,
        detail: data.ssl?.issuer ? `Issued by ${data.ssl.issuer}` : undefined,
      });
    else if (sslGrade === "Valid")
      signals.push({
        type: "strength",
        text: "SSL certificate verified",
        detail: data.ssl?.issuer ? `Issued by ${data.ssl.issuer}` : "HTTPS connection confirmed",
      });
    else if (sslGrade.startsWith("B"))
      signals.push({
        type: "notice",
        text: `SSL Grade ${sslGrade}`,
        detail: "Good but not optimal — consider upgrading configuration",
      });
    else signals.push({ type: "issue", text: `SSL Grade ${sslGrade}`, detail: "Weak SSL configuration detected" });
  } else if (!data.not_registered && !streaming) {
    signals.push({ type: "issue", text: "SSL certificate not detected" });
  }

  // SSL expiry
  if (data.ssl?.valid_to) {
    const daysLeft = Math.floor((new Date(data.ssl.valid_to).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0)
      signals.push({
        type: "issue",
        text: "SSL certificate expired",
        detail: `Expired ${Math.abs(daysLeft)} days ago`,
      });
    else if (daysLeft < 30)
      signals.push({ type: "notice", text: `SSL expires in ${daysLeft} days`, detail: "Renewal recommended soon" });
  }

  // ─── Security Headers ───
  if (!httpBlocked && data.headers?.security_grade) {
    const sg = data.headers.security_grade;
    if (sg === "A+" || sg === "A")
      signals.push({
        type: "strength",
        text: "Strong security headers",
        detail: sg === "A+" ? `Grade ${sg}` : undefined,
      });
    else if (sg === "B+" || sg === "B")
      signals.push({ type: "strength", text: "Good security headers", detail: `Grade ${sg}` });
    else if (sg === "C+" || sg === "C")
      signals.push({ type: "notice", text: "Moderate security headers", detail: `Grade ${sg} — some headers missing` });
    else if (sg !== "N/A") signals.push({ type: "notice", text: "Weak security headers", detail: `Grade ${sg}` });
  }

  // CSP
  if (!httpBlocked && data.headers?.raw) {
    if (data.headers.raw["content-security-policy"]) {
      signals.push({ type: "strength", text: "Content Security Policy configured" });
    } else {
      signals.push({ type: "notice", text: "No Content Security Policy (CSP)" });
    }
  }

  // ─── HSTS ───
  if (!httpBlocked && data.headers?.raw) {
    const hsts = data.headers.raw["strict-transport-security"];
    if (hsts) {
      const hasPreload = hsts.includes("preload");
      const hasSubdomains = hsts.includes("includeSubDomains") || hsts.includes("includeSubdomains");
      if (hasPreload && hasSubdomains) signals.push({ type: "strength", text: "HSTS with preload enabled" });
      else if (hsts) signals.push({ type: "strength", text: "HSTS enabled" });
    } else {
      signals.push({ type: "notice", text: "No HSTS header" });
    }
  }

  // ─── DNSSEC ───
  if (data.dnssec?.enabled) {
    signals.push({ type: "strength", text: "DNSSEC enabled" });
  } else if (data.dnssec && !data.dnssec.enabled) {
    signals.push({ type: "notice", text: "DNSSEC not enabled" });
  }

  // ─── Email Auth ───
  if (data.email_auth && !data.is_subdomain) {
    const { spf, dmarc, dkim_selectors_found } = data.email_auth;
    const hasSpf = spf.found;
    const hasDmarc = dmarc.found;
    const hasDkim = dkim_selectors_found.length > 0;
    if (hasSpf && hasDmarc && hasDkim) {
      const policy = dmarc.policy;
      if (policy === "reject")
        signals.push({ type: "strength", text: "Full email authentication (SPF + DMARC reject + DKIM)" });
      else if (policy === "quarantine")
        signals.push({ type: "strength", text: "Email authentication configured", detail: `DMARC policy: ${policy}` });
      else
        signals.push({
          type: "notice",
          text: "Email auth present but DMARC not enforcing",
          detail: `DMARC policy: ${policy ?? "none"} — consider upgrading to quarantine or reject`,
        });
    } else {
      if (!hasSpf) signals.push({ type: "issue", text: "No SPF record", detail: "Email spoofing protection missing" });
      if (!hasDmarc)
        signals.push({ type: "issue", text: "No DMARC record", detail: "Email authentication policy missing" });
      if (!hasDkim) signals.push({ type: "notice", text: "No DKIM selectors found" });
    }
  }

  // ─── BIMI ───
  if (data.email_auth?.bimi?.found) {
    signals.push({ type: "strength", text: "BIMI record configured", detail: "Brand logo in email clients" });
  }

  // ─── Blocklists ───
  const listedCount = (data.blocklists ?? []).filter((b) => b.listed).length;
  if (listedCount > 0) {
    signals.push({
      type: "issue",
      text: `Listed on ${listedCount} blocklist${listedCount > 1 ? "s" : ""}`,
      detail: "Domain reputation may be impacted",
    });
  } else if ((data.blocklists ?? []).length > 0) {
    signals.push({ type: "strength", text: "Clean on all blocklists" });
  }

  // ─── Performance ───
  if (data.performance?.score != null) {
    if (data.performance.score >= 90)
      signals.push({ type: "strength", text: `PageSpeed score ${data.performance.score}/100` });
    else if (data.performance.score >= 50)
      signals.push({ type: "notice", text: `PageSpeed score ${data.performance.score}/100` });
    else signals.push({ type: "issue", text: `Low PageSpeed score: ${data.performance.score}/100` });
  }

  if (data.status?.response_time_ms != null) {
    const rt = data.status.response_time_ms;
    if (rt < 300) signals.push({ type: "strength", text: `Fast response time (${rt}ms)` });
    else if (rt < 1000) signals.push({ type: "info", text: `Response time: ${rt}ms` });
    else signals.push({ type: "notice", text: `Slow response time (${rt}ms)` });
  }

  // ─── Domain Registration ───
  if (data.rdap?.domain_age_days != null) {
    const age = data.rdap.domain_age_days;
    if (age < 30)
      signals.push({ type: "notice", text: `Domain registered ${age} days ago`, detail: "Very new domain" });
    else if (age < 365) signals.push({ type: "info", text: `Domain age: ${Math.floor(age / 30)} months` });
    else signals.push({ type: "info", text: `Domain age: ${Math.floor(age / 365)}y ${Math.floor((age % 365) / 30)}m` });
  }

  if (data.rdap?.days_until_expiry != null) {
    const daysLeft = data.rdap.days_until_expiry;
    if (daysLeft < 0) signals.push({ type: "issue", text: "Domain registration expired" });
    else if (daysLeft < 30)
      signals.push({ type: "issue", text: `Domain expires in ${daysLeft} days`, detail: "Renewal critical" });
    else if (daysLeft < 90) signals.push({ type: "notice", text: `Domain expires in ${daysLeft} days` });
  }

  // ─── Hosting / Infrastructure ───
  if (data.hosting?.provider) signals.push({ type: "info", text: `Hosted on ${data.hosting.provider}` });
  if (data.hosting?.cdn) signals.push({ type: "info", text: `CDN: ${data.hosting.cdn}` });
  if (data.waf?.detected) {
    signals.push({ type: "strength", text: `WAF: ${data.waf.provider}`, detail: `${data.waf.confidence} confidence` });
  } else if (data.hosting?.waf) {
    signals.push({ type: "strength", text: `WAF: ${data.hosting.waf}` });
  }

  // ─── Tech ───
  if (data.wordpress) {
    const wp = data.wordpress;
    const wpParts = ["WordPress"];
    if (wp.version) wpParts.push(wp.version);
    if (wp.theme) wpParts.push(`· ${wp.theme.name} theme`);
    signals.push({ type: "info", text: wpParts.join(" ") });
    if (wp.page_builder) signals.push({ type: "info", text: `Page builder: ${wp.page_builder}` });
    if (wp.plugins && wp.plugins.length > 0)
      signals.push({ type: "info", text: `${wp.plugins.length} plugin${wp.plugins.length > 1 ? "s" : ""} detected` });
  }

  // ─── Tranco Ranking ───
  if (data.tranco_rank != null) {
    if (data.tranco_rank <= 1000)
      signals.push({
        type: "info",
        text: `Tranco rank #${data.tranco_rank.toLocaleString()}`,
        detail: "Top 1K globally",
      });
    else if (data.tranco_rank <= 100000)
      signals.push({ type: "info", text: `Tranco rank #${data.tranco_rank.toLocaleString()}` });
    else signals.push({ type: "info", text: `Tranco rank #${data.tranco_rank.toLocaleString()}` });
  }

  // ─── Shodan ───
  if (data.shodan?.vulns && data.shodan.vulns.length > 0) {
    signals.push({
      type: "issue",
      text: `${data.shodan.vulns.length} known CVE${data.shodan.vulns.length > 1 ? "s" : ""} detected`,
      detail: data.shodan.vulns.slice(0, 3).join(", "),
    });
  }
  if (data.shodan?.ports && data.shodan.ports.length > 0) {
    const unusual = data.shodan.ports.filter((p) => ![80, 443, 22, 25, 587, 993, 143].includes(p));
    if (unusual.length > 0) signals.push({ type: "notice", text: `Unusual open ports: ${unusual.join(", ")}` });
  }

  // ─── Robots / AI ───
  if (data.robots_parsed?.is_missing) {
    signals.push({ type: "notice", text: "No robots.txt found" });
  } else if (data.robots_parsed?.is_restrictive) {
    signals.push({ type: "info", text: "Restrictive robots.txt" });
  }

  if (data.llms_txt?.found) {
    signals.push({ type: "info", text: "llms.txt present", detail: "AI-ready domain" });
  }

  // ─── Legal ───
  if (!httpBlocked && data.legal) {
    if (data.legal.pages_found.length >= 2) signals.push({ type: "strength", text: "Privacy policy and terms found" });
    else if (data.legal.pages_found.length === 1)
      signals.push({ type: "notice", text: `Only ${data.legal.pages_found[0].name} found` });
    else signals.push({ type: "notice", text: "No privacy policy or terms detected" });
  }

  // ─── HTTP Probe Blocked ───
  if (httpBlocked) {
    signals.push({ type: "notice", text: "HTTP probe blocked", detail: "Some data based on DNS and SSL only" });
  }

  // ─── Data Breaches ───
  if (data.breaches) {
    if (data.breaches.found && data.breaches.count > 0) {
      const { count, total_pwned } = data.breaches;
      const countStr =
        total_pwned >= 1_000_000_000
          ? `${(total_pwned / 1_000_000_000).toFixed(1)}B`
          : total_pwned >= 1_000_000
            ? `${(total_pwned / 1_000_000).toFixed(1)}M`
            : total_pwned >= 1_000
              ? `${(total_pwned / 1_000).toFixed(1)}K`
              : total_pwned.toLocaleString();
      signals.push({
        type: "issue",
        text: `${count} known data breach${count > 1 ? "es" : ""}`,
        detail: `${countStr} accounts exposed`,
      });
    } else {
      signals.push({ type: "strength", text: "No known data breaches" });
    }
  }

  // ─── Security.txt ───
  if (data.security_txt) {
    if (data.security_txt.found) {
      if (data.security_txt.has_bug_bounty) {
        signals.push({
          type: "strength",
          text: `Bug bounty program (${data.security_txt.bug_bounty_platform ?? "active"})`,
        });
      } else {
        signals.push({ type: "strength", text: "Security disclosure policy (security.txt)" });
      }
      if (data.security_txt.is_expired) {
        signals.push({
          type: "notice",
          text: "security.txt is expired",
          detail: `Expires: ${data.security_txt.expires}`,
        });
      }
    } else if (data.tranco_rank != null && data.tranco_rank <= 10000) {
      signals.push({
        type: "notice",
        text: "No security.txt",
        detail: "Major site without vulnerability disclosure policy",
      });
    }
  }

  // ─── Green Hosting ───
  if (data.green_hosting && !data.green_hosting.error) {
    if (data.green_hosting.green) {
      signals.push({
        type: "strength",
        text: "Verified green hosting",
        detail: data.green_hosting.hosted_by ? `Hosted by ${data.green_hosting.hosted_by}` : undefined,
      });
    } else {
      signals.push({ type: "info", text: "Hosting not verified as green" });
    }
  }

  // ─── CAA ───
  if (data.caa_analysis) {
    if (!data.caa_analysis.has_caa) {
      signals.push({ type: "notice", text: "No CAA records", detail: "Any CA can issue certificates" });
    }
  }

  // ─── GreyNoise ───
  if (data.greynoise && !data.greynoise.error) {
    if (data.greynoise.classification === "malicious") {
      signals.push({
        type: "issue",
        text: "IP classified as malicious",
        detail: data.greynoise.name ?? "Identified by GreyNoise",
      });
    } else if (data.greynoise.riot) {
      signals.push({
        type: "info",
        text: "IP is a common business service",
        detail: data.greynoise.name ?? "CDN/DNS/Cloud provider",
      });
    }
  }

  // ─── Well-Known ───
  if (data.well_known) {
    if (data.well_known.pwa_ready) {
      signals.push({ type: "info", text: "Progressive Web App ready" });
    }
    if (data.well_known.has_mobile_apps) {
      signals.push({ type: "info", text: "Mobile app deep links configured" });
    }
    if (data.well_known.ads_partner_count != null && data.well_known.ads_partner_count > 0) {
      signals.push({ type: "info", text: `${data.well_known.ads_partner_count} ad partners (ads.txt)` });
    }
  }

  // ─── Certificate Transparency ───
  if (data.cert_transparency && !data.cert_transparency.error) {
    if (data.cert_transparency.subdomains.length > 20) {
      signals.push({ type: "info", text: `${data.cert_transparency.subdomains.length} subdomains via CT logs` });
    }
  }

  // ─── Network Health ───
  if (data.network_health) {
    const nh = data.network_health;
    if (nh.dns_propagation) {
      if (nh.dns_propagation.consistent) {
        signals.push({
          type: "strength",
          text: "DNS consistent across resolvers",
          detail: `${nh.dns_propagation.unique_ips.length} unique IP${nh.dns_propagation.unique_ips.length !== 1 ? "s" : ""} across ${nh.dns_propagation.resolvers.length} resolvers`,
        });
      } else {
        signals.push({
          type: "notice",
          text: "DNS inconsistent across resolvers",
          detail: "Different resolvers return different IP addresses — propagation may be in progress",
        });
      }
    }
    if (nh.ripe_routing) {
      if (nh.ripe_routing.routing_stability === "unstable") {
        signals.push({
          type: "issue",
          text: `Unstable BGP routing (${nh.ripe_routing.bgp_updates_24h} updates/24h)`,
          detail: "Frequent route changes may cause intermittent reachability issues",
        });
      } else if (nh.ripe_routing.routing_stability === "stable") {
        signals.push({ type: "strength", text: "Stable BGP routing" });
      }
      if (nh.ripe_routing.visibility && nh.ripe_routing.visibility.percentage < 70) {
        signals.push({
          type: "notice",
          text: `Low route visibility (${nh.ripe_routing.visibility.percentage}%)`,
          detail: "Route not seen by many BGP peers — may indicate reachability issues",
        });
      }
    }
    if (nh.connection_timing) {
      const total = Math.round(nh.connection_timing.total_ms);
      if (total < 200) signals.push({ type: "strength", text: `Fast connection setup (${total}ms)` });
      else if (total > 500)
        signals.push({
          type: "notice",
          text: `Slow connection setup (${total}ms)`,
          detail: "DNS + TCP + TLS handshake combined",
        });
    }
  }

  return signals;
}

// ─── External Tool Links ───

interface ExternalToolLink {
  name: string;
  url: string;
  category: string;
}

function buildExternalLinks(data: AnalysisResult): ExternalToolLink[] {
  const domain = data.domain;
  const ip = data.ip_info?.ip;
  const links: ExternalToolLink[] = [];

  // Security
  links.push({
    name: "SecurityHeaders",
    url: `https://securityheaders.com/?q=${domain}&followRedirects=on`,
    category: "Security",
  });
  links.push({
    name: "SSL Labs",
    url: `https://www.ssllabs.com/ssltest/analyze.html?d=${domain}`,
    category: "Security",
  });
  links.push({ name: "VirusTotal", url: `https://www.virustotal.com/gui/domain/${domain}`, category: "Security" });
  links.push({
    name: "Google Safe Browsing",
    url: `https://transparencyreport.google.com/safe-browsing/search?url=${domain}`,
    category: "Security",
  });

  // Infrastructure
  if (ip) {
    links.push({ name: "Shodan", url: `https://www.shodan.io/host/${ip}`, category: "Infrastructure" });
    links.push({ name: "Censys", url: `https://search.censys.io/hosts/${ip}`, category: "Infrastructure" });
  }
  links.push({ name: "DNSViz", url: `https://dnsviz.net/d/${domain}/dnssec/`, category: "Infrastructure" });

  // WHOIS
  links.push({ name: "ICANN Lookup", url: `https://lookup.icann.org/en/lookup?name=${domain}`, category: "WHOIS" });
  links.push({ name: "who.is", url: `https://who.is/whois/${domain}`, category: "WHOIS" });

  // Email
  links.push({
    name: "MXToolbox",
    url: `https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${domain}&run=toolpage`,
    category: "Email",
  });

  // Performance
  links.push({
    name: "PageSpeed Insights",
    url: `https://pagespeed.web.dev/analysis?url=https://${domain}`,
    category: "Performance",
  });
  links.push({ name: "GTmetrix", url: `https://gtmetrix.com/?url=https://${domain}`, category: "Performance" });
  links.push({
    name: "WebPageTest",
    url: `https://www.webpagetest.org/?url=https://${domain}`,
    category: "Performance",
  });

  // Archive
  links.push({ name: "Wayback Machine", url: `https://web.archive.org/web/*/https://${domain}`, category: "Archive" });

  // Tech & SEO
  links.push({ name: "BuiltWith", url: `https://builtwith.com/${domain}`, category: "Tech" });
  links.push({
    name: "Rich Results Test",
    url: `https://search.google.com/test/rich-results?url=https://${domain}`,
    category: "SEO",
  });
  links.push({
    name: "Ahrefs Backlinks",
    url: `https://ahrefs.com/backlink-checker/?input=${domain}`,
    category: "SEO",
  });

  // Network Health
  if (data.network_health?.ripe_routing?.asn) {
    links.push({
      name: "bgp.tools",
      url: `https://bgp.tools/as/${data.network_health.ripe_routing.asn}`,
      category: "Routing",
    });
    links.push({
      name: "HE BGP",
      url: `https://bgp.he.net/AS${data.network_health.ripe_routing.asn}`,
      category: "Routing",
    });
  }
  if (ip) {
    links.push({ name: "HE BGP (IP)", url: `https://bgp.he.net/ip/${ip}`, category: "Routing" });
  }
  if (data.network_health?.outage_links?.downdetector?.exists) {
    links.push({
      name: "Downdetector",
      url: data.network_health.outage_links.downdetector.url,
      category: "Monitoring",
    });
  }

  return links;
}

// ─── Render ───

const iconMap = {
  strength: <CheckCircle2 size={13} />,
  notice: <AlertTriangle size={13} />,
  issue: <XCircle size={13} />,
  info: <Info size={13} />,
};

const colorMap = {
  strength: "var(--success)",
  notice: "var(--warning)",
  issue: "var(--danger)",
  info: "var(--accent)",
};

const bgMap = {
  strength: "var(--success-subtle)",
  notice: "var(--warning-subtle)",
  issue: "var(--danger-subtle)",
  info: "var(--accent-subtle)",
};

const labelMap = {
  strength: "Strengths",
  notice: "Notices",
  issue: "Issues",
  info: "Info",
};

const tooltipMap: Record<string, string> = {
  strength: "Security and infrastructure features this domain has implemented well",
  notice: "Areas that could be improved but aren't necessarily problems",
  issue: "Active problems that should be addressed — these may affect security, deliverability, or trust",
  info: "Neutral facts about this domain's infrastructure, hosting, and configuration",
};

export function DomainSignals({ data, streaming }: { data: AnalysisResult; streaming?: boolean }) {
  const signals = buildSignals(data, streaming);
  if (signals.length === 0) return null;

  const groups: Record<string, Signal[]> = { strength: [], notice: [], issue: [], info: [] };
  for (const s of signals) {
    groups[s.type].push(s);
  }

  // Order: issues first (attention), then notices, strengths, info
  const order: Array<Signal["type"]> = ["issue", "notice", "strength", "info"];
  const nonEmptyGroups = order.filter((t) => groups[t].length > 0);

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="opacity-60" aria-hidden="true">
            <Info size={14} />
          </span>
          <h3
            style={{
              fontSize: "inherit",
              fontWeight: "inherit",
              textTransform: "inherit",
              letterSpacing: "inherit",
              color: "inherit",
              margin: 0,
            }}
          >
            Domain Signals
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {groups.issue.length > 0 && (
            <span className="badge badge-fail">
              {groups.issue.length} issue{groups.issue.length > 1 ? "s" : ""}
            </span>
          )}
          {groups.notice.length > 0 && (
            <span className="badge badge-warn">
              {groups.notice.length} notice{groups.notice.length > 1 ? "s" : ""}
            </span>
          )}
          {groups.strength.length > 0 && (
            <span className="badge badge-pass">
              {groups.strength.length} strength{groups.strength.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="p-4 space-y-4">
        {nonEmptyGroups.map((type) => (
          <div key={type}>
            <div className="flex items-center gap-1.5 mb-2">
              <span style={{ color: colorMap[type] }} aria-hidden="true">
                {iconMap[type]}
              </span>
              <h4
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: colorMap[type],
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  margin: 0,
                }}
              >
                {labelMap[type]}
              </h4>
              <Tooltip text={tooltipMap[type]} help />
            </div>
            <div className="space-y-1">
              {groups[type].map((signal, i) => {
                const ref = findReferenceLink(signal.text);
                return (
                  <div
                    key={`sig-${i}`}
                    className="flex items-start gap-2 rounded-md px-2.5 py-1.5"
                    style={{ background: bgMap[type] }}
                  >
                    <span style={{ color: colorMap[type], marginTop: "1px", flexShrink: 0 }}>{iconMap[type]}</span>
                    <div className="flex-1 min-w-0">
                      <span
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: "12px",
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {signal.text}
                      </span>
                      {signal.detail && (
                        <span
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: "11px",
                            color: "var(--dim)",
                            marginLeft: "6px",
                          }}
                        >
                          — {signal.detail}
                        </span>
                      )}
                    </div>
                    {ref && (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={ref.label}
                        style={{
                          color: "var(--dim)",
                          flexShrink: 0,
                          marginTop: "2px",
                          opacity: 0.5,
                          transition: "opacity 0.15s",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
                      >
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExternalTools({ data }: { data: AnalysisResult }) {
  const links = buildExternalLinks(data);
  const categories = [...new Set(links.map((l) => l.category))];

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2.5">
        <span className="opacity-60">
          <ExternalLink size={14} />
        </span>
        <span>External Tools</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {categories.map((cat) => (
            <div key={cat}>
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "10px",
                  fontWeight: 600,
                  color: "var(--dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: "6px",
                }}
              >
                {cat}
              </div>
              <div className="space-y-1">
                {links
                  .filter((l) => l.category === cat)
                  .map((link, i) => (
                    <a
                      key={`sig-${i}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors"
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: "11px",
                        color: "var(--accent)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-subtle)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <ExternalLink size={10} style={{ flexShrink: 0, opacity: 0.6 }} />
                      {link.name}
                    </a>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
