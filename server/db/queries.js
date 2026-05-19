// Centralized SQL queries — all raw SQL lives here, not in routes or services.
// Functions accept a `db` handle (from getDb()) and return the result directly.

// ── Videos ────────────────────────────────────────────────────────────────────

function insertVideo(db, { title, hook, niche, channel_size, upload_date, prediction_date, wing, youtube_video_id, last_updated_at, duration_seconds }) {
  return db.run(
    `INSERT INTO videos
       (title, hook, niche, channel_size, upload_date, prediction_date, wing, youtube_video_id, last_updated_at, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, hook, niche, channel_size, upload_date ?? null, prediction_date, wing, youtube_video_id ?? null, last_updated_at ?? null, duration_seconds ?? null],
  );
}

function getVideoById(db, id) {
  return db.get('SELECT * FROM videos WHERE id = ?', [id]);
}

function getVideoByYouTubeId(db, ytId) {
  return db.get(
    `SELECT v.*, pm.views, pm.likes, pm.performance_score, pm.training_ready, pm.upload_age_days
     FROM videos v
     LEFT JOIN performance_metrics pm ON pm.video_id = v.id
     WHERE v.youtube_video_id = ?`,
    [ytId],
  );
}

function updateVideoMeta(db, videoId, { title, channel_size, last_updated_at }) {
  db.run(
    `UPDATE videos SET title=?, channel_size=?, last_updated_at=? WHERE id=?`,
    [title, channel_size, last_updated_at, videoId],
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

function upsertFeatures(db, videoId, f) {
  db.run(
    `INSERT INTO features
       (video_id, title_length, has_number, has_power_word, hook_type,
        hook_question_present, upload_day, days_since_last_upload, niche_trend_score,
        curiosity_score, urgency_score, specificity_score, power_word_score, sentiment_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       title_length=excluded.title_length, has_number=excluded.has_number,
       curiosity_score=excluded.curiosity_score, urgency_score=excluded.urgency_score,
       specificity_score=excluded.specificity_score, power_word_score=excluded.power_word_score,
       sentiment_score=excluded.sentiment_score`,
    [
      videoId,
      f.title_length, f.has_number, f.has_power_word,
      f.hook_type, f.hook_question_present, f.upload_day,
      f.days_since_last_upload, f.niche_trend_score,
      f.curiosity_score, f.urgency_score, f.specificity_score,
      f.power_word_score, f.sentiment_score,
    ],
  );
}

// ── Performance metrics ────────────────────────────────────────────────────────

function upsertPerformanceMetrics(db, videoId, { views, likes, upload_age_days, performance_score }) {
  db.run(
    `INSERT INTO performance_metrics
       (video_id, views, likes, upload_age_days, performance_score, training_ready)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(video_id) DO UPDATE SET
       views=excluded.views, likes=excluded.likes,
       upload_age_days=excluded.upload_age_days,
       performance_score=excluded.performance_score,
       training_ready=1`,
    [videoId, views, likes ?? null, upload_age_days, performance_score],
  );
}

function insertPerformanceMetricsPlaceholder(db, videoId) {
  db.run('INSERT OR IGNORE INTO performance_metrics (video_id) VALUES (?)', [videoId]);
}

// ── Predictions ───────────────────────────────────────────────────────────────

function insertPrediction(db, videoId, { ml_score, similarity_score, final_score, confidence, ensemble_weights, feature_snapshot_json }) {
  return db.run(
    `INSERT INTO predictions
       (video_id, llm_score, ml_score, similarity_score, final_score, confidence, ensemble_weights, feature_snapshot_json)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    [videoId, ml_score, similarity_score, final_score, confidence, JSON.stringify(ensemble_weights), feature_snapshot_json ?? null],
  );
}

function upsertPrediction(db, videoId, { ml_score, similarity_score, final_score, confidence, ensemble_weights, feature_snapshot_json }) {
  db.run(
    `INSERT INTO predictions
       (video_id, llm_score, ml_score, similarity_score, final_score, confidence, ensemble_weights, feature_snapshot_json)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       ml_score=excluded.ml_score, similarity_score=excluded.similarity_score,
       final_score=excluded.final_score, confidence=excluded.confidence,
       ensemble_weights=excluded.ensemble_weights,
       feature_snapshot_json=COALESCE(excluded.feature_snapshot_json, feature_snapshot_json)`,
    [videoId, ml_score, similarity_score, final_score, confidence, JSON.stringify(ensemble_weights), feature_snapshot_json ?? null],
  );
}

// ── Results / metrics aggregates ──────────────────────────────────────────────

function getVideoResults(db, id) {
  return {
    video:       db.get('SELECT * FROM videos WHERE id = ?', [id]),
    features:    db.get('SELECT * FROM features WHERE video_id = ?', [id]),
    prediction:  db.get('SELECT * FROM predictions WHERE video_id = ?', [id]),
    performance: db.get('SELECT * FROM performance_metrics WHERE video_id = ?', [id]),
  };
}

function getMetricsCoverage(db) {
  return {
    total_videos:      db.get('SELECT COUNT(*) AS n FROM videos')?.n ?? 0,
    training_ready:    db.get('SELECT COUNT(*) AS n FROM performance_metrics WHERE training_ready=1')?.n ?? 0,
    with_embeddings:   db.get('SELECT COUNT(*) AS n FROM embeddings')?.n ?? 0,
    with_last_updated: db.get('SELECT COUNT(*) AS n FROM videos WHERE last_updated_at IS NOT NULL')?.n ?? 0,
  };
}

function getModelStatusCounts(db) {
  return {
    total_samples:        db.get('SELECT COUNT(*) AS c FROM videos')?.c ?? 0,
    training_ready_count: db.get('SELECT COUNT(*) AS c FROM performance_metrics WHERE training_ready=1')?.c ?? 0,
  };
}

function getDebugCounts(db) {
  return {
    total_videos:      db.get('SELECT COUNT(*) AS n FROM videos')?.n ?? 0,
    total_embeddings:  db.get('SELECT COUNT(*) AS n FROM embeddings')?.n ?? 0,
    total_predictions: db.get('SELECT COUNT(*) AS n FROM predictions')?.n ?? 0,
  };
}

// ── Feedback ──────────────────────────────────────────────────────────────────

function updateFeedback(db, videoId, correction, reason) {
  return db.run(
    'UPDATE predictions SET user_correction=?, correction_reason=? WHERE video_id=?',
    [correction, reason ?? null, videoId],
  );
}

// ── Workspaces ────────────────────────────────────────────────────────────────

function getDbStats(db) {
  const tables = ['videos', 'features', 'predictions', 'performance_metrics', 'embeddings', 'workspaces', 'prediction_feedback', 'video_outcomes'];
  const counts = {};
  for (const t of tables) {
    try { counts[t] = db.get(`SELECT COUNT(*) as n FROM ${t}`)?.n ?? 0; }
    catch { counts[t] = null; }
  }
  const pageCount = db.get('PRAGMA page_count')?.page_count ?? 0;
  const pageSize  = db.get('PRAGMA page_size')?.page_size  ?? 0;
  return { counts, size_bytes: pageCount * pageSize };
}

function getAllWorkspaces(db) {
  return db.all('SELECT * FROM workspaces ORDER BY updated_at DESC');
}

function getWorkspaceById(db, id) {
  return db.get('SELECT * FROM workspaces WHERE id = ?', [id]);
}

function insertWorkspace(db, { id, name, created_at, updated_at, data }) {
  return db.run(
    'INSERT INTO workspaces (id, name, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)',
    [id, name, created_at, updated_at, typeof data === 'string' ? data : JSON.stringify(data)],
  );
}

function updateWorkspace(db, id, { name, updated_at, data }) {
  return db.run(
    'UPDATE workspaces SET name=?, updated_at=?, data=? WHERE id=?',
    [name, updated_at, typeof data === 'string' ? data : JSON.stringify(data), id],
  );
}

function deleteWorkspace(db, id) {
  return db.run('DELETE FROM workspaces WHERE id = ?', [id]);
}

// ── Prediction feedback ────────────────────────────────────────────────────────

function insertPredictionFeedbackSnapshot(db, {
  prediction_id, video_id, predicted_score, predicted_state, confidence_state,
  pipeline_version, warnings_json, predicted_at, degraded_mode, created_at, updated_at,
}) {
  return db.run(
    `INSERT INTO prediction_feedback
       (prediction_id, video_id, predicted_score, predicted_state, confidence_state,
        pipeline_version, warnings_json, predicted_at, degraded_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      prediction_id, video_id, predicted_score, predicted_state ?? null, confidence_state ?? null,
      pipeline_version, warnings_json ?? null, predicted_at, degraded_mode ? 1 : 0,
      created_at, updated_at,
    ],
  );
}

function getSnapshotByPredictionId(db, predictionId) {
  return db.get('SELECT * FROM prediction_feedback WHERE prediction_id = ?', [predictionId]);
}

function updatePredictionFeedbackLabel(db, id, { feedback_label, feedback_reason, user_notes, updated_at }) {
  return db.run(
    'UPDATE prediction_feedback SET feedback_label=?, feedback_reason=?, user_notes=?, updated_at=? WHERE id=?',
    [feedback_label, feedback_reason ?? null, user_notes ?? null, updated_at, id],
  );
}

function updatePredictionFeedbackOutcomes(db, id, { actual_views_24h, actual_views_7d, actual_ctr, actual_retention, updated_at }) {
  return db.run(
    'UPDATE prediction_feedback SET actual_views_24h=?, actual_views_7d=?, actual_ctr=?, actual_retention=?, updated_at=? WHERE id=?',
    [actual_views_24h ?? null, actual_views_7d ?? null, actual_ctr ?? null, actual_retention ?? null, updated_at, id],
  );
}

function getFeedbackStats(db) {
  return db.get(`
    SELECT
      COUNT(*) AS total_snapshots,
      SUM(CASE WHEN feedback_label IS NOT NULL THEN 1 ELSE 0 END)                               AS total_reviewed,
      SUM(CASE WHEN feedback_label = 'accurate'   THEN 1 ELSE 0 END)                            AS accurate_count,
      SUM(CASE WHEN feedback_label = 'inaccurate' THEN 1 ELSE 0 END)                            AS inaccurate_count,
      SUM(CASE WHEN feedback_label = 'partial'    THEN 1 ELSE 0 END)                            AS partial_count,
      SUM(CASE WHEN pipeline_version = 'legacy'      THEN 1 ELSE 0 END)                         AS legacy_count,
      SUM(CASE WHEN pipeline_version = 'pipeline_v1' THEN 1 ELSE 0 END)                         AS pipeline_v1_count,
      SUM(CASE WHEN degraded_mode = 1 THEN 1 ELSE 0 END)                                        AS degraded_count,
      SUM(CASE WHEN degraded_mode = 1 AND feedback_label IS NOT NULL  THEN 1 ELSE 0 END)         AS degraded_reviewed_count,
      SUM(CASE WHEN degraded_mode = 1 AND feedback_label = 'accurate' THEN 1 ELSE 0 END)         AS degraded_accurate_count,
      MAX(updated_at) AS last_feedback_at
    FROM prediction_feedback
  `);
}

// ── Video outcomes ─────────────────────────────────────────────────────────────

function insertVideoOutcome(db, {
  prediction_id, video_id, youtube_video_id, pipeline_version,
  predicted_score, predicted_state, confidence_state,
  niche, title, hook,
  published_at, published_title, published_thumbnail,
  outcome_state, observed_at, created_at,
}) {
  return db.run(
    `INSERT INTO video_outcomes
       (prediction_id, video_id, youtube_video_id, pipeline_version,
        predicted_score, predicted_state, confidence_state,
        niche, title, hook,
        published_at, published_title, published_thumbnail,
        outcome_state, observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      prediction_id ?? null, video_id ?? null, youtube_video_id, pipeline_version ?? 'legacy',
      predicted_score ?? null, predicted_state ?? null, confidence_state ?? null,
      niche ?? null, title ?? null, hook ?? null,
      published_at ?? null, published_title ?? null, published_thumbnail ?? null,
      outcome_state ?? 'insufficient_data', observed_at, created_at,
    ],
  );
}

function getVideoOutcomeByPredictionId(db, predictionId) {
  return db.get('SELECT * FROM video_outcomes WHERE prediction_id = ?', [predictionId]);
}

function getMostRecentOutcomeByYouTubeId(db, ytId) {
  return db.get(
    'SELECT * FROM video_outcomes WHERE youtube_video_id = ? ORDER BY created_at DESC LIMIT 1',
    [ytId],
  );
}

function updateVideoOutcomeRefresh(db, id, {
  actual_views_1h, actual_views_24h, actual_views_7d, actual_ctr, actual_retention,
  velocity_1h, velocity_24h, velocity_7d,
  actual_performance_score, calibration_error, calibration_band, outcome_state,
  last_refreshed_at,
}) {
  return db.run(
    `UPDATE video_outcomes SET
       actual_views_1h=?, actual_views_24h=?, actual_views_7d=?,
       actual_ctr=?, actual_retention=?,
       velocity_1h=?, velocity_24h=?, velocity_7d=?,
       actual_performance_score=?, calibration_error=?, calibration_band=?,
       outcome_state=?, last_refreshed_at=?,
       refresh_count = refresh_count + 1
     WHERE id=?`,
    [
      actual_views_1h ?? null, actual_views_24h ?? null, actual_views_7d ?? null,
      actual_ctr ?? null, actual_retention ?? null,
      velocity_1h ?? null, velocity_24h ?? null, velocity_7d ?? null,
      actual_performance_score ?? null, calibration_error ?? null, calibration_band ?? null,
      outcome_state, last_refreshed_at, id,
    ],
  );
}

function getOutcomeStats(db) {
  return db.get(`
    SELECT
      COUNT(*)                                                                         AS total_tracked,
      SUM(CASE WHEN published_at IS NOT NULL THEN 1 ELSE 0 END)                       AS published_count,
      SUM(CASE WHEN calibration_error IS NOT NULL THEN 1 ELSE 0 END)                  AS calibrated_count,
      AVG(CASE WHEN calibration_error IS NOT NULL THEN ABS(calibration_error) END)    AS avg_abs_error,
      SUM(CASE WHEN calibration_error > 0 THEN 1 ELSE 0 END)                         AS over_count,
      SUM(CASE WHEN calibration_error < 0 THEN 1 ELSE 0 END)                         AS under_count,
      SUM(CASE WHEN calibration_error IS NOT NULL
               AND ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)                   AS accurate_count
    FROM video_outcomes
  `);
}

function getOutcomeRowsForDrift(db, limit) {
  return db.all(
    `SELECT niche, calibration_error, calibration_band, actual_ctr, actual_retention,
            pipeline_version, outcome_state, created_at
     FROM video_outcomes
     WHERE calibration_error IS NOT NULL OR actual_ctr IS NOT NULL
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit ?? 100],
  );
}

function getOutcomeRefreshQueueSize(db) {
  return db.get(`
    SELECT COUNT(*) AS n FROM video_outcomes
    WHERE youtube_video_id IS NOT NULL AND published_at IS NOT NULL
      AND (last_refreshed_at IS NULL
           OR last_refreshed_at < datetime('now', '-6 hours'))
  `)?.n ?? 0;
}

function getOutcomeStaleCount(db) {
  return db.get(`
    SELECT COUNT(*) AS n FROM video_outcomes
    WHERE youtube_video_id IS NOT NULL AND published_at IS NOT NULL
      AND (last_refreshed_at IS NULL
           OR last_refreshed_at < datetime('now', '-24 hours'))
  `)?.n ?? 0;
}

// ── Analytics aggregation ─────────────────────────────────────────────────────

function getCalibrationTimeline(db, days) {
  const n = parseInt(days, 10) || 90;
  return db.all(
    `SELECT
       DATE(last_refreshed_at)                                           AS date,
       COUNT(*)                                                          AS count,
       AVG(ABS(calibration_error))                                       AS mae,
       AVG(calibration_error)                                            AS avg_error,
       SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)    AS accurate_count,
       SUM(CASE WHEN calibration_error > 10       THEN 1 ELSE 0 END)    AS over_count,
       SUM(CASE WHEN calibration_error < -10      THEN 1 ELSE 0 END)    AS under_count
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND last_refreshed_at >= datetime('now', '-${n} days')
     GROUP BY DATE(last_refreshed_at)
     ORDER BY date ASC`,
  );
}

function getConfidenceReliability(db) {
  return db.all(
    `SELECT
       COALESCE(LOWER(TRIM(confidence_state)), 'unknown') AS confidence_bucket,
       COUNT(*)                                            AS total,
       SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END) AS accurate_count,
       SUM(CASE WHEN ABS(calibration_error) > 10  THEN 1 ELSE 0 END) AS inaccurate_count,
       AVG(ABS(calibration_error))                        AS mae,
       AVG(actual_performance_score)                      AS avg_actual
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY confidence_bucket`,
  );
}

function getNicheDriftMetrics(db) {
  return db.all(
    `SELECT
       COALESCE(LOWER(TRIM(niche)), 'unknown') AS niche,
       COUNT(*)                                AS count,
       AVG(calibration_error)                  AS avg_error,
       AVG(ABS(calibration_error))             AS mae
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY niche
     ORDER BY mae DESC`,
  );
}

function getPredictionAccuracySummary(db) {
  return db.get(
    `SELECT
       COUNT(*)                                                           AS total,
       AVG(ABS(calibration_error))                                        AS mae,
       AVG(calibration_error)                                             AS avg_error,
       SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)     AS accurate_count,
       SUM(CASE WHEN calibration_error > 10        THEN 1 ELSE 0 END)    AS over_count,
       SUM(CASE WHEN calibration_error < -10       THEN 1 ELSE 0 END)    AS under_count
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL`,
  );
}

function getCalibrationDistribution(db) {
  return db.all(
    `SELECT calibration_band, COUNT(*) AS count
     FROM video_outcomes
     WHERE calibration_band IS NOT NULL
     GROUP BY calibration_band`,
  );
}

function getRecentPredictionErrors(db, limit) {
  return db.all(
    `SELECT
       title,
       COALESCE(LOWER(TRIM(niche)), 'unknown') AS niche,
       calibration_error,
       calibration_band,
       predicted_score,
       actual_performance_score,
       last_refreshed_at
     FROM video_outcomes
     WHERE calibration_error IS NOT NULL
     ORDER BY last_refreshed_at DESC
     LIMIT ?`,
    [limit ?? 10],
  );
}

function getTopDriftingNiches(db, limit) {
  return db.all(
    `SELECT
       COALESCE(LOWER(TRIM(niche)), 'unknown') AS niche,
       COUNT(*)                                AS count,
       AVG(calibration_error)                  AS avg_error,
       AVG(ABS(calibration_error))             AS mae
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY niche
     ORDER BY mae DESC
     LIMIT ?`,
    [limit ?? 10],
  );
}

function getPredictionTrendBuckets(db) {
  return db.all(
    `SELECT
       strftime('%Y-W%W', last_refreshed_at)                             AS week,
       COUNT(*)                                                          AS total,
       SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)    AS accurate_count,
       SUM(CASE WHEN calibration_error > 10        THEN 1 ELSE 0 END)   AS over_count,
       SUM(CASE WHEN calibration_error < -10       THEN 1 ELSE 0 END)   AS under_count
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND last_refreshed_at >= datetime('now', '-90 days')
     GROUP BY week
     ORDER BY week ASC`,
  );
}

// ── Learning engine queries ────────────────────────────────────────────────────

function getLearningOutcomeRows(db) {
  return db.all(
    `SELECT
       COALESCE(LOWER(TRIM(vo.niche)), 'unknown')            AS niche,
       vo.calibration_error,
       COALESCE(LOWER(TRIM(vo.confidence_state)), 'unknown') AS confidence_state,
       vo.pipeline_version,
       vo.video_id,
       COALESCE(vo.calibration_weight, 1.0)                  AS calibration_weight
     FROM video_outcomes vo
     JOIN ingested_videos iv ON iv.youtube_video_id = vo.youtube_video_id
     JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     JOIN corpus_channels cc ON cc.channel_id = ic.channel_id AND cc.training_eligible = 1
     WHERE vo.actual_performance_score IS NOT NULL
       AND vo.calibration_error IS NOT NULL
     ORDER BY vo.created_at DESC
     LIMIT 500`,
  );
}

function getDegradedModeRows(db) {
  return db.all(
    `SELECT vo.calibration_error
     FROM prediction_feedback pf
     JOIN video_outcomes vo ON vo.prediction_id = pf.prediction_id
     WHERE pf.degraded_mode = 1
       AND vo.calibration_error IS NOT NULL`,
  );
}

function getHookTypeOutcomeRows(db) {
  return db.all(
    `SELECT
       COALESCE(f.hook_type, 'unknown') AS hook_type,
       vo.calibration_error
     FROM video_outcomes vo
     JOIN features f ON f.video_id = vo.video_id
     WHERE vo.calibration_error IS NOT NULL
       AND vo.video_id IS NOT NULL`,
  );
}

// ── Scoring weight audit ──────────────────────────────────────────────────────

function getActiveScoringVersionByType(db, versionType) {
  return db.get(
    'SELECT * FROM scoring_versions WHERE active = 1 AND version_type = ? ORDER BY created_at DESC LIMIT 1',
    [versionType],
  );
}

function activateScoringVersion(db, versionId, versionType) {
  db.run('UPDATE scoring_versions SET active = 0 WHERE version_type = ?', [versionType]);
  db.run('UPDATE scoring_versions SET active = 1 WHERE id = ?', [versionId]);
}

function insertScoringWeightAudit(db, { id, version_type, old_version_id, new_version_id, old_weights_json, new_weights_json, trigger_reason, experiment_id, applied_by, rollback_of_audit_id }) {
  return db.run(
    `INSERT INTO scoring_weight_audit
       (id, version_type, old_version_id, new_version_id, old_weights_json, new_weights_json,
        trigger_reason, experiment_id, applied_by, applied_at, rollback_of_audit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, version_type,
      old_version_id ?? null,
      new_version_id,
      old_weights_json != null ? (typeof old_weights_json === 'string' ? old_weights_json : JSON.stringify(old_weights_json)) : null,
      typeof new_weights_json === 'string' ? new_weights_json : JSON.stringify(new_weights_json),
      trigger_reason,
      experiment_id ?? null,
      applied_by ?? 'system',
      new Date().toISOString(),
      rollback_of_audit_id ?? null,
    ],
  );
}

