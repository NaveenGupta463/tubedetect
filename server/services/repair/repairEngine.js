'use strict';

const crypto = require('crypto');
const { getDb }                      = require('../../db/init');
const { classifyDurationBucket }     = require('../../db/queries');
const { computeTrajectoryScore }     = require('./trajectoryScore');
const { computeExpectedPerformanceScore } = require('./expectedPerformanceScore');
const { computeAudienceResponseScore }    = require('./audienceResponseScore');
const { computePackagingRiskScore }       = require('./packagingRiskScore');
const { classifyRepairWindow, computeFixabilityScore } = require('./fixabilityScore');

const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];

function getVideoMeta(db, youtubeVideoId) {
  return db.get(
    'SELECT * FROM ingested_videos WHERE youtube_video_id = ?',
    [youtubeVideoId],
  );
}

function getChannelMeta(db, channelId) {
  return db.get(
    'SELECT * FROM ingested_channels WHERE channel_id = ?',
    [channelId],
  );
}

function getSnapshots(db, youtubeVideoId) {
  return db.all(
    'SELECT * FROM video_growth_snapshots WHERE video_id = ?',
    [youtubeVideoId],
  );
}

function getAllBenchmarkRows(db, niche, durationBucket) {
  if (!niche) return [];
  return BUCKET_ORDER.map(bucket => {
    const row = db.get(
      'SELECT * FROM niche_benchmarks WHERE niche = ? AND bucket = ? AND duration_bucket = ?',
      [niche, bucket, durationBucket],
    );
    return row ?? null;
  }).filter(Boolean);
}

function videoAgeHours(publishedAt) {
  if (!publishedAt) return null;
  const ms = Date.now() - new Date(publishedAt).getTime();
  return ms / 3600000;
}

function inputHash(videoMeta, snapshots) {
  const payload = JSON.stringify({
    vid: videoMeta?.youtube_video_id,
    views: videoMeta?.views,
    likes: videoMeta?.likes,
    comments: videoMeta?.comments,
    snaps: (snapshots ?? []).map(s => ({ b: s.bucket, vph: s.views_per_hour })),
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Compute the full structural repair assessment for a video (Phase A — no AI).
 *
 * @param {string} youtubeVideoId
 * @param {{ force?: boolean }} opts
 * @returns {object} repair assessment
 */
function computeRepair(youtubeVideoId, opts = {}) {
  const db = getDb();

  // Cache check (unless force=true).
  if (!opts.force) {
    const cached = db.get(
      'SELECT * FROM video_repair_cache WHERE video_id = ?',
      [youtubeVideoId],
    );
    if (cached?.result_json) {
      const result = JSON.parse(cached.result_json);
      result._cached = true;
      result._cached_at = cached.computed_at;
      return result;
    }
  }

  const videoMeta   = getVideoMeta(db, youtubeVideoId);
  if (!videoMeta) {
    return { error: 'video_not_found', video_id: youtubeVideoId };
  }

  const channelMeta  = videoMeta.channel_id ? getChannelMeta(db, videoMeta.channel_id) : null;
  const snapshots    = getSnapshots(db, youtubeVideoId);
  const niche        = videoMeta.niche;
  const durationBucket = classifyDurationBucket(videoMeta.duration_seconds);
  const benchmarkRows  = getAllBenchmarkRows(db, niche, durationBucket);

  // Video age for repair window classification.
  const ageHours = videoAgeHours(videoMeta.published_at);

  // ── Score modules ────────────────────────────────────────────────────────────
  const trajectory = computeTrajectoryScore(snapshots);
  const expected   = computeExpectedPerformanceScore(db, snapshots, videoMeta);
  const audience   = computeAudienceResponseScore(videoMeta, channelMeta, benchmarkRows[0] ?? null);
  const packaging  = computePackagingRiskScore(snapshots, benchmarkRows);

  // do_not_touch: video is genuinely performing well — don't intervene.
  const doNotTouch = (
    trajectory.trajectory_status === 'viral' ||
    (trajectory.trajectory_status === 'growing' && expected.expected_performance_score >= 70)
  );

  const isViral = trajectory.trajectory_status === 'viral' && (ageHours ?? 0) > 30 * 24;
  const repairWindow = ageHours != null
    ? classifyRepairWindow(ageHours, isViral)
    : 'unknown';

  const fixability = computeFixabilityScore(
    repairWindow,
    trajectory.trajectory_status,
    trajectory.trajectory_score,
    packaging.packaging_risk_score,
    doNotTouch,
  );

  const result = {
    video_id:     youtubeVideoId,
    computed_at:  new Date().toISOString(),
    repair_window: repairWindow,
    age_hours:     ageHours != null ? Math.round(ageHours) : null,
    do_not_touch:  doNotTouch,

    // Top-level scores.
    urgency_score:               fixability.urgency_score,
    fixability_score:            fixability.fixability_score,
    trajectory_status:           trajectory.trajectory_status,
    trajectory_score:            trajectory.trajectory_score,
    expected_performance_score:  expected.expected_performance_score,
    audience_response_score:     audience.audience_response_score,
    packaging_risk_score:        packaging.packaging_risk_score,

    // Per-module evidence.
    evidence: {
      trajectory:           trajectory.evidence,
      expected_performance: expected.evidence,
      audience_response:    audience.evidence,
      packaging_risk:       packaging.evidence,
      fixability:           fixability.evidence,
    },

    // Metadata for Phase B AI cache.
    ai_cache_key: inputHash(videoMeta, snapshots),
  };

  // Persist to cache.
  try {
    db.run(
      `INSERT OR REPLACE INTO video_repair_cache
         (video_id, computed_at, repair_window, do_not_touch, urgency_score,
          fixability_score, result_json, input_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        youtubeVideoId,
        result.computed_at,
        result.repair_window,
        doNotTouch ? 1 : 0,
        result.urgency_score,
        result.fixability_score,
        JSON.stringify(result),
        result.ai_cache_key,
      ],
    );
  } catch (e) {
    // Cache write failure is non-fatal.
    result._cache_error = e.message;
  }

  return result;
}

module.exports = { computeRepair };
