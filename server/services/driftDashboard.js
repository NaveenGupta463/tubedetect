// Pure niche drift analytics — no DB access, no side effects.

const MAE_CRITICAL = 35;
const MAE_WARNING  = 20;

function nicheSerity(mae) {
  if (mae > MAE_CRITICAL) return 'critical';
  if (mae > MAE_WARNING)  return 'warning';
  return 'healthy';
}

function driftDirection(avg_error) {
  if (avg_error > 2)  return 'overprediction';
  if (avg_error < -2) return 'underprediction';
  return 'neutral';
}

function computeNicheDrift(nicheDriftRows, summaryRow) {
  const niches = (nicheDriftRows || []).map(r => ({
    niche:           r.niche,
    avg_error:       parseFloat((r.avg_error ?? 0).toFixed(2)),
    mae:             parseFloat((r.mae       ?? 0).toFixed(2)),
    count:           r.count ?? 0,
    severity:        nicheSerity(r.mae ?? 0),
    drift_direction: driftDirection(r.avg_error ?? 0),
  }));

  const totalNiches  = niches.length;
  const healthyCount = niches.filter(n => n.severity === 'healthy').length;

  let volatilityIndex = null;
  if (niches.length >= 2) {
    const maes   = niches.map(n => n.mae);
    const avgMae = maes.reduce((s, m) => s + m, 0) / maes.length;
    const vari   = maes.reduce((s, m) => s + (m - avgMae) ** 2, 0) / maes.length;
    volatilityIndex = parseFloat(Math.sqrt(vari).toFixed(2));
  }

  const total = summaryRow?.total ?? 0;
  const over  = summaryRow?.over_count      ?? 0;
  const under = summaryRow?.under_count     ?? 0;
  const acc   = summaryRow?.accurate_count  ?? 0;

  return {
    niches,
    summary: {
      volatilityIndex,
      calibrationStability:      totalNiches > 0 ? parseFloat((healthyCount / totalNiches * 100).toFixed(1)) : null,
      overpredictionRatio:       total > 0 ? parseFloat((over  / total * 100).toFixed(1)) : null,
      underpredictionRatio:      total > 0 ? parseFloat((under / total * 100).toFixed(1)) : null,
      confidenceDegradationRate: total > 0 ? parseFloat(((total - acc) / total * 100).toFixed(1)) : null,
      totalNiches,
    },
  };
}

module.exports = { computeNicheDrift };
