const { Database } = require('node-sqlite3-wasm');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const SCHEMA = require('./schema');
const { extractFeatures }  = require('../services/featureExtraction');
const { runPatternMining } = require('../services/patternMiner');

const DATA_DIR  = path.resolve(__dirname, '../data');
const DB_PATH   = path.resolve(DATA_DIR, 'scoring.db');
const LOCK_PATH = DB_PATH + '.lock';

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('[DB] FATAL: Cannot create data directory:', DATA_DIR, e.message);
    throw e;
  }
}

// node-sqlite3-wasm uses a directory as a lock file on Windows.
// If a previous process was killed without cleanup, remove the stale lock.
function clearStaleLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const stat = fs.statSync(LOCK_PATH);
      console.log('[DB] Removing stale lock (mtime:', stat.mtime.toISOString(), ')');
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
      console.log('[DB] Stale lock removed');
    }
  } catch (e) {
    console.warn('[DB] Could not remove lock file:', e.message);
  }
}

function verifyWalMode(database) {
  try {
    const row = database.get('PRAGMA journal_mode');
    const mode = row?.journal_mode ?? row?.['journal_mode'] ?? Object.values(row ?? {})[0];
    if (mode !== 'wal') {
      console.warn('[DB] WARNING: journal_mode is', mode, '— expected wal. Attempting to re-enable.');
      database.exec('PRAGMA journal_mode=WAL');
    } else {
      console.log('[DB] WAL mode confirmed');
    }
  } catch (e) {
    console.warn('[DB] Could not verify WAL mode:', e.message);
  }
}

function checkForSpuriousDbFiles() {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.db') && f !== 'scoring.db');
    if (files.length > 0) {
      console.warn('[DB] WARNING: Unexpected .db files in data directory:', files.join(', '));
    }
  } catch (e) {
    console.warn('[DB] Could not scan data directory:', e.message);
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
  ['user_correction',      'REAL'],
  ['correction_reason',    'TEXT'],
  ['feature_snapshot_json','TEXT'],
];

const NEW_INGESTED_CHANNEL_COLS = [
  ['is_own_channel',           'INTEGER DEFAULT 0'],
  ['trust_score',              'REAL DEFAULT 1.0'],
  ['weight_multiplier',        'REAL DEFAULT 1.0'],
  ['ignore_from_benchmarks',   'INTEGER DEFAULT 0'],
  ['secondary_niche',          'TEXT'],
  ['primary_language',         'TEXT'],
  ['region',                   'TEXT'],
  ['primary_niche',            'TEXT'],
  ['behavior_tags',            'TEXT'],
  ['format_type',              'TEXT'],
  ['audience_style',           'TEXT'],
  ['identity_confidence',      'REAL'],
  ['identity_reasoning',       'TEXT'],
  ['identity_last_detected_at','TEXT'],
  ['identity_strength',        'REAL'],
  ['identity_source',          'TEXT'],
  ['inferred_topics',          'TEXT'],
  ['content_archetype',        'TEXT'],
  ['niche_override',           'TEXT'],
];

const NEW_VIDEO_OUTCOMES_COLS = [
  ['scoring_version_id',       'TEXT'],
  ['confidence_at_prediction', 'REAL'],
  ['predicted_band',           'TEXT'],
  ['actual_band',              'TEXT'],
  ['confidence_correct',       'INTEGER'],
  ['calibration_weight',       'REAL DEFAULT 1.0'],
];

const NEW_LCH_COLS = [
  ['confidence_accuracy_correlation', 'REAL'],
  ['high_confidence_mae',             'REAL'],
  ['medium_confidence_mae',           'REAL'],
  ['low_confidence_mae',              'REAL'],
  ['routing_accuracy_score',          'REAL'],
];

const NEW_VIDEO_OUTCOMES_PHASE_E_COLS = [
  ['freshness_weight',   'REAL DEFAULT 1.0'],
  ['is_expired',         'INTEGER DEFAULT 0'],
  ['disagreement_score', 'REAL'],
];

const NEW_PREDICTION_FEEDBACK_PHASE_E_COLS = [
  ['score_override',         'REAL'],
  ['disagreement_magnitude', 'REAL'],
];

const NEW_SEMANTIC_CLUSTER_COLS = [
  ['label_override',           'TEXT'],
  ['cohesion_score',           'REAL'],
  ['cohesion_tier',            'TEXT'],
  ['outlier_ratio',            'REAL'],
  ['avg_centroid_similarity',  'REAL'],
];

const NEW_HOOK_PERFORMANCE_PHASE_D_COLS = [
  ['primary_hook_confidence', 'REAL'],
  ['avg_ambiguity_score',     'REAL'],
  ['inference_version',       'TEXT'],
  ['top_signals_json',        'TEXT'],
];

