'use strict';

const crypto = require('crypto');

const GRAPH_DISCOVERY_SOURCES = [
  'description_channel_id',
  'description_handle_link',
  'title_collab_handle',
];

const GRAPH_DISCOVERY_SQL_LIST = GRAPH_DISCOVERY_SOURCES.map(s => `'${s}'`).join(',');

const INDIA_SEARCH_DISCOVERY_SOURCES = [
  'video_search_IN',
  'video_search_hi',
  'video_search_pa',
  'video_search_bn',
  'video_search_kn',
  'video_search_ml',
  'video_search_ta',
  'video_search_te',
  'video_search_ar',
  'hindi_keyword_search',
  'punjabi_keyword_search',
  'bengali_keyword_search',
  'kannada_keyword_search',
  'malayalam_keyword_search',
  'tamil_keyword_search',
  'telugu_keyword_search',
  'arabic_keyword_search',
  'keyword_search_IN',
  'trending_IN',
  'emerging_IN',
];

const INDIA_SEARCH_DISCOVERY_SQL_LIST = INDIA_SEARCH_DISCOVERY_SOURCES.map(s => `'${s}'`).join(',');
// US/UK expansion: first-class discovery sources we now actively ingest.
const USUK_SEARCH_DISCOVERY_SOURCES = [
  'us_keyword_search',
  'gb_keyword_search',
  'trending_US',
  'trending_GB',
];
const USUK_SEARCH_DISCOVERY_SQL_LIST = USUK_SEARCH_DISCOVERY_SOURCES.map(s => `'${s}'`).join(',');
const FOREIGN_SEARCH_DISCOVERY_SQL_LIST = [
  'video_search_es',
  'video_search_pt',
  'video_search_id',
  'spanish_keyword_search',
  'portuguese_keyword_search',
  'indonesian_keyword_search',
].map(s => `'${s}'`).join(',');

const REFERENCE_LIKE_TITLE_SQL = [
  "LOWER(cc.title) LIKE '%nursery rhyme%'",
  "LOWER(cc.title) LIKE '%kids song%'",
  "LOWER(cc.title) LIKE '%cosmetic%'",
  "LOWER(cc.title) LIKE '%skincare%'",
  "LOWER(cc.title) LIKE '%dot & key%'",
  "LOWER(cc.title) LIKE '%maybelline%'",
  "LOWER(cc.title) LIKE '%sephora%'",
  "LOWER(cc.title) LIKE '%swiss beauty%'",
  "LOWER(cc.title) LIKE '%nykaa%'",
  "LOWER(cc.title) LIKE '%upgrad%'",
  "LOWER(cc.title) LIKE '%lenovo%'",
  "LOWER(cc.title) LIKE '%dji%'",
  "LOWER(cc.title) LIKE '%minecraft%'",
  "LOWER(cc.title) LIKE '%call of duty%'",
  "LOWER(cc.title) LIKE '%cocomelon%'",
  "LOWER(cc.title) LIKE '%shemaroo%'",
  "LOWER(cc.title) LIKE '%yrf%'",
  "LOWER(cc.title) LIKE '%set india%'",
  "LOWER(cc.title) LIKE '%t-series%'",
  "LOWER(cc.title) LIKE '%ultra bollywood%'",
  "LOWER(cc.title) LIKE '%sony music%'",
  "LOWER(cc.title) LIKE '%netflix%'",
  "LOWER(cc.title) LIKE '%prime video%'",
].join(' OR ');

// ── corpus_channels ───────────────────────────────────────────────────────────

