'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb, closeDb } = require('../db/init');

const since = process.argv[2] || '2026-06-04 08:45:51';
const db = getDb();

function tableExists(name) {
  return !!db.get(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    [name],
  );
}

const snapshotTables = db
  .all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%snapshot%' ORDER BY name")
  .map(r => r.name);

console.log('since:', since);
console.log('snapshot_tables:', snapshotTables);
for (const table of snapshotTables) {
  const n = db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
  const cols = db.all(`PRAGMA table_info(${table})`).map(c => c.name);
  console.log(`${table}:`, n, cols.join(','));
}

const promoted = db.get(
  `SELECT COUNT(*) AS n
   FROM corpus_channels
   WHERE auto_promoted_at >= ?`,
  [since],
)?.n ?? 0;

const ingestedCols = db.all('PRAGMA table_info(ingested_channels)').map(c => c.name);
const ingestedTimeCol = ['created_at', 'updated_at', 'added_at', 'ingested_at']
  .find(c => ingestedCols.includes(c));
const ingested = ingestedTimeCol
  ? (db.get(
      `SELECT COUNT(*) AS n
       FROM ingested_channels
       WHERE ${ingestedTimeCol} >= ?`,
      [since],
    )?.n ?? 0)
  : null;

console.log('new_auto_promoted_since:', promoted);
console.log('ingested_created_or_updated_since:', ingested);

if (tableExists('video_growth_snapshots')) {
  const snapCols = db.all('PRAGMA table_info(video_growth_snapshots)').map(c => c.name);
  console.log('video_growth_snapshots_time_columns:', snapCols.filter(c => /snapshot|created|captured|at$/.test(c)));
}

const videoCols = db.all('PRAGMA table_info(ingested_videos)').map(c => c.name);
if (videoCols.includes('ingested_at') && videoCols.includes('last_refreshed_at')) {
  const newVideoRefresh = db.get(
    `SELECT COUNT(*) AS total,
            COUNT(DISTINCT channel_id) AS channels,
            SUM(CASE WHEN last_refreshed_at IS NOT NULL THEN 1 ELSE 0 END) AS refreshed_any,
            SUM(CASE WHEN last_refreshed_at >= ? THEN 1 ELSE 0 END) AS refreshed_since
     FROM ingested_videos
     WHERE ingested_at >= ?`,
    [since, since],
  );
  console.log('newly_ingested_video_refresh_status:', newVideoRefresh);
}

closeDb();
