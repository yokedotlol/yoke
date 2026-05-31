// ─── Lightweight API Error Tracking ──────────────────────────────────
// Logs external API failures to D1 for observability.
// Table auto-creates on first write. Pruned probabilistically.

export interface ApiError {
  api: string; // e.g. "hibp", "fly-probe", "hackertarget", "pagespeed"
  status: number; // HTTP status or 0 for network/timeout errors
  message: string; // Brief error description
  domain?: string; // Domain being analyzed when error occurred
}

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS api_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api TEXT NOT NULL,
  status INTEGER NOT NULL,
  message TEXT NOT NULL,
  domain TEXT,
  ts INTEGER NOT NULL
)`;

const INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_api_errors_ts ON api_errors(ts)`;
const INDEX_API_SQL = `CREATE INDEX IF NOT EXISTS idx_api_errors_api_ts ON api_errors(api, ts)`;

let tableEnsured = false;

async function ensureTable(db: D1Database): Promise<void> {
  if (tableEnsured) return;
  try {
    await db.prepare(TABLE_SQL).run();
    await db.prepare(INDEX_SQL).run();
    await db.prepare(INDEX_API_SQL).run();
    tableEnsured = true;
  } catch {
    /* first-write failure is non-critical */
  }
}

export async function logApiError(db: D1Database, err: ApiError): Promise<void> {
  try {
    await ensureTable(db);
    await db
      .prepare("INSERT INTO api_errors (api, status, message, domain, ts) VALUES (?, ?, ?, ?, ?)")
      .bind(err.api, err.status, err.message.slice(0, 200), err.domain ?? null, Date.now())
      .run();
  } catch {
    /* non-critical — don't break analysis over logging */
  }
}

// ─── Health summary for /api/health ──────────────────────────────────

export async function getApiHealth(db: D1Database): Promise<{
  last_24h: { api: string; errors: number; last_status: number; last_message: string; last_ts: number }[];
  last_7d_summary: { api: string; errors: number }[];
}> {
  try {
    await ensureTable(db);
    const now = Date.now();
    const day = now - 24 * 60 * 60 * 1000;
    const week = now - 7 * 24 * 60 * 60 * 1000;

    const recent = await db
      .prepare(`
      SELECT api, COUNT(*) as errors,
        (SELECT status FROM api_errors e2 WHERE e2.api = api_errors.api AND e2.ts >= ? ORDER BY ts DESC LIMIT 1) as last_status,
        (SELECT message FROM api_errors e3 WHERE e3.api = api_errors.api AND e3.ts >= ? ORDER BY ts DESC LIMIT 1) as last_message,
        MAX(ts) as last_ts
      FROM api_errors WHERE ts >= ? GROUP BY api ORDER BY errors DESC
    `)
      .bind(day, day, day)
      .all<{ api: string; errors: number; last_status: number; last_message: string; last_ts: number }>();

    const weekly = await db
      .prepare(`
      SELECT api, COUNT(*) as errors FROM api_errors WHERE ts >= ? GROUP BY api ORDER BY errors DESC
    `)
      .bind(week)
      .all<{ api: string; errors: number }>();

    return {
      last_24h: recent.results ?? [],
      last_7d_summary: weekly.results ?? [],
    };
  } catch {
    return { last_24h: [], last_7d_summary: [] };
  }
}

// ─── Hourly buckets for status page ──────────────────────────────────

export interface HourlyBucket {
  hour: string; // ISO hour label e.g. "2026-05-24T14:00"
  ts: number; // epoch ms start of hour
  errors: number;
}

export interface ApiStatusRow {
  api: string;
  label: string;
  url: string;
  errors_24h: number;
  errors_7d: number;
  last_error_ts: number | null;
  last_error_message: string | null;
  last_error_status: number | null;
  hourly: HourlyBucket[];
}

