const cron   = require('node-cron');
const crypto = require('crypto');
const { getDb }      = require('../db/init');
const quotaGuard     = require('../services/quotaGuard');
const { setLastRun, hoursSinceLastRun } = require('../services/jobState');
const { withCronRetry } = require('../utils/cronRetry');
const {
  fetchChannelContentDetails,
  fetchPlaylistItems,
  fetchVideoFullBatch,
} = require('../services/youtubeMetrics');
const {
  getIngestableChannels,
  updateChannelIngestMetadata,
  markChannelIngested,
  upsertIngestedVideo,
  insertGrowthSnapshot,
  getPreviousBucketSnapshot,
} = require('../db/queries');

const VIDEOS_PER_CHANNEL = 50;

// Ingest's own daily budget — prevents it from consuming snapshot's headroom.
// Override via INGEST_QUOTA_BUDGET in .env.
const INGEST_BUDGET = parseInt(process.env.INGEST_QUOTA_BUDGET || '30000', 10);

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

function insertEligibleSnapshots(db, ytId, vdata, channelSubscribers) {
  if (!vdata.published_at) return 0;
  const ageHours = (Date.now() - new Date(vdata.published_at).getTime()) / 3600000;
  const buckets  = getEligibleBuckets(vdata.published_at);
  const vel      = computeVelocity(vdata.views, ageHours, channelSubscribers ?? 0);
  let count = 0;

  for (const bucket of buckets) {
    const prevSnap = getPreviousBucketSnapshot(db, ytId, bucket);
    const prevVph  = prevSnap?.views_per_hour ?? null;
    const velocity_acceleration = (prevVph != null && vel.views_per_hour != null)
      ? parseFloat(((vel.views_per_hour - prevVph) / prevVph).toFixed(4))
      : null;

    insertGrowthSnapshot(db, {
      id:                          crypto.randomUUID(),
      video_id:                    ytId,
      bucket,
      age_hours_at_snapshot:       parseFloat(ageHours.toFixed(2)),
      views:                       vdata.views,
      likes:                       vdata.likes,
      comments:                    vdata.comments,
      views_per_hour:              vel.views_per_hour,
      subscriber_adjusted_velocity: vel.subscriber_adjusted_velocity,
      views_to_subscriber_ratio:   vel.views_to_subscriber_ratio,
      velocity_acceleration,
    });
    count++;
  }
  return count;
}

