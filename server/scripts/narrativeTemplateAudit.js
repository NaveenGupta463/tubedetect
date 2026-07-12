'use strict';

/**
 * Narrative Template Audit — Phase 4
 *
 * Analyzes all Excellent-labeled rows in the gold set to identify recurring
 * narrative structures. Narrative peer signals produce ALL Excellent recommendations
 * but cannot be reliably generated from DNA alone.
 *
 * Outputs:
 *   scripts/narrative_template_library.json   — machine-readable template library
 *   Console report with narrative structure analysis
 *
 * Usage: node narrativeTemplateAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const VERBOSE = process.argv.includes('--verbose');
const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const JSON_OUT = path.resolve(__dirname, 'narrative_template_library.json');

// ── Narrative structure detectors ─────────────────────────────────────────────
// Each entry defines a narrative pattern found in Excellent titles.

const NARRATIVE_STRUCTURES = [
  {
    id: 'assumption_reversal',
    name: 'Assumption Reversal',
    description: 'Presents a widely-held belief and then subverts it with surprising evidence.',
    hook_trigger: 'We Thought / Everyone Thinks / You Think',
    test: t => /\b(we thought|you think|people think|everyone thinks?|everyone thought)\b/i.test(t) ||
               /\b(thought|expected|believed)\b.*\b(but|actually|might|could|turns out)\b/i.test(t),
    skeleton: 'We Thought [ACCEPTED_BELIEF]. They Might [SURPRISING_TRUTH]',
    generation_requires: 'peer signal + domain misconception',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'forced_conflict',
    name: 'Forced Conflict',
    description: 'A named entity is compelled to take an action against its natural state. Creates tension and sympathy.',
    hook_trigger: 'Forced to / Made to / Had to',
    test: t => /\b(forced to|made to|compelled to|had to hunt|had to (kill|fight|flee|survive))\b/i.test(t),
    skeleton: 'The [SPECIFIC_SUBJECT] That Was Forced to [UNNATURAL_ACTION] [OBJECT]',
    generation_requires: 'peer signal + named subject + documented incident',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'conflict_expose',
    name: 'Conflict Expose',
    description: "Named actor shown failing at their core function, with specific evidence named.",
    hook_trigger: "Can't / Won't / Couldn't + specific proof",
    test: t => /\bcan[’']?t\b.*\b(negotiate|prove|shows?|handle|fix|manage|solve)\b/i.test(t) ||
               /\bwon[’']?t\b.*\b(work|last|survive|hold)\b/i.test(t) ||
               /\b(fail|fails|failed)\b.*\b(and|the)\b.*\b(prove|shows?|shows us)\b/i.test(t),
    skeleton: '[NAMED_ACTOR] Can\'t [CORE_FUNCTION], and the [SPECIFIC_EVIDENCE] Prove[s] It',
    generation_requires: 'peer signal + named actor + verifiable evidence',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'memory_object',
    name: 'Memory Object',
    description: 'Ties a named physical object to a relationship and a time span. Creates immediate emotional resonance.',
    hook_trigger: 'A [object], A [relationship], and N years',
    test: t => /\ba [^,]+,\s*a [^,]+\s*and\s+\d+\s*years?\b/i.test(t),
    skeleton: 'A [NAMED_OBJECT], A [RELATIONSHIP] and [N] Years of [EMOTION]',
    generation_requires: 'peer signal + named object + relationship + time span',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'verdict_claim',
    name: 'Verdict Claim',
    description: 'States a sharp, opinionated verdict about a named subject. Polarizing but credibility-signalling.',
    hook_trigger: "Strong claim about named subject's character or capability",
    test: t => /\b[A-Z][a-zA-Z]+\s+(can'?t|won'?t|isn'?t|doesn'?t|never|always|refuses? to)\b/.test(t) ||
               /\b(terrible|brilliant|broken|corrupt|failing|winning|proof|verdict)\b.*\b(negotiate|explain|fix|lead|work|prove)\b/i.test(t),
    skeleton: '[NAMED_SUBJECT] [STRONG_VERDICT], and the [EVIDENCE] [PROVES_IT]',
    generation_requires: 'peer signal + named subject + strong verdict + named evidence',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'discovery_reveal',
    name: 'Discovery Reveal',
    description: 'An unexpected discovery about a familiar topic, where the discovery is named specifically.',
    hook_trigger: 'They Might / It Could / New evidence shows',
    test: t => /\b(they might|it could|might end in|might (be|have|explain|reveal)|new evidence|scientists? found|researchers? discovered)\b/i.test(t),
    skeleton: 'We Thought [X]. They Might [SURPRISING_ALTERNATIVE]',
    generation_requires: 'peer signal + established belief + named alternative',
    can_generate_from_dna: false,
    examples_from_gold: [],
  },
  {
    id: 'hidden_mechanism',
    name: 'Hidden Mechanism',
    description: 'Reveals the actual cause or mechanism behind a familiar phenomenon. "What really happened" structure.',
    hook_trigger: 'The real reason / What really / The truth behind',
    test: t => /\b(the real reason|what really (happened|drives?|causes?|explains?)|the truth behind|the actual|the real story behind)\b/i.test(t),
    skeleton: 'The Real [MECHANISM] Behind [FAMILIAR_PHENOMENON]',
    generation_requires: 'peer signal OR DNA bet with specific cause + familiar effect',
    can_generate_from_dna: true, // weak — depends on subject specificity
    examples_from_gold: [],
  },
];

// ── Helper: word count ────────────────────────────────────────────────────────
function wordCount(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

// ── Helper: token n-gram for pattern extraction ───────────────────────────────
function extractFirstThreeWords(t) {
  return String(t || '').trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase();
}

// ── Main ─────────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  const allLabeled = db.prepare(`
    SELECT id, generated_title, rec_source, human_label, family, concept_label,
           concept_confidence, score, channel_id
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL AND generated_title IS NOT NULL
    ORDER BY human_label, id
  `).all();

  db.close();

  const excellentAll = allLabeled.filter(r => r.human_label === 'Excellent');
  // Deduplicate by title so cross-channel duplicates don't inflate counts
  const seenTitles = new Set();
  const excellent = excellentAll.filter(r => {
    if (seenTitles.has(r.generated_title)) return false;
    seenTitles.add(r.generated_title);
    return true;
  });
  const good      = allLabeled.filter(r => r.human_label === 'Good');
  const winners   = [...excellent, ...good];
  const losers    = allLabeled.filter(r => r.human_label === 'Poor' || r.human_label === 'Garbage');

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Narrative Template Audit\n');
  process.stdout.write(`  ${excellent.length} Excellent | ${good.length} Good | ${allLabeled.length} total labeled\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // ── Classify all labeled rows by narrative structure ─────────────────────
  for (const row of allLabeled) {
    for (const struct of NARRATIVE_STRUCTURES) {
      if (struct.test(row.generated_title)) {
        if (row.human_label === 'Excellent' || row.human_label === 'Good') {
          struct.examples_from_gold.push({
            title: row.generated_title,
            label: row.human_label,
            source: row.rec_source,
            family: row.family,
            wc: wordCount(row.generated_title),
          });
        }
      }
    }
  }

  // ── Find Excellent titles that DON'T match any narrative structure ─────────
  const unclassifiedExcellent = excellent.filter(row =>
    !NARRATIVE_STRUCTURES.some(s => s.test(row.generated_title))
  );

  // ── Word count distribution of Excellent titles ───────────────────────────
  const excellentWC = excellent.map(r => wordCount(r.generated_title));
  const avgWC = excellentWC.reduce((a, b) => a + b, 0) / (excellentWC.length || 1);
  const minWC = Math.min(...excellentWC);
  const maxWC = Math.max(...excellentWC);

  // ── Source breakdown for Excellent ────────────────────────────────────────
  const sourceBreakdown = {};
  for (const row of excellent) {
    sourceBreakdown[row.rec_source] = (sourceBreakdown[row.rec_source] || 0) + 1;
  }

  // ── Hook word analysis ────────────────────────────────────────────────────
  const firstWordFreq = {};
  for (const row of excellent) {
    const fw = extractFirstThreeWords(row.generated_title);
    firstWordFreq[fw] = (firstWordFreq[fw] || 0) + 1;
  }

  // ── Print report ─────────────────────────────────────────────────────────
  process.stdout.write('── Excellent titles: all ' + excellent.length + ' ──────────────────────\n');
  for (const row of excellent) {
    const cls = NARRATIVE_STRUCTURES.find(s => s.test(row.generated_title));
    process.stdout.write(`  [${row.rec_source}] ${row.generated_title}\n`);
    if (cls) process.stdout.write(`    ↳ Pattern: ${cls.name}\n`);
    else       process.stdout.write(`    ↳ Pattern: UNCLASSIFIED\n`);
  }

  process.stdout.write('\n── Narrative structure match counts ─────────────────────────\n');
  for (const struct of NARRATIVE_STRUCTURES) {
    const matchedExcellent = struct.examples_from_gold.filter(e => e.label === 'Excellent').length;
    const matchedGood      = struct.examples_from_gold.filter(e => e.label === 'Good').length;
    process.stdout.write(`  ${struct.name.padEnd(24)} excellent=${matchedExcellent}  good=${matchedGood}\n`);
    if (VERBOSE && struct.examples_from_gold.length) {
      for (const ex of struct.examples_from_gold.slice(0, 3)) {
        process.stdout.write(`      [${ex.label}] "${ex.title}"\n`);
      }
    }
  }

  process.stdout.write('\n── Unclassified Excellent (no pattern match) ─────────────\n');
  for (const row of unclassifiedExcellent) {
    process.stdout.write(`  [${row.rec_source}] "${row.generated_title}"\n`);
  }

  process.stdout.write('\n── Source breakdown (Excellent) ──────────────────────────\n');
  for (const [src, n] of Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${src.padEnd(28)} ${n}\n`);
  }

  process.stdout.write('\n── Word count distribution (Excellent) ───────────────────\n');
  process.stdout.write(`  avg=${avgWC.toFixed(1)} min=${minWC} max=${maxWC}\n`);

  process.stdout.write('\n── Can be generated from DNA? ──────────────────────────────\n');
  const dnaPossible = NARRATIVE_STRUCTURES.filter(s => s.can_generate_from_dna);
  const dnaImpossible = NARRATIVE_STRUCTURES.filter(s => !s.can_generate_from_dna);
  process.stdout.write(`  Possible from DNA (weak): ${dnaPossible.map(s => s.id).join(', ')}\n`);
  process.stdout.write(`  Requires peer signal:     ${dnaImpossible.map(s => s.id).join(', ')}\n`);

  // ── Build library output ──────────────────────────────────────────────────
  const library = {
    generated: new Date().toISOString().slice(0, 10),
    gold_set_size: allLabeled.length,
    excellent_count: excellent.length,
    good_count: good.length,
    source_breakdown_excellent: sourceBreakdown,
    excellent_word_count: { avg: +avgWC.toFixed(1), min: minWC, max: maxWC },
    key_finding: 'ALL Excellent titles come from peer_video_signal. ' +
                 'Zero Excellent titles from dna_original_bets. ' +
                 'Narrative templates cannot be reliably generated from DNA alone — ' +
                 'they require surfacing real peer content with strong narrative hooks.',
    generation_strategy: {
      narrative_source: 'peer_video_signal',
      narrative_filter: 'surface peer titles with ASSUMPTION_REVERSAL, FORCED_CONFLICT, CONFLICT_EXPOSE, MEMORY_OBJECT patterns',
      dna_strategy: 'Focus DNA bets on: mistake + instructional + challenge + comparison templates',
      peer_upgrade: 'Rank peer signals with narrative hook patterns above non-narrative peer signals',
    },
    structures: NARRATIVE_STRUCTURES.map(struct => ({
      id: struct.id,
      name: struct.name,
      description: struct.description,
      hook_trigger: struct.hook_trigger,
      skeleton: struct.skeleton,
      generation_requires: struct.generation_requires,
      can_generate_from_dna: struct.can_generate_from_dna,
      excellent_count: struct.examples_from_gold.filter(e => e.label === 'Excellent').length,
      good_count:      struct.examples_from_gold.filter(e => e.label === 'Good').length,
      examples: struct.examples_from_gold.slice(0, 5).map(e => ({
        title: e.title,
        label: e.label,
        source: e.source,
        word_count: e.wc,
      })),
    })),
    unclassified_excellent: unclassifiedExcellent.map(r => ({
      title: r.generated_title,
      source: r.rec_source,
      word_count: wordCount(r.generated_title),
      note: 'Excellent title that evades all narrative detectors — likely unique structure',
    })),
    peer_signal_curation_rules: [
      'Include peer titles with word count >= 8 (narrative signals are long)',
      'Boost peer titles matching ASSUMPTION_REVERSAL, FORCED_CONFLICT, CONFLICT_EXPOSE patterns',
      'Include peer titles with named entities + claim verbs (proves, shows, reveals)',
      'Exclude peer titles matching spam patterns (episode numbers, LIVE suffix, collab format)',
      'Peer titles with named specific subject (The Tiger, Trump, Black Holes) rank above generic',
    ],
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(library, null, 2));
  process.stdout.write('\n  Written: ' + JSON_OUT + '\n');
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');
}

main();
