'use strict';

// Pure benchmark execution module — no console output, no process.exit.
// Exports runBenchmark(db, options) → snapshot-shaped result object.
// Scoring logic mirrors auditWtpQuality.js exactly so both tools measure the same thing.

const { computeWhatToPost }          = require('../services/whatToPost');
const { resolveCreatorPeerContext }  = require('../services/creatorPeerContext');
const {
  STOPWORDS, HOOK_PHRASES, DEVANAGARI_RE, SOUTH_SCRIPT_RE, extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS }        = require('../lib/creatorMode');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');

const ALL_CATEGORIES = [
  { name: 'Podcast',       niches: ['education', 'business', 'finance'], mode: 'podcast' },
  { name: 'Finance',       niches: ['finance'] },
  { name: 'Business',      niches: ['business'] },
  { name: 'News',          niches: ['news', 'politics'] },
  { name: 'Education',     niches: ['education'] },
  { name: 'Gaming',        niches: ['gaming'] },
  { name: 'Tech',          niches: ['tech'] },
  { name: 'Health',        niches: ['wellness', 'health', 'fitness', 'selfimprovement', 'mindset'] },
  { name: 'Spirituality',  niches: ['devotional', 'spirituality'] },
  { name: 'Entertainment', niches: ['entertainment'] },
];

// ── Scoring helpers ───────────────────────────────────────────────────────────

const FORMAT_DIRECTIVE_RE = /^(make a|make an|create a|record a|post a|do a|film a)\b/i;
const PLACEHOLDER_RE      = /\[.+?\]/;
const CLEAR_PAYOFF_RE     = /with a clear payoff\b/i;

const ENTITY_STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'from', 'into', 'have',
  'will', 'more', 'than', 'just', 'like', 'some', 'also', 'over', 'which', 'there',
  'their', 'would', 'could', 'should', 'after', 'before', 'about', 'make', 'what',
  'when', 'why', 'how', 'who', 'can', 'top', 'best', 'new', 'all', 'every', 'most',
  'one', 'two', 'big', 'real', 'true', 'way', 'ways', 'tips', 'time', 'life',
  'people', 'world', 'good', 'you', 'are', 'its', 'was', 'has', 'not',
]);

function countNamedEntities(topic) {
  const words = topic.split(/[\s\-—–:,!?]+/).slice(1);
  return words.filter(w => {
    const c = w.replace(/[^a-zA-Z]/g, '');
    return c.length >= 3 && /^[A-Z]/.test(c) && !ENTITY_STOP.has(c.toLowerCase());
  }).length;
}

function specificityScore(idea) {
  if (typeof idea.specificity_score === 'number') return idea.specificity_score;

  const topic = String(idea.topic || idea.title || '').trim();
  if (!topic) return 0;

  const entities    = countNamedEntities(topic);
  const hasNumber   = /\d/.test(topic);
  const isDirective = FORMAT_DIRECTIVE_RE.test(topic);

  if (isDirective) {
    if (entities === 0 && !hasNumber) return CLEAR_PAYOFF_RE.test(topic) ? 3 : 8;
    return Math.min(35, 15 + entities * 12 + (hasNumber ? 5 : 0));
  }

  if (PLACEHOLDER_RE.test(topic)) return 8;

  let score = 35;
  score += Math.min(30, entities * 10);
  if (/\b\d{4}\b/.test(topic))                                                  score += 12;
  if (/\b\d+\s*(x|%|ways|reasons|tips|mistakes|things|steps)\b/i.test(topic))  score += 14;
  else if (hasNumber)                                                            score +=  8;
  if (topic.length >= 50)      score += 10;
  else if (topic.length >= 35) score +=  6;
  else if (topic.length <  20) score -= (entities >= 1 || hasNumber ? 8 : 15);
  if (/[—–:]/.test(topic) && entities > 0) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function personalizationScore(idea) {
  if (idea.source === 'fallback_evergreen') return 0;
  if (idea.idea_type === 'dna_bet')         return 72;

  let score = 20;
  if (idea.idea_type === 'narrative_angle') score += 20;
  if (idea.strong_territory)               score += 25;
  if (idea.act_now)                        score += 10;

  const bd = idea.score_breakdown || {};
  if ((bd.dna_boost       || 0) > 0) score += 12;
  if ((bd.personalization || 0) > 0) score +=  8;

  const reasons = (idea.reasons || []).join(' ').toLowerCase();
  if (reasons.includes('your upload') || reasons.includes('your niche') || reasons.includes('your territory')) score += 10;

  return Math.max(0, Math.min(100, score));
}

function evidenceScore(idea) {
  if (idea.source === 'fallback_evergreen') return 0;

  const tier  = idea.confidence_tier || idea.confidence;
  let score   = { high: 80, medium: 55, low: 22 }[tier] ?? 10;
  const exCnt = (idea.examples || []).length;
  score += Math.min(15, exCnt * 4);
  const peers = idea.evidence?.channel_count ?? idea.channel_count ?? 0;
  score += Math.min(8, Math.floor(peers / 2));
  return Math.max(0, Math.min(100, score));
}

function isFormatDirective(idea) {
  const t = String(idea.topic || '');
  if (!FORMAT_DIRECTIVE_RE.test(t)) return false;
  return countNamedEntities(t) === 0 && !/\d/.test(t);
}

function isGeneric(idea) {
  return isFormatDirective(idea) || PLACEHOLDER_RE.test(String(idea.topic || ''));
}

const JACCARD_STOP = new Set([
  'the', 'a', 'an', 'of', 'in', 'to', 'is', 'it', 'on', 'for',
  'and', 'with', 'how', 'why', 'what', 'make', 'video',
]);

function jaccardSimilarity(a, b) {
  const words = s => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !JACCARD_STOP.has(w)));
  const wa = words(a), wb = words(b);
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function computeDuplicateRate(ideas) {
  const topics = ideas.map(i => String(i.topic || ''));
  let dupes = 0;
  const seen = [];
  for (const t of topics) {
    if (seen.some(prev => jaccardSimilarity(prev, t) >= 0.55)) dupes++;
    else seen.push(t);
  }
  return ideas.length > 0 ? dupes / ideas.length : 0;
}

