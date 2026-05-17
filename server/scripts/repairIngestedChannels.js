'use strict';

// Two-phase repair for ingested_channels when table data pages are corrupt:
//   Phase 1 — extract as many rows as possible using narrow column reads
//              (avoids overflow pages where corruption typically lives)
//   Phase 2 — surgically remove the corrupt table entry from sqlite_master
//              using writable_schema, then rename the clean table into place
//
// Usage: node scripts/repairIngestedChannels.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const fs   = require('fs');

const DB_PATH   = path.resolve(__dirname, '../data/scoring.db');
const LOCK_PATH = DB_PATH + '.lock';

try {
  if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH, { recursive: true, force: true });
} catch (_) {}

console.log('[repair] Opening:', DB_PATH);
const db = new Database(DB_PATH);
db.exec('PRAGMA foreign_keys=OFF');

// All 32 known columns (from PRAGMA table_info output)
const ALL_COLS = [
  'id', 'channel_id', 'channel_name', 'niche', 'uploads_playlist_id',
  'channel_subscribers', 'last_ingested_at', 'ingest_enabled', 'trust_score',
  'weight_multiplier', 'ignore_from_benchmarks', 'added_by', 'added_at', 'notes',
  'secondary_niche', 'primary_language', 'region', 'primary_niche', 'behavior_tags',
  'format_type', 'audience_style', 'identity_confidence', 'identity_reasoning',
  'identity_last_detected_at', 'identity_strength', 'identity_source', 'inferred_topics',
  'content_archetype', 'is_own_channel', 'niche_override', 'community_id', 'audience_language',
];

// Short-value columns unlikely to have SQLite overflow pages.
// (SQLite spills to overflow when a cell exceeds ~980 bytes on a 4 KB page.)
const SHORT_COLS = ALL_COLS.filter(c => ![
  'notes', 'behavior_tags', 'identity_reasoning', 'inferred_topics',
].includes(c));

function trySelect(cols, extra = '') {
  try {
    return db.all(`SELECT ${cols.join(', ')} FROM ingested_channels ${extra}`);
  } catch (_) {
    return null;
  }
}

function padRow(row, cols) {
  const full = {};
  for (const c of ALL_COLS) full[c] = row[c] ?? null;
  return full;
}

// ── Detect prior partial run ─────────────────────────────────────────────────
// A previous run may have already removed ingested_channels from sqlite_master
// but failed before renaming ingested_channels_new. Detect that state and jump
// straight to the rename phase.

const tableExists = tbl =>
  !!db.get(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, [tbl]);

if (!tableExists('ingested_channels') && tableExists('ingested_channels_new')) {
  console.log('[repair] Detected prior partial run — ingested_channels_new already exists, skipping to rename phase');
  db.close();
  try { if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH, { recursive: true, force: true }); } catch (_) {}
  const db2 = new Database(DB_PATH);
  db2.exec('PRAGMA foreign_keys=OFF');
  db2.exec('ALTER TABLE ingested_channels_new RENAME TO ingested_channels');
  db2.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ic_channel_id ON ingested_channels(channel_id)');
  db2.exec('CREATE INDEX IF NOT EXISTS idx_ic_niche   ON ingested_channels(niche)');
  db2.exec('CREATE INDEX IF NOT EXISTS idx_ic_enabled ON ingested_channels(ingest_enabled)');
  const { n } = db2.get('SELECT COUNT(*) AS n FROM ingested_channels');
  const sample = db2.get('SELECT channel_id, channel_name, niche FROM ingested_channels LIMIT 1');
  db2.close();
  console.log(`[repair] Final count: ${n} channels`);
  console.log('[repair] Sample:', sample);
  console.log('[repair] SUCCESS — restart the server.');
  process.exit(0);
}

// ── Phase 1: extract rows ────────────────────────────────────────────────────

const total = db.get('SELECT COUNT(*) AS n FROM ingested_channels').n;
console.log(`[repair] ingested_channels: ${total} rows`);

let rows = null;
let mode = '';

// Attempt A: full column set
rows = trySelect(ALL_COLS);
if (rows) { mode = 'full'; }

// Attempt B: short columns (skip overflow-prone TEXT)
if (!rows) {
  rows = trySelect(SHORT_COLS);
  if (rows) { mode = 'short-cols'; rows = rows.map(r => padRow(r, SHORT_COLS)); }
}

// Attempt C: chunked short-column scan (skips individual corrupt page ranges)
if (!rows) {
  console.log('[repair] Full reads failing — switching to chunked short-column scan...');
  const { max_r } = db.get('SELECT MAX(rowid) AS max_r FROM ingested_channels') || { max_r: 0 };
  const CHUNK = 50;
  const recovered = [];
  let skippedChunks = 0;

  for (let r = 1; r <= max_r; r += CHUNK) {
    const chunk = trySelect(SHORT_COLS, `WHERE rowid BETWEEN ${r} AND ${r + CHUNK - 1}`);
    if (chunk) {
      recovered.push(...chunk.map(row => padRow(row, SHORT_COLS)));
    } else {
      skippedChunks++;
    }
  }
  rows = recovered;
  mode = `chunked (${skippedChunks} corrupt chunks skipped)`;
}

