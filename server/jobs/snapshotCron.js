const cron   = require('node-cron');
const crypto = require('crypto');
const { getDb }      = require('../db/init');
const quotaGuard     = require('../services/quotaGuard');
const { setLastRun, hoursSinceLastRun } = require('../services/jobState');
const { withCronRetry } = require('../utils/cronRetry');
const { fetchVideoFullBatch } = require('../services/youtubeMetrics');
const { recordPipelineHealth, checkpointWalPassive } = require('../services/pipelineHealth');
const {
  getAllIngestedVideosForSnapshot,
  getNeverRefreshedVideosForSnapshot,
  getStaleOlderVideosForSnapshot,
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

// Drop + recreate the six indexes pattern mining JOINs hit.
// Called when a "disk image malformed" error is detected before retrying.
function _rebuildPatternMiningIndexes(db) {
  const indexes = [
    ['idx_vgs_video_id', 'CREATE INDEX IF NOT EXISTS idx_vgs_video_id ON video_growth_snapshots(video_id)'],
    ['idx_vgs_bucket',   'CREATE INDEX IF NOT EXISTS idx_vgs_bucket   ON video_growth_snapshots(bucket)'],
    ['idx_iv_niche',     'CREATE INDEX IF NOT EXISTS idx_iv_niche     ON ingested_videos(niche)'],
    ['idx_iv_channel',   'CREATE INDEX IF NOT EXISTS idx_iv_channel   ON ingested_videos(channel_id)'],
    ['idx_ic_niche',     'CREATE INDEX IF NOT EXISTS idx_ic_niche     ON ingested_channels(niche)'],
    ['idx_ic_enabled',   'CREATE INDEX IF NOT EXISTS idx_ic_enabled   ON ingested_channels(ingest_enabled)'],
  ];
  for (const [name, sql] of indexes) {
    try {
      db.exec(`DROP INDEX IF EXISTS "${name}"`);
      db.exec(sql);
      console.log('[snapshot] Rebuilt index:', name);
    } catch (e) {
      console.warn(`[snapshot] Could not rebuild ${name}:`, e.message);
    }
  }
}

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

function markSnapshotRefreshAttempt(db, videoId) {
  db.run(
    `UPDATE ingested_videos
     SET last_refreshed_at = datetime('now')
     WHERE youtube_video_id = ?`,
    [videoId],
  );
}

let _running = false;

async function runSnapshotCycle({ quotaBudget } = {}) {
  const startedAt = new Date();
  const SNAPSHOT_BUDGET = quotaBudget || Infinity;
  let snapshotUsed = 0;
  if (_running) {
    console.warn('[snapshot] Already running — skipping concurrent call');
    return { skipped: true, reason: 'already_running' };
  }
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[snapshot] YT_API_KEY not set — skipping');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }
  if (!quotaGuard.quotaAvailable()) {
    console.warn('[snapshot] Quota exhausted at cycle start — aborting');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }
  _running = true;
  try {

  const db      = getDb();
  const videos  = getAllIngestedVideosForSnapshot(db);

  if (!videos.length) {
    console.log('[snapshot] No ingested videos — skipping snapshot pass');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }

  console.log(`[snapshot] Starting cycle — ${videos.length} videos`);
  let refreshed = 0, newSnapshots = 0, unavailable = 0;

  // Process in batches of 50 (one videos.list call each)
  for (let i = 0; i < videos.length; i += 50) {
    if (!quotaGuard.quotaAvailable()) {
      console.warn('[snapshot] Quota exhausted mid-cycle — stopping');
      break;
    }
    if (snapshotUsed >= SNAPSHOT_BUDGET) {
      console.warn(`[snapshot] Step budget (${SNAPSHOT_BUDGET}) reached — stopping`);
      break;
    }

    if (i > 0 && i % 5000 === 0) {
      console.log(`[snapshot] Progress — ${i}/${videos.length} videos processed (${Math.round(i/videos.length*100)}%)`);
    }

    const batch   = videos.slice(i, i + 50);
    const ids     = batch.map(v => v.youtube_video_id);

    let videoMap;
    try {
      videoMap = await fetchVideoFullBatch(ids);
      quotaGuard.recordUsage(1, 'refresh');
      snapshotUsed++;
    } catch (e) {
      console.warn('[snapshot] videos.list batch failed:', e.message);
      if (i + 50 < videos.length) await sleep(300);
      continue;
    }

    // Wrap all DB writes for this batch in one transaction — keeps WAL small
    db.exec('BEGIN');
    try {
      for (const video of batch) {
        const fresh = videoMap.get(video.youtube_video_id);
        if (!fresh) {
          markSnapshotRefreshAttempt(db, video.youtube_video_id);
          unavailable++;
          continue;
        }

        upsertIngestedVideo(db, {
          youtube_video_id:    video.youtube_video_id,
          channel_id:          video.channel_id,
          niche:               video.niche,
          title:               fresh.title || video.title,
          description:         fresh.description,
          published_at:        video.published_at,
          duration_seconds:    fresh.duration_seconds ?? video.duration_seconds,
          category_id:         fresh.category_id,
          thumbnail_url:       fresh.thumbnail_url,
          thumbnail_width:     fresh.thumbnail_width,
          thumbnail_height:    fresh.thumbnail_height,
          thumbnail_aspect_ratio: fresh.thumbnail_aspect_ratio,
          format_type:         fresh.format_type,
          format_confidence:   fresh.format_confidence,
          format_reason:       fresh.format_reason,
          views:               fresh.views,
          likes:               fresh.likes,
          comments:            fresh.comments,
          channel_subscribers: video.channel_subscribers,
        });
        refreshed++;

        const eligible   = getEligibleBuckets(video.published_at);
        const existing   = getExistingBucketsForVideo(db, video.youtube_video_id);
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
            id:                           crypto.randomUUID(),
            video_id:                     video.youtube_video_id,
            bucket,
            age_hours_at_snapshot:        parseFloat(ageHours.toFixed(2)),
            views:                        fresh.views,
            likes:                        fresh.likes,
            comments:                     fresh.comments,
            views_per_hour:               vel.views_per_hour,
            subscriber_adjusted_velocity: vel.subscriber_adjusted_velocity,
            views_to_subscriber_ratio:    vel.views_to_subscriber_ratio,
            velocity_acceleration,
          });
          newSnapshots++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.warn('[snapshot] Batch transaction rolled back:', e.message);
    }

    if (i + 50 < videos.length) await sleep(300);
  }

  // Checkpoint before pattern mining — flushes WAL to main DB so pattern mining
  // works on a clean, small WAL rather than reading through thousands of pending entries
  try {
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    console.log('[snapshot] WAL checkpoint complete');
  } catch (e) {
    console.warn('[snapshot] WAL checkpoint failed (non-fatal):', e.message);
  }

  // Recompute niche benchmarks — wrapped in one transaction for atomicity
  let patternResult = null;
  try {
    db.exec('BEGIN');
    patternResult = runPatternMining(db);
    db.exec('COMMIT');
    setLastRun('recompute_patterns');
    console.log(`[snapshot] Pattern mining: combinations=${patternResult.combinations} upserted=${patternResult.upserted} skipped=${patternResult.skipped}`);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    console.warn('[snapshot] Pattern mining failed:', e.message);

    if (e.message?.includes('malformed') || e.message?.includes('disk image')) {
      console.log('[snapshot] Detected index corruption — rebuilding indexes and retrying pattern mining');
      _rebuildPatternMiningIndexes(db);
      try {
        db.exec('BEGIN');
        patternResult = runPatternMining(db);
        db.exec('COMMIT');
        setLastRun('recompute_patterns');
        console.log(`[snapshot] Pattern mining retry OK: combinations=${patternResult.combinations} upserted=${patternResult.upserted}`);
      } catch (e2) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        console.warn('[snapshot] Pattern mining retry also failed:', e2.message);
      }
    }
  }

  const quota = quotaGuard.getStats();
  console.log(`[snapshot] Cycle complete — refreshed=${refreshed} unavailable=${unavailable} new_snapshots=${newSnapshots} quota_used=${quota.used}/${quota.cutoff}`);
  setLastRun('snapshot_refresh');
  recordPipelineHealth(db, {
    job_name:    'snapshot_refresh',
    status:      'ok',
    started_at:  startedAt.toISOString(),
    duration_ms: Date.now() - startedAt.getTime(),
    metrics: {
      refreshed,
      unavailable,
      new_snapshots: newSnapshots,
      quota_used:    quota.used,
      quota_cutoff:  quota.cutoff,
      pattern_result: patternResult,
    },
  });
  return { refreshed, unavailable, new_snapshots: newSnapshots, pattern_result: patternResult };

  } finally {
    _running = false;
  }
}

