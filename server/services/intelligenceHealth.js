// Shared health scoring and learning velocity classification.
// Imported by both admin.js (at calibration time) and adminEvolution.js (live endpoint).
// All computations are synchronous and snapshot-in-time — no side effects.

function tryParse(json, fallback) {
  try { return JSON.parse(json || 'null') ?? fallback; }
  catch { return fallback; }
}

function computeHealthScore(db) {
  // Accuracy component (40%) — rolling 30d, accurate = |calibration_error| <= 10
  const acc30 = db.get(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END) AS accurate
    FROM video_outcomes
    WHERE actual_performance_score IS NOT NULL
      AND last_refreshed_at >= datetime('now', '-30 days')
  `);
  const accuracyScore = (acc30?.total ?? 0) >= 5
    ? Math.min(100, (acc30.accurate / acc30.total) * 100)
    : 50; // insufficient data → neutral

  // Calibration component (20%) — any calibrations in last 90d; 5+ = full score
  const calCount = db.get(`
    SELECT COUNT(*) AS n FROM intelligence_versions
    WHERE trigger IN ('auto', 'manual')
      AND created_at >= datetime('now', '-90 days')
  `)?.n ?? 0;
  const calibrationScore = Math.min(100, (calCount / 5) * 100);

  // Stability component (25%) — weekly accuracy std dev over 30d
  const weeklyRows = db.all(`
    SELECT strftime('%Y-W%W', last_refreshed_at) AS week,
           AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END) AS acc
    FROM video_outcomes
    WHERE actual_performance_score IS NOT NULL
      AND last_refreshed_at >= datetime('now', '-30 days')
    GROUP BY week ORDER BY week ASC
  `);
  let stabilityScore = 75;
  if (weeklyRows.length >= 2) {
    const accs = weeklyRows.map(r => r.acc);
    const mean = accs.reduce((s, v) => s + v, 0) / accs.length;
    const variance = accs.reduce((s, v) => s + (v - mean) ** 2, 0) / accs.length;
    stabilityScore = Math.max(0, Math.min(100, (1 - Math.sqrt(variance) * 3) * 100));
  }

  // Drift component (15%) — mean % change in median_vph across latest two batches
  const batches = db.all(`
    SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at
    FROM niche_benchmark_history
    GROUP BY snapshot_batch_id ORDER BY snapshot_at DESC LIMIT 2
  `);
  let driftScore = 100;
  if (batches.length >= 2) {
    const curr = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[0].snapshot_batch_id]);
    const prev = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[1].snapshot_batch_id]);
    const prevMap = {};
    for (const r of prev) prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`] = r;
    const drifts = [];
    for (const r of curr) {
      const p = prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`];
      if (p?.median_vph && r.median_vph)
        drifts.push(Math.abs(r.median_vph - p.median_vph) / p.median_vph);
    }
    if (drifts.length) {
      const mean = drifts.reduce((s, v) => s + v, 0) / drifts.length;
      driftScore = Math.max(0, Math.min(100, (1 - mean * 2) * 100));
    }
  }

  const health_score = parseFloat((
    accuracyScore    * 0.40 +
    calibrationScore * 0.20 +
    stabilityScore   * 0.25 +
    driftScore       * 0.15
  ).toFixed(1));

  return {
    health_score,
    components: {
      accuracy_score:    parseFloat(accuracyScore.toFixed(1)),
      calibration_score: parseFloat(calibrationScore.toFixed(1)),
      stability_score:   parseFloat(stabilityScore.toFixed(1)),
      drift_score:       parseFloat(driftScore.toFixed(1)),
    },
  };
}

function computeLearningVelocity(db) {
  // weight_delta — sum of absolute changes in the most recent intelligence_version
  const lastVer = db.get(
    "SELECT changed_weights_json FROM intelligence_versions ORDER BY created_at DESC LIMIT 1",
  );
  let weightDelta = 0;
  if (lastVer?.changed_weights_json) {
    const w = tryParse(lastVer.changed_weights_json, {});
    weightDelta = Object.values(w).reduce((s, v) => s + Math.abs(v), 0);
  }

  // calibration_freq — calibrations in last 30d
  const calibFreq = db.get(
    "SELECT COUNT(*) AS n FROM intelligence_versions WHERE trigger IN ('auto','manual') AND created_at >= datetime('now', '-30 days')",
  )?.n ?? 0;

  // benchmark_drift — mean % change across latest two batches
  let benchmarkDrift = 0;
  const batches = db.all(`
    SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at
    FROM niche_benchmark_history
    GROUP BY snapshot_batch_id ORDER BY snapshot_at DESC LIMIT 2
  `);
  if (batches.length >= 2) {
    const curr = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[0].snapshot_batch_id]);
    const prev = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[1].snapshot_batch_id]);
    const prevMap = {};
    for (const r of prev) prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`] = r;
    const drifts = [];
    for (const r of curr) {
      const p = prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`];
      if (p?.median_vph && r.median_vph)
        drifts.push(Math.abs(r.median_vph - p.median_vph) / p.median_vph);
    }
    if (drifts.length) benchmarkDrift = drifts.reduce((s, v) => s + v, 0) / drifts.length;
  }

  // accuracy_slope — 7d accuracy minus 30d accuracy as a proxy
  const acc7  = db.get(`SELECT AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END) AS v FROM video_outcomes WHERE actual_performance_score IS NOT NULL AND last_refreshed_at >= datetime('now', '-7 days')`)?.v ?? null;
  const acc30 = db.get(`SELECT AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END) AS v FROM video_outcomes WHERE actual_performance_score IS NOT NULL AND last_refreshed_at >= datetime('now', '-30 days')`)?.v ?? null;
  const accuracySlope = (acc7 != null && acc30 != null) ? acc7 - acc30 : 0;

  // Normalize by niche count — changed_weights_json stores niche_bias deltas (-10 to +10 scale),
  // not ensemble weights (0-1 scale). Raw sum comparison to 0.30 was a scale mismatch bug.
  const nChanged = lastVer?.changed_weights_json
    ? Object.keys(tryParse(lastVer.changed_weights_json, {})).length
    : 0;
  const avgAbsDeltaPerNiche = nChanged > 0 ? weightDelta / nChanged : 0;

  let velocity;
  if (avgAbsDeltaPerNiche > 5.0 || calibFreq > 10)              velocity = 'Volatile';
  else if (benchmarkDrift > 0.25 && avgAbsDeltaPerNiche > 2.0)  velocity = 'Drifting';
  else if (accuracySlope > 0.02 && avgAbsDeltaPerNiche < 2.0)   velocity = 'Improving';
  else                                                           velocity = 'Stable';

  return {
    velocity,
    inputs: {
      weight_delta:            parseFloat(weightDelta.toFixed(4)),
      avg_abs_delta_per_niche: parseFloat(avgAbsDeltaPerNiche.toFixed(4)),
      niches_changed:          nChanged,
      benchmark_drift:         parseFloat(benchmarkDrift.toFixed(4)),
      calibration_freq:        calibFreq,
      accuracy_slope:          parseFloat(accuracySlope.toFixed(4)),
    },
  };
}

function computeCalibrationTrustScore(db) {
  const stats = db.get(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic,
      AVG(ABS(calibration_error)) AS mae,
      SUM(CASE WHEN last_refreshed_at < datetime('now', '-30 days') OR last_refreshed_at IS NULL THEN 1 ELSE 0 END) AS stale
    FROM video_outcomes WHERE actual_performance_score IS NOT NULL
  `) ?? {};

  const benchZero  = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE median_vph <= 0 AND bucket = '7d'`)?.n ?? 0;
  const benchTotal = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE bucket = '7d'`)?.n ?? 1;

  const total = stats.total ?? 0;
  if (total === 0) return 0;

  const synthRatio     = (stats.synthetic ?? 0) / total;
  const staleRatio     = Math.min(1, (stats.stale ?? 0) / total);
  const mae            = stats.mae ?? 50;

  const sampleScore    = Math.min(100, (total / 500) * 100);
  const realScore      = (1 - synthRatio) * 100;
  const freshnessScore = (1 - staleRatio) * 100;
  const benchScore     = benchTotal > 0 ? (1 - benchZero / benchTotal) * 100 : 0;
  const maeScore       = Math.max(0, 100 - mae);

  return Math.round(
    sampleScore    * 0.20 +
    realScore      * 0.35 +
    freshnessScore * 0.20 +
    benchScore     * 0.15 +
    maeScore       * 0.10,
  );
}

