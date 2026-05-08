// Pure orchestration layer for outcome snapshots — no DB access.
const {
  computeActualPerformanceScore,
  computeCalibrationError,
  getCalibrationBand,
} = require('./calibration');

function computeVelocity({ actual_views_1h, actual_views_24h, actual_views_7d, published_at }) {
  const now        = Date.now();
  const publishedMs = published_at ? new Date(published_at).getTime() : now;
  const ageDays    = Math.max(1, (now - publishedMs) / 86400000);

  return {
    velocity_1h:  actual_views_1h  != null ? parseFloat((actual_views_1h  / 1).toFixed(2))              : null,
    velocity_24h: actual_views_24h != null ? parseFloat((actual_views_24h / 24).toFixed(2))             : null,
    velocity_7d:  actual_views_7d  != null ? parseFloat((actual_views_7d  / ageDays).toFixed(2))        : null,
  };
}

function classifyOutcomeState({ calibration_error, actual_views_24h, velocity_24h }) {
  const hasData = (actual_views_24h != null && actual_views_24h > 0) ||
                  (velocity_24h     != null && velocity_24h > 0);
  if (!hasData || calibration_error == null) return 'insufficient_data';
  if (calibration_error < -10) return 'outperforming';
  if (calibration_error >  10) return 'underperforming';
  return 'on_track';
}

function captureOutcomeSnapshot({ snapshotData, videoData, publishData }) {
  const now = new Date().toISOString();
  return {
    prediction_id:       snapshotData.prediction_id ?? null,
    video_id:            snapshotData.video_id ?? videoData?.id ?? null,
    youtube_video_id:    publishData.youtube_video_id,
    pipeline_version:    snapshotData.pipeline_version ?? 'legacy',
    predicted_score:     snapshotData.predicted_score ?? null,
    predicted_state:     snapshotData.predicted_state ?? null,
    confidence_state:    snapshotData.confidence_state ?? null,
    niche:               videoData?.niche ?? null,
    title:               videoData?.title ?? null,
    hook:                videoData?.hook  ?? null,
    published_at:        publishData.published_at ?? now,
    published_title:     publishData.published_title     ?? videoData?.title ?? null,
    published_thumbnail: publishData.published_thumbnail ?? null,
    outcome_state:       'insufficient_data',
    observed_at:         now,
    created_at:          now,
  };
}

function computeOutcomeRefreshPayload({ outcome, actual_views_1h, actual_views_24h, actual_views_7d, actual_ctr, actual_retention }) {
  const safeCtr       = actual_ctr       != null ? Math.max(0, Math.min(1, actual_ctr))       : null;
  const safeRetention = actual_retention != null ? Math.max(0, Math.min(1, actual_retention)) : null;

  const velocity = computeVelocity({
    actual_views_1h, actual_views_24h, actual_views_7d,
    published_at: outcome.published_at,
  });

  const actual_performance_score = (velocity.velocity_24h != null || safeCtr != null || safeRetention != null)
    ? computeActualPerformanceScore({
        velocity_24h:     velocity.velocity_24h ?? 0,
        actual_ctr:       safeCtr ?? 0,
        actual_retention: safeRetention ?? 0,
      })
    : null;

  const calibration_error = (outcome.predicted_score != null && actual_performance_score != null)
    ? computeCalibrationError({ predicted_score: outcome.predicted_score, actual_performance_score })
    : null;

  const calibration_band = calibration_error != null ? getCalibrationBand(calibration_error) : null;

  const outcome_state = classifyOutcomeState({
    calibration_error,
    actual_views_24h: actual_views_24h ?? 0,
    velocity_24h: velocity.velocity_24h ?? 0,
  });

  return {
    actual_views_1h:         actual_views_1h  ?? null,
    actual_views_24h:        actual_views_24h ?? null,
    actual_views_7d:         actual_views_7d  ?? null,
    actual_ctr:              safeCtr,
    actual_retention:        safeRetention,
    ...velocity,
    actual_performance_score,
    calibration_error,
    calibration_band,
    outcome_state,
    last_refreshed_at:       new Date().toISOString(),
  };
}

function computeOutcomeMetrics(statsRow, refreshQueueSize, staleCount) {
  if (!statsRow) {
    return {
      trackedVideos: 0, publishedVideos: 0, calibratedPredictions: 0,
      avgCalibrationError: null, overpredictionRate: null,
      underpredictionRate: null, accurateRate: null,
      refreshQueueSize: refreshQueueSize ?? 0, staleOutcomeCount: staleCount ?? 0,
    };
  }
  const cal = statsRow.calibrated_count ?? 0;
  const pct = (n) => cal > 0 ? parseFloat((n / cal * 100).toFixed(1)) : null;
  return {
    trackedVideos:         statsRow.total_tracked       ?? 0,
    publishedVideos:       statsRow.published_count     ?? 0,
    calibratedPredictions: cal,
    avgCalibrationError:   statsRow.avg_abs_error != null ? parseFloat(statsRow.avg_abs_error.toFixed(2)) : null,
    overpredictionRate:    pct(statsRow.over_count  ?? 0),
    underpredictionRate:   pct(statsRow.under_count ?? 0),
    accurateRate:          pct(statsRow.accurate_count ?? 0),
    refreshQueueSize:      refreshQueueSize ?? 0,
    staleOutcomeCount:     staleCount       ?? 0,
  };
}

module.exports = {
  computeVelocity, classifyOutcomeState,
  captureOutcomeSnapshot, computeOutcomeRefreshPayload, computeOutcomeMetrics,
};
