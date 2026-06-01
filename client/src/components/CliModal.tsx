import { Check, Copy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface CliCommand {
  label: string;
  platforms: { linux: string; mac?: string; windows?: string };
}

interface CliModalProps {
  commands: CliCommand[];
  domain?: string;
  ip?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex items-center gap-1 px-2 py-0.5 rounded transition-all"
      style={{
        background: copied ? "rgba(63, 185, 80, 0.15)" : "var(--surface-raised)",
        border: "1px solid var(--border-muted)",
        color: copied ? "var(--success)" : "var(--dim)",
        cursor: "pointer",
        fontSize: "10px",
        fontFamily: "var(--font-ui)",
      }}
      title="Copy to clipboard"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CliButton({ commands, domain, ip }: CliModalProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"linux" | "windows">("linux");
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Replace placeholders
  const interpolate = (cmd: string) => {
    let result = cmd;
    if (domain) result = result.replace(/\{domain\}/g, domain);
    if (ip) {
      result = result.replace(/\{ip\}/g, ip);
      result = result.replace(/\{reversed_ip\}/g, ip.split(".").reverse().join("."));
    }
    return result;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cli-btn"
        title="Show CLI commands"
        aria-label="Show CLI commands"
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.5px",
          }}
        >
          &gt;_
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", textTransform: "none" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={modalRef}
            className="w-full max-w-lg mx-4 rounded-xl overflow-hidden"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--accent)", fontWeight: 700 }}
                >
                  &gt;_
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "13px", color: "var(--text)", fontWeight: 600 }}>
                  CLI Equivalents
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* Platform tabs */}
                <div className="flex rounded-md overflow-hidden" style={{ border: "1px solid var(--border-muted)" }}>
                  <button
                    type="button"
                    onClick={() => setTab("linux")}
                    className="px-3 py-1 transition-all"
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "11px",
                      fontWeight: 500,
                      cursor: "pointer",
                      border: "none",
                      background: tab === "linux" ? "var(--accent)" : "transparent",
                      color: tab === "linux" ? "var(--accent-fg)" : "var(--dim)",
                    }}
                  >
                    Linux / macOS
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("windows")}
                    className="px-3 py-1 transition-all"
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "11px",
                      fontWeight: 500,
                      cursor: "pointer",
                      border: "none",
                      background: tab === "windows" ? "var(--accent)" : "transparent",
                      color: tab === "windows" ? "var(--accent-fg)" : "var(--dim)",
                    }}
                  >
                    Windows
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  style={{ color: "var(--dim)", cursor: "pointer", background: "none", border: "none" }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Commands list */}
            <div className="p-3 space-y-2" style={{ maxHeight: "70vh", overflowY: "auto" }}>
              {commands.map((cmd, i) => {
                const raw =
                  tab === "windows" && cmd.platforms.windows
                    ? cmd.platforms.windows
                    : tab === "linux" && cmd.platforms.mac
                      ? cmd.platforms.mac
                      : cmd.platforms.linux;
                const text = interpolate(raw);
                return (
                  <div
                    key={`cli-${i}`}
                    className="rounded-lg p-3"
                    style={{ background: "var(--bg)", border: "1px solid var(--border-muted)" }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        style={{ fontFamily: "var(--font-ui)", fontSize: "11px", color: "var(--dim)", fontWeight: 500 }}
                      >
                        {cmd.label}
                      </span>
                      <CopyButton text={text} />
                    </div>
                    <pre
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        color: "var(--accent)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        lineHeight: "18px",
                        margin: 0,
                      }}
                    >
                      {text}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Pre-built CLI command sets ──────────────────────────────────────

export function dnsCliCommands(domain: string): CliCommand[] {
  return [
    { label: "A Records", platforms: { linux: `dig ${domain} A +short`, windows: `nslookup ${domain}` } },
    { label: "MX Records", platforms: { linux: `dig ${domain} MX +short`, windows: `nslookup -type=MX ${domain}` } },
    { label: "TXT Records", platforms: { linux: `dig ${domain} TXT +short`, windows: `nslookup -type=TXT ${domain}` } },
    { label: "NS Records", platforms: { linux: `dig ${domain} NS +short`, windows: `nslookup -type=NS ${domain}` } },
    {
      label: "AAAA Records",
      platforms: { linux: `dig ${domain} AAAA +short`, windows: `nslookup -type=AAAA ${domain}` },
    },
    { label: "SOA Record", platforms: { linux: `dig ${domain} SOA +short`, windows: `nslookup -type=SOA ${domain}` } },
  ];
}

export function whoisCliCommands(domain: string): CliCommand[] {
  return [{ label: "WHOIS Lookup", platforms: { linux: `whois ${domain}`, windows: `whois ${domain}` } }];
}

export function sslCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "SSL Certificate Details",
      platforms: {
        linux: `openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -dates -issuer -subject`,
        windows: `openssl s_client -connect ${domain}:443 -servername ${domain} 2>nul | openssl x509 -noout -dates -issuer -subject`,
      },
    },
    {
      label: "SSL Verify",
      platforms: {
        linux: `curl -sI https://${domain} -o /dev/null -w '%{ssl_verify_result}'`,
        windows: `curl -sI https://${domain} -o nul -w "%{ssl_verify_result}"`,
      },
    },
  ];
}

