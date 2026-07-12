'use strict';

// WTP Outcome Controller — API handlers for recommendation outcome events.
//
// All endpoints are fire-and-forget from the client's perspective.
// Every handler returns 204 on success and 400 on bad input.
// 5xx errors are swallowed so tracking failures never surface to creators.

const { getDb }              = require('../db/init');
const {
  recordSave,
  recordBrief,
  recordExport,
  recordVideoMatch,
  recordImpressions,
  fetchFunnelMetrics,
  fetchSourceBreakdown,
  fetchTopTopics,
} = require('../services/wtpOutcomeTracker');

// ── Validation helpers ────────────────────────────────────────────────────────

function requireString(value, name, res) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    res.status(400).json({ error: `${name} is required` });
    return false;
  }
  return true;
}

function sanitizeString(value, maxLen = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLen) : null;
}

// ── POST /impression ──────────────────────────────────────────────────────────
// Records all ideas shown to a creator in a single WTP view.
// Body: { channel_id, session_id?, ideas: [{ idea_key, topic, rec_source, rec_type, score, confidence, rank_position }] }
//
function impressionHandler(req, res) {
  try {
    const { channel_id, session_id, ideas } = req.body || {};
    if (!requireString(channel_id, 'channel_id', res)) return;
    if (!Array.isArray(ideas) || !ideas.length) {
      return res.status(400).json({ error: 'ideas must be a non-empty array' });
    }

    // Shape each idea so recordImpressions can use them directly
    const normalized = ideas.map((raw, idx) => ({
      wtp_idea_key:        sanitizeString(raw.idea_key, 32),
      topic:               sanitizeString(raw.topic, 200) || '',
      wtp_rec_source:      sanitizeString(raw.rec_source, 32) || 'peer_signal',
      idea_type:           sanitizeString(raw.rec_type, 60) || '',
      score:               raw.score != null ? Number(raw.score) : null,
      confidence_tier:     sanitizeString(raw.confidence, 10),
      _rank:               raw.rank_position ?? idx + 1,
    }));

    const db = getDb();
    recordImpressions(db, channel_id.trim(), normalized, session_id || null);
    res.status(204).end();
  } catch (e) {
    console.warn('[wtp_outcomes] impressionHandler error:', e.message);
    res.status(204).end(); // swallow — tracking must not break the UI
  }
}

// ── POST /save ────────────────────────────────────────────────────────────────
// Body: { channel_id, idea_key, topic, rec_source, rec_type?, score? }
//
function saveHandler(req, res) {
  try {
    const { channel_id, idea_key, topic, rec_source, rec_type, score } = req.body || {};
    if (!requireString(channel_id, 'channel_id', res)) return;
    if (!requireString(idea_key,   'idea_key',   res)) return;
    if (!requireString(topic,      'topic',      res)) return;
    if (!requireString(rec_source, 'rec_source', res)) return;

    const db = getDb();
    recordSave(db, {
      channelId: channel_id.trim(),
      ideaKey:   idea_key.trim(),
      topic:     sanitizeString(topic, 200),
      recSource: rec_source.trim(),
      recType:   sanitizeString(rec_type, 60),
      score:     score != null ? Number(score) : null,
    });
    res.status(204).end();
  } catch (e) {
    console.warn('[wtp_outcomes] saveHandler error:', e.message);
    res.status(204).end();
  }
}

// ── POST /brief ───────────────────────────────────────────────────────────────
// Body: { channel_id, idea_key, topic, rec_source, rec_type?, score? }
//
function briefHandler(req, res) {
  try {
    const { channel_id, idea_key, topic, rec_source, rec_type, score } = req.body || {};
    if (!requireString(channel_id, 'channel_id', res)) return;
    if (!requireString(idea_key,   'idea_key',   res)) return;
    if (!requireString(topic,      'topic',      res)) return;
    if (!requireString(rec_source, 'rec_source', res)) return;

    const db = getDb();
    recordBrief(db, {
      channelId: channel_id.trim(),
      ideaKey:   idea_key.trim(),
      topic:     sanitizeString(topic, 200),
      recSource: rec_source.trim(),
      recType:   sanitizeString(rec_type, 60),
      score:     score != null ? Number(score) : null,
    });
    res.status(204).end();
  } catch (e) {
    console.warn('[wtp_outcomes] briefHandler error:', e.message);
    res.status(204).end();
  }
}

