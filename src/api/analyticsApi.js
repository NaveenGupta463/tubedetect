// YouTube Analytics API v2
const ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';
const YT_BASE        = 'https://www.googleapis.com/youtube/v3';

// 1-hour cache
const CACHE_TTL = 60 * 60 * 1000;
const CACHE_PREFIX = 'tubeintel_analytics_';

function cacheKey(path) {
  return CACHE_PREFIX + btoa(path).replace(/[^a-z0-9]/gi, '').slice(0, 40);
}
function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

async function analyticsQuery(token, params) {
  const ck = cacheKey(JSON.stringify(params));
  const cached = readCache(ck);
  if (cached) return cached;

  const url = new URL(ANALYTICS_BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error('OAUTH_EXPIRED');
  if (res.status === 403) throw new Error('QUOTA_EXCEEDED');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Analytics API error ${res.status}`);
  }
  const data = await res.json();
  writeCache(ck, data);
  return data;
}

async function ytQuery(token, endpoint, params) {
  const ck = cacheKey(endpoint + JSON.stringify(params));
  const cached = readCache(ck);
  if (cached) return cached;

  const url = new URL(`${YT_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error('OAUTH_EXPIRED');
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `YouTube API error ${res.status}`);
  }
  const data = await res.json();
  writeCache(ck, data);
  return data;
}

function dateRange(days) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const fmt = d => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ── Overview metrics (28 days) ────────────────────────────────────────────────
export async function fetchOverviewMetrics(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  const data = await analyticsQuery(token, {
    ids:        `channel==${channelId}`,
    startDate,
    endDate,
    metrics:    'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares,estimatedRevenue',
  });
  const row = data.rows?.[0] || [];
  const cols = (data.columnHeaders || []).map(h => h.name);
  const get  = name => row[cols.indexOf(name)] ?? 0;
  return {
    views:            get('views'),
    watchTimeHours:   Math.round(get('estimatedMinutesWatched') / 60),
    avgViewDuration:  get('averageViewDuration'),
    avgViewPct:       +(get('averageViewPercentage')).toFixed(1),
    subsGained:       get('subscribersGained'),
    subsLost:         get('subscribersLost'),
    netSubs:          get('subscribersGained') - get('subscribersLost'),
    likes:            get('likes'),
    comments:         get('comments'),
    shares:           get('shares'),
    estimatedRevenue: get('estimatedRevenue'),
  };
}

// ── Impressions & CTR (separate query — no video/day dimension) ───────────────
export async function fetchImpressionsAndCTR(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  try {
    const data = await analyticsQuery(token, {
      ids:        `channel==${channelId}`,
      startDate,
      endDate,
      metrics:    'impressions,impressionClickThroughRate',
      dimensions: 'day',
      sort:       'day',
    });
    const cols = (data.columnHeaders || []).map(h => h.name);
    const rows = (data.rows || []).map(row => ({
      date:        row[cols.indexOf('day')],
      impressions: row[cols.indexOf('impressions')] || 0,
      ctr:         +(( row[cols.indexOf('impressionClickThroughRate')] || 0) * 100).toFixed(2),
    }));
    const totImpressions = rows.reduce((s, r) => s + r.impressions, 0);
    const avgCtr = rows.length
      ? +(rows.reduce((s, r) => s + r.ctr, 0) / rows.length).toFixed(2)
      : 0;
    return { rows, totImpressions, avgCtr };
  } catch {
    return { rows: [], totImpressions: 0, avgCtr: 0 };
  }
}

// ── Daily timeseries (views, watch time) ──────────────────────────────────────
export async function fetchDailyTimeseries(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  const data = await analyticsQuery(token, {
    ids:        `channel==${channelId}`,
    startDate,
    endDate,
    metrics:    'views,estimatedMinutesWatched',
    dimensions: 'day',
    sort:       'day',
  });
  const cols = (data.columnHeaders || []).map(h => h.name);
  return (data.rows || []).map(row => {
    const get = name => row[cols.indexOf(name)] ?? 0;
    return {
      date:         get('day'),
      views:        get('views'),
      watchMinutes: get('estimatedMinutesWatched'),
    };
  });
}

