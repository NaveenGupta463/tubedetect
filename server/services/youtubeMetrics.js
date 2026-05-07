// YouTube Data API v3 — views and publishedAt only.
// CTR and retention require YouTube Analytics API (OAuth) — set null otherwise.
// Key name matches existing backend convention: YT_API_KEY

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

function getYtKey() {
  // Accept either name so it works alongside the existing backend
  const key = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('[youtubeMetrics] Missing YT_API_KEY in backend/.env');
  return key;
}

/**
 * Fetch view count for a YouTube video ID via Data API v3.
 * Returns { views, publishedAt, ctr: null, retention: null }.
 *
 * Note: CTR and retention are NOT available via YouTube Data API v3.
 * They require channel-owner OAuth via YouTube Analytics API.
 *
 * @param {string} videoId       - YouTube video ID
 * @param {string|null} oauthToken
 */
async function fetchVideoMetrics(videoId, oauthToken = null) {
  const url = `${YT_BASE}/videos?part=statistics,snippet&id=${videoId}&key=${getYtKey()}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!res.ok) throw new Error(`YouTube API error: ${data?.error?.message || res.status}`);

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

/**
 * YouTube Analytics API — requires channel-owner OAuth token.
 */
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

/**
 * Search YouTube for videos by keyword (one page).
 * Returns { items, nextPageToken }.
 * Pass pageToken to fetch subsequent pages.
 */
async function searchVideosByKeyword(keyword, maxResults = 50, pageToken = null) {
  let url = `${YT_BASE}/search?part=snippet&q=${encodeURIComponent(keyword)}`
    + `&type=video&maxResults=${Math.min(maxResults, 50)}&key=${getYtKey()}`;
  if (pageToken) url += `&pageToken=${pageToken}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!res.ok) throw new Error(`YouTube search error: ${data?.error?.message || res.status}`);

  const items = (data.items ?? []).map(item => ({
    videoId:     item.id?.videoId,
    channelId:   item.snippet?.channelId,
    title:       item.snippet?.title,
    publishedAt: item.snippet?.publishedAt,
  })).filter(v => v.videoId);

  return { items, nextPageToken: data.nextPageToken ?? null };
}

/**
 * Batch-fetch view + like counts for up to 50 video IDs in one API call.
 * Returns Map<videoId, { views, likes }>.
 */
async function fetchVideoStatsBatch(videoIds) {
  if (!videoIds.length) return new Map();

  const ids = videoIds.slice(0, 50).join(',');
  const url = `${YT_BASE}/videos?part=statistics&id=${ids}&key=${getYtKey()}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!res.ok) throw new Error(`YouTube videos error: ${data?.error?.message || res.status}`);

  const map = new Map();
  for (const item of (data.items ?? [])) {
    map.set(item.id, {
      views: parseInt(item.statistics?.viewCount  ?? '0', 10),
      likes: parseInt(item.statistics?.likeCount  ?? '0', 10),
    });
  }
  return map;
}

/**
 * Batch-fetch subscriber counts for up to 50 channel IDs in one API call.
 * Returns Map<channelId, subscriberCount>.
 */
async function fetchChannelStatsBatch(channelIds) {
  if (!channelIds.length) return new Map();

  const ids = [...new Set(channelIds)].slice(0, 50).join(',');
  const url = `${YT_BASE}/channels?part=statistics&id=${ids}&key=${getYtKey()}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (!res.ok) throw new Error(`YouTube channels error: ${data?.error?.message || res.status}`);

  const map = new Map();
  for (const item of (data.items ?? [])) {
    const subs = parseInt(item.statistics?.subscriberCount ?? '0', 10);
    map.set(item.id, subs);
  }
  return map;
}

/**
 * Fetch full video data (snippet + statistics) for a single video ID.
 * Returns { title, channelId, publishedAt, views, likes }.
 * Costs 1 quota unit.
 */
async function fetchVideoFull(videoId) {
  const url  = `${YT_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${getYtKey()}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube videos error: ${data?.error?.message || res.status}`);
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

module.exports = { fetchVideoMetrics, fetchVideoFull, searchVideosByKeyword, fetchVideoStatsBatch, fetchChannelStatsBatch };
