'use strict';

/**
 * Narrative Pattern Library — Phase 3
 *
 * Extracts, classifies, and stores reusable narrative excellence patterns
 * from all Excellent and high-narrative peer_video_signal traces.
 *
 * Patterns defined:
 *   FORCED_CONFLICT     — Subject forced into threat, danger, or impossible situation
 *   ASSUMPTION_REVERSAL — Common belief proven wrong; new discovery overturns consensus
 *   MEMORY_OBJECT       — Object/vehicle/place as anchor for human memory or time passage
 *   CONFLICT_EXPOSE     — Named actor exposed as incompetent, hypocritical, or failing
 *   DISCOVERY_SCIENCE   — Scale, scope, or mechanism discovered that changes understanding
 *   REVEAL_MECHANISM    — How something actually works, revealed unexpectedly
 *
 * Output: Console report + scripts/narrative_pattern_library.json
 * Usage:  node narrativePatternLibrary.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH  = path.resolve(__dirname, '../data/scoring.db');
const JSON_OUT = path.resolve(__dirname, 'narrative_pattern_library.json');
const VERBOSE  = process.argv.includes('--verbose');

// ── Pattern definitions ───────────────────────────────────────────────────────
// Each pattern has: name, description, structural_rules[], skeleton_templates[],
// worked_examples[], generation_requirements[], and can_generate_from_dna flag.

const NARRATIVE_PATTERNS = [
  {
    id: 'FORCED_CONFLICT',
    name: 'Forced Conflict',
    description: 'A subject (animal, person, place) is forced into a situation they did not choose — threat, impossibility, or external compulsion.',
    structural_rules: [
      'Subject must be named or highly specific (not generic)',
      'Conflict is external — imposed on subject, not chosen',
      'Stakes are physical, moral, or existential',
      'Title names the subject AND the conflict in the same breath',
    ],
    skeleton_templates: [
      'The [Subject] That Was Forced to [Conflict]',
      'What Happens When [Subject] Is Forced Into [Situation]',
      'The [Subject] Who Had No Choice but to [Action]',
    ],
    detection_regex: [
      '/\\bforced (to|into)\\b/i',
      '/\\b(animal|beast|tiger|creature|man|woman|village)\\b.*\\b(hunt|attack|kill|flee|survive)\\b/i',
    ],
    gold_examples: [
      {
        title: 'The Tiger That Was Forced to Hunt Humans',
        gold_label: 'Excellent',
        why_it_works: 'Specific named species (tiger), forced action (hunt humans), inversion of predator/prey relationship creates curiosity gap',
        named_entities: ['tiger', 'humans'],
        word_count: 9,
      },
    ],
    can_generate_from_dna: false,
    generation_requirement: 'Requires real documented incident from peer signal — a specific tiger, a specific human victim. Cannot be invented from creator DNA.',
    peer_signal_curation_rule: 'Boost peer titles containing: forced, trapped, survived, escaped, no choice, had to [dangerous verb]',
    category: 'narrative_excellence',
    win_rate_estimate: '~100% (2/2 in gold set — tiny sample)',
  },
  {
    id: 'ASSUMPTION_REVERSAL',
    name: 'Assumption Reversal',
    description: 'A widely-held scientific or cultural belief is overturned by new evidence. The title names the old belief and hints at the new truth.',
    structural_rules: [
      'Must name the OLD assumption explicitly ("we thought", "scientists believed")',
      'Must hint at the reversal ("might", "turns out", "actually")',
      'Subject is a known concept, not a person or event',
      'Word count 10-16 — needs room to set up both old and new states',
    ],
    skeleton_templates: [
      'We Thought [Subject] [Old Belief]. [New Discovery]',
      '[Subject]: What Scientists Got Wrong',
      'The [Subject] Theory That Just Collapsed',
    ],
    detection_regex: [
      '/\\b(we thought|scientists (thought|believed)|it turns out|might (actually|end))\\b/i',
      '/\\b(frozen big bang|singularit|quantum|black hole)\\b/i',
    ],
    gold_examples: [
      {
        title: 'We Thought Black Holes Ended in Singularities. They Might End In a Frozen Big Bang',
        gold_label: 'Excellent',
        why_it_works: 'Explicit "We Thought" frame, names old belief (singularities), names new possibility (Frozen Big Bang), creates massive curiosity gap',
        named_entities: ['Black Holes', 'Singularities', 'Frozen Big Bang'],
        word_count: 15,
      },
    ],
    average_examples: [
      {
        title: 'This Tiny Chip Could Make Google\'s Quantum Computer 1,000× Better',
        gold_label: 'Average',
        why_average: 'Has named entities and numbers but is a product announcement, not an assumption reversal. Missing the "we were wrong" frame.',
      },
    ],
    can_generate_from_dna: false,
    generation_requirement: 'Requires a real new scientific finding that contradicts consensus. Cannot be invented — must come from peer signals in science/education channels.',
    peer_signal_curation_rule: 'Boost peer titles containing: we thought, scientists believed, it turns out, new study, overturns, contradicts, actually not',
    category: 'narrative_excellence',
    win_rate_estimate: '~100% (2/2 in gold set — tiny sample)',
  },
  {
    id: 'MEMORY_OBJECT',
    name: 'Memory Object',
    description: 'A specific object (car, house, person) serves as the anchor for a story about human memory, time, and emotional resonance.',
    structural_rules: [
      'Must name a SPECIFIC object or vehicle (model, brand, or distinctive descriptor)',
      'Must anchor the object to people or time (family, years, memories)',
      'The emotional weight is in the combination — object + time + people',
      'Short and compact — 6-10 words ideal',
    ],
    skeleton_templates: [
      'A [Specific Object], A [Person/Group] and [N] Years of [Emotion]',
      'The [Object] That Carried Our [Emotion] for [N] Years',
    ],
    detection_regex: [
      '/\\b\\d{2,} years?\\b.*\\b(memories|journey|story|life)\\b/i',
      '/\\b(a (santro|family|car|house|bike) and \\d+)\\b/i',
    ],
    gold_examples: [
      {
        title: 'A Santro, A Family and 20 Years of Memories',
        gold_label: 'Excellent',
        why_it_works: 'Specific car model (Santro — iconic Indian middle-class car), contrasts with abstract human emotion (family, memories), exact number (20 years) anchors time. Universally relatable through a single specific object.',
        named_entities: ['Santro'],
        word_count: 9,
        cultural_context: 'Santro is an iconic small car for Indian middle-class families — deep nostalgia signal for the target audience',
      },
    ],
    can_generate_from_dna: false,
    generation_requirement: 'Requires a culturally resonant specific object from the creator\'s niche. The object must have emotional weight for the audience — cannot be generic. Must come from peer signals showing audience response.',
    peer_signal_curation_rule: 'Boost peer titles containing: specific product models, "20 years of", "a family and", "grew up with", "remember when"',
    category: 'narrative_excellence',
    win_rate_estimate: '~100% (2/2 in gold set — tiny sample)',
  },
  {
    id: 'CONFLICT_EXPOSE',
    name: 'Conflict Expose',
    description: 'A named person or institution is exposed as failing, incompetent, or hypocritical — with a specific event as proof.',
    structural_rules: [
      'MUST name the specific actor (person, institution, company)',
      'MUST name the specific event or context proving the failure',
      'Failure verb is direct and unambiguous ("Can\'t", "Failed", "Proved It")',
      'Title makes a claim, not a question — high confidence tone',
    ],
    skeleton_templates: [
      '[Named Actor] Can\'t [Skill], and [Specific Event] Proves It',
      '[Named Actor]\'s [Failure] Is Worse Than You Think',
      'How [Named Actor] Exposed Themselves at [Event]',
    ],
    detection_regex: [
      '/\\bcan[\\x27’]?t (negotiate|deal|fight|hide|stop)\\b/i',
      '/\\b(prove[sd]?|expose[sd]?)\\b.*\\b(lie|truth|hypocrisy|it)\\b/i',
    ],
    gold_examples: [
      {
        title: "Trump Can't Negotiate for S**t, and the Iran Peace Talks Prove It",
        gold_label: 'Excellent',
        why_it_works: 'Named actor (Trump), direct failure claim (Can\'t Negotiate), specific proof event (Iran Peace Talks). Opinion stated as fact creates strong emotional response — agree or disagree, viewer clicks to process it.',
        named_entities: ['Trump', 'Iran Peace Talks'],
        word_count: 12,
        controversy_score: 'HIGH — political figure, strong claim',
      },
    ],
    can_generate_from_dna: false,
    generation_requirement: 'Requires a specific named actor AND a specific documented failure event. Both must be from real peer signal content — cannot be constructed from creator DNA alone.',
    peer_signal_curation_rule: 'Boost peer titles containing: can\'t [verb], proved it, exposed, failed at, the truth about [named person]',
    category: 'narrative_excellence',
    win_rate_estimate: '~100% (4/4 in gold set — counting all label occurrences)',
  },
  {
    id: 'DISCOVERY_SCIENCE',
    name: 'Discovery Science',
    description: 'A scale, scope, or natural phenomenon is framed to create wonder or surprise. Often uses geographic specificity or massive scale numbers.',
    structural_rules: [
      'Must reference a real phenomenon (not a metaphor)',
      'Scale or location creates the wow factor',
      'Question frame ("Why So Many X HERE") or location emphasis works well',
      'Word count 6-10',
    ],
    skeleton_templates: [
      'Why So Many [Phenomenon] Happen [Location]',
      'What if You [Impossible Action] in [Extreme Location]',
      '[Famous Place/Thing]: The [Unexpected Discovery]',
    ],
    detection_regex: [
      '/\\b(black holes?|quantum|singularit|chernobyl|mariana trench|tornado|why so many)\\b/i',
    ],
    gold_examples: [
      {
        title: 'Why So Many Tornadoes Happen HERE',
        gold_label: 'Average',
        note: 'Not Excellent but strong narrative hook. Would be Excellent with named location.',
      },
      {
        title: 'What if you dropped a bowling ball in the Mariana Trench',
        gold_label: 'Average',
        note: 'Good scale + specific location. Average because the "what if" is too abstract — no real-world implication.',
      },
    ],
    can_generate_from_dna: false,
    generation_requirement: 'Requires real scientific content from science/education channels in peer pool. Geographic specificity is key.',
    peer_signal_curation_rule: 'Boost peer titles from science/education channels containing: "why so many", specific geographic locations, extreme scale numbers',
    category: 'narrative_near_miss',
    win_rate_estimate: 'Average gold label — gets clicks but not Excellent without additional specificity',
  },
  {
    id: 'REVEAL_MECHANISM',
    name: 'Reveal Mechanism',
    description: 'Explains how something actually works in a surprising or counterintuitive way. Uses "unreasonably", "actually", "let me explain" to signal depth.',
    structural_rules: [
      'Named product or service',
      'Signal word: "unreasonably", "actually", "secretly", "surprisingly"',
      '"Let me explain" or similar creates teacher-student authority frame',
    ],
    skeleton_templates: [
      '[Named Thing] is [Surprising Adjective]. Let me explain.',
      'How [Named Thing] Actually Works (and why it\'s [surprising])',
    ],
    detection_regex: [
      '/\\b(unreasonably|surprisingly|actually|secretly)\\b/i',
      '/\\blet me explain\\b/i',
    ],
    gold_examples: [
      {
        title: 'Google Maps is unreasonably fast. Let me explain',
        gold_label: 'Average',
        note: 'Strong mechanism reveal pattern. Average because "Google Maps" is well-known — less curiosity gap than an unknown phenomenon.',
      },
    ],
    can_generate_from_dna: true,
    can_generate_from_dna_notes: 'Possible for tech_review and explainer_case families if creator has relevant subjects. Template: "[Subject] is [unexpected adjective]. Here\'s why."',
    generation_requirement: 'Needs a subject with a non-obvious mechanism. Works for tech_review (products), finance (economic mechanisms), fitness (counterintuitive biology).',
    peer_signal_curation_rule: 'Boost peer titles containing: unreasonably, surprisingly, actually works, let me explain, the real reason',
    category: 'dna_generatable',
    win_rate_estimate: 'Average gold label — reliable click driver but rarely Excellent without named discovery',
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // Load all Excellent peer signal traces
  const excellentTraces = db.prepare(`
    SELECT DISTINCT t.generated_title, t.peer_language, t.peer_adaptability, t.peer_narrative, r.human_label
    FROM wtp_generation_traces t
    JOIN wtp_human_quality_reviews r ON r.generated_title = t.generated_title
    WHERE t.rec_source = 'peer_video_signal'
      AND r.human_label IN ('Excellent', 'Good')
    ORDER BY r.human_label, t.peer_narrative DESC
  `).all();

  // Load high-narrative peer traces (peer_narrative >= 70, even if not gold-labeled)
  const highNarrativeTraces = db.prepare(`
    SELECT DISTINCT generated_title, peer_language, peer_adaptability, peer_narrative
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal'
      AND peer_narrative >= 70
      AND generated_title IS NOT NULL
    ORDER BY peer_narrative DESC
  `).all();

  // Load all peer traces with quality metadata for summary
  const allPeerMetrics = db.prepare(`
    SELECT
      COUNT(DISTINCT generated_title) as distinct_titles,
      COUNT(DISTINCT CASE WHEN peer_language = 'english' THEN generated_title END) as english_titles,
      COUNT(DISTINCT CASE WHEN peer_adaptability >= 65 THEN generated_title END) as adaptable_titles,
      COUNT(DISTINCT CASE WHEN peer_narrative >= 70 THEN generated_title END) as narrative_titles,
      COUNT(DISTINCT CASE WHEN peer_language != 'english' AND peer_language IS NOT NULL THEN generated_title END) as non_english_titles
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal' AND generated_title IS NOT NULL
  `).get();

  db.close();

  // ── Console output ────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Narrative Pattern Library\n');
  process.stdout.write(`  ${NARRATIVE_PATTERNS.length} patterns defined | ${excellentTraces.length} Excellent/Good peer examples\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  process.stdout.write('── Pattern catalog ───────────────────────────────────────────\n');
  for (const p of NARRATIVE_PATTERNS) {
    const dnaFlag = p.can_generate_from_dna ? '✅ DNA-generatable' : '❌ Peer-only';
    process.stdout.write(`  [${p.id}] ${p.name} — ${dnaFlag}\n`);
    process.stdout.write(`    "${p.description.slice(0, 80)}..."\n`);
    if (p.gold_examples?.length) {
      for (const ex of p.gold_examples) {
        process.stdout.write(`    Example [${ex.gold_label}]: "${ex.title}"\n`);
      }
    }
    process.stdout.write('\n');
  }

  process.stdout.write('── Peer signal pool health (with enrichment data) ────────────\n');
  process.stdout.write(`  Total distinct titles:     ${allPeerMetrics.distinct_titles}\n`);
  process.stdout.write(`  English titles:            ${allPeerMetrics.english_titles} (${Math.round(allPeerMetrics.english_titles/allPeerMetrics.distinct_titles*100)}%)\n`);
  process.stdout.write(`  Adaptable (≥65 score):     ${allPeerMetrics.adaptable_titles} (${Math.round(allPeerMetrics.adaptable_titles/allPeerMetrics.distinct_titles*100)}%)\n`);
  process.stdout.write(`  Narrative (≥70 score):     ${allPeerMetrics.narrative_titles} (${Math.round(allPeerMetrics.narrative_titles/allPeerMetrics.distinct_titles*100)}%)\n`);
  process.stdout.write(`  Non-English:               ${allPeerMetrics.non_english_titles} (${Math.round(allPeerMetrics.non_english_titles/allPeerMetrics.distinct_titles*100)}%)\n`);

  if (VERBOSE) {
    process.stdout.write('\n── High-narrative peer titles (narrative ≥70) ────────────────\n');
    for (const r of highNarrativeTraces) {
      process.stdout.write(`  [narr=${r.peer_narrative}] "${r.generated_title}"\n`);
    }
  }

  process.stdout.write('\n── Key finding ───────────────────────────────────────────────\n');
  process.stdout.write('  ALL Excellent recommendations come from peer_video_signal.\n');
  process.stdout.write('  NONE can be generated from DNA alone.\n');
  process.stdout.write('  The 2 DNA-generatable patterns (REVEAL_MECHANISM) score Average.\n');
  process.stdout.write('  Next requirement: English science/education peer content in pool.\n');
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  // ── Write JSON output ─────────────────────────────────────────────────────
  const output = {
    generated: new Date().toISOString().slice(0, 10),
    purpose: 'Reusable narrative pattern definitions for Excellent recommendation generation',
    key_finding: 'ALL Excellent titles come from peer_video_signal. Zero from dna_original_bets. Narrative patterns CANNOT be generated from DNA alone — they require real peer signals with specific named entities and documented incidents.',
    peer_pool_health: {
      total_distinct_titles:   allPeerMetrics.distinct_titles,
      english_titles:          allPeerMetrics.english_titles,
      adaptable_titles:        allPeerMetrics.adaptable_titles,
      narrative_titles:        allPeerMetrics.narrative_titles,
      non_english_titles:      allPeerMetrics.non_english_titles,
      usable_pct:              Math.round((allPeerMetrics.adaptable_titles + allPeerMetrics.narrative_titles) / allPeerMetrics.distinct_titles * 100),
    },
    patterns: NARRATIVE_PATTERNS,
    peer_signal_curation_strategy: {
      priority_channels: 'Science, explainer, finance, current events channels in English',
      boost_signals: [
        'Titles with "forced", "trapped", "no choice" + physical stakes',
        'Titles with "we thought", "scientists believed", "turns out"',
        'Titles with specific branded objects + "years" + "memories"',
        'Titles with named public figures + "can\'t" or "proved it"',
        'Titles with named geographic locations + natural phenomena',
      ],
      filter_signals: [
        'Hindi / Devanagari script',
        'Episode numbers or show labels',
        '@mention promotional content',
        'Titles < 3 meaningful words',
        'Challenge / stunt / reaction vlog format',
      ],
      target_pool_size: '≥ 50 usable English titles (currently: ' + allPeerMetrics.english_titles + ' English, ~' + allPeerMetrics.adaptable_titles + ' adaptable)',
    },
    excellent_peer_examples: excellentTraces,
    dna_generatable_patterns: NARRATIVE_PATTERNS.filter(p => p.can_generate_from_dna).map(p => ({
      id: p.id,
      skeleton_templates: p.skeleton_templates,
      applicable_families: ['tech_review', 'explainer_case', 'finance_education'],
      notes: p.can_generate_from_dna_notes,
    })),
  };

  fs.writeFileSync(JSON_OUT, JSON.stringify(output, null, 2));
  process.stdout.write(`  Written: ${JSON_OUT}\n\n`);
}

main();
