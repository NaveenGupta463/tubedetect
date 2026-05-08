// Pure drift aggregation — read-only, no DB access, no side effects.
// Accepts video_outcomes rows and computes observational drift signals.

const THRESHOLDS = Object.freeze({
  maeWarning:          20,    // mean absolute calibration error
  overpredictionRatio: 0.65,
  underpredictionRatio: 0.65,
  nicheInflation:      15,    // per-niche avg calibration_error triggers flag
  ctrWeak:             0.03,  // 3% CTR floor
  retentionWeak:       0.30,  // 30% retention floor
  minRowsForSignal:    5,     // minimum rows before signaling
});

function computeDriftSignals(rows) {
  if (!rows || rows.length === 0) {
    return { signals: [], warnings: [], niches: {}, pipeline: {}, summary: { total: 0, calibrated: 0 } };
  }

  const total      = rows.length;
  const calibrated = rows.filter(r => r.calibration_error != null);
  const calCount   = calibrated.length;

  // ── Per-niche aggregation ──────────────────────────────────────────────────
  const nicheMap = {};
  for (const r of calibrated) {
    const n = r.niche || 'unknown';
    if (!nicheMap[n]) nicheMap[n] = { errors: [], count: 0 };
    nicheMap[n].errors.push(r.calibration_error);
    nicheMap[n].count++;
  }
  const niches = {};
  for (const [n, d] of Object.entries(nicheMap)) {
    const avg = d.errors.reduce((s, e) => s + e, 0) / d.errors.length;
    niches[n] = { count: d.count, avgCalibrationError: parseFloat(avg.toFixed(2)), inflated: avg > THRESHOLDS.nicheInflation };
  }

  // ── Per-pipeline aggregation ───────────────────────────────────────────────
  const pipelineMap = {};
  for (const r of rows) {
    const pv = r.pipeline_version || 'unknown';
    pipelineMap[pv] = (pipelineMap[pv] ?? 0) + 1;
  }

  if (calCount === 0) {
    return { signals: [], warnings: [], niches, pipeline: pipelineMap, summary: { total, calibrated: 0 } };
  }

  const sumError    = calibrated.reduce((s, r) => s + r.calibration_error, 0);
  const avgError    = sumError / calCount;
  const mae         = calibrated.reduce((s, r) => s + Math.abs(r.calibration_error), 0) / calCount;
  const overCount   = calibrated.filter(r => r.calibration_error >  10).length;
  const underCount  = calibrated.filter(r => r.calibration_error < -10).length;
  const overRatio   = overCount  / calCount;
  const underRatio  = underCount / calCount;

  const warnings = [];
  const signals  = [];

  // ── System-level warnings ──────────────────────────────────────────────────
  if (mae > THRESHOLDS.maeWarning) {
    warnings.push({
      type:     'high_calibration_error',
      message:  `Mean absolute error ${mae.toFixed(1)} exceeds ${THRESHOLDS.maeWarning} threshold`,
      severity: mae > 35 ? 'critical' : 'warning',
    });
  }
  if (overRatio > THRESHOLDS.overpredictionRatio) {
    warnings.push({
      type:     'systematic_overprediction',
      message:  `${(overRatio * 100).toFixed(0)}% of predictions overpredicted`,
      severity: 'warning',
    });
  }
  if (underRatio > THRESHOLDS.underpredictionRatio) {
    warnings.push({
      type:     'systematic_underprediction',
      message:  `${(underRatio * 100).toFixed(0)}% of predictions underpredicted`,
      severity: 'warning',
    });
  }

  // ── CTR signal ────────────────────────────────────────────────────────────
  const withCtr = rows.filter(r => r.actual_ctr != null);
  if (withCtr.length >= THRESHOLDS.minRowsForSignal) {
    const avgCtr = withCtr.reduce((s, r) => s + r.actual_ctr, 0) / withCtr.length;
    if (avgCtr < THRESHOLDS.ctrWeak) {
      signals.push({ type: 'ctr_below_threshold', value: parseFloat(avgCtr.toFixed(4)), threshold: THRESHOLDS.ctrWeak, rows: withCtr.length });
    }
  }

  // ── Retention signal ──────────────────────────────────────────────────────
  const withRet = rows.filter(r => r.actual_retention != null);
  if (withRet.length >= THRESHOLDS.minRowsForSignal) {
    const avgRet = withRet.reduce((s, r) => s + r.actual_retention, 0) / withRet.length;
    if (avgRet < THRESHOLDS.retentionWeak) {
      signals.push({ type: 'retention_below_threshold', value: parseFloat(avgRet.toFixed(4)), threshold: THRESHOLDS.retentionWeak, rows: withRet.length });
    }
  }

  // ── Niche inflation signals ───────────────────────────────────────────────
  for (const [n, stats] of Object.entries(niches)) {
    if (stats.inflated && stats.count >= THRESHOLDS.minRowsForSignal) {
      signals.push({ type: 'niche_score_inflation', niche: n, avgError: stats.avgCalibrationError, count: stats.count });
    }
  }

  return {
    signals,
    warnings,
    niches,
    pipeline: pipelineMap,
    summary: {
      total,
      calibrated:          calCount,
      avgCalibrationError: parseFloat(avgError.toFixed(2)),
      meanAbsoluteError:   parseFloat(mae.toFixed(2)),
      overpredictionRate:  parseFloat((overRatio  * 100).toFixed(1)),
      underpredictionRate: parseFloat((underRatio * 100).toFixed(1)),
    },
  };
}

module.exports = { computeDriftSignals, THRESHOLDS };
