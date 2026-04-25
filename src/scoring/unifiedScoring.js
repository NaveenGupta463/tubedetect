import { parseDuration } from '../utils/analysis';
import { classifyVideo } from './videoClassifier';
import { getBaseline } from './truthEngine';

export function classifyFormat(video) {
  const duration = parseDuration(video.contentDetails?.duration)?.total ?? 0;
  if (duration > 0 && duration <= 60) return 'short';
  if (duration > 0 && duration <= 180) {
    const text = [
      video.snippet?.title || '',
      (video.snippet?.tags || []).join(' '),
      (video.snippet?.description || '').slice(0, 300),
    ].join(' ').toLowerCase();
    if (text.includes('#shorts')) return 'short';
  }
  return 'long';
}

function computeMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildBaseline(channelVideos, format, videoId) {
  if (!channelVideos?.length) return null;

  const now = Date.now();
  const cutoff = now - 365 * 24 * 3600 * 1000;

  const pool = channelVideos
    .filter(v => {
      if (v.id === videoId) return false;
      const pub = v.snippet?.publishedAt;
      if (pub && new Date(pub).getTime() < cutoff) return false;
      return classifyFormat(v) === format;
    })
    .slice(0, 100);

  const src = pool.length >= 5
    ? pool
    : channelVideos.filter(v => v.id !== videoId).slice(0, 100);

  if (!src.length) return null;

  const viewsList = [], likeRateList = [], commentRateList = [], vphList = [], engRateList = [];

  for (const v of src) {
    const vs = v.statistics || {};
    const vws = parseInt(vs.viewCount || 0);
    const lks = parseInt(vs.likeCount || 0);
    const cms = parseInt(vs.commentCount || 0);
    const pub = v.snippet?.publishedAt;
    if (vws <= 0) continue;
    const ageH = pub ? Math.max(1, (now - new Date(pub).getTime()) / 3_600_000) : 1;
    viewsList.push(vws);
    likeRateList.push(lks / vws * 100);
    commentRateList.push(cms / vws * 100);
    vphList.push(vws / ageH);
    engRateList.push((lks + cms) / vws * 100);
  }

  const sampleSize = viewsList.length;
  return {
    medianViews:       computeMedian(viewsList),
    medianLikeRate:    computeMedian(likeRateList),
    medianCommentRate: computeMedian(commentRateList),
    medianVph:         computeMedian(vphList),
    medianEngRate:     computeMedian(engRateList),
    sampleSize,
    confidence: sampleSize >= 15 ? 'HIGH' : sampleSize >= 8 ? 'MEDIUM' : 'LOW',
  };
}

function computeSignalTrust(views, likes, comments) {
  let trust = 1;
  if (views < 300)       trust *= 0.2;
  else if (views < 1000) trust *= 0.5;
  else if (views < 5000) trust *= 0.8;
  if (comments < 5)      trust *= 0.5;
  if (likes < 20)        trust *= 0.7;
  return Math.min(1, Math.max(0, trust));
}

