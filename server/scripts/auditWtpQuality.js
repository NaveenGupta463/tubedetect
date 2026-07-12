'use strict';

// ── WTP Quality Benchmark ─────────────────────────────────────────────────────
// Measures recommendation quality across 10 creator categories.
//
// Metrics per category (computed over the top-N pooled ideas):
//   specificity      — does the topic name a concrete subject?     (0–100)
//   personalization  — is the idea tailored to this creator?        (0–100)
//   evidence         — how well-backed by peer data?                (0–100)
//   generic_rate     — % ideas matching format-directive templates   (lower better)
//   duplicate_rate   — % ideas with high word-overlap to a prior    (lower better)
//   diversity        — unique first-keyword clusters / total ideas  (0–100)
//
// Output: category-by-category report → overall score → worst categories
//         → root-cause table → single highest-impact engine improvement
//
// Usage:
//   node server/scripts/auditWtpQuality.js
//   node server/scripts/auditWtpQuality.js --channels=8 --top=20 --verbose
//   node server/scripts/auditWtpQuality.js --category=Gaming --verbose

require('dotenv').config({ path: __dirname + '/../.env' });

const path        = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { computeWhatToPost }          = require('../services/whatToPost');
const { resolveCreatorPeerContext }  = require('../services/creatorPeerContext');
const {
  STOPWORDS, HOOK_PHRASES, DEVANAGARI_RE, SOUTH_SCRIPT_RE, extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS }             = require('../lib/creatorMode');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);
const CHANNELS_PER_CAT = Math.max(2, Math.min(20, Number(args.channels) || 5));
const TOP_N            = Math.max(5, Math.min(50, Number(args.top)      || 20));
const VERBOSE          = !!args.verbose;
const CAT_FILTER       = args.category ? String(args.category).toLowerCase() : null;

// ── DB ────────────────────────────────────────────────────────────────────────
function openReadonlyDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const stmtCache = new Map();
  const stmt = (sql) => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all:   (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:   (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:   ()            => ({ changes: 0 }),
    exec:  ()            => undefined,
    close: ()            => { stmtCache.clear(); raw.close(); },
  };
}

const db  = openReadonlyDb();
const ctx = {
  resolveCreatorPeerContext, extractPhrases, getVelocity,
  classifyTrend, getFormatWinner, PODCAST_META_TOKENS,
  STOPWORDS, HOOK_PHRASES, SOUTH_SCRIPT_RE, DEVANAGARI_RE,
};

// ── Categories ────────────────────────────────────────────────────────────────
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
  // Mid-sentence capitalized words not in stopword set → probable proper nouns
  const words = topic.split(/[\s\-—–:,!?]+/).slice(1);
  return words.filter(w => {
    const c = w.replace(/[^a-zA-Z]/g, '');
    return c.length >= 3 && /^[A-Z]/.test(c) && !ENTITY_STOP.has(c.toLowerCase());
  }).length;
}

