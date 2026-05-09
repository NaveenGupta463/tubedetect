// All 5 tables. Executed once via db.exec() on startup.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS videos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    title             TEXT    NOT NULL,
    hook              TEXT    NOT NULL,
    niche             TEXT    NOT NULL,
    channel_size      INTEGER NOT NULL,
    upload_date       TEXT,
    prediction_date   TEXT    NOT NULL,
    wing              TEXT    NOT NULL CHECK(wing IN ('pre', 'post')),
    youtube_video_id  TEXT,
    duration_seconds  INTEGER
  );

  CREATE TABLE IF NOT EXISTS features (
    video_id               INTEGER PRIMARY KEY,
    title_length           INTEGER,
    has_number             INTEGER,
    has_power_word         INTEGER,
    hook_type              TEXT CHECK(hook_type IN ('curiosity','story','shock','question','other')),
    hook_question_present  INTEGER,
    upload_day             INTEGER,
    days_since_last_upload INTEGER,
    niche_trend_score      REAL DEFAULT 0,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );

  CREATE TABLE IF NOT EXISTS predictions (
    video_id          INTEGER PRIMARY KEY,
    llm_score         REAL,
    ml_score          REAL,
    similarity_score  REAL,
    final_score       REAL,
    confidence        REAL,
    ensemble_weights  TEXT,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );

  CREATE TABLE IF NOT EXISTS performance_metrics (
    video_id                  INTEGER PRIMARY KEY,
    views_7d                  INTEGER,
    ctr_7d                    REAL,
    retention_7d              REAL,
    views_30d                 INTEGER,
    ctr_30d                   REAL,
    retention_30d             REAL,
    feedback_7d_collected     INTEGER DEFAULT 0,
    feedback_30d_collected    INTEGER DEFAULT 0,
    training_ready            INTEGER DEFAULT 0,
    performance_score         REAL,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );

  CREATE TABLE IF NOT EXISTS embeddings (
    video_id    INTEGER PRIMARY KEY,
    vector      TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_youtube_id
    ON videos(youtube_video_id)
    WHERE youtube_video_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS workspaces (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    data        TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prediction_feedback (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id    INTEGER,
    video_id         INTEGER,
    predicted_score  REAL,
    predicted_state  TEXT,
    confidence_state TEXT,
    pipeline_version TEXT,
    warnings_json    TEXT,
    predicted_at     TEXT,
    degraded_mode    INTEGER DEFAULT 0,
    actual_views_24h INTEGER,
    actual_views_7d  INTEGER,
    actual_ctr       REAL,
    actual_retention REAL,
    feedback_label   TEXT,
    feedback_reason  TEXT,
    user_notes       TEXT,
    resolved         INTEGER DEFAULT 0,
    created_at       TEXT,
    updated_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pf_prediction_id  ON prediction_feedback(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_pf_video_id       ON prediction_feedback(video_id);
  CREATE INDEX IF NOT EXISTS idx_pf_feedback_label ON prediction_feedback(feedback_label);
  CREATE INDEX IF NOT EXISTS idx_pf_created_at     ON prediction_feedback(created_at);

  CREATE TABLE IF NOT EXISTS video_outcomes (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id            INTEGER,
    video_id                 INTEGER,
    youtube_video_id         TEXT,
    pipeline_version         TEXT,

    predicted_score          REAL,
    predicted_state          TEXT,
    confidence_state         TEXT,
    niche                    TEXT,
    title                    TEXT,
    hook                     TEXT,

    published_at             TEXT,
    published_title          TEXT,
    published_thumbnail      TEXT,

    actual_views_1h          INTEGER,
    actual_views_24h         INTEGER,
    actual_views_7d          INTEGER,
    actual_ctr               REAL,
    actual_retention         REAL,

    velocity_1h              REAL,
    velocity_24h             REAL,
    velocity_7d              REAL,

    actual_performance_score REAL,
    calibration_error        REAL,
    calibration_band         TEXT,

    outcome_state            TEXT DEFAULT 'insufficient_data',
    drift_tags_json          TEXT,

    observed_at              TEXT,
    created_at               TEXT,
    last_refreshed_at        TEXT,
    refresh_count            INTEGER DEFAULT 0,
    refresh_attempts         INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_vo_prediction_id    ON video_outcomes(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_vo_youtube_video_id ON video_outcomes(youtube_video_id);
  CREATE INDEX IF NOT EXISTS idx_vo_created_at       ON video_outcomes(created_at);

  CREATE TABLE IF NOT EXISTS recommendation_actions (
    id                           TEXT    PRIMARY KEY,
    recommendation_id            TEXT    NOT NULL,
    recommendation_type          TEXT,
    status                       TEXT    NOT NULL DEFAULT 'pending',
    approved_by                  TEXT,
    approved_at                  TEXT,
    rejected_reason              TEXT,
    experiment_id                TEXT,
    recommendation_snapshot_json TEXT,
    created_at                   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ra_rec_id ON recommendation_actions(recommendation_id);
  CREATE INDEX IF NOT EXISTS idx_ra_status ON recommendation_actions(status);

  CREATE TABLE IF NOT EXISTS experiments (
    id                TEXT    PRIMARY KEY,
    name              TEXT    NOT NULL,
    description       TEXT,
    experiment_type   TEXT    NOT NULL,
    baseline_version  TEXT    NOT NULL,
    candidate_version TEXT    NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'draft',
    started_at        TEXT,
    completed_at      TEXT,
    result_summary    TEXT,
    winner            TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_exp_status ON experiments(status);

  CREATE TABLE IF NOT EXISTS scoring_versions (
    id                    TEXT    PRIMARY KEY,
    version_name          TEXT    NOT NULL,
    version_type          TEXT    NOT NULL DEFAULT 'ensemble_weights',
    weights_json          TEXT    NOT NULL,
    thresholds_json       TEXT,
    confidence_rules_json TEXT,
    active                INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by            TEXT,
    notes                 TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sv_active ON scoring_versions(active);

  CREATE TABLE IF NOT EXISTS video_outcomes_reality (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_video_id       TEXT    NOT NULL,
    video_id               INTEGER,
    niche                  TEXT,

    views_1h               INTEGER,
    views_6h               INTEGER,
    views_24h              INTEGER,
    views_72h              INTEGER,

    like_rate              REAL,
    comment_rate           REAL,
    share_rate             REAL,

    impression_velocity    REAL,
    ctr                    REAL,
    avg_view_duration      REAL,
    avg_retention_pct      REAL,
    audience_retention_json TEXT,
    sub_conversion_rate    REAL,

    velocity_state         TEXT,
    algorithm_push_score   REAL,
    viral_outcome          INTEGER DEFAULT 0,
    breakout_multiplier    REAL,
    is_false_positive      INTEGER DEFAULT 0,
    is_false_negative      INTEGER DEFAULT 0,
    false_positive_reason  TEXT,
    false_negative_reason  TEXT,
    signal_quality         TEXT,
    has_oauth_data         INTEGER DEFAULT 0,

    snapshot_created_at    TEXT,
    last_refreshed_at      TEXT,
    refresh_count          INTEGER DEFAULT 0,

    UNIQUE(youtube_video_id)
  );

  CREATE INDEX IF NOT EXISTS idx_vor_youtube_id     ON video_outcomes_reality(youtube_video_id);
  CREATE INDEX IF NOT EXISTS idx_vor_signal_quality ON video_outcomes_reality(signal_quality);

  CREATE TABLE IF NOT EXISTS scoring_weight_audit (
    id                   TEXT    PRIMARY KEY,
    version_type         TEXT    NOT NULL,
    old_version_id       TEXT,
    new_version_id       TEXT    NOT NULL,
    old_weights_json     TEXT,
    new_weights_json     TEXT    NOT NULL DEFAULT '{}',
    trigger_reason       TEXT    NOT NULL,
    experiment_id        TEXT,
    applied_by           TEXT,
    applied_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    rollback_of_audit_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_swa_version_type ON scoring_weight_audit(version_type);
  CREATE INDEX IF NOT EXISTS idx_swa_applied_at   ON scoring_weight_audit(applied_at);

  CREATE TABLE IF NOT EXISTS ingested_channels (
    id                  TEXT    PRIMARY KEY,
    channel_id          TEXT    NOT NULL UNIQUE,
    channel_name        TEXT,
    niche               TEXT    NOT NULL,
    uploads_playlist_id TEXT,
    channel_subscribers INTEGER,
    last_ingested_at         TEXT,
    ingest_enabled           INTEGER NOT NULL DEFAULT 1,
    trust_score              REAL    NOT NULL DEFAULT 1.0,
    weight_multiplier        REAL    NOT NULL DEFAULT 1.0,
    ignore_from_benchmarks   INTEGER NOT NULL DEFAULT 0,
    added_by                 TEXT    NOT NULL DEFAULT 'system',
    added_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
    notes                    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_ic_niche   ON ingested_channels(niche);
  CREATE INDEX IF NOT EXISTS idx_ic_enabled ON ingested_channels(ingest_enabled);

  CREATE TABLE IF NOT EXISTS ingested_videos (
    youtube_video_id    TEXT    PRIMARY KEY,
    channel_id          TEXT    NOT NULL,
    niche               TEXT    NOT NULL,
    title               TEXT    NOT NULL,
    description         TEXT,
    published_at        TEXT,
    duration_seconds    INTEGER,
    category_id         TEXT,
    views               INTEGER,
    likes               INTEGER,
    comments            INTEGER,
    channel_subscribers INTEGER,
    ingested_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    last_refreshed_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_iv_channel   ON ingested_videos(channel_id);
  CREATE INDEX IF NOT EXISTS idx_iv_niche     ON ingested_videos(niche);
  CREATE INDEX IF NOT EXISTS idx_iv_published ON ingested_videos(published_at);

  CREATE TABLE IF NOT EXISTS video_growth_snapshots (
    id                           TEXT PRIMARY KEY,
    video_id                     TEXT NOT NULL,
    bucket                       TEXT NOT NULL,
    age_hours_at_snapshot        REAL NOT NULL,
    views                        INTEGER,
    likes                        INTEGER,
    comments                     INTEGER,
    views_per_hour               REAL,
    subscriber_adjusted_velocity REAL,
    views_to_subscriber_ratio    REAL,
    velocity_acceleration        REAL,
    snapshotted_at               TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(video_id, bucket)
  );

  CREATE INDEX IF NOT EXISTS idx_vgs_video_id ON video_growth_snapshots(video_id);
  CREATE INDEX IF NOT EXISTS idx_vgs_bucket   ON video_growth_snapshots(bucket);

  CREATE TABLE IF NOT EXISTS niche_benchmarks (
    id              TEXT    PRIMARY KEY,
    niche           TEXT    NOT NULL,
    bucket          TEXT    NOT NULL,
    duration_bucket TEXT    NOT NULL,
    sample_size     INTEGER NOT NULL DEFAULT 0,
    median_views    REAL,
    p75_views       REAL,
    p90_views       REAL,
    median_vph      REAL,
    p75_vph         REAL,
    p90_vph         REAL,
    median_sav      REAL,
    median_vsr      REAL,
    median_accel    REAL,
    computed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(niche, bucket, duration_bucket)
  );

  CREATE INDEX IF NOT EXISTS idx_nb_niche  ON niche_benchmarks(niche);
  CREATE INDEX IF NOT EXISTS idx_nb_bucket ON niche_benchmarks(bucket);
`;

module.exports = SCHEMA;
