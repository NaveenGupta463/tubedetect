const API_KEY = import.meta.env.VITE_YT_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

async function apiFetch(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `API Error ${res.status}`);
  return data;
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
