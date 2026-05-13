const express = require('express');
const { getDb } = require('../db/init');
const {
  getAllIntelligenceVersions,
  getEvolutionAccuracyTimeline,
  getEvolutionFPFNStats,
  getEvolutionScoreDistribution,
  getEvolutionSignalWeightHistory,
  getEvolutionConfidenceBins,
  getLatestTwoSnapshotBatches,
  getBenchmarkHistoryByBatch,
  getBenchmarkTimelineForCombination,
  getCalibrationOverview,
  getOutcomeFreshnessHistogram,
  getNicheCalibrationDensity,
  insertLearningSnapshot,
  getLearningHistory,
  getNicheLearningStats,
  getCalibrationDistributions,
  getLearningEvents,
  getLatestLearningSnapshot,
  getConfidenceHistory,
  getLatestConfidenceMetrics,
  getAllNicheReliability,
  getCohortSnapshots,
  getDisagreementStats,
  getFreshnessDecayAnalysis,
} = require('../db/queries');
const { getSyntheticTransitionStatus } = require('../services/syntheticTransition');
const {
  computeHealthScore,
  computeLearningVelocity,
  computeCalibrationTrustScore,
  computeLearningSnapshot,
} = require('../services/intelligenceHealth');
const { runLearningSnapshotCycle } = require('../jobs/learningSnapshotCron');
const {
  FEATURES,
  computeFeatureConfidence,
  computeAllConfidences,
  computeRoutingDistribution,
  getActiveNiches,
} = require('../services/confidenceEngine');
const { runConfidenceSnapshot } = require('../jobs/learningConfidenceCron');
const { computeConfidenceCorrectness } = require('../services/confidenceValidation');
const { getRoutingAnalytics } = require('../db/queries');

const router = express.Router();

