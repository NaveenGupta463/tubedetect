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
    youtube_video_id  TEXT
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
`;

module.exports = SCHEMA;
