const MIN_VIEWS_24H  = 500;
const MIN_VIEWS_72H  = 2000;
const WEAK_VIEWS_24H = 200;

function computeSignalQuality(row) {
  const v24 = row.views_24h ?? 0;
  const v72 = row.views_72h ?? 0;
  if (v72 >= MIN_VIEWS_72H || v24 >= MIN_VIEWS_24H) return 'strong';
  if (v24 >= WEAK_VIEWS_24H) return 'weak';
  return 'insufficient';
}

function computeMedian(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyLifecycle(row, channelContext) {
  const median = channelContext?.median_views_24h;
  const v24    = row.views_24h;
  const v72    = row.views_72h;

  if (!v24 || !median || median <= 0) {
    return { velocity_state: null, breakout_multiplier: null };
  }

  const ratio = v24 / median;
  let velocity_state;
  if      (ratio >= 5)   velocity_state = 'explosive';
  else if (ratio >= 2)   velocity_state = 'accelerating';
  else if (ratio >= 0.5) velocity_state = 'stable';
  else if (ratio >= 0.1) velocity_state = 'decaying';
  else                   velocity_state = 'dead';

  const breakout_multiplier = (v72 != null && median > 0)
    ? parseFloat((v72 / (median * 3)).toFixed(2))
    : null;

  return { velocity_state, breakout_multiplier };
}

function computeAlgorithmPushScore(row, channelContext) {
  const v24    = row.views_24h;
  const median = channelContext?.median_views_24h;
  if (!v24 || !median || median <= 0) return null;

  const velocityRatio   = v24 / median;
  const engagementRate  = (row.like_rate ?? 0.03) + (row.comment_rate ?? 0.01);
  const engagementRatio = engagementRate / 0.04;

  let score = Math.min(50, velocityRatio * 20) + Math.min(30, engagementRatio * 15);

  if (row.has_oauth_data) {
    if (row.ctr != null)             score += Math.max(-15, Math.min(20, (row.ctr - 4) * 2));
    if (row.avg_retention_pct != null) score += Math.max(-10, Math.min(20, (row.avg_retention_pct - 0.40) * 30));
  }

  return Math.max(0, Math.min(100, parseFloat(score.toFixed(1))));
}

function detectBreakoutVideo(row, channelContext) {
  const { velocity_state, breakout_multiplier } = classifyLifecycle(row, channelContext);
  const is_breakout = velocity_state === 'explosive' || (breakout_multiplier != null && breakout_multiplier >= 3.0);
  return { is_breakout: Boolean(is_breakout), breakout_multiplier };
}

function detectFalsePositivePrediction(row, predictionCtx) {
  if (predictionCtx.signal_quality === 'insufficient') return { is_false_positive: false, reason: null };
  if ((predictionCtx.predicted_score ?? 0) >= 65 &&
      (row.velocity_state === 'decaying' || row.velocity_state === 'dead')) {
    return {
      is_false_positive: true,
      reason: `Predicted ${predictionCtx.predicted_score} but velocity is ${row.velocity_state}`,
    };
  }
  return { is_false_positive: false, reason: null };
}

function detectFalseNegativePrediction(row, predictionCtx) {
  if (predictionCtx.signal_quality === 'insufficient') return { is_false_negative: false, reason: null };
  if ((predictionCtx.predicted_score ?? 100) <= 45 &&
      row.viral_outcome &&
      (row.breakout_multiplier ?? 0) >= 3.0) {
    return {
      is_false_negative: true,
      reason: `Predicted ${predictionCtx.predicted_score} but breakout multiplier is ${row.breakout_multiplier}x`,
    };
  }
  return { is_false_negative: false, reason: null };
}

function computeVelocityCurve(row) {
  const points = [];
  if (row.views_1h  != null) points.push({ hours: 1,  views: row.views_1h });
  if (row.views_6h  != null) points.push({ hours: 6,  views: row.views_6h });
  if (row.views_24h != null) points.push({ hours: 24, views: row.views_24h });
  if (row.views_72h != null) points.push({ hours: 72, views: row.views_72h });
  return points;
}

module.exports = {
  computeSignalQuality,
  computeMedian,
  classifyLifecycle,
  computeAlgorithmPushScore,
  detectBreakoutVideo,
  detectFalsePositivePrediction,
  detectFalseNegativePrediction,
  computeVelocityCurve,
};
