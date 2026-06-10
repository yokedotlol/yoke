-- Target DB: yoke-cache  (DB binding)
-- Apply with:
--   npx wrangler d1 execute yoke-cache --file=worker/migrations/0004_drop_domain_cache.sql
--
-- Drops the vestigial `domain_cache` table created by 0001_init.sql. The D1
-- cache layer was replaced by Cloudflare KV (REFERENCE_DATA binding); nothing
-- reads or writes domain_cache anymore — the only remaining reference is a
-- status string in worker/src/routes/api-admin.ts.
--
-- `domain_lookups` (also from 0001_init.sql) is intentionally left in place.

DROP TABLE IF EXISTS domain_cache;
DROP INDEX IF EXISTS idx_cache_domain_type;
DROP INDEX IF EXISTS idx_cache_at;
