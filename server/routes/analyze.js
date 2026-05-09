const express  = require('express');
const { getDb }                    = require('../db/init');
const { extractFeatures }          = require('../services/featureExtraction');
const { processEmbeddingAndSearch } = require('../services/similarityEngine');
const { buildEnsemble }            = require('../services/ensembleScoring');
const {
  insertVideo, upsertFeatures, upsertPerformanceMetrics,
  insertPerformanceMetricsPlaceholder, insertPrediction,
  insertPredictionFeedbackSnapshot,
  getActiveScoringVersionByType,
} = require('../db/queries');
const orchestrator             = require('../pipeline/orchestrator');
const { isNewPipelineEnabled } = require('../pipeline/flags');
const { capturePrediction }    = require('../services/outcomeTracker');
const scoreCache               = require('../services/scoreCache');
const logger                   = require('../utils/logger');

const router = express.Router();

function readActiveWeights(db) {
  try {
    const ensembleVersion  = getActiveScoringVersionByType(db, 'ensemble_weights');
    const nicheBiasVersion = getActiveScoringVersionByType(db, 'niche_bias');
    return {
      activeEnsembleWeights:  ensembleVersion  ? JSON.parse(ensembleVersion.weights_json)  : null,
      activeNicheBiasWeights: nicheBiasVersion ? JSON.parse(nicheBiasVersion.weights_json) : null,
    };
  } catch {
    return { activeEnsembleWeights: null, activeNicheBiasWeights: null };
  }
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
      duration_seconds,
    } = req.body;

    if (!title || !hook || !niche || !channel_size || !wing) {
      return res.status(400).json({ error: 'title, hook, niche, channel_size, and wing are required' });
    }
    if (!['pre', 'post'].includes(wing)) {
      return res.status(400).json({ error: 'wing must be "pre" or "post"' });
    }

    const db = getDb();
    const now = new Date().toISOString();

    // 1. Read adaptive scoring weights (before cache key construction)
    const { activeEnsembleWeights, activeNicheBiasWeights } = readActiveWeights(db);

    // 2. Insert video row
    const { lastInsertRowid: videoId } = insertVideo(db, {
      title, hook, niche, channel_size,
      upload_date:     wing === 'post' ? now : null,
      prediction_date: now,
      wing,
      youtube_video_id,
      duration_seconds: duration_seconds ?? null,
    });

    // 3. Extract and store features
    const features = extractFeatures({ title, hook, niche, lastUploadDate: last_upload_date });
    upsertFeatures(db, videoId, features);

    // 4. Performance metrics row
    const hasPerformanceData = views != null && upload_age_days != null && upload_age_days > 0;

    if (hasPerformanceData) {
      const perfScore = Math.log((views + 1) / Math.max(channel_size, 1));
      upsertPerformanceMetrics(db, videoId, { views, likes, upload_age_days, performance_score: perfScore });
      console.log(`[analyze] performance_score=${perfScore.toFixed(4)} | training_ready=1`);
    } else if (wing === 'post') {
      insertPerformanceMetricsPlaceholder(db, videoId);
    }

    // 5. Check score cache — version-stamped key auto-invalidates on weight changes
    const cacheKey    = scoreCache.makeKey(title, hook, niche);
    const cachedScore = scoreCache.get(cacheKey);

    // ── NEW PIPELINE PATH (USE_NEW_PIPELINE=1) ────────────────────────────────
    if (isNewPipelineEnabled()) {
      if (cachedScore && cachedScore._pipeline) {
        // Cache hit on pipeline path — result already has _pipeline shape
        console.log('[analyze][pipeline] cache hit:', cacheKey);
        const { lastInsertRowid: predictionId } = insertPrediction(db, videoId, {
          ml_score:         cachedScore.ml_score,
          similarity_score: cachedScore.peer_context_score,
          final_score:      cachedScore.final_score,
          confidence:       cachedScore.confidence,
          ensemble_weights: cachedScore.ensemble_weights ?? {},
        });
        setImmediate(() => {
          try {
            const snap = capturePrediction({
              predictionId,
              videoId,
              final_score:      cachedScore.final_score,
              confidence_state: cachedScore._pipeline.confidence.state,
              predicted_state:  cachedScore._pipeline.recommendation?.priority ?? null,
              degraded_mode:    cachedScore.degraded_mode ?? false,
              warnings:         cachedScore._pipeline.confidence.warnings ?? [],
              pipeline_version: 'pipeline_v1',
              predicted_at:     now,
            });
            insertPredictionFeedbackSnapshot(db, snap);
          } catch (e) {
            logger.error('SNAPSHOT', `capturePrediction failed: ${e.message}`);
          }
        });
        const { ensemble_weights: _ew, ...responseFields } = cachedScore;
        return res.json({
          video_id:      videoId,
          prediction_id: predictionId,
          ...responseFields,
          _pipeline: { ...cachedScore._pipeline, cached: true },
          cached: true,
        });
      }

      // Cache miss on pipeline path
      const result = await orchestrator.run({ videoId, title, hook, niche, features, activeEnsembleWeights, activeNicheBiasWeights });
      scoreCache.set(cacheKey, result);

      console.log(`[analyze][pipeline] final_score=${result.final_score} confidence=${result._pipeline.confidence.state} peers=${result.peer_count}`);

      const { lastInsertRowid: predictionId } = insertPrediction(db, videoId, {
        ml_score:         result.ml_score,
        similarity_score: result.peer_context_score,
        final_score:      result.final_score,
        confidence:       result.confidence,
        ensemble_weights: result.ensemble_weights ?? {},
      });

      setImmediate(() => {
        try {
          const snap = capturePrediction({
            predictionId,
            videoId,
            final_score:      result.final_score,
            confidence_state: result._pipeline.confidence.state,
            predicted_state:  result._pipeline.recommendation?.priority ?? null,
            degraded_mode:    result.degraded_mode ?? false,
            warnings:         result._pipeline.confidence.warnings ?? [],
            pipeline_version: 'pipeline_v1',
            predicted_at:     now,
          });
          insertPredictionFeedbackSnapshot(db, snap);
        } catch (e) {
          logger.error('SNAPSHOT', `capturePrediction failed: ${e.message}`);
        }
      });

      const { ensemble_weights: _ew, ...responseFields } = result;
      return res.json({
        video_id:      videoId,
        prediction_id: predictionId,
        ...responseFields,
        cached: false,
        ...(result.low_confidence && {
          message: 'Accuracy improves as more videos are analyzed in this niche',
        }),
      });
    }

    // ── EXISTING PIPELINE PATH (default) ─────────────────────────────────────
    let simResult, ensemble;

    if (cachedScore) {
      simResult = cachedScore.simResult;
      ensemble  = cachedScore.ensemble;
      console.log('[analyze] cache hit:', cacheKey);
    } else {
      // 6. Similarity + performance peer search
      simResult = { matches: [], peer_context_score: null, peer_count: 0, source: 'none', low_confidence: true };
      try {
        simResult = await processEmbeddingAndSearch(videoId, title, hook, niche);
      } catch (e) {
        console.warn('[analyze] Similarity search failed:', e.message);
      }

      // 7. Ensemble scoring with active DB weights
      ensemble = { final_score: 50, ml_score: null, rule_based_score: 50, confidence: 0, ensemble_weights: {}, scoring_source: 'rule_based', degraded_mode: true };
      try {
        ensemble = await buildEnsemble({
          peer_context_score: simResult.peer_context_score,
          matches_count:      simResult.matches.length,
          features,
          activeWeights: activeEnsembleWeights,
        });
      } catch (e) {
        console.warn('[analyze] Ensemble failed:', e.message);
      }

      // 8. Apply niche bias (legacy path — calibration.js is orchestrator-only)
      if (activeNicheBiasWeights && niche) {
        const bias = activeNicheBiasWeights[(niche ?? '').toLowerCase().trim()] ?? 0;
        if (bias !== 0) {
          ensemble = {
            ...ensemble,
            final_score: parseFloat(Math.max(0, Math.min(100, ensemble.final_score + bias)).toFixed(2)),
          };
        }
      }

      scoreCache.set(cacheKey, { simResult, ensemble });
    }

    console.log(`[analyze] final_score=${ensemble.final_score} source=${ensemble.scoring_source} peers=${simResult.peer_count} cached=${!!cachedScore}`);

    // 7. Persist prediction
    const { lastInsertRowid: predictionId } = insertPrediction(db, videoId, {
      ml_score:          ensemble.ml_score,
      similarity_score:  simResult.peer_context_score,
      final_score:       ensemble.final_score,
      confidence:        ensemble.confidence,
      ensemble_weights:  ensemble.ensemble_weights,
    });

    setImmediate(() => {
      try {
        const snap = capturePrediction({
          predictionId,
          videoId,
          final_score:      ensemble.final_score,
          confidence_state: null,
          predicted_state:  null,
          degraded_mode:    ensemble.degraded_mode ?? false,
          warnings:         [],
          pipeline_version: 'legacy',
          predicted_at:     now,
        });
        insertPredictionFeedbackSnapshot(db, snap);
      } catch (e) {
        logger.error('SNAPSHOT', `capturePrediction failed: ${e.message}`);
      }
    });

    res.json({
      video_id:           videoId,
      prediction_id:      predictionId,
      final_score:        ensemble.final_score,
      ml_score:           ensemble.ml_score,
      rule_based_score:   ensemble.rule_based_score,
      peer_context_score: simResult.peer_context_score,
      peer_count:         simResult.peer_count,
      confidence:         ensemble.confidence,
      scoring_source:     ensemble.scoring_source,
      similar_videos:     simResult.matches,
      data_source:        simResult.source,
      degraded_mode:      ensemble.degraded_mode,
      low_confidence:     simResult.low_confidence,
      cached:             !!cachedScore,
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
