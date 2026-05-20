'use strict';

// Merges video_growth_snapshots from a backup into the current scoring.db.
// Run with server STOPPED.
// Usage: node scripts/mergeSnapshotsFromBackup.js <backup-path>

const fs   = require('fs');
const path = require('path');
const Database = require('node-sqlite3-wasm').Database;

const DATA      = path.join(__dirname, '../data');
const backupArg = process.argv[2];
const BACKUP    = backupArg
  ? (path.isAbsolute(backupArg) ? backupArg : path.join(DATA, backupArg))
  : null;
// Use a working copy to avoid Windows file-handle lock on scoring.db.
// After merge completes, rename scoring.db.snap_work → scoring.db.
const TARGET_ARG = process.argv[3];
const TARGET    = TARGET_ARG
  ? (path.isAbsolute(TARGET_ARG) ? TARGET_ARG : path.join(DATA, TARGET_ARG))
  : path.join(DATA, 'scoring.db.snap_work');

if (!BACKUP) { console.error('Usage: node scripts/mergeSnapshotsFromBackup.js <backup-path> [target-path]'); process.exit(1); }
if (!fs.existsSync(BACKUP)) { console.error('Backup not found:', BACKUP); process.exit(1); }

// If target doesn't exist yet, copy scoring.db into it so we work on a fresh copy
const LIVE_DB = path.join(DATA, 'scoring.db');
if (!fs.existsSync(TARGET)) {
  if (!fs.existsSync(LIVE_DB)) { console.error('scoring.db not found:', LIVE_DB); process.exit(1); }
  console.log(`[merge-snap] Copying scoring.db → ${path.basename(TARGET)} …`);
  fs.copyFileSync(LIVE_DB, TARGET);
  console.log('[merge-snap] Copy done.');
}

const BATCH = 2000;

async function main() {
  console.log('[merge-snap] Opening backup…');
  const src = new Database(BACKUP);

  console.log('[merge-snap] Opening target DB…');
  const dst = new Database(TARGET);
  dst.run('PRAGMA synchronous=NORMAL');

  const total    = src.get('SELECT COUNT(*) AS n FROM video_growth_snapshots').n;
  const existing = dst.get('SELECT COUNT(*) AS n FROM video_growth_snapshots').n;
  console.log(`[merge-snap] Backup has: ${total.toLocaleString()} snapshots`);
  console.log(`[merge-snap] Target has: ${existing.toLocaleString()} snapshots`);

  const sample = src.all('SELECT * FROM video_growth_snapshots LIMIT 1');
  if (!sample.length) { console.log('[merge-snap] No rows.'); src.close(); dst.close(); return; }

  const cols   = Object.keys(sample[0]);
  const colStr = cols.map(c => `"${c}"`).join(', ');
  const vals   = cols.map(() => '?').join(', ');
  const ins    = `INSERT OR IGNORE INTO video_growth_snapshots (${colStr}) VALUES (${vals})`;

  let inserted = 0, lastRowid = 0;

  while (true) {
    let rows;
    try {
      rows = src.all(`SELECT *, rowid FROM video_growth_snapshots WHERE rowid > ${lastRowid} ORDER BY rowid LIMIT ${BATCH}`);
    } catch (e) {
      console.warn(`[merge-snap] Read error at rowid>${lastRowid}: ${e.message} — skipping batch`);
      lastRowid += BATCH;
      continue;
    }
    if (!rows.length) break;

    dst.run('BEGIN');
    for (const row of rows) {
      try {
        dst.run(ins, cols.map(c => row[c] ?? null));
        inserted++;
      } catch (_) {}
    }
    dst.run('COMMIT');

    lastRowid = rows[rows.length - 1].rowid;

    if (inserted % 100000 < BATCH) {
      console.log(`[merge-snap] Progress: ${inserted.toLocaleString()} inserted…`);
    }
  }

  src.close();
  dst.close();

  console.log(`\n[merge-snap] Done — ${inserted.toLocaleString()} snapshots merged`);
  console.log(`[merge-snap] Target now has ${(existing + inserted).toLocaleString()} snapshots`);
  if (TARGET !== LIVE_DB) {
    console.log('\n[merge-snap] Now swap the working copy into place:');
    console.log(`[merge-snap]   copy data\\scoring.db data\\scoring.db.pre_snap`);
    console.log(`[merge-snap]   copy data\\scoring.db.snap_work data\\scoring.db`);
    console.log('[merge-snap]   del data\\scoring.db.snap_work');
    console.log('[merge-snap]   Then restart the server.');
  } else {
    console.log('[merge-snap] Restart the server.');
  }
}

main().catch(e => { console.error('[merge-snap] Fatal:', e.message); process.exit(1); });