export function headersCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "HTTP Headers",
      platforms: { linux: `curl -sI https://${domain}`, windows: `curl -sI https://${domain}` },
    },
    {
      label: "Security Headers Only",
      platforms: {
        linux: `curl -sI https://${domain} | grep -iE '(strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy)'`,
        windows: `curl -sI https://${domain} | findstr /I "strict-transport content-security x-frame x-content-type referrer-policy permissions-policy"`,
      },
    },
  ];
}

export function dnssecCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "DNSKEY Records",
      platforms: { linux: `dig ${domain} DNSKEY +short`, windows: `nslookup -type=DNSKEY ${domain}` },
    },
    { label: "DS Records", platforms: { linux: `dig ${domain} DS +short`, windows: `nslookup -type=DS ${domain}` } },
    {
      label: "DNSSEC Validation",
      platforms: { linux: `dig +dnssec ${domain}`, windows: `nslookup -type=A ${domain}` },
    },
  ];
}

export function shodanCliCommands(ip: string): CliCommand[] {
  return [
    {
      label: "Shodan InternetDB",
      platforms: {
        linux: `curl -s https://internetdb.shodan.io/${ip} | python3 -m json.tool`,
        windows: `curl -s https://internetdb.shodan.io/${ip} | python -m json.tool`,
      },
    },
  ];
}

export function emailAuthCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "SPF Record",
      platforms: {
        linux: `dig ${domain} TXT +short | grep spf`,
        windows: `nslookup -type=TXT ${domain} | findstr spf`,
      },
    },
    {
      label: "DMARC Record",
      platforms: { linux: `dig _dmarc.${domain} TXT +short`, windows: `nslookup -type=TXT _dmarc.${domain}` },
    },
    {
      label: "DKIM (default)",
      platforms: {
        linux: `dig default._domainkey.${domain} TXT +short`,
        windows: `nslookup -type=TXT default._domainkey.${domain}`,
      },
    },
    {
      label: "BIMI Record",
      platforms: {
        linux: `dig default._bimi.${domain} TXT +short`,
        windows: `nslookup -type=TXT default._bimi.${domain}`,
      },
    },
    {
      label: "MTA-STS Policy",
      platforms: {
        linux: `curl -s https://mta-sts.${domain}/.well-known/mta-sts.txt`,
        windows: `curl -s https://mta-sts.${domain}/.well-known/mta-sts.txt`,
      },
    },
  ];
}

export function ipInfoCliCommands(ip: string): CliCommand[] {
  return [
    {
      label: "IP Geolocation",
      platforms: { linux: `curl -s http://ip-api.com/json/${ip}`, windows: `curl -s http://ip-api.com/json/${ip}` },
    },
    { label: "Reverse DNS", platforms: { linux: `host ${ip}`, windows: `nslookup ${ip}` } },
  ];
}

export function blocklistCliCommands(ip: string): CliCommand[] {
  const reversed = ip.split(".").reverse().join(".");
  return [
    {
      label: "Spamhaus Check",
      platforms: { linux: `dig ${reversed}.zen.spamhaus.org +short`, windows: `nslookup ${reversed}.zen.spamhaus.org` },
    },
  ];
}

