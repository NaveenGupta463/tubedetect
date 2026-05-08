const express = require('express');
const { getDb }                     = require('../db/init');
const { getSnapshotByPredictionId, updatePredictionFeedbackLabel } = require('../db/queries');
const { attachUserFeedback }        = require('../services/outcomeTracker');

const router = express.Router();

router.post('/prediction-feedback', (req, res) => {
  try {
    const { predictionId, label, reason, notes } = req.body;

    if (predictionId == null) {
      return res.status(400).json({ error: 'predictionId is required' });
    }

    let payload;
    try {
      payload = attachUserFeedback({ label, reason, notes });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const db       = getDb();
    const snapshot = getSnapshotByPredictionId(db, predictionId);
    if (!snapshot) {
      return res.status(404).json({ error: 'No prediction snapshot found for this predictionId' });
    }

    updatePredictionFeedbackLabel(db, snapshot.id, payload);

    return res.json({
      success:        true,
      feedback_id:    snapshot.id,
      prediction_id:  predictionId,
      feedback_label: label,
      saved_at:       payload.updated_at,
    });
  } catch (err) {
    console.error('[prediction-feedback]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save feedback' });
  }
});

module.exports = router;