// ── POST /export ──────────────────────────────────────────────────────────────
// Body: { channel_id, idea_key, topic, rec_source, rec_type?, score?, export_format? }
//
function exportHandler(req, res) {
  try {
    const { channel_id, idea_key, topic, rec_source, rec_type, score, export_format } = req.body || {};
    if (!requireString(channel_id, 'channel_id', res)) return;
    if (!requireString(idea_key,   'idea_key',   res)) return;
    if (!requireString(topic,      'topic',      res)) return;
    if (!requireString(rec_source, 'rec_source', res)) return;

    const db = getDb();
    recordExport(db, {
      channelId:    channel_id.trim(),
      ideaKey:      idea_key.trim(),
      topic:        sanitizeString(topic, 200),
      recSource:    rec_source.trim(),
      recType:      sanitizeString(rec_type, 60),
      score:        score != null ? Number(score) : null,
      exportFormat: sanitizeString(export_format, 30),
    });
    res.status(204).end();
  } catch (e) {
    console.warn('[wtp_outcomes] exportHandler error:', e.message);
    res.status(204).end();
  }
}

// ── POST /video-match ─────────────────────────────────────────────────────────
// Records a published video that matches a prior recommendation.
// Body: { channel_id, idea_key, topic, rec_source, rec_type?, score?,
//         video_id?, video_title?, days_to_publish?, match_confidence? }
//
function videoMatchHandler(req, res) {
  try {
    const {
      channel_id, idea_key, topic, rec_source, rec_type, score,
      video_id, video_title, days_to_publish, match_confidence,
    } = req.body || {};

    if (!requireString(channel_id, 'channel_id', res)) return;
    if (!requireString(idea_key,   'idea_key',   res)) return;
    if (!requireString(topic,      'topic',      res)) return;
    if (!requireString(rec_source, 'rec_source', res)) return;

    const db = getDb();
    recordVideoMatch(db, {
      channelId:      channel_id.trim(),
      ideaKey:        idea_key.trim(),
      topic:          sanitizeString(topic, 200),
      recSource:      rec_source.trim(),
      recType:        sanitizeString(rec_type, 60),
      score:          score != null ? Number(score) : null,
      videoId:        sanitizeString(video_id, 64),
      videoTitle:     sanitizeString(video_title, 300),
      daysToPublish:  days_to_publish != null ? Number(days_to_publish) : null,
      matchConfidence: sanitizeString(match_confidence, 20) || 'manual',
    });
    res.status(204).end();
  } catch (e) {
    console.warn('[wtp_outcomes] videoMatchHandler error:', e.message);
    res.status(204).end();
  }
}

// ── GET /metrics ──────────────────────────────────────────────────────────────
// Returns funnel metrics + per-source breakdown.
// Query: ?days=30&channel_id=UCxxx
//
function metricsHandler(req, res) {
  try {
    const days      = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const channelId = req.query.channel_id || null;
    const topLimit  = Math.max(5, Math.min(100, Number(req.query.top) || 20));

    const db = getDb();
    const funnel  = fetchFunnelMetrics(db,      { days, channelId });
    const sources = fetchSourceBreakdown(db,    { days, channelId });
    const topics  = fetchTopTopics(db,          { days, channelId, limit: topLimit });

    res.json({ funnel, sources, topTopics: topics, windowDays: days });
  } catch (e) {
    console.error('[wtp_outcomes] metricsHandler error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  impressionHandler,
  saveHandler,
  briefHandler,
  exportHandler,
  videoMatchHandler,
  metricsHandler,
};
