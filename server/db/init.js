const BetterSqlite3 = require('better-sqlite3');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const SCHEMA = require('./schema');
const { extractFeatures }  = require('../services/featureExtraction');
const { runPatternMining } = require('../services/patternMiner');

const DATA_DIR  = path.resolve(__dirname, '../data');
const DB_PATH   = path.resolve(DATA_DIR, 'scoring.db');
const LOCK_PATH = DB_PATH + '.lock';

// Thin wrapper so all existing db.all/get/run/exec calls work unchanged.
// Prepared statements are cached per SQL string for performance.
class Database {
  constructor(dbPath) {
    this._db    = new BetterSqlite3(dbPath);
    this._cache = new Map();
  }
  _stmt(sql) {
    if (!this._cache.has(sql)) this._cache.set(sql, this._db.prepare(sql));
    return this._cache.get(sql);
  }
  _p(params) {
    if (params == null) return [];
    return Array.isArray(params) ? params : [params];
  }
  all(sql, params)  { return this._stmt(sql).all(this._p(params)); }
  get(sql, params)  { return this._stmt(sql).get(this._p(params)); }
  run(sql, params)  { return this._stmt(sql).run(this._p(params)); }
  exec(sql)         { return this._db.exec(sql); }
  close()           { this._cache.clear(); return this._db.close(); }
  pragma(str, opts) { return this._db.pragma(str, opts); }
  transaction(fn)   { return this._db.transaction(fn); }
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('[DB] FATAL: Cannot create data directory:', DATA_DIR, e.message);
    throw e;
  }
}

// Legacy: node-sqlite3-wasm used a directory lock file. Clean it up if present.
function clearStaleLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
      console.log('[DB] Removed legacy wasm lock file');
    }
  } catch (_) {}
}

function verifyWalMode(database) {
  try {
    const mode = database.pragma('journal_mode', { simple: true });
    if (mode === 'wal') {
      console.log('[DB] WAL mode confirmed');
    } else {
      console.warn('[DB] WARNING: journal_mode is', mode, '— expected wal');
    }
  } catch (e) {
    console.warn('[DB] Could not verify WAL mode:', e.message);
  }
}

