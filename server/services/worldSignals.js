'use strict';

// World signals: combines internal velocity spikes (Option A) with
// Google Trends rising queries (Option B) for a channel's topic DNA.

const googleTrends = require('google-trends-api');

// ── Option A: Internal velocity spikes ───────────────────────────────────────
// Finds videos where the 7d views_per_hour is significantly higher than 30d,
// indicating a current acceleration spike.

function getVelocitySpikes(db, topicKeywords, { limit = 60 } = {}) {
  try {
    // Get videos with both 7d and 30d snapshots where 7d velocity > 30d velocity * 1.5
    const spikes = db.all(`
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
      FROM video_growth_snapshots s7
      JOIN video_growth_snapshots s30 ON s30.video_id = s7.video_id AND s30.bucket = '30d'
      JOIN ingested_videos iv         ON iv.youtube_video_id = s7.video_id
      JOIN ingested_channels ic       ON ic.channel_id = iv.channel_id
      WHERE s7.bucket = '7d'
        AND s7.views_per_hour IS NOT NULL
        AND s30.views_per_hour IS NOT NULL
        AND s30.views_per_hour > 0
        AND s7.views_per_hour > s30.views_per_hour * 1.5
        AND s7.views > 5000
        AND iv.title IS NOT NULL
      ORDER BY (s7.views_per_hour / s30.views_per_hour) DESC
      LIMIT 300
    `);

    if (!spikes.length) return [];

    // Score each spike by relevance to the channel's topics
    const topicSet = new Set(topicKeywords.map(t => t.toLowerCase()));

    const scored = spikes.map(s => {
      const titleLower  = (s.title || '').toLowerCase();
      const peerTopics  = (() => { try { return JSON.parse(s.inferred_topics || '[]'); } catch(_) { return []; } })();
      const topicMatch  = topicSet.size === 0 ? 1
        : [...topicSet].some(t => titleLower.includes(t) || peerTopics.some(pt => (pt||'').toLowerCase() === t)) ? 1 : 0;

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

async function getTrendSignals(topics, { geo = 'IN', timeoutMs = 8000 } = {}) {
  const results = [];

  for (const topic of topics.slice(0, 3)) {
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
      // Google Trends is flaky — silently skip on timeout or block
    }
  }

  // Deduplicate by topic name
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.topic)) return false;
    seen.add(r.topic);
    return true;
  });
}

// ── Combined entry point ──────────────────────────────────────────────────────

async function getWorldSignals(db, { channel_id, topics = [] }) {
  const [velocitySpikes, trendSignals] = await Promise.all([
    Promise.resolve(getVelocitySpikes(db, topics)),
    getTrendSignals(topics),
  ]);

  return {
    velocity: velocitySpikes,
    trends:   trendSignals,
  };
}

module.exports = { getWorldSignals };
