const quotaGuard = require('./quotaGuard');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

function getYtKey() {
  const key = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YT_API_KEY not set');
  return key;
}

async function ytGet(path, params) {
  const qs  = new URLSearchParams({ ...params, key: getYtKey() }).toString();
  const res = await fetch(`${YT_BASE}/${path}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `YouTube API error ${res.status}`);
  return data;
}

// Resolve a raw handle/URL/channel-id to a channel ID + basic metadata
async function resolveSeedChannel(raw) {
  const s = (raw ?? '').trim();
  if (!s) throw new Error('Empty input');

  // Raw channel ID
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) {
    return { channel_id: s, resolved_via: 'direct' };
  }

  // Extract from URL
  const channelMatch = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (channelMatch) return { channel_id: channelMatch[1], resolved_via: 'direct' };

  // Handle or URL with handle
  const handleMatch = s.match(/(?:youtube\.com\/)?@([\w.-]+)/);
  const handle = handleMatch
    ? '@' + handleMatch[1]
    : s.startsWith('@') ? s : '@' + s;

  quotaGuard.recordUsage(1, 'ingest');
  const data = await ytGet('channels', { part: 'id,snippet', forHandle: handle });
  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found: ${handle}`);
  return {
    channel_id:   item.id,
    channel_name: item.snippet?.title ?? null,
    resolved_via: 'api',
  };
}

// Fetch full channel metadata + featured channels
async function fetchChannelMeta(channelId) {
  quotaGuard.recordUsage(1, 'ingest');
  const data = await ytGet('channels', {
    part: 'snippet,statistics,brandingSettings,contentDetails',
    id:   channelId,
  });
  const item = data.items?.[0];
  if (!item) return null;

  const featured = (item.brandingSettings?.channel?.featuredChannelsUrls ?? [])
    .filter(u => /^UC[A-Za-z0-9_-]{22}$/.test(u));

  return {
    channel_id:       item.id,
    title:            item.snippet?.title ?? null,
    handle:           item.snippet?.customUrl ?? null,
    thumbnail_url:    item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
    subscriber_count: parseInt(item.statistics?.subscriberCount ?? '0', 10) || null,
    video_count:      parseInt(item.statistics?.videoCount ?? '0', 10) || null,
    description:      item.snippet?.description ?? '',
    featured_channel_ids: featured,
    uploads_playlist_id:  item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

// Fetch multiple channels metadata in one call (up to 50 IDs)
async function fetchChannelsBatch(channelIds) {
  if (!channelIds.length) return [];
  const unique = [...new Set(channelIds)].slice(0, 50);
  quotaGuard.recordUsage(1, 'ingest');
  const data = await ytGet('channels', {
    part: 'snippet,statistics',
    id:   unique.join(','),
    maxResults: 50,
  });
  return (data.items ?? []).map(item => ({
    channel_id:       item.id,
    title:            item.snippet?.title ?? null,
    handle:           item.snippet?.customUrl ?? null,
    thumbnail_url:    item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
    subscriber_count: parseInt(item.statistics?.subscriberCount ?? '0', 10) || null,
    video_count:      parseInt(item.statistics?.videoCount ?? '0', 10) || null,
  }));
}

// Search for channels by topic keyword
async function searchChannelsByTopic(topic, maxResults = 15) {
  if (!quotaGuard.quotaAvailable()) return [];
  quotaGuard.recordUsage(100, 'ingest'); // search.list costs 100 units
  const data = await ytGet('search', {
    part:       'snippet',
    type:       'channel',
    q:          topic,
    maxResults: String(maxResults),
    relevanceLanguage: 'en',
  });
  return (data.items ?? []).map(item => ({
    channel_id:    item.snippet?.channelId ?? item.id?.channelId,
    title:         item.snippet?.channelTitle ?? null,
    thumbnail_url: item.snippet?.thumbnails?.medium?.url ?? null,
  })).filter(c => c.channel_id);
}

// Search for videos by topic, extract unique channel IDs
async function searchVideoChannelsByTopic(topic, maxResults = 25) {
  if (!quotaGuard.quotaAvailable()) return [];
  quotaGuard.recordUsage(100, 'ingest');
  const data = await ytGet('search', {
    part:       'snippet',
    type:       'video',
    q:          topic,
    maxResults: String(maxResults),
    relevanceLanguage: 'en',
  });
  const seen = new Set();
  return (data.items ?? [])
    .map(item => item.snippet?.channelId)
    .filter(id => id && !seen.has(id) && seen.add(id));
}

// Fetch recent video titles from a channel's uploads playlist
async function fetchChannelTitles(uploadsPlaylistId, maxResults = 25) {
  if (!uploadsPlaylistId) return [];
  quotaGuard.recordUsage(1, 'ingest');
  const data = await ytGet('playlistItems', {
    part:       'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults),
  });
  return (data.items ?? [])
    .map(item => item.snippet?.title)
    .filter(Boolean);
}

// Main discovery function — given a seed channel, return candidate channel objects
async function discoverFromSeed(rawInput, { topicsOverride = null } = {}) {
  if (!quotaGuard.quotaAvailable()) throw new Error('Quota exhausted');

  const seed     = await resolveSeedChannel(rawInput);
  const seedMeta = await fetchChannelMeta(seed.channel_id);
  if (!seedMeta) throw new Error('Could not fetch seed channel metadata');

  const candidateIds = new Set();
  const sourceMap    = {}; // channelId → discovery_source

  // Source 1: Featured channels (brandingSettings)
  for (const id of (seedMeta.featured_channel_ids ?? [])) {
    if (id !== seed.channel_id) {
      candidateIds.add(id);
      sourceMap[id] = 'featured_channels';
    }
  }

  // Source 2: Topic-based channel search (using caller-supplied topics or seed description keywords)
  const topics = topicsOverride?.slice(0, 3) ?? extractKeywords(seedMeta.description, 2);
  for (const topic of topics) {
    if (!quotaGuard.quotaAvailable()) break;
    const results = await searchChannelsByTopic(topic, 12);
    for (const r of results) {
      if (r.channel_id && r.channel_id !== seed.channel_id && !candidateIds.has(r.channel_id)) {
        candidateIds.add(r.channel_id);
        sourceMap[r.channel_id] = 'topic_search';
      }
    }
  }

  // Source 3: Video-based search → channel IDs (for broader discovery)
  if (topics.length && quotaGuard.quotaAvailable()) {
    const videoChannelIds = await searchVideoChannelsByTopic(topics[0], 20);
    for (const id of videoChannelIds) {
      if (id !== seed.channel_id && !candidateIds.has(id)) {
        candidateIds.add(id);
        sourceMap[id] = 'video_search';
      }
    }
  }

  // Fetch metadata for all candidates in batches of 50
  const allIds     = [...candidateIds];
  const candidates = [];
  for (let i = 0; i < allIds.length; i += 50) {
    const batch = allIds.slice(i, i + 50);
    const metas = await fetchChannelsBatch(batch);
    for (const meta of metas) {
      candidates.push({
        ...meta,
        discovery_source:           sourceMap[meta.channel_id] ?? 'unknown',
        discovered_from_channel_id: seed.channel_id,
      });
    }
  }

  return { seed: seedMeta, candidates, topics_used: topics };
}

// Lightweight keyword extraction from a channel description
function extractKeywords(description, max = 2) {
  if (!description) return [];
  const stopWords = new Set(['the','and','for','with','from','that','this','are','has','have','been','will','your','their','they','our','about']);
  const words = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !stopWords.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

module.exports = { discoverFromSeed, fetchChannelTitles, resolveSeedChannel };
