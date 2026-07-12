'use strict';

const path = require('path');
const DB = require('../node_modules/better-sqlite3');

const cutoff = process.argv[2] || '1970-01-01 00:00:00';
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), {
  readonly: true,
  fileMustExist: true,
  timeout: 60000,
});

console.log('cutoff', cutoff);

console.log('HISTORICAL_SELECTOR_BACKLOG');
console.table(db.prepare(`
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN ingest_enabled = 1 THEN 1 ELSE 0 END) AS enabled,
         SUM(CASE WHEN ingest_enabled = 1 AND last_ingested_at IS NULL THEN 1 ELSE 0 END) AS enabled_never_ingested,
         SUM(CASE WHEN ingest_enabled = 1 AND last_ingested_at IS NOT NULL THEN 1 ELSE 0 END) AS enabled_already_ingested
  FROM ingested_channels
`).all());

console.log('RUN_PROGRESS');
console.table(db.prepare(`
  SELECT COUNT(*) AS channels_ingested_since_cutoff,
         MIN(last_ingested_at) AS first_ingested,
         MAX(last_ingested_at) AS last_ingested
  FROM ingested_channels
  WHERE last_ingested_at >= ?
`).all(cutoff));

console.log('ENABLED_NEVER_INGESTED_BY_SOURCE');
console.table(db.prepare(`
  SELECT COALESCE(added_by, 'unknown') AS added_by, COUNT(*) AS n
  FROM ingested_channels
  WHERE ingest_enabled = 1 AND last_ingested_at IS NULL
  GROUP BY COALESCE(added_by, 'unknown')
  ORDER BY n DESC
  LIMIT 20
`).all());

console.log('ENABLED_NEVER_INGESTED_BY_NICHE');
console.table(db.prepare(`
  SELECT COALESCE(primary_niche, niche, 'unknown') AS niche, COUNT(*) AS n
  FROM ingested_channels
  WHERE ingest_enabled = 1 AND last_ingested_at IS NULL
  GROUP BY COALESCE(primary_niche, niche, 'unknown')
  ORDER BY n DESC
  LIMIT 20
`).all());

console.log('RECENTLY_INGESTED_SAMPLE');
console.table(db.prepare(`
  SELECT channel_name, channel_id, COALESCE(primary_niche, niche) AS niche,
         channel_subscribers, added_by, last_ingested_at
  FROM ingested_channels
  WHERE last_ingested_at >= ?
  ORDER BY last_ingested_at DESC
  LIMIT 20
`).all(cutoff));

db.close();