async function ingestChannel(channel) {
  const db = getDb();
  let inserted = 0, skipped = 0, snapshots = 0;

  // 1. Resolve uploads playlist ID + refresh channel metadata
  let playlistId      = channel.uploads_playlist_id;
  let channelSubs     = channel.channel_subscribers ?? 0;

  if (!playlistId) {
    if (!quotaGuard.quotaAvailable()) {
      console.warn(`[historical:${channel.channel_id}] Quota exhausted — skip channels.list`);
      return { inserted: 0, skipped: 0, snapshots: 0 };
    }
    try {
      const details = await fetchChannelContentDetails(channel.channel_id);
      quotaGuard.recordUsage(1, 'ingest');
      playlistId  = details.uploadsPlaylistId;
      channelSubs = details.subscriberCount ?? channelSubs;
      if (playlistId) {
        updateChannelIngestMetadata(db, channel.channel_id, {
          uploadsPlaylistId: playlistId,
          channelName:       details.channelName,
          channelSubscribers: details.subscriberCount,
        });
      }
    } catch (e) {
      console.warn(`[historical:${channel.channel_id}] channels.list failed:`, e.message);
      return { inserted: 0, skipped: 0, snapshots: 0 };
    }
  }

  if (!playlistId) {
    console.warn(`[historical:${channel.channel_id}] No uploads playlist — skipping`);
    return { inserted: 0, skipped: 0, snapshots: 0 };
  }

  // 2. Fetch video IDs from uploads playlist
  if (!quotaGuard.quotaAvailable()) {
    console.warn(`[historical:${channel.channel_id}] Quota exhausted — skip playlistItems`);
    return { inserted: 0, skipped: 0, snapshots: 0 };
  }

  let videoIds = [];
  try {
    const result = await fetchPlaylistItems(playlistId, null, VIDEOS_PER_CHANNEL);
    videoIds = result.videoIds;
    quotaGuard.recordUsage(1, 'ingest');
  } catch (e) {
    const isNotFound = e.message?.toLowerCase().includes('cannot be found')
                    || e.message?.toLowerCase().includes('playlistnotfound')
                    || e.message?.toLowerCase().includes('not found');

    if (isNotFound) {
      // Stale playlist ID — clear it and re-fetch from channels.list
      updateChannelIngestMetadata(db, channel.channel_id, { uploadsPlaylistId: null });

      if (!quotaGuard.quotaAvailable()) {
        console.warn(`[historical:${channel.channel_id}] Stale playlist, quota exhausted — deferring`);
        return { inserted: 0, skipped: 0, snapshots: 0 };
      }

      let freshPlaylistId = null;
      try {
        const details = await fetchChannelContentDetails(channel.channel_id);
        quotaGuard.recordUsage(1, 'ingest');
        freshPlaylistId = details.uploadsPlaylistId;
        if (freshPlaylistId) {
          updateChannelIngestMetadata(db, channel.channel_id, {
            uploadsPlaylistId:  freshPlaylistId,
            channelName:        details.channelName,
            channelSubscribers: details.subscriberCount,
          });
          channelSubs = details.subscriberCount ?? channelSubs;
        }
      } catch (ce) {
        // Channel itself is gone — disable ingest
        console.warn(`[historical:${channel.channel_id}] Channel not found on re-check — disabling`);
        db.run(`UPDATE ingested_channels SET ingest_enabled = 0 WHERE channel_id = ?`, [channel.channel_id]);
        return { inserted: 0, skipped: 0, snapshots: 0 };
      }

      if (!freshPlaylistId || freshPlaylistId === playlistId) {
        // Playlist is permanently inaccessible
        console.warn(`[historical:${channel.channel_id}] Uploads playlist inaccessible — disabling`);
        db.run(`UPDATE ingested_channels SET ingest_enabled = 0 WHERE channel_id = ?`, [channel.channel_id]);
        return { inserted: 0, skipped: 0, snapshots: 0 };
      }

      // Retry with the fresh playlist ID
      try {
        const result = await fetchPlaylistItems(freshPlaylistId, null, VIDEOS_PER_CHANNEL);
        videoIds = result.videoIds;
        quotaGuard.recordUsage(1, 'ingest');
        playlistId = freshPlaylistId;
      } catch (re) {
        console.warn(`[historical:${channel.channel_id}] Retry with fresh playlist also failed:`, re.message);
        db.run(`UPDATE ingested_channels SET ingest_enabled = 0 WHERE channel_id = ?`, [channel.channel_id]);
        return { inserted: 0, skipped: 0, snapshots: 0 };
      }
    } else {
      console.warn(`[historical:${channel.channel_id}] playlistItems failed:`, e.message);
      return { inserted: 0, skipped: 0, snapshots: 0 };
    }
  }

  if (!videoIds.length) {
    markChannelIngested(db, channel.channel_id);
    return { inserted: 0, skipped: 0, snapshots: 0 };
  }

  // 3. Batch-fetch full video data (snippet + statistics + contentDetails)
  for (let i = 0; i < videoIds.length; i += 50) {
    if (!quotaGuard.quotaAvailable()) {
      console.warn(`[historical:${channel.channel_id}] Quota exhausted mid-batch`);
      break;
    }

    const batch = videoIds.slice(i, i + 50);
    let videoMap;
    try {
      videoMap = await fetchVideoFullBatch(batch);
      quotaGuard.recordUsage(1, 'ingest');
    } catch (e) {
      console.warn(`[historical:${channel.channel_id}] videos.list batch failed:`, e.message);
      skipped += batch.length;
      if (i + 50 < videoIds.length) await sleep(200);
      continue;
    }

    // 4. Upsert each video + insert all currently eligible growth snapshots
    for (const [ytId, vdata] of videoMap) {
      try {
        upsertIngestedVideo(db, {
          youtube_video_id:    ytId,
          channel_id:          channel.channel_id,
          niche:               channel.niche,
          title:               vdata.title,
          description:         vdata.description,
          published_at:        vdata.published_at,
          duration_seconds:    vdata.duration_seconds,
          category_id:         vdata.category_id,
          views:               vdata.views,
          likes:               vdata.likes,
          comments:            vdata.comments,
          channel_subscribers: channelSubs,
        });
        inserted++;

        snapshots += insertEligibleSnapshots(db, ytId, vdata, channelSubs);
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) {
          console.warn(`[historical:${channel.channel_id}] insert failed (${ytId}):`, e.message);
        }
        skipped++;
      }
    }

    if (i + 50 < videoIds.length) await sleep(200);
  }

  markChannelIngested(db, channel.channel_id);
  console.log(`[historical:${channel.channel_id}] niche=${channel.niche} inserted=${inserted} skipped=${skipped} snapshots=${snapshots}`);
  return { inserted, skipped, snapshots };
}

