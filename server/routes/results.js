const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { getDb }       = require('../db/init');
const { modelExists } = require('../services/ensembleScoring');
const {
  getVideoById, getVideoResults,
  getModelStatusCounts, getDebugCounts,
} = require('../db/queries');

const router = express.Router();

/**
 * GET /api/results/:id
 */
router.get('/results/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { video, features, prediction, performance } = getVideoResults(db, id);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  if (prediction?.ensemble_weights) {
    try { prediction.ensemble_weights = JSON.parse(prediction.ensemble_weights); } catch {}
  }

  res.json({ video, features, prediction, performance });
});

/**
 * GET /api/model/status
 */
router.get('/model/status', (_req, res) => {
  const db = getDb();

  const { total_samples, training_ready_count } = getModelStatusCounts(db);

  const exists = modelExists();

  const metaPath = path.join(__dirname, '../../ml/models/meta.json');
  let last_retrained = null;
  if (fs.existsSync(metaPath)) {
    try { last_retrained = JSON.parse(fs.readFileSync(metaPath, 'utf8')).trained_at; } catch {}
  }

  res.json({
    total_samples,
    training_ready_count,
    current_phase:  exists ? 1 : 0,
    last_retrained,
    model_exists:   exists,
  });
});

/**
 * GET /api/debug/db-stats
 */
router.get('/debug/db-stats', (_req, res) => {
  const db = getDb();

  const { total_videos, total_embeddings, total_predictions } = getDebugCounts(db);

  const byNiche = db.all(
    'SELECT niche, COUNT(*) AS count FROM videos GROUP BY niche ORDER BY count DESC'
  );

  const avgScore = db.get(
    'SELECT ROUND(AVG(final_score), 2) AS avg_score FROM predictions WHERE final_score IS NOT NULL'
  );

  res.json({
    total_videos,
    total_embeddings,
    total_predictions,
    embeddings_coverage: `${total_embeddings}/${total_videos}`,
    avg_final_score: avgScore.avg_score,
    by_niche: byNiche,
  });
});

module.exports = router;
