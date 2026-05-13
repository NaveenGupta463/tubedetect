const express = require('express');
const { getDb }                     = require('../db/init');
const { getSnapshotByPredictionId, updatePredictionFeedbackLabel } = require('../db/queries');
const { attachUserFeedback }        = require('../services/outcomeTracker');

const router = express.Router();

router.post('/prediction-feedback', (req, res) => {
  try {
    const { predictionId, label, reason, notes, scoreOverride } = req.body;

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

    // Compute disagreement magnitude if override provided
    let disagreementMagnitude = null;
    if (scoreOverride != null && snapshot.predicted_score != null) {
      disagreementMagnitude = parseFloat(Math.abs(scoreOverride - snapshot.predicted_score).toFixed(2));
    }

    updatePredictionFeedbackLabel(db, snapshot.id, payload);

    if (scoreOverride != null) {
      db.run(
        `UPDATE prediction_feedback
         SET score_override = ?, disagreement_magnitude = ?
         WHERE id = ?`,
        [parseFloat(scoreOverride), disagreementMagnitude, snapshot.id],
      );
      // Propagate disagreement_score to matching video_outcome row
      if (disagreementMagnitude != null) {
        db.run(
          `UPDATE video_outcomes SET disagreement_score = ?
           WHERE prediction_id = ?`,
          [disagreementMagnitude, snapshot.prediction_id],
        );
      }
    }

    return res.json({
      success:               true,
      feedback_id:           snapshot.id,
      prediction_id:         predictionId,
      feedback_label:        label,
      score_override:        scoreOverride ?? null,
      disagreement_magnitude: disagreementMagnitude,
      saved_at:              payload.updated_at,
    });
  } catch (err) {
    console.error('[prediction-feedback]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save feedback' });
  }
});

module.exports = router;