function getScoringWeightAuditLog(db, limit) {
  return db.all(
    'SELECT * FROM scoring_weight_audit ORDER BY applied_at DESC LIMIT ?',
    [limit ?? 50],
  );
}

function getMostRecentAuditForType(db, versionType) {
  return db.get(
    'SELECT * FROM scoring_weight_audit WHERE version_type = ? ORDER BY applied_at DESC LIMIT 1',
    [versionType],
  );
}

// ── Scoring versions ──────────────────────────────────────────────────────────

function insertScoringVersion(db, { id, version_name, version_type, weights_json, thresholds_json, confidence_rules_json, created_by, notes }) {
  return db.run(
    `INSERT INTO scoring_versions
       (id, version_name, version_type, weights_json, thresholds_json, confidence_rules_json, active, created_at, created_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [
      id, version_name, version_type ?? 'ensemble_weights',
      typeof weights_json === 'string' ? weights_json : JSON.stringify(weights_json),
      thresholds_json ? JSON.stringify(thresholds_json) : null,
      confidence_rules_json ? JSON.stringify(confidence_rules_json) : null,
      new Date().toISOString(), created_by ?? 'user', notes ?? null,
    ],
  );
}

function getActiveScoringVersion(db) {
  return db.get('SELECT * FROM scoring_versions WHERE active = 1 ORDER BY created_at DESC LIMIT 1');
}

function getScoringVersionById(db, id) {
  return db.get('SELECT * FROM scoring_versions WHERE id = ?', [id]);
}

function getScoringVersions(db) {
  return db.all('SELECT id, version_name, version_type, active, created_at, created_by, notes FROM scoring_versions ORDER BY created_at DESC');
}

// ── Experiments ───────────────────────────────────────────────────────────────

function insertExperiment(db, { id, name, description, experiment_type, baseline_version, candidate_version }) {
  return db.run(
    `INSERT INTO experiments (id, name, description, experiment_type, baseline_version, candidate_version, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [id, name, description ?? null, experiment_type, baseline_version, candidate_version, new Date().toISOString()],
  );
}

function getExperiment(db, id) {
  return db.get('SELECT * FROM experiments WHERE id = ?', [id]);
}

function getExperiments(db) {
  return db.all(
    'SELECT id, name, description, experiment_type, baseline_version, candidate_version, status, winner, started_at, completed_at, created_at FROM experiments ORDER BY created_at DESC',
  );
}

function updateExperimentRun(db, id, { status, started_at, completed_at, result_summary, winner }) {
  return db.run(
    `UPDATE experiments SET status=?, started_at=?, completed_at=?, result_summary=?, winner=? WHERE id=?`,
    [
      status,
      started_at ?? null,
      completed_at ?? null,
      result_summary ? (typeof result_summary === 'string' ? result_summary : JSON.stringify(result_summary)) : null,
      winner ?? null,
      id,
    ],
  );
}

// ── Recommendation actions ────────────────────────────────────────────────────

function insertRecommendationAction(db, { id, recommendation_id, recommendation_type, status, approved_by, approved_at, rejected_reason, experiment_id, recommendation_snapshot }) {
  return db.run(
    `INSERT INTO recommendation_actions
       (id, recommendation_id, recommendation_type, status, approved_by, approved_at, rejected_reason, experiment_id, recommendation_snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, recommendation_id, recommendation_type ?? null,
      status, approved_by ?? 'user', approved_at ?? null,
      rejected_reason ?? null, experiment_id ?? null,
      recommendation_snapshot ? JSON.stringify(recommendation_snapshot) : null,
      new Date().toISOString(),
    ],
  );
}

function getRecommendationActions(db) {
  return db.all('SELECT * FROM recommendation_actions ORDER BY created_at DESC');
}

function updateRecommendationActionExperiment(db, id, experimentId) {
  return db.run('UPDATE recommendation_actions SET experiment_id=? WHERE id=?', [experimentId, id]);
}

// ── Simulation row fetchers ───────────────────────────────────────────────────

function getSimulationRowsEnsemble(db) {
  return db.all(
    `SELECT
       p.ml_score, p.similarity_score,
       vo.actual_performance_score, vo.calibration_error,
       COALESCE(LOWER(TRIM(vo.niche)), 'unknown') AS niche
     FROM predictions p
     JOIN video_outcomes vo ON vo.video_id = p.video_id
     WHERE p.ml_score IS NOT NULL
       AND p.similarity_score IS NOT NULL
       AND vo.actual_performance_score IS NOT NULL
       AND vo.calibration_error IS NOT NULL
     ORDER BY vo.created_at DESC
     LIMIT 500`,
  );
}

function getSimulationRowsNicheBias(db) {
  return db.all(
    `SELECT
       predicted_score, actual_performance_score, calibration_error,
       COALESCE(LOWER(TRIM(niche)), 'unknown') AS niche
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND calibration_error IS NOT NULL
       AND predicted_score IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 500`,
  );
}

// ── Video outcomes reality ────────────────────────────────────────────────────

function getVideoOutcomeRealityByYouTubeId(db, ytId) {
  return db.get('SELECT * FROM video_outcomes_reality WHERE youtube_video_id = ?', [ytId]);
}

function upsertVideoOutcomeReality(db, youtubeVideoId, data) {
  const toN = v => v != null ? Number(v) : null;
  return db.run(
    `INSERT INTO video_outcomes_reality
       (youtube_video_id, video_id, niche,
        views_1h, views_6h, views_24h, views_72h,
        like_rate, comment_rate, share_rate,
        impression_velocity, ctr, avg_view_duration, avg_retention_pct, sub_conversion_rate,
        velocity_state, algorithm_push_score, viral_outcome, breakout_multiplier,
        is_false_positive, is_false_negative, false_positive_reason, false_negative_reason,
        signal_quality, has_oauth_data, snapshot_created_at, last_refreshed_at, refresh_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, 1)
     ON CONFLICT(youtube_video_id) DO UPDATE SET
       video_id             = COALESCE(excluded.video_id, video_id),
       niche                = COALESCE(excluded.niche, niche),
       views_1h  = CASE WHEN views_1h  IS NULL AND excluded.views_1h  IS NOT NULL THEN excluded.views_1h  ELSE views_1h  END,
       views_6h  = CASE WHEN views_6h  IS NULL AND excluded.views_6h  IS NOT NULL THEN excluded.views_6h  ELSE views_6h  END,
       views_24h = CASE WHEN views_24h IS NULL AND excluded.views_24h IS NOT NULL THEN excluded.views_24h ELSE views_24h END,
       views_72h = CASE WHEN views_72h IS NULL AND excluded.views_72h IS NOT NULL THEN excluded.views_72h ELSE views_72h END,
       like_rate             = COALESCE(excluded.like_rate, like_rate),
       comment_rate          = COALESCE(excluded.comment_rate, comment_rate),
       share_rate            = COALESCE(excluded.share_rate, share_rate),
       impression_velocity   = COALESCE(excluded.impression_velocity, impression_velocity),
       ctr                   = COALESCE(excluded.ctr, ctr),
       avg_view_duration     = COALESCE(excluded.avg_view_duration, avg_view_duration),
       avg_retention_pct     = COALESCE(excluded.avg_retention_pct, avg_retention_pct),
       sub_conversion_rate   = COALESCE(excluded.sub_conversion_rate, sub_conversion_rate),
       has_oauth_data        = MAX(has_oauth_data, excluded.has_oauth_data),
       velocity_state        = excluded.velocity_state,
       algorithm_push_score  = excluded.algorithm_push_score,
       viral_outcome         = excluded.viral_outcome,
       breakout_multiplier   = excluded.breakout_multiplier,
       is_false_positive     = excluded.is_false_positive,
       is_false_negative     = excluded.is_false_negative,
       false_positive_reason = excluded.false_positive_reason,
       false_negative_reason = excluded.false_negative_reason,
       signal_quality        = excluded.signal_quality,
       last_refreshed_at     = excluded.last_refreshed_at,
       refresh_count         = refresh_count + 1`,
    [
      youtubeVideoId,
      data.video_id ?? null,
      data.niche ?? null,
      toN(data.views_1h), toN(data.views_6h), toN(data.views_24h), toN(data.views_72h),
      toN(data.like_rate), toN(data.comment_rate), toN(data.share_rate),
      toN(data.impression_velocity), toN(data.ctr), toN(data.avg_view_duration),
      toN(data.avg_retention_pct), toN(data.sub_conversion_rate),
      data.velocity_state ?? null,
      toN(data.algorithm_push_score),
      data.viral_outcome ? 1 : 0,
      toN(data.breakout_multiplier),
      data.is_false_positive ? 1 : 0,
      data.is_false_negative ? 1 : 0,
      data.false_positive_reason ?? null,
      data.false_negative_reason ?? null,
      data.signal_quality ?? null,
      data.has_oauth_data ? 1 : 0,
      data.last_refreshed_at ?? new Date().toISOString(),
    ],
  );
}

function getRealityRowsForLearning(db) {
  return db.all(
    `SELECT
       vr.youtube_video_id, vr.views_1h, vr.views_6h, vr.views_24h, vr.views_72h,
       vr.like_rate, vr.comment_rate, vr.ctr, vr.avg_retention_pct,
       vr.velocity_state, vr.algorithm_push_score,
       vr.viral_outcome, vr.breakout_multiplier,
       vr.is_false_positive, vr.is_false_negative,
       vr.false_positive_reason, vr.false_negative_reason,
       vr.signal_quality, vr.has_oauth_data,
       vr.created_at AS reality_created_at,
       vo.predicted_score, vo.calibration_error,
       COALESCE(LOWER(TRIM(vo.niche)), 'unknown') AS niche,
       vo.title
     FROM video_outcomes_reality vr
     JOIN video_outcomes vo ON vo.youtube_video_id = vr.youtube_video_id
     WHERE vr.signal_quality != 'insufficient'
     ORDER BY vr.last_refreshed_at DESC
     LIMIT 200`,
  );
}

function getChannelViewHistory(db, niche) {
  return db.all(
    `SELECT actual_views_24h
     FROM video_outcomes
     WHERE actual_views_24h IS NOT NULL
       AND actual_views_24h > 0
       AND COALESCE(LOWER(TRIM(niche)), 'unknown') = ?
     ORDER BY actual_views_24h ASC
     LIMIT 100`,
    [(niche ?? 'unknown').toLowerCase().trim()],
  );
}

// ── Ingested channels ─────────────────────────────────────────────────────────

function getIngestableChannels(db) {
  return db.all(
    `SELECT * FROM ingested_channels WHERE ingest_enabled = 1 AND last_ingested_at IS NULL
     ORDER BY added_at ASC`,
  );
}

function getAllIngestedChannels(db) {
  return db.all('SELECT * FROM ingested_channels ORDER BY added_at DESC');
}

function upsertIngestedChannel(db, { id, channel_id, channel_name, niche, uploads_playlist_id, channel_subscribers, added_by, notes, ignore_from_benchmarks = 0, community_id = null }) {
  return db.run(
    `INSERT INTO ingested_channels
       (id, channel_id, channel_name, niche, uploads_playlist_id, channel_subscribers, added_by, notes, ignore_from_benchmarks, community_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET
       channel_name          = COALESCE(excluded.channel_name, channel_name),
       uploads_playlist_id   = COALESCE(excluded.uploads_playlist_id, uploads_playlist_id),
       channel_subscribers   = COALESCE(excluded.channel_subscribers, channel_subscribers),
       community_id          = COALESCE(ingested_channels.community_id, excluded.community_id)`,
    [id, channel_id, channel_name ?? null, niche, uploads_playlist_id ?? null,
     channel_subscribers ?? null, added_by ?? 'system', notes ?? null, ignore_from_benchmarks ? 1 : 0, community_id],
  );
}

function updateChannelIngestMetadata(db, channelId, { uploadsPlaylistId, channelName, channelSubscribers }) {
  db.run(
    `UPDATE ingested_channels
     SET uploads_playlist_id = ?,
         channel_name        = COALESCE(?, channel_name),
         channel_subscribers = COALESCE(?, channel_subscribers)
     WHERE channel_id = ?`,
    [uploadsPlaylistId, channelName ?? null, channelSubscribers ?? null, channelId],
  );
}

function markChannelIngested(db, channelId) {
  db.run(
    "UPDATE ingested_channels SET last_ingested_at = datetime('now') WHERE channel_id = ?",
    [channelId],
  );
}

function setChannelEnabled(db, id, enabled) {
  db.run('UPDATE ingested_channels SET ingest_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
}

function setOwnChannel(db, id, isOwn) {
  db.run('UPDATE ingested_channels SET is_own_channel = ? WHERE id = ?', [isOwn ? 1 : 0, id]);
}

// ── Ingested videos ───────────────────────────────────────────────────────────

function upsertIngestedVideo(db, {
  youtube_video_id, channel_id, niche, title, description,
  published_at, duration_seconds, category_id,
  views, likes, comments, channel_subscribers,
}) {
  db.run(
    `INSERT INTO ingested_videos
       (youtube_video_id, channel_id, niche, title, description, published_at,
        duration_seconds, category_id, views, likes, comments, channel_subscribers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(youtube_video_id) DO UPDATE SET
       views             = excluded.views,
       likes             = excluded.likes,
       comments          = excluded.comments,
       last_refreshed_at = datetime('now')`,
    [
      youtube_video_id, channel_id, niche, title, description ?? null,
      published_at ?? null, duration_seconds ?? null, category_id ?? null,
      views ?? 0, likes ?? 0, comments ?? 0, channel_subscribers ?? null,
    ],
  );
}

function getIngestedVideosByNiche(db, niche) {
  return db.all(
    'SELECT * FROM ingested_videos WHERE niche = ? ORDER BY published_at DESC',
    [niche],
  );
}

function getIngestedVideoCount(db) {
  return db.get('SELECT COUNT(*) AS n FROM ingested_videos')?.n ?? 0;
}

// ── Video growth snapshots ────────────────────────────────────────────────────

function insertGrowthSnapshot(db, {
  id, video_id, bucket, age_hours_at_snapshot,
  views, likes, comments,
  views_per_hour, subscriber_adjusted_velocity,
  views_to_subscriber_ratio, velocity_acceleration,
}) {
  db.run(
    `INSERT OR IGNORE INTO video_growth_snapshots
       (id, video_id, bucket, age_hours_at_snapshot, views, likes, comments,
        views_per_hour, subscriber_adjusted_velocity, views_to_subscriber_ratio,
        velocity_acceleration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, video_id, bucket, age_hours_at_snapshot,
      views ?? null, likes ?? null, comments ?? null,
      views_per_hour ?? null, subscriber_adjusted_velocity ?? null,
      views_to_subscriber_ratio ?? null, velocity_acceleration ?? null,
    ],
  );
}

function getPreviousBucketSnapshot(db, videoId, bucket) {
  const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];
  const idx = BUCKET_ORDER.indexOf(bucket);
  if (idx <= 0) return null;
  return db.get(
    'SELECT * FROM video_growth_snapshots WHERE video_id = ? AND bucket = ?',
    [videoId, BUCKET_ORDER[idx - 1]],
  );
}

function getSnapshotCountByBucket(db) {
  return db.all(
    `SELECT bucket, COUNT(*) AS n FROM video_growth_snapshots GROUP BY bucket ORDER BY bucket`,
  );
}

// Returns all ingested videos joined with their channel subscriber count,
// used by snapshot cron to determine newly eligible buckets and refresh stats.
function getAllIngestedVideosForSnapshot(db) {
  return db.all(`
    SELECT iv.youtube_video_id, iv.channel_id, iv.niche, iv.published_at,
           iv.duration_seconds, iv.views, iv.likes, iv.comments,
           ic.channel_subscribers
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.published_at >= datetime('now', '-60 days')
    ORDER BY iv.published_at DESC
  `);
}

function getNeverRefreshedVideosForSnapshot(db) {
  return db.all(`
    SELECT iv.youtube_video_id, iv.channel_id, iv.niche, iv.published_at,
           iv.duration_seconds, iv.views, iv.likes, iv.comments,
           ic.channel_subscribers
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.published_at IS NOT NULL
      AND iv.last_refreshed_at IS NULL
    ORDER BY iv.ingested_at DESC
  `);
}

// Returns buckets already filled for a video (to determine which are new).
function getExistingBucketsForVideo(db, videoId) {
  const rows = db.all(
    'SELECT bucket FROM video_growth_snapshots WHERE video_id = ?',
    [videoId],
  );
  return new Set(rows.map(r => r.bucket));
}

// ── Niche benchmarks ──────────────────────────────────────────────────────────

function upsertNicheBenchmark(db, {
  id, niche, bucket, duration_bucket, sample_size,
  median_views, p75_views, p90_views,
  median_vph, p75_vph, p90_vph,
  median_sav, median_vsr, median_accel,
}) {
  db.run(
    `INSERT INTO niche_benchmarks
       (id, niche, bucket, duration_bucket, sample_size,
        median_views, p75_views, p90_views,
        median_vph, p75_vph, p90_vph,
        median_sav, median_vsr, median_accel, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(niche, bucket, duration_bucket) DO UPDATE SET
       sample_size   = excluded.sample_size,
       median_views  = excluded.median_views,
       p75_views     = excluded.p75_views,
       p90_views     = excluded.p90_views,
       median_vph    = excluded.median_vph,
       p75_vph       = excluded.p75_vph,
       p90_vph       = excluded.p90_vph,
       median_sav    = excluded.median_sav,
       median_vsr    = excluded.median_vsr,
       median_accel  = excluded.median_accel,
       computed_at   = datetime('now')`,
    [
      id, niche, bucket, duration_bucket, sample_size,
      median_views ?? null, p75_views ?? null, p90_views ?? null,
      median_vph ?? null, p75_vph ?? null, p90_vph ?? null,
      median_sav ?? null, median_vsr ?? null, median_accel ?? null,
    ],
  );
}

function getAllNicheBenchmarks(db) {
  return db.all(
    `SELECT * FROM niche_benchmarks ORDER BY niche, bucket, duration_bucket`,
  );
}

function getNicheBenchmarksByNiche(db, niche) {
  return db.all(
    `SELECT * FROM niche_benchmarks WHERE niche = ? ORDER BY bucket, duration_bucket`,
    [niche],
  );
}

// Raw snapshot rows for a given niche + bucket — used by patternMiner.
function getSnapshotRowsForAggregation(db, niche, bucket) {
  return db.all(
    `SELECT vgs.views, vgs.views_per_hour, vgs.subscriber_adjusted_velocity,
            vgs.views_to_subscriber_ratio, vgs.velocity_acceleration,
            iv.duration_seconds
     FROM video_growth_snapshots vgs
     JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
     JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE iv.niche = ? AND vgs.bucket = ?
       AND vgs.views IS NOT NULL
       AND ic.ignore_from_benchmarks = 0
     ORDER BY vgs.views DESC`,
    [niche, bucket],
  );
}

// Distinct (niche, bucket) pairs that have enough rows to aggregate.
// Excludes channels flagged ignore_from_benchmarks=1.
function getAggregatableCombinations(db, minSample) {
  return db.all(
    `SELECT iv.niche, vgs.bucket, COUNT(*) AS n
     FROM video_growth_snapshots vgs
     JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
     JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE vgs.views IS NOT NULL
       AND ic.ignore_from_benchmarks = 0
     GROUP BY iv.niche, vgs.bucket
     HAVING COUNT(*) >= ?
     ORDER BY iv.niche, vgs.bucket`,
    [minSample ?? 5],
  );
}

function deleteIngestedChannel(db, id) {
  db.run('DELETE FROM ingested_channels WHERE id = ?', [id]);
}

function getChannelVideoTitles(db, channelId, limit) {
  const lim = limit ?? 50;
  const ingested = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT ?`,
    [channelId, lim],
  ).map(r => r.title);
  if (ingested.length > 0) return ingested;
  return db.all(
    `SELECT title FROM corpus_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT ?`,
    [channelId, lim],
  ).map(r => r.title);
}

function getChannelIdentity(db, id) {
  return db.get(
    `SELECT primary_niche, secondary_niche, behavior_tags, format_type, audience_style,
            identity_confidence, identity_reasoning, identity_last_detected_at,
            identity_strength, identity_source, inferred_topics, content_archetype,
            channel_id, channel_name, niche
     FROM ingested_channels WHERE id = ?`,
    [id],
  );
}

function saveChannelIdentity(db, channelId, {
  primary_niche, secondary_niche, behavior_tags, format_type, audience_style,
  identity_confidence, identity_reasoning, identity_last_detected_at,
  identity_strength, identity_source, inferred_topics, content_archetype,
}) {
  const toJson = v => Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
  db.run(
    `UPDATE ingested_channels SET
       primary_niche              = ?,
       secondary_niche            = ?,
       behavior_tags              = ?,
       format_type                = ?,
       audience_style             = ?,
       identity_confidence        = ?,
       identity_reasoning         = ?,
       identity_last_detected_at  = ?,
       identity_strength          = ?,
       identity_source            = ?,
       inferred_topics            = ?,
       content_archetype          = ?
     WHERE channel_id = ?`,
    [
      primary_niche ?? null,
      secondary_niche ?? null,
      toJson(behavior_tags),
      format_type ?? null,
      audience_style ?? null,
      identity_confidence ?? null,
      identity_reasoning ?? null,
      identity_last_detected_at ?? null,
      identity_strength ?? null,
      identity_source ?? null,
      toJson(inferred_topics),
      content_archetype ?? null,
      channelId,
    ],
  );

  // OpenAI classification is ground truth — overwrite the keyword-guessed niche
  if (Array.isArray(inferred_topics) && inferred_topics.length > 0 && inferred_topics[0]) {
    try {
      db.run(
        `UPDATE ingested_channels SET niche = ? WHERE channel_id = ? AND niche_override IS NULL`,
        [inferred_topics[0].toString().trim().toLowerCase(), channelId],
      );
    } catch (_) {}
  }

  // Sync channel_topics flat table
  if (Array.isArray(inferred_topics) && inferred_topics.length > 0) {
    try {
      db.run(`DELETE FROM channel_topics WHERE channel_id = ?`, [channelId]);
      for (const topic of inferred_topics) {
        const t = (topic ?? '').toString().trim().toLowerCase();
        if (!t) continue;
        db.run(
          `INSERT OR IGNORE INTO channel_topics (channel_id, topic, niche) VALUES (?, ?, ?)`,
          [channelId, t, primary_niche ?? null],
        );
      }
    } catch (_) {}
  }
}

// ── Niche benchmark history (append-only) ─────────────────────────────────────

function insertBenchmarkHistory(db, {
  id, snapshot_batch_id, snapshot_at, niche, bucket, duration_bucket,
  sample_size, median_vph, p75_vph, p90_vph, median_sav, median_vsr, median_accel,
}) {
  db.run(
    `INSERT INTO niche_benchmark_history
       (id, snapshot_batch_id, snapshot_at, niche, bucket, duration_bucket,
        sample_size, median_vph, p75_vph, p90_vph, median_sav, median_vsr, median_accel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, snapshot_batch_id, snapshot_at, niche, bucket, duration_bucket,
      sample_size ?? null, median_vph ?? null, p75_vph ?? null, p90_vph ?? null,
      median_sav ?? null, median_vsr ?? null, median_accel ?? null,
    ],
  );
}

function getLatestTwoSnapshotBatches(db) {
  return db.all(`
    SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at, COUNT(*) AS row_count
    FROM niche_benchmark_history
    GROUP BY snapshot_batch_id
    ORDER BY snapshot_at DESC
    LIMIT 2
  `);
}

function getBenchmarkHistoryByBatch(db, batchId) {
  return db.all(
    'SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ? ORDER BY niche, bucket, duration_bucket',
    [batchId],
  );
}

function getBenchmarkTimelineForCombination(db, { niche, bucket, duration_bucket } = {}) {
  const conditions = ['1=1'];
  const params     = [];
  if (niche)           { conditions.push('niche = ?');           params.push(niche); }
  if (bucket)          { conditions.push('bucket = ?');          params.push(bucket); }
  if (duration_bucket) { conditions.push('duration_bucket = ?'); params.push(duration_bucket); }
  return db.all(
    `SELECT * FROM niche_benchmark_history WHERE ${conditions.join(' AND ')} ORDER BY snapshot_at ASC`,
    params,
  );
}

function getLatestBenchmarkSnapshotId(db) {
  return db.get(`
    SELECT snapshot_batch_id FROM niche_benchmark_history
    GROUP BY snapshot_batch_id ORDER BY MIN(snapshot_at) DESC LIMIT 1
  `)?.snapshot_batch_id ?? null;
}

// ── Intelligence versions (permanent, never deleted) ──────────────────────────

function insertIntelligenceVersion(db, {
  id, created_at, trigger, scoring_version_id,
  prev_weights_json, new_weights_json, changed_weights_json,
  health_score, learning_velocity, benchmark_snapshot_id,
  notes, rollback_tag, rollback_source_version_id,
}) {
  return db.run(
    `INSERT INTO intelligence_versions
       (id, created_at, trigger, scoring_version_id,
        prev_weights_json, new_weights_json, changed_weights_json,
        health_score, learning_velocity, benchmark_snapshot_id,
        notes, rollback_tag, rollback_source_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      created_at ?? new Date().toISOString(),
      trigger,
      scoring_version_id ?? null,
      prev_weights_json   != null ? (typeof prev_weights_json    === 'string' ? prev_weights_json    : JSON.stringify(prev_weights_json))    : null,
      new_weights_json    != null ? (typeof new_weights_json     === 'string' ? new_weights_json     : JSON.stringify(new_weights_json))     : null,
      changed_weights_json != null ? (typeof changed_weights_json === 'string' ? changed_weights_json : JSON.stringify(changed_weights_json)) : null,
      health_score     ?? null,
      learning_velocity ?? null,
      benchmark_snapshot_id ?? null,
      notes            ?? null,
      rollback_tag     ?? null,
      rollback_source_version_id ?? null,
    ],
  );
}

function getAllIntelligenceVersions(db, limit) {
  return db.all(
    'SELECT * FROM intelligence_versions ORDER BY created_at DESC LIMIT ?',
    [limit ?? 100],
  );
}

// ── Evolution analytics queries ───────────────────────────────────────────────

function getEvolutionAccuracyTimeline(db) {
  return db.all(`
    SELECT
      strftime('%Y-W%W', last_refreshed_at) AS week,
      COUNT(*)                                                           AS total,
      SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)    AS accurate,
      SUM(CASE WHEN predicted_score >= 70 AND actual_performance_score < 50  THEN 1 ELSE 0 END) AS fp,
      SUM(CASE WHEN predicted_score < 40  AND actual_performance_score >= 70 THEN 1 ELSE 0 END) AS fn
    FROM video_outcomes
    WHERE actual_performance_score IS NOT NULL
      AND last_refreshed_at >= datetime('now', '-90 days')
    GROUP BY week
    ORDER BY week ASC
  `);
}

function getEvolutionFPFNStats(db, windowDays) {
  const days = windowDays ?? 30;
  return db.get(`
    SELECT
      COUNT(*)                                                                                 AS total,
      SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END)                          AS accurate,
      SUM(CASE WHEN predicted_score >= 70 AND actual_performance_score < 50  THEN 1 ELSE 0 END) AS fp_count,
      SUM(CASE WHEN predicted_score < 40  AND actual_performance_score >= 70 THEN 1 ELSE 0 END) AS fn_count,
      SUM(CASE WHEN predicted_score >= 70 THEN 1 ELSE 0 END)                                  AS strong_predictions,
      SUM(CASE WHEN predicted_score < 40  THEN 1 ELSE 0 END)                                  AS weak_predictions
    FROM video_outcomes
    WHERE actual_performance_score IS NOT NULL
      AND last_refreshed_at >= datetime('now', '-${days} days')
  `);
}

function getEvolutionScoreDistribution(db, beforeDate, afterDate) {
  function distQuery(dateCondition, params) {
    return db.get(
      `SELECT
         SUM(CASE WHEN predicted_score < 40  THEN 1 ELSE 0 END) AS weak,
         SUM(CASE WHEN predicted_score >= 40 AND predicted_score < 70 THEN 1 ELSE 0 END) AS average,
         SUM(CASE WHEN predicted_score >= 70 THEN 1 ELSE 0 END) AS strong,
         COUNT(*) AS total
       FROM video_outcomes
       WHERE predicted_score IS NOT NULL ${dateCondition}`,
      params,
    );
  }
  const before = beforeDate ? distQuery('AND created_at < ?', [beforeDate]) : null;
  const after  = afterDate  ? distQuery('AND created_at >= ?', [afterDate]) : null;
  const weekly = db.all(`
    SELECT
      strftime('%Y-W%W', created_at) AS week,
      SUM(CASE WHEN predicted_score < 40  THEN 1 ELSE 0 END) AS weak,
      SUM(CASE WHEN predicted_score >= 40 AND predicted_score < 70 THEN 1 ELSE 0 END) AS average,
      SUM(CASE WHEN predicted_score >= 70 THEN 1 ELSE 0 END) AS strong
    FROM video_outcomes
    WHERE predicted_score IS NOT NULL
      AND created_at >= datetime('now', '-90 days')
    GROUP BY week ORDER BY week ASC
  `);
  return { before, after, weekly };
}

function getEvolutionSignalWeightHistory(db) {
  return db.all(
    `SELECT id, version_name, version_type, weights_json, thresholds_json,
            active, created_at, created_by, notes
     FROM scoring_versions ORDER BY created_at ASC`,
  );
}

function getEvolutionConfidenceBins(db) {
  return db.all(`
    SELECT
      COALESCE(LOWER(TRIM(confidence_state)), 'unknown') AS confidence_bucket,
      COUNT(*)                                            AS total,
      SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END) AS accurate,
      AVG(ABS(calibration_error))                         AS mae,
      SUM(CASE WHEN predicted_score >= 70 AND actual_performance_score < 50  THEN 1 ELSE 0 END) AS fp_count,
      SUM(CASE WHEN predicted_score < 40  AND actual_performance_score >= 70 THEN 1 ELSE 0 END) AS fn_count
    FROM video_outcomes
    WHERE actual_performance_score IS NOT NULL
    GROUP BY confidence_bucket
    ORDER BY confidence_bucket
  `);
}

function updateChannelNiche(db, id, niche) {
  db.run('UPDATE ingested_channels SET niche = ? WHERE id = ?', [niche, id]);
  db.run('UPDATE ingested_videos SET niche = ? WHERE channel_id = (SELECT channel_id FROM ingested_channels WHERE id = ?)', [niche, id]);
}

function setNicheOverride(db, id, niche) {
  db.run('UPDATE ingested_channels SET niche = ?, niche_override = ?, identity_source = ? WHERE id = ?',
    [niche, niche, 'operator_override', id]);
  db.run('UPDATE ingested_videos SET niche = ? WHERE channel_id = (SELECT channel_id FROM ingested_channels WHERE id = ?)',
    [niche, id]);
}

// ── Duration bucket helpers (canonical — matches patternMiner.js) ─────────────

function classifyDurationBucket(seconds) {
  if (seconds == null || seconds <= 0) return 'unknown';
  if (seconds < 180) return 'short';
  if (seconds < 600) return 'medium';
  return 'long';
}

function getBenchmarkRow(db, niche, bucket, durationBucket) {
  return db.get(
    'SELECT * FROM niche_benchmarks WHERE niche = ? AND bucket = ? AND duration_bucket = ?',
    [niche, bucket, durationBucket ?? 'unknown'],
  );
}

// ── Synthetic calibration ─────────────────────────────────────────────────────

function insertSyntheticOutcome(db, {
  youtube_video_id, niche, title, predicted_score,
  actual_performance_score, calibration_error, calibration_band,
  actual_views_7d, velocity_7d, outcome_state,
}) {
  const now = new Date().toISOString();
  return db.run(
    `INSERT INTO video_outcomes
       (youtube_video_id, pipeline_version, calibration_weight,
        niche, title, predicted_score,
        actual_views_7d, velocity_7d,
        actual_performance_score, calibration_error, calibration_band,
        outcome_state, last_refreshed_at, created_at, observed_at)
     VALUES (?, 'synthetic_b', 0.5, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      youtube_video_id, niche ?? null, title ?? null, predicted_score ?? null,
      actual_views_7d ?? null, velocity_7d ?? null,
      actual_performance_score ?? null, calibration_error ?? null, calibration_band ?? null,
      outcome_state ?? 'on_track', now, now, now,
    ],
  );
}

