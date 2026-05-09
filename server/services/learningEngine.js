// Pure learning analytics — no DB access, no side effects, advisory only.
// All outputs are recommendations; none are applied automatically.

const crypto = require('crypto');

const EXPECTED_ACCURACY = Object.freeze({
  high:     0.80,
  medium:   0.60,
  low:      0.40,
  degraded: 0.30,
  unknown:  null,
});

const MIN_NICHE   = 5;
const MIN_BUCKET  = 3;
const MIN_PATTERN = 3;
const BIAS_TRIGGER = 5; // |avg_error| threshold to emit a calibration recommendation

function recId(type, scope, issue) {
  return crypto.createHash('sha1')
    .update(`${type}:${scope ?? 'global'}:${issue}`)
    .digest('hex')
    .slice(0, 12);
}

function bayesConf(n) {
  return parseFloat(Math.min(0.95, n / (n + 20)).toFixed(3));
}

function clampAdj(avg_error) {
  return Math.max(-20, Math.min(20, Math.round(-avg_error / 2)));
}

function nowIso() { return new Date().toISOString(); }

function groupByKey(rows, key) {
  const map = {};
  for (const r of rows) {
    const k = r[key] ?? 'unknown';
    if (!map[k]) map[k] = [];
    map[k].push(r);
  }
  return map;
}

function stats(errors) {
  const n       = errors.length;
  const avg     = errors.reduce((s, e) => s + e, 0) / n;
  const mae     = errors.reduce((s, e) => s + Math.abs(e), 0) / n;
  return { n, avg, mae };
}

// ── Phase 2: Calibration Recommendations ──────────────────────────────────────

function computeCalibrationRecommendations(rows) {
  if (!rows || rows.length === 0) return [];

  const byNiche = groupByKey(rows, 'niche');
  const recs    = [];

  for (const [niche, nicheRows] of Object.entries(byNiche)) {
    const errors = nicheRows.map(r => r.calibration_error);
    if (errors.length < MIN_NICHE) continue;

    const { n, avg, mae } = stats(errors);
    if (Math.abs(avg) < BIAS_TRIGGER) continue;

    const issue               = avg > 0 ? 'systematic_overprediction' : 'systematic_underprediction';
    const suggested_adjustment = clampAdj(avg);
    const confidence           = bayesConf(n);

    recs.push({
      id:                   recId('score_bias', niche, issue),
      type:                 'score_bias',
      niche,
      issue,
      recommendation:       `Adjust score predictions for "${niche}" by ${suggested_adjustment > 0 ? '+' : ''}${suggested_adjustment} points`,
      rationale:            `Mean calibration error of ${avg.toFixed(1)} across ${n} samples indicates ${issue.replace(/_/g, ' ')}`,
      average_error:        parseFloat(avg.toFixed(2)),
      mae:                  parseFloat(mae.toFixed(2)),
      suggested_adjustment,
      confidence,
      sample_size:          n,
      created_at:           nowIso(),
      status:               'pending',
    });
  }

  return recs.sort((a, b) => Math.abs(b.average_error) - Math.abs(a.average_error));
}

// ── Phase 3: Confidence Reliability ───────────────────────────────────────────

function computeConfidenceReliability(rows) {
  if (!rows || rows.length === 0) return {};

  const byConf = groupByKey(rows, 'confidence_state');
  const result = {};

  for (const [key, bucketRows] of Object.entries(byConf)) {
    if (bucketRows.length < MIN_BUCKET) continue;
    const errors   = bucketRows.map(r => r.calibration_error);
    const accurate = errors.filter(e => Math.abs(e) <= 10).length;
    const actual_accuracy    = parseFloat((accurate / errors.length).toFixed(3));
    const expected_accuracy  = EXPECTED_ACCURACY[key] ?? null;
    const reliability_gap    = expected_accuracy != null
      ? parseFloat((actual_accuracy - expected_accuracy).toFixed(3))
      : null;

    result[key] = {
      expected_accuracy,
      actual_accuracy,
      reliability_gap,
      sample_size: errors.length,
    };
  }
  return result;
}

