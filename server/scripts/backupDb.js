'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const BACKUP_DIR = path.join(process.env.USERPROFILE || 'C:\\Users\\bd', 'OneDrive', 'TubeIntel Backups');
const KEEP_DAYS  = 7;

function run() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[backup] DB not found at', DB_PATH);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const date     = new Date().toISOString().slice(0, 10);
  const destName = `scoring_${date}.db`;
  const destPath = path.join(BACKUP_DIR, destName);

  fs.copyFileSync(DB_PATH, destPath);
  console.log('[backup] Copied to', destPath);

  // Also copy WAL/SHM files if they exist (ensures consistent snapshot)
  for (const ext of ['-wal', '-shm']) {
    const src = DB_PATH + ext;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, destPath + ext);
    }
  }

  // Prune backups older than KEEP_DAYS
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.startsWith('scoring_') || !f.endsWith('.db')) continue;
    const full = path.join(BACKUP_DIR, f);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      pruned++;
    }
  }

  if (pruned > 0) console.log('[backup] Pruned', pruned, 'old backup(s)');
  console.log('[backup] Done.');
}

run();
