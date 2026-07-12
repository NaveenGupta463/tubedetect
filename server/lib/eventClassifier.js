'use strict';

// ── Keyword sets ──────────────────────────────────────────────────────────────
// Checked in priority order: event > news_event > seasonal > recurring.
// Unknown topics default to 'evergreen'.

const EVENT_PHRASES = [
  'election result', 'election results', 'vote count', 'vote counting',
  'exit poll', 'assembly election', 'lok sabha election', 'state election',
  'general election', 'bypoll', 'by-election',
  'budget 2024', 'budget 2025', 'budget 2026', 'union budget',
  'ipl final', 'world cup final', 'champions trophy final', 'grand final',
  'finals day', 'match result', 'series result',
  'verdict', 'sentencing', 'judgement day', 'court verdict',
  'product launch', 'launch event', 'keynote', 'annual conference',
  'inauguration', 'swearing in', 'swearing-in', 'oath taking',
  'listing day', 'ipo listing', 'ipo launch',
  'summit meeting', 'bilateral meet',
];

const NEWS_EVENT_PHRASES = [
  // Ongoing geopolitical / conflict events — no fixed end date
  'ukraine war', 'ukraine russia', 'russia ukraine', 'ukraine crisis',
  'israel iran', 'iran israel', 'israel war', 'gaza war', 'middle east war',
  'israel hamas', 'hamas israel', 'west asia conflict',
  'taiwan crisis', 'south china sea',
  'india pakistan', 'india china border', 'india china conflict',
  // Disasters — ongoing but episodic
  'earthquake', 'tsunami', 'cyclone', 'flood disaster', 'landslide',
  'wildfire', 'forest fire',
  // Crises
  'economic crisis', 'banking crisis', 'currency crisis',
  'coup', 'political crisis', 'government collapse',
  // Epidemics
  'outbreak', 'epidemic', 'pandemic',
];

const SEASONAL_PHRASES = [
  'diwali', 'holi', 'navratri', 'durga puja', 'ganesh chaturthi', 'ganesh festival',
  'eid ul fitr', 'eid al fitr', 'eid ul adha', 'bakrid', 'muharram',
  'christmas', 'new year', 'new year eve',
  'dussehra', 'ram navami', 'hanuman jayanti',
  'independence day', 'republic day', 'gandhi jayanti',
  'raksha bandhan', 'lohri', 'makar sankranti', 'baisakhi', 'onam',
  'ugadi', 'pongal', 'bihu', 'janmashtami', 'guru nanak jayanti',
  'board exam', 'board exams', 'class 10 board', 'class 12 board',
  'jee main', 'jee advanced', 'neet exam', 'upsc prelims', 'upsc mains',
  'monsoon', 'monsoon season', 'rainy season',
  'valentine', 'mother\'s day', 'father\'s day', 'teacher\'s day',
  'harvest festival',
];

const RECURRING_PHRASES = [
  // Sports seasons (annual)
  'ipl 20', 'ipl season', 'ipl 2025', 'ipl 2026',
  'world cup 20', 'cricket world cup',
  'champions trophy', 'asia cup',
  'premier league', 'la liga', 'bundesliga',
  'pro kabaddi', 'nba season', 'nfl season',
  // Finance / economic
  'quarterly results', 'q1 results', 'q2 results', 'q3 results', 'q4 results',
  'rbi policy', 'rbi monetary policy', 'fed rate', 'interest rate decision',
  'monthly data', 'inflation data', 'gdp data',
  // Entertainment seasons
  'season 1', 'season 2', 'season 3', 'season 4', 'season 5',
  'season finale', 'season premiere',
  'award season', 'filmfare', 'iifa', 'oscars',
  // Weekly
  'weekly update', 'weekly recap', 'this week in',
];

// Completion keywords: if recent videos contain these → event likely concluded
const COMPLETION_KEYWORDS = [
  'result', 'winner', 'elected', 'concluded', 'ended', 'over',
  'final score', 'victory', 'defeated', 'champion', 'wins',
  'announced winner', 'ceasefire', 'peace deal', 'resolved',
  'convicted', 'acquitted', 'sentenced',
];

