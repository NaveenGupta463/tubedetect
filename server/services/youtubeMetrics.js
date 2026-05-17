const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const { getApiKey, markExhausted, isQuotaError } = require('./apiKeyManager');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Rotates through all available keys on quota errors.
// Retries transient network and 5xx errors up to 3 times per key before giving up.
async function ytFetch(url) {
  for (let keyAttempt = 0; keyAttempt < 12; keyAttempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const sep  = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}key=${key}`;

    for (let t = 1; t <= 3; t++) {
      let res, data;
      try {
        res  = await fetch(full);
        data = await res.json();
      } catch (_) {
        if (t < 3) { await sleep(2000 * t); continue; }
        throw new Error('network_error_after_retries');
      }

      if (!res.ok) {
        const msg = data?.error?.message || String(res.status);
        if (isQuotaError(msg) || res.status === 429) { markExhausted(key); break; }
        if (res.status >= 500 && t < 3) { await sleep(3000 * t); continue; }
        throw new Error(msg);
      }
      return data;
    }
  }
  throw new Error('all_api_keys_exhausted');
}

async function fetchVideoMetrics(videoId, oauthToken = null) {
  const data = await ytFetch(`${YT_BASE}/videos?part=statistics,snippet&id=${videoId}`);
  const item = data.items?.[0];
  if (!item) throw new Error(`Video not found: ${videoId}`);

  const views       = parseInt(item.statistics?.viewCount ?? '0', 10);
  const publishedAt = item.snippet?.publishedAt ?? null;
  let ctr = null, retention = null;

  if (oauthToken) {
    try {
      const analytics = await fetchAnalyticsMetrics(videoId, oauthToken);
      ctr       = analytics.ctr;
      retention = analytics.retention;
    } catch (e) {
      console.warn('[youtubeMetrics] Analytics API failed:', e.message);
    }
  }

  return { views, publishedAt, ctr, retention };
}

async function fetchAnalyticsMetrics(videoId, oauthToken) {
  const endDate   = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const url = `https://youtubeanalytics.googleapis.com/v2/reports` +
    `?ids=channel==MINE&filters=video==${videoId}` +
    `&metrics=views,cardClickRate,averageViewPercentage` +
    `&startDate=${startDate}&endDate=${endDate}&dimensions=video`;
  const res  = await fetch(url, { headers: { Authorization: `Bearer ${oauthToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Analytics API error');
  const row = data.rows?.[0];
  if (!row) return { ctr: null, retention: null };
  return {
    ctr:       row[2] != null ? parseFloat((row[2] * 100).toFixed(2)) : null,
    retention: row[3] != null ? parseFloat(row[3].toFixed(2))         : null,
  };
}

async function searchVideosByKeyword(keyword, maxResults = 50, pageToken = null) {
  let url = `${YT_BASE}/search?part=snippet&q=${encodeURIComponent(keyword)}&type=video&maxResults=${Math.min(maxResults, 50)}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const data  = await ytFetch(url);
  const items = (data.items ?? []).map(item => ({
    videoId:     item.id?.videoId,
    channelId:   item.snippet?.channelId,
    title:       item.snippet?.title,
    publishedAt: item.snippet?.publishedAt,
  })).filter(v => v.videoId);
  return { items, nextPageToken: data.nextPageToken ?? null };
}

async function fetchVideoStatsBatch(videoIds) {
  if (!videoIds.length) return new Map();
  const ids  = videoIds.slice(0, 50).join(',');
  const data = await ytFetch(`${YT_BASE}/videos?part=statistics&id=${ids}`);
  const map  = new Map();
  for (const item of (data.items ?? [])) {
    map.set(item.id, {
      views: parseInt(item.statistics?.viewCount ?? '0', 10),
      likes: parseInt(item.statistics?.likeCount ?? '0', 10),
    });
  }
  return map;
}

async function fetchChannelStatsBatch(channelIds) {
  if (!channelIds.length) return new Map();
  const ids  = [...new Set(channelIds)].slice(0, 50).join(',');
  const data = await ytFetch(`${YT_BASE}/channels?part=statistics&id=${ids}&maxResults=50`);
  const map  = new Map();
  for (const item of (data.items ?? [])) {
    map.set(item.id, parseInt(item.statistics?.subscriberCount ?? '0', 10));
  }
  return map;
}

async function fetchVideoFull(videoId) {
  const data = await ytFetch(`${YT_BASE}/videos?part=snippet,statistics&id=${videoId}`);
  const item = data.items?.[0];
  if (!item) throw new Error(`Video not found: ${videoId}`);
  return {
    title:       item.snippet?.title       ?? '',
    channelId:   item.snippet?.channelId   ?? '',
    publishedAt: item.snippet?.publishedAt ?? null,
    views:       parseInt(item.statistics?.viewCount ?? '0', 10),
    likes:       parseInt(item.statistics?.likeCount ?? '0', 10),
  };
}

async function fetchChannelContentDetails(channelId) {
  const data = await ytFetch(`${YT_BASE}/channels?part=contentDetails,snippet,statistics&id=${channelId}`);
  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found: ${channelId}`);
  return {
    channelName:       item.snippet?.title ?? '',
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    subscriberCount:   parseInt(item.statistics?.subscriberCount ?? '0', 10),
  };
}

async function fetchPlaylistItems(playlistId, pageToken = null, maxResults = 50) {
  let url = `${YT_BASE}/playlistItems?part=contentDetails&playlistId=${playlistId}&maxResults=${Math.min(maxResults, 50)}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const data = await ytFetch(url);
  return {
    videoIds:      (data.items ?? []).map(i => i.contentDetails?.videoId).filter(Boolean),
    nextPageToken: data.nextPageToken ?? null,
  };
}

async function fetchVideoFullBatch(videoIds) {
  if (!videoIds.length) return new Map();
  const ids  = videoIds.slice(0, 50).join(',');
  const data = await ytFetch(`${YT_BASE}/videos?part=snippet,statistics,contentDetails&id=${ids}`);
  const map  = new Map();
  for (const item of (data.items ?? [])) {
    const raw = item.contentDetails?.duration ?? '';
    const m   = raw.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const duration_seconds = m
      ? (parseInt(m[1] ?? 0) * 3600 + parseInt(m[2] ?? 0) * 60 + parseInt(m[3] ?? 0))
      : null;
    map.set(item.id, {
      title:           item.snippet?.title          ?? '',
      description:     item.snippet?.description    ?? '',
      published_at:    item.snippet?.publishedAt    ?? null,
      channel_id:      item.snippet?.channelId      ?? '',
      category_id:     item.snippet?.categoryId     ?? null,
      duration_seconds,
      views:           parseInt(item.statistics?.viewCount    ?? '0', 10),
      likes:           parseInt(item.statistics?.likeCount    ?? '0', 10),
      comments:        parseInt(item.statistics?.commentCount ?? '0', 10),
    });
  }
  return map;
}

module.exports = {
  fetchVideoMetrics, fetchVideoFull, searchVideosByKeyword,
  fetchVideoStatsBatch, fetchChannelStatsBatch,
  fetchChannelContentDetails, fetchPlaylistItems, fetchVideoFullBatch,
};
