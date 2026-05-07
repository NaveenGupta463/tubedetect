// ─────────────────────────────────────────────────────────────────────────────
// Content Format Detection — multi-signal classifier
// Priority: behavioral overrides → behavior score → category → channel → keywords
// Learning layer runs after full scoring as a soft additive adjustment.
// ─────────────────────────────────────────────────────────────────────────────

import { getBehaviorBaselines } from './learningEngine';

function extractMetrics(video) {
  const stats    = video?.statistics || {};
  const views    = parseInt(stats.viewCount    || 0);
  const likes    = parseInt(stats.likeCount    || 0);
  const comments = parseInt(stats.commentCount || 0);
  return {
    views,
    likeRate:       views ? (likes    / views) * 100 : 0,
    commentRate:    views ? (comments / views) * 100 : 0,
    engagementRate: views ? ((likes + comments) / views) * 100 : 0,
  };
}

// ── Hard behavioral overrides (highest priority) ───────────────────────────
function isStrongMusicPattern(m) {
  return (
    m.views > 5000 &&
    m.likeRate > 2 &&
    m.commentRate < 0.2 &&
    (m.likeRate / (m.commentRate + 0.01)) > 20
  );
}

function isStrongPassivePattern(m) {
  return (
    m.views > 5000 &&
    m.commentRate < 0.1 &&
    m.likeRate < 2
  );
}

// ── Weighted scoring layers ────────────────────────────────────────────────

function applyBehaviorScore(scores, m) {
  if (m.likeRate / (m.commentRate + 0.01) > 15) {
    scores.MUSIC_SEARCH += 35;
  }
  if (m.commentRate > 0.5 && m.engagementRate > 3) {
    scores.CREATOR += 35;
  }
  if (m.commentRate < 0.1) {
    scores.PASSIVE += 20;
  }
}

function applyCategoryScore(scores, video) {
  // YouTube categoryId is returned as a string from the API
  const cat = String(video?.snippet?.categoryId || '');
  switch (cat) {
    case '10': // Music
      scores.MUSIC_SEARCH += 30;
      scores.MUSIC_PROMO  += 20;
      break;
    case '24': // Entertainment
    case '23': // Comedy
      scores.ENTERTAINMENT += 30;
      break;
    case '27': // Education
    case '26': // Howto & Style
    case '28': // Science & Technology
      scores.CREATOR += 30;
      break;
    case '22': // People & Blogs
    case '20': // Gaming
      scores.CREATOR += 20;
      break;
    default:
      scores.CREATOR += 10;
  }
}

function applyChannelScore(scores, channel, video) {
  // Try multiple paths — channelStats only has statistics, so fallback to video snippet
  const name = (
    channel?.snippet?.title   ||
    channel?.title            ||
    video?.snippet?.channelTitle ||
    ''
  ).toLowerCase();

  if (/vevo|records|music|official|label|audio/.test(name)) {
    scores.MUSIC_SEARCH += 20;
    scores.MUSIC_PROMO  += 15;
  }
  if (/yoga|meditation|asmr|lofi|wellness|calm/.test(name)) {
    scores.PASSIVE += 20;
  }
  if (/comedy|roast|meme|funny/.test(name)) {
    scores.ENTERTAINMENT += 15;
  }
}

function applyKeywordScore(scores, video) {
  const title = (video?.snippet?.title       || '').toLowerCase();
  const desc  = (video?.snippet?.description || '').toLowerCase();
  const tags  = (video?.snippet?.tags        || []).join(' ').toLowerCase();
  const text  = title + ' ' + desc + ' ' + tags;

  if (/lyrics|karaoke|bhajan|audio|bhakti|aarti|devotional|song/.test(text)) {
    scores.MUSIC_SEARCH += 10;
  }
  if (/official video|official audio|new song|music video/.test(text)) {
    scores.MUSIC_PROMO += 10;
  }
  if (/meditation|relax|sleep|lofi|lo-fi|asmr/.test(text)) {
    scores.PASSIVE += 10;
  }
  if (/tutorial|how to|review|guide|tips/.test(text)) {
    scores.CREATOR += 10;
  }
  if (/funny|comedy|meme|prank|reaction/.test(text)) {
    scores.ENTERTAINMENT += 10;
  }
}

