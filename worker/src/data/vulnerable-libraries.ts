// ─── Vulnerable Client-Side JavaScript Libraries ─────────────────────
// Curated vulnerability map for detecting outdated/vulnerable JS libraries
// in page HTML. Covers >95% of commonly-deployed vulnerable libraries.
//
// Detection: CDN URL patterns (cdnjs, jsdelivr, unpkg, googleapis, etc.)
// and inline version strings/comments.

export interface VulnerableLibrary {
  name: string;
  /** Regex patterns to match CDN URLs or inline version comments.
   *  Each pattern MUST have a capture group for the version string. */
  patterns: RegExp[];
  /** Versions below this are considered vulnerable (semver). null = all versions. */
  vulnerableBelow: string | null;
  /** Key CVEs or advisories */
  cves: string[];
  /** Severity if a vulnerable version is found */
  severity: "critical" | "high" | "medium";
  /** Library is end-of-life / abandoned — any version is a concern */
  eol?: boolean;
}

/**
 * Compare two semver-ish version strings: returns true if `version` < `threshold`.
 * Handles 2-part (1.6) and 3-part (3.5.1) versions. Non-numeric parts are ignored.
 */
export function isVersionBelow(version: string, threshold: string): boolean {
  const parse = (v: string) => v.split(".").map((p) => parseInt(p, 10) || 0);
  const a = parse(version);
  const b = parse(threshold);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false; // equal
}

// ─── Library Definitions ─────────────────────────────────────────────

