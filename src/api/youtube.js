const BASE = `${import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'}/api/youtube`;

// ─── Frontend cache (localStorage, 6-hour TTL) ───────────────────────────────
const CACHE_TTL    = 30 * 60 * 1000; // 30 minutes
const CACHE_PREFIX = 'tubeintel_yt2_'; // bumped to evict stale entries from old cache

// Clear any entries from the old cache prefix
try {
  Object.keys(localStorage)
    .filter(k => k.startsWith('tubeintel_yt_'))
    .forEach(k => localStorage.removeItem(k));
} catch {}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key, data) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// In-flight deduplication: avoid firing the same request twice simultaneously
const inflight = new Map();

async function apiFetch(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
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

  const params = { part: 'snippet,statistics,brandingSettings' };

  if (parsed.type === 'id') params.id = parsed.value;
  else if (parsed.type === 'handle') params.forHandle = parsed.value;
  else if (parsed.type === 'username') params.forUsername = parsed.value;

  const data = await apiFetch('channels', params);

  if (!data.items?.length) {
    throw new Error(`Channel not found. Try using the @handle directly, e.g. @${parsed.value}`);
  }
  return data.items[0];
}

export async function fetchChannelVideos(channelId, maxResults = 50) {
  const channelData = await apiFetch('channels', {
    part: 'contentDetails',
    id: channelId,
  });

  const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error('Could not find uploads playlist for this channel');

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

  return videosData.items || [];
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

export async function fetchVideoById(videoId) {
  const data = await apiFetch('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoId,
  });
  if (!data.items?.length) throw new Error('Video not found');
  return data.items[0];
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
