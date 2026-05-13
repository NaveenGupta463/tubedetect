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

const { classifyHookTypeMulti } = require('../services/hookClassifier');

const router = express.Router();

const SEED_CENTROID_TEXTS = {
  curiosity:      'what happens why nobody knows secret hidden truth revealed real reason behind',
  fear:           'stop avoid danger warning biggest mistake ruining destroying never should',
  authority:      'doctor expert scientist proven research study reveals according science facts',
  controversy:    'controversial debate unpopular opinion wrong everyone disagrees truth exposed',
  transformation: 'before after transformation journey changed completely progress results weeks months',
  tutorial:       'how to learn step guide beginner complete walkthrough tutorial course explained',
  urgency:        'now today immediately before too late last chance hurry urgent this week',
  challenge:      'challenge days week month impossible extreme hardest attempted tried result',
  myth:           'myth reality truth wrong misconception debunked actually really not true',
  reaction:       'react reaction watching first time trying unboxing reviewing response',
  comparison:     'vs versus better worse comparison which best choose between two options',
  list:           'top reasons ways things tips signs facts mistakes habits steps tricks',
  mistake:        'mistake error wrong fail avoid common biggest never make this again',
  secret:         'secret nobody tells hidden truth unknown underground forbidden revealed',
};

function applySemanticBoundary(db, cluster, confidence, source) {
  const benchmark = getSemanticBenchmark(db, cluster);
  const cohesionDecay = benchmark?.cohesion_tier === 'weak'     ? 0.75
                      : benchmark?.cohesion_tier === 'moderate'  ? 0.90
                      : 1.0;
  return {
    cluster,
    confidence:          parseFloat((confidence * cohesionDecay).toFixed(3)),
    benchmark,
    source,
    secondary_archetypes: [],
  };
}