// ── Static calendar ───────────────────────────────────────────────────────────
// Known Indian events with anchor dates. Matched against topic phrase.
// next_occurrence = next expected occurrence (for recurring/seasonal).
const CALENDAR_EVENTS = [
  { pattern: /lok sabha election 2024|general election 2024/i,    date: '2024-06-04', next: '2029-05-01' },
  { pattern: /budget 2024|union budget 2024/i,                    date: '2024-02-01', next: '2025-02-01' },
  { pattern: /budget 2025|union budget 2025/i,                    date: '2025-02-01', next: '2026-02-01' },
  { pattern: /budget 2026|union budget 2026/i,                    date: '2026-02-01', next: '2027-02-01' },
  { pattern: /ipl final 2024/i,                                   date: '2024-05-26', next: '2025-05-01' },
  { pattern: /ipl final 2025/i,                                   date: '2025-06-03', next: '2026-05-01' },
  { pattern: /west bengal election|bengal election/i,             date: '2026-05-20', next: '2031-04-01' },
  { pattern: /tamil nadu election/i,                              date: '2026-04-10', next: '2031-04-01' },
  { pattern: /delhi election 2025/i,                              date: '2025-02-05', next: '2030-02-01' },
  { pattern: /bihar election/i,                                   date: '2025-11-01', next: '2030-10-01' },
  { pattern: /champions trophy 2025/i,                            date: '2025-03-09', next: '2029-01-01' },
];

// ── Category classifier ───────────────────────────────────────────────────────

function classifyTopicCategory(topic) {
  const t = topic.toLowerCase();

  for (const ph of EVENT_PHRASES)       { if (t.includes(ph)) return 'event'; }
  for (const ph of NEWS_EVENT_PHRASES)  { if (t.includes(ph)) return 'news_event'; }
  for (const ph of SEASONAL_PHRASES)    { if (t.includes(ph)) return 'seasonal'; }
  for (const ph of RECURRING_PHRASES)   { if (t.includes(ph)) return 'recurring'; }

  return 'evergreen'; // revised design: unknown = evergreen, NOT recurring
}

// ── Calendar lookup ───────────────────────────────────────────────────────────

function lookupCalendar(topic) {
  const t = topic.toLowerCase();
  for (const entry of CALENDAR_EVENTS) {
    if (entry.pattern.test(t)) {
      return { calendar_date: entry.date, next_occurrence: entry.next || null };
    }
  }
  return null;
}

// ── Death score ───────────────────────────────────────────────────────────────
// Composite 0–100. Dead threshold = 60.
//
// signals = {
//   d0, d1, d2,                    ← video density per day (cnt / window_days)
//   days_since_last_video,         ← age of most recent video in topic
//   calendar_date,                 ← ISO date string or null
//   completion_keyword_found,      ← bool
//   avg_v30_v7_ratio,              ← long-tail signal (null if unavailable)
// }

function computeDeathScore(signals) {
  let score = 0;

  // Signal D4 — calendar expired (+30)
  if (signals.calendar_date) {
    const daysAfterEvent = (Date.now() - new Date(signals.calendar_date).getTime()) / 86400000;
    if (daysAfterEvent > 3)  score += 30;
  }

  // Signal D1 — publication collapse (+25 / +12)
  const d0        = signals.d0 || 0;
  const maxPrior  = Math.max(signals.d1 || 0, signals.d2 || 0);
  if (maxPrior > 0.05) {
    const ratio = d0 / maxPrior;
    if (ratio < 0.30) score += 25;
    else if (ratio < 0.60) score += 12;
  }

  // Signal D2 — recency gap (+25 / +12)
  const recency = signals.days_since_last_video || 0;
  if      (recency > 14) score += 25;
  else if (recency > 7)  score += 12;

  // Signal D3 — completion keyword (+20)
  if (signals.completion_keyword_found) score += 20;

  // Signal D5 — long-tail only: high v30/v7 ratio + publication collapse (+20)
  const vRatio = signals.avg_v30_v7_ratio;
  if (vRatio != null && vRatio > 4 && maxPrior > 0.05 && d0 / maxPrior < 0.50) {
    score += 20;
  }

  return Math.min(100, score);
}

// ── Runtime event stage ───────────────────────────────────────────────────────
// Called at query time inside computeWhatToPost.
// Uses bucket data already computed in topicMap — zero extra DB queries.
//
// b = topicMap bucket { cnt_0_14, cnt_15_30, cnt_31_60, cnt_61_90, videos, vel_pairs }
// dbRow = row from topic_event_metadata (may be null)

