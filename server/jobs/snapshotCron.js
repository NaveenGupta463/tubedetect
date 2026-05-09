const cron   = require('node-cron');
const crypto = require('crypto');
const { getDb }      = require('../db/init');
const quotaGuard     = require('../services/quotaGuard');
const { fetchVideoFullBatch } = require('../services/youtubeMetrics');
const {
  getAllIngestedVideosForSnapshot,
  getExistingBucketsForVideo,
  upsertIngestedVideo,
  insertGrowthSnapshot,
  getPreviousBucketSnapshot,
} = require('../db/queries');
const { runPatternMining } = require('../services/patternMiner');

const BUCKET_THRESHOLDS = {
  '1d':   1,
  '3d':   3,
  '7d':   7,
  '14d':  14,
  '30d':  30,
  '90d':  90,
  '365d': 365,
};
const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getEligibleBuckets(publishedAt) {
  const ageDays = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  return BUCKET_ORDER.filter(b => ageDays >= BUCKET_THRESHOLDS[b]);
}

function computeVelocity(views, ageHours, channelSubscribers) {
  const vph  = ageHours > 0 ? views / ageHours : null;
  const subs = channelSubscribers > 0 ? channelSubscribers : null;
  return {
    views_per_hour:               vph  != null ? parseFloat(vph.toFixed(4)) : null,
    subscriber_adjusted_velocity: (vph != null && subs) ? parseFloat((vph / subs * 1000).toFixed(6)) : null,
    views_to_subscriber_ratio:    (views != null && subs) ? parseFloat((views / subs).toFixed(4)) : null,
  };
}

async function runSnapshotCycle() {
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[snapshot] YT_API_KEY not set — skipping');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }
  if (!quotaGuard.quotaAvailable()) {
    console.warn('[snapshot] Quota exhausted at cycle start — aborting');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }

  const db      = getDb();
  const videos  = getAllIngestedVideosForSnapshot(db);

  if (!videos.length) {
    console.log('[snapshot] No ingested videos — skipping snapshot pass');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }

  console.log(`[snapshot] Starting cycle — ${videos.length} videos`);
  let refreshed = 0, newSnapshots = 0;

  // Process in batches of 50 (one videos.list call each)
  for (let i = 0; i < videos.length; i += 50) {
    if (!quotaGuard.quotaAvailable()) {
      console.warn('[snapshot] Quota exhausted mid-cycle — stopping');
      break;
    }

    const batch   = videos.slice(i, i + 50);
    const ids     = batch.map(v => v.youtube_video_id);

    let videoMap;
    try {
      videoMap = await fetchVideoFullBatch(ids);
      quotaGuard.recordUsage(1, 'refresh');
    } catch (e) {
      console.warn('[snapshot] videos.list batch failed:', e.message);
      if (i + 50 < videos.length) await sleep(300);
      continue;
    }

    for (const video of batch) {
      const fresh = videoMap.get(video.youtube_video_id);
      if (!fresh) continue;

      // Update latest stats in ingested_videos
      upsertIngestedVideo(db, {
        youtube_video_id:    video.youtube_video_id,
        channel_id:          video.channel_id,
        niche:               video.niche,
        title:               fresh.title || video.title,
        description:         fresh.description,
        published_at:        video.published_at,
        duration_seconds:    fresh.duration_seconds ?? video.duration_seconds,
        category_id:         fresh.category_id,
        views:               fresh.views,
        likes:               fresh.likes,
        comments:            fresh.comments,
        channel_subscribers: video.channel_subscribers,
      });
      refreshed++;

      // Insert newly eligible buckets only (existing ones are protected by UNIQUE constraint)
      const eligible  = getEligibleBuckets(video.published_at);
      const existing  = getExistingBucketsForVideo(db, video.youtube_video_id);
      const newBuckets = eligible.filter(b => !existing.has(b));

      if (!newBuckets.length) continue;

      const ageHours = (Date.now() - new Date(video.published_at).getTime()) / 3600000;
      const vel      = computeVelocity(fresh.views, ageHours, video.channel_subscribers ?? 0);

      for (const bucket of newBuckets) {
        const prevSnap = getPreviousBucketSnapshot(db, video.youtube_video_id, bucket);
        const prevVph  = prevSnap?.views_per_hour ?? null;
        const velocity_acceleration = (prevVph != null && vel.views_per_hour != null)
          ? parseFloat(((vel.views_per_hour - prevVph) / prevVph).toFixed(4))
          : null;

        insertGrowthSnapshot(db, {
          id:                          crypto.randomUUID(),
          video_id:                    video.youtube_video_id,
          bucket,
          age_hours_at_snapshot:       parseFloat(ageHours.toFixed(2)),
          views:                       fresh.views,
          likes:                       fresh.likes,
          comments:                    fresh.comments,
          views_per_hour:              vel.views_per_hour,
          subscriber_adjusted_velocity: vel.subscriber_adjusted_velocity,
          views_to_subscriber_ratio:   vel.views_to_subscriber_ratio,
          velocity_acceleration,
        });
        newSnapshots++;
      }
    }

    if (i + 50 < videos.length) await sleep(300);
  }

  // After refreshing, recompute niche benchmarks from all snapshot data
  let patternResult = null;
  try {
    patternResult = runPatternMining(db);
    console.log(`[snapshot] Pattern mining: combinations=${patternResult.combinations} upserted=${patternResult.upserted} skipped=${patternResult.skipped}`);
  } catch (e) {
    console.warn('[snapshot] Pattern mining failed:', e.message);
  }

  const quota = quotaGuard.getStats();
  console.log(`[snapshot] Cycle complete — refreshed=${refreshed} new_snapshots=${newSnapshots} quota_used=${quota.used}/${quota.cutoff}`);
  return { refreshed, new_snapshots: newSnapshots, pattern_result: patternResult };
}

function startSnapshotCron() {
  cron.schedule('0 4 * * *', async () => {
    try { await runSnapshotCycle(); }
    catch (e) { console.error('[snapshot] Cron error:', e.message); }
  });
  console.log('[Snapshot Cron] Scheduled — daily at 04:00 UTC');
}

module.exports = { startSnapshotCron, runSnapshotCycle };
