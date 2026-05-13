const cron   = require('node-cron');
const { getDb }    = require('../db/init');
const logger       = require('../utils/logger');
const {
  upsertVideoOutcomeReality,
  getChannelViewHistory,
  updateVideoOutcomeRefresh,
  getBenchmarkRow,
  classifyDurationBucket,
}                  = require('../db/queries');
const { computeActualPerformanceScoreFromVph, computeCalibrationError, getCalibrationBand } = require('../services/calibration');
const { fetchVideoStatsBatch }                     = require('../services/youtubeMetrics');
const {
  computeSignalQuality,
  computeMedian,
  classifyLifecycle,
  computeAlgorithmPushScore,
  detectBreakoutVideo,
  detectFalsePositivePrediction,
  detectFalseNegativePrediction,
}                  = require('../services/realityValidator');

const MAX_REFRESHES_PER_RUN = 25;

let lastRun     = null;
let lastFlagged = 0;

async function runOutcomeRefreshCycle() {
  const db = getDb();

  const stale = db.all(
    `SELECT vo.id, vo.youtube_video_id, vo.prediction_id, vo.refresh_attempts,
            vo.predicted_score, vo.niche, vo.published_at,
            iv.duration_seconds
     FROM video_outcomes vo
     LEFT JOIN ingested_videos iv ON iv.youtube_video_id = vo.youtube_video_id
     WHERE vo.youtube_video_id IS NOT NULL AND vo.published_at IS NOT NULL
       AND (vo.last_refreshed_at IS NULL
            OR vo.last_refreshed_at < datetime('now', '-6 hours'))
     ORDER BY RANDOM()
     LIMIT ?`,
    [MAX_REFRESHES_PER_RUN],
  );

  lastRun = new Date().toISOString();

  if (stale.length === 0) {
    logger.info('outcomeRefreshJob', 'No stale outcomes');
    lastFlagged = 0;
    return;
  }

  const ids = stale.map(r => r.id);
  db.run(
    `UPDATE video_outcomes SET refresh_attempts = refresh_attempts + 1
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );

  logger.info('outcomeRefreshJob', `Flagged ${stale.length} stale outcomes — IDs: ${ids.join(',')}`);
  lastFlagged = stale.length;

  const hasYtKey = !!(process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY);
  if (!hasYtKey) return;

  const ytRows = stale.filter(r => r.youtube_video_id);
  if (!ytRows.length) return;

  let statsMap;
  try {
    statsMap = await fetchVideoStatsBatch(ytRows.map(r => r.youtube_video_id));
  } catch (e) {
    logger.warn('outcomeRefreshJob', `YouTube batch fetch failed: ${e.message}`);
    return;
  }

  const now = Date.now();

  for (const row of ytRows) {
    const stats = statsMap.get(row.youtube_video_id);
    if (!stats) continue;

    const publishMs = row.published_at ? new Date(row.published_at).getTime() : null;
    const hoursAgo  = publishMs ? (now - publishMs) / 3_600_000 : null;

    const viewData = {};
    if (hoursAgo != null) {
      if      (hoursAgo < 2)  viewData.views_1h  = stats.views;
      else if (hoursAgo < 8)  viewData.views_6h  = stats.views;
      else if (hoursAgo < 48) viewData.views_24h = stats.views;
      else                    viewData.views_72h = stats.views;
    } else {
      viewData.views_24h = stats.views;
    }

    const likeRate       = stats.views > 0 ? parseFloat((stats.likes / stats.views).toFixed(4)) : null;
    const fullRow        = { ...viewData, like_rate: likeRate };

    const histRows       = getChannelViewHistory(db, row.niche ?? 'unknown');
    const sortedViews    = histRows.map(r => r.actual_views_24h).sort((a, b) => a - b);
    const channelContext = { median_views_24h: computeMedian(sortedViews) };

    const signalQuality                             = computeSignalQuality(fullRow);
    const { velocity_state, breakout_multiplier }   = classifyLifecycle(fullRow, channelContext);
    const algorithm_push_score                      = computeAlgorithmPushScore(fullRow, channelContext);
    const { is_breakout }                           = detectBreakoutVideo(fullRow, channelContext);

    const predCtx = { predicted_score: row.predicted_score ?? null, signal_quality: signalQuality };
    const { is_false_positive, reason: fpReason }   = detectFalsePositivePrediction(
      { velocity_state, ...fullRow }, predCtx,
    );
    const { is_false_negative, reason: fnReason }   = detectFalseNegativePrediction(
      { viral_outcome: is_breakout, breakout_multiplier, ...fullRow }, predCtx,
    );

    const refreshedAt = new Date().toISOString();

    try {
      upsertVideoOutcomeReality(db, row.youtube_video_id, {
        video_id:              row.id,
        niche:                 row.niche ?? null,
        ...viewData,
        like_rate:             likeRate,
        velocity_state,        algorithm_push_score,
        viral_outcome:         is_breakout ? 1 : 0,
        breakout_multiplier,   is_false_positive,    is_false_negative,
        false_positive_reason: fpReason ?? null,
        false_negative_reason: fnReason ?? null,
        signal_quality:        signalQuality,
        has_oauth_data:        0,
        last_refreshed_at:     refreshedAt,
      });
    } catch (e) {
      logger.warn('outcomeRefreshJob', `Reality upsert failed for ${row.youtube_video_id}: ${e.message}`);
    }

    try {
      const views = stats.views ?? 0;
      const vph   = hoursAgo != null && hoursAgo > 0 ? views / hoursAgo : null;

      const durationBucket = classifyDurationBucket(row.duration_seconds ?? null);
      const benchmark      = getBenchmarkRow(db, row.niche ?? 'unknown', '7d', durationBucket);

      const actualPerfScore = benchmark
        ? computeActualPerformanceScoreFromVph(vph, {
            median_vph: benchmark.median_vph,
            p75_vph:    benchmark.p75_vph,
            p90_vph:    benchmark.p90_vph,
          })
        : null;

      const calibError = (actualPerfScore != null && row.predicted_score != null)
        ? computeCalibrationError({ predicted_score: row.predicted_score, actual_performance_score: actualPerfScore })
        : null;
      const calibBand  = calibError != null ? getCalibrationBand(calibError) : null;

      const outcomeState = actualPerfScore == null ? 'insufficient_data'
        : calibBand === 'large_overprediction'  ? 'overperformed'
        : calibBand === 'large_underprediction' ? 'underperformed'
        : 'as_predicted';

      updateVideoOutcomeRefresh(db, row.id, {
        actual_views_24h:        viewData.views_24h ?? null,
        actual_views_1h:         viewData.views_1h  ?? null,
        actual_views_7d:         null,
        actual_ctr:              null,
        actual_retention:        null,
        velocity_1h:             null,
        velocity_24h:            vph != null ? parseFloat(vph.toFixed(4)) : null,
        velocity_7d:             null,
        actual_performance_score: actualPerfScore,
        calibration_error:       calibError,
        calibration_band:        calibBand,
        outcome_state:           outcomeState,
        last_refreshed_at:       refreshedAt,
      });
    } catch (e) {
      logger.warn('outcomeRefreshJob', `Outcome calibration write failed for ${row.youtube_video_id}: ${e.message}`);
    }
  }

  logger.info('outcomeRefreshJob', `Reality data refreshed for ${ytRows.length} videos`);
}

function startOutcomeRefreshJob() {
  cron.schedule('0 */6 * * *', () => {
    runOutcomeRefreshCycle().catch(err => logger.error('outcomeRefreshJob', err.message));
  });
  logger.info('outcomeRefreshJob', 'Scheduled — every 6 hours');
}

function getOutcomeRefreshJobStats() {
  return { lastRun, lastFlagged };
}

module.exports = { startOutcomeRefreshJob, getOutcomeRefreshJobStats };