function upsertCorpusChannel(db, ch) {
  db.run(
    `INSERT INTO corpus_channels
       (channel_id, title, handle, thumbnail_url, uploads_playlist_id,
        niche, language, country, subscriber_count, total_views, video_count,
        last_ingested_at, discovery_source, raw_json,
        yt_default_language, yt_country, yt_topic_ids,
        updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       title               = excluded.title,
       handle              = COALESCE(excluded.handle, handle),
       thumbnail_url       = COALESCE(excluded.thumbnail_url, thumbnail_url),
       uploads_playlist_id = COALESCE(excluded.uploads_playlist_id, uploads_playlist_id),
       niche               = COALESCE(excluded.niche, niche),
       subscriber_count    = excluded.subscriber_count,
       total_views         = excluded.total_views,
       video_count         = excluded.video_count,
       last_ingested_at    = excluded.last_ingested_at,
       raw_json            = COALESCE(excluded.raw_json, raw_json),
       yt_default_language = COALESCE(excluded.yt_default_language, yt_default_language),
       yt_country          = COALESCE(excluded.yt_country, yt_country),
       yt_topic_ids        = COALESCE(excluded.yt_topic_ids, yt_topic_ids),
       updated_at          = datetime('now')`,
    [
      ch.channel_id, ch.title, ch.handle ?? null, ch.thumbnail_url ?? null,
      ch.uploads_playlist_id ?? null, ch.niche ?? null, ch.language ?? 'en',
      ch.country ?? null, ch.subscriber_count ?? 0, ch.total_views ?? 0,
      ch.video_count ?? 0, ch.last_ingested_at ?? null, ch.discovery_source ?? 'manual',
      ch.raw_json ? JSON.stringify(ch.raw_json) : null,
      ch.yt_default_language ?? null, ch.yt_country ?? null, ch.yt_topic_ids ?? null,
    ],
  );
}

function getCorpusChannel(db, channelId) {
  const row = db.get('SELECT * FROM corpus_channels WHERE channel_id = ?', [channelId]);
  if (!row) return null;
  if (row.raw_json) try { row.raw_json = JSON.parse(row.raw_json); } catch (_) {}
  if (row.quality_flags) try { row.quality_flags = JSON.parse(row.quality_flags); } catch (_) {}
  return row;
}

function getCorpusChannelByHandle(db, handle) {
  const norm = (handle || '').replace(/^@/, '').toLowerCase();
  const row  = db.get(
    'SELECT * FROM corpus_channels WHERE LOWER(handle) = ?', [norm],
  );
  if (!row) return null;
  if (row.raw_json) try { row.raw_json = JSON.parse(row.raw_json); } catch (_) {}
  return row;
}

function updateCorpusChannelQuality(db, channelId, { quality_score, training_eligible, is_spam, is_low_quality, quality_flags }) {
  db.run(
    `UPDATE corpus_channels SET
       quality_score     = ?,
       training_eligible = ?,
       is_spam           = ?,
       is_low_quality    = ?,
       quality_flags     = ?,
       updated_at        = datetime('now')
     WHERE channel_id = ?`,
    [quality_score, training_eligible ? 1 : 0, is_spam ? 1 : 0,
     is_low_quality ? 1 : 0, JSON.stringify(quality_flags ?? []), channelId],
  );
}

function updateCorpusChannelSemanticStatus(db, channelId, status) {
  db.run(
    `UPDATE corpus_channels SET semantic_status = ?, updated_at = datetime('now') WHERE channel_id = ?`,
    [status, channelId],
  );
}

function updateCorpusChannelPriority(db, channelId, score) {
  db.run(
    `UPDATE corpus_channels SET priority_score = ?, updated_at = datetime('now') WHERE channel_id = ?`,
    [score, channelId],
  );
}

function promoteCorpusChannelTraining(db, channelId) {
  db.run(
    `UPDATE corpus_channels SET training_eligible = 1, training_promoted_at = datetime('now'), updated_at = datetime('now') WHERE channel_id = ?`,
    [channelId],
  );
}

function demoteCorpusChannelTraining(db, channelId) {
  db.run(
    `UPDATE corpus_channels SET training_eligible = 0, training_demoted_at = datetime('now'), updated_at = datetime('now') WHERE channel_id = ?`,
    [channelId],
  );
}

function getAllCorpusChannels(db, { limit = 100, offset = 0, niche, training_eligible, min_quality } = {}) {
  let sql = 'SELECT * FROM corpus_channels WHERE 1=1';
  const params = [];
  if (niche) { sql += ' AND niche = ?'; params.push(niche); }
  if (training_eligible != null) { sql += ' AND training_eligible = ?'; params.push(training_eligible ? 1 : 0); }
  if (min_quality != null) { sql += ' AND quality_score >= ?'; params.push(min_quality); }
  sql += ' ORDER BY priority_score DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.all(sql, params);
}

