'use strict';

const path       = require('path');
const fs         = require('fs');
const { execSync } = require('child_process');
const { isSemanticScoringEnabled } = require('../pipeline/flags');

const ML_MODEL_PATH  = path.join(__dirname, '../../ml/models/model.pkl');
const PREDICT_SCRIPT = path.join(__dirname, '../../ml/predict.py');

// Probe ML availability once at startup with a short timeout.
// Caches the result so per-prediction calls never re-probe.
let _mlAvailable = null;
function modelExists() {
  if (_mlAvailable !== null) return _mlAvailable;
  if (!fs.existsSync(ML_MODEL_PATH)) { _mlAvailable = false; return false; }
  try {
    execSync(`python "${PREDICT_SCRIPT}"`, {
      input: JSON.stringify({ title_length: 0, hook_length: 0, curiosity_score: 0, urgency_score: 0, specificity_score: 0, power_word_score: 0, sentiment_score: 0, niche_encoded: 0, channel_size_log: 0 }),
      timeout: 5000,
      encoding: 'utf8',
    });
    _mlAvailable = true;
  } catch (_) {
    console.warn('[Ensemble] ML probe failed — disabling ML scoring for this session');
    _mlAvailable = false;
  }
  return _mlAvailable;
}

function runMLPredict(features) {
  try {
    const input  = JSON.stringify(features);
    const stdout = execSync(`python "${PREDICT_SCRIPT}"`, {
      input,
      timeout: 5000,
      encoding: 'utf8',
    });
    const result = JSON.parse(stdout.trim());
    if (typeof result.ml_score !== 'number') return null;
    return Math.max(0, Math.min(100, result.ml_score));
  } catch (e) {
    _mlAvailable = false;
    console.warn('[Ensemble] ML predict error — disabling for session:', e.code ?? e.message);
    return null;
  }
}

/**
 * Rule-based score derived purely from extracted features.
 * Used as cold-start fallback when no ML model and no performance peers exist.
 */
function ruleBasedScore(features) {
  let score = 50;
  score += (features.curiosity_score    ?? 0) * 2;  // 0–20
  score += (features.urgency_score      ?? 0) * 1;  // 0–10
  score += (features.specificity_score  ?? 0) * 3;  // 0–9
  score += (features.power_word_score   ?? 0) * 1;  // 0–10
  score += (features.has_number         ?? 0) * 5;  // 0–5
  if (features.hook_question_present)  score += 5;

  const tl   = features.title_length ?? 50;
  if (tl < 30) score -= 10;
  if (tl > 70) score -= 5;

  const sent = features.sentiment_score ?? 0;
  if (sent > 0) score += 3;
  if (sent < 0) score -= 5;

  return parseFloat(Math.max(0, Math.min(100, score)).toFixed(2));
}

/**
 * Build final ensemble score — no LLM dependency.
 *
 * Priority:
 *   ml + peers  → ml*0.6 + peer_context*0.4
 *   ml only     → ml*0.8
 *   peers only  → peer_context*0.7
 *   cold start  → rule_based
 *
 * @param {object} p
 * @param {number|null}  p.peer_context_score     avg normalized perf of top-5 peers (0–100)
 * @param {number}       p.matches_count
 * @param {object}       p.features
 * @param {object|null}  p.activeWeights           DB-sourced weight overrides
 * @param {object|null}  p.semanticClusterSignal   { cluster, confidence, cluster_avg_vph, sample_size }
 */
async function buildEnsemble({ peer_context_score, matches_count, features, activeWeights, semanticClusterSignal = null }) {
  const ml_score = modelExists() ? runMLPredict(features) : null;
  const rb_score = ruleBasedScore(features);

  if (!activeWeights) {
    console.warn('[Ensemble] No active DB weights found — using hardcoded fallback ratios (0.6/0.4).');
  }

  let confidence = Math.min(1.0, (matches_count ?? 0) / 10);
  if (ml_score !== null) confidence = Math.min(1.0, confidence + 0.2);

  let final_score, ensemble_weights, scoring_source;

  if (ml_score !== null && peer_context_score !== null) {
    const mlW        = activeWeights?.ml          ?? 0.6;
    const pcW        = activeWeights?.peer_context ?? 0.4;
    final_score      = ml_score * mlW + peer_context_score * pcW;
    ensemble_weights = { ml: mlW, peer_context: pcW };
    scoring_source   = 'ml_and_peers';
  } else if (ml_score !== null) {
    final_score      = ml_score * 0.8;
    ensemble_weights = { ml: 0.8, peer_context: 0 };
    scoring_source   = 'ml_only';
  } else if (peer_context_score !== null) {
    final_score      = peer_context_score * 0.7;
    ensemble_weights = { ml: 0, peer_context: 0.7 };
    scoring_source   = 'peers_only';
  } else {
    final_score      = rb_score;
    ensemble_weights = { rule_based: 1.0 };
    scoring_source   = 'rule_based';
  }

  final_score = parseFloat(Math.max(0, Math.min(100, final_score)).toFixed(2));

  // ── Semantic cluster prior (dampened additive, max ±5 pts) ────────────────
  // Gated by: SEMANTIC_SCORING_ENABLED=1, confidence >= 0.3, sample_size >= 15,
  // non-degraded mode, and cluster_avg_vph present.
  let clusterAdj = 0;
  if (
    isSemanticScoringEnabled() &&
    scoring_source !== 'rule_based' &&
    semanticClusterSignal?.cluster_avg_vph != null &&
    (semanticClusterSignal?.confidence ?? 0) >= 0.3 &&
    (semanticClusterSignal?.sample_size ?? 0) >= 15
  ) {
    // Logistic-ish normalization: avg_vph=30 → score=50 (neutral).
    // Higher VPH clusters add a small positive signal; low-VPH clusters subtract.
    // Scaled by cohesion_score (Phase 5): weak topology dampens the prior.
    const avgVph              = semanticClusterSignal.cluster_avg_vph;
    const normalizedCluster   = (avgVph / (avgVph + 30)) * 100;
    const cohesionFactor      = semanticClusterSignal.cohesion_score != null
      ? Math.max(0.3, semanticClusterSignal.cohesion_score)
      : 1.0;
    const rawAdj              = (normalizedCluster - 50) * semanticClusterSignal.confidence * 0.10 * cohesionFactor;
    clusterAdj                = parseFloat(Math.max(-5, Math.min(5, rawAdj)).toFixed(3));
    final_score               = parseFloat(Math.max(0, Math.min(100, final_score + clusterAdj)).toFixed(2));
    ensemble_weights          = { ...ensemble_weights, cluster_signal: parseFloat((semanticClusterSignal.confidence * 0.10).toFixed(3)) };
  }

  return {
    final_score,
    ml_score,
    rule_based_score:  rb_score,
    confidence:        parseFloat(confidence.toFixed(3)),
    ensemble_weights,
    scoring_source,
    degraded_mode:     scoring_source === 'rule_based',
    cluster_adjustment: clusterAdj,
  };
}

module.exports = { buildEnsemble, modelExists, ruleBasedScore };
