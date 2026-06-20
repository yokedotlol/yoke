// ─── Asset CDN Detection ─────────────────────────────────────────────
// Scan HTML source for resource URLs pointing to known CDN hostnames.
// Detects CDN usage for static assets even when the main site isn't
// CDN-fronted (complementary to the full-site CDN detection in security.ts).

export interface AssetCdnProvider {
  name: string;
  urls: number;
}

export interface AssetCdnResult {
  detected: boolean;
  providers: AssetCdnProvider[];
  sameOriginCdn: boolean;
  totalCdnUrls: number;
}

// ─── CDN Hostname → Display Name Mapping ────────────────────────────

interface CdnPattern {
  pattern: RegExp;
  name: string;
}

const CDN_PATTERNS: CdnPattern[] = [
  // Major CDN providers
  { pattern: /\.cloudfront\.net$/i, name: "CloudFront" },
  { pattern: /\.akamaihd\.net$/i, name: "Akamai" },
  { pattern: /\.akamaiedge\.net$/i, name: "Akamai" },
  { pattern: /\.akamai\.net$/i, name: "Akamai" },
  { pattern: /\.fastly\.net$/i, name: "Fastly" },
  { pattern: /\.fastlylb\.net$/i, name: "Fastly" },
  { pattern: /\.b-cdn\.net$/i, name: "BunnyCDN" },
  { pattern: /\.bunny\.net$/i, name: "BunnyCDN" },
  { pattern: /\.cdnetworks\.net$/i, name: "CDNetworks" },
  { pattern: /\.cdngc\.net$/i, name: "CDNetworks" },
  { pattern: /\.quantil\.com$/i, name: "CDNetworks" },
  { pattern: /\.azureedge\.net$/i, name: "Azure CDN" },
  { pattern: /\.azurefd\.net$/i, name: "Azure CDN" },
  { pattern: /\.cdn\.cloudflare\.net$/i, name: "Cloudflare" },
  { pattern: /\.cdnjs\.cloudflare\.com$/i, name: "Cloudflare" },
  { pattern: /\.stackpathdns\.com$/i, name: "StackPath" },
  { pattern: /\.highwinds\.com$/i, name: "StackPath" },
  { pattern: /\.hwcdn\.net$/i, name: "StackPath" },
  { pattern: /\.kxcdn\.com$/i, name: "KeyCDN" },
  { pattern: /\.cdn77\.org$/i, name: "CDN77" },
  { pattern: /\.gcorelabs\.com$/i, name: "Gcore" },
  { pattern: /\.cachefly\.net$/i, name: "CacheFly" },
  { pattern: /\.edgecastcdn\.net$/i, name: "Edgecast" },

  // WordPress / CMS CDNs
  { pattern: /^i[0-3]\.wp\.com$/i, name: "Jetpack/WP.com" },
  { pattern: /^s[0-2]\.wp\.com$/i, name: "Jetpack/WP.com" },
  { pattern: /^c0\.wp\.com$/i, name: "Jetpack/WP.com" },
  { pattern: /^photon\.wp\.com$/i, name: "Jetpack/WP.com" },
  { pattern: /(?:^|\.)netdna-cdn\.com$/i, name: "MaxCDN" },
  { pattern: /(?:^|\.)netdna-ssl\.com$/i, name: "MaxCDN" },
  { pattern: /maxcdn\.bootstrapcdn\.com$/i, name: "BootstrapCDN" },
  { pattern: /stackpath\.bootstrapcdn\.com$/i, name: "BootstrapCDN" },
  { pattern: /(?:^|\.)smushcdn\.com$/i, name: "Smush" },
  { pattern: /(?:^|\.)optimole\.com$/i, name: "Optimole" },
  { pattern: /(?:^|\.)shortpixel\.ai$/i, name: "ShortPixel" },
  { pattern: /(?:^|\.)nitropack\.io$/i, name: "NitroPack" },

  // Image / media CDNs
  { pattern: /(?:^|\.)imgix\.net$/i, name: "imgix" },
  { pattern: /(?:^|\.)cloudinary\.com$/i, name: "Cloudinary" },

  // Open-source CDNs
  { pattern: /(?:^|\.)jsdelivr\.net$/i, name: "jsDelivr" },
  { pattern: /(?:^|\.)unpkg\.com$/i, name: "unpkg" },
  { pattern: /(?:^|\.)cdnjs\.com$/i, name: "cdnjs" },

  // Regional CDNs
  { pattern: /(?:^|\.)alicdn\.com$/i, name: "Alibaba CDN" },
  { pattern: /(?:^|\.)bdstatic\.com$/i, name: "Baidu" },
  { pattern: /(?:^|\.)myqcloud\.com$/i, name: "Tencent CDN" },
  { pattern: /(?:^|\.)qiniucdn\.com$/i, name: "Qiniu" },
];

// Same-domain CDN subdomain prefixes (medium confidence)
const SAME_ORIGIN_CDN_PREFIXES = /^(cdn|static|assets|media|img|images)\./i;

// URL extraction: src, href, srcset, data-src attributes
const URL_ATTR_RE = /(?:src|href|srcset|data-src)\s*=\s*["']([^"']+)["']/gi;

/**
 * Extract hostname from a URL string. Returns null for relative URLs,
 * data URIs, and malformed URLs.
 */
function extractHostname(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("#") || trimmed.startsWith("mailto:")) {
    return null;
  }
  // Handle protocol-relative URLs
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return null;
  }
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Detect CDN usage in HTML source by scanning resource URLs.
 */
export function detectAssetCdn(html: string, domain: string): AssetCdnResult | null {
  if (!html || html.length < 100) {
    return null;
  }

  const providerCounts = new Map<string, number>();
  let sameOriginCdn = false;
  let totalCdnUrls = 0;

  // Extract all URLs from resource attributes
  let match: RegExpExecArray | null = null;
  while ((match = URL_ATTR_RE.exec(html)) !== null) {
    const rawUrl = match[1];
    // srcset can contain multiple URLs separated by commas with descriptors
    const urls = rawUrl.includes(",") ? rawUrl.split(",").map((part) => part.trim().split(/\s+/)[0]) : [rawUrl];

    for (const u of urls) {
      const hostname = extractHostname(u);
      if (!hostname) continue;

      // Check same-domain CDN subdomains
      if (hostname.endsWith(`.${domain}`) && SAME_ORIGIN_CDN_PREFIXES.test(hostname)) {
        sameOriginCdn = true;
        totalCdnUrls++;
        continue;
      }

      // Check known CDN patterns
      for (const cdnPattern of CDN_PATTERNS) {
        if (cdnPattern.pattern.test(hostname)) {
          const count = providerCounts.get(cdnPattern.name) ?? 0;
          providerCounts.set(cdnPattern.name, count + 1);
          totalCdnUrls++;
          break;
        }
      }
    }
  }

  // Reset regex lastIndex (global flag)
  URL_ATTR_RE.lastIndex = 0;

  const providers: AssetCdnProvider[] = Array.from(providerCounts.entries())
    .map(([name, urls]) => ({ name, urls }))
    .sort((a, b) => b.urls - a.urls);

  const detected = providers.length > 0 || sameOriginCdn;

  return {
    detected,
    providers,
    sameOriginCdn,
    totalCdnUrls,
  };
}