function countCorpusChannels(db) {
  return db.get('SELECT COUNT(*) AS n FROM corpus_channels')?.n ?? 0;
}

function getCorpusChannelsForQualityEval(db, limit = 50) {
  return db.all(
    `SELECT cc.*,
            CASE WHEN EXISTS (
              SELECT 1 FROM corpus_videos cv WHERE cv.channel_id = cc.channel_id LIMIT 1
            ) THEN 1 ELSE 0 END AS _has_videos,
            CASE WHEN cc.discovery_source IN (${GRAPH_DISCOVERY_SQL_LIST}) THEN 1 ELSE 0 END AS _graph_source,
            CASE WHEN cc.yt_country = 'IN' OR cc.country = 'IN' THEN 1 ELSE 0 END AS _is_indian,
            CASE WHEN cc.subscriber_count >= 5000 AND cc.auto_promoted_at IS NULL THEN 1 ELSE 0 END AS _promotion_candidate
     FROM corpus_channels cc
     LEFT JOIN corpus_quality_state cqs ON cqs.channel_id = cc.channel_id
     WHERE cqs.evaluated_at IS NULL
        OR cqs.evaluated_at < datetime('now','-7 days')
        OR (cc.last_ingested_at IS NOT NULL AND (cqs.evaluated_at IS NULL OR cc.last_ingested_at > cqs.evaluated_at))
        OR ((cqs.sample_size IS NULL OR cqs.sample_size < 5)
            AND EXISTS (SELECT 1 FROM corpus_videos cv WHERE cv.channel_id = cc.channel_id LIMIT 1))
     ORDER BY
       _has_videos DESC,
       _graph_source DESC,
       _is_indian DESC,
       _promotion_candidate DESC,
       (cqs.evaluated_at IS NULL) DESC,
       CASE WHEN cqs.evaluated_at IS NULL THEN COALESCE(cc.subscriber_count, 0) ELSE 0 END DESC,
       cc.priority_score DESC
     LIMIT ?`,
    [limit],
  );
}

