'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const {
  getChannelCache,
  getChannelCacheByHandle,
  upsertChannelCache,
  getVideoCache,
  getVideoCacheById,
  getVideoCacheIds,
  upsertVideoCache,
  updateVideoCacheStats,
} = require('../db/queries');
const {
  readChannelRuntimeSummary,
  buildAndSaveChannelRuntimeSummary,
  summaryToSyntheticChannel,
} = require('../services/channelRuntimeSummary');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const YT_SEARCH_TIMEOUT_MS = 7000;
const LIVE_SEARCH_ROUTE_TIMEOUT_MS = 4500;

async function fetchJsonWithTimeout(url, timeoutMs = YT_SEARCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

// Quota-aware YouTube GET — rotates through all configured API keys
async function ytGet(path, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey('lookup');
    if (!key) return null;
    const url = new URL(`${YT_BASE}/${path}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res  = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `YouTube ${res.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      return null;
    }
    return data;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function secondsToISO(secs) {
  if (!secs) return 'PT0S';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  let d = 'PT';
  if (h) d += `${h}H`;
  if (m) d += `${m}M`;
  if (s || (!h && !m)) d += `${s}S`;
  return d;
}

function buildSyntheticChannel(ic) {
  return {
    id: ic.channel_id,
    snippet: {
      title:        ic.channel_name || ic.channel_id,
      description:  '',
      customUrl:    '',
      publishedAt:  '',
      thumbnails: {
        default: { url: '' },
        medium:  { url: '' },
        high:    { url: '' },
      },
    },
    statistics: {
      subscriberCount:     String(ic.channel_subscribers || 0),
      videoCount:          '0',
      viewCount:           '0',
      hiddenSubscriberCount: false,
    },
    contentDetails: {
      relatedPlaylists: {
        uploads: ic.uploads_playlist_id || '',
      },
    },
    brandingSettings: { channel: {}, image: {} },
  };
}

function buildSyntheticVideo(iv) {
  const vid = iv.youtube_video_id;
  return {
    id: vid,
    snippet: {
      title:       iv.title,
      description: iv.description || '',
      publishedAt: iv.published_at || '',
      channelId:   iv.channel_id,
      channelTitle: '',
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${vid}/default.jpg` },
        medium:  { url: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` },
        high:    { url: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` },
        maxres:  { url: `https://i.ytimg.com/vi/${vid}/maxresdefault.jpg` },
      },
      categoryId: iv.category_id || '',
      tags: [],
    },
    statistics: {
      viewCount:    String(iv.views    || 0),
      likeCount:    String(iv.likes    || 0),
      commentCount: String(iv.comments || 0),
      favoriteCount: '0',
    },
    contentDetails: {
      duration:   secondsToISO(iv.duration_seconds),
      definition: 'hd',
    },
  };
}

// Fetch real channel data from YouTube and store in channel_cache (1 quota unit).
async function refreshChannelFromYT(db, channelId) {
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return;
  try {
    const url  = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    const item = data.items?.[0];
    if (!item) return;
    upsertChannelCache(db, item);
    console.log(`[channel-cache] real data refreshed for ${channelId}`);
  } catch (e) {
    console.warn('[channel-cache] refreshChannelFromYT error:', e.message);
  }
}

// One call per 50 channels — populate channel_cache for all ingested channels
// not yet cached. Triggered lazily on first handle miss.
let populateRunning = false;
async function populateUncachedChannels(db) {
  if (populateRunning) return;
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return;
  populateRunning = true;
  try {
    const uncached = db.all(`
      SELECT ic.channel_id FROM ingested_channels ic
      WHERE ic.ingest_enabled = 1
        AND NOT EXISTS (SELECT 1 FROM channel_cache cc WHERE cc.channel_id = ic.channel_id)
      LIMIT 50
    `);
    if (!uncached.length) return;
    const ids  = uncached.map(r => r.channel_id).join(',');
    const url  = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,brandingSettings,contentDetails&id=${encodeURIComponent(ids)}&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    for (const item of (data.items || [])) upsertChannelCache(db, item);
    console.log(`[channel-cache] bulk-populated ${(data.items || []).length} ingested channels`);
  } catch (e) {
    console.warn('[channel-cache] populateUncachedChannels error:', e.message);
  } finally {
    populateRunning = false;
  }
}

// ── Keyword niche detection (for YouTube live results) ───────────────────────

const NICHE_KEYWORDS = {
  politics:      ['politics', 'political', 'government', 'election', 'minister', 'parliament', 'democracy', 'foreign policy', 'geopolitics', 'rajya', 'lok sabha', 'bjp', 'congress', 'modi', 'rahul'],
  education:     ['education', 'learn', 'tutorial', 'study', 'teaching', 'school', 'upsc', 'ias', 'exam', 'lecture', 'course', 'knowledge'],
  technology:    ['tech', 'software', 'coding', 'programming', 'gadget', 'smartphone', 'ai', 'machine learning', 'developer'],
  finance:       ['finance', 'investing', 'stock market', 'mutual fund', 'money', 'wealth', 'trading', 'budget', 'economy'],
  entertainment: ['entertainment', 'comedy', 'fun', 'viral', 'trending', 'memes', 'reaction'],
  gaming:        ['gaming', 'game', 'esports', 'playthrough', 'minecraft', 'pubg', 'free fire'],
  lifestyle:     ['lifestyle', 'vlog', 'daily life', 'travel', 'food', 'vlogs', 'family'],
  health:        ['health', 'fitness', 'workout', 'yoga', 'ayurveda', 'diet', 'wellness', 'doctor'],
  news:          ['news', 'breaking', 'current affairs', 'samachar', 'daily news', 'latest'],
  business:      ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'growth hacking'],
};

function guessNiche(title, description) {
  const text = `${title} ${description}`.toLowerCase();
  let best = null, bestCount = 0;
  for (const [niche, kws] of Object.entries(NICHE_KEYWORDS)) {
    const count = kws.filter(kw => text.includes(kw)).length;
    if (count > bestCount) { bestCount = count; best = niche; }
  }
  return best;
}

// ── In-memory search cache (5-minute TTL) ────────────────────────────────────
const searchCache = new Map(); // key → { results, expiresAt }
const SEARCH_CACHE_TTL = 5 * 60 * 1000;

function getFrontendSearchKey() {
  return process.env.YT_API_KEY_7 || process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
}

function youtubeChannelItemToResult(item, fallbackThumbnail = null) {
  return {
    channel_id:   item.id,
    name:         item.snippet?.title || item.id,
    subs:         parseInt(item.statistics?.subscriberCount || '0', 10),
    niche:        guessNiche(item.snippet?.title || '', item.snippet?.description || ''),
    community_id: null,
    source:       'youtube',
    language:     item.snippet?.defaultLanguage || null,
    thumbnail:    item.snippet?.thumbnails?.medium?.url ||
                  item.snippet?.thumbnails?.default?.url ||
                  fallbackThumbnail || null,
  };
}

async function liveYoutubeChannelSearch(q, limit = 5) {
  const searchKey = getFrontendSearchKey();
  if (!searchKey || !q) return { results: [], live_unavailable: true, reason: 'youtube_search_key_missing' };

  async function searchYtGet(path, params) {
    const url = new URL(`${YT_BASE}/${path}`);
    url.searchParams.set('key', searchKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const { res, data } = await fetchJsonWithTimeout(url.toString(), LIVE_SEARCH_ROUTE_TIMEOUT_MS);
    return res.ok ? data : null;
  }

  const handle = q.match(/^@([A-Za-z0-9._-]{3,})$/)?.[1] || null;
  if (handle) {
    const handleData = await searchYtGet('channels', {
      part: 'snippet,statistics',
      forHandle: `@${handle}`,
    });
    const item = handleData?.items?.[0];
    return item ? { items: [item], results: [youtubeChannelItemToResult(item)] } : { results: [] };
  }

  const searchData = await searchYtGet('search', {
    part: 'snippet', type: 'channel', q, maxResults: limit,
  });
  if (!searchData) return { results: [], live_unavailable: true, reason: 'youtube_search_failed' };

  const searchThumbMap = {};
  const ids = [];
  for (const item of (searchData.items || [])) {
    const id = item.id?.channelId || item.snippet?.channelId;
    if (!id) continue;
    ids.push(id);
    searchThumbMap[id] =
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url || null;
  }
  if (!ids.length) return { results: [] };

  const detailData = await searchYtGet('channels', {
    part: 'snippet,statistics', id: ids.join(','),
  });
  if (!detailData) return { results: [], live_unavailable: true, reason: 'youtube_channel_detail_failed' };

  const items = detailData.items || [];
  return {
    items,
    results: items.map(item => youtubeChannelItemToResult(item, searchThumbMap[item.id])),
  };
}

// ── GET /api/channel-cache/search?q=&limit=10 ─────────────────────────────────
router.get('/channel-cache/search', async (req, res) => {
  const t0    = Date.now();
  const debug = process.env.DEBUG_SEARCH === '1';
  try {
    const db    = getDb();
    const q     = (req.query.q || '').trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit ?? '10', 10)));

    if (!q) return res.json({ results: [] });

    // In-memory cache hit
    const cacheKey = `${q.toLowerCase()}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (debug) console.log(`[search] cache_hit q="${q}" ms=${Date.now() - t0}`);
      if ((cached.results || []).length > 0) return res.json({ results: cached.results });
      searchCache.delete(cacheKey);
    }

    const qLower = q.toLowerCase();
    let allRows  = [];

    // ── Ranked query against channel_search_index ────────────────────────────
    const t1 = Date.now();
    try {
      const indexRows = db.all(
        `SELECT channel_id, name, source, subs, niche, community_id, language, thumbnail,
                CASE
                  WHEN lower(name) = ?           THEN 0
                  WHEN lower(name) LIKE ? || '%' THEN 1
                  ELSE                                2
                END AS match_rank
         FROM channel_search_index
         WHERE lower(name) LIKE '%' || ? || '%'
            OR channel_id  LIKE '%' || ? || '%'
         ORDER BY match_rank ASC, subs DESC
         LIMIT ?`,
        [qLower, qLower, qLower, qLower, limit],
      );
      if (indexRows.length > 0) {
        allRows = indexRows;
        if (debug) console.log(`[search] index_ms=${Date.now() - t1} rows=${allRows.length}`);
      }
    } catch { /* index not yet populated — fall through */ }

    // ── Fallback to direct table queries if index returned nothing ────────────
    if (!allRows.length) {
      const like = `%${q}%`;
      const t2   = Date.now();

      const ingested = db.all(
        `SELECT ic.channel_id, ic.channel_name AS name, 'ingested' AS source,
                ic.channel_subscribers AS subs, ic.niche, ic.community_id,
                COALESCE(ic.primary_language, cc.yt_default_language) AS language,
                cc.thumbnail_url AS thumbnail
         FROM ingested_channels ic
         LEFT JOIN corpus_channels cc ON cc.channel_id = ic.channel_id
         WHERE ic.ingest_enabled = 1
           AND (lower(ic.channel_name) LIKE lower(?) OR ic.channel_id LIKE ?)
         ORDER BY ic.channel_subscribers DESC
         LIMIT ?`,
        [like, like, limit],
      );

      const ingestedIds = new Set(ingested.map(r => r.channel_id));
      const remaining   = limit - ingested.length;
      let corpus = [];
      if (remaining > 0) {
        const rows = db.all(
          `SELECT channel_id, title AS name, 'corpus' AS source,
                  subscriber_count AS subs, niche, community_id, language,
                  thumbnail_url AS thumbnail
           FROM corpus_channels
           WHERE (lower(title) LIKE lower(?) OR channel_id LIKE ?)
           ORDER BY subscriber_count DESC
           LIMIT ?`,
          [like, like, limit],
        );
        corpus = rows.filter(r => !ingestedIds.has(r.channel_id)).slice(0, remaining);
      }
      const knownIds = new Set([...ingested, ...corpus].map(r => r.channel_id));
      const cacheRemaining = limit - ingested.length - corpus.length;
      let cachedChannels = [];
      if (cacheRemaining > 0) {
        try {
          const cacheRows = db.all(
            `SELECT channel_id, title AS name, 'youtube' AS source,
                    subscriber_count AS subs, NULL AS niche, NULL AS community_id,
                    NULL AS language, raw_json
             FROM channel_cache
             WHERE lower(title) LIKE lower(?)
                OR lower(replace(coalesce(handle,''),'@','')) LIKE lower(?)
                OR channel_id LIKE ?
             ORDER BY subscriber_count DESC
             LIMIT ?`,
            [like, like.replace(/[%\s]/g, ''), like, limit],
          );
          cachedChannels = cacheRows
            .filter(r => !knownIds.has(r.channel_id))
            .slice(0, cacheRemaining)
            .map(r => {
              let thumbnail = null;
              let language = r.language;
              try {
                const parsed = JSON.parse(r.raw_json || '{}');
                thumbnail = parsed?.snippet?.thumbnails?.medium?.url ||
                            parsed?.snippet?.thumbnails?.default?.url || null;
                language = parsed?.snippet?.defaultLanguage || language;
              } catch (_) {}
              return { ...r, thumbnail, language };
            });
        } catch (_) {}
      }
      allRows = [...ingested, ...corpus, ...cachedChannels];
      if (debug) console.log(`[search] fallback_ms=${Date.now() - t2} rows=${allRows.length}`);
    }

    // ── Fetch thumbnails only for rows that still need them ───────────────────
    const t3         = Date.now();
    const missingIds = allRows.filter(r => !r.thumbnail).map(r => r.channel_id);
    const thumbMap   = {};
    if (missingIds.length > 0) {
      try {
        const ph       = missingIds.map(() => '?').join(',');
        const cacheRows = db.all(
          `SELECT channel_id, raw_json FROM channel_cache WHERE channel_id IN (${ph}) AND raw_json IS NOT NULL`,
          missingIds,
        );
        for (const { channel_id, raw_json } of cacheRows) {
          try {
            const parsed = JSON.parse(raw_json);
            const url = parsed?.snippet?.thumbnails?.medium?.url
                     || parsed?.snippet?.thumbnails?.default?.url || null;
            if (url) thumbMap[channel_id] = url;
          } catch (_) {}
        }
      } catch (_) {}
    }
    if (debug) console.log(`[search] thumb_ms=${Date.now() - t3}`);

    let results = allRows.map(r => ({
      channel_id:   r.channel_id,
      name:         r.name || r.channel_id,
      subs:         r.subs || 0,
      niche:        r.niche || null,
      community_id: r.community_id || null,
      source:       r.source || 'corpus',
      language:     r.language || 'en',
      thumbnail:    r.thumbnail || thumbMap[r.channel_id] || null,
    }));

    if (results.length === 0 && q.length >= 3) {
      try {
        const live = await liveYoutubeChannelSearch(q, limit);
        if (live.results?.length) {
          for (const item of (live.items || [])) upsertChannelCache(db, item);
          results = live.results;
        }
      } catch (_) {}
    }

    // Cache result; evict expired entries every 200 inserts
    if (results.length > 0) searchCache.set(cacheKey, { results, expiresAt: Date.now() + SEARCH_CACHE_TTL });
    if (searchCache.size % 200 === 0) {
      const now = Date.now();
      for (const [k, v] of searchCache) if (v.expiresAt < now) searchCache.delete(k);
    }

    if (debug) console.log(`[search] total_ms=${Date.now() - t0} q="${q}" rows=${results.length}`);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/channel-cache/browse?niches=finance,technology&limit=20 ──────────
router.get('/channel-cache/browse', (req, res) => {
  try {
    const db     = getDb();
    const niches = (req.query.niches || '').split(',').map(n => n.trim().toLowerCase()).filter(Boolean);
    const limit  = Math.min(30, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    if (!niches.length) return res.json({ results: [] });

    const ph = niches.map(() => '?').join(',');

    const ingested = db.all(
      `SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers AS subs,
              ic.niche, ic.community_id, 'ingested' AS source,
              COALESCE(ic.primary_language, cc.yt_default_language) AS language,
              cc.thumbnail_url AS thumbnail
       FROM ingested_channels ic
       LEFT JOIN corpus_channels cc ON cc.channel_id = ic.channel_id
       WHERE ic.ingest_enabled = 1
         AND (
           lower(COALESCE(ic.niche,'')) IN (${ph})
           OR EXISTS (
             SELECT 1 FROM channel_topics ct
             WHERE ct.channel_id = ic.channel_id AND ct.niche IN (${ph})
           )
         )
       ORDER BY ic.channel_subscribers DESC LIMIT ?`,
      [...niches, ...niches, limit],
    );

    const ingestedIds = new Set(ingested.map(r => r.channel_id));
    const remaining   = limit - ingested.length;
    let corpus = [];
    if (remaining > 0) {
      const rows = db.all(
        `SELECT cc.channel_id, cc.title AS channel_name, cc.subscriber_count AS subs,
                cc.niche, cc.community_id, 'corpus' AS source, cc.language, cc.thumbnail_url AS thumbnail
         FROM corpus_channels cc
         WHERE (
           lower(COALESCE(cc.niche,'')) IN (${ph})
           OR EXISTS (
             SELECT 1 FROM channel_topics ct
             WHERE ct.channel_id = cc.channel_id AND ct.niche IN (${ph})
           )
         )
         ORDER BY cc.subscriber_count DESC LIMIT ?`,
        [...niches, ...niches, limit],
      );
      corpus = rows.filter(r => !ingestedIds.has(r.channel_id)).slice(0, remaining);
    }

    const results = [...ingested, ...corpus].map(r => ({
      channel_id:   r.channel_id,
      name:         r.channel_name || r.channel_id,
      subs:         r.subs || 0,
      niche:        r.niche || null,
      community_id: r.community_id || null,
      source:       r.source,
      language:     r.language || 'en',
      thumbnail:    r.thumbnail || null,
    }));

    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/channel-cache/search-youtube?q=&limit=5 ─────────────────────────
// Live YouTube search — called by the frontend only when DB search has < 3 hits.
// Returns same shape as /channel-cache/search so results can be merged directly.

router.get('/channel-cache/search-youtube', async (req, res) => {
  // Uses YT_API_KEY_7 exclusively — reserved for frontend search, never touched by backend jobs.
  const searchKey = process.env.YT_API_KEY_7 || process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!searchKey) return res.json({ results: [], live_unavailable: true, reason: 'youtube_search_key_missing' });

  const q     = (req.query.q || '').trim();
  const limit = Math.min(8, Math.max(1, parseInt(req.query.limit ?? '5', 10)));
  if (!q) return res.json({ results: [] });

  async function searchYtGet(path, params) {
    const url = new URL(`${YT_BASE}/${path}`);
    url.searchParams.set('key', searchKey);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const { res, data } = await fetchJsonWithTimeout(url.toString());
    return res.ok ? data : null;
  }

  try {
    // Step 1: search.list — channel IDs + search-snippet thumbnails
    const handle = q.match(/^@([A-Za-z0-9._-]{3,})$/)?.[1] || null;
    if (handle) {
      const handleData = await searchYtGet('channels', {
        part: 'snippet,statistics',
        forHandle: `@${handle}`,
      });
      const item = handleData?.items?.[0];
      if (item) {
        try {
          const db = getDb();
          upsertChannelCache(db, item);
        } catch (_) {}
        return res.json({
          results: [{
            channel_id:   item.id,
            name:         item.snippet?.title || item.id,
            subs:         parseInt(item.statistics?.subscriberCount || '0', 10),
            niche:        guessNiche(item.snippet?.title || '', item.snippet?.description || ''),
            community_id: null,
            source:       'youtube',
            language:     item.snippet?.defaultLanguage || null,
            thumbnail:    item.snippet?.thumbnails?.medium?.url ||
                          item.snippet?.thumbnails?.default?.url || null,
          }],
        });
      }
    }

    const searchData = await searchYtGet('search', {
      part: 'snippet', type: 'channel', q, maxResults: limit,
    });
    if (!searchData) return res.json({ results: [], live_unavailable: true, reason: 'youtube_search_failed' });

    const searchThumbMap = {};
    const ids = [];
    for (const item of (searchData.items || [])) {
      const id = item.id?.channelId || item.snippet?.channelId;
      if (!id) continue;
      ids.push(id);
      searchThumbMap[id] =
        item.snippet?.thumbnails?.medium?.url ||
        item.snippet?.thumbnails?.default?.url || null;
    }
    if (!ids.length) return res.json({ results: [] });

    // Step 2: channels.list — subscriber counts + authoritative thumbnail
    const detailData = await searchYtGet('channels', {
      part: 'snippet,statistics', id: ids.join(','),
    });
    if (!detailData) return res.json({ results: [], live_unavailable: true, reason: 'youtube_channel_detail_failed' });

    const results = (detailData.items || []).map(item => ({
      channel_id:   item.id,
      name:         item.snippet?.title || item.id,
      subs:         parseInt(item.statistics?.subscriberCount || '0', 10),
      niche:        guessNiche(item.snippet?.title || '', item.snippet?.description || ''),
      community_id: null,
      source:       'youtube',
      language:     item.snippet?.defaultLanguage || null,
      thumbnail:    item.snippet?.thumbnails?.medium?.url ||
                    item.snippet?.thumbnails?.default?.url ||
                    searchThumbMap[item.id] || null,
    }));
    try {
      const db = getDb();
      for (const item of (detailData.items || [])) upsertChannelCache(db, item);
    } catch (_) {}

    res.json({ results });
  } catch (e) {
    res.json({ results: [], live_unavailable: true, reason: e.name === 'AbortError' ? 'youtube_search_timeout' : 'youtube_search_error' });
  }
});

// ── GET channel by id or handle ───────────────────────────────────────────────
// Query params: ?id=UCxxx  OR  ?handle=mkbhd
// Falls back to ingested_channels if channel_cache misses.

router.get('/channel-cache/channel', async (req, res) => {
  try {
    const db = getDb();
    const { id, handle } = req.query;

    // 1. Check channel_cache (real YouTube data)
    let channel = null;
    if (id)             channel = getChannelCache(db, id);
    if (!channel && handle) channel = getChannelCacheByHandle(db, handle);
    if (channel) return res.json({ hit: true, channel, cache_source: 'channel_cache' });

    // 2. Fallback: check ingested_channels by channel_id
    if (id) {
      const summary = readChannelRuntimeSummary(db, id);
      if (summary) {
        return res.json({
          hit: true,
          channel: summaryToSyntheticChannel(summary),
          summary,
          cache_source: 'channel_runtime_summary',
        });
      }
      const ic = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [id]);
      if (ic) {
        const synthetic = buildSyntheticChannel(ic);
        // Background: fetch real data (thumbnail, handle, accurate stats) and cache it
        refreshChannelFromYT(db, ic.channel_id).catch(() => {});
        console.log(`[channel-cache] ingested_channels hit for ${id} (synthetic)`);
        return res.json({ hit: true, channel: synthetic, cache_source: 'ingested_channels' });
      }
    }

    // 3. Handle miss — try fuzzy name match against ingested_channels
    //    Normalise both sides: remove non-alphanum, lowercase
    //    e.g. handle "GrahamStephan" matches channel_name "Graham Stephan"
    //    IMPORTANT: skip channels whose name normalises to "" (non-ASCII/Korean etc.)
    //    to avoid matching every handle via startsWith("").
    if (handle) {
      const norm = handle.toLowerCase().replace(/[^a-z0-9]/g, '');
      const all  = db.all('SELECT * FROM ingested_channels WHERE ingest_enabled = 1');
      const match = norm ? all.find(ic => {
        const n = (ic.channel_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return n && n === norm;
      }) : null;
      if (match) {
        const synthetic = buildSyntheticChannel(match);
        refreshChannelFromYT(db, match.channel_id).catch(() => {});
        console.log(`[channel-cache] name-fuzzy hit handle="${handle}" → ${match.channel_id}`);
        return res.json({ hit: true, channel: synthetic, cache_source: 'ingested_channels_fuzzy' });
      }
      // Still nothing — background-populate so next search works after quota resets
      populateUncachedChannels(db).catch(() => {});
    }

    res.status(404).json({ hit: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/channel-cache/summary/:channelId', (req, res) => {
  try {
    const db = getDb();
    const channelId = req.params.channelId;
    let summary = readChannelRuntimeSummary(db, channelId);
    let cacheSource = 'channel_runtime_summary';
    if (!summary && req.query.compute === '1') {
      summary = buildAndSaveChannelRuntimeSummary(db, channelId);
      cacheSource = 'computed';
    }
    if (!summary) return res.status(404).json({ ok: false, hit: false, channel_id: channelId });
    res.json({ ok: true, hit: true, channel_id: channelId, summary, cache_source: cacheSource });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── POST store channel ────────────────────────────────────────────────────────

router.post('/channel-cache/channel', (req, res) => {
  try {
    const db = getDb();
    const { channel } = req.body ?? {};
    if (!channel?.id) return res.status(400).json({ error: 'channel.id required' });
    upsertChannelCache(db, channel);
    res.json({ ok: true, channel_id: channel.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET videos for channel ────────────────────────────────────────────────────
// Falls back to ingested_videos if video_cache misses.

router.get('/channel-cache/channel/:channelId/videos', (req, res) => {
  try {
    const db        = getDb();
    const channelId = req.params.channelId;

    // 1. Check video_cache (real YouTube data)
    const videos = getVideoCache(db, channelId);
    if (videos.length) {
      return res.json({ hit: true, videos, count: videos.length, cache_source: 'video_cache' });
    }

    // 2. Fallback: check ingested_videos
    const ingested = db.all(
      'SELECT * FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 200',
      [channelId],
    );
    if (ingested.length) {
      const syntheticVideos = ingested.map(buildSyntheticVideo);
      console.log(`[channel-cache] ingested_videos hit for channel ${channelId} — ${ingested.length} videos (synthetic)`);
      return res.json({ hit: true, videos: syntheticVideos, count: syntheticVideos.length, cache_source: 'ingested_videos' });
    }

    // Channel IS ingested but has no videos yet — return empty hit so the
    // frontend doesn't fall through to YouTube and exhaust quota.
    const knownChannel = db.get(
      `SELECT channel_id FROM ingested_channels WHERE channel_id = ?
       UNION SELECT channel_id FROM channel_cache WHERE channel_id = ? LIMIT 1`,
      [channelId, channelId],
    );
    if (knownChannel) {
      console.log(`[channel-cache] known channel ${channelId} but no videos — returning empty`);
      return res.json({ hit: true, videos: [], count: 0, cache_source: 'no_videos' });
    }

    res.status(404).json({ hit: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST store videos ─────────────────────────────────────────────────────────

router.post('/channel-cache/videos', (req, res) => {
  try {
    const db = getDb();
    const { videos } = req.body ?? {};
    if (!Array.isArray(videos)) return res.status(400).json({ error: 'videos[] required' });
    for (const v of videos) upsertVideoCache(db, v);
    res.json({ ok: true, stored: videos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET single video by ID ────────────────────────────────────────────────────

router.get('/channel-cache/video/:videoId', (req, res) => {
  try {
    const db    = getDb();
    const video = getVideoCacheById(db, req.params.videoId);
    if (!video) return res.status(404).json({ hit: false });
    res.json({ hit: true, video, cache_source: 'video_cache' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST background stats refresh ─────────────────────────────────────────────

router.post('/channel-cache/channel/:channelId/refresh-stats', async (req, res) => {
  res.json({ ok: true, queued: true });
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) return;
  try {
    const db  = getDb();
    const ids = getVideoCacheIds(db, req.params.channelId);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50).join(',');
      const url   = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(batch)}&key=${apiKey}`;
      const resp  = await fetch(url);
      if (!resp.ok) { console.warn('[channel-cache] refresh-stats YouTube error', resp.status); break; }
      const data  = await resp.json();
      for (const item of (data.items ?? [])) {
        updateVideoCacheStats(db, item.id, item.statistics);
      }
    }
    console.log(`[channel-cache] stats refreshed — ${ids.length} videos, channel ${req.params.channelId}`);
  } catch (e) {
    console.warn('[channel-cache] refresh-stats error:', e.message);
  }
});

