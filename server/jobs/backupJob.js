'use strict';

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

const DATA_DIR    = path.resolve(__dirname, '../data');
const LOCAL_DIR   = path.join(DATA_DIR, 'backups');
const ONEDRIVE_DIR = 'C:\\Users\\bd\\OneDrive\\TubeIntel Backups';
const DB_PATH     = path.join(DATA_DIR, 'scoring.db');
const LOCAL_KEEP  = 7; // rolling local backups to retain

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function lastLocalBackupDate() {
  try {
    const files = fs.readdirSync(LOCAL_DIR)
      .filter(f => f.startsWith('scoring_') && f.endsWith('.db'))
      .sort();
    if (!files.length) return null;
    const last = files[files.length - 1];
    return last.replace('scoring_', '').replace('.db', ''); // YYYY-MM-DD
  } catch (_) {
    return null;
  }
}

function runBackup() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.warn('[backup] scoring.db not found — skipping');
      return;
    }

    const stamp = todayStamp();

    // ── Local rolling backup ──────────────────────────────────────────────────
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const localDest = path.join(LOCAL_DIR, `scoring_${stamp}.db`);
    fs.copyFileSync(DB_PATH, localDest);
    const mb = (fs.statSync(localDest).size / 1024 / 1024).toFixed(0);
    console.log(`[backup] Local: saved scoring_${stamp}.db (${mb} MB)`);

    // Prune oldest local backups beyond LOCAL_KEEP
    const localFiles = fs.readdirSync(LOCAL_DIR)
      .filter(f => f.startsWith('scoring_') && f.endsWith('.db'))
      .sort();
    const toPrune = localFiles.slice(0, Math.max(0, localFiles.length - LOCAL_KEEP));
    for (const f of toPrune) {
      fs.unlinkSync(path.join(LOCAL_DIR, f));
      console.log(`[backup] Local: pruned ${f}`);
    }

    // ── OneDrive backup — keep only the latest file ───────────────────────────
    try {
      fs.mkdirSync(ONEDRIVE_DIR, { recursive: true });
      const oneDriveDest = path.join(ONEDRIVE_DIR, `scoring_${stamp}.db`);

      // Copy new backup first, then delete old ones (never leave OneDrive empty)
      fs.copyFileSync(DB_PATH, oneDriveDest);
      console.log(`[backup] OneDrive: saved scoring_${stamp}.db (${mb} MB)`);

      const oldFiles = fs.readdirSync(ONEDRIVE_DIR)
        .filter(f => f.startsWith('scoring_') && f.endsWith('.db') && f !== `scoring_${stamp}.db`);
      for (const f of oldFiles) {
        fs.unlinkSync(path.join(ONEDRIVE_DIR, f));
        console.log(`[backup] OneDrive: deleted old backup ${f}`);
      }
    } catch (e) {
      console.warn('[backup] OneDrive backup failed (OneDrive may be unavailable):', e.message);
    }
  } catch (e) {
    console.error('[backup] Backup failed:', e.message);
  }
}

function runStartupBackupIfNeeded() {
  const lastDate = lastLocalBackupDate();
  const today    = todayStamp();
  if (lastDate === today) {
    console.log(`[backup] Already backed up today (${today}) — skipping startup backup`);
    return;
  }
  const msg = lastDate
    ? `[backup] Last backup was ${lastDate} — running catch-up backup now`
    : '[backup] No previous backup found — running initial backup now';
  console.log(msg);
  runBackup();
}

function startBackupCron() {
  // Run at 03:30 UTC daily — between historical ingest (03:00) and snapshot cron (04:00)
  cron.schedule('30 3 * * *', runBackup, { timezone: 'UTC' });
  console.log('[backup] Cron scheduled — daily at 03:30 UTC');

  // Catch-up: if system was down when the cron was due, back up immediately on startup
  runStartupBackupIfNeeded();
}

module.exports = { startBackupCron, runBackup };
