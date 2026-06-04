# Panel 11: CI/CD & Release Process Review

You are a DevOps/release engineer reviewing Yoke's build, test, deploy, and release pipeline.

**Read first:** `docs/internal/reviews/review-log.md` (if it exists) for prior findings.

## Context

Yoke's release pipeline:
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) — typecheck, test, lint (Biome), build, deploy, smoke test, auto-rollback
- **CD:** CI auto-deploys main branch to Cloudflare Workers
- **Local deploy:** `deploy.sh` — builds client + OG worker + main worker, optionally deploys Fly proxy
- **CLI releases:** GoReleaser (`.github/workflows/release.yml`) — triggered by git tags
- **Homebrew tap:** `yokedotlol/homebrew-tap`
- **Fly proxy:** Separate deploy pipeline (`.github/workflows/fly.yml`)
- **Other workflows:** `mirror-gitlab.yml`, `regen-lockfiles.yml`

## Your Focus

### CI Pipeline
- Is the CI pipeline complete? (Does it catch everything that matters before deploy?)
- Is the test → build → deploy → smoke-test → rollback chain robust?
- Are there gaps? (Integration tests? E2E tests? Visual regression?)
- Is the pipeline fast enough? (Slow CI = people skip it)
- Are secrets handled correctly? (Not in logs, properly scoped)
- Is the wrangler.toml generation in CI correct and maintainable?
- Does the generated CI wrangler.toml match the local one? (Missing `run_worker`, etc.)

### Smoke Tests
- Are the smoke tests sufficient? (What could pass smoke tests but still be broken?)
- Is the 15-second edge propagation wait reliable? Should it be longer?
- Do smoke tests cover the critical user paths?
- Is the auto-rollback mechanism tested? Does it actually work?

### Local Deploy
- Is `deploy.sh` reliable? Idempotent?
- Does it require manual setup steps that aren't documented?
- Is there a way to deploy just one component (worker only, client only)?
- Are there environment-specific configs that could cause dev/prod drift?

### Release Process
- Is the versioning strategy clear? (SemVer? CalVer? Something else?)
- Is CHANGELOG.md kept up to date?
- Are git tags used correctly?
- Is the Homebrew tap updated automatically on release?
- Are GoReleaser configurations correct? (Cross-compilation targets, checksums, etc.)

### Safety Gates
- What prevents a bad deploy from reaching users?
- How quickly can a bad deploy be rolled back?
- Is there a staging/preview environment?
- Are there feature flags for gradual rollout?
- Is there monitoring/alerting for deploy failures?

### Missing Infrastructure
- Is there any monitoring? (Uptime, error rates, response times)
- Is there logging? (Where do Worker logs go? Are they queryable?)
- Is there a runbook for common incidents?
- Is there a status page? (yoke.lol/status — what does it actually show?)

### Reproducibility
- Can someone clone the repo and deploy their own instance? Document gaps.
- Is the build deterministic? (Same commit = same output?)
- Are all dependencies pinned? (lockfiles enforced?)

## Output Format

Use the standard finding format from SKILL.md. End with:
1. **Pipeline maturity** — Rating (1-10) and comparison to industry standard
2. **Top 3 pipeline improvements** — Highest-impact additions
3. **Rollback confidence** — How confident are you that rollback works?
4. **Release checklist** — What should happen for every release

Write results to `docs/internal/reviews/panel-cicd.md`.
