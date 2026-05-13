'use strict';

// E5 — Temporal Cohort Analysis.
// Computes 7d / 30d / 90d windowed snapshots of learning quality per niche.
// Runs daily at 03:00 UTC (after the 02:00 health snapshot).

const cron   = require('node-cron');
const { getDb }              = require('../db/init');
const logger                 = require('../utils/logger');
const { upsertCohortSnapshot } = require('../db/queries');

const WINDOWS = [
  { key: '7d',  days: 7  },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
];

function computeCohortForWindow(db, windowKey, days) {
  const cutoff = `-${days} days`;
  const today  = new Date().toISOString().slice(0, 10);

  // All niches that have outcomes within this window
  const niches = db.all(
    `SELECT DISTINCT LOWER(TRIM(COALESCE(niche, 'unknown'))) AS niche
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND COALESCE(last_refreshed_at, created_at) >= datetime('now', ?)`,
    [cutoff],
  ).map(r => r.niche);

  const saved = [];

  // System-wide aggregate
  const allStats = computeWindowStats(db, cutoff, null);
  if (allStats) {
    upsertCohortSnapshot(db, { cohort_window: windowKey, snapshot_date: today, niche: '__all__', ...allStats });
    saved.push('__all__');
  }

  // Per-niche
  for (const niche of niches) {
    const stats = computeWindowStats(db, cutoff, niche);
    if (stats) {
      upsertCohortSnapshot(db, { cohort_window: windowKey, snapshot_date: today, niche, ...stats });
      saved.push(niche);
    }
  }

  return saved.length;
}

function computeWindowStats(db, cutoff, niche) {
  const nicheClause = niche ? `AND LOWER(TRIM(COALESCE(vo.niche, 'unknown'))) = ?` : '';
  const params      = niche ? [cutoff, niche] : [cutoff];

  const stats = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_outcomes,
       SUM(CASE WHEN pipeline_version = 'synthetic_b'  THEN 1 ELSE 0 END) AS synthetic_count,
       AVG(ABS(calibration_error)) AS mae,
       AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END) AS accuracy_rate,
       AVG(COALESCE(freshness_weight, 1.0)) AS avg_freshness_weight
     FROM video_outcomes vo
     WHERE actual_performance_score IS NOT NULL
       AND COALESCE(vo.last_refreshed_at, vo.created_at) >= datetime('now', ?)
       ${nicheClause}`,
    params,
  );

  if (!stats || (stats.total ?? 0) === 0) return null;

  const total = stats.total ?? 0;

  // Disagreement rate from prediction_feedback within window
  const disParams = niche ? [cutoff, niche] : [cutoff];
  const disClause = niche ? `AND LOWER(TRIM(COALESCE(vo2.niche, 'unknown'))) = ?` : '';
  const disStats  = db.get(
    `SELECT
       COUNT(pf.id) AS total_fb,
       SUM(CASE WHEN pf.score_override IS NOT NULL THEN 1 ELSE 0 END) AS overrides
     FROM prediction_feedback pf
     JOIN video_outcomes vo2 ON vo2.prediction_id = pf.prediction_id
     WHERE pf.created_at >= datetime('now', ?)
       ${disClause}`,
    disParams,
  ) ?? {};

  const disagreement_rate = (disStats.total_fb ?? 0) > 0
    ? parseFloat(((disStats.overrides ?? 0) / disStats.total_fb).toFixed(4))
    : null;

  return {
    total_outcomes:       total,
    real_outcomes:        stats.real_outcomes  ?? 0,
    mae:                  stats.mae            != null ? parseFloat(Number(stats.mae).toFixed(3)) : null,
    accuracy_rate:        stats.accuracy_rate  != null ? parseFloat(Number(stats.accuracy_rate).toFixed(4)) : null,
    avg_confidence:       null, // not readily available without joining confidence_metrics
    avg_freshness_weight: stats.avg_freshness_weight != null ? parseFloat(Number(stats.avg_freshness_weight).toFixed(4)) : null,
    disagreement_rate,
    synthetic_ratio:      total > 0 ? parseFloat(((stats.synthetic_count ?? 0) / total).toFixed(4)) : null,
  };
}

function runLearningCohortCycle() {
  const db = getDb();
  let totalSaved = 0;
  for (const { key, days } of WINDOWS) {
    try {
      const saved = computeCohortForWindow(db, key, days);
      totalSaved += saved;
    } catch (err) {
      logger.error('learningCohortCron', `window=${key}: ${err.message}`);
    }
  }
  logger.info('learningCohortCron', `Cohort snapshots saved: ${totalSaved} rows across 3 windows`);
  return { ok: true, rows_saved: totalSaved };
}

function startLearningCohortCron() {
  cron.schedule('0 3 * * *', () => {
    runLearningCohortCycle();
  });
  logger.info('learningCohortCron', 'Scheduled — daily at 03:00 UTC');
}

module.exports = { runLearningCohortCycle, startLearningCohortCron };