function getCorpusChannelsForLightIngest(db, limit = 3000) {
  return db.all(
    `SELECT cc.*,
            CASE WHEN cc.discovery_source IN (${GRAPH_DISCOVERY_SQL_LIST}) THEN 1 ELSE 0 END AS _graph_source,
            CASE WHEN cc.created_at >= datetime('now','-2 hours') THEN 1 ELSE 0 END AS _fresh_discovery,
            CASE
              WHEN cc.discovery_source = 'title_collab_handle' THEN 3
              WHEN cc.discovery_source = 'description_channel_id' THEN 2
              WHEN cc.discovery_source = 'description_handle_link' THEN 1
              ELSE 0
            END AS _graph_source_rank,
            CASE
              WHEN cc.discovery_source = 'video_search_IN'
                   AND COALESCE(cc.subscriber_count, 0) >= 500
                   AND COALESCE(cc.video_count, 0) >= 5 THEN 9
              WHEN cc.discovery_source IN (${INDIA_SEARCH_DISCOVERY_SQL_LIST})
                   AND COALESCE(cc.subscriber_count, 0) >= 500
                   AND COALESCE(cc.video_count, 0) >= 5 THEN 8
              WHEN cc.discovery_source IN (${USUK_SEARCH_DISCOVERY_SQL_LIST})
                   AND COALESCE(cc.subscriber_count, 0) >= 500
                   AND COALESCE(cc.video_count, 0) >= 5 THEN 8
              WHEN cc.discovery_source LIKE 'video_search%'
                   AND (cc.yt_country = 'IN' OR cc.country = 'IN')
                   AND COALESCE(cc.subscriber_count, 0) >= 500
                   AND COALESCE(cc.video_count, 0) >= 5 THEN 6
              WHEN cc.discovery_source LIKE '%keyword_search%'
                   AND (cc.yt_country = 'IN' OR cc.country = 'IN')
                   AND COALESCE(cc.subscriber_count, 0) >= 500
                   AND COALESCE(cc.video_count, 0) >= 5 THEN 5
              WHEN cc.discovery_source = 'title_collab_handle' THEN 4
              WHEN cc.discovery_source = 'description_channel_id' THEN 3
              WHEN cc.discovery_source = 'description_handle_link'
                   AND COALESCE(cc.subscriber_count, 0) BETWEEN 1000 AND 10000000
                   AND COALESCE(cc.video_count, 0) >= 5
                   AND NOT (${REFERENCE_LIKE_TITLE_SQL}) THEN 2
              WHEN cc.discovery_source = 'comment_harvest_IN'
                   AND COALESCE(cc.subscriber_count, 0) >= 2000
                   AND COALESCE(cc.video_count, 0) >= 10 THEN 1
              ELSE 0
            END AS _source_quality_rank,
            CASE WHEN cc.yt_country = 'IN' OR cc.country = 'IN' THEN 1 ELSE 0 END AS _is_indian,
            CASE WHEN cc.yt_country IN ('US','GB') OR cc.country IN ('US','GB') THEN 1 ELSE 0 END AS _is_target_foreign,
            CASE WHEN cc.subscriber_count >= 5000 THEN 1 ELSE 0 END AS _has_promotable_size,
            CASE
              WHEN cc.subscriber_count BETWEEN 5000 AND 10000000 THEN 3
              WHEN cc.subscriber_count BETWEEN 10000000 AND 50000000 THEN 2
              WHEN cc.subscriber_count BETWEEN 1000 AND 5000 THEN 1
              ELSE 0
            END AS _creator_size_fit,
            CASE WHEN (${REFERENCE_LIKE_TITLE_SQL}) THEN 1 ELSE 0 END AS _reference_like
     FROM corpus_channels cc
     WHERE cc.ingest_depth < 1
       AND cc.is_spam = 0
       AND (cc.discovery_source IS NULL OR cc.discovery_source != 'ingested_channels_sync')
       AND NOT (
         cc.discovery_source IN (${FOREIGN_SEARCH_DISCOVERY_SQL_LIST})
         AND NOT (cc.yt_country = 'IN' OR cc.country = 'IN')
       )
       AND NOT (
         (
           cc.discovery_source LIKE 'video_search%'
           OR cc.discovery_source LIKE '%keyword_search%'
           OR cc.discovery_source IN ('trending_IN', 'emerging_IN')
         )
         AND COALESCE(cc.video_count, 0) < 5
       )
       AND NOT (
         cc.discovery_source = 'description_handle_link'
         AND (
           (${REFERENCE_LIKE_TITLE_SQL})
           OR COALESCE(cc.video_count, 0) < 5
           OR COALESCE(cc.subscriber_count, 0) < 1000
           OR COALESCE(cc.subscriber_count, 0) > 10000000
         )
       )
       AND (
         cc.discovery_source IS NULL
         OR cc.discovery_source != 'comment_harvest_IN'
         OR (
           COALESCE(cc.subscriber_count, 0) >= 2000
           AND COALESCE(cc.video_count, 0) >= 10
         )
       )
     ORDER BY
       _source_quality_rank DESC,
       _fresh_discovery DESC,
       _is_target_foreign DESC,
       _is_indian DESC,
       _graph_source DESC,
       _graph_source_rank DESC,
       _reference_like ASC,
       _creator_size_fit DESC,
       _has_promotable_size DESC,
       COALESCE(cc.subscriber_count, 0) DESC,
       cc.priority_score DESC
     LIMIT ?`,
    [limit],
  );
}

function normalizeGraphDiscoveryAdmissionState(db) {
  const info = db.run(
    `UPDATE corpus_channels
     SET last_ingested_at = NULL,
         updated_at = datetime('now')
     WHERE discovery_source IN (${GRAPH_DISCOVERY_SQL_LIST})
       AND ingest_depth < 1
       AND last_ingested_at IS NOT NULL`,
  );
  return { graph_channels_reset: info.changes ?? 0 };
}

// ── corpus_videos ─────────────────────────────────────────────────────────────

