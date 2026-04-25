// ── Helpers ───────────────────────────────────────────────────────────────────

function safe(v) {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

function avg(...values) {
  const nums = values.filter(v => v !== undefined && v !== null).map(safe);
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function gradeFromScore(score) {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

// ── Schema version ────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = 2;

// ── Score weights ─────────────────────────────────────────────────────────────
export const SCORE_WEIGHTS = {
  packaging:  0.40,
  engagement: 0.30,
  seo:        0.15,
  velocity:   0.15,
};

// ── Niche-specific baselines ──────────────────────────────────────────────────
// likeRate/commentRate = industry medians (%) when no channel data available
// velocityMult = expected velocity relative to industry (>1 = fast-decay niches)
// seoThreshold = score below which SEO is flagged as an issue for this niche
export const NICHE_BASELINES = {
  'News/Politics':    { likeRate: 2.5,  commentRate: 1.2,  velocityMult: 1.5, seoThreshold: 45 },
  'Education':        { likeRate: 5.5,  commentRate: 0.35, velocityMult: 0.7, seoThreshold: 65 },
  'Entertainment':    { likeRate: 4.0,  commentRate: 0.5,  velocityMult: 1.0, seoThreshold: 55 },
  'Finance/Business': { likeRate: 3.0,  commentRate: 0.25, velocityMult: 0.8, seoThreshold: 60 },
  'Podcast/Long-form':{ likeRate: 5.0,  commentRate: 0.7,  velocityMult: 0.6, seoThreshold: 40 },
  'Commentary':       { likeRate: 3.5,  commentRate: 1.0,  velocityMult: 1.2, seoThreshold: 50 },
};
const INDUSTRY_BASELINE = { likeRate: 4, commentRate: 0.5, velocityMult: 1.0, seoThreshold: 50 };

const DIM_NAMES = {
  packaging:  'Packaging',
  engagement: 'Engagement',
  seo:        'SEO',
  velocity:   'Velocity',
};

// ── Packaging score (AI-estimated from title + description) ───────────────────
function computePackaging(aiSignals) {
  const p = aiSignals?.packaging || {};
  return Math.round(clamp(
    avg(p.title_clarity, p.title_curiosity, p.title_emotion, p.title_keyword_strength, p.description_relevance) * 10
  ));
}

// ── SEO score (AI-estimated) ──────────────────────────────────────────────────
function computeSeo(aiSignals) {
  const s = aiSignals?.seo || {};
  return Math.round(clamp(
    avg(s.keyword_alignment, s.search_potential, s.competition_fit, s.tag_relevance) * 10
  ));
}

// ── Engagement score (channel-relative; falls back to niche baseline) ─────────
function computeEngagement(realStats, channelRealStats, niche) {
  const likeRate    = safe(realStats?.likeRate);
  const commentRate = safe(realStats?.commentRate);

  const nicheBL             = NICHE_BASELINES[niche] || INDUSTRY_BASELINE;
  const hasChannelBaseline  = (channelRealStats?.likeRate ?? 0) > 0;
  const baselineLike        = hasChannelBaseline ? channelRealStats.likeRate    : nicheBL.likeRate;
  const baselineComment     = hasChannelBaseline && (channelRealStats?.commentRate ?? 0) > 0
    ? channelRealStats.commentRate : nicheBL.commentRate;

  const likeScore    = clamp(likeRate    / baselineLike,    0, 2);
  const commentScore = clamp(commentRate / baselineComment, 0, 2);
  const score        = Math.round(((likeScore * 0.6) + (commentScore * 0.4)) * 50);

  return { score, confidence: hasChannelBaseline ? 'high' : 'medium' };
}

// ── Velocity score (real stats vs channel average, niche-normalized) ──────────
function computeVelocity(realStats, channelRealStats, niche) {
  const views           = safe(realStats?.views);
  const publishedAt     = realStats?.publishedAt;
  const channelAvgViews = safe(channelRealStats?.views);
  const nicheBL         = NICHE_BASELINES[niche] || INDUSTRY_BASELINE;

  if (!channelAvgViews || channelAvgViews === 0) {
    return { score: 0, confidence: 'low' };
  }

  const viewsRatio             = Math.min(1, views / channelAvgViews);
  const channelAvgViewsPerHour = safe(channelRealStats?.avgViewsPerHour);

  if (!channelAvgViewsPerHour || channelAvgViewsPerHour <= 0 || !publishedAt) {
    return { score: Math.round(viewsRatio * 100), confidence: 'low' };
  }

  const hoursSincePublish = Math.max(1, (Date.now() - new Date(publishedAt).getTime()) / 3_600_000);
  // Normalize by nicheMult: fast-decay niches (News) have higher expected vph, so divide to set a higher bar
  const normalizedChannelVph = channelAvgViewsPerHour * nicheBL.velocityMult;
  const earlyVelocityRatio   = Math.min(1, (views / hoursSincePublish) / normalizedChannelVph);
  const score                = Math.round(clamp((viewsRatio * 0.7) + (earlyVelocityRatio * 0.3), 0, 1) * 100);

  return { score, confidence: 'high' };
}

// ── Default fallback ──────────────────────────────────────────────────────────
function defaultAnalysisData() {
  return {
    viralScore:           0,
    grade:                'F',
    confidenceScore:      0,
    dimensionScores:      { packaging: 0, engagement: 0, seo: 0, velocity: 0 },
    engagementConfidence: 'medium',
    velocityConfidence:   'low',
    strengths:            '',
    weaknesses:           '',
    diagnosis:            ['No major issues detected'],
    primaryIssue:         { message: 'None', impact: 0 },
    biggestOpportunity:   { message: 'All dimensions performing well', potentialGain: 0 },
  };
}

// ── Main transformer ──────────────────────────────────────────────────────────
export function transformSignalsToAnalysisData(aiSignals, realStats = {}, channelRealStats = {}, niche = null) {
  if (!aiSignals && Object.keys(realStats).length === 0) return defaultAnalysisData();

  const packaging                                                  = computePackaging(aiSignals);
  const { score: engagement, confidence: engagementConfidence }   = computeEngagement(realStats, channelRealStats, niche);
  const seo                                                        = computeSeo(aiSignals);
  const { score: velocity, confidence: velocityConfidence }       = computeVelocity(realStats, channelRealStats, niche);

  const dimensionScores = { packaging, engagement, seo, velocity };

  const viralScore = clamp(Math.round(
    packaging  * SCORE_WEIGHTS.packaging  +
    engagement * SCORE_WEIGHTS.engagement +
    seo        * SCORE_WEIGHTS.seo        +
    velocity   * SCORE_WEIGHTS.velocity,
  ));

  const grade          = gradeFromScore(viralScore);
  const confidenceScore = aiSignals ? (engagementConfidence === 'high' ? 85 : 70) : 50;

  const strengths  = Object.entries(dimensionScores)
    .filter(([, s]) => s >= 75)
    .map(([k]) => `Strong ${DIM_NAMES[k]}`)
    .join('. ');
  const weaknesses = Object.entries(dimensionScores)
    .filter(([, s]) => s < 50)
    .map(([k]) => `Low ${DIM_NAMES[k]}`)
    .join('. ');

  const nicheBL      = NICHE_BASELINES[niche] || INDUSTRY_BASELINE;
  const seoThreshold = nicheBL.seoThreshold;

  const diagnosis = [];
  if (packaging  < 50)           diagnosis.push('Packaging is limiting click-through rate');
  if (engagement < 40)           diagnosis.push('Low engagement signals are suppressing distribution');
  if (seo        < seoThreshold) diagnosis.push('SEO is blocking organic discovery');
  if (velocity   < 30)           diagnosis.push('View velocity is below channel average');
  if (diagnosis.length === 0)    diagnosis.push('No major issues detected');

  const dimEntries = Object.entries(dimensionScores)
    .map(([k, s]) => ({ key: k, score: s, weight: SCORE_WEIGHTS[k] }))
    .sort((a, b) => (a.score * a.weight) - (b.score * b.weight));

  const worst         = dimEntries[0];
  const primaryIssue  = worst
    ? { message: `Low ${DIM_NAMES[worst.key]} is the primary constraint`, impact: Math.max(0, (70 - worst.score) * worst.weight) }
    : { message: 'None', impact: 0 };

  const candidates         = dimEntries.filter(d => d.score < 70);
  const biggestOpportunity = candidates.length > 0
    ? { message: `Improving ${DIM_NAMES[candidates[0].key]} would have the highest impact`, potentialGain: (70 - candidates[0].score) * candidates[0].weight }
    : { message: 'All dimensions performing well', potentialGain: 0 };

  return {
    viralScore,
    grade,
    confidenceScore,
    dimensionScores,
    engagementConfidence,
    velocityConfidence,
    strengths,
    weaknesses,
    diagnosis,
    primaryIssue,
    biggestOpportunity,
  };
}
