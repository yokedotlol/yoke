import { logApiError } from "../api-errors";
import { fetchWithTimeout, getFromCache, normalizeDomain, setCache } from "../helpers";

type NewsArticle = { title: string; link: string; source: string | null; pub_date: string | null };
type HnStory = { title: string; url: string | null; points: number; num_comments: number; created_at: string };

function parseGoogleNewsRss(xml: string, maxItems = 15): NewsArticle[] {
  const results: NewsArticle[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;
  let count = 0;
  while ((itemMatch = itemRegex.exec(xml)) !== null && count < maxItems) {
    const itemXml = itemMatch[1] ?? "";
    const title =
      itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
      itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
      "";
    const link =
      itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() ??
      itemXml.match(/<link\s*\/>\s*(https?:\/\/[^\s<]+)/)?.[1]?.trim() ??
      itemXml.match(/<link\s*\/>([\s\S]*?)(?=<)/)?.[1]?.trim() ??
      "";
    const source = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? null;
    const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null;
    if (title && link) {
      results.push({ title: title.trim(), link: link.trim(), source, pub_date: pubDate });
      count++;
    }
  }
  return results;
}

async function fetchGoogleNews(query: string): Promise<NewsArticle[]> {
  try {
    const res = await fetchWithTimeout(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      {
        timeout: 8000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Yoke/1.0; +https://github.com/yokedotlol/yoke)" },
      },
    );
    if (res.ok) return parseGoogleNewsRss(await res.text());
  } catch {
    /* failed */
  }
  return [];
}

export async function getNews(kv: KVNamespace, rawDomain: string, statsDb?: D1Database) {
  const domain = normalizeDomain(rawDomain);
  const cached = await getFromCache(kv, domain, "news", 4 * 60 * 60 * 1000);
  if (cached) {
    const c = cached as { google_news: NewsArticle[]; hacker_news: HnStory[] };
    return { google_news: c.google_news, hacker_news: c.hacker_news, cached: true };
  }

  // Google News: try full domain first, then brand name fallback
  let googleNews = await fetchGoogleNews(domain);

  if (googleNews.length === 0) {
    // Fallback: try the brand name (SLD without TLD)
    const parts = domain.split(".");
    if (parts.length >= 2) {
      const brandName = parts.slice(0, -1).join(".");
      googleNews = await fetchGoogleNews(brandName);
    }
  }

  // If Google News still empty (CF Worker IPs often blocked), try Bing News RSS
  if (googleNews.length === 0) {
    try {
      const queries = [domain, domain.split(".").slice(0, -1).join(".")];
      for (const q of queries) {
        const res = await fetchWithTimeout(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`, {
          timeout: 8000,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Yoke/1.0; +https://github.com/yokedotlol/yoke)" },
        });
        if (res.ok) {
          const xml = await res.text();
          const items = parseGoogleNewsRss(xml, 15); // Same XML format works for RSS
          if (items.length > 0) {
            googleNews = items;
            break;
          }
        } else if (statsDb) {
          logApiError(statsDb, { api: "bing-news", status: res.status, message: "Bing News RSS failed", domain });
        }
      }
    } catch (e) {
      if (statsDb) logApiError(statsDb, { api: "bing-news", status: 0, message: String(e).slice(0, 200), domain });
    }
  }

  // HackerNews Algolia
  const hackerNews: HnStory[] = [];
  try {
    const res = await fetchWithTimeout(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(domain)}&tags=story&hitsPerPage=15`,
      { timeout: 8000 },
    );
    if (res.ok) {
      const data = (await res.json()) as { hits?: HnStory[] };
      if (data.hits) {
        for (const hit of data.hits) {
          hackerNews.push({
            title: hit.title,
            url: hit.url ?? null,
            points: hit.points ?? 0,
            num_comments: hit.num_comments ?? 0,
            created_at: hit.created_at,
          });
        }
      }
    } else if (statsDb) {
      logApiError(statsDb, { api: "hackernews", status: res.status, message: "HN Algolia search failed", domain });
    }
  } catch (e) {
    if (statsDb) logApiError(statsDb, { api: "hackernews", status: 0, message: String(e).slice(0, 200), domain });
  }

  const result = { google_news: googleNews, hacker_news: hackerNews };
  await setCache(kv, domain, "news", result, 60 * 60 * 1000);
  return { ...result, cached: false };
}