function isSnapshotRunning() { return _running; }

async function runNeverRefreshedSnapshotCycle() {
  const startedAt = new Date();
  if (_running) {
    console.warn('[snapshot] Already running — skipping concurrent call');
    return { skipped: true, reason: 'already_running' };
  }
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[snapshot] YT_API_KEY not set — skipping');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }
  if (!quotaGuard.quotaAvailable()) {
    console.warn('[snapshot] Quota exhausted — aborting');
    return { refreshed: 0, new_snapshots: 0, pattern_result: null };
  }
  _running = true;
  try {
    const db     = getDb();
    const videos = getNeverRefreshedVideosForSnapshot(db);

    if (!videos.length) {
      console.log('[snapshot] No unrefreshed videos — all caught up');
      return { refreshed: 0, new_snapshots: 0, pattern_result: null };
    }

    console.log(`[snapshot] Never-refreshed cycle — ${videos.length} videos`);
    let refreshed = 0, newSnapshots = 0, unavailable = 0;

    for (let i = 0; i < videos.length; i += 50) {
      if (!quotaGuard.quotaAvailable()) {
        console.warn('[snapshot] Quota exhausted mid-cycle — stopping');
        break;
      }
      const batch    = videos.slice(i, i + 50);
      const ids      = batch.map(v => v.youtube_video_id);
      let videoMap;
      try {
        videoMap = await fetchVideoFullBatch(ids);
        quotaGuard.recordUsage(1, 'refresh');
      } catch (e) {
        console.warn('[snapshot] videos.list batch failed:', e.message);
        if (i + 50 < videos.length) await sleep(300);
        continue;
      }

      db.exec('BEGIN');
      try {
        for (const video of batch) {
          const fresh = videoMap.get(video.youtube_video_id);
          if (!fresh) {
            markSnapshotRefreshAttempt(db, video.youtube_video_id);
            unavailable++;
            continue;
          }

          upsertIngestedVideo(db, {
            youtube_video_id:    video.youtube_video_id,
            channel_id:          video.channel_id,
            niche:               video.niche,
            title:               fresh.title || video.title,
            description:         fresh.description,
            published_at:        video.published_at,
            duration_seconds:    fresh.duration_seconds ?? video.duration_seconds,
            category_id:         fresh.category_id,
            thumbnail_url:       fresh.thumbnail_url,
            thumbnail_width:     fresh.thumbnail_width,
            thumbnail_height:    fresh.thumbnail_height,
            thumbnail_aspect_ratio: fresh.thumbnail_aspect_ratio,
            format_type:         fresh.format_type,
            format_confidence:   fresh.format_confidence,
            format_reason:       fresh.format_reason,
            views:               fresh.views,
            likes:               fresh.likes,
            comments:            fresh.comments,
            channel_subscribers: video.channel_subscribers,
          });
          refreshed++;

          const eligible   = getEligibleBuckets(video.published_at);
          const existing   = getExistingBucketsForVideo(db, video.youtube_video_id);
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
              id:                           require('crypto').randomUUID(),
              video_id:                     video.youtube_video_id,
              bucket,
              age_hours_at_snapshot:        parseFloat(ageHours.toFixed(2)),
              views:                        fresh.views,
              likes:                        fresh.likes,
              comments:                     fresh.comments,
              views_per_hour:               vel.views_per_hour,
              subscriber_adjusted_velocity: vel.subscriber_adjusted_velocity,
              views_to_subscriber_ratio:    vel.views_to_subscriber_ratio,
              velocity_acceleration,
            });
            newSnapshots++;
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        console.warn('[snapshot] Batch transaction rolled back:', e.message);
      }

      if (i + 50 < videos.length) await sleep(300);
    }

    setLastRun('snapshot_refresh');
    console.log(`[snapshot] Never-refreshed cycle done — refreshed=${refreshed} unavailable=${unavailable} new_snapshots=${newSnapshots}`);
    {
      const quota = quotaGuard.getStats();
      recordPipelineHealth(db, {
        job_name:    'snapshot_never_refreshed',
        status:      'ok',
        started_at:  startedAt.toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
        metrics: {
          refreshed,
          unavailable,
          new_snapshots: newSnapshots,
          quota_used:    quota.used,
          quota_cutoff:  quota.cutoff,
        },
      });
      checkpointWalPassive(db, 'snapshot-never');
    }
    return { refreshed, unavailable, new_snapshots: newSnapshots, pattern_result: null };
  } finally {
    _running = false;
  }
}

