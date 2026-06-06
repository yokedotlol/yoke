// ─── NS Provider Mapping ─────────────────────────────────────────────
// Maps nameserver hostnames to their DNS provider for NS diversity analysis.
// Covers >95% of commonly-used DNS providers globally.

export interface NsProvider {
  name: string;
  /** Regex pattern(s) to match nameserver hostnames */
  patterns: RegExp[];
}

export const NS_PROVIDERS: NsProvider[] = [
  // ── Major Cloud DNS ─────────────────────────────────────────────
  { name: "Cloudflare", patterns: [/\.ns\.cloudflare\.com$/i, /\.cloudflare\.com$/i] },
  { name: "AWS Route 53", patterns: [/\.awsdns-\d+\./i, /awsdns/i] },
  { name: "Google Cloud DNS", patterns: [/ns-cloud-\w+\.googledomains\.com$/i, /\.googledomains\.com$/i] },
  { name: "Azure DNS", patterns: [/\.azure-dns\./i, /azuredns/i] },
  { name: "Oracle/Dyn", patterns: [/\.dynect\.net$/i, /\.dyn\.com$/i] },
  { name: "NS1", patterns: [/\.nsone\.net$/i, /\.ns1\.com$/i] },
  { name: "UltraDNS/Neustar", patterns: [/\.ultradns\./i, /ultradns/i] },
  { name: "Akamai", patterns: [/\.akam\.net$/i, /\.akamaiedge\.net$/i, /\.akadns\.net$/i] },

  // ── Domain Registrars ───────────────────────────────────────────
  { name: "GoDaddy", patterns: [/\.domaincontrol\.com$/i, /\.secureserver\.net$/i] },
  { name: "Namecheap", patterns: [/\.registrar-servers\.com$/i, /\.namecheaphosting\.com$/i] },
  { name: "Name.com", patterns: [/\.name\.com$/i] },
  { name: "Gandi", patterns: [/\.gandi\.net$/i] },
  { name: "Dynadot", patterns: [/\.dynadot\.com$/i] },
  { name: "Hover", patterns: [/\.hover\.com$/i] },
  { name: "1&1/IONOS", patterns: [/\.ui-dns\./i, /\.ionos\./i] },
  { name: "easyDNS", patterns: [/\.easydns\./i] },

  // ── Hosting Providers ───────────────────────────────────────────
  { name: "DigitalOcean", patterns: [/\.digitalocean\.com$/i] },
  { name: "Linode/Akamai", patterns: [/\.linode\.com$/i] },
  { name: "Hetzner", patterns: [/\.hetzner\./i] },
  { name: "OVH", patterns: [/\.ovh\./i, /\.anycast\.me$/i] },
  { name: "Bluehost", patterns: [/\.bluehost\.com$/i] },
  { name: "SiteGround", patterns: [/\.sgcpanel\.com$/i, /\.siteground\./i] },
  { name: "DreamHost", patterns: [/\.dreamhost\.com$/i] },
  { name: "Media Temple", patterns: [/\.mediatemple\.net$/i] },
  { name: "Hostinger", patterns: [/\.hostinger\./i] },
  { name: "Vultr", patterns: [/\.vultr\.com$/i] },
  { name: "Rackspace", patterns: [/\.rackspace\./i, /\.stabletransit\.com$/i] },

  // ── Website Builders / Platforms ────────────────────────────────
  { name: "Squarespace", patterns: [/\.squarespace\.com$/i, /\.squarespace-dns\.com$/i] },
  { name: "Wix", patterns: [/\.wixdns\.net$/i] },
  { name: "Shopify", patterns: [/\.shopify\.com$/i, /\.myshopify\.com$/i] },
  { name: "Vercel", patterns: [/\.vercel-dns\.com$/i] },
  { name: "Netlify", patterns: [/\.netlify\.com$/i] },
  { name: "WordPress.com", patterns: [/\.wordpress\.com$/i] },
  { name: "Weebly", patterns: [/\.weebly\.com$/i] },
  { name: "Webflow", patterns: [/\.webflow\.io$/i] },
  { name: "Fly.io", patterns: [/\.fly\.io$/i] },
  { name: "Render", patterns: [/\.render\.com$/i] },
  { name: "Railway", patterns: [/\.railway\.app$/i] },

  // ── Specialist DNS Providers ────────────────────────────────────
  { name: "ClouDNS", patterns: [/\.cloudns\.net$/i] },
  { name: "Hurricane Electric", patterns: [/\.he\.net$/i] },
  { name: "FreeDNS", patterns: [/\.afraid\.org$/i] },
  { name: "ZoneEdit", patterns: [/\.zoneedit\.com$/i] },
  { name: "Constellix", patterns: [/\.constellix\.com$/i] },
  { name: "DNS Made Easy", patterns: [/\.dnsmadeeasy\.com$/i] },
  { name: "DNSimple", patterns: [/\.dnsimple\.com$/i] },
  { name: "Rage4", patterns: [/\.rage4\.com$/i] },
  { name: "BuddyNS", patterns: [/\.buddyns\.com$/i] },
  { name: "Quad9 DNS", patterns: [/\.quad9\.net$/i] },
  { name: "Porkbun", patterns: [/\.porkbun\.com$/i] },
  { name: "Bunny.net", patterns: [/\.bunny\.net$/i, /\.bunnyinfra\.net$/i] },

  // ── Enterprise / Legacy ─────────────────────────────────────────
  { name: "Verisign", patterns: [/\.verisigndns\./i, /\.verisign-grs\.com$/i] },
  { name: "CSC/DBS", patterns: [/\.cscdns\./i, /\.corporatedomains\.com$/i] },
  { name: "MarkMonitor", patterns: [/\.markmonitor\.com$/i] },
  { name: "Alibaba Cloud", patterns: [/\.alidns\.com$/i, /\.hichina\.com$/i] },
  { name: "Tencent Cloud", patterns: [/\.tencentcloudns\.com$/i, /\.dnspod\.net$/i] },
  { name: "Baidu Cloud", patterns: [/\.bdydns\.cn$/i] },
  { name: "Yandex Cloud", patterns: [/\.yandex\./i] },

  // ── Additional Platforms (2026) ──────────────────────────────────
  { name: "Fastly", patterns: [/\.fastly\.net$/i, /\.fastlylb\.net$/i] },
  { name: "Deno Deploy", patterns: [/\.deno\.dev$/i] },
  { name: "Supabase", patterns: [/\.supabase\.co$/i, /\.supabase\.com$/i] },
  { name: "Kinsta", patterns: [/\.kinsta\.cloud$/i, /\.kinsta\.com$/i] },
  { name: "Strato", patterns: [/\.strato\./i] },
  { name: "Scaleway", patterns: [/\.scaleway\./i, /\.online\.net$/i] },
];

/**
 * Identify the DNS provider from a nameserver hostname.
 * Returns provider name or null if unrecognized.
 */
export function identifyNsProvider(nsHostname: string): string | null {
  if (!nsHostname || typeof nsHostname !== "string") return null;
  const host = nsHostname.toLowerCase().replace(/\.+$/, "");
  for (const provider of NS_PROVIDERS) {
    for (const pattern of provider.patterns) {
      if (pattern.test(host)) {
        return provider.name;
      }
    }
  }
  return null;
}

/**
 * Analyze NS provider diversity from a list of nameserver hostnames.
 * Returns unique provider names found.
 */
export function analyzeNsDiversity(nsHostnames: string[]): { providers: string[]; isMultiProvider: boolean } {
  const providerSet = new Set<string>();
  for (const ns of nsHostnames) {
    const provider = identifyNsProvider(ns);
    if (provider) {
      providerSet.add(provider);
    }
  }
  const providers = Array.from(providerSet);
  return {
    providers,
    isMultiProvider: providers.length >= 2,
  };
}
