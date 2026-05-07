const path       = require('path');
const fs         = require('fs');
const { execSync } = require('child_process');

const ML_MODEL_PATH  = path.join(__dirname, '../../ml/models/model.pkl');
const PREDICT_SCRIPT = path.join(__dirname, '../../ml/predict.py');

function modelExists() {
  return fs.existsSync(ML_MODEL_PATH);
}

function runMLPredict(features) {
  try {
    const input  = JSON.stringify(features);
    const stdout = execSync(`python "${PREDICT_SCRIPT}"`, {
      input,
      timeout: 10000,
      encoding: 'utf8',
    });
    const result = JSON.parse(stdout.trim());
    if (typeof result.ml_score !== 'number') return null;
    return Math.max(0, Math.min(100, result.ml_score));
  } catch (e) {
    console.warn('[Ensemble] ML predict error:', e.message);
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
 * @param {number|null} p.peer_context_score  - avg normalized perf of top-5 peers (0–100)
 * @param {number}      p.matches_count
 * @param {object}      p.features
 * @returns {{ final_score, ml_score, rule_based_score, confidence, ensemble_weights, scoring_source, degraded_mode }}
 */
async function buildEnsemble({ peer_context_score, matches_count, features }) {
  const ml_score = modelExists() ? runMLPredict(features) : null;
  const rb_score = ruleBasedScore(features);

  let confidence = Math.min(1.0, (matches_count ?? 0) / 10);
  if (ml_score !== null) confidence = Math.min(1.0, confidence + 0.2);

  let final_score, ensemble_weights, scoring_source;

  if (ml_score !== null && peer_context_score !== null) {
    final_score      = ml_score * 0.6 + peer_context_score * 0.4;
    ensemble_weights = { ml: 0.6, peer_context: 0.4 };
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

  return {
    final_score,
    ml_score,
    rule_based_score: rb_score,
    confidence:       parseFloat(confidence.toFixed(3)),
    ensemble_weights,
    scoring_source,
    degraded_mode:    scoring_source === 'rule_based',
  };
}

module.exports = { buildEnsemble, modelExists, ruleBasedScore };
