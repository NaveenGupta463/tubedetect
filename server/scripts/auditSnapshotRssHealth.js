'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scoring.db');
const logPath = path.join(__dirname, '..', 'data', 'snapshot-rss-audit.log');
fs.writeFileSync(logPath, `[${new Date().toISOString()}] audit start\n`);
function mark(step) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${step}\n`);
}
mark('opening db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 30_000 });
db.pragma('query_only = ON');
db.pragma('busy_timeout = 30000');
mark('db opened');

function get(sql, params = []) { return db.prepare(sql).get(params); }
function all(sql, params = []) { return db.prepare(sql).all(params); }
function n(sql, params = []) { return get(sql, params)?.n || 0; }
function section(title) { console.log(`\n=== ${title} ===`); }
function pct(part, total) { return total ? `${((part / total) * 100).toFixed(1)}%` : '0.0%'; }

section('Snapshot Schema Guardrails');
mark('snapshot schema start');
const snapshotIndexes = all(`PRAGMA index_list(video_growth_snapshots)`);
const ingestedIndexes = all(`PRAGMA index_list(ingested_videos)`);
const snapshotUnique = snapshotIndexes.some(i => i.unique && String(i.name || '').includes('autoindex'));
const ingestedPk = all(`PRAGMA table_info(ingested_videos)`).find(c => c.name === 'youtube_video_id')?.pk === 1;
console.table([{
  snapshot_unique_video_bucket: snapshotUnique,
  ingested_video_id_primary_key: ingestedPk,
  snapshot_indexes: snapshotIndexes.map(i => i.name).join(', '),
}]);
mark('snapshot schema done');

section('Snapshot Volume');
mark('snapshot volume start');
console.table([{
  ingested_videos: n('SELECT COUNT(*) AS n FROM ingested_videos'),
  snapshot_rows: n('SELECT COUNT(*) AS n FROM video_growth_snapshots'),
  never_refreshed_videos: n('SELECT COUNT(*) AS n FROM ingested_videos WHERE published_at IS NOT NULL AND last_refreshed_at IS NULL'),
}]);
mark('snapshot volume done');

section('Snapshot Buckets');
mark('snapshot buckets start');
console.table(all(`
  SELECT bucket, COUNT(*) AS snapshots
  FROM video_growth_snapshots
  GROUP BY bucket
  ORDER BY CASE bucket
    WHEN '1d' THEN 1 WHEN '3d' THEN 2 WHEN '7d' THEN 3
    WHEN '14d' THEN 4 WHEN '30d' THEN 5 WHEN '90d' THEN 6
    WHEN '365d' THEN 7 ELSE 99 END`));
mark('snapshot buckets done');

section('Snapshot Due Samples');
mark('snapshot due samples start');
const missingSamples = all(`
  SELECT iv.youtube_video_id, iv.channel_id, iv.published_at, iv.last_refreshed_at,
         CASE
           WHEN iv.published_at <= datetime('now', '-30 days') AND NOT EXISTS (SELECT 1 FROM video_growth_snapshots s WHERE s.video_id = iv.youtube_video_id AND s.bucket = '30d') THEN '30d'
           WHEN iv.published_at <= datetime('now', '-14 days') AND NOT EXISTS (SELECT 1 FROM video_growth_snapshots s WHERE s.video_id = iv.youtube_video_id AND s.bucket = '14d') THEN '14d'
           WHEN iv.published_at <= datetime('now', '-7 days')  AND NOT EXISTS (SELECT 1 FROM video_growth_snapshots s WHERE s.video_id = iv.youtube_video_id AND s.bucket = '7d') THEN '7d'
           WHEN iv.published_at <= datetime('now', '-3 days')  AND NOT EXISTS (SELECT 1 FROM video_growth_snapshots s WHERE s.video_id = iv.youtube_video_id AND s.bucket = '3d') THEN '3d'
           WHEN iv.published_at <= datetime('now', '-1 days')  AND NOT EXISTS (SELECT 1 FROM video_growth_snapshots s WHERE s.video_id = iv.youtube_video_id AND s.bucket = '1d') THEN '1d'
         END AS missing_bucket
  FROM ingested_videos iv
  WHERE iv.published_at IS NOT NULL
    AND iv.published_at >= datetime('now', '-60 days')
    AND missing_bucket IS NOT NULL
  ORDER BY iv.published_at DESC
  LIMIT 20`);
console.table(missingSamples);
mark('snapshot due samples done');

section('RSS Sweep Health');
mark('rss health start');
const enabledChannels = n('SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1');
const scanned6h = n(`SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1 AND last_rss_scan_at >= datetime('now', '-6 hours')`);
const scanned24h = n(`SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1 AND last_rss_scan_at >= datetime('now', '-24 hours')`);
const neverScanned = n(`SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1 AND last_rss_scan_at IS NULL`);
const newVideos6h = n(`SELECT COUNT(*) AS n FROM ingested_videos WHERE ingested_at >= datetime('now', '-6 hours')`);
const newVideos24h = n(`SELECT COUNT(*) AS n FROM ingested_videos WHERE ingested_at >= datetime('now', '-24 hours')`);
console.table([{
  enabled_channels: enabledChannels,
  scanned_last_6h: scanned6h,
  scanned_last_6h_pct: pct(scanned6h, enabledChannels),
  scanned_last_24h: scanned24h,
  scanned_last_24h_pct: pct(scanned24h, enabledChannels),
  never_scanned: neverScanned,
  new_videos_last_6h: newVideos6h,
  new_videos_last_24h: newVideos24h,
}]);
mark('rss health done');

section('RSS Scan Lag');
mark('rss scan lag start');
console.table(all(`
  SELECT
    CASE
      WHEN last_rss_scan_at IS NULL THEN 'never'
      WHEN last_rss_scan_at >= datetime('now', '-6 hours') THEN '<6h'
      WHEN last_rss_scan_at >= datetime('now', '-24 hours') THEN '6-24h'
      WHEN last_rss_scan_at >= datetime('now', '-72 hours') THEN '1-3d'
      ELSE '>3d'
    END AS scan_lag,
    COUNT(*) AS channels
  FROM ingested_channels
  WHERE ingest_enabled = 1
  GROUP BY scan_lag
  ORDER BY CASE scan_lag
    WHEN '<6h' THEN 1 WHEN '6-24h' THEN 2 WHEN '1-3d' THEN 3
    WHEN '>3d' THEN 4 ELSE 5 END`));
mark('rss scan lag done');
