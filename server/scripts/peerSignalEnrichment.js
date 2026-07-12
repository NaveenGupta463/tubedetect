'use strict';

/**
 * Peer Signal Enrichment — Phase 2
 *
 * Adds quality metadata columns to wtp_generation_traces for peer_video_signal rows:
 *   peer_language TEXT        — 'english', 'hindi', 'other_non_latin', 'other_latin', 'unknown'
 *   peer_adaptability INTEGER — 0-100: does title have an adaptable WAY_TO/MISTAKE/DISH/COLON/CHECKLIST pattern?
 *   peer_narrative INTEGER    — 0-100: does title match a narrative excellence pattern?
 *
 * Also backfills existing peer_video_signal traces.
 * Future traces should compute these values at write time (see Phase 2 notes).
 *
 * Usage: node peerSignalEnrichment.js [--dry-run] [--verbose]
 */

const path = require('path');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE  = process.argv.includes('--verbose');

// ── Language classifier ───────────────────────────────────────────────────────
// Returns 'hindi', 'other_non_latin', 'other_latin', 'english', 'unknown'
function classifyLanguage(title) {
  const t = String(title || '').trim();
  if (!t) return 'unknown';

  // Non-Latin scripts (Devanagari, Telugu, Tamil, Bengali, Malayalam, Kannada, etc.)
  const devanagari   = (t.match(/[ऀ-ॿ]/g) || []).length;
  const otherScript  = (t.match(/[਀-੿଀-୿ఀ-౿ഀ-ൿ฀-๿가-힣ぁ-ん一-鿿]/g) || []).length;
  const totalNonLatin = devanagari + otherScript;
  if (totalNonLatin / Math.max(t.length, 1) > 0.03) {
    return devanagari > 0 ? 'hindi' : 'other_non_latin';
  }

  // Spanish / other Latin-script non-English
  if (/\b(hablé|con\s+mini|los\s+backrooms|este|esta|para\s+mi|gracias|buenas)\b/i.test(t)) return 'other_latin';

  // Romanized South Indian languages (Tamil/Telugu/Odia romanized patterns)
  if (/\b(panna\s+vidunga|peru\s+cheppandi|chudham|manigali\s+muni|dini\s+peru|ku\s+mu\s+manigali)\b/i.test(t)) return 'other_latin';

  // Hindi stop-words in otherwise Latin-script text (Hinglish)
  const HINDI_WORDS = ['ka', 'ki', 'ko', 'ne', 'se', 'pe', 'par', 'hai', 'tha', 'thi', 'the', 'gaya', 'gyi', 'nahi', 'nhi', 'bhai', 'yaar', 'ghar', 'khana', 'lagri', 'bhari', 'chori', 'khilaya'];
  const words = t.toLowerCase().split(/\s+/);
  const hindiHits = words.filter(w => HINDI_WORDS.includes(w.replace(/[^a-z]/g, ''))).length;
  if (hindiHits >= 2 && hindiHits / words.length >= 0.25) return 'hindi';

  return 'english';
}

// ── Adaptability scorer (0-100) ───────────────────────────────────────────────
// 100 = strong adaptable pattern, 0 = no pattern detected
const ADAPT_DETECTORS = {
  WAY_TO:           { score: 90, test: t => /^(how |what nobody|the best way)/i.test(t) || /\b(how to|way to|the best way)\b/i.test(t) },
  CHECKLIST_FORMAT: { score: 90, test: t => /\b(checklist|guide|tips?|routine|plan)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t) },
  MISTAKE_BEHIND:   { score: 85, test: t => /\b(mistake|trap|pitfall|wrong|hidden cost|beginner mistake|common mistake|get wrong)\b/i.test(t) },
  DISH_TECHNIQUE:   { score: 80, test: t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|cake|bread|coffee|asmr cooking)\b/i.test(t) || /\bcan you make.*at home\b/i.test(t) },
  COLON_EXPLAINER:  { score: 70, test: t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why)\b/i.test(t) },
  WHY_PATTERN:      { score: 65, test: t => /^why\s+.{10,}/i.test(t) && !/\blive\b/i.test(t) },
};

