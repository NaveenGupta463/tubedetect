'use strict';

/**
 * Quality Agent — Phase XI Corpus Layer
 *
 * Evaluates channel quality from locally available data only.
 * Assigns quality_score 0–100 and flags low-trust signals.
 *
 * ARCHITECTURAL RULE: Quality scores gate training eligibility.
 * A channel MUST pass quality gating before its data can influence
 * validator scoring, recommendations, or semantic priors.
 */

const {
  upsertCorpusQualityState,
  updateCorpusChannelQuality,
  getCorpusVideosByChannel,
  logChannelEvent,
} = require('../db/corpusQueries');

const SUBSCRIBER_MILESTONES = [10_000, 50_000, 100_000, 500_000, 1_000_000];

const TRAINING_QUALITY_THRESHOLD  = 60;
const TRAINING_MIN_SAMPLE_SIZE    = 5;
const CLICKBAIT_TITLE_PATTERNS    = [
  /\b(shocking|insane|unbelievable|you won't believe|watch till end|gone wrong|gone sexual)\b/i,
  /[!]{3,}/,
  /\*{2,}/,
  /[A-Z]{10,}/,
  /\b(free money|get rich|100x|1000%|overnight)\b/i,
];

// ── Scoring components ────────────────────────────────────────────────────────

function scoreAuthority(channel) {
  const subs  = channel.subscriber_count ?? 0;
  const views = channel.total_views ?? 0;

  // log-scale authority: 0–25 pts
  const subScore  = subs  > 0 ? Math.min(12.5, Math.log10(subs + 1)  / Math.log10(10_000_000) * 12.5) : 0;
  const viewScore = views > 0 ? Math.min(12.5, Math.log10(views + 1) / Math.log10(1_000_000_000) * 12.5) : 0;
  return Math.round((subScore + viewScore) * 10) / 10;
}

function scoreEngagementAuthenticity(videos) {
  if (!videos.length) return 0;

  const ratios = videos
    .filter(v => (v.views ?? 0) > 100)
    .map(v => {
      const likeRatio    = v.likes    ? v.likes    / v.views : 0;
      const commentRatio = v.comments ? v.comments / v.views : 0;
      return { likeRatio, commentRatio };
    });

  if (!ratios.length) return 10;

  const avgLike    = ratios.reduce((s, r) => s + r.likeRatio, 0)    / ratios.length;
  const avgComment = ratios.reduce((s, r) => s + r.commentRatio, 0) / ratios.length;

  // Typical healthy channels: like rate 0.02–0.08, comment rate 0.001–0.01
  const likeScore    = avgLike    >= 0.005 && avgLike    <= 0.15 ? 10 : avgLike > 0 ? 5 : 0;
  const commentScore = avgComment >= 0.001 ? 10 : 5;

  return likeScore + commentScore; // 0–20
}

function scoreClickbaitSaturation(videos) {
  if (!videos.length) return 10;
  const clickbaitCount = videos.filter(v =>
    CLICKBAIT_TITLE_PATTERNS.some(p => p.test(v.title ?? '')),
  ).length;
  const ratio = clickbaitCount / videos.length;
  // Heavy clickbait (>50%) → 0pts; clean (<10%) → 10pts
  if (ratio > 0.5) return 0;
  if (ratio > 0.3) return 4;
  if (ratio > 0.1) return 7;
  return 10;
}

function scorePerformanceStability(videos) {
  if (videos.length < 3) return 5;

  const vphs = videos.map(v => v.vph ?? 0).filter(v => v > 0);
  if (vphs.length < 3) return 5;

  const mean = vphs.reduce((s, v) => s + v, 0) / vphs.length;
  if (mean === 0) return 0;
  const variance  = vphs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vphs.length;
  const cv        = Math.sqrt(variance) / mean; // coefficient of variation

  // Low CV = stable = better. CV < 1 → 15pts, CV < 2 → 10pts, CV < 4 → 5pts
  if (cv < 1) return 15;
  if (cv < 2) return 10;
  if (cv < 4) return 5;
  return 2;
}

function scoreTitleQuality(videos) {
  if (!videos.length) return 0;

  const titleScores = videos.map(v => {
    const t   = v.title ?? '';
    const len = t.length;
    if (len < 5 || len > 150) return 0;
    if (/^[A-Z\s!?]+$/.test(t)) return 0; // all caps
    if (len >= 20 && len <= 80) return 1;
    return 0.5;
  });

  const avg = titleScores.reduce((s, x) => s + x, 0) / titleScores.length;
  return Math.round(avg * 10); // 0–10
}

function scoreSemanticConsistency(channel, videos) {
  // Does the channel have a niche? Are titles topically consistent?
  if (!channel.niche || channel.niche === 'other') return 5;

  // Crude topic consistency: if channel has a niche that's not 'other', base score 10
  // More sophisticated: would require embedding comparison
  return 10;
}

// ── Spam detection ────────────────────────────────────────────────────────────

function detectSpam(channel, videos) {
  const subs   = channel.subscriber_count ?? 0;
  const vcount = channel.video_count ?? videos.length;

  if (subs < 50) return true;
  if (vcount > 100 && subs < 100) return true;

  const avgViews = videos.length
    ? videos.reduce((s, v) => s + (v.views ?? 0), 0) / videos.length
    : 0;
  if (vcount > 50 && avgViews < 50) return true;

  return false;
}

function detectAISlop(videos) {
  if (!videos.length) return false;
  // Heuristic: many videos with near-identical short titles, or
  // unusually high posting frequency with very low engagement
  const titles = videos.map(v => (v.title ?? '').toLowerCase().trim());
  const unique  = new Set(titles).size;
  // If >30% of recent titles are identical or near-identical → suspicious
  if (unique / titles.length < 0.7 && titles.length > 10) return true;
  return false;
}

function detectUnstable(videos) {
  if (videos.length < 5) return false;
  const vphs = videos.map(v => v.vph ?? 0).filter(v => v > 0);
  if (!vphs.length) return false;
  const max  = Math.max(...vphs);
  const min  = Math.min(...vphs);
  // Wild swings (100x range) → unstable
  return min > 0 && max / min > 100;
}

// ── Milestone detection ───────────────────────────────────────────────────────

function checkMilestoneCrossings(db, channel, qualityScore, trainingEligible) {
  const subs = channel.subscriber_count ?? 0;
  if (subs === 0) return;

  const logged = db.all(
    `SELECT event_data FROM channel_events WHERE channel_id = ? AND event_type = 'milestone_crossed'`,
    [channel.channel_id],
  );
  const loggedMilestones = new Set(
    logged.map(r => {
      try { return JSON.parse(r.event_data).milestone; } catch (_) { return null; }
    }).filter(Boolean),
  );

  // First evaluation: channel has no milestone history yet.
  // Silently register all already-achieved milestones as a pre-existing baseline
  // so future evaluations can detect genuine new crossings. No log output.
  const isFirstContact = loggedMilestones.size === 0;

  for (const milestone of SUBSCRIBER_MILESTONES) {
    if (subs >= milestone && !loggedMilestones.has(milestone)) {
      logChannelEvent(db, channel.channel_id, 'milestone_crossed', {
        milestone,
        subscriber_count:    subs,
        total_views:         channel.total_views ?? null,
        video_count:         channel.video_count ?? null,
        quality_score:       qualityScore,
        training_eligible:   trainingEligible,
        niche:               channel.niche ?? null,
        title:               channel.title ?? null,
        yt_default_language: channel.yt_default_language ?? null,
        yt_country:          channel.yt_country ?? null,
        was_pre_existing:    isFirstContact,
      });
      if (!isFirstContact) {
        console.log(`[quality] Milestone crossed: ${channel.title} reached ${milestone.toLocaleString()} subs`);
      }
    }
  }
}

// ── Main evaluation function ──────────────────────────────────────────────────

function evaluateChannelQuality(db, channel) {
  const videos = getCorpusVideosByChannel(db, channel.channel_id, 100);

  const authority     = scoreAuthority(channel);             // 0–25
  const engagement    = scoreEngagementAuthenticity(videos); // 0–20
  const antiClickbait = scoreClickbaitSaturation(videos);    // 0–10
  const stability     = scorePerformanceStability(videos);   // 0–15
  const titleQ        = scoreTitleQuality(videos);           // 0–10
  const semantic      = scoreSemanticConsistency(channel, videos); // 0–10
  // 10 points reserved: niche coverage bonus
  const nicheBonus    = channel.niche && channel.niche !== 'other' ? 10 : 0;

  const quality_score = Math.min(100, Math.round(
    authority + engagement + antiClickbait + stability + titleQ + semantic + nicheBonus,
  ));

  const is_spam    = detectSpam(channel, videos);
  const is_ai_slop = detectAISlop(videos);
  const is_unstable = detectUnstable(videos);

  const flags = [];
  if (is_spam)    flags.push('spam');
  if (is_ai_slop) flags.push('ai_slop');
  if (is_unstable) flags.push('unstable');
  if (antiClickbait < 4) flags.push('high_clickbait');
  if (authority < 5)     flags.push('low_authority');

  const sample_size     = videos.length;
  const training_eligible = (
    !is_spam &&
    !is_ai_slop &&
    quality_score >= TRAINING_QUALITY_THRESHOLD &&
    sample_size   >= TRAINING_MIN_SAMPLE_SIZE
  );

  const qs = {
    channel_id:              channel.channel_id,
    quality_score,
    semantic_consistency:    semantic,
    engagement_authenticity: engagement,
    clickbait_score:         10 - antiClickbait, // higher = more clickbait
    performance_stability:   stability,
    title_quality:           titleQ,
    authority_score:         authority,
    sample_size,
    is_spam,
    is_ai_slop,
    is_unstable,
    flags,
    training_eligible,
  };

  upsertCorpusQualityState(db, qs);
  updateCorpusChannelQuality(db, channel.channel_id, {
    quality_score,
    training_eligible,
    is_spam,
    is_low_quality: quality_score < 40,
    quality_flags:  flags,
  });

  checkMilestoneCrossings(db, channel, quality_score, training_eligible);

  return qs;
}

function evaluateVideosQuality(videos) {
  return videos.map(v => {
    const flags  = [];
    const cbHit  = CLICKBAIT_TITLE_PATTERNS.some(p => p.test(v.title ?? ''));
    if (cbHit) flags.push('clickbait');
    const titleLen = (v.title ?? '').length;
    if (titleLen < 5 || titleLen > 150) flags.push('bad_title_length');

    const quality_score = cbHit ? 40 : titleLen >= 20 && titleLen <= 80 ? 80 : 60;
    return { video_id: v.video_id, quality_score, flags };
  });
}

function calculateTrainingEligibility(qualityState) {
  return (
    !qualityState.is_spam &&
    !qualityState.is_ai_slop &&
    qualityState.quality_score >= TRAINING_QUALITY_THRESHOLD &&
    qualityState.sample_size   >= TRAINING_MIN_SAMPLE_SIZE
  );
}

module.exports = {
  evaluateChannelQuality,
  evaluateVideosQuality,
  calculateTrainingEligibility,
  TRAINING_QUALITY_THRESHOLD,
  TRAINING_MIN_SAMPLE_SIZE,
};
