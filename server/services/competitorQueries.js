const cache = require('./queryCache');

const DURATION_SQL = `
  CASE
    WHEN duration_seconds < 180  THEN 'short'
    WHEN duration_seconds < 600  THEN 'mid'
    WHEN duration_seconds < 1200 THEN 'long'
    ELSE 'longform'
  END
`;

function getTopChannelsByNiche(db, { niche, language, community_id, limit = 20 } = {}) {
  const key = `competitor:top_channels:${niche}:${community_id}:${language}:${limit}`;
  return cache.wrap(key, () => {
    // Step 1: get top channels by subscribers — cheap index scan, no video join.
    // Fetch 3× limit so we have candidates to re-rank by avg_views in step 2.
    const conditions = ['(ic.ignore_from_benchmarks IS NULL OR ic.ignore_from_benchmarks = 0)'];
    const params = [];
    if (niche) { conditions.push('COALESCE(ic.primary_niche, ic.niche) = ?'); params.push(niche); }
    if (community_id) {
      conditions.push('COALESCE(ic.community_id, cc.community_id) = ?');
      params.push(community_id);
    } else if (language) {
      conditions.push("COALESCE(ic.primary_language, cc.language, 'en') = ?");
      params.push(language);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const candidateLimit = Math.min(limit * 3, 600);
    params.push(candidateLimit);

    const candidates = db.all(`
      SELECT
        ic.id, ic.channel_id, ic.channel_name, ic.niche, ic.niche_override,
        ic.channel_subscribers, ic.content_archetype, ic.format_type,
        ic.behavior_tags, ic.audience_style, ic.identity_source
      FROM ingested_channels ic
      LEFT JOIN corpus_channels cc ON cc.channel_id = ic.channel_id
      ${where}
      ORDER BY ic.channel_subscribers DESC NULLS LAST
      LIMIT ?
    `, params);

    if (!candidates.length) return [];

    // Step 2: aggregate video stats only for those candidates — tiny result set.
    const ids = candidates.map(c => c.channel_id);
    const ph  = ids.map(() => '?').join(',');
    const statsRows = db.all(`
      SELECT channel_id,
             COUNT(youtube_video_id)        AS video_count,
             MAX(views)                     AS peak_views,
             CAST(AVG(views) AS INTEGER)    AS avg_views,
             CAST(AVG(likes) AS INTEGER)    AS avg_likes,
             CAST(AVG(comments) AS INTEGER) AS avg_comments,
             MAX(published_at)              AS latest_video_at
      FROM ingested_videos
      WHERE channel_id IN (${ph})
      GROUP BY channel_id
    `, ids);

    const statsMap = {};
    for (const s of statsRows) statsMap[s.channel_id] = s;

    const merged = candidates.map(c => ({
      ...c,
      video_count:     statsMap[c.channel_id]?.video_count     ?? 0,
      peak_views:      statsMap[c.channel_id]?.peak_views      ?? null,
      avg_views:       statsMap[c.channel_id]?.avg_views       ?? null,
      avg_likes:       statsMap[c.channel_id]?.avg_likes       ?? null,
      avg_comments:    statsMap[c.channel_id]?.avg_comments    ?? null,
      latest_video_at: statsMap[c.channel_id]?.latest_video_at ?? null,
    }));

    // Re-rank by avg_views (same as original ORDER BY), then trim to requested limit.
    merged.sort((a, b) => (b.avg_views ?? -1) - (a.avg_views ?? -1));
    return merged.slice(0, limit);
  }, 20 * 60 * 1000);
}

function getTopVideosByViews(db, { niche, duration, days, limit = 50 } = {}) {
  const key = `competitor:top_views:${niche}:${duration}:${days}:${limit}`;
  return cache.wrap(key, () => {
    const conditions = [];
    const params = [];

    if (niche) { conditions.push('iv.niche = ?'); params.push(niche); }
    if (duration) { conditions.push(`(${DURATION_SQL}) = ?`); params.push(duration); }
    if (days) {
      conditions.push(`iv.published_at >= datetime('now', ?)`)
      params.push(`-${days} days`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    return db.all(`
      SELECT
        iv.youtube_video_id,
        iv.title,
        iv.channel_id,
        ic.channel_name,
        iv.niche,
        iv.views,
        iv.likes,
        iv.comments,
        iv.published_at,
        iv.duration_seconds,
        (${DURATION_SQL}) AS duration_bucket,
        ic.content_archetype,
        ic.format_type
      FROM ingested_videos iv
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      ${where}
      ORDER BY iv.views DESC NULLS LAST
      LIMIT ?
    `, params);
  }, 20 * 60 * 1000);
}

function getTopVideosByVelocity(db, { niche, duration, limit = 50 } = {}) {
  const key = `competitor:top_velocity:${niche}:${duration}:${limit}`;
  return cache.wrap(key, () => {
    const conditions = [`vgs.bucket = '7d'`];
    const params = [];

    if (niche) { conditions.push('iv.niche = ?'); params.push(niche); }
    if (duration) { conditions.push(`(${DURATION_SQL}) = ?`); params.push(duration); }

    params.push(limit);

    return db.all(`
      SELECT
        iv.youtube_video_id,
        iv.title,
        iv.channel_id,
        ic.channel_name,
        iv.niche,
        iv.views,
        iv.published_at,
        iv.duration_seconds,
        (${DURATION_SQL}) AS duration_bucket,
        vgs.views_per_hour,
        vgs.subscriber_adjusted_velocity,
        vgs.views_to_subscriber_ratio,
        ic.content_archetype,
        ic.format_type
      FROM ingested_videos iv
      JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY vgs.views_per_hour DESC NULLS LAST
      LIMIT ?
    `, params);
  }, 20 * 60 * 1000);
}

function getUploadFrequency(db, niche) {
  const key = `competitor:upload_freq:${niche}`;
  return cache.wrap(key, () => {
    const where = niche ? `WHERE COALESCE(ic.primary_niche, ic.niche) = ?` : '';
    const params = niche ? [niche] : [];
    return db.all(`
      SELECT
        ic.channel_id,
        ic.channel_name,
        ic.niche,
        COUNT(iv.youtube_video_id) AS videos_90d,
        ROUND(COUNT(iv.youtube_video_id) / 12.857, 2) AS videos_per_week
      FROM ingested_channels ic
      JOIN ingested_videos iv
        ON iv.channel_id = ic.channel_id
        AND iv.published_at >= datetime('now', '-90 days')
      ${where}
      GROUP BY ic.channel_id
      ORDER BY videos_90d DESC
    `, params);
  }, 20 * 60 * 1000);
}

function getFormatBreakdown(db, niche) {
  const key = `competitor:format_breakdown:${niche}`;
  return cache.wrap(key, () => {
    const conditions = [`ic.format_type IS NOT NULL`];
    const params = [];
    if (niche) { conditions.push('iv.niche = ?'); params.push(niche); }

    return db.all(`
      SELECT
        ic.format_type,
        ic.content_archetype,
        COUNT(iv.youtube_video_id)           AS video_count,
        CAST(AVG(iv.views) AS INTEGER)       AS avg_views,
        ROUND(AVG(vgs.views_per_hour), 2)    AS avg_vph
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      LEFT JOIN video_growth_snapshots vgs
        ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
      WHERE ${conditions.join(' AND ')}
      GROUP BY ic.format_type, ic.content_archetype
      ORDER BY avg_views DESC
    `, params);
  }, 20 * 60 * 1000);
}

module.exports = {
  getTopChannelsByNiche,
  getTopVideosByViews,
  getTopVideosByVelocity,
  getUploadFrequency,
  getFormatBreakdown,
};
