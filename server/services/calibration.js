// Pure calibration math — no DB access, no side effects.
// Separate from server/pipeline/calibration.js (score adjustment stub).
// This module measures prediction accuracy against real outcomes.

const WEIGHTS = Object.freeze({ velocity: 0.45, ctr: 0.35, retention: 0.20 });

const BAND_LARGE  = 25;
const BAND_SLIGHT = 10;

function computeActualPerformanceScore({ velocity_24h, actual_ctr, actual_retention }) {
  const v = Math.min(100, Math.log10((velocity_24h ?? 0) + 1) * 40);
  const c = Math.min(100, Math.max(0, (actual_ctr ?? 0)) * 1000);
  const r = Math.max(0, Math.min(1, actual_retention ?? 0)) * 100;
  return parseFloat((WEIGHTS.velocity * v + WEIGHTS.ctr * c + WEIGHTS.retention * r).toFixed(2));
}

function computeCalibrationError({ predicted_score, actual_performance_score }) {
  return parseFloat((predicted_score - actual_performance_score).toFixed(2));
}

function getCalibrationBand(error) {
  if (error >  BAND_LARGE)  return 'large_overprediction';
  if (error >  BAND_SLIGHT) return 'slight_overprediction';
  if (error >= -BAND_SLIGHT) return 'accurate';
  if (error >= -BAND_LARGE)  return 'slight_underprediction';
  return 'large_underprediction';
}

function bucketPredictionAccuracy(rows) {
  const calibrated = rows.filter(r => r.calibration_band);
  const total = calibrated.length;
  if (total === 0) return { total: 0, bands: {}, accurate_rate: null, over_rate: null, under_rate: null };

  const bands = {};
  for (const r of calibrated) {
    bands[r.calibration_band] = (bands[r.calibration_band] ?? 0) + 1;
  }

  const overCount  = (bands.large_overprediction  ?? 0) + (bands.slight_overprediction  ?? 0);
  const underCount = (bands.large_underprediction ?? 0) + (bands.slight_underprediction ?? 0);

  return {
    total,
    bands,
    accurate_rate: parseFloat(((bands.accurate ?? 0) / total * 100).toFixed(1)),
    over_rate:     parseFloat((overCount  / total * 100).toFixed(1)),
    under_rate:    parseFloat((underCount / total * 100).toFixed(1)),
  };
}

// Public-data path: niche-relative percentile scoring using views_per_hour.
// Does NOT require OAuth (no CTR, no retention).
// Mapping: 0 VPH→0, median→50, p75→75, p90→90, ≥2×p90→100.
function computeActualPerformanceScoreFromVph(vph, { median_vph, p75_vph, p90_vph } = {}) {
  if (vph == null || median_vph == null || p75_vph == null || p90_vph == null) return null;
  if (median_vph <= 0 || p75_vph <= 0 || p90_vph <= 0) return null;

  let score;
  if (vph >= p90_vph) {
    const excess = Math.min(1, (vph - p90_vph) / p90_vph);
    score = 90 + excess * 10;
  } else if (vph >= p75_vph) {
    const span = p90_vph - p75_vph;
    score = span > 0 ? 75 + ((vph - p75_vph) / span) * 15 : 75;
  } else if (vph >= median_vph) {
    const span = p75_vph - median_vph;
    score = span > 0 ? 50 + ((vph - median_vph) / span) * 25 : 50;
  } else {
    score = (vph / median_vph) * 50;
  }

  return parseFloat(Math.max(0, Math.min(100, score)).toFixed(2));
}

module.exports = {
  computeActualPerformanceScore,
  computeActualPerformanceScoreFromVph,
  computeCalibrationError,
  getCalibrationBand,
  bucketPredictionAccuracy,
  WEIGHTS,
};
