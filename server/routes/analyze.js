const express  = require('express');
const crypto   = require('crypto');
const { getDb }                    = require('../db/init');
const { extractFeatures }          = require('../services/featureExtraction');
const { processEmbeddingAndSearch } = require('../services/similarityEngine');
const { buildEnsemble }            = require('../services/ensembleScoring');
const {
  insertVideo, upsertFeatures, upsertPerformanceMetrics,
  insertPerformanceMetricsPlaceholder, insertPrediction,
} = require('../db/queries');

const router = express.Router();

// In-memory score cache: key → { data, ts }
const scoreCache = new Map();
const CACHE_TTL  = 60 * 60 * 1000; // 1 hour

function makeCacheKey(title, hook, niche) {
  return crypto.createHash('md5').update(`${title}|${hook}|${niche}`).digest('hex');
}

function getCached(key) {
  const entry = scoreCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { scoreCache.delete(key); return null; }
  return entry.data;
}

/**
 * POST /api/analyze
 * Body: { title, hook, niche, channel_size, wing, youtube_video_id?, last_upload_date?,
 *         views?, likes?, upload_age_days? }
 *
 * Returns scoring data without calling LLM.
 * For human-readable suggestions call POST /api/explain separately.
 */
router.post('/analyze', async (req, res) => {
  console.log('[analyze] incoming body:', JSON.stringify(req.body));

  try {
    const {
      title, hook, niche, channel_size, wing,
      youtube_video_id, last_upload_date,
      views, likes, upload_age_days,
    } = req.body;

    if (!title || !hook || !niche || !channel_size || !wing) {
      return res.status(400).json({ error: 'title, hook, niche, channel_size, and wing are required' });
    }
    if (!['pre', 'post'].includes(wing)) {
      return res.status(400).json({ error: 'wing must be "pre" or "post"' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    // 1. Insert video row
    const { lastInsertRowid: videoId } = insertVideo(db, {
      title, hook, niche, channel_size,
      upload_date:     wing === 'post' ? now : null,
      prediction_date: now,
      wing,
      youtube_video_id,
    });

    // 2. Extract and store features
    const features = extractFeatures({ title, hook, niche, lastUploadDate: last_upload_date });
    upsertFeatures(db, videoId, features);

    // 3. Performance metrics row
    const hasPerformanceData = views != null && upload_age_days != null && upload_age_days > 0;

    if (hasPerformanceData) {
      const perfScore = Math.log((views + 1) / Math.max(channel_size, 1));
      upsertPerformanceMetrics(db, videoId, { views, likes, upload_age_days, performance_score: perfScore });
      console.log(`[analyze] performance_score=${perfScore.toFixed(4)} | training_ready=1`);
    } else if (wing === 'post') {
      insertPerformanceMetricsPlaceholder(db, videoId);
    }

    // 4. Check score cache (keyed by content — same title/hook/niche gets same score)
    const cacheKey    = makeCacheKey(title, hook, niche);
    const cachedScore = getCached(cacheKey);

    let simResult, ensemble;

    if (cachedScore) {
      simResult = cachedScore.simResult;
      ensemble  = cachedScore.ensemble;
      console.log('[analyze] cache hit:', cacheKey);
    } else {
      // 5. Similarity + performance peer search
      simResult = { matches: [], peer_context_score: null, peer_count: 0, source: 'none', low_confidence: true };
      try {
        simResult = await processEmbeddingAndSearch(videoId, title, hook, niche);
      } catch (e) {
        console.warn('[analyze] Similarity search failed:', e.message);
      }

      // 6. Ensemble scoring (no LLM)
      ensemble = { final_score: 50, ml_score: null, rule_based_score: 50, confidence: 0, ensemble_weights: {}, scoring_source: 'rule_based', degraded_mode: true };
      try {
        ensemble = await buildEnsemble({
          peer_context_score: simResult.peer_context_score,
          matches_count:      simResult.matches.length,
          features,
        });
      } catch (e) {
        console.warn('[analyze] Ensemble failed:', e.message);
      }

      scoreCache.set(cacheKey, { data: { simResult, ensemble }, ts: Date.now() });
    }

    console.log(`[analyze] final_score=${ensemble.final_score} source=${ensemble.scoring_source} peers=${simResult.peer_count} cached=${!!cachedScore}`);

    // 7. Persist prediction
    insertPrediction(db, videoId, {
      ml_score:          ensemble.ml_score,
      similarity_score:  simResult.peer_context_score,
      final_score:       ensemble.final_score,
      confidence:        ensemble.confidence,
      ensemble_weights:  ensemble.ensemble_weights,
    });

    res.json({
      video_id:          videoId,
      final_score:       ensemble.final_score,
      ml_score:          ensemble.ml_score,
      rule_based_score:  ensemble.rule_based_score,
      peer_context_score: simResult.peer_context_score,
      peer_count:        simResult.peer_count,
      confidence:        ensemble.confidence,
      scoring_source:    ensemble.scoring_source,
      similar_videos:    simResult.matches,
      data_source:       simResult.source,
      degraded_mode:     ensemble.degraded_mode,
      low_confidence:    simResult.low_confidence,
      cached:            !!cachedScore,
      ...(simResult.low_confidence && {
        message: 'Accuracy improves as more videos are analyzed in this niche',
      }),
    });

  } catch (err) {
    console.error('[analyze] Unhandled error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

module.exports = router;
