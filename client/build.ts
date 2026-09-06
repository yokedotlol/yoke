// Build script for the Yoke client using Bun's native bundler + Tailwind CSS v4

import tailwind from "bun-plugin-tailwind";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const outdir = join(import.meta.dir, "dist");

// Clean stale build artifacts before writing new ones
rmSync(join(outdir, "assets"), { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
mkdirSync(join(outdir, "assets"), { recursive: true });

// Build the JS + CSS bundle with Tailwind plugin
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/main.tsx")],
  outdir,
  target: "browser",
  minify: true,
  splitting: true,
  plugins: [tailwind],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  naming: {
    entry: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  external: [],
});

if (!result.success) {
  console.error("Build failed:");
  for (const msg of result.logs) {
    console.error(msg);
  }
  process.exit(1);
}

// Find outputs
const jsOutputs = result.outputs.filter((o) => o.path.endsWith(".js"));
const cssOutput = result.outputs.find((o) => o.path.endsWith(".css"));

// Entry point is the one matching the entrypoint name pattern
const jsEntry = jsOutputs.find((o) => o.path.includes("/main-")) ?? jsOutputs[0];

if (!jsEntry) {
  console.error("No JS entry output found");
  process.exit(1);
}

const jsPath = jsEntry.path.replace(`${outdir}/`, "");
const cssPath = cssOutput ? cssOutput.path.replace(`${outdir}/`, "") : null;

// Report all chunks
const jsChunks = jsOutputs.filter((o) => o !== jsEntry);
console.log(`  Chunks: ${jsChunks.length} lazy-loaded chunk(s)`);

// CSS served as a separate cacheable file (avoids large inline block, improves cacheability)
const cssLink = cssOutput ? `<link rel="stylesheet" href="/${cssPath}" />` : "";
const jsPreload = `<link rel="modulepreload" href="/${jsPath}" />`;
const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${cssLink}
    ${jsPreload}
    <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin />
    <style>
      @font-face {
        font-family: 'Inter';
        font-style: normal;
        font-weight: 400 700;
        font-display: swap;
        src: url('/fonts/inter-latin.woff2') format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }
      @font-face {
        font-family: 'JetBrains Mono';
        font-style: normal;
        font-weight: 400 600;
        font-display: swap;
        src: url('/fonts/jetbrains-mono-latin.woff2') format('woff2');
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }
    </style>
    <title>Yoke — Free Domain Intelligence Tool</title>
    <meta name="description" content="Free domain intelligence tool. DNS, SSL, WHOIS, security audit, tech stack detection, performance analysis, breach detection, and AI insights. Web UI, Chrome extension, and curl API." />
    <meta name="robots" content="index, follow" />
    <meta name="keywords" content="domain intelligence, OSINT, DNS lookup, SSL checker, security headers, tech stack detection, WHOIS, domain analysis, website scanner, breach detection" />
    <link rel="canonical" href="https://yoke.lol" />
    <meta property="og:title" content="Yoke — Free Domain Intelligence Tool" />
    <meta property="og:description" content="Analyze any domain instantly. DNS, SSL, WHOIS, security audit, tech stack, performance, breach detection, and AI-powered insights. Free, no signup required." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://yoke.lol" />
    <meta property="og:site_name" content="Yoke" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image" content="https://yoke.lol/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Yoke — Free Domain Intelligence Tool" />
    <meta name="twitter:description" content="Analyze any domain instantly. DNS, SSL, WHOIS, security headers, tech stack, performance, and breach detection. Free API: curl -s https://yoke.lol/stripe.com" />
    <meta name="twitter:image" content="https://yoke.lol/og.png" />

    <!-- Social verification (rel="me") -->
    <link rel="me" href="https://mastodon.social/@yokelol" />
    <link rel="me" href="https://bsky.app/profile/yoke.lol" />
    <link rel="me" href="https://x.com/yokedotlol" />
    <link rel="me" href="https://github.com/yokedotlol" />
    <link rel="me" href="https://www.reddit.com/u/yokelol" />
    <link rel="me" href="https://www.instagram.com/yokedotlol/" />
    <link rel="me" href="https://www.threads.net/@yokedotlol" />
    <link rel="me" href="https://www.linkedin.com/company/yokelol" />
    <link rel="me" href="https://gitlab.com/yokelol" />
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "name": "Yoke",
      "url": "https://yoke.lol",
      "description": "Free domain intelligence and OSINT tool. Analyze DNS, SSL, WHOIS, security headers, tech stack, performance, breach history, and more for any domain.",
      "applicationCategory": "SecurityApplication",
      "operatingSystem": "Any",
      "browserRequirements": "Requires a modern web browser",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      },
      "featureList": [
        "DNS record lookup (A, AAAA, MX, NS, TXT, CNAME, SOA)",
        "SSL/TLS certificate analysis with direct TLS probe grading",
        "WHOIS and RDAP registration data",
        "Security header audit and scoring",
        "Technology stack detection (frameworks, CMS, CDN, WAF)",
        "WordPress deep fingerprinting (theme, plugins, version)",
        "Performance analysis via Google PageSpeed Insights",
        "Data breach detection via HIBP",
        "Email authentication (SPF, DKIM, DMARC)",
        "IP geolocation and ASN information",
        "Shodan and GreyNoise threat intelligence",
        "Certificate Transparency log monitoring",
        "AI-powered domain analysis with multiple expert personas",
        "Free JSON API (curl -s https://yoke.lol/example.com)",
        "Chrome extension for in-browser analysis"
      ],
      "author": {
        "@type": "Person",
        "name": "yokedotlol",
        "url": "https://github.com/yokedotlol"
      }
    }
    </script>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAFCElEQVR4nO1UX0xTVxj/zjm9/UOL6RzGbRDlYQvtk3OLBE0UkZK58DKzRYxsCWzyIM5YGTNb3JYlOqNhjZBlssYRZMv4ZwgJoJtv0I6OEJw6El2GxlqR8EekTQu3vbfnfHvAskpvx8we9jB+ycm5+e53z/f7fvd8P4BVrOI/BlkeaGtr+8hutxdFo9EFQggBAMAnMjA5gIRSgYiMAAAiAhDy16GUAgoBiIgZJpP52rVrvRUVFV/9LaPr169fMZlMAADAGNNclNKlPbHS5TLGAADAYrGQ0dHR/uX16PJAKBQal2UZ8vLyDAcOHNjMOQdEBM750hJCLO2Jlfw+OefQ+4cKcnNzdZFIBMPh8MyKBCRJ0hNC4IXsbLPT6XTBY2klSUpRIZ0CkiQBIgJjDGqO1jRmZWUZCSFAGZNWJICIgIgwfv9+xGazFZ08eeJ1RARVVVM6TKeAqqpACIGGhoa3N27c+PLExISMiLD8NgEA6JYHhBCcUgr37t1Turq6Pj1+/JPLDkfJ952dneeGh4d/R0T4oLbWyShlljWWdQQJhsPhh7FYbN7lcp0zGAy6goIC+/79+2s3bdr0RnNz88GpqSkuSRIIIXgKg+UY8A5ceHz5wWw2k+7u7s8ePXo0jogYCARu9PT01NXV1e2x2WwGh8ORVVxc/KzNZjM0NjZW9vb2fjk9Mz2OiPhw9qG/tbX1qCQtqq7T6cDn83WtSMD7s/cCAECCRGZmJjl27MMd7e3tH1dXV7966tQXe7S+M5lM4HK5yo84j2zt6Og4XlNTs81sNhNCCBBCgDGmSSDlDgACUEoBEcHhKF7n9Xp/mpiYmJRlObhr167Sysp36/Lz8zMJISBJEiQ63FlU9Fx5efmJbVu3FcqyHJycmpzx+XxXSkpK1iMiUEo1XEeLAAAIIYBSCh6Pd6a/v/9CcbGjuKWlpTMSiSwEg8Hx+vr6c5RS4JxDPB4Hg8EA9fX1HcFQ8P78wnysqampdfdru3d7PJ4fBgYGpgghIITQuoOpBBLSIyIoigJOp7NtaGhocPMrm186f/58U0NDQ20wGJwrLS3NFosuB/v27bP57969cfbs2dqmb5ua8/PzbUNDQ97Dhw+3xGKxRYdMOjsZKVOAyJcIJOB2u39LPNe56o6EQ+H5ubm5aCI2PT0VMhgM1rK9ZRXub9yHBgcHf9FSVgsaCrCUJMYYGI1GoJRCwB+4sX379qqxsbFQwnhuj90OFhYWvnPnzp2rlFIwGo2g06X0Blr/IIUAx9RRTZiLEAIu/3i5R1GVhcnJyXjCeB5MPIgqihLv6+u7IoQAVVUhHo//g/IavyAdOOdACIH2tvY/Cnfs+Nzj8TQFAoFRxhjLzs62ud3ug319fQ8IIcD5yn7z1AQSUBQFzGaL/tKlS9+dPn26X5blyJkzZ97asGHDi5zzpRH+FwQ0J3MJhBDYsmXLmzk5OXnDw8MX4/G4Wlpa+p5erzcDwNdPUzxtNa1xSY6Xle3dKcuyarFY1q9duzZ3dnZ2uqKycm/C9Z7mzNQx5FxN14UQAgAARkauRqqqqqrtdvsziAg3b96cCwQCKgCklZ9zDoILdUUCVqs1R6/Xg6IomgcBLFq13+9X/X7/dHIsQVALRqORWK3W51ckcOvWrQGfz9cdjUbDjDEmhABCCCDi4g4IBAgQQhillAIAIGKcc/5E68mSCyF4RkbGmpFfR7rTMlzFKv63+BOhUKBf8MM3LQAAAABJRU5ErkJggg==" />
    <link rel="icon" type="image/png" sizes="16x16" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAB2klEQVR4nNWRP48SURTFz3sz88gEx2gMg8bKws4AuxRubCyIoaCxM0Ss+AJQ4Wa/gGQLdqGClgISEikIhckSEyxdAsNWSizExA3djsUszJ93LRaMK36BPdVN7rm/m5MD3HixzVAul1+ORqOJpmka55wREQDQxscYg5RSep7nJ5PJnVKp1L0GyGQy9znnrN/vn0sp//tNCIF0Ov0AAOv1ej8BQN0siQiRSOT2YDA4qFar74IgkKZp3gGAxWJxIYRQCoXCQb1eP7R/2cstejabfcQ5R61Wez2ejPvFYnEvGo1y0zT52/3955ZlfahUKq8458jlco83d3wzSCnJMAw2m82+dt93j2OJ2FPbvpCO41AiHn/W6XQO5/P5d8MwmPwr458ImqYptm1To9H4rOs6azabL8LhW1zXdR42wvdqtdrAdVd0ebmEpmnqFkDSFdTzPCyXSzo7m36KxWJ3hRDcGlsfbdsmRVHAGAOtK7oGYIxDURSEQiG4rovT09Gk3W6PASCfz++pqgohBFar1VWn/wJcd+UFQQDHcQAAJ4OTH0fHR2+ICMPh8Nz3ffi+v/a6/hZgd2c3oXCFA2BERK7r+lNr+gUAUqnUQyGEuv5M8Xj8SavV+rZV5c3Ub/GuzsO6WllAAAAAAElFTkSuQmCC" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="theme-color" content="#0f1419" />
    <style>
      /* Critical inline styles for CLS skeleton — renders before external CSS loads */
      @keyframes shimmer{0%{opacity:.5}50%{opacity:.8}100%{opacity:.5}}
      .sk{border-radius:4px;background:var(--border,#21262d);animation:shimmer 2s ease-in-out infinite}
      .sk-surface{background:var(--surface,#161b22);border:1px solid var(--border,#21262d);border-radius:8px}
    </style>

  </head>
  <body>
    <a href="#main-content" class="sr-only" style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden">Skip to main content</a>
    <div id="root">
      <noscript>
        <header role="banner"><nav aria-label="Main"><a href="/">Yoke</a></nav></header>
        <main id="main-content"><h1>Yoke — Domain Intelligence</h1><p>JavaScript is required to use Yoke. Please enable JavaScript in your browser settings.</p></main>
        <footer role="contentinfo"><p>&copy; 2026 Yoke</p><nav aria-label="Legal"><a href="/about">About</a> | <a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a></nav><nav aria-label="Yoke tools"><a href="https://certs.lol">certs</a> | <a href="https://ns.lol">ns</a> | <a href="https://xhttp.lol">xhttp</a> | <a href="https://vrfy.lol">vrfy</a></nav></footer>
      </noscript>
      <!-- CLS skeleton: matches full landing page layout to prevent layout shift when React mounts -->
      <div id="shell" aria-hidden="true" style="min-height:100vh;background:var(--bg,#0f1419);padding:24px 24px 48px">
        <div style="max-width:1440px;margin:0 auto">
          <!-- Nav bar -->
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;height:24px">
            <div class="sk" style="width:24px;height:24px"></div>
            <div class="sk" style="width:48px;height:18px"></div>
            <div style="width:1px;height:16px;background:var(--border,#21262d);margin:0 4px"></div>
            <div class="sk" style="width:120px;height:14px"></div>
          </div>
          <!-- Search bar -->
          <div class="sk-surface" style="height:46px"></div>
          <!-- Landing page content placeholder -->
          <div style="display:flex;flex-direction:column;align-items:center;padding:64px 0">
            <!-- Search icon -->
            <div class="sk-surface" style="width:64px;height:64px;border-radius:12px;margin-bottom:20px"></div>
            <!-- Heading -->
            <div class="sk" style="width:340px;max-width:80%;height:20px;margin-bottom:12px"></div>
            <!-- Description lines -->
            <div class="sk" style="width:420px;max-width:90%;height:14px;margin-bottom:8px"></div>
            <div class="sk" style="width:360px;max-width:75%;height:14px;margin-bottom:24px"></div>
            <!-- Feature grid: 2x2 -->
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;width:100%;max-width:700px;margin-bottom:24px">
              <div class="sk-surface" style="height:72px"></div>
              <div class="sk-surface" style="height:72px"></div>
              <div class="sk-surface" style="height:72px"></div>
              <div class="sk-surface" style="height:72px"></div>
            </div>
            <!-- API teaser -->
            <div class="sk" style="width:100px;height:12px;margin-bottom:10px"></div>
            <div class="sk-surface" style="width:100%;max-width:440px;height:40px"></div>
          </div>
        </div>
      </div>
    </div>
    <script>try{var t=localStorage.getItem("yoke-theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>
    <script type="module" src="/${jsPath}"></script>
  </body>
</html>`;

writeFileSync(join(outdir, "index.html"), html);

// Copy all public/ files to dist (favicons, manifest, icons, BIMI, fonts, _headers, etc.)
// This mirrors Vite's public directory behavior — everything in public/ is served as-is.
import { copyFileSync, cpSync } from "fs";

cpSync(join(import.meta.dir, "public"), outdir, { recursive: true, force: true });

// Copy logo.png for /logo.png route (used by social profiles, README badges)
const assetsDir = join(import.meta.dir, "..", "assets", "logo");
copyFileSync(join(assetsDir, "mark-transparent-512.png"), join(outdir, "logo.png"));

console.log("✓ Client build complete");
console.log(`  JS:   ${jsPath}`);
if (cssPath) console.log(`  CSS:  ${cssPath}`);
console.log(`  HTML: index.html`);
console.log(`  Assets: public/ files, logo.png`);
console.log(`  Output dir: ${outdir}`);
