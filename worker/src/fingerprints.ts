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
  // ─── CMS ──────────────────────────────────────────────────────────────
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
  {
    name: "Hugo",
    category: "CMS",
    patterns: {
      meta: { generator: /hugo/i },
    },
    versionExtract: { source: "meta", pattern: /Hugo\s+([\d.]+)/i },
  },
  {
    name: "Jekyll",
    category: "CMS",
    patterns: {
      meta: { generator: /jekyll/i },
    },
    versionExtract: { source: "meta", pattern: /Jekyll\s+v?([\d.]+)/i },
  },
  {
    name: "Gatsby",
    category: "CMS",
    patterns: {
      meta: { generator: /gatsby/i },
      htmlPatterns: [/gatsby-image/i, /gatsby-link/i],
      scriptUrls: [/gatsby-chunk-/i],
    },
    versionExtract: { source: "meta", pattern: /Gatsby\s+([\d.]+)/i },
  },
  {
    name: "HubSpot CMS",
    category: "CMS",
    patterns: {
      htmlPatterns: [/hs-scripts\.com/i, /hbspt\.cta/i, /hubspot\.com/i],
      scriptUrls: [/js\.hs-scripts\.com/i, /js\.hubspot\.com/i],
    },
  },
  {
    name: "Contentful",
    category: "CMS",
    patterns: {
      htmlPatterns: [/contentful\.com/i, /ctfassets\.net/i],
      scriptUrls: [/contentful/i],
    },
  },
  {
    name: "Craft CMS",
    category: "CMS",
    patterns: {
      headers: { "x-powered-by": /craft cms/i },
      meta: { generator: /craft cms/i },
    },
    versionExtract: { source: "meta", pattern: /Craft CMS\s+([\d.]+)/i },
  },
  {
    name: "TYPO3",
    category: "CMS",
    patterns: {
      meta: { generator: /typo3/i },
      headers: { "x-typo3-parsetime": /./ },
      htmlPatterns: [/typo3temp\//i, /typo3conf\//i],
    },
    versionExtract: { source: "meta", pattern: /TYPO3 CMS\s+([\d.]+)/i },
  },
  {
    name: "Cargo",
    category: "CMS",
    patterns: {
      meta: { generator: /cargo/i },
      htmlPatterns: [/cargo\.site/i, /cargocollective\.com/i],
    },
  },
  {
    name: "Blogger",
    category: "CMS",
    patterns: {
      meta: { generator: /blogger/i },
      htmlPatterns: [/blogger\.com/i, /blogspot\.com/i],
    },
  },
  {
    name: "Medium",
    category: "CMS",
    patterns: {
      htmlPatterns: [/medium\.com/i],
      scriptUrls: [/cdn-client\.medium\.com/i],
    },
  },

  // ─── E-commerce ────────────────────────────────────────────────────────
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
  {
    name: "BigCommerce",
    category: "E-commerce",
    patterns: {
      headers: { "x-bc-store-version": /./ },
      htmlPatterns: [/bigcommerce\.com/i, /cdn11\.bigcommerce\.com/i],
      scriptUrls: [/cdn11\.bigcommerce\.com/i],
    },
  },
  {
    name: "PrestaShop",
    category: "E-commerce",
    patterns: {
      meta: { generator: /prestashop/i },
      htmlPatterns: [/\/modules\/prestashop/i, /prestashop/i],
      cookies: ["PrestaShop"],
    },
    versionExtract: { source: "meta", pattern: /PrestaShop\s+([\d.]+)/i },
  },
  {
    name: "OpenCart",
    category: "E-commerce",
    patterns: {
      htmlPatterns: [/catalog\/view\/theme/i, /index\.php\?route=product/i],
    },
  },
  {
    name: "Salesforce Commerce Cloud",
    category: "E-commerce",
    patterns: {
      headers: { "x-dw-request-base-id": /./ },
      htmlPatterns: [/demandware\.static/i, /demandware\.edgekey/i],
    },
  },

  // ─── Web Servers ──────────────────────────────────────────────────────
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
    name: "Caddy",
    category: "Web Server",
    patterns: { headers: { server: /^caddy$/i } },
  },
  {
    name: "Openresty",
    category: "Web Server",
    patterns: { headers: { server: /openresty/i } },
    versionExtract: { source: "header", pattern: /openresty\/([\d.]+)/i },
  },
  {
    name: "Envoy",
    category: "Web Server",
    patterns: { headers: { server: /envoy/i, "x-envoy-upstream-service-time": /./ } },
  },
  {
    name: "Cowboy",
    category: "Web Server",
    patterns: { headers: { server: /^cowboy$/i } },
  },

  // ─── CDN / Infrastructure ─────────────────────────────────────────────
  {
    name: "Cloudflare",
    category: "CDN",
    patterns: { headers: { server: /cloudflare/i } },
  },
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
    name: "KeyCDN",
    category: "CDN",
    patterns: {
      headers: { server: /keycdn/i, "x-edge-location": /./ },
    },
  },
  {
    name: "StackPath",
    category: "CDN",
    patterns: {
      headers: { "x-hw": /./, server: /stackpath/i },
    },
  },
  {
    name: "Bunny CDN",
    category: "CDN",
    patterns: {
      headers: { server: /bunnycdn/i, "cdn-pullzone": /./ },
    },
  },
  {
    name: "Sucuri",
    category: "CDN",
    patterns: {
      headers: { server: /sucuri/i, "x-sucuri-id": /./ },
    },
  },
  {
    name: "Incapsula",
    category: "CDN",
    patterns: {
      headers: { "x-iinfo": /./, "x-cdn": /incapsula/i },
    },
  },

  // ─── Hosting / Platform ───────────────────────────────────────────────
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
    name: "GitHub Pages",
    category: "Hosting",
    patterns: {
      headers: { server: /github\.com/i, "x-github-request-id": /./ },
    },
  },
  {
    name: "Heroku",
    category: "Hosting",
    patterns: {
      headers: { via: /vegur/i },
    },
  },
  {
    name: "AWS",
    category: "Hosting",
    patterns: {
      headers: { server: /amazons3/i, "x-amz-request-id": /./ },
    },
  },
  {
    name: "Azure",
    category: "Hosting",
    patterns: {
      headers: { "x-azure-ref": /./, "x-ms-request-id": /./ },
    },
  },
  {
    name: "Google Cloud",
    category: "Hosting",
    patterns: {
      headers: { via: /google/i, "x-goog-generation": /./ },
    },
  },
  {
    name: "Render",
    category: "Hosting",
    patterns: {
      headers: { "x-render-origin-server": /./ },
    },
  },
  {
    name: "Fly.io",
    category: "Hosting",
    patterns: {
      headers: { "fly-request-id": /./, server: /fly\//i },
    },
  },
  {
    name: "Railway",
    category: "Hosting",
    patterns: {
      headers: { "x-railway-request-id": /./ },
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
  {
    name: "Pantheon",
    category: "Hosting",
    patterns: {
      headers: { "x-pantheon-styx-hostname": /./, "x-styx-req-id": /./ },
    },
  },
  {
    name: "WP Engine",
    category: "Hosting",
    patterns: {
      headers: { "x-powered-by": /wp engine/i, "wpe-backend": /./ },
    },
  },
  {
    name: "Kinsta",
    category: "Hosting",
    patterns: {
      headers: { "x-kinsta-cache": /./ },
    },
  },

  // ─── JavaScript Frameworks ────────────────────────────────────────────
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
    name: "Svelte",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/svelte-[a-z0-9]+/i, /class="svelte-/i],
    },
  },
  {
    name: "SvelteKit",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/__sveltekit\//i, /data-sveltekit/i],
      scriptUrls: [/__sveltekit\//i],
    },
  },
  {
    name: "Astro",
    category: "JS Framework",
    patterns: {
      meta: { generator: /astro/i },
      htmlPatterns: [/astro-island/i, /astro-slot/i],
    },
    versionExtract: { source: "meta", pattern: /Astro\s+v?([\d.]+)/i },
  },
  {
    name: "Remix",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/__remix/i, /data-remix/i],
      scriptUrls: [/remix-/i],
    },
  },
  {
    name: "Ember.js",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/ember-view/i, /data-ember-action/i, /id="ember\d+"/i],
      scriptUrls: [/ember(?:\.min)?\.js/i],
    },
  },
  {
    name: "Backbone.js",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/backbone(?:\.min)?\.js/i, /backbone-[.\d]+(?:\.min)?\.js/i],
    },
  },
  {
    name: "Alpine.js",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/x-data\s*=/i, /x-bind:/i, /x-on:/i],
      scriptUrls: [/alpinejs/i, /alpine(?:\.min)?\.js/i],
    },
  },
  {
    name: "htmx",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/hx-get\s*=/i, /hx-post\s*=/i, /hx-trigger\s*=/i],
      scriptUrls: [/htmx(?:\.min)?\.js/i],
    },
  },
  {
    name: "Stimulus",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/data-controller\s*=/i, /data-action\s*=/i],
      scriptUrls: [/stimulus(?:\.min)?\.js/i],
    },
  },
  {
    name: "Turbo",
    category: "JS Framework",
    patterns: {
      htmlPatterns: [/data-turbo-frame/i, /data-turbo/i],
      scriptUrls: [/turbo(?:\.es2017)?(?:\.min)?\.js/i],
    },
  },
  {
    name: "Preact",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/preact(?:\.min)?\.js/i, /preact\/compat/i],
    },
  },
  {
    name: "Solid.js",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/solid-js/i],
      htmlPatterns: [/data-hk=/i],
    },
  },
  {
    name: "Lit",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/lit-element/i, /lit-html/i, /@lit\//i],
    },
  },
  {
    name: "Eleventy",
    category: "JS Framework",
    patterns: {
      meta: { generator: /eleventy/i },
    },
    versionExtract: { source: "meta", pattern: /Eleventy\s+v?([\d.]+)/i },
  },

  // ─── JS Libraries ────────────────────────────────────────────────────
  {
    name: "jQuery",
    category: "JS Library",
    patterns: {
      scriptUrls: [/jquery(?:\.min)?\.js/i, /jquery-[\d.]+(?:\.min)?\.js/i],
    },
    versionExtract: { source: "script", pattern: /jquery[.-]([\d.]+)/i },
  },
  {
    name: "Bootstrap",
    category: "JS Library",
    patterns: {
      scriptUrls: [/bootstrap(?:\.bundle)?(?:\.min)?\.js/i],
      cssUrls: [/bootstrap(?:\.min)?\.css/i],
    },
    versionExtract: { source: "script", pattern: /bootstrap[.-]([\d.]+)/i },
  },
  {
    name: "Tailwind CSS",
    category: "JS Library",
    patterns: {
      cssUrls: [/tailwind(?:css)?(?:\.min)?\.css/i],
      htmlPatterns: [/<(?:link|script|style)[^>]*tailwindcss/i, /tailwind\.config/i],
    },
  },
  {
    name: "Lodash",
    category: "JS Library",
    patterns: {
      scriptUrls: [/lodash(?:\.min)?\.js/i, /lodash\.[a-z]+(?:\.min)?\.js/i],
    },
  },
  {
    name: "Moment.js",
    category: "JS Library",
    patterns: {
      scriptUrls: [/moment(?:\.min)?\.js/i, /moment-with-locales(?:\.min)?\.js/i],
    },
  },
  {
    name: "GSAP",
    category: "JS Library",
    patterns: {
      scriptUrls: [/gsap(?:\.min)?\.js/i, /greensock/i, /TweenMax/i],
    },
  },
  {
    name: "Three.js",
    category: "JS Library",
    patterns: {
      scriptUrls: [/three(?:\.min)?\.js/i, /three\.module\.js/i],
    },
  },
  {
    name: "D3.js",
    category: "JS Library",
    patterns: {
      scriptUrls: [/d3(?:\.min)?\.js/i, /d3\.v\d+(?:\.min)?\.js/i],
    },
  },
  {
    name: "Axios",
    category: "JS Library",
    patterns: {
      scriptUrls: [/axios(?:\.min)?\.js/i],
    },
  },
  {
    name: "Socket.io",
    category: "JS Library",
    patterns: {
      scriptUrls: [/socket\.io(?:\.min)?\.js/i],
    },
  },

  // ─── Programming Languages / Server Frameworks ────────────────────────
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
  {
    name: "Express",
    category: "Server",
    patterns: {
      headers: { "x-powered-by": /^express$/i },
    },
  },
  {
    name: "Ruby on Rails",
    category: "Server",
    patterns: {
      headers: { "x-powered-by": /phusion passenger/i, "x-runtime": /^[\d.]+$/ },
      htmlPatterns: [/csrf-token/i, /authenticity_token/i],
    },
  },
  {
    name: "Django",
    category: "Server",
    patterns: {
      htmlPatterns: [/csrfmiddlewaretoken/i, /django\.contrib/i, /django-formset/i, /__django_/i],
    },
  },
  {
    name: "Laravel",
    category: "Server",
    patterns: {
      cookies: ["laravel_session", "XSRF-TOKEN"],
      htmlPatterns: [/laravel/i],
    },
  },
  {
    name: "Flask",
    category: "Server",
    patterns: {
      headers: { server: /werkzeug/i },
    },
    versionExtract: { source: "header", pattern: /Werkzeug\/([\d.]+)/i },
  },
  {
    name: "Spring",
    category: "Server",
    patterns: {
      headers: { "x-application-context": /./ },
      cookies: ["JSESSIONID"],
    },
  },
  {
    name: "ColdFusion",
    category: "Server",
    patterns: {
      headers: { "x-powered-by": /coldfusion/i },
      cookies: ["CFID", "CFTOKEN"],
    },
  },
  {
    name: "Perl",
    category: "Language",
    patterns: {
      headers: { server: /mod_perl/i },
    },
    versionExtract: { source: "header", pattern: /mod_perl\/([\d.]+)/i },
  },

  // ─── Analytics ────────────────────────────────────────────────────────
  {
    name: "Google Analytics",
    category: "Analytics",
    patterns: {
      scriptUrls: [/google-analytics\.com\/analytics\.js/i, /googletagmanager\.com\/gtag/i, /ga\.js/i],
      htmlPatterns: [/gtag\(/i, /UA-\d+-\d/i, /['"]G-[A-Z0-9]{10,}['"]/],
    },
  },
  {
    name: "Google Tag Manager",
    category: "Tag Manager",
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
  {
    name: "Hotjar",
    category: "Analytics",
    patterns: {
      scriptUrls: [/static\.hotjar\.com/i],
      htmlPatterns: [/hotjar\.com/i, /hj\(/i, /_hjSettings/i],
    },
  },
  {
    name: "Mixpanel",
    category: "Analytics",
    patterns: {
      scriptUrls: [/cdn\.mxpnl\.com/i, /mixpanel/i],
      htmlPatterns: [/mixpanel\.init/i, /mixpanel\.track/i],
    },
  },
  {
    name: "Amplitude",
    category: "Analytics",
    patterns: {
      scriptUrls: [/cdn\.amplitude\.com/i, /amplitude/i],
      htmlPatterns: [/amplitude\.getInstance/i],
    },
  },
  {
    name: "Heap",
    category: "Analytics",
    patterns: {
      scriptUrls: [/cdn\.heapanalytics\.com/i, /heapanalytics/i],
      htmlPatterns: [/heap\.load/i],
    },
  },
  {
    name: "Segment",
    category: "Analytics",
    patterns: {
      scriptUrls: [/cdn\.segment\.com/i, /cdn\.segment\.io/i],
      htmlPatterns: [/analytics\.identify/i, /analytics\.track/i, /analytics\.page/i],
    },
  },
  {
    name: "Plausible",
    category: "Analytics",
    patterns: {
      scriptUrls: [/plausible\.io\/js\/script/i],
    },
  },
  {
    name: "Fathom",
    category: "Analytics",
    patterns: {
      scriptUrls: [/cdn\.usefathom\.com\/script\.js/i, /usefathom\.com/i],
    },
  },
  {
    name: "Matomo",
    category: "Analytics",
    patterns: {
      scriptUrls: [/matomo\.js/i, /piwik\.js/i],
      htmlPatterns: [/_paq\.push/i, /matomo/i],
    },
  },
  {
    name: "Clarity",
    category: "Analytics",
    patterns: {
      scriptUrls: [/clarity\.ms\/tag/i],
      htmlPatterns: [/clarity\(/i],
    },
  },
  {
    name: "PostHog",
    category: "Analytics",
    patterns: {
      scriptUrls: [/app\.posthog\.com/i, /us\.posthog\.com/i, /eu\.posthog\.com/i],
      htmlPatterns: [/posthog\.init/i],
    },
  },
  {
    name: "Snowplow",
    category: "Analytics",
    patterns: {
      scriptUrls: [/sp\.js/i, /snowplow/i],
      htmlPatterns: [/snowplow/i, /GlobalSnowplowNamespace/i],
    },
  },
  {
    name: "Chartbeat",
    category: "Analytics",
    patterns: {
      scriptUrls: [/static\.chartbeat\.com/i],
      htmlPatterns: [/chartbeat/i],
    },
  },
  {
    name: "Adobe Analytics",
    category: "Analytics",
    patterns: {
      scriptUrls: [/omtrdc\.net/i, /demdex\.net/i],
      htmlPatterns: [/s_code/i, /AppMeasurement/i, /omniture/i],
    },
  },
  {
    name: "LinkedIn Insight Tag",
    category: "Analytics",
    patterns: {
      scriptUrls: [/snap\.licdn\.com\/li\.lms-analytics/i],
    },
  },
  {
    name: "Pinterest Tag",
    category: "Analytics",
    patterns: {
      scriptUrls: [/s\.pinimg\.com\/ct\/core\.js/i],
      htmlPatterns: [/pintrk\(/i],
    },
  },
  {
    name: "TikTok Pixel",
    category: "Analytics",
    patterns: {
      scriptUrls: [/analytics\.tiktok\.com/i],
      htmlPatterns: [/ttq\.load/i],
    },
  },

  // ─── Tag Managers ─────────────────────────────────────────────────────
  {
    name: "Adobe Launch",
    category: "Tag Manager",
    patterns: {
      scriptUrls: [/assets\.adobedtm\.com/i, /launch-/i],
    },
  },
  {
    name: "Tealium",
    category: "Tag Manager",
    patterns: {
      scriptUrls: [/tags\.tiqcdn\.com/i, /tealium/i],
    },
  },

  // ─── A/B Testing ──────────────────────────────────────────────────────
  {
    name: "Optimizely",
    category: "A/B Testing",
    patterns: {
      scriptUrls: [/cdn\.optimizely\.com/i],
      htmlPatterns: [/optimizely/i],
    },
  },
  {
    name: "VWO",
    category: "A/B Testing",
    patterns: {
      scriptUrls: [/dev\.visualwebsiteoptimizer\.com/i],
      htmlPatterns: [/vwo_/i, /visualwebsiteoptimizer/i],
    },
  },
  {
    name: "LaunchDarkly",
    category: "A/B Testing",
    patterns: {
      scriptUrls: [/app\.launchdarkly\.com/i, /launchdarkly/i],
    },
  },
  {
    name: "AB Tasty",
    category: "A/B Testing",
    patterns: {
      scriptUrls: [/abtasty\.com/i],
    },
  },

  // ─── Marketing / Chat / Support ───────────────────────────────────────
  {
    name: "Intercom",
    category: "Marketing",
    patterns: {
      scriptUrls: [/widget\.intercom\.io/i],
      htmlPatterns: [/intercomSettings/i, /intercom-container/i],
    },
  },
  {
    name: "Drift",
    category: "Marketing",
    patterns: {
      scriptUrls: [/js\.driftt\.com/i],
      htmlPatterns: [/drift-frame/i],
    },
  },
  {
    name: "Zendesk",
    category: "Marketing",
    patterns: {
      scriptUrls: [/static\.zdassets\.com/i, /assets\.zendesk\.com/i],
      htmlPatterns: [/zESettings/i, /zendesk/i],
    },
  },
  {
    name: "Crisp",
    category: "Marketing",
    patterns: {
      scriptUrls: [/client\.crisp\.chat/i],
      htmlPatterns: [/crisp-client/i, /\$crisp/i],
    },
  },
  {
    name: "LiveChat",
    category: "Marketing",
    patterns: {
      scriptUrls: [/cdn\.livechatinc\.com/i],
      htmlPatterns: [/livechat/i, /__lc/i],
    },
  },
  {
    name: "Tawk.to",
    category: "Marketing",
    patterns: {
      scriptUrls: [/embed\.tawk\.to/i],
      htmlPatterns: [/tawk\.to/i, /Tawk_API/i],
    },
  },
  {
    name: "Freshdesk",
    category: "Marketing",
    patterns: {
      scriptUrls: [/widget\.freshworks\.com/i],
      htmlPatterns: [/FreshworksWidget/i],
    },
  },
  {
    name: "HubSpot",
    category: "Marketing",
    patterns: {
      scriptUrls: [/js\.hs-scripts\.com/i, /js\.hubspot\.com/i],
      htmlPatterns: [/hbspt\.forms/i, /hubspot/i],
    },
  },
  {
    name: "Mailchimp",
    category: "Marketing",
    patterns: {
      scriptUrls: [/chimpstatic\.com/i, /list-manage\.com/i],
      htmlPatterns: [/mc-embedded-subscribe/i, /mailchimp/i],
    },
  },
  {
    name: "Olark",
    category: "Marketing",
    patterns: {
      scriptUrls: [/static\.olark\.com/i],
      htmlPatterns: [/olark/i],
    },
  },

  // ─── Payment ──────────────────────────────────────────────────────────
  {
    name: "Stripe",
    category: "Payment",
    patterns: {
      scriptUrls: [/js\.stripe\.com/i],
      htmlPatterns: [/stripe-button/i, /StripeCheckout/i],
    },
  },
  {
    name: "PayPal",
    category: "Payment",
    patterns: {
      scriptUrls: [/paypalobjects\.com/i, /paypal\.com\/sdk/i],
      htmlPatterns: [/paypal-button/i],
    },
  },
  {
    name: "Square",
    category: "Payment",
    patterns: {
      scriptUrls: [/squareup\.com/i, /js\.squareup\.com/i, /js\.squareupsandbox\.com/i],
    },
  },
  {
    name: "Braintree",
    category: "Payment",
    patterns: {
      scriptUrls: [/braintreegateway\.com/i, /js\.braintreegateway\.com/i],
    },
  },
  {
    name: "Klarna",
    category: "Payment",
    patterns: {
      scriptUrls: [/js\.klarna\.com/i, /x\.klarnacdn\.net/i],
      htmlPatterns: [/klarna/i],
    },
  },
  {
    name: "Afterpay",
    category: "Payment",
    patterns: {
      scriptUrls: [/afterpay\.com/i, /portal\.afterpay\.com/i],
      htmlPatterns: [/afterpay/i],
    },
  },

  // ─── Auth / Identity ──────────────────────────────────────────────────
  {
    name: "Auth0",
    category: "Auth",
    patterns: {
      scriptUrls: [/cdn\.auth0\.com/i, /auth0-js/i, /auth0\.js/i],
    },
  },
  {
    name: "Okta",
    category: "Auth",
    patterns: {
      scriptUrls: [/okta\.com/i, /oktacdn\.com/i],
      htmlPatterns: [/okta-sign-in/i],
    },
  },
  {
    name: "Firebase",
    category: "Auth",
    patterns: {
      scriptUrls: [/gstatic\.com\/firebasejs/i, /firebase-app/i],
      htmlPatterns: [/firebaseapp\.com/i, /firebase/i],
    },
  },
  {
    name: "Clerk",
    category: "Auth",
    patterns: {
      scriptUrls: [/clerk\.com/i, /clerk\.dev/i],
    },
  },

  // ─── Monitoring / Error Tracking ──────────────────────────────────────
  {
    name: "Sentry",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/browser\.sentry-cdn\.com/i, /sentry\.io/i],
      htmlPatterns: [/Sentry\.init/i, /dsn:.*sentry\.io/i],
    },
  },
  {
    name: "Datadog RUM",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/datadog-rum/i, /datadoghq\.com/i],
      htmlPatterns: [/DD_RUM/i, /datadogRum/i],
    },
  },
  {
    name: "New Relic",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/js-agent\.newrelic\.com/i, /bam\.nr-data\.net/i],
      htmlPatterns: [/NREUM/i, /newrelic/i],
    },
  },
  {
    name: "LogRocket",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/cdn\.logrocket\.io/i, /cdn\.lr-ingest\.io/i],
      htmlPatterns: [/LogRocket\.init/i],
    },
  },
  {
    name: "Bugsnag",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/d2wy8f7a9ursnm\.cloudfront\.net\/bugsnag/i, /bugsnag/i],
      htmlPatterns: [/Bugsnag\.start/i],
    },
  },
  {
    name: "Rollbar",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/rollbar\.com/i, /cdn\.rollbar\.com/i],
      htmlPatterns: [/Rollbar\.init/i, /rollbarConfig/i],
    },
  },
  {
    name: "FullStory",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/fullstory\.com\/s\/fs\.js/i, /edge\.fullstory\.com/i],
      htmlPatterns: [/FullStory/i],
    },
  },
  {
    name: "Dynatrace",
    category: "Monitoring",
    patterns: {
      scriptUrls: [/dynatrace/i, /dtagent/i],
      headers: { "x-dynatrace": /./ },
    },
  },

  // ─── Fonts / Design ───────────────────────────────────────────────────
  {
    name: "Google Fonts",
    category: "Fonts",
    patterns: {
      cssUrls: [/fonts\.googleapis\.com/i],
      htmlPatterns: [/fonts\.googleapis\.com/i, /fonts\.gstatic\.com/i],
    },
  },
  {
    name: "Adobe Fonts",
    category: "Fonts",
    patterns: {
      cssUrls: [/use\.typekit\.net/i],
      scriptUrls: [/use\.typekit\.net/i],
      htmlPatterns: [/typekit\.net/i],
    },
  },
  {
    name: "Font Awesome",
    category: "Fonts",
    patterns: {
      cssUrls: [/font-awesome(?:\.min)?\.css/i, /fontawesome/i],
      scriptUrls: [/fontawesome/i, /kit\.fontawesome\.com/i],
      htmlPatterns: [/class="fa[srlb]?\s+fa-/i],
    },
  },

  // ─── Build Tools (detectable from output) ─────────────────────────────
  {
    name: "Webpack",
    category: "Build Tool",
    patterns: {
      scriptUrls: [/bundle\.js/i],
      htmlPatterns: [/webpackJsonp/i, /webpackChunk/i],
    },
  },
  {
    name: "Vite",
    category: "Build Tool",
    patterns: {
      htmlPatterns: [/@vite\/client/i, /vite\/modulepreload-polyfill/i],
      scriptUrls: [/@vite\/client/i],
    },
  },
  {
    name: "Parcel",
    category: "Build Tool",
    patterns: {
      htmlPatterns: [/parcelRequire/i],
    },
  },
  {
    name: "Turbopack",
    category: "Build Tool",
    patterns: {
      htmlPatterns: [/turbopack/i, /__turbopack_/i],
    },
  },

  // ─── Security / Captcha ───────────────────────────────────────────────
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
  {
    name: "Cloudflare Turnstile",
    category: "Security",
    patterns: {
      scriptUrls: [/challenges\.cloudflare\.com\/turnstile/i],
      htmlPatterns: [/cf-turnstile/i],
    },
  },

  // ─── Consent / Privacy ────────────────────────────────────────────────
  {
    name: "OneTrust",
    category: "Privacy",
    patterns: {
      scriptUrls: [/cdn\.cookielaw\.org/i, /optanon/i],
      htmlPatterns: [/onetrust/i, /optanon/i],
    },
  },
  {
    name: "Cookiebot",
    category: "Privacy",
    patterns: {
      scriptUrls: [/consent\.cookiebot\.com/i],
      htmlPatterns: [/CookieConsent/i, /cookiebot/i],
    },
  },
  {
    name: "TrustArc",
    category: "Privacy",
    patterns: {
      scriptUrls: [/consent\.trustarc\.com/i, /truste\.com/i],
    },
  },

  // ─── Social / Embeds ──────────────────────────────────────────────────
  {
    name: "YouTube Embed",
    category: "Embed",
    patterns: {
      htmlPatterns: [/youtube\.com\/embed/i, /youtube-nocookie\.com\/embed/i],
    },
  },
  {
    name: "Vimeo Embed",
    category: "Embed",
    patterns: {
      htmlPatterns: [/player\.vimeo\.com/i],
      scriptUrls: [/player\.vimeo\.com/i],
    },
  },
  {
    name: "Twitter Widgets",
    category: "Embed",
    patterns: {
      scriptUrls: [/platform\.twitter\.com\/widgets/i, /platform\.x\.com\/widgets/i],
    },
  },

  // ─── Search / SEO ─────────────────────────────────────────────────────
  {
    name: "Algolia",
    category: "Search",
    patterns: {
      scriptUrls: [/algoliasearch/i, /algolia\.net/i],
      htmlPatterns: [/algolia/i],
    },
  },
  {
    name: "Elasticsearch",
    category: "Search",
    patterns: {
      headers: { "x-elastic-product": /elasticsearch/i },
    },
  },

  // ─── Caching ──────────────────────────────────────────────────────────
  {
    name: "Varnish",
    category: "Caching",
    patterns: {
      headers: { via: /varnish/i, "x-varnish": /./ },
    },
  },
  {
    name: "Redis",
    category: "Caching",
    patterns: {
      headers: { "x-redis-cache": /./ },
    },
  },

  // ─── Reverse Proxy / Load Balancer ────────────────────────────────────
  {
    name: "HAProxy",
    category: "Load Balancer",
    patterns: {
      headers: { "x-haproxy-ip": /./ },
    },
  },
  {
    name: "Traefik",
    category: "Load Balancer",
    patterns: {
      headers: { server: /traefik/i },
    },
  },

  // ─── Email Marketing ──────────────────────────────────────────────────
  {
    name: "Klaviyo",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/static\.klaviyo\.com/i, /klaviyo\.js/i],
      htmlPatterns: [/_learnq/i, /klaviyo/i],
    },
  },
  {
    name: "Brevo",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/sibautomation\.com/i, /sibforms\.com/i],
      htmlPatterns: [/sendinblue/i, /brevo/i, /sib-form/i],
    },
  },
  {
    name: "ConvertKit",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/f\.convertkit\.com/i, /convertkit/i],
      htmlPatterns: [/formkit-form/i, /convertkit/i],
    },
  },
  {
    name: "ActiveCampaign",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/trackcmp\.net/i, /activehosted\.com/i],
      htmlPatterns: [/activecampaign/i, /_acfn/i],
    },
  },
  {
    name: "Drip",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/dc\.ads\.drip\.com/i, /tag\.getdrip\.com/i],
      htmlPatterns: [/_drip_client/i, /getdrip/i],
    },
  },
  {
    name: "Constant Contact",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/cc\.constantcontact\.com/i, /r20\.rs6\.net/i],
      htmlPatterns: [/constantcontact/i, /ctct-inline-form/i],
    },
  },
  {
    name: "SendGrid",
    category: "Email Marketing",
    patterns: {
      scriptUrls: [/mc\.sendgrid\.com/i],
      htmlPatterns: [/sendgrid/i],
      headers: { "x-sg-id": /./ },
    },
  },

  // ─── Customer Data Platform ───────────────────────────────────────────
  {
    name: "mParticle",
    category: "Customer Data Platform",
    patterns: {
      scriptUrls: [/jssdkcdns\.mparticle\.com/i, /mparticle/i],
      htmlPatterns: [/mParticle/i],
    },
  },
  {
    name: "Lytics",
    category: "Customer Data Platform",
    patterns: {
      scriptUrls: [/c\.lytics\.io/i, /lytics/i],
      htmlPatterns: [/jstag/i],
    },
  },
  {
    name: "Treasure Data",
    category: "Customer Data Platform",
    patterns: {
      scriptUrls: [/in\.treasuredata\.com/i, /td-js-sdk/i],
      htmlPatterns: [/treasuredata/i],
    },
  },

  // ─── Form Builder ─────────────────────────────────────────────────────
  {
    name: "Typeform",
    category: "Form Builder",
    patterns: {
      scriptUrls: [/embed\.typeform\.com/i],
      htmlPatterns: [/typeform-embed/i, /typeform\.com/i],
    },
  },
  {
    name: "JotForm",
    category: "Form Builder",
    patterns: {
      scriptUrls: [/cdn\.jotfor\.ms/i, /jotform/i],
      htmlPatterns: [/jotform/i],
    },
  },
  {
    name: "Gravity Forms",
    category: "Form Builder",
    patterns: {
      htmlPatterns: [/gform_wrapper/i, /gfield/i, /gravity-forms/i],
      scriptUrls: [/gravityforms/i],
    },
  },
  {
    name: "Wufoo",
    category: "Form Builder",
    patterns: {
      scriptUrls: [/wufoo\.com\/scripts/i],
      htmlPatterns: [/wufoo-form/i, /wufoo\.com/i],
    },
  },
  {
    name: "Cognito Forms",
    category: "Form Builder",
    patterns: {
      scriptUrls: [/cognitoforms\.com/i],
      htmlPatterns: [/cognito-form/i, /cognitoforms/i],
    },
  },
  {
    name: "Formstack",
    category: "Form Builder",
    patterns: {
      scriptUrls: [/formstack\.com\/forms\/js/i],
      htmlPatterns: [/formstack/i, /fsForm/i],
    },
  },

  // ─── Scheduling ───────────────────────────────────────────────────────
  {
    name: "Calendly",
    category: "Scheduling",
    patterns: {
      scriptUrls: [/assets\.calendly\.com/i],
      htmlPatterns: [/calendly-badge-widget/i, /calendly-inline-widget/i, /calendly\.com/i],
    },
  },
  {
    name: "Acuity Scheduling",
    category: "Scheduling",
    patterns: {
      scriptUrls: [/app\.acuityscheduling\.com/i, /acuityscheduling/i],
      htmlPatterns: [/acuity-embed/i, /acuityscheduling/i],
    },
  },
  {
    name: "Cal.com",
    category: "Scheduling",
    patterns: {
      scriptUrls: [/app\.cal\.com\/embed/i, /cal\.com\/embed/i],
      htmlPatterns: [/cal-embed/i],
    },
  },

  // ─── Reviews / Social Proof ───────────────────────────────────────────
  {
    name: "Trustpilot",
    category: "Reviews",
    patterns: {
      scriptUrls: [/widget\.trustpilot\.com/i],
      htmlPatterns: [/trustpilot-widget/i, /trustpilot\.com/i],
    },
  },
  {
    name: "Yotpo",
    category: "Reviews",
    patterns: {
      scriptUrls: [/staticw2\.yotpo\.com/i, /yotpo/i],
      htmlPatterns: [/yotpo-widget/i, /yotpo/i],
    },
  },
  {
    name: "Bazaarvoice",
    category: "Reviews",
    patterns: {
      scriptUrls: [/apps\.bazaarvoice\.com/i, /bazaarvoice/i],
      htmlPatterns: [/bv-cv2-cleanslate/i, /bazaarvoice/i],
    },
  },
  {
    name: "Judge.me",
    category: "Reviews",
    patterns: {
      scriptUrls: [/judge\.me\/assets/i, /judgeme/i],
      htmlPatterns: [/jdgm-widget/i, /judge\.me/i],
    },
  },
  {
    name: "Stamped.io",
    category: "Reviews",
    patterns: {
      scriptUrls: [/stamped\.io/i],
      htmlPatterns: [/stamped-reviews/i, /stamped-container/i],
    },
  },
  {
    name: "Feefo",
    category: "Reviews",
    patterns: {
      scriptUrls: [/api\.feefo\.com/i, /feefo/i],
      htmlPatterns: [/feefo-review/i],
    },
  },

  // ─── Accessibility ────────────────────────────────────────────────────
  {
    name: "AccessiBe",
    category: "Accessibility",
    patterns: {
      scriptUrls: [/acsbapp\.com/i, /accessibe/i],
      htmlPatterns: [/acsb-trigger/i, /accessibe/i],
    },
  },
  {
    name: "UserWay",
    category: "Accessibility",
    patterns: {
      scriptUrls: [/cdn\.userway\.org/i, /userway/i],
      htmlPatterns: [/userway/i],
    },
  },
  {
    name: "AudioEye",
    category: "Accessibility",
    patterns: {
      scriptUrls: [/ws\.audioeye\.com/i, /audioeye/i],
      htmlPatterns: [/audioeye/i],
    },
  },
  {
    name: "EqualWeb",
    category: "Accessibility",
    patterns: {
      scriptUrls: [/equalweb\.com/i],
      htmlPatterns: [/equalweb/i],
    },
  },

  // ─── Personalization ──────────────────────────────────────────────────
  {
    name: "Dynamic Yield",
    category: "Personalization",
    patterns: {
      scriptUrls: [/cdn\.dynamicyield\.com/i, /dynamicyield/i],
      htmlPatterns: [/DY\.API/i, /dynamicyield/i],
    },
  },
  {
    name: "Bloomreach",
    category: "Personalization",
    patterns: {
      scriptUrls: [/cdn\.exponea\.com/i, /bloomreach/i],
      htmlPatterns: [/exponea/i, /bloomreach/i],
    },
  },
  {
    name: "Insider",
    category: "Personalization",
    patterns: {
      scriptUrls: [/insr\.ins-global\.com/i, /useinsider\.com/i],
      htmlPatterns: [/Insider\.init/i, /useinsider/i],
    },
  },

  // ─── Mapping ──────────────────────────────────────────────────────────
  {
    name: "Mapbox GL JS",
    category: "Mapping",
    patterns: {
      scriptUrls: [/api\.mapbox\.com\/mapbox-gl/i, /mapbox-gl\.js/i],
      cssUrls: [/mapbox-gl\.css/i],
      htmlPatterns: [/mapboxgl/i],
    },
  },
  {
    name: "Leaflet",
    category: "Mapping",
    patterns: {
      scriptUrls: [/leaflet(?:\.min)?\.js/i, /unpkg\.com\/leaflet/i],
      cssUrls: [/leaflet(?:\.min)?\.css/i],
      htmlPatterns: [/leaflet-container/i],
    },
  },
  {
    name: "Google Maps",
    category: "Mapping",
    patterns: {
      scriptUrls: [/maps\.googleapis\.com\/maps/i],
      htmlPatterns: [/maps\.google\.com\/maps/i, /google\.com\/maps\/embed/i],
    },
  },
  {
    name: "OpenStreetMap",
    category: "Mapping",
    patterns: {
      htmlPatterns: [/tile\.openstreetmap\.org/i, /openstreetmap\.org/i],
    },
  },

  // ─── Database / BaaS ──────────────────────────────────────────────────
  {
    name: "Supabase",
    category: "Database",
    patterns: {
      scriptUrls: [/supabase/i],
      htmlPatterns: [/supabase\.co/i, /supabase/i],
    },
  },

  // ─── Additional E-commerce ────────────────────────────────────────────
  {
    name: "Ecwid",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/app\.ecwid\.com/i],
      htmlPatterns: [/ecwid/i, /ec\.store/i],
    },
  },
  {
    name: "Big Cartel",
    category: "E-commerce",
    patterns: {
      meta: { generator: /big cartel/i },
      htmlPatterns: [/bigcartel\.com/i],
    },
  },
  {
    name: "Volusion",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/a\.vsstatic\.com/i],
      htmlPatterns: [/volusion/i],
      headers: { "x-volusion-secure": /./ },
    },
  },
  {
    name: "Gumroad",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/gumroad\.com\/js\/gumroad/i, /gumroad\.com/i],
      htmlPatterns: [/gumroad-overlay/i, /gumroad/i],
    },
  },
  {
    name: "Lemon Squeezy",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/assets\.lemonsqueezy\.com/i, /lemonsqueezy/i],
      htmlPatterns: [/lemonsqueezy/i],
    },
  },
  {
    name: "ThriveCart",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/thrivecart\.com/i],
      htmlPatterns: [/thrivecart/i],
    },
  },
  {
    name: "Snipcart",
    category: "E-commerce",
    patterns: {
      scriptUrls: [/cdn\.snipcart\.com/i, /snipcart/i],
      htmlPatterns: [/snipcart/i, /data-item-id/i],
    },
  },

  // ─── Additional CMS ───────────────────────────────────────────────────
  {
    name: "Sanity",
    category: "CMS",
    patterns: {
      htmlPatterns: [/cdn\.sanity\.io/i],
      scriptUrls: [/sanity/i],
    },
  },
  {
    name: "Storyblok",
    category: "CMS",
    patterns: {
      scriptUrls: [/app\.storyblok\.com/i, /storyblok/i],
      htmlPatterns: [/storyblok/i],
    },
  },
  {
    name: "Prismic",
    category: "CMS",
    patterns: {
      scriptUrls: [/prismic\.io/i],
      htmlPatterns: [/prismic/i, /cdn\.prismic\.io/i],
    },
  },
  {
    name: "DatoCMS",
    category: "CMS",
    patterns: {
      htmlPatterns: [/datocms-assets\.com/i, /datocms/i],
    },
  },
  {
    name: "Framer",
    category: "CMS",
    patterns: {
      htmlPatterns: [/framer\.com/i, /framerusercontent\.com/i],
      scriptUrls: [/events\.framer\.com/i, /framer/i],
    },
  },
  {
    name: "Bubble",
    category: "CMS",
    patterns: {
      htmlPatterns: [/bubble\.io/i, /bubbleapps\.io/i],
      scriptUrls: [/bubble\.io/i],
    },
  },
  {
    name: "Carrd",
    category: "CMS",
    patterns: {
      htmlPatterns: [/carrd\.co/i],
      meta: { generator: /carrd/i },
    },
  },
  {
    name: "Substack",
    category: "CMS",
    patterns: {
      htmlPatterns: [/substack\.com/i, /substackcdn\.com/i],
      scriptUrls: [/substackcdn\.com/i],
    },
  },
  {
    name: "Discourse",
    category: "CMS",
    patterns: {
      meta: { generator: /discourse/i },
      htmlPatterns: [/discourse-/i, /data-discourse/i],
    },
    versionExtract: { source: "meta", pattern: /Discourse\s+([\d.]+)/i },
  },
  {
    name: "Beehiiv",
    category: "CMS",
    patterns: {
      htmlPatterns: [/beehiiv\.com/i],
      scriptUrls: [/beehiiv\.com/i],
    },
  },
  {
    name: "Kajabi",
    category: "CMS",
    patterns: {
      htmlPatterns: [/kajabi/i],
      scriptUrls: [/kajabi\.com/i, /kajabi-/i],
    },
  },
  {
    name: "Teachable",
    category: "CMS",
    patterns: {
      scriptUrls: [/teachablecdn\.com/i, /teachable/i],
      htmlPatterns: [/teachable/i],
    },
  },

  // ─── Additional Search ────────────────────────────────────────────────
  {
    name: "Coveo",
    category: "Search",
    patterns: {
      scriptUrls: [/platform\.cloud\.coveo\.com/i, /coveo/i],
      htmlPatterns: [/CoveoSearchInterface/i, /coveo/i],
    },
  },
  {
    name: "Yext",
    category: "Search",
    patterns: {
      scriptUrls: [/assets\.sitescdn\.net/i, /yext/i],
      htmlPatterns: [/yext-search/i, /yext/i],
    },
  },
  {
    name: "Doofinder",
    category: "Search",
    patterns: {
      scriptUrls: [/doofinder\.com/i],
      htmlPatterns: [/doofinder/i, /dfclassic/i],
    },
  },
  {
    name: "Searchspring",
    category: "Search",
    patterns: {
      scriptUrls: [/searchspring\.net/i, /searchspring/i],
      htmlPatterns: [/searchspring/i],
    },
  },

  // ─── Additional Security ──────────────────────────────────────────────
  {
    name: "PerimeterX",
    category: "Security",
    patterns: {
      scriptUrls: [/px-cdn\.net/i, /px-cloud\.net/i],
      cookies: ["_pxhd", "_px3", "_pxvid"],
    },
  },
  {
    name: "DataDome",
    category: "Security",
    patterns: {
      scriptUrls: [/datadome\.co/i],
      cookies: ["datadome"],
      headers: { "x-datadome": /./ },
    },
  },
  {
    name: "Radware",
    category: "Security",
    patterns: {
      headers: { "x-rdwr": /./, "x-cdn": /radware/i },
    },
  },

  // ─── Additional Hosting ───────────────────────────────────────────────
  {
    name: "DigitalOcean App Platform",
    category: "Hosting",
    patterns: {
      headers: { server: /digitalocean/i, "x-do-app-origin": /./ },
    },
  },
  {
    name: "Deno Deploy",
    category: "Hosting",
    patterns: {
      headers: { server: /deno/i, "x-deno-ray": /./ },
    },
  },
  {
    name: "Surge",
    category: "Hosting",
    patterns: {
      headers: { server: /surge/i },
    },
  },
  {
    name: "Replit",
    category: "Hosting",
    patterns: {
      headers: { "x-replit-cluster": /./ },
      htmlPatterns: [/repl\.co/i, /replit\.dev/i],
    },
  },
  {
    name: "Glitch",
    category: "Hosting",
    patterns: {
      htmlPatterns: [/glitch\.me/i, /cdn\.glitch\.com/i],
    },
  },

  // ─── Additional Analytics ─────────────────────────────────────────────
  {
    name: "Piwik PRO",
    category: "Analytics",
    patterns: {
      scriptUrls: [/piwikpro\.com/i, /containers\.piwik\.pro/i],
      htmlPatterns: [/ppms\.js/i, /piwikpro/i],
    },
  },
  {
    name: "Kissmetrics",
    category: "Analytics",
    patterns: {
      scriptUrls: [/scripts\.kissmetrics\.com/i, /kissmetrics/i],
      htmlPatterns: [/kissmetrics/i, /_kmq/i],
    },
  },
  {
    name: "Woopra",
    category: "Analytics",
    patterns: {
      scriptUrls: [/static\.woopra\.com/i, /woopra/i],
      htmlPatterns: [/woopra/i],
    },
  },
  {
    name: "Pirsch",
    category: "Analytics",
    patterns: {
      scriptUrls: [/api\.pirsch\.io/i, /pirsch/i],
    },
  },
  {
    name: "Umami",
    category: "Analytics",
    patterns: {
      scriptUrls: [/umami\.js/i, /umami\.is/i],
      htmlPatterns: [/data-website-id/i],
    },
  },
  {
    name: "Simple Analytics",
    category: "Analytics",
    patterns: {
      scriptUrls: [/scripts\.simpleanalyticscdn\.com/i, /simpleanalytics/i],
      htmlPatterns: [/simpleanalytics/i],
    },
  },
  {
    name: "GoatCounter",
    category: "Analytics",
    patterns: {
      scriptUrls: [/gc\.zgo\.at/i, /goatcounter/i],
      htmlPatterns: [/goatcounter/i],
    },
  },

  // ─── Additional Servers / Runtimes ────────────────────────────────────
  {
    name: "Bun",
    category: "Server",
    patterns: {
      headers: { server: /bun/i },
    },
    versionExtract: { source: "header", pattern: /Bun\/([\d.]+)/i },
  },
  {
    name: "Deno",
    category: "Server",
    patterns: {
      headers: { server: /^deno\//i },
    },
    versionExtract: { source: "header", pattern: /deno\/([\d.]+)/i },
  },

  // ─── Additional JS Frameworks ─────────────────────────────────────────
  {
    name: "Unpoly",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/unpoly(?:\.min)?\.js/i],
      htmlPatterns: [/up-follow/i, /up-instant/i, /\[up-/i],
    },
  },
  {
    name: "Turbolinks",
    category: "JS Framework",
    patterns: {
      scriptUrls: [/turbolinks(?:\.min)?\.js/i],
      htmlPatterns: [/data-turbolinks/i],
    },
  },

  // ─── Additional Marketing / Chat ──────────────────────────────────────
  {
    name: "Tidio",
    category: "Marketing",
    patterns: {
      scriptUrls: [/code\.tidio\.co/i],
      htmlPatterns: [/tidio/i],
    },
  },
  {
    name: "Chatwoot",
    category: "Marketing",
    patterns: {
      scriptUrls: [/chatwoot/i, /app\.chatwoot\.com/i],
      htmlPatterns: [/chatwootSettings/i, /chatwoot/i],
    },
  },
  {
    name: "Help Scout",
    category: "Marketing",
    patterns: {
      scriptUrls: [/beacon-v2\.helpscout\.net/i],
      htmlPatterns: [/helpscout/i, /HS\.beacon/i],
    },
  },

  // ─── Additional Payment ───────────────────────────────────────────────
  {
    name: "Paddle",
    category: "Payment",
    patterns: {
      scriptUrls: [/cdn\.paddle\.com/i, /paddle\.js/i],
      htmlPatterns: [/paddle/i, /Paddle\.Setup/i],
    },
  },
  {
    name: "Chargebee",
    category: "Payment",
    patterns: {
      scriptUrls: [/js\.chargebee\.com/i, /chargebee/i],
      htmlPatterns: [/chargebee/i],
    },
  },
  {
    name: "Recurly",
    category: "Payment",
    patterns: {
      scriptUrls: [/js\.recurly\.com/i, /recurly\.js/i],
      htmlPatterns: [/recurly/i],
    },
  },

  // ─── Additional Embeds ────────────────────────────────────────────────
  {
    name: "Airtable Embed",
    category: "Embed",
    patterns: {
      htmlPatterns: [/airtable\.com\/embed/i, /airtable\.com\/shrink/i],
    },
  },
];
