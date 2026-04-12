// ── TubeIntel Background Service Worker ──────────────────────────────────────
// All YouTube API calls are proxied through the local TubeIntel backend.
// This keeps the API key off the extension and uses the same proven proxy.

const BACKEND  = 'http://localhost:3001/api/youtube';
const CACHE_MS = 5 * 60 * 1000; // 5 min

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = new Map();

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_MS) { cache.delete(key); return null; }
  return hit.data;
}
function toCache(key, data) {
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, { ts: Date.now(), data });
}

// ── Backend proxy helper ──────────────────────────────────────────────────────
async function ytFetch(endpoint, params, force = false) {
  const url = new URL(`${BACKEND}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (force) url.searchParams.set('refresh', '1');
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `API error ${res.status}`);
  return data;
}

// ── Data helpers ──────────────────────────────────────────────────────────────
async function getChannelByHandle(handle, force = false) {
  const cacheKey = `channel_handle_${handle}`;
  if (force) cache.delete(cacheKey);
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const clean = handle.replace(/^@/, '');
  let data = await ytFetch('channels', {
    part: 'snippet,statistics,brandingSettings',
    forHandle: clean,
  }, force);

  if (!data.items?.length) {
    const search = await ytFetch('search', {
      part: 'snippet',
      q: handle,
      type: 'channel',
      maxResults: 1,
    }, force);
    const id = search.items?.[0]?.id?.channelId;
    if (!id) return null;
    data = await ytFetch('channels', {
      part: 'snippet,statistics,brandingSettings',
      id,
    }, force);
  }

  const ch = data.items?.[0] || null;
  if (ch) toCache(cacheKey, ch);
  return ch;
}

async function getChannelById(channelId, force = false) {
  const cacheKey = `channel_id_${channelId}`;
  if (force) cache.delete(cacheKey);
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const data = await ytFetch('channels', {
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
  }, force);
  const ch = data.items?.[0] || null;
  if (ch) toCache(cacheKey, ch);
  return ch;
}

async function getTopVideos(channelId, maxResults = 5, force = false) {
  const cacheKey = `top_videos_${channelId}`;
  if (force) cache.delete(cacheKey);
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const chData = await ytFetch('channels', { part: 'contentDetails', id: channelId }, force);
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  const plData = await ytFetch('playlistItems', {
    part: 'contentDetails',
    playlistId: uploadsId,
    maxResults: 20,
  }, force);
  const ids = (plData.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];

  const vData = await ytFetch('videos', {
    part: 'snippet,statistics',
    id: ids.slice(0, 20).join(','),
  }, force);

  const sorted = (vData.items || [])
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, maxResults);

  if (sorted.length) toCache(cacheKey, sorted);
  return sorted;
}

async function getVideoById(videoId, force = false) {
  const cacheKey = `video_${videoId}`;
  if (force) cache.delete(cacheKey);
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const data = await ytFetch('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoId,
  }, force);
  const v = data.items?.[0] || null;
  if (v) toCache(cacheKey, v);
  return v;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {

        case 'GET_CHANNEL_BY_HANDLE': {
          const ch = await getChannelByHandle(msg.handle, msg.force);
          if (!ch) return { ok: false, error: 'Channel not found' };
          const topVids = await getTopVideos(ch.id, 5, msg.force).catch(() => []);
          return { ok: true, channel: ch, topVideos: topVids };
        }

        case 'GET_CHANNEL_BY_ID': {
          const ch = await getChannelById(msg.channelId, msg.force);
          if (!ch) return { ok: false, error: 'Channel not found' };
          const topVids = await getTopVideos(msg.channelId, 5, msg.force).catch(() => []);
          return { ok: true, channel: ch, topVideos: topVids };
        }

        case 'GET_VIDEO': {
          const v = await getVideoById(msg.videoId, msg.force);
          if (!v) return { ok: false, error: 'Video not found' };
          const channel = v.snippet?.channelId
            ? await getChannelById(v.snippet.channelId, msg.force).catch(() => null)
            : null;
          return { ok: true, video: v, channel };
        }

        default:
          return { ok: false, error: 'Unknown message type' };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })().then(sendResponse);

  return true; // keep message channel open for async response
});
