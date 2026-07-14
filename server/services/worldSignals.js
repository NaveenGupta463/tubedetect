'use strict';

// World signals: combines internal velocity spikes (Option A) with
// Google Trends rising queries (Option B) for a channel's topic DNA.

const googleTrends = require('google-trends-api');
const cache = require('./queryCache');

// ── Option A: Internal velocity spikes ───────────────────────────────────────
// Finds videos where the 7d views_per_hour is significantly higher than 30d,
// indicating a current acceleration spike.

// The raw spike query is entirely channel-independent (topicKeywords only affects
// the per-channel filtering/clustering below) but was re-run from scratch on EVERY
// /world-signals request with no cache -- an unscoped JOIN across video_growth_snapshots
// (ORDER BY on a computed ratio, so no index can serve the sort) that got very slow
// under concurrent write load from the ingestion worker (observed 40s+, sometimes
// timing out entirely). Caching the raw result for a few minutes turns every request
// except the rare cold one into a fast in-memory read + cheap per-channel JS filtering.
function _fetchRawSpikes(db) {
  return cache.wrap('world_signals_raw_spikes', () => db.all(`
      SELECT
        s7.video_id,
        s7.views_per_hour   AS vph_7d,
        s30.views_per_hour  AS vph_30d,
        s7.views            AS views_7d,
        s30.views           AS views_30d,
        iv.title,
        iv.channel_id,
        ic.channel_name,
        ic.niche,
        ic.inferred_topics
      FROM video_growth_snapshots s7 INDEXED BY idx_vgs_bucket_views
      JOIN video_growth_snapshots s30 INDEXED BY idx_vgs_video_bucket ON s30.video_id = s7.video_id AND s30.bucket = '30d'
      JOIN ingested_videos iv         ON iv.youtube_video_id = s7.video_id
      JOIN ingested_channels ic       ON ic.channel_id = iv.channel_id
      WHERE s7.bucket = '7d'
        AND s7.views_per_hour IS NOT NULL
        AND s30.views_per_hour IS NOT NULL
        AND s30.views_per_hour > 0
        AND s7.views_per_hour > s30.views_per_hour * 1.5
        AND s7.views > 5000
        AND iv.title IS NOT NULL
      ORDER BY s7.views DESC
      LIMIT 2000
    `), 10 * 60 * 1000);
}

function getVelocitySpikes(db, topicKeywords, { limit = 60 } = {}) {
  try {
    const spikes = _fetchRawSpikes(db);
    if (!spikes.length) return [];

    // Score each spike by relevance to the channel's topics. No keywords means we have no basis to
    // judge relevance -- fail CLOSED (show nothing) rather than open (show every viral video
    // globally regardless of niche), which is what happened before this fix.
    const topicSet = new Set(topicKeywords.map(t => t.toLowerCase()));
    if (!topicSet.size) return [];

    const scored = spikes.map(s => {
      const titleLower  = (s.title || '').toLowerCase();
      const peerTopics  = (() => { try { return JSON.parse(s.inferred_topics || '[]'); } catch(_) { return []; } })();
      const topicMatch  = [...topicSet].some(t => titleLower.includes(t) || peerTopics.some(pt => (pt||'').toLowerCase() === t)) ? 1 : 0;

      const velocityRatio = s.vph_30d > 0 ? s.vph_7d / s.vph_30d : 1;

      return {
        video_id:     s.video_id,
        title:        s.title,
        channel_name: s.channel_name,
        views_7d:     s.views_7d,
        velocity_ratio: +velocityRatio.toFixed(2),
        topic_match:  topicMatch,
      };
    }).filter(s => s.topic_match > 0);
    // SQL now orders by views (indexed) instead of the computed ratio -- rank by actual
    // velocity ratio here in JS, on the already-bounded 2000-row candidate set.
    scored.sort((a, b) => b.velocity_ratio - a.velocity_ratio);

    // Cluster into topics by extracting key noun phrases (top words from titles)
    const topicClusters = clusterTitles(scored.slice(0, limit));
    return topicClusters;
  } catch (e) {
    console.warn('[worldSignals] velocity spike query failed:', e.message);
    return [];
  }
}

