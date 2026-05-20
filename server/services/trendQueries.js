const cache = require('./queryCache');

function getAccelerationSpikes(db, { niche, limit = 30 } = {}) {
  const key = `trends:accel_spikes:${niche}:${limit}`;
  return cache.wrap(key, () => {
    const conditions = [
      `vgs.bucket = '7d'`,
      `vgs.velocity_acceleration IS NOT NULL`,
      `vgs.velocity_acceleration > 0`,
    ];
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
        vgs.views_per_hour,
        vgs.velocity_acceleration,
        vgs.subscriber_adjusted_velocity,
        ic.content_archetype,
        ic.format_type
      FROM video_growth_snapshots vgs
      JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY vgs.velocity_acceleration DESC
      LIMIT ?
    `, params);
  }, 5 * 60 * 1000);
}

function getBreakoutVideos(db, { niche, days = 14, limit = 20 } = {}) {
  const key = `trends:breakout:${niche}:${days}:${limit}`;
  return cache.wrap(key, () => {
    // Videos published in `days` window whose VPH beats p75 benchmark for their niche+duration
    const conditions = [
      `vgs.bucket = '7d'`,
      `iv.published_at >= datetime('now', '-${days} days')`,
    ];
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
        vgs.views_per_hour,
        vgs.subscriber_adjusted_velocity,
        nb.p75_vph AS benchmark_p75_vph,
        CASE WHEN vgs.views_per_hour > nb.p75_vph THEN 1 ELSE 0 END AS beats_p75,
        ic.content_archetype,
        ic.format_type
      FROM ingested_videos iv
      JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
      LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      LEFT JOIN niche_benchmarks nb
        ON nb.niche = iv.niche
        AND nb.bucket = '7d'
        AND nb.duration_bucket = CASE
          WHEN iv.duration_seconds < 180  THEN 'short'
          WHEN iv.duration_seconds < 600  THEN 'mid'
          WHEN iv.duration_seconds < 1200 THEN 'long'
          ELSE 'longform'
        END
      WHERE ${conditions.join(' AND ')}
        AND (nb.p75_vph IS NULL OR vgs.views_per_hour > nb.p75_vph)
      ORDER BY vgs.views_per_hour DESC
      LIMIT ?
    `, params);
  }, 5 * 60 * 1000);
}

function getBenchmarkDrift(db, niche) {
  const key = `trends:bench_drift:${niche}`;
  return cache.wrap(key, () => {
    const conditions = [`nbh.bucket = '7d'`];
    const params = [];
    if (niche) { conditions.push('nbh.niche = ?'); params.push(niche); }

    // Last 8 snapshots per niche+duration_bucket to show trend direction
    return db.all(`
      SELECT
        nbh.niche,
        nbh.duration_bucket,
        nbh.snapshot_at,
        nbh.median_vph,
        nbh.p75_vph,
        nbh.p90_vph,
        nbh.sample_size,
        nb.median_vph AS current_median_vph,
        nb.p75_vph    AS current_p75_vph
      FROM niche_benchmark_history nbh
      LEFT JOIN niche_benchmarks nb
        ON nb.niche = nbh.niche
        AND nb.bucket = nbh.bucket
        AND nb.duration_bucket = nbh.duration_bucket
      WHERE ${conditions.join(' AND ')}
      ORDER BY nbh.niche, nbh.duration_bucket, nbh.snapshot_at DESC
      LIMIT 200
    `, params);
  }, 10 * 60 * 1000);
}

function getRisingArchetypes(db, niche) {
  const key = `trends:rising_archetypes:${niche}`;
  return cache.wrap(key, () => {
    const conditions = [
      `ic.content_archetype IS NOT NULL`,
      `iv.published_at >= datetime('now', '-60 days')`,
    ];
    const params = [];
    if (niche) { conditions.push('COALESCE(ic.primary_niche, ic.niche) = ?'); params.push(niche); }

    return db.all(`
      SELECT
        ic.content_archetype,
        ic.format_type,
        COUNT(CASE WHEN iv.published_at >= datetime('now', '-30 days') THEN 1 END) AS recent_30d,
        COUNT(CASE WHEN iv.published_at < datetime('now', '-30 days') THEN 1 END)  AS prior_30d,
        CAST(AVG(CASE WHEN iv.published_at >= datetime('now', '-30 days') THEN iv.views END) AS INTEGER) AS recent_avg_views,
        ROUND(AVG(vgs.views_per_hour), 2) AS avg_vph
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      LEFT JOIN video_growth_snapshots vgs
        ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
      WHERE ${conditions.join(' AND ')}
      GROUP BY ic.content_archetype, ic.format_type
      HAVING recent_30d >= 1
      ORDER BY recent_30d DESC
    `, params);
  }, 5 * 60 * 1000);
}

module.exports = {
  getAccelerationSpikes,
  getBreakoutVideos,
  getBenchmarkDrift,
  getRisingArchetypes,
};
