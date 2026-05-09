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

function insertPrediction(db, videoId, { ml_score, similarity_score, final_score, confidence, ensemble_weights }) {
  return db.run(
    `INSERT INTO predictions
       (video_id, llm_score, ml_score, similarity_score, final_score, confidence, ensemble_weights)
     VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    [videoId, ml_score, similarity_score, final_score, confidence, JSON.stringify(ensemble_weights)],
  );
}

function upsertPrediction(db, videoId, { ml_score, similarity_score, final_score, confidence, ensemble_weights }) {
  db.run(
    `INSERT INTO predictions
       (video_id, llm_score, ml_score, similarity_score, final_score, confidence, ensemble_weights)
     VALUES (?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       ml_score=excluded.ml_score, similarity_score=excluded.similarity_score,
       final_score=excluded.final_score, confidence=excluded.confidence,
       ensemble_weights=excluded.ensemble_weights`,
    [videoId, ml_score, similarity_score, final_score, confidence, JSON.stringify(ensemble_weights)],
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
       COALESCE(LOWER(TRIM(niche)), 'unknown')            AS niche,
       calibration_error,
       COALESCE(LOWER(TRIM(confidence_state)), 'unknown') AS confidence_state,
       pipeline_version,
       video_id
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND calibration_error IS NOT NULL
     ORDER BY created_at DESC
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
};