// ── Traffic sources ────────────────────────────────────────────────────────────
export async function fetchTrafficSources(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  const data = await analyticsQuery(token, {
    ids:        `channel==${channelId}`,
    startDate,
    endDate,
    metrics:    'views,estimatedMinutesWatched',
    dimensions: 'insightTrafficSourceType',
    sort:       '-views',
  });
  const cols = (data.columnHeaders || []).map(h => h.name);
  const totalViews = (data.rows || []).reduce((s, r) => s + (r[cols.indexOf('views')] || 0), 0) || 1;

  const SOURCE_LABELS = {
    'YT_SEARCH':         'YouTube Search',
    'SUBSCRIBER':        'Subscriptions',
    'BROWSE_FEATURES':   'Browse Features',
    'SUGGESTED_VIDEOS':  'Suggested Videos',
    'EXTERNAL':          'External Sources',
    'NO_LINK_OTHER':     'Direct / Unknown',
    'PLAYLIST':          'Playlists',
    'NOTIFICATION':      'Notifications',
    'YT_CHANNEL':        'Channel Pages',
    'END_SCREEN':        'End Screens',
    'CARDS':             'Cards',
    'SHORTS':            'Shorts Feed',
  };

  return (data.rows || []).map(row => {
    const source = row[cols.indexOf('insightTrafficSourceType')];
    const views  = row[cols.indexOf('views')] || 0;
    return {
      source,
      label:      SOURCE_LABELS[source] || source,
      views,
      pct:        +((views / totalViews) * 100).toFixed(1),
      watchMins:  row[cols.indexOf('estimatedMinutesWatched')] || 0,
    };
  });
}

// ── Audience demographics (age group & gender) ───────────────────────────────
export async function fetchAudienceType(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  try {
    const data = await analyticsQuery(token, {
      ids:        `channel==${channelId}`,
      startDate,
      endDate,
      metrics:    'viewerPercentage',
      dimensions: 'ageGroup,gender',
      sort:       '-viewerPercentage',
    });
    const cols = (data.columnHeaders || []).map(h => h.name);
    const rows = data.rows || [];

    // Group by ageGroup
    const ageMap = {};
    const genderMap = { male: 0, female: 0 };
    rows.forEach(row => {
      const age    = row[cols.indexOf('ageGroup')];
      const gender = row[cols.indexOf('gender')]?.toLowerCase();
      const pct    = row[cols.indexOf('viewerPercentage')] || 0;
      if (age) ageMap[age] = (ageMap[age] || 0) + pct;
      if (gender === 'male' || gender === 'female') genderMap[gender] += pct;
    });

    const AGE_LABELS = {
      'age13-17': '13–17', 'age18-24': '18–24', 'age25-34': '25–34',
      'age35-44': '35–44', 'age45-54': '45–54', 'age55-64': '55–64', 'age65-': '65+',
    };

    const ageBreakdown = Object.entries(ageMap).map(([key, pct]) => ({
      age: AGE_LABELS[key] || key,
      pct: +pct.toFixed(1),
    })).sort((a, b) => b.pct - a.pct);

    const totalGender = genderMap.male + genderMap.female || 1;
    return {
      ageBreakdown,
      malePct:   +((genderMap.male   / totalGender) * 100).toFixed(1),
      femalePct: +((genderMap.female / totalGender) * 100).toFixed(1),
    };
  } catch {
    return { ageBreakdown: [], malePct: 0, femalePct: 0 };
  }
}

