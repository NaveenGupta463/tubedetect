'use strict';

// ── Narrative type ─────────────────────────────────────────────────────────────
// 'event'      — discrete, one-time occurrence. Strict death, no revival.
//                Example: exam paper analysis, IPL final.
// 'news_event' — ongoing geopolitical/political story. Can revive after silence.
//                Example: Trump: Strikes Iran, Russia: Ukraine War.

function getNarrativeType(niche) {
  return /upsc|exam|neet|ssc|jee|preparation|ias/.test(niche) ? 'event' : 'news_event';
}

// ── Expiry lifespan by parent topic ───────────────────────────────────────────
const TOPIC_LIFESPAN_DAYS = {
  'Geopolitics':       { event: 3, news_event: 5  },
  'Politics':          { event: 3, news_event: 7  },
  'Economy & Finance': { event: 2, news_event: 4  },
  'Competitive Exams': { event: 5, news_event: 5  },
  'Sports':            { event: 1, news_event: 3  },
  'Judiciary & Law':   { event: 5, news_event: 10 },
  'Society & Health':  { event: 3, news_event: 6  },
  'Science & Tech':    { event: 2, news_event: 5  },
};

function computeExpiry(firstSeenAt, parentTopic, narrativeType) {
  if (!firstSeenAt) return null;
  const lifespan = (TOPIC_LIFESPAN_DAYS[parentTopic] || { event: 3, news_event: 5 })[narrativeType] || 4;
  const d = new Date(firstSeenAt);
  d.setDate(d.getDate() + lifespan);
  return d.toISOString().split('T')[0];
}

// ── Stage classifier ───────────────────────────────────────────────────────────
// States: seed → emerging → peak → saturated → decay → dead
//                                                dead ↔ revived  (news_event only)

function classifyStage(signals, prevStage, narrativeType) {
  const { age_hours, channel_count, velocity, pub_rate_recent, pub_rate_prior, saturation_pct } = signals;

  // Revival: was dead, now has a publication burst (≥2 new titles in last 24h)
  if (prevStage === 'dead' && narrativeType === 'news_event' && pub_rate_recent >= 2) {
    return 'revived';
  }

  // Revived can decay back to dead if burst fades
  if (prevStage === 'revived' && pub_rate_recent === 0) {
    return 'dead';
  }

  const noRecentPubs = pub_rate_recent === 0 && age_hours > 72;
  const overdead     = saturation_pct > 90 && age_hours > 120;
  if (noRecentPubs || overdead) return 'dead';

  const collapse_ratio = pub_rate_recent / Math.max(0.1, pub_rate_prior);

  if (age_hours < 36 && channel_count < 3)        return 'seed';
  if (age_hours < 72 && velocity > 0)              return 'emerging';
  if (saturation_pct > 70 && velocity <= 0)        return 'saturated';
  if (collapse_ratio < 0.6 && age_hours > 48)      return 'decay';
  return 'peak';
}

// ── Window score (0–100) ──────────────────────────────────────────────────────
const STAGE_BASE_SCORE = {
  seed:      100,
  emerging:   85,
  peak:       60,
  revived:    80,
  saturated:  25,
  decay:      10,
  dead:        0,
};

function computeWindowScore(stage, saturation_pct, velocity) {
  const base     = STAGE_BASE_SCORE[stage] ?? 0;
  const satPen   = saturation_pct * 0.3;
  const velBonus = velocity > 1 ? 10 : 0;
  return Math.max(0, Math.min(100, Math.round(base - satPen + velBonus)));
}

// ── Act-now confidence (0–100, or 0 = suppress) ───────────────────────────────
function computeActNowConf(stage, window_score, saturation_pct, velocity, age_hours) {
  if (['dead', 'saturated', 'decay'].includes(stage)) return 0;
  let conf = window_score
    * (1 - saturation_pct / 100)
    * (velocity > 0 ? 1.2 : 1.0)
    * (age_hours < 48 ? 1.1 : 1.0);
  conf = Math.max(0, Math.min(100, Math.round(conf / 5) * 5));
  return conf < 40 ? 0 : conf;
}

module.exports = {
  getNarrativeType,
  computeExpiry,
  classifyStage,
  computeWindowScore,
  computeActNowConf,
  STAGE_BASE_SCORE,
  TOPIC_LIFESPAN_DAYS,
};
