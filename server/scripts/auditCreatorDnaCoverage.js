'use strict';

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openReadonlyDb() {
  const db = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    fileMustExist: true,
    timeout: 60000,
  });
  db.pragma('query_only = ON');
  db.pragma('busy_timeout = 60000');
  return db;
}

function rows(db, sql) {
  return db.prepare(sql).all();
}

function main() {
  const db = openReadonlyDb();
  const enabled = rows(db, `
    SELECT channel_id
      FROM ingested_channels
     WHERE ingest_enabled = 1
       AND channel_id IS NOT NULL
  `).map(r => r.channel_id);

  const videoChannels = rows(db, `
    SELECT DISTINCT channel_id
      FROM ingested_videos
     WHERE channel_id IS NOT NULL
       AND title IS NOT NULL
       AND title != ''
  `).map(r => r.channel_id);

  const dnaRows = rows(db, `SELECT channel_id, confidence FROM creator_idea_dna`);
  const enabledSet = new Set(enabled);
  const videoSet = new Set(videoChannels);
  const dnaSet = new Set(dnaRows.map(r => r.channel_id));
  const eligible = [...enabledSet].filter(id => videoSet.has(id));
  const eligibleWithDna = eligible.filter(id => dnaSet.has(id));
  const missing = eligible.filter(id => !dnaSet.has(id));
  const confidence = {};
  for (const row of dnaRows) {
    const key = row.confidence || 'unknown';
    confidence[key] = (confidence[key] || 0) + 1;
  }

  const snapshots = db.prepare(`SELECT COUNT(*) AS n FROM creator_idea_dna_snapshots`).get().n;
  const out = {
    ingested_enabled: enabled.length,
    channels_with_stored_titles_all: videoChannels.length,
    eligible_enabled_with_titles: eligible.length,
    creator_idea_dna_rows: dnaRows.length,
    eligible_with_dna: eligibleWithDna.length,
    eligible_missing_dna: missing.length,
    coverage_pct: +((eligibleWithDna.length / Math.max(eligible.length, 1)) * 100).toFixed(2),
    confidence,
    snapshots,
    missing_sample: missing.slice(0, 10),
  };

  console.log(JSON.stringify(out, null, 2));
  db.close();
}

try {
  main();
} catch (e) {
  console.error('[creator-dna-coverage] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}