// Refresh old videos on a slower cadence:
//   60d–365d old → every 2 months (last_refreshed_at < now - 60 days)
//   365d+        → every 6 months (last_refreshed_at < now - 180 days)
async function runOlderVideoSnapshotCycle() {
  const startedAt = new Date();
  if (_running) {
    console.warn('[snapshot-older] Main cycle running — skipping');
    return { skipped: true, reason: 'main_running' };
  }
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[snapshot-older] YT_API_KEY not set — skipping');
    return { refreshed: 0 };
  }
  if (!quotaGuard.quotaAvailable()) {
    console.warn('[snapshot-older] Quota exhausted — skipping');
    return { refreshed: 0 };
  }
  _running = true;
  try {
    const db     = getDb();
    const videos = getStaleOlderVideosForSnapshot(db);

    if (!videos.length) {
      console.log('[snapshot-older] No stale older videos due for refresh');
      return { refreshed: 0 };
    }

    console.log(`[snapshot-older] Starting — ${videos.length} stale older videos due`);
    let refreshed = 0;

    for (let i = 0; i < videos.length; i += 50) {
      if (!quotaGuard.quotaAvailable()) {
        console.warn('[snapshot-older] Quota exhausted mid-cycle — stopping');
        break;
      }

      const batch    = videos.slice(i, i + 50);
      const ids      = batch.map(v => v.youtube_video_id);
      let videoMap;
      try {
        videoMap = await fetchVideoFullBatch(ids);
        quotaGuard.recordUsage(1, 'refresh-older');
      } catch (e) {
        console.warn('[snapshot-older] videos.list batch failed:', e.message);
        if (i + 50 < videos.length) await sleep(300);
        continue;
      }

      db.exec('BEGIN');
      try {
        for (const video of batch) {
          const fresh = videoMap.get(video.youtube_video_id);
          if (!fresh) continue;

          upsertIngestedVideo(db, {
            youtube_video_id:    video.youtube_video_id,
            channel_id:          video.channel_id,
            niche:               video.niche,
            title:               fresh.title || video.title,
            description:         fresh.description,
            published_at:        video.published_at,
            duration_seconds:    fresh.duration_seconds ?? video.duration_seconds,
            category_id:         fresh.category_id,
            thumbnail_url:       fresh.thumbnail_url,
            thumbnail_width:     fresh.thumbnail_width,
            thumbnail_height:    fresh.thumbnail_height,
            thumbnail_aspect_ratio: fresh.thumbnail_aspect_ratio,
            format_type:         fresh.format_type,
            format_confidence:   fresh.format_confidence,
            format_reason:       fresh.format_reason,
            views:               fresh.views,
            likes:               fresh.likes,
            comments:            fresh.comments,
            channel_subscribers: video.channel_subscribers,
          });
          refreshed++;

          // Older videos may still unlock the 90d or 365d bucket for the first time
          const eligible   = getEligibleBuckets(video.published_at);
          const existing   = getExistingBucketsForVideo(db, video.youtube_video_id);
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
              id:                           crypto.randomUUID(),
              video_id:                     video.youtube_video_id,
              bucket,
              age_hours_at_snapshot:        parseFloat(ageHours.toFixed(2)),
              views:                        fresh.views,
              likes:                        fresh.likes,
              comments:                     fresh.comments,
              views_per_hour:               vel.views_per_hour,
              subscriber_adjusted_velocity: vel.subscriber_adjusted_velocity,
              views_to_subscriber_ratio:    vel.views_to_subscriber_ratio,
              velocity_acceleration,
            });
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        console.warn('[snapshot-older] Batch rolled back:', e.message);
      }

      if (i + 50 < videos.length) await sleep(300);
    }

    console.log(`[snapshot-older] Done — refreshed=${refreshed}`);
    {
      const quota = quotaGuard.getStats();
      recordPipelineHealth(db, {
        job_name:    'snapshot_older',
        status:      'ok',
        started_at:  startedAt.toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
        metrics: {
          refreshed,
          quota_used:   quota.used,
          quota_cutoff: quota.cutoff,
        },
      });
      checkpointWalPassive(db, 'snapshot-older');
    }
    return { refreshed };
  } finally {
    _running = false;
  }
}

function startSnapshotCron() {
  cron.schedule('0 4 * * *', () => {
    withCronRetry(runSnapshotCycle, 'snapshot', { maxAttempts: 3, retryDelayMs: 20 * 60 * 1000 });
  });
  console.log('[Snapshot Cron] Scheduled — daily at 04:00 UTC');

  // Older video refresh — runs daily at 02:00, WHERE clause selects only what's actually due
  cron.schedule('0 2 * * *', () => {
    withCronRetry(runOlderVideoSnapshotCycle, 'snapshot-older', { maxAttempts: 2, retryDelayMs: 30 * 60 * 1000 });
  });
  console.log('[Snapshot Cron] Older-video refresh scheduled — daily at 02:00 UTC');

  // No startup catch-up — run via: node pipeline.js
}

module.exports = { startSnapshotCron, runSnapshotCycle, runNeverRefreshedSnapshotCycle, runOlderVideoSnapshotCycle, isSnapshotRunning };
