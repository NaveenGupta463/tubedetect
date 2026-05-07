function buildConfidence({ ensemble, simResult }) {
  const reasons  = [];
  const warnings = [];

  // ── Degraded detection (takes priority over all states) ───────────────────
  const isDegraded =
    ensemble.degraded_mode === true ||
    simResult.peer_count === 0 ||
    simResult.source === 'none';

  if (ensemble.degraded_mode)       reasons.push('ensemble ran in degraded mode');
  if (simResult.peer_count === 0)   reasons.push('no peer videos found for similarity');
  if (simResult.source === 'none')  reasons.push('similarity search returned no results');

  if (isDegraded) {
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
