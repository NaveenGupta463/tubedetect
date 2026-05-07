// Centralized SQL queries — all raw SQL lives here, not in routes or services.
// Functions accept a `db` handle (from getDb()) and return the result directly.

// ── Videos ────────────────────────────────────────────────────────────────────

function insertVideo(db, { title, hook, niche, channel_size, upload_date, prediction_date, wing, youtube_video_id, last_updated_at }) {
  return db.run(
    `INSERT INTO videos
       (title, hook, niche, channel_size, upload_date, prediction_date, wing, youtube_video_id, last_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, hook, niche, channel_size, upload_date ?? null, prediction_date, wing, youtube_video_id ?? null, last_updated_at ?? null],
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
  db.run(
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
  const tables = ['videos', 'features', 'predictions', 'performance_metrics', 'embeddings', 'workspaces'];
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
};
