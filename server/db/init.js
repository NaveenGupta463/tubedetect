const { Database } = require('node-sqlite3-wasm');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const SCHEMA = require('./schema');
const { extractFeatures } = require('../services/featureExtraction');

const DB_PATH   = path.join(__dirname, '../data/scoring.db');
const LOCK_PATH = DB_PATH + '.lock';

// node-sqlite3-wasm uses a directory as a lock file on Windows.
// If a previous process was killed without cleanup, remove the stale lock.
function clearStaleLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
      console.log('[DB] Removed stale lock file');
    }
  } catch (e) {
    console.warn('[DB] Could not remove lock file:', e.message);
  }
}

const NEW_FEATURE_COLS = [
  ['curiosity_score',   'REAL DEFAULT 0'],
  ['urgency_score',     'REAL DEFAULT 0'],
  ['specificity_score', 'REAL DEFAULT 0'],
  ['power_word_score',  'REAL DEFAULT 0'],
  ['sentiment_score',   'REAL DEFAULT 0'],
];

const NEW_METRICS_COLS = [
  ['views',            'INTEGER'],
  ['likes',            'INTEGER'],
  ['upload_age_days',  'INTEGER'],
];

const NEW_VIDEOS_COLS = [
  ['last_updated_at',  'TEXT'],
  ['duration_seconds', 'INTEGER'],
];

const NEW_PREDICTION_COLS = [
  ['user_correction',   'REAL'],
  ['correction_reason', 'TEXT'],
];

const NEW_INGESTED_CHANNEL_COLS = [
  ['trust_score',              'REAL DEFAULT 1.0'],
  ['weight_multiplier',        'REAL DEFAULT 1.0'],
  ['ignore_from_benchmarks',   'INTEGER DEFAULT 0'],
];

function migrate(database) {
  const featureCols = database.all("PRAGMA table_info(features)").map(r => r.name);
  for (const [col, def] of NEW_FEATURE_COLS) {
    if (!featureCols.includes(col)) {
      database.exec(`ALTER TABLE features ADD COLUMN ${col} ${def}`);
      console.log(`[DB] Added column: features.${col}`);
    }
  }

  const metricsCols = database.all("PRAGMA table_info(performance_metrics)").map(r => r.name);
  for (const [col, def] of NEW_METRICS_COLS) {
    if (!metricsCols.includes(col)) {
      database.exec(`ALTER TABLE performance_metrics ADD COLUMN ${col} ${def}`);
      console.log(`[DB] Added column: performance_metrics.${col}`);
    }
  }

  const videoCols = database.all("PRAGMA table_info(videos)").map(r => r.name);
  for (const [col, def] of NEW_VIDEOS_COLS) {
    if (!videoCols.includes(col)) {
      database.exec(`ALTER TABLE videos ADD COLUMN ${col} ${def}`);
      console.log(`[DB] Added column: videos.${col}`);
    }
  }

  const predictionCols = database.all("PRAGMA table_info(predictions)").map(r => r.name);
  for (const [col, def] of NEW_PREDICTION_COLS) {
    if (!predictionCols.includes(col)) {
      database.exec(`ALTER TABLE predictions ADD COLUMN ${col} ${def}`);
      console.log(`[DB] Added column: predictions.${col}`);
    }
  }

  try {
    const icCols = database.all("PRAGMA table_info(ingested_channels)").map(r => r.name);
    for (const [col, def] of NEW_INGESTED_CHANNEL_COLS) {
      if (!icCols.includes(col)) {
        database.exec(`ALTER TABLE ingested_channels ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: ingested_channels.${col}`);
      }
    }
  } catch (_) {}
}

function backfillNewFeatures(database) {
  // Find rows where the new columns are all still NULL (pre-migration rows)
  // Backfill rows that still have all-zero new scores (pre-migration rows default to 0)
  const rows = database.all(`
    SELECT f.video_id, v.title, v.hook, v.niche
    FROM features f
    JOIN videos v ON v.id = f.video_id
    WHERE f.curiosity_score = 0 AND f.urgency_score = 0
      AND f.power_word_score = 0 AND f.specificity_score = 0
  `);

  if (rows.length === 0) return;

  console.log(`[DB] Backfilling new features for ${rows.length} existing rows...`);
  for (const row of rows) {
    const f = extractFeatures({ title: row.title, hook: row.hook, niche: row.niche });
    database.run(
      `UPDATE features
       SET curiosity_score=?, urgency_score=?, specificity_score=?, power_word_score=?, sentiment_score=?
       WHERE video_id=?`,
      [f.curiosity_score, f.urgency_score, f.specificity_score, f.power_word_score, f.sentiment_score, row.video_id],
    );
  }
  console.log(`[DB] Backfill complete.`);
}

let db = null;

function getDb() {
  if (db) return db;

  clearStaleLock();
  db = new Database(DB_PATH);

  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA);

  migrate(db);
  backfillNewFeatures(db);
  seedDefaultScoringVersion(db);

  return db;
}

function seedDefaultScoringVersion(db) {
  try {
    const existing = db.get('SELECT COUNT(*) AS n FROM scoring_versions WHERE active = 1');
    if ((existing?.n ?? 0) > 0) return;

    db.run(
      `INSERT INTO scoring_versions
         (id, version_name, version_type, weights_json, thresholds_json,
          confidence_rules_json, active, created_at, created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        'v1.0.0',
        'ensemble_weights',
        JSON.stringify({ ml: 0.6, peer_context: 0.4 }),
        JSON.stringify({ low: 0.4, medium: 0.7 }),
        JSON.stringify({ degraded_on_zero_peers: true, degraded_on_degraded_mode: true }),
        new Date().toISOString(),
        'system',
        'Auto-seeded baseline — production ensemble weights (ml:0.6, peer_context:0.4)',
      ],
    );
    console.log('[DB] Seeded scoring baseline v1.0.0');
  } catch (e) {
    console.warn('[DB] Could not seed scoring version:', e.message);
  }
}

module.exports = { getDb };
