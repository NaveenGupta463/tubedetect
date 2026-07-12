function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function getThumbnailFromRaw(rawJson) {
  const raw = parseJson(rawJson, {});
  return raw?.snippet?.thumbnails?.medium?.url
    || raw?.snippet?.thumbnails?.high?.url
    || raw?.snippet?.thumbnails?.default?.url
    || null;
}

function getHandleFromRaw(rawJson) {
  const raw = parseJson(rawJson, {});
  return raw?.snippet?.customUrl || raw?.snippet?.custom_url || null;
}

function readChannelRuntimeSummary(db, channelId) {
  const row = db.get(`SELECT * FROM channel_runtime_summary WHERE channel_id = ?`, [channelId]);
  if (!row) return null;
  return {
    ...row,
    top_territories: parseJson(row.top_territories_json, []),
    summary: parseJson(row.summary_json, {}),
    source_versions: parseJson(row.source_versions_json, {}),
  };
}

function buildChannelRuntimeSummary(db, channelId) {
  const channel = db.get(
    `SELECT *
     FROM ingested_channels
     WHERE channel_id = ?`,
    [channelId],
  );
  if (!channel) return null;

  const cache = db.get(
    `SELECT handle, title, raw_json, subscriber_count
     FROM channel_cache
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const corpus = db.get(
    `SELECT title, handle, thumbnail_url, subscriber_count, video_count, total_views, language, country
     FROM corpus_channels
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const csp = db.get(
    `SELECT primary_csp, confidence, confidence_score, secondary_csp_1, secondary_csp_2, classified_at
     FROM channel_content_strategy_profiles
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const dna = db.get(
    `SELECT confidence, confidence_score, drift_status, drift_score, sample_count,
            long_count, short_count, last_video_published_at, updated_at
     FROM creator_idea_dna
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const wtpCache = db.get(
    `SELECT status, computed_at, expires_at, refresh_reason
     FROM channel_wtp_cache
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const videoStats = db.get(
    `SELECT COUNT(*) AS video_count,
            SUM(CASE WHEN COALESCE(is_short, 0) = 1 THEN 1 ELSE 0 END) AS shorts_count,
            SUM(CASE WHEN COALESCE(is_short, 0) = 0 THEN 1 ELSE 0 END) AS long_count,
            SUM(CASE WHEN published_at >= datetime('now', '-90 days') THEN 1 ELSE 0 END) AS recent_video_count,
            MAX(published_at) AS latest_video_published_at,
            MAX(views) AS max_views,
            AVG(CASE WHEN views IS NOT NULL THEN views ELSE NULL END) AS avg_views
     FROM ingested_videos
     WHERE channel_id = ?`,
    [channelId],
  ) || {};
  const territories = db.all(
    `SELECT territory_id, role, confidence, video_count, recent_video_count, view_lift
     FROM channel_territory_profiles
     WHERE channel_id = ?
     ORDER BY
       CASE role WHEN 'core' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
       video_count DESC,
       territory_id ASC
     LIMIT 8`,
    [channelId],
  );

  const thumbnailUrl = corpus.thumbnail_url || getThumbnailFromRaw(cache.raw_json);
  const handle = corpus.handle || cache.handle || getHandleFromRaw(cache.raw_json);
  const subscriberCount = channel.channel_subscribers || cache.subscriber_count || corpus.subscriber_count || 0;
  const videoCount = videoStats.video_count || corpus.video_count || 0;
  const latestVideoAt = videoStats.latest_video_published_at || dna.last_video_published_at || null;

  return {
    channel_id: channelId,
    channel_name: channel.channel_name || cache.title || corpus.title || channelId,
    handle: handle || null,
    thumbnail_url: thumbnailUrl || null,
    subscriber_count: subscriberCount,
    niche: channel.niche || corpus.niche || null,
    primary_niche: channel.primary_niche || channel.niche || null,
    community_id: channel.community_id || corpus.community_id || null,
    primary_language: channel.primary_language || corpus.language || null,
    region: channel.region || corpus.country || null,
    content_language: channel.content_language || null,
    audience_geo: channel.audience_geo || null,
    format_profile: channel.format_profile || null,
    routing_profile: channel.routing_profile || null,
    creator_mode: channel.creator_mode || null,
    primary_csp: csp.primary_csp || null,
    csp_confidence: csp.confidence || null,
    csp_confidence_score: csp.confidence_score || null,
    dna_confidence: dna.confidence || null,
    dna_confidence_score: dna.confidence_score || null,
    dna_drift_status: dna.drift_status || null,
    dna_drift_score: dna.drift_score || null,
    dna_updated_at: dna.updated_at || null,
    territory_count: territories.length,
    top_territories: territories,
    video_count: videoCount,
    recent_video_count: videoStats.recent_video_count || 0,
    shorts_count: videoStats.shorts_count || dna.short_count || 0,
    long_count: videoStats.long_count || dna.long_count || 0,
    latest_video_published_at: latestVideoAt,
    max_views: videoStats.max_views || 0,
    avg_views: videoStats.avg_views || 0,
    wtp_cache_status: wtpCache.status || null,
    wtp_cache_computed_at: wtpCache.computed_at || null,
    wtp_cache_expires_at: wtpCache.expires_at || null,
    summary: {
      csp_secondary: [csp.secondary_csp_1, csp.secondary_csp_2].filter(Boolean),
      dna_sample_count: dna.sample_count || 0,
      wtp_refresh_reason: wtpCache.refresh_reason || null,
    },
    source_versions: {
      summary_version: 1,
      csp_classified_at: csp.classified_at || null,
      dna_updated_at: dna.updated_at || null,
    },
  };
}

function saveChannelRuntimeSummary(db, summary) {
  if (!summary?.channel_id) throw new Error('channel_id required for channel runtime summary');
  db.run(
    `INSERT INTO channel_runtime_summary
       (channel_id, channel_name, handle, thumbnail_url, subscriber_count, niche, primary_niche,
        community_id, primary_language, region, content_language, audience_geo,
        format_profile, routing_profile, creator_mode, primary_csp, csp_confidence,
        csp_confidence_score, dna_confidence, dna_confidence_score, dna_drift_status,
        dna_drift_score, dna_updated_at, territory_count, top_territories_json,
        video_count, recent_video_count, shorts_count, long_count, latest_video_published_at,
        max_views, avg_views, wtp_cache_status, wtp_cache_computed_at, wtp_cache_expires_at,
        summary_json, source_versions_json, computed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(channel_id) DO UPDATE SET
       channel_name = excluded.channel_name,
       handle = excluded.handle,
       thumbnail_url = excluded.thumbnail_url,
       subscriber_count = excluded.subscriber_count,
       niche = excluded.niche,
       primary_niche = excluded.primary_niche,
       community_id = excluded.community_id,
       primary_language = excluded.primary_language,
       region = excluded.region,
       content_language = excluded.content_language,
       audience_geo = excluded.audience_geo,
       format_profile = excluded.format_profile,
       routing_profile = excluded.routing_profile,
       creator_mode = excluded.creator_mode,
       primary_csp = excluded.primary_csp,
       csp_confidence = excluded.csp_confidence,
       csp_confidence_score = excluded.csp_confidence_score,
       dna_confidence = excluded.dna_confidence,
       dna_confidence_score = excluded.dna_confidence_score,
       dna_drift_status = excluded.dna_drift_status,
       dna_drift_score = excluded.dna_drift_score,
       dna_updated_at = excluded.dna_updated_at,
       territory_count = excluded.territory_count,
       top_territories_json = excluded.top_territories_json,
       video_count = excluded.video_count,
       recent_video_count = excluded.recent_video_count,
       shorts_count = excluded.shorts_count,
       long_count = excluded.long_count,
       latest_video_published_at = excluded.latest_video_published_at,
       max_views = excluded.max_views,
       avg_views = excluded.avg_views,
       wtp_cache_status = excluded.wtp_cache_status,
       wtp_cache_computed_at = excluded.wtp_cache_computed_at,
       wtp_cache_expires_at = excluded.wtp_cache_expires_at,
       summary_json = excluded.summary_json,
       source_versions_json = excluded.source_versions_json,
       computed_at = datetime('now'),
       updated_at = datetime('now')`,
    [
      summary.channel_id,
      summary.channel_name,
      summary.handle,
      summary.thumbnail_url,
      summary.subscriber_count,
      summary.niche,
      summary.primary_niche,
      summary.community_id,
      summary.primary_language,
      summary.region,
      summary.content_language,
      summary.audience_geo,
      summary.format_profile,
      summary.routing_profile,
      summary.creator_mode,
      summary.primary_csp,
      summary.csp_confidence,
      summary.csp_confidence_score,
      summary.dna_confidence,
      summary.dna_confidence_score,
      summary.dna_drift_status,
      summary.dna_drift_score,
      summary.dna_updated_at,
      summary.territory_count || 0,
      JSON.stringify(summary.top_territories || []),
      summary.video_count || 0,
      summary.recent_video_count || 0,
      summary.shorts_count || 0,
      summary.long_count || 0,
      summary.latest_video_published_at,
      summary.max_views || 0,
      summary.avg_views || 0,
      summary.wtp_cache_status,
      summary.wtp_cache_computed_at,
      summary.wtp_cache_expires_at,
      JSON.stringify(summary.summary || {}),
      JSON.stringify(summary.source_versions || {}),
    ],
  );
  return readChannelRuntimeSummary(db, summary.channel_id);
}

function buildAndSaveChannelRuntimeSummary(db, channelId) {
  const summary = buildChannelRuntimeSummary(db, channelId);
  if (!summary) return null;
  return saveChannelRuntimeSummary(db, summary);
}

function summaryToSyntheticChannel(summary) {
  return {
    id: summary.channel_id,
    snippet: {
      title: summary.channel_name || summary.channel_id,
      description: '',
      customUrl: summary.handle || '',
      publishedAt: '',
      thumbnails: {
        default: { url: summary.thumbnail_url || '' },
        medium: { url: summary.thumbnail_url || '' },
        high: { url: summary.thumbnail_url || '' },
      },
    },
    statistics: {
      subscriberCount: String(summary.subscriber_count || 0),
      videoCount: String(summary.video_count || 0),
      viewCount: '0',
      hiddenSubscriberCount: false,
    },
    contentDetails: {
      relatedPlaylists: { uploads: '' },
    },
    brandingSettings: { channel: {}, image: {} },
  };
}

module.exports = {
  readChannelRuntimeSummary,
  buildChannelRuntimeSummary,
  saveChannelRuntimeSummary,
  buildAndSaveChannelRuntimeSummary,
  summaryToSyntheticChannel,
};
