-- Target DB: yoke-stats  (STATS_DB binding)
-- Apply with:
--   npx wrangler d1 execute yoke-stats --file=worker/migrations/0005_daily_counters.sql
--
-- Minimal cost instrumentation: one row per (metric, day). NO per-request rows.
-- Populated by the hourly cron (worker/src/scheduled.ts), which flushes the
-- global analysis-budget Durable Object's current-day totals here via UPSERT.
-- Read by the usage panel's "Cost & Budget" section.
--
-- Metrics written today:
--   analyses_total, analyses_curl, analyses_analyze, analyses_compare,
--   analyses_badge, badge_refreshes
--
-- This table is also self-healed by a `CREATE TABLE IF NOT EXISTS` in
-- worker/src/daily-counters.ts, so it works without applying this migration
-- manually. The migration just makes the schema a first-class artifact.

CREATE TABLE IF NOT EXISTS daily_counters (
  metric TEXT NOT NULL,
  day TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metric, day)
);