export function performanceCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "PageSpeed Insights",
      platforms: {
        linux: `curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&strategy=mobile&key=YOUR_API_KEY" | jq '{score: .lighthouseResult.categories.performance.score, lcp: .lighthouseResult.audits["largest-contentful-paint"].displayValue, cls: .lighthouseResult.audits["cumulative-layout-shift"].displayValue, fcp: .lighthouseResult.audits["first-contentful-paint"].displayValue}'`,
        windows: `curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&strategy=mobile&key=YOUR_API_KEY" | jq "{score: .lighthouseResult.categories.performance.score, lcp: .lighthouseResult.audits["""largest-contentful-paint"""].displayValue}"`,
      },
    },
    {
      label: "PageSpeed (no key)",
      platforms: {
        linux: `curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&strategy=mobile" | jq '.lighthouseResult.categories.performance.score'`,
        windows: `curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&strategy=mobile" | jq ".lighthouseResult.categories.performance.score"`,
      },
    },
    {
      label: "Response Timing",
      platforms: {
        linux: `curl -sI -o /dev/null -w 'HTTP/%{http_version} %{http_code}\\nTTFB: %{time_starttransfer}s\\nTotal: %{time_total}s\\nSize: %{size_download} bytes\\n' https://${domain}`,
        windows: `curl -sI -o nul -w "HTTP/%{http_version} %{http_code}\\nTTFB: %{time_starttransfer}s\\nTotal: %{time_total}s\\nSize: %{size_download} bytes\\n" https://${domain}`,
      },
    },
    { label: "Ping", platforms: { linux: `ping -c 4 ${domain}`, windows: `ping -n 4 ${domain}` } },
    { label: "Traceroute", platforms: { linux: `traceroute ${domain}`, windows: `tracert ${domain}` } },
  ];
}

export function compressionCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Compression Check",
      platforms: {
        linux: `curl -sI -H "Accept-Encoding: gzip, deflate, br" https://${domain} | grep -i content-encoding`,
        windows: `curl -sI -H "Accept-Encoding: gzip, deflate, br" https://${domain} | findstr /I content-encoding`,
      },
    },
  ];
}

export function robotsCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "robots.txt",
      platforms: { linux: `curl -s https://${domain}/robots.txt`, windows: `curl -s https://${domain}/robots.txt` },
    },
    {
      label: "Sitemap",
      platforms: {
        linux: `curl -s https://${domain}/sitemap.xml | head -20`,
        windows: `curl -s https://${domain}/sitemap.xml`,
      },
    },
  ];
}

export function availabilityCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Global HTTP Check",
      platforms: {
        linux: `curl -sH "Accept: application/json" "https://check-host.net/check-http?host=https://${domain}&max_nodes=10"`,
        windows: `curl -sH "Accept: application/json" "https://check-host.net/check-http?host=https://${domain}&max_nodes=10"`,
      },
    },
    {
      label: "Get Check Results",
      platforms: {
        linux: `curl -sH "Accept: application/json" "https://check-host.net/check-result/<REQUEST_ID>" | jq`,
        windows: `curl -sH "Accept: application/json" "https://check-host.net/check-result/<REQUEST_ID>" | jq`,
      },
    },
    {
      label: "Global Ping",
      platforms: {
        linux: `curl -sH "Accept: application/json" "https://check-host.net/check-ping?host=${domain}&max_nodes=10"`,
        windows: `curl -sH "Accept: application/json" "https://check-host.net/check-ping?host=${domain}&max_nodes=10"`,
      },
    },
    {
      label: "Global TCP Check",
      platforms: {
        linux: `curl -sH "Accept: application/json" "https://check-host.net/check-tcp?host=${domain}:443&max_nodes=10"`,
        windows: `curl -sH "Accept: application/json" "https://check-host.net/check-tcp?host=${domain}:443&max_nodes=10"`,
      },
    },
    {
      label: "Global DNS Check",
      platforms: {
        linux: `curl -sH "Accept: application/json" "https://check-host.net/check-dns?host=${domain}&max_nodes=10"`,
        windows: `curl -sH "Accept: application/json" "https://check-host.net/check-dns?host=${domain}&max_nodes=10"`,
      },
    },
  ];
}