// ── Dashboard aggregate queries ───────────────────────────────────────────────

function getCalibrationOverview(db) {
  return db.all(
    `SELECT
       COALESCE(pipeline_version, 'unknown')         AS pipeline_version,
       COUNT(*)                                       AS total,
       AVG(ABS(calibration_error))                   AS mae,
       SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END) AS accurate_count
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY pipeline_version`,
  );
}

function getOutcomeFreshnessHistogram(db) {
  return db.get(
    `SELECT
       SUM(CASE WHEN last_refreshed_at >= datetime('now', '-1 days')  THEN 1 ELSE 0 END) AS fresh_1d,
       SUM(CASE WHEN last_refreshed_at >= datetime('now', '-7 days')
                AND last_refreshed_at < datetime('now', '-1 days')    THEN 1 ELSE 0 END) AS fresh_7d,
       SUM(CASE WHEN last_refreshed_at >= datetime('now', '-30 days')
                AND last_refreshed_at < datetime('now', '-7 days')    THEN 1 ELSE 0 END) AS fresh_30d,
       SUM(CASE WHEN last_refreshed_at < datetime('now', '-30 days')
                OR  last_refreshed_at IS NULL                         THEN 1 ELSE 0 END) AS stale,
       COUNT(*) AS total
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL`,
  );
}