// ── Per-video performance table ───────────────────────────────────────────────
export async function fetchVideoPerformance(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  const data = await analyticsQuery(token, {
    ids:        `channel==${channelId}`,
    startDate,
    endDate,
    metrics:    'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments',
    dimensions: 'video',
    sort:       '-views',
    maxResults: 25,
  });
  const cols = (data.columnHeaders || []).map(h => h.name);
  const videoIds = (data.rows || []).map(r => r[cols.indexOf('video')]).filter(Boolean);
  if (!videoIds.length) return [];

  // Fetch video metadata (title + thumbnail)
  let metaMap = {};
  try {
    const ytData = await ytQuery(token, 'videos', {
      part: 'snippet,statistics',
      id:   videoIds.join(','),
    });
    (ytData.items || []).forEach(v => {
      metaMap[v.id] = {
        title:     v.snippet?.title,
        thumbnail: v.snippet?.thumbnails?.default?.url,
        publishedAt: v.snippet?.publishedAt,
      };
    });
  } catch {}

  return (data.rows || []).map(row => {
    const get = name => row[cols.indexOf(name)] ?? 0;
    const id  = get('video');
    const meta = metaMap[id] || {};
    return {
      id,
      title:           meta.title || id,
      thumbnail:       meta.thumbnail,
      publishedAt:     meta.publishedAt,
      views:           get('views'),
      watchMinutes:    get('estimatedMinutesWatched'),
      avgViewDuration: get('averageViewDuration'),
      avgViewPct:      +(get('averageViewPercentage')).toFixed(1),
      subsGained:      get('subscribersGained'),
      subsLost:        get('subscribersLost'),
      likes:           get('likes'),
      comments:        get('comments'),
    };
  });
}

// ── Subscriber timeseries ─────────────────────────────────────────────────────
export async function fetchSubscriberTimeseries(token, channelId, days = 90) {
  const { startDate, endDate } = dateRange(days);
  const data = await analyticsQuery(token, {
    ids:        `channel==${channelId}`,
    startDate,
    endDate,
    metrics:    'subscribersGained,subscribersLost',
    dimensions: 'day',
    sort:       'day',
  });
  const cols = (data.columnHeaders || []).map(h => h.name);
  let running = 0;
  return (data.rows || []).map(row => {
    const gained = row[cols.indexOf('subscribersGained')] || 0;
    const lost   = row[cols.indexOf('subscribersLost')]   || 0;
    running += gained - lost;
    return {
      date:   row[cols.indexOf('day')],
      gained,
      lost,
      net:    gained - lost,
      cumulative: running,
    };
  });
}

// ── Monetization / Revenue ────────────────────────────────────────────────────
export async function fetchMonetization(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  try {
    const data = await analyticsQuery(token, {
      ids:        `channel==${channelId}`,
      startDate,
      endDate,
      metrics:    'estimatedRevenue,estimatedAdRevenue,grossRevenue,cpm,adImpressions',
      currency:   'USD',
    });
    const row  = data.rows?.[0] || [];
    const cols = (data.columnHeaders || []).map(h => h.name);
    const get  = name => row[cols.indexOf(name)] ?? null;
    return {
      estimatedRevenue:   get('estimatedRevenue'),
      estimatedAdRevenue: get('estimatedAdRevenue'),
      grossRevenue:       get('grossRevenue'),
      cpm:                get('cpm'),
      adImpressions:      get('adImpressions'),
      isMonetized:        get('estimatedRevenue') !== null,
    };
  } catch {
    return { isMonetized: false };
  }
}

// ── Posting day/time heatmap ──────────────────────────────────────────────────
export async function fetchPostingHeatmap(token, channelId) {
  // Fetch last 50 videos published by this channel + their views
  try {
    const data = await ytQuery(token, 'search', {
      part:       'snippet',
      forMine:    'true',
      type:       'video',
      order:      'date',
      maxResults: 50,
    });
    const items = data.items || [];
    if (!items.length) return null;

    const ids = items.map(i => i.id.videoId).filter(Boolean).join(',');
    const stats = await ytQuery(token, 'videos', { part: 'statistics', id: ids });
    const statsMap = {};
    (stats.items || []).forEach(v => { statsMap[v.id] = parseInt(v.statistics?.viewCount || 0); });

    const grid = {}; // key: "dow_hour" -> { totalViews, count }
    items.forEach(item => {
      const id  = item.id?.videoId;
      if (!id) return;
      const pub = new Date(item.snippet?.publishedAt);
      const dow = pub.getDay();   // 0=Sun
      const hr  = pub.getHours();
      const key = `${dow}_${hr}`;
      if (!grid[key]) grid[key] = { totalViews: 0, count: 0 };
      grid[key].totalViews += statsMap[id] || 0;
      grid[key].count += 1;
    });

    // Find peak slot
    let peak = null, peakAvg = 0;
    Object.entries(grid).forEach(([key, val]) => {
      const avg = val.count > 0 ? val.totalViews / val.count : 0;
      if (avg > peakAvg) { peakAvg = avg; peak = key; }
    });

    return { grid, peak };
  } catch {
    return null;
  }
}

