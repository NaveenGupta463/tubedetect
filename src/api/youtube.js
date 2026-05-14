import { ROUTES, SCORING_URL } from '../config';
import * as storage from '../utils/storage';

const CACHE_TTL    = 30 * 60 * 1000;
const CACHE_PREFIX = 'tubeintel_yt3_';

// Evict stale entries from old cache prefix versions
storage.removeByPrefix('tubeintel_yt_');
storage.removeByPrefix('tubeintel_yt2_');

function cacheGet(key) {
  return storage.getCached(CACHE_PREFIX + key, CACHE_TTL);
}

function cacheSet(key, data) {
  storage.setCached(CACHE_PREFIX + key, data);
}

// In-flight deduplication: avoid firing the same request twice simultaneously
const inflight = new Map();

async function apiFetch(endpoint, params) {
  const url = new URL(`${ROUTES.youtube}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const key = url.toString();

  // Return cached result if fresh
  const cached = cacheGet(key);
  if (cached) return cached;

  // Deduplicate in-flight requests
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const res  = await fetch(key);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `API Error ${res.status}`);
      // Don't cache empty item lists — channel not found by handle shouldn't poison the cache
      if (!('items' in data) || data.items?.length > 0) cacheSet(key, data);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export function parseChannelInput(input) {
  input = (input || '').trim();
  if (!input) return null;

  if (input.includes('youtube.com')) {
    const idMatch = input.match(/\/channel\/(UC[\w-]+)/);
    if (idMatch) return { type: 'id', value: idMatch[1] };

    const handleMatch = input.match(/\/@([\w.-]+)/);
    if (handleMatch) return { type: 'handle', value: handleMatch[1] };

    const userMatch = input.match(/\/user\/([\w.-]+)/);
    if (userMatch) return { type: 'username', value: userMatch[1] };

    const cMatch = input.match(/\/c\/([\w.-]+)/);
    if (cMatch) return { type: 'handle', value: cMatch[1] };
  }

  if (input.startsWith('@')) return { type: 'handle', value: input.slice(1) };
  if (/^UC[\w-]{20,}$/.test(input)) return { type: 'id', value: input };

  return { type: 'handle', value: input };
}

export async function fetchChannel(rawInput) {
  const parsed = parseChannelInput(rawInput);
  if (!parsed) throw new Error('Please enter a valid channel URL or @handle');

  // ── Step 1: Check local DB cache (0 quota) ────────────────────────────────
  try {
    const params = new URLSearchParams();
    if (parsed.type === 'id') params.set('id', parsed.value);
    else params.set('handle', parsed.value);
    const r = await fetch(`${SCORING_URL}/api/channel-cache/channel?${params}`);
    if (r.ok) {
      const { hit, channel } = await r.json();
      if (hit && channel) {
        // Fire background stats refresh — non-blocking, best-effort
        fetch(`${SCORING_URL}/api/channel-cache/channel/${channel.id}/refresh-stats`, { method: 'POST' }).catch(() => {});
        console.log('[yt] cache_hit channel', channel.id);
        return channel;
      }
    }
  } catch { /* DB unavailable — fall through to YouTube */ }

  // ── Step 2: Fetch from YouTube ────────────────────────────────────────────
  const params = { part: 'snippet,statistics,brandingSettings,contentDetails' };
  if (parsed.type === 'id') params.id = parsed.value;
  else if (parsed.type === 'handle') params.forHandle = parsed.value;
  else if (parsed.type === 'username') params.forUsername = parsed.value;

  const data = await apiFetch('channels', params);
  if (!data.items?.length) {
    throw new Error(`Channel not found. Try using the @handle directly, e.g. @${parsed.value}`);
  }
  const channel = data.items[0];

  // ── Step 3: Persist to DB cache permanently ───────────────────────────────
  fetch(`${SCORING_URL}/api/channel-cache/channel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  }).catch(() => {});

  console.log('[yt] cache_miss channel', channel.id, '— fetched from YouTube + cached');
  return channel;
}

export async function fetchChannelVideos(channelId, maxResults = 50) {
  // ── Step 1: Check local DB cache (0 quota) ────────────────────────────────
  try {
    const r = await fetch(`${SCORING_URL}/api/channel-cache/channel/${channelId}/videos`);
    if (r.ok) {
      const { hit, videos } = await r.json();
      if (hit && videos?.length >= 1) {
        fetch(`${SCORING_URL}/api/channel-cache/channel/${channelId}/refresh-stats`, { method: 'POST' }).catch(() => {});
        console.log('[yt] cache_hit videos', channelId, videos.length);
        return videos;
      }
    }
  } catch { /* DB unavailable — fall through to YouTube */ }

  // ── Step 2: Get uploads playlist (prefer channel_cache, avoid extra API call) ──
  let uploadsId;
  try {
    const r = await fetch(`${SCORING_URL}/api/channel-cache/channel?id=${channelId}`);
    if (r.ok) {
      const { hit, channel } = await r.json();
      uploadsId = channel?.contentDetails?.relatedPlaylists?.uploads;
    }
  } catch { /* ignore */ }

  if (!uploadsId) {
    const channelData = await apiFetch('channels', { part: 'contentDetails', id: channelId });
    uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  }
  if (!uploadsId) throw new Error('Could not find uploads playlist for this channel');

  // ── Step 3: Fetch from YouTube ────────────────────────────────────────────
  const playlistData = await apiFetch('playlistItems', {
    part: 'contentDetails',
    playlistId: uploadsId,
    maxResults,
  });

  const videoIds = playlistData.items?.map(i => i.contentDetails.videoId).join(',');
  if (!videoIds) return [];

  const videosData = await apiFetch('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoIds,
  });

  const videos = videosData.items || [];

  // ── Step 4: Persist to DB cache (fire-and-forget) ─────────────────────────
  if (videos.length) {
    fetch(`${SCORING_URL}/api/channel-cache/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos }),
    }).catch(() => {});
    console.log('[yt] cache_miss videos', channelId, '— fetched from YouTube + cached', videos.length);
  }

  return videos;
}

export async function fetchChannelVideosExpanded(channelId, maxVideos = 200) {
  const cacheKey = `expanded_ch_${channelId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const channelData = await apiFetch('channels', { part: 'contentDetails', id: channelId });
  const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  const oneYearAgo = Date.now() - 365 * 24 * 3_600_000;
  const allItems = [];
  let pageToken;

  while (allItems.length < maxVideos) {
    const params = { part: 'contentDetails', playlistId: uploadsId, maxResults: 50 };
    if (pageToken) params.pageToken = pageToken;
    const page = await apiFetch('playlistItems', params);
    const items = page.items || [];
    if (!items.length) break;
    let hitLimit = false;
    for (const item of items) {
      const pubAt = item.contentDetails?.videoPublishedAt;
      if (pubAt && new Date(pubAt).getTime() < oneYearAgo) { hitLimit = true; break; }
      allItems.push(item);
    }
    if (hitLimit || !page.nextPageToken || allItems.length >= maxVideos) break;
    pageToken = page.nextPageToken;
  }

  if (!allItems.length) return [];
  const ids = allItems.map(i => i.contentDetails.videoId);
  const results = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).join(',');
    const data = await apiFetch('videos', { part: 'snippet,statistics,contentDetails', id: batch });
    results.push(...(data.items || []));
  }
  cacheSet(cacheKey, results);
  return results;
}

