'use strict';

// Daily cron: snapshot system-wide confidence scores by feature and niche.
// Runs at 03:00 UTC — 1 hour after learningSnapshotCron (02:00 UTC).
// Stores aggregated confidence in learning_confidence_history for trending.

const cron = require('node-cron');
const { getDb }        = require('../db/init');
const { insertConfidenceMetric, insertConfidenceHistorySnapshot, updateConfidenceHistoryCorrectness } = require('../db/queries');
const { computeConfidenceCorrectness } = require('../services/confidenceValidation');
const {
  FEATURES,
  computeAllConfidences,
  computeRoutingDistribution,
  getActiveNiches,
} = require('../services/confidenceEngine');

function runConfidenceSnapshot() {
  const db   = getDb();
  const date = new Date().toISOString().slice(0, 10);
  const niches = getActiveNiches(db);

  // Compute for: each niche + system-wide (null)
  const allResults = computeAllConfidences(db, [null, ...niches]);

  // ── Write individual metric rows for the latest run ───────────────────────
  for (const r of allResults) {
    try {
      insertConfidenceMetric(db, {
        feature:            r.feature,
        niche:              r.niche,
        confidence_score:   r.confidence,
        sample_depth_score: r.components.sample_depth_score ?? 0,
        recency_score:      r.components.recency_score      ?? 0,
        coverage_score:     r.components.coverage_score     ?? 0,
        real_ratio_score:   r.components.real_ratio_score   ?? 0,
        stability_score:    r.components.stability_score    ?? 0,
        routing_decision:   r.routing_decision,
        reasons_json:       r.reasons,
      });
    } catch { /* non-fatal */ }
  }

  // ── Aggregate by feature (across all niches) and write history rows ───────
  for (const feature of FEATURES) {
    const featureRows = allResults.filter(r => r.feature === feature && r.niche !== null);
    if (!featureRows.length) continue;

    const avgConf     = featureRows.reduce((s, r) => s + r.confidence, 0) / featureRows.length;
    const dist        = computeRoutingDistribution(featureRows);

    try {
      insertConfidenceHistorySnapshot(db, {
        snapshot_date:            date,
        feature,
        niche:                    '__all__',
        avg_confidence:           parseFloat(avgConf.toFixed(1)),
        routing_distribution_json: dist,
        fallback_rate:             dist.fallback_rate,
      });
    } catch { /* duplicate on re-run — safe to ignore */ }
  }

  // ── Aggregate by niche (across all features) and write history rows ───────
  for (const niche of niches) {
    const nicheRows = allResults.filter(r => r.niche === niche);
    if (!nicheRows.length) continue;

    const avgConf = nicheRows.reduce((s, r) => s + r.confidence, 0) / nicheRows.length;
    const dist    = computeRoutingDistribution(nicheRows);

    try {
      insertConfidenceHistorySnapshot(db, {
        snapshot_date:            date,
        feature:                  '__all__',
        niche,
        avg_confidence:           parseFloat(avgConf.toFixed(1)),
        routing_distribution_json: dist,
        fallback_rate:             dist.fallback_rate,
      });
    } catch { /* duplicate — safe */ }
  }

  // ── System-wide row ───────────────────────────────────────────────────────
  const sysRows = allResults.filter(r => r.niche !== null);
  if (sysRows.length) {
    const avgConf = sysRows.reduce((s, r) => s + r.confidence, 0) / sysRows.length;
    const dist    = computeRoutingDistribution(sysRows);
    try {
      insertConfidenceHistorySnapshot(db, {
        snapshot_date:            date,
        feature:                  '__all__',
        niche:                    '__all__',
        avg_confidence:           parseFloat(avgConf.toFixed(1)),
        routing_distribution_json: dist,
        fallback_rate:             dist.fallback_rate,
      });
    } catch { /* duplicate */ }
  }

  // ── Compute and persist confidence correctness ────────────────────────────
  try {
    const correctness = computeConfidenceCorrectness(db);
    updateConfidenceHistoryCorrectness(db, {
      snapshot_date:                    date,
      confidence_accuracy_correlation:  correctness.correlation,
      high_confidence_mae:              correctness.bucketed_mae.high,
      medium_confidence_mae:            correctness.bucketed_mae.medium,
      low_confidence_mae:               correctness.bucketed_mae.low,
      routing_accuracy_score:           correctness.routing_accuracy_score,
    });
  } catch (e) {
    console.warn('[confidenceCron] correctness update failed:', e.message);
  }

  const dist = computeRoutingDistribution(allResults.filter(r => r.niche !== null));
  return {
    ok:            true,
    date,
    niches_scored: niches.length,
    total_rows:    allResults.length,
    system_dist:   dist,
  };
}

function startLearningConfidenceCron() {
  // 03:00 UTC daily — after learningSnapshotCron at 02:00 UTC
  cron.schedule('0 3 * * *', () => {
    try {
      const result = runConfidenceSnapshot();
      console.log('[confidenceCron] snapshot complete', JSON.stringify(result));
    } catch (e) {
      console.error('[confidenceCron] error:', e.message);
    }
  });
}

module.exports = { startLearningConfidenceCron, runConfidenceSnapshot };
