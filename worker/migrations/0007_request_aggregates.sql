-- Target DB: yoke-stats  (STATS_DB binding)
-- Apply with:
--   npx wrangler d1 execute yoke-stats --file=worker/migrations/0007_request_aggregates.sql
--
-- Replace legacy per-request telemetry (including daily visitor hashes) with
-- hourly operational counters that contain no IP hash, target, timestamp, or
-- other per-request identifier. The Worker also self-heals this schema.

DROP TABLE IF EXISTS request_meta;

CREATE TABLE IF NOT EXISTS request_aggregates (
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  client_type TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'XX',
  status_code INTEGER NOT NULL DEFAULT 200,
  request_count INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, endpoint, client_type, country, status_code)
);

CREATE INDEX IF NOT EXISTS idx_ra_day ON request_aggregates(day);
CREATE INDEX IF NOT EXISTS idx_ra_endpoint ON request_aggregates(endpoint, day);
CREATE INDEX IF NOT EXISTS idx_ra_country ON request_aggregates(country, day);