function computeRuntimeEventStage(topic, b, dbRow) {
  const category = dbRow?.topic_category || classifyTopicCategory(topic);

  // Pure evergreen — no event stage
  if (category === 'evergreen') return { category, event_stage: null, death_score: 0 };

  const d0 = b.cnt_0_14  / 14;
  const d1 = b.cnt_15_30 / 16;
  const d2 = b.cnt_31_60 / 30;

  // Recency: age of most recent video in bucket
  const recentVideos  = b.videos.filter(v => v.published_at);
  const days_since_last_video = recentVideos.length > 0
    ? (Date.now() - new Date(recentVideos.reduce((a, v) =>
        v.published_at > a ? v.published_at : a, '2000-01-01')).getTime()) / 86400000
    : 99;

  // Completion keyword: scan example videos
  const completion_keyword_found = b.videos.some(v =>
    COMPLETION_KEYWORDS.some(kw => (v.title || '').toLowerCase().includes(kw)),
  );

  // Long-tail ratio
  const avg_v30_v7_ratio = b.vel_pairs.length >= 2
    ? b.vel_pairs.reduce((s, p) => s + p.v30 / Math.max(1, p.v7), 0) / b.vel_pairs.length
    : null;

  // Calendar: prefer DB row (nightly job enriches it), else lookup
  const calLookup    = dbRow?.calendar_date ? null : lookupCalendar(topic);
  const calendar_date = dbRow?.calendar_date || calLookup?.calendar_date || null;

  const death_score = computeDeathScore({
    d0, d1, d2, days_since_last_video,
    calendar_date, completion_keyword_found,
    avg_v30_v7_ratio,
  });

  // Revival: was dead, now has new burst
  if (dbRow?.event_stage === 'dead') {
    const lastLiveD0 = dbRow.last_live_d0 || 0;
    if (d0 >= 0.5 && (lastLiveD0 === 0 || d0 >= lastLiveD0 * 0.4)) {
      return { category, event_stage: 'revived', death_score };
    }
    // news_event: more lenient revival (any non-trivial activity)
    if (category === 'news_event' && d0 >= 0.2) {
      return { category, event_stage: 'revived', death_score };
    }
    return { category, event_stage: 'dead', death_score };
  }

  if (death_score >= 60) return { category, event_stage: 'dead',  death_score };
  if (death_score >= 35) return { category, event_stage: 'decay', death_score };

  // Calendar-driven stages
  if (calendar_date) {
    const daysFromEvent = (Date.now() - new Date(calendar_date).getTime()) / 86400000;
    if (daysFromEvent >=  1)  return { category, event_stage: 'post_event', death_score };
    if (daysFromEvent >= -3)  return { category, event_stage: 'live_event', death_score };
    if (daysFromEvent >= -30) return { category, event_stage: 'pre_event',  death_score };
  }

  // Density-burst = live event (no calendar anchor needed)
  const maxPrior = Math.max(d1, d2);
  if (d0 >= 0.4 && d0 >= maxPrior * 2.5) {
    return { category, event_stage: 'live_event', death_score };
  }

  // Seasonal: if activity is present, mark as seasonal_window
  if (category === 'seasonal' && d0 > 0) {
    return { category, event_stage: 'live_event', death_score };
  }

  // Hold previous DB stage if recent (< 2 days old), else null
  const staleThreshold = new Date(Date.now() - 2 * 86400000).toISOString();
  const heldStage = dbRow?.updated_at > staleThreshold ? dbRow.event_stage : null;
  return { category, event_stage: heldStage || null, death_score };
}

// ── Score penalty ─────────────────────────────────────────────────────────────
// Returns additional score modifier based on event stage.
// Dead events are skipped entirely (handled in caller with continue).

function getEventPenalty(event_stage) {
  if (event_stage === 'decay')      return -25;
  if (event_stage === 'post_event') return -10;
  return 0;
}

// ── ACT NOW suppression rule ──────────────────────────────────────────────────

function shouldSuppressActNow(event_stage) {
  return event_stage === 'decay' || event_stage === 'dead';
}

// ── Nightly batch: compute + upsert topic_event_metadata ─────────────────────
// Runs for all topics in topic_signal_stats (channel_count_30d / prior as d0/d1 proxy).

