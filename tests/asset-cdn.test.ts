import { describe, expect, it } from "vitest";
import { detectAssetCdn } from "../worker/src/actions/analyze/asset-cdn";

describe("detectAssetCdn", () => {
  it("returns null for empty HTML", () => {
    expect(detectAssetCdn("", "example.com")).toBeNull();
    expect(detectAssetCdn("<html></html>", "example.com")).toBeNull();
  });

  it("detects CloudFront URLs in img src", () => {
    const html = `<html><body>
      <img src="https://d1234abcd.cloudfront.net/images/hero.jpg" />
      <img src="https://d1234abcd.cloudfront.net/images/logo.png" />
      <p>Some content here to pass the length check and make this realistic enough</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers).toHaveLength(1);
    expect(result?.providers[0].name).toBe("CloudFront");
    expect(result?.providers[0].urls).toBe(2);
    expect(result?.totalCdnUrls).toBe(2);
  });

  it("detects Jetpack/WP.com CDN URLs", () => {
    const html = `<html><body>
      <img src="https://i0.wp.com/example.com/wp-content/uploads/photo.jpg" />
      <img src="https://i1.wp.com/example.com/wp-content/uploads/banner.jpg" />
      <link href="https://s0.wp.com/wp-content/themes/starter.css" rel="stylesheet" />
      <p>WordPress site with Jetpack Site Accelerator enabled for image delivery</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers).toHaveLength(1);
    expect(result?.providers[0].name).toBe("Jetpack/WP.com");
    expect(result?.providers[0].urls).toBe(3);
  });

  it("detects MaxCDN / netdna-cdn URLs", () => {
    const html = `<html><body>
      <link href="https://assets.netdna-cdn.com/css/bootstrap.css" rel="stylesheet" />
      <script src="https://cdn.netdna-ssl.com/js/app.js"></script>
      <p>Legacy MaxCDN-hosted assets still in use on many WordPress sites today</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers.find((p) => p.name === "MaxCDN")).toBeDefined();
  });

  it("detects same-origin CDN subdomains", () => {
    const html = `<html><body>
      <img src="https://cdn.example.com/images/hero.jpg" />
      <img src="https://static.example.com/images/logo.png" />
      <p>Some content here to make this HTML realistic enough for the length check</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.sameOriginCdn).toBe(true);
    // Same-origin CDN subdomains don't add to providers list
    expect(result?.providers).toHaveLength(0);
    expect(result?.totalCdnUrls).toBe(2);
  });

  it("excludes platform CDNs (fbcdn, twimg, etc.)", () => {
    const html = `<html><body>
      <img src="https://scontent.fbcdn.net/v/t1.123456.jpg" />
      <img src="https://pbs.twimg.com/media/abcdef.jpg" />
      <img src="https://lh3.googleusercontent.com/photo.jpg" />
      <p>Page with embedded social media content should not trigger asset CDN detection</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(false);
    expect(result?.providers).toHaveLength(0);
    expect(result?.totalCdnUrls).toBe(0);
  });

  it("detects multiple CDN providers", () => {
    const html = `<html><body>
      <img src="https://d1234.cloudfront.net/hero.jpg" />
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css" rel="stylesheet" />
      <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
      <img src="https://res.cloudinary.com/demo/image/upload/sample.jpg" />
      <p>Multiple CDN providers for different asset types is a healthy architecture</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers.length).toBeGreaterThanOrEqual(4);
    const names = result?.providers.map((p) => p.name);
    expect(names).toContain("CloudFront");
    expect(names).toContain("jsDelivr");
    expect(names).toContain("unpkg");
    expect(names).toContain("Cloudinary");
  });

  it("handles srcset attributes with multiple URLs", () => {
    const html = `<html><body>
      <img srcset="https://d1234.cloudfront.net/small.jpg 480w, https://d1234.cloudfront.net/large.jpg 1024w" />
      <p>Some additional content to meet the minimum length threshold for detection</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers[0].name).toBe("CloudFront");
    expect(result?.providers[0].urls).toBe(2);
  });

  it("detects regional CDN providers", () => {
    const html = `<html><body>
      <img src="https://img.alicdn.com/bao/uploaded/product.jpg" />
      <script src="https://cdn.bdstatic.com/static/common/pkg/index.js"></script>
      <p>Chinese CDN providers are commonly used for sites targeting the Asian market</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    const names = result?.providers.map((p) => p.name);
    expect(names).toContain("Alibaba CDN");
    expect(names).toContain("Baidu");
  });

  it("ignores relative URLs and data URIs", () => {
    const html = `<html><body>
      <img src="/images/hero.jpg" />
      <img src="data:image/png;base64,iVBORw0KGgoAAAA..." />
      <img src="images/local.jpg" />
      <p>Only absolute http/https URLs should be checked against CDN patterns</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(false);
    expect(result?.totalCdnUrls).toBe(0);
  });

  it("handles data-src (lazy loading) attributes", () => {
    const html = `<html><body>
      <img data-src="https://d1234.cloudfront.net/lazy-hero.jpg" class="lazyload" />
      <p>Lazy loaded images via data-src are common and should still be detected</p>
    </body></html>`;
    const result = detectAssetCdn(html, "example.com");
    expect(result).not.toBeNull();
    expect(result?.detected).toBe(true);
    expect(result?.providers[0].name).toBe("CloudFront");
  });
});