function gradeFromScore(score) {
  if (score >= 85) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

const WEIGHTS = {
  long_public:  { velocity: 0.40, engagement: 0.40, discussion: 0.20 },
  long_oauth:   { velocity: 0.30, engagement: 0.50, discussion: 0.20 },
  short_public: { velocity: 0.40, engagement: 0.40, discussion: 0.20 },
  short_oauth:  { velocity: 0.30, engagement: 0.50, discussion: 0.20 },
};

export function buildPerformanceInsights(ratios, metrics, duration) {
  const positives = [];
  const negatives = [];
  const { viewsRatio = 1 } = ratios;
  const { views = 0, likeRate = 0, commentRate = 0 } = metrics;
  const totalMin = duration?.minutes ?? 0;

  if (viewsRatio >= 3) {
    positives.push({ category: 'Reach', icon: '🚀', title: `Viral hit — ${Math.round(viewsRatio * 100)}% of channel average`, detail: "YouTube's algorithm heavily amplified this video. Strong early signals triggered the recommendation engine." });
  } else if (viewsRatio >= 1.5) {
    positives.push({ category: 'Reach', icon: '📈', title: `Above-average performance (${Math.round(viewsRatio * 100)}% of channel norm)`, detail: 'The algorithm favored this content. High early watch time or CTR likely contributed to broader distribution.' });
  } else if (viewsRatio < 0.4) {
    negatives.push({ category: 'Reach', icon: '📉', title: `Underperformed — only ${Math.round(viewsRatio * 100)}% of your channel average`, detail: "The algorithm didn't amplify this video. Possible causes: low CTR on the thumbnail/title, poor audience retention in the first 30 seconds." });
  }

  if (likeRate > 5) {
    positives.push({ category: 'Engagement', icon: '❤️', title: `Exceptional like rate: ${likeRate.toFixed(2)}% (avg YouTube: 1–4%)`, detail: 'Viewers felt strongly compelled to show appreciation.' });
  } else if (likeRate > 2) {
    positives.push({ category: 'Engagement', icon: '👍', title: `Healthy like rate: ${likeRate.toFixed(2)}%`, detail: 'Above-average viewer appreciation. The content resonated positively.' });
  } else if (views > 1000 && likeRate < 0.5) {
    negatives.push({ category: 'Engagement', icon: '👎', title: `Low like rate: ${likeRate.toFixed(2)}%`, detail: 'Very few viewers liked the video. Consider if the content was satisfying and if there was a clear like CTA.' });
  }

  if (commentRate > 0.3) {
    positives.push({ category: 'Community', icon: '💬', title: `High comment rate: ${commentRate.toFixed(3)}%`, detail: 'This video sparked significant discussion — a strong signal to YouTube.' });
  } else if (commentRate > 0.08) {
    positives.push({ category: 'Community', icon: '🗨️', title: `Good comment activity (${commentRate.toFixed(3)}%)`, detail: 'Healthy audience conversation. The content invited viewer participation.' });
  } else if (views > 5000 && commentRate < 0.02) {
    negatives.push({ category: 'Community', icon: '🔇', title: `Very low comments (${commentRate.toFixed(3)}%)`, detail: 'Minimal audience discussion. Try ending videos with a specific question to drive comments.' });
  }

  if (totalMin >= 8 && totalMin <= 20) {
    positives.push({ category: 'Format', icon: '⏱️', title: `Optimal video length: ${duration.formatted}`, detail: 'Videos 8–20 minutes hit the sweet spot for YouTube.' });
  } else if (totalMin > 40) {
    negatives.push({ category: 'Format', icon: '⏰', title: `Very long format: ${duration.formatted}`, detail: 'Long videos require near-perfect audience retention to succeed.' });
  } else if (totalMin < 3 && views > 1000) {
    negatives.push({ category: 'Format', icon: '⚡', title: `Very short video: ${duration.formatted}`, detail: 'Short non-Shorts videos accumulate little total watch time.' });
  }

  return { positives, negatives };
}

export function scoreVideoUnified(video, channelVideos, oauthMetrics = null, niche = null) {
  const stats    = video.statistics || {};
  const views    = parseInt(stats.viewCount    || 0);
  const likes    = parseInt(stats.likeCount    || 0);
  const comments = parseInt(stats.commentCount || 0);
  const pub      = video.snippet?.publishedAt;
  const duration = parseDuration(video.contentDetails?.duration);
  const subscribers = parseInt(video._channelStats?.subscriberCount || 1);

  const format  = classifyFormat(video);
  const isShort = format === 'short';
  const ageH    = pub ? Math.max(1, (Date.now() - new Date(pub).getTime()) / 3_600_000) : 1;
  const vph     = views / ageH;

  const likeRate    = views > 0 ? (likes    / views * 100) : 0;
  const commentRate = views > 0 ? (comments / views * 100) : 0;
  const engRate     = views > 0 ? ((likes + comments) / views * 100) : 0;
  const viewsPerSub = subscribers > 0 ? views / subscribers : 0;

  const baseline = buildBaseline(channelVideos, format, video.id);

  // m-values — hoisted so engagementQuality can reference them
  const mViews   = baseline?.medianViews       ?? 0;
  const mLike    = baseline?.medianLikeRate    ?? 0;
  const mComment = baseline?.medianCommentRate ?? 0;
  const mVph     = baseline?.medianVph         ?? 0;
  const mEng     = baseline?.medianEngRate     ?? 0;

  // Step 2: base signal trust from volume
  let signalTrust = computeSignalTrust(views, likes, comments);
  const lowSample = views < 1000 || comments < 5 || likes < 20;

  const viewsRatio   = mViews   > 0 ? views       / mViews   : 1;
  const likeRatio    = mLike    > 0 ? likeRate    / mLike    : 1;
  const commentRatio = mComment > 0 ? commentRate / mComment : 1;
  const vphRatio     = mVph     > 0 ? vph         / mVph     : 1;
  const engRatio     = mEng     > 0 ? engRate      / mEng     : 1;

  // Signal reliability system
  const sampleLevel      = views < 500  ? 'very_low' : views < 2000 ? 'low' : 'high';
  const lowVolume        = likes < 20 || comments < 5;
  const strongRelative   = likeRatio > 1 && commentRatio > 1;
  const sufficientVolume = likes >= 20 && comments >= 5;
  const strongEngagement = strongRelative && sufficientVolume;
  const signalState      = (strongEngagement && sampleLevel === 'high') ? 'CONFIRMED'
    : strongRelative ? 'EARLY'
    : 'WEAK';

  // Step 3: engagement quality detection
  const isLowReach        = views < 500;
  const suspiciousDensity = (likes >= 5 || comments >= 3) && isLowReach;
  const lowDiscussion     = comments > 0 && comments < 5;
  const passiveEngagement = likeRate > mLike && commentRate < mComment;
  const engagementQuality = (suspiciousDensity && (lowDiscussion || passiveEngagement))
    ? 'LOW' : 'NORMAL';

  // Step 4: apply quality modifier to signalTrust
  if (engagementQuality === 'LOW') signalTrust *= 0.7;

  const hasOAuth = !!oauthMetrics;
  const mode = hasOAuth ? 'oauth' : 'public';
  const weightKey = `${format}_${mode}`;
  const w = WEIGHTS[weightKey] || WEIGHTS.long_public;

  const nicheBaseline = getBaseline(niche);

  // Velocity score: ratio of this video's VPH to channel median VPH
  const velocityScore = clamp(Math.round(vphRatio * 50), 0, 100);

  // Engagement score
  let engagementScore;
  if (hasOAuth) {
    const ctr      = oauthMetrics.ctr || 0;
    const retRate  = oauthMetrics.avgViewDuration && oauthMetrics.videoLength
      ? oauthMetrics.avgViewDuration / oauthMetrics.videoLength
      : 0.5;
    const ctrBase  = oauthMetrics.channelAvgCtr || nicheBaseline.ctr || 4.5;
    const ctrRatio = clamp(ctr / Math.max(ctrBase, 0.001), 0, 2);
    const retRatio = clamp(retRate, 0, 1);
    const likeR    = clamp(likeRatio, 0, 2);
    const commentR = clamp(commentRatio, 0, 2);
    engagementScore = clamp(Math.round(
      (likeR * 0.20 + commentR * 0.15 + ctrRatio * 0.30 + retRatio * 0.35) * 100
    ), 0, 100);
  } else {
    const likeR    = clamp(likeRatio, 0, 2);
    const commentR = clamp(commentRatio, 0, 2);
    engagementScore = clamp(Math.round((likeR * 0.60 + commentR * 0.40) * 50), 0, 100);
  }

  // Apply signal trust to engagement (not velocity)
  engagementScore = clamp(Math.round(engagementScore * signalTrust + 50 * (1 - signalTrust)), 0, 100);

  // Discussion score
  const commentToLikeRatio = likes > 0 ? comments / likes : 0;
  const baseCtlRatio = nicheBaseline.commentRate / Math.max(nicheBaseline.likeRate, 0.001);
  let discussionScore = clamp(
    Math.round((commentToLikeRatio / Math.max(baseCtlRatio, 0.001)) * 50),
    0, 100
  );
  discussionScore = clamp(Math.round(discussionScore * signalTrust + 50 * (1 - signalTrust)), 0, 100);

  // Step 7: velocity vs engagement mismatch
  const velocityHigh   = velocityScore >= 60;
  const velocityLow    = velocityScore < 60;
  const engagementHigh = engagementScore >= 60;
  const engagementLow  = engagementScore < 60;
  const mismatch = (velocityHigh && engagementLow)  ? 'WEAK_CONTENT'
    : (velocityLow  && engagementHigh) ? 'UNDER_DISTRIBUTED'
    : (velocityHigh && engagementHigh) ? 'ALIGNED'
    : 'NO_SIGNAL';

  const finalScore = clamp(Math.round(
    velocityScore   * w.velocity  +
    engagementScore * w.engagement +
    discussionScore * w.discussion
  ), 0, 100);

  const grade = gradeFromScore(finalScore);

  const baselineConf  = baseline?.confidence || 'LOW';
  const confidence    = mode === 'oauth' ? 'HIGH' : baselineConf;
  const confidenceScore = confidence === 'HIGH' ? 90 : confidence === 'MEDIUM' ? 75 : 55;

  const { type: videoType, videoAgeDays } = classifyVideo({
    views,
    publishedAt:            pub,
    channelAvgViews:        mViews,
    viewsPerHour:           vph,
    channelAvgViewsPerHour: mVph,
  });

  const { positives, negatives } = buildPerformanceInsights(
    { viewsRatio, likeRatio, commentRatio, vphRatio, engRatio },
    { views, likeRate, commentRate },
    duration
  );

  const oauthDisplay = hasOAuth ? {
    ctr:             oauthMetrics.ctr ?? null,
    retentionRate:   (oauthMetrics.avgViewDuration ?? 0) / Math.max(oauthMetrics.videoLength ?? 1, 1),
    avgViewDuration: oauthMetrics.avgViewDuration ?? null,
    impressions:     oauthMetrics.impressions ?? null,
  } : null;

  const dimensionScores = { engagement: engagementScore, velocity: velocityScore, discussion: discussionScore };

  return {
    scores: { ...dimensionScores, finalScore, grade },
    ratios: { viewsRatio, likeRatio, commentRatio, vphRatio, engRatio },
    baseline: {
      medianViews:       mViews,
      medianLikeRate:    mLike,
      medianCommentRate: mComment,
      medianVph:         mVph,
      medianEngRate:     mEng,
      sampleSize:        baseline?.sampleSize ?? 0,
      confidence:        baselineConf,
    },
    metrics: {
      views, likes, comments,
      likeRate, commentRate, engagementRate: engRate,
      viewsPerSub, duration,
      viewsRatio, engRatio,
    },
    videoType,
    videoAgeDays,
    format,
    mode,
    confidence,
    confidenceScore,
    signalTrust,
    lowSample,
    sampleLevel,
    lowVolume,
    signalState,
    engagementQuality,
    mismatch,
    analysis: { positives, negatives },
    channelAvg: {
      views:       mViews,
      engagement:  mEng,
      likeRate:    mLike,
      commentRate: mComment,
    },
    oauthDisplay,
    dimensionScores,
    viralScore: finalScore,
    grade,
    dimensionConfidence: {
      engagement: confidence,
      velocity:   confidence,
      discussion: isShort ? 'low' : confidence,
    },
  };
}
