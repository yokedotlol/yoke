-- Target DB: yoke-stats  (STATS_DB binding)
-- Apply with:
--   npx wrangler d1 execute yoke-stats --file=worker/migrations/0003_badge_domains.sql
--
-- Tracks every domain a badge has ever been requested for, so the hourly badge
-- sweep (worker/src/scheduled.ts) can pre-warm their KV badge caches.
--
-- This table was previously created on-the-fly by a self-healing
-- `CREATE TABLE IF NOT EXISTS` in worker/src/routes/api-badge.ts. That defensive
-- create is intentionally kept (harmless), but this migration makes the schema
-- a first-class, explicitly-applied artifact alongside 0002_domain_scores.sql,
-- which also targets yoke-stats.
--
-- NOTE: rows are now first-seen-only inserts (INSERT OR IGNORE). last_requested
-- and request_count are no longer bumped per badge hit — see the comment in
-- trackBadgeDomain(). They remain in the schema for backward compatibility and
-- so existing rows are untouched.

CREATE TABLE IF NOT EXISTS badge_domains (
  domain TEXT PRIMARY KEY,
  first_requested TEXT NOT NULL,
  last_requested TEXT NOT NULL,
  request_count INTEGER DEFAULT 1
);
