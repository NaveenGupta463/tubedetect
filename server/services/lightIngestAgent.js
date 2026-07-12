'use strict';

/**
 * Light Ingest Agent — Phase XI Corpus Memory Layer
 *
 * Stores YouTube channel and video data into the corpus WITHOUT
 * triggering any behavioral learning, benchmark updates, or
 * recommendation changes.
 *
 * ARCHITECTURAL RULE: This layer is PASSIVE MEMORY ONLY.
 * It does not call evaluateChannelQuality() or interact with
 * niche_benchmarks, scoring_versions, or recommendation tables.
 * Those are downstream gates that fire separately.
 */

const {
  upsertCorpusChannel,
  upsertCorpusVideo,
  updateCorpusChannelSemanticStatus,
  upsertRefreshSchedule,
  enqueueForEmbedding,
  logChannelEvent,
  logDiscoveryProvenance,
} = require('../db/corpusQueries');

const quotaGuard = require('./quotaGuard');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

const { getApiKey, markExhausted, isQuotaError } = require('./apiKeyManager');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(...args) {
  if (process.env.CORPUS_QUIET_GROWTH !== '1') console.log(...args);
}

// ── YouTube helpers (quota-aware, key-rotating) ───────────────────────────────

async function ytFetch(endpoint, params, timeoutMs = 25_000) {
  if (!quotaGuard.quotaAvailable(1)) throw new Error('quota_exhausted');
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey('ingest');
    if (!key) throw new Error('all_api_keys_exhausted');
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const ac    = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(url.toString(), { signal: ac.signal });
      const data = await resp.json();
      clearTimeout(timer);
      if (!resp.ok) {
        const msg = data?.error?.message || `YouTube ${resp.status}`;
        if (isQuotaError(msg)) { markExhausted(key); continue; }
        throw new Error(msg);
      }
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        console.warn(`[lightIngest] ytFetch timeout (${timeoutMs}ms) for ${endpoint}, attempt ${attempt + 1}`);
        if (attempt < 2) continue;
        throw new Error(`ytFetch_timeout:${endpoint}`);
      }
      throw e;
    }
  }
  throw new Error('all_api_keys_exhausted');
}

// ── Channel light-ingest ──────────────────────────────────────────────────────

