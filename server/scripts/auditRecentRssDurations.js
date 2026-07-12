'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const Database = require('better-sqlite3');

const hours = Number(process.argv[2] || 6);
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scoring.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 30_000 });
db.pragma('query_only = ON');
db.pragma('busy_timeout = 30000');

function get(sql, params = []) { return db.prepare(sql).get(params); }
function all(sql, params = []) { return db.prepare(sql).all(params); }

function pct(n, total) {
  return total ? `${((n / total) * 100).toFixed(1)}%` : '0.0%';
}

try {
  const windowExpr = `-${Math.max(1, hours)} hours`;
  const total = get(
    `SELECT COUNT(*) AS n
     FROM ingested_videos
     WHERE ingested_at >= datetime('now', ?)`,
    [windowExpr],
  ).n;

  const shorts = get(
    `SELECT COUNT(*) AS n
     FROM ingested_videos
     WHERE ingested_at >= datetime('now', ?)
       AND is_short = 1`,
    [windowExpr],
  ).n;

  const nonShorts = get(
    `SELECT COUNT(*) AS n
     FROM ingested_videos
     WHERE ingested_at >= datetime('now', ?)
       AND is_short = 0`,
    [windowExpr],
  ).n;

  const sampleBuckets = all(
    `WITH recent AS (
       SELECT duration_seconds
       FROM ingested_videos
       WHERE ingested_at >= datetime('now', ?)
       ORDER BY ingested_at DESC
       LIMIT 5000
     )
     SELECT
       CASE
         WHEN duration_seconds IS NULL THEN 'unknown'
         WHEN duration_seconds <= 60 THEN '<=60s'
         WHEN duration_seconds <= 180 THEN '61-180s'
         WHEN duration_seconds <= 600 THEN '3-10m'
         WHEN duration_seconds <= 1800 THEN '10-30m'
         ELSE '30m+'
       END AS bucket,
       COUNT(*) AS sample_videos
     FROM recent
     GROUP BY bucket
     ORDER BY
       CASE bucket
         WHEN '<=60s' THEN 1
         WHEN '61-180s' THEN 2
         WHEN '3-10m' THEN 3
         WHEN '10-30m' THEN 4
         WHEN '30m+' THEN 5
         ELSE 6
       END`,
    [windowExpr],
  );

  console.log(`\n=== Recent Ingest Duration Mix (${hours}h) ===`);
  console.log({ total, shorts, shorts_pct: pct(shorts, total), nonShorts, nonShorts_pct: pct(nonShorts, total) });
  console.log('\n=== Recent Format Metadata ===');
  console.table(all(
    `SELECT format_type, format_confidence, ingest_source, COUNT(*) AS videos
     FROM ingested_videos
     WHERE ingested_at >= datetime('now', ?)
     GROUP BY format_type, format_confidence, ingest_source
     ORDER BY videos DESC
     LIMIT 20`,
    [windowExpr],
  ).map(r => ({ ...r, pct: pct(r.videos, total) })));
  console.log('\n=== Duration Buckets From Latest 5,000 Recent Inserts ===');
  console.table(sampleBuckets.map(r => ({ ...r, sample_pct: pct(r.sample_videos, 5000) })));

  console.log('\n=== Recent Sample ===');
  console.table(all(
    `SELECT youtube_video_id, title, duration_seconds, published_at, ingested_at
     FROM ingested_videos
     WHERE ingested_at >= datetime('now', ?)
     ORDER BY ingested_at DESC
     LIMIT 30`,
    [windowExpr],
  ));

  console.log('\n=== Top Channels By Recent <=60s Videos ===');
  console.table(all(
    `SELECT ic.channel_name, iv.channel_id, COUNT(*) AS shorts
     FROM ingested_videos iv
     LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE iv.ingested_at >= datetime('now', ?)
       AND iv.is_short = 1
     GROUP BY iv.channel_id
     ORDER BY shorts DESC
     LIMIT 20`,
    [windowExpr],
  ));
} finally {
  db.close();
}
