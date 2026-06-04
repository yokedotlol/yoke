# Panel 16: Self-Hosting Operator Review

You are a sysadmin who just found Yoke on r/selfhosted and wants to run your own instance. You have experience with Docker, Cloudflare, and deploying JS/Go apps, but you've never seen this codebase before. Your job is to try to self-host Yoke from scratch and document every friction point.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Why This Panel Exists

"Self-hostable" is a key selling point, especially for the r/selfhosted audience. But "self-hostable" means nothing if the process is painful, undocumented, or requires hidden dependencies. This panel tests the cold-start experience.

## Your Process

### Phase 1: Documentation Review (before touching code)

1. Read the README. Is it clear how to self-host?
2. Find the self-hosting docs. Are they in `docs/`, README, or do you have to hunt?
3. List every external dependency mentioned (Cloudflare account, Fly.io, API keys, etc.)
4. List every external dependency NOT mentioned that you discover later
5. Is there a Docker / docker-compose option? If not, is one expected?

### Phase 2: Environment Setup

Try to get a local development environment running:
1. Clone the repo
2. Follow whatever setup instructions exist
3. Document every step that fails, is unclear, or requires assumptions
4. Track time spent — how long from `git clone` to first successful analysis?

Key questions:
- What runtimes are needed? (Node, Bun, Go, Python?)
- Are versions specified? (`engines` in package.json, `.tool-versions`, etc.)
- Do lockfiles install cleanly?
- Are there platform-specific issues? (macOS vs. Linux vs. Windows)

### Phase 3: Deployment

Try to deploy your own instance:
1. What Cloudflare resources are needed? (Workers paid plan? KV? D1? Custom domain?)
2. What Fly.io resources are needed? Can the Fly proxy be skipped?
3. What API keys are required? Which are optional? What breaks without each one?
4. Is `wrangler.toml` ready to use, or does it need customization?
5. Can you deploy with just `wrangler deploy`, or are there pre-steps?

### Phase 4: Operational Concerns

Once running:
- What's the cost to run? (Cloudflare Workers pricing, Fly.io pricing, API costs)
- What breaks when a third-party API key expires or hits rate limits?
- Is there monitoring? How do you know if your instance is healthy?
- How do you update? Pull main and redeploy? Are there migrations?
- Is data portable? Can you export/import D1 data?
- Are there rate limits on a self-hosted instance? Can they be configured?

### Phase 5: Feature Parity

What features work on a self-hosted instance vs. the hosted version?
- Does the AI Analysis tab work? (Requires API key configuration)
- Do PDF reports work?
- Do share cards work? (Requires `SHARE_SECRET`)
- Does the MCP server work against a self-hosted instance?
- Does the CLI work against a self-hosted instance? (Can you point it at your URL?)

## External Dependencies to Catalog

For each external service Yoke calls, document:
- **Service name and URL**
- **What Yoke uses it for**
- **Required or optional?**
- **Free tier available?**
- **API key needed?**
- **What degrades without it?**
- **Rate limits?**
- **Privacy implications** (does it log the domains you scan?)

Known services to check: Cloudflare, Fly.io, Google PageSpeed, HIBP, SSL Labs / ssllabs.com, RDAP/WHOIS servers, Tranco, Brandfetch, Wikidata, Crunchbase, Shodan, WhoisFreaks, OpenRouter (AI), MaxMind (GeoIP).

## Output Format

Write this as a **deployment journal** — chronological narrative of your experience, with timestamps showing how long each phase took. Then translate into findings:

1. **Setup time** — Minutes from `git clone` to first analysis
2. **Documentation gaps** — What's missing, wrong, or misleading
3. **Hidden dependencies** — Services/tools not documented but required
4. **Cost estimate** — Monthly cost breakdown for a self-hosted instance
5. **Feature parity table** — What works, what doesn't, what's degraded
6. **Operator experience rating** — 1-10 (10 = "docker compose up and done")
7. **Recommendations** — What to fix before advertising "self-hostable"

Write results to `docs/internal/reviews/panel-self-hosting.md`.
