'use strict';

// Recovery script — uses the app's own DB init (which handles schema corruption)
// to read each table and rebuild a clean DB.
// Run with server STOPPED: node scripts/recoverDb.js

require('dotenv').config({ path: __dirname + '/../.env' });

const fs   = require('fs');
const path = require('path');
const Database = require('node-sqlite3-wasm').Database;

const DATA_DIR   = path.join(__dirname, '../data');
const DB_PATH    = path.join(DATA_DIR, 'scoring.db');
const NEW_PATH   = path.join(DATA_DIR, 'scoring.db.recovered');

// All known tables in this codebase (order matters — FK dependencies)
const TABLES = [
  'videos', 'features', 'performance_metrics',
  'channel_cache',
  'corpus_channels',
  'ingested_channels',
  'ingested_videos',
  'growth_snapshots',
  'channel_topics',
  'channel_signals',
  'saved_workspaces',
  'feedback',
  'training_runs',
  'benchmarks',
  'niche_benchmarks',
  'video_outcome_reality',
  'recommendation_actions',
  'experiments',
  'experiment_runs',
  'embedding_queue',
  'semantic_clusters',
  'cluster_assignments',
  'cluster_snapshots',
  'attention_ecology_log',
  'intelligence_events',
  'community_summaries',
  'learning_snapshots',
  'learning_cohorts',
  'drift_log',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tryRead(db, sql, params = []) {
  try { return db.all(sql, params); }
  catch (_) { return null; }
}

async function main() {
  // 1. Use the app's getDb() — this handles schema init + corruption gracefully
  console.log('[recover] Opening source DB via app init…');
  const { getDb } = require('../db/init');
  const src = getDb();

  // 2. Verify we can read something meaningful
  const chCount = tryRead(src, 'SELECT COUNT(*) AS n FROM ingested_channels');
  if (chCount) {
    console.log(`[recover] Source readable — ingested_channels: ${chCount[0].n} rows`);
  } else {
    console.error('[recover] Cannot read ingested_channels — DB may be fully unreadable');
  }

  // 3. Create fresh destination DB
  if (fs.existsSync(NEW_PATH)) fs.unlinkSync(NEW_PATH);
  console.log(`[recover] Creating fresh DB at ${NEW_PATH}…`);
  const dst = new Database(NEW_PATH);
  dst.run('PRAGMA journal_mode=DELETE');
  dst.run('PRAGMA synchronous=NORMAL');

  // 4. Copy schema from source into destination
  console.log('[recover] Copying schema…');
  const schemaSql = tryRead(src, "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rootpage");
  if (schemaSql) {
    dst.run('BEGIN');
    for (const { sql } of schemaSql) {
      try { dst.run(sql); } catch (_) {}
    }
    dst.run('COMMIT');
    console.log(`[recover] Schema: ${schemaSql.length} DDL statements copied`);
  } else {
    console.warn('[recover] Could not read schema from sqlite_master — using hardcoded schema');
    // Fallback: just let dst be a blank DB, init will recreate schema when server restarts
  }

  // 5. Copy each table row by row in batches
  let totalRows = 0;
  const BATCH = 2000;

  for (const table of TABLES) {
    // Get total count first
    const countRow = tryRead(src, `SELECT COUNT(*) AS n FROM "${table}"`);
    if (!countRow) {
      console.warn(`[recover] ${table}: unreadable (skipped)`);
      continue;
    }
    const total = countRow[0].n;
    if (total === 0) { console.log(`[recover] ${table}: empty`); continue; }

    // Read in batches by rowid to avoid loading huge tables at once
    let offset = 0, inserted = 0, failed = 0;

    // Get column names from first row
    const sample = tryRead(src, `SELECT * FROM "${table}" LIMIT 1`);
    if (!sample || !sample.length) {
      console.warn(`[recover] ${table}: no sample row`);
      continue;
    }
    const cols   = Object.keys(sample[0]);
    const colStr = cols.map(c => `"${c}"`).join(', ');
    const vals   = cols.map(() => '?').join(', ');
    const ins    = `INSERT OR IGNORE INTO "${table}" (${colStr}) VALUES (${vals})`;

    while (offset < total) {
      let rows;
      try {
        rows = src.all(`SELECT * FROM "${table}" LIMIT ${BATCH} OFFSET ${offset}`);
      } catch (_) {
        failed += Math.min(BATCH, total - offset);
        offset += BATCH;
        continue;
      }
      if (!rows.length) break;

      dst.run('BEGIN');
      for (const row of rows) {
        try {
          dst.run(ins, cols.map(c => row[c] ?? null));
          inserted++;
        } catch (_) { failed++; }
      }
      dst.run('COMMIT');
      offset += rows.length;
    }

    const status = failed > 0 ? ` (${failed} failed)` : '';
    console.log(`[recover] ${table}: ${inserted}/${total} rows${status}`);
    totalRows += inserted;
  }

  dst.close();

  console.log(`\n[recover] ══════════════════════════════════════`);
  console.log(`[recover] Done — ${totalRows} total rows recovered`);
  console.log(`[recover] Recovered DB: data/scoring.db.recovered`);
  console.log(`[recover]`);
  console.log(`[recover] To apply (run these commands):`);
  console.log(`[recover]   copy data\\scoring.db data\\scoring.db.corrupt_backup`);
  console.log(`[recover]   copy data\\scoring.db.recovered data\\scoring.db`);
  console.log(`[recover]   Then restart the server.`);
}

main().catch(e => { console.error('[recover] Fatal:', e.message, e.stack); process.exit(1); });
