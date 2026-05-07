const express  = require('express');
const { getDb }                    = require('../db/init');
const { extractFeatures }          = require('../services/featureExtraction');
const { processEmbeddingAndSearch } = require('../services/similarityEngine');
const { buildEnsemble }            = require('../services/ensembleScoring');
const { fetchVideoFull, fetchChannelStatsBatch } = require('../services/youtubeMetrics');
const { quotaAvailable, recordUsage } = require('../services/quotaGuard');
const {
  insertVideo, getVideoByYouTubeId, updateVideoMeta,
  upsertFeatures, upsertPerformanceMetrics, upsertPrediction,
} = require('../db/queries');

const router = express.Router();

// ── Metrics counters (in-memory, reset on restart) ───────────────────────────
const counters = { db_hits: 0, api_calls: 0, refreshes: 0, total: 0 };

function dbHitPct() {
  return counters.total > 0
    ? parseFloat(((counters.db_hits / counters.total) * 100).toFixed(1))
    : 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {}
  if (/^[A-Za-z0-9_-]{11}$/.test(raw.trim())) return raw.trim();
  return null;
}

function refreshIntervalMs(uploadDate) {
  if (!uploadDate) return 7 * 86400000;
  const ageDays = (Date.now() - new Date(uploadDate).getTime()) / 86400000;
  if (ageDays < 3)  return 6  * 3600000;
  if (ageDays < 14) return 24 * 3600000;
  return 7 * 86400000;
}

function isStale(lastUpdatedAt, uploadDate) {
  if (!lastUpdatedAt) return true;
  return (Date.now() - new Date(lastUpdatedAt).getTime()) > refreshIntervalMs(uploadDate);
}

/**
 * Run ML + similarity scoring for an existing DB video.
 * Returns { simResult, ensemble }.
 */
async function scoreDbVideo(videoId, title, niche, channelSize, views, likes, uploadDate) {
  const db       = getDb();
  const features = extractFeatures({ title, hook: title, niche });

  upsertFeatures(db, videoId, features);

  if (views > 0) {
    const ageDays   = uploadDate
      ? Math.round((Date.now() - new Date(uploadDate).getTime()) / 86400000)
      : null;
    upsertPerformanceMetrics(db, videoId, {
      views,
      likes,
      upload_age_days:   ageDays,
      performance_score: Math.log((views + 1) / Math.max(channelSize, 1)),
    });
  }

  const simResult = await processEmbeddingAndSearch(videoId, title, title, niche);
  const ensemble  = await buildEnsemble({
    peer_context_score: simResult.peer_context_score,
    matches_count:      simResult.matches.length,
    features,
  });

  upsertPrediction(db, videoId, {
    ml_score:         ensemble.ml_score,
    similarity_score: simResult.peer_context_score,
    final_score:      ensemble.final_score,
    confidence:       ensemble.confidence,
    ensemble_weights: ensemble.ensemble_weights,
  });

  return { simResult, ensemble, features };
}