// ── Phase 4: Niche Learning ────────────────────────────────────────────────────

function computeNicheLearning(rows) {
  if (!rows || rows.length === 0) return [];

  const byNiche = groupByKey(rows, 'niche');
  const recs    = [];

  for (const [niche, nicheRows] of Object.entries(byNiche)) {
    const errors = nicheRows.map(r => r.calibration_error);
    if (errors.length < MIN_NICHE) continue;

    const { n, avg, mae } = stats(errors);

    let issue, recommendation, rationale;

    if (avg > 10) {
      issue          = 'persistent_overprediction';
      recommendation = `Reduce predicted scores for "${niche}" — consistent overprediction detected`;
      rationale      = `Mean error of +${avg.toFixed(1)} across ${n} samples indicates structural score inflation`;
    } else if (avg < -10) {
      issue          = 'persistent_underprediction';
      recommendation = `Increase predicted scores for "${niche}" — consistent underprediction detected`;
      rationale      = `Mean error of ${avg.toFixed(1)} across ${n} samples indicates structural score deflation`;
    } else if (mae > 20 && Math.abs(avg) < 5) {
      issue          = 'volatile';
      recommendation = `Prediction variance in "${niche}" is high — scoring signals may be unreliable`;
      rationale      = `MAE of ${mae.toFixed(1)} with near-zero mean bias (${avg.toFixed(1)}) indicates high error scatter`;
    } else if (mae > 20) {
      issue          = 'unstable_accuracy';
      recommendation = `Review scoring signals for "${niche}" — high calibration error detected`;
      rationale      = `MAE of ${mae.toFixed(1)} across ${n} samples — prediction consistency needs investigation`;
    } else {
      continue;
    }

    recs.push({
      id:          recId('niche_learning', niche, issue),
      type:        'niche_learning',
      niche,
      issue,
      recommendation,
      rationale,
      avg_error:   parseFloat(avg.toFixed(2)),
      mae:         parseFloat(mae.toFixed(2)),
      confidence:  bayesConf(n),
      sample_size: n,
      created_at:  nowIso(),
      status:      'pending',
    });
  }

  return recs.sort((a, b) => b.mae - a.mae);
}

// ── Phase 5: Pattern Detection ────────────────────────────────────────────────