function runEventClassificationJob(db) {
  const today = new Date().toISOString().slice(0, 10);

  // Load all scored topics
  const topics = db.all(`
    SELECT topic, signal_tier, signal_score,
           channel_count_30d, channel_count_prior_30d,
           vph_direction, score_breakdown
    FROM topic_signal_stats
    WHERE computed_at >= datetime('now', '-2 days')
  `);

  if (!topics.length) {
    console.log('[eventClassifier] No topics in topic_signal_stats — skipping');
    return;
  }

  // Load existing metadata for revival detection
  const existing = new Map(
    db.all(`SELECT topic, topic_category, event_stage, calendar_date, death_score,
                   last_live_d0, updated_at FROM topic_event_metadata`)
      .map(r => [r.topic, r]),
  );

  const upsertSql = `
    INSERT OR REPLACE INTO topic_event_metadata
      (topic, topic_category, event_stage, confidence, calendar_date, next_occurrence,
       death_score, last_live_d0, stage_entered_at, detected_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `;

  let classified = 0, eventCount = 0, deadCount = 0;

  const tx = db.transaction(() => {
    for (const row of topics) {
      const category = classifyTopicCategory(row.topic);
      if (category === 'evergreen') continue; // skip — no event metadata needed

      const cal     = lookupCalendar(row.topic);
      const dbRow   = existing.get(row.topic);
      const prevStage = dbRow?.event_stage;

      // Approximate density from trendSignalJob channel counts
      // channel_count_30d ≈ d0, channel_count_prior_30d ≈ d1
      const d0Approx = (row.channel_count_30d || 0) / 30;
      const d1Approx = (row.channel_count_prior_30d || 0) / 30;

      // Completion keyword: scan score_breakdown for vph_direction
      const falling = row.vph_direction === 'falling';

      const death_score = computeDeathScore({
        d0: d0Approx, d1: d1Approx, d2: 0,
        days_since_last_video: falling ? 10 : 0, // proxy: falling VPH implies recency gap
        calendar_date:            cal?.calendar_date || dbRow?.calendar_date || null,
        completion_keyword_found: falling && row.signal_score < 30,
        avg_v30_v7_ratio:         null,
      });

      // Stage resolution
      let event_stage = prevStage;
      let last_live_d0 = dbRow?.last_live_d0 || null;

      if (prevStage === 'dead') {
        // Revival check
        const revived = (category === 'news_event')
          ? d0Approx >= 0.1 && row.channel_count_30d >= 5
          : d0Approx >= 0.05 && row.channel_count_30d >= 8;
        event_stage = revived ? 'revived' : 'dead';
      } else if (death_score >= 60) {
        event_stage = 'dead';
      } else if (death_score >= 35) {
        event_stage = 'decay';
      } else if (cal?.calendar_date) {
        const daysFrom = (Date.now() - new Date(cal.calendar_date).getTime()) / 86400000;
        if (daysFrom >= 1)   event_stage = 'post_event';
        else if (daysFrom >= -3)  event_stage = 'live_event';
        else if (daysFrom >= -30) event_stage = 'pre_event';
        else event_stage = prevStage || null;
      } else if (row.signal_tier === 'rising' && row.channel_count_30d >= 8) {
        event_stage = 'live_event';
      } else {
        event_stage = prevStage || null;
      }

      // Record d0 density when live (for later revival baseline)
      if (event_stage === 'live_event') last_live_d0 = d0Approx;

      const stageChanged = event_stage !== prevStage;
      const stage_entered_at = stageChanged
        ? today
        : (dbRow?.stage_entered_at || today);

      const confidence = cal ? 'high' : category === 'news_event' ? 'medium' : 'low';

      db.run(upsertSql, [
        row.topic, category, event_stage, confidence,
        cal?.calendar_date || dbRow?.calendar_date || null,
        cal?.next_occurrence || dbRow?.next_occurrence || null,
        death_score, last_live_d0, stage_entered_at,
        cal ? 'calendar' : 'keyword',
      ]);

      classified++;
      if (['event', 'news_event', 'seasonal'].includes(category)) eventCount++;
      if (event_stage === 'dead') deadCount++;
    }
  });
  tx();

  console.log(`[eventClassifier] ${classified} topics classified — events: ${eventCount}, dead: ${deadCount}`);
  return { classified, events: eventCount, dead: deadCount };
}

module.exports = {
  classifyTopicCategory,
  lookupCalendar,
  computeDeathScore,
  computeRuntimeEventStage,
  getEventPenalty,
  shouldSuppressActNow,
  runEventClassificationJob,
  COMPLETION_KEYWORDS,
};
