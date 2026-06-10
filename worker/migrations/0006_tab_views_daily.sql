-- Target DB: yoke-stats  (STATS_DB binding)
-- Apply with:
--   npx wrangler d1 execute yoke-stats --file=worker/migrations/0006_tab_views_daily.sql
--
-- Reshape tab_views from per-event rows to a daily aggregate, mirroring
-- endpoint_usage. The old shape (id, tab, domain, ts) wrote one row per tab
-- click — a write-amplification hole — even though the usage panel only ever
-- reads aggregate counts. The new shape stores one row per (tab, day) and the
-- POST /api/track-tab handler increments `views` via UPSERT.
--
-- Old per-event history is NOT migrated (it carried no value beyond the
-- aggregate, which restarts cleanly). The previous `domain` column is dropped:
-- it was always written but never read.
--
-- The handler in worker/src/routes/api-admin.ts also self-heals this exact
-- shape via CREATE TABLE IF NOT EXISTS, so the table works without applying
-- this migration manually. This migration makes the schema a first-class
-- artifact and reshapes any existing deployment.

DROP TABLE IF EXISTS tab_views;

CREATE TABLE IF NOT EXISTS tab_views (
  tab TEXT NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tab, day)
);

CREATE INDEX IF NOT EXISTS idx_tab_views_day ON tab_views(day);