function resolveSemanticCluster(db, title, youtube_video_id) {
  try {
    if (youtube_video_id) {
      const row = db.get(
        `SELECT semantic_cluster, semantic_confidence FROM semantic_embeddings
         WHERE source_id = ? AND source_type = 'title_dna' ORDER BY created_at DESC LIMIT 1`,
        [youtube_video_id],
      );
      if (row?.semantic_cluster) {
        return applySemanticBoundary(db, row.semantic_cluster, row.semantic_confidence ?? 0.4, 'corpus');
      }
    }
    const cls = classifyHookTypeMulti(title);
    if (cls.primary_hook && cls.primary_hook !== 'unknown') {
      const conf = parseFloat(((cls.probabilities?.[cls.primary_hook] ?? 0.4) * 0.7).toFixed(3));
      return applySemanticBoundary(db, cls.primary_hook, conf, 'classifier');
    }
    const tl = title.toLowerCase();
    let best = null, bestScore = 0;
    for (const [cluster, text] of Object.entries(SEED_CENTROID_TEXTS)) {
      const score = text.split(/\s+/).filter(t => t.length > 3).reduce((s, t) => s + (tl.includes(t) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = cluster; }
    }
    if (bestScore > 0) {
      const conf = parseFloat(Math.min(0.28, 0.07 + bestScore * 0.04).toFixed(3));
      return applySemanticBoundary(db, best, conf, 'keyword');
    }
    return null;
  } catch { return null; }
}

function getSemanticBenchmark(db, clusterName) {
  try {
    const row = db.get(
      `SELECT avg_vph, sample_size, confidence AS cluster_confidence, trend_direction,
              cohesion_score, cohesion_tier
       FROM semantic_clusters WHERE cluster_name = ? AND sample_size > 10`,
      [clusterName],
    );
    if (!row) return null;
    return {
      cluster:            clusterName,
      avg_vph:            row.avg_vph,
      sample_size:        row.sample_size,
      cluster_confidence: row.cluster_confidence,
      trend:              row.trend_direction,
      cohesion_score:     row.cohesion_score ?? null,
      cohesion_tier:      row.cohesion_tier  ?? null,
    };
  } catch { return null; }
}

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
    const semantic = resolveSemanticCluster(db, title, youtube_video_id);

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

    // ── NEW PIPELINE PATH (default — disable with USE_LEGACY_PIPELINE=1) ────────
    if (isNewPipelineEnabled()) {
      if (cachedScore && cachedScore._pipeline) {
        // Cache hit on pipeline path — result already has _pipeline shape
        console.log('[analyze][pipeline] cache hit:', cacheKey);
        const { lastInsertRowid: predictionId } = insertPrediction(db, videoId, {
          ml_score:              cachedScore.ml_score,
          similarity_score:      cachedScore.peer_context_score,
          final_score:           cachedScore.final_score,
          confidence:            cachedScore.confidence,
          ensemble_weights:      cachedScore.ensemble_weights ?? {},
          feature_snapshot_json: JSON.stringify(features),
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
            logger.error('SNAPSHOT', `snapshot capture failed predictionId=${predictionId} videoId=${videoId}: ${e.message}`);
          }
        });
        const { ensemble_weights: _ew, ...responseFields } = cachedScore;
        return res.json({
          video_id:      videoId,
          prediction_id: predictionId,
          ...responseFields,
          _pipeline:           { ...cachedScore._pipeline, cached: true },
          cached:              true,
          semantic_cluster:    semantic?.cluster    ?? null,
          semantic_confidence: semantic?.confidence ?? null,
          semantic_benchmark:  semantic?.benchmark  ?? null,
          semantic_source:     semantic?.source     ?? null,
        });
      }

      // Cache miss on pipeline path
      const result = await orchestrator.run({ videoId, title, hook, niche, features, activeEnsembleWeights, activeNicheBiasWeights, semanticCluster: semantic });
      scoreCache.set(cacheKey, result);

      console.log(`[analyze][pipeline] final_score=${result.final_score} confidence=${result._pipeline.confidence.state} peers=${result.peer_count}`);

      const { lastInsertRowid: predictionId } = insertPrediction(db, videoId, {
        ml_score:              result.ml_score,
        similarity_score:      result.peer_context_score,
        final_score:           result.final_score,
        confidence:            result.confidence,
        ensemble_weights:      result.ensemble_weights ?? {},
        feature_snapshot_json: JSON.stringify(features),
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
          logger.error('SNAPSHOT', `snapshot capture failed predictionId=${predictionId} videoId=${videoId}: ${e.message}`);
        }
      });

      const { ensemble_weights: _ew, ...responseFields } = result;
      return res.json({
        video_id:      videoId,
        prediction_id: predictionId,
        ...responseFields,
        cached:              false,
        semantic_cluster:    semantic?.cluster    ?? null,
        semantic_confidence: semantic?.confidence ?? null,
        semantic_benchmark:  semantic?.benchmark  ?? null,
        semantic_source:     semantic?.source     ?? null,
        ...(result.low_confidence && {
          message: 'Accuracy improves as more videos are analyzed in this niche',
        }),
      });
    }

    // ── LEGACY PIPELINE PATH (USE_LEGACY_PIPELINE=1 only) ────────────────────
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
      ml_score:              ensemble.ml_score,
      similarity_score:      simResult.peer_context_score,
      final_score:           ensemble.final_score,
      confidence:            ensemble.confidence,
      ensemble_weights:      ensemble.ensemble_weights,
      feature_snapshot_json: JSON.stringify(features),
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
        logger.error('SNAPSHOT', `snapshot capture failed predictionId=${predictionId} videoId=${videoId}: ${e.message}`);
      }
    });

    res.json({
      video_id:            videoId,
      prediction_id:       predictionId,
      final_score:         ensemble.final_score,
      ml_score:            ensemble.ml_score,
      rule_based_score:    ensemble.rule_based_score,
      peer_context_score:  simResult.peer_context_score,
      peer_count:          simResult.peer_count,
      confidence:          ensemble.confidence,
      scoring_source:      ensemble.scoring_source,
      similar_videos:      simResult.matches,
      data_source:         simResult.source,
      degraded_mode:       ensemble.degraded_mode,
      low_confidence:      simResult.low_confidence,
      cached:              !!cachedScore,
      semantic_cluster:    semantic?.cluster    ?? null,
      semantic_confidence: semantic?.confidence ?? null,
      semantic_benchmark:  semantic?.benchmark  ?? null,
      semantic_source:     semantic?.source     ?? null,
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
