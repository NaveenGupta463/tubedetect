'use strict';

// Merges ingested_videos from a backup file into scoring.db.recovered.
// Run with server STOPPED.
// Usage: node scripts/mergeVideosFromBackup.js

const fs   = require('fs');
const path = require('path');
const Database = require('node-sqlite3-wasm').Database;

const DATA       = path.join(__dirname, '../data');
const backupArg  = process.argv[2];
const BACKUP     = backupArg
  ? (path.isAbsolute(backupArg) ? backupArg : path.join(DATA, backupArg))
  : path.join(DATA, 'scoring.db.pre_recovery');
const RECOVERED  = path.join(DATA, 'scoring.db.recovered');

if (!fs.existsSync(BACKUP))    { console.error('Backup not found:', BACKUP);    process.exit(1); }
if (!fs.existsSync(RECOVERED)) { console.error('Recovered DB not found:', RECOVERED); process.exit(1); }

const BATCH = 1000;

async function main() {
  console.log('[merge] Opening backup (source)…');
  const src = new Database(BACKUP);

  console.log('[merge] Opening recovered DB (destination)…');
  const dst = new Database(RECOVERED);
  dst.run('PRAGMA synchronous=NORMAL');

  // Count source rows
  const total = src.get('SELECT COUNT(*) AS n FROM ingested_videos').n;
  console.log(`[merge] ingested_videos in backup: ${total.toLocaleString()}`);

  const existing = dst.get('SELECT COUNT(*) AS n FROM ingested_videos').n;
  console.log(`[merge] ingested_videos already in recovered: ${existing.toLocaleString()}`);

  // Get column list from backup
  const sample = src.all('SELECT * FROM ingested_videos LIMIT 1');
  if (!sample.length) { console.log('[merge] No rows to copy.'); src.close(); dst.close(); return; }
  const cols   = Object.keys(sample[0]);
  const colStr = cols.map(c => `"${c}"`).join(', ');
  const vals   = cols.map(() => '?').join(', ');
  const ins    = `INSERT OR IGNORE INTO ingested_videos (${colStr}) VALUES (${vals})`;

  let inserted = 0, skipped = 0, lastRowid = 0;

  while (true) {
    let rows;
    try {
      rows = src.all(`SELECT * FROM ingested_videos WHERE rowid > ${lastRowid} ORDER BY rowid LIMIT ${BATCH}`);
    } catch (e) {
      console.warn(`[merge] Read error at rowid>${lastRowid}: ${e.message}`);
      lastRowid += BATCH;
      continue;
    }
    if (!rows.length) break;

    dst.run('BEGIN');
    for (const row of rows) {
      try {
        dst.run(ins, cols.map(c => row[c] ?? null));
        inserted++;
      } catch (_) { skipped++; }
    }
    dst.run('COMMIT');

    // Track last rowid for next batch
    const lastRow = rows[rows.length - 1];
    lastRowid = src.get(`SELECT rowid FROM ingested_videos WHERE youtube_video_id = ? LIMIT 1`,
      [lastRow.youtube_video_id])?.rowid ?? (lastRowid + BATCH);

    if (inserted % 10000 < BATCH) {
      console.log(`[merge] Progress: ${inserted.toLocaleString()} inserted…`);
    }
  }

  src.close();
  dst.close();

  console.log(`\n[merge] ══════════════════════════════`);
  console.log(`[merge] Done — ${inserted.toLocaleString()} videos merged, ${skipped.toLocaleString()} skipped (duplicates)`);
  console.log(`[merge] scoring.db.recovered now has ${(existing + inserted).toLocaleString()} ingested_videos`);
  console.log(`\n[merge] Now apply the swap:`);
  console.log(`[merge]   copy data\\scoring.db data\\scoring.db.corrupt_backup`);
  console.log(`[merge]   copy data\\scoring.db.recovered data\\scoring.db`);
  console.log(`[merge]   Then restart the server.`);
}

main().catch(e => { console.error('[merge] Fatal:', e.message); process.exit(1); });
