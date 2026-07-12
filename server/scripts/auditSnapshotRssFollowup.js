'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'scoring.db'), {
  readonly: true,
  fileMustExist: true,
  timeout: 60_000,
});
db.pragma('query_only = ON');

function get(sql) { return db.prepare(sql).get(); }
function all(sql) { return db.prepare(sql).all(); }

console.log('\n=== Time Anchors ===');
console.log(JSON.stringify({
  sqlite_now: get(`SELECT datetime('now') AS v`).v,
  max_rss_scan: get(`SELECT MAX(last_rss_scan_at) AS v FROM ingested_channels`).v,
}, null, 2));

console.log('\n=== RSS Scan Max Samples ===');
console.table(all(`
  SELECT channel_name, channel_id, last_rss_scan_at
  FROM ingested_channels
  WHERE last_rss_scan_at IS NOT NULL
  ORDER BY last_rss_scan_at DESC
  LIMIT 10
`));
