'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

/**
 * Phase 2: Creator graph candidate resolver.
 * Reads creator_discovery_candidates, resolves via YouTube API, applies quality gate,
 * admits passing channels to corpus_channels.
 *
 * Resolution strategy:
 *   channel_id candidates → channels.list?id= (batch 50, 1 unit/call)
 *   handle candidates     → channels.list?forHandle= (1 unit each, not batchable)
 *
 * Usage:
 *   node server/scripts/resolveCreatorDiscoveryCandidates.js [options]
 *
 * Options:
 *   --handle-cap N   max handle candidates to resolve per run (default 200)
 *   --dry-run        resolve and score but do not write to DB
 *   --report         print queue stats and exit
 */

const { getDb }            = require('../db/init');
const { upsertCorpusChannel } = require('../db/corpusQueries');
const quotaGuard           = require('../services/quotaGuard');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// Quality gate thresholds by source type.
// title_collab signals are strong (intentional collab), so threshold is looser.
const QUALITY_GATES = {
  title_collab:    { min_subs: 300,  min_videos: 5,  max_days_since_upload: 120 },
  description:     { min_subs: 500,  min_videos: 10, max_days_since_upload: 90  },
  channel_id:      { min_subs: 500,  min_videos: 10, max_days_since_upload: 90  },
  default:         { min_subs: 1000, min_videos: 10, max_days_since_upload: 90  },
};

const HANDLE_RESOLVE_MIN_SCORE = parseFloat(process.env.CREATOR_GRAPH_MIN_HANDLE_SCORE ?? '55');
const HANDLE_BLOCKLIST = new Set([
  'youtube', 'instagram', 'facebook', 'twitter', 'x', 'spotify', 'amazon',
  'google', 'adobe', 'audible', 'netflix', 'primevideo', 'hotstar',
  'prince', 'queen', 'king', 'official', 'india', 'https', 'http', 'www',
]);

const HANDLE_BRAND_PATTERNS = [
  /official$/i,
  /^amazon/i, /^google/i, /^apple/i, /^adobe/i, /^audible/i,
  /^samsung/i, /^oneplus/i, /^realme/i, /^xiaomi/i, /^oppo/i, /^vivo/i,
  /^motorola/i, /^sony/i, /^lg/i, /^nokia/i, /^jio/i, /^airtel/i,
  /^nykaa/i, /^sephora/i, /^maybelline/i, /^swissbeauty/i,
  /^lovebeautyandplanet/i, /^statefarm/i, /^reliance/i,
  /^rockstargames/i, /^minecraft/i, /^callofduty/i,
  /(store|shop|mall|market|officialstore|support|help|care)$/i,
  /(insurance|foundation|beauty|cosmetics|skincare|fashion|apparel)/i,
];

const CREATOR_HINT_RE = /(vlog|vlogs|gaming|gamer|music|films?|podcast|show|comedy|shorts|reacts?|recipes?|kitchen|fitness|academy|classes|study|travel|official)$/i;
const WEAK_GENERIC_HANDLE_RE = /^[a-z]{3,9}$/i;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(...args) {
  if (process.env.CORPUS_QUIET_GROWTH !== '1') console.log(...args);
}