const NEW_HOOK_PERFORMANCE_TABLE = `
  CREATE TABLE IF NOT EXISTS hook_type_performance (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    niche               TEXT    NOT NULL,
    hook_type           TEXT    NOT NULL,
    duration_bucket     TEXT    NOT NULL DEFAULT 'all',
    avg_vph             REAL,
    median_vph          REAL,
    p75_vph             REAL,
    consistency_score   REAL,
    momentum_score      REAL,
    sample_count        INTEGER NOT NULL DEFAULT 0,
    hook_score          REAL,
    confidence_score    REAL,
    trend_direction     TEXT    DEFAULT 'stable',
    example_titles_json TEXT,
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(niche, hook_type, duration_bucket)
  );
  CREATE INDEX IF NOT EXISTS idx_htp_niche      ON hook_type_performance(niche);
  CREATE INDEX IF NOT EXISTS idx_htp_hook_type  ON hook_type_performance(hook_type);
  CREATE INDEX IF NOT EXISTS idx_htp_hook_score ON hook_type_performance(hook_score DESC);
  CREATE INDEX IF NOT EXISTS idx_htp_updated    ON hook_type_performance(updated_at);
`;

function migrate(database) {
  try { database.exec(NEW_HOOK_PERFORMANCE_TABLE); } catch (_) {}
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

  try {
    const voCols = database.all("PRAGMA table_info(video_outcomes)").map(r => r.name);
    for (const [col, def] of NEW_VIDEO_OUTCOMES_COLS) {
      if (!voCols.includes(col)) {
        database.exec(`ALTER TABLE video_outcomes ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: video_outcomes.${col}`);
      }
    }
  } catch (_) {}

  try {
    const lchCols = database.all("PRAGMA table_info(learning_confidence_history)").map(r => r.name);
    for (const [col, def] of NEW_LCH_COLS) {
      if (!lchCols.includes(col)) {
        database.exec(`ALTER TABLE learning_confidence_history ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: learning_confidence_history.${col}`);
      }
    }
  } catch (_) {}

  try {
    const voCols = database.all("PRAGMA table_info(video_outcomes)").map(r => r.name);
    for (const [col, def] of NEW_VIDEO_OUTCOMES_PHASE_E_COLS) {
      if (!voCols.includes(col)) {
        database.exec(`ALTER TABLE video_outcomes ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: video_outcomes.${col}`);
      }
    }
  } catch (_) {}

  try {
    const pfCols = database.all("PRAGMA table_info(prediction_feedback)").map(r => r.name);
    for (const [col, def] of NEW_PREDICTION_FEEDBACK_PHASE_E_COLS) {
      if (!pfCols.includes(col)) {
        database.exec(`ALTER TABLE prediction_feedback ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: prediction_feedback.${col}`);
      }
    }
  } catch (_) {}

  try {
    const htpCols = database.all("PRAGMA table_info(hook_type_performance)").map(r => r.name);
    for (const [col, def] of NEW_HOOK_PERFORMANCE_PHASE_D_COLS) {
      if (!htpCols.includes(col)) {
        database.exec(`ALTER TABLE hook_type_performance ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: hook_type_performance.${col}`);
      }
    }
  } catch (_) {}

  try {
    const scCols = database.all("PRAGMA table_info(semantic_clusters)").map(r => r.name);
    for (const [col, def] of NEW_SEMANTIC_CLUSTER_COLS) {
      if (!scCols.includes(col)) {
        database.exec(`ALTER TABLE semantic_clusters ADD COLUMN ${col} ${def}`);
        console.log(`[DB] Added column: semantic_clusters.${col}`);
      }
    }
  } catch (_) {}

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS niche_reliability (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        niche              TEXT    NOT NULL UNIQUE,
        reliability_score  REAL    NOT NULL DEFAULT 0,
        real_outcome_count INTEGER NOT NULL DEFAULT 0,
        avg_mae            REAL,
        mae_7d             REAL,
        mae_30d            REAL,
        mae_90d            REAL,
        trust_weight       REAL    NOT NULL DEFAULT 1.0,
        synthetic_ratio    REAL,
        disagreement_rate  REAL,
        computed_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_nr_niche       ON niche_reliability(niche);
      CREATE INDEX IF NOT EXISTS idx_nr_computed_at ON niche_reliability(computed_at);
      CREATE TABLE IF NOT EXISTS learning_cohort_snapshots (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        cohort_window        TEXT    NOT NULL CHECK(cohort_window IN ('7d','30d','90d')),
        snapshot_date        TEXT    NOT NULL,
        niche                TEXT    NOT NULL DEFAULT '__all__',
        total_outcomes       INTEGER NOT NULL DEFAULT 0,
        real_outcomes        INTEGER NOT NULL DEFAULT 0,
        mae                  REAL,
        accuracy_rate        REAL,
        avg_confidence       REAL,
        avg_freshness_weight REAL,
        disagreement_rate    REAL,
        synthetic_ratio      REAL,
        created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(cohort_window, snapshot_date, niche)
      );
      CREATE INDEX IF NOT EXISTS idx_lcs_window ON learning_cohort_snapshots(cohort_window, snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_lcs_niche  ON learning_cohort_snapshots(niche, snapshot_date);
    `);
  } catch (_) {}

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS discovered_channels (
        id                         TEXT PRIMARY KEY,
        channel_id                 TEXT NOT NULL UNIQUE,
        title                      TEXT,
        handle                     TEXT,
        thumbnail_url              TEXT,
        subscriber_count           INTEGER,
        video_count                INTEGER,
        discovery_source           TEXT,
        discovered_from_channel_id TEXT,
        discovery_run_id           TEXT,
        discovery_depth            INTEGER DEFAULT 1,
        discovery_confidence       REAL DEFAULT 0,
        duplicate_risk             TEXT DEFAULT 'none',
        diversity_score            REAL DEFAULT 0,
        approval_status            TEXT DEFAULT 'pending',
        discovered_at              TEXT DEFAULT (datetime('now')),
        reviewed_at                TEXT,
        titles_sample              TEXT,
        primary_niche              TEXT,
        secondary_niche            TEXT,
        inferred_topics            TEXT,
        behavior_tags              TEXT,
        content_archetype          TEXT,
        audience_style             TEXT,
        format_type                TEXT,
        identity_strength          REAL,
        identity_confidence        REAL,
        identity_reasoning         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dc_channel_id      ON discovered_channels(channel_id);
      CREATE INDEX IF NOT EXISTS idx_dc_approval_status ON discovered_channels(approval_status);
      CREATE INDEX IF NOT EXISTS idx_dc_discovered_at   ON discovered_channels(discovered_at);
      CREATE INDEX IF NOT EXISTS idx_dc_run_id          ON discovered_channels(discovery_run_id);
    `);
  } catch (_) {}
}

