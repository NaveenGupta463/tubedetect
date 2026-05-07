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
    baselineQuality: sampleSize >= 15 ? 'HIGH' : sampleSize >= 8 ? 'MEDIUM' : 'LOW',
    baselineTier:    sampleSize <= 1 ? 'NONE' : sampleSize <= 4 ? 'LOW' : sampleSize <= 10 ? 'MEDIUM' : 'HIGH',
  };
}

function computeSignalTrust(views, likes) {
  let trust;
  if (views < 1_000)       trust = 0.3;
  else if (views < 10_000)  trust = 0.6;
  else if (views < 100_000) trust = 0.85;
  else if (views < 1_000_000) trust = 0.95;
  else trust = 1.0;
  if (likes < 20) trust *= 0.85;
  return trust;
}

function getCommentState({ comments, views, ageH }) {
  if (comments === 0 && views >= 50_000) return 'RESTRICTED_OR_KIDS';
  if (comments < 10 && ageH < 6)        return 'TOO_EARLY';
  if (comments < 10 && views > 50_000)  return 'ANOMALY_LOW_ENGAGEMENT';
  return 'NORMAL';
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

function buildExplanation({
  views, likes, comments,
  viewsRatio, likeRatio, commentRatio,
  mViews, mLike, mComment,
  confidence, engagementAuthenticity, signalState, mismatch,
  engagementQuality, finalScore,
  suspiciousCaseA, suspiciousCaseB, suspiciousCaseC,
  noBaseline, baselineTier,
  lowSample, trustState,
  commentState, ignoreCommentMetrics,
}) {
  // summary.score — keyed entirely to trustState
  const scoreSummary = {
    LOW_CONFIDENCE: 'Insufficient data — patterns not established',
    EARLY_SIGNAL:   'Early signal detected — not yet confirmed',
    CONFLICTED:     'Conflicting performance signals detected',
    CONFIRMED:      'Strong and consistent performance signals',
  }[trustState] ?? 'Insufficient data — patterns not established';

  // summary.confidence
  let confidenceSummary;
  if (baselineTier === 'NONE') {
    confidenceSummary = 'No channel baseline — insights are highly uncertain';
  } else if (baselineTier === 'LOW') {
    confidenceSummary = 'Limited channel history — insights are directional only';
  } else if (confidence === 'HIGH') {
    confidenceSummary = 'High confidence — signals are stable and data volume is sufficient';
  } else if (confidence === 'MEDIUM') {
    confidenceSummary = 'Moderate confidence — early signals, monitor for changes';
  } else {
    confidenceSummary = 'Low confidence — signals are insufficient for reliable conclusions';
  }

  // summary.authenticity
  const authenticitySummary = {
    SUSPICIOUS:  'Engagement pattern mismatch — signals may not reflect real audience behavior',
    UNVERIFIED:  'Insufficient data to validate engagement authenticity',
    AUTHENTIC:   'Engagement signals align with expected channel patterns',
  }[engagementAuthenticity] ?? 'Insufficient data to validate engagement authenticity';

  // performanceReasons
  const performanceReasons = [];
  if (mViews > 0) {
    const pct = Math.round(viewsRatio * 100);
    if (pct >= 150) performanceReasons.push(`Views are ${pct}% of channel average — above-average reach`);
    else if (pct >= 80) performanceReasons.push(`Views are ${pct}% of channel average — near channel norm`);
    else performanceReasons.push(`Views are ${pct}% of channel average — below channel norm`);
  }
  if (mLike > 0) {
    const suffix = lowSample ? ' (low sample — unreliable)' : '';
    if (likeRatio >= 1.2) performanceReasons.push(`Like rate is ${likeRatio.toFixed(2)}× the channel baseline${suffix}`);
    else if (likeRatio < 0.8) performanceReasons.push(`Like rate is below channel baseline (${likeRatio.toFixed(2)}×)${suffix}`);
  }
  if (mComment > 0 && !ignoreCommentMetrics) {
    const suffix = lowSample ? ' (low sample — unreliable)' : '';
    if (commentRatio >= 1.2) performanceReasons.push(`Comment rate is ${commentRatio.toFixed(2)}× the channel baseline${suffix}`);
    else if (commentRatio < 0.8) performanceReasons.push(`Comment rate is below channel baseline (${commentRatio.toFixed(2)}×)${suffix}`);
  }
  if (lowSample) performanceReasons.push('Engagement ratios may be unreliable due to limited data (<1,000 views)');
  if (mismatch === 'WEAK_CONTENT') performanceReasons.push('Velocity is high but engagement is low — reach is not converting');
  if (mismatch === 'UNDER_DISTRIBUTED') performanceReasons.push('Engagement is strong but reach is limited — distribution gap detected');

  // confidenceReasons
  const confidenceReasons = [];
  if (baselineTier === 'NONE') {
    confidenceReasons.push('No channel baseline available — insights are highly uncertain');
  } else if (baselineTier === 'LOW') {
    confidenceReasons.push('Limited channel history — insights are directional, not validated');
  }
  if (lowSample) confidenceReasons.push('Insufficient sample — fewer than 1,000 views');
  if (commentState === 'RESTRICTED_OR_KIDS') confidenceReasons.push('Comments unavailable — analysis based on behavioral signals only');
  else if (commentState === 'TOO_EARLY') confidenceReasons.push('Early signal — comment data not yet available');
  if (engagementQuality === 'LOW') confidenceReasons.push('Engagement quality flag — signals may not reflect real audience behavior');
  if (trustState === 'EARLY_SIGNAL') confidenceReasons.push('Engagement inconsistency detected — treating as early signal, not confirmed pattern');
  if (trustState === 'CONFLICTED') confidenceReasons.push('Performance signals contradict each other — overall reliability is reduced');

  // authenticityReasons
  const authenticityReasons = [];
  if (engagementAuthenticity === 'SUSPICIOUS') {
    if (suspiciousCaseA) authenticityReasons.push('High velocity but weak engagement — distribution is not converting to audience connection');
    if (suspiciousCaseB) authenticityReasons.push('Likes high but comments disproportionately low — shallow engagement pattern');
    if (suspiciousCaseC) authenticityReasons.push('Extreme imbalance between like and comment rates — unusual engagement pattern');
  } else if (engagementAuthenticity === 'UNVERIFIED') {
    authenticityReasons.push('Engagement ratios may be unreliable due to limited data');
    if (views < 1000) authenticityReasons.push('Under 1,000 views — insufficient to validate engagement patterns');
  } else {
    authenticityReasons.push('No suspicious engagement patterns detected');
    authenticityReasons.push('Data volume meets minimum threshold for pattern validation');
  }

  // interpretation — keyed to trustState
  const interpretation = noBaseline
    ? 'No channel baseline available — performance cannot be compared against channel history'
    : ({
        LOW_CONFIDENCE: 'This video has not yet accumulated enough data to establish reliable patterns',
        EARLY_SIGNAL:   'Engagement inconsistency detected — treat as an early signal, not a confirmed pattern',
        CONFLICTED:     'Performance signals are contradictory — this tension should be investigated rather than resolved prematurely',
        CONFIRMED:      'Strong and consistent signals suggest reliable performance patterns',
      }[trustState] ?? 'This video has not yet accumulated enough data to establish reliable patterns');

  // actionHint — still mismatch/state driven for actionability
  let actionHint;
  if (noBaseline || lowSample) {
    actionHint = 'Allow more data to accumulate before making decisions';
  } else if (mismatch === 'WEAK_CONTENT') {
    actionHint = 'Review hook and content structure to improve engagement';
  } else if (mismatch === 'UNDER_DISTRIBUTED') {
    actionHint = 'Focus on distribution — promote within the first 24 hours';
  } else if (signalState === 'WEAK') {
    actionHint = 'Improve thumbnail and title to increase reach';
  } else if (trustState === 'CONFIRMED') {
    actionHint = 'Scale what is working — publish related content to build on momentum';
  } else if (signalState === 'EARLY') {
    actionHint = 'Monitor performance over the next 48–72 hours';
  } else {
    actionHint = 'Run AI analysis for deeper content-specific recommendations';
  }

  return {
    summary: { score: scoreSummary, confidence: confidenceSummary, authenticity: authenticitySummary },
    performanceReasons,
    confidenceReasons,
    authenticityReasons,
    interpretation,
    actionHint,
  };
}

export function coreScore({ views, channel_avg_views, like_rate, channel_avg_like_rate, comment_rate, channel_avg_comment_rate }) {
  const V_score = channel_avg_views        > 0 ? views        / channel_avg_views        : 0;
  const L_score = channel_avg_like_rate    > 0 ? like_rate    / channel_avg_like_rate    : 0;
  const C_score = channel_avg_comment_rate > 0 ? comment_rate / channel_avg_comment_rate : 0;

  let state;
  if (V_score > 2.5) {
    state = 'VIRAL';
  } else if (V_score >= 0.7 && V_score <= 2.5 && L_score >= 1 && C_score >= 1) {
    state = 'STRONG';
  } else if (V_score >= 0.7 && V_score <= 2.5 && (L_score < 1 || C_score < 1)) {
    state = 'LIMITED';
  } else if (V_score < 0.7 && (L_score >= 1 || C_score >= 1)) {
    state = 'LIMITED';
  } else {
    state = 'WEAK';
  }

  const leak = V_score > 2.5 && (L_score < 1 || C_score < 1);

  const leak_intensity = !leak ? 'NONE' : V_score > 5 ? 'HIGH' : 'MEDIUM';

  const reliability = views < 0.3 * channel_avg_views ? 'LOW'
    : views < channel_avg_views ? 'MEDIUM'
    : 'HIGH';

  let final_state;
  if (state === 'VIRAL' && leak === true) {
    final_state = leak_intensity === 'HIGH' ? 'CRITICAL_LEAK' : 'LEAKING_VIRAL';
  } else if (state === 'VIRAL' && leak === false) {
    final_state = 'CONFIRMED_VIRAL';
  } else if (state === 'STRONG') {
    final_state = 'CONFIRMED_STRONG';
  } else if (state === 'LIMITED') {
    final_state = 'EARLY_OR_BLOCKED';
  } else {
    final_state = 'WEAK';
  }

  return {
    state,
    final_state,
    leak,
    leak_intensity,
    reliability,
    scores: { V_score, L_score, C_score },
  };
}

export function buildPerformanceInsights(ratios, metrics, duration, ignoreCommentMetrics = false) {
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
  } else if (!ignoreCommentMetrics && views > 5000 && commentRate < 0.02) {
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
  const ageH       = pub ? Math.max(1, (Date.now() - new Date(pub).getTime()) / 3_600_000) : 1;
  const isEarlyStage = ageH < 24;
  const vph        = views / ageH;

  const likeRate    = views > 0 ? (likes    / views * 100) : 0;
  const commentRate = views > 0 ? (comments / views * 100) : 0;
  const engRate     = views > 0 ? ((likes + comments) / views * 100) : 0;
  const viewsPerSub = subscribers > 0 ? views / subscribers : 0;

  const baseline    = buildBaseline(channelVideos, format, video.id);
  const baselineTier = baseline?.baselineTier ?? 'NONE';
  const noBaseline   = baselineTier === 'NONE' || baselineTier === 'LOW';

  // m-values — hoisted so engagementQuality can reference them
  const mViews   = baseline?.medianViews       ?? 0;
  const mLike    = baseline?.medianLikeRate    ?? 0;
  const mComment = baseline?.medianCommentRate ?? 0;
  const mVph     = baseline?.medianVph         ?? 0;
  const mEng     = baseline?.medianEngRate     ?? 0;

  // Step 2: base signal trust from volume
  const commentState = getCommentState({ comments, views, ageH });
  const ignoreCommentMetrics = commentState === 'RESTRICTED_OR_KIDS';
  let signalTrust = computeSignalTrust(views, likes);
  if (commentState === 'TOO_EARLY')              signalTrust *= 0.7;
  else if (commentState === 'ANOMALY_LOW_ENGAGEMENT') signalTrust *= 0.4;
  const lowSample = views < 1000;

  const viewsRatio   = mViews   > 0 ? views       / mViews   : 1;
  const likeRatio    = mLike    > 0 ? likeRate    / mLike    : 1;
  const commentRatio = mComment > 0 ? commentRate / mComment : 1;
  const vphRatio     = mVph     > 0 ? vph         / mVph     : 1;
  const engRatio     = mEng     > 0 ? engRate      / mEng     : 1;

  // Signal reliability system
  const sampleLevel      = views < 500  ? 'very_low' : views < 2000 ? 'low' : 'high';
  const lowVolume        = likes < 20 || (!ignoreCommentMetrics && comments < 5);
  const strongRelative   = likeRatio > 1 && (ignoreCommentMetrics || commentRatio > 1);
  const sufficientVolume = likes >= 20 && (ignoreCommentMetrics || comments >= 5);
  const strongEngagement = strongRelative && sufficientVolume;
  const signalState      = (strongEngagement && sampleLevel === 'high') ? 'CONFIRMED'
    : strongRelative ? 'EARLY'
    : 'WEAK';

  // Step 3: engagement quality detection
  const isLowReach        = views < 500;
  const suspiciousDensity = (likes >= 5 || comments >= 3) && isLowReach;
  const lowDiscussion     = !ignoreCommentMetrics && comments > 0 && comments < 5;
  const passiveEngagement = !ignoreCommentMetrics && likeRate > mLike && commentRate < mComment;
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
    const commentR = ignoreCommentMetrics ? 1 : clamp(commentRatio, 0, 2);
    engagementScore = clamp(Math.round((likeR * 0.60 + commentR * 0.40) * 50), 0, 100);
  }

  // Apply signal trust to engagement (not velocity)
  engagementScore = clamp(Math.round(engagementScore * signalTrust + 50 * (1 - signalTrust)), 0, 100);

  // Discussion score
  let discussionScore;
  if (ignoreCommentMetrics) {
    discussionScore = 50;
  } else {
    const commentToLikeRatio = likes > 0 ? comments / likes : 0;
    const baseCtlRatio = nicheBaseline.commentRate / Math.max(nicheBaseline.likeRate, 0.001);
    discussionScore = clamp(
      Math.round((commentToLikeRatio / Math.max(baseCtlRatio, 0.001)) * 50),
      0, 100
    );
    discussionScore = clamp(Math.round(discussionScore * signalTrust + 50 * (1 - signalTrust)), 0, 100);
  }

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

  const baselineConf = baseline?.baselineQuality || 'LOW';

  // Step 8: base confidence from view volume
  let confidence = (commentState === 'RESTRICTED_OR_KIDS' || views > 100_000) ? 'HIGH'
    : views > 10_000 ? 'MEDIUM'
    : 'LOW';
  if (engagementQuality === 'LOW') confidence = 'LOW';

  // Step 9: engagement authenticity detection
  const suspiciousCaseA = velocityScore > 70 && engagementScore < 40;
  const suspiciousCaseB = !ignoreCommentMetrics && likeRatio > 1.2 && commentRatio > 1.2 && likes < 30;
  const suspiciousCaseC = !ignoreCommentMetrics && ((likeRatio > 1.5 && commentRatio < 0.7) || (commentRatio > 1.5 && likeRatio < 0.7));
  const isSuspicious = suspiciousCaseA || suspiciousCaseB || suspiciousCaseC;

  const engagementAuthenticity = lowSample    ? 'UNVERIFIED'
    : isSuspicious ? 'SUSPICIOUS'
    : 'AUTHENTIC';

  const hasMismatch = mismatch === 'WEAK_CONTENT' || mismatch === 'UNDER_DISTRIBUTED';
  const trustState  = (lowSample && !hasMismatch)            ? 'LOW_CONFIDENCE'
    : (lowSample && hasMismatch)               ? 'EARLY_SIGNAL'
    : (!lowSample && hasMismatch)              ? 'CONFLICTED'
    : (!lowSample && mismatch === 'ALIGNED')   ? 'CONFIRMED'
    : 'LOW_CONFIDENCE';

  // Step 9b: authenticity + baseline tier override confidence
  if (engagementAuthenticity === 'SUSPICIOUS') {
    confidence = 'LOW';
  }
  if (baselineTier === 'NONE') {
    confidence = 'LOW';
  } else if (baselineTier === 'LOW' && confidence === 'HIGH') {
    confidence = 'MEDIUM';
  }

  const explanation = buildExplanation({
    views, likes, comments,
    viewsRatio, likeRatio, commentRatio,
    mViews, mLike, mComment,
    confidence, engagementAuthenticity, signalState, mismatch,
    engagementQuality, finalScore,
    suspiciousCaseA, suspiciousCaseB, suspiciousCaseC,
    noBaseline, baselineTier,
    lowSample, trustState,
    commentState, ignoreCommentMetrics,
  });

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
    duration,
    ignoreCommentMetrics
  );

  const oauthDisplay = hasOAuth ? {
    ctr:             oauthMetrics.ctr ?? null,
    retentionRate:   (oauthMetrics.avgViewDuration ?? 0) / Math.max(oauthMetrics.videoLength ?? 1, 1),
    avgViewDuration: oauthMetrics.avgViewDuration ?? null,
    impressions:     oauthMetrics.impressions ?? null,
  } : null;

  const dimensionScores = { engagement: engagementScore, velocity: velocityScore, discussion: discussionScore };

  const { final_state: rawFinalState, leak, leak_intensity, reliability } = coreScore({
    views,
    channel_avg_views:        mViews,
    like_rate:                likeRate,
    channel_avg_like_rate:    mLike,
    comment_rate:             ignoreCommentMetrics ? mComment : commentRate,
    channel_avg_comment_rate: mComment,
  });

  let final_state = rawFinalState;

  // Strong engagement override — absolute thresholds beat ratio-based weak/blocked classification
  if (
    engRate >= 6 && likeRate >= 3 && comments >= 200 &&
    rawFinalState !== 'CONFIRMED_VIRAL' && rawFinalState !== 'LEAKING_VIRAL' && rawFinalState !== 'CRITICAL_LEAK'
  ) {
    final_state = 'CONFIRMED_STRONG';
  }

  // Early-stage guard — respect strong signals, avoid distribution diagnosis without sufficient data
  if (isEarlyStage && final_state !== 'CONFIRMED_STRONG') {
    const hasStrongSignals = comments >= 200 || engRate >= 6;
    final_state = hasStrongSignals ? 'EARLY_OR_BLOCKED' : 'INSUFFICIENT_DATA';
  }

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
      baselineQuality:   baselineConf,
      baselineTier,
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
    signalTrust,
    lowSample,
    sampleLevel,
    lowVolume,
    signalState,
    commentState,
    ignoreCommentMetrics,
    engagementQuality,
    engagementAuthenticity,
    mismatch,
    hasMismatch,
    trustState,
    noBaseline,
    final_state,
    leak,
    leak_intensity,
    reliability,
    explanation,
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