const DIVERSITY_STOP = new Set([
  'make', 'post', 'create', 'the', 'why', 'how', 'what', 'when', 'that', 'your',
  'with', 'this', 'from', 'just', 'like', 'video', 'content',
]);

function computeDiversityScore(ideas) {
  if (!ideas.length) return 0;
  const clusters = new Set();
  for (const idea of ideas) {
    const words = String(idea.topic || '')
      .split(/\W+/)
      .filter(w => w.length > 3 && !DIVERSITY_STOP.has(w.toLowerCase()));
    clusters.add(words[0]?.toLowerCase() || '_empty');
  }
  return Math.round((clusters.size / ideas.length) * 100);
}

function phraseWordCount(idea) {
  return String(idea.topic || '').trim().split(/\s+/).filter(Boolean).length;
}

function scoreIdeas(ideas) {
  if (!ideas.length) return null;

  const specs       = ideas.map(specificityScore);
  const pers        = ideas.map(personalizationScore);
  const evids       = ideas.map(evidenceScore);
  const genCnt      = ideas.filter(isGeneric).length;
  const fallbackCnt = ideas.filter(i => i.source === 'fallback_evergreen').length;
  const genRate     = genCnt / ideas.length;
  const dupeRate    = computeDuplicateRate(ideas);
  const diversity   = computeDiversityScore(ideas);

  const wcs      = ideas.map(phraseWordCount);
  const avgWords = wcs.reduce((s, v) => s + v, 0) / wcs.length;
  const avg      = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

  const specificity     = Math.round(avg(specs));
  const personalization = Math.round(avg(pers));
  const evidence        = Math.round(avg(evids));

  const composite = Math.round(
    specificity     * 0.25 +
    evidence        * 0.25 +
    personalization * 0.15 +
    (1 - genRate)   * 100  * 0.20 +
    (1 - dupeRate)  * 100  * 0.05 +
    diversity       * 0.10,
  );

  return {
    specificity,
    personalization,
    evidence,
    genericRate:   Math.round(genRate  * 100),
    genericCount:  genCnt,
    fallbackRate:  Math.round((fallbackCnt / ideas.length) * 100),
    duplicateRate: Math.round(dupeRate * 100),
    diversity,
    composite,
    avgWords:  +avgWords.toFixed(1),
    bigramPct: Math.round(wcs.filter(w => w <= 2).length / wcs.length * 100),
    longPct:   Math.round(wcs.filter(w => w >= 4).length / wcs.length * 100),
  };
}

// ── Channel sampling ──────────────────────────────────────────────────────────