function specificityScore(idea) {
  // Use the engine's own score when present (attached by computeWhatToPost)
  if (typeof idea.specificity_score === 'number') return idea.specificity_score;

  const topic = String(idea.topic || idea.title || '').trim();
  if (!topic) return 0;

  const entities  = countNamedEntities(topic);
  const hasNumber = /\d/.test(topic);
  const isDirective = FORMAT_DIRECTIVE_RE.test(topic);

  if (isDirective) {
    if (entities === 0 && !hasNumber) return CLEAR_PAYOFF_RE.test(topic) ? 3 : 8;
    return Math.min(35, 15 + entities * 12 + (hasNumber ? 5 : 0));
  }

  if (PLACEHOLDER_RE.test(topic))          return 8;

  let score = 35;
  score += Math.min(30, entities * 10);
  if (/\b\d{4}\b/.test(topic))                                                  score += 12;
  if (/\b\d+\s*(x|%|ways|reasons|tips|mistakes|things|steps)\b/i.test(topic))  score += 14;
  else if (hasNumber)                                                            score +=  8;
  if (topic.length >= 50) score += 10;
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
  if ((bd.dna_boost      || 0) > 0) score += 12;
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

// Format directive: "Make a X video with a clear payoff" — no entity, no number
function isFormatDirective(idea) {
  const t = String(idea.topic || '');
  if (!FORMAT_DIRECTIVE_RE.test(t)) return false;
  const entities = countNamedEntities(t);
  return entities === 0 && !/\d/.test(t);
}

function isGeneric(idea) {
  // Generic rate measures format-directive contamination only.
  // Fallback evergreen is tracked separately via evidence/personalization scores.
  return isFormatDirective(idea) || PLACEHOLDER_RE.test(String(idea.topic || ''));
}

const JACCARD_STOP = new Set(['the', 'a', 'an', 'of', 'in', 'to', 'is', 'it', 'on', 'for', 'and', 'with', 'how', 'why', 'what', 'make', 'video']);

function jaccardWords(a, b) {
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
  const seen  = [];
  for (const t of topics) {
    if (seen.some(prev => jaccardWords(prev, t) >= 0.55)) dupes++;
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
    const key = words[0]?.toLowerCase() || '_empty';
    clusters.add(key);
  }
  return Math.round((clusters.size / ideas.length) * 100);
}

// ── Composite scoring ─────────────────────────────────────────────────────────
function phraseWordCount(idea) {
  return String(idea.topic || '').trim().split(/\s+/).filter(Boolean).length;
}

function scoreIdeas(ideas) {
  if (!ideas.length) return null;

  const specs     = ideas.map(specificityScore);
  const pers      = ideas.map(personalizationScore);
  const evids     = ideas.map(evidenceScore);
  const genCnt    = ideas.filter(isGeneric).length;
  const fallbackCnt = ideas.filter(i => i.source === 'fallback_evergreen').length;
  const genRate   = genCnt / ideas.length;
  const dupeRate  = computeDuplicateRate(ideas);
  const diversity = computeDiversityScore(ideas);

  const wcs       = ideas.map(phraseWordCount);
  const avgWords  = wcs.reduce((s, v) => s + v, 0) / wcs.length;
  const bigramPct = Math.round(wcs.filter(w => w <= 2).length / wcs.length * 100);
  const longPct   = Math.round(wcs.filter(w => w >= 4).length / wcs.length * 100);

  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

  const specificity     = Math.round(avg(specs));
  const personalization = Math.round(avg(pers));
  const evidence        = Math.round(avg(evids));

  // Weighted composite (0–100)
  const composite = Math.round(
    specificity     * 0.25 +
    evidence        * 0.25 +
    personalization * 0.15 +
    (1 - genRate)   * 100  * 0.20 +
    (1 - dupeRate)  * 100  * 0.05 +
    diversity       * 0.10,
  );

  return {
    specificity, personalization, evidence,
    genericRate:   Math.round(genRate      * 100),
    genericCount:  genCnt,
    fallbackRate:  Math.round((fallbackCnt / ideas.length) * 100),
    duplicateRate: Math.round(dupeRate     * 100),
    diversity,
    composite,
    avgWords:  +avgWords.toFixed(1),
    bigramPct,
    longPct,
  };
}

// ── Root cause classification ─────────────────────────────────────────────────
// Classify why a specific idea is low-quality.
// Only called for ideas where specificityScore < 25 or source=fallback.

const DNA_TEMPLATE_RE  = /\b(hidden cost of|startup discipline|career leverage|communication gap|leadership principle|personal brand|growth mindset|imposter syndrome)\b/i;

function classifyRootCause(idea) {
  const t = String(idea.topic || '');
  if (FORMAT_DIRECTIVE_RE.test(t) || CLEAR_PAYOFF_RE.test(t)) return 'FORMAT_DIRECTIVE';
  if (DNA_TEMPLATE_RE.test(t) && idea.idea_type === 'dna_bet') return 'DNA_TEMPLATE';
  if (idea.source === 'fallback_evergreen')                    return 'FALLBACK_POOL';
  const tier = idea.confidence_tier || idea.confidence;
  if (tier === 'low' && !(idea.examples || []).length)         return 'LOW_EVIDENCE';
  return null;
}

// ── Channel sampling ──────────────────────────────────────────────────────────
function sampleChannels(cat, limit) {
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
    // Fallback: education/business/finance channels when no podcast-mode rows exist
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

// ── Report helpers ────────────────────────────────────────────────────────────
function bar(score, width = 20) {
  const filled = Math.min(width, Math.round((score / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function grade(score)   { return score >= 70 ? '✓' : score >= 50 ? '●' : '✗'; }
function rateGrade(pct) { return pct  <=  5  ? '✓' : pct  <= 15  ? '●' : '✗'; }

function truncate(s, n = 68) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function ideaTag(idea) {
  const spec = specificityScore(idea);
  if (spec === 0) return '[✗ format]';
  if (spec < 25)  return '[✗ generic]';
  if (spec >= 70) return '[✓ topic]';
  return '[● topic]';
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY      = new Date().toISOString().slice(0, 10);
const categories = CAT_FILTER
  ? ALL_CATEGORIES.filter(c => c.name.toLowerCase() === CAT_FILTER)
  : ALL_CATEGORIES;

console.log('');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  WTP QUALITY BENCHMARK  —  ' + TODAY);
console.log(`  Channels per category: ${CHANNELS_PER_CAT}  |  Top ideas per category: ${TOP_N}`);
if (CAT_FILTER) console.log(`  Filter: ${args.category}`);
console.log('══════════════════════════════════════════════════════════════════');
console.log('');

const categoryResults = [];
const rootCauseCounts = { FORMAT_DIRECTIVE: 0, DNA_TEMPLATE: 0, FALLBACK_POOL: 0, LOW_EVIDENCE: 0 };

for (const cat of categories) {
  process.stdout.write(`  Sampling ${cat.name}...`);

  const channels = sampleChannels(cat, CHANNELS_PER_CAT);
  if (!channels.length) {
    console.log(' no channels found — skipping');
    continue;
  }
  console.log(` ${channels.length} channel(s)`);

  const allIdeas = [];
  let   errors   = 0;

  for (const ch of channels) {
    let result;
    try {
      result = computeWhatToPost(
        db,
        { channel_id: ch.channel_id, subscriber_count: String(ch.channel_subscribers || 0) },
        ctx,
      );
    } catch (e) {
      errors++;
      if (VERBOSE) console.log(`    [error] ${ch.channel_name || ch.channel_id}: ${e.message}`);
      continue;
    }
    const ideas = result?.ideas || [];
    allIdeas.push(...ideas);
    if (VERBOSE) {
      console.log(`    ${String(ch.channel_name || ch.channel_id).slice(0, 30).padEnd(30)} | ${ideas.length} ideas | niche=${ch.niche}`);
    }
  }

  // Dedup by topic, sort by combined quality (engine score + specificity), take top TOP_N
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
  const topIdeas = deduped.slice(0, TOP_N);

  // Classify root causes for low-quality ideas
  for (const idea of topIdeas) {
    const spec = specificityScore(idea);
    if (spec < 25 || idea.source === 'fallback_evergreen') {
      const cause = classifyRootCause(idea);
      if (cause) rootCauseCounts[cause]++;
    }
  }

  const scores = scoreIdeas(topIdeas);
  if (!scores) {
    console.log(`    (no ideas generated)`);
    continue;
  }

  categoryResults.push({
    name:     cat.name,
    sampled:  channels.length,
    errors,
    ideas:    topIdeas,
    scores,
  });
}

if (!categoryResults.length) {
  console.log('No results. Check that ingested_channels has rows and the DB path is correct.');
  db.close();
  process.exit(1);
}

// ── Category-by-category report ───────────────────────────────────────────────
console.log('');
console.log('  CATEGORY SCORES');
console.log('  ' + '─'.repeat(66));
console.log('');

const sortedResults = [...categoryResults].sort((a, b) => b.scores.composite - a.scores.composite);

for (const r of sortedResults) {
  const s = r.scores;
  const channelInfo = `${r.sampled - r.errors}/${r.sampled} channels`;
  console.log(`  ┌─ ${r.name.toUpperCase().padEnd(14)} ${channelInfo}  •  ${r.ideas.length} ideas`);
  console.log(`  │  Specificity      ${String(s.specificity).padStart(3)}/100  ${bar(s.specificity)}  ${grade(s.specificity)}`);
  console.log(`  │  Personalization  ${String(s.personalization).padStart(3)}/100  ${bar(s.personalization)}  ${grade(s.personalization)}`);
  console.log(`  │  Evidence         ${String(s.evidence).padStart(3)}/100  ${bar(s.evidence)}  ${grade(s.evidence)}`);
  console.log(`  │  Format-dir rate   ${String(s.genericRate).padStart(2)}%        ${rateGrade(s.genericRate)}`);
  console.log(`  │  Fallback rate     ${String(s.fallbackRate).padStart(2)}%        ${rateGrade(s.fallbackRate)}`);
  console.log(`  │  Duplicate rate    ${String(s.duplicateRate).padStart(2)}%        ${rateGrade(s.duplicateRate)}`);
  console.log(`  │  Diversity        ${String(s.diversity).padStart(3)}/100  ${bar(s.diversity)}  ${grade(s.diversity)}`);
  console.log(`  │  Avg phrase words  ${String(s.avgWords).padStart(3)}       (bigrams:${s.bigramPct}%  4+words:${s.longPct}%)`);
  console.log(`  │  ${'─'.repeat(48)}`);
  console.log(`  │  COMPOSITE        ${String(s.composite).padStart(3)}/100  ${bar(s.composite)}  ${grade(s.composite)}`);

  if (r.ideas.length) {
    // Top 3 best and worst by specificity for quality inspection
    const bySpec  = [...r.ideas].sort((a, b) => specificityScore(b) - specificityScore(a));
    const best3   = bySpec.slice(0, 3);
    const worst3  = bySpec.slice(-3).reverse();

    console.log(`  │`);
    console.log(`  │  Best specificity:`);
    for (const idea of best3) {
      console.log(`  │    ${ideaTag(idea).padEnd(12)} ${truncate(idea.topic, 60)}  (score:${idea.score})`);
    }

    if (worst3.some(i => specificityScore(i) < 40)) {
      console.log(`  │  Weakest specificity:`);
      for (const idea of worst3) {
        if (specificityScore(idea) < 40) {
          console.log(`  │    ${ideaTag(idea).padEnd(12)} ${truncate(idea.topic, 60)}  (score:${idea.score})`);
        }
      }
    }
  }

  console.log(`  └${'─'.repeat(64)}`);
  console.log('');
}

// ── Overall score ─────────────────────────────────────────────────────────────
const overallScore = Math.round(
  categoryResults.reduce((s, r) => s + r.scores.composite, 0) / categoryResults.length,
);

const metricAvg = (field) => Math.round(
  categoryResults.reduce((s, r) => s + r.scores[field], 0) / categoryResults.length,
);

console.log('  ' + '═'.repeat(66));
console.log(`  OVERALL QUALITY SCORE:  ${overallScore}/100  ${grade(overallScore)}`);
console.log('');
console.log(`  Avg specificity:      ${metricAvg('specificity')}/100`);
console.log(`  Avg personalization:  ${metricAvg('personalization')}/100`);
console.log(`  Avg evidence:         ${metricAvg('evidence')}/100`);
console.log(`  Avg format-dir rate:  ${metricAvg('genericRate')}%`);
console.log(`  Avg fallback rate:    ${metricAvg('fallbackRate')}%`);
console.log(`  Avg duplicate rate:   ${metricAvg('duplicateRate')}%`);
console.log(`  Avg diversity:        ${metricAvg('diversity')}/100`);
const avgWordsOverall = +(categoryResults.reduce((s, r) => s + r.scores.avgWords, 0) / categoryResults.length).toFixed(1);
const avgBigramPct   = Math.round(categoryResults.reduce((s, r) => s + r.scores.bigramPct, 0) / categoryResults.length);
const avgLongPct     = Math.round(categoryResults.reduce((s, r) => s + r.scores.longPct, 0) / categoryResults.length);
console.log(`  Avg topic words:      ${avgWordsOverall}  (bigrams:${avgBigramPct}%  4+words:${avgLongPct}%)`);
console.log('  ' + '═'.repeat(66));
console.log('');

// ── Worst performing categories ───────────────────────────────────────────────
const worst3 = [...categoryResults].sort((a, b) => a.scores.composite - b.scores.composite).slice(0, 3);

console.log('  WORST-PERFORMING CATEGORIES');
console.log('  ' + '─'.repeat(66));
for (let i = 0; i < worst3.length; i++) {
  const r = worst3[i];
  const s = r.scores;
  const flags = [];
  if (s.genericRate    > 15) flags.push(`generic rate ${s.genericRate}%`);
  if (s.specificity    < 50) flags.push(`specificity ${s.specificity}/100`);
  if (s.evidence       < 45) flags.push(`evidence ${s.evidence}/100`);
  if (s.personalization < 35) flags.push(`personalization ${s.personalization}/100`);
  if (s.duplicateRate  > 10) flags.push(`duplicates ${s.duplicateRate}%`);
  console.log(`  ${i + 1}. ${r.name.padEnd(15)} ${s.composite}/100  —  ${flags.join(', ') || 'all metrics below threshold'}`);
}
console.log('');

// ── Root causes ───────────────────────────────────────────────────────────────
const totalProblematic = Object.values(rootCauseCounts).reduce((s, v) => s + v, 0);

if (totalProblematic > 0) {
  console.log('  ROOT CAUSES  (low-quality ideas in top-' + TOP_N + ' sets, by category)');
  console.log('  ' + '─'.repeat(66));
  console.log('');

  const CAUSE_META = {
    FORMAT_DIRECTIVE: {
      label: 'Format directive instead of topic',
      detail: '"Make a X video with a clear payoff" — creative engine format bucket has no\n' +
              '    peer titles. buildAxisMap discards titles; commandForFormatLabel fires.\n' +
              '    File: creativeOpportunityEngine.js — buildAxisMap, computeCreativeOpportunities',
    },
    DNA_TEMPLATE: {
      label: 'DNA family-template topic (not creator-specific)',
      detail: '"The hidden cost of career leverage" — FAMILY_DEFAULT_SUBJECTS subjects in\n' +
              '    originalBets.js are shared across every channel in a niche family.\n' +
              '    File: originalBets.js — FAMILY_DEFAULT_SUBJECTS, makeIdea()',
    },
    FALLBACK_POOL: {
      label: 'Peer pool too thin → fallback_evergreen reached top-' + TOP_N,
      detail: 'Data-backed ideas < 5 for this creator → _getNicheFallbackToFive fired.\n' +
              '    Root: peer expansion failed or niche has too few ingested channels.\n' +
              '    File: whatToPost.js — _getNicheFallbackToFive, resolveCreatorPeerContext',
    },
    LOW_EVIDENCE: {
      label: 'Low-confidence idea (0 peer examples) in top positions',
      detail: 'confidence=low, examples=[], but score high enough to rank in top positions.\n' +
              '    DNA bets and single-peer ideas can outrank medium-confidence peer topics.\n' +
              '    File: whatToPost.js — _orderByConfidence, scoreForIdea (originalBets.js)',
    },
  };

  const sorted = Object.entries(rootCauseCounts)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a);

  for (const [cause, count] of sorted) {
    const pct  = Math.round((count / totalProblematic) * 100);
    const meta = CAUSE_META[cause];
    console.log(`  ▸ ${meta.label}`);
    console.log(`    Count: ${count} ideas (${pct}% of problematic)`);
    console.log(`    ${meta.detail}`);
    console.log('');
  }
}

// ── Single highest-impact improvement ─────────────────────────────────────────
const topCause = Object.entries(rootCauseCounts).sort(([, a], [, b]) => b - a)[0]?.[0]
  ?? 'FORMAT_DIRECTIVE';

const IMPROVEMENTS = {
  FORMAT_DIRECTIVE: {
    title:      'Add a minimum-specificity gate before any creative_package enters the output',
    file:       'creativeOpportunityEngine.js — computeCreativeOpportunities output loop (~line 1089)',
    what: [
      'The topic specificity fix (June 11) replaces format labels with the top peer title',
      'when sample_titles is non-empty. But when the format bucket has no peer titles (sparse',
      'pool), the label "Make a X video with a clear payoff" still reaches the output.',
      '',
      'Gate: before pushing any creative_package, compute specificityScore(candidate).',
      'If specificityScore < 20, SUPPRESS the idea rather than include it. Force the engine',
      'to fall through to the next highest-scoring opportunity instead of emitting a format',
      'directive. This benefits all creative families simultaneously (wellness, entertainment,',
      'gaming, experience) with one check, and makes the fallback cascade fire EARLIER —',
      'which is more honest than confidently showing a zero-specificity recommendation.',
    ],
    lift: '~20–30pt specificity gain for Health, Gaming, Entertainment. ~12pt overall composite.',
    affects: 'All Category B + C channels (creative/experience engine).',
  },
  DNA_TEMPLATE: {
    title:      'Suppress FAMILY_DEFAULT_SUBJECTS when ≥10 peer-backed ideas already exist',
    file:       'originalBets.js — buildOriginalBets() / makeIdea()',
    what: [
      'Family-level template subjects ("career leverage", "startup discipline") appear even',
      'when the peer topic engine already has 15 strong ideas for the creator. They score',
      '48–72 (after the cap fix) but still reach top-20 when peer coverage is moderate.',
      '',
      'Gate: in buildOriginalBets(), count how many non-family-template ideas are already',
      'in the candidate pool. If >= 10 peer-backed ideas exist, omit all ideas where',
      'archetype.startsWith("family:"). No scoring change needed — structural suppression.',
      'Family templates can remain as a "for inspiration" section after the main list.',
    ],
    lift: '~12pt personalization gain for Finance, Business, Podcast. ~8pt overall composite.',
    affects: 'All channels across all niches that use FAMILY_DEFAULT_SUBJECTS templates.',
  },
  FALLBACK_POOL: {
    title:      'Raise the "enough organic ideas" gate before allowing fallback ideas into top-10',
    file:       'whatToPost.js — _getNicheFallbackToFive and the final merge (lines ~3600–3700)',
    what: [
      'Fallback ideas appear when organic idea count < 5. But 3 of those 5 may be DNA bets',
      '(confidence=low, 0 peer channels), leaving effectively 2 peer-backed ideas + fallback.',
      '',
      'Gate: change the "enough ideas" threshold from 5 to 8, counting only ideas where',
      'confidence != "low" OR examples.length > 0. This forces the fallback trigger earlier',
      'for thin pools, making it explicit when a niche needs more ingestion rather than',
      'silently padding with generic content. Also reveals which niches to prioritise next.',
    ],
    lift: '~10pt evidence gain for thin niches. Surfaces which niche pools need ingestion.',
    affects: 'All categories with < 20 peer channels in pool.',
  },
  LOW_EVIDENCE: {
    title:      'Reserve positions 7–10 for confidence >= medium in the final ranking',
    file:       'whatToPost.js — _orderByConfidence (~line 2297)',
    what: [
      'Low-confidence ideas (0 peer channels) currently rank purely on score. A DNA bet at',
      'score 68 outranks a peer-backed idea at score 64 with confidence=medium.',
      '',
      'Change: in _orderByConfidence, add an "evidence reserve" for positions 7–10.',
      'When filling positions 7–10, prefer confidence >= medium over confidence=low,',
      'even if score is lower. Low-confidence ideas are still shown at positions 11+.',
      'This guarantees every creator sees >= 6 data-backed ideas in the first 10.',
      'One conditional in the sort comparator — zero risk of breaking other ordering.',
    ],
    lift: '~15pt evidence gain across all categories. Visible to every active creator.',
    affects: 'Every channel that has at least one medium/high-confidence idea.',
  },
};

const best = IMPROVEMENTS[topCause] || IMPROVEMENTS.FORMAT_DIRECTIVE;

console.log('  ' + '═'.repeat(66));
console.log('  SINGLE HIGHEST-IMPACT ENGINE IMPROVEMENT');
console.log('  (selected by root-cause frequency in this benchmark run)');
console.log('  ' + '─'.repeat(66));
console.log('');
console.log(`  ${best.title}`);
console.log(`  File: ${best.file}`);
console.log('');
for (const line of best.what) {
  console.log(`  ${line}`);
}
console.log('');
console.log(`  Expected lift:  ${best.lift}`);
console.log(`  Affects:        ${best.affects}`);
console.log('');
console.log('  ' + '═'.repeat(66));
console.log('');

db.close();
process.exit(0);