export function networkHealthCliCommands(domain: string, ip?: string): CliCommand[] {
  const cmds: CliCommand[] = [
    {
      label: "Yoke Network Health",
      platforms: {
        linux: `curl -s https://yoke.lol/${domain} | jq '.network_health'`,
        windows: `curl -s https://yoke.lol/${domain} | jq ".network_health"`,
      },
    },
    {
      label: "DNS Propagation (Google)",
      platforms: {
        linux: `curl -s "https://dns.google/resolve?name=${domain}&type=A" | jq '.Answer'`,
        windows: `curl -s "https://dns.google/resolve?name=${domain}&type=A" | jq ".Answer"`,
      },
    },
    {
      label: "DNS Propagation (Cloudflare)",
      platforms: {
        linux: `curl -s -H "Accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=${domain}&type=A" | jq '.Answer'`,
        windows: `curl -s -H "Accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=${domain}&type=A" | jq ".Answer"`,
      },
    },
    {
      label: "Connection Timing",
      platforms: {
        linux: `curl -sI -o /dev/null -w 'DNS: %{time_namelookup}s\\nTCP: %{time_connect}s\\nTLS: %{time_appconnect}s\\nTotal: %{time_total}s\\n' https://${domain}`,
        windows: `curl -sI -o nul -w "DNS: %{time_namelookup}s\\nTCP: %{time_connect}s\\nTLS: %{time_appconnect}s\\nTotal: %{time_total}s\\n" https://${domain}`,
      },
    },
  ];
  if (ip) {
    cmds.push({
      label: "RIPE Prefix Overview",
      platforms: {
        linux: `curl -s "https://stat.ripe.net/data/prefix-overview/data.json?resource=${ip}" | jq '.data'`,
        windows: `curl -s "https://stat.ripe.net/data/prefix-overview/data.json?resource=${ip}" | jq ".data"`,
      },
    });
    cmds.push({
      label: "RIPE Routing Status",
      platforms: {
        linux: `curl -s "https://stat.ripe.net/data/routing-status/data.json?resource=${ip}" | jq '.data.visibility'`,
        windows: `curl -s "https://stat.ripe.net/data/routing-status/data.json?resource=${ip}" | jq ".data.visibility"`,
      },
    });
  }
  return cmds;
}

export function breachCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "HIBP Breaches",
      platforms: {
        linux: `curl -s -H "hibp-api-key: YOUR_API_KEY" "https://haveibeenpwned.com/api/v3/breaches?domain=${domain}" | jq '.[].Name'`,
        windows: `curl -s -H "hibp-api-key: YOUR_API_KEY" "https://haveibeenpwned.com/api/v3/breaches?domain=${domain}" | jq ".[].Name"`,
      },
    },
    {
      label: "HIBP Breach Count",
      platforms: {
        linux: `curl -s "https://haveibeenpwned.com/api/v3/breaches" | jq '[.[] | select(.Domain=="${domain}")] | length'`,
        windows: `curl -s "https://haveibeenpwned.com/api/v3/breaches" | jq "[.[] | select(.Domain=="${domain}")] | length"`,
      },
    },
  ];
}

export function httpProtocolCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "HTTP/2 Support",
      platforms: {
        linux: `curl -sI --http2 -o /dev/null -w '%{http_version}' https://${domain}`,
        windows: `curl -sI --http2 -o nul -w "%{http_version}" https://${domain}`,
      },
    },
    {
      label: "HTTP/3 Support",
      platforms: {
        linux: `curl -sI --http3-only -o /dev/null -w '%{http_version}' https://${domain} 2>/dev/null || echo "HTTP/3 not supported by this curl build"`,
        windows: `curl -sI --http3-only -o nul -w "%{http_version}" https://${domain} 2>nul`,
      },
    },
    {
      label: "HSTS Header",
      platforms: {
        linux: `curl -sI https://${domain} | grep -i strict-transport-security`,
        windows: `curl -sI https://${domain} | findstr /I strict-transport-security`,
      },
    },
  ];
}

export function techStackCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Server Header",
      platforms: {
        linux: `curl -sI https://${domain} | grep -i '^server:'`,
        windows: `curl -sI https://${domain} | findstr /I "^server:"`,
      },
    },
    {
      label: "X-Powered-By",
      platforms: {
        linux: `curl -sI https://${domain} | grep -i '^x-powered-by'`,
        windows: `curl -sI https://${domain} | findstr /I "x-powered-by"`,
      },
    },
    {
      label: "Generator Meta",
      platforms: {
        linux: `curl -sL https://${domain} | grep -ioP '<meta[^>]+name="?generator"?[^>]+content="?\\K[^">/]+'`,
        windows: `curl -sL https://${domain} | findstr /I "generator"`,
      },
    },
    {
      label: "Cookie Frameworks",
      platforms: {
        linux: `curl -sI https://${domain} | grep -i '^set-cookie' | head -5`,
        windows: `curl -sI https://${domain} | findstr /I "set-cookie"`,
      },
    },
  ];
}