function upsertCorpusVideo(db, v) {
  const ageHours = v.published_at
    ? (Date.now() - new Date(v.published_at).getTime()) / 3_600_000
    : null;
  const vph = (ageHours && ageHours > 0 && v.views) ? v.views / ageHours : null;

  db.run(
    `INSERT INTO corpus_videos
       (video_id, channel_id, title, description, thumbnail_url, published_at,
        duration_seconds, views, likes, comments, vph, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(video_id) DO UPDATE SET
       views        = excluded.views,
       likes        = excluded.likes,
       comments     = excluded.comments,
       vph          = excluded.vph,
       refreshed_at = datetime('now')`,
    [
      v.video_id, v.channel_id, v.title, v.description ?? null,
      v.thumbnail_url ?? null, v.published_at ?? null,
      v.duration_seconds ?? null, v.views ?? 0, v.likes ?? 0,
      v.comments ?? 0, vph, v.raw_json ? JSON.stringify(v.raw_json) : null,
    ],
  );
}

function getCorpusVideosByChannel(db, channelId, limit = 100) {
  return db.all(
    'SELECT * FROM corpus_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT ?',
    [channelId, limit],
  );
}

function getCorpusVideoCount(db, channelId) {
  return db.get('SELECT COUNT(*) AS n FROM corpus_videos WHERE channel_id = ?', [channelId])?.n ?? 0;
}

function getCorpusVideosPendingEmbedding(db, limit = 200) {
  return db.all(
    `SELECT * FROM corpus_videos WHERE embedding_status = 'pending' ORDER BY ingested_at DESC LIMIT ?`,
    [limit],
  );
}

function updateCorpusVideoEmbeddingStatus(db, videoId, status) {
  db.run('UPDATE corpus_videos SET embedding_status = ? WHERE video_id = ?', [status, videoId]);
}

// ── corpus_quality_state ──────────────────────────────────────────────────────

function upsertCorpusQualityState(db, qs) {
  db.run(
    `INSERT INTO corpus_quality_state
       (channel_id, quality_score, semantic_consistency, engagement_authenticity,
        clickbait_score, performance_stability, title_quality, authority_score,
        sample_size, is_spam, is_ai_slop, is_unstable, flags_json,
        training_eligible, evaluated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       quality_score            = excluded.quality_score,
       semantic_consistency     = excluded.semantic_consistency,
       engagement_authenticity  = excluded.engagement_authenticity,
       clickbait_score          = excluded.clickbait_score,
       performance_stability    = excluded.performance_stability,
       title_quality            = excluded.title_quality,
       authority_score          = excluded.authority_score,
       sample_size              = excluded.sample_size,
       is_spam                  = excluded.is_spam,
       is_ai_slop               = excluded.is_ai_slop,
       is_unstable              = excluded.is_unstable,
       flags_json               = excluded.flags_json,
       training_eligible        = excluded.training_eligible,
       evaluated_at             = datetime('now')`,
    [
      qs.channel_id, qs.quality_score, qs.semantic_consistency,
      qs.engagement_authenticity, qs.clickbait_score, qs.performance_stability,
      qs.title_quality, qs.authority_score, qs.sample_size,
      qs.is_spam ? 1 : 0, qs.is_ai_slop ? 1 : 0, qs.is_unstable ? 1 : 0,
      JSON.stringify(qs.flags ?? []), qs.training_eligible ? 1 : 0,
    ],
  );
}

function getCorpusQualityState(db, channelId) {
  return db.get('SELECT * FROM corpus_quality_state WHERE channel_id = ?', [channelId]);
}

// ── corpus_discovery_graph ────────────────────────────────────────────────────

function upsertDiscoveryEdge(db, { source_channel_id, target_channel_id, relationship_type, confidence, discovered_via }) {
  db.run(
    `INSERT INTO corpus_discovery_graph
       (id, source_channel_id, target_channel_id, relationship_type, confidence, discovered_via)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(source_channel_id, target_channel_id, relationship_type) DO UPDATE SET
       confidence    = MAX(excluded.confidence, confidence),
       discovered_at = datetime('now')`,
    [
      crypto.randomUUID(), source_channel_id, target_channel_id,
      relationship_type, confidence ?? 0, discovered_via ?? null,
    ],
  );
}

