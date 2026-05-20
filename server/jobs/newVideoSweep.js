const cron   = require('node-cron');
const { getDb }  = require('../db/init');
const quotaGuard = require('../services/quotaGuard');
const { withCronRetry } = require('../utils/cronRetry');
const { fetchVideoFullBatch } = require('../services/youtubeMetrics');
const { upsertIngestedVideo } = require('../db/queries');

// RSS fetches are free — no quota cost. Sweep everything every run.
// Only YouTube API quota is spent when genuinely new video IDs are found.
const CONCURRENCY    = parseInt(process.env.RSS_SWEEP_CONCURRENCY || '50', 10);
const FETCH_TIMEOUT_MS = 8000;

// Niche leaders: channels above this sub count get swept on every run,
// regardless of when they were last scanned.
const NICHE_LEADER_SUBS = 100_000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Live progress — readable via getSweepStatus()
const _state = {
  running:          false,
  total:            0,
  checked:          0,
  new_videos:       0,
  started_at:       null,
  last_completed_at: null,
};

function getSweepStatus() { return { ..._state }; }

// Parse YouTube Atom feed — no XML lib needed, format is stable
function parseRssFeed(xml) {
  const videoIds = [];
  const entryRe  = /<entry>([\s\S]*?)<\/entry>/g;
  const idRe     = /<yt:videoId>([^<]+)<\/yt:videoId>/;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const idMatch = idRe.exec(m[1]);
    if (idMatch) videoIds.push(idMatch[1].trim());
  }
  return videoIds;
}

async function fetchRss(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssFeed(xml);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Returns video IDs from candidateIds that are NOT yet in ingested_videos
function findNewVideoIds(db, channelId, candidateIds) {
  if (!candidateIds.length) return [];
  const placeholders = candidateIds.map(() => '?').join(',');
  const existing = db.all(
    `SELECT youtube_video_id FROM ingested_videos
     WHERE channel_id = ? AND youtube_video_id IN (${placeholders})`,
    [channelId, ...candidateIds],
  ).map(r => r.youtube_video_id);
  const existingSet = new Set(existing);
  return candidateIds.filter(id => !existingSet.has(id));
}

async function sweepChannel(db, channel) {
  const rssIds = await fetchRss(channel.channel_id);
  if (!rssIds.length) return { new: 0 };

  const newIds = findNewVideoIds(db, channel.channel_id, rssIds);
  stampChannel(db, channel.channel_id);
  if (!newIds.length) return { new: 0 };

  if (!quotaGuard.quotaAvailable()) {
    console.warn(`[rss-sweep] Quota exhausted — skipping video fetch for ${channel.channel_id}`);
    return { new: 0 };
  }

  let inserted = 0;
  try {
    const videoMap = await fetchVideoFullBatch(newIds);
    quotaGuard.recordUsage(1, 'rss-sweep');

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
          channel_subscribers: channel.channel_subscribers ?? 0,
        });
        inserted++;
      } catch (e) {
        if (!e.message?.includes('UNIQUE')) {
          console.warn(`[rss-sweep] upsert failed (${ytId}):`, e.message);
        }
      }
    }
  } catch (e) {
    console.warn(`[rss-sweep] videos.list failed for ${channel.channel_id}:`, e.message);
  }

  return { new: inserted };
}

function stampChannel(db, channelId) {
  db.run(
    `UPDATE ingested_channels SET last_rss_scan_at = datetime('now') WHERE channel_id = ?`,
    [channelId],
  );
}

// Ordering:
// 1. Own channels always first
// 2. Niche leaders (>100K subs) — sorted by subscriber count desc so biggest come first
// 3. Everyone else — oldest-scanned first so no channel starves
function getChannelsForSweep(db) {
  return db.all(
    `SELECT channel_id, niche, channel_subscribers, is_own_channel
     FROM ingested_channels
     WHERE ingest_enabled = 1
     ORDER BY
       is_own_channel DESC,
       CASE WHEN channel_subscribers >= ${NICHE_LEADER_SUBS} THEN 0 ELSE 1 END ASC,
       channel_subscribers DESC,
       CASE WHEN last_rss_scan_at IS NULL THEN 0 ELSE 1 END ASC,
       last_rss_scan_at ASC`,
  );
}

async function runNewVideoSweep() {
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[rss-sweep] YT_API_KEY not set — skipping');
    return;
  }
  if (_state.running) {
    console.warn('[rss-sweep] Already running — skipping');
    return;
  }

  const db       = getDb();
  const channels = getChannelsForSweep(db);
  if (!channels.length) {
    console.log('[rss-sweep] No channels to sweep');
    return;
  }

  Object.assign(_state, {
    running:    true,
    total:      channels.length,
    checked:    0,
    new_videos: 0,
    started_at: new Date().toISOString(),
  });

  const leaders = channels.filter(c => (c.channel_subscribers ?? 0) >= NICHE_LEADER_SUBS || c.is_own_channel).length;
  console.log(`[rss-sweep] Starting — ${channels.length} total (${leaders} niche leaders/own), concurrency=${CONCURRENCY}`);

  try {
    for (let i = 0; i < channels.length; i += CONCURRENCY) {
      const batch   = channels.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(ch => sweepChannel(db, ch)));
      _state.checked    += batch.length;
      _state.new_videos += results.reduce((s, r) => s + r.new, 0);

      if (i % (CONCURRENCY * 10) === 0 && i > 0) {
        console.log(`[rss-sweep] ${_state.checked}/${_state.total} checked — ${_state.new_videos} new videos`);
      }

      if (i + CONCURRENCY < channels.length) await sleep(300);
    }
  } finally {
    const quota = quotaGuard.getStats();
    console.log(`[rss-sweep] Done — checked=${_state.checked} new_videos=${_state.new_videos} quota=${quota.used}/${quota.cutoff}`);
    _state.running           = false;
    _state.last_completed_at = new Date().toISOString();
  }
}

function startNewVideoSweepCron() {
  // Every 6 hours — niche leaders and own channels get new videos picked up 4× per day.
  // Full sweep of 13k channels takes ~4 minutes, well within any window.
  cron.schedule('0 */6 * * *', () => {
    withCronRetry(runNewVideoSweep, 'rss-sweep', { maxAttempts: 2, retryDelayMs: 15 * 60 * 1000 });
  });
  console.log('[RSS Sweep Cron] Scheduled — every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)');

  // Startup sweep after 60s so DB migrations are done and server is warm
  setTimeout(() => {
    console.log('[RSS Sweep Cron] Startup sweep firing');
    withCronRetry(runNewVideoSweep, 'rss-sweep-startup', { maxAttempts: 1, retryDelayMs: 0 });
  }, 60_000);
}

module.exports = { startNewVideoSweepCron, runNewVideoSweep, getSweepStatus };
