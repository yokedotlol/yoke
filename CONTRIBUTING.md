# Contributing to Yoke

Thanks for wanting to contribute! Yoke is MIT-licensed and welcomes pull requests.

## Quick Start

```bash
git clone https://github.com/yokedotlol/yoke.git
cd yoke
bun install
cd client && bun install && cd ..
cd worker && bun install && cd ..

# Enable pre-commit hooks (Biome lint + lockfile freshness)
git config core.hooksPath .githooks

# Run tests
npx vitest run

# Type check (must pass with zero errors — CI enforces this)
cd worker && bun run typecheck

# Lint (must pass with zero errors — CI enforces this)
npx @biomejs/biome check .

# Auto-fix lint and formatting issues
npx @biomejs/biome check --write .

# Local development
cd client && bun run dev        # Vite dev server for the SPA
cd worker && bun run dev        # Wrangler dev for the worker (needs wrangler.toml)
```

No Cloudflare account needed for running tests. You'll need one for local Worker development (`wrangler dev`). See `README.md` for full self-hosting setup.

## Project Structure

```
yoke/
├── worker/src/              # Cloudflare Worker (TypeScript, zero-framework)
│   ├── index.ts             # HTTP router + entry point
│   ├── checks/              # Analysis check registry (one file per check)
│   │   ├── types.ts         # Check + CheckContext interfaces
│   │   ├── registry.ts      # Ordered check array
│   │   └── *.ts             # Individual checks (ssl.ts, rdap.ts, etc.)
│   ├── actions/             # API action handlers
│   ├── actions/analyze/     # Analysis pipeline (core.ts orchestrator)
│   ├── config/              # Signal registry, scoring thresholds, cache config
│   │   ├── signal-registry.ts   # Single source of truth for all scoring signals
│   │   ├── scoring-thresholds.ts # Archetype weights + axis definitions
│   │   └── contextual-scoring-types.ts
│   ├── helpers.ts           # Shared utilities, SSRF protection, CORS, KV cache
│   ├── logger.ts            # Structured JSON logger
│   └── spa.ts               # SPA serving, OG tag injection, CSP
├── client/src/              # React SPA (Vite + TypeScript)
├── client/build.ts          # Client build script (generates dist/index.html from template)
├── fly-proxy/               # Go HTTP probe (SSL grading, GeoIP, SSRF-safe fetch)
├── extension/               # Chrome extension (Manifest V3, side panel)
├── cli/                     # Go CLI (goreleaser, Homebrew tap)
├── prompts/                 # AI analysis prompt (.txt, imported by worker)
└── tests/                   # Vitest test suite (508+ tests)
```

### Storage

- **KV** (`REFERENCE_DATA`) — all caching. Domain results, recent lookups, AI analysis, subdomain scans. TTL-based expiry.
- **D1** (`yoke-stats`) — durable stats only. Rate limits, endpoint usage, domain scores, daily snapshots, tab analytics.

## Adding a New Analysis Check

This is the easiest and most impactful way to contribute. Each check lives in its own file under `worker/src/checks/`.

### 1. Create your check file

```typescript
// worker/src/checks/my-check.ts
import type { Check, CheckContext } from './types';

const myCheck: Check = {
  key: 'my_check',        // Key in the analysis result object
  label: 'My Check',      // Streaming progress label shown to users
  default: null,           // Fallback value if the check fails

  async run(ctx: CheckContext) {
    // ctx.domain           — the domain being analyzed
    // ctx.env              — Cloudflare Worker env bindings
    // ctx.dnsRecords       — DNS records from Phase 1
    // ctx.ip               — first A-record IP (if any)
    // ctx.httpResponseTimeMs — HTTP probe time from Phase 1
    // ctx.instanceHost     — for self-analysis bypass

    const resp = await fetchWithTimeout(`https://api.example.com/${ctx.domain}`, {}, 5000);
    const text = await boundedText(resp);
    return JSON.parse(text);
  },
};