function computeAdaptabilityScore(title) {
  const t = String(title || '');
  for (const { score, test } of Object.values(ADAPT_DETECTORS)) {
    if (test(t)) return score;
  }
  return 0;
}

// ── Narrative scorer (0-100) ──────────────────────────────────────────────────
// 100 = strong narrative excellence pattern
const NARRATIVE_DETECTORS = {
  FORCED_CONFLICT:     { score: 100, test: t => /\bforced (to|into)\b/i.test(t) || /\b(animal|beast|tiger|creature)\b.*\b(hunt|attack|kill)\b/i.test(t) },
  ASSUMPTION_REVERSAL: { score: 100, test: t => /\b(we thought|scientists (thought|believed)|it turns out|might (actually|end))\b/i.test(t) || /\b(frozen big bang|singularit)\b/i.test(t) },
  MEMORY_OBJECT:       { score: 100, test: t => /\b\d{2,} years?\b.*\b(memories|journey|story|life)\b/i.test(t) || /\b(a (santro|family|car) and \d+)\b/i.test(t) },
  CONFLICT_EXPOSE:     { score: 100, test: t => /\bcan['']?t (negotiate|deal|fight|hide)\b/i.test(t) || /\b(prove[sd]?|expose[sd]?)\b.*\b(lie|truth|hypocrisy)\b/i.test(t) },
  DISCOVERY_SCIENCE:   { score: 80,  test: t => /\b(black holes?|quantum|singularit|chernobyl|mariana trench|tornado|why so many)\b/i.test(t) },
  REVEAL_MECHANISM:    { score: 70,  test: t => /\b(how.*actually works?|the real (reason|cause|story)|what really happened)\b/i.test(t) },
};

function computeNarrativeScore(title) {
  const t = String(title || '');
  let best = 0;
  for (const { score, test } of Object.values(NARRATIVE_DETECTORS)) {
    if (test(t) && score > best) best = score;
  }
  return best;
}