function getNicheCalibrationDensity(db) {
  return db.all(
    `SELECT
       COALESCE(LOWER(TRIM(niche)), 'unknown')        AS niche,
       COUNT(*)                                       AS sample_count,
       COALESCE(pipeline_version, 'unknown')          AS pipeline_version
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY niche, pipeline_version
     ORDER BY sample_count DESC`,
  );
}

// ── Learning Intelligence Dashboard queries ───────────────────────────────────

function insertLearningSnapshot(db, {
  snapshot_date, mae, calibration_trust_score, synthetic_ratio,
  stale_outcomes, benchmark_health, learning_velocity,
  total_calibration_rows, real_rows, synthetic_rows,
  avg_confidence_score, benchmark_drift, weight_delta,
}) {
  return db.run(
    `INSERT OR REPLACE INTO learning_health_snapshots
       (snapshot_date, mae, calibration_trust_score, synthetic_ratio,
        stale_outcomes, benchmark_health, learning_velocity,
        total_calibration_rows, real_rows, synthetic_rows,
        avg_confidence_score, benchmark_drift, weight_delta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [snapshot_date, mae, calibration_trust_score, synthetic_ratio,
     stale_outcomes, benchmark_health, learning_velocity,
     total_calibration_rows, real_rows, synthetic_rows,
     avg_confidence_score, benchmark_drift, weight_delta],
  );
}

function getLearningHistory(db, days = 30) {
  return db.all(
    `SELECT * FROM learning_health_snapshots
     WHERE snapshot_date >= date('now', ?)
     ORDER BY snapshot_date ASC`,
    [`-${days} days`],
  );
}

function getNicheLearningStats(db) {
  return db.all(
    `SELECT
       COALESCE(niche, 'unknown') AS niche,
       COUNT(*) AS sample_count,
       ROUND(AVG(calibration_error), 2) AS avg_error,
       ROUND(AVG(actual_performance_score), 2) AS avg_actual,
       ROUND(AVG(ABS(calibration_error)), 2) AS mae,
       SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic_count,
       SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_count,
       MAX(last_refreshed_at) AS last_refreshed
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY niche
     ORDER BY sample_count DESC`,
  );
}

function getCalibrationDistributions(db) {
  const actual = db.all(
    `SELECT CAST(ROUND(actual_performance_score / 10) * 10 AS INTEGER) AS bucket, COUNT(*) AS n
     FROM video_outcomes WHERE actual_performance_score IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
  );
  const error = db.all(
    `SELECT CAST(ROUND(calibration_error / 10) * 10 AS INTEGER) AS bucket, COUNT(*) AS n
     FROM video_outcomes WHERE calibration_error IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
  );
  const bands = db.all(
    `SELECT calibration_band,
       COUNT(*) AS total,
       SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic,
       SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real
     FROM video_outcomes WHERE calibration_band IS NOT NULL
     GROUP BY calibration_band ORDER BY total DESC`,
  );
  return { actual, error, bands };
}

function getLearningEvents(db, limit = 60) {
  const calibEvents = db.all(
    `SELECT id, created_at, trigger, health_score, learning_velocity,
       changed_weights_json, notes
     FROM intelligence_versions
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  const syntheticRuns = db.all(
    `SELECT DATE(created_at) AS run_date, COUNT(*) AS rows_inserted,
       AVG(ABS(calibration_error)) AS mae
     FROM video_outcomes WHERE pipeline_version = 'synthetic_b'
     GROUP BY DATE(created_at) ORDER BY run_date DESC LIMIT 10`,
  );
  return { calibration_events: calibEvents, synthetic_runs: syntheticRuns };
}

function getLatestLearningSnapshot(db) {
  return db.get(`SELECT * FROM learning_health_snapshots ORDER BY snapshot_date DESC LIMIT 1`);
}

// ── Confidence metrics ────────────────────────────────────────────────────────

function insertConfidenceMetric(db, {
  feature, niche, confidence_score, sample_depth_score, recency_score,
  coverage_score, real_ratio_score, stability_score, routing_decision, reasons_json,
}) {
  return db.run(
    `INSERT INTO confidence_metrics
       (feature, niche, confidence_score, sample_depth_score, recency_score,
        coverage_score, real_ratio_score, stability_score, routing_decision, reasons_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      feature, niche ?? null, confidence_score, sample_depth_score, recency_score,
      coverage_score, real_ratio_score, stability_score, routing_decision,
      typeof reasons_json === 'string' ? reasons_json : JSON.stringify(reasons_json ?? []),
    ],
  );
}

function insertConfidenceHistorySnapshot(db, {
  snapshot_date, feature, niche, avg_confidence, routing_distribution_json, fallback_rate,
}) {
  return db.run(
    `INSERT OR REPLACE INTO learning_confidence_history
       (snapshot_date, feature, niche, avg_confidence, routing_distribution_json, fallback_rate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      snapshot_date, feature,
      niche ?? '__all__',
      avg_confidence,
      typeof routing_distribution_json === 'string' ? routing_distribution_json : JSON.stringify(routing_distribution_json ?? {}),
      fallback_rate,
    ],
  );
}

function getConfidenceHistory(db, days = 30) {
  return db.all(
    `SELECT * FROM learning_confidence_history
     WHERE snapshot_date >= date('now', ?)
     ORDER BY snapshot_date ASC, feature ASC`,
    [`-${days} days`],
  );
}

function getLatestConfidenceMetrics(db, feature) {
  return feature
    ? db.all(
        'SELECT * FROM confidence_metrics WHERE feature = ? ORDER BY created_at DESC LIMIT 25',
        [feature])
    : db.all(
        'SELECT * FROM confidence_metrics ORDER BY created_at DESC LIMIT 100');
}

// ── Confidence correctness ────────────────────────────────────────────────────

function updateConfidenceHistoryCorrectness(db, {
  snapshot_date,
  confidence_accuracy_correlation,
  high_confidence_mae,
  medium_confidence_mae,
  low_confidence_mae,
  routing_accuracy_score,
}) {
  return db.run(
    `UPDATE learning_confidence_history
     SET confidence_accuracy_correlation = ?,
         high_confidence_mae             = ?,
         medium_confidence_mae           = ?,
         low_confidence_mae              = ?,
         routing_accuracy_score          = ?
     WHERE snapshot_date = ? AND feature = '__all__' AND niche = '__all__'`,
    [
      confidence_accuracy_correlation ?? null,
      high_confidence_mae             ?? null,
      medium_confidence_mae           ?? null,
      low_confidence_mae              ?? null,
      routing_accuracy_score          ?? null,
      snapshot_date,
    ],
  );
}

// ── Routing log ───────────────────────────────────────────────────────────────

function insertRoutingLog(db, {
  feature, niche, route_type, confidence_score, correctness_score,
  fallback_reason, tokens_saved_estimate, latency_ms, cache_hit, routing_version, payload_hash,
}) {
  return db.run(
    `INSERT INTO routing_log
       (feature, niche, route_type, confidence_score, correctness_score,
        fallback_reason, tokens_saved_estimate, latency_ms, cache_hit, routing_version, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      feature, niche ?? null, route_type,
      confidence_score  ?? null, correctness_score ?? null,
      fallback_reason   ?? null,
      tokens_saved_estimate ?? 0, latency_ms ?? null,
      cache_hit ? 1 : 0, routing_version ?? 'v1', payload_hash ?? null,
    ],
  );
}

function getRoutingAnalytics(db, days = 7) {
  const cutoff = `-${days} days`;
  const dist = db.all(
    `SELECT route_type, COUNT(*) AS n,
            AVG(confidence_score) AS avg_confidence,
            SUM(tokens_saved_estimate) AS total_tokens_saved,
            AVG(latency_ms) AS avg_latency_ms
     FROM routing_log
     WHERE created_at >= datetime('now', ?)
     GROUP BY route_type`,
    [cutoff],
  );
  const timeline = db.all(
    `SELECT date(created_at) AS day,
            route_type, COUNT(*) AS n,
            SUM(tokens_saved_estimate) AS tokens_saved
     FROM routing_log
     WHERE created_at >= datetime('now', ?)
     GROUP BY day, route_type
     ORDER BY day ASC`,
    [cutoff],
  );
  const fallbacks = db.all(
    `SELECT fallback_reason, COUNT(*) AS n
     FROM routing_log
     WHERE fallback_reason IS NOT NULL AND created_at >= datetime('now', ?)
     GROUP BY fallback_reason
     ORDER BY n DESC
     LIMIT 10`,
    [cutoff],
  );
  const total = dist.reduce((s, r) => s + (r.n ?? 0), 0);
  const totalSaved = dist.reduce((s, r) => s + (r.total_tokens_saved ?? 0), 0);
  return { days, dist, timeline, fallbacks, total, total_tokens_saved: totalSaved };
}

// ── Hook intelligence queries (Phase D) ──────────────────────────────────────

function getTopHooks(db, { niche, duration_bucket, limit = 20 } = {}) {
  const where = [];
  const args  = [];
  if (niche)           { where.push('niche = ?');           args.push(niche); }
  if (duration_bucket) { where.push('duration_bucket = ?'); args.push(duration_bucket); }
  where.push('sample_count >= 5');
  const sql = `
    SELECT * FROM hook_type_performance
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY hook_score DESC
    LIMIT ?`;
  args.push(limit);
  return db.all(sql, args).map(r => ({ ...r, example_titles: tryParseJson(r.example_titles_json, []) }));
}

function getRisingHooks(db, { niche, limit = 20 } = {}) {
  const where = ["trend_direction = 'rising'", 'sample_count >= 5'];
  const args  = [];
  if (niche) { where.push('niche = ?'); args.push(niche); }
  args.push(limit);
  return db.all(
    `SELECT * FROM hook_type_performance WHERE ${where.join(' AND ')} ORDER BY momentum_score DESC, hook_score DESC LIMIT ?`,
    args,
  ).map(r => ({ ...r, example_titles: tryParseJson(r.example_titles_json, []) }));
}

function getDecliningHooks(db, { niche, limit = 20 } = {}) {
  const where = ["trend_direction = 'declining'", 'sample_count >= 5'];
  const args  = [];
  if (niche) { where.push('niche = ?'); args.push(niche); }
  args.push(limit);
  return db.all(
    `SELECT * FROM hook_type_performance WHERE ${where.join(' AND ')} ORDER BY momentum_score ASC, hook_score ASC LIMIT ?`,
    args,
  ).map(r => ({ ...r, example_titles: tryParseJson(r.example_titles_json, []) }));
}

function getHooksByNiche(db, niche) {
  return db.all(
    `SELECT * FROM hook_type_performance WHERE niche = ? AND sample_count >= 3 ORDER BY hook_score DESC`,
    [niche],
  ).map(r => ({ ...r, example_titles: tryParseJson(r.example_titles_json, []) }));
}

function getHookSummaryStats(db) {
  const total = db.get('SELECT COUNT(*) n FROM hook_type_performance')?.n ?? 0;
  const niches = db.get('SELECT COUNT(DISTINCT niche) n FROM hook_type_performance')?.n ?? 0;
  const hooks  = db.get('SELECT COUNT(DISTINCT hook_type) n FROM hook_type_performance')?.n ?? 0;
  const updated = db.get('SELECT MAX(updated_at) t FROM hook_type_performance')?.t ?? null;
  const rising  = db.get("SELECT COUNT(*) n FROM hook_type_performance WHERE trend_direction='rising'")?.n ?? 0;
  const declining = db.get("SELECT COUNT(*) n FROM hook_type_performance WHERE trend_direction='declining'")?.n ?? 0;
  return { total_rows: total, niches_covered: niches, hook_types_covered: hooks, last_updated: updated, rising, declining };
}

function tryParseJson(json, fallback) {
  try { return JSON.parse(json || 'null') ?? fallback; } catch { return fallback; }
}

// ── Phase E: Niche Reliability ────────────────────────────────────────────────

function upsertNicheReliability(db, {
  niche, reliability_score, real_outcome_count, avg_mae,
  mae_7d, mae_30d, mae_90d, trust_weight, synthetic_ratio, disagreement_rate,
}) {
  return db.run(
    `INSERT INTO niche_reliability
       (niche, reliability_score, real_outcome_count, avg_mae, mae_7d, mae_30d, mae_90d,
        trust_weight, synthetic_ratio, disagreement_rate, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(niche) DO UPDATE SET
       reliability_score  = excluded.reliability_score,
       real_outcome_count = excluded.real_outcome_count,
       avg_mae            = excluded.avg_mae,
       mae_7d             = excluded.mae_7d,
       mae_30d            = excluded.mae_30d,
       mae_90d            = excluded.mae_90d,
       trust_weight       = excluded.trust_weight,
       synthetic_ratio    = excluded.synthetic_ratio,
       disagreement_rate  = excluded.disagreement_rate,
       computed_at        = datetime('now')`,
    [
      niche, reliability_score ?? 0, real_outcome_count ?? 0,
      avg_mae ?? null, mae_7d ?? null, mae_30d ?? null, mae_90d ?? null,
      trust_weight ?? 1.0, synthetic_ratio ?? null, disagreement_rate ?? null,
    ],
  );
}

function getAllNicheReliability(db) {
  return db.all('SELECT * FROM niche_reliability ORDER BY reliability_score DESC');
}

// ── Phase E: Learning Cohort Snapshots ────────────────────────────────────────

function upsertCohortSnapshot(db, {
  cohort_window, snapshot_date, niche,
  total_outcomes, real_outcomes, mae, accuracy_rate,
  avg_confidence, avg_freshness_weight, disagreement_rate, synthetic_ratio,
}) {
  return db.run(
    `INSERT INTO learning_cohort_snapshots
       (cohort_window, snapshot_date, niche, total_outcomes, real_outcomes,
        mae, accuracy_rate, avg_confidence, avg_freshness_weight, disagreement_rate, synthetic_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cohort_window, snapshot_date, niche) DO UPDATE SET
       total_outcomes       = excluded.total_outcomes,
       real_outcomes        = excluded.real_outcomes,
       mae                  = excluded.mae,
       accuracy_rate        = excluded.accuracy_rate,
       avg_confidence       = excluded.avg_confidence,
       avg_freshness_weight = excluded.avg_freshness_weight,
       disagreement_rate    = excluded.disagreement_rate,
       synthetic_ratio      = excluded.synthetic_ratio`,
    [
      cohort_window, snapshot_date, niche ?? '__all__',
      total_outcomes ?? 0, real_outcomes ?? 0,
      mae ?? null, accuracy_rate ?? null, avg_confidence ?? null,
      avg_freshness_weight ?? null, disagreement_rate ?? null, synthetic_ratio ?? null,
    ],
  );
}

function getCohortSnapshots(db, { window, niche, days = 90 } = {}) {
  const conditions = [`snapshot_date >= date('now', ?)`];
  const params = [`-${days} days`];
  if (window) { conditions.push('cohort_window = ?'); params.push(window); }
  if (niche)  { conditions.push('niche = ?');         params.push(niche); }
  return db.all(
    `SELECT * FROM learning_cohort_snapshots WHERE ${conditions.join(' AND ')} ORDER BY snapshot_date ASC, cohort_window ASC`,
    params,
  );
}

// Disagreement stats — aggregate from prediction_feedback
function getDisagreementStats(db, days = 90) {
  return db.all(
    `SELECT
       LOWER(TRIM(COALESCE(vo.niche, 'unknown'))) AS niche,
       COUNT(pf.id) AS total_feedback,
       SUM(CASE WHEN pf.score_override IS NOT NULL THEN 1 ELSE 0 END) AS overrides,
       AVG(CASE WHEN pf.score_override IS NOT NULL THEN pf.disagreement_magnitude ELSE NULL END) AS avg_disagreement,
       MAX(CASE WHEN pf.score_override IS NOT NULL THEN pf.disagreement_magnitude ELSE NULL END) AS max_disagreement
     FROM prediction_feedback pf
     LEFT JOIN video_outcomes vo ON vo.prediction_id = pf.prediction_id
     WHERE pf.created_at >= datetime('now', ?)
     GROUP BY niche
     ORDER BY overrides DESC`,
    [`-${days} days`],
  );
}

// Freshness weight distribution — bucket by weight tier
function getFreshnessDecayAnalysis(db) {
  const buckets = db.all(
    `SELECT
       CASE
         WHEN freshness_weight >= 0.9 THEN 'fresh (>=0.9)'
         WHEN freshness_weight >= 0.7 THEN 'recent (0.7-0.9)'
         WHEN freshness_weight >= 0.4 THEN 'aging (0.4-0.7)'
         WHEN freshness_weight >= 0.1 THEN 'stale (0.1-0.4)'
         ELSE 'expired (<0.1)'
       END AS bucket,
       COUNT(*) AS count,
       AVG(ABS(calibration_error)) AS avg_mae
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY bucket
     ORDER BY MIN(freshness_weight) DESC`,
  );

  const timeline = db.all(
    `SELECT
       strftime('%Y-W%W', COALESCE(last_refreshed_at, created_at)) AS week,
       AVG(freshness_weight) AS avg_freshness,
       COUNT(*) AS n
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND COALESCE(last_refreshed_at, created_at) >= datetime('now', '-90 days')
     GROUP BY week
     ORDER BY week ASC`,
  );

  return { buckets, timeline };
}

function updateChannelQuality(db, id, { trust_score, weight_multiplier, ignore_from_benchmarks }) {
  const fields = [];
  const vals   = [];
  if (trust_score            != null) { fields.push('trust_score = ?');            vals.push(trust_score); }
  if (weight_multiplier      != null) { fields.push('weight_multiplier = ?');      vals.push(weight_multiplier); }
  if (ignore_from_benchmarks != null) { fields.push('ignore_from_benchmarks = ?'); vals.push(ignore_from_benchmarks ? 1 : 0); }
  if (!fields.length) return;
  vals.push(id);
  db.run(`UPDATE ingested_channels SET ${fields.join(', ')} WHERE id = ?`, vals);
}

// ── Topic fingerprint queries ─────────────────────────────────────────────────

// Returns channels ranked by topic overlap with the given channel.
// Each row: { channel_id, title, niche, secondary_niche, content_archetype, topic_overlap }
// topic_overlap = count of shared inferred_topics (higher = more similar)
function getChannelsByTopicOverlap(db, channelId, { limit = 200, minOverlap = 1 } = {}) {
  return db.all(
    `SELECT ct2.channel_id,
            ic.channel_name  AS title,
            ic.niche,
            ic.primary_niche,
            ic.secondary_niche,
            ic.content_archetype,
            COUNT(ct2.topic) AS topic_overlap
     FROM channel_topics ct1
     JOIN channel_topics ct2 ON ct2.topic = ct1.topic AND ct2.channel_id != ct1.channel_id
     JOIN ingested_channels ic ON ic.channel_id = ct2.channel_id
     WHERE ct1.channel_id = ?
     GROUP BY ct2.channel_id
     HAVING topic_overlap >= ?
     ORDER BY topic_overlap DESC
     LIMIT ?`,
    [channelId, minOverlap, limit],
  );
}

// Returns the inferred topics for a channel as a plain array.
function getChannelTopics(db, channelId) {
  return db.all(
    `SELECT topic FROM channel_topics WHERE channel_id = ? ORDER BY topic`,
    [channelId],
  ).map(r => r.topic);
}

// Topic velocity: for each topic, how many channels adopted it this week vs last week.
// Returns topics sorted by growth rate descending.
function getTopicVelocity(db, { niche = null, limit = 50 } = {}) {
  const nicheFilter = niche ? `AND niche = '${niche.replace(/'/g, "''")}'` : '';
  return db.all(
    `SELECT
       topic,
       niche,
       COUNT(*) AS total_channels,
       SUM(CASE WHEN first_seen >= datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS added_this_week,
       SUM(CASE WHEN first_seen >= datetime('now', '-14 days')
                 AND first_seen <  datetime('now', '-7 days')  THEN 1 ELSE 0 END) AS added_last_week,
       SUM(CASE WHEN first_seen >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS added_this_month
     FROM channel_topics
     WHERE 1=1 ${nicheFilter}
     GROUP BY topic
     HAVING total_channels >= 2
     ORDER BY added_this_week DESC, total_channels DESC
     LIMIT ?`,
    [limit],
  );
}

module.exports = {
  insertVideo,
  getVideoById,
  getVideoByYouTubeId,
  updateVideoMeta,
  upsertFeatures,
  upsertPerformanceMetrics,
  insertPerformanceMetricsPlaceholder,
  insertPrediction,
  upsertPrediction,
  getDbStats,
  getVideoResults,
  getMetricsCoverage,
  getModelStatusCounts,
  getDebugCounts,
  updateFeedback,
  getAllWorkspaces,
  getWorkspaceById,
  insertWorkspace,
  updateWorkspace,
  deleteWorkspace,
  insertPredictionFeedbackSnapshot,
  getSnapshotByPredictionId,
  updatePredictionFeedbackLabel,
  updatePredictionFeedbackOutcomes,
  getFeedbackStats,
  insertVideoOutcome,
  getVideoOutcomeByPredictionId,
  getMostRecentOutcomeByYouTubeId,
  updateVideoOutcomeRefresh,
  getOutcomeStats,
  getOutcomeRowsForDrift,
  getOutcomeRefreshQueueSize,
  getOutcomeStaleCount,
  getCalibrationTimeline,
  getConfidenceReliability,
  getNicheDriftMetrics,
  getPredictionAccuracySummary,
  getCalibrationDistribution,
  getRecentPredictionErrors,
  getTopDriftingNiches,
  getPredictionTrendBuckets,
  getLearningOutcomeRows,
  getDegradedModeRows,
  getHookTypeOutcomeRows,
  getActiveScoringVersionByType,
  activateScoringVersion,
  insertScoringWeightAudit,
  getScoringWeightAuditLog,
  getMostRecentAuditForType,
  insertScoringVersion,
  getActiveScoringVersion,
  getScoringVersionById,
  getScoringVersions,
  insertExperiment,
  getExperiment,
  getExperiments,
  updateExperimentRun,
  insertRecommendationAction,
  getRecommendationActions,
  updateRecommendationActionExperiment,
  getSimulationRowsEnsemble,
  getSimulationRowsNicheBias,
  getVideoOutcomeRealityByYouTubeId,
  upsertVideoOutcomeReality,
  getRealityRowsForLearning,
  getChannelViewHistory,
  getIngestableChannels,
  getAllIngestedChannels,
  upsertIngestedChannel,
  updateChannelIngestMetadata,
  markChannelIngested,
  setChannelEnabled,
  setOwnChannel,
  upsertIngestedVideo,
  getIngestedVideosByNiche,
  getIngestedVideoCount,
  insertGrowthSnapshot,
  getPreviousBucketSnapshot,
  getSnapshotCountByBucket,
  getAllIngestedVideosForSnapshot,
  getNeverRefreshedVideosForSnapshot,
  getExistingBucketsForVideo,
  upsertNicheBenchmark,
  getAllNicheBenchmarks,
  getNicheBenchmarksByNiche,
  getSnapshotRowsForAggregation,
  getAggregatableCombinations,
  deleteIngestedChannel,
  getChannelVideoTitles,
  getChannelIdentity,
  saveChannelIdentity,
  getChannelsByTopicOverlap,
  getChannelTopics,
  getTopicVelocity,
  updateChannelNiche,
  setNicheOverride,
  updateChannelQuality,
  insertBenchmarkHistory,
  getLatestTwoSnapshotBatches,
  getBenchmarkHistoryByBatch,
  getBenchmarkTimelineForCombination,
  getLatestBenchmarkSnapshotId,
  insertIntelligenceVersion,
  getAllIntelligenceVersions,
  getEvolutionAccuracyTimeline,
  getEvolutionFPFNStats,
  getEvolutionScoreDistribution,
  getEvolutionSignalWeightHistory,
  getEvolutionConfidenceBins,
  classifyDurationBucket,
  getBenchmarkRow,
  insertSyntheticOutcome,
  getCalibrationOverview,
  getOutcomeFreshnessHistogram,
  getNicheCalibrationDensity,
  insertLearningSnapshot,
  getLearningHistory,
  getNicheLearningStats,
  getCalibrationDistributions,
  getLearningEvents,
  getLatestLearningSnapshot,
  insertConfidenceMetric,
  insertConfidenceHistorySnapshot,
  getConfidenceHistory,
  getLatestConfidenceMetrics,
  updateConfidenceHistoryCorrectness,
  insertRoutingLog,
  getRoutingAnalytics,
  insertDiscoveredChannel,
  getDiscoveredChannels,
  getDiscoveredChannelById,
  updateDiscoveredChannelStatus,
  bulkUpdateDiscoveredStatus,
  updateDiscoveredChannelIdentity,
  getDiscoveryStats,
  isChannelKnown,
  getTopHooks,
  getRisingHooks,
  getDecliningHooks,
  getHooksByNiche,
  getHookSummaryStats,
  upsertNicheReliability,
  getAllNicheReliability,
  upsertCohortSnapshot,
  getCohortSnapshots,
  getDisagreementStats,
  getFreshnessDecayAnalysis,
  // Phase G — Semantic Intelligence
  getSemanticCoverage,
  getAllSemanticClusters,
  getSemanticCluster,
  upsertSemanticCluster,
  cacheSemanticQuery,
  getSemanticQueryCache,
  getSemanticCacheStats,
  // Phase H — Strategy Recommendations
  upsertStrategyRecommendation,
  getStrategyRecommendations,
  getStrategyRecommendationById,
  saveRecommendationFeedback,
  getRecommendationFeedbackStats,
  getStrategyAnalytics,
  // Local-first channel/video cache
  getChannelCache,
  getChannelCacheByHandle,
  upsertChannelCache,
  getVideoCache,
  getVideoCacheById,
  getVideoCacheIds,
  upsertVideoCache,
  updateVideoCacheStats,
};

// ── Discovery ─────────────────────────────────────────────────────────────────

function insertDiscoveredChannel(db, row) {
  const toJson = v => Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
  db.run(
    `INSERT OR IGNORE INTO discovered_channels
       (id, channel_id, title, handle, thumbnail_url, subscriber_count, video_count,
        discovery_source, discovered_from_channel_id, discovery_run_id, discovery_depth,
        discovery_confidence, duplicate_risk, diversity_score, titles_sample,
        primary_niche, secondary_niche, inferred_topics, behavior_tags,
        content_archetype, audience_style, format_type,
        identity_strength, identity_confidence, identity_reasoning)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id, row.channel_id, row.title ?? null, row.handle ?? null,
      row.thumbnail_url ?? null, row.subscriber_count ?? null, row.video_count ?? null,
      row.discovery_source ?? null, row.discovered_from_channel_id ?? null,
      row.discovery_run_id ?? null, row.discovery_depth ?? 1,
      row.discovery_confidence ?? 0, row.duplicate_risk ?? 'none',
      row.diversity_score ?? 0, toJson(row.titles_sample),
      row.primary_niche ?? null, row.secondary_niche ?? null,
      toJson(row.inferred_topics), toJson(row.behavior_tags),
      row.content_archetype ?? null, row.audience_style ?? null, row.format_type ?? null,
      row.identity_strength ?? null, row.identity_confidence ?? null,
      row.identity_reasoning ?? null,
    ],
  );
}

function getDiscoveredChannels(db, { status, run_id, limit = 200, offset = 0 } = {}) {
  const conditions = [];
  const params     = [];
  if (status)  { conditions.push('approval_status = ?'); params.push(status); }
  if (run_id)  { conditions.push('discovery_run_id = ?'); params.push(run_id); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  return db.all(
    `SELECT * FROM discovered_channels ${where} ORDER BY discovered_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

function getDiscoveredChannelById(db, id) {
  return db.get('SELECT * FROM discovered_channels WHERE id = ?', [id]);
}

function updateDiscoveredChannelStatus(db, id, status) {
  db.run(
    `UPDATE discovered_channels SET approval_status = ?, reviewed_at = datetime('now') WHERE id = ?`,
    [status, id],
  );
}

function bulkUpdateDiscoveredStatus(db, ids, status) {
  const placeholders = ids.map(() => '?').join(',');
  db.run(
    `UPDATE discovered_channels SET approval_status = ?, reviewed_at = datetime('now')
     WHERE id IN (${placeholders})`,
    [status, ...ids],
  );
}

function updateDiscoveredChannelIdentity(db, id, identity) {
  const toJson = v => Array.isArray(v) ? JSON.stringify(v) : (v ?? null);
  db.run(
    `UPDATE discovered_channels SET
       primary_niche = ?, secondary_niche = ?, inferred_topics = ?, behavior_tags = ?,
       content_archetype = ?, audience_style = ?, format_type = ?,
       identity_strength = ?, identity_confidence = ?, identity_reasoning = ?
     WHERE id = ?`,
    [
      identity.primary_niche ?? null, identity.secondary_niche ?? null,
      toJson(identity.inferred_topics), toJson(identity.behavior_tags),
      identity.content_archetype ?? null, identity.audience_style ?? null,
      identity.format_type ?? null, identity.identity_strength ?? null,
      identity.identity_confidence ?? null, identity.identity_reasoning ?? null,
      id,
    ],
  );
}

function getDiscoveryStats(db) {
  const row = db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN approval_status = 'pending'  THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN approval_status = 'ignored'  THEN 1 ELSE 0 END) AS ignored,
      SUM(CASE WHEN duplicate_risk IN ('high','medium') THEN 1 ELSE 0 END) AS duplicates
    FROM discovered_channels
  `);
  return row ?? { total: 0, pending: 0, approved: 0, rejected: 0, ignored: 0, duplicates: 0 };
}

function isChannelKnown(db, channelId) {
  const inIngested   = db.get('SELECT 1 FROM ingested_channels   WHERE channel_id = ?', [channelId]);
  const inDiscovered = db.get('SELECT 1 FROM discovered_channels WHERE channel_id = ?', [channelId]);
  return { ingested: !!inIngested, discovered: !!inDiscovered };
}

// ── Semantic Intelligence (Phase G) ──────────────────────────────────────────

function getSemanticCoverage(db) {
  try {
    const byType   = db.all(`
      SELECT source_type, embedding_model, COUNT(*) AS count, MAX(updated_at) AS last_updated
      FROM semantic_embeddings
      GROUP BY source_type, embedding_model
    `);
    const total    = db.get(`SELECT COUNT(*) AS n FROM semantic_embeddings`)?.n ?? 0;
    const clusters = db.get(`SELECT COUNT(*) AS n FROM semantic_clusters`)?.n ?? 0;
    const cacheHits = db.get(`SELECT COALESCE(SUM(cache_hit_count), 0) AS n FROM semantic_query_cache`)?.n ?? 0;
    const totalTitles = db.get(`SELECT COUNT(*) AS n FROM ingested_videos WHERE title IS NOT NULL`)?.n ?? 0;
    return { by_type: byType, total, clusters, cache_hits: cacheHits, total_titles: totalTitles };
  } catch (e) {
    return { by_type: [], total: 0, clusters: 0, cache_hits: 0, total_titles: 0, error: e.message };
  }
}

function getAllSemanticClusters(db) {
  try {
    return db.all(`SELECT * FROM semantic_clusters ORDER BY sample_size DESC, confidence DESC`) ?? [];
  } catch { return []; }
}

function getSemanticCluster(db, name) {
  try {
    return db.get(`SELECT * FROM semantic_clusters WHERE cluster_name = ?`, [name]) ?? null;
  } catch { return null; }
}

function upsertSemanticCluster(db, { cluster_name, cluster_centroid, sample_size, avg_vph, confidence, niches_present, dominant_hooks, trend_direction, seeded }) {
  const toJson = v => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  db.run(`
    INSERT INTO semantic_clusters
      (cluster_name, cluster_centroid, sample_size, avg_vph, confidence,
       niches_present, dominant_hooks, trend_direction, seeded, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(cluster_name) DO UPDATE SET
      cluster_centroid = excluded.cluster_centroid,
      sample_size      = excluded.sample_size,
      avg_vph          = excluded.avg_vph,
      confidence       = excluded.confidence,
      niches_present   = excluded.niches_present,
      dominant_hooks   = excluded.dominant_hooks,
      trend_direction  = excluded.trend_direction,
      updated_at       = datetime('now')
  `, [
    cluster_name, toJson(cluster_centroid ?? {}),
    sample_size ?? 0, avg_vph ?? null, confidence ?? 0,
    toJson(niches_present ?? []), toJson(dominant_hooks ?? []),
    trend_direction ?? 'stable', seeded ? 1 : 0,
  ]);
}

function cacheSemanticQuery(db, { query_hash, source_type, provider, query_text, result_json, latency_ms }) {
  try {
    db.run(`
      INSERT INTO semantic_query_cache
        (query_hash, source_type, provider, query_text, result_json, cache_hit_count, latency_ms)
      VALUES (?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(query_hash, provider) DO UPDATE SET
        result_json     = excluded.result_json,
        cache_hit_count = cache_hit_count + 1,
        latency_ms      = excluded.latency_ms
    `, [query_hash, source_type ?? null, provider, query_text ?? null,
        typeof result_json === 'string' ? result_json : JSON.stringify(result_json),
        latency_ms ?? null]);
  } catch (e) { console.warn('[semanticCache] upsert failed:', e.message); }
}

function getSemanticQueryCache(db, queryHash, provider) {
  try {
    const row = db.get(
      `SELECT * FROM semantic_query_cache WHERE query_hash = ? AND provider = ?`,
      [queryHash, provider],
    );
    if (!row) return null;
    try { db.run(`UPDATE semantic_query_cache SET cache_hit_count = cache_hit_count + 1 WHERE id = ?`, [row.id]); } catch { /* non-fatal */ }
    return row;
  } catch { return null; }
}

function getSemanticCacheStats(db) {
  try {
    return db.get(`
      SELECT COUNT(*) AS entries,
             COALESCE(SUM(cache_hit_count), 0) AS total_hits,
             ROUND(AVG(latency_ms), 1) AS avg_latency_ms,
             MAX(created_at) AS last_cached
      FROM semantic_query_cache
    `) ?? { entries: 0, total_hits: 0, avg_latency_ms: null, last_cached: null };
  } catch { return { entries: 0, total_hits: 0, avg_latency_ms: null, last_cached: null }; }
}

// ── Phase H — Strategy Recommendations ───────────────────────────────────────

function upsertStrategyRecommendation(db, rec) {
  db.run(`
    INSERT INTO strategy_recommendations
      (id, niche, category, priority_score, confidence, expected_impact,
       risk_level, estimated_uplift, time_horizon, title, reasoning,
       supporting_evidence, source_signals, rank, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      priority_score      = excluded.priority_score,
      confidence          = excluded.confidence,
      expected_impact     = excluded.expected_impact,
      risk_level          = excluded.risk_level,
      estimated_uplift    = excluded.estimated_uplift,
      time_horizon        = excluded.time_horizon,
      title               = excluded.title,
      reasoning           = excluded.reasoning,
      supporting_evidence = excluded.supporting_evidence,
      source_signals      = excluded.source_signals,
      rank                = excluded.rank,
      created_at          = datetime('now')
  `, [
    rec.recommendation_id, rec.niche ?? null, rec.category,
    rec.priority ?? 0, rec.confidence ?? 0, rec.expected_impact ?? 0,
    rec.risk_level ?? 'medium', rec.estimated_uplift ?? null, rec.time_horizon ?? null,
    rec.title, rec.reasoning,
    rec.supporting_evidence != null ? JSON.stringify(rec.supporting_evidence) : null,
    rec.source_signals != null ? JSON.stringify(rec.source_signals) : null,
    rec.rank ?? null,
  ]);
}

function getStrategyRecommendations(db, { niche, category, limit = 50 } = {}) {
  const conds = [];
  const params = [];
  if (niche)    { conds.push('niche = ?');    params.push(niche); }
  if (category) { conds.push('category = ?'); params.push(category); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(limit);
  return db.all(
    `SELECT * FROM strategy_recommendations ${where} ORDER BY priority_score DESC LIMIT ?`,
    params,
  );
}

function getStrategyRecommendationById(db, id) {
  return db.get('SELECT * FROM strategy_recommendations WHERE id = ?', [id]);
}

function saveRecommendationFeedback(db, { recommendation_id, feedback_type, notes }) {
  db.run(
    `INSERT INTO recommendation_feedback (recommendation_id, feedback_type, notes)
     VALUES (?, ?, ?)`,
    [recommendation_id, feedback_type, notes ?? null],
  );
  db.run(
    `UPDATE strategy_recommendations SET feedback = ?, feedback_at = datetime('now') WHERE id = ?`,
    [feedback_type, recommendation_id],
  );
}

function getRecommendationFeedbackStats(db) {
  return {
    by_type: db.all(`
      SELECT feedback_type, COUNT(*) AS count
      FROM recommendation_feedback
      GROUP BY feedback_type ORDER BY count DESC
    `),
    total:    db.get('SELECT COUNT(*) AS n FROM recommendation_feedback')?.n ?? 0,
    hit_rate: (() => {
      const s = db.get(`SELECT
        SUM(CASE WHEN feedback_type = 'successful' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN feedback_type = 'failed'     THEN 1 ELSE 0 END) AS failures
        FROM recommendation_feedback`) ?? {};
      const denom = (s.successes ?? 0) + (s.failures ?? 0);
      return denom > 0 ? Math.round((s.successes / denom) * 100) : null;
    })(),
    recent: db.all(`
      SELECT rf.recommendation_id, rf.feedback_type, rf.notes, rf.created_at, sr.title, sr.category
      FROM recommendation_feedback rf
      LEFT JOIN strategy_recommendations sr ON sr.id = rf.recommendation_id
      ORDER BY rf.created_at DESC LIMIT 20
    `),
  };
}

function getStrategyAnalytics(db) {
  const routing = db.get(`
    SELECT COUNT(*) AS total_requests,
      SUM(CASE WHEN route_type = 'local'  THEN 1 ELSE 0 END) AS local_count,
      SUM(CASE WHEN route_type = 'claude' THEN 1 ELSE 0 END) AS claude_count,
      SUM(CASE WHEN route_type = 'hybrid' THEN 1 ELSE 0 END) AS hybrid_count,
      COALESCE(SUM(tokens_saved_estimate), 0) AS tokens_saved
    FROM routing_log
    WHERE created_at >= datetime('now', '-30 days')
  `) ?? {};

  const recStats = db.get(`
    SELECT COUNT(*) AS total,
      ROUND(AVG(priority_score), 3) AS avg_priority,
      ROUND(AVG(confidence), 3)     AS avg_confidence,
      ROUND(AVG(estimated_uplift), 1) AS avg_uplift_est
    FROM strategy_recommendations
  `) ?? {};

  const byCategory = db.all(`
    SELECT category, COUNT(*) AS count, ROUND(AVG(priority_score), 3) AS avg_priority
    FROM strategy_recommendations
    GROUP BY category ORDER BY count DESC
  `);

  const hookMatrix = db.all(`
    SELECT niche, hook_type, median_vph, hook_score, sample_count, trend_direction, confidence_score
    FROM hook_type_performance
    WHERE duration_bucket = 'all' AND sample_count >= 3
    ORDER BY niche, hook_score DESC NULLS LAST
  `);

  const nicheList = db.all(`
    SELECT DISTINCT niche FROM ingested_channels WHERE ingest_enabled = 1 ORDER BY niche
  `).map(r => r.niche).filter(Boolean);

  return { routing, recStats, byCategory, hookMatrix, nicheList };
}

// ── Local-first channel/video cache ──────────────────────────────────────────

function getChannelCache(db, channelId) {
  const row = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channelId]);
  return row ? JSON.parse(row.raw_json) : null;
}

function getChannelCacheByHandle(db, handle) {
  if (!handle) return null;
  const normalized = handle.toLowerCase().replace(/^@/, '');
  const row = db.get(
    `SELECT raw_json FROM channel_cache WHERE lower(replace(coalesce(handle,''),'@','')) = ?`,
    [normalized]
  );
  return row ? JSON.parse(row.raw_json) : null;
}

function upsertChannelCache(db, channelItem) {
  const handle      = channelItem.snippet?.customUrl?.replace(/^@/, '') ?? null;
  const uploadsId   = channelItem.contentDetails?.relatedPlaylists?.uploads ?? null;
  const subscribers = parseInt(channelItem.statistics?.subscriberCount ?? '0', 10) || 0;
  db.run(
    `INSERT OR REPLACE INTO channel_cache
       (channel_id, handle, title, raw_json, uploads_playlist_id, subscriber_count, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [channelItem.id, handle, channelItem.snippet?.title ?? null,
     JSON.stringify(channelItem), uploadsId, subscribers]
  );
}

function getVideoCache(db, channelId) {
  const rows = db.all(
    'SELECT raw_json FROM video_cache WHERE channel_id = ? ORDER BY cached_at DESC',
    [channelId]
  );
  return rows.map(r => JSON.parse(r.raw_json));
}

function getVideoCacheById(db, videoId) {
  const row = db.get('SELECT raw_json FROM video_cache WHERE video_id = ?', [videoId]);
  return row ? JSON.parse(row.raw_json) : null;
}

function getVideoCacheIds(db, channelId) {
  return db.all(
    'SELECT video_id FROM video_cache WHERE channel_id = ?', [channelId]
  ).map(r => r.video_id);
}

function upsertVideoCache(db, videoItem) {
  if (!videoItem?.id) return;
  const channelId = videoItem.snippet?.channelId ?? null;
  const views     = parseInt(videoItem.statistics?.viewCount ?? '0', 10) || 0;
  db.run(
    `INSERT OR REPLACE INTO video_cache
       (video_id, channel_id, raw_json, view_count, cached_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [videoItem.id, channelId, JSON.stringify(videoItem), views]
  );
}

function updateVideoCacheStats(db, videoId, statistics) {
  const row = db.get('SELECT raw_json FROM video_cache WHERE video_id = ?', [videoId]);
  if (!row) return;
  const item = JSON.parse(row.raw_json);
  item.statistics = { ...item.statistics, ...statistics };
  db.run(
    `UPDATE video_cache SET raw_json = ?, view_count = ?, stats_refreshed_at = datetime('now')
     WHERE video_id = ?`,
    [JSON.stringify(item), parseInt(statistics.viewCount ?? '0', 10) || 0, videoId]
  );
}

