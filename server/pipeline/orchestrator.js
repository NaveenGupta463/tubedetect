const { processEmbeddingAndSearch } = require('../services/similarityEngine');
const { buildEnsemble }             = require('../services/ensembleScoring');
const { buildConfidence }           = require('./confidence');
const { calibrateScore }            = require('./calibration');
const { buildRecommendation }       = require('./recommendation');
const { createTrace }               = require('./tracing');
const logger                        = require('../utils/logger');

// ── In-memory stats (reset on restart) ────────────────────────────────────────
const _stats = {
  requestCount:       0,
  degradedCount:      0,
  lastTimings:        null,
  lastConfidenceState: null,
};

/**
 * Run the scoring pipeline for a video that has already been inserted into the DB.
 * Feature extraction and all DB writes remain the caller's responsibility.
 *
 * @param {{ videoId, title, hook, niche, features }} params
 * @returns {Promise<Object>} Same scoring fields analyze.js assembles, plus _pipeline metadata.
 */
async function run({ videoId, title, hook, niche, features }) {
  const requestId = `${videoId}-${Date.now()}`;
  const trace     = createTrace(requestId);
  const pipelineStart = Date.now();

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

  // ── Stage 2: Ensemble scoring ──────────────────────────────────────────────
  trace.startStage('ensemble');
  try {
    ensemble = await buildEnsemble({
      peer_context_score: simResult.peer_context_score,
      matches_count:      simResult.matches.length,
      features,
    });
    trace.endStage('ensemble', { finalScore: ensemble.final_score, source: ensemble.scoring_source });
  } catch (e) {
    trace.fail('ensemble', e);
    logger.warn('PIPELINE', `Ensemble failed, using degraded defaults: ${e.message}`);
    ensemble = { final_score: 50, ml_score: null, rule_based_score: 50, confidence: 0, ensemble_weights: {}, scoring_source: 'rule_based', degraded_mode: true };
    trace.warn('ensemble stage fell back to degraded defaults');
  }

  // ── Stage 3: Confidence normalization ─────────────────────────────────────
  trace.startStage('confidence');
  const confidence = buildConfidence({ ensemble, simResult });
  trace.endStage('confidence', { state: confidence.state });

  if (confidence.degraded) {
    _stats.degradedCount++;
    trace.warn(`confidence degraded: ${confidence.reasons.join('; ')}`);
  }

  // ── Stage 4: Calibration (stub) ────────────────────────────────────────────
  trace.startStage('calibration');
  const calibration = calibrateScore(ensemble.final_score, { niche, confidence });
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

  logger.info('PIPELINE', `[${requestId}] completed in ${totalDuration}ms — score=${calibration.adjustedScore} confidence=${confidence.state}`);

  // ── Return same shape analyze.js currently assembles, plus _pipeline ───────
  // ensemble_weights is NOT sent in the HTTP response — only used by the route
  // for insertPrediction. _pipeline fields are additive / non-stable contract.
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
