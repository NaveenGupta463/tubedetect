const cache = require('./queryCache');

const DURATION_SQL = `
  CASE
    WHEN duration_seconds < 180  THEN 'short'
    WHEN duration_seconds < 600  THEN 'mid'
    WHEN duration_seconds < 1200 THEN 'long'
    ELSE 'longform'
  END
`;

function getTopChannelsByNiche(db, { niche, limit = 20 } = {}) {
  const key = `competitor:top_channels:${niche}:${limit}`;
  return cache.wrap(key, () => {
    const where = niche ? `WHERE ic.niche = ?` : '';
    const params = niche ? [limit] : [limit];
    if (niche) params.unshift(niche);
    return db.all(`
      SELECT
        ic.id,
        ic.channel_id,
        ic.channel_name,
        ic.niche,
        ic.niche_override,
        ic.channel_subscribers,
        ic.content_archetype,
        ic.format_type,
        ic.behavior_tags,
        ic.audience_style,
        ic.identity_source,
        COUNT(iv.youtube_video_id)               AS video_count,
        MAX(iv.views)                            AS peak_views,
        CAST(AVG(iv.views) AS INTEGER)           AS avg_views,
        CAST(AVG(iv.likes) AS INTEGER)           AS avg_likes,
        MAX(iv.published_at)                     AS latest_video_at
      FROM ingested_channels ic
      LEFT JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
      ${where}
      GROUP BY ic.channel_id
      ORDER BY avg_views DESC NULLS LAST
      LIMIT ?
    `, params);
  }, 5 * 60 * 1000);
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
  }, 5 * 60 * 1000);
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
  }, 5 * 60 * 1000);
}

function getUploadFrequency(db, niche) {
  const key = `competitor:upload_freq:${niche}`;
  return cache.wrap(key, () => {
    const where = niche ? `WHERE ic.niche = ?` : '';
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
  }, 5 * 60 * 1000);
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
  }, 5 * 60 * 1000);
}

module.exports = {
  getTopChannelsByNiche,
  getTopVideosByViews,
  getTopVideosByVelocity,
  getUploadFrequency,
  getFormatBreakdown,
};
