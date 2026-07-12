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
    is_short           INTEGER NOT NULL DEFAULT 0,
    thumbnail_url       TEXT,
    thumbnail_width     INTEGER,
    thumbnail_height    INTEGER,
    thumbnail_aspect_ratio REAL,
    format_type         TEXT    NOT NULL DEFAULT 'unknown',
    format_confidence   TEXT    NOT NULL DEFAULT 'low',
    format_reason       TEXT,
    ingest_source       TEXT,
    ingested_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    last_refreshed_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_iv_channel   ON ingested_videos(channel_id);
  CREATE INDEX IF NOT EXISTS idx_iv_niche     ON ingested_videos(niche);
  CREATE INDEX IF NOT EXISTS idx_iv_published ON ingested_videos(published_at);
  CREATE INDEX IF NOT EXISTS idx_iv_snapshot_due ON ingested_videos(published_at, last_refreshed_at, youtube_video_id);

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
  CREATE INDEX IF NOT EXISTS idx_vgs_video_bucket ON video_growth_snapshots(video_id, bucket);

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

  CREATE TABLE IF NOT EXISTS niche_benchmark_history (
    id                TEXT    PRIMARY KEY,
    snapshot_batch_id TEXT    NOT NULL,
    snapshot_at       TEXT    NOT NULL,
    niche             TEXT    NOT NULL,
    bucket            TEXT    NOT NULL,
    duration_bucket   TEXT    NOT NULL,
    sample_size       INTEGER,
    median_vph        REAL,
    p75_vph           REAL,
    p90_vph           REAL,
    median_sav        REAL,
    median_vsr        REAL,
    median_accel      REAL
  );
  CREATE INDEX IF NOT EXISTS idx_nbh_batch ON niche_benchmark_history(snapshot_batch_id);
  CREATE INDEX IF NOT EXISTS idx_nbh_niche ON niche_benchmark_history(niche, bucket, duration_bucket);
  CREATE INDEX IF NOT EXISTS idx_nbh_at    ON niche_benchmark_history(snapshot_at);

  CREATE TABLE IF NOT EXISTS intelligence_versions (
    id                         TEXT    PRIMARY KEY,
    created_at                 TEXT    NOT NULL DEFAULT (datetime('now')),
    trigger                    TEXT    NOT NULL,
    scoring_version_id         TEXT,
    prev_weights_json          TEXT,
    new_weights_json           TEXT,
    changed_weights_json       TEXT,
    health_score               REAL,
    learning_velocity          TEXT,
    benchmark_snapshot_id      TEXT,
    notes                      TEXT,
    rollback_tag               TEXT,
    rollback_source_version_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_iv_created ON intelligence_versions(created_at);
  CREATE INDEX IF NOT EXISTS idx_iv_trigger ON intelligence_versions(trigger);

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

  CREATE TABLE IF NOT EXISTS learning_health_snapshots (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date            TEXT    NOT NULL UNIQUE,
    mae                      REAL,
    calibration_trust_score  INTEGER,
    synthetic_ratio          REAL,
    stale_outcomes           INTEGER,
    benchmark_health         INTEGER,
    learning_velocity        TEXT,
    total_calibration_rows   INTEGER,
    real_rows                INTEGER,
    synthetic_rows           INTEGER,
    avg_confidence_score     REAL,
    benchmark_drift          REAL,
    weight_delta             REAL,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lhs_date ON learning_health_snapshots(snapshot_date);

  CREATE TABLE IF NOT EXISTS confidence_metrics (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    feature             TEXT    NOT NULL,
    niche               TEXT,
    confidence_score    REAL    NOT NULL,
    sample_depth_score  REAL    NOT NULL,
    recency_score       REAL    NOT NULL,
    coverage_score      REAL    NOT NULL,
    real_ratio_score    REAL    NOT NULL,
    stability_score     REAL    NOT NULL,
    routing_decision    TEXT    NOT NULL,
    reasons_json        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cfm_feature       ON confidence_metrics(feature);
  CREATE INDEX IF NOT EXISTS idx_cfm_feature_niche ON confidence_metrics(feature, niche);
  CREATE INDEX IF NOT EXISTS idx_cfm_created       ON confidence_metrics(created_at DESC);

  CREATE TABLE IF NOT EXISTS learning_confidence_history (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date            TEXT    NOT NULL,
    feature                  TEXT    NOT NULL,
    niche                    TEXT    NOT NULL DEFAULT '__all__',
    avg_confidence           REAL,
    routing_distribution_json TEXT,
    fallback_rate            REAL,
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(snapshot_date, feature, niche)
  );
  CREATE INDEX IF NOT EXISTS idx_lch_date    ON learning_confidence_history(snapshot_date);
  CREATE INDEX IF NOT EXISTS idx_lch_feature ON learning_confidence_history(feature, snapshot_date);
  CREATE INDEX IF NOT EXISTS idx_lch_niche   ON learning_confidence_history(niche, snapshot_date);

  CREATE TABLE IF NOT EXISTS routing_log (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    feature                TEXT    NOT NULL,
    niche                  TEXT,
    route_type             TEXT    NOT NULL,
    confidence_score       REAL,
    correctness_score      REAL,
    fallback_reason        TEXT,
    tokens_saved_estimate  INTEGER DEFAULT 0,
    latency_ms             INTEGER,
    cache_hit              INTEGER DEFAULT 0,
    routing_version        TEXT    DEFAULT 'v1',
    payload_hash           TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rl_feature    ON routing_log(feature);
  CREATE INDEX IF NOT EXISTS idx_rl_route_type ON routing_log(route_type);
  CREATE INDEX IF NOT EXISTS idx_rl_created    ON routing_log(created_at DESC);

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

  CREATE TABLE IF NOT EXISTS semantic_embeddings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type         TEXT    NOT NULL CHECK(source_type IN (
                          'ingested_video','title','hook_profile',
                          'niche_pattern','title_dna','creator_profile','benchmark_snapshot'
                        )),
    source_id           TEXT    NOT NULL,
    embedding_model     TEXT    NOT NULL DEFAULT 'tfidf_v1',
    embedding_version   TEXT    NOT NULL DEFAULT '1.0',
    vector_json         TEXT    NOT NULL,
    vector_norm         REAL    NOT NULL DEFAULT 1.0,
    semantic_cluster    TEXT,
    semantic_confidence REAL    NOT NULL DEFAULT 0.0,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_type, source_id, embedding_model, embedding_version)
  );
  CREATE INDEX IF NOT EXISTS idx_se_source_type ON semantic_embeddings(source_type);
  CREATE INDEX IF NOT EXISTS idx_se_source_id   ON semantic_embeddings(source_id);
  CREATE INDEX IF NOT EXISTS idx_se_cluster     ON semantic_embeddings(semantic_cluster);
  CREATE INDEX IF NOT EXISTS idx_se_model       ON semantic_embeddings(embedding_model, embedding_version);
  CREATE INDEX IF NOT EXISTS idx_se_created     ON semantic_embeddings(created_at);

  CREATE TABLE IF NOT EXISTS semantic_clusters (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_name     TEXT    NOT NULL UNIQUE,
    cluster_centroid TEXT    NOT NULL DEFAULT '{}',
    sample_size      INTEGER NOT NULL DEFAULT 0,
    avg_vph          REAL,
    confidence       REAL    NOT NULL DEFAULT 0.0,
    niches_present   TEXT,
    dominant_hooks   TEXT,
    trend_direction  TEXT    NOT NULL DEFAULT 'stable',
    centroid_version INTEGER NOT NULL DEFAULT 1,
    seeded           INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sc_name       ON semantic_clusters(cluster_name);
  CREATE INDEX IF NOT EXISTS idx_sc_confidence ON semantic_clusters(confidence DESC);
  CREATE INDEX IF NOT EXISTS idx_sc_trend      ON semantic_clusters(trend_direction);

  CREATE TABLE IF NOT EXISTS semantic_query_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash      TEXT    NOT NULL,
    source_type     TEXT,
    provider        TEXT    NOT NULL,
    query_text      TEXT,
    result_json     TEXT    NOT NULL,
    cache_hit_count INTEGER NOT NULL DEFAULT 0,
    latency_ms      INTEGER,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(query_hash, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_sqc_hash    ON semantic_query_cache(query_hash, provider);
  CREATE INDEX IF NOT EXISTS idx_sqc_created ON semantic_query_cache(created_at);

  CREATE TABLE IF NOT EXISTS strategy_recommendations (
    id                  TEXT    PRIMARY KEY,
    niche               TEXT,
    category            TEXT    NOT NULL,
    priority_score      REAL    NOT NULL DEFAULT 0,
    confidence          REAL    NOT NULL DEFAULT 0,
    expected_impact     REAL    NOT NULL DEFAULT 0,
    risk_level          TEXT    NOT NULL DEFAULT 'medium',
    estimated_uplift    REAL,
    time_horizon        TEXT,
    title               TEXT    NOT NULL,
    reasoning           TEXT    NOT NULL,
    supporting_evidence TEXT,
    source_signals      TEXT,
    rank                INTEGER,
    feedback            TEXT,
    feedback_at         TEXT,
    outcome_measured    INTEGER NOT NULL DEFAULT 0,
    measured_uplift     REAL,
    prediction_correct  INTEGER,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sr_niche    ON strategy_recommendations(niche);
  CREATE INDEX IF NOT EXISTS idx_sr_category ON strategy_recommendations(category);
  CREATE INDEX IF NOT EXISTS idx_sr_priority ON strategy_recommendations(priority_score DESC);
  CREATE INDEX IF NOT EXISTS idx_sr_created  ON strategy_recommendations(created_at);

  CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    recommendation_id   TEXT    NOT NULL,
    feedback_type       TEXT    NOT NULL CHECK(feedback_type IN ('useful','irrelevant','risky','successful','failed')),
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rf_rec_id  ON recommendation_feedback(recommendation_id);
  CREATE INDEX IF NOT EXISTS idx_rf_type    ON recommendation_feedback(feedback_type);
  CREATE INDEX IF NOT EXISTS idx_rf_created ON recommendation_feedback(created_at);

  CREATE TABLE IF NOT EXISTS embedding_ingest_jobs (
    id                  TEXT    PRIMARY KEY,
    status              TEXT    NOT NULL DEFAULT 'pending'
                                CHECK(status IN ('pending','running','paused','completed','failed')),
    stage               INTEGER NOT NULL DEFAULT 1,
    label               TEXT    NOT NULL DEFAULT 'manual',
    batch_size          INTEGER NOT NULL DEFAULT 500,
    max_titles          INTEGER,
    processed_count     INTEGER NOT NULL DEFAULT 0,
    error_count         INTEGER NOT NULL DEFAULT 0,
    skipped_count       INTEGER NOT NULL DEFAULT 0,
    retry_queue_size    INTEGER NOT NULL DEFAULT 0,
    final_batch_size    INTEGER,
    last_checkpoint_id  TEXT,
    error_message       TEXT,
    started_at          TEXT,
    completed_at        TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_eij_status     ON embedding_ingest_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_eij_stage      ON embedding_ingest_jobs(stage);
  CREATE INDEX IF NOT EXISTS idx_eij_created    ON embedding_ingest_jobs(created_at DESC);

  CREATE TABLE IF NOT EXISTS embedding_telemetry (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id                        TEXT,
    recorded_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
    embeddings_per_minute         INTEGER NOT NULL DEFAULT 0,
    avg_api_latency_ms            INTEGER NOT NULL DEFAULT 0,
    total_processed               INTEGER NOT NULL DEFAULT 0,
    total_errors                  INTEGER NOT NULL DEFAULT 0,
    api_success_rate              REAL    NOT NULL DEFAULT 1.0,
    duplicates_skipped            INTEGER NOT NULL DEFAULT 0,
    avg_vector_insert_latency_ms  INTEGER NOT NULL DEFAULT 0,
    total_tokens_used             INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_et_job_id    ON embedding_telemetry(job_id);
  CREATE INDEX IF NOT EXISTS idx_et_recorded  ON embedding_telemetry(recorded_at DESC);

  CREATE TABLE IF NOT EXISTS vector_validation_log (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at                TEXT    NOT NULL DEFAULT (datetime('now')),
    total_vectors         INTEGER NOT NULL DEFAULT 0,
    duplicate_count       INTEGER NOT NULL DEFAULT 0,
    orphan_count          INTEGER NOT NULL DEFAULT 0,
    bad_norm_count        INTEGER NOT NULL DEFAULT 0,
    corrupted_sample_rate REAL    NOT NULL DEFAULT 0,
    unassigned_count      INTEGER NOT NULL DEFAULT 0,
    knn_latency_ms        INTEGER NOT NULL DEFAULT 0,
    coverage_pct          REAL    NOT NULL DEFAULT 0,
    pending_count         INTEGER NOT NULL DEFAULT 0,
    error_count           INTEGER NOT NULL DEFAULT 0,
    warning_count         INTEGER NOT NULL DEFAULT 0,
    ok                    INTEGER NOT NULL DEFAULT 1,
    report_json           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_vvl_ran_at ON vector_validation_log(ran_at DESC);

  CREATE TABLE IF NOT EXISTS cluster_quality_snapshots (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at                TEXT    NOT NULL DEFAULT (datetime('now')),
    total_clusters        INTEGER NOT NULL DEFAULT 0,
    weak_cluster_count    INTEGER NOT NULL DEFAULT 0,
    low_confidence_count  INTEGER NOT NULL DEFAULT 0,
    avg_cohesion          REAL    NOT NULL DEFAULT 0,
    avg_separation        REAL    NOT NULL DEFAULT 0,
    overall_quality       TEXT    NOT NULL DEFAULT 'unknown',
    report_json           TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cqs_ran_at ON cluster_quality_snapshots(ran_at DESC);

  CREATE TABLE IF NOT EXISTS creator_discovery_candidates (
    candidate_key               TEXT    PRIMARY KEY,
    handle                      TEXT,
    candidate_type              TEXT    NOT NULL DEFAULT 'handle',
    score                       REAL    NOT NULL DEFAULT 0,
    total_mentions              INTEGER NOT NULL DEFAULT 0,
    distinct_source_channels    INTEGER NOT NULL DEFAULT 0,
    recent_mention_count        INTEGER NOT NULL DEFAULT 0,
    title_collab_count          INTEGER NOT NULL DEFAULT 0,
    description_mention_count   INTEGER NOT NULL DEFAULT 0,
    high_quality_source_count   INTEGER NOT NULL DEFAULT 0,
    thin_pool_relevance         REAL    NOT NULL DEFAULT 0,
    status                      TEXT    NOT NULL DEFAULT 'pending',
    resolved_channel_id         TEXT,
    resolved_title              TEXT,
    resolved_subscriber_count   INTEGER,
    resolved_video_count        INTEGER,
    resolved_country            TEXT,
    resolved_language           TEXT,
    rejection_reason            TEXT,
    created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                  TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at                 TEXT,
    admitted_at                 TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cdc_status    ON creator_discovery_candidates(status);
  CREATE INDEX IF NOT EXISTS idx_cdc_score     ON creator_discovery_candidates(score DESC);
  CREATE INDEX IF NOT EXISTS idx_cdc_type      ON creator_discovery_candidates(candidate_type);
  CREATE INDEX IF NOT EXISTS idx_cdc_resolved  ON creator_discovery_candidates(resolved_channel_id);

  CREATE TABLE IF NOT EXISTS creator_discovery_edges (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_key     TEXT    NOT NULL,
    source_channel_id TEXT,
    source_video_id   TEXT,
    evidence_type     TEXT    NOT NULL,
    evidence_text     TEXT,
    source_niche      TEXT,
    observed_at       TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (candidate_key) REFERENCES creator_discovery_candidates(candidate_key)
  );
  CREATE INDEX IF NOT EXISTS idx_cde_candidate ON creator_discovery_edges(candidate_key);
  CREATE INDEX IF NOT EXISTS idx_cde_source_ch ON creator_discovery_edges(source_channel_id);
  CREATE INDEX IF NOT EXISTS idx_cde_type      ON creator_discovery_edges(evidence_type);
`;

module.exports = SCHEMA;
