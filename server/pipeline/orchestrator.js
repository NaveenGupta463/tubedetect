'use strict';

const { processEmbeddingAndSearch } = require('../services/similarityEngine');
const { buildEnsemble }             = require('../services/ensembleScoring');
const { buildConfidence }           = require('./confidence');
const { calibrateScore }            = require('./calibration');
const { buildRecommendation }       = require('./recommendation');
const { createTrace }               = require('./tracing');
const { isSemanticScoringEnabled }  = require('./flags');
const { getDb }                     = require('../db/init');
const logger                        = require('../utils/logger');

// Minimum corpus size before semantic parallel lookup is attempted.
const SEMANTIC_COVERAGE_THRESHOLD = 100;

// ── In-memory stats (reset on restart) ────────────────────────────────────────
const _stats = {
  requestCount:        0,
  degradedCount:       0,
  lastTimings:         null,
  lastConfidenceState: null,
};

// ── Semantic parallel corpus lookup ───────────────────────────────────────────
// Synchronous DB query — no new API calls.
// Returns cluster-level corpus statistics alongside the scoring request
// for side-by-side comparison during the parallel-run validation period.
function runSemanticParallelLookup(db, semanticCluster) {
  try {
    const coverage = db.get(
      'SELECT COUNT(*) as cnt FROM semantic_embeddings WHERE source_type = ?',
      ['title_dna'],
    );
    const corpusSize = coverage?.cnt ?? 0;

    if (corpusSize < SEMANTIC_COVERAGE_THRESHOLD) {
      return {
        source:           'user_pool',
        corpus_pool_size: corpusSize,
        below_threshold:  true,
      };
    }

    const result = {
      source:           'user_pool_with_semantic_parallel',
      corpus_pool_size: corpusSize,
    };

    if (semanticCluster?.cluster) {
      const clusterSample = db.all(
        `SELECT iv.title, vgs.views_per_hour
         FROM semantic_embeddings se
         JOIN ingested_videos iv ON se.source_id = iv.youtube_video_id
         LEFT JOIN video_growth_snapshots vgs
           ON vgs.video_id = se.source_id AND vgs.views_per_hour > 0
         WHERE se.semantic_cluster = ? AND se.source_type = 'title_dna'
         ORDER BY COALESCE(vgs.views_per_hour, 0) DESC
         LIMIT 5`,
        [semanticCluster.cluster],
      );
      const vphs = clusterSample.filter(v => v.views_per_hour).map(v => v.views_per_hour);
      result.cluster         = semanticCluster.cluster;
      result.cluster_sample  = clusterSample;
      result.avg_cluster_vph = vphs.length > 0
        ? parseFloat((vphs.reduce((s, v) => s + v, 0) / vphs.length).toFixed(2))
        : null;
    }

    return result;
  } catch { return null; }
}

// ── run ────────────────────────────────────────────────────────────────────────
/**
 * Run the scoring pipeline for a video that has already been inserted into the DB.
 * Feature extraction and all DB writes remain the caller's responsibility.
 *
 * @param {{ videoId, title, hook, niche, features, activeEnsembleWeights,
 *           activeNicheBiasWeights, semanticCluster? }} params
 *   semanticCluster: result of resolveSemanticCluster() — { cluster, confidence,
 *                    benchmark, source } — optional, safe to omit
 * @returns {Promise<Object>} Scoring fields plus _pipeline metadata.
 */
