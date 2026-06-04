/** Deep WordPress fingerprinting — theme, plugins, version, hosting, page builder, etc. */

export interface WordPressDetails {
  detected: true;
  version: string | null;
  theme: { name: string; slug: string } | null;
  parent_theme: { name: string; slug: string } | null;
  plugins: Array<{ slug: string; name: string; category: string | null }>;
  page_builder: string | null;
  caching_plugin: string | null;
  seo_plugin: string | null;
  security_plugin: string | null;
  ecommerce: string | null;
  managed_hosting: string | null;
  api_exposed: boolean;
  block_editor: boolean;
  multisite: boolean;
  // Security probes (populated by probeWordPressSecurity)
  xmlrpc_accessible?: boolean;
  login_accessible?: boolean;
  user_enumeration?: boolean;
  directory_listing?: boolean;
}

// ─── Known plugin database (slug → display name + category) ─────────
const KNOWN_PLUGINS: Record<string, { name: string; category: string }> = {
  // SEO
  "wordpress-seo": { name: "Yoast SEO", category: "SEO" },
  "yoast-seo-premium": { name: "Yoast SEO Premium", category: "SEO" },
  "wp-seo": { name: "Yoast SEO", category: "SEO" },
  "seo-by-rank-math": { name: "Rank Math SEO", category: "SEO" },
  "rank-math-seo": { name: "Rank Math SEO", category: "SEO" },
  "all-in-one-seo-pack": { name: "All in One SEO", category: "SEO" },
  aioseo: { name: "All in One SEO", category: "SEO" },
  "the-seo-framework": { name: "The SEO Framework", category: "SEO" },
  "slim-seo": { name: "Slim SEO", category: "SEO" },
  "squirrly-seo": { name: "Squirrly SEO", category: "SEO" },

  // Page builders
  elementor: { name: "Elementor", category: "Page Builder" },
  "elementor-pro": { name: "Elementor Pro", category: "Page Builder" },
  "beaver-builder-lite-version": { name: "Beaver Builder", category: "Page Builder" },
  "bb-plugin": { name: "Beaver Builder", category: "Page Builder" },
  js_composer: { name: "WPBakery Page Builder", category: "Page Builder" },
  "divi-builder": { name: "Divi Builder", category: "Page Builder" },
  oxygen: { name: "Oxygen Builder", category: "Page Builder" },
  bricks: { name: "Bricks Builder", category: "Page Builder" },
  brizy: { name: "Brizy", category: "Page Builder" },
  generateblocks: { name: "GenerateBlocks", category: "Page Builder" },
  spectra: { name: "Spectra (Ultimate Addons)", category: "Page Builder" },
  "stackable-ultimate-gutenberg-blocks": { name: "Stackable", category: "Page Builder" },
  "kadence-blocks": { name: "Kadence Blocks", category: "Page Builder" },

  // E-commerce
  woocommerce: { name: "WooCommerce", category: "E-commerce" },
  "easy-digital-downloads": { name: "Easy Digital Downloads", category: "E-commerce" },
  surecart: { name: "SureCart", category: "E-commerce" },
  wpsc: { name: "WP eCommerce", category: "E-commerce" },
  "wc-product-table-lite": { name: "WC Product Table", category: "E-commerce" },
  "woo-gutenberg-products-block": { name: "WooCommerce Blocks", category: "E-commerce" },

  // Caching
  "wp-rocket": { name: "WP Rocket", category: "Caching" },
  "w3-total-cache": { name: "W3 Total Cache", category: "Caching" },
  "wp-super-cache": { name: "WP Super Cache", category: "Caching" },
  "litespeed-cache": { name: "LiteSpeed Cache", category: "Caching" },
  "wp-fastest-cache": { name: "WP Fastest Cache", category: "Caching" },
  autoptimize: { name: "Autoptimize", category: "Performance" },
  breeze: { name: "Breeze (Cloudways)", category: "Caching" },
  "sg-cachepress": { name: "SiteGround Optimizer", category: "Caching" },
  "cache-enabler": { name: "Cache Enabler", category: "Caching" },
  "comet-cache": { name: "Comet Cache", category: "Caching" },
  "hummingbird-performance": { name: "Hummingbird", category: "Performance" },
  "flying-press": { name: "FlyingPress", category: "Performance" },
  perfmatters: { name: "Perfmatters", category: "Performance" },
  nitropack: { name: "NitroPack", category: "Performance" },
  "swift-performance-lite": { name: "Swift Performance", category: "Caching" },

  // Security
  wordfence: { name: "Wordfence", category: "Security" },
  "sucuri-scanner": { name: "Sucuri Security", category: "Security" },
  "better-wp-security": { name: "Solid Security (iThemes)", category: "Security" },
  "ithemes-security-pro": { name: "Solid Security Pro", category: "Security" },
  "all-in-one-wp-security-and-firewall": { name: "All In One WP Security", category: "Security" },
  "defender-security": { name: "Defender Security", category: "Security" },
  "wp-cerber": { name: "WP Cerber Security", category: "Security" },
  jetpack: { name: "Jetpack", category: "Security / Performance" },
  "jetpack-boost": { name: "Jetpack Boost", category: "Performance" },
  "limit-login-attempts-reloaded": { name: "Limit Login Attempts", category: "Security" },
  "really-simple-ssl": { name: "Really Simple SSL", category: "Security" },
  "wp-2fa": { name: "WP 2FA", category: "Security" },
  "shield-security-for-wordpress": { name: "Shield Security", category: "Security" },

  // Forms
  "contact-form-7": { name: "Contact Form 7", category: "Forms" },
  "wpforms-lite": { name: "WPForms", category: "Forms" },
  forminator: { name: "Forminator", category: "Forms" },
  gravityforms: { name: "Gravity Forms", category: "Forms" },
  "ninja-forms": { name: "Ninja Forms", category: "Forms" },
  fluentform: { name: "Fluent Forms", category: "Forms" },
  formidable: { name: "Formidable Forms", category: "Forms" },
  "everest-forms": { name: "Everest Forms", category: "Forms" },

  // Content / Media
  "advanced-custom-fields": { name: "Advanced Custom Fields", category: "Content" },
  "advanced-custom-fields-pro": { name: "ACF Pro", category: "Content" },
  "classic-editor": { name: "Classic Editor", category: "Editor" },
  gutenberg: { name: "Gutenberg (Beta)", category: "Editor" },
  tablepress: { name: "TablePress", category: "Content" },
  "wp-smushit": { name: "Smush (Image Optimization)", category: "Media" },
  "ewww-image-optimizer": { name: "EWWW Image Optimizer", category: "Media" },
  "shortpixel-image-optimiser": { name: "ShortPixel", category: "Media" },
  imagify: { name: "Imagify", category: "Media" },
  "regenerate-thumbnails": { name: "Regenerate Thumbnails", category: "Media" },
  "enable-media-replace": { name: "Enable Media Replace", category: "Media" },
  "wp-video-lightbox": { name: "WP Video Lightbox", category: "Media" },
  "jw-player-7-for-wp-premium": { name: "JW Player", category: "Media" },
  revslider: { name: "Slider Revolution", category: "Media" },
  "smart-slider-3": { name: "Smart Slider 3", category: "Media" },

  // Social / Analytics
  "google-site-kit": { name: "Google Site Kit", category: "Analytics" },
  "google-analytics-for-wordpress": { name: "MonsterInsights", category: "Analytics" },
  "google-analytics-dashboard-for-wp": { name: "ExactMetrics", category: "Analytics" },
  "wp-statistics": { name: "WP Statistics", category: "Analytics" },
  "sailthru-widget": { name: "Sailthru", category: "Email / Engagement" },
  "mailchimp-for-wp": { name: "Mailchimp for WP", category: "Email" },
  "mailchimp-for-woocommerce": { name: "Mailchimp for WooCommerce", category: "Email" },

  // Backup / Migration
  updraftplus: { name: "UpdraftPlus", category: "Backup" },
  duplicator: { name: "Duplicator", category: "Backup / Migration" },
  "all-in-one-wp-migration": { name: "All-in-One WP Migration", category: "Migration" },
  backwpup: { name: "BackWPup", category: "Backup" },

  // Multilingual
  "sitepress-multilingual-cms": { name: "WPML", category: "Multilingual" },
  polylang: { name: "Polylang", category: "Multilingual" },
  "translatepress-multilingual": { name: "TranslatePress", category: "Multilingual" },
  weglot: { name: "Weglot", category: "Multilingual" },

  // Utility
  redirection: { name: "Redirection", category: "Utility" },
  "wordpress-importer": { name: "WordPress Importer", category: "Utility" },
  "wp-crontrol": { name: "WP Crontrol", category: "Utility" },
  "query-monitor": { name: "Query Monitor", category: "Dev Tools" },
  "code-syntax-block": { name: "Code Syntax Block", category: "Editor" },
  handbook: { name: "Handbook", category: "Content" },
  "custom-post-type-ui": { name: "Custom Post Type UI", category: "Content" },
  members: { name: "Members", category: "Users" },
  "user-role-editor": { name: "User Role Editor", category: "Users" },

  // GTM / Analytics wrappers
  "wdgdc-gtm-analytics": { name: "GTM Analytics", category: "Analytics" },
  "duracelltomi-google-tag-manager": { name: "GTM for WordPress", category: "Analytics" },
  "google-tag-manager": { name: "Google Tag Manager", category: "Analytics" },
  "header-footer-code-manager": { name: "Header Footer Code Manager", category: "Utility" },
  "insert-headers-and-footers": { name: "WPCode", category: "Utility" },
  "cookieyes-plugin": { name: "CookieYes GDPR Consent", category: "Privacy" },
  "cookie-law-info": { name: "CookieYes (Cookie Law Info)", category: "Privacy" },
  "complianz-gdpr": { name: "Complianz GDPR/CCPA", category: "Privacy" },
  cookiebot: { name: "Cookiebot CMP", category: "Privacy" },
  "starter-templates": { name: "Starter Templates (Astra)", category: "Page Builder" },
  "astra-sites": { name: "Starter Templates (Astra)", category: "Page Builder" },
  "fluent-smtp": { name: "FluentSMTP", category: "Email" },
  "wp-mail-smtp": { name: "WP Mail SMTP", category: "Email" },
  "seo-simple-pack": { name: "SEO Simple Pack", category: "SEO" },
  suretriggers: { name: "SureTriggers", category: "Automation" },
  "wp-recipe-maker": { name: "WP Recipe Maker", category: "Content" },
  "wps-hide-login": { name: "WPS Hide Login", category: "Security" },
  "safe-svg": { name: "Safe SVG", category: "Media" },
  "converter-for-media": { name: "Converter for Media (WebP)", category: "Media" },
};

