const express  = require('express');
const { getDb } = require('../db/init');
const {
  getMetricsCoverage, getFeedbackStats,
  getOutcomeStats, getOutcomeRowsForDrift,
  getOutcomeRefreshQueueSize, getOutcomeStaleCount,
  getCalibrationTimeline, getConfidenceReliability,
  getNicheDriftMetrics, getPredictionAccuracySummary,
  getCalibrationDistribution, getRecentPredictionErrors,
  getTopDriftingNiches, getPredictionTrendBuckets,
} = require('../db/queries');
const { getStats: quotaStats }        = require('../services/quotaGuard');
const { getUsageStats: explainStats } = require('../services/llmExplain');
const { getRefreshStats }             = require('../jobs/refreshCron');
const { getLookupCounters }           = require('./lookup');
const orchestrator                    = require('../pipeline/orchestrator');
const { isNewPipelineEnabled }        = require('../pipeline/flags');
const { computePredictionAccuracy }   = require('../services/outcomeTracker');
const { computeOutcomeMetrics }       = require('../services/outcomeCollector');
const { computeDriftSignals }         = require('../services/driftAnalytics');
const {
  computeCalibrationTimeline, computeRollingMAE,
  computeCalibrationDistribution, computePredictionBias,
  computePredictionHealth, computeTrendBuckets,
} = require('../services/calibrationAnalytics');
const { computeConfidenceMatrix } = require('../services/confidenceAnalytics');
const { computeNicheDrift }       = require('../services/driftDashboard');

const router = express.Router();

router.get('/metrics', (_req, res) => {
  const db = getDb();

  const { total_videos, training_ready, with_embeddings, with_last_updated } = getMetricsCoverage(db);
  const { stale_count } = db.get(`
    SELECT COUNT(*) AS stale_count FROM videos v
    JOIN performance_metrics pm ON pm.video_id = v.id
    WHERE v.youtube_video_id IS NOT NULL
      AND (v.last_updated_at IS NULL OR
        (julianday('now') - julianday(v.last_updated_at)) * 86400 >
          CASE
            WHEN (julianday('now') - julianday(v.upload_date)) < 3  THEN 21600
            WHEN (julianday('now') - julianday(v.upload_date)) < 14 THEN 86400
            ELSE 604800
          END
      )
  `);

  const byNiche = db.all(`
    SELECT v.niche, COUNT(*) AS count, AVG(pm.performance_score) AS avg_perf
    FROM videos v
    JOIN performance_metrics pm ON pm.video_id = v.id
    WHERE pm.training_ready=1
    GROUP BY v.niche
    ORDER BY count DESC
    LIMIT 10
  `);

  const lookupC       = getLookupCounters();
  const outcomeStats  = getOutcomeStats(db);
  const refreshQ      = getOutcomeRefreshQueueSize(db);
  const staleOutcomes = getOutcomeStaleCount(db);
  const driftRows     = getOutcomeRowsForDrift(db, 100);

  // Analytics aggregation
  const timelineRows   = getCalibrationTimeline(db, 90);
  const confRelRows    = getConfidenceReliability(db);
  const nicheDriftRows = getNicheDriftMetrics(db);
  const topDriftRows   = getTopDriftingNiches(db, 10);
  const summaryRow     = getPredictionAccuracySummary(db);
  const distRows       = getCalibrationDistribution(db);
  const recentErrors   = getRecentPredictionErrors(db, 10);
  const trendRows      = getPredictionTrendBuckets(db);

  const enrichedTimeline = computeCalibrationTimeline(timelineRows);

  res.json({
    db: {
      total_videos,
      training_ready,
      training_ready_pct: total_videos > 0
        ? parseFloat(((training_ready / total_videos) * 100).toFixed(1))
        : 0,
      with_embeddings,
      with_last_updated,
      stale_count,
      by_niche: byNiche,
    },
    quota:           quotaStats(),
    explain:         explainStats(),
    refresh:         getRefreshStats(),
    lookup:          lookupC,
    feedbackMetrics: computePredictionAccuracy(getFeedbackStats(db)),
    outcomeMetrics:  computeOutcomeMetrics(outcomeStats, refreshQ, staleOutcomes),
    driftSignals:    computeDriftSignals(driftRows),
    calibrationDashboard: {
      timeline:     enrichedTimeline,
      trendBuckets: computeTrendBuckets(trendRows),
      distribution: computeCalibrationDistribution(distRows),
      recentErrors,
      bias:         computePredictionBias(summaryRow),
    },
    confidenceMatrix:  computeConfidenceMatrix(confRelRows),
    nicheDrift:        computeNicheDrift(topDriftRows, summaryRow),
    predictionHealth:  computePredictionHealth(summaryRow),
    ...(isNewPipelineEnabled() && { pipeline: orchestrator.getPipelineStats() }),
  });
});

module.exports = router;