// ── Noise detectors ───────────────────────────────────────────────────────────
// Used for console reporting only — not stored separately
function detectNoiseType(title) {
  const t = String(title || '');
  const lang = classifyLanguage(t);
  if (lang === 'hindi') return 'HINDI';
  if (lang === 'other_non_latin') return 'NON_LATIN';
  if (lang === 'other_latin') return 'OTHER_LATIN';
  if (/\b(episode|ep\.?\s*\d+|part\s*\d+|by\s+\w+\s+(tv|ltd|fun))\b/i.test(t)) return 'SPAM_EPISODE';
  if (/@\w+|presented by|buy now|#ad\b/i.test(t)) return 'SPAM_PROMO';
  const meaningfulWords = t.split(/\s+/).filter(w => w.length > 1).length;
  if (meaningfulWords < 4) return 'TOO_SHORT';
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: false, timeout: 60000 });

  // Step 1: Add columns (idempotent)
  const existingCols = db.prepare('PRAGMA table_info(wtp_generation_traces)').all().map(c => c.name);
  const toAdd = [
    ['peer_language', 'TEXT'],
    ['peer_adaptability', 'INTEGER'],
    ['peer_narrative', 'INTEGER'],
  ];
  for (const [col, type] of toAdd) {
    if (!existingCols.includes(col)) {
      if (!DRY_RUN) db.exec(`ALTER TABLE wtp_generation_traces ADD COLUMN ${col} ${type}`);
      process.stdout.write(`  + Added column: ${col} ${type}\n`);
    } else {
      process.stdout.write(`  ✓ Column exists: ${col}\n`);
    }
  }

  // Step 2: Load all peer traces
  const peerTraces = db.prepare(`
    SELECT id, generated_title, peer_language, peer_adaptability, peer_narrative
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal' AND generated_title IS NOT NULL
  `).all();

  process.stdout.write(`\n  Peer traces to enrich: ${peerTraces.length}\n\n`);

  // Step 3: Compute and update
  const updateStmt = DRY_RUN ? null : db.prepare(
    'UPDATE wtp_generation_traces SET peer_language=?, peer_adaptability=?, peer_narrative=? WHERE id=?'
  );

  const summary = { total: 0, updated: 0, skipped: 0, byLang: {}, adaptable: 0, narrative: 0, noise: 0 };
  const noiseBreakdown = {};

  const doUpdate = DRY_RUN ? null : db.transaction(rows => {
    for (const row of rows) updateStmt.run(row.lang, row.adapt, row.narr, row.id);
  });

  const batch = [];
  for (const row of peerTraces) {
    summary.total++;
    const lang   = classifyLanguage(row.generated_title);
    const adapt  = computeAdaptabilityScore(row.generated_title);
    const narr   = computeNarrativeScore(row.generated_title);
    const noise  = detectNoiseType(row.generated_title);

    summary.byLang[lang] = (summary.byLang[lang] || 0) + 1;
    if (adapt > 0) summary.adaptable++;
    if (narr > 0)  summary.narrative++;
    if (noise)   { summary.noise++; noiseBreakdown[noise] = (noiseBreakdown[noise] || 0) + 1; }

    // Skip if already identical
    if (row.peer_language === lang && row.peer_adaptability === adapt && row.peer_narrative === narr) {
      summary.skipped++;
      continue;
    }

    batch.push({ id: row.id, lang, adapt, narr });
    summary.updated++;

    if (VERBOSE) {
      process.stdout.write(`  [${lang.padEnd(12)}] adapt=${adapt}  narr=${narr}  "${row.generated_title.slice(0,60)}"\n`);
    }
  }

  if (!DRY_RUN && batch.length) doUpdate(batch);

  // ── Report ─────────────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Peer Signal Enrichment\n');
  process.stdout.write(`  ${summary.total} peer traces | ${summary.updated} updated | ${summary.skipped} unchanged\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  process.stdout.write('── Language distribution ─────────────────────────────────────\n');
  for (const [lang, n] of Object.entries(summary.byLang).sort((a,b)=>b[1]-a[1])) {
    const pct = Math.round(n/summary.total*100);
    process.stdout.write(`  ${lang.padEnd(18)} ${String(n).padEnd(5)} (${pct}%)\n`);
  }

  process.stdout.write('\n── Quality signals ───────────────────────────────────────────\n');
  process.stdout.write(`  Adaptable titles:   ${summary.adaptable} / ${summary.total} (${Math.round(summary.adaptable/summary.total*100)}%)\n`);
  process.stdout.write(`  Narrative titles:   ${summary.narrative} / ${summary.total} (${Math.round(summary.narrative/summary.total*100)}%)\n`);
  process.stdout.write(`  Noise titles:       ${summary.noise} / ${summary.total} (${Math.round(summary.noise/summary.total*100)}%)\n`);

  if (Object.keys(noiseBreakdown).length) {
    process.stdout.write('\n── Noise breakdown ───────────────────────────────────────────\n');
    for (const [type, n] of Object.entries(noiseBreakdown).sort((a,b)=>b[1]-a[1])) {
      process.stdout.write(`  ${type.padEnd(18)} ${n}\n`);
    }
  }

  process.stdout.write('\n── English peer titles by quality tier ───────────────────────\n');
  const englishTraces = peerTraces.filter(r => classifyLanguage(r.generated_title) === 'english');
  const tier1 = englishTraces.filter(r => computeNarrativeScore(r.generated_title) >= 80);
  const tier2 = englishTraces.filter(r => computeAdaptabilityScore(r.generated_title) >= 65 && computeNarrativeScore(r.generated_title) < 80);
  const tier3 = englishTraces.filter(r => computeAdaptabilityScore(r.generated_title) === 0 && computeNarrativeScore(r.generated_title) === 0);
  process.stdout.write(`  Tier 1 (Narrative ≥80):   ${tier1.length} — Excellent pattern potential\n`);
  process.stdout.write(`  Tier 2 (Adaptable ≥65):   ${tier2.length} — Good generation input\n`);
  process.stdout.write(`  Tier 3 (No pattern):       ${tier3.length} — Borderline / low value\n`);

  if (DRY_RUN) process.stdout.write('\n  [DRY RUN — no changes written]\n');
  process.stdout.write('\n');

  db.close();
}

main();