function computeLearningSnapshot(db) {
  const stats = db.get(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic_rows,
      SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_rows,
      AVG(ABS(calibration_error)) AS mae,
      SUM(CASE WHEN last_refreshed_at < datetime('now', '-30 days') OR last_refreshed_at IS NULL THEN 1 ELSE 0 END) AS stale_outcomes
    FROM video_outcomes WHERE actual_performance_score IS NOT NULL
  `) ?? {};

  const benchZero  = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE median_vph <= 0 AND bucket = '7d'`)?.n ?? 0;
  const benchTotal = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE bucket = '7d'`)?.n ?? 1;
  const benchHealth = benchTotal > 0 ? Math.round((1 - benchZero / benchTotal) * 100) : 0;

  const { velocity } = computeLearningVelocity(db);

  let benchmarkDrift = 0;
  const batches = db.all(`SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at FROM niche_benchmark_history GROUP BY snapshot_batch_id ORDER BY snapshot_at DESC LIMIT 2`);
  if (batches.length >= 2) {
    const curr = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[0].snapshot_batch_id]);
    const prev = db.all('SELECT * FROM niche_benchmark_history WHERE snapshot_batch_id = ?', [batches[1].snapshot_batch_id]);
    const prevMap = {};
    for (const r of prev) prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`] = r;
    const drifts = [];
    for (const r of curr) {
      const p = prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`];
      if (p?.median_vph && r.median_vph)
        drifts.push(Math.abs(r.median_vph - p.median_vph) / p.median_vph);
    }
    if (drifts.length) benchmarkDrift = drifts.reduce((s, v) => s + v, 0) / drifts.length;
  }

  let weightDelta = 0;
  const lastVer = db.get('SELECT changed_weights_json FROM intelligence_versions ORDER BY created_at DESC LIMIT 1');
  if (lastVer?.changed_weights_json) {
    try {
      const w = JSON.parse(lastVer.changed_weights_json || '{}');
      weightDelta = Object.values(w).reduce((s, v) => s + Math.abs(v), 0);
    } catch {}
  }

  const total = stats.total ?? 0;
  const synth = stats.synthetic_rows ?? 0;

  return {
    snapshot_date:           new Date().toISOString().slice(0, 10),
    mae:                     stats.mae != null ? parseFloat(Number(stats.mae).toFixed(3)) : null,
    calibration_trust_score: computeCalibrationTrustScore(db),
    synthetic_ratio:         total > 0 ? parseFloat((synth / total).toFixed(4)) : null,
    stale_outcomes:          stats.stale_outcomes ?? 0,
    benchmark_health:        benchHealth,
    learning_velocity:       velocity,
    total_calibration_rows:  total,
    real_rows:               stats.real_rows ?? 0,
    synthetic_rows:          synth,
    avg_confidence_score:    null,
    benchmark_drift:         parseFloat(benchmarkDrift.toFixed(4)),
    weight_delta:            parseFloat(weightDelta.toFixed(4)),
  };
}

module.exports = { computeHealthScore, computeLearningVelocity, computeCalibrationTrustScore, computeLearningSnapshot };