function migrateNiches(database) {
  try {
    const ch1  = database.run(`UPDATE ingested_channels SET niche = 'technology' WHERE niche = 'ai_tools'`);
    const ch2  = database.run(`UPDATE ingested_channels SET niche = 'business'   WHERE niche = 'creator_growth'`);
    const vid1 = database.run(`UPDATE ingested_videos   SET niche = 'technology' WHERE niche = 'ai_tools'`);
    const vid2 = database.run(`UPDATE ingested_videos   SET niche = 'business'   WHERE niche = 'creator_growth'`);
    const del  = database.run(`DELETE FROM niche_benchmarks WHERE niche IN ('ai_tools', 'creator_growth')`);

    const channelsMigrated   = (ch1.changes ?? 0) + (ch2.changes ?? 0);
    const videosMigrated     = (vid1.changes ?? 0) + (vid2.changes ?? 0);
    const benchmarksDeleted  = del.changes ?? 0;

    if (channelsMigrated || videosMigrated || benchmarksDeleted) {
      console.log(`[DB] Niche rename: channels=${channelsMigrated}, videos=${videosMigrated}, benchmarks_deleted=${benchmarksDeleted}`);
      runPatternMining(database);
      console.log('[DB] Pattern mining re-triggered after niche migration');
    }
  } catch (_) {}
}

function backfillIdentityPrimaryNiche(database) {
  try {
    const result = database.run(
      `UPDATE ingested_channels SET primary_niche = niche WHERE primary_niche IS NULL AND niche IS NOT NULL`,
    );
    if ((result.changes ?? 0) > 0) {
      console.log(`[DB] Backfilled primary_niche for ${result.changes} channels`);
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

  console.log('[DB] Initializing — pid:', process.pid, '| cwd:', process.cwd());
  console.log('[DB] DB_PATH:', DB_PATH);

  ensureDataDir();
  checkForSpuriousDbFiles();
  clearStaleLock();

  db = new Database(DB_PATH);

  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');        // WAL mode default; fewer fsyncs on Windows
  db.exec('PRAGMA wal_autocheckpoint=2000');   // checkpoint every 2000 pages (~8 MB) instead of default 1000
  db.exec('PRAGMA cache_size=-8000');          // 8 MB page cache
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(SCHEMA);

  verifyWalMode(db);

  migrate(db);
  migrateNiches(db);
  backfillIdentityPrimaryNiche(db);
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