async function run({
  videoId, title, hook, niche,
  features,
  activeEnsembleWeights,
  activeNicheBiasWeights,
  semanticCluster = null,
}) {
  const requestId     = `${videoId}-${Date.now()}`;
  const trace         = createTrace(requestId);
  const pipelineStart = Date.now();

  const db = getDb();

  let simResult, ensemble;

  // ── Stage 1: Similarity search ─────────────────────────────────────────────
  trace.startStage('similarity');
  try {
    simResult = await processEmbeddingAndSearch(videoId, title, hook, niche);
    trace.endStage('similarity', { peerCount: simResult.peer_count });
  } catch (e) {
    trace.fail('similarity', e);
    logger.warn('PIPELINE', `Similarity failed, using empty result: ${e.message}`);
    simResult = { matches: [], peer_context_score: null, peer_count: 0, source: 'none', low_confidence: true };
    trace.warn('similarity stage fell back to empty result');
  }

  // ── Stage 1b: Semantic parallel corpus lookup (observability) ─────────────
  // Synchronous, no API calls. Compares corpus knowledge against current request.
  trace.startStage('semantic_parallel');
  const semanticParallel = runSemanticParallelLookup(db, semanticCluster);
  trace.endStage('semantic_parallel', {
    source:      semanticParallel?.source ?? 'skipped',
    corpusSize:  semanticParallel?.corpus_pool_size ?? 0,
  });

  // ── Stage 2: Ensemble scoring + optional semantic cluster prior ────────────
  trace.startStage('ensemble');
  const semanticClusterSignal = (semanticCluster?.benchmark?.avg_vph != null)
    ? {
        cluster:         semanticCluster.cluster,
        confidence:      semanticCluster.confidence ?? 0,
        cluster_avg_vph: semanticCluster.benchmark.avg_vph,
        sample_size:     semanticCluster.benchmark.sample_size ?? 0,
        cohesion_score:  semanticCluster.benchmark.cohesion_score ?? null,
        cohesion_tier:   semanticCluster.benchmark.cohesion_tier  ?? null,
      }
    : null;

  try {
    ensemble = await buildEnsemble({
      peer_context_score: simResult.peer_context_score,
      matches_count:      simResult.matches.length,
      features,
      activeWeights:       activeEnsembleWeights,
      semanticClusterSignal,
    });
    trace.endStage('ensemble', {
      finalScore:      ensemble.final_score,
      source:          ensemble.scoring_source,
      clusterAdj:      ensemble.cluster_adjustment,
    });
  } catch (e) {
    trace.fail('ensemble', e);
    logger.warn('PIPELINE', `Ensemble failed, using degraded defaults: ${e.message}`);
    ensemble = {
      final_score: 50, ml_score: null, rule_based_score: 50,
      confidence: 0, ensemble_weights: {}, scoring_source: 'rule_based',
      degraded_mode: true, cluster_adjustment: 0,
    };
    trace.warn('ensemble stage fell back to degraded defaults');
  }

  // ── Stage 3: Confidence normalization + semantic annotations ──────────────
  trace.startStage('confidence');
  const semanticSignals = semanticCluster
    ? {
        semantic_confidence:  semanticCluster.confidence ?? 0,
        resolution_path:      semanticCluster.source     ?? null,
        cluster_sample_size:  semanticCluster.benchmark?.sample_size ?? null,
      }
    : null;

  const confidence = buildConfidence({ ensemble, simResult, semanticSignals });
  trace.endStage('confidence', { state: confidence.state });

  if (confidence.degraded) {
    _stats.degradedCount++;
    trace.warn(`confidence degraded: ${confidence.reasons.join('; ')}`);
  }

  // ── Stage 4: Calibration ───────────────────────────────────────────────────
  trace.startStage('calibration');
  const calibration = calibrateScore(ensemble.final_score, {
    niche,
    confidence,
    nicheBiasWeights: activeNicheBiasWeights,
  });
  trace.endStage('calibration', { version: calibration.calibrationVersion });

  // ── Stage 5: Recommendation ────────────────────────────────────────────────
  trace.startStage('recommendation');
  const recommendation = buildRecommendation(calibration.adjustedScore, confidence.state);
  trace.endStage('recommendation', { priority: recommendation.priority });

  const totalDuration = Date.now() - pipelineStart;

  // ── Update in-memory stats ─────────────────────────────────────────────────
  _stats.requestCount++;
  _stats.lastConfidenceState = confidence.state;
  _stats.lastTimings = { ...trace.serialize().timings, total: totalDuration };

  logger.info(
    'PIPELINE',
    `[${requestId}] ${totalDuration}ms — score=${calibration.adjustedScore} ` +
    `confidence=${confidence.state} cluster=${semanticCluster?.cluster ?? 'none'} ` +
    `clusterAdj=${ensemble.cluster_adjustment ?? 0}`,
  );

  // ── Return scoring fields + full _pipeline observability ──────────────────
  return {
    final_score:        calibration.adjustedScore,
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
    ensemble_weights:   ensemble.ensemble_weights,

    _pipeline: {
      confidence,
      trace:          trace.serialize(),
      calibration,
      recommendation,

      // Phase 6: Full observability
      embedding: {
        source:           semanticParallel?.source ?? 'user_pool',
        pool_size:        simResult.peer_count,
        corpus_pool_size: semanticParallel?.corpus_pool_size ?? null,
        below_threshold:  semanticParallel?.below_threshold ?? null,
        // Cluster-level corpus sample (parallel run data — not used for scoring)
        semantic_parallel_cluster:   semanticParallel?.cluster         ?? null,
        semantic_parallel_avg_vph:   semanticParallel?.avg_cluster_vph ?? null,
        semantic_parallel_sample:    semanticParallel?.cluster_sample   ?? null,
      },

      semantic: {
        cluster:                 semanticCluster?.cluster               ?? null,
        confidence:              semanticCluster?.confidence            ?? null,
        resolution_path:         semanticCluster?.source                ?? null,
        cluster_avg_vph:         semanticCluster?.benchmark?.avg_vph    ?? null,
        cluster_sample_size:     semanticCluster?.benchmark?.sample_size ?? null,
        cluster_trend:           semanticCluster?.benchmark?.trend       ?? null,
        signal_weight:           semanticClusterSignal
                                   ? parseFloat((semanticClusterSignal.confidence * 0.10).toFixed(3))
                                   : 0,
        cluster_adjustment:      ensemble.cluster_adjustment ?? 0,
        cluster_scoring_enabled: isSemanticScoringEnabled(),
      },

      weights: {
        source:           activeEnsembleWeights ? 'db' : 'hardcoded_fallback',
        ensemble_weights: activeEnsembleWeights ?? null,
      },
    },
  };
}

function getPipelineStats() {
  return {
    enabled:             true,
    requestCount:        _stats.requestCount,
    degradedCount:       _stats.degradedCount,
    lastConfidenceState: _stats.lastConfidenceState,
    lastTimings:         _stats.lastTimings,
  };
}

module.exports = { run, getPipelineStats };