async function runHistoricalIngestCycle() {
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[historical] YT_API_KEY not set — skipping');
    return { channels: 0, inserted: 0, skipped: 0, snapshots: 0 };
  }
  if (!quotaGuard.quotaAvailable()) {
    console.warn('[historical] Quota exhausted at cycle start — aborting');
    return { channels: 0, inserted: 0, skipped: 0, snapshots: 0 };
  }

  const db       = getDb();
  const channels = getIngestableChannels(db);
  if (!channels.length) {
    console.log('[historical] No channels seeded — add channels via POST /api/admin/intelligence/channels');
    return { channels: 0, inserted: 0, skipped: 0, snapshots: 0 };
  }

  console.log(`[historical] Starting cycle — ${channels.length} channels, budget=${INGEST_BUDGET}`);
  let totalInserted = 0, totalSkipped = 0, totalSnapshots = 0, ingestUsed = 0;

  for (const channel of channels) {
    if (ingestUsed >= INGEST_BUDGET) {
      console.warn(`[historical] Ingest budget (${INGEST_BUDGET}) reached — stopping to preserve snapshot quota`);
      break;
    }
    const usedBefore = quotaGuard.getStats().used;
    const r = await ingestChannel(channel);
    ingestUsed += (quotaGuard.getStats().used - usedBefore);
    totalInserted  += r.inserted;
    totalSkipped   += r.skipped;
    totalSnapshots += r.snapshots;
    await sleep(500);
  }

  const quota = quotaGuard.getStats();
  console.log(`[historical] Cycle complete — inserted=${totalInserted} skipped=${totalSkipped} snapshots=${totalSnapshots} ingest_units=${ingestUsed}/${INGEST_BUDGET} total_quota=${quota.used}/${quota.cutoff}`);
  setLastRun('historical_ingest');
  return { channels: channels.length, inserted: totalInserted, skipped: totalSkipped, snapshots: totalSnapshots };
}

function startHistoricalIngestCron() {
  cron.schedule('0 3 * * *', () => {
    withCronRetry(runHistoricalIngestCycle, 'historical', { maxAttempts: 3, retryDelayMs: 20 * 60 * 1000 });
  });
  console.log('[Historical Ingest Cron] Scheduled — daily at 03:00 UTC');

  if (hoursSinceLastRun('historical_ingest') > 23) {
    console.log('[Historical Ingest Cron] Missed window detected — catch-up run in 15s');
    setTimeout(() => {
      withCronRetry(runHistoricalIngestCycle, 'historical-catchup', { maxAttempts: 3, retryDelayMs: 20 * 60 * 1000 });
    }, 15_000);
  }
}

module.exports = { startHistoricalIngestCron, runHistoricalIngestCycle, ingestChannel };