function getHighestScore(scores) {
  return Object.entries(scores).reduce(
    (best, [type, score]) => score > best.score ? { type, score } : best,
    { type: 'CREATOR', score: -1 }
  );
}

// ── Learning adjustment (soft, additive, runs after full scoring) ─────────
function applyLearningAdjustment(scores, m, baseline) {
  if (!baseline) return scores;
  const adjusted = { ...scores };
  if (m.commentRate < 0.2 && baseline.avgCommentRate < 0.2) {
    adjusted.MUSIC_SEARCH = (adjusted.MUSIC_SEARCH || 0) + 5;
  }
  return adjusted;
}

// ── Main exported detection function ──────────────────────────────────────
export function detectContentFormat(video, channel) {
  const metrics  = extractMetrics(video);
  const baseline = getBehaviorBaselines(); // fetched once, shared below

  if (isStrongMusicPattern(metrics)) {
    return { type: 'MUSIC_SEARCH', confidence: 'HIGH' };
  }
  if (isStrongPassivePattern(metrics)) {
    return { type: 'PASSIVE', confidence: 'HIGH' };
  }

  const scores = {
    MUSIC_SEARCH:  0,
    MUSIC_PROMO:   0,
    PASSIVE:       0,
    ENTERTAINMENT: 0,
    CREATOR:       0,
  };

  applyBehaviorScore(scores, metrics);
  applyCategoryScore(scores, video);
  applyChannelScore(scores, channel, video);
  applyKeywordScore(scores, video);

  scores.CREATOR += 5; // safe tiebreaker

  // Learning adjustment runs after full scoring so all signals are visible
  const adjustedScores = applyLearningAdjustment(scores, metrics, baseline);

  const winner = getHighestScore(adjustedScores);

  let confidence =
    winner.score > 60 ? 'HIGH'   :
    winner.score > 35 ? 'MEDIUM' :
    'LOW';

  if (confidence === 'LOW') {
    return { type: 'CREATOR', confidence: 'LOW' };
  }

  // Scoped confidence boost: only MUSIC_SEARCH borderline cases (MEDIUM → HIGH)
  if (baseline && winner.type === 'MUSIC_SEARCH' && winner.score > 55 && confidence === 'MEDIUM') {
    confidence = 'HIGH';
  }

  return { type: winner.type, confidence };
}

// ── Interpretation overrides ───────────────────────────────────────────────
export function getInterpretationOverrides(format) {
  switch (format) {
    case 'PASSIVE':
      return {
        ignoreComments: true,
        ctaExpected:    false,
        engagementNote: 'Low interaction is normal for passive content',
      };
    case 'MUSIC_SEARCH':
      return {
        ignoreComments: true,
        titleImmutable: true,
        ctaExpected:    false,
        engagementNote: 'Search-driven music relies on discovery, not interaction',
      };
    case 'MUSIC_PROMO':
      return {
        ctaExpected:    true,
        engagementNote: 'Audience interaction helps push new music',
      };
    default:
      return {};
  }
}

// ── Fix action filter (for VideoAnalysis fix cards) ────────────────────────
export function filterActions(actions, contentFormat) {
  if (!actions || contentFormat?.confidence === 'LOW') return actions;

  return actions.filter(action => {
    if (contentFormat.type === 'MUSIC_SEARCH') {
      return action.dimension !== 'packaging';
    }
    if (contentFormat.type === 'PASSIVE') {
      return action.dimension !== 'engagement';
    }
    return true;
  });
}

// ── Allowed checklist keys for ImproveHub ──────────────────────────────────
export function getAllowedChecklistKeys(contentFormat) {
  if (contentFormat?.type === 'MUSIC_SEARCH') return ['thumbnail', 'seo'];
  if (contentFormat?.type === 'PASSIVE')      return ['thumbnail', 'seo'];
  return ['title', 'thumbnail', 'seo', 'cta'];
}
