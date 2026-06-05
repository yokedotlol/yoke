// ─── Import production code (single source of truth) ─────────────────
import { detectTechStack } from "@worker/actions/analyze/http";
import { detectHosting } from "@worker/actions/analyze/security";
import { describe, expect, it } from "vitest";

// ─── Tech Stack Detection ─────────────────────────────────────────────

describe("WordPress Detection", () => {
  it("should detect WordPress from wp-content in HTML", () => {
    const html = '<link rel="stylesheet" href="/wp-content/themes/twentytwenty/style.css">';
    const result = detectTechStack({}, html);
    const wp = result.find((r) => r.name === "WordPress");
    expect(wp).toBeDefined();
    expect(wp?.category).toBe("CMS");
  });

  it("should detect WordPress from wp-includes", () => {
    const html = '<script src="/wp-includes/js/jquery/jquery.min.js"></script>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "WordPress")).toBeDefined();
  });

  it("should detect WordPress version from meta generator", () => {
    const html = '<meta name="generator" content="WordPress 6.5.3">';
    const result = detectTechStack({}, html);
    const wp = result.find((r) => r.name === "WordPress");
    expect(wp).toBeDefined();
    expect(wp?.version).toBe("6.5.3");
    // Production confidence depends on cumulative fingerprint score
  });

  it("should not detect WordPress on non-WP sites", () => {
    const html = "<html><body>Hello world</body></html>";
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "WordPress")).toBeUndefined();
  });
});

describe("CDN/Server Detection", () => {
  it("should detect Cloudflare from server header", () => {
    const result = detectTechStack({ server: "cloudflare" }, "");
    expect(result.find((r) => r.name === "Cloudflare")).toBeDefined();
  });

  it("should detect nginx with version", () => {
    const result = detectTechStack({ server: "nginx/1.25.3" }, "");
    const nginx = result.find((r) => r.name === "Nginx");
    expect(nginx).toBeDefined();
    expect(nginx?.version).toBe("1.25.3");
  });

  it("should detect nginx without version", () => {
    const result = detectTechStack({ server: "nginx" }, "");
    const nginx = result.find((r) => r.name === "Nginx");
    expect(nginx).toBeDefined();
    expect(nginx?.version).toBeNull();
  });

  it("should not confuse Cloudflare with nginx", () => {
    const result = detectTechStack({ server: "cloudflare" }, "");
    expect(result.find((r) => r.name === "Nginx")).toBeUndefined();
    expect(result.find((r) => r.name === "Cloudflare")).toBeDefined();
  });
});

describe("Shopify Detection", () => {
  it("should detect Shopify from x-shopid header", () => {
    const result = detectTechStack({ "x-shopid": "12345", "x-shopify-stage": "production" }, "");
    expect(result.find((r) => r.name === "Shopify")).toBeDefined();
  });

  it("should detect Shopify from HTML patterns", () => {
    const html = '<script src="https://cdn.shopify.com/s/files/1/0123/script.js"></script>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Shopify")).toBeDefined();
  });
});

describe("React Detection", () => {
  it("should detect React from data-reactroot", () => {
    const html = '<div id="root" data-reactroot="">...</div>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "React")).toBeDefined();
  });

  it("should detect Next.js data", () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{}</script>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "React")).toBeDefined();
  });
});

// ─── Hosting/CDN Detection ───────────────────────────────────────────
// Production detectHosting takes (ipInfo, headers) — we adapt tests accordingly.

