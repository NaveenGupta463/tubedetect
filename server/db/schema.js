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
`;

module.exports = SCHEMA;
