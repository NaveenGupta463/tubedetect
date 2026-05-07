const express  = require('express');
const { getDb }             = require('../db/init');
const { getMetricsCoverage } = require('../db/queries');
const { getStats: quotaStats } = require('../services/quotaGuard');
const { getUsageStats: explainStats } = require('../services/llmExplain');
const { getRefreshStats }   = require('../jobs/refreshCron');
const { getLookupCounters } = require('./lookup');

const router = express.Router();

/**
 * GET /api/metrics
 * Returns system health: DB coverage, quota, LLM usage, cache stats.
 */
router.get('/metrics', (_req, res) => {
  const db = getDb();

  const { total_videos, training_ready, with_embeddings, with_last_updated } = getMetricsCoverage(db);
  const { stale_count }       = db.get(`
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

  const lookupC = getLookupCounters();

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
    quota:   quotaStats(),
    explain: explainStats(),
    refresh: getRefreshStats(),
    lookup:  lookupC,
  });
});

module.exports = router;
