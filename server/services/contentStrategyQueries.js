const cache = require('./queryCache');

const DURATION_SQL = `
  CASE
    WHEN duration_seconds < 180  THEN 'short'
    WHEN duration_seconds < 600  THEN 'mid'
    WHEN duration_seconds < 1200 THEN 'long'
    ELSE 'longform'
  END
`;

function getTopTitlesByNiche(db, { niche, days = 90, limit = 30 } = {}) {
  const key = `content:top_titles:${niche}:${days}:${limit}`;
  return cache.wrap(key, () => {
    const conditions = [`iv.published_at >= datetime('now', '-${days} days')`];
    const params = [];
    if (niche) { conditions.push('iv.niche = ?'); params.push(niche); }
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
        ic.content_archetype,
        ic.format_type
      FROM ingested_videos iv
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY iv.views DESC NULLS LAST
      LIMIT ?
    `, params);
  }, 20 * 60 * 1000);
}

function getBestPerformingDurations(db, niche) {
  const key = `content:best_durations:${niche}`;
  return cache.wrap(key, () => {
    const conditions = ['iv.duration_seconds IS NOT NULL', 'iv.views IS NOT NULL'];
    const params = [];
    if (niche) { conditions.push('iv.niche = ?'); params.push(niche); }

    return db.all(`
      SELECT
        (${DURATION_SQL})              AS duration_bucket,
        COUNT(*)                       AS video_count,
        CAST(AVG(iv.views) AS INTEGER) AS avg_views,
        CAST(MAX(iv.views) AS INTEGER) AS peak_views
      FROM ingested_videos iv
      WHERE ${conditions.join(' AND ')}
      GROUP BY duration_bucket
      ORDER BY avg_views DESC
    `, params);
  }, 20 * 60 * 1000);
}

function getRisingFormats(db, niche) {
  const key = `content:rising_formats:${niche}`;
  return cache.wrap(key, () => {
    const conditions = [`ic.content_archetype IS NOT NULL`];
    const params = [];
    if (niche) { conditions.push('COALESCE(ic.primary_niche, ic.niche) = ?'); params.push(niche); }

    // Compare last 30d vs prior 30d for each archetype
    return db.all(`
      SELECT
        ic.content_archetype,
        ic.format_type,
        COUNT(CASE WHEN iv.published_at >= datetime('now', '-30 days') THEN 1 END) AS recent_count,
        COUNT(CASE WHEN iv.published_at >= datetime('now', '-60 days')
                    AND iv.published_at < datetime('now', '-30 days') THEN 1 END)  AS prior_count,
        CAST(AVG(CASE WHEN iv.published_at >= datetime('now', '-30 days') THEN iv.views END) AS INTEGER) AS recent_avg_views,
        CAST(AVG(CASE WHEN iv.published_at >= datetime('now', '-60 days')
                       AND iv.published_at < datetime('now', '-30 days') THEN iv.views END) AS INTEGER) AS prior_avg_views
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE ${conditions.join(' AND ')}
        AND iv.published_at >= datetime('now', '-60 days')
      GROUP BY ic.content_archetype, ic.format_type
      HAVING recent_count >= 2
      ORDER BY recent_count DESC
    `, params);
  }, 20 * 60 * 1000);
}

function getContentPatterns(db, niche) {
  const key = `content:patterns:${niche}`;
  return cache.wrap(key, () => {
    // Drive from ingested_channels (small set, idx_ic_primary_niche), then use
    // idx_iv_channel_published per channel. VGS join removed — avg_vph not used
    // by the dashboard. OR condition lets SQLite use idx_ic_primary_niche + idx_ic_niche.
    const where = niche
      ? `WHERE (ic.primary_niche = ? OR (ic.primary_niche IS NULL AND ic.niche = ?))`
      : '';
    const params = niche ? [niche, niche] : [];

    return db.all(`
      SELECT
        ic.content_archetype,
        ic.format_type,
        ic.behavior_tags,
        COALESCE(ic.primary_niche, ic.niche) AS niche,
        COUNT(iv.youtube_video_id)         AS video_count,
        CAST(AVG(iv.views) AS INTEGER)     AS avg_views,
        CAST(MAX(iv.views) AS INTEGER)     AS peak_views,
        COUNT(DISTINCT ic.channel_id)      AS channel_count
      FROM ingested_channels ic
      JOIN ingested_videos iv
        ON iv.channel_id = ic.channel_id
        AND iv.views IS NOT NULL
        AND iv.published_at >= datetime('now', '-90 days')
      ${where}
      GROUP BY ic.content_archetype, ic.format_type, COALESCE(ic.primary_niche, ic.niche)
      HAVING video_count >= 2
      ORDER BY avg_views DESC
      LIMIT 50
    `, params);
  }, 20 * 60 * 1000);
}

module.exports = {
  getTopTitlesByNiche,
  getBestPerformingDurations,
  getRisingFormats,
  getContentPatterns,
};