function getDiscoveryNeighbors(db, channelId, limit = 20) {
  return db.all(
    `SELECT cdg.target_channel_id, cdg.relationship_type, cdg.confidence,
            cc.title, cc.niche, cc.subscriber_count
     FROM corpus_discovery_graph cdg
     LEFT JOIN corpus_channels cc ON cc.channel_id = cdg.target_channel_id
     WHERE cdg.source_channel_id = ?
     ORDER BY cdg.confidence DESC LIMIT ?`,
    [channelId, limit],
  );
}

function getDiscoveryGraphStats(db) {
  return {
    edges:    db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph')?.n ?? 0,
    channels: db.get('SELECT COUNT(DISTINCT source_channel_id) AS n FROM corpus_discovery_graph')?.n ?? 0,
  };
}

// ── corpus_embeddings_queue ───────────────────────────────────────────────────

function enqueueForEmbedding(db, { entity_type, entity_id, priority = 5 }) {
  db.run(
    `INSERT OR IGNORE INTO corpus_embeddings_queue (id, entity_type, entity_id, priority)
     VALUES (?,?,?,?)`,
    [crypto.randomUUID(), entity_type, entity_id, priority],
  );
}

function getNextEmbeddingBatch(db, limit = 50) {
  return db.all(
    `SELECT * FROM corpus_embeddings_queue
     WHERE status = 'pending' AND attempts < 3
     ORDER BY priority DESC, queued_at ASC LIMIT ?`,
    [limit],
  );
}

function markEmbeddingDone(db, id) {
  db.run(
    `UPDATE corpus_embeddings_queue SET status='done', processed_at=datetime('now') WHERE id=?`, [id],
  );
}

function markEmbeddingFailed(db, id, error) {
  db.run(
    `UPDATE corpus_embeddings_queue SET status='failed', attempts=attempts+1, error=? WHERE id=?`,
    [error, id],
  );
}

// ── corpus_refresh_schedule ───────────────────────────────────────────────────

function upsertRefreshSchedule(db, channelId, { priority = 5, stale_threshold_hours = 168 } = {}) {
  const next = new Date(Date.now() + stale_threshold_hours * 3_600_000).toISOString();
  db.run(
    `INSERT INTO corpus_refresh_schedule (channel_id, refresh_priority, next_refresh_at, stale_threshold_hours)
     VALUES (?,?,?,?)
     ON CONFLICT(channel_id) DO UPDATE SET
       refresh_priority      = excluded.refresh_priority,
       next_refresh_at       = excluded.next_refresh_at,
       stale_threshold_hours = excluded.stale_threshold_hours`,
    [channelId, priority, next, stale_threshold_hours],
  );
}

function getStaleChannels(db, limit = 30) {
  return db.all(
    `SELECT crs.channel_id, crs.refresh_priority, cc.niche, cc.subscriber_count
     FROM corpus_refresh_schedule crs
     LEFT JOIN corpus_channels cc ON cc.channel_id = crs.channel_id
     WHERE crs.next_refresh_at <= datetime('now')
     ORDER BY crs.refresh_priority DESC LIMIT ?`,
    [limit],
  );
}

function markRefreshed(db, channelId) {
  db.run(
    `UPDATE corpus_refresh_schedule SET
       last_refresh_at = datetime('now'),
       next_refresh_at = datetime('now', '+' || stale_threshold_hours || ' hours'),
       refresh_count   = refresh_count + 1
     WHERE channel_id = ?`,
    [channelId],
  );
}

// ── corpus stats ──────────────────────────────────────────────────────────────

