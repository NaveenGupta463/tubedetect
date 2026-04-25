// src/engines/videoClassifier.js
// Classifies a video as SHORT or LONG and routes it to the correct analysis engine.
// Duration is a soft signal only — behavior can override to LONG for sub-180s videos.

import { scoreVideoUnified } from '../scoring/unifiedScoring.js';
import { getInsightMode, generateInsights } from '../scoring/insightsEngine.js';
import { analyzeShort }  from './shortsIntelligenceEngine.js';

// ─── Long pipeline wrapper ────────────────────────────────────────────────────

function mapToLongPipelineInput(video) {
  return {
    views:                  video.views,
    likes:                  video.likes,
    comments:               video.comments,
    duration:               video.duration,
    publishedAt:            video.publishedAt,
    channelAvgViews:        video.channelAvgViews,
    channelAvgViewsPerHour: video.channelAvgViewsPerHour,
    impressions:            video.impressions,
    ctr:                    video.ctr,
  };
}

function runLongPipeline(video) {
  const oauthMetrics = (video.impressions != null && video.ctr != null)
    ? { impressions: video.impressions, ctr: video.ctr, avgViewDuration: video.avgViewDuration }
    : null;
  const videoObj = {
    statistics: { viewCount: video.views, likeCount: video.likes, commentCount: video.comments },
    snippet: { publishedAt: video.publishedAt },
    contentDetails: { duration: `PT${Math.floor(video.duration / 60)}M${video.duration % 60}S` },
  };
  return scoreVideoUnified(videoObj, [], oauthMetrics, video.niche ?? null);
}

// ─── Behavior signal extraction ───────────────────────────────────────────────

function deriveBehaviorSignals(video) {
  const views  = video.views  || 0;
  const likes  = video.likes  || 0;
  const comments = video.comments || 0;

  const likeRate     = views > 0 ? likes    / views    : 0;
  const commentRate  = views > 0 ? comments / views    : 0;
  const safeChAvgVPH = Math.max(video.channelAvgViewsPerHour || 1, 1);
  const velocityRatio = (video.viewsPerHour || 0) / safeChAvgVPH;

  return { likeRate, commentRate, velocityRatio };
}

// ─── Classification logic ─────────────────────────────────────────────────────

function classifyFormat(video) {
  const duration = video.duration || 0;
  const { likeRate, commentRate, velocityRatio } = deriveBehaviorSignals(video);

  // Hard LONG: over 180s with no short behavior signals
  if (duration > 180) {
    const hasShortBehavior = velocityRatio > 1.5 && likeRate > 0.05 && commentRate < 0.02;
    if (!hasShortBehavior) {
      return {
        type: 'LONG', subType: null, confidence: 0.90,
        reasoning: `Duration is ${duration}s and engagement pattern is consistent with long-form content. No short-style velocity or low comment rate detected.`,
      };
    }
  }

  // Under 180s: candidate. Behavior can still push to LONG.
  const looksLong =
    velocityRatio <= 1.0 &&
    commentRate   >  0.02 &&
    likeRate      <  0.03;

  if (looksLong) {
    return {
      type: 'LONG', subType: null, confidence: 0.90,
      reasoning: `Despite duration of ${duration}s, behavior signals match long-form: low velocity ratio (${velocityRatio.toFixed(2)}×), elevated comment rate (${(commentRate * 100).toFixed(2)}%), and low like rate (${(likeRate * 100).toFixed(2)}%).`,
    };
  }

  // SHORT candidate: determine PURE vs HYBRID
  const velocitySpike = velocityRatio > 1.5;
  const highLikeRate  = likeRate > 0.05;
  const lowCommentRate = commentRate < 0.01;

  // OAuth short feed signal overrides everything
  if (video.shortFeedRatio != null && video.shortFeedRatio > 0.6) {
    return {
      type: 'SHORT', subType: 'PURE_SHORT', confidence: 0.90,
      reasoning: `Short feed ratio of ${(video.shortFeedRatio * 100).toFixed(0)}% confirms Shorts distribution. Classified as PURE_SHORT.`,
    };
  }

  if (velocitySpike && (highLikeRate || lowCommentRate)) {
    return {
      type: 'SHORT', subType: 'PURE_SHORT', confidence: video.shortFeedRatio != null ? 0.90 : 0.80,
      reasoning: `Strong short-form behavior: velocity ratio ${velocityRatio.toFixed(2)}×${highLikeRate ? `, like rate ${(likeRate * 100).toFixed(2)}%` : ''}${lowCommentRate ? `, low comment rate ${(commentRate * 100).toFixed(2)}%` : ''}. Classified as PURE_SHORT.`,
    };
  }

  return {
    type: 'SHORT', subType: 'HYBRID_SHORT', confidence: 0.65,
    reasoning: `Duration (${duration}s) is within short candidate range but behavior signals are mixed — velocity ratio ${velocityRatio.toFixed(2)}×, like rate ${(likeRate * 100).toFixed(2)}%. Classified as HYBRID_SHORT.`,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function classifyAndRouteVideo(input) {
  const { videoId, engines = {}, userOverride = false, ...video } = input;

  // Resolve engines: allow injection or fall back to built-ins
  const shortsEngine = engines.shortsIntelligenceEngine ?? analyzeShort;

  const { type, subType, confidence, reasoning } = classifyFormat(video);

  let result;

  if (type === 'SHORT') {
    const shortsInput = {
      videoId,
      version:                video.version ?? 1,
      hasOAuth:               video.hasOAuth ?? false,
      views:                  video.views,
      likes:                  video.likes,
      comments:               video.comments,
      viewsPerHour:           video.viewsPerHour,
      channelAvgViewsPerHour: video.channelAvgViewsPerHour,
      duration:               video.duration,
      publishAgeHours:        video.publishAgeHours,
      retentionCurve:         video.retentionCurve,
      ctr:                    video.ctr,
      impressions:            video.impressions,
      avgViewDuration:        video.avgViewDuration,
      aiInsights:             video.aiInsights ?? {},
      history:                video.history ?? [],
    };
    result = shortsEngine(shortsInput, { mode: subType });
  } else {
    result = runLongPipeline(video);
  }

  return {
    videoId,
    type,
    subType,
    confidence,
    reasoning,
    userOverride,
    result,
  };
}
