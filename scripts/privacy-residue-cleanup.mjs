#!/usr/bin/env node

const accountId = mustEnv('CF_ACCOUNT_ID');
const apiToken = mustEnv('CF_API_TOKEN');
const d1Id = mustEnv('D1_STATS_DB_ID');
const kvId = mustEnv('KV_REFERENCE_DATA_ID');

const kvKeys = ['recent:index', 'showcase:index', 'stats:top-domains', 'stats:top_domains', 'top_domains'];
const summary = {
  kv: {},
  d1: {},
  verified: {},
};

function mustEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok || body?.success === false) {
    throw new Error(`${init.method || 'GET'} ${path} failed (${res.status}): ${JSON.stringify(body?.errors || body).slice(0, 500)}`);
  }
  return body;
}

async function d1(sql, params = []) {
  const body = await cf(`/accounts/${accountId}/d1/database/${d1Id}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
  });
  const result = body.result?.[0];
  if (!result?.success) throw new Error(`D1 query failed: ${sql}`);
  return result.results || [];
}

async function d1Maybe(sql, params = []) {
  try {
    return await d1(sql, params);
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

async function kvDelete(key) {
  const encoded = encodeURIComponent(key);
  const existsBefore = await kvExists(encoded);
  await cf(`/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/${encoded}`, { method: 'DELETE' });
  const existsAfter = await kvExists(encoded);
  summary.kv[key] = { existed_before: existsBefore, exists_after: existsAfter };
}

async function kvExists(encodedKey) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/${encodedKey}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (res.status === 404) return false;
  if (res.ok) return true;
  const text = await res.text();
  throw new Error(`KV get failed (${res.status}): ${text.slice(0, 500)}`);
}

async function tableExists(name) {
  const rows = await d1('SELECT COUNT(*) AS c FROM sqlite_master WHERE type = ? AND name = ?', ['table', name]);
  return Number(rows[0]?.c || 0) > 0;
}

async function columns(table) {
  const rows = await d1Maybe(`PRAGMA table_info(${table})`);
  if (Array.isArray(rows)) return rows.map((r) => r.name).filter(Boolean);
  return [];
}

async function countWhere(table, where) {
  const rows = await d1Maybe(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`);
  if (!Array.isArray(rows)) return null;
  return Number(rows[0]?.c || 0);
}

for (const key of kvKeys) {
  await kvDelete(key);
}

const targetTables = await d1(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND (name = 'domain_lookups' OR name LIKE '%top%domain%')",
);
summary.d1.dropped_tables = [];
for (const row of targetTables) {
  await d1(`DROP TABLE IF EXISTS ${row.name}`);
  summary.d1.dropped_tables.push(row.name);
}

const requestMetaExists = await tableExists('request_meta');
if (requestMetaExists) await d1('DROP TABLE IF EXISTS request_meta');
summary.d1.request_meta = { present_before: requestMetaExists, present_after: await tableExists('request_meta') };

const apiErrorsExists = await tableExists('api_errors');
const apiErrorColumns = apiErrorsExists ? await columns('api_errors') : [];
if (apiErrorsExists && apiErrorColumns.includes('domain')) {
  const before = await countWhere('api_errors', 'domain IS NOT NULL');
  await d1('UPDATE api_errors SET domain = NULL WHERE domain IS NOT NULL');
  const after = await countWhere('api_errors', 'domain IS NOT NULL');
  summary.d1.api_errors = { domain_values_before: before, domain_values_after: after };
} else {
  summary.d1.api_errors = { present: apiErrorsExists, domain_column: apiErrorColumns.includes('domain') };
}

const tabExists = await tableExists('tab_views');
if (tabExists) {
  const cols = await columns('tab_views');
  if (cols.includes('domain') || !cols.includes('day') || !cols.includes('views')) {
    await d1('DROP TABLE IF EXISTS tab_views');
    await d1('CREATE TABLE IF NOT EXISTS tab_views (tab TEXT NOT NULL, day TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tab, day))');
    await d1('CREATE INDEX IF NOT EXISTS idx_tab_views_day ON tab_views(day)');
    summary.d1.tab_views = { reshaped: true, old_columns: cols };
  } else {
    summary.d1.tab_views = { reshaped: false, columns: cols };
  }
} else {
  summary.d1.tab_views = { present: false };
}

summary.verified.no_target_tables =
  (await d1("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND (name = 'domain_lookups' OR name LIKE '%top%domain%')"))[0].c === 0;

summary.verified.request_meta_removed = !(await tableExists('request_meta'));
const finalApiErrorsExists = await tableExists('api_errors');
const finalApiErrorCols = finalApiErrorsExists ? await columns('api_errors') : [];
summary.verified.api_errors_domain_null =
  !finalApiErrorsExists ||
  !finalApiErrorCols.includes('domain') ||
  (await countWhere('api_errors', 'domain IS NOT NULL')) === 0;

const finalTabCols = (await tableExists('tab_views')) ? await columns('tab_views') : [];
summary.verified.tab_views_aggregate_only = finalTabCols.length === 0 || (!finalTabCols.includes('domain') && finalTabCols.includes('tab') && finalTabCols.includes('day') && finalTabCols.includes('views'));
summary.verified.kv_target_keys_absent = Object.values(summary.kv).every((v) => v.exists_after === false);

const ok = Object.values(summary.verified).every(Boolean);
console.log(JSON.stringify(summary, null, 2));
if (!ok) {
  throw new Error('Privacy residue verification failed');
}
