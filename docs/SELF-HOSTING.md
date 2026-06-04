# Self-Hosting Yoke

Yoke runs on Cloudflare Workers Paid ($5/mo). This guide covers deploying your own instance.

## Running Costs

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Cloudflare Workers Paid | ~$5 | 10M requests, 1M KV reads, 25M D1 rows |
| Fly.io proxy (optional) | ~$6 | HTTP probes + MaxMind GeoIP |
| All external APIs | $0 | PageSpeed, WHOIS, Shodan, etc. — free tiers |
| **Total** | **~$5–11/mo** | |

> **Why not the free tier?** The free plan caps CPU time at 10ms/request. A single analysis runs ~30 external API calls, scores 156 signals, and writes results to KV/D1 — needs hundreds of ms minimum. The free tier also limits subrequests (50/request) and KV writes (1,000/day).

## Prerequisites

- [Bun](https://bun.sh/) — client + worker builds
- [Node.js 22+](https://nodejs.org/) — Wrangler CLI
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) — `npm install -g wrangler`
- [Cloudflare account](https://dash.cloudflare.com/) — Workers Paid plan ($5/mo)
- A domain on Cloudflare (for custom domain routing)

Optional (Fly proxy only):
- [Go 1.22+](https://go.dev/)
- [Fly CLI](https://fly.io/docs/flyctl/install/)

## Step 1: Clone and Install

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke

cd client && bun install && cd ..
cd worker && bun install && cd ..
cd og-worker && npm install && cd ..

# Enable pre-commit hooks (recommended)
git config core.hooksPath .githooks
```

## Step 2: Create Cloudflare Resources

```bash
npx wrangler login

# D1 database (historical scores + analytics)
npx wrangler d1 create yoke-stats
# → Save the database_id

# KV namespace (analysis cache + rate limiting + reference data)
npx wrangler kv namespace create REFERENCE_DATA
# → Save the id
```

## Cloudflare Bot Fight Mode

**Disable Bot Fight Mode** (Security → Bots → Bot Fight Mode → Off).

Yoke is an API-first product — the CLI, MCP server, Chrome extension, and CI smoke tests all make automated requests. Bot Fight Mode challenges anything that isn't a browser, returning 403 JS challenge pages that automated clients can't solve. This breaks the JSON API, CI pipelines (GitHub Actions runners use Azure IPs, which BFM flags), and any headless consumer of your instance.

Your instance is already protected by per-IP rate limiting and SSRF guards — BFM adds nothing useful here.

## Step 3: Configure

**OG Worker** (deploy first — main worker depends on it via service binding):

```bash
cp og-worker/wrangler.toml.example og-worker/wrangler.toml
```

Edit `og-worker/wrangler.toml`:
```toml
name = "yoke-og"
main = "dist/worker.js"
compatibility_date = "2024-12-01"
account_id = "your-cloudflare-account-id"   # dash.cloudflare.com → any zone → Overview sidebar
```

**Main Worker:**

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
```

Edit `worker/wrangler.toml`:
```toml
name = "yoke"
main = "dist/worker.js"
compatibility_date = "2024-12-01"
account_id = "your-cloudflare-account-id"

[vars]
BASE_URL = "https://yourdomain.com"

[assets]
directory = "../client/dist"
binding = "ASSETS"

[[d1_databases]]
binding = "STATS_DB"
database_name = "yoke-stats"
database_id = "paste-database-id-from-step-2"

[[kv_namespaces]]
binding = "REFERENCE_DATA"
id = "paste-kv-namespace-id-from-step-2"

[[routes]]
pattern = "yourdomain.com/*"
zone_name = "yourdomain.com"

[[services]]
binding = "OG_WORKER"
service = "yoke-og"
```

Both wrangler.toml files are gitignored.

## Step 4: Migrations

```bash
npx wrangler d1 execute yoke-stats --file=worker/migrations/0002_domain_scores.sql
```

> `0001_init.sql` is deprecated (old D1 cache layer, replaced by KV). Skip it.

## Step 5: Secrets

**Required:**

```bash
# HMAC key for signed share card URLs (openssl rand -hex 32)
npx wrangler secret put SHARE_SECRET

# Admin key — protects /usage, /api/cleanup, /api/cache (openssl rand -hex 32)
npx wrangler secret put ADMIN_KEY
```

**Recommended:**

```bash
# AI Analysis — get a key at https://openrouter.ai/keys
npx wrangler secret put OPENROUTER_API_KEY

# Lighthouse + Core Web Vitals — free, 25K req/day
# Enable at: https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com
npx wrangler secret put GOOGLE_PAGESPEED_API_KEY

# WHOIS fallback for ccTLDs — free, 100 req/month — https://whoisfreaks.com/
npx wrangler secret put WHOISFREAKS_API_KEY
```

## Step 6: Build and Deploy

Deploy order matters — OG worker first, then main worker.

```bash
# Everything at once
bash deploy.sh --cf

# Or manually
cd og-worker && bun run build && npx wrangler deploy && cd ..
cd worker && bun run build && npx wrangler deploy && cd ..
```

Visit `https://yourdomain.com` — try analyzing a domain.

## Step 7 (Optional): Fly.io Proxy

The proxy provides HTTP probes from non-Cloudflare IPs (some sites block CF ranges), MaxMind GeoIP enrichment, and check-host.net relay for global availability.

**Without it**, everything works — blocked sites show as `RESTRICTED` instead of `UP`, and GeoIP falls back to ipwho.is.

```bash
cd fly-proxy
fly auth login
fly launch --no-deploy
fly secrets set FLY_AUTH_SECRET=<your-shared-secret>
fly deploy

# Optional: MaxMind GeoIP (free license at maxmind.com/en/geolite2/signup)
MAXMIND_LICENSE_KEY=your_key fly deploy
cd ..
```

Then set `FLY_PROBE_URL` and `FLY_AUTH_SECRET` in your main worker:
```bash
# Add to worker/wrangler.toml [vars]:
# FLY_PROBE_URL = "https://your-fly-app.fly.dev"
npx wrangler secret put FLY_AUTH_SECRET   # must match Fly side
```

## Environment Variables

Set via `npx wrangler secret put` or as `[vars]` in wrangler.toml (non-sensitive only).

| Variable | Required | Description |
|----------|----------|-------------|
| `SHARE_SECRET` | **Yes** | HMAC key for share card URLs |
| `ADMIN_KEY` | **Yes** | Protects admin endpoints |
| `BASE_URL` | Recommended | Instance URL for self-analysis + share cards |
| `OPENROUTER_API_KEY` | Recommended | AI Analysis (Cross-Signal Insights) |
| `GOOGLE_PAGESPEED_API_KEY` | Recommended | Lighthouse scores + Core Web Vitals |
| `WHOISFREAKS_API_KEY` | Optional | WHOIS fallback for ccTLDs (100 free/mo) |
| `FLY_PROBE_URL` | Optional | Fly proxy URL |
| `FLY_AUTH_SECRET` | Optional | Worker ↔ Fly proxy shared secret |
| `RATE_LIMIT_ANALYZE` | Optional | Max analyses/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_COMPARE` | Optional | Max compares/hr per IP (default: 50, 0 = disable) |
| `RATE_LIMIT_SUBDOMAIN` | Optional | Max subdomain scans/hr per IP (default: 30, 0 = disable) |
| `RATE_LIMIT_AVAILABILITY` | Optional | Max availability checks/hr per IP (default: 60, 0 = disable) |
| `CACHE_TTL_HOURS` | Optional | Analysis cache TTL in hours (default: 24, 0 = disable) |

## Admin Endpoints

Protected by `ADMIN_KEY` via HTTP Basic auth (any username, password = key):

```bash
# Usage dashboard (also at /usage in browser)
curl -u admin:YOUR_KEY https://your-instance.com/usage

# D1 cleanup — old stats, expired rate limits
curl -u admin:YOUR_KEY https://your-instance.com/api/cleanup

# Purge cached analysis for a domain
curl -u admin:YOUR_KEY -X DELETE https://your-instance.com/api/cache/example.com

# Purge all AI analysis cache
curl -u admin:YOUR_KEY -X DELETE "https://your-instance.com/api/cache?type=ai_analysis"
```

Run `/api/cleanup` periodically (daily/weekly) to keep D1 lean. Cache cleanup is automatic via KV TTL.

### Rate Limit Bypass

For batch analysis or CI, pass `X-Admin-Key` to skip per-IP rate limits:

```bash
curl -X POST https://your-instance.com/api/analyze \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: YOUR_KEY" \
  -d '{"domain": "example.com"}'
```

## Updating

```bash
git pull
bash deploy.sh --cf    # or --all to include Fly proxy
```

## Share Cards

Share cards use HMAC-SHA256 signed URLs for social sharing with OG image previews:
- `/r/{payload}.{sig}` — Report card HTML page
- `/og/{payload}.{sig}.png` — Dynamic OG image (1200×630, rendered via resvg-wasm)