console.log(`[repair] Extracted ${rows.length} rows via [${mode}]`);

// ── Phase 2: create clean replacement table ──────────────────────────────────

db.exec('DROP TABLE IF EXISTS ingested_channels_new');

db.exec(`
  CREATE TABLE ingested_channels_new (
    id                         TEXT,
    channel_id                 TEXT,
    channel_name               TEXT,
    niche                      TEXT,
    uploads_playlist_id        TEXT,
    channel_subscribers        INTEGER,
    last_ingested_at           TEXT,
    ingest_enabled             INTEGER DEFAULT 1,
    trust_score                REAL    DEFAULT 1.0,
    weight_multiplier          REAL    DEFAULT 1.0,
    ignore_from_benchmarks     INTEGER DEFAULT 0,
    added_by                   TEXT,
    added_at                   TEXT,
    notes                      TEXT,
    secondary_niche            TEXT,
    primary_language           TEXT,
    region                     TEXT,
    primary_niche              TEXT,
    behavior_tags              TEXT,
    format_type                TEXT,
    audience_style             TEXT,
    identity_confidence        REAL,
    identity_reasoning         TEXT,
    identity_last_detected_at  TEXT,
    identity_strength          REAL,
    identity_source            TEXT,
    inferred_topics            TEXT,
    content_archetype          TEXT,
    is_own_channel             INTEGER DEFAULT 0,
    niche_override             TEXT,
    community_id               TEXT,
    audience_language          TEXT
  )
`);

const placeholders = ALL_COLS.map(() => '?').join(', ');
const insertSql = `INSERT OR IGNORE INTO ingested_channels_new (${ALL_COLS.join(', ')}) VALUES (${placeholders})`;

db.exec('BEGIN');
let inserted = 0;
for (const row of rows) {
  const vals = ALL_COLS.map(c => row[c] ?? null);
  try { db.run(insertSql, vals); inserted++; } catch (_) {}
}
db.exec('COMMIT');
console.log(`[repair] Inserted ${inserted} rows into ingested_channels_new`);

// ── Phase 3: swap tables using writable_schema ───────────────────────────────
// DROP TABLE would traverse the corrupt B-tree to free pages — which fails.
// writable_schema lets us remove the table entry from sqlite_master directly,
// orphaning those pages (harmless wasted space, recoverable by VACUUM later).

console.log('[repair] Removing corrupt ingested_channels from sqlite_master...');
try {
  db.exec('PRAGMA writable_schema=ON');
  db.exec(`
    DELETE FROM sqlite_master
    WHERE name = 'ingested_channels'
       OR (type = 'index' AND tbl_name = 'ingested_channels')
  `);
  db.exec('PRAGMA writable_schema=OFF');
  console.log('[repair] Removed from sqlite_master');
} catch (e) {
  db.exec('PRAGMA writable_schema=OFF');
  console.error('[repair] writable_schema removal failed:', e.message);
  process.exit(1);
}

// Close and reopen so SQLite re-reads sqlite_master from disk.
// The writable_schema DELETE is committed to the file, but the in-memory
// schema cache still believes ingested_channels exists — a fresh connection
// starts clean and will see only ingested_channels_new.
db.close();
console.log('[repair] Connection closed — reopening to flush schema cache...');

try {
  if (fs.existsSync(LOCK_PATH)) fs.rmSync(LOCK_PATH, { recursive: true, force: true });
} catch (_) {}

const db2 = new Database(DB_PATH);
db2.exec('PRAGMA foreign_keys=OFF');

db2.exec('ALTER TABLE ingested_channels_new RENAME TO ingested_channels');
console.log('[repair] Renamed ingested_channels_new → ingested_channels');

// Recreate clean indexes
db2.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ic_channel_id ON ingested_channels(channel_id)');
db2.exec('CREATE INDEX IF NOT EXISTS idx_ic_niche   ON ingested_channels(niche)');
db2.exec('CREATE INDEX IF NOT EXISTS idx_ic_enabled ON ingested_channels(ingest_enabled)');
console.log('[repair] Indexes rebuilt');

// ── Final report ─────────────────────────────────────────────────────────────

const final = db2.get('SELECT COUNT(*) AS n FROM ingested_channels').n;
const sample = db2.get('SELECT channel_id, channel_name, niche FROM ingested_channels LIMIT 1');
console.log(`\n[repair] Final count: ${final}/${total} channels`);
console.log('[repair] Sample:', sample);

if (final < total * 0.9) {
  console.warn(`[repair] WARNING: Only ${Math.round(final / total * 100)}% recovered.`);
  console.warn('[repair] Run npm run pipeline to refill gaps from corpus_channels.');
} else {
  console.log('[repair] SUCCESS — restart the server.');
}

db2.close();
