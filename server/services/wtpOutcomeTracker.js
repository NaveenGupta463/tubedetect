'use strict';

// WTP Outcome Tracker — source classification, idea_key generation, and insert helpers.
//
// This module is the single source of truth for:
//   - How a recommendation's source engine is classified (classifyRecSource)
//   - How a stable, deterministic idea_key is computed (makeIdeaKey)
//   - How tracking events are written to the DB (recordXxx functions)
//
// It does NOT touch recommendation generation logic.

const crypto = require('crypto');

// ── Source classification ─────────────────────────────────────────────────────
// Maps the raw WTP idea fields to one of five measurable source buckets.
//
//  peer_signal    — topic_gap, context_gap, long_form_opportunity backed by peer video data
//  dna            — originalBets / creator-specific DNA recommendations
//  creative_engine — creativeOpportunityEngine (format/mood/occasion/language axis)
//  trend_engine   — angle_gap, narrative_angle, peer_video_signal, territory_expansion, defence_signal
//  fallback       — fallback_evergreen pool (thin niche)
//
const SOURCE_PEER    = 'peer_signal';
const SOURCE_DNA     = 'dna';
const SOURCE_CREATIVE = 'creative_engine';
const SOURCE_TREND   = 'trend_engine';
const SOURCE_FALLBACK = 'fallback';

const TREND_ENGINE_TYPES = new Set([
  'angle_gap', 'narrative_angle', 'peer_video_signal',
  'territory_expansion', 'defence_signal',
]);

function classifyRecSource(idea) {
  const src  = String(idea.source            || '');
  const type = String(idea.idea_type         || idea.recommendation_type || src);

  if (src === 'fallback_evergreen')    return SOURCE_FALLBACK;
  if (type === 'dna_bet')             return SOURCE_DNA;
  if (type === 'creative_package')    return SOURCE_CREATIVE;
  if (TREND_ENGINE_TYPES.has(type))   return SOURCE_TREND;
  if (TREND_ENGINE_TYPES.has(src))    return SOURCE_TREND;
  return SOURCE_PEER;
}

// ── idea_key ──────────────────────────────────────────────────────────────────
// Deterministic 16-char hex string that identifies a recommendation uniquely per channel.
// Stable across requests so events can be joined across tables.
//
function makeIdeaKey(channelId, topic, recSource) {
  const content = `${channelId}:${String(topic || '').toLowerCase().trim()}:${recSource}`;
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
}

// ── Attach keys to ideas ──────────────────────────────────────────────────────
// Called in the WTP handler after getCachedOrComputeWhatToPost returns.
// Mutates each idea in place — adds wtp_idea_key and wtp_rec_source.
// Idempotent: skips ideas that already have a key (cache hit scenario).
//
function attachIdeaKeys(ideas, channelId) {
  if (!Array.isArray(ideas) || !channelId) return;
  for (const idea of ideas) {
    if (idea.wtp_idea_key) continue;
    const recSource = classifyRecSource(idea);
    idea.wtp_idea_key   = makeIdeaKey(channelId, idea.topic || idea.title || '', recSource);
    idea.wtp_rec_source = recSource;
  }
}

// ── DB insert helpers ─────────────────────────────────────────────────────────

function recordImpressions(db, channelId, ideas, sessionId) {
  if (!Array.isArray(ideas) || !ideas.length) return;
  const stmt = db._stmt(
    `INSERT INTO wtp_impressions
       (channel_id, session_id, idea_key, topic, rec_source, rec_type, score, confidence, rank_position, trend_bonus, gap_bonus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insert = db.transaction((rows) => { for (const r of rows) stmt.run(r); });
  const rows = ideas.map((idea, idx) => [
    channelId,
    sessionId || null,
    idea.wtp_idea_key  || makeIdeaKey(channelId, idea.topic || '', classifyRecSource(idea)),
    String(idea.topic  || '').slice(0, 200),
    idea.wtp_rec_source || classifyRecSource(idea),
    String(idea.idea_type || idea.recommendation_type || idea.source || '').slice(0, 60),
    idea.score != null ? Number(idea.score) : null,
    String(idea.confidence_tier || idea.confidence || '').slice(0, 10) || null,
    idx + 1,
    idea.trend_bonus != null ? Number(idea.trend_bonus) : null,
    idea.gap_bonus   != null ? Number(idea.gap_bonus)   : null,
  ]);
  try { insert(rows); } catch (e) {
    console.warn('[wtp_outcomes] recordImpressions failed:', e.message);
  }
}

function recordSave(db, { channelId, ideaKey, topic, recSource, recType, score }) {
  try {
    db.run(
      `INSERT INTO wtp_saves (channel_id, idea_key, topic, rec_source, rec_type, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [channelId, ideaKey, topic, recSource, recType || null, score != null ? Number(score) : null],
    );
  } catch (e) { console.warn('[wtp_outcomes] recordSave failed:', e.message); }
}

