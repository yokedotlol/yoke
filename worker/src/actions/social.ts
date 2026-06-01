import type { Env } from "../helpers";
import {
  boundedText,
  fetchWithTimeout,
  getFromCache,
  normalizeDomain,
  safeFetchWithRedirects,
  setCache,
} from "../helpers";

export async function getSocialAccounts(kv: KVNamespace, rawDomain: string, env?: Env, skipCache = false) {
  const domain = normalizeDomain(rawDomain);
  if (!skipCache) {
    const cached = await getFromCache(kv, domain, "social_accounts", 24 * 60 * 60 * 1000);
    if (cached) {
      const c = cached as {
        accounts: Array<{ platform: string; url: string; username: string | null; found_via: string }>;
      };
      return { accounts: c.accounts, cached: true };
    }
  }

  const accounts: Array<{ platform: string; url: string; username: string | null; found_via: string }> = [];

  // Normalized URL set for dedup — strip protocol, www, trailing slash, query, fragment
  const seenNormalized = new Set<string>();
  // Per-platform cap to avoid flooding
  const platformCount: Record<string, number> = {};
  const MAX_PER_PLATFORM = 3;

  // Trust hierarchy: rel-me > homepage > probe
  const TRUST_RANK: Record<string, number> = { "rel-me": 3, homepage: 2, probe: 1 };

  function normalizeUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .replace(/[?#].*$/, "");
  }

  function addAccount(platform: string, url: string, username: string | null, foundVia: string): boolean {
    const normalized = normalizeUrl(url);
    // If we already have this exact URL, upgrade found_via if new source is higher trust
    const existing = accounts.find((a) => normalizeUrl(a.url) === normalized);
    if (existing) {
      if ((TRUST_RANK[foundVia] ?? 0) > (TRUST_RANK[existing.found_via] ?? 0)) {
        existing.found_via = foundVia;
      }
      return false;
    }
    if ((platformCount[platform] ?? 0) >= MAX_PER_PLATFORM) return false;
    if (
      !username ||
      [
        "share",
        "sharer",
        "intent",
        "dialog",
        "login",
        "signup",
        "hashtag",
        "search",
        "explore",
        "about",
        "help",
        "p",
        "watch",
        "status",
        "i",
        "reel",
        "stories",
        "reels",
      ].includes(username.toLowerCase())
    )
      return false;
    seenNormalized.add(normalized);
    platformCount[platform] = (platformCount[platform] ?? 0) + 1;
    accounts.push({ platform, url, username, found_via: foundVia });
    return true;
  }

  // Platform patterns — each regex captures the username as group 1 from the FULL URL
  const platformPatterns: Array<{ platform: string; pattern: RegExp; selfDomain?: string }> = [
    {
      platform: "Twitter/X",
      pattern: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:[/?#]|$)/gi,
      selfDomain: "x.com",
    },
    {
      platform: "GitHub",
      pattern: /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/gi,
      selfDomain: "github.com",
    },
    {
      platform: "LinkedIn",
      pattern: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/gi,
      selfDomain: "linkedin.com",
    },
    {
      platform: "Facebook",
      pattern: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)(?:[/?#]|$)/gi,
      selfDomain: "facebook.com",
    },
    {
      platform: "Instagram",
      pattern: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)(?:[/?#]|$)/gi,
      selfDomain: "instagram.com",
    },
    {
      platform: "YouTube",
      pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)([a-zA-Z0-9_@-]+)(?:[/?#]|$)/gi,
      selfDomain: "youtube.com",
    },
    {
      platform: "TikTok",
      pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)(?:[/?#]|$)/gi,
      selfDomain: "tiktok.com",
    },
    {
      platform: "Threads",
      pattern: /https?:\/\/(?:www\.)?threads\.net\/@([a-zA-Z0-9._]+)(?:[/?#]|$)/gi,
      selfDomain: "threads.net",
    },
    {
      platform: "Bluesky",
      pattern: /https?:\/\/bsky\.app\/profile\/([a-zA-Z0-9._-]+)(?:[/?#]|$)/gi,
      selfDomain: "bsky.app",
    },
    { platform: "Mastodon", pattern: /https?:\/\/[a-zA-Z0-9.-]+\/@([a-zA-Z0-9_]+)(?:[/?#]|$)/gi },
    {
      platform: "Pinterest",
      pattern: /https?:\/\/(?:www\.)?pinterest\.com\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/gi,
      selfDomain: "pinterest.com",
    },
    {
      platform: "Discord",
      pattern: /https?:\/\/(?:www\.)?discord\.(?:gg|com\/invite)\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/gi,
      selfDomain: "discord.com",
    },
    {
      platform: "Reddit",
      pattern: /https?:\/\/(?:www\.)?reddit\.com\/(?:r|u|user)\/([a-zA-Z0-9_-]+)(?:[/?#]|$)/gi,
      selfDomain: "reddit.com",
    },
    {
      platform: "GitLab",
      pattern: /https?:\/\/(?:www\.)?gitlab\.com\/([a-zA-Z0-9_.-]+)(?:[/?#]|$)/gi,
      selfDomain: "gitlab.com",
    },
    {
      platform: "Substack",
      pattern: /https?:\/\/([a-zA-Z0-9_-]+)\.substack\.com(?:[/?#]|$)/gi,
      selfDomain: "substack.com",
    },
  ];

  // Determine the base domain being analyzed (to skip self-referencing links)
  const baseDomain = domain.replace(/^www\./, "").toLowerCase();

  function matchHrefToPlatform(href: string, foundVia: string): void {
    for (const pp of platformPatterns) {
      // Skip self-referencing links (e.g., github.com linking to github.com/*)
      if (pp.selfDomain && baseDomain.includes(pp.selfDomain.replace(/^www\./, ""))) continue;
      pp.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pp.pattern.exec(href)) !== null) {
        const username = m[1] ?? null;
        const cleanUrl = href.split("?")[0]?.replace(/\/+$/, "") ?? href;
        addAccount(pp.platform, cleanUrl, username, foundVia);
      }
    }
  }

  // Strategy 1: Parse homepage HTML for social links
  try {
    let html: string | null = null;

    // Self-analysis: use ASSETS binding to read our own index.html (CF Workers can't fetch themselves)
    const instanceHost = env?.BASE_URL
      ? (() => {
          try {
            return new URL(env.BASE_URL).hostname;
          } catch {
            return null;
          }
        })()
      : null;
    const selfDomains = instanceHost ? [instanceHost, `www.${instanceHost}`] : [];
    if (env?.ASSETS && selfDomains.includes(baseDomain)) {
      try {
        const assetResp = await env.ASSETS.fetch(new Request(`${env.BASE_URL}/index.html`));
        if (assetResp.ok) html = await assetResp.text();
      } catch {
        /* ASSETS fetch failed, fall through */
      }
    }

    // Normal fetch for external domains (or fallback if ASSETS failed)
    if (!html) {
      const res = await safeFetchWithRedirects(`https://${domain}`, {
        timeout: 8000,
        headers: {
          "User-Agent": "YokeBot/1.0 (+https://yoke.lol)",
        },
      });
      if (res.ok) {
        html = await boundedText(res);
      }
    }

    if (html) {
      // Strategy 1a: Extract rel="me" links first (highest trust — site claims ownership)
      // Matches both <link rel="me" href="..."> and <a rel="me" href="...">
      const relMeRegex =
        /<(?:link|a)\s[^>]*rel=["']me["'][^>]*href=["']([^"']+)["'][^>]*>|<(?:link|a)\s[^>]*href=["']([^"']+)["'][^>]*rel=["']me["'][^>]*>/gi;
      let relMeMatch: RegExpExecArray | null;
      while ((relMeMatch = relMeRegex.exec(html)) !== null) {
        const href = relMeMatch[1] || relMeMatch[2] || "";
        if (href) matchHrefToPlatform(href, "rel-me");
      }

      // Strategy 1b: Extract all other hrefs (medium trust — linked from site)
      const hrefRegex = /href=["']([^"']+)["']/gi;
      let hrefMatch: RegExpExecArray | null;
      while ((hrefMatch = hrefRegex.exec(html)) !== null) {
        const href = hrefMatch[1] ?? "";
        matchHrefToPlatform(href, "homepage");
      }
    }
  } catch {
    /* homepage fetch failed */
  }

  // Strategy 2: Probe common URL patterns (only if few found via HTML)
  if (accounts.length < 3) {
    const baseName = domain.split(".")[0] ?? domain;
    // Skip probing for generic/word-like domain names that produce false positives
    // (e.g., "security.com" → finds unrelated @security on every platform)
    const SKIP_PROBE_NAMES = new Set([
      "www",
      "mail",
      "ftp",
      "blog",
      "shop",
      "store",
      "app",
      "api",
      "web",
      "security",
      "support",
      "help",
      "news",
      "info",
      "data",
      "cloud",
      "login",
      "admin",
      "test",
      "dev",
      "staging",
      "demo",
      "status",
      "media",
      "video",
      "music",
      "photo",
      "images",
      "files",
      "docs",
      "home",
      "about",
      "contact",
      "search",
      "tools",
      "health",
      "money",
      "travel",
      "food",
      "tech",
      "code",
      "design",
      "art",
      "game",
      "play",
    ]);
    const shouldProbe = baseName.length >= 3 && !SKIP_PROBE_NAMES.has(baseName.toLowerCase());

    if (shouldProbe) {
      const probeUrls: Array<{ platform: string; url: string; username: string }> = [
        { platform: "Twitter/X", url: `https://x.com/${baseName}`, username: baseName },
        { platform: "GitHub", url: `https://github.com/${baseName}`, username: baseName },
        { platform: "LinkedIn", url: `https://www.linkedin.com/company/${baseName}`, username: baseName },
        { platform: "Facebook", url: `https://www.facebook.com/${baseName}`, username: baseName },
        { platform: "Instagram", url: `https://www.instagram.com/${baseName}`, username: baseName },
        { platform: "GitLab", url: `https://gitlab.com/${baseName}`, username: baseName },
      ];

      const probes = probeUrls
        .filter((p) => !accounts.some((a) => a.platform === p.platform))
        .map(async (probe) => {
          try {
            const res = await fetchWithTimeout(probe.url, {
              timeout: 5000,
              method: "HEAD",
              redirect: "follow",
              headers: { "User-Agent": "YokeBot/1.0 (+https://yoke.lol)" },
            });
            if (res.ok || res.status === 200) {
              addAccount(probe.platform, probe.url, probe.username, "probe");
            }
          } catch {
            /* probe failed */
          }
        });
      await Promise.allSettled(probes);
    }
  }

  // Sort: rel-me first, then homepage, then probe
  accounts.sort((a, b) => (TRUST_RANK[b.found_via] ?? 0) - (TRUST_RANK[a.found_via] ?? 0));

  const result = { accounts };
  await setCache(kv, domain, "social_accounts", result, 24 * 60 * 60 * 1000);
  return { ...result, cached: false };
}