function computePatternFailures(outcomeRows, degradedRows, hookRows) {
  const patterns = [];
  const ts       = nowIso();

  // Pattern 1: Degraded pipeline failures
  if (degradedRows && degradedRows.length >= MIN_PATTERN) {
    const total   = degradedRows.length;
    const failures = degradedRows.filter(r => Math.abs(r.calibration_error) > 10).length;
    const failure_rate = parseFloat((failures / total).toFixed(3));
    if (failure_rate > 0.40) {
      patterns.push({
        id:             recId('pattern_detection', 'global', 'degraded_mode_failures'),
        type:           'pattern_detection',
        pattern:        'degraded_mode_failures',
        occurrences:    total,
        failure_rate,
        severity:       failure_rate > 0.70 ? 'critical' : 'warning',
        recommendation: 'Degraded-mode predictions are frequently inaccurate — consider restricting fallback scoring',
        rationale:      `${(failure_rate * 100).toFixed(0)}% of ${total} degraded-mode predictions exceeded ±10 calibration error`,
        confidence:     bayesConf(total),
        sample_size:    total,
        created_at:     ts,
        status:         'pending',
      });
    }
  }

  // Pattern 2: Systematic overprediction (global)
  if (outcomeRows && outcomeRows.length >= MIN_PATTERN) {
    const total    = outcomeRows.length;
    const overCount = outcomeRows.filter(r => r.calibration_error > 10).length;
    const failure_rate = parseFloat((overCount / total).toFixed(3));
    if (failure_rate > 0.65 && total >= MIN_NICHE) {
      patterns.push({
        id:             recId('pattern_detection', 'global', 'systematic_overprediction'),
        type:           'pattern_detection',
        pattern:        'systematic_overprediction',
        occurrences:    overCount,
        failure_rate,
        severity:       failure_rate > 0.80 ? 'critical' : 'warning',
        recommendation: 'System is overpredicting across all niches — global score adjustment may be needed',
        rationale:      `${(failure_rate * 100).toFixed(0)}% of ${total} calibrated predictions had calibration_error > 10`,
        confidence:     bayesConf(total),
        sample_size:    total,
        created_at:     ts,
        status:         'pending',
      });
    }
  }

  // Pattern 3: High-confidence misses
  if (outcomeRows && outcomeRows.length >= MIN_PATTERN) {
    const highConf  = outcomeRows.filter(r => r.confidence_state === 'high');
    if (highConf.length >= MIN_PATTERN) {
      const misses       = highConf.filter(r => Math.abs(r.calibration_error) > 10).length;
      const failure_rate = parseFloat((misses / highConf.length).toFixed(3));
      if (failure_rate > 0.40) {
        patterns.push({
          id:             recId('pattern_detection', 'global', 'high_confidence_misses'),
          type:           'pattern_detection',
          pattern:        'high_confidence_misses',
          occurrences:    misses,
          failure_rate,
          severity:       failure_rate > 0.60 ? 'critical' : 'warning',
          recommendation: 'High-confidence predictions are frequently wrong — confidence labeling needs recalibration',
          rationale:      `${(failure_rate * 100).toFixed(0)}% of ${highConf.length} high-confidence predictions exceeded ±10 calibration error`,
          confidence:     bayesConf(highConf.length),
          sample_size:    highConf.length,
          created_at:     ts,
          status:         'pending',
        });
      }
    }
  }

  // Pattern 4: Hook-type failures
  if (hookRows && hookRows.length >= MIN_PATTERN) {
    const byHook = groupByKey(hookRows, 'hook_type');
    for (const [hook_type, hRows] of Object.entries(byHook)) {
      const errors = hRows.map(r => r.calibration_error).filter(e => e != null);
      if (errors.length < MIN_PATTERN) continue;
      const { n, avg } = stats(errors);
      if (Math.abs(avg) <= 10) continue;

      const overrated = avg > 0;
      patterns.push({
        id:             recId('pattern_detection', hook_type, 'hook_type_bias'),
        type:           'pattern_detection',
        pattern:        overrated ? 'hook_type_overrated' : 'hook_type_underrated',
        hook_type,
        occurrences:    n,
        failure_rate:   parseFloat((Math.abs(avg) / 100).toFixed(3)),
        severity:       Math.abs(avg) > 20 ? 'critical' : 'warning',
        recommendation: `"${hook_type}" hooks are systematically ${overrated ? 'over' : 'under'}rated — review hook-type scoring weight`,
        rationale:      `Mean calibration error of ${avg.toFixed(1)} across ${n} "${hook_type}" hook predictions`,
        confidence:     bayesConf(n),
        sample_size:    n,
        created_at:     ts,
        status:         'pending',
      });
    }
  }

  return patterns;
}

// ── Learning health rollup ─────────────────────────────────────────────────────

function computeLearningHealth(allRecs, outcomeRows) {
  const dataPoints         = outcomeRows?.length ?? 0;
  const recommendationCount = allRecs?.length ?? 0;
  const avgConfidence      = recommendationCount > 0
    ? parseFloat((allRecs.reduce((s, r) => s + (r.confidence ?? 0), 0) / recommendationCount).toFixed(3))
    : null;

  const topDriftNiche = [...(allRecs ?? [])]
    .filter(r => r.mae != null)
    .sort((a, b) => b.mae - a.mae)[0]?.niche ?? null;

  let status = 'insufficient_data';
  if (dataPoints >= 50) {
    const hasCritical = allRecs.some(r => r.severity === 'critical');
    status = hasCritical ? 'warning' : 'stable';
  } else if (dataPoints >= 10) {
    status = 'learning';
  }

  return { status, dataPoints, recommendationCount, avgConfidence, topDriftNiche, lastAnalyzed: nowIso() };
}

