const crypto = require('crypto');
const { enqueueRefreshJob } = require('./refreshQueue');

// v3: creator_fit_score applied to all Category A ideas; original bets subject
// filtering hardened (entity person-name check extended to all families, India-
// specific subjects filtered for non-Indian creators).
// v4: sparse-DNA fix — creators with confidence_score < 0.3 now use a 0.85× floor
// instead of the full fit_weight, preventing false penalization of new channels.
// trend_bonus and gap_bonus added to wtp_impressions for outcome telemetry.
// v5: Stream-B low-value gate (directive non-recs, emoji/hashtag spam, non-Latin
// peers for English creators) + DNA fragment-subject rejection + skeleton dedup
// (one recommendation per title skeleton). Forces recompute so fixes reach users.
// v6: segment-aware phrase extraction (#1) + region gate on communityIds for
// English/Western creators (#3) — India-region peers excluded from their pools.
// v7: refiner drops synth-declined seeds (a) + topic-diversity interleave in
// familySubjectPool (b) + religion-aware devotional fallback (c).
// v8: classification guard/backfill (#1) + per-cluster cap in buildExpansionCandidates
// (#3, collapses near-duplicate subject variants → distinct angles). (#2 cold-start is
// refiner-layer, no cache impact.)
const CACHE_VERSION = 8;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const WTP_CACHE_TTL_MS = Math.max(60_000, Number.parseInt(process.env.WTP_CACHE_TTL_MS || DEFAULT_TTL_MS, 10));