function recordBrief(db, { channelId, ideaKey, topic, recSource, recType, score }) {
  try {
    db.run(
      `INSERT INTO wtp_brief_generations (channel_id, idea_key, topic, rec_source, rec_type, score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [channelId, ideaKey, topic, recSource, recType || null, score != null ? Number(score) : null],
    );
  } catch (e) { console.warn('[wtp_outcomes] recordBrief failed:', e.message); }
}

function recordExport(db, { channelId, ideaKey, topic, recSource, recType, score, exportFormat }) {
  try {
    db.run(
      `INSERT INTO wtp_exports (channel_id, idea_key, topic, rec_source, rec_type, score, export_format)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [channelId, ideaKey, topic, recSource, recType || null, score != null ? Number(score) : null, exportFormat || null],
    );
  } catch (e) { console.warn('[wtp_outcomes] recordExport failed:', e.message); }
}

function recordVideoMatch(db, { channelId, ideaKey, topic, recSource, recType, score, videoId, videoTitle, daysToPublish, matchConfidence }) {
  try {
    db.run(
      `INSERT INTO wtp_video_matches
         (channel_id, idea_key, topic, rec_source, rec_type, score, video_id, video_title, days_to_publish, match_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        channelId, ideaKey, topic, recSource, recType || null,
        score != null ? Number(score) : null,
        videoId || null,
        videoTitle ? String(videoTitle).slice(0, 300) : null,
        daysToPublish != null ? Number(daysToPublish) : null,
        matchConfidence || 'manual',
      ],
    );
  } catch (e) { console.warn('[wtp_outcomes] recordVideoMatch failed:', e.message); }
}

// ── Metrics queries ───────────────────────────────────────────────────────────
// Used by the metrics endpoint and the dashboard script.

function fetchFunnelMetrics(db, { days = 30, channelId = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chFilter = channelId ? 'AND channel_id = ?' : '';
  const chParams = channelId ? [since, channelId] : [since];

  const imp = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ? ${chFilter}`, chParams,
  )?.n || 0;
  const saves = db.get(
    `SELECT COUNT(*) AS n FROM wtp_saves WHERE created_at >= ? ${chFilter}`, chParams,
  )?.n || 0;
  const briefs = db.get(
    `SELECT COUNT(*) AS n FROM wtp_brief_generations WHERE created_at >= ? ${chFilter}`, chParams,
  )?.n || 0;
  const exports = db.get(
    `SELECT COUNT(*) AS n FROM wtp_exports WHERE created_at >= ? ${chFilter}`, chParams,
  )?.n || 0;
  const matches = db.get(
    `SELECT COUNT(*) AS n FROM wtp_video_matches WHERE created_at >= ? ${chFilter}`, chParams,
  )?.n || 0;

  const rate = (n) => imp > 0 ? +(n / imp * 100).toFixed(1) : 0;

  return {
    impressions:   imp,
    saves,         saves,
    briefs,        briefs,
    exports,       exports,
    videoMatches:  matches,
    saveRate:      rate(saves),
    briefRate:     rate(briefs),
    exportRate:    rate(exports),
    publishRate:   rate(matches),
    successRate:   rate(saves + briefs + exports + matches),
    ctr:           rate(saves + briefs),
    windowDays:    days,
  };
}

function fetchSourceBreakdown(db, { days = 30, channelId = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chFilter = channelId ? 'AND channel_id = ?' : '';
  const chParams = channelId ? [since, channelId] : [since];

  const sources = [SOURCE_PEER, SOURCE_DNA, SOURCE_CREATIVE, SOURCE_TREND, SOURCE_FALLBACK];
  const result  = {};

  for (const src of sources) {
    const srcParams = [...chParams, src];
    const imp    = db.get(`SELECT COUNT(*) AS n FROM wtp_impressions       WHERE created_at >= ? ${chFilter} AND rec_source = ?`, srcParams)?.n || 0;
    const saves  = db.get(`SELECT COUNT(*) AS n FROM wtp_saves              WHERE created_at >= ? ${chFilter} AND rec_source = ?`, srcParams)?.n || 0;
    const briefs = db.get(`SELECT COUNT(*) AS n FROM wtp_brief_generations  WHERE created_at >= ? ${chFilter} AND rec_source = ?`, srcParams)?.n || 0;
    const exps   = db.get(`SELECT COUNT(*) AS n FROM wtp_exports             WHERE created_at >= ? ${chFilter} AND rec_source = ?`, srcParams)?.n || 0;
    const matches= db.get(`SELECT COUNT(*) AS n FROM wtp_video_matches       WHERE created_at >= ? ${chFilter} AND rec_source = ?`, srcParams)?.n || 0;

    const rate = (n) => imp > 0 ? +(n / imp * 100).toFixed(1) : 0;
    result[src] = {
      impressions:  imp,
      saves,
      briefs,
      exports:      exps,
      videoMatches: matches,
      saveRate:     rate(saves),
      briefRate:    rate(briefs),
      exportRate:   rate(exps),
      publishRate:  rate(matches),
      successRate:  rate(saves + briefs + exps + matches),
      ctr:          rate(saves + briefs),
    };
  }
  return result;
}

function fetchTopTopics(db, { days = 30, limit = 20, channelId = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chFilter = channelId ? 'AND channel_id = ?' : '';
  const chParams = channelId ? [since, channelId, limit] : [since, limit];

  return db.all(
    `SELECT
       i.topic,
       i.rec_source,
       COUNT(i.id) AS impressions,
       COALESCE(s.saves, 0)   AS saves,
       COALESCE(b.briefs, 0)  AS briefs,
       COALESCE(e.exports, 0) AS exports,
       COALESCE(m.matches, 0) AS video_matches
     FROM wtp_impressions i
     LEFT JOIN (SELECT idea_key, COUNT(*) AS saves   FROM wtp_saves             WHERE created_at >= ? GROUP BY idea_key) s ON i.idea_key = s.idea_key
     LEFT JOIN (SELECT idea_key, COUNT(*) AS briefs  FROM wtp_brief_generations WHERE created_at >= ? GROUP BY idea_key) b ON i.idea_key = b.idea_key
     LEFT JOIN (SELECT idea_key, COUNT(*) AS exports FROM wtp_exports            WHERE created_at >= ? GROUP BY idea_key) e ON i.idea_key = e.idea_key
     LEFT JOIN (SELECT idea_key, COUNT(*) AS matches FROM wtp_video_matches      WHERE created_at >= ? GROUP BY idea_key) m ON i.idea_key = m.idea_key
     WHERE i.created_at >= ? ${chFilter}
     GROUP BY i.idea_key
     ORDER BY (saves + briefs + exports + video_matches) DESC, impressions DESC
     LIMIT ?`,
    [since, since, since, since, ...chParams],
  );
}

module.exports = {
  classifyRecSource,
  makeIdeaKey,
  attachIdeaKeys,
  recordImpressions,
  recordSave,
  recordBrief,
  recordExport,
  recordVideoMatch,
  fetchFunnelMetrics,
  fetchSourceBreakdown,
  fetchTopTopics,
  SOURCES: { SOURCE_PEER, SOURCE_DNA, SOURCE_CREATIVE, SOURCE_TREND, SOURCE_FALLBACK },
};
