'use strict';

const { getDb, closeDb } = require('../db/init');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { extractPhrases } = require('../lib/phrases');
const { classifyTrend } = require('../services/topicAnalysis');

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function main() {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.error('Usage: node server/scripts/debugWtpCandidateCollapse.js <channel id or name>');
    process.exit(1);
  }

  const db = getDb();
  try {
    const channel = db.get(
      `SELECT * FROM ingested_channels
       WHERE channel_id = ?
          OR lower(channel_name) = lower(?)
          OR lower(channel_name) LIKE lower(?)
       ORDER BY CASE WHEN channel_id = ? OR lower(channel_name) = lower(?) THEN 0 ELSE 1 END,
                channel_subscribers DESC
       LIMIT 1`,
      [query, query, `${query}%`, query, query],
    );
    if (!channel) throw new Error(`Channel not found: ${query}`);

    const peerCtx = resolveCreatorPeerContext(db, channel.channel_id, {
      userSubs: channel.channel_subscribers || 0,
      debug: false,
    });
    const peerIds = (peerCtx.peerIds || []).slice(0, 160);
    if (!peerIds.length) throw new Error('No peers resolved');

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ph = peerIds.map(() => '?').join(',');
    const videos = db.all(
      `SELECT youtube_video_id, title, views, channel_id, published_at, duration_seconds,
              format_type, channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, iv.duration_seconds, iv.format_type, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at >= ?
           AND iv.title IS NOT NULL
           AND iv.views > 0
       ) WHERE rn <= 10`,
      [...peerIds, since],
    );

    const userPhrases = new Set();
    db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL
       ORDER BY published_at DESC LIMIT 100`,
      [channel.channel_id],
    ).forEach(row => extractPhrases(row.title).forEach(p => userPhrases.add(p)));

    const userOwnMedian = median(
      db.all(`SELECT views FROM ingested_videos WHERE channel_id = ? AND views > 0`, [channel.channel_id])
        .map(row => row.views),
    );
    const minMedianViews = userOwnMedian > 0
      ? Math.max(300, Math.round(userOwnMedian * 0.08))
      : 4000;

    const buckets = new Map();
    let phraseMentions = 0;
    for (const video of videos) {
      const seen = new Set();
      const ageDays = (Date.now() - new Date(video.published_at).getTime()) / 86400000;
      for (const phrase of extractPhrases(video.title)) {
        if (seen.has(phrase)) continue;
        seen.add(phrase);
        phraseMentions++;
        if (!buckets.has(phrase)) {
          buckets.set(phrase, {
            channels: new Set(),
            videos: [],
            views: [],
            recent: 0,
            older: 0,
          });
        }
        const bucket = buckets.get(phrase);
        bucket.channels.add(video.channel_id);
        bucket.videos.push(video);
        bucket.views.push(video.views || 0);
        if (ageDays <= 30) bucket.recent++;
        else bucket.older++;
      }
    }

    const minChannels = 3;
    const rows = [...buckets.entries()].map(([phrase, bucket]) => {
      const medianViews = median(bucket.views);
      const own = userPhrases.has(phrase);
      return {
        phrase,
        channels: bucket.channels.size,
        videos: bucket.videos.length,
        median_views: medianViews,
        recent: bucket.recent,
        older: bucket.older,
        own_phrase: own,
        passes_min_channels: bucket.channels.size >= minChannels,
        passes_min_views: medianViews >= minMedianViews,
        passes_own_gap: !own,
        passes_fresh_spike_gate: bucket.older > 0 || bucket.channels.size >= 5,
        trend: classifyTrend({
          cnt_0_14: 0,
          cnt_15_30: bucket.recent,
          cnt_31_60: 0,
          cnt_61_90: bucket.older,
        }),
        examples: bucket.videos.slice(0, 3).map(v => ({
          channel_name: v.channel_name,
          title: v.title,
          views: v.views,
        })),
      };
    });

    const counts = {
      raw_phrase_buckets: rows.length,
      min_channels: rows.filter(r => r.passes_min_channels).length,
      min_channels_and_views: rows.filter(r => r.passes_min_channels && r.passes_min_views).length,
      after_own_phrase_exclusion: rows.filter(r => r.passes_min_channels && r.passes_min_views && r.passes_own_gap).length,
      after_fresh_spike_gate: rows.filter(r => r.passes_min_channels && r.passes_min_views && r.passes_own_gap && r.passes_fresh_spike_gate).length,
    };

    console.log(JSON.stringify({
      channel: {
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        subscribers: channel.channel_subscribers,
        niche: channel.primary_niche || channel.niche,
        creator_mode: channel.creator_mode,
        format_profile: channel.format_profile,
      },
      peer_context: {
        peer_source: peerCtx.peer_source,
        csp_primary: peerCtx.csp_primary,
        csp_peer_count: peerCtx.csp_peer_count,
        csp_target_family: peerCtx.csp_target_family,
        peer_count: peerIds.length,
      },
      videos: {
        window_days: 90,
        sampled_peer_videos: videos.length,
        phrase_mentions: phraseMentions,
        user_phrase_count: userPhrases.size,
        user_own_median_views: userOwnMedian,
        min_median_views: minMedianViews,
      },
      counts,
      top_by_channels: rows
        .slice()
        .sort((a, b) => b.channels - a.channels || b.median_views - a.median_views)
        .slice(0, 25),
      top_after_basic_gates: rows
        .filter(r => r.passes_min_channels && r.passes_min_views && r.passes_own_gap && r.passes_fresh_spike_gate)
        .sort((a, b) => b.median_views - a.median_views || b.channels - a.channels)
        .slice(0, 25),
    }, null, 2));
  } finally {
    closeDb();
  }
}

main();
