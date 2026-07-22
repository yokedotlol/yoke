// ─── Cookie Consent Detection ────────────────────────────────────────
// Detect Consent Management Platforms and analyze cookie compliance.

export interface CmpDetection {
  name: string;
  confidence: number; // 0-1
}

export interface CookieInfo {
  name: string;
  domain: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
  expires: string | null;
  category: "session" | "persistent" | "third-party";
}

export interface CookieConsentResult {
  cmp_detected: CmpDetection | null;
  cookies_set: CookieInfo[];
  pre_consent_cookies: number;
  has_cookie_policy: boolean;
  compliance_flags: string[];
  p3p_present: boolean;
}

// ─── CMP Detection Patterns ────────────────────────────────────────

interface CmpPattern {
  name: string;
  scriptPatterns: RegExp[];
  htmlPatterns: RegExp[];
  headerPatterns?: RegExp[];
}

const CMP_PATTERNS: CmpPattern[] = [
  {
    name: "OneTrust",
    scriptPatterns: [/cdn\.cookielaw\.org/i, /onetrust\.com/i, /optanon/i],
    htmlPatterns: [/onetrust-consent/i, /optanon/i, /ot-sdk-btn/i, /onetrust-banner/i, /ot-pc-content/i],
  },
  {
    name: "Cookiebot",
    scriptPatterns: [/consent\.cookiebot\.com/i, /cookiebot\.com/i],
    htmlPatterns: [/CookieConsent/i, /cookiebot/i, /CookiebotWidget/i],
  },
  {
    name: "Cookie Script",
    scriptPatterns: [/cookie-script\.com/i],
    htmlPatterns: [/cookie-script-consent/i, /cookiescript/i],
  },
  {
    name: "Quantcast Choice",
    scriptPatterns: [/quantcast\.mgr\.consensu\.org/i, /quantcast\.com.*choice/i],
    htmlPatterns: [/qc-cmp2?-container/i, /quantcast-choice/i],
  },
  {
    name: "Iubenda",
    scriptPatterns: [/cdn\.iubenda\.com/i, /iubenda\.com/i],
    htmlPatterns: [/iubenda-cs-banner/i, /iubenda-cookie/i],
  },
  {
    name: "TrustArc",
    scriptPatterns: [/consent\.trustarc\.com/i, /trustarc\.com/i, /truste\.com/i, /consent-pref/i],
    htmlPatterns: [/truste-consent/i, /trustarc/i, /consent_blackbar/i],
  },
  {
    name: "Didomi",
    scriptPatterns: [/sdk\.privacy-center\.org/i, /didomi\.io/i],
    htmlPatterns: [/didomi/i],
  },
  {
    name: "Osano",
    scriptPatterns: [/cmp\.osano\.com/i, /osano\.com/i],
    htmlPatterns: [/osano-cookie/i, /osano-cm/i],
  },
  {
    name: "Complianz",
    scriptPatterns: [/complianz/i],
    htmlPatterns: [/cmplz-/i, /complianz/i],
  },
  {
    name: "CookieYes",
    scriptPatterns: [/cdn-cookieyes\.com/i, /cookieyes\.com/i],
    htmlPatterns: [/cky-consent/i, /cookieyes/i],
  },
  {
    name: "Civic Cookie Control",
    scriptPatterns: [/cc\.cdn\.civiccomputing\.com/i],
    htmlPatterns: [/civic-cookie/i, /ccc-module/i],
  },
  {
    name: "Cookie Information",
    scriptPatterns: [/policy\.app\.cookieinformation\.com/i],
    htmlPatterns: [/cookie-information-consent/i],
  },
  {
    name: "Usercentrics",
    scriptPatterns: [/app\.usercentrics\.eu/i, /usercentrics\.com/i],
    htmlPatterns: [/usercentrics/i, /uc-banner/i],
  },
  {
    name: "Enzuzo",
    scriptPatterns: [/enzuzo\.com/i, /cdn\.enzuzo\.com/i],
    htmlPatterns: [/enzuzo-cookie/i, /enzuzo-consent/i],
  },
  {
    name: "Ketch",
    scriptPatterns: [/global\.ketchcdn\.com/i, /ketch\.com/i],
    htmlPatterns: [/ketch-consent/i, /lanyard/i],
  },
  {
    name: "Sirdata",
    scriptPatterns: [/sirdata\.io/i, /sddan\.com/i, /cache\.consentframework\.com/i],
    htmlPatterns: [/sirdata/i, /sd-cmp/i],
  },
  {
    name: "Crownpeak",
    scriptPatterns: [/cdn\.crownpeak\.net/i, /evidon\.com/i, /crownpeak\.com/i],
    htmlPatterns: [/evidon-banner/i, /crownpeak-consent/i],
  },
  {
    name: "Clarip",
    scriptPatterns: [/clarip\.com/i],
    htmlPatterns: [/clarip-consent/i, /clarip-cookie/i],
  },
  {
    name: "Consentmanager",
    scriptPatterns: [/cdn\.consentmanager\.net/i, /consentmanager\.net/i],
    htmlPatterns: [/cmpbox/i, /consentmanager/i],
  },
  {
    name: "Piwik PRO Consent",
    scriptPatterns: [/piwik\.pro.*consent/i, /piwikpro.*consent/i],
    htmlPatterns: [/ppms_cm/i, /piwik-pro-consent/i],
  },
  {
    name: "Termly",
    scriptPatterns: [/app\.termly\.io/i, /termly\.io/i],
    htmlPatterns: [/termly-consent/i, /t-consentPrompt/i],
  },
  {
    name: "Pandectes",
    scriptPatterns: [/pandectes\.io/i, /cdn\.pandectes\.io/i],
    htmlPatterns: [/pandectes-banner/i, /pandectes-consent/i],
  },
  {
    name: "Securiti",
    scriptPatterns: [/cdn\.securiti\.ai/i, /securiti\.ai/i],
    htmlPatterns: [/securiti-consent/i, /s-consent/i],
  },
  {
    name: "WebToffee",
    scriptPatterns: [/webtoffee\.com/i, /cookie-law-info/i],
    htmlPatterns: [/cli-modal-content/i, /cookie-law-info-bar/i, /wt-cli-cookie-bar/i],
  },
  {
    name: "Klaro",
    scriptPatterns: [/klaro\.js/i, /klaro-no-css/i, /kiprotect\.com\/klaro/i, /klaro\.org/i, /heyklaro\.com/i],
    htmlPatterns: [/klaro--/i, /klaro-modal/i, /\bklaro\b/i],
  },
];