function adminAuth(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const provided = req.headers['x-admin-token'] ?? req.query.admin_token;
  if (provided !== token) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.use(adminAuth);

function tryParse(json, fallback) {
  try { return JSON.parse(json || 'null') ?? fallback; }
  catch { return fallback; }
}

function MIN_DATA_MSG() {
  return { insufficient_data: true, message: 'Accumulating intelligence data — insufficient historical prediction samples' };
}

// ── GET /api/admin/evolution/calibration-history ──────────────────────────────
router.get('/admin/evolution/calibration-history', (_req, res) => {
  try {
    const db       = getDb();
    const versions = getAllIntelligenceVersions(db, 50);
    const parsed   = versions.map(v => ({
      ...v,
      prev_weights:    tryParse(v.prev_weights_json, {}),
      new_weights:     tryParse(v.new_weights_json, {}),
      changed_weights: tryParse(v.changed_weights_json, {}),
    }));
    res.json({ ok: true, versions: parsed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/prediction-accuracy ──────────────────────────────
router.get('/admin/evolution/prediction-accuracy', (_req, res) => {
  try {
    const db      = getDb();
    const stats7  = getEvolutionFPFNStats(db, 7);
    const stats30 = getEvolutionFPFNStats(db, 30);
    const weekly  = getEvolutionAccuracyTimeline(db);

    if ((stats30?.total ?? 0) < 5) {
      return res.json({ ...MIN_DATA_MSG(), weekly: [] });
    }

    const toRate = (n, d) => d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null;

    res.json({
      ok: true,
      rolling_7d: {
        total:        stats7?.total ?? 0,
        accurate_pct: toRate(stats7?.accurate, stats7?.total),
        fp_rate:      toRate(stats7?.fp_count, stats7?.strong_predictions),
        fn_rate:      toRate(stats7?.fn_count, stats7?.weak_predictions),
        fp_count:     stats7?.fp_count ?? 0,
        fn_count:     stats7?.fn_count ?? 0,
      },
      rolling_30d: {
        total:        stats30?.total ?? 0,
        accurate_pct: toRate(stats30?.accurate, stats30?.total),
        fp_rate:      toRate(stats30?.fp_count, stats30?.strong_predictions),
        fn_rate:      toRate(stats30?.fn_count, stats30?.weak_predictions),
        fp_count:     stats30?.fp_count ?? 0,
        fn_count:     stats30?.fn_count ?? 0,
      },
      weekly: weekly.map(w => ({
        week:         w.week,
        total:        w.total,
        accurate_pct: toRate(w.accurate, w.total),
        fp:           w.fp,
        fn:           w.fn,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/score-distribution ───────────────────────────────
router.get('/admin/evolution/score-distribution', (_req, res) => {
  try {
    const db        = getDb();
    const lastCalib = getDb().get('SELECT created_at FROM intelligence_versions ORDER BY created_at DESC LIMIT 1');
    const boundary  = lastCalib?.created_at ?? null;

    if (!boundary) {
      return res.json({ ok: true, no_calibration: true, message: 'No calibration comparison available yet', weekly: [] });
    }

    const { before, after, weekly } = getEvolutionScoreDistribution(db, boundary, boundary);
    res.json({ ok: true, boundary, before, after, weekly });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/signal-weights ───────────────────────────────────
router.get('/admin/evolution/signal-weights', (_req, res) => {
  try {
    const db       = getDb();
    const versions = getEvolutionSignalWeightHistory(db);
    const parsed   = versions.map(v => ({
      id:           v.id,
      version_name: v.version_name,
      version_type: v.version_type,
      created_at:   v.created_at,
      created_by:   v.created_by,
      active:       v.active,
      weights:      tryParse(v.weights_json, {}),
      thresholds:   tryParse(v.thresholds_json, {}),
      notes:        v.notes,
    }));
    res.json({ ok: true, versions: parsed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/benchmark-drift ──────────────────────────────────
router.get('/admin/evolution/benchmark-drift', (_req, res) => {
  try {
    const db      = getDb();
    const batches = getLatestTwoSnapshotBatches(db);

    if (batches.length < 2) {
      return res.json({
        ok: true, insufficient_history: true,
        message: 'Benchmark history accumulates after the second patternMiner run',
        batches, drift: [], heatmap: [], warnings: [],
      });
    }

    const [currBatch, prevBatch] = batches;
    const currRows = getBenchmarkHistoryByBatch(db, currBatch.snapshot_batch_id);
    const prevRows = getBenchmarkHistoryByBatch(db, prevBatch.snapshot_batch_id);

    const prevMap = {};
    for (const r of prevRows) prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`] = r;

    const drift = currRows.map(r => {
      const p           = prevMap[`${r.niche}|${r.bucket}|${r.duration_bucket}`];
      const delta_pct   = (p?.median_vph && r.median_vph)
        ? parseFloat(((r.median_vph - p.median_vph) / p.median_vph * 100).toFixed(1))
        : null;
      const sample_change = p?.sample_size != null ? r.sample_size - p.sample_size : null;

      let warning_level = 'none';
      if (delta_pct != null) {
        const abs = Math.abs(delta_pct);
        if (abs > 40) warning_level = 'red';
        else if (abs > 20) warning_level = 'amber';
      }
      if (sample_change != null && p?.sample_size > 0) {
        const dropPct = (-sample_change / p.sample_size) * 100;
        if (dropPct > 60) warning_level = 'red';
        else if (dropPct > 30 && warning_level === 'none') warning_level = 'amber';
      }

      return {
        niche:             r.niche,
        bucket:            r.bucket,
        duration_bucket:   r.duration_bucket,
        curr_median_vph:   r.median_vph,
        prev_median_vph:   p?.median_vph ?? null,
        curr_sample_size:  r.sample_size,
        prev_sample_size:  p?.sample_size ?? null,
        delta_pct,
        sample_change,
        warning_level,
      };
    });

    // Heatmap: (niche, duration_bucket) → max |delta_pct|
    const heatmapMap = {};
    for (const d of drift) {
      const key = `${d.niche}|${d.duration_bucket}`;
      const abs = d.delta_pct != null ? Math.abs(d.delta_pct) : 0;
      if (!heatmapMap[key] || abs > heatmapMap[key].max_drift) {
        heatmapMap[key] = { niche: d.niche, duration_bucket: d.duration_bucket, max_drift: abs, warning_level: d.warning_level };
      }
    }
    const heatmap = Object.values(heatmapMap);

    // Stability warnings
    const warnings = [];
    const redCount = drift.filter(d => d.warning_level === 'red').length;
    const amberCount = drift.filter(d => d.warning_level === 'amber').length;
    if (redCount)   warnings.push({ type: 'benchmark_drift', severity: 'red',   message: `${redCount} benchmark combination(s) drifted >40%` });
    if (amberCount) warnings.push({ type: 'benchmark_drift', severity: 'amber', message: `${amberCount} benchmark combination(s) drifted >20%` });

    // Score inflation detection
    const r14 = db.get(`SELECT AVG(predicted_score) AS avg FROM video_outcomes WHERE predicted_score IS NOT NULL AND created_at >= datetime('now', '-14 days')`)?.avg;
    const p14 = db.get(`SELECT AVG(predicted_score) AS avg FROM video_outcomes WHERE predicted_score IS NOT NULL AND created_at >= datetime('now', '-28 days') AND created_at < datetime('now', '-14 days')`)?.avg;
    if (r14 != null && p14 != null) {
      const delta = r14 - p14;
      if (delta > 15) warnings.push({ type: 'score_inflation', severity: 'red',   message: `Mean score rose ${delta.toFixed(1)} pts in 14d (threshold: 15)` });
      else if (delta > 8) warnings.push({ type: 'score_inflation', severity: 'amber', message: `Mean score rose ${delta.toFixed(1)} pts in 14d (threshold: 8)` });
    }

    // Calibration frequency
    const freq7d = db.get(`SELECT COUNT(*) AS n FROM intelligence_versions WHERE trigger IN ('auto','manual') AND created_at >= datetime('now', '-7 days')`)?.n ?? 0;
    if (freq7d > 10) warnings.push({ type: 'calibration_frequency', severity: 'red',   message: `${freq7d} calibrations in 7 days (threshold: 10)` });
    else if (freq7d > 5) warnings.push({ type: 'calibration_frequency', severity: 'amber', message: `${freq7d} calibrations in 7 days (threshold: 5)` });

    res.json({
      ok: true,
      batches: { current: currBatch, previous: prevBatch },
      drift,
      heatmap,
      warnings,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/health-score ─────────────────────────────────────
router.get('/admin/evolution/health-score', (_req, res) => {
  try {
    const db             = getDb();
    const { health_score, components } = computeHealthScore(db);
    const { velocity, inputs }         = computeLearningVelocity(db);

    const history = getAllIntelligenceVersions(db, 20)
      .filter(v => v.health_score != null)
      .map(v => ({ created_at: v.created_at, health_score: v.health_score, velocity: v.learning_velocity, trigger: v.trigger }))
      .reverse();

    res.json({ ok: true, health_score, components, learning_velocity: velocity, velocity_inputs: inputs, history });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/benchmark-timeline ───────────────────────────────
router.get('/admin/evolution/benchmark-timeline', (req, res) => {
  try {
    const db = getDb();
    const { niche, bucket, duration_bucket } = req.query;
    const rows = getBenchmarkTimelineForCombination(db, { niche, bucket, duration_bucket });
    res.json({ ok: true, rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/versions ─────────────────────────────────────────
router.get('/admin/evolution/versions', (_req, res) => {
  try {
    const db       = getDb();
    const versions = getAllIntelligenceVersions(db, 100);
    const parsed   = versions.map(v => ({
      ...v,
      prev_weights:    tryParse(v.prev_weights_json, {}),
      new_weights:     tryParse(v.new_weights_json, {}),
      changed_weights: tryParse(v.changed_weights_json, {}),
    }));
    res.json({ ok: true, versions: parsed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/confidence ───────────────────────────────────────
router.get('/admin/evolution/confidence', (_req, res) => {
  try {
    const db   = getDb();
    const bins = getEvolutionConfidenceBins(db);
    if (!bins.length) return res.json({ ...MIN_DATA_MSG(), bins: [] });
    res.json({
      ok: true,
      bins: bins.map(b => ({
        ...b,
        accurate_pct: b.total > 0 ? parseFloat((b.accurate / b.total * 100).toFixed(1)) : null,
        sparse:       b.total < 10,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/calibration-overview ─────────────────────────────
router.get('/admin/evolution/calibration-overview', (_req, res) => {
  try {
    const db        = getDb();
    const byPipeline = getCalibrationOverview(db);
    const freshness  = getOutcomeFreshnessHistogram(db) ?? {};
    const density    = getNicheCalibrationDensity(db);

    const total      = byPipeline.reduce((s, r) => s + (r.total ?? 0), 0);
    const realRows   = byPipeline.filter(r => r.pipeline_version !== 'synthetic_b');
    const synthRows  = byPipeline.filter(r => r.pipeline_version === 'synthetic_b');
    const realTotal  = realRows.reduce((s, r) => s + (r.total ?? 0), 0);
    const synthTotal = synthRows.reduce((s, r) => s + (r.total ?? 0), 0);

    res.json({
      ok: true,
      summary: {
        total_calibrated:  total,
        real_predictions:  realTotal,
        synthetic_b:       synthTotal,
        stale_count:       freshness.stale ?? 0,
      },
      by_pipeline: byPipeline.map(r => ({
        pipeline_version: r.pipeline_version,
        total:            r.total,
        mae:              r.mae != null ? parseFloat(r.mae.toFixed(2)) : null,
        accurate_pct:     r.total > 0 ? parseFloat((r.accurate_count / r.total * 100).toFixed(1)) : null,
      })),
      freshness: {
        fresh_1d:  freshness.fresh_1d  ?? 0,
        fresh_7d:  freshness.fresh_7d  ?? 0,
        fresh_30d: freshness.fresh_30d ?? 0,
        stale:     freshness.stale     ?? 0,
        total:     freshness.total     ?? 0,
      },
      niche_density: density,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/stale-outcomes ───────────────────────────────────
router.get('/admin/evolution/stale-outcomes', (_req, res) => {
  try {
    const db = getDb();
    const freshness = getOutcomeFreshnessHistogram(db) ?? {};
    const staleRows = db.all(
      `SELECT youtube_video_id, niche, pipeline_version,
              predicted_score, actual_performance_score, calibration_band,
              last_refreshed_at, created_at
       FROM video_outcomes
       WHERE actual_performance_score IS NOT NULL
         AND (last_refreshed_at < datetime('now', '-30 days') OR last_refreshed_at IS NULL)
       ORDER BY last_refreshed_at ASC
       LIMIT 100`,
    );
    res.json({
      ok: true,
      stale_count: freshness.stale ?? 0,
      rows: staleRows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/learning-kpis ────────────────────────────────────
router.get('/admin/evolution/learning-kpis', (_req, res) => {
  try {
    const db = getDb();

    const stats = db.get(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic,
        SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real,
        AVG(ABS(calibration_error)) AS mae,
        SUM(CASE WHEN last_refreshed_at < datetime('now', '-1 days')  OR last_refreshed_at IS NULL THEN 1 ELSE 0 END) AS stale_1d,
        SUM(CASE WHEN last_refreshed_at < datetime('now', '-7 days')  OR last_refreshed_at IS NULL THEN 1 ELSE 0 END) AS stale_7d,
        SUM(CASE WHEN last_refreshed_at < datetime('now', '-30 days') OR last_refreshed_at IS NULL THEN 1 ELSE 0 END) AS stale_30d
      FROM video_outcomes WHERE actual_performance_score IS NOT NULL
    `) ?? {};

    const benchZero  = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE median_vph <= 0 AND bucket = '7d'`)?.n ?? 0;
    const benchTotal = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks WHERE bucket = '7d'`)?.n ?? 1;
    const benchCoverage = db.get(`SELECT COUNT(DISTINCT niche) AS n FROM niche_benchmarks WHERE median_vph > 0 AND bucket = '7d'`)?.n ?? 0;
    const benchHealth = benchTotal > 0 ? Math.round((1 - benchZero / benchTotal) * 100) : 0;

    const trust = computeCalibrationTrustScore(db);
    const { velocity } = computeLearningVelocity(db);

    const snap1d = db.get(`SELECT mae, calibration_trust_score FROM learning_health_snapshots WHERE snapshot_date = date('now', '-1 days')`);
    const snap7d = db.get(`SELECT mae, calibration_trust_score FROM learning_health_snapshots WHERE snapshot_date = date('now', '-7 days')`);

    const total   = stats.total ?? 0;
    const synth   = stats.synthetic ?? 0;
    const real    = stats.real ?? 0;
    const mae     = stats.mae != null ? parseFloat(Number(stats.mae).toFixed(2)) : null;
    const synthRatio = total > 0 ? parseFloat((synth / total).toFixed(4)) : null;

    const maeDelta24h = (mae != null && snap1d?.mae != null) ? parseFloat((mae - snap1d.mae).toFixed(2)) : null;
    const maeDelta7d  = (mae != null && snap7d?.mae != null) ? parseFloat((mae - snap7d.mae).toFixed(2)) : null;
    const trustDelta24h = (snap1d?.calibration_trust_score != null) ? trust - snap1d.calibration_trust_score : null;
    const trustDelta7d  = (snap7d?.calibration_trust_score != null) ? trust - snap7d.calibration_trust_score : null;

    const alerts = [];
    if (mae != null && mae > 40)         alerts.push({ severity: 'red',    type: 'high_mae',        message: `MAE is ${mae} — prediction accuracy severely degraded`, action: 'Run auto-calibration and inspect per-niche error distribution' });
    else if (mae != null && mae > 30)    alerts.push({ severity: 'yellow', type: 'elevated_mae',    message: `MAE is ${mae} — above healthy threshold of 30`, action: 'Monitor trend over next 48h; consider manual calibration if rising' });
    if (maeDelta24h != null && maeDelta24h > mae * 0.25)
                                          alerts.push({ severity: 'red',    type: 'mae_spike',       message: `MAE increased ${maeDelta24h.toFixed(1)} pts in 24h (>25% spike)`, action: 'Check benchmark drift and recent synthetic calibration quality' });
    if (synthRatio != null && synthRatio >= 0.95)
                                          alerts.push({ severity: 'yellow', type: 'synthetic_dominance', message: `${Math.round(synthRatio * 100)}% synthetic data — real creator predictions near zero`, action: 'Encourage users to make predictions via TitleThumbnailScorer' });
    if (benchZero > 5)                    alerts.push({ severity: 'yellow', type: 'benchmark_gaps',  message: `${benchZero} niche/duration combinations have zero benchmarks`, action: 'Run Recompute Patterns or add more channels for affected niches' });
    if (total > 0 && stats.stale_30d / total > 0.20)
                                          alerts.push({ severity: 'yellow', type: 'stale_outcomes',  message: `${Math.round((stats.stale_30d / total) * 100)}% of calibration data is older than 30 days`, action: 'Run Snapshot Refresh to regenerate stale outcome scores' });
    if (trust < 30)                       alerts.push({ severity: 'red',    type: 'low_trust',       message: `Calibration trust score is critically low (${trust}/100)`, action: 'Accumulate real predictions and ensure benchmark data is healthy' });

    res.json({
      ok: true,
      kpis: {
        mae:               { current: mae,        delta_24h: maeDelta24h,   delta_7d: maeDelta7d,  lower_is_better: true },
        calibration_trust: { current: trust,       delta_24h: trustDelta24h, delta_7d: trustDelta7d, lower_is_better: false },
        learning_velocity: { label: velocity },
        synthetic_ratio:   { current: synthRatio,  real_rows: real, synthetic_rows: synth, lower_is_better: true },
        benchmark_health:  { score: benchHealth, zero_count: benchZero, coverage_niches: benchCoverage, total_benchmarks: benchTotal },
        stale_outcomes:    { count_1d: stats.stale_1d ?? 0, count_7d: stats.stale_7d ?? 0, count_30d: stats.stale_30d ?? 0, total },
      },
      alerts,
      totals: { total, real, synthetic: synth },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/learning-history ─────────────────────────────────
router.get('/admin/evolution/learning-history', (req, res) => {
  try {
    const db   = getDb();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '30', 10)));
    const rows = getLearningHistory(db, days);

    // Fallback: derive daily MAE from video_outcomes when snapshots are sparse
    let fallback = [];
    if (rows.length < 2) {
      fallback = db.all(
        `SELECT DATE(created_at) AS snapshot_date,
           ROUND(AVG(ABS(calibration_error)), 3) AS mae,
           COUNT(*) AS total_calibration_rows,
           SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) AS synthetic_rows,
           SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_rows
         FROM video_outcomes
         WHERE actual_performance_score IS NOT NULL
           AND created_at >= datetime('now', ?)
         GROUP BY DATE(created_at) ORDER BY snapshot_date ASC`,
        [`-${days} days`],
      );
    }

    res.json({ ok: true, rows: rows.length >= 2 ? rows : fallback, source: rows.length >= 2 ? 'snapshots' : 'live_derived' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/niche-intelligence ───────────────────────────────
router.get('/admin/evolution/niche-intelligence', (_req, res) => {
  try {
    const db    = getDb();
    const niches = getNicheLearningStats(db);

    const benchmarks = db.all(
      `SELECT niche, AVG(median_vph) AS avg_median_vph, MAX(computed_at) AS last_computed
       FROM niche_benchmarks WHERE bucket = '7d' AND median_vph > 0
       GROUP BY niche`,
    );
    const benchMap = {};
    for (const b of benchmarks) benchMap[b.niche] = b;

    const result = niches.map(r => {
      const b    = benchMap[r.niche] ?? null;
      const trend = r.avg_error > 10 ? 'over' : r.avg_error < -10 ? 'under' : 'calibrated';
      return {
        ...r,
        trend,
        has_benchmark:       !!b,
        benchmark_freshness: b?.last_computed ?? null,
      };
    });

    res.json({ ok: true, niches: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/calibration-distributions ───────────────────────
router.get('/admin/evolution/calibration-distributions', (_req, res) => {
  try {
    const db   = getDb();
    const dist = getCalibrationDistributions(db);
    res.json({ ok: true, ...dist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/evolution/learning-events ──────────────────────────────────
router.get('/admin/evolution/learning-events', (_req, res) => {
  try {
    const db    = getDb();
    const data  = getLearningEvents(db, 60);

    const calibEvents = (data.calibration_events ?? []).map(v => {
      let weightDelta = 0;
      try {
        const w = JSON.parse(v.changed_weights_json || '{}');
        weightDelta = parseFloat(Object.values(w).reduce((s, x) => s + Math.abs(x), 0).toFixed(3));
      } catch {}
      return {
        id:          v.id,
        type:        'calibration',
        created_at:  v.created_at,
        trigger:     v.trigger,
        health_score: v.health_score,
        velocity:    v.learning_velocity,
        weight_delta: weightDelta,
        notes:       v.notes,
        severity:    v.health_score != null && v.health_score < 40 ? 'red' : weightDelta > 0.3 ? 'yellow' : 'info',
      };
    });

    const synthEvents = (data.synthetic_runs ?? []).map(r => ({
      id:         `synth_${r.run_date}`,
      type:       'synthetic_run',
      created_at: r.run_date,
      trigger:    'cron',
      rows_inserted: r.rows_inserted,
      mae:        r.mae != null ? parseFloat(Number(r.mae).toFixed(2)) : null,
      severity:   'info',
    }));

    const events = [...calibEvents, ...synthEvents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 80);

    res.json({ ok: true, events });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/admin/evolution/learning-snapshot ───────────────────────────────
router.post('/admin/evolution/learning-snapshot', async (_req, res) => {
  try {
    const result = await runLearningSnapshotCycle();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/admin/confidence/report ─────────────────────────────────────────
// Live confidence scores for all features × all active niches.
// Also returns system-wide aggregate and routing distribution.
router.get('/admin/confidence/report', (req, res) => {
  try {
    const db     = getDb();
    const niches = getActiveNiches(db);

    // Compute system-wide (niche=null) + per-niche
    const allResults = computeAllConfidences(db, [null, ...niches]);

    // Group by feature for easy frontend consumption
    const byFeature = {};
    for (const f of FEATURES) {
      const rows = allResults.filter(r => r.feature === f);
      const sysRow = rows.find(r => r.niche === null);
      const nicheRows = rows.filter(r => r.niche !== null).sort((a, b) => b.confidence - a.confidence);
      byFeature[f] = {
        system:   sysRow ?? null,
        by_niche: nicheRows,
        avg_confidence: nicheRows.length
          ? parseFloat((nicheRows.reduce((s, r) => s + r.confidence, 0) / nicheRows.length).toFixed(1))
          : 0,
      };
    }

    const nicheOnlyResults = allResults.filter(r => r.niche !== null);
    const systemDist       = computeRoutingDistribution(nicheOnlyResults);

    res.json({
      generated_at:        new Date().toISOString(),
      active_niches:       niches.length,
      features:            FEATURES,
      by_feature:          byFeature,
      system_distribution: systemDist,
      routing_thresholds:  { autonomous: 80, local_first: 60, hybrid: 40, mandatory_claude: 0 },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/confidence/history ─────────────────────────────────────────
// Historical confidence snapshots from learning_confidence_history.
// Query params: days (default 30), feature (filter to one feature), niche (filter)
router.get('/admin/confidence/history', (req, res) => {
  try {
    const db   = getDb();
    const days = parseInt(req.query.days, 10) || 30;
    let rows   = getConfidenceHistory(db, days);

    if (req.query.feature) rows = rows.filter(r => r.feature === req.query.feature);
    if (req.query.niche)   rows = rows.filter(r => r.niche   === req.query.niche);

    // Parse routing_distribution_json
    const parsed = rows.map(r => ({
      ...r,
      routing_distribution: tryParse(r.routing_distribution_json, {}),
    }));

    res.json({ days, rows: parsed, count: parsed.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/confidence/snapshot ──────────────────────────────────────
// Manually trigger a confidence snapshot (same as daily cron).
router.post('/admin/confidence/snapshot', (req, res) => {
  try {
    const result = runConfidenceSnapshot();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/evolution/history-dashboard ────────────────────────────────
// Joins learning_health_snapshots + learning_confidence_history for the History subtab.
// Returns: health_timeline, confidence_timeline, routing_timeline, niche_rankings, deltas.
router.get('/admin/evolution/history-dashboard', (req, res) => {
  try {
    const db     = getDb();
    const days   = parseInt(req.query.days, 10) || 30;
    const cutoff = `-${days} days`;

    // 1. Health timeline from learning_health_snapshots
    const healthRows = db.all(
      `SELECT snapshot_date, mae, calibration_trust_score, synthetic_ratio,
              benchmark_drift, stale_outcomes, total_calibration_rows, real_rows, synthetic_rows
       FROM learning_health_snapshots
       WHERE snapshot_date >= date('now', ?)
       ORDER BY snapshot_date ASC`,
      [cutoff],
    );

    // 2. Per-feature confidence timeline (niche='__all__', feature != '__all__')
    const confRows = db.all(
      `SELECT snapshot_date, feature, avg_confidence, fallback_rate, routing_distribution_json
       FROM learning_confidence_history
       WHERE snapshot_date >= date('now', ?)
         AND niche = '__all__'
         AND feature != '__all__'
       ORDER BY snapshot_date ASC, feature ASC`,
      [cutoff],
    );

    // 3. System-wide routing timeline (feature='__all__', niche='__all__')
    const sysRows = db.all(
      `SELECT snapshot_date, avg_confidence, fallback_rate, routing_distribution_json
       FROM learning_confidence_history
       WHERE snapshot_date >= date('now', ?)
         AND feature = '__all__'
         AND niche   = '__all__'
       ORDER BY snapshot_date ASC`,
      [cutoff],
    );

    const routingTimeline = sysRows.map(r => {
      const d    = tryParse(r.routing_distribution_json, {});
      // routing_distribution_json stores { counts: {...}, pcts: {...}, fallback_rate }
      const pcts = d.pcts ?? d; // fall back to flat structure for backwards compat
      return {
        snapshot_date:        r.snapshot_date,
        avg_confidence:       r.avg_confidence,
        fallback_rate:        r.fallback_rate ?? d.fallback_rate ?? 0,
        autonomous_pct:       pcts.autonomous       ?? 0,
        local_first_pct:      pcts.local_first      ?? 0,
        hybrid_pct:           pcts.hybrid           ?? 0,
        mandatory_claude_pct: pcts.mandatory_claude ?? 0,
      };
    });

    // 4. Niche rankings — latest available snapshot
    const latestNicheDate = db.get(
      `SELECT MAX(snapshot_date) AS d FROM learning_confidence_history WHERE feature = '__all__' AND niche != '__all__'`
    )?.d;
    const nicheRows = latestNicheDate ? db.all(
      `SELECT niche, avg_confidence, fallback_rate
       FROM learning_confidence_history
       WHERE feature = '__all__' AND niche != '__all__' AND snapshot_date = ?
       ORDER BY avg_confidence DESC`,
      [latestNicheDate],
    ) : [];

    // 5. Deltas: current vs yesterday, vs 7d average, vs 30d average
    function computeDeltas(rows, key) {
      if (!rows.length) return null;
      const sorted  = [...rows].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));
      const current = sorted[0][key];
      if (current == null) return null;
      const prev    = sorted[1]?.[key] ?? null;
      const d7      = new Date(Date.now() -  7 * 86400000).toISOString().slice(0, 10);
      const d30     = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const near7   = rows.filter(r => r.snapshot_date <= d7  && r[key] != null);
      const near30  = rows.filter(r => r.snapshot_date <= d30 && r[key] != null);
      const avg     = arr => arr.length ? parseFloat((arr.reduce((s, r) => s + r[key], 0) / arr.length).toFixed(2)) : null;
      const fmt     = ref => ref != null ? parseFloat((current - ref).toFixed(2)) : null;
      return { current, vs_yesterday: fmt(prev), vs_7d_avg: fmt(avg(near7)), vs_30d_avg: fmt(avg(near30)) };
    }

    res.json({
      ok:                  true,
      days,
      health_timeline:     healthRows,
      confidence_timeline: confRows,
      routing_timeline:    routingTimeline,
      niche_rankings:      { top: nicheRows.slice(0, 10), worst: [...nicheRows].reverse().slice(0, 10) },
      deltas: {
        mae:               computeDeltas(healthRows, 'mae'),
        calibration_trust: computeDeltas(healthRows, 'calibration_trust_score'),
        avg_confidence:    computeDeltas(sysRows, 'avg_confidence'),
        fallback_rate:     computeDeltas(sysRows, 'fallback_rate'),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/confidence/correctness ─────────────────────────────────────
// Live confidence correctness: Pearson correlation + bucketed MAE + alerts.
router.get('/admin/confidence/correctness', (_req, res) => {
  try {
    const db = getDb();
    const result = computeConfidenceCorrectness(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/intelligence/routing/analytics ─────────────────────────────
// Routing distribution, token savings, fallback reasons.
router.get('/admin/intelligence/routing/analytics', (req, res) => {
  try {
    const db   = getDb();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '7', 10)));
    const data = getRoutingAnalytics(db, days);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/learning/niche-reliability ─────────────────────────────────
// Per-niche reliability scores (Phase E).
router.get('/admin/learning/niche-reliability', (_req, res) => {
  try {
    const db   = getDb();
    const rows = getAllNicheReliability(db);
    res.json({ ok: true, niches: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/learning/cohort-analysis ───────────────────────────────────
// Temporal cohort snapshots: window=7d|30d|90d, optional niche filter.
router.get('/admin/learning/cohort-analysis', (req, res) => {
  try {
    const db     = getDb();
    const window = req.query.window ?? null;
    const niche  = req.query.niche  ?? null;
    const days   = Math.min(365, Math.max(7, parseInt(req.query.days ?? '90', 10)));
    const rows   = getCohortSnapshots(db, { window, niche, days });
    res.json({ ok: true, snapshots: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/learning/decay-analysis ────────────────────────────────────
// Freshness weight distribution + timeline (Phase E).
router.get('/admin/learning/decay-analysis', (_req, res) => {
  try {
    const db   = getDb();
    const data = getFreshnessDecayAnalysis(db);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/learning/disagreement-stats ────────────────────────────────
// Human override / disagreement analysis (Phase E).
router.get('/admin/learning/disagreement-stats', (req, res) => {
  try {
    const db   = getDb();
    const days = Math.min(365, Math.max(1, parseInt(req.query.days ?? '90', 10)));
    const rows = getDisagreementStats(db, days);
    res.json({ ok: true, niches: rows, total: rows.length, window_days: days });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/learning/synthetic-transition ──────────────────────────────
// Per-niche synthetic → real transition progress (Phase E).
router.get('/admin/learning/synthetic-transition', (_req, res) => {
  try {
    const db   = getDb();
    const rows = getSyntheticTransitionStatus(db);
    res.json({ ok: true, niches: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