function getCorpusStats(db) {
  const channels         = db.get('SELECT COUNT(*) AS n FROM corpus_channels')?.n ?? 0;
  const videos           = db.get('SELECT COUNT(*) AS n FROM corpus_videos')?.n ?? 0;
  const training         = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE training_eligible=1')?.n ?? 0;
  const spam             = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE is_spam=1')?.n ?? 0;
  const pendingQuality   = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE quality_score=0')?.n ?? 0;
  const pendingEmbedding = db.get(`SELECT COUNT(*) AS n FROM corpus_embeddings_queue WHERE status='pending'`)?.n ?? 0;
  const graphEdges       = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph')?.n ?? 0;
  const nicheBreakdown   = db.all(
    `SELECT niche, COUNT(*) AS n, AVG(quality_score) AS avg_quality,
            SUM(training_eligible) AS training_count
     FROM corpus_channels WHERE niche IS NOT NULL
     GROUP BY niche ORDER BY n DESC LIMIT 20`,
  );
  const qualityDist = db.all(
    `SELECT
       SUM(CASE WHEN quality_score >= 80 THEN 1 ELSE 0 END) AS high,
       SUM(CASE WHEN quality_score >= 60 AND quality_score < 80 THEN 1 ELSE 0 END) AS medium,
       SUM(CASE WHEN quality_score >= 40 AND quality_score < 60 THEN 1 ELSE 0 END) AS low,
       SUM(CASE WHEN quality_score < 40 THEN 1 ELSE 0 END) AS poor
     FROM corpus_channels`,
  );
  return { channels, videos, training, spam, pendingQuality, pendingEmbedding, graphEdges, nicheBreakdown, qualityDist: qualityDist[0] };
}

// ── auto-promotion: corpus_channels → ingested_channels ──────────────────────

function getAutoPromotionCandidates(db, { qualityThreshold = 60 } = {}) {
  return db.all(
    `SELECT cc.* FROM corpus_channels cc
     WHERE cc.training_eligible = 1
       AND cc.is_spam = 0
       AND cc.quality_score >= ?
       AND cc.niche IS NOT NULL
       AND cc.auto_promoted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ingested_channels ic WHERE ic.channel_id = cc.channel_id
       )
     ORDER BY cc.quality_score DESC`,
    [qualityThreshold],
  );
}

function markCorpusAutoPromoted(db, channelId) {
  db.run(
    `UPDATE corpus_channels SET auto_promoted_at = datetime('now') WHERE channel_id = ?`,
    [channelId],
  );
}

// ── migration: sync ingested_channels → corpus_channels ──────────────────────

function syncIngestedToCorpus(db) {
  const rows = db.all('SELECT * FROM ingested_channels');
  let synced = 0;
  for (const ic of rows) {
    const exists = db.get('SELECT 1 FROM corpus_channels WHERE channel_id = ?', [ic.channel_id]);
    if (!exists) {
      upsertCorpusChannel(db, {
        channel_id:          ic.channel_id,
        title:               ic.channel_name,
        uploads_playlist_id: ic.uploads_playlist_id,
        niche:               ic.niche,
        subscriber_count:    ic.channel_subscribers ?? 0,
        discovery_source:    'ingested_channels_sync',
      });
      synced++;
    }
  }
  return synced;
}

function getUnclassifiedCorpusChannels(db, limit = 100) {
  return db.all(
    `SELECT channel_id, title FROM corpus_channels
     WHERE niche IS NULL AND ingest_depth >= 1
     ORDER BY
       CASE WHEN discovery_source IN (${GRAPH_DISCOVERY_SQL_LIST}) THEN 1 ELSE 0 END DESC,
       subscriber_count DESC
     LIMIT ?`,
    [limit],
  );
}

function getCorpusVideoTitles(db, channelId, limit = 40) {
  const rows = db.all(
    `SELECT title FROM corpus_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT ?`,
    [channelId, limit],
  );
  return rows.map(r => r.title);
}

function updateCorpusChannelNiche(db, channelId, niche) {
  db.run(
    `UPDATE corpus_channels SET niche = ?, updated_at = datetime('now') WHERE channel_id = ?`,
    [niche, channelId],
  );
}

// ── Zero-quota: copy ingested_videos → corpus_videos for sync'd channels ────────

