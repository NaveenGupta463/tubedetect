const API_KEY = import.meta.env.VITE_YT_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

async function apiFetch(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString());
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || `API Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

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
    const statsData = await apiFetch('channels', { part: 'statistics', id: ids });
    const statsMap = {};
    (statsData.items || []).forEach(c => { statsMap[c.id] = c.statistics; });

    return items.map(item => ({
      id: item.id.channelId,
      title: item.snippet.channelTitle,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails?.default?.url || '',
      statistics: statsMap[item.id.channelId] || {},
    }));
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
