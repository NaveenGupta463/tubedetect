const MAE_THRESHOLD = 1.0;
const MIN_SAMPLE    = 10;

function computeMetricDelta(baseline, candidate) {
  return {
    mae:                  parseFloat((candidate.mae - baseline.mae).toFixed(2)),
    accurate_pct:         parseFloat((candidate.accurate_pct - baseline.accurate_pct).toFixed(3)),
    overprediction_rate:  parseFloat((candidate.overprediction_rate - baseline.overprediction_rate).toFixed(3)),
    underprediction_rate: parseFloat((candidate.underprediction_rate - baseline.underprediction_rate).toFixed(3)),
  };
}

function determineWinner(baseline, candidate) {
  if ((candidate.sample_size ?? 0) < MIN_SAMPLE) return 'inconclusive';
  const maeDelta = candidate.mae - baseline.mae;
  if (maeDelta < -MAE_THRESHOLD && candidate.accurate_pct >= baseline.accurate_pct) return 'candidate';
  if (maeDelta >  MAE_THRESHOLD) return 'baseline';
  return 'inconclusive';
}

function rankImprovementAreas(nicheBreakdown) {
  return [...(nicheBreakdown ?? [])].filter(r => r.improvement).sort((a, b) => a.delta - b.delta);
}

function detectRegressionRisk(deltas, sampleSize) {
  const reasons = [];
  if (deltas.mae > 2.0)                reasons.push(`MAE increased by ${deltas.mae.toFixed(1)} pts`);
  if (deltas.accurate_pct < -0.05)     reasons.push(`Accuracy fell by ${Math.abs(Math.round(deltas.accurate_pct * 100))}%`);
  if (deltas.overprediction_rate > 0.10) reasons.push(`Overprediction rose by ${Math.round(deltas.overprediction_rate * 100)}%`);
  if ((sampleSize ?? 0) < 20)          reasons.push(`Small sample (${sampleSize}) — results may not generalise`);
  return {
    risk:    reasons.length === 0 ? 'low' : reasons.length <= 1 ? 'medium' : 'high',
    reasons,
  };
}

function compareVersions(simResult) {
  const { baseline_metrics, candidate_metrics, niche_breakdown } = simResult;
  const deltas            = computeMetricDelta(baseline_metrics, candidate_metrics);
  const winner            = determineWinner(baseline_metrics, candidate_metrics);
  const regression_risk   = detectRegressionRisk(deltas, candidate_metrics.sample_size);
  const improvement_areas = rankImprovementAreas(niche_breakdown);
  return { deltas, winner, regression_risk, improvement_areas };
}

module.exports = { compareVersions, computeMetricDelta, rankImprovementAreas, detectRegressionRisk };