// Full registry of external APIs Yoke depends on
const API_REGISTRY: { api: string; label: string; url: string }[] = [
  { api: "pagespeed", label: "Google PageSpeed", url: "googleapis.com/pagespeedonline" },
  { api: "hibp", label: "Have I Been Pwned", url: "haveibeenpwned.com" },
  { api: "hackertarget", label: "HackerTarget", url: "api.hackertarget.com" },
  { api: "ssl", label: "SSL (fallback)", url: "direct TLS connect" },
  { api: "shodan", label: "Shodan InternetDB", url: "internetdb.shodan.io" },
  { api: "greynoise", label: "GreyNoise", url: "api.greynoise.io" },
  { api: "wayback", label: "Wayback Machine", url: "archive.org" },
  { api: "tranco", label: "Tranco Ranking", url: "tranco-list.eu" },
  { api: "rdap", label: "WHOIS / RDAP", url: "various registries" },
  { api: "carbon", label: "Website Carbon", url: "api.websitecarbon.com" },
  { api: "crt", label: "Certificate Transparency", url: "crt.sh" },
  { api: "dns", label: "Google DNS", url: "dns.google" },
  { api: "dnssec", label: "DNSSEC", url: "dns.google" },
  { api: "emailauth", label: "Email Auth (SPF/DKIM/DMARC)", url: "dns.google" },
  { api: "blocklists", label: "DNS Blocklists", url: "various DNSBL" },
  { api: "greenhosting", label: "Green Web Foundation", url: "api.thegreenwebfoundation.org" },
  { api: "ipinfo", label: "IP Geolocation", url: "dns.google" },
  { api: "dns_propagation", label: "DNS Propagation", url: "multiple DoH resolvers" },
  { api: "ripe_routing", label: "RIPE RIS Routing", url: "stat.ripe.net" },
  { api: "outage_links", label: "Outage Pages", url: "downdetector.com / isitdownrightnow.com" },
  { api: "connection_timing", label: "Connection Timing", url: "Fly probe /probe-timing" },
];

export async function getStatusPageData(db: D1Database): Promise<{ apis: ApiStatusRow[]; generated_at: string }> {
  await ensureTable(db);
  const now = Date.now();
  const day = now - 24 * 60 * 60 * 1000;
  const week = now - 7 * 24 * 60 * 60 * 1000;

  // Get all errors from last 7 days in one query
  const allErrors = await db
    .prepare("SELECT api, status, message, ts FROM api_errors WHERE ts >= ? ORDER BY ts DESC")
    .bind(week)
    .all<{ api: string; status: number; message: string; ts: number }>();

  const errors = allErrors.results ?? [];

  // Build hourly buckets for the last 24 hours
  const hourStart = (ts: number) => ts - (ts % (60 * 60 * 1000));
  const hours: number[] = [];
  for (let h = hourStart(now) - 23 * 60 * 60 * 1000; h <= hourStart(now); h += 60 * 60 * 1000) {
    hours.push(h);
  }

  // Group errors by API
  const byApi = new Map<string, typeof errors>();
  for (const e of errors) {
    const arr = byApi.get(e.api) ?? [];
    arr.push(e);
    byApi.set(e.api, arr);
  }

  const apis: ApiStatusRow[] = API_REGISTRY.map(({ api, label, url }) => {
    const apiErrors = byApi.get(api) ?? [];
    const errors24h = apiErrors.filter((e) => e.ts >= day);
    const lastError = apiErrors[0] ?? null; // already sorted DESC

    const hourly: HourlyBucket[] = hours.map((h) => {
      const hEnd = h + 60 * 60 * 1000;
      const count = errors24h.filter((e) => e.ts >= h && e.ts < hEnd).length;
      const d = new Date(h);
      return {
        hour: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:00`,
        ts: h,
        errors: count,
      };
    });

    return {
      api,
      label,
      url,
      errors_24h: errors24h.length,
      errors_7d: apiErrors.length,
      last_error_ts: lastError?.ts ?? null,
      last_error_message: lastError?.message ?? null,
      last_error_status: lastError?.status ?? null,
      hourly,
    };
  });

  return { apis, generated_at: new Date().toISOString() };
}

// ─── Prune old rows ──────────────────────────────────────────────────

export async function pruneApiErrors(db: D1Database): Promise<void> {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await db.prepare("DELETE FROM api_errors WHERE ts < ?").bind(cutoff).run();
  } catch {
    /* non-critical */
  }
}