export const VULNERABLE_LIBRARIES: VulnerableLibrary[] = [
  // ── jQuery ──────────────────────────────────────────────────────
  {
    name: "jQuery",
    patterns: [
      /jquery[.-](\d+\.\d+\.\d+)/i,
      /jquery\/(\d+\.\d+\.\d+)\//i,
      /jquery\.min\.js.*?v(\d+\.\d+\.\d+)/i,
      /\/ajax\/libs\/jquery\/(\d+\.\d+\.\d+)\//i,
    ],
    vulnerableBelow: "3.5.0",
    cves: ["CVE-2020-11022", "CVE-2020-11023"],
    severity: "medium",
  },

  // ── Angular 1.x ────────────────────────────────────────────────
  {
    name: "AngularJS (1.x)",
    patterns: [
      /angular[.-](\d+\.\d+\.\d+)/i,
      /angular\.js\/(\d+\.\d+\.\d+)\//i,
      /angularjs\/(\d+\.\d+\.\d+)\//i,
      /\/angular(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.0.0", // All 1.x is EOL
    cves: ["CVE-2022-25869", "CVE-2020-7676"],
    severity: "medium",
    eol: true,
  },

  // ── lodash ─────────────────────────────────────────────────────
  {
    name: "lodash",
    patterns: [/lodash[.-](\d+\.\d+\.\d+)/i, /lodash\/(\d+\.\d+\.\d+)\//i, /lodash(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "4.17.21",
    cves: ["CVE-2021-23337", "CVE-2020-28500"],
    severity: "medium",
  },

  // ── moment.js ──────────────────────────────────────────────────
  {
    name: "moment.js",
    patterns: [/moment[.-](\d+\.\d+\.\d+)/i, /moment\/(\d+\.\d+\.\d+)\//i, /moment(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: null, // all versions — deprecated
    cves: ["CVE-2022-31129"],
    severity: "medium",
    eol: true,
  },

  // ── Bootstrap JS ───────────────────────────────────────────────
  {
    name: "Bootstrap",
    patterns: [
      /bootstrap[.-](\d+\.\d+\.\d+)/i,
      /bootstrap\/(\d+\.\d+\.\d+)\//i,
      /bootstrap(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
      /bootstrap(?:\.bundle)?(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "4.3.1",
    cves: ["CVE-2019-8331", "CVE-2018-14042"],
    severity: "medium",
  },

  // ── React ──────────────────────────────────────────────────────
  {
    name: "React",
    patterns: [
      /react[.-](\d+\.\d+\.\d+)/i,
      /react\/(\d+\.\d+\.\d+)\//i,
      /react(?:\.production|\.development)?(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
      /react-dom[.-](\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "16.14.0",
    cves: ["CVE-2020-15265"],
    severity: "medium",
  },

  // ── Vue.js ─────────────────────────────────────────────────────
  {
    name: "Vue.js",
    patterns: [
      /vue[.-](\d+\.\d+\.\d+)/i,
      /vue\/(\d+\.\d+\.\d+)\//i,
      /vue(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
      /vue(?:\.runtime)?(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.6.12",
    cves: ["CVE-2020-7643"],
    severity: "medium",
  },

  // ── Backbone.js ────────────────────────────────────────────────
  {
    name: "Backbone.js",
    patterns: [
      /backbone[.-](\d+\.\d+\.\d+)/i,
      /backbone\/(\d+\.\d+\.\d+)\//i,
      /backbone(?:-min|\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "1.3.3",
    cves: [],
    severity: "medium",
  },

  // ── Handlebars ─────────────────────────────────────────────────
  {
    name: "Handlebars",
    patterns: [
      /handlebars[.-](\d+\.\d+\.\d+)/i,
      /handlebars\/(\d+\.\d+\.\d+)\//i,
      /handlebars(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "4.7.7",
    cves: ["CVE-2021-23369", "CVE-2019-19919"],
    severity: "high",
  },

  // ── DOMPurify ──────────────────────────────────────────────────
  {
    name: "DOMPurify",
    patterns: [
      /purify[.-](\d+\.\d+\.\d+)/i,
      /dompurify\/(\d+\.\d+\.\d+)\//i,
      /dompurify(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.3.0",
    cves: ["CVE-2021-23558"],
    severity: "high",
  },

  // ── Underscore.js ──────────────────────────────────────────────
  {
    name: "Underscore.js",
    patterns: [
      /underscore[.-](\d+\.\d+\.\d+)/i,
      /underscore\/(\d+\.\d+\.\d+)\//i,
      /underscore(?:-min|\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "1.13.1",
    cves: ["CVE-2021-23358"],
    severity: "high",
  },

  // ── Socket.io ──────────────────────────────────────────────────
  {
    name: "Socket.io",
    patterns: [
      /socket\.io[.-](\d+\.\d+\.\d+)/i,
      /socket\.io\/(\d+\.\d+\.\d+)\//i,
      /socket\.io(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.4.0",
    cves: ["CVE-2020-36049"],
    severity: "medium",
  },

  // ── highlight.js ───────────────────────────────────────────────
  {
    name: "highlight.js",
    patterns: [
      /highlight[.-](\d+\.\d+\.\d+)/i,
      /highlight\.js\/(\d+\.\d+\.\d+)\//i,
      /highlight(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "10.4.1",
    cves: ["CVE-2020-26237"],
    severity: "medium",
  },

  // ── Chart.js ───────────────────────────────────────────────────
  {
    name: "Chart.js",
    patterns: [/chart[.-](\d+\.\d+\.\d+)/i, /chart\.js\/(\d+\.\d+\.\d+)\//i, /Chart(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "3.0.0",
    cves: [],
    severity: "medium",
  },

  // ── TinyMCE ────────────────────────────────────────────────────
  {
    name: "TinyMCE",
    patterns: [
      /tinymce[.-](\d+\.\d+\.\d+)/i,
      /tinymce\/(\d+\.\d+\.\d+)\//i,
      /tinymce(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "5.6.0",
    cves: ["CVE-2020-17480", "CVE-2021-26740"],
    severity: "medium",
  },

  // ── CKEditor 4 ─────────────────────────────────────────────────
  {
    name: "CKEditor 4",
    patterns: [
      /ckeditor[.-](\d+\.\d+\.\d+)/i,
      /ckeditor\/(\d+\.\d+\.\d+)\//i,
      /ckeditor(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "4.16.0",
    cves: ["CVE-2021-26272", "CVE-2021-32808"],
    severity: "medium",
  },

  // ── D3.js ──────────────────────────────────────────────────────
  {
    name: "D3.js",
    patterns: [/d3[.-](\d+\.\d+\.\d+)/i, /d3\/(\d+\.\d+\.\d+)\//i, /d3(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "6.0.0",
    cves: [],
    severity: "medium",
  },

  // ── Ember.js ───────────────────────────────────────────────────
  {
    name: "Ember.js",
    patterns: [/ember[.-](\d+\.\d+\.\d+)/i, /ember\.js\/(\d+\.\d+\.\d+)\//i, /ember(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "3.24.0",
    cves: ["CVE-2021-4127"],
    severity: "medium",
  },

  // ── Knockout ───────────────────────────────────────────────────
  {
    name: "Knockout",
    patterns: [
      /knockout[.-](\d+\.\d+\.\d+)/i,
      /knockout\/(\d+\.\d+\.\d+)\//i,
      /knockout(?:-min|\.min)?\.js.*?v(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "3.5.0",
    cves: [],
    severity: "medium",
  },

  // ── Dojo ───────────────────────────────────────────────────────
  {
    name: "Dojo",
    patterns: [/dojo[.-](\d+\.\d+\.\d+)/i, /dojo\/(\d+\.\d+\.\d+)\//i, /dojo(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "1.16.0",
    cves: ["CVE-2020-5258", "CVE-2020-5259"],
    severity: "medium",
  },

  // ── RequireJS ──────────────────────────────────────────────────
  {
    name: "RequireJS",
    patterns: [
      /require[.-](\d+\.\d+\.\d+)/i,
      /requirejs\/(\d+\.\d+\.\d+)\//i,
      /require(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.3.6",
    cves: [],
    severity: "medium",
  },

  // ── Polymer 1.x ────────────────────────────────────────────────
  {
    name: "Polymer",
    patterns: [
      /polymer[.-](\d+\.\d+\.\d+)/i,
      /polymer\/(\d+\.\d+\.\d+)\//i,
      /polymer(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.0.0",
    cves: [],
    severity: "medium",
    eol: true,
  },

  // ── Axios ──────────────────────────────────────────────────────
  {
    name: "Axios",
    patterns: [/axios[.-](\d+\.\d+\.\d+)/i, /axios\/(\d+\.\d+\.\d+)\//i, /axios(?:\.min)?\.js.*?v(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "0.21.1",
    cves: ["CVE-2020-28168"],
    severity: "medium",
  },

  // ── EOL / Abandoned Libraries (any version) ────────────────────

  {
    name: "YUI",
    patterns: [/yui[.-](\d+\.\d+\.\d+)/i, /yui\/(\d+\.\d+\.\d+)\//i, /yui(?:-min|\.min)?\.js.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: null,
    cves: [],
    severity: "medium",
    eol: true,
  },

  {
    name: "Prototype.js",
    patterns: [
      /prototype[.-](\d+\.\d+\.\d+)/i,
      /prototype\/(\d+\.\d+\.\d+)\//i,
      /Prototype JavaScript.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: null,
    cves: [],
    severity: "medium",
    eol: true,
  },

  {
    name: "MooTools",
    patterns: [/mootools[.-](\d+\.\d+\.\d+)/i, /mootools\/(\d+\.\d+\.\d+)\//i, /MooTools.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: null,
    cves: [],
    severity: "medium",
    eol: true,
  },

  // ── Ext JS ─────────────────────────────────────────────────────
  {
    name: "Ext JS",
    patterns: [
      /ext-all[.-](\d+\.\d+\.\d+)/i,
      /extjs\/(\d+\.\d+\.\d+)\//i,
      /Ext JS.*?(\d+\.\d+\.\d+)/i,
      /ext-all(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "7.0.0",
    cves: [],
    severity: "medium",
  },

  // ── jQuery UI ──────────────────────────────────────────────────
  {
    name: "jQuery UI",
    patterns: [
      /jquery-ui[.-](\d+\.\d+\.\d+)/i,
      /jquery\.ui[.-](\d+\.\d+\.\d+)/i,
      /jquery-ui\/(\d+\.\d+\.\d+)\//i,
      /jqueryui\/(\d+\.\d+\.\d+)\//i,
    ],
    vulnerableBelow: "1.13.2",
    cves: ["CVE-2021-41182", "CVE-2021-41183", "CVE-2021-41184", "CVE-2022-31160"],
    severity: "medium",
  },

  // ── Highcharts ─────────────────────────────────────────────────
  {
    name: "Highcharts",
    patterns: [/highcharts[.-](\d+\.\d+\.\d+)/i, /highcharts\/(\d+\.\d+\.\d+)\//i, /Highcharts.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "9.0.0",
    cves: ["CVE-2021-29489", "CVE-2018-20801"],
    severity: "high",
  },

  // ── Froala Editor ──────────────────────────────────────────────
  {
    name: "Froala Editor",
    patterns: [
      /froala-editor[/@](\d+\.\d+\.\d+)/i,
      /froala\/(\d+\.\d+\.\d+)\//i,
      /froala-editor(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "4.3.1",
    cves: ["CVE-2021-28114", "CVE-2024-51434", "CVE-2023-41592"],
    severity: "high",
  },

  // ── Mustache.js ────────────────────────────────────────────────
  {
    name: "Mustache.js",
    patterns: [
      /mustache[.-](\d+\.\d+\.\d+)/i,
      /mustache\/(\d+\.\d+\.\d+)\//i,
      /mustache(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "2.2.1",
    cves: ["CVE-2015-8862"],
    severity: "high",
  },

  // ── Marked ─────────────────────────────────────────────────────
  {
    name: "Marked",
    patterns: [/marked[/@](\d+\.\d+\.\d+)/i, /marked[.-](\d+\.\d+\.\d+)/i, /marked(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i],
    vulnerableBelow: "4.0.10",
    cves: ["CVE-2022-21681", "CVE-2022-21680"],
    severity: "high",
  },

  // ── Swiper ─────────────────────────────────────────────────────
  {
    name: "Swiper",
    patterns: [
      /swiper[/@](\d+\.\d+\.\d+)/i,
      /swiper[.-](\d+\.\d+\.\d+)/i,
      /swiper(?:-bundle)?(?:\.min)?\.js.*?(\d+\.\d+\.\d+)/i,
    ],
    vulnerableBelow: "11.2.1",
    cves: [],
    severity: "critical",
  },
];

// ─── Scanner ─────────────────────────────────────────────────────────

export interface VulnScanResult {
  library: string;
  version: string;
  cves: string[];
  severity: "critical" | "high" | "medium";
  eol: boolean;
}

/**
 * Scan HTML source for vulnerable JavaScript libraries.
 * Extracts <script src="..."> URLs and scans for version patterns.
 * Also scans first 50KB of inline content for version comments.
 */
export function scanForVulnerableLibraries(html: string): VulnScanResult[] {
  const results: VulnScanResult[] = [];
  const seen = new Set<string>();

  // Extract all script src URLs
  const scriptSrcPattern = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  const scriptSrcs: string[] = [];
  let srcMatch: RegExpExecArray | null;
  while ((srcMatch = scriptSrcPattern.exec(html)) !== null) {
    scriptSrcs.push(srcMatch[1]);
  }

  // Also scan inline content (version comments, etc.) — cap at 100KB
  const inlineContent = html.slice(0, 100_000);

  for (const lib of VULNERABLE_LIBRARIES) {
    for (const pattern of lib.patterns) {
      // Check script src URLs
      for (const src of scriptSrcs) {
        const match = pattern.exec(src);
        pattern.lastIndex = 0; // reset stateful regex
        if (match?.[1]) {
          const version = match[1];
          const key = `${lib.name}:${version}`;
          if (seen.has(key)) continue;

          const isVuln = lib.eol
            ? true // all versions of EOL libraries
            : lib.vulnerableBelow
              ? isVersionBelow(version, lib.vulnerableBelow)
              : true; // null threshold = all versions

          if (isVuln) {
            seen.add(key);
            results.push({
              library: lib.name,
              version,
              cves: lib.cves,
              severity: lib.severity,
              eol: !!lib.eol,
            });
          }
          break; // found this lib, move on
        }
      }

      // Check inline content (version comments like /* jQuery v3.4.1 */)
      if (!seen.has(`${lib.name}:`)) {
        const inlineMatch = pattern.exec(inlineContent);
        pattern.lastIndex = 0;
        if (inlineMatch?.[1]) {
          const version = inlineMatch[1];
          const key = `${lib.name}:${version}`;
          if (seen.has(key)) continue;

          const isVuln = lib.eol ? true : lib.vulnerableBelow ? isVersionBelow(version, lib.vulnerableBelow) : true;

          if (isVuln) {
            seen.add(key);
            results.push({
              library: lib.name,
              version,
              cves: lib.cves,
              severity: lib.severity,
              eol: !!lib.eol,
            });
          }
        }
      }
    }
  }

  return results;
}
