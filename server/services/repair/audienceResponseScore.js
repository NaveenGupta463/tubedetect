'use strict';

// Format profiles where low comment rate is expected and must not penalise the video.
// Matches values that may appear in ingested_channels.format_profile or content_archetype.
const PASSIVE_FORMAT_TOKENS = new Set([
  'music', 'kids', 'meditation', 'ambient', 'sleep', 'lofi', 'study',
  'passive_utility', 'passive utility', 'relaxation', 'asmr', 'white_noise',
  'white noise', 'nature_sounds', 'nature sounds',
]);

function isPassiveFormat(channelMeta) {
  const fp = (channelMeta?.format_profile  ?? '').toLowerCase();
  const ca = (channelMeta?.content_archetype ?? '').toLowerCase();
  for (const tok of PASSIVE_FORMAT_TOKENS) {
    if (fp.includes(tok) || ca.includes(tok)) return true;
  }
  return false;
}

/**
 * Compute audience-response score from like/comment rates vs niche benchmark.
 *
 * benchmarkRow  — row from niche_benchmarks (may be null).
 * videoMeta     — row from ingested_videos (views, likes, comments).
 * channelMeta   — row from ingested_channels (format_profile, content_archetype).
 *
 * Returns 0–100 where 100 = strong audience signals, 0 = flat/disengaged.
 */
function computeAudienceResponseScore(videoMeta, channelMeta, benchmarkRow) {
  const views    = videoMeta?.views    ?? 0;
  const likes    = videoMeta?.likes    ?? 0;
  const comments = videoMeta?.comments ?? 0;

  if (views < 100) {
    return {
      audience_response_score: 50,
      like_rate:     null,
      comment_rate:  null,
      is_passive:    false,
      evidence: { reason: 'insufficient_views', views },
    };
  }

  const likeRate    = likes    / views;
  const commentRate = comments / views;
  const passive     = isPassiveFormat(channelMeta);

  // Reference rates from benchmark (fallback to industry defaults if missing).
  const refLikeRate    = benchmarkRow?.median_like_rate    ?? 0.03;
  const refCommentRate = passive ? null : (benchmarkRow?.median_comment_rate ?? 0.005);

  // Like-rate ratio (capped at 3× for score mapping).
  const likeRatio = refLikeRate > 0 ? likeRate / refLikeRate : null;
  let likeScore   = likeRatio != null ? Math.min(100, likeRatio * 50) : 50;

  // Comment-rate ratio — skipped entirely for passive formats.
  let commentScore = 50;
  if (!passive && refCommentRate != null) {
    const cr = commentRate / refCommentRate;
    commentScore = Math.min(100, cr * 50);
  }

  // Weight: like signal is primary (70%), comment is secondary (30%).
  // For passive formats: 100% weight on likes.
  const score = passive
    ? likeScore
    : likeScore * 0.7 + commentScore * 0.3;

  return {
    audience_response_score: Math.round(score),
    like_rate:    parseFloat(likeRate.toFixed(5)),
    comment_rate: parseFloat(commentRate.toFixed(5)),
    is_passive:   passive,
    evidence: {
      views,
      likes,
      comments,
      ref_like_rate:    refLikeRate,
      ref_comment_rate: refCommentRate,
      like_ratio:       likeRatio != null ? parseFloat(likeRatio.toFixed(3)) : null,
      comment_skipped:  passive,
    },
  };
}

module.exports = { computeAudienceResponseScore };