export function wordpressCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "WP Version",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP 'wp-includes/[^"]+\\.js\\?ver=\\K[0-9.]+'| head -1`,
        windows: `curl -sL https://${domain} | findstr /I "wp-includes"`,
      },
    },
    {
      label: "REST API",
      platforms: {
        linux: `curl -s https://${domain}/wp-json/ | jq '{name, url, namespaces}'`,
        windows: `curl -s https://${domain}/wp-json/ | jq "{name, url, namespaces}"`,
      },
    },
    {
      label: "Active Theme",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '/wp-content/themes/\\K[^/]+' | sort -u | head -1`,
        windows: `curl -sL https://${domain} | findstr /I "wp-content/themes"`,
      },
    },
    {
      label: "Plugin Detection",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '/wp-content/plugins/\\K[^/]+' | sort -u`,
        windows: `curl -sL https://${domain} | findstr /I "wp-content/plugins"`,
      },
    },
  ];
}

export function structuredDataCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "JSON-LD",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '<script[^>]+type="application/ld\\+json"[^>]*>\\K[^<]+' | jq '.["@type"]'`,
        windows: `curl -sL https://${domain} | findstr /I "application/ld+json"`,
      },
    },
    {
      label: "Schema.org Types",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '"@type"\\s*:\\s*"\\K[^"]+' | sort -u`,
        windows: `curl -sL https://${domain} | findstr /I "@type"`,
      },
    },
  ];
}

export function ogPreviewCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Open Graph Tags",
      platforms: {
        linux: `curl -sL https://${domain} | grep -iE '<meta[^>]+(og:|twitter:)[^>]+>' | head -20`,
        windows: `curl -sL https://${domain} | findstr /I "og: twitter:"`,
      },
    },
    {
      label: "OG Image",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '<meta[^>]+property="og:image"[^>]+content="\\K[^"]+'`,
        windows: `curl -sL https://${domain} | findstr /I "og:image"`,
      },
    },
    {
      label: "Favicon",
      platforms: {
        linux: `curl -sL https://${domain} | grep -ioP '<link[^>]+rel="[^"]*icon[^"]*"[^>]+href="\\K[^"]+'`,
        windows: `curl -sL https://${domain} | findstr /I "icon"`,
      },
    },
  ];
}

export function thirdPartyScriptsCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "External Scripts",
      platforms: {
        linux: `curl -sL https://${domain} | grep -oP '<script[^>]+src="\\K[^"]+' | grep -v '${domain}' | sort -u`,
        windows: `curl -sL https://${domain} | findstr /I "<script" | findstr /I "src="`,
      },
    },
    {
      label: "Tracking Pixels",
      platforms: {
        linux: `curl -sL https://${domain} | grep -ioE '(google-analytics|googletagmanager|facebook\\.net|connect\\.facebook|analytics|gtag|fbq|_ga)' | sort -u`,
        windows: `curl -sL https://${domain} | findstr /I "google-analytics googletagmanager facebook.net gtag"`,
      },
    },
  ];
}

export function cacheCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Cache Headers",
      platforms: {
        linux: `curl -sI https://${domain} | grep -iE '(cache-control|expires|etag|last-modified|age|cf-cache|x-cache)'`,
        windows: `curl -sI https://${domain} | findstr /I "cache-control expires etag last-modified age cf-cache x-cache"`,
      },
    },
    {
      label: "CDN Detection",
      platforms: {
        linux: `curl -sI https://${domain} | grep -iE '(cf-ray|x-cdn|x-served-by|x-cache|via|server: cloudflare|server: AmazonS3)'`,
        windows: `curl -sI https://${domain} | findstr /I "cf-ray x-cdn x-served-by x-cache via"`,
      },
    },
  ];
}

export function subdomainCliCommands(domain: string): CliCommand[] {
  return [
    {
      label: "Certificate Transparency",
      platforms: {
        linux: `curl -s "https://crt.sh/?q=%25.${domain}&output=json" | jq -r '.[].name_value' | sort -u | head -20`,
        windows: `curl -s "https://crt.sh/?q=%25.${domain}&output=json" | jq -r ".[].name_value" | sort`,
      },
    },
    {
      label: "Common Subdomains",
      platforms: {
        linux: `for sub in www mail ftp api dev staging app cdn; do dig +short $sub.${domain} A | grep -q . && echo "$sub.${domain}"; done`,
        windows: `for %s in (www mail ftp api dev staging app cdn) do @nslookup %s.${domain} 2>nul | findstr /I "Address" && echo %s.${domain}`,
      },
    },
  ];
}