// ─── Known theme database ───────────────────────────────────────────
// prettifySlug handles most themes ("theme-name" → "Theme Name").
// This map overrides only where the display name differs significantly.
const KNOWN_THEMES: Record<string, string> = {
  flavor: "flavor",
  "flavor-developer-2023": "flavor.org Developer 2023",
  "flavor-parent-2021": "flavor.org Parent 2021",
};

// ─── Managed hosting detection via headers + CNAME ──────────────────
function detectManagedHosting(
  headers: Record<string, string>,
  html: string,
  dnsRecords?: Array<{ type: string; data: string }>,
): string | null {
  const h = (k: string) => headers[k.toLowerCase()] ?? "";

  // WP Engine
  if (h("x-powered-by").includes("WP Engine") || h("wpe-backend") || h("x-wpe-loopback-upstream-addr"))
    return "WP Engine";
  for (const c of (headers["set-cookie"] ?? "").split(",")) {
    if (/wpe-auth/i.test(c)) return "WP Engine";
  }

  // Kinsta
  if (h("x-kinsta-cache") || h("x-edge-location")) return "Kinsta";

  // Pantheon
  if (h("x-pantheon-styx-hostname") || h("x-styx-req-id")) return "Pantheon";

  // Flywheel
  if (h("x-fw-hash") || h("x-fw-serve") || h("x-fw-type")) return "Flywheel";

  // WordPress VIP
  if (
    /wordpress vip/i.test(h("x-powered-by")) ||
    h("x-vip-go") ||
    /client-mu-plugins/i.test(html) ||
    /wpvip\.com/i.test(html)
  )
    return "WordPress VIP";

  // WordPress.com / Automattic
  if (
    h("x-powered-by").includes("WordPress.com") ||
    /\.wordpress\.com/i.test(h("host")) ||
    /atomiccdn|wpcomstaging\.com|wp\.com\/wp-content/i.test(html)
  )
    return "WordPress.com (Automattic)";

  // Pressable
  if (h("x-pressable-cache") || /pressablecdn\.com/i.test(html)) return "Pressable";

  // Cloudways
  if (h("x-cw-cache") || h("x-turbo-charged-by")) return "Cloudways";

  // SiteGround
  if (h("x-sg-optimizer") || /SiteGround/i.test(h("server"))) return "SiteGround";

  // Pagely
  if (h("x-pagely-cache") || h("x-pagely-lb")) return "Pagely";

  // Bluehost / Newfold
  if (/bluehost|newfold/i.test(h("server")) || h("x-bh-cdn")) return "Bluehost";

  // GoDaddy Managed WP
  if (h("x-mwp-site-id") || /secureservercdn/i.test(html)) return "GoDaddy Managed WordPress";

  // Nexcess / Liquid Web
  if (h("x-nexcess-cache") || h("x-lw-cache")) return "Nexcess / Liquid Web";

  // Platform.sh
  if (h("x-platform-server") || h("x-platform-cluster")) return "Platform.sh";

  // Check CNAME records
  if (dnsRecords) {
    for (const r of dnsRecords) {
      if (r.type !== "CNAME") continue;
      const d = r.data.toLowerCase();
      if (d.includes("wpengine.com")) return "WP Engine";
      if (d.includes("kinsta.cloud") || d.includes("kinsta.com")) return "Kinsta";
      if (d.includes("flywheelsites.com") || d.includes("getflywheel.com")) return "Flywheel";
      if (d.includes("pantheonsite.io") || d.includes("pantheon.io")) return "Pantheon";
      if (d.includes("wordpress.com") || d.includes("wpcomstaging.com")) return "WordPress.com (Automattic)";
      if (d.includes("pressable.com")) return "Pressable";
      if (d.includes("cloudways.com")) return "Cloudways";
      if (d.includes("secureserver.net") || d.includes("godaddysites.com")) return "GoDaddy";
    }
  }

  return null;
}