function migrateIngestedVideosToCorpus(db) {
  const channels = db.all(`
    SELECT cc.channel_id FROM corpus_channels cc
    WHERE cc.discovery_source = 'ingested_channels_sync'
      AND cc.ingest_depth < 1
      AND EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = cc.channel_id)
  `);

  if (channels.length === 0) return { channels_migrated: 0, videos_copied: 0 };

  let copied = 0;
  db.run('BEGIN');
  try {
    for (const { channel_id } of channels) {
      const videos = db.all(
        `SELECT youtube_video_id, channel_id, title, description, published_at,
                duration_seconds, views, likes, comments
         FROM ingested_videos WHERE channel_id = ? LIMIT 50`,
        [channel_id],
      );
      for (const v of videos) {
        if (!v.youtube_video_id) continue;
        const ageHours = v.published_at
          ? (Date.now() - new Date(v.published_at).getTime()) / 3_600_000
          : null;
        const vph = ageHours && ageHours > 0 && v.views ? v.views / ageHours : null;
        db.run(
          `INSERT OR IGNORE INTO corpus_videos
             (video_id, channel_id, title, description, published_at,
              duration_seconds, views, likes, comments, vph, ingested_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
          [v.youtube_video_id, channel_id, v.title ?? '', v.description ?? null,
           v.published_at ?? null, v.duration_seconds ?? null,
           v.views ?? 0, v.likes ?? 0, v.comments ?? 0, vph ?? null],
        );
        copied++;
      }
      db.run(
        `UPDATE corpus_channels SET ingest_depth = 2, last_ingested_at = datetime('now')
         WHERE channel_id = ?`,
        [channel_id],
      );
    }
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  return { channels_migrated: channels.length, videos_copied: copied };
}

function updateCorpusChannelLanguageProfile(db, channelId, languageProfile) {
  db.run(
    `UPDATE corpus_channels SET language_profile = ?, updated_at = datetime('now') WHERE channel_id = ?`,
    [JSON.stringify(languageProfile), channelId],
  );
}

// ── channel_events ────────────────────────────────────────────────────────────

function logChannelEvent(db, channelId, eventType, eventData = {}) {
  db.run(
    `INSERT INTO channel_events (channel_id, event_type, event_data, recorded_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [channelId, eventType, JSON.stringify(eventData)],
  );
}

// ── discovery_provenance ──────────────────────────────────────────────────────

function logDiscoveryProvenance(db, channelId, { discovery_source, source_channel_id = null, search_query = null, search_language = null, search_region = null, quality_at_entry = null } = {}) {
  db.run(
    `INSERT INTO discovery_provenance
       (channel_id, discovery_source, source_channel_id, search_query, search_language, search_region, quality_at_entry, discovered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(channel_id) DO NOTHING`,
    [channelId, discovery_source ?? 'unknown', source_channel_id, search_query, search_language, search_region, quality_at_entry],
  );
}

// ── creator_edges ─────────────────────────────────────────────────────────────

function logCreatorEdge(db, sourceChannel, targetChannel, edgeType, weight = 0.5) {
  db.run(
    `INSERT INTO creator_edges (source_channel, target_channel, edge_type, weight, observed_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source_channel, target_channel, edge_type) DO UPDATE SET
       weight      = MAX(excluded.weight, weight),
       observed_at = datetime('now')`,
    [sourceChannel, targetChannel, edgeType, weight],
  );
}

module.exports = {
  upsertCorpusChannel, getCorpusChannel, getCorpusChannelByHandle,
  updateCorpusChannelQuality, updateCorpusChannelSemanticStatus,
  updateCorpusChannelPriority, promoteCorpusChannelTraining,
  demoteCorpusChannelTraining, getAllCorpusChannels, countCorpusChannels,
  getCorpusChannelsForQualityEval, getCorpusChannelsForLightIngest,
  normalizeGraphDiscoveryAdmissionState,
  upsertCorpusVideo, getCorpusVideosByChannel, getCorpusVideoCount,
  getCorpusVideosPendingEmbedding, updateCorpusVideoEmbeddingStatus,
  upsertCorpusQualityState, getCorpusQualityState,
  upsertDiscoveryEdge, getDiscoveryNeighbors, getDiscoveryGraphStats,
  enqueueForEmbedding, getNextEmbeddingBatch, markEmbeddingDone, markEmbeddingFailed,
  upsertRefreshSchedule, getStaleChannels, markRefreshed,
  getCorpusStats, syncIngestedToCorpus,
  getAutoPromotionCandidates, markCorpusAutoPromoted,
  getUnclassifiedCorpusChannels, getCorpusVideoTitles, updateCorpusChannelNiche,
  migrateIngestedVideosToCorpus,
  logChannelEvent, logDiscoveryProvenance, logCreatorEdge,
  updateCorpusChannelLanguageProfile,
};