// ── Revenue daily timeseries ──────────────────────────────────────────────────
export async function fetchRevenueSeries(token, channelId, days = 28) {
  const { startDate, endDate } = dateRange(days);
  try {
    const data = await analyticsQuery(token, {
      ids:        `channel==${channelId}`,
      startDate,
      endDate,
      metrics:    'estimatedRevenue,cpm',
      dimensions: 'day',
      sort:       'day',
      currency:   'USD',
    });
    const cols = (data.columnHeaders || []).map(h => h.name);
    return (data.rows || []).map(row => ({
      date:     row[cols.indexOf('day')],
      revenue:  +(row[cols.indexOf('estimatedRevenue')] || 0).toFixed(2),
      cpm:      +(row[cols.indexOf('cpm')] || 0).toFixed(2),
    }));
  } catch {
    return [];
  }
}

// ── Per-video OAuth metrics (impressions, CTR, avgViewDuration) ───────────────
// Only works for videos belonging to the authenticated user's channel.
// Date range: lifetime if video age < 30 days, else last 30 days.
export async function fetchPerVideoOAuthMetrics(token, videoId, publishedAt) {
  const videoAgeMs  = publishedAt ? Date.now() - new Date(publishedAt).getTime() : Infinity;
  const useLifetime = videoAgeMs < 30 * 24 * 3600 * 1000;

  let startDate, endDate;
  const fmt = d => d.toISOString().slice(0, 10);
  if (useLifetime) {
    startDate = fmt(new Date(publishedAt));
    endDate   = fmt(new Date());
  } else {
    const { startDate: s, endDate: e } = dateRange(30);
    startDate = s;
    endDate   = e;
  }

  try {
    const data = await analyticsQuery(token, {
      ids:        'channel==MINE',
      startDate,
      endDate,
      metrics:    'impressions,impressionClickThroughRate,averageViewDuration',
      dimensions: 'video',
      filters:    `video==${videoId}`,
    });
    const cols = (data.columnHeaders || []).map(h => h.name);
    const row  = (data.rows || []).find(r => r[cols.indexOf('video')] === videoId);
    if (!row) return null;
    const get = name => row[cols.indexOf(name)] ?? null;
    return {
      impressions:      get('impressions'),
      ctr:              +(( get('impressionClickThroughRate') || 0) * 100).toFixed(2),
      avgViewDuration:  get('averageViewDuration'),
    };
  } catch {
    return null;
  }
}

// ── Channel impressions baseline for velocity normalization ───────────────────
// Returns avgImpressionsPerHour and channelAvgCtr based on last 30 days.
export async function fetchChannelImpressionsBaseline(token, channelId) {
  try {
    const { rows, totImpressions, avgCtr } = await fetchImpressionsAndCTR(token, channelId, 30);
    if (!rows.length) return { avgImpressionsPerHour: 0, channelAvgCtr: avgCtr };
    return {
      avgImpressionsPerHour: totImpressions / (30 * 24),
      channelAvgCtr:         avgCtr,
    };
  } catch {
    return { avgImpressionsPerHour: 0, channelAvgCtr: 0 };
  }
}

export function clearAnalyticsCache() {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(CACHE_PREFIX))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}
