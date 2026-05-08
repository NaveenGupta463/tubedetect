const express = require('express');
const { getDb }                              = require('../db/init');
const {
  getSnapshotByPredictionId,
  updatePredictionFeedbackOutcomes,
  insertVideoOutcome,
  getVideoOutcomeByPredictionId,
  getMostRecentOutcomeByYouTubeId,
  updateVideoOutcomeRefresh,
}                                            = require('../db/queries');
const { updateOutcomeMetrics }               = require('../services/outcomeTracker');
const { captureOutcomeSnapshot, computeOutcomeRefreshPayload } = require('../services/outcomeCollector');

const router = express.Router();

function normalizeYouTubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  const watchMatch  = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch)  return watchMatch[1];
  const shortMatch  = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch)  return shortMatch[1];
  const shortsMatch = s.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  return null;
}

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

router.post('/outcomes/publish', (req, res) => {
  try {
    const { prediction_id, youtube_video_id, published_at } = req.body;

    if (!youtube_video_id) {
      return res.status(400).json({ error: 'youtube_video_id is required' });
    }
    const ytId = normalizeYouTubeId(youtube_video_id);
    if (!ytId) {
      return res.status(400).json({ error: 'Invalid youtube_video_id format' });
    }

    const db = getDb();

    if (prediction_id != null) {
      const existing = getVideoOutcomeByPredictionId(db, prediction_id);
      if (existing) {
        return res.json({ success: true, outcome_id: existing.id, already_tracked: true });
      }
    }

    let snapshotData = {};
    let videoData    = null;
    const pfRow = prediction_id != null ? getSnapshotByPredictionId(db, prediction_id) : null;

    if (pfRow) {
      snapshotData = {
        prediction_id:    pfRow.prediction_id,
        video_id:         pfRow.video_id,
        pipeline_version: pfRow.pipeline_version,
        predicted_score:  pfRow.predicted_score,
        predicted_state:  pfRow.predicted_state,
        confidence_state: pfRow.confidence_state,
      };
    } else if (prediction_id != null) {
      const fallback = db.get(
        `SELECT p.video_id, p.final_score, v.niche, v.title, v.hook
         FROM predictions p JOIN videos v ON v.id = p.video_id
         WHERE p.video_id = ?`,
        [prediction_id],
      );
      if (!fallback) {
        return res.status(404).json({ error: 'No prediction found for this prediction_id' });
      }
      snapshotData = {
        prediction_id:    prediction_id,
        video_id:         fallback.video_id,
        pipeline_version: 'legacy',
        predicted_score:  fallback.final_score,
        predicted_state:  null,
        confidence_state: null,
      };
      videoData = { niche: fallback.niche, title: fallback.title, hook: fallback.hook };
    }

    const publishData = {
      youtube_video_id:    ytId,
      published_at:        published_at ?? new Date().toISOString(),
      published_title:     null,
      published_thumbnail: null,
    };

    const payload = captureOutcomeSnapshot({ snapshotData, videoData, publishData });
    const result  = insertVideoOutcome(db, payload);

    return res.json({ success: true, outcome_id: result.lastInsertRowid, already_tracked: false });
  } catch (err) {
    console.error('[outcomes/publish]', err.message);
    res.status(500).json({ error: err.message || 'Failed to track publish' });
  }
});

router.post('/outcomes/video-refresh', (req, res) => {
  try {
    const {
      youtube_video_id,
      actual_views_1h, actual_views_24h, actual_views_7d,
      actual_ctr, actual_retention,
    } = req.body;

    if (!youtube_video_id) {
      return res.status(400).json({ error: 'youtube_video_id is required' });
    }
    const ytId = normalizeYouTubeId(youtube_video_id);
    if (!ytId) {
      return res.status(400).json({ error: 'Invalid youtube_video_id format' });
    }

    const db      = getDb();
    const outcome = getMostRecentOutcomeByYouTubeId(db, ytId);
    if (!outcome) {
      return res.status(404).json({ error: 'No outcome tracked for this video' });
    }

    const toNum = (v) => (v != null ? Number(v) : null);
    const payload = computeOutcomeRefreshPayload({
      outcome,
      actual_views_1h:  toNum(actual_views_1h),
      actual_views_24h: toNum(actual_views_24h),
      actual_views_7d:  toNum(actual_views_7d),
      actual_ctr:       toNum(actual_ctr),
      actual_retention: toNum(actual_retention),
    });

    updateVideoOutcomeRefresh(db, outcome.id, payload);

    return res.json({
      success:           true,
      outcome_id:        outcome.id,
      outcome_state:     payload.outcome_state,
      calibration_error: payload.calibration_error,
      calibration_band:  payload.calibration_band,
      refreshed_at:      payload.last_refreshed_at,
    });
  } catch (err) {
    console.error('[outcomes/video-refresh]', err.message);
    res.status(500).json({ error: err.message || 'Failed to refresh outcome' });
  }
});

module.exports = router;