function sampleChannels(db, cat, limit) {
  const niches = cat.niches || [];
  const inPh   = niches.map(() => '?').join(',');

  if (cat.mode === 'podcast') {
    const rows = db.all(
      `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
       FROM ingested_channels
       WHERE ingest_enabled = 1 AND creator_mode = 'podcast'
       ORDER BY RANDOM() LIMIT ?`,
      [limit],
    );
    if (rows.length >= 2) return rows;
    if (!niches.length) return [];
    return db.all(
      `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
       FROM ingested_channels
       WHERE ingest_enabled = 1 AND COALESCE(primary_niche, niche) IN (${inPh})
       ORDER BY RANDOM() LIMIT ?`,
      [...niches, limit],
    );
  }

  if (!niches.length) return [];
  return db.all(
    `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
     FROM ingested_channels
     WHERE ingest_enabled = 1 AND COALESCE(primary_niche, niche) IN (${inPh})
     ORDER BY RANDOM() LIMIT ?`,
    [...niches, limit],
  );
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Run the WTP quality benchmark.
 *
 * @param {object} db         - DB handle from openReadonlyDb()
 * @param {object} options
 * @param {number} options.channelsPerCat  - channels per category (default 5)
 * @param {number} options.topN            - top N ideas per category (default 20)
 * @param {string} options.categoryFilter  - run a single category only
 * @param {function} options.onProgress    - called with { category } as each category starts
 *
 * @returns {{ runAt, channelsPerCat, topN, overall, categories } | null}
 */
function runBenchmark(db, { channelsPerCat = 5, topN = 20, categoryFilter = null, onProgress = null } = {}) {
  const ctx = {
    resolveCreatorPeerContext, extractPhrases, getVelocity,
    classifyTrend, getFormatWinner, PODCAST_META_TOKENS,
    STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE,
  };

  const categories = categoryFilter
    ? ALL_CATEGORIES.filter(c => c.name.toLowerCase() === categoryFilter.toLowerCase())
    : ALL_CATEGORIES;

  const categoryResults = [];

  for (const cat of categories) {
    if (onProgress) onProgress({ category: cat.name });

    const channels = sampleChannels(db, cat, channelsPerCat);
    if (!channels.length) continue;

    const allIdeas = [];
    let errorCount = 0;

    for (const ch of channels) {
      try {
        const result = computeWhatToPost(
          db,
          { channel_id: ch.channel_id, subscriber_count: String(ch.channel_subscribers || 0) },
          ctx,
        );
        allIdeas.push(...(result?.ideas || []));
      } catch (_) {
        errorCount++;
      }
    }

    const seenTopics = new Set();
    const deduped    = [];
    for (const idea of allIdeas.sort((a, b) =>
      ((b.score || 0) + (b.specificity_score || 0)) - ((a.score || 0) + (a.specificity_score || 0))
    )) {
      const key = String(idea.topic || '').toLowerCase().trim();
      if (!key || seenTopics.has(key)) continue;
      seenTopics.add(key);
      deduped.push(idea);
    }

    const topIdeas = deduped.slice(0, topN);
    const scores   = scoreIdeas(topIdeas);
    if (!scores) continue;

    categoryResults.push({ name: cat.name, sampled: channels.length, errors: errorCount, scores });
  }

  if (!categoryResults.length) return null;

  const metricAvg = field => Math.round(
    categoryResults.reduce((s, r) => s + r.scores[field], 0) / categoryResults.length,
  );

  const overall = {
    composite:       Math.round(categoryResults.reduce((s, r) => s + r.scores.composite, 0) / categoryResults.length),
    specificity:     metricAvg('specificity'),
    personalization: metricAvg('personalization'),
    evidence:        metricAvg('evidence'),
    genericRate:     metricAvg('genericRate'),
    fallbackRate:    metricAvg('fallbackRate'),
    duplicateRate:   metricAvg('duplicateRate'),
    diversity:       metricAvg('diversity'),
    avgWords:  +(categoryResults.reduce((s, r) => s + r.scores.avgWords, 0) / categoryResults.length).toFixed(1),
    bigramPct:  Math.round(categoryResults.reduce((s, r) => s + r.scores.bigramPct, 0) / categoryResults.length),
    longPct:    Math.round(categoryResults.reduce((s, r) => s + r.scores.longPct,   0) / categoryResults.length),
  };

  const categories_out = {};
  for (const r of categoryResults) {
    categories_out[r.name] = { ...r.scores, sampled: r.sampled, errors: r.errors };
  }

  return {
    runAt:          new Date().toISOString(),
    channelsPerCat,
    topN,
    overall,
    categories:     categories_out,
  };
}

module.exports = { runBenchmark, scoreIdeas, specificityScore, ALL_CATEGORIES };
