'use strict';

/**
 * classificationQualityAudit.js
 *
 * Detects misclassified channels using 5 internal-consistency signals.
 * No AI API calls — pure DB analysis.
 *
 * Signals:
 *  1. AI identity_confidence (classifier's own self-assessment)
 *  2. niche × archetype coherence (hard/soft conflict matrix)
 *  3. niche × format coherence
 *  4. raw niche field vs primary_niche alignment
 *  5. behavior_tags vs niche alignment
 *  6. recent video title vocabulary vs classified niche
 *
 * Outputs:
 *  - Aggregate stats across sampled channels
 *  - Conflict type frequency table
 *  - Top N highest-impact misclassifications (ranked by subs × conflict score)
 *  - Automatic repair candidates with suggested niche
 *
 * Usage:
 *   node server/scripts/classificationQualityAudit.js
 *   node server/scripts/classificationQualityAudit.js --sample=1000
 *   node server/scripts/classificationQualityAudit.js --channel="Jimmy Fallon"
 *   node server/scripts/classificationQualityAudit.js --top=100
 *   node server/scripts/classificationQualityAudit.js --min-subs=100000
 *   node server/scripts/classificationQualityAudit.js --sample=all --min-subs=1000000
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);
const SAMPLE   = args.sample === 'all' ? Infinity : (Number(args.sample) || 1000);
const CHANNEL  = args.channel ? String(args.channel).toLowerCase() : null;
const TOP      = Number(args.top) || 100;
const MIN_SUBS = Number(args['min-subs']) || 0;

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=30000');
  const cache = new Map();
  const stmt = sql => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
  };
}

// ── Compatibility tables ──────────────────────────────────────────────────────

// Acceptable archetypes per primary_niche
const NICHE_OK_ARCHETYPES = {
  entertainment:   ['entertainer', 'personality_host', 'storyteller', 'commentator', 'reviewer'],
  comedy:          ['entertainer', 'personality_host', 'commentator', 'storyteller'],
  lifestyle:       ['personality_host', 'storyteller', 'entertainer', 'authority_educator'],
  gaming:          ['entertainer', 'personality_host', 'commentator', 'reviewer', 'analyst'],
  music:           ['entertainer', 'personality_host', 'authority_educator', 'storyteller', 'reviewer'],
  food:            ['authority_educator', 'personality_host', 'storyteller', 'reviewer', 'entertainer'],
  travel:          ['personality_host', 'storyteller', 'authority_educator', 'entertainer', 'commentator'],
  sports:          ['commentator', 'analyst', 'personality_host', 'entertainer', 'authority_educator'],
  beauty:          ['authority_educator', 'personality_host', 'reviewer', 'entertainer'],
  finance:         ['authority_educator', 'analyst', 'commentator', 'reviewer'],
  news:            ['commentator', 'authority_educator', 'investigative_creator', 'analyst'],
  politics:        ['commentator', 'analyst', 'debater', 'authority_educator'],
  geopolitics:     ['commentator', 'analyst', 'authority_educator'],
  education:       ['authority_educator', 'storyteller', 'analyst', 'commentator'],
  technology:      ['reviewer', 'authority_educator', 'analyst', 'commentator'],
  health:          ['authority_educator', 'analyst', 'commentator', 'personality_host'],
  fitness:         ['authority_educator', 'commentator', 'personality_host', 'entertainer'],
  science:         ['authority_educator', 'analyst', 'storyteller', 'commentator'],
  business:        ['authority_educator', 'analyst', 'commentator', 'personality_host'],
  selfimprovement: ['authority_educator', 'personality_host', 'commentator', 'storyteller'],
  yoga:            ['authority_educator', 'personality_host'],
  meditation:      ['authority_educator', 'personality_host'],
  philosophy:      ['authority_educator', 'commentator', 'analyst', 'storyteller'],
  defence:         ['authority_educator', 'analyst', 'commentator', 'personality_host'],
  other:           ['personality_host', 'authority_educator', 'entertainer', 'commentator', 'storyteller', 'analyst', 'reviewer'],
};

// Acceptable format_types per primary_niche
const NICHE_OK_FORMATS = {
  entertainment:   ['other', 'vlog', 'shorts', 'interview', 'compilation', 'podcast', 'documentary', 'news'],
  comedy:          ['other', 'shorts', 'vlog', 'compilation'],
  lifestyle:       ['vlog', 'shorts', 'other', 'podcast', 'interview', 'documentary'],
  gaming:          ['other', 'livestream', 'shorts', 'vlog', 'review', 'compilation'],
  music:           ['other', 'shorts', 'vlog', 'tutorial', 'podcast', 'documentary', 'compilation'],
  food:            ['tutorial', 'vlog', 'other', 'shorts', 'review'],
  travel:          ['vlog', 'other', 'documentary', 'shorts'],
  sports:          ['other', 'news', 'shorts', 'documentary', 'livestream', 'compilation'],
  beauty:          ['tutorial', 'vlog', 'shorts', 'review', 'other'],
  finance:         ['tutorial', 'other', 'essay', 'news', 'documentary', 'podcast', 'shorts'],
  news:            ['news', 'other', 'shorts', 'documentary'],
  politics:        ['news', 'other', 'essay', 'documentary', 'podcast'],
  geopolitics:     ['news', 'other', 'essay', 'documentary', 'podcast'],
  education:       ['tutorial', 'other', 'essay', 'documentary', 'shorts', 'podcast'],
  technology:      ['tutorial', 'review', 'other', 'shorts', 'documentary'],
  health:          ['tutorial', 'other', 'podcast', 'documentary', 'interview'],
  fitness:         ['tutorial', 'other', 'shorts', 'vlog'],
  science:         ['documentary', 'other', 'tutorial', 'essay', 'shorts'],
  business:        ['other', 'tutorial', 'podcast', 'interview', 'essay', 'documentary'],
  selfimprovement: ['other', 'tutorial', 'shorts', 'vlog', 'podcast'],
  yoga:            ['tutorial', 'other', 'shorts'],
  meditation:      ['other', 'tutorial', 'podcast', 'shorts'],
  philosophy:      ['other', 'essay', 'podcast', 'documentary'],
  defence:         ['other', 'documentary', 'news', 'essay'],
  other:           ['other', 'vlog', 'shorts', 'tutorial', 'documentary', 'news', 'essay', 'podcast', 'review', 'interview', 'compilation', 'livestream'],
};

// Hard conflicts: almost certainly wrong
const HARD_CONFLICTS = new Set([
  'finance+entertainer',
  'news+entertainer',
  'politics+entertainer',
  'geopolitics+entertainer',
  'science+entertainer',
  'defence+entertainer',
  'comedy+authority_educator',
  'comedy+analyst',
]);

// Soft conflicts: suspicious, sometimes valid
const SOFT_CONFLICTS = new Set([
  'finance+personality_host',
  'news+personality_host',
  'politics+personality_host',
  'geopolitics+personality_host',
  'science+personality_host',
  'philosophy+entertainer',
  'philosophy+personality_host',
  'education+entertainer',
  'finance+storyteller',
]);

// Behavior tags that strongly imply a specific set of niches
const BTAG_NICHE_SIGNALS = {
  sketch:           ['entertainment', 'comedy'],
  character_driven: ['entertainment', 'comedy'],
  gameplay:         ['gaming'],
  recipe_based:     ['food'],
  travelogue:       ['travel'],
  music_video:      ['music'],
  audio_release:    ['music'],
  performance:      ['entertainment', 'comedy', 'music'],
  news_reaction:    ['news', 'politics', 'geopolitics'],
};

// Keywords for detecting niche from free text (raw niche field or video titles)
const NICHE_VOCAB = {
  entertainment:   ['entertainment', 'celebrity', 'bollywood', 'movie', 'series', 'web series', 'viral', 'trending', 'late night', 'talk show', 'variety', 'interview show', 'tv show'],
  comedy:          ['comedy', 'funny', 'humor', 'sketch', 'prank', 'standup', 'roast', 'parody', 'skit'],
  gaming:          ['gaming', 'game', 'gameplay', 'minecraft', 'pubg', 'free fire', 'bgmi', 'roblox', 'valorant', 'esports', 'gamer', 'playthrough'],
  music:           ['music', 'song', 'singer', 'rap', 'hip hop', 'album', 'bhajans', 'bhojpuri', 'devotional', 'punjabi', 'melody', 'beats', 'musician'],
  food:            ['food', 'recipe', 'cook', 'kitchen', 'chef', 'biryani', 'cuisine', 'restaurant', 'street food', 'baking', 'khana'],
  travel:          ['travel', 'adventure', 'explore', 'destination', 'trip', 'journey', 'wanderlust', 'travelogue'],
  finance:         ['finance', 'stock market', 'mutual fund', 'invest', 'trading', 'crypto', 'wealth', 'money management', 'portfolio', 'nifty', 'sensex'],
  technology:      ['tech', 'smartphone', 'gadget', 'software', 'ai ', 'coding', 'programming', 'review', 'unboxing', 'developer', 'cybersecurity'],
  education:       ['education', 'learn', 'tutorial', 'study', 'school', 'exam', 'upsc', 'ias', 'lecture', 'course', 'university'],
  news:            ['news', 'breaking', 'current affairs', 'samachar', 'update', 'latest', 'reporter', 'headline'],
  health:          ['health', 'medical', 'doctor', 'medicine', 'nutrition', 'diet', 'ayurveda', 'wellness'],
  fitness:         ['fitness', 'workout', 'gym', 'bodybuilding', 'exercise', 'training'],
  yoga:            ['yoga', 'asana', 'pranayama', 'yogi'],
  meditation:      ['meditation', 'mindfulness', 'mindful', 'guided meditation'],
  sports:          ['cricket', 'football', 'sports', 'ipl', 'match', 'athlete', 'tournament', 'score', 'batting', 'bowling'],
  politics:        ['politics', 'political', 'election', 'parliament', 'government', 'policy', 'minister', 'party', 'democracy'],
  geopolitics:     ['geopolit', 'world affairs', 'international', 'diplomacy', 'foreign policy', 'nato', 'superpower', 'proxy war'],
  selfimprovement: ['motivation', 'self help', 'productivity', 'mindset', 'growth', 'habits', 'self improvement', 'personal development', 'life coach'],
  science:         ['science', 'space', 'physics', 'chemistry', 'biology', 'research', 'experiment', 'nasa', 'quantum'],
  philosophy:      ['philosophy', 'stoicism', 'wisdom', 'consciousness', 'existential', 'eastern philosophy', 'vedanta'],
  business:        ['business', 'entrepreneur', 'startup', 'marketing', 'sales', 'brand', 'ecommerce'],
  beauty:          ['beauty', 'makeup', 'skincare', 'fashion', 'style', 'cosmetic', 'grooming'],
  defence:         ['army', 'military', 'defence', 'defense', 'navy', 'air force', 'weapon', 'soldier', 'missile', 'fighter jet'],
  lifestyle:       ['lifestyle', 'vlog', 'daily life', 'day in my life', 'family', 'routine', 'grwm', 'morning routine'],
};

// Groups of niches that are semantically adjacent (cross-classification is less wrong)
const CLOSE_NICHE_GROUPS = [
  new Set(['entertainment', 'comedy', 'lifestyle']),
  new Set(['health', 'fitness', 'yoga', 'meditation', 'selfimprovement']),
  new Set(['education', 'science', 'technology']),
  new Set(['politics', 'news', 'geopolitics']),
  new Set(['business', 'finance']),
  new Set(['sports', 'gaming']),
  new Set(['food', 'lifestyle']),
  new Set(['travel', 'lifestyle']),
];

function areNichesClose(a, b) {
  if (a === b) return true;
  return CLOSE_NICHE_GROUPS.some(g => g.has(a) && g.has(b));
}

function detectNicheFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const [niche, kws] of Object.entries(NICHE_VOCAB)) {
    const score = kws.filter(kw => t.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = niche; }
  }
  return bestScore >= 1 ? best : null;
}

function parseJsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

// ── Core scoring ──────────────────────────────────────────────────────────────

function computeClassificationConfidence(channel, titleNiche) {
  const pn     = channel.primary_niche;
  const arch   = channel.content_archetype;
  const fmt    = channel.format_type;
  const rawN   = channel.niche;
  const btags  = parseJsonArray(channel.behavior_tags);
  const aiConf = channel.identity_confidence != null ? Number(channel.identity_confidence) : 1.0;

  let penalty = 0;
  const flags = [];

  // Signal 1 — AI confidence
  if      (aiConf < 0.30) { penalty += 35; flags.push({ type: 'LOW_AI_CONFIDENCE',  detail: `conf=${aiConf.toFixed(2)}` }); }
  else if (aiConf < 0.50) { penalty += 20; flags.push({ type: 'MID_AI_CONFIDENCE',  detail: `conf=${aiConf.toFixed(2)}` }); }
  else if (aiConf < 0.70) { penalty += 8;  flags.push({ type: 'MILD_AI_CONFIDENCE', detail: `conf=${aiConf.toFixed(2)}` }); }

  // Signal 2 — Niche × Archetype
  if (pn && arch) {
    const naKey = `${pn}+${arch}`;
    if (HARD_CONFLICTS.has(naKey)) {
      penalty += 40; flags.push({ type: 'HARD_NA_CONFLICT', detail: naKey });
    } else if (SOFT_CONFLICTS.has(naKey)) {
      penalty += 18; flags.push({ type: 'SOFT_NA_CONFLICT', detail: naKey });
    } else {
      const okArch = NICHE_OK_ARCHETYPES[pn] || [];
      if (!okArch.includes(arch)) {
        penalty += 22; flags.push({ type: 'INCOMPAT_ARCHETYPE', detail: naKey });
      }
    }
  }

  // Signal 3 — Niche × Format
  if (pn && fmt) {
    const okFmt = NICHE_OK_FORMATS[pn] || [];
    if (!okFmt.includes(fmt)) {
      penalty += 10; flags.push({ type: 'INCOMPAT_FORMAT', detail: `${pn}+${fmt}` });
    }
  }

  // Signal 4 — Raw niche field vs primary_niche
  if (rawN && pn) {
    const rawDetected = detectNicheFromText(rawN);
    if (rawDetected && rawDetected !== pn) {
      const close = areNichesClose(rawDetected, pn);
      if (!close) {
        penalty += 28; flags.push({ type: 'RAW_NICHE_MISMATCH', detail: `raw→${rawDetected} != ${pn}` });
      } else {
        penalty += 5;  flags.push({ type: 'RAW_NICHE_DRIFT', detail: `raw→${rawDetected} ~ ${pn}` });
      }
    }
  }

  // Signal 5 — Behavior tags vs niche
  for (const tag of btags) {
    const sigNiches = BTAG_NICHE_SIGNALS[tag];
    if (sigNiches && !sigNiches.includes(pn)) {
      penalty += 12; flags.push({ type: 'BTAG_NICHE_MISMATCH', detail: `btag:${tag}→[${sigNiches}] != ${pn}` });
    }
  }

  // Signal 6 — Video title vocabulary vs niche
  if (titleNiche && pn && titleNiche !== pn) {
    const close = areNichesClose(titleNiche, pn);
    if (!close) {
      penalty += 22; flags.push({ type: 'TITLE_VOCAB_MISMATCH', detail: `titles→${titleNiche} != ${pn}` });
    } else {
      penalty += 5;  flags.push({ type: 'TITLE_VOCAB_DRIFT', detail: `titles→${titleNiche} ~ ${pn}` });
    }
  }

  const classification_confidence = Math.max(0, Math.min(100, Math.round((1 - penalty / 130) * 100)));
  return { classification_confidence, penalty, flags };
}

// Suggest most likely correct niche based on all available evidence
function suggestRepairNiche(channel, titleNiche) {
  const pn   = channel.primary_niche;
  const arch = channel.content_archetype;
  const btags = parseJsonArray(channel.behavior_tags);

  const votes = {};
  const vote = (niche, w, reason) => {
    if (!niche || niche === pn) return;
    if (!votes[niche]) votes[niche] = { weight: 0, reasons: [] };
    votes[niche].weight += w;
    votes[niche].reasons.push(reason);
  };

  // Raw niche field
  const rawDetected = detectNicheFromText(channel.niche);
  if (rawDetected) vote(rawDetected, 30, `raw:"${channel.niche}"`);

  // Video title vocabulary
  if (titleNiche) vote(titleNiche, 25, 'title_vocabulary');

  // Behavior tag signals
  for (const tag of btags) {
    const sigs = BTAG_NICHE_SIGNALS[tag];
    if (sigs) sigs.forEach(n => vote(n, 15, `btag:${tag}`));
  }

  // Archetype → likely niches
  const ARCHETYPE_HINTS = {
    entertainer:       ['entertainment', 'comedy', 'gaming', 'music', 'lifestyle'],
    personality_host:  ['entertainment', 'lifestyle', 'comedy', 'food', 'travel'],
    authority_educator:['education', 'finance', 'technology', 'health', 'fitness', 'science'],
    analyst:           ['finance', 'technology', 'sports', 'geopolitics', 'business'],
    commentator:       ['news', 'politics', 'geopolitics', 'sports', 'entertainment'],
    reviewer:          ['technology', 'food', 'beauty', 'gaming'],
    storyteller:       ['travel', 'lifestyle', 'entertainment', 'education'],
  };
  (ARCHETYPE_HINTS[arch] || []).slice(0, 2).forEach((n, i) => vote(n, 8 - i * 3, `archetype:${arch}`));

  const sorted = Object.entries(votes)
    .map(([niche, { weight, reasons }]) => ({ niche, weight, reasons }))
    .sort((a, b) => b.weight - a.weight);

  return sorted[0] || null;
}

// ── Formatting ────────────────────────────────────────────────────────────────
function pad(s, n)  { return String(s ?? '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s ?? '').padStart(n).slice(-n); }

function confBar(score) {
  const n = Math.round(score / 10);
  const color = score >= 70 ? '\x1b[32m' : score >= 40 ? '\x1b[33m' : '\x1b[31m';
  return color + '[' + '█'.repeat(n) + '░'.repeat(10 - n) + ']\x1b[0m';
}

function fmtSubs(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function divider(char = '─', w = 120) { console.log('  ' + char.repeat(w)); }

function conflictLabel(type) {
  return {
    HARD_NA_CONFLICT:   '\x1b[31mHARD_NA\x1b[0m    ',
    SOFT_NA_CONFLICT:   '\x1b[33mSOFT_NA\x1b[0m    ',
    INCOMPAT_ARCHETYPE: '\x1b[33mARCH\x1b[0m       ',
    INCOMPAT_FORMAT:    '\x1b[2mFMT\x1b[0m        ',
    RAW_NICHE_MISMATCH: '\x1b[31mRAW_MISMATCH\x1b[0m',
    RAW_NICHE_DRIFT:    '\x1b[2mRAW_DRIFT\x1b[0m  ',
    BTAG_NICHE_MISMATCH:'\x1b[33mBTAG\x1b[0m       ',
    TITLE_VOCAB_MISMATCH:'\x1b[31mTITLE\x1b[0m      ',
    TITLE_VOCAB_DRIFT:  '\x1b[2mTITLE_DRIFT\x1b[0m',
    LOW_AI_CONFIDENCE:  '\x1b[31mLOW_CONF\x1b[0m   ',
    MID_AI_CONFIDENCE:  '\x1b[33mMID_CONF\x1b[0m   ',
    MILD_AI_CONFIDENCE: '\x1b[2mMILD_CONF\x1b[0m  ',
  }[type] || type;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const db = openDb();

// Fetch channels
let channelQuery;
const queryParams = [];
if (CHANNEL) {
  channelQuery = `SELECT channel_id, channel_name, niche, primary_niche, secondary_niche,
      content_archetype, format_type, identity_confidence, identity_strength, identity_source,
      behavior_tags, inferred_topics, channel_subscribers, identity_reasoning
    FROM ingested_channels
    WHERE ingest_enabled = 1 AND LOWER(channel_name) LIKE ?
    ORDER BY channel_subscribers DESC
    LIMIT 5`;
  queryParams.push(`%${CHANNEL}%`);
} else if (Number.isFinite(SAMPLE)) {
  const subsClause = MIN_SUBS > 0 ? `AND channel_subscribers >= ${MIN_SUBS}` : '';
  channelQuery = `SELECT channel_id, channel_name, niche, primary_niche, secondary_niche,
      content_archetype, format_type, identity_confidence, identity_strength, identity_source,
      behavior_tags, inferred_topics, channel_subscribers, identity_reasoning
    FROM ingested_channels
    WHERE ingest_enabled = 1 ${subsClause}
    ORDER BY RANDOM()
    LIMIT ${SAMPLE}`;
} else {
  // all
  const subsClause = MIN_SUBS > 0 ? `WHERE ingest_enabled = 1 AND channel_subscribers >= ${MIN_SUBS}` : 'WHERE ingest_enabled = 1';
  channelQuery = `SELECT channel_id, channel_name, niche, primary_niche, secondary_niche,
      content_archetype, format_type, identity_confidence, identity_strength, identity_source,
      behavior_tags, inferred_topics, channel_subscribers, identity_reasoning
    FROM ingested_channels
    ${subsClause}
    ORDER BY channel_subscribers DESC`;
}

const channels = db.all(channelQuery, queryParams);

if (!channels.length) {
  console.log('No channels found matching criteria.');
  process.exit(0);
}

console.log(`\nFetched ${channels.length} channels. Loading video titles...`);

// Fetch recent titles for all channels in one query
const channelIds = channels.map(c => c.channel_id);
const titlesBatch = channelIds.length <= 5000
  ? db.all(
      `SELECT channel_id, title FROM ingested_videos
       WHERE channel_id IN (${channelIds.map(() => '?').join(',')})
         AND title IS NOT NULL
       ORDER BY published_at DESC`,
      channelIds,
    )
  : [];

// Group titles by channel_id (up to 15 per channel)
const titlesByChannel = {};
for (const row of titlesBatch) {
  if (!titlesByChannel[row.channel_id]) titlesByChannel[row.channel_id] = [];
  if (titlesByChannel[row.channel_id].length < 15) titlesByChannel[row.channel_id].push(row.title);
}

console.log(`Loaded titles. Scoring ${channels.length} channels...\n`);

// ── Score all channels ────────────────────────────────────────────────────────
const results = [];
const flagTypeCount = {};

for (const ch of channels) {
  const titles    = titlesByChannel[ch.channel_id] || [];
  const titleText = titles.join(' ');
  const titleNiche = detectNicheFromText(titleText) || null;

  const { classification_confidence, penalty, flags } = computeClassificationConfidence(ch, titleNiche);
  const repair = suggestRepairNiche(ch, titleNiche);

  // Impact = log10(subs+1) × (100 − conf) — prioritises big channels with bad confidence
  const subs   = ch.channel_subscribers || 0;
  const impact = Math.log10(subs + 1) * (100 - classification_confidence);

  for (const f of flags) {
    flagTypeCount[f.type] = (flagTypeCount[f.type] || 0) + 1;
  }

  results.push({
    ...ch,
    titles,
    titleNiche,
    classification_confidence,
    penalty,
    flags,
    repair,
    impact,
  });
}

// Sort by impact descending
results.sort((a, b) => b.impact - a.impact);

// ── Print header ──────────────────────────────────────────────────────────────
console.log('');
console.log('  ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  CLASSIFICATION QUALITY AUDIT  —  ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
console.log(`  Sample: ${channels.length} channels${MIN_SUBS ? ` (min ${fmtSubs(MIN_SUBS)} subs)` : ''}${CHANNEL ? ` filter="${CHANNEL}"` : ''}`);
console.log('  ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');

// ── Aggregate stats ───────────────────────────────────────────────────────────
const confBuckets = { high: 0, medium: 0, low: 0, critical: 0 };
for (const r of results) {
  if      (r.classification_confidence >= 80) confBuckets.high++;
  else if (r.classification_confidence >= 60) confBuckets.medium++;
  else if (r.classification_confidence >= 40) confBuckets.low++;
  else                                         confBuckets.critical++;
}

const withFlags  = results.filter(r => r.flags.length > 0).length;
const withRepair = results.filter(r => r.repair != null).length;
const avgConf    = Math.round(results.reduce((s, r) => s + r.classification_confidence, 0) / results.length);

console.log('\n  AGGREGATE STATS');
divider('·', 60);
console.log(`  Total channels scored       : ${results.length}`);
console.log(`  Average confidence          : ${avgConf}%`);
console.log(`  High confidence  (≥80%)     : ${confBuckets.high}  (${pct(confBuckets.high, results.length)}%)`);
console.log(`  Medium confidence (60-79%)  : ${confBuckets.medium}  (${pct(confBuckets.medium, results.length)}%)`);
console.log(`  Low confidence   (40-59%)   : ${confBuckets.low}  (${pct(confBuckets.low, results.length)}%)`);
console.log(`  Critical confidence (<40%)  : ${confBuckets.critical}  (${pct(confBuckets.critical, results.length)}%)`);
console.log(`  Channels with any flag      : ${withFlags}  (${pct(withFlags, results.length)}%)`);
console.log(`  Repair candidates           : ${withRepair}  (${pct(withRepair, results.length)}%)`);

function pct(n, d) { return d ? Math.round(100 * n / d) : 0; }

// ── Conflict type frequency ───────────────────────────────────────────────────
console.log('\n  CONFLICT TYPE FREQUENCY');
divider('·', 60);
const sortedFlags = Object.entries(flagTypeCount).sort((a, b) => b[1] - a[1]);
for (const [type, count] of sortedFlags) {
  const bar = '█'.repeat(Math.min(30, Math.round(count / results.length * 300)));
  console.log(`  ${pad(type, 24)} ${rpad(count, 5)}  ${pct(count, results.length)}%  ${bar}`);
}

// ── Niche distribution in sample ──────────────────────────────────────────────
console.log('\n  NICHE DISTRIBUTION IN SAMPLE');
divider('·', 60);
const nicheDist = {};
for (const r of results) {
  const n = r.primary_niche || 'null';
  if (!nicheDist[n]) nicheDist[n] = { count: 0, totalConf: 0, flagged: 0 };
  nicheDist[n].count++;
  nicheDist[n].totalConf += r.classification_confidence;
  if (r.flags.length > 0) nicheDist[n].flagged++;
}
const sortedNiches = Object.entries(nicheDist).sort((a, b) => b[1].count - a[1].count);
console.log(`  ${pad('niche', 20)} ${rpad('count', 6)} ${rpad('avg_conf', 9)} ${rpad('flagged%', 9)}`);
divider('·', 50);
for (const [niche, d] of sortedNiches) {
  const avgC = Math.round(d.totalConf / d.count);
  const flagPct = pct(d.flagged, d.count);
  const color = flagPct >= 50 ? '\x1b[31m' : flagPct >= 25 ? '\x1b[33m' : '';
  console.log(`  ${pad(niche, 20)} ${rpad(d.count, 6)} ${rpad(avgC + '%', 9)} ${color}${rpad(flagPct + '%', 9)}\x1b[0m`);
}

// ── Top misclassifications ────────────────────────────────────────────────────
const topN = results.filter(r => r.flags.length > 0).slice(0, TOP);

console.log(`\n  TOP ${topN.length} HIGHEST-IMPACT MISCLASSIFICATIONS  (ranked by subs × conflict_score)`);
divider();

const H = { rank: 4, name: 26, subs: 7, niche: 15, arch: 20, fmt: 12, conf: 5 };
console.log(
  `  ${pad('#', H.rank)} ${pad('channel', H.name)} ${rpad('subs', H.subs)}` +
  `  ${pad('niche', H.niche)} ${pad('archetype', H.arch)} ${pad('format', H.fmt)}` +
  `  ${rpad('conf', H.conf)}  conflict flags`
);
divider('·', 120);

for (let i = 0; i < topN.length; i++) {
  const r = topN[i];
  const confColor = r.classification_confidence >= 70 ? '\x1b[32m' : r.classification_confidence >= 40 ? '\x1b[33m' : '\x1b[31m';

  console.log(
    `  ${rpad(i + 1, H.rank)} ${pad(r.channel_name, H.name)} ${rpad(fmtSubs(r.channel_subscribers), H.subs)}` +
    `  ${pad(r.primary_niche || '—', H.niche)} ${pad(r.content_archetype || '—', H.arch)} ${pad(r.format_type || '—', H.fmt)}` +
    `  ${confColor}${rpad(r.classification_confidence + '%', H.conf)}\x1b[0m  ${r.flags.map(f => f.type).join(', ')}`
  );

  // Show top flag details
  const importantFlags = r.flags.filter(f =>
    ['HARD_NA_CONFLICT', 'RAW_NICHE_MISMATCH', 'TITLE_VOCAB_MISMATCH', 'BTAG_NICHE_MISMATCH'].includes(f.type)
  );
  for (const f of importantFlags) {
    console.log(`  ${' '.repeat(H.rank + 1)} \x1b[2m↳ ${f.type}: ${f.detail}\x1b[0m`);
  }

  // Show repair suggestion
  if (r.repair) {
    const rr = r.repair;
    console.log(`  ${' '.repeat(H.rank + 1)} \x1b[36m→ REPAIR: ${r.primary_niche} → ${rr.niche}  (score:${rr.weight}, evidence: ${rr.reasons.slice(0, 2).join(', ')})\x1b[0m`);
  }

  // Show title sample if available and relevant
  if (r.titles.length > 0 && r.flags.some(f => f.type === 'TITLE_VOCAB_MISMATCH' || f.type === 'RAW_NICHE_MISMATCH')) {
    const sample = r.titles.slice(0, 3).join(' | ');
    console.log(`  ${' '.repeat(H.rank + 1)} \x1b[2mTitles: ${sample.slice(0, 110)}\x1b[0m`);
  }
}

// ── Repair candidate summary ──────────────────────────────────────────────────
const repairCandidates = results
  .filter(r => r.repair && r.classification_confidence < 60)
  .sort((a, b) => (b.channel_subscribers || 0) - (a.channel_subscribers || 0));

if (repairCandidates.length > 0) {
  console.log(`\n  AUTO-REPAIR CANDIDATES (conf<60%, ordered by subscribers)  —  ${repairCandidates.length} channels`);
  divider();
  console.log(`  ${pad('channel', 30)} ${rpad('subs', 7)}  ${pad('current_niche', 18)} → ${pad('suggested_niche', 18)} ${rpad('repair_score', 12)}  evidence`);
  divider('·', 110);
  for (const r of repairCandidates.slice(0, 50)) {
    const rr = r.repair;
    console.log(
      `  ${pad(r.channel_name, 30)} ${rpad(fmtSubs(r.channel_subscribers), 7)}` +
      `  ${pad(r.primary_niche || '—', 18)} → ${pad(rr.niche, 18)}` +
      `  ${rpad(rr.weight, 12)}  ${rr.reasons.slice(0, 3).join(', ')}`
    );
  }
}

// ── Most common misclassification patterns ────────────────────────────────────
console.log('\n  MOST COMMON NICHE+ARCHETYPE CONFLICT PATTERNS');
divider('·', 60);
const naConflictCount = {};
for (const r of results) {
  for (const f of r.flags) {
    if (f.type === 'HARD_NA_CONFLICT' || f.type === 'SOFT_NA_CONFLICT' || f.type === 'INCOMPAT_ARCHETYPE') {
      naConflictCount[f.detail] = (naConflictCount[f.detail] || 0) + 1;
    }
  }
}
const sortedNa = Object.entries(naConflictCount).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [pattern, count] of sortedNa) {
  const pn = pattern.split('+')[0];
  const arch = pattern.split('+')[1];
  const isHard = HARD_CONFLICTS.has(pattern) ? '\x1b[31m[HARD]\x1b[0m' : SOFT_CONFLICTS.has(pattern) ? '\x1b[33m[SOFT]\x1b[0m' : '[INCOMPAT]';
  console.log(`  ${isHard}  ${rpad(count, 5)}×  ${pattern}`);
}

// ── Root cause recommendations ────────────────────────────────────────────────
console.log('\n  ROOT CAUSE ANALYSIS & RECOMMENDATIONS');
divider();

console.log(`
  RC-1  RAW_NICHE_MISMATCH (${flagTypeCount['RAW_NICHE_MISMATCH'] || 0} channels)
        The legacy "niche" field keyword contradicts the AI-assigned primary_niche.
        These channels were likely classified from title vocabulary alone without
        seeing the channel description, or the AI prompt mapped the wrong niche.
        Fix: Re-run classifyChannel() for channels where raw→detected != primary_niche
        with confidence_penalty > 20. Target: channels with high subscribers first.

  RC-2  HARD_NA_CONFLICT (${flagTypeCount['HARD_NA_CONFLICT'] || 0} channels)
        Niche+archetype combinations that are semantically impossible
        (e.g., finance+entertainer, news+entertainer, comedy+authority_educator).
        These are systematic prompt failures where the classifier mapped the wrong
        niche for a creator whose archetype is unambiguous.
        Fix: Add explicit archetype→niche guard to parseClassifierResponse():
        if archetype='entertainer' and primary_niche in ['finance','news','science']:
          override primary_niche using rawNiche or inferred_topics.

  RC-3  TITLE_VOCAB_MISMATCH (${flagTypeCount['TITLE_VOCAB_MISMATCH'] || 0} channels)
        Video title vocabulary contradicts the classified niche.
        This catches channels whose 15 most recent titles clearly belong to a
        different domain than what was classified.
        Fix: Add a lightweight title-niche pre-check in classifyChannel() — if
        detectNicheFromTitles() returns a niche with confidence >= 3 keyword hits
        and it differs from AI output, log a "title_niche_suspect" flag in the DB.

  RC-4  BTAG_NICHE_MISMATCH (${flagTypeCount['BTAG_NICHE_MISMATCH'] || 0} channels)
        Behavior tags (sketch, gameplay, recipe_based, etc.) point to a different
        niche than primary_niche. These are strong signals — sketch/character_driven
        almost never appear in finance or news channels.
        Fix: Add a post-classification validation in channelClassifier.js:
        for each btag in BTAG_NICHE_SIGNALS, if primary_niche not in expected_niches,
        reduce identity_confidence by 0.15 and flag for re-review.

  RC-5  INCOMPAT_ARCHETYPE / SOFT_NA_CONFLICT (${(flagTypeCount['INCOMPAT_ARCHETYPE'] || 0) + (flagTypeCount['SOFT_NA_CONFLICT'] || 0)} channels)
        Archetype is not compatible with niche but not a hard conflict.
        Often caused by personality_host leaking into niche-specific roles, or
        authority_educator being applied to channels that are clearly personality-led.
        Fix: Tighten the channelClassifier prompt Step 5 with explicit examples
        of personality_host vs authority_educator disambiguation.

  RC-6  INCOMPAT_FORMAT (${flagTypeCount['INCOMPAT_FORMAT'] || 0} channels)
        Format type doesn't fit the niche. Least critical — usually a minor signal.
        finance+vlog or comedy+tutorial are suspicious but not always wrong.

  PRIORITY ORDER FOR BULK RECLASSIFICATION:
    1. HARD_NA_CONFLICT with channel_subscribers > 1M         (systematic prompt failure)
    2. RAW_NICHE_MISMATCH with confidence < 50%               (likely wrong niche entirely)
    3. TITLE_VOCAB_MISMATCH with > 3 keyword hits in titles    (strong vocabulary signal)
    4. BTAG_NICHE_MISMATCH on sketch/character_driven/gameplay (very high-signal tags)
`);

divider();
console.log(`  Legend: conf = classification_confidence (0–100). Lower = more likely misclassified.`);
console.log(`  Impact score = log10(subs+1) × (100-conf). Prioritises large channels with bad confidence.\n`);