function repairCorruptedIndexes(database) {
  // Integrity check is expensive on large DBs (~2 min). Skip if checked within last 7 days.
  try {
    const row = database.get(`SELECT value FROM kv_store WHERE key = 'last_integrity_check'`);
    if (row?.value) {
      const age = Date.now() - new Date(row.value).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) return; // checked in last 7 days, skip
    }
  } catch (_) {}

  let integrityRows;
  try {
    integrityRows = database.all('PRAGMA integrity_check(100)');
    try {
      database.run(
        `INSERT INTO kv_store (key, value) VALUES ('last_integrity_check', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [new Date().toISOString()],
      );
    } catch (_) {}
  } catch (e) {
    console.warn('[DB] integrity_check failed — attempting proactive index rebuild on key tables:', e.message);
    _rebuildKeyIndexes(database);
    return;
  }

  const bad = integrityRows.filter(r => r.integrity_check !== 'ok');
  if (bad.length === 0) return;

  const idxNames = new Set();
  for (const { integrity_check: msg } of bad) {
    const m = msg.match(/missing from index (\S+)/);
    if (m) idxNames.add(m[1]);
  }

  if (idxNames.size > 0) {
    console.warn('[DB] Corrupted indexes — rebuilding (drop + create):', [...idxNames].join(', '));
    for (const idx of idxNames) {
      try {
        const defRow = database.get(
          `SELECT sql FROM sqlite_master WHERE type='index' AND name=?`, [idx],
        );
        if (!defRow?.sql) continue;
        database.exec(`DROP INDEX IF EXISTS "${idx}"`);
        database.exec(defRow.sql);
        console.log('[DB] Rebuilt index:', idx);
      } catch (e2) {
        console.warn(`[DB] Could not rebuild ${idx}:`, e2.message);
      }
    }
  } else {
    console.warn('[DB] Integrity issues (non-index):', bad.slice(0, 3).map(r => r.integrity_check));
    _rebuildKeyIndexes(database);
  }
}

// Drop + recreate the indexes that pattern mining JOINs touch.
// Safe to call even when the indexes are healthy — just costs one rebuild pass.
function _rebuildKeyIndexes(database) {
  const indexes = [
    ['idx_vgs_video_id', 'CREATE INDEX IF NOT EXISTS idx_vgs_video_id ON video_growth_snapshots(video_id)'],
    ['idx_vgs_bucket',   'CREATE INDEX IF NOT EXISTS idx_vgs_bucket   ON video_growth_snapshots(bucket)'],
    ['idx_iv_niche',     'CREATE INDEX IF NOT EXISTS idx_iv_niche     ON ingested_videos(niche)'],
    ['idx_iv_channel',   'CREATE INDEX IF NOT EXISTS idx_iv_channel   ON ingested_videos(channel_id)'],
    ['idx_ic_niche',     'CREATE INDEX IF NOT EXISTS idx_ic_niche     ON ingested_channels(niche)'],
    ['idx_ic_enabled',   'CREATE INDEX IF NOT EXISTS idx_ic_enabled   ON ingested_channels(ingest_enabled)'],
  ];
  for (const [name, sql] of indexes) {
    try {
      database.exec(`DROP INDEX IF EXISTS "${name}"`);
      database.exec(sql);
      console.log('[DB] Proactively rebuilt index:', name);
    } catch (e) {
      console.warn(`[DB] Could not rebuild ${name}:`, e.message);
    }
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
  ['audience_language',        'TEXT'],
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

  // ── Local-first cache: user-searched channels and their videos ────────────
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS channel_cache (
        channel_id          TEXT PRIMARY KEY,
        handle              TEXT,
        title               TEXT,
        raw_json            TEXT NOT NULL,
        uploads_playlist_id TEXT,
        subscriber_count    INTEGER,
        cached_at           TEXT NOT NULL DEFAULT (datetime('now')),
        stats_refreshed_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cc_handle ON channel_cache(handle);

      CREATE TABLE IF NOT EXISTS video_cache (
        video_id           TEXT PRIMARY KEY,
        channel_id         TEXT NOT NULL,
        raw_json           TEXT NOT NULL,
        view_count         INTEGER,
        cached_at          TEXT NOT NULL DEFAULT (datetime('now')),
        stats_refreshed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_vc_channel ON video_cache(channel_id);
    `);
  } catch (_) {}

  // ── Corpus Layer: durable semantic memory (Phase XI) ─────────────────────
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS corpus_channels (
        channel_id          TEXT    PRIMARY KEY,
        title               TEXT,
        handle              TEXT,
        thumbnail_url       TEXT,
        uploads_playlist_id TEXT,
        niche               TEXT,
        language            TEXT    DEFAULT 'en',
        country             TEXT,
        subscriber_count    INTEGER DEFAULT 0,
        total_views         INTEGER DEFAULT 0,
        video_count         INTEGER DEFAULT 0,
        last_ingested_at    TEXT,
        last_refreshed_at   TEXT,
        ingest_depth        INTEGER DEFAULT 0,
        semantic_status     TEXT    DEFAULT 'pending',
        quality_score       REAL    DEFAULT 0,
        training_eligible   INTEGER DEFAULT 0,
        training_promoted_at TEXT,
        training_demoted_at  TEXT,
        discovery_source    TEXT    DEFAULT 'manual',
        priority_score      REAL    DEFAULT 50,
        is_spam             INTEGER DEFAULT 0,
        is_low_quality      INTEGER DEFAULT 0,
        quality_flags       TEXT,
        raw_json            TEXT,
        created_at          TEXT    DEFAULT (datetime('now')),
        updated_at          TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_corp_ch_niche    ON corpus_channels(niche);
      CREATE INDEX IF NOT EXISTS idx_corp_ch_quality  ON corpus_channels(quality_score);
      CREATE INDEX IF NOT EXISTS idx_corp_ch_training ON corpus_channels(training_eligible);
      CREATE INDEX IF NOT EXISTS idx_corp_ch_status   ON corpus_channels(semantic_status);
      CREATE INDEX IF NOT EXISTS idx_corp_ch_priority ON corpus_channels(priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_corp_ch_handle   ON corpus_channels(handle);

      CREATE TABLE IF NOT EXISTS corpus_videos (
        video_id          TEXT    PRIMARY KEY,
        channel_id        TEXT    NOT NULL,
        title             TEXT    NOT NULL,
        description       TEXT,
        thumbnail_url     TEXT,
        published_at      TEXT,
        duration_seconds  INTEGER,
        views             INTEGER DEFAULT 0,
        likes             INTEGER DEFAULT 0,
        comments          INTEGER DEFAULT 0,
        vph               REAL,
        semantic_cluster  TEXT,
        embedding_status  TEXT    DEFAULT 'pending',
        training_weight   REAL    DEFAULT 1.0,
        performance_tier  TEXT,
        quality_score     REAL,
        raw_json          TEXT,
        ingested_at       TEXT    DEFAULT (datetime('now')),
        refreshed_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_corp_vid_channel  ON corpus_videos(channel_id);
      CREATE INDEX IF NOT EXISTS idx_corp_vid_cluster  ON corpus_videos(semantic_cluster);
      CREATE INDEX IF NOT EXISTS idx_corp_vid_embed    ON corpus_videos(embedding_status);
      CREATE INDEX IF NOT EXISTS idx_corp_vid_published ON corpus_videos(published_at DESC);

      CREATE TABLE IF NOT EXISTS corpus_discovery_graph (
        id                 TEXT    PRIMARY KEY,
        source_channel_id  TEXT    NOT NULL,
        target_channel_id  TEXT    NOT NULL,
        relationship_type  TEXT    NOT NULL,
        confidence         REAL    DEFAULT 0,
        discovered_via     TEXT,
        discovered_at      TEXT    DEFAULT (datetime('now')),
        UNIQUE(source_channel_id, target_channel_id, relationship_type)
      );
      CREATE INDEX IF NOT EXISTS idx_cdg_source ON corpus_discovery_graph(source_channel_id);
      CREATE INDEX IF NOT EXISTS idx_cdg_target ON corpus_discovery_graph(target_channel_id);
      CREATE INDEX IF NOT EXISTS idx_cdg_type   ON corpus_discovery_graph(relationship_type);

      CREATE TABLE IF NOT EXISTS corpus_embeddings_queue (
        id           TEXT    PRIMARY KEY,
        entity_type  TEXT    NOT NULL,
        entity_id    TEXT    NOT NULL,
        priority     INTEGER DEFAULT 5,
        status       TEXT    DEFAULT 'pending',
        attempts     INTEGER DEFAULT 0,
        queued_at    TEXT    DEFAULT (datetime('now')),
        processed_at TEXT,
        error        TEXT,
        UNIQUE(entity_type, entity_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ceq_status   ON corpus_embeddings_queue(status, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_ceq_type     ON corpus_embeddings_queue(entity_type);

      CREATE TABLE IF NOT EXISTS corpus_quality_state (
        channel_id               TEXT    PRIMARY KEY,
        quality_score            REAL    DEFAULT 0,
        semantic_consistency     REAL    DEFAULT 0,
        engagement_authenticity  REAL    DEFAULT 0,
        clickbait_score          REAL    DEFAULT 0,
        performance_stability    REAL    DEFAULT 0,
        title_quality            REAL    DEFAULT 0,
        authority_score          REAL    DEFAULT 0,
        sample_size              INTEGER DEFAULT 0,
        is_spam                  INTEGER DEFAULT 0,
        is_ai_slop               INTEGER DEFAULT 0,
        is_unstable              INTEGER DEFAULT 0,
        flags_json               TEXT,
        training_eligible        INTEGER DEFAULT 0,
        evaluated_at             TEXT,
        promoted_at              TEXT,
        demoted_at               TEXT
      );

      CREATE TABLE IF NOT EXISTS corpus_refresh_schedule (
        channel_id             TEXT    PRIMARY KEY,
        refresh_priority       INTEGER DEFAULT 5,
        last_refresh_at        TEXT,
        next_refresh_at        TEXT,
        refresh_count          INTEGER DEFAULT 0,
        stale_threshold_hours  INTEGER DEFAULT 168
      );

      CREATE TABLE IF NOT EXISTS corpus_run_log (
        id              TEXT    PRIMARY KEY,
        started_at      TEXT    NOT NULL,
        completed_at    TEXT,
        status          TEXT    DEFAULT 'running',
        quota_used      INTEGER DEFAULT 0,
        quota_budget    INTEGER DEFAULT 0,
        channels_ingested INTEGER DEFAULT 0,
        channels_evaluated INTEGER DEFAULT 0,
        channels_promoted INTEGER DEFAULT 0,
        channels_demoted  INTEGER DEFAULT 0,
        discovery_synced  INTEGER DEFAULT 0,
        error           TEXT,
        log_json        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_crl_started ON corpus_run_log(started_at DESC);
    `);
  } catch (_) {}
}

function migratePhaseXII(database) {
  // New columns on corpus_channels (each in own try/catch — column-already-exists is silent)
  const channelCols = [
    `ALTER TABLE corpus_channels ADD COLUMN training_trust_score  REAL    DEFAULT NULL`,
    `ALTER TABLE corpus_channels ADD COLUMN probation_state       INTEGER DEFAULT 1`,
    `ALTER TABLE corpus_channels ADD COLUMN probation_started_at  TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN trust_maturity_score  REAL    DEFAULT NULL`,
    `ALTER TABLE corpus_channels ADD COLUMN semantic_novelty_score REAL   DEFAULT NULL`,
    `ALTER TABLE corpus_channels ADD COLUMN ingest_tier           INTEGER DEFAULT 1`,
    `ALTER TABLE corpus_channels ADD COLUMN creator_size_tier     TEXT    DEFAULT NULL`,
  ];
  // New columns on corpus_discovery_graph
  const graphCols = [
    `ALTER TABLE corpus_discovery_graph ADD COLUMN edge_strength       REAL DEFAULT 1.0`,
    `ALTER TABLE corpus_discovery_graph ADD COLUMN decay_rate          REAL DEFAULT 0.85`,
    `ALTER TABLE corpus_discovery_graph ADD COLUMN last_reinforced_at  TEXT DEFAULT (datetime('now'))`,
  ];
  for (const sql of [...channelCols, ...graphCols]) {
    try { database.run(sql); } catch (_) {}
  }

  // New governance tables
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        metadata_key   TEXT PRIMARY KEY,
        metadata_value TEXT
      );

      CREATE TABLE IF NOT EXISTS topology_health_snapshots (
        id                   TEXT PRIMARY KEY,
        cluster_name         TEXT NOT NULL,
        snapshot_at          TEXT NOT NULL,
        video_count          INTEGER DEFAULT 0,
        channel_count        INTEGER DEFAULT 0,
        entropy              REAL    DEFAULT 0,
        cohesion             REAL    DEFAULT 0,
        overlap_pressure     REAL    DEFAULT 0,
        outlier_ratio        REAL    DEFAULT 0,
        archetype_inflation  REAL    DEFAULT 0,
        giant_cluster_size   INTEGER DEFAULT 0,
        centroid_instability REAL    DEFAULT 0,
        semantic_bleed       REAL    DEFAULT 0,
        health_status        TEXT    DEFAULT 'healthy',
        metrics_json         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ths_cluster ON topology_health_snapshots(cluster_name, snapshot_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ths_status  ON topology_health_snapshots(health_status, snapshot_at DESC);

      CREATE TABLE IF NOT EXISTS governance_alerts (
        id           TEXT    PRIMARY KEY,
        alert_type   TEXT    NOT NULL,
        severity     TEXT    DEFAULT 'medium',
        cluster      TEXT,
        drift_score  REAL    DEFAULT 0,
        explanation  TEXT,
        acknowledged INTEGER DEFAULT 0,
        created_at   TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ga_type     ON governance_alerts(alert_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ga_severity ON governance_alerts(severity, acknowledged);
      CREATE INDEX IF NOT EXISTS idx_ga_cluster  ON governance_alerts(cluster, created_at DESC);

      CREATE TABLE IF NOT EXISTS ai_discovery_log (
        id                TEXT PRIMARY KEY,
        run_id            TEXT,
        handle            TEXT NOT NULL,
        channel_id        TEXT,
        niche             TEXT,
        region            TEXT,
        suggestion_status TEXT,
        validation_status TEXT,
        admission_status  TEXT,
        rejection_reason  TEXT,
        novelty_score     REAL,
        creator_size_tier TEXT,
        hallucinated      INTEGER DEFAULT 0,
        created_at        TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_adl_run      ON ai_discovery_log(run_id);
      CREATE INDEX IF NOT EXISTS idx_adl_niche    ON ai_discovery_log(niche, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_adl_admitted ON ai_discovery_log(admission_status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_adl_region   ON ai_discovery_log(region);

      CREATE TABLE IF NOT EXISTS behavioral_feedback_log (
        id             TEXT    PRIMARY KEY,
        event_type     TEXT    NOT NULL,
        session_id     TEXT,
        channel_id     TEXT,
        video_id       TEXT,
        suggestion_id  TEXT,
        payload_json   TEXT,
        created_at     TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bfl_type    ON behavioral_feedback_log(event_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_bfl_channel ON behavioral_feedback_log(channel_id);

      CREATE TABLE IF NOT EXISTS governance_roadmap (
        id                      TEXT    PRIMARY KEY,
        governance_layer        TEXT    NOT NULL UNIQUE,
        description             TEXT,
        category                TEXT,
        maturity_stage          TEXT    DEFAULT 'future',
        readiness_conditions    TEXT,
        activation_thresholds   TEXT,
        dependencies            TEXT,
        risks_if_missing        TEXT,
        implementation_priority INTEGER DEFAULT 5,
        current_status          TEXT    DEFAULT 'future',
        recommended_action      TEXT,
        readiness_pct           REAL    DEFAULT 0,
        last_evaluated_at       TEXT,
        created_at              TEXT    DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_grm_status   ON governance_roadmap(current_status);
      CREATE INDEX IF NOT EXISTS idx_grm_priority ON governance_roadmap(implementation_priority DESC);

      CREATE TABLE IF NOT EXISTS governance_layer_history (
        id                  TEXT PRIMARY KEY,
        layer_id            TEXT NOT NULL,
        governance_layer    TEXT NOT NULL,
        previous_status     TEXT,
        new_status          TEXT,
        triggering_metrics  TEXT,
        topology_conditions TEXT,
        relevant_alerts     TEXT,
        maturity_score_before REAL,
        maturity_score_after  REAL,
        maturity_delta        REAL,
        rationale           TEXT,
        changed_by          TEXT DEFAULT 'system_evaluation',
        changed_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_glh_layer   ON governance_layer_history(layer_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_glh_changed ON governance_layer_history(changed_at DESC);
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
  // Skip if already completed — uses kv_store (created by migrateSignals before this runs)
  try {
    const done = database.get(`SELECT value FROM kv_store WHERE key = 'features_backfill_done'`);
    if (done?.value === '1') return;
  } catch (_) {}

  // Only process rows with a non-empty title — rows with blank titles always score zero
  const rows = database.all(`
    SELECT f.video_id, v.title, v.hook, v.niche
    FROM features f
    JOIN videos v ON v.id = f.video_id
    WHERE f.curiosity_score = 0 AND f.urgency_score = 0
      AND f.power_word_score = 0 AND f.specificity_score = 0
      AND v.title IS NOT NULL AND v.title != ''
  `);

  if (rows.length > 0) {
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

  // Mark done so it never runs again
  try {
    database.run(
      `INSERT INTO kv_store (key, value) VALUES ('features_backfill_done', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    );
  } catch (_) {}
}

function applyOpenAINicheOverride(database) {
  // OpenAI inferred_topics is ground truth — overwrite the keyword-guessed niche
  // for every channel that has been classified. Skips if already done (kv_store flag).
  try {
    const done = database.get(`SELECT value FROM kv_store WHERE key = 'openai_niche_override_done'`);
    if (done?.value === '1') return;
  } catch (_) {}

  try {
    const result = database.run(`
      UPDATE ingested_channels
      SET niche = json_extract(inferred_topics, '$[0]')
      WHERE inferred_topics IS NOT NULL
        AND inferred_topics != '[]'
        AND inferred_topics != 'null'
        AND json_extract(inferred_topics, '$[0]') IS NOT NULL
    `);
    if ((result.changes ?? 0) > 0) {
      console.log(`[DB] OpenAI niche override applied to ${result.changes} channels`);
    }
    database.run(`INSERT INTO kv_store (key, value) VALUES ('openai_niche_override_done', '1')
                  ON CONFLICT(key) DO UPDATE SET value = '1'`);
  } catch (e) {
    console.warn('[DB] OpenAI niche override failed:', e.message);
  }
}

let db = null;

function getDb() {
  if (db) return db;

  console.log('[DB] Initializing — pid:', process.pid, '| cwd:', process.cwd());
  console.log('[DB] DB_PATH:', DB_PATH);

  ensureDataDir();
  checkForSpuriousDbFiles();
  clearStaleLock();

  // With better-sqlite3 + WAL, concurrent opens are safe. Keep a short retry
  // in case of a transient lock during a write-heavy operation.
  const MAX_OPEN_RETRIES = 10;
  for (let attempt = 1; attempt <= MAX_OPEN_RETRIES; attempt++) {
    try {
      db = new Database(DB_PATH);
      break;
    } catch (e) {
      const locked = e.message?.includes('database is locked') || e.message?.includes('unable to open');
      if (locked && attempt < MAX_OPEN_RETRIES) {
        console.warn(`[DB] Locked on open (attempt ${attempt}/${MAX_OPEN_RETRIES}) — waiting 1s…`);
        const wait = Date.now() + 1000;
        while (Date.now() < wait) {}
      } else {
        throw e;
      }
    }
  }

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
  seedDefaultScoringVersion(db);
  migratePhaseXII(db);
  seedGovernanceRoadmap(db);
  migratePhaseXIV(db);
  migratePhaseXV(db);
  migrateMultilingual(db);
  migratePhaseXVI(db);
  migrateCrawler(db);
  migrateSignals(db);   // creates kv_store — must run before backfillNewFeatures
  backfillNewFeatures(db);
  migrateTopics(db);
  migrateRssSweep(db);
  migrateShorts(db);
  applyOpenAINicheOverride(db);
  migrateVoiceProfile(db);
  migrateNicheIntelligence(db);
  migrateCredits(db);
  migrateDrafts(db);
  repairCorruptedIndexes(db);

  return db;
}

function migrateRssSweep(database) {
  try { database.exec(`ALTER TABLE ingested_channels ADD COLUMN last_rss_scan_at TEXT`); } catch (_) {}
  console.log('[DB] RSS sweep migration complete (last_rss_scan_at on ingested_channels)');
}

function migrateShorts(database) {
  try { database.exec(`ALTER TABLE ingested_videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0`); } catch (_) {}
  try { database.exec(`CREATE INDEX IF NOT EXISTS idx_iv_is_short ON ingested_videos(is_short)`); } catch (_) {}
  try { database.exec(`CREATE INDEX IF NOT EXISTS idx_iv_channel_short ON ingested_videos(channel_id, is_short)`); } catch (_) {}
  // Backfill existing rows — duration_seconds <= 60 = Short
  database.exec(`UPDATE ingested_videos SET is_short = CASE WHEN duration_seconds <= 60 THEN 1 ELSE 0 END WHERE duration_seconds IS NOT NULL`);
  const counts = database.get(`SELECT SUM(is_short) as shorts, COUNT(*) - SUM(is_short) as long_form FROM ingested_videos`);
  console.log(`[DB] Shorts migration complete — shorts=${counts.shorts?.toLocaleString()} long_form=${counts.long_form?.toLocaleString()}`);
}

function migrateTopics(database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS channel_topics (
        channel_id TEXT NOT NULL,
        topic      TEXT NOT NULL,
        niche      TEXT,
        first_seen TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (channel_id, topic)
      );
      CREATE INDEX IF NOT EXISTS idx_ct_topic ON channel_topics(topic);
      CREATE INDEX IF NOT EXISTS idx_ct_niche  ON channel_topics(niche);
    `);
  } catch (_) {}

  // Backfill from existing inferred_topics JSON blobs — skip if already populated
  const existing = database.get('SELECT COUNT(*) AS n FROM channel_topics')?.n ?? 0;
  if (existing === 0) {
    const rows = database.all(
      `SELECT channel_id, niche, inferred_topics FROM ingested_channels
       WHERE inferred_topics IS NOT NULL AND inferred_topics != '[]' AND inferred_topics != 'null'`,
    );
    let inserted = 0;
    for (const row of rows) {
      let topics;
      try { topics = JSON.parse(row.inferred_topics); } catch (_) { continue; }
      if (!Array.isArray(topics)) continue;
      for (const topic of topics) {
        const t = (topic ?? '').toString().trim().toLowerCase();
        if (!t) continue;
        try {
          database.run(
            `INSERT OR IGNORE INTO channel_topics (channel_id, topic, niche) VALUES (?, ?, ?)`,
            [row.channel_id, t, row.niche ?? null],
          );
          inserted++;
        } catch (_) {}
      }
    }
    if (inserted > 0) console.log(`[DB] Topics migration: backfilled ${inserted} topic rows from ${rows.length} channels`);
  }
  console.log('[DB] channel_topics table ready');
}

function migrateCrawler(database) {
  try { database.exec(`ALTER TABLE corpus_channels ADD COLUMN crawler_visited_at TEXT`); } catch (_) {}
}

function migrateSignals(database) {
  // General key-value store for server-side flags (e.g. last_integrity_check timestamp)
  database.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  // Community signal table — crowd-sourced confirmations of channel metadata
  database.exec(`
    CREATE TABLE IF NOT EXISTS channel_signals (
      id                 TEXT PRIMARY KEY,
      channel_id         TEXT NOT NULL,
      question_id        TEXT NOT NULL,
      answer             TEXT NOT NULL,
      session_id         TEXT NOT NULL,
      is_owner_verified  INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      UNIQUE(channel_id, question_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_signals_channel  ON channel_signals(channel_id);
    CREATE INDEX IF NOT EXISTS idx_signals_question ON channel_signals(channel_id, question_id);
  `);
  // Columns applied from verified signals
  try { database.exec(`ALTER TABLE ingested_channels ADD COLUMN content_language TEXT`); } catch (_) {}
  try { database.exec(`ALTER TABLE ingested_channels ADD COLUMN audience_geo TEXT`);     } catch (_) {}
  try { database.exec(`ALTER TABLE ingested_channels ADD COLUMN signal_niche TEXT`);     } catch (_) {}
  console.log('[DB] Signals migration complete (channel_signals table + 3 columns)');
}

function migratePhaseXVI(database) {
  try {
    database.exec(`ALTER TABLE ingested_channels ADD COLUMN community_id TEXT`);
  } catch (_) {}
  console.log('[DB] Phase XVI migration complete (community_id on ingested_channels)');
}

function migratePhaseXIV(database) {
  // Ecology columns on corpus_channels (each in own try/catch — silently skips if already exists)
  const ecologyCols = [
    `ALTER TABLE corpus_channels ADD COLUMN ecology_profile          TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_confidence       REAL`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_entropy          REAL`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_last_updated_at  TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_source           TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_version          INTEGER`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_manual_override  INTEGER DEFAULT 0`,
    `ALTER TABLE corpus_channels ADD COLUMN ecology_override_notes   TEXT`,
  ];
  for (const sql of ecologyCols) {
    try { database.exec(sql); } catch (_) {}
  }

  // Longitudinal history table for drift detection and spot-check audit
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS corpus_ecology_history (
        id                 TEXT    PRIMARY KEY,
        channel_id         TEXT    NOT NULL,
        ecology_profile    TEXT    NOT NULL,
        ecology_confidence REAL,
        ecology_entropy    REAL,
        ecology_source     TEXT,
        ecology_version    INTEGER,
        drift_distance     REAL,
        drift_alert        INTEGER DEFAULT 0,
        recorded_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `);
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_corpus_ecology_history_channel
       ON corpus_ecology_history(channel_id)`,
    );
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_corpus_ecology_history_drift
       ON corpus_ecology_history(drift_alert, recorded_at)`,
    );
  } catch (_) {}

  console.log('[DB] Phase XIV migration complete (attention ecology observability)');
}

function migratePhaseXV(database) {
  try {
    database.exec(`ALTER TABLE corpus_channels ADD COLUMN auto_promoted_at TEXT`);
  } catch (_) {}
}

function migrateMultilingual(database) {
  const cols = [
    `ALTER TABLE corpus_channels ADD COLUMN language_profile    TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN dna_features        TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN community_id        TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN yt_default_language TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN yt_country          TEXT`,
    `ALTER TABLE corpus_channels ADD COLUMN yt_topic_ids        TEXT`,
  ];
  for (const sql of cols) {
    try { database.exec(sql); } catch (_) {}
  }

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS channel_events (
        id          INTEGER PRIMARY KEY,
        channel_id  TEXT NOT NULL,
        event_type  TEXT NOT NULL,
        event_data  TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ce_ch ON channel_events(channel_id, event_type, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ce_ty ON channel_events(event_type, recorded_at DESC);
    `);
  } catch (_) {}

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS creator_edges (
        id             INTEGER PRIMARY KEY,
        source_channel TEXT NOT NULL,
        target_channel TEXT NOT NULL,
        edge_type      TEXT NOT NULL,
        weight         REAL DEFAULT 1.0,
        observed_at    TEXT NOT NULL DEFAULT (datetime('now')),
        edge_data      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_edge_src ON creator_edges(source_channel, edge_type);
      CREATE INDEX IF NOT EXISTS idx_edge_tgt ON creator_edges(target_channel, observed_at DESC);
    `);
  } catch (_) {}
  try {
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_unique ON creator_edges(source_channel, target_channel, edge_type)`);
  } catch (_) {}

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS discovery_provenance (
        channel_id        TEXT PRIMARY KEY,
        discovered_at     TEXT NOT NULL DEFAULT (datetime('now')),
        discovery_source  TEXT NOT NULL,
        source_channel_id TEXT,
        search_query      TEXT,
        search_language   TEXT,
        search_region     TEXT,
        quality_at_entry  REAL,
        eligible_at_entry INTEGER,
        entry_data        TEXT
      );
    `);
  } catch (_) {}

  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS discovery_seeds (
        channel_id    TEXT PRIMARY KEY,
        language_code TEXT NOT NULL,
        niche_hint    TEXT,
        seed_quality  TEXT DEFAULT 'candidate',
        added_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ds_lang ON discovery_seeds(language_code);
    `);
  } catch (_) {}

  console.log('[DB] Multilingual infrastructure migration complete');
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

function seedGovernanceRoadmap(db) {
  const layers = [
    {
      id: 'grm-001',
      governance_layer: 'creator_influence_normalization',
      description: 'Prevent giant creators from becoming semantic gravity wells that warp niche benchmarks and recommendation priors.',
      category: 'topology_protection',
      readiness_conditions: JSON.stringify({
        training_corpus_size: { gte: 300 },
        archetype_dominance_pct: { gte: 30 },
        graph_centralization_risk: { eq: true },
      }),
      activation_thresholds: JSON.stringify({ top_creator_influence_pct: 15, graph_hub_concentration: 0.4 }),
      dependencies: JSON.stringify(['trainingTrustEngine', 'diversityPressureEngine']),
      risks_if_missing: 'Top 5 creators may represent >40% of training signal, warping validator scoring and semantic priors toward their style.',
      implementation_priority: 2,
      current_status: 'monitoring',
      recommended_action: 'Monitor top-creator influence concentration. Activate when any single creator exceeds 15% of training corpus influence.',
    },
    {
      id: 'grm-002',
      governance_layer: 'cross_archetype_bridge_detection',
      description: 'Identify creators who connect semantically distant clusters — rare topology bridges that add structural diversity value.',
      category: 'topology_intelligence',
      readiness_conditions: JSON.stringify({
        cluster_count: { gte: 15 },
        training_corpus_size: { gte: 200 },
        topology_cohesion_stable: { eq: true },
      }),
      activation_thresholds: JSON.stringify({ min_clusters: 15, min_bridge_candidates: 5 }),
      dependencies: JSON.stringify(['topologyHealthEngine', 'semanticDriftEngine']),
      risks_if_missing: 'Multi-niche creators with cross-cluster semantic value may be underweighted or misclassified as noisy/unstable.',
      implementation_priority: 3,
      current_status: 'monitoring',
      recommended_action: 'Begin identifying bridge candidates once cluster count stabilizes above 15.',
    },
    {
      id: 'grm-003',
      governance_layer: 'semantic_ecosystem_balance',
      description: 'Actively rebalance the training corpus when emotional/archetype concentration exceeds safe thresholds.',
      category: 'diversity_governance',
      readiness_conditions: JSON.stringify({
        corpus_channels: { gte: 3000 },
        training_corpus_size: { gte: 300 },
        archetype_dominance_pct: { gte: 30 },
      }),
      activation_thresholds: JSON.stringify({ max_single_archetype_pct: 35, min_archetype_count: 8 }),
      dependencies: JSON.stringify(['diversityPressureEngine', 'trainingTrustEngine']),
      risks_if_missing: 'Training corpus converges on 2-3 dominant archetypes, reducing recommendation diversity and semantic range.',
      implementation_priority: 3,
      current_status: 'future',
      recommended_action: 'Activate when corpus reaches 3K channels and any archetype exceeds 35% of training set.',
    },
    {
      id: 'grm-004',
      governance_layer: 'temporal_semantic_weighting',
      description: 'Weight semantic signals by recency to distinguish stable persuasion structures from temporary trends.',
      category: 'temporal_intelligence',
      readiness_conditions: JSON.stringify({
        corpus_channels: { gte: 2000 },
        cluster_count: { gte: 25 },
        corpus_data_span_days: { gte: 365 },
      }),
      activation_thresholds: JSON.stringify({ min_data_span_days: 365, min_temporal_snapshots: 52 }),
      dependencies: JSON.stringify(['topologyHealthEngine', 'corpusScheduler']),
      risks_if_missing: 'Viral/seasonal content may temporarily warp semantic priors if trend signals are treated equally with stable patterns.',
      implementation_priority: 4,
      current_status: 'future',
      recommended_action: 'Requires at least one year of corpus snapshot history before temporal patterns are statistically meaningful.',
    },
    {
      id: 'grm-005',
      governance_layer: 'recommendation_diversity_injection',
      description: 'Prevent recommendation loops by enforcing archetype diversity constraints at the output layer.',
      category: 'recommendation_safety',
      readiness_conditions: JSON.stringify({
        recommendation_engine_exists: { eq: true },
        training_corpus_size: { gte: 500 },
        archetype_dominance_pct: { gte: 25 },
      }),
      activation_thresholds: JSON.stringify({ max_same_archetype_pct: 40, min_archetype_spread: 4 }),
      dependencies: JSON.stringify(['diversityPressureEngine', 'trainingTrustEngine', 'recommendation_engine']),
      risks_if_missing: 'Recommendation outputs may recursively surface the same archetype, creating persuasion monoculture visible to end users.',
      implementation_priority: 2,
      current_status: 'future',
      recommended_action: 'Activate when a discrete recommendation engine exists and diversity pressure signals show archetype compression.',
    },
    {
      id: 'grm-006',
      governance_layer: 'trend_seasonality_awareness',
      description: 'Detect cyclical persuasion structures (annual events, news cycles, seasonal virality) to prevent misclassification as stable patterns.',
      category: 'temporal_intelligence',
      readiness_conditions: JSON.stringify({
        corpus_videos: { gte: 50000 },
        corpus_data_span_days: { gte: 365 },
        cluster_count: { gte: 20 },
      }),
      activation_thresholds: JSON.stringify({ min_video_count: 50000, min_data_span_days: 365 }),
      dependencies: JSON.stringify(['temporal_semantic_weighting']),
      risks_if_missing: 'Seasonal content spikes (elections, holidays, events) may be absorbed into stable semantic clusters, distorting archetype baselines.',
      implementation_priority: 5,
      current_status: 'future',
      recommended_action: 'Implement after temporal_semantic_weighting is active and at least 1 year of data exists.',
    },
    {
      id: 'grm-007',
      governance_layer: 'semantic_wild_zones',
      description: 'Experimental semantic regions that accept noisy/uncategorized channels without contaminating the trusted training topology.',
      category: 'topology_architecture',
      readiness_conditions: JSON.stringify({
        corpus_channels: { gte: 5000 },
        governance_maturity_score: { gte: 60 },
        topology_health_stable_days: { gte: 30 },
      }),
      activation_thresholds: JSON.stringify({ min_corpus_size: 5000, min_governance_maturity: 60 }),
      dependencies: JSON.stringify(['trainingTrustEngine', 'topologyHealthEngine', 'semanticDriftEngine']),
      risks_if_missing: 'Experimental or borderline channels are either rejected entirely or admitted to the trusted topology — no middle ground for probabilistic exploration.',
      implementation_priority: 6,
      current_status: 'future',
      recommended_action: 'Requires mature governance infrastructure and stable topology before experimental regions can be safely isolated.',
    },
    {
      id: 'grm-008',
      governance_layer: 'topology_mutation_safeguards',
      description: 'Protect the semantic topology from runaway self-modification if future autonomous cluster-rewriting systems are added.',
      category: 'system_safety',
      readiness_conditions: JSON.stringify({
        governance_maturity_score: { gte: 70 },
        autonomous_topology_mutation: { eq: true },
      }),
      activation_thresholds: JSON.stringify({ min_governance_maturity: 70 }),
      dependencies: JSON.stringify(['topologyHealthEngine', 'semanticDriftEngine', 'governanceMaturityEngine']),
      risks_if_missing: 'Any future self-modifying topology system could recursively destabilize semantic clusters without human oversight.',
      implementation_priority: 7,
      current_status: 'future',
      recommended_action: 'Pre-register now. Activate only if autonomous topology mutation is ever implemented.',
    },
  ];

  for (const layer of layers) {
    try {
      db.run(
        `INSERT OR IGNORE INTO governance_roadmap
           (id, governance_layer, description, category, readiness_conditions,
            activation_thresholds, dependencies, risks_if_missing,
            implementation_priority, current_status, recommended_action)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          layer.id, layer.governance_layer, layer.description, layer.category,
          layer.readiness_conditions, layer.activation_thresholds, layer.dependencies,
          layer.risks_if_missing, layer.implementation_priority,
          layer.current_status, layer.recommended_action,
        ],
      );
    } catch (_) {}
  }
}

function migrateNicheIntelligence(database) {
  // Thread state persistence — one row per active topic thread
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_threads (
        thread_id       TEXT PRIMARY KEY,
        channel_id      TEXT NOT NULL,
        topic           TEXT,
        state           TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
        niche           TEXT,
        secondary_niche TEXT,
        mode            TEXT,
        brief           TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_wt_channel ON workspace_threads(channel_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_wt_state   ON workspace_threads(state);
    `);
  } catch (_) {}

  // Passive decision logger — seeded now, activated in V4
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS creator_decisions (
        id               TEXT PRIMARY KEY,
        channel_id       TEXT NOT NULL,
        action_type      TEXT NOT NULL,
        topic            TEXT,
        niche            TEXT,
        decided_at       TEXT NOT NULL DEFAULT (datetime('now')),
        outcome_video_id TEXT,
        outcome_views    INTEGER,
        outcome_filled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cd_channel ON creator_decisions(channel_id, decided_at DESC);
    `);
  } catch (_) {}

  // last_seen on channel_topics — needed for V2 topic evolution tracking
  try { database.exec(`ALTER TABLE channel_topics ADD COLUMN last_seen TEXT`); } catch (_) {}

  console.log('[DB] Niche intelligence migration complete (workspace_threads, creator_decisions, channel_topics.last_seen)');
}

function migrateCredits(database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS user_credits (
        client_id    TEXT PRIMARY KEY,
        plan         TEXT NOT NULL DEFAULT 'free',
        credits      INTEGER NOT NULL DEFAULT 50,
        rollover     INTEGER NOT NULL DEFAULT 0,
        topup        INTEGER NOT NULL DEFAULT 0,
        plan_expires TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT NOT NULL,
        action     TEXT NOT NULL,
        amount     INTEGER NOT NULL,
        balance    INTEGER NOT NULL,
        thread_id  TEXT,
        channel_id TEXT,
        meta       TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ct_client     ON credit_transactions(client_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ct_action     ON credit_transactions(action);
      CREATE INDEX IF NOT EXISTS idx_uc_plan       ON user_credits(plan);
    `);
  } catch (_) {}
  console.log('[DB] Credits migration complete (user_credits, credit_transactions)');
}

function migrateDrafts(database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS content_drafts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  TEXT NOT NULL,
        channel_id TEXT,
        topic      TEXT,
        cards_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_drafts_client ON content_drafts(client_id, created_at DESC);
    `);
  } catch (_) {}
  console.log('[DB] Drafts migration complete');
}

function migrateVoiceProfile(database) {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS creator_voice (
        channel_id       TEXT PRIMARY KEY,
        voice_analysis   TEXT,
        sample_sentences TEXT,
        skipped_at       TEXT,
        interaction_log  TEXT NOT NULL DEFAULT '[]',
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (_) {}
  console.log('[DB] creator_voice table ready');
}

function closeDb() {
  if (db) { try { db.close(); } catch (_) {} db = null; }
}

module.exports = { getDb, closeDb };