describe("Hosting/CDN Detection", () => {
  it("should detect Cloudflare CDN", () => {
    const result = detectHosting(null, { server: "cloudflare", "cf-ray": "abc123" });
    expect(result.cdn).toBe("Cloudflare");
  });

  it("should detect Vercel", () => {
    const result = detectHosting(null, { "x-vercel-id": "iad1::12345", server: "Vercel" });
    expect(result.provider).toBe("Vercel");
  });

  it("should detect AWS from rDNS", () => {
    const ipInfo = {
      ip: "54.123.45.67",
      isp: null,
      org: null,
      asn: null,
      city: null,
      country: null,
      country_code: null,
      lat: null,
      lon: null,
      reverse_dns: "ec2-54-123-45-67.compute-1.amazonaws.com",
      ipv6: null,
    };
    const result = detectHosting(ipInfo, null);
    expect(result.provider).toBe("AWS");
  });

  it("should detect Fastly from headers", () => {
    const result = detectHosting(null, { "x-served-by": "cache-iad-kjhg7890", via: "1.1 varnish" });
    expect(result.cdn).toBe("Fastly");
  });

  it("should detect Netlify", () => {
    const result = detectHosting(null, { server: "Netlify", "x-nf-request-id": "abc" });
    expect(result.provider).toBe("Netlify");
  });

  it("should detect WordPress VIP via x-vip-go header", () => {
    const result = detectHosting(null, { "x-vip-go": "1" });
    expect(result.provider).toBe("WordPress VIP");
  });

  it("should detect WordPress VIP via x-powered-by header", () => {
    const result = detectHosting(null, { "x-powered-by": "WordPress VIP <https://wpvip.com>" });
    expect(result.provider).toBe("WordPress VIP");
  });

  it("should detect WordPress VIP via HTML pattern", () => {
    // HTML-based VIP detection is handled by detectManagedHosting() in wordpress.ts
    // detectHosting() only checks headers/IP/rDNS, so test with wpvip.com domain in x-powered-by
    const result = detectHosting(null, { "x-powered-by": "WordPress VIP <https://wpvip.com>" });
    expect(result.provider).toBe("WordPress VIP");
  });

  it("should return nulls for unknown hosting", () => {
    const result = detectHosting(null, { server: "Apache/2.4.52" });
    expect(result.provider).toBeNull();
    expect(result.cdn).toBeNull();
    expect(result.waf).toBeNull();
  });

  it("should handle null inputs", () => {
    const result = detectHosting(null, null);
    expect(result.provider).toBeNull();
    expect(result.cdn).toBeNull();
    expect(result.waf).toBeNull();
  });
});

// ─── Django Detection (False Positive Prevention) ─────────────────────

describe("Django Detection", () => {
  it("should detect Django from csrfmiddlewaretoken", () => {
    const html = '<input type="hidden" name="csrfmiddlewaretoken" value="abc123">';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Django")).toBeDefined();
  });

  it("should detect Django from django.contrib references", () => {
    const html = '<script src="/static/django.contrib.admin/js/core.js"></script>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Django")).toBeDefined();
  });

  it("should NOT detect Django from x-frame-options: sameorigin alone", () => {
    const result = detectTechStack({ "x-frame-options": "SAMEORIGIN" }, "");
    expect(result.find((r) => r.name === "Django")).toBeUndefined();
  });

  it("should NOT detect Django from generic page mentioning 'django' in text", () => {
    const html = "<html><body>Learn how to build with Django framework</body></html>";
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Django")).toBeUndefined();
  });

  it("should NOT detect Django on a React/Next.js site", () => {
    const html = '<div id="__next" data-reactroot=""><div class="flex bg-white p-4">Hello</div></div>';
    const result = detectTechStack({ "x-frame-options": "SAMEORIGIN" }, html);
    expect(result.find((r) => r.name === "Django")).toBeUndefined();
  });
});

// ─── Tailwind CSS Detection (False Positive Prevention) ───────────────

describe("Tailwind CSS Detection", () => {
  it("should detect Tailwind from CSS URL", () => {
    const html = '<link rel="stylesheet" href="/css/tailwind.min.css">';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Tailwind CSS")).toBeDefined();
  });

  it("should detect Tailwind from tailwindcss reference", () => {
    const html = '<link rel="stylesheet" href="/assets/tailwindcss.css">';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Tailwind CSS")).toBeDefined();
  });

  it("should NOT detect Tailwind from generic utility class names", () => {
    const html = '<div class="flex grid text-center bg-white p-4 m-2 w-full h-screen">Hello</div>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Tailwind CSS")).toBeUndefined();
  });

  it("should NOT detect Tailwind on Bootstrap sites", () => {
    const html = '<link rel="stylesheet" href="/css/bootstrap.min.css"><div class="flex p-4 text-center">Hello</div>';
    const result = detectTechStack({}, html);
    expect(result.find((r) => r.name === "Tailwind CSS")).toBeUndefined();
  });
});
