'use strict';

const { getDb } = require('../db/init');
const { promoteToVideoMatch } = require('../services/wtpAttributionMatcher');

// GET /api/intel/wtp-attribution/pending?channel_id=XX[&limit=20]
// Returns 'possible' candidates awaiting creator confirmation, ranked by score.
function pendingHandler(req, res) {
  const { channel_id, limit: limitParam } = req.query;
  if (!channel_id) return res.status(400).json({ error: 'channel_id required' });

  const limit = Math.max(1, Math.min(100, Number(limitParam) || 20));
  const db    = getDb();

  try {
    const rows = db.all(
      `SELECT id, channel_id, video_id, video_title, video_published_at,
              idea_key, topic, rec_source, rec_type,
              had_export, had_brief, had_save,
              recommendation_age_days, title_sim_score,
              behavior_score, age_score, title_score, total_score,
              match_confidence, computed_at
       FROM wtp_attribution_candidates
       WHERE channel_id = ?
         AND match_confidence = 'possible'
         AND creator_confirmed IS NULL
         AND promoted = 0
       ORDER BY total_score DESC
       LIMIT ?`,
      [channel_id, limit],
    );
    return res.json({ pending: rows, count: rows.length });
  } catch (e) {
    console.error('[wtpAttribution] pendingHandler:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/intel/wtp-attribution/confirm  { candidate_id, channel_id }
// Creator confirms attribution → marks confirmed + promotes to wtp_video_matches.
function confirmHandler(req, res) {
  const { candidate_id, channel_id } = req.body || {};
  if (!candidate_id || !channel_id) {
    return res.status(400).json({ error: 'candidate_id and channel_id required' });
  }

  const db = getDb();

  try {
    const candidate = db.get(
      `SELECT * FROM wtp_attribution_candidates WHERE id = ? AND channel_id = ? LIMIT 1`,
      [candidate_id, channel_id],
    );
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (candidate.creator_confirmed === 1) return res.json({ ok: true, already: true });

    db.run(
      `UPDATE wtp_attribution_candidates
       SET creator_confirmed = 1, confirmed_at = datetime('now'), match_confidence = 'confirmed'
       WHERE id = ?`,
      [candidate_id],
    );

    const promoted = promoteToVideoMatch(db, { ...candidate, match_confidence: 'confirmed' });
    return res.json({ ok: true, promoted });
  } catch (e) {
    console.error('[wtpAttribution] confirmHandler:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// POST /api/intel/wtp-attribution/reject  { candidate_id, channel_id }
// Creator rejects attribution → marks rejected, no promotion.
function rejectHandler(req, res) {
  const { candidate_id, channel_id } = req.body || {};
  if (!candidate_id || !channel_id) {
    return res.status(400).json({ error: 'candidate_id and channel_id required' });
  }

  const db = getDb();

  try {
    const result = db.run(
      `UPDATE wtp_attribution_candidates
       SET creator_confirmed = 0, rejected_at = datetime('now')
       WHERE id = ? AND channel_id = ? AND creator_confirmed IS NULL`,
      [candidate_id, channel_id],
    );
    if (!result.changes) {
      return res.status(404).json({ error: 'Candidate not found or already confirmed' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[wtpAttribution] rejectHandler:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// GET /api/intel/wtp-attribution/stats?channel_id=XX[&days=30]
// Attribution summary: totals + per-source breakdown.
function statsHandler(req, res) {
  const { channel_id, days: daysParam } = req.query;
  if (!channel_id) return res.status(400).json({ error: 'channel_id required' });

  const days  = Math.max(1, Math.min(365, Number(daysParam) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db    = getDb();

  try {
    const totals = db.get(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN match_confidence IN ('highly_likely','confirmed') THEN 1 ELSE 0 END) AS strong_matches,
         SUM(CASE WHEN match_confidence = 'possible' AND creator_confirmed IS NULL THEN 1 ELSE 0 END) AS pending_confirmation,
         SUM(CASE WHEN creator_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN creator_confirmed = 0 THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN promoted = 1 THEN 1 ELSE 0 END) AS promoted_to_matches
       FROM wtp_attribution_candidates
       WHERE channel_id = ? AND computed_at >= ?`,
      [channel_id, since],
    );

    const bySource = db.all(
      `SELECT rec_source,
         COUNT(*) AS candidates,
         SUM(CASE WHEN promoted = 1 THEN 1 ELSE 0 END) AS promoted,
         SUM(CASE WHEN creator_confirmed = 1 THEN 1 ELSE 0 END) AS confirmed,
         ROUND(AVG(total_score), 1) AS avg_score,
         MAX(total_score) AS max_score
       FROM wtp_attribution_candidates
       WHERE channel_id = ? AND computed_at >= ? AND match_confidence != 'unlikely'
       GROUP BY rec_source
       ORDER BY candidates DESC`,
      [channel_id, since],
    );

    return res.json({ days, totals, bySource });
  } catch (e) {
    console.error('[wtpAttribution] statsHandler:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { pendingHandler, confirmHandler, rejectHandler, statsHandler };
