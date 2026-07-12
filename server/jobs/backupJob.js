'use strict';

const fs   = require('fs');
const path = require('path');
const cron = require('node-cron');

const DATA_DIR    = path.resolve(__dirname, '../data');
const LOCAL_DIR   = path.join(DATA_DIR, 'backups');
const DB_PATH     = path.join(DATA_DIR, 'scoring.db');
const LOCAL_KEEP  = 1; // rolling local backups to retain
const MIN_FREE_AFTER_BACKUP = 2 * 1024 * 1024 * 1024; // keep 2 GB breathing room

// Matches scoring_YYYY-MM-DD.db only — never scoring.db, WAL files, or anything else.
const BACKUP_RE = /^scoring_\d{4}-\d{2}-\d{2}\.db$/;

function todayStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function listBackups() {
  try {
    return fs.readdirSync(LOCAL_DIR).filter(f => BACKUP_RE.test(f)).sort();
  } catch (_) {
    return [];
  }
}

function deleteBackupSidecars(dir, dbFile) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = path.join(dir, dbFile + suffix);
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
}

function formatMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(0) + ' MB';
}

function availableBytes(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stat = fs.statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch (_) {
    return null;
  }
}

function hasSpaceForCopy(dir, bytesNeeded, label) {
  const free = availableBytes(dir);
  if (free == null) return true;
  if (free - bytesNeeded >= MIN_FREE_AFTER_BACKUP) return true;
  console.warn(
    `[backup] ${label}: not enough disk space for ${formatMb(bytesNeeded)} copy ` +
    `(free=${formatMb(free)}, required headroom=${formatMb(MIN_FREE_AFTER_BACKUP)})`,
  );
  return false;
}

function deleteBackupsForSpace(dir, keepDbFiles = []) {
  const keep = new Set(keepDbFiles);
  let deleted = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!BACKUP_RE.test(f) || keep.has(f)) continue;
    const full = path.join(dir, f);
    const size = (() => {
      try { return fs.statSync(full).size; } catch (_) { return 0; }
    })();
    fs.unlinkSync(full);
    deleteBackupSidecars(dir, f);
    deleted++;
    console.log(`[backup] Space guard: deleted ${f} (${formatMb(size)})`);
  }
  return deleted;
}

function pruneOrphanSidecars(dir, keepDbFiles = []) {
  const keep = new Set(keepDbFiles);
  let deleted = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/^scoring_\d{4}-\d{2}-\d{2}\.db-(wal|shm)$/.test(f)) continue;
    const dbFile = f.replace(/-(wal|shm)$/, '');
    if (keep.has(dbFile)) continue;
    fs.unlinkSync(path.join(dir, f));
    deleted++;
    console.log(`[backup] Prune: deleted orphan sidecar ${f}`);
  }
  return deleted;
}

function lastLocalBackupDate() {
  const files = listBackups();
  if (!files.length) return null;
  const last = files[files.length - 1];
  return last.replace('scoring_', '').replace('.db', ''); // YYYY-MM-DD
}

// Prune local backups beyond LOCAL_KEEP. Pass dryRun=true to only log without deleting.
function pruneLocalBackups(dryRun = false) {
  const files    = listBackups();
  const excess   = Math.max(0, files.length - LOCAL_KEEP);
  const toDelete = files.slice(0, excess);

  if (!toDelete.length) {
    console.log(`[backup] Prune: ${files.length} backups present — nothing to remove (keep=${LOCAL_KEEP})`);
    return { kept: files.slice(excess), deleted: [] };
  }

  console.log(`[backup] Prune: ${files.length} backups present, keeping latest ${LOCAL_KEEP}, removing ${toDelete.length}:`);
  for (const f of toDelete) {
    const sizeMb = (() => {
      try { return (fs.statSync(path.join(LOCAL_DIR, f)).size / 1024 / 1024).toFixed(0) + ' MB'; } catch (_) { return '?'; }
    })();
    if (dryRun) {
      console.log(`[backup] Prune (dry-run): would delete ${f} (${sizeMb})`);
    } else {
      fs.unlinkSync(path.join(LOCAL_DIR, f));
      deleteBackupSidecars(LOCAL_DIR, f);
      console.log(`[backup] Prune: deleted ${f} (${sizeMb})`);
    }
  }

  const kept = files.slice(excess);
  if (!dryRun) pruneOrphanSidecars(LOCAL_DIR, kept);
  return { kept, deleted: toDelete };
}

function runBackup() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.warn('[backup] scoring.db not found — skipping');
      return;
    }

    const stamp = todayStamp();
    const dbBytes = fs.statSync(DB_PATH).size;

    // ── Local rolling backup ──────────────────────────────────────────────────
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const localDest = path.join(LOCAL_DIR, `scoring_${stamp}.db`);
    if (!hasSpaceForCopy(LOCAL_DIR, dbBytes, 'Local')) {
      deleteBackupsForSpace(LOCAL_DIR, [`scoring_${stamp}.db`]);
    }
    if (!hasSpaceForCopy(LOCAL_DIR, dbBytes, 'Local')) {
      console.warn('[backup] Local: skipped backup because disk space is still too low after pruning');
      return;
    }
    fs.copyFileSync(DB_PATH, localDest);
    const mb = (fs.statSync(localDest).size / 1024 / 1024).toFixed(0);
    console.log(`[backup] Local: saved scoring_${stamp}.db (${mb} MB)`);

    // Prune oldest local backups beyond LOCAL_KEEP
    pruneLocalBackups(false);

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

  // Avoid creating a large DB copy on every server restart. The scheduled local
  // backup is enough; external-drive copies are handled manually.
  console.log('[backup] Startup catch-up disabled — waiting for scheduled local backup');
}

module.exports = { startBackupCron, runBackup, pruneLocalBackups, listBackups };
