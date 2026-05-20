'use strict';

// Inspect a backup file using a direct connection (bypasses app init).
// Usage: node scripts/inspectBackup.js <backup-filename>

const fs   = require('fs');
const path = require('path');
const Database = require('node-sqlite3-wasm').Database;

const backupFile = process.argv[2] || 'scoring.db.pre_recovery';
const BACKUP_PATH = path.isAbsolute(backupFile) ? backupFile : path.join(__dirname, '../data', backupFile);

if (!fs.existsSync(BACKUP_PATH)) {
  console.error(`Not found: ${BACKUP_PATH}`);
  process.exit(1);
}

function tryCount(db, table) {
  try { return db.get(`SELECT COUNT(*) AS n FROM "${table}"`).n; }
  catch (_) { return 'unreadable'; }
}

function trySample(db, table) {
  try {
    const rows = db.all(`SELECT * FROM "${table}" LIMIT 5`);
    return rows.length > 0 ? `readable (sample: ${rows.length} rows)` : 'empty';
  } catch (e) { return `UNREADABLE: ${e.message.slice(0, 60)}`; }
}

const TABLES = [
  'corpus_channels', 'ingested_channels', 'ingested_videos',
  'video_growth_snapshots', 'channel_topics', 'niche_benchmarks',
  'saved_workspaces', 'feedback', 'semantic_clusters',
];

async function main() {
  console.log(`\nFile: ${backupFile}`);
  console.log(`Size: ${(fs.statSync(BACKUP_PATH).size / 1024 / 1024 / 1024).toFixed(2)} GB\n`);

  const db = new Database(BACKUP_PATH);

  console.log('Table                    Count         Read test');
  console.log('─'.repeat(70));
  for (const table of TABLES) {
    const count  = tryCount(db, table);
    const sample = trySample(db, table);
    console.log(`${table.padEnd(25)} ${String(count).padStart(10)}    ${sample}`);
  }

  db.close();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