export async function searchChannels(query, maxResults = 8) {
  try {
    const searchData = await apiFetch('search', {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults,
    });
    const items = searchData.items || [];
    if (!items.length) return [];

    const ids = items.map(i => i.id.channelId).join(',');
    const chData = await apiFetch('channels', { part: 'snippet,statistics', id: ids });
    const chMap = {};
    (chData.items || []).forEach(c => { chMap[c.id] = c; });

    return items.map(item => {
      const ch    = chMap[item.id.channelId] || {};
      const thumb = ch.snippet?.thumbnails?.default?.url
                 || ch.snippet?.thumbnails?.medium?.url
                 || item.snippet.thumbnails?.default?.url
                 || '';
      return {
        id: item.id.channelId,
        title: ch.snippet?.title || item.snippet.channelTitle,
        description: item.snippet.description,
        thumbnail: thumb.startsWith('//') ? 'https:' + thumb : thumb,
        statistics: ch.statistics || {},
      };
    });
  } catch {
    return [];
  }
}

export async function fetchVideoById(id) {
  // ── Step 1: Check local DB cache (0 quota) ────────────────────────────────
  try {
    const r = await fetch(`${SCORING_URL}/api/channel-cache/video/${id}`);
    if (r.ok) {
      const { hit, video } = await r.json();
      if (hit && video) {
        console.log('[yt] cache_hit video', id);
        return video;
      }
    }
  } catch { /* DB unavailable — fall through to YouTube */ }

  // ── Step 2: Fetch from YouTube ────────────────────────────────────────────
  const data = await apiFetch('videos', {
    part: 'snippet,statistics,contentDetails',
    id,
  });
  if (!data.items?.length) throw new Error('Video not found');
  const video = data.items[0];

  // ── Step 3: Persist to DB cache (fire-and-forget) ─────────────────────────
  fetch(`${SCORING_URL}/api/channel-cache/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videos: [video] }),
  }).catch(() => {});
  console.log('[yt] cache_miss video', id, '— fetched from YouTube + cached');

  return video;
}

export async function fetchVideoComments(videoId, maxResults = 100) {
  try {
    const data = await apiFetch('commentThreads', {
      part: 'snippet',
      videoId,
      maxResults,
      order: 'relevance',
    });
    return data.items || [];
  } catch {
    return [];
  }
}

export async function searchVideos(query, maxResults = 8) {
  try {
    const searchData = await apiFetch('search', {
      part: 'snippet',
      type: 'video',
      q: query,
      maxResults,
    });
    const items = searchData.items || [];
    if (!items.length) return [];
    const ids = items.map(i => i.id.videoId).join(',');
    const statsData = await apiFetch('videos', { part: 'statistics,contentDetails', id: ids });
    const statsMap = {};
    (statsData.items || []).forEach(v => { statsMap[v.id] = v; });
    return items.map(item => {
      const full = statsMap[item.id.videoId] || {};
      return {
        id: item.id.videoId,
        snippet: item.snippet,
        statistics: full.statistics || {},
        contentDetails: full.contentDetails || {},
      };
    });
  } catch {
    return [];
  }
}

export async function searchTopVideos(query, maxResults = 15) {
  try {
    const searchData = await apiFetch('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      order: 'viewCount',
      maxResults,
    });
    const items = searchData.items || [];
    if (!items.length) return [];
    const ids = items.map(i => i.id.videoId).join(',');
    const statsData = await apiFetch('videos', { part: 'statistics,snippet,contentDetails', id: ids });
    return statsData.items || [];
  } catch {
    return [];
  }
}

export async function searchTrendingVideos(query, maxResults = 20) {
  const publishedAfter = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const searchData = await apiFetch('search', {
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'viewCount',
    maxResults,
    publishedAfter,
  });

  const items = searchData.items || [];
  if (!items.length) return [];

  const ids = items.map(i => i.id.videoId).join(',');
  const statsData = await apiFetch('videos', {
    part: 'statistics,snippet,contentDetails',
    id: ids,
  });

  return statsData.items || [];
}
