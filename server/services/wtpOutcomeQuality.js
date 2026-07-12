'use strict';

// WTP Outcome Quality — compute whether a matched video actually outperformed
// the creator's baseline. This is the signal that answers "did this recommendation work?"
//
// Pipeline per matched video:
//   1. Fetch views_7d, views_30d from video_growth_snapshots
//   2. Compute channel_baseline_views (median views_7d of creator's last 30 videos)
//   3. Compute relative_lift = views_7d / channel_baseline_views
//   4. Classify outcome_class (breakout / above_average / average / below_average / failed)
//   5. Compute percentile_vs_channel (how this video ranks in creator's own catalog)
//   6. Compute percentile_vs_source  (how this video ranks against all outcomes in same rec_source)
//   7. Upsert into wtp_outcomes + update wtp_video_matches

// ── Thresholds ────────────────────────────────────────────────────────────────
// All thresholds are multiples of the creator's own baseline.
// Using relative metrics makes the system size-agnostic: a 10K-sub channel
// and a 1M-sub channel are both evaluated against their own norms.

const OUTCOME_THRESHOLDS = {
  breakout:      3.0,   // 3× channel baseline — genuinely viral for this creator
  above_average: 1.5,   // 50%+ above channel average
  average:       0.6,   // within 40% of channel average (normal variance)
  below_average: 0.15,  // significantly underperformed
  // < 0.15 → 'failed'
};

function classifyOutcome(relativeLift) {
  if (relativeLift == null)                             return 'unscored';
  if (relativeLift >= OUTCOME_THRESHOLDS.breakout)      return 'breakout';
  if (relativeLift >= OUTCOME_THRESHOLDS.above_average) return 'above_average';
  if (relativeLift >= OUTCOME_THRESHOLDS.average)       return 'average';
  if (relativeLift >= OUTCOME_THRESHOLDS.below_average) return 'below_average';
  return 'failed';
}