function clusterTitles(spikes) {
  // Extract significant words from titles and group spikes by dominant keyword
  const STOP = new Set([
    'the','a','an','in','on','of','to','for','is','are','was','were',
    'and','or','but','not','with','by','from','at','this','that','it',
    'he','she','they','we','i','you','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'as','if','so','then','than','just','also','very','more','most',
    'its','his','her','our','their','your','my','into','up','out','over',
    'after','before','about','through','against','between','during',
    'news','today','hindi','english','latest','new','big','breaking',
    'live','watch','full','video','episode','part','series',
  ]);

  const wordScores = {};
  for (const s of spikes) {
    const words = (s.title || '').toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w));

    for (const w of words) {
      wordScores[w] = (wordScores[w] || 0) + s.velocity_ratio;
    }
  }

  const topWords = Object.entries(wordScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);

  const clusters = [];
  const assigned = new Set();

  for (const word of topWords) {
    const matching = spikes.filter((s, idx) => {
      if (assigned.has(idx)) return false;
      return (s.title || '').toLowerCase().includes(word);
    });
    if (matching.length < 1) continue;

    const indices = spikes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => (s.title || '').toLowerCase().includes(word))
      .map(({ i }) => i);
    indices.forEach(i => assigned.add(i));

    const totalViews   = matching.reduce((sum, s) => sum + (s.views_7d || 0), 0);
    const avgVelRatio  = matching.reduce((sum, s) => sum + s.velocity_ratio, 0) / matching.length;

    clusters.push({
      topic:         word,
      signal:        'velocity',
      velocity_ratio: +avgVelRatio.toFixed(2),
      video_count:   matching.length,
      total_views:   totalViews,
      sample_titles: matching.slice(0, 3).map(s => ({
        title:        s.title,
        channel_name: s.channel_name,
        views:        s.views_7d,
      })),
    });
  }

  return clusters.sort((a, b) => b.total_views - a.total_views);
}

// ── Option B: Google Trends ───────────────────────────────────────────────────

async function getTrendSignals(topics, { geo = 'IN', timeoutMs = 1500, maxTopics = 2 } = {}) {
  const results = [];
  const attempted = topics.slice(0, maxTopics);
  let failures = 0;

  for (const topic of attempted) {
    try {
      const raw = await Promise.race([
        googleTrends.relatedQueries({ keyword: topic, geo }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);

      const parsed = JSON.parse(raw);
      const risingList = parsed?.default?.rankedList?.[1]?.rankedKeyword || [];

      const rising = risingList
        .filter(r => r.value === 'Breakout' || r.value > 50)
        .slice(0, 5)
        .map(r => ({
          topic:        r.query,
          parent_topic: topic,
          trend_value:  r.value === 'Breakout' ? 999 : r.value,
          signal:       'google_trends',
        }));

      results.push(...rising);
    } catch (_) {
      // Google Trends is flaky — skip this topic but report once below.
      failures++;
    }
  }
  if (failures > 0) {
    console.warn(`[worldSignals] Google Trends lookup failed for ${failures}/${attempted.length} topics (timeout or block)`);
  }

  // Deduplicate by topic name
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.topic)) return false;
    seen.add(r.topic);
    return true;
  });
}

// ── Google Trends persistence ─────────────────────────────────────────────────
// Trends lookups are async and flaky, so they cannot run inside the synchronous
// computeWhatToPost path. Instead every successful fetch is persisted here and
// the WTP scorer reads recent rows (≤48h) as a bounded score boost.

function ensureGoogleTrendsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS google_trends_signals (
    topic        TEXT NOT NULL,
    parent_topic TEXT,
    geo          TEXT NOT NULL DEFAULT 'IN',
    trend_value  INTEGER,
    fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (topic, geo)
  )`);
}

function persistTrendSignals(db, signals, { geo = 'IN' } = {}) {
  if (!db || !Array.isArray(signals) || signals.length === 0) return 0;
  let written = 0;
  try {
    ensureGoogleTrendsTable(db);
    for (const s of signals) {
      const topic = String(s.topic || '').toLowerCase().trim();
      if (!topic) continue;
      db.run(
        `INSERT INTO google_trends_signals (topic, parent_topic, geo, trend_value, fetched_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(topic, geo) DO UPDATE SET
           parent_topic = excluded.parent_topic,
           trend_value  = excluded.trend_value,
           fetched_at   = datetime('now')`,
        [topic, s.parent_topic || null, geo, Number(s.trend_value) || 0],
      );
      written++;
    }
  } catch (e) {
    console.warn('[worldSignals] persisting Google Trends signals failed:', e.message);
  }
  return written;
}

function readRecentTrendSignals(db, { geo = 'IN', maxAgeHours = 48, limit = 40 } = {}) {
  const map = new Map();
  if (!db) return map;
  try {
    db.all(
      `SELECT topic, parent_topic, trend_value, fetched_at
       FROM google_trends_signals
       WHERE geo = ? AND fetched_at >= datetime('now', ?)
       ORDER BY trend_value DESC LIMIT ?`,
      [geo, `-${Math.max(1, Math.round(maxAgeHours))} hours`, limit],
    ).forEach(r => map.set(String(r.topic || '').toLowerCase(), r));
  } catch (_) {
    // Table absent until the first successful fetch — boost simply stays off.
  }
  return map;
}

// ── Combined entry point ──────────────────────────────────────────────────────

async function getWorldSignals(db, { channel_id, topics = [], trendTimeoutMs = 1500, trendTopicLimit = 2 }) {
  const [velocitySpikes, trendSignals] = await Promise.all([
    Promise.resolve(getVelocitySpikes(db, topics)),
    getTrendSignals(topics, { timeoutMs: trendTimeoutMs, maxTopics: trendTopicLimit }),
  ]);

  if (trendSignals.length) persistTrendSignals(db, trendSignals);

  return {
    velocity: velocitySpikes,
    trends:   trendSignals,
  };
}

module.exports = { getWorldSignals, getTrendSignals, persistTrendSignals, readRecentTrendSignals };
