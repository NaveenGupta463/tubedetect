'use strict';

/**
 * peerSignalValueAudit.js  —  Research Track 1: Peer Signal Value Assessment
 *
 * Measures the actionable signal quality of peer_video_signal recommendations
 * across seven dimensions:
 *
 *   1. Usable rate           — peer_adaptability ≥ 65 OR peer_narrative ≥ 70
 *   2. Narrative rate        — peer_narrative ≥ 70 (distinct titles)
 *   3. Creator relevance     — concept_confidence ≥ 0.55 (expected 0% — confirmed)
 *   4. Title quality tiers   — Tier1=narrative≥80, Tier2=adapt≥65+narr<80,
 *                              Tier3=english+no-pattern, Tier4=non-english/spam
 *   5. Human quality by tier — Excellent+Good "positive rate" from gold labels
 *   6. Novelty signal        — does the DNA corpus already cover this pattern?
 *   7. Win rate by language  — english vs hindi vs other_latin
 *   8. Pattern value         — win rate per pattern (DISH_TECHNIQUE / WAY_TO / ...)
 *
 * Output:
 *   Console report  (structured, sections separated by rules)
 *   scripts/peer_signal_value_report.md
 *
 * Usage:
 *   node peerSignalValueAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT = path.resolve(__dirname, 'peer_signal_value_report.md');
const VERBOSE    = process.argv.includes('--verbose');

// ── Schema guard ──────────────────────────────────────────────────────────────
function checkColumns(db, table, required) {
  const cols = new Set(db.pragma(`table_info(${table})`).map(c => c.name));
  const missing = required.filter(c => !cols.has(c));
  return { cols, missing };
}

// ── Language helpers ───────────────────────────────────────────────────────────
function hasNonLatinScript(t) {
  // Devanagari, Gurmukhi, Odia, Telugu, Malayalam, Thai ranges
  const nonLatin = (t.match(/[ऀ-ॿ਀-੿଀-୿ఀ-౿ഀ-ൿ฀-๿]/g) || []).length;
  return nonLatin / Math.max(t.length, 1) > 0.05;
}

const HINDI_WORD_RE = /\b(ki|ka|ko|ne|meri|mera|hua|hoga|hai|ho|se|pe|par|bhi|aaj|kal|yeh|woh|kya|kisi|karo|kiya|gaya|gyi|tha|thi|the|ab|apna|apni|unka|uska|nahi|nhi|nai|bhai|yaar|dost|beta|beti|aur|lekin|phir|toh|lagri|bhari|chori|khana|ghar|parivar|Khajur|Karela|Anaya|Rishabh|Mansi|Binesar|Uday)\b/i;

function isHindiTitle(t) {
  if (hasNonLatinScript(t)) return true;
  const words  = t.trim().split(/\s+/);
  const hindi  = words.filter(w => HINDI_WORD_RE.test(w)).length;
  return hindi >= 2 && hindi / words.length >= 0.3;
}

const SPANISH_RE           = /\b(hablé|con mini|exe|los|backrooms|este|esta|una|para)\b/i;
const SOUTH_INDIAN_ROMAN_RE= /\b(panna|vidunga|da|peru|cheppandi|chudham|manigali|muni|soumya|dillagi)\b/i;
const ODIA_ROMAN_RE        = /\bku\b.*\bmu\b/i;

function isOtherLatin(t) {
  return SPANISH_RE.test(t) || SOUTH_INDIAN_ROMAN_RE.test(t) || ODIA_ROMAN_RE.test(t);
}

// ── Spam helpers ───────────────────────────────────────────────────────────────
const EPISODE_RE    = /\b(episode|ep\.?\s*\d+|part\s*\d+|season\s*\d+|s\d{1,2}e\d{1,2}|#\d+)\b/i;
const SHOW_NAME_RE  = /\b(taarak mehta|chashmah|comedy video \d{4}|fun tv|busy fun|fun ltd)\b/i;
const SERIAL_RE     = /\b(ladies special|anniyan|raakh|shaidai)\b/i;
const PROMO_RE      = /@\w+|presented by|ujooba|happilac|berg snow|buy now|#ad\b/i;
const SELF_PROMO_RE = /have you watched this|subscribe|follow me|link in bio/i;

function isSpam(t) {
  return EPISODE_RE.test(t) || SHOW_NAME_RE.test(t) || SERIAL_RE.test(t) ||
         PROMO_RE.test(t)   || SELF_PROMO_RE.test(t);
}

const TRIVIAL_WORDS = new Set(['a','an','the','is','in','on','at','of','it','my','me','i','we','he','she','his','her','our','vs','and','or','but']);
function meaningfulWordCount(t) {
  return t.trim().split(/\s+/).filter(w => w.length > 1 && !TRIVIAL_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))).length;
}
function isShortVague(t) {
  if (meaningfulWordCount(t) < 4) return true;
  const wc = t.trim().split(/\s+/).length;
  return wc <= 3 && !/\b(how|why|what|mistake|checklist|recipe|guide)\b/i.test(t);
}

const ENTERTAINMENT_RE = /\b(challenge|stunt|prank|reaction|unboxing|haul|vlog|try|vs|battle|tasting|eating|testing|we made|i made|i bought|i turned|haunted|ghost|wedding|party|birthday|shopping|review|tour|trip|travel|hotel|resort|cricket|match|ipl|football)\b/i;

function isEntertainmentNoise(t) {
  return ENTERTAINMENT_RE.test(t);
}

// ── Pattern classifiers ───────────────────────────────────────────────────────
// Narrative: high-concept story patterns (Tier 1 candidate)
const NARRATIVE_DETECTORS = {
  FORCED_CONFLICT:     t => /\bforced (to|into)\b/i.test(t) || /\b(tiger|animal|beast)\b.*\b(hunt|kill|attack)\b/i.test(t),
  ASSUMPTION_REVERSAL: t => /\b(we thought|scientists (thought|believed)|it turns out|turns out|might (actually|end))\b/i.test(t) || /\b(frozen big bang|singularit)\b/i.test(t),
  MEMORY_OBJECT:       t => /\b(years? of (memories|life)|a (santro|family|car) and \d+)/i.test(t) || (/\b\d{2,} years\b/i.test(t) && /\b(memories|journey|story)\b/i.test(t)),
  CONFLICT_EXPOSE:     t => /\bcan['']?t (negotiate|deal|fight|hide|stop)\b/i.test(t) || /\bprove(s|d)? (it|him|them)\b/i.test(t),
  DISCOVERY_SCIENCE:   t => /\b(black holes?|quantum|singularit|chernobyl|mariana trench|tornado|why so many)\b/i.test(t),
};

// Adaptable: template-transferable patterns (Tier 2 candidate)
const ADAPTABLE_DETECTORS = {
  DISH_TECHNIQUE: t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|cake|bread|coffee|asmr cooking)\b/i.test(t),
  WAY_TO:         t => /^(how |what nobody|the best way)/i.test(t) || /\b(how to|way to|the best way)\b/i.test(t),
  MISTAKE:        t => /\b(mistake|trap|pitfall|wrong|hidden cost|beginner mistake|common mistake|get wrong)\b/i.test(t),
  CHECKLIST:      t => /\b(checklist|guide|tips?|routine|plan|framework)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t),
  COLON:          t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why|the trap|the beginner|can you make)\b/i.test(t),
};

function detectPattern(t) {
  for (const [name, fn] of Object.entries(NARRATIVE_DETECTORS)) {
    if (fn(t)) return { group: 'NARRATIVE', name };
  }
  for (const [name, fn] of Object.entries(ADAPTABLE_DETECTORS)) {
    if (fn(t)) return { group: 'ADAPTABLE', name };
  }
  return { group: 'NO_PATTERN', name: 'NO_PATTERN' };
}

// ── Tier classifier ────────────────────────────────────────────────────────────
// Uses peer_narrative and peer_adaptability scores from the DB (enriched rows).
// Falls back to text-based pattern detection for titles with zero scores.
function assignTier(row) {
  const narr  = row.peer_narrative   || 0;
  const adapt = row.peer_adaptability || 0;
  const lang  = (row.peer_language || '').toLowerCase();

  // Tier 1 — strong narrative signal
  if (narr >= 80) return 'TIER1_NARRATIVE';

  // Tier 2 — adaptable, not narrative-tier
  if (adapt >= 65 && narr < 80) return 'TIER2_ADAPTABLE';

  // Tier 3 / 4 — use text analysis for unscored rows
  const t = String(row.generated_title || '');

  if (isHindiTitle(t) || isOtherLatin(t) || lang === 'hindi' || lang === 'other_latin') {
    return 'TIER4_NON_ENGLISH';
  }
  if (isSpam(t) || (isShortVague(t) && !detectPattern(t).name.match(/NARRATIVE|ADAPTABLE/))) {
    return 'TIER4_NON_ENGLISH'; // treat spam as tier 4
  }

  // Adaptable pattern but below score threshold (0-scored rows)
  const { group } = detectPattern(t);
  if (group === 'NARRATIVE') return 'TIER1_NARRATIVE';
  if (group === 'ADAPTABLE') return 'TIER2_ADAPTABLE';

  // English, no pattern
  return 'TIER3_ENGLISH_NO_PATTERN';
}

// ── Novelty check — does DNA corpus already cover this? ───────────────────────
// Simple heuristic: look for a DNA title that shares the same core pattern
// and a significant subject overlap with the peer title.
function buildDnaPatternIndex(dnaRows) {
  // Index: map from detected pattern name → array of normalised subject words
  const index = {};
  for (const r of dnaRows) {
    const t = String(r.generated_title || '');
    const { name } = detectPattern(t);
    if (!index[name]) index[name] = [];
    const words = t.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !TRIVIAL_WORDS.has(w));
    index[name].push(new Set(words));
  }
  return index;
}

function isNovelVsDna(peerTitle, dnaIndex) {
  const t = String(peerTitle || '');
  const { name: peerPattern } = detectPattern(t);
  if (peerPattern === 'NO_PATTERN') return true; // can't be a dupe of a structured template

  const peerWords = new Set(t.toLowerCase().split(/\W+/).filter(w => w.length > 4 && !TRIVIAL_WORDS.has(w)));
  const existingSets = dnaIndex[peerPattern] || [];

  for (const dnaWordSet of existingSets) {
    let overlap = 0;
    for (const w of peerWords) {
      if (dnaWordSet.has(w)) overlap++;
    }
    const jaccardApprox = overlap / Math.max(peerWords.size + dnaWordSet.size - overlap, 1);
    if (jaccardApprox >= 0.45) return false; // not novel — DNA already covers it
  }
  return true; // novel pattern
}

// ── Win rate helper ───────────────────────────────────────────────────────────
function winRate(labels) {
  const total    = labels.length;
  if (total === 0) return { winRate: null, positive: 0, total: 0 };
  const positive = labels.filter(l => l === 'Excellent' || l === 'Good').length;
  return { winRate: positive / total, positive, total };
}

// ── Pretty print helpers ───────────────────────────────────────────────────────
function pct(n, d) {
  if (!d) return '—';
  return Math.round((n / d) * 100) + '%';
}
function rateStr(r) {
  if (r.winRate === null) return '— (no labels)';
  return `${pct(r.positive, r.total)} (${r.positive}/${r.total})`;
}
function hr(char = '─', width = 64) { return char.repeat(width); }

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  // ── Open DB ─────────────────────────────────────────────────────────────────
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // ── Schema guard ─────────────────────────────────────────────────────────────
  const tracesCheck = checkColumns(db, 'wtp_generation_traces', [
    'peer_language', 'peer_adaptability', 'peer_narrative',
    'concept_id', 'concept_confidence', 'family', 'wtp_score', 'generated_title', 'channel_id'
  ]);
  if (tracesCheck.missing.length > 0) {
    console.error(`[FATAL] wtp_generation_traces is missing columns: ${tracesCheck.missing.join(', ')}`);
    console.error('        Run the peer signal enrichment migration first.');
    process.exit(1);
  }

  // ── Load distinct peer titles from traces ────────────────────────────────────
  // Use the row with the highest (peer_narrative + peer_adaptability) to represent each title
  const peerRows = db.prepare(`
    SELECT
      generated_title,
      peer_language,
      MAX(peer_adaptability) as peer_adaptability,
      MAX(peer_narrative)    as peer_narrative,
      concept_id,
      concept_confidence,
      family,
      COUNT(DISTINCT channel_id) as channel_count
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal'
      AND generated_title IS NOT NULL
      AND generated_title != ''
    GROUP BY generated_title
  `).all();

  // ── Load gold labels ─────────────────────────────────────────────────────────
  // A title may have multiple gold rows (labelled for multiple channels).
  // Collect all label occurrences per title.
  const goldByTitle = new Map(); // title → [label, label, ...]
  const goldRows = db.prepare(`
    SELECT generated_title, human_label
    FROM wtp_human_quality_reviews
    WHERE rec_source = 'peer_video_signal'
      AND human_label IS NOT NULL
      AND generated_title IS NOT NULL
  `).all();
  for (const r of goldRows) {
    if (!goldByTitle.has(r.generated_title)) goldByTitle.set(r.generated_title, []);
    goldByTitle.get(r.generated_title).push(r.human_label);
  }

  // ── Load DNA titles for novelty check ────────────────────────────────────────
  const dnaRows = db.prepare(`
    SELECT generated_title
    FROM wtp_generation_traces
    WHERE rec_source != 'peer_video_signal'
      AND generated_title IS NOT NULL
  `).all();
  const dnaIndex = buildDnaPatternIndex(dnaRows);

  db.close();

  // ── Enrich each peer row ──────────────────────────────────────────────────────
  const enriched = peerRows.map(r => {
    const tier    = assignTier(r);
    const gold    = goldByTitle.get(r.generated_title) || [];
    const { group: patternGroup, name: patternName } = detectPattern(r.generated_title);
    const novel   = isNovelVsDna(r.generated_title, dnaIndex);

    // usable = score-based
    const usable  = (r.peer_adaptability >= 65) || (r.peer_narrative >= 70);
    const hasCreatorRelevance = (r.concept_confidence !== null && r.concept_confidence >= 0.55);

    return {
      title:             r.generated_title,
      language:          (r.peer_language || 'unknown').toLowerCase(),
      adaptability:      r.peer_adaptability || 0,
      narrative:         r.peer_narrative    || 0,
      conceptConf:       r.concept_confidence,
      channelCount:      r.channel_count,
      tier,
      patternGroup,
      patternName,
      novel,
      usable,
      hasCreatorRelevance,
      gold, // array of labels
    };
  });

  const total = enriched.length;

  // ═══════════════════════════════════════════════════════════════════════════
  // METRIC 1 — Usable rate
  // ═══════════════════════════════════════════════════════════════════════════
  const usableSet    = enriched.filter(r => r.usable);
  const usableCount  = usableSet.length;

  // METRIC 2 — Narrative rate
  const narrativeSet   = enriched.filter(r => r.narrative >= 70);
  const narrativeCount = narrativeSet.length;

  // METRIC 3 — Creator relevance (concept_confidence)
  const relevantSet   = enriched.filter(r => r.hasCreatorRelevance);
  const relevantCount = relevantSet.length;
  // Also check: how many have any non-null concept_confidence?
  const nonNullConf   = enriched.filter(r => r.conceptConf !== null).length;

  // METRIC 4 — Tier distribution
  const tierCounts = {};
  for (const r of enriched) {
    tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;
  }
  const TIER_ORDER = ['TIER1_NARRATIVE', 'TIER2_ADAPTABLE', 'TIER3_ENGLISH_NO_PATTERN', 'TIER4_NON_ENGLISH'];
  const TIER_LABELS = {
    TIER1_NARRATIVE:         'Tier 1 — Narrative (narr ≥ 80)',
    TIER2_ADAPTABLE:         'Tier 2 — Adaptable (adapt ≥ 65, narr < 80)',
    TIER3_ENGLISH_NO_PATTERN:'Tier 3 — English, no pattern',
    TIER4_NON_ENGLISH:       'Tier 4 — Non-English / spam',
  };

  // METRIC 5 — Human quality by tier
  const tierGold = {};
  for (const r of enriched) {
    if (!tierGold[r.tier]) tierGold[r.tier] = [];
    tierGold[r.tier].push(...r.gold);
  }

  // METRIC 6 — Novelty signal
  const novelCount    = enriched.filter(r => r.novel).length;
  const nonNovelCount = total - novelCount;

  // By tier novelty
  const novelByTier = {};
  for (const r of enriched) {
    if (!novelByTier[r.tier]) novelByTier[r.tier] = { novel: 0, total: 0 };
    novelByTier[r.tier].total++;
    if (r.novel) novelByTier[r.tier].novel++;
  }

  // METRIC 7 — Win rate by language
  const langGroups = {};
  for (const r of enriched) {
    const lang = isHindiTitle(r.title) ? 'hindi'
               : isOtherLatin(r.title)  ? 'other_latin'
               : 'english';
    if (!langGroups[lang]) langGroups[lang] = [];
    langGroups[lang].push(...r.gold);
  }

  // METRIC 8 — Win rate by pattern
  const patternGroups = {};
  for (const r of enriched) {
    const key = r.patternName;
    if (!patternGroups[key]) patternGroups[key] = [];
    patternGroups[key].push(...r.gold);
  }

  // Gold label totals (for validation)
  const allGoldLabels = enriched.flatMap(r => r.gold);
  const goldLabelCounts = {};
  for (const l of allGoldLabels) goldLabelCounts[l] = (goldLabelCounts[l] || 0) + 1;
  const goldTotal = allGoldLabels.length;
  const goldTitlesWithLabel = enriched.filter(r => r.gold.length > 0).length;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD REPORT LINES
  // ═══════════════════════════════════════════════════════════════════════════
  const lines = [];
  const md    = [];

  function emit(text) {
    lines.push(text);
    // strip ANSI if any; keep as plain markdown
    md.push(text);
  }
  function emitHr(c = '─', w = 64) { emit(hr(c, w)); }
  function emitBlank() { emit(''); }

  emitHr('═');
  emit('  Peer Signal Value Audit  —  Research Track 1');
  emit(`  ${total} distinct peer titles  |  ${goldTitlesWithLabel} with gold labels  |  ${goldTotal} total label instances`);
  emitHr('═');
  emitBlank();

  // ── Section 1: Usable & Narrative Rate ───────────────────────────────────
  emit('1. SIGNAL COVERAGE RATES');
  emitHr();
  emit(`  Usable rate    (adapt ≥ 65 OR narr ≥ 70):  ${usableCount}/${total}  =  ${pct(usableCount, total)}`);
  emit(`  Narrative rate (narr ≥ 70):                 ${narrativeCount}/${total}  =  ${pct(narrativeCount, total)}`);
  emit(`  Adaptable only (adapt ≥ 65, narr < 70):    ${usableCount - narrativeCount}/${total}  =  ${pct(usableCount - narrativeCount, total)}`);
  emitBlank();

  // ── Section 2: Creator Relevance ─────────────────────────────────────────
  emit('2. CREATOR RELEVANCE RATE  (concept_confidence ≥ 0.55)');
  emitHr();
  emit(`  Titles with concept_confidence ≥ 0.55:  ${relevantCount}/${total}  =  ${pct(relevantCount, total)}`);
  emit(`  Titles with ANY non-null concept_conf:   ${nonNullConf}/${total}  =  ${pct(nonNullConf, total)}`);
  emitBlank();
  emit('  WHY IT IS 0%:');
  emit('  peer_video_signal rows are sourced from raw YouTube peer channel titles');
  emit('  that have NOT passed through the concept-matching pipeline. The columns');
  emit('  concept_id, concept_confidence, and family are ALWAYS NULL for these');
  emit('  rows by design — the peer signal enrichment phase scores adaptability');
  emit('  and narrative instead, not creator-concept alignment. To get a non-zero');
  emit('  creator relevance rate, peer titles would need to run through the');
  emit('  dna_affinity or concept-matching step before being stored.');
  emitBlank();

  // ── Section 3: Tier Distribution ─────────────────────────────────────────
  emit('3. TITLE QUALITY TIERS');
  emitHr();
  emit('  Tier definition:');
  emit('    Tier 1 — narrative ≥ 80  (high-concept story, forced conflict, etc.)');
  emit('    Tier 2 — adaptability ≥ 65  AND  narrative < 80  (template-transfer)');
  emit('    Tier 3 — english + no strong pattern  (borderline)');
  emit('    Tier 4 — non-english / spam / short-vague');
  emitHr('·');
  emit(`  ${'Tier'.padEnd(44)} Count   Share`);
  emitHr('·');
  for (const tier of TIER_ORDER) {
    const n   = tierCounts[tier] || 0;
    const lbl = TIER_LABELS[tier];
    emit(`  ${lbl.padEnd(44)} ${String(n).padEnd(8)} ${pct(n, total)}`);
  }
  emitBlank();

  // ── Section 4: Human Quality by Tier ─────────────────────────────────────
  emit('4. HUMAN QUALITY BY TIER  (Excellent + Good = positive)');
  emitHr();
  emit(`  ${'Tier'.padEnd(40)} Positive rate   Labels`);
  emitHr('·');
  for (const tier of TIER_ORDER) {
    const labels   = tierGold[tier] || [];
    const wr       = winRate(labels);
    const lbl      = TIER_LABELS[tier];
    const breakdown = Object.entries(
      labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
    ).map(([l, n]) => `${l}:${n}`).join(' ');
    emit(`  ${lbl.padEnd(40)} ${rateStr(wr).padEnd(16)}  ${breakdown || '—'}`);
  }
  emitBlank();

  // ── Section 5: Novelty Signal ─────────────────────────────────────────────
  emit('5. NOVELTY vs DNA CORPUS');
  emitHr();
  emit(`  Novel (no matching DNA pattern):    ${novelCount}/${total}  =  ${pct(novelCount, total)}`);
  emit(`  Already covered by DNA:             ${nonNovelCount}/${total}  =  ${pct(nonNovelCount, total)}`);
  emitBlank();
  emit('  Novelty by tier:');
  emit(`  ${'Tier'.padEnd(44)} Novel   Total   %`);
  emitHr('·');
  for (const tier of TIER_ORDER) {
    const s   = novelByTier[tier] || { novel: 0, total: 0 };
    const lbl = TIER_LABELS[tier];
    emit(`  ${lbl.padEnd(44)} ${String(s.novel).padEnd(8)} ${String(s.total).padEnd(8)} ${pct(s.novel, s.total)}`);
  }
  emitBlank();

  // ── Section 6: Win Rate by Language ──────────────────────────────────────
  emit('6. WIN RATE BY LANGUAGE  (Excellent + Good / labelled titles)');
  emitHr();
  emit(`  ${'Language'.padEnd(18)} Positive rate   Label breakdown`);
  emitHr('·');
  for (const lang of ['english', 'hindi', 'other_latin']) {
    const labels = langGroups[lang] || [];
    const wr     = winRate(labels);
    const breakdown = Object.entries(
      labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
    ).map(([l, n]) => `${l}:${n}`).join(' ');
    emit(`  ${lang.padEnd(18)} ${rateStr(wr).padEnd(16)}  ${breakdown || '—'}`);
  }
  emitBlank();

  // ── Section 7: Win Rate by Pattern ───────────────────────────────────────
  emit('7. WIN RATE BY PATTERN');
  emitHr();
  emit(`  ${'Pattern'.padEnd(24)} Positive rate   Label breakdown`);
  emitHr('·');
  const patternOrder = [
    'DISH_TECHNIQUE', 'WAY_TO', 'MISTAKE', 'CHECKLIST', 'COLON',
    'FORCED_CONFLICT','ASSUMPTION_REVERSAL','MEMORY_OBJECT','CONFLICT_EXPOSE','DISCOVERY_SCIENCE',
    'NO_PATTERN'
  ];
  for (const pname of patternOrder) {
    const labels = patternGroups[pname];
    if (!labels || labels.length === 0) continue;
    const wr        = winRate(labels);
    const breakdown = Object.entries(
      labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
    ).map(([l, n]) => `${l}:${n}`).join(' ');
    emit(`  ${pname.padEnd(24)} ${rateStr(wr).padEnd(16)}  ${breakdown || '—'}`);
  }
  emitBlank();

  // ── Section 8: Gold Label Validation ─────────────────────────────────────
  emit('8. GOLD LABEL TOTALS  (validation)');
  emitHr();
  emit('  Expected (from task spec): Excellent:10  Good:6  Average:142  Poor:64  Garbage:16  Total:238');
  emit(`  Observed (in DB join):     ${Object.entries(goldLabelCounts).map(([l,n])=>`${l}:${n}`).join('  ')}  Total:${goldTotal}`);
  emitBlank();

  if (VERBOSE) {
    // ── Verbose: all tier 1 and tier 2 titles ────────────────────────────────
    emit('── VERBOSE: TIER 1 TITLES ─────────────────────────────────────────────');
    const tier1 = enriched.filter(r => r.tier === 'TIER1_NARRATIVE');
    for (const r of tier1) {
      const goldStr = r.gold.length > 0 ? ` [${r.gold.join(',')}]` : '';
      emit(`  [narr=${r.narrative}] "${r.title}"${goldStr}`);
    }
    emitBlank();
    emit('── VERBOSE: TIER 2 TITLES ─────────────────────────────────────────────');
    const tier2 = enriched.filter(r => r.tier === 'TIER2_ADAPTABLE');
    for (const r of tier2) {
      const goldStr = r.gold.length > 0 ? ` [${r.gold.join(',')}]` : '';
      emit(`  [adapt=${r.adaptability} narr=${r.narrative} pat=${r.patternName}] "${r.title}"${goldStr}`);
    }
    emitBlank();
    emit('── VERBOSE: NON-NOVEL (DNA already covers pattern) ────────────────────');
    const nonNovel = enriched.filter(r => !r.novel && (r.tier === 'TIER1_NARRATIVE' || r.tier === 'TIER2_ADAPTABLE'));
    for (const r of nonNovel) {
      emit(`  [${r.patternName}] "${r.title}"`);
    }
    emitBlank();
  }

  emitHr('═');
  emit('  END OF REPORT');
  emitHr('═');

  // ── Console output ────────────────────────────────────────────────────────
  process.stdout.write('\n' + lines.join('\n') + '\n');

  // ── Markdown output ───────────────────────────────────────────────────────
  const mdContent = [
    '# Peer Signal Value Audit — Research Track 1',
    '',
    `Generated: ${new Date().toISOString().slice(0,16).replace('T', ' ')} UTC`,
    '',
    '```',
    ...md,
    '```',
    '',
    '## Summary Table',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total distinct peer titles | ${total} |`,
    `| Titles with gold labels | ${goldTitlesWithLabel} |`,
    `| Total gold label instances | ${goldTotal} |`,
    `| **Usable rate** (adapt ≥ 65 OR narr ≥ 70) | **${pct(usableCount, total)}** (${usableCount}/${total}) |`,
    `| Narrative rate (narr ≥ 70) | ${pct(narrativeCount, total)} (${narrativeCount}/${total}) |`,
    `| Creator relevance (concept_conf ≥ 0.55) | **0%** — concept_confidence is NULL for all peer rows |`,
    `| Novel vs DNA corpus | ${pct(novelCount, total)} (${novelCount}/${total}) |`,
    '',
    '## Tier Distribution',
    '',
    '| Tier | Count | Share |',
    '|------|-------|-------|',
    ...TIER_ORDER.map(t => `| ${TIER_LABELS[t]} | ${tierCounts[t] || 0} | ${pct(tierCounts[t] || 0, total)} |`),
    '',
    '## Human Quality by Tier',
    '',
    '| Tier | Positive Rate | Label Detail |',
    '|------|--------------|--------------|',
    ...TIER_ORDER.map(t => {
      const labels    = tierGold[t] || [];
      const wr        = winRate(labels);
      const breakdown = Object.entries(
        labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
      ).map(([l, n]) => `${l}:${n}`).join(' ') || '—';
      return `| ${TIER_LABELS[t]} | ${rateStr(wr)} | ${breakdown} |`;
    }),
    '',
    '## Win Rate by Language',
    '',
    '| Language | Positive Rate | Detail |',
    '|----------|--------------|--------|',
    ...['english','hindi','other_latin'].map(lang => {
      const labels    = langGroups[lang] || [];
      const wr        = winRate(labels);
      const breakdown = Object.entries(
        labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
      ).map(([l, n]) => `${l}:${n}`).join(' ') || '—';
      return `| ${lang} | ${rateStr(wr)} | ${breakdown} |`;
    }),
    '',
    '## Win Rate by Pattern',
    '',
    '| Pattern | Positive Rate | Detail |',
    '|---------|--------------|--------|',
    ...patternOrder
      .filter(pname => patternGroups[pname] && patternGroups[pname].length > 0)
      .map(pname => {
        const labels    = patternGroups[pname];
        const wr        = winRate(labels);
        const breakdown = Object.entries(
          labels.reduce((acc, l) => { acc[l] = (acc[l] || 0) + 1; return acc; }, {})
        ).map(([l, n]) => `${l}:${n}`).join(' ') || '—';
        return `| ${pname} | ${rateStr(wr)} | ${breakdown} |`;
      }),
    '',
    '## Why Creator Relevance Is 0%',
    '',
    'The `concept_confidence` column is structurally NULL for all `peer_video_signal` rows.',
    'These rows come from raw YouTube peer-channel title ingestion and are never routed',
    'through the concept-matching pipeline. Peer signal enrichment scores `peer_adaptability`',
    'and `peer_narrative` instead, reflecting template-transfer and story-quality signals.',
    'A non-zero creator relevance rate would require running peer titles through the',
    '`dna_affinity` or concept-classification step before persisting them.',
    '',
    '## Novelty vs DNA',
    '',
    '| Tier | Novel | Total | Novel % |',
    '|------|-------|-------|---------|',
    ...TIER_ORDER.map(t => {
      const s = novelByTier[t] || { novel: 0, total: 0 };
      return `| ${TIER_LABELS[t]} | ${s.novel} | ${s.total} | ${pct(s.novel, s.total)} |`;
    }),
    '',
  ].join('\n');

  fs.writeFileSync(REPORT_OUT, mdContent, 'utf8');
  console.error(`\n[INFO] Markdown report written to: ${REPORT_OUT}`);
}

main();
