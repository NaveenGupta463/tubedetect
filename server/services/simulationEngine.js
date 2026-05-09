const MIN_SAMPLE = 10;

function parseWeights(json) {
  return typeof json === 'string' ? JSON.parse(json) : (json ?? {});
}

function computeMetrics(errors) {
  if (!errors.length) return null;
  const n             = errors.length;
  const mae           = errors.reduce((s, e) => s + Math.abs(e), 0) / n;
  const accurateCount = errors.filter(e => Math.abs(e) <= 10).length;
  const overCount     = errors.filter(e => e > 10).length;
  const underCount    = errors.filter(e => e < -10).length;
  return {
    mae:                  parseFloat(mae.toFixed(2)),
    accurate_pct:         parseFloat((accurateCount / n).toFixed(3)),
    overprediction_rate:  parseFloat((overCount    / n).toFixed(3)),
    underprediction_rate: parseFloat((underCount   / n).toFixed(3)),
    sample_size: n,
  };
}

function buildNicheBreakdown(rows, baselineErrors, candidateErrors) {
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    const niche = rows[i].niche ?? 'unknown';
    if (!map[niche]) map[niche] = { b: [], c: [] };
    map[niche].b.push(baselineErrors[i]);
    map[niche].c.push(candidateErrors[i]);
  }
  return Object.entries(map).map(([niche, { b, c }]) => {
    const bMae  = b.reduce((s, e) => s + Math.abs(e), 0) / b.length;
    const cMae  = c.reduce((s, e) => s + Math.abs(e), 0) / c.length;
    const delta = parseFloat((cMae - bMae).toFixed(2));
    return {
      niche,
      baseline_mae:  parseFloat(bMae.toFixed(2)),
      candidate_mae: parseFloat(cMae.toFixed(2)),
      delta,
      improvement: delta < 0,
    };
  }).sort((a, b) => a.delta - b.delta);
}

function runSimulation(rows, candidateVersion) {
  if (!rows || rows.length < MIN_SAMPLE) {
    throw new Error(`Insufficient data: need at least ${MIN_SAMPLE} eligible rows, got ${rows?.length ?? 0}`);
  }

  const weights = parseWeights(candidateVersion.weights_json);
  let baselineErrors, candidateErrors;

  if (candidateVersion.version_type === 'ensemble_weights') {
    const wMl   = weights.ml           ?? 0.6;
    const wPeer = weights.peer_context ?? 0.4;
    const total = wMl + wPeer;
    const nMl   = total > 0 ? wMl   / total : 0.6;
    const nPeer = total > 0 ? wPeer / total : 0.4;

    baselineErrors  = rows.map(r => r.calibration_error);
    candidateErrors = rows.map(r =>
      (r.ml_score * nMl + r.similarity_score * nPeer) - r.actual_performance_score
    );
  } else if (candidateVersion.version_type === 'niche_bias') {
    baselineErrors  = rows.map(r => r.calibration_error);
    candidateErrors = rows.map(r => {
      const niche = (r.niche ?? 'unknown').toLowerCase().trim();
      return (r.predicted_score + (weights[niche] ?? 0)) - r.actual_performance_score;
    });
  } else {
    throw new Error(`Unknown version_type: ${candidateVersion.version_type}`);
  }

  return {
    baseline_metrics:  computeMetrics(baselineErrors),
    candidate_metrics: computeMetrics(candidateErrors),
    niche_breakdown:   buildNicheBreakdown(rows, baselineErrors, candidateErrors),
  };
}

module.exports = { runSimulation };
