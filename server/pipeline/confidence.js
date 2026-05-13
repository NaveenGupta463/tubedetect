'use strict';

// ── Semantic signal annotations ────────────────────────────────────────────────
// Adds cluster-quality warnings to reasons/warnings arrays.
// Called for all confidence states — never changes the state, only explains it.
function _addSemanticAnnotations(reasons, warnings, semanticSignals) {
  if (!semanticSignals) return;

  const conf = semanticSignals.semantic_confidence ?? null;
  if (conf !== null && conf < 0.3) {
    warnings.push(
      `semantic confidence weak (${Math.round(conf * 100)}%) — cluster priors carry high uncertainty`,
    );
  }

  if (semanticSignals.resolution_path === 'keyword') {
    warnings.push('semantic cluster resolved via keyword fallback — structural similarity not verified');
  }

  const n = semanticSignals.cluster_sample_size ?? null;
  if (n !== null && n > 0 && n < 15) {
    warnings.push(`cluster benchmark drawn from small sample (${n} videos)`);
  }
}

// ── buildConfidence ────────────────────────────────────────────────────────────
//
// @param {{ ensemble, simResult, semanticSignals? }} params
//   semanticSignals: { semantic_confidence, resolution_path, cluster_sample_size }
//
// @returns {{ score, state, reasons, degraded, warnings }}
function buildConfidence({ ensemble, simResult, semanticSignals = null }) {
  const reasons  = [];
  const warnings = [];

  // ── Degraded detection (takes priority) ───────────────────────────────────
  const isDegraded =
    ensemble.degraded_mode === true ||
    simResult.peer_count === 0 ||
    simResult.source === 'none';

  if (ensemble.degraded_mode)       reasons.push('ensemble ran in degraded mode');
  if (simResult.peer_count === 0)   reasons.push('no peer videos found for similarity');
  if (simResult.source === 'none')  reasons.push('similarity search returned no results');

  if (isDegraded) {
    _addSemanticAnnotations(reasons, warnings, semanticSignals);
    return {
      score:    ensemble.confidence ?? 0,
      state:    'degraded',
      reasons,
      degraded: true,
      warnings,
    };
  }

  // ── Low confidence ─────────────────────────────────────────────────────────
  const ensembleConf = ensemble.confidence ?? 0;

  if (simResult.low_confidence) {
    reasons.push('insufficient similar videos in niche for reliable peer scoring');
    warnings.push('accuracy improves as more videos are analyzed in this niche');
  }

  if (ensembleConf < 0.4) {
    reasons.push(`ensemble confidence is low (${(ensembleConf * 100).toFixed(0)}%)`);
  }

  _addSemanticAnnotations(reasons, warnings, semanticSignals);

  const isLow = ensembleConf < 0.4 || simResult.low_confidence === true;
  if (isLow) {
    return {
      score:    ensembleConf,
      state:    'low',
      reasons,
      degraded: false,
      warnings,
    };
  }

  // ── Medium ─────────────────────────────────────────────────────────────────
  if (ensembleConf < 0.7) {
    reasons.push(`ensemble confidence is moderate (${(ensembleConf * 100).toFixed(0)}%)`);
    return {
      score:    ensembleConf,
      state:    'medium',
      reasons,
      degraded: false,
      warnings,
    };
  }

  // ── High ───────────────────────────────────────────────────────────────────
  return {
    score:    ensembleConf,
    state:    'high',
    reasons,
    degraded: false,
    warnings,
  };
}

module.exports = { buildConfidence };