function buildResponse(base, scoreData, dataSource, freshness, lastUpdatedAt) {
  const { simResult, ensemble } = scoreData;
  return {
    ...base,
    final_score:        ensemble.final_score,
    ml_score:           ensemble.ml_score,
    rule_based_score:   ensemble.rule_based_score,
    peer_context_score: simResult.peer_context_score,
    peer_count:         simResult.peer_count,
    similar_videos:     simResult.matches,
    scoring_source:     ensemble.scoring_source,
    confidence:         ensemble.confidence,
    low_confidence:     simResult.low_confidence,
    data_source:        dataSource,
    freshness,
    last_updated_at:    lastUpdatedAt,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/lookup
 * Body: { url, niche? }
 */
router.post('/lookup', async (req, res) => {
  const { url, niche = 'general' } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const ytId = extractVideoId(url);
  if (!ytId) return res.status(400).json({ error: 'Could not extract YouTube video ID from URL' });

  counters.total++;
  const db = getDb();
  const now = new Date().toISOString();

  // ── 1. DB-first lookup ───────────────────────────────────────────────────────
  const existing = getVideoByYouTubeId(db, ytId);

  if (existing) {
    counters.db_hits++;
    const stale = isStale(existing.last_updated_at, existing.upload_date);

    // ── 2. Lazy refresh if stale ───────────────────────────────────────────────
    if (stale && quotaAvailable()) {
      try {
        const yt           = await fetchVideoFull(ytId);
        const channelStats = await fetchChannelStatsBatch([yt.channelId]);
        const channelSize  = channelStats.get(yt.channelId) ?? existing.channel_size;

        recordUsage(2, 'refresh');
        counters.refreshes++;

        updateVideoMeta(db, existing.id, { title: yt.title, channel_size: channelSize, last_updated_at: now });

        const scoreData = await scoreDbVideo(
          existing.id, yt.title, existing.niche, channelSize,
          yt.views, yt.likes, existing.upload_date,
        );

        return res.json(buildResponse(
          { video_id: existing.id, youtube_video_id: ytId, title: yt.title, views: yt.views, channel_size: channelSize, niche: existing.niche, upload_date: existing.upload_date },
          scoreData, 'db_refreshed', 'refreshed', now,
        ));
      } catch (e) {
        console.warn('[lookup] Refresh failed, serving stale data:', e.message);
      }
    }

    // ── Serve from DB (fresh or stale-no-quota) ───────────────────────────────
    const scoreData = await scoreDbVideo(
      existing.id, existing.title, existing.niche, existing.channel_size,
      existing.views ?? 0, existing.likes ?? 0, existing.upload_date,
    );

    return res.json(buildResponse(
      { video_id: existing.id, youtube_video_id: ytId, title: existing.title, views: existing.views, channel_size: existing.channel_size, niche: existing.niche, upload_date: existing.upload_date },
      scoreData, 'db', stale ? 'stale' : 'fresh', existing.last_updated_at,
    ));
  }

  // ── 3. Cache miss ─────────────────────────────────────────────────────────────
  if (!quotaAvailable()) {
    return res.status(503).json({
      error: 'Video not in database and API quota is exhausted. Please enter the title manually.',
      fallback_mode: true,
      youtube_video_id: ytId,
    });
  }

  try {
    const yt           = await fetchVideoFull(ytId);
    const channelStats = await fetchChannelStatsBatch([yt.channelId]);
    const channelSize  = channelStats.get(yt.channelId) ?? 10000;

    recordUsage(2, 'miss');
    counters.api_calls++;

    const ageDays   = yt.publishedAt
      ? Math.round((Date.now() - new Date(yt.publishedAt).getTime()) / 86400000)
      : null;
    const perfScore = Math.log((yt.views + 1) / Math.max(channelSize, 1));

    const { lastInsertRowid: newId } = insertVideo(db, {
      title: yt.title, hook: yt.title, niche, channel_size: channelSize,
      upload_date: yt.publishedAt, prediction_date: now, wing: 'post',
      youtube_video_id: ytId, last_updated_at: now,
    });

    upsertPerformanceMetrics(db, newId, {
      views: yt.views, likes: yt.likes,
      upload_age_days: ageDays, performance_score: perfScore,
    });

    const scoreData = await scoreDbVideo(
      newId, yt.title, niche, channelSize, yt.views, yt.likes, yt.publishedAt,
    );

    return res.json(buildResponse(
      { video_id: newId, youtube_video_id: ytId, title: yt.title, views: yt.views, channel_size: channelSize, niche, upload_date: yt.publishedAt },
      scoreData, 'api_fresh', 'fresh', now,
    ));

  } catch (e) {
    console.error('[lookup] API fetch failed:', e.message);
    return res.status(502).json({
      error: 'Could not fetch video from YouTube. Please enter the title manually.',
      fallback_mode: true,
      youtube_video_id: ytId,
    });
  }
});

function getLookupCounters() { return { ...counters, db_hit_pct: dbHitPct() }; }

module.exports = router;
module.exports.getLookupCounters = getLookupCounters;
