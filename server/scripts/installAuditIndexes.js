'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scoring.db');
const db = new Database(dbPath, { timeout: 120_000 });

const indexes = [
  {
    name: 'idx_iv_ingested_at',
    sql:  'CREATE INDEX IF NOT EXISTS idx_iv_ingested_at ON ingested_videos(ingested_at)',
  },
  {
    name: 'idx_iv_ingested_at_channel',
    sql:  'CREATE INDEX IF NOT EXISTS idx_iv_ingested_at_channel ON ingested_videos(ingested_at, channel_id)',
  },
  {
    name: 'idx_ic_rss_scan',
    sql:  'CREATE INDEX IF NOT EXISTS idx_ic_rss_scan ON ingested_channels(ingest_enabled, last_rss_scan_at)',
  },
  {
    name: 'idx_vgs_bucket_age',
    sql:  'CREATE INDEX IF NOT EXISTS idx_vgs_bucket_age ON video_growth_snapshots(bucket, age_hours_at_snapshot)',
  },
];

function now() { return new Date().toISOString(); }

console.log(`[audit-indexes] Starting at ${now()}`);
console.log(`[audit-indexes] DB: ${dbPath}`);

try {
  db.pragma('busy_timeout = 120000');
  db.exec('PRAGMA wal_checkpoint(PASSIVE)');
} catch (e) {
  console.warn('[audit-indexes] pre-checkpoint skipped:', e.message);
}

for (const idx of indexes) {
  const started = Date.now();
  console.log(`[audit-indexes] Creating ${idx.name}...`);
  try {
    db.exec(idx.sql);
    console.log(`[audit-indexes] ${idx.name} ready in ${Date.now() - started}ms`);
  } catch (e) {
    console.error(`[audit-indexes] ${idx.name} failed:`, e.message);
    process.exitCode = 1;
    break;
  }
}

try {
  db.exec('PRAGMA wal_checkpoint(PASSIVE)');
} catch (e) {
  console.warn('[audit-indexes] post-checkpoint skipped:', e.message);
}

console.log(`[audit-indexes] Done at ${now()}`);