// ── GET cache observability stats ─────────────────────────────────────────────

router.get('/channel-cache/stats', (req, res) => {
  try {
    const db       = getDb();
    const channels = db.get('SELECT COUNT(*) AS n FROM channel_cache') ?? { n: 0 };
    const videos   = db.get('SELECT COUNT(*) AS n FROM video_cache')   ?? { n: 0 };
    const stale    = db.get(
      `SELECT COUNT(*) AS n FROM channel_cache
       WHERE stats_refreshed_at < datetime('now','-24 hours') OR stats_refreshed_at IS NULL`,
    ) ?? { n: 0 };
    const hitExample = db.all(
      `SELECT channel_id, title, cached_at, stats_refreshed_at
       FROM channel_cache ORDER BY cached_at DESC LIMIT 5`,
    );
    const ingested = db.get('SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1') ?? { n: 0 };
    const uncached = db.get(`
      SELECT COUNT(*) AS n FROM ingested_channels ic
      WHERE ic.ingest_enabled = 1
        AND NOT EXISTS (SELECT 1 FROM channel_cache cc WHERE cc.channel_id = ic.channel_id)
    `) ?? { n: 0 };
    res.json({
      cached_channels:   channels.n,
      cached_videos:     videos.n,
      stale_channels:    stale.n,
      ingested_channels: ingested.n,
      uncached_ingested: uncached.n,
      recent_channels:   hitExample,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
