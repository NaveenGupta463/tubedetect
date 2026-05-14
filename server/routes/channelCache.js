'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const {
  getChannelCache,
  getChannelCacheByHandle,
  upsertChannelCache,
  getVideoCache,
  getVideoCacheById,
  getVideoCacheIds,
  upsertVideoCache,
  updateVideoCacheStats,
} = require('../db/queries');

// ── GET channel by id or handle ───────────────────────────────────────────────
// Query params: ?id=UCxxx  OR  ?handle=mkbhd

router.get('/channel-cache/channel', (req, res) => {
  try {
    const db = getDb();
    const { id, handle } = req.query;
    let channel = null;
    if (id)             channel = getChannelCache(db, id);
    if (!channel && handle) channel = getChannelCacheByHandle(db, handle);
    if (!channel) return res.status(404).json({ hit: false });
    res.json({ hit: true, channel, cache_source: 'channel_cache' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST store channel ────────────────────────────────────────────────────────
// Body: { channel: <YouTube channels.list item> }

router.post('/channel-cache/channel', (req, res) => {
  try {
    const db = getDb();
    const { channel } = req.body ?? {};
    if (!channel?.id) return res.status(400).json({ error: 'channel.id required' });
    upsertChannelCache(db, channel);
    res.json({ ok: true, channel_id: channel.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET videos for channel ────────────────────────────────────────────────────

router.get('/channel-cache/channel/:channelId/videos', (req, res) => {
  try {
    const db     = getDb();
    const videos = getVideoCache(db, req.params.channelId);
    if (!videos.length) return res.status(404).json({ hit: false });
    res.json({ hit: true, videos, count: videos.length, cache_source: 'video_cache' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST store videos ─────────────────────────────────────────────────────────
// Body: { videos: [<YouTube videos.list items>] }

router.post('/channel-cache/videos', (req, res) => {
  try {
    const db = getDb();
    const { videos } = req.body ?? {};
    if (!Array.isArray(videos)) return res.status(400).json({ error: 'videos[] required' });
    for (const v of videos) upsertVideoCache(db, v);
    res.json({ ok: true, stored: videos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET single video by ID ────────────────────────────────────────────────────

router.get('/channel-cache/video/:videoId', (req, res) => {
  try {
    const db    = getDb();
    const video = getVideoCacheById(db, req.params.videoId);
    if (!video) return res.status(404).json({ hit: false });
    res.json({ hit: true, video, cache_source: 'video_cache' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST background stats refresh ─────────────────────────────────────────────
// Responds immediately. Calls YouTube videos.list in background using
// the server's own YT_API_KEY. Cost: 1 quota unit per 50 cached videos.

router.post('/channel-cache/channel/:channelId/refresh-stats', async (req, res) => {
  res.json({ ok: true, queued: true });
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return;
  try {
    const db  = getDb();
    const ids = getVideoCacheIds(db, req.params.channelId);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50).join(',');
      const url   = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(batch)}&key=${apiKey}`;
      const resp  = await fetch(url);
      if (!resp.ok) { console.warn('[channel-cache] refresh-stats YouTube error', resp.status); break; }
      const data  = await resp.json();
      for (const item of (data.items ?? [])) {
        updateVideoCacheStats(db, item.id, item.statistics);
      }
    }
    console.log(`[channel-cache] stats refreshed — ${ids.length} videos, channel ${req.params.channelId}`);
  } catch (e) {
    console.warn('[channel-cache] refresh-stats error:', e.message);
  }
});

// ── GET cache observability stats ─────────────────────────────────────────────

router.get('/channel-cache/stats', (req, res) => {
  try {
    const db       = getDb();
    const channels = db.get('SELECT COUNT(*) AS n FROM channel_cache') ?? { n: 0 };
    const videos   = db.get('SELECT COUNT(*) AS n FROM video_cache')   ?? { n: 0 };
    const stale    = db.get(
      `SELECT COUNT(*) AS n FROM channel_cache
       WHERE stats_refreshed_at < datetime('now','-24 hours') OR stats_refreshed_at IS NULL`
    ) ?? { n: 0 };
    const hitExample = db.all(
      `SELECT channel_id, title, cached_at, stats_refreshed_at
       FROM channel_cache ORDER BY cached_at DESC LIMIT 5`
    );
    res.json({
      cached_channels:  channels.n,
      cached_videos:    videos.n,
      stale_channels:   stale.n,
      recent_channels:  hitExample,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
