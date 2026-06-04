/** Tech stack fingerprint database for detecting CMS, frameworks, servers, etc. */

export interface Fingerprint {
  name: string;
  category: string;
  patterns: {
    headers?: Record<string, RegExp>;
    meta?: Record<string, RegExp>;
    scriptUrls?: RegExp[];
    cssUrls?: RegExp[];
    htmlPatterns?: RegExp[];
    cookies?: string[];
  };
  versionExtract?: {
    source: "meta" | "header" | "html" | "script";
    pattern: RegExp;
  };
}

export const fingerprints: Fingerprint[] = [
  // CMS
  {
    name: "WordPress",
    category: "CMS",
    patterns: {
      meta: { generator: /wordpress/i },
      htmlPatterns: [/wp-content\//i, /wp-includes\//i],
      scriptUrls: [/wp-content\/.*\.js/i, /wp-includes\/.*\.js/i],
      cssUrls: [/wp-content\/.*\.css/i],
    },
    versionExtract: { source: "meta", pattern: /WordPress\s+([\d.]+)/i },
  },
  {
    name: "Drupal",
    category: "CMS",
    patterns: {
      meta: { generator: /drupal/i },
      headers: { "x-generator": /drupal/i, "x-drupal-cache": /./ },
      htmlPatterns: [/sites\/default\/files/i, /\/core\/misc\/drupal\.js/i],
    },
    versionExtract: { source: "meta", pattern: /Drupal\s+([\d.]+)/i },
  },
  {
    name: "Joomla",
    category: "CMS",
    patterns: {
      meta: { generator: /joomla/i },
      htmlPatterns: [/\/media\/jui\/js\//i, /\/components\/com_/i],
    },
    versionExtract: { source: "meta", pattern: /Joomla!\s+([\d.]+)/i },
  },
  {
    name: "Shopify",
    category: "E-commerce",
    patterns: {
      headers: { "x-shopid": /./, "x-shopify-stage": /./ },
      htmlPatterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i],
      scriptUrls: [/cdn\.shopify\.com/i],
    },
  },
  {
    name: "Squarespace",
    category: "CMS",
    patterns: {
      htmlPatterns: [/squarespace\.com/i, /static\.squarespace\.com/i],
      scriptUrls: [/static\.squarespace\.com/i],
    },
  },
  {
    name: "Wix",
    category: "CMS",
    patterns: {
      headers: { "x-wix-request-id": /./ },
      htmlPatterns: [/wix\.com/i, /static\.wixstatic\.com/i, /wixsite\.com/i],
      scriptUrls: [/static\.parastorage\.com/i],
    },
  },
  {
    name: "Ghost",
    category: "CMS",
    patterns: {
      meta: { generator: /ghost/i },
      headers: { "x-ghost-cache-status": /./ },
      htmlPatterns: [/ghost\.org/i],
    },
    versionExtract: { source: "meta", pattern: /Ghost\s+([\d.]+)/i },
  },
  {
    name: "Webflow",
    category: "CMS",
    patterns: {
      meta: { generator: /webflow/i },
      htmlPatterns: [/webflow\.com/i, /assets\.website-files\.com/i],
    },
  },
  // Web servers
  {
    name: "Nginx",
    category: "Web Server",
    patterns: { headers: { server: /nginx/i } },
    versionExtract: { source: "header", pattern: /nginx\/([\d.]+)/i },
  },
  {
    name: "Apache",
    category: "Web Server",
    patterns: { headers: { server: /apache/i } },
    versionExtract: { source: "header", pattern: /Apache\/([\d.]+)/i },
  },
  {
    name: "LiteSpeed",
    category: "Web Server",
    patterns: { headers: { server: /litespeed/i } },
    versionExtract: { source: "header", pattern: /LiteSpeed\/([\d.]+)/i },
  },
  {
    name: "IIS",
    category: "Web Server",
    patterns: { headers: { server: /microsoft-iis/i } },
    versionExtract: { source: "header", pattern: /Microsoft-IIS\/([\d.]+)/i },
  },
  {
    name: "Cloudflare",
    category: "CDN",
    patterns: { headers: { server: /cloudflare/i } },
  },
  // JavaScript frameworks
  {
    name: "React",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/data-reactroot/i, /__NEXT_DATA__/i, /react\.production\.min\.js/i],
      scriptUrls: [/react(?:\.production)?\.min\.js/i, /react-dom/i],
    },
  },
  {
    name: "Next.js",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/__NEXT_DATA__/i, /_next\/static/i],
      scriptUrls: [/_next\/static/i],
      headers: { "x-nextjs-cache": /./, "x-powered-by": /next\.js/i },
    },
  },
  {
    name: "Vue.js",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/data-v-[a-f0-9]+/i, /vue\.runtime/i],
      scriptUrls: [/vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js/i],
    },
  },
  {
    name: "Nuxt",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/__NUXT__/i, /_nuxt\//i],
      scriptUrls: [/_nuxt\//i],
    },
  },
  {
    name: "Angular",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/ng-version/i, /ng-app/i, /\[\(ngModel\)\]/i],
      scriptUrls: [/angular(?:\.min)?\.js/i, /zone\.js/i],
    },
  },
  {
    name: "jQuery",
    category: "JS Library",
    patterns: {
      scriptUrls: [/jquery(?:\.min)?\.js/i, /jquery-[\d.]+(?:\.min)?\.js/i],
    },
    versionExtract: { source: "script", pattern: /jquery[.-]([\d.]+)/i },
  },
  // Programming languages
  {
    name: "PHP",
    category: "Language",
    patterns: {
      headers: { "x-powered-by": /php/i },
      htmlPatterns: [/\.php(?:\?|")/i],
    },
    versionExtract: { source: "header", pattern: /PHP\/([\d.]+)/i },
  },
  {
    name: "ASP.NET",
    category: "Language",
    patterns: {
      headers: { "x-powered-by": /asp\.net/i, "x-aspnet-version": /./ },
    },
    versionExtract: { source: "header", pattern: /X-AspNet-Version:\s*([\d.]+)/i },
  },
  // Analytics
  {
    name: "Google Analytics",
    category: "Analytics",
    patterns: {
      scriptUrls: [/google-analytics\.com\/analytics\.js/i, /googletagmanager\.com\/gtag/i, /ga\.js/i],
      htmlPatterns: [/gtag\(/i, /UA-\d+-\d/i, /G-[A-Z0-9]+/i],
    },
  },
  {
    name: "Google Tag Manager",
    category: "Analytics",
    patterns: {
      scriptUrls: [/googletagmanager\.com\/gtm\.js/i],
      htmlPatterns: [/GTM-[A-Z0-9]+/i],
    },
  },
  {
    name: "Facebook Pixel",
    category: "Analytics",
    patterns: {
      scriptUrls: [/connect\.facebook\.net\/.*\/fbevents\.js/i],
      htmlPatterns: [/fbq\(/i],
    },
  },
  // CDN / Hosting
  {
    name: "Fastly",
    category: "CDN",
    patterns: {
      headers: { via: /varnish/i, "x-served-by": /cache-/i, "x-fastly-request-id": /./ },
    },
  },
  {
    name: "Akamai",
    category: "CDN",
    patterns: {
      headers: { "x-akamai-transformed": /./, server: /akamaighost/i },
    },
  },
  {
    name: "Amazon CloudFront",
    category: "CDN",
    patterns: {
      headers: { via: /cloudfront/i, "x-amz-cf-id": /./, "x-amz-cf-pop": /./ },
    },
  },
  {
    name: "Vercel",
    category: "Hosting",
    patterns: {
      headers: { "x-vercel-id": /./, server: /vercel/i },
    },
  },
  {
    name: "Netlify",
    category: "Hosting",
    patterns: {
      headers: { server: /netlify/i, "x-nf-request-id": /./ },
    },
  },
  {
    name: "WordPress VIP",
    category: "Hosting",
    patterns: {
      headers: { "x-vip-go": /./, "x-powered-by": /wordpress vip/i },
      htmlPatterns: [/wp-content\/client-mu-plugins/, /wpvip\.com/],
    },
  },
  // E-commerce
  {
    name: "WooCommerce",
    category: "E-commerce",
    patterns: {
      headers: { "x-woo-version": /./ },
      htmlPatterns: [/wp-content\/plugins\/woocommerce\/assets/],
    },
  },
  {
    name: "Magento",
    category: "E-commerce",
    patterns: {
      headers: { "x-magento-vary": /./ },
    },
  },
  // Security
  {
    name: "reCAPTCHA",
    category: "Security",
    patterns: {
      scriptUrls: [/google\.com\/recaptcha/i],
      htmlPatterns: [/g-recaptcha/i],
    },
  },
  {
    name: "hCaptcha",
    category: "Security",
    patterns: {
      scriptUrls: [/hcaptcha\.com/i],
      htmlPatterns: [/h-captcha/i],
    },
  },
];