// ─── Cookie Parsing ─────────────────────────────────────────────────

function parseSetCookieHeaders(headers: Record<string, string>, pageDomain: string): CookieInfo[] {
  const cookies: CookieInfo[] = [];

  // set-cookie headers can be a single value or we may have the combined header
  const setCookieRaw = headers["set-cookie"] ?? "";
  if (!setCookieRaw) return cookies;

  // Split by actual cookie boundaries — look for name=value patterns after newlines or commas
  // set-cookie headers joined with \n or ,
  const _cookieStrings = setCookieRaw.split(
    /\n|(?<=;\s*(?:path|domain|expires|max-age|samesite|secure|httponly)[^;]*),\s*/i,
  );

  // Simpler split: by newline if present, otherwise treat as one
  const lines = setCookieRaw.includes("\n") ? setCookieRaw.split("\n") : [setCookieRaw];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse name=value
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (!name) continue;

    // Parse attributes (case-insensitive)
    const lower = trimmed.toLowerCase();
    const secure = lower.includes("secure");
    const httpOnly = lower.includes("httponly");

    // SameSite
    let sameSite: string | null = null;
    const ssMatch = lower.match(/samesite\s*=\s*(strict|lax|none)/);
    if (ssMatch) sameSite = ssMatch[1] ?? null;

    // Domain
    let cookieDomain = pageDomain;
    const domainMatch = lower.match(/domain\s*=\s*([^;]+)/);
    if (domainMatch) cookieDomain = domainMatch[1]?.trim().replace(/^\./, "");

    // Expires / Max-Age
    let expires: string | null = null;
    const expiresMatch = trimmed.match(/expires\s*=\s*([^;]+)/i);
    if (expiresMatch) expires = expiresMatch[1]?.trim();
    const maxAgeMatch = lower.match(/max-age\s*=\s*(\d+)/);
    if (maxAgeMatch) expires = `max-age=${maxAgeMatch[1]}`;

    // Categorize
    let category: CookieInfo["category"] = "session";
    if (expires || maxAgeMatch) {
      category = "persistent";
    }
    // Check if third-party
    const normalized = (d: string) => d.replace(/^www\./, "").toLowerCase();
    const cd = normalized(cookieDomain);
    const pd = normalized(pageDomain);
    if (cd !== pd && !cd.endsWith(`.${pd}`) && !pd.endsWith(`.${cd}`)) {
      category = "third-party";
    }

    cookies.push({ name, domain: cookieDomain, secure, httpOnly, sameSite, expires, category });
  }

  return cookies;
}

// ─── Main Analysis ──────────────────────────────────────────────────