export default myCheck;
```

### 2. Register it

Add your check to `worker/src/checks/registry.ts`. Append to the end — order matters for streaming progress.

### 3. Add the scoring signal

If your check produces a scoring signal, add it to `worker/src/config/signal-registry.ts`:

```typescript
my_signal: {
  axis: 'security',       // security | speed | foundations | reputation | discoverability | email
  actionable: true,
  effort: 'low',          // low | medium | high
  fix: 'Enable the thing to improve security.',
},
```

Then wire it into `worker/src/actions/analyze/contextual-scoring.ts` to push findings.

### 4. Add tests

Add a test in `tests/` for the expected output shape and graceful failure. Run:

```bash
npx vitest run
cd worker && bun run typecheck   # must have zero errors
```

### What makes a good check?

- **Free public API** — no API key required (or has a generous free tier)
- **Fast** — under 5 seconds. Checks run in parallel but slow ones delay the overall result
- **Graceful failure** — returns the `default` value on error, never throws
- **No PII** — don't send user data to third parties beyond the domain name
- **Bounded reads** — use `boundedText()` from helpers to cap response body sizes
- **Timeouts** — use `fetchWithTimeout()` for all external calls

## Working on the Fly Proxy

The Go proxy at `fly-proxy/` handles SSL probing, GeoIP, and check-host.net relaying from a non-Cloudflare IP. It has its own test suite:

```bash
cd fly-proxy
go test -v
```

Key constraints:
- All outbound fetches go through `safeDialContext` (SSRF protection)
- Response bodies must use `io.LimitReader` (1MB cap)
- Error messages to clients must not leak internal details

## Working on the CLI

The Go CLI at `cli/` is distributed via goreleaser and Homebrew (`yokedotlol/homebrew-tap`). It streams SSE analysis results and supports compare, AI analysis, and custom prompts. See `cli/README.md` for usage.

## Client Build

**Important:** The HTML shell (`client/dist/index.html`) is generated from a hardcoded template literal in `client/build.ts`, NOT from `client/index.html`. If you need to change meta tags, footer links, inline scripts, or the noscript fallback — edit the template in `build.ts`.

## Code Style

- **TypeScript** everywhere (worker + client + tests)
- **No framework** in the worker — hand-rolled router, plain `fetch` handler
- **Structured logging** — use `log()` from `worker/src/logger.ts`, not bare `console.log`
- **Error handling** — fail gracefully. Individual check failures should never crash the pipeline
- **No `as any`** — the codebase is fully typed
- **Timeouts** — use `fetchWithTimeout()` from helpers for all external calls
- **Bounded reads** — use `boundedText()` for all `.text()` calls on external responses

## Testing

Tests use [Vitest](https://vitest.dev/) and live in `tests/`:

```bash
npx vitest run              # Run all tests (508+ tests)
npx vitest run --watch      # Watch mode
npx vitest run scoring      # Run specific test file
```

### What needs tests?

- Scoring logic and threshold boundaries
- Signal registry enforcement (consistency between registry, scoring, and UI)
- Detection fingerprints (tech stack, WordPress, WAF)
- Helper/utility functions
- WHOIS/RDAP parsing for new TLD formats
- New analysis checks (expected output shape + graceful failure on error)

## Git Hooks

The repo includes pre-commit hooks in `.githooks/`. Enable them after cloning:

```bash
git config core.hooksPath .githooks
```

This runs automatically before each commit:

- **Biome lint & format** — checks staged `.ts`/`.tsx`/`.js`/`.json` files for lint errors and formatting issues. Blocks the commit if errors are found; run `npx @biomejs/biome check --write .` to auto-fix.
- **Lockfile freshness** — verifies `bun.lockb` in all three roots (root, client, worker) matches `package.json`. Blocks the commit if lockfiles are stale, with instructions to fix.

If you need to bypass the hook for a WIP commit: `git commit --no-verify`.

## Pull Request Checklist

- [ ] `npx vitest run` passes (all 508+ tests)
- [ ] `cd worker && bun run typecheck` passes with zero errors
- [ ] `npx @biomejs/biome check .` passes with zero errors (warnings are OK)
- [ ] New checks include a test for the expected output shape
- [ ] New scoring signals are added to `signal-registry.ts`
- [ ] No hardcoded secrets or API keys
- [ ] Errors are handled — no empty `catch {}` blocks without logging
- [ ] External fetches use `fetchWithTimeout()` and `boundedText()`
- [ ] Commit message is descriptive

## What Reviewers Look For

- **Does it work?** Reviewers will test your PR against a few domains.
- **Does it fail gracefully?** What happens when the external API is down, rate-limited, or returns garbage?
- **Is it fast?** Checks should complete in under 5 seconds. Use `fetchWithTimeout()`.
- **Is it typed?** No `any` types. Define interfaces for external API responses.

## Opening Issues

Found a bug or have a feature idea? [Open an issue](https://github.com/yokedotlol/yoke/issues). Include:

- What you expected vs. what happened
- The domain you tested (if applicable)
- Browser/OS (for UI bugs)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
