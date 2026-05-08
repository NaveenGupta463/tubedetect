// Pure calibration aggregation — no DB access, no side effects.

const safe2 = (n) => (n != null && isFinite(n) ? parseFloat(n.toFixed(2)) : null);
const pct1  = (num, den) => den > 0 ? parseFloat((num / den * 100).toFixed(1)) : null;

function computeCalibrationTimeline(rows) {
  if (!rows || rows.length === 0) return [];
  return rows.map(r => {
    const count = r.count ?? 0;
    return {
      date:         r.date,
      mae:          safe2(r.mae) ?? 0,
      count,
      accurate_pct: pct1(r.accurate_count ?? 0, count),
      over_pct:     pct1(r.over_count     ?? 0, count),
      under_pct:    pct1(r.under_count    ?? 0, count),
    };
  });
}

function computeRollingMAE(timelineRows) {
  if (!timelineRows || timelineRows.length === 0) return [];
  return timelineRows.map(r => ({
    date:  r.date,
    mae:   safe2(r.mae) ?? 0,
    count: r.count ?? 0,
  }));
}

function computeCalibrationDistribution(bandRows) {
  const dist = {
    accurate: 0, slight_overprediction: 0, large_overprediction: 0,
    slight_underprediction: 0, large_underprediction: 0, total: 0,
  };
  if (!bandRows || bandRows.length === 0) return dist;
  for (const r of bandRows) {
    const band = r.calibration_band;
    if (band in dist) dist[band] = r.count ?? 0;
    dist.total += r.count ?? 0;
  }
  return dist;
}

function computePredictionBias(summaryRow) {
  if (!summaryRow || !(summaryRow.total > 0)) return { direction: 'neutral', magnitude: null };
  const avg = summaryRow.avg_error ?? 0;
  return {
    direction: avg > 2 ? 'overprediction' : avg < -2 ? 'underprediction' : 'neutral',
    magnitude: safe2(Math.abs(avg)),
  };
}

function computePredictionHealth(summaryRow) {
  if (!summaryRow || !(summaryRow.total > 0)) {
    return { status: 'healthy', mae: null, accurateRate: null, biasDirection: 'neutral', datapoints: 0 };
  }
  const mae  = safe2(summaryRow.mae) ?? 0;
  const avg  = summaryRow.avg_error ?? 0;
  return {
    status:        mae > 35 ? 'critical' : mae > 20 ? 'warning' : 'healthy',
    mae,
    accurateRate:  pct1(summaryRow.accurate_count ?? 0, summaryRow.total),
    biasDirection: avg > 2 ? 'overprediction' : avg < -2 ? 'underprediction' : 'neutral',
    datapoints:    summaryRow.total,
  };
}

function computeTrendBuckets(rawRows) {
  if (!rawRows || rawRows.length === 0) return [];
  return rawRows.map(r => {
    const total = r.total ?? 0;
    return {
      week:         r.week,
      total,
      accurate_pct: pct1(r.accurate_count ?? 0, total),
      over_pct:     pct1(r.over_count     ?? 0, total),
      under_pct:    pct1(r.under_count    ?? 0, total),
    };
  });
}

module.exports = {
  computeCalibrationTimeline,
  computeRollingMAE,
  computeCalibrationDistribution,
  computePredictionBias,
  computePredictionHealth,
  computeTrendBuckets,
};