// ── Observational benchmark recommendations ───────────────────────────────────
// Separate signal from prediction calibration — uses niche_benchmarks derived
// from ingested historical videos, NOT from our own prediction errors.
// Detects niches that systematically outperform or underperform market median.

const OBS_MIN_SAMPLE        = 10;  // higher bar than prediction-based
const OBS_REFERENCE_BUCKET  = '30d';
const OBS_REFERENCE_DUR     = 'medium';
const OBS_SAV_DEVIATION_MIN = 0.20; // 20% deviation from cross-niche median to qualify
const OBS_MAX_ADJUSTMENT    = 8;    // bounded lower than prediction-based max

/**
 * @param {Object} benchmarkMap  Nested map from loadBenchmarkMap(): { niche: { bucket: { dur_bucket: row } } }
 * @returns {Array} Observational calibration recommendations, type='observational_niche_signal'
 */
function computeObservationalRecommendations(benchmarkMap) {
  if (!benchmarkMap || !Object.keys(benchmarkMap).length) return [];

  // Collect per-niche SAV reference — prefer 30d/medium, fall back to other dur buckets
  const nicheSAVs = [];
  for (const [niche, buckets] of Object.entries(benchmarkMap)) {
    const refBucket = buckets[OBS_REFERENCE_BUCKET];
    if (!refBucket) continue;
    const row = refBucket[OBS_REFERENCE_DUR]
      ?? refBucket['short']
      ?? refBucket['long']
      ?? refBucket['unknown'];
    if (!row || row.sample_size < OBS_MIN_SAMPLE || row.median_sav == null) continue;
    nicheSAVs.push({ niche, sav: row.median_sav, sample_size: row.sample_size });
  }

  if (nicheSAVs.length < 2) return []; // need at least two niches for a reference

  // Cross-niche median SAV (sample-weighted centroid)
  const totalWeight  = nicheSAVs.reduce((s, r) => s + r.sample_size, 0);
  const weightedMean = nicheSAVs.reduce((s, r) => s + r.sav * r.sample_size, 0) / totalWeight;
  if (weightedMean <= 0) return [];

  const recs = [];
  for (const { niche, sav, sample_size } of nicheSAVs) {
    const deviation = (sav - weightedMean) / weightedMean;
    if (Math.abs(deviation) < OBS_SAV_DEVIATION_MIN) continue;

    // Scale to adjustment: ±OBS_MAX_ADJUSTMENT at 100% deviation
    const raw_adjustment = deviation * OBS_MAX_ADJUSTMENT;
    const suggested_adjustment = Math.max(-OBS_MAX_ADJUSTMENT, Math.min(OBS_MAX_ADJUSTMENT,
      parseFloat(raw_adjustment.toFixed(1)),
    ));
    if (suggested_adjustment === 0) continue;

    const issue      = deviation > 0 ? 'market_outperformer' : 'market_underperformer';
    const confidence = bayesConf(sample_size);

    recs.push({
      id:                   recId('observational_niche_signal', niche, issue),
      type:                 'observational_niche_signal',
      niche,
      issue,
      recommendation:       `Observational data suggests "${niche}" ${deviation > 0 ? 'outperforms' : 'underperforms'} market median — apply ${suggested_adjustment > 0 ? '+' : ''}${suggested_adjustment} point bias`,
      rationale:            `Subscriber-adjusted velocity ${Math.abs(deviation * 100).toFixed(0)}% ${deviation > 0 ? 'above' : 'below'} cross-niche median across ${sample_size} videos`,
      sav_ratio:            parseFloat((sav / weightedMean).toFixed(3)),
      deviation_pct:        parseFloat((deviation * 100).toFixed(1)),
      suggested_adjustment,
      confidence,
      sample_size,
      created_at:           nowIso(),
      status:               'pending',
    });
  }

  return recs.sort((a, b) => Math.abs(b.suggested_adjustment) - Math.abs(a.suggested_adjustment));
}

module.exports = {
  computeCalibrationRecommendations,
  computeConfidenceReliability,
  computeNicheLearning,
  computePatternFailures,
  computeLearningHealth,
  computeObservationalRecommendations,
};