// ─── Main WordPress analysis ────────────────────────────────────────
export function analyzeWordPress(
  html: string,
  headers: Record<string, string>,
  dnsRecords?: Array<{ type: string; data: string }>,
): WordPressDetails | null {
  // Quick check: is this WordPress at all?
  const isWP =
    /wp-content\//i.test(html) ||
    /wp-includes\//i.test(html) ||
    /<meta[^>]+generator[^>]+WordPress/i.test(html) ||
    /\/wp-json\//i.test(html) ||
    /wp-emoji/i.test(html) ||
    /api\.w\.org/i.test(html);

  if (!isWP) return null;

  // ── Version ──
  let version: string | null = null;
  const genMatch = html.match(/<meta[^>]+content=["']WordPress\s+([\d.]+(?:-[a-zA-Z0-9-]+)?)/i);
  if (genMatch) version = genMatch[1];
  if (!version) {
    const verMatch = html.match(/wp-(?:includes|content)\/[^"'?]+\?ver=(\d+\.\d[\d.]*)/i);
    if (verMatch) version = verMatch[1];
  }

  // ── Theme ──
  let theme: { name: string; slug: string } | null = null;
  let parentTheme: { name: string; slug: string } | null = null;
  const themeMatches = html.match(/wp-content\/themes\/([a-zA-Z0-9_-]+)/gi);
  if (themeMatches) {
    const themeSlugs = new Set<string>();
    for (const m of themeMatches) {
      const slug = m.replace(/.*wp-content\/themes\//i, "").toLowerCase();
      if (slug && slug.length > 1) themeSlugs.add(slug);
    }
    const slugs = [...themeSlugs];
    if (slugs.length > 0) {
      // First theme found is typically the active one
      const mainSlug = slugs[0];
      theme = { name: KNOWN_THEMES[mainSlug] ?? prettifySlug(mainSlug), slug: mainSlug };
      // If there's a second theme, it's likely a parent/child relationship
      if (slugs.length > 1) {
        const parentSlug = slugs[1];
        parentTheme = { name: KNOWN_THEMES[parentSlug] ?? prettifySlug(parentSlug), slug: parentSlug };
      }
    }
  }

  // ── Plugins ──
  const pluginSlugs = new Set<string>();
  const pluginMatches = html.match(/wp-content\/plugins\/([a-zA-Z0-9_-]+)/gi);
  if (pluginMatches) {
    for (const m of pluginMatches) {
      const slug = m.replace(/.*wp-content\/plugins\//i, "").toLowerCase();
      if (slug && slug !== "*") pluginSlugs.add(slug);
    }
  }
  // Also check for inline plugin signatures
  if (/wpcf7/i.test(html)) pluginSlugs.add("contact-form-7");
  if (/yoast/i.test(html) && /schema/i.test(html)) pluginSlugs.add("wordpress-seo");
  if (/rank-math/i.test(html) || /rankMath/i.test(html)) pluginSlugs.add("seo-by-rank-math");
  if (/class=["'][^"']*elementor/i.test(html) || /elementor-frontend/i.test(html)) pluginSlugs.add("elementor");
  if (/class=["'][^"']*et_pb_/i.test(html) || /et-boc/i.test(html)) pluginSlugs.add("divi-builder");
  if (/class=["'][^"']*fl-builder/i.test(html)) pluginSlugs.add("beaver-builder-lite-version");
  if (/wpbakery\b|js_composer/i.test(html) || /vc_row|vc_column/i.test(html)) pluginSlugs.add("js_composer");
  if (/class=["'][^"']*oxygen-/i.test(html) || /ct-section/i.test(html)) pluginSlugs.add("oxygen");
  if (/class=["'][^"']*brxe-/i.test(html)) pluginSlugs.add("bricks");
  if (/class=["'][^"']*brizy-/i.test(html)) pluginSlugs.add("brizy");
  if (/woocommerce/i.test(html) || /wc-block/i.test(html)) pluginSlugs.add("woocommerce");
  if (/wordfence/i.test(html)) pluginSlugs.add("wordfence");
  if (/sucuri/i.test(html) && /cloudproxy/i.test(html)) pluginSlugs.add("sucuri-scanner");
  if (/jetpack/i.test(html) && /wp-content/i.test(html)) pluginSlugs.add("jetpack");
  if (/wpml-config/i.test(html) || /icl_/i.test(html)) pluginSlugs.add("sitepress-multilingual-cms");
  if (/polylang/i.test(html)) pluginSlugs.add("polylang");
  if (/gform_wrapper/i.test(html) || /gravityforms/i.test(html)) pluginSlugs.add("gravityforms");
  if (/wpforms/i.test(html)) pluginSlugs.add("wpforms-lite");
  if (/fluentform/i.test(html)) pluginSlugs.add("fluentform");

  // Header-based detection
  const xPoweredBy = (headers["x-powered-by"] ?? "").toLowerCase();
  if (/wp\s*rocket/i.test(xPoweredBy) || headers["x-rocket-nginx-bypass"]) pluginSlugs.add("wp-rocket");
  if (/w3 total cache/i.test(xPoweredBy)) pluginSlugs.add("w3-total-cache");
  if (headers["x-litespeed-cache"] || headers["x-lsadc-cache"]) pluginSlugs.add("litespeed-cache");

  const plugins = [...pluginSlugs].map((slug) => {
    const known = KNOWN_PLUGINS[slug];
    return {
      slug,
      name: known?.name ?? prettifySlug(slug),
      category: known?.category ?? null,
    };
  });

  // Sort: known plugins first, then alphabetical
  plugins.sort((a, b) => {
    const aKnown = KNOWN_PLUGINS[a.slug] ? 0 : 1;
    const bKnown = KNOWN_PLUGINS[b.slug] ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.name.localeCompare(b.name);
  });

  // ── Categorize key plugins ──
  const pageBuilder = findFirstByCategory(plugins, "Page Builder");
  const cachingPlugin = findFirstByCategory(plugins, "Caching") ?? findFirstByCategory(plugins, "Performance");
  const seoPlugin = findFirstByCategory(plugins, "SEO");
  const securityPlugin = findFirstByCategory(plugins, "Security");
  const ecommerce = findFirstByCategory(plugins, "E-commerce");

  // ── Managed hosting ──
  const managedHosting = detectManagedHosting(headers, html, dnsRecords);

  // ── API exposed ──
  const apiExposed = /api\.w\.org/i.test(html) || /\/wp-json\//i.test(html);

  // ── Block editor (Gutenberg) ──
  const blockEditor = /wp-block-/i.test(html) || /block-library/i.test(html) || /has-blocks/i.test(html);

  // ── Multisite ──
  const multisite = /wp-signup\.php/i.test(html) || /network-admin/i.test(html);

  return {
    detected: true,
    version,
    theme,
    parent_theme: parentTheme,
    plugins,
    page_builder: pageBuilder,
    caching_plugin: cachingPlugin,
    seo_plugin: seoPlugin,
    security_plugin: securityPlugin,
    ecommerce,
    managed_hosting: managedHosting,
    api_exposed: apiExposed,
    block_editor: blockEditor,
    multisite,
  };
}

function findFirstByCategory(
  plugins: Array<{ slug: string; name: string; category: string | null }>,
  category: string,
): string | null {
  const match = plugins.find((p) => p.category?.includes(category));
  return match?.name ?? null;
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bWp\b/g, "WP")
    .replace(/\bSeo\b/g, "SEO")
    .replace(/\bGtm\b/g, "GTM")
    .replace(/\bCss\b/g, "CSS")
    .replace(/\bJs\b/g, "JS")
    .replace(/\bAcf\b/g, "ACF")
    .replace(/\bApi\b/g, "API")
    .replace(/\bSsl\b/g, "SSL")
    .replace(/\bCdn\b/g, "CDN")
    .replace(/\bUi\b/g, "UI");
}

// ─── WordPress Security Probes ──────────────────────────────────────
// Quick HEAD/GET checks for common WP security issues.
// Called separately from analyzeWordPress since it needs async fetch.

export async function probeWordPressSecurity(
  domain: string,
  fetchFn: (url: string, opts?: RequestInit & { timeout?: number }) => Promise<Response>,
): Promise<{
  xmlrpc_accessible: boolean;
  login_accessible: boolean;
  user_enumeration: boolean;
  directory_listing: boolean;
}> {
  const results = {
    xmlrpc_accessible: false,
    login_accessible: false,
    user_enumeration: false,
    directory_listing: false,
  };

  const checks = await Promise.allSettled([
    // xmlrpc.php — common brute-force and DDoS amplification vector
    fetchFn(`https://${domain}/xmlrpc.php`, { method: "HEAD", timeout: 5000 }).then((r) => {
      results.xmlrpc_accessible = r.status === 200 || r.status === 405;
    }),

    // wp-login.php — exposed login page
    fetchFn(`https://${domain}/wp-login.php`, { method: "HEAD", timeout: 5000 }).then((r) => {
      results.login_accessible = r.status === 200;
    }),

    // REST API user enumeration — /wp-json/wp/v2/users
    fetchFn(`https://${domain}/wp-json/wp/v2/users`, { timeout: 5000 }).then(async (r) => {
      if (r.status === 200) {
        try {
          const body = await r.text();
          // Check if it actually returns user data (array of user objects)
          results.user_enumeration = body.startsWith("[") && body.includes('"slug"');
        } catch {
          // ignore
        }
      }
    }),

    // Directory listing — /wp-content/uploads/
    fetchFn(`https://${domain}/wp-content/uploads/`, { method: "GET", timeout: 5000 }).then(async (r) => {
      if (r.status === 200) {
        try {
          const body = await r.text();
          results.directory_listing = /Index of|<title>.*listing/i.test(body);
        } catch {
          // ignore
        }
      }
    }),
  ]);

  // Silently ignore any failures — these are best-effort probes
  void checks;

  return results;
}