// ── Statistics helpers ────────────────────────────────────────────────────────

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentileOf(values, target) {
  if (!values.length || target == null) return null;
  const below = values.filter(v => v < target).length;
  return Math.round((below / values.length) * 100);
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

// views_7d and views_30d for a video from video_growth_snapshots.
function getVideoSnapshots(db, videoId) {
  const rows = db.all(
    `SELECT bucket, views
     FROM video_growth_snapshots
     WHERE video_id = ? AND bucket IN ('7d', '30d') AND views IS NOT NULL`,
    [videoId],
  );
  const out = { views_7d: null, views_30d: null };
  for (const r of rows) {
    if (r.bucket === '7d')  out.views_7d  = r.views;
    if (r.bucket === '30d') out.views_30d = r.views;
  }
  return out;
}

// Median views_7d of a channel's last BASELINE_SAMPLE recent videos.
// Excludes the matched video itself so we're not measuring it against itself.
const BASELINE_SAMPLE = 30;

function getChannelBaselineViews(db, channelId, excludeVideoId) {
  const rows = db.all(
    `SELECT vgs.views
     FROM (
       SELECT youtube_video_id
       FROM ingested_videos
       WHERE channel_id = ?
         AND youtube_video_id != ?
         AND published_at IS NOT NULL
       ORDER BY published_at DESC
       LIMIT ${BASELINE_SAMPLE}
     ) recent
     JOIN video_growth_snapshots vgs
       ON vgs.video_id = recent.youtube_video_id AND vgs.bucket = '7d'
     WHERE vgs.views IS NOT NULL`,
    [channelId, excludeVideoId || ''],
  );
  const values = rows.map(r => r.views).filter(v => v != null);
  return { baseline: median(values), sampleSize: values.length };
}

// Percentile rank of views_7d within the creator's own catalog.
function getPercentileVsChannel(db, channelId, views7d, excludeVideoId) {
  if (views7d == null) return null;
  const rows = db.all(
    `SELECT vgs.views
     FROM ingested_videos iv
     JOIN video_growth_snapshots vgs
       ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
     WHERE iv.channel_id = ?
       AND iv.youtube_video_id != ?
       AND vgs.views IS NOT NULL`,
    [channelId, excludeVideoId || ''],
  );
  return percentileOf(rows.map(r => r.views), views7d);
}

// Niche benchmark views_7d median from pre-computed niche_benchmarks table.
// Falls back to null if the niche/duration combination has no benchmark.
function getNicheMedian(db, niche, durationBucket) {
  if (!niche) return null;
  const row = db.get(
    `SELECT median_views, p75_views
     FROM niche_benchmarks
     WHERE niche = ? AND bucket = '7d' AND duration_bucket = ?
     ORDER BY computed_at DESC LIMIT 1`,
    [niche, durationBucket || 'mid'],
  );
  return row ? { median: row.median_views, p75: row.p75_views } : null;
}

// Channel's niche from ingested_channels.
function getChannelNiche(db, channelId) {
  const row = db.get(
    `SELECT COALESCE(primary_niche, niche) AS niche FROM ingested_channels WHERE channel_id = ?`,
    [channelId],
  );
  return row?.niche || null;
}

// Duration bucket for a video ('short', 'mid', 'long', 'longform').
function getDurationBucket(db, videoId) {
  const row = db.get(
    `SELECT duration_seconds FROM ingested_videos WHERE youtube_video_id = ?`,
    [videoId],
  );
  if (!row?.duration_seconds) return 'mid';
  const s = row.duration_seconds;
  if (s < 65)    return 'short';
  if (s < 480)   return 'mid';
  if (s < 1200)  return 'long';
  return 'longform';
}

// Percentile rank of views_7d among all wtp_outcomes with same rec_source.
// Called after inserting the current row (uses all rows including the new one).
function getPercentileVsSource(db, recSource, views7d, excludeIdeaKey) {
  if (views7d == null || !recSource) return null;
  const rows = db.all(
    `SELECT views_7d FROM wtp_outcomes
     WHERE rec_source = ? AND idea_key != ? AND views_7d IS NOT NULL`,
    [recSource, excludeIdeaKey || ''],
  );
  return percentileOf(rows.map(r => r.views_7d), views7d);
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute outcome quality for one wtp_video_matches row and upsert into wtp_outcomes.
 * Also back-fills performance columns on the wtp_video_matches row itself.
 *
 * @param {object} db         - DB handle
 * @param {object} matchRow   - Row from wtp_video_matches
 * @returns {{ outcomeClass, relativeLift, views7d, views30d } | null}
 */
function computeAndStoreOutcome(db, matchRow) {
  const { channel_id, idea_key, video_id, rec_source, rec_type, score, confidence, topic } = matchRow;
  if (!video_id || !channel_id || !idea_key) return null;

  // 1. Raw performance
  const { views_7d, views_30d } = getVideoSnapshots(db, video_id);
  if (views_7d == null) return null; // video not yet snapshotted at 7d — skip for now

  // 2. Channel baseline
  const { baseline: channelBaseline, sampleSize } = getChannelBaselineViews(db, channel_id, video_id);

  // 3. Relative lift
  const relativeLift = channelBaseline && channelBaseline > 0
    ? Math.round((views_7d / channelBaseline) * 1000) / 1000
    : null;

  // 4. Outcome class
  const outcomeClass = classifyOutcome(relativeLift);

  // 5. Percentile vs channel
  const pctChannel = getPercentileVsChannel(db, channel_id, views_7d, video_id);

  // 6. Niche context
  const niche         = getChannelNiche(db, channel_id);
  const durationBucket = getDurationBucket(db, video_id);
  const nicheBenchmark = getNicheMedian(db, niche, durationBucket);

  // 7. Upsert wtp_outcomes
  try {
    db.run(
      `INSERT INTO wtp_outcomes
         (idea_key, channel_id, video_id, rec_source, rec_type, rec_score, confidence,
          topic, niche, views_7d, views_30d, channel_baseline_views, niche_median_views_7d,
          relative_lift, percentile_vs_channel, outcome_class,
          days_to_publish, match_confidence, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(idea_key, video_id) DO UPDATE SET
         views_7d               = excluded.views_7d,
         views_30d              = excluded.views_30d,
         channel_baseline_views = excluded.channel_baseline_views,
         niche_median_views_7d  = excluded.niche_median_views_7d,
         relative_lift          = excluded.relative_lift,
         percentile_vs_channel  = excluded.percentile_vs_channel,
         outcome_class          = excluded.outcome_class,
         computed_at            = datetime('now')`,
      [
        idea_key, channel_id, video_id,
        rec_source  || 'peer_signal',
        rec_type    || null,
        score       != null ? Number(score) : null,
        confidence  || null,
        topic       ? String(topic).slice(0, 200) : '',
        niche,
        views_7d,
        views_30d,
        channelBaseline,
        nicheBenchmark?.median ?? null,
        relativeLift,
        pctChannel,
        outcomeClass,
        matchRow.days_to_publish ?? null,
        matchRow.match_confidence ?? 'manual',
      ],
    );
  } catch (e) {
    console.warn('[wtpOutcomeQuality] upsert wtp_outcomes failed:', e.message);
    return null;
  }

  // 8. Compute percentile_vs_source now that the row exists
  const pctSource = getPercentileVsSource(db, rec_source, views_7d, idea_key);

  // 9. Back-update wtp_outcomes with percentile_vs_source
  if (pctSource != null) {
    try {
      db.run(
        `UPDATE wtp_outcomes SET percentile_vs_source = ? WHERE idea_key = ? AND video_id = ?`,
        [pctSource, idea_key, video_id],
      );
    } catch (_) {}
  }

  // 10. Update wtp_video_matches with performance fields
  try {
    db.run(
      `UPDATE wtp_video_matches
       SET views_7d = ?, views_30d = ?, relative_performance = ?,
           percentile_vs_channel = ?, percentile_vs_recommendation_source = ?,
           outcome_class = ?, performance_computed_at = datetime('now')
       WHERE idea_key = ? AND video_id = ?`,
      [
        views_7d, views_30d, relativeLift,
        pctChannel, pctSource,
        outcomeClass,
        idea_key, video_id,
      ],
    );
  } catch (e) {
    console.warn('[wtpOutcomeQuality] update wtp_video_matches failed:', e.message);
  }

  return {
    outcomeClass,
    relativeLift,
    views7d: views_7d,
    views30d: views_30d,
    channelBaseline,
    baselineSampleSize: sampleSize,
    pctChannel,
    pctSource,
  };
}

// ── Reporting queries ─────────────────────────────────────────────────────────

const OUTCOME_RANK = { breakout: 4, above_average: 3, average: 2, below_average: 1, failed: 0, unscored: -1 };

// Returns success rate metrics grouped by a dimension column.
// success = breakout + above_average
function fetchSuccessRateByDimension(db, { dimension, days = 90, minSamples = 3 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const validDimensions = new Set(['rec_source', 'niche', 'rec_type', 'confidence', 'outcome_class']);
  if (!validDimensions.has(dimension)) throw new Error(`Invalid dimension: ${dimension}`);

  const rows = db.all(
    `SELECT
       ${dimension}                                          AS dim_value,
       COUNT(*)                                              AS sample_size,
       SUM(CASE WHEN outcome_class IN ('breakout', 'above_average') THEN 1 ELSE 0 END) AS success_count,
       SUM(CASE WHEN outcome_class = 'breakout'      THEN 1 ELSE 0 END)   AS breakout_count,
       SUM(CASE WHEN outcome_class = 'above_average' THEN 1 ELSE 0 END)   AS above_avg_count,
       SUM(CASE WHEN outcome_class = 'average'       THEN 1 ELSE 0 END)   AS avg_count,
       SUM(CASE WHEN outcome_class = 'below_average' THEN 1 ELSE 0 END)   AS below_avg_count,
       SUM(CASE WHEN outcome_class = 'failed'        THEN 1 ELSE 0 END)   AS failed_count,
       ROUND(AVG(relative_lift), 3)                         AS avg_lift,
       ROUND(AVG(views_7d), 0)                              AS avg_views_7d,
       ROUND(AVG(percentile_vs_channel), 1)                 AS avg_pct_vs_channel
     FROM wtp_outcomes
     WHERE computed_at >= ?
       AND outcome_class != 'unscored'
     GROUP BY ${dimension}
     HAVING COUNT(*) >= ?
     ORDER BY success_count * 1.0 / COUNT(*) DESC, COUNT(*) DESC`,
    [since, minSamples],
  );

  return rows.map(r => ({
    dimension:      r.dim_value,
    sampleSize:     r.sample_size,
    successRate:    r.sample_size > 0 ? +(r.success_count / r.sample_size * 100).toFixed(1) : 0,
    breakoutRate:   r.sample_size > 0 ? +(r.breakout_count / r.sample_size * 100).toFixed(1) : 0,
    aboveAvgRate:   r.sample_size > 0 ? +(r.above_avg_count / r.sample_size * 100).toFixed(1) : 0,
    avgRate:        r.sample_size > 0 ? +(r.avg_count / r.sample_size * 100).toFixed(1) : 0,
    belowAvgRate:   r.sample_size > 0 ? +(r.below_avg_count / r.sample_size * 100).toFixed(1) : 0,
    failedRate:     r.sample_size > 0 ? +(r.failed_count / r.sample_size * 100).toFixed(1) : 0,
    avgLift:        r.avg_lift,
    avgViews7d:     r.avg_views_7d,
    avgPctVsChannel: r.avg_pct_vs_channel,
  }));
}

// Overall outcome distribution — high-level view.
function fetchOutcomeDistribution(db, { days = 90 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const row = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN outcome_class = 'breakout'      THEN 1 ELSE 0 END) AS breakout,
       SUM(CASE WHEN outcome_class = 'above_average' THEN 1 ELSE 0 END) AS above_average,
       SUM(CASE WHEN outcome_class = 'average'       THEN 1 ELSE 0 END) AS average,
       SUM(CASE WHEN outcome_class = 'below_average' THEN 1 ELSE 0 END) AS below_average,
       SUM(CASE WHEN outcome_class = 'failed'        THEN 1 ELSE 0 END) AS failed,
       ROUND(AVG(relative_lift), 3) AS avg_lift,
       ROUND(AVG(percentile_vs_channel), 1) AS avg_pct_channel
     FROM wtp_outcomes
     WHERE computed_at >= ? AND outcome_class != 'unscored'`,
    [since],
  );
  return row;
}

// Top performing topics — which specific topics yielded the best videos.
function fetchTopPerformingTopics(db, { days = 90, limit = 20 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db.all(
    `SELECT
       topic,
       rec_source,
       niche,
       COUNT(*) AS times_matched,
       ROUND(AVG(relative_lift), 2) AS avg_lift,
       ROUND(AVG(percentile_vs_channel), 1) AS avg_pct_channel,
       SUM(CASE WHEN outcome_class IN ('breakout','above_average') THEN 1 ELSE 0 END) AS successes,
       MAX(views_7d) AS best_views_7d
     FROM wtp_outcomes
     WHERE computed_at >= ? AND outcome_class != 'unscored' AND relative_lift IS NOT NULL
     GROUP BY topic, rec_source
     HAVING COUNT(*) >= 1
     ORDER BY avg_lift DESC, successes DESC
     LIMIT ?`,
    [since, limit],
  );
}

// Videos with outcome data — for a channel or globally.
function fetchRecentOutcomes(db, { days = 30, channelId = null, limit = 30 } = {}) {
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chFilter = channelId ? 'AND channel_id = ?' : '';
  const params   = channelId ? [since, channelId, limit] : [since, limit];
  return db.all(
    `SELECT idea_key, channel_id, video_id, topic, rec_source, rec_type,
            views_7d, views_30d, channel_baseline_views, relative_lift,
            percentile_vs_channel, outcome_class, days_to_publish, computed_at
     FROM wtp_outcomes
     WHERE computed_at >= ? ${chFilter}
     ORDER BY relative_lift DESC, computed_at DESC
     LIMIT ?`,
    params,
  );
}

module.exports = {
  classifyOutcome,
  computeAndStoreOutcome,
  getVideoSnapshots,
  getChannelBaselineViews,
  fetchSuccessRateByDimension,
  fetchOutcomeDistribution,
  fetchTopPerformingTopics,
  fetchRecentOutcomes,
  OUTCOME_THRESHOLDS,
};
