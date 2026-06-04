import { useMemo } from "react";

// ─── 250 well-known domains across categories ───────────────────────
// Curated for variety: tech, media, finance, government, education,
// e-commerce, social, infrastructure, gaming, health, etc.
const SEED_DOMAINS = [
  // Tech giants & platforms
  "google.com",
  "apple.com",
  "microsoft.com",
  "amazon.com",
  "meta.com",
  "netflix.com",
  "spotify.com",
  "github.com",
  "gitlab.com",
  "stackoverflow.com",
  "openai.com",
  "anthropic.com",
  "nvidia.com",
  "intel.com",
  "amd.com",
  "cloudflare.com",
  "aws.amazon.com",
  "vercel.com",
  "netlify.com",
  "digitalocean.com",
  "heroku.com",
  "fly.io",
  "supabase.com",
  "firebase.google.com",
  "mongodb.com",
  // SaaS & tools
  "stripe.com",
  "shopify.com",
  "twilio.com",
  "datadog.com",
  "grafana.com",
  "slack.com",
  "notion.so",
  "figma.com",
  "linear.app",
  "1password.com",
  "zoom.us",
  "dropbox.com",
  "atlassian.com",
  "hubspot.com",
  "salesforce.com",
  "zendesk.com",
  "intercom.com",
  "mailchimp.com",
  "sendgrid.com",
  "postmark.app",
  "sentry.io",
  "launchdarkly.com",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  // Social & content
  "twitter.com",
  "instagram.com",
  "linkedin.com",
  "reddit.com",
  "pinterest.com",
  "tiktok.com",
  "youtube.com",
  "twitch.tv",
  "discord.com",
  "signal.org",
  "telegram.org",
  "whatsapp.com",
  "mastodon.social",
  "bsky.app",
  "threads.net",
  // Media & publishing
  "nytimes.com",
  "washingtonpost.com",
  "bbc.com",
  "reuters.com",
  "theguardian.com",
  "wsj.com",
  "bloomberg.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "wired.com",
  "engadget.com",
  "vice.com",
  "vox.com",
  "medium.com",
  "substack.com",
  "wordpress.com",
  "ghost.org",
  "squarespace.com",
  "wix.com",
  // E-commerce & retail
  "ebay.com",
  "etsy.com",
  "walmart.com",
  "target.com",
  "bestbuy.com",
  "costco.com",
  "homedepot.com",
  "ikea.com",
  "wayfair.com",
  "zappos.com",
  "nike.com",
  "adidas.com",
  "patagonia.com",
  "allbirds.com",
  "warbyparker.com",
  // Finance
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "goldmansachs.com",
  "paypal.com",
  "venmo.com",
  "wise.com",
  "revolut.com",
  "coinbase.com",
  "robinhood.com",
  "fidelity.com",
  "vanguard.com",
  "schwab.com",
  "plaid.com",
  "square.com",
  // Government & civic
  "usa.gov",
  "whitehouse.gov",
  "nasa.gov",
  "cdc.gov",
  "irs.gov",
  "data.gov",
  "canada.ca",
  "gov.uk",
  "europa.eu",
  "un.org",
  // Education & research
  "mit.edu",
  "stanford.edu",
  "harvard.edu",
  "berkeley.edu",
  "caltech.edu",
  "yale.edu",
  "princeton.edu",
  "columbia.edu",
  "cam.ac.uk",
  "ox.ac.uk",
  "arxiv.org",
  "scholar.google.com",
  "wikipedia.org",
  "khanacademy.org",
  "coursera.org",
  "edx.org",
  "udemy.com",
  "duolingo.com",
  "brilliant.org",
  "codecademy.com",
  // Gaming & entertainment
  "steampowered.com",
  "epicgames.com",
  "playstation.com",
  "xbox.com",
  "nintendo.com",
  "roblox.com",
  "ea.com",
  "ubisoft.com",
  "hulu.com",
  "disneyplus.com",
  "hbomax.com",
  "crunchyroll.com",
  "imdb.com",
  "rottentomatoes.com",
  "letterboxd.com",
  // Health & science
  "nih.gov",
  "who.int",
  "mayoclinic.org",
  "webmd.com",
  "healthline.com",
  "23andme.com",
  "fitbit.com",
  "peloton.com",
  "headspace.com",
  "calm.com",
  // Infrastructure & dev tools
  "letsencrypt.org",
  "mozilla.org",
  "apache.org",
  "kernel.org",
  "debian.org",
  "ubuntu.com",
  "redhat.com",
  "docker.com",
  "kubernetes.io",
  "terraform.io",
  "npmjs.com",
  "pypi.org",
  "crates.io",
  "rubygems.org",
  "packagist.org",
  // Security
  "haveibeenpwned.com",
  "virustotal.com",
  "shodan.io",
  "securityheaders.com",
  "ssllabs.com",
  "1password.com",
  "bitwarden.com",
  "lastpass.com",
  "proton.me",
  "mullvad.net",
  // Travel & transport
  "airbnb.com",
  "booking.com",
  "expedia.com",
  "tripadvisor.com",
  "kayak.com",
  "united.com",
  "delta.com",
  "southwest.com",
  "uber.com",
  "lyft.com",
  // Food & delivery
  "doordash.com",
  "grubhub.com",
  "instacart.com",
  "opentable.com",
  "yelp.com",
  // Telecom & ISPs
  "t-mobile.com",
  "verizon.com",
  "att.com",
  "comcast.com",
  "spectrum.com",
  // Misc notable
  "archive.org",
  "craigslist.org",
  "duckduckgo.com",
  "brave.com",
  "vivaldi.com",
  "akamai.com",
  "fastly.com",
  "imperva.com",
  "okta.com",
  "auth0.com",
  "elastic.co",
  "splunk.com",
  "snowflake.com",
  "databricks.com",
  "palantir.com",
  "canva.com",
  "adobe.com",
  "autodesk.com",
  "unity.com",
  "unrealengine.com",
  "spacex.com",
  "tesla.com",
  "rivian.com",
  "waymo.com",
  "cruise.com",
] as const;

// ─── Fisher-Yates shuffle for unbiased random selection ─────────────

function pickRandom<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const len = copy.length;
  const count = Math.min(n, len);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (len - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// ─── Component ───────────────────────────────────────────────────────

/** @deprecated Use DomainSuggestions directly. This alias preserves backward compatibility. */
export const RecentLookups = DomainSuggestions;

export function DomainSuggestions({ onSelect }: { onSelect: (domain: string) => void }) {
  const picks = useMemo(() => pickRandom(SEED_DOMAINS, 10), []);

  return (
    <div style={{ width: "100%", maxWidth: "700px", marginTop: "1.5rem" }}>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--dim)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "0.5rem",
          textAlign: "center",
        }}
      >
        Try a domain
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.375rem",
        }}
      >
        {picks.map((domain) => (
          <button
            key={domain}
            type="button"
            onClick={() => onSelect(domain)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.25rem 0.625rem",
              borderRadius: "999px",
              border: "1px solid var(--border-muted)",
              background: "var(--surface)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              color: "var(--text)",
              transition: "all 0.15s",
              lineHeight: "20px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.background = "var(--bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-muted)";
              e.currentTarget.style.background = "var(--surface)";
            }}
          >
            {domain}
          </button>
        ))}
      </div>
    </div>
  );
}
