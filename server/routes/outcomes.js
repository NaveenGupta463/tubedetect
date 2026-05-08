const express = require('express');
const { getDb }                              = require('../db/init');
const { getSnapshotByPredictionId, updatePredictionFeedbackOutcomes } = require('../db/queries');
const { updateOutcomeMetrics }               = require('../services/outcomeTracker');

const router = express.Router();

router.post('/outcomes/refresh', (req, res) => {
  try {
    const { predictionId, actual_views_24h, actual_views_7d, actual_ctr, actual_retention } = req.body;

    if (predictionId == null) {
      return res.status(400).json({ error: 'predictionId is required' });
    }

    const db       = getDb();
    const snapshot = getSnapshotByPredictionId(db, predictionId);
    if (!snapshot) {
      return res.status(404).json({ error: 'No prediction snapshot found for this predictionId' });
    }

    const payload = updateOutcomeMetrics({ actual_views_24h, actual_views_7d, actual_ctr, actual_retention });
    updatePredictionFeedbackOutcomes(db, snapshot.id, payload);

    return res.json({
      success:       true,
      feedback_id:   snapshot.id,
      prediction_id: predictionId,
      updated_at:    payload.updated_at,
    });
  } catch (err) {
    console.error('[outcomes]', err.message);
    res.status(500).json({ error: err.message || 'Failed to update outcomes' });
  }
});

module.exports = router;