async function lightIngestChannel(db, channelId, { discoverySource = 'manual' } = {}) {
  if (!getApiKey('ingest')) {
    console.warn('[lightIngest] No API key — cannot ingest', channelId);
    return { ok: false, reason: 'no_api_key' };
  }

  try {
    quotaGuard.recordUsage(1, 'corpus');
    const data = await ytFetch('channels', {
      part: 'snippet,statistics,contentDetails,brandingSettings,topicDetails,localizations',
      id:   channelId,
    });

    const item = data.items?.[0];
    if (!item) return { ok: false, reason: 'channel_not_found' };

    const snippet    = item.snippet ?? {};
    const stats      = item.statistics ?? {};
    const content    = item.contentDetails?.relatedPlaylists ?? {};
    const topicCats  = item.topicDetails?.topicCategories ?? [];

    const ch = {
      channel_id:           item.id,
      title:                snippet.title,
      handle:               snippet.customUrl?.replace(/^@/, '').toLowerCase() ?? null,
      thumbnail_url:        snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? null,
      uploads_playlist_id:  content.uploads ?? null,
      niche:                null, // assigned by channelClassifier separately
      language:             snippet.defaultLanguage ?? 'en',
      country:              snippet.country ?? null,
      subscriber_count:     parseInt(stats.subscriberCount ?? '0', 10),
      total_views:          parseInt(stats.viewCount      ?? '0', 10),
      video_count:          parseInt(stats.videoCount     ?? '0', 10),
      last_ingested_at:     new Date().toISOString(),
      last_refreshed_at:    new Date().toISOString(),
      ingest_depth:         1,
      discovery_source:     discoverySource,
      raw_json:             item,
      yt_default_language:  snippet.defaultLanguage ?? null,
      yt_country:           snippet.country ?? null,
      yt_topic_ids:         topicCats.length ? JSON.stringify(topicCats) : null,
    };

    const isNew = !db.get('SELECT 1 FROM corpus_channels WHERE channel_id = ?', [channelId]);
    upsertCorpusChannel(db, ch);
    if (isNew) {
      logChannelEvent(db, channelId, 'first_discovered', {
        discovery_source: discoverySource,
        subscriber_count: ch.subscriber_count,
        title: ch.title,
      });
      logDiscoveryProvenance(db, channelId, { discovery_source: discoverySource });
    }
    upsertRefreshSchedule(db, channelId, { priority: 5, stale_threshold_hours: 168 });

    // Queue channel title for embedding
    enqueueForEmbedding(db, { entity_type: 'channel', entity_id: channelId, priority: 6 });

    log(`[lightIngest] channel stored: ${item.id} (${snippet.title})`);
    return { ok: true, channel_id: item.id, title: snippet.title };
  } catch (e) {
    if (e.message === 'quota_exhausted') return { ok: false, reason: 'quota_exhausted' };
    console.warn(`[lightIngest] channel error ${channelId}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

// ── Video batch light-ingest ──────────────────────────────────────────────────

async function lightIngestVideoBatch(db, channelId, videoIds) {
  if (!videoIds.length) return { stored: 0 };

  const results = { stored: 0, errors: 0 };
  const snapshotItems = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      quotaGuard.recordUsage(1, 'corpus');
      const data = await ytFetch('videos', {
        part: 'snippet,statistics,contentDetails',
        id:   batch.join(','),
      });

      for (const item of (data.items ?? [])) {
        const sn  = item.snippet    ?? {};
        const st  = item.statistics ?? {};
        const cd  = item.contentDetails ?? {};

        const durationMatch = (cd.duration ?? '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        const durationSecs  = durationMatch
          ? (parseInt(durationMatch[1] ?? '0') * 3600 +
             parseInt(durationMatch[2] ?? '0') * 60   +
             parseInt(durationMatch[3] ?? '0'))
          : null;

        const views    = parseInt(st.viewCount    ?? '0', 10);
        const publishedAt = sn.publishedAt ?? null;
        const ageHours = publishedAt
          ? (Date.now() - new Date(publishedAt).getTime()) / 3_600_000
          : null;
        const vph = (ageHours && ageHours > 0 && views) ? views / ageHours : null;

        upsertCorpusVideo(db, {
          video_id:        item.id,
          channel_id:      channelId,
          title:           sn.title ?? '',
          description:     sn.description?.slice(0, 500) ?? null,
          thumbnail_url:   sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
          published_at:    publishedAt,
          duration_seconds: durationSecs,
          views,
          likes:           parseInt(st.likeCount    ?? '0', 10),
          comments:        parseInt(st.commentCount ?? '0', 10),
          vph,
          raw_json:        item,
        });

        // Queue each video title for embedding
        enqueueForEmbedding(db, { entity_type: 'video', entity_id: item.id, priority: 5 });
        snapshotItems.push({ video_id: item.id, title: sn.title ?? '', views, published_at: publishedAt, thumbnail_url: sn.thumbnails?.maxres?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null });
        results.stored++;
      }

      if (i + 50 < videoIds.length) await sleep(150);
    } catch (e) {
      if (e.message === 'quota_exhausted') break;
      console.warn(`[lightIngest] video batch error:`, e.message);
      results.errors++;
    }
  }

  if (results.stored > 0) {
    updateCorpusChannelSemanticStatus(db, channelId, 'pending');
    logChannelEvent(db, channelId, 'title_snapshot', { videos: snapshotItems });
  }

  log(`[lightIngest] videos stored: ${results.stored} for channel ${channelId}`);
  return results;
}

// ── Full channel ingest (metadata + recent videos) ────────────────────────────

async function lightIngestChannelFull(db, channelId, { maxVideos = 50, discoverySource = 'manual' } = {}) {
  const chResult = await lightIngestChannel(db, channelId, { discoverySource });
  if (!chResult.ok) return chResult;

  // Get uploads playlist from what we just stored
  const { getDb } = require('../db/init');
  const database = db || getDb();
  const stored = database.get('SELECT uploads_playlist_id FROM corpus_channels WHERE channel_id = ?', [channelId]);
  const uploadsId = stored?.uploads_playlist_id;

  if (!uploadsId) return { ...chResult, videos: { stored: 0, reason: 'no_uploads_playlist' } };

  try {
    quotaGuard.recordUsage(1, 'corpus');
    const playlistData = await ytFetch('playlistItems', {
      part:       'contentDetails',
      playlistId: uploadsId,
      maxResults: Math.min(maxVideos, 50),
    });

    const videoIds = (playlistData.items ?? []).map(i => i.contentDetails.videoId).filter(Boolean);
    const videoResult = await lightIngestVideoBatch(db, channelId, videoIds);

    // Increment ingest_depth so this channel isn't re-fetched every cycle
    const { getDb: _getDb } = require('../db/init');
    const _db = db || _getDb();
    _db.run('UPDATE corpus_channels SET ingest_depth = ingest_depth + 1, last_ingested_at = ? WHERE channel_id = ?', [new Date().toISOString(), channelId]);

    return { ...chResult, videos: videoResult };
  } catch (e) {
    if (e.message === 'quota_exhausted') return { ...chResult, videos: { stored: 0, reason: 'quota_exhausted' } };
    return { ...chResult, videos: { stored: 0, reason: e.message } };
  }
}

// ── Refresh a known channel's stats (cheap: 1 quota unit) ────────────────────

async function refreshKnownChannel(db, channelId) {
  return lightIngestChannel(db, channelId, { discoverySource: 'refresh' });
}

module.exports = {
  lightIngestChannel,
  lightIngestVideoBatch,
  lightIngestChannelFull,
  refreshKnownChannel,
};