export function analyzeCookieConsent(
  html: string,
  headers: Record<string, string>,
  domain: string,
): CookieConsentResult {
  const complianceFlags: string[] = [];
  const lowerHtml = html.toLowerCase();

  // ─── 1. Detect CMP ─────────────────────────────────────────────
  let cmpDetected: CmpDetection | null = null;
  let bestConfidence = 0;

  for (const cmp of CMP_PATTERNS) {
    let confidence = 0;

    // Script pattern matches
    for (const pattern of cmp.scriptPatterns) {
      if (pattern.test(html)) {
        confidence += 0.5;
        break;
      }
    }

    // HTML pattern matches (div IDs, class names)
    for (const pattern of cmp.htmlPatterns) {
      if (pattern.test(html)) {
        confidence += 0.3;
        break;
      }
    }

    // Header pattern matches
    if (cmp.headerPatterns) {
      const allHeaders = Object.values(headers).join(" ");
      for (const pattern of cmp.headerPatterns) {
        if (pattern.test(allHeaders)) {
          confidence += 0.2;
          break;
        }
      }
    }

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      cmpDetected = { name: cmp.name, confidence: Math.min(1, confidence) };
    }
  }

  // Also check for generic TCF (IAB Transparency & Consent Framework) signals
  if (!cmpDetected) {
    if (/__tcfapi/i.test(html) || /__cmp/i.test(html) || /gdpr-consent/i.test(lowerHtml)) {
      cmpDetected = { name: "IAB TCF (Generic)", confidence: 0.4 };
    }
  }

  // ─── 2. Parse cookies from headers ──────────────────────────────
  const cookiesSet = parseSetCookieHeaders(headers, domain);

  // ─── 3. Check for pre-consent cookies (tracking before consent) ─
  // If CMP is detected, any tracking cookies in the initial response are
  // potentially set before the user consents
  const knownTrackingCookies = [
    /^_ga/i,
    /^_gid/i,
    /^_gat/i,
    /^_fbp/i,
    /^_fbc/i,
    /^fr$/i,
    /^_gcl/i,
    /^_hjid/i,
    /^_hjSession/i,
    /^_hjAbsoluteSession/i,
    /^mp_/i,
    /^ajs_/i,
    /^__utm/i,
    /^IDE$/i,
    /^NID$/i,
    /^_pin_unauth/i,
    /^li_/i,
    /^bcookie/i,
  ];

  let preConsentCount = 0;
  for (const cookie of cookiesSet) {
    const isTracking = knownTrackingCookies.some((p) => p.test(cookie.name));
    if (isTracking) preConsentCount++;
  }

  // ─── 4. Check for P3P header ────────────────────────────────────
  const p3pPresent = !!headers.p3p;

  // ─── 5. Check for cookie policy page ────────────────────────────
  const hasCookiePolicy =
    /href\s*=\s*["'][^"']*\/cookie[s]?[-_]?policy/i.test(html) ||
    /href\s*=\s*["'][^"']*\/cookie[s]?/i.test(html) ||
    /href\s*=\s*["'][^"']*\/privacy[^"']*["'][^>]*>[^<]*cookie/i.test(html);

  // ─── 6. Compliance flags ────────────────────────────────────────

  if (!cmpDetected) {
    // Only flag if the site appears to have tracking (not every site needs a CMP)
    const hasTrackingScripts = /google-analytics|googletagmanager|facebook\.net|hotjar|mixpanel|segment\.com/i.test(
      html,
    );
    if (hasTrackingScripts) {
      complianceFlags.push("No consent management platform detected despite tracking scripts being present");
    }
  }

  if (preConsentCount > 0) {
    complianceFlags.push(`${preConsentCount} potential tracking cookie(s) set in initial response before user consent`);
  }

  // Check cookie security issues
  const insecureCookies = cookiesSet.filter((c) => !c.secure);
  if (insecureCookies.length > 0) {
    complianceFlags.push(`${insecureCookies.length} cookie(s) without Secure flag`);
  }

  const noSameSite = cookiesSet.filter((c) => !c.sameSite);
  if (noSameSite.length > 0) {
    complianceFlags.push(`${noSameSite.length} cookie(s) without SameSite attribute`);
  }

  const thirdPartyCookies = cookiesSet.filter((c) => c.category === "third-party");
  if (thirdPartyCookies.length > 0) {
    complianceFlags.push(`${thirdPartyCookies.length} third-party cookie(s) set`);
  }

  if (!hasCookiePolicy && cookiesSet.length > 0) {
    complianceFlags.push("Cookies set but no cookie policy page link detected");
  }

  if (p3pPresent) {
    complianceFlags.push("Legacy P3P header present — deprecated and not recognized by modern browsers");
  }

  const longLivedCookies = cookiesSet.filter((c) => {
    if (!c.expires) return false;
    const maxAgeMatch = c.expires.match(/max-age=(\d+)/);
    if (maxAgeMatch) return parseInt(maxAgeMatch[1] ?? "0", 10) > 365 * 24 * 60 * 60;
    return false;
  });
  if (longLivedCookies.length > 0) {
    complianceFlags.push(`${longLivedCookies.length} cookie(s) with expiry exceeding 1 year`);
  }

  return {
    cmp_detected: cmpDetected,
    cookies_set: cookiesSet,
    pre_consent_cookies: preConsentCount,
    has_cookie_policy: hasCookiePolicy,
    compliance_flags: complianceFlags,
    p3p_present: p3pPresent,
  };
}
