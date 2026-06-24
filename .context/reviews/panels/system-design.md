# Panel 1: System Design Review

You are a senior systems architect reviewing Yoke — a domain intelligence tool built as a Cloudflare Worker + React SPA + Fly.io probe proxy + Go CLI.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings in your domain.

## Your Focus

You are looking for architectural weaknesses that would cause problems at scale, under load, or in production. Think: "What breaks when this gets popular on HN and 10,000 people hit it in an hour?"

### Rate Limiting & Abuse Prevention
- Is rate limiting correctly implemented? (per-IP, per-endpoint, rolling windows)
- Can rate limits be trivially bypassed? (IP rotation, header spoofing, etc.)
- Are rate limit counters atomic? Race conditions in D1?
- Is the AI endpoint (most expensive) properly gated?
- Are there endpoints with NO rate limiting that should have it?

### Caching Strategy
- Is every external API call cached appropriately? (KV, D1, or in-memory)
- Are cache keys collision-safe? (could two different inputs produce the same key?)
- Are cache TTLs appropriate for the data freshness vs. API cost tradeoff?
- Is there a thundering herd risk? (100 requests for the same uncached domain simultaneously)
- Can stale cache cause user-visible incorrectness?

### External API Resilience
- What happens when each external API is down? (RDAP, PageSpeed, HIBP, etc.)
- Are there timeouts on every external fetch? Are they reasonable?
- Is there retry logic where appropriate? With backoff?
- Do partial failures degrade gracefully or cause cascading failures?
- Is the analysis pipeline fault-tolerant? (one check failing shouldn't tank the whole analysis)

### Resource Management
- Are there unbounded operations? (arrays that grow forever, uncapped loops)
- Is D1 query volume proportional to request volume? (N+1 patterns)
- Worker memory limits — any risk of hitting V8 isolate limits?
- Are there module-level mutable state concerns in CF Worker isolates?

### Data Flow & Consistency
- Is data written and read consistently? (write-then-read race conditions)
- Are there orphaned records? (cache entries without cleanup)
- Is the D1 schema appropriate? (indexes, column types, constraints)

## Output Format

Use the standard finding format from SKILL.md. Group findings by subcategory above. End with:
1. **Architecture strengths** — What's well-designed
2. **Top 3 risks** — What would you fix before launch
3. **Scalability ceiling** — Where will this architecture hit its limits first

Write results to `docs/internal/reviews/panel-system-design.md`.
