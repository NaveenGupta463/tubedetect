/**
 * DB Recovery Script
 * Run this ONLY when the server is stopped.
 *   node server/scripts/recover-db.js
 *
 * Steps:
 *   1. Backup current scoring.db
 *   2. Delete stale journal (rolls back any incomplete transaction)
 *   3. Open DB and run integrity_check
 *   4. VACUUM INTO a clean copy
 *   5. If clean copy is good, swap it in as scoring.db
 */

const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs   = require('fs');

const DATA_DIR      = path.resolve(__dirname, '../data');
const DB_PATH       = path.resolve(DATA_DIR, 'scoring.db');
const JOURNAL_PATH  = DB_PATH + '-journal';
const LOCK_PATH     = DB_PATH + '.lock';
const BACKUP_PATH   = DB_PATH + `.bak_${Date.now()}`;
const CLEAN_PATH    = DB_PATH + '.recovered';

console.log('=== TubeIntel DB Recovery ===');
console.log('DB_PATH:', DB_PATH);

if (!fs.existsSync(DB_PATH)) {
  console.error('FATAL: scoring.db not found at', DB_PATH);
  process.exit(1);
}

// Step 1: Backup
console.log('\n[1/5] Backing up DB…');
fs.copyFileSync(DB_PATH, BACKUP_PATH);
const backupSize = fs.statSync(BACKUP_PATH).size;
console.log(`      Backup written: ${BACKUP_PATH} (${(backupSize / 1e6).toFixed(1)} MB)`);

// Step 2: Remove stale journal and lock
console.log('\n[2/5] Removing stale journal / lock…');
if (fs.existsSync(JOURNAL_PATH)) {
  fs.rmSync(JOURNAL_PATH);
  console.log('      Removed:', JOURNAL_PATH);
} else {
  console.log('      No journal file found.');
}
if (fs.existsSync(LOCK_PATH)) {
  fs.rmSync(LOCK_PATH, { recursive: true, force: true });
  console.log('      Removed lock:', LOCK_PATH);
}

// Step 3: Open DB and check integrity
console.log('\n[3/5] Opening DB and running integrity_check…');
let db;
try {
  db = new Database(DB_PATH);
} catch (e) {
  console.error('FATAL: Could not open DB:', e.message);
  process.exit(1);
}

let integrityOk = false;
try {
  const rows = db.all('PRAGMA integrity_check(50)');
  const bad  = rows.filter(r => (r.integrity_check ?? Object.values(r)[0]) !== 'ok');
  if (bad.length === 0) {
    integrityOk = true;
    console.log('      integrity_check: OK');
  } else {
    console.warn('      integrity_check: FAILED — issues found:');
    bad.slice(0, 10).forEach(r => console.warn('       -', r.integrity_check ?? Object.values(r)[0]));
    if (bad.length > 10) console.warn(`       … and ${bad.length - 10} more`);
  }
} catch (e) {
  console.error('      integrity_check threw:', e.message);
}

// Step 4: VACUUM INTO clean copy
console.log('\n[4/5] VACUUM INTO clean copy…');
if (fs.existsSync(CLEAN_PATH)) fs.rmSync(CLEAN_PATH);

let vacuumOk = false;
try {
  // Use forward slashes — node-sqlite3-wasm / WASM SQLite is sensitive to backslashes
  const cleanSlash = CLEAN_PATH.replace(/\\/g, '/');
  db.exec(`VACUUM INTO '${cleanSlash}'`);
  vacuumOk = true;
  const cleanSize = fs.statSync(CLEAN_PATH).size;
  console.log(`      VACUUM OK — clean copy: ${CLEAN_PATH} (${(cleanSize / 1e6).toFixed(1)} MB)`);
} catch (e) {
  console.error('      VACUUM INTO failed:', e.message);
  console.warn('      The DB may be too corrupt for VACUUM. Falling back to table-dump approach…');
}

db.close();

// Step 5: Swap if clean copy was created
if (vacuumOk) {
  console.log('\n[5/5] Swapping recovered DB into place…');
  fs.renameSync(DB_PATH, DB_PATH + '.pre_recovery');
  fs.renameSync(CLEAN_PATH, DB_PATH);
  console.log('      Done! scoring.db replaced with clean copy.');
  console.log('      Original preserved at:', DB_PATH + '.pre_recovery');
  console.log('\n✓ Recovery complete. You can now restart the server.');
} else {
  console.log('\n[5/5] SKIPPED — VACUUM failed. Manual recovery needed.');
  console.log('      Backup is at:', BACKUP_PATH);
  console.log('      Try: sqlite3 scoring.db ".recover" | sqlite3 scoring.db.new');
  console.log('      (Requires SQLite CLI installed)');
  process.exit(1);
}