function nowIso() {
  return new Date().toISOString();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function normalizeBool(value) {
  return value === true || value === 'true' || value === '1';
}

function normalizeChannelId(params = {}) {
  return String(params.channel_id || params.channelId || '').trim();
}

function isCacheableWtpRequest(params = {}) {
  if (process.env.WTP_CACHE_DISABLE === '1') return false;
  if (!normalizeChannelId(params)) return false;
  if (normalizeBool(params.debug)) return false;
  if (params.reference_date || params.referenceDate) return false;
  if (normalizeBool(params.disable_lifecycle_filter)) return false;
  return true;
}

function normalizedCacheParams(params = {}) {
  return {
    channel_id: normalizeChannelId(params),
    subscriber_count: params.subscriber_count ? String(params.subscriber_count) : undefined,
    use_creator_mode_peers: normalizeBool(params.use_creator_mode_peers) ? 'true' : undefined,
  };
}

function cacheParamsHash(params = {}) {
  const stable = JSON.stringify(normalizedCacheParams(params));
  return crypto.createHash('sha1').update(stable).digest('hex');
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function attachCacheMeta(payload, meta) {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    cache: {
      ...(payload.cache || {}),
      ...meta,
    },
  };
}

function getChannelWtpCache(db, channelId) {
  const row = db.get(`SELECT * FROM channel_wtp_cache WHERE channel_id = ?`, [channelId]);
  if (!row) return null;
  return {
    ...row,
    payload: parseJson(row.payload_json, null),
    source_versions: parseJson(row.source_versions_json, {}),
  };
}

function saveChannelWtpCache(db, channelId, payload, options = {}) {
  const computedAt = options.computed_at || nowIso();
  const ttlMs = Math.max(60_000, Number.parseInt(options.ttl_ms || WTP_CACHE_TTL_MS, 10));
  const expiresAt = options.expires_at || toIso(new Date(computedAt).getTime() + ttlMs);
  const sourceVersions = {
    cache_version: CACHE_VERSION,
    params_hash: options.params_hash || null,
    computed_by: options.computed_by || 'api',
    ...(options.source_versions || {}),
  };
  const payloadJson = JSON.stringify(payload);
  const sourceVersionsJson = JSON.stringify(sourceVersions);

  db.run(
    `INSERT INTO channel_wtp_cache
       (channel_id, payload_json, computed_at, expires_at, status, source_versions_json, refresh_reason, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       payload_json = excluded.payload_json,
       computed_at = excluded.computed_at,
       expires_at = excluded.expires_at,
       status = excluded.status,
       source_versions_json = excluded.source_versions_json,
       refresh_reason = excluded.refresh_reason,
       error_message = NULL,
       updated_at = datetime('now')`,
    [
      channelId,
      payloadJson,
      computedAt,
      expiresAt,
      options.status || 'ready',
      sourceVersionsJson,
      options.refresh_reason || options.refreshReason || 'compute',
    ],
  );

  return getChannelWtpCache(db, channelId);
}

function markChannelWtpCacheError(db, channelId, error, options = {}) {
  const message = String(error?.message || error || 'WTP cache refresh failed').slice(0, 500);
  db.run(
    `INSERT INTO channel_wtp_cache
       (channel_id, payload_json, computed_at, expires_at, status, source_versions_json, refresh_reason, error_message, created_at, updated_at)
     VALUES (?, '{}', datetime('now'), datetime('now'), 'error', '{}', ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       status = 'error',
       refresh_reason = ?,
       error_message = ?,
       updated_at = datetime('now')`,
    [channelId, options.refresh_reason || 'refresh_error', message, options.refresh_reason || 'refresh_error', message],
  );
}

function enqueueWtpCacheRefresh(db, channelId, params, reason = 'stale_cache') {
  return enqueueRefreshJob(db, {
    job_type: 'wtp_cache',
    channel_id: channelId,
    priority: reason === 'force_refresh' ? 0 : 50,
    run_after: nowIso(),
    reason,
    payload: {
      params: normalizedCacheParams(params),
      params_hash: cacheParamsHash(params),
    },
  });
}

function computeAndSaveWhatToPostCache(db, params, ctx, computeWhatToPost, options = {}) {
  const channelId = normalizeChannelId(params);
  if (!channelId) throw new Error('channel_id required for WTP cache compute');
  const cleanParams = normalizedCacheParams(params);
  const payload = computeWhatToPost(db, cleanParams, ctx);
  const saved = saveChannelWtpCache(db, channelId, payload, {
    computed_by: options.computed_by || 'worker',
    refresh_reason: options.refresh_reason || 'queue_refresh',
    params_hash: cacheParamsHash(cleanParams),
    source_versions: options.source_versions,
  });
  return attachCacheMeta(saved.payload || payload, {
    status: 'fresh',
    source: options.computed_by || 'worker',
    computed_at: saved.computed_at,
    expires_at: saved.expires_at,
    queued_refresh: false,
  });
}

function getCachedOrComputeWhatToPost(db, params, ctx, computeWhatToPost) {
  if (!isCacheableWtpRequest(params)) {
    return attachCacheMeta(computeWhatToPost(db, params, ctx), {
      status: 'bypass',
      source: 'live_compute',
      reason: 'uncacheable_params',
    });
  }

  const channelId = normalizeChannelId(params);
  const row = getChannelWtpCache(db, channelId);
  const nowMs = Date.now();

  if (row?.payload) {
    const expired = new Date(row.expires_at).getTime() <= nowMs
      || (row.source_versions?.cache_version ?? null) !== CACHE_VERSION;
    if (!expired && row.status === 'ready') {
      return attachCacheMeta(row.payload, {
        status: 'fresh',
        source: 'cache',
        computed_at: row.computed_at,
        expires_at: row.expires_at,
        queued_refresh: false,
      });
    }

    const job = enqueueWtpCacheRefresh(db, channelId, params, 'stale_cache');
    return attachCacheMeta(row.payload, {
      status: 'stale',
      source: 'cache',
      computed_at: row.computed_at,
      expires_at: row.expires_at,
      queued_refresh: Boolean(job?.id),
      refresh_job_id: job?.id,
    });
  }

  try {
    return computeAndSaveWhatToPostCache(db, params, ctx, computeWhatToPost, {
      computed_by: 'api_cold',
      refresh_reason: 'missing_cache',
    });
  } catch (error) {
    markChannelWtpCacheError(db, channelId, error, { refresh_reason: 'cold_compute_error' });
    throw error;
  }
}

module.exports = {
  CACHE_VERSION,
  WTP_CACHE_TTL_MS,
  isCacheableWtpRequest,
  normalizedCacheParams,
  cacheParamsHash,
  getChannelWtpCache,
  saveChannelWtpCache,
  enqueueWtpCacheRefresh,
  computeAndSaveWhatToPostCache,
  getCachedOrComputeWhatToPost,
  markChannelWtpCacheError,
};
