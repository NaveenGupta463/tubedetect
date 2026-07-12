'use strict';

/**
 * Peer Signal Quality Audit — Phase 1
 *
 * Classifies all 102 distinct peer_video_signal titles into failure modes
 * to explain why only 13/102 were usable in the hybrid generator.
 *
 * Categories:
 *   HINDI_SCRIPT      — Devanagari or other non-Latin-script characters (> 5% of chars)
 *   OTHER_LANGUAGE    — Latin-script but not English (Spanish, Telugu romanized, etc.)
 *   SPAM_EPISODE      — Numbered episode / serial TV show titles
 *   SPAM_PROMO        — Paid promo, brand placement, @mention self-promo
 *   SHORT_VAGUE       — < 4 meaningful words with no adaptable subject
 *   ENTERTAINMENT_VLOG— English but format/vlog noise (challenges, reactions, stunts)
 *   NARRATIVE         — Excellence pattern: Forced Conflict, Assumption Reversal, Memory Object, Conflict Expose
 *   ADAPTABLE         — Has a WAY_TO/CHECKLIST/MISTAKE/DISH/COLON pattern
 *   BORDERLINE        — English, no obvious noise, but no strong adaptable pattern
 *
 * Output: scripts/peer_signal_quality_report.md
 * Usage:  node peerSignalQualityAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH   = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT= path.resolve(__dirname, 'peer_signal_quality_report.md');
const VERBOSE   = process.argv.includes('--verbose');

// ── Language detectors ─────────────────────────────────────────────────────────
// Non-Latin ratio > 5% → Hindi/regional script
function hasNonLatinScript(t) {
  const nonLatin = (t.match(/[ऀ-ॿ਀-੿଀-୿ఀ-౿ഀ-ൿ฀-๿]/g) || []).length;
  return nonLatin / Math.max(t.length, 1) > 0.05;
}

// Known Hindi/Hinglish words that appear in otherwise Latin-script titles
const HINDI_WORD_RE = /\b(ki|ka|ko|ne|meri|mera|hua|hoga|hai|ho|se|pe|par|bhi|aaj|kal|yeh|woh|kya|kisi|kisi|karo|kiya|gaya|gyi|tha|thi|the|ab|apna|apni|unka|uska|nahi|nhi|nai|bhai|yaar|dost|beta|beti|aur|lekin|phir|toh|matlab|matlab|lagri|bhari|chori|khana|ghar|parivar|khilaya|Khajur|sabziyon|Karela|Anaya|Rishabh|Mansi|Binesar|Uday)\b/i;

function isHindiScript(t) {
  if (hasNonLatinScript(t)) return true;
  // Mixed Hindi-English: many Hindi words in otherwise-Latin title
  const words = t.trim().split(/\s+/);
  const hindiWords = words.filter(w => HINDI_WORD_RE.test(w)).length;
  return hindiWords >= 2 && hindiWords / words.length >= 0.3;
}

// Spanish/other-language Latin detection
const SPANISH_WORD_RE = /\b(hablé|con|mini|exe|los|backrooms|este|esta|una|para)\b/i;
const SOUTH_INDIAN_ROMANIZED_RE = /\b(panna|vidunga|da|peru|cheppandi|chudham|manigali|muni|soumya|dillagi)\b/i;
const ODIA_ROMANIZED_RE = /\bku\b.*\bmu\b/i;

function isOtherLanguage(t) {
  if (SPANISH_WORD_RE.test(t)) return true;
  if (SOUTH_INDIAN_ROMANIZED_RE.test(t)) return true;
  if (ODIA_ROMANIZED_RE.test(t)) return true;
  return false;
}

// ── Spam detectors ─────────────────────────────────────────────────────────────
const EPISODE_RE = /\b(episode|ep\.?|part|season|s\d{1,2}e\d{1,2}|ep\s*\d+|#\d+|\bep\b\s*\d|\d+\s*by\s+\w+\s+(tv|ltd|fun))\b/i;
const SHOW_NAME_RE = /\b(taarak mehta|taarak|chashmah|comedy video \d{4}|fun tv|busy fun|fun ltd)\b/i;
const SERIAL_TITLE_RE = /\b(ladies special|anniyan|raakh|shaidai)\b/i;

function isSpamEpisode(t) {
  if (EPISODE_RE.test(t)) return true;
  if (SHOW_NAME_RE.test(t)) return true;
  if (SERIAL_TITLE_RE.test(t)) return true;
  return false;
}

const PROMO_RE = /@\w+|presented by|ujooba|happilac|berg snow|buy now|vivo x300|#ad\b/i;
const CRYPTO_SHOW_RE = /\bthe trade room\b/i;
const SELF_PROMO_RE = /have you watched this\b|subscribe|follow me|link in bio/i;

function isSpamPromo(t) {
  if (PROMO_RE.test(t)) return true;
  if (CRYPTO_SHOW_RE.test(t)) return true;
  if (SELF_PROMO_RE.test(t)) return true;
  return false;
}

// Short + vague: < 4 non-trivial words AND no named subject
const TRIVIAL_WORDS = new Set(['a','an','the','is','in','on','at','of','it','my','me','i','we','he','she','his','her','our','vs','and','or','but']);
function countMeaningfulWords(t) {
  return t.trim().split(/\s+/).filter(w => w.length > 1 && !TRIVIAL_WORDS.has(w.toLowerCase().replace(/[^a-z]/g,''))).length;
}

function isShortVague(t) {
  if (countMeaningfulWords(t) < 4) return true;
  // Very short sentence with no domain context (e.g. "Green Flag", "new song", "TOWEL BALL")
  const wc = t.trim().split(/\s+/).length;
  if (wc <= 3 && !/\b(how|why|what|when|the way|mistake|checklist|recipe|guide)\b/i.test(t)) return true;
  return false;
}

// ── Pattern detectors ─────────────────────────────────────────────────────────
// Narrative excellence patterns (from narrativeTemplateAudit.js)
const NARRATIVE_PATTERNS = {
  FORCED_CONFLICT:     t => /\bforced (to|into)\b/i.test(t) || /\b(tiger|animal|beast)\b.*\b(hunt|kill|attack)\b/i.test(t),
  ASSUMPTION_REVERSAL: t => /\b(we thought|scientists (thought|believed)|it turns out|turns out|might (actually|end))\b/i.test(t) || /\b(frozen big bang|singularit)\b/i.test(t),
  MEMORY_OBJECT:       t => /\b(years? of (memories|life)|a (santro|family|car) and \d+)/i.test(t) || (/\b\d{2,} years\b/i.test(t) && /\b(memories|journey|story)\b/i.test(t)),
  CONFLICT_EXPOSE:     t => /\bcan['']?t (negotiate|deal|fight|hide|stop)\b/i.test(t) || /\bprove(s|d)? (it|him|them)\b/i.test(t) || /\b(expose[sd]?|proves?)\b.*\b(lie|hypocrisy|truth)\b/i.test(t),
  DISCOVERY_SCIENCE:   t => /\b(black holes?|quantum|singularit|chernobyl|mariana trench|tornado|why so many)\b/i.test(t),
};

function classifyNarrative(t) {
  for (const [name, fn] of Object.entries(NARRATIVE_PATTERNS)) {
    if (fn(t)) return name;
  }
  return null;
}

// Adaptable patterns (from hybridRecommendationGenerator.js)
const ADAPTABLE_PATTERNS = {
  WAY_TO:           t => /^(how |what nobody|the best way)/i.test(t) || /\b(how to|way to|the best way)\b/i.test(t),
  CHECKLIST_FORMAT: t => /\b(checklist|guide|tips?|routine|plan|framework)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t),
  MISTAKE_BEHIND:   t => /\b(mistake|trap|pitfall|wrong|hidden cost|beginner mistake|common mistake|get wrong)\b/i.test(t),
  DISH_TECHNIQUE:   t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|cake|bread|coffee|asmr cooking)\b/i.test(t) || /\bcan you make.*at home\b/i.test(t),
  COLON_EXPLAINER:  t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why|the trap|the beginner|can you make)\b/i.test(t),
};

function classifyAdaptable(t) {
  for (const [name, fn] of Object.entries(ADAPTABLE_PATTERNS)) {
    if (fn(t)) return name;
  }
  return null;
}

// ── Entertainment / vlog noise detector (English but not adaptable) ──────────
const ENTERTAINMENT_RE = /\b(challenge|stunt|prank|reaction|unboxing|haul|vlog|try|vs|battle|tasting|eating|testing|we made|i made|i bought|i turned|confronting|haunted|ghost|axe murderer|wedding|party|birthday|baby shower|anniversary|shopping|review|tour|trip|travel|hotel|resort)\b/i;
const SPORTS_NOISE_RE = /\b(ipl final|football|cricket|match|goal|score)\b/i;

function isEntertainmentVlog(t) {
  if (ENTERTAINMENT_RE.test(t)) return true;
  if (SPORTS_NOISE_RE.test(t)) return true;
  return false;
}

// ── Master classifier ─────────────────────────────────────────────────────────
function classifyTitle(title) {
  const t = String(title || '');

  // Priority order matters here
  if (isHindiScript(t))                  return { category: 'HINDI_SCRIPT',       pattern: null };
  if (isOtherLanguage(t))                return { category: 'OTHER_LANGUAGE',      pattern: null };
  if (isSpamEpisode(t))                  return { category: 'SPAM_EPISODE',        pattern: null };
  if (isSpamPromo(t))                    return { category: 'SPAM_PROMO',          pattern: null };
  if (isShortVague(t))                   return { category: 'SHORT_VAGUE',         pattern: null };

  const narrativePattern = classifyNarrative(t);
  if (narrativePattern)                  return { category: 'NARRATIVE',           pattern: narrativePattern };

  const adaptablePattern = classifyAdaptable(t);
  if (adaptablePattern)                  return { category: 'ADAPTABLE',           pattern: adaptablePattern };

  if (isEntertainmentVlog(t))            return { category: 'ENTERTAINMENT_VLOG',  pattern: null };

  return { category: 'BORDERLINE', pattern: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // Load all distinct peer titles
  const allTitles = db.prepare(`
    SELECT generated_title, COUNT(*) as shown_to_channels
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal' AND generated_title IS NOT NULL AND generated_title != ''
    GROUP BY generated_title
    ORDER BY shown_to_channels DESC
  `).all();

  // Load gold labels
  const goldByTitle = new Map();
  const goldRows = db.prepare(`
    SELECT generated_title, human_label
    FROM wtp_human_quality_reviews
    WHERE rec_source = 'peer_video_signal' AND human_label IS NOT NULL
    GROUP BY generated_title
    HAVING COUNT(*) > 0
  `).all();
  for (const r of goldRows) goldByTitle.set(r.generated_title, r.human_label);

  // Also check gold in the main review table (all recs)
  const goldRows2 = db.prepare(`
    SELECT generated_title, human_label
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL
  `).all();
  for (const r of goldRows2) {
    if (!goldByTitle.has(r.generated_title)) goldByTitle.set(r.generated_title, r.human_label);
  }

  db.close();

  // ── Classify all titles ───────────────────────────────────────────────────
  const classified = allTitles.map(r => {
    const { category, pattern } = classifyTitle(r.generated_title);
    const gold = goldByTitle.get(r.generated_title) || null;
    return { title: r.generated_title, shown: r.shown_to_channels, category, pattern, gold };
  });

  // ── Aggregate by category ─────────────────────────────────────────────────
  const cats = {};
  for (const row of classified) {
    if (!cats[row.category]) cats[row.category] = { titles: [], goldCounts: {} };
    cats[row.category].titles.push(row);
    if (row.gold) cats[row.category].goldCounts[row.gold] = (cats[row.category].goldCounts[row.gold] || 0) + 1;
  }

  const CATEGORY_LABELS = {
    HINDI_SCRIPT:        'Hindi / non-Latin script',
    OTHER_LANGUAGE:      'Other language (romanized)',
    SPAM_EPISODE:        'Spam: episode / serial show',
    SPAM_PROMO:          'Spam: brand promo / @mention',
    SHORT_VAGUE:         'Too short / vague (< 4 words)',
    NARRATIVE:           'Narrative (Excellent pattern)',
    ADAPTABLE:           'Adaptable to creator context',
    ENTERTAINMENT_VLOG:  'Entertainment / vlog / challenge',
    BORDERLINE:          'English — no strong pattern',
  };

  // ── Summary stats ─────────────────────────────────────────────────────────
  const total = classified.length;
  const usable = (cats['NARRATIVE']?.titles.length || 0) + (cats['ADAPTABLE']?.titles.length || 0);
  const noise  = total - usable;

  // ── Console output ────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Peer Signal Quality Audit\n');
  process.stdout.write(`  ${total} distinct peer titles | ${usable} usable (${Math.round(usable/total*100)}%) | ${noise} noise (${Math.round(noise/total*100)}%)\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  process.stdout.write('  Category                         Count   %      Gold labels\n');
  process.stdout.write('  ' + '─'.repeat(68) + '\n');

  const ORDER = ['ADAPTABLE','NARRATIVE','BORDERLINE','ENTERTAINMENT_VLOG','SHORT_VAGUE','SPAM_EPISODE','SPAM_PROMO','HINDI_SCRIPT','OTHER_LANGUAGE'];
  for (const cat of ORDER) {
    const c = cats[cat];
    if (!c) continue;
    const n = c.titles.length;
    const pct = Math.round(n/total*100);
    const goldStr = Object.entries(c.goldCounts).map(([l,v])=>`${l}:${v}`).join(', ') || '—';
    process.stdout.write(`  ${(CATEGORY_LABELS[cat] || cat).padEnd(33)} ${String(n).padEnd(8)} ${String(pct+'%').padEnd(7)}${goldStr}\n`);
  }

  process.stdout.write('\n── Adaptable pattern breakdown ───────────────────────────────\n');
  const adaptPatterns = {};
  for (const r of classified.filter(r => r.category === 'ADAPTABLE')) {
    adaptPatterns[r.pattern] = (adaptPatterns[r.pattern] || 0) + 1;
  }
  for (const [p, n] of Object.entries(adaptPatterns).sort((a,b)=>b[1]-a[1])) {
    process.stdout.write(`  ${p.padEnd(22)} ${n}\n`);
  }

  process.stdout.write('\n── Narrative pattern breakdown ───────────────────────────────\n');
  const narrativePatterns = {};
  for (const r of classified.filter(r => r.category === 'NARRATIVE')) {
    narrativePatterns[r.pattern] = (narrativePatterns[r.pattern] || 0) + 1;
  }
  for (const [p, n] of Object.entries(narrativePatterns).sort((a,b)=>b[1]-a[1])) {
    process.stdout.write(`  ${p.padEnd(22)} ${n}\n`);
  }

  if (VERBOSE) {
    for (const cat of ORDER) {
      const c = cats[cat];
      if (!c || !c.titles.length) continue;
      process.stdout.write(`\n── ${CATEGORY_LABELS[cat]} (${c.titles.length}) ─────────────────────────────\n`);
      for (const r of c.titles) {
        const goldTag = r.gold ? ` [${r.gold}]` : '';
        process.stdout.write(`  "${r.title}"${goldTag}\n`);
      }
    }
  }

  // ── Failure analysis ──────────────────────────────────────────────────────
  process.stdout.write('\n── Why only 13/102 were usable ───────────────────────────────\n');
  const failureBreakdown = [
    { label: 'Hindi / non-Latin script',    count: cats['HINDI_SCRIPT']?.titles.length || 0,       root: 'buildPeerVideoSignalIdeas() only blocks Marathi/Telugu/Tamil/Kannada/Malayalam/Bengali — Hindi passes through' },
    { label: 'Other language (romanized)',   count: cats['OTHER_LANGUAGE']?.titles.length || 0,     root: 'No romanized-language detector in ingestion filter' },
    { label: 'Spam: episode / serial',       count: cats['SPAM_EPISODE']?.titles.length || 0,       root: 'No episode-number or show-name filter in cleanPeerSignalTitle()' },
    { label: 'Spam: promo / @mention',       count: cats['SPAM_PROMO']?.titles.length || 0,         root: 'No promotional content filter in ingestion' },
    { label: 'Too short / vague',            count: cats['SHORT_VAGUE']?.titles.length || 0,        root: 'No minimum meaningful word count gate' },
    { label: 'Entertainment / vlog noise',   count: cats['ENTERTAINMENT_VLOG']?.titles.length || 0, root: 'Entertainment format titles pass all current filters' },
    { label: 'English — no strong pattern',  count: cats['BORDERLINE']?.titles.length || 0,         root: 'English and clean but no pattern match — borderline quality' },
  ];
  for (const f of failureBreakdown) {
    if (!f.count) continue;
    process.stdout.write(`  ${String(f.count).padEnd(4)} ${f.label}\n`);
    process.stdout.write(`       → ${f.root}\n`);
  }

  process.stdout.write('\n── Recommended filters (priority order) ─────────────────────\n');
  process.stdout.write('  1. Add Hindi language block to buildPeerVideoSignalIdeas():\n');
  process.stdout.write('     /\\b(ka|ki|ko|ne|hai|tha|thi|gaya|nahi|nhi|bhai|yaar|ghar|khana)\\b/i\n');
  process.stdout.write('  2. Add romanized South Indian language block\n');
  process.stdout.write('  3. Add episode/serial filter: /\\b(episode|ep\\b|part \\d+|by \\w+ tv|by \\w+ ltd)\\b/i\n');
  process.stdout.write('  4. Add promo filter: /@\\w+|presented by|buy now|#ad\\b/i\n');
  process.stdout.write('  5. Require ≥ 4 meaningful words in cleanPeerSignalTitle()\n');
  process.stdout.write('  6. Require English title: non-Latin ratio < 5% (already done in hybridRecommendationGenerator)\n');

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write(`  Projected usable pool after fixes: ~${usable + (cats['BORDERLINE']?.titles.length||0) + Math.round((cats['ENTERTAINMENT_VLOG']?.titles.length||0)*0.4)} / ${total} (${Math.round(((usable + (cats['BORDERLINE']?.titles.length||0) + Math.round((cats['ENTERTAINMENT_VLOG']?.titles.length||0)*0.4))/total)*100)}%)\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // ── Write markdown report ─────────────────────────────────────────────────
  const lines = [
    '# Peer Signal Quality Audit',
    '',
    `**Date:** ${new Date().toISOString().slice(0,10)}  `,
    `**Total distinct peer titles:** ${total}  `,
    `**Usable (ADAPTABLE + NARRATIVE):** ${usable} (${Math.round(usable/total*100)}%)  `,
    `**Noise / unusable:** ${noise} (${Math.round(noise/total*100)}%)  `,
    '',
    '## Category Breakdown',
    '',
    '| Category | Count | % | Gold labels |',
    '|---|---|---|---|',
  ];

  for (const cat of ORDER) {
    const c = cats[cat];
    if (!c) continue;
    const n = c.titles.length;
    const pct = Math.round(n/total*100);
    const goldStr = Object.entries(c.goldCounts).map(([l,v])=>`${l}:${v}`).join(', ') || '—';
    lines.push(`| ${CATEGORY_LABELS[cat]} | ${n} | ${pct}% | ${goldStr} |`);
  }

  lines.push('', '## Why only 13/102 were usable', '');
  for (const f of failureBreakdown) {
    if (!f.count) continue;
    lines.push(`**${f.count} — ${f.label}**  `);
    lines.push(`Root cause: ${f.root}  `);
    lines.push('');
  }

  lines.push('## Recommended Ingestion Filters (priority order)', '');
  lines.push('1. **Hindi language block** in `buildPeerVideoSignalIdeas()`: add Hindi stop-words to the language filter alongside the existing regional language list.');
  lines.push('2. **Romanized South Indian language block**: detect Tamil/Telugu romanized patterns.');
  lines.push('3. **Episode / serial filter**: reject titles with `/\\b(episode|ep\\b|part \\d+|by \\w+ tv)\\b/i`.');
  lines.push('4. **Promotional content filter**: reject titles with `/@\\w+|presented by|buy now/i`.');
  lines.push('5. **Minimum word count gate**: require ≥ 4 meaningful words in `cleanPeerSignalTitle()`.');
  lines.push('6. **English-only gate**: non-Latin character ratio < 5% (already enforced in hybridRecommendationGenerator).');
  lines.push('');
  lines.push('## Impact Projection', '');
  lines.push('After applying all 6 filters:');
  lines.push(`- Noise removed: ~${noise - (cats['BORDERLINE']?.titles.length||0) - Math.round((cats['ENTERTAINMENT_VLOG']?.titles.length||0)*0.4)} titles`);
  lines.push(`- Estimated usable pool: ~${usable + (cats['BORDERLINE']?.titles.length||0) + Math.round((cats['ENTERTAINMENT_VLOG']?.titles.length||0)*0.4)} / ${total} (${Math.round(((usable + (cats['BORDERLINE']?.titles.length||0) + Math.round((cats['ENTERTAINMENT_VLOG']?.titles.length||0)*0.4))/total)*100)}%)`);
  lines.push('- CHECKLIST_FORMAT gap: currently 0 active peer examples — Hindi/noise block will not fix this. Need English creators with checklist-style content in the peer pool.');
  lines.push('');
  lines.push('## Titles by Category', '');

  for (const cat of ORDER) {
    const c = cats[cat];
    if (!c || !c.titles.length) continue;
    lines.push(`### ${CATEGORY_LABELS[cat]} (n=${c.titles.length})`, '');
    for (const r of c.titles.sort((a,b)=>b.shown-a.shown)) {
      const goldTag = r.gold ? ` — **${r.gold}**` : '';
      lines.push(`- "${r.title}"${goldTag}`);
    }
    lines.push('');
  }

  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  process.stdout.write(`  Written: ${REPORT_OUT}\n\n`);
}

main();
