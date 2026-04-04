// ── TubeIntel Background Service Worker ──────────────────────────────────────

const API_KEY  = 'AIzaSyBXdk4qIKKnSum1R1sc40DHDnqbrxe9m7A';
const YT_BASE  = 'https://www.googleapis.com/youtube/v3';
const CACHE_MS = 10 * 60 * 1000; // 10 min

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = new Map();

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_MS) { cache.delete(key); return null; }
  return hit.data;
}
function toCache(key, data) {
  cache.set(key, { ts: Date.now(), data });
}

// ── YouTube API helpers ───────────────────────────────────────────────────────
async function ytFetch(endpoint, params) {
  const url = new URL(`${YT_BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`YT API ${res.status}`);
  return res.json();
}

async function getChannelByHandle(handle) {
  const cacheKey = `channel_handle_${handle}`;
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  // Try forHandle first (works for @handles)
  const clean = handle.replace(/^@/, '');
  let data = await ytFetch('channels', {
    part: 'snippet,statistics,brandingSettings',
    forHandle: clean,
  });

  if (!data.items?.length) {
    // Fallback: search
    const search = await ytFetch('search', {
      part: 'snippet',
      q: handle,
      type: 'channel',
      maxResults: 1,
    });
    const id = search.items?.[0]?.id?.channelId;
    if (!id) return null;
    data = await ytFetch('channels', {
      part: 'snippet,statistics,brandingSettings',
      id,
    });
  }

  const ch = data.items?.[0] || null;
  if (ch) toCache(cacheKey, ch);
  return ch;
}

async function getChannelById(channelId) {
  const cacheKey = `channel_id_${channelId}`;
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const data = await ytFetch('channels', {
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
  });
  const ch = data.items?.[0] || null;
  if (ch) toCache(cacheKey, ch);
  return ch;
}

async function getTopVideos(channelId, maxResults = 5) {
  const cacheKey = `top_videos_${channelId}`;
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  // Get recent uploads playlist
  const chData = await ytFetch('channels', {
    part: 'contentDetails',
    id: channelId,
  });
  const uploadsId = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  const plData = await ytFetch('playlistItems', {
    part: 'contentDetails',
    playlistId: uploadsId,
    maxResults: 20,
  });
  const ids = (plData.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];

  const vData = await ytFetch('videos', {
    part: 'snippet,statistics',
    id: ids.slice(0, 20).join(','),
  });

  const sorted = (vData.items || [])
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, maxResults);

  if (sorted.length) toCache(cacheKey, sorted);
  return sorted;
}

async function getVideoById(videoId) {
  const cacheKey = `video_${videoId}`;
  const cached = fromCache(cacheKey);
  if (cached) return cached;

  const data = await ytFetch('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoId,
  });
  const v = data.items?.[0] || null;
  if (v) toCache(cacheKey, v);
  return v;
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    try {
      switch (msg.type) {

        case 'GET_CHANNEL_BY_HANDLE': {
          const ch = await getChannelByHandle(msg.handle);
          if (!ch) return { ok: false, error: 'Channel not found' };
          const topVids = await getTopVideos(ch.id).catch(() => []);
          return { ok: true, channel: ch, topVideos: topVids };
        }

        case 'GET_CHANNEL_BY_ID': {
          const ch = await getChannelById(msg.channelId);
          if (!ch) return { ok: false, error: 'Channel not found' };
          const topVids = await getTopVideos(msg.channelId).catch(() => []);
          return { ok: true, channel: ch, topVideos: topVids };
        }

        case 'GET_VIDEO': {
          const v = await getVideoById(msg.videoId);
          if (!v) return { ok: false, error: 'Video not found' };
          let channel = null;
          if (v.snippet?.channelId) {
            channel = await getChannelById(v.snippet.channelId).catch(() => null);
          }
          return { ok: true, video: v, channel };
        }

        case 'GET_CURRENT_TAB_INFO': {
          return { ok: true };
        }

        default:
          return { ok: false, error: 'Unknown message type' };
      }
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  handle().then(sendResponse);
  return true; // keep channel open for async
});