async function ytFetch(endpoint, params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || `HTTP ${resp.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    return data;
  }
  throw new Error('all_api_keys_exhausted');
}

function classifyCreatorSize(subs) {
  const s = subs ?? 0;
  if (s >= 10_000_000) return 'mega';
  if (s >= 1_000_000)  return 'large';
  if (s >= 100_000)    return 'medium';
  if (s >= 10_000)     return 'small';
  return 'emerging';
}

const REFERENCE_CHANNEL_PATTERNS = [
  /\bnursery rhymes?\b/i,
  /\bkids songs?\b/i,
  /\bcosmetics?\b/i,
  /\bskincare\b/i,
  /\bdot & key\b/i,
  /\bmaybelline\b/i,
  /\bsephora\b/i,
  /\bswiss beauty\b/i,
  /\bnykaa\b/i,
  /\bupgrad\b/i,
  /\badobe\b/i,
  /\baudible\b/i,
  /\bstate farm\b/i,
  /\binsurance\b/i,
  /\breliance foundation\b/i,
  /\barman(i|y) beauty\b/i,
  /\blenovo\b/i,
  /\bdji\b/i,
  /\brockstar games\b/i,
  /\bminecraft\b/i,
  /\bcall of duty\b/i,
  /\bcocomelon\b/i,
  /\bshemaroo\b/i,
  /\byrf\b/i,
  /\bset india\b/i,
  /\bt-series\b/i,
  /\bultra bollywood\b/i,
  /\bsony music\b/i,
  /\bnetflix\b/i,
  /\bprime video\b/i,
];

function isLikelyReferenceChannel(item) {
  const snippet = item.snippet ?? {};
  const haystack = [
    snippet.title,
    snippet.customUrl,
    snippet.description,
  ].filter(Boolean).join(' ');
  return REFERENCE_CHANNEL_PATTERNS.some(re => re.test(haystack));
}

// Novelty score: proxy from distinct_source_channels + collab signal.
// Range 0-100 for compatibility with existing probation flow.
function computeNoveltyScore(candidate) {
  const raw = Math.min(
    candidate.distinct_source_channels * 3 +
    candidate.title_collab_count * 5 +
    candidate.recent_mention_count * 2,
    100,
  );
  return Math.max(raw, 20); // floor at 20 so probation isn't blocked immediately
}

function gateForCandidate(candidate) {
  if (candidate.title_collab_count > 0)          return QUALITY_GATES.title_collab;
  if (candidate.candidate_type === 'channel_id')  return QUALITY_GATES.channel_id;
  if (candidate.description_mention_count > 0)   return QUALITY_GATES.description;
  return QUALITY_GATES.default;
}

function discoverySourceForCandidate(candidate) {
  if (candidate.candidate_type === 'channel_id') return 'description_channel_id';
  if (candidate.title_collab_count > 0)          return 'title_collab_handle';
  return 'description_handle_link';
}

function hasResolverQuota(stats, units, maxQuota) {
  return stats.quota_used + units <= maxQuota;
}

async function getLatestUploadPublishedAt(item, stats, { maxQuota = Infinity } = {}) {
  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) return null;
  if (!hasResolverQuota(stats, 1, maxQuota)) {
    stats.quota_exhausted = true;
    return null;
  }
  if (!quotaGuard.quotaAvailable(1)) return null;

  quotaGuard.recordUsage(1, 'creator_graph_recent_upload_check');
  stats.quota_used++;

  const data = await ytFetch('playlistItems', {
    part:       'snippet',
    playlistId: uploadsPlaylistId,
    maxResults: '1',
  });
  return data.items?.[0]?.snippet?.publishedAt ?? null;
}

async function applyQualityGate(item, gate, stats, opts = {}) {
  const subs   = parseInt(item.statistics?.subscriberCount ?? '0', 10);
  const videos = parseInt(item.statistics?.videoCount       ?? '0', 10);

  if (isLikelyReferenceChannel(item)) {
    return { pass: false, reason: 'reference_or_brand_channel' };
  }

  if (subs < gate.min_subs) {
    return { pass: false, reason: `low_subscribers:${subs}<${gate.min_subs}` };
  }
  if (videos < gate.min_videos) {
    return { pass: false, reason: `low_video_count:${videos}<${gate.min_videos}` };
  }

  const latestUpload = await getLatestUploadPublishedAt(item, stats, opts);
  if (!latestUpload) {
    return { pass: false, reason: 'latest_upload_unavailable' };
  }

  const ageDays = (Date.now() - new Date(latestUpload).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > gate.max_days_since_upload) {
    return {
      pass: false,
      reason: `stale_upload:${Math.round(ageDays || 9999)}>${gate.max_days_since_upload}`,
    };
  }

  return { pass: true, subs, videos, latestUpload };
}

function admitToCorpus(db, item, candidate, noveltyScore) {
  const snippet = item.snippet ?? {};
  const stats   = item.statistics ?? {};
  const subs    = parseInt(stats.subscriberCount ?? '0', 10);
  const videos  = parseInt(stats.videoCount      ?? '0', 10);
  const views   = parseInt(stats.viewCount       ?? '0', 10);
  const handle  = snippet.customUrl?.replace(/^@/, '').toLowerCase() ?? null;
  const sizeTier = classifyCreatorSize(subs);
  const source  = discoverySourceForCandidate(candidate);

  upsertCorpusChannel(db, {
    channel_id:          item.id,
    title:               snippet.title ?? item.id,
    handle,
    thumbnail_url:       snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? null,
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    niche:               null,
    language:            snippet.defaultLanguage ?? null,
    country:             snippet.country ?? null,
    subscriber_count:    subs,
    total_views:         views,
    video_count:         videos,
    last_ingested_at:    null,
    discovery_source:    source,
    raw_json:            item,
    yt_default_language: snippet.defaultLanguage ?? null,
    yt_country:          snippet.country ?? null,
    yt_topic_ids:        item.topicDetails?.topicIds?.join(',') ?? null,
  });

  db.run(
    `UPDATE corpus_channels
     SET probation_state        = 1,
         probation_started_at   = COALESCE(probation_started_at, datetime('now')),
         creator_size_tier      = ?,
         semantic_novelty_score = ?,
         updated_at             = datetime('now')
     WHERE channel_id = ?`,
    [sizeTier, noveltyScore, item.id],
  );
}

function markCandidateResolved(db, candidateKey, channelId, item, status, rejectionReason) {
  const snippet = item?.snippet ?? {};
  const stats   = item?.statistics ?? {};
  db.run(
    `UPDATE creator_discovery_candidates SET
       status                    = ?,
       resolved_channel_id       = ?,
       resolved_title            = ?,
       resolved_subscriber_count = ?,
       resolved_video_count      = ?,
       resolved_country          = ?,
       resolved_language         = ?,
       rejection_reason          = ?,
       resolved_at               = datetime('now'),
       admitted_at               = CASE WHEN ? = 'admitted' THEN datetime('now') ELSE admitted_at END,
       updated_at                = datetime('now')
     WHERE candidate_key = ?`,
    [
      status,
      channelId ?? null,
      snippet.title ?? null,
      parseInt(stats.subscriberCount ?? '0', 10) || null,
      parseInt(stats.videoCount      ?? '0', 10) || null,
      snippet.country ?? null,
      snippet.defaultLanguage ?? null,
      rejectionReason ?? null,
      status,
      candidateKey,
    ],
  );
}

function markCandidateInvalid(db, candidateKey, reason) {
  db.run(
    `UPDATE creator_discovery_candidates SET
       status           = 'invalid',
       rejection_reason = ?,
       resolved_at      = datetime('now'),
       updated_at       = datetime('now')
     WHERE candidate_key = ?`,
    [reason, candidateKey],
  );
}

function normalizeHandle(handle) {
  return String(handle || '').replace(/^@/, '').trim().toLowerCase();
}

function isBlockedHandleCandidate(handle) {
  const h = normalizeHandle(handle);
  if (!h) return true;
  if (HANDLE_BLOCKLIST.has(h)) return true;
  if (/[._-]$/.test(h)) return true;
  if (/^[0-9]+$/.test(h)) return true;
  if (/\.(com|in|net|org|co|io|app|tv|me|us|uk|au|ca|edu|gov)(\.|$)/i.test(h)) return true;
  return HANDLE_BRAND_PATTERNS.some(re => re.test(h));
}

function isWeakHandleCandidate(row) {
  if (row.candidate_type !== 'handle') return false;
  const h = normalizeHandle(row.handle || row.candidate_key);
  if (isBlockedHandleCandidate(h)) return true;
  if ((row.score ?? 0) < HANDLE_RESOLVE_MIN_SCORE) return true;

  const distinctSources = row.distinct_source_channels ?? 0;
  const titleCollabs = row.title_collab_count ?? 0;
  const recentMentions = row.recent_mention_count ?? 0;
  const genericSingleWord = WEAK_GENERIC_HANDLE_RE.test(h) && !CREATOR_HINT_RE.test(h);

  if (genericSingleWord && distinctSources < 4 && titleCollabs < 2) return true;
  return distinctSources < 2 && titleCollabs < 2 && recentMentions < 2;
}

function markWeakHandleCandidates(db, dryRun, limit = 5000) {
  const rows = db.all(`
    SELECT candidate_key, candidate_type, handle, score,
           distinct_source_channels, title_collab_count, recent_mention_count
    FROM creator_discovery_candidates
    WHERE status = 'pending'
      AND candidate_type = 'handle'
    ORDER BY score DESC
    LIMIT ?
  `, [limit]).filter(isWeakHandleCandidate);

  if (!rows.length || dryRun) return rows.length;

  db.run('BEGIN');
  try {
    for (const row of rows) {
      db.run(`
        UPDATE creator_discovery_candidates
        SET status = 'invalid',
            rejection_reason = ?,
            resolved_at = datetime('now'),
            updated_at = datetime('now')
        WHERE candidate_key = ?
      `, [
        isBlockedHandleCandidate(row.handle || row.candidate_key)
          ? 'blocked_or_brand_handle'
          : 'weak_handle_signal',
        row.candidate_key,
      ]);
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  return rows.length;
}

function markKnownHandleDuplicates(db, dryRun, limit = 1000) {
  const candidates = db.all(`
    SELECT candidate_key, handle
    FROM creator_discovery_candidates cdc
    WHERE cdc.status = 'pending'
      AND cdc.candidate_type = 'handle'
      AND cdc.handle IS NOT NULL
    ORDER BY cdc.score DESC
    LIMIT ?
  `, [limit]);

  const handles = [...new Set(candidates.map(c => normalizeHandle(c.handle)).filter(Boolean))];
  if (!handles.length) return 0;

  const placeholders = handles.map(() => '?').join(',');
  const knownRows = db.all(`
    SELECT handle AS handle_norm,
           channel_id
    FROM corpus_channels
    WHERE handle IS NOT NULL
      AND handle IN (${placeholders})
  `, handles);

  const known = new Map();
  for (const row of knownRows) {
    const norm = normalizeHandle(row.handle_norm);
    if (norm && !known.has(norm)) known.set(norm, row.channel_id);
  }

  const rows = candidates
    .map(c => ({ candidate_key: c.candidate_key, channel_id: known.get(normalizeHandle(c.handle)) }))
    .filter(r => r.channel_id);

  if (!rows.length || dryRun) return rows.length;

  db.run('BEGIN');
  try {
    for (const row of rows) {
      db.run(`
        UPDATE creator_discovery_candidates
        SET status = 'invalid',
            rejection_reason = 'already_in_corpus_handle',
            resolved_channel_id = COALESCE(resolved_channel_id, ?),
            resolved_at = datetime('now'),
            updated_at = datetime('now')
        WHERE candidate_key = ?
      `, [row.channel_id ?? null, row.candidate_key]);
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }

  return rows.length;
}

// ── Channel-ID resolution (batch) ─────────────────────────────────────────────

async function resolveChannelIdBatch(db, candidates, stats, dryRun, { maxQuota = Infinity } = {}) {
  const IDS_PER_CALL = 50;

  for (let i = 0; i < candidates.length; i += IDS_PER_CALL) {
    if (!hasResolverQuota(stats, 1, maxQuota)) {
      stats.quota_exhausted = true;
      break;
    }
    if (!quotaGuard.quotaAvailable(1)) {
      console.log('[resolver] Quota exhausted during channel_id batch resolution.');
      stats.quota_exhausted = true;
      break;
    }

    const batch = candidates.slice(i, i + IDS_PER_CALL);
    const ids   = batch.map(c => c.resolved_channel_id).join(',');

    try {
      quotaGuard.recordUsage(1, 'creator_graph_resolver');
      stats.quota_used++;

      const data  = await ytFetch('channels', {
        part: 'snippet,statistics,contentDetails',
        id:   ids,
      });

      const found = new Map((data.items ?? []).map(item => [item.id, item]));

      for (const c of batch) {
        const item = found.get(c.resolved_channel_id);
        if (!item) {
          stats.not_found++;
          if (!dryRun) markCandidateInvalid(db, c.candidate_key, 'not_found');
          continue;
        }

        // Already in corpus — mark duplicate
        const existing = db.get('SELECT channel_id FROM corpus_channels WHERE channel_id = ?', [item.id]);
        if (existing) {
          stats.duplicates++;
          if (!dryRun) markCandidateInvalid(db, c.candidate_key, 'already_in_corpus');
          continue;
        }

        const gate   = gateForCandidate(c);
        const result = await applyQualityGate(item, gate, stats, { maxQuota });

        if (!result.pass) {
          stats.rejected++;
          stats.rejection_reasons[result.reason] = (stats.rejection_reasons[result.reason] || 0) + 1;
          if (!dryRun) markCandidateResolved(db, c.candidate_key, item.id, item, 'rejected', result.reason);
          continue;
        }

        stats.admitted++;
        const novelty = computeNoveltyScore(c);
        if (!dryRun) {
          admitToCorpus(db, item, c, novelty);
          markCandidateResolved(db, c.candidate_key, item.id, item, 'admitted', null);
        }
        log(`[resolver] + ${item.snippet?.title ?? item.id} (${result.subs.toLocaleString()} subs) [channel_id]`);
      }

      await sleep(100);
    } catch (e) {
      if (e.message === 'all_api_keys_exhausted') {
        console.log('[resolver] All API keys exhausted.');
        break;
      }
      console.error('[resolver] Batch error:', e.message);
      stats.errors++;
    }
  }
}

// ── Handle resolution (one by one) ────────────────────────────────────────────

async function resolveHandles(db, candidates, stats, dryRun, { maxQuota = Infinity } = {}) {
  for (const c of candidates) {
    if (!hasResolverQuota(stats, 1, maxQuota)) {
      stats.quota_exhausted = true;
      break;
    }
    if (!quotaGuard.quotaAvailable(1)) {
      console.log('[resolver] Quota exhausted during handle resolution.');
      stats.quota_exhausted = true;
      break;
    }

    const handle = c.handle;
    try {
      quotaGuard.recordUsage(1, 'creator_graph_resolver');
      stats.quota_used++;

      const data = await ytFetch('channels', {
        part:      'snippet,statistics,contentDetails',
        forHandle: handle,
      });

      const item = data.items?.[0];
      if (!item) {
        stats.not_found++;
        if (!dryRun) markCandidateInvalid(db, c.candidate_key, 'not_found');
        await sleep(100);
        continue;
      }

      // Check duplicate
      const existing = db.get(
        'SELECT channel_id FROM corpus_channels WHERE channel_id = ?', [item.id],
      );
      if (existing) {
        stats.duplicates++;
        // Update handle in corpus in case it was missing
        if (!dryRun) {
          db.run('UPDATE corpus_channels SET handle = COALESCE(handle, ?) WHERE channel_id = ?',
            [handle, item.id]);
          markCandidateInvalid(db, c.candidate_key, 'already_in_corpus');
        }
        await sleep(100);
        continue;
      }

      const gate   = gateForCandidate(c);
      const result = await applyQualityGate(item, gate, stats, { maxQuota });

      if (!result.pass) {
        stats.rejected++;
        stats.rejection_reasons[result.reason] = (stats.rejection_reasons[result.reason] || 0) + 1;
        if (!dryRun) markCandidateResolved(db, c.candidate_key, item.id, item, 'rejected', result.reason);
        await sleep(100);
        continue;
      }

      stats.admitted++;
      const novelty = computeNoveltyScore(c);
      if (!dryRun) {
        admitToCorpus(db, item, c, novelty);
        markCandidateResolved(db, c.candidate_key, item.id, item, 'admitted', null);
      }
      log(`[resolver] + ${item.snippet?.title ?? handle} (${result.subs.toLocaleString()} subs) [@${handle}]`);

      await sleep(120);
    } catch (e) {
      if (e.message === 'all_api_keys_exhausted') {
        console.log('[resolver] All API keys exhausted.');
        break;
      }
      console.error(`[resolver] Error resolving @${handle}:`, e.message);
      stats.errors++;
      await sleep(200);
    }
  }
}

// ── Queue report ──────────────────────────────────────────────────────────────

function printQueueReport(db) {
  const total    = db.get(`SELECT COUNT(*) AS n FROM creator_discovery_candidates`).n;
  const byStatus = db.all(`SELECT status, COUNT(*) AS n FROM creator_discovery_candidates GROUP BY status ORDER BY n DESC`);
  const byType   = db.all(`SELECT candidate_type, status, COUNT(*) AS n FROM creator_discovery_candidates GROUP BY candidate_type, status ORDER BY candidate_type, n DESC`);
  const topPending = db.all(`
    SELECT candidate_key, candidate_type, score, distinct_source_channels, title_collab_count, recent_mention_count
    FROM creator_discovery_candidates WHERE status = 'pending'
    ORDER BY score DESC LIMIT 20
  `);

  console.log('\n========== CANDIDATE QUEUE REPORT ==========');
  console.log('total_candidates:', total);
  console.log('\n--- By status ---');
  byStatus.forEach(r => console.log(' ', r.status.padEnd(12), r.n));
  console.log('\n--- By type × status ---');
  byType.forEach(r => console.log(' ', r.candidate_type.padEnd(12), r.status.padEnd(12), r.n));
  console.log('\n--- Top 20 pending by score ---');
  topPending.forEach((r, i) => {
    console.log(
      String(i + 1).padStart(3), '|',
      String(Math.round(r.score)).padStart(6), '|',
      r.candidate_type.slice(0, 10).padEnd(10), '|',
      r.candidate_key.slice(0, 35).padEnd(35), '|',
      'dsc:', String(r.distinct_source_channels).padStart(3),
      'col:', String(r.title_collab_count).padStart(3),
      'rec:', String(r.recent_mention_count).padStart(3),
    );
  });
  console.log('=============================================\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runCreatorDiscoveryResolver(db, {
  handleCap = 200,
  dryRun = false,
  maxQuota = Infinity,
} = {}) {
  console.log(`[resolver] Starting. handle_cap=${handleCap} dry_run=${dryRun} max_quota=${Number.isFinite(maxQuota) ? maxQuota : 'unbounded'}`);
  const t0 = Date.now();

  const stats = {
    quota_used: 0,
    admitted: 0,
    rejected: 0,
    not_found: 0,
    duplicates: 0,
    local_duplicates: 0,
    weak_handles_invalidated: 0,
    errors: 0,
    quota_exhausted: false,
    rejection_reasons: {},
  };

  stats.local_duplicates = markKnownHandleDuplicates(db, dryRun, Math.max(handleCap * 20, 200));
  if (stats.local_duplicates > 0) {
    console.log(`[resolver] Marked ${stats.local_duplicates} pending handle candidates as already known locally.`);
  }

  stats.weak_handles_invalidated = markWeakHandleCandidates(db, dryRun, Math.max(handleCap * 20, 5000));
  if (stats.weak_handles_invalidated > 0) {
    console.log(`[resolver] Marked ${stats.weak_handles_invalidated} weak/blocked handle candidates invalid before API resolution.`);
  }

  // ── Step 1: channel_id candidates (batch-resolvable, cheapest) ──────────────

  const channelIdCandidates = db.all(`
    SELECT candidate_key, candidate_type, resolved_channel_id, score,
           distinct_source_channels, title_collab_count, description_mention_count,
           recent_mention_count
    FROM creator_discovery_candidates
    WHERE status = 'pending' AND candidate_type = 'channel_id'
    ORDER BY score DESC
  `);

  if (channelIdCandidates.length > 0) {
    console.log(`[resolver] Resolving ${channelIdCandidates.length} channel_id candidates in batches of 50...`);
    await resolveChannelIdBatch(db, channelIdCandidates, stats, dryRun, { maxQuota });
  } else {
    console.log('[resolver] No pending channel_id candidates.');
  }

  // ── Step 2: handle candidates (one per API call, cap applies) ───────────────

  const handleCandidates = db.all(`
    SELECT candidate_key, candidate_type, handle, score,
           distinct_source_channels, title_collab_count, description_mention_count,
           recent_mention_count
    FROM creator_discovery_candidates
    WHERE status = 'pending' AND candidate_type = 'handle' AND handle IS NOT NULL
      AND score >= ?
      AND (
        distinct_source_channels >= 2
        OR title_collab_count >= 2
        OR recent_mention_count >= 2
      )
      AND NOT EXISTS (
        SELECT 1
        FROM corpus_channels cc
        WHERE cc.handle = creator_discovery_candidates.handle
      )
    ORDER BY score DESC
    LIMIT ?
  `, [HANDLE_RESOLVE_MIN_SCORE, handleCap]);

  if (handleCandidates.length > 0) {
    console.log(`[resolver] Resolving ${handleCandidates.length} handle candidates (cap=${handleCap})...`);
    await resolveHandles(db, handleCandidates, stats, dryRun, { maxQuota });
  } else {
    console.log('[resolver] No pending handle candidates.');
  }

  // ── Report ───────────────────────────────────────────────────────────────────

  const elapsed = Math.round((Date.now() - t0) / 1000);
  stats.elapsed_seconds = elapsed;

  console.log('\n========== RESOLVER REPORT ==========');
  console.log('elapsed_seconds: ', elapsed);
  console.log('quota_used:      ', stats.quota_used);
  console.log('admitted:        ', stats.admitted);
  console.log('rejected:        ', stats.rejected);
  console.log('not_found:       ', stats.not_found);
  console.log('duplicates:      ', stats.duplicates);
  console.log('local_duplicates:', stats.local_duplicates);
  console.log('weak_handles_invalidated:', stats.weak_handles_invalidated);
  console.log('errors:          ', stats.errors);
  console.log('quota_exhausted: ', stats.quota_exhausted);
  if (Object.keys(stats.rejection_reasons).length) {
    console.log('\n--- Rejection reasons ---');
    Object.entries(stats.rejection_reasons)
      .sort(([, a], [, b]) => b - a)
      .forEach(([r, n]) => console.log(' ', r, n));
  }
  if (dryRun) console.log('\n[DRY RUN] Nothing written to DB.');
  console.log('=====================================\n');

  const remaining = db.get(
    `SELECT COUNT(*) AS n FROM creator_discovery_candidates WHERE status = 'pending'`,
  ).n;
  stats.pending_remaining = remaining;
  console.log(`[resolver] Pending candidates remaining: ${remaining}`);
  return stats;
}

async function main() {
  const args      = process.argv.slice(2);
  const dryRun    = args.includes('--dry-run');
  const report    = args.includes('--report');
  const capIdx    = args.indexOf('--handle-cap');
  const quotaIdx  = args.indexOf('--max-quota');
  const handleCap = capIdx >= 0 ? parseInt(args[capIdx + 1], 10) : 200;
  const maxQuota  = quotaIdx >= 0 ? parseInt(args[quotaIdx + 1], 10) : Infinity;

  const db = getDb();

  if (report) {
    printQueueReport(db);
    return;
  }

  await runCreatorDiscoveryResolver(db, { handleCap, dryRun, maxQuota });
}

if (require.main === module) {
  main().catch(e => { console.error('[resolver] Fatal:', e); process.exit(1); });
}

module.exports = {
  runCreatorDiscoveryResolver,
  printQueueReport,
};
