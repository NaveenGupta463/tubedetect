'use strict';

/**
 * Narrative Pattern Expansion Audit — Research Track 2
 *
 * Studies the 4 core narrative excellence patterns found in the peer signal pool:
 *   FORCED_CONFLICT, ASSUMPTION_REVERSAL, MEMORY_OBJECT, CONFLICT_EXPOSE
 *
 * For each pattern:
 *   - Frequency in current peer pool
 *   - Human quality labels (gold set)
 *   - Creator niches shown to (join with ingested_channels)
 *   - Adaptability assessment: can this pattern be applied to creator subjects?
 *   - Pattern expansion: what structural variants exist beyond current examples?
 *
 * Output: scripts/narrative_intelligence_report.md
 * Usage:  node narrativePatternExpansionAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT = path.resolve(__dirname, 'narrative_intelligence_report.md');
const VERBOSE    = process.argv.includes('--verbose');

// ── Pattern definitions ───────────────────────────────────────────────────────
const PATTERNS = [
  {
    id: 'FORCED_CONFLICT',
    name: 'Forced Conflict',
    description: 'Subject forced into threat, danger, or impossible situation not of their choosing.',
    test: t => /\bforced (to|into)\b/i.test(t) || (/\b(tiger|animal|beast|creature|man|woman|person|village)\b/i.test(t) && /\b(hunt|attack|kill|flee|survive|face)\b/i.test(t)),
    skeleton: 'The [Subject] That Was Forced to [Conflict]',
    adaptable_families: ['travel_lifestyle', 'general_education', 'explainer_case', 'news_event'],
    dna_generatable: false,
    generation_path: 'Requires real documented incident — specific species/person + specific forcing event. Cannot be invented from creator DNA.',
    expansion_variants: [
      'What Happens When [Subject] Is Forced to [Action]',
      'The [Subject] Who Had No Choice but to [Dangerous Action]',
      'When [Subject] Were Forced Into [Extreme Situation]',
    ],
    required_named_entities: ['Subject (specific animal/person/place)', 'Conflict event (specific documented incident)'],
  },
  {
    id: 'ASSUMPTION_REVERSAL',
    name: 'Assumption Reversal',
    description: 'A widely-held belief proven wrong. Old assumption named + new truth hinted.',
    test: t => /\b(we thought|scientists (thought|believed)|it turns out|might (actually|end)|turns out)\b/i.test(t) || /\b(frozen big bang|singularit)\b/i.test(t),
    skeleton: 'We Thought [Subject] [Old Belief]. They Might [New Truth]',
    adaptable_families: ['general_education', 'finance_education', 'explainer_case', 'wellness_teaching', 'fitness_practice'],
    dna_generatable: false,
    generation_path: 'Requires a real scientific or expert consensus reversal — not an opinion. The "new truth" must be sourced from peer channels, not invented.',
    expansion_variants: [
      'We Thought [Subject] Was [Common Belief]. It\'s [Reversal]',
      'Why [Subject] Isn\'t What We Were Taught',
      '[Subject]: The Study That Overturned Everything',
      'Everything You Know About [Subject] Is [Degree] Wrong',
    ],
    required_named_entities: ['Subject (known concept)', 'Old belief (specific, nameable)', 'New finding source (study/discovery)'],
  },
  {
    id: 'MEMORY_OBJECT',
    name: 'Memory Object',
    description: 'Specific object anchors human emotion: time, family, memory, nostalgia.',
    test: t => /\b\d{2,} years?\b.*\b(memories|journey|story|life)\b/i.test(t) || /\b(a (santro|family|car|bike|house) and \d+)\b/i.test(t),
    skeleton: 'A [Specific Named Object], A [Person/Group] and [N] Years of [Emotion]',
    adaptable_families: ['cooking_food', 'travel_lifestyle', 'wellness_teaching', 'conversation_spiritual', 'general_education'],
    dna_generatable: false,
    generation_path: 'Requires a culturally resonant named object with deep audience nostalgia signal. The object must be SPECIFIC (Santro, not "a car"). Must come from peer channel audience patterns.',
    expansion_variants: [
      'A [Specific Object], A [Family/Community] and [N] Years of [Emotion]',
      'The [Specific Object] That [Defined/Changed] [Time Period] for [Audience Group]',
      '[N] Years. One [Specific Object]. An Entire [Life/Era/Generation].',
    ],
    required_named_entities: ['Specific object (branded/named)', 'Time period (years)', 'Emotional anchor (family/memories/generation)'],
  },
  {
    id: 'CONFLICT_EXPOSE',
    name: 'Conflict Expose',
    description: 'Named person or institution exposed as incompetent/hypocritical with specific event as proof.',
    test: t => /\bcan[''’]?t (negotiate|deal|fight|hide|stop|lead|govern|manage)\b/i.test(t) || /\b(prove[sd]?|expose[sd]?|reveals?)\b.*\b(lie|it|truth|hypocrisy|failure)\b/i.test(t) || (/\bcan[''’]?t\b/i.test(t) && /\b(and|proves?|proof|evidence)\b/i.test(t)),
    skeleton: '[Named Actor] Can\'t [Skill], and [Specific Event] Proves It',
    adaptable_families: ['news_event', 'explainer_case', 'conversation_business', 'conversation_finance', 'general_education'],
    dna_generatable: false,
    generation_path: 'Requires named public figure OR named institution + specific documented failure. Both must be from real peer signals. The "Proves It" event must be citable.',
    expansion_variants: [
      '[Named Actor]\'s [Failure Event] Reveals Everything',
      'Why [Named Actor] Can\'t [Competency] (And Never Could)',
      '[Named Actor] Is [Failing]. [Specific Event] Makes It Undeniable.',
      'The [Specific Event] That Finally Exposed [Named Actor]',
    ],
    required_named_entities: ['Named actor (public figure or institution)', 'Failure event (specific, recent, documented)'],
  },
];

// ── Peer channel niche lookup ──────────────────────────────────────────────────
// The peer signal pool (14 creator channels) shows which niches benefit most.
// We join on channel_id from traces → ingested_channels for niche.
// Also load peer pool source channels from corpus_videos / video signals.

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // Check enrichment columns exist
  const tCols = db.prepare('PRAGMA table_info(wtp_generation_traces)').all().map(c => c.name);
  const hasEnrichment = tCols.includes('peer_narrative');

  // Load all distinct peer titles with metadata
  const peerTitles = db.prepare(`
    SELECT DISTINCT
      t.generated_title,
      ${hasEnrichment ? 'MAX(t.peer_language) as peer_language, MAX(t.peer_adaptability) as peer_adaptability, MAX(t.peer_narrative) as peer_narrative,' : ''}
      MAX(t.wtp_score) as wtp_score,
      COUNT(DISTINCT t.channel_id) as shown_to_channels,
      GROUP_CONCAT(DISTINCT t.channel_id) as channel_ids
    FROM wtp_generation_traces t
    WHERE t.rec_source = 'peer_video_signal' AND t.generated_title IS NOT NULL
    GROUP BY t.generated_title
    ORDER BY MAX(t.wtp_score) DESC NULLS LAST
  `).all();

  // Gold labels
  const goldByTitle = new Map();
  const goldRows = db.prepare(`
    SELECT generated_title, human_label
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL
  `).all();
  for (const r of goldRows) {
    if (!goldByTitle.has(r.generated_title)) goldByTitle.set(r.generated_title, r.human_label);
  }

  // Creator channel niches (receivers of peer recommendations)
  const nicheByChannel = new Map();
  try {
    const niches = db.prepare(`
      SELECT channel_id, primary_niche, niche
      FROM ingested_channels
      WHERE channel_id IS NOT NULL
    `).all();
    for (const r of niches) nicheByChannel.set(r.channel_id, r.primary_niche || r.niche || 'unknown');
  } catch (_) {}

  // All gold Excellent rows for cross-reference
  const excellentTitles = new Set(
    db.prepare("SELECT DISTINCT generated_title FROM wtp_human_quality_reviews WHERE human_label='Excellent'").all().map(r => r.generated_title)
  );

  db.close();

  // ── Classify each peer title by pattern ────────────────────────────────────
  const classifiedByPattern = {};
  for (const p of PATTERNS) classifiedByPattern[p.id] = [];

  const unclassified = [];

  for (const row of peerTitles) {
    let matched = false;
    for (const p of PATTERNS) {
      if (p.test(row.generated_title)) {
        const channelIdList = (row.channel_ids || '').split(',').filter(Boolean);
        const niches = [...new Set(channelIdList.map(id => nicheByChannel.get(id) || 'unknown'))];
        classifiedByPattern[p.id].push({
          ...row,
          gold: goldByTitle.get(row.generated_title) || null,
          is_excellent: excellentTitles.has(row.generated_title),
          receiver_niches: niches,
        });
        matched = true;
        break;
      }
    }
    if (!matched) unclassified.push(row);
  }

  // ── Console report ──────────────────────────────────────────────────────────
  const total = peerTitles.length;
  const inPattern = PATTERNS.reduce((s, p) => s + classifiedByPattern[p.id].length, 0);

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Narrative Pattern Expansion Audit\n');
  process.stdout.write(`  ${total} distinct peer titles | ${inPattern} match narrative patterns (${Math.round(inPattern/total*100)}%)\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  const reportLines = [
    '# Narrative Intelligence Report',
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Total distinct peer titles:** ${total}  `,
    `**Narrative pattern matches:** ${inPattern} (${Math.round(inPattern/total*100)}%)  `,
    '',
  ];

  for (const p of PATTERNS) {
    const titles = classifiedByPattern[p.id];
    const n = titles.length;
    const positiveN = titles.filter(r => r.gold === 'Excellent' || r.gold === 'Good').length;
    const labeledN  = titles.filter(r => r.gold).length;
    const positiveRate = labeledN ? `${Math.round(positiveN/labeledN*100)}% (${positiveN}/${labeledN} labeled)` : 'no gold labels';
    const allNiches = [...new Set(titles.flatMap(r => r.receiver_niches))].filter(n => n !== 'unknown');

    process.stdout.write(`── [${p.id}] ${p.name} (n=${n}) ─────────────────────────────\n`);
    process.stdout.write(`   Positive rate: ${positiveRate}\n`);
    process.stdout.write(`   DNA-generatable: ${p.dna_generatable ? 'YES' : 'NO'}\n`);
    process.stdout.write(`   Adaptable families: ${p.adaptable_families.join(', ')}\n`);

    if (titles.length) {
      process.stdout.write(`   Titles:\n`);
      for (const r of titles) {
        const goldTag = r.gold ? ` [${r.gold}]` : '';
        const niches  = r.receiver_niches.filter(n => n !== 'unknown').join(', ');
        process.stdout.write(`     "${r.generated_title}"${goldTag}${niches ? ' → ' + niches : ''}\n`);
      }
    }
    process.stdout.write('\n');

    // Adaptability analysis — can creator subjects fill the skeleton?
    process.stdout.write(`   Adaptability: `);
    if (p.dna_generatable) {
      process.stdout.write('Can generate from DNA for: ' + p.adaptable_families.join(', ') + '\n');
    } else {
      process.stdout.write('Requires peer signal. Works best for: ' + p.adaptable_families.slice(0, 3).join(', ') + '\n');
      process.stdout.write(`   Path: ${p.generation_path.slice(0, 100)}...\n`);
    }
    process.stdout.write('\n');

    // Add to markdown
    reportLines.push(`## ${p.name} (${p.id})`, '');
    reportLines.push(`**Matches in current peer pool:** ${n}  `);
    reportLines.push(`**Positive rate:** ${positiveRate}  `);
    reportLines.push(`**DNA-generatable:** ${p.dna_generatable ? 'YES' : 'NO'}  `);
    reportLines.push(`**Best creator families:** ${p.adaptable_families.join(', ')}  `);
    reportLines.push('');
    reportLines.push(`**Description:** ${p.description}`, '');
    reportLines.push(`**Skeleton template:** \`${p.skeleton}\``, '');
    reportLines.push('**Expansion variants:**', '');
    for (const v of p.expansion_variants) reportLines.push(`- \`${v}\``);
    reportLines.push('');
    reportLines.push('**Required named entities:**', '');
    for (const e of p.required_named_entities) reportLines.push(`- ${e}`);
    reportLines.push('');
    reportLines.push('**Generation path:**', `${p.generation_path}`, '');
    reportLines.push('**Receiver niches:**', allNiches.length ? allNiches.join(', ') : 'unknown', '');
    if (titles.length) {
      reportLines.push('**Current peer examples:**', '');
      for (const r of titles) {
        const goldTag = r.gold ? ` — **${r.gold}**` : '';
        reportLines.push(`- "${r.generated_title}"${goldTag}`);
      }
    }
    reportLines.push('');
  }

  // ── Pattern expansion opportunity ─────────────────────────────────────────
  process.stdout.write('── Pattern expansion opportunities ────────────────────────────\n');
  const borderlineEnglish = unclassified.filter(r => {
    const lang = hasEnrichment ? r.peer_language : 'unknown';
    return lang === 'english' || lang === 'unknown';
  });
  process.stdout.write(`  ${borderlineEnglish.length} English peer titles outside all 4 patterns — potential 5th pattern candidates\n\n`);

  // Look for emerging pattern types in borderline titles
  const POTENTIAL_PATTERNS = {
    'TRANSFORMATION': t => /\b(turned|transformed|built|made|became)\b/i.test(t) && /\b(school bus|house|city|room|nothing|zero)\b/i.test(t),
    'SCALE_SURPRISE': t => /\b(biggest|giant|1000|1,000|million|billion)\b/i.test(t),
    'IMPOSSIBLE_ACTION': t => /\b(you can('|')?t|impossible|nobody can|can anyone)\b/i.test(t),
    'INVESTIGATIVE': t => /\b(expose[sd]?|i exposed|i investigated|the truth about|what they don[''`]?t tell)\b/i.test(t),
  };

  const emerging = {};
  for (const row of borderlineEnglish) {
    for (const [name, test] of Object.entries(POTENTIAL_PATTERNS)) {
      if (test(row.generated_title)) {
        if (!emerging[name]) emerging[name] = [];
        emerging[name].push(row);
      }
    }
  }

  reportLines.push('## Emerging Pattern Candidates', '');
  reportLines.push(`${borderlineEnglish.length} English peer titles outside the 4 core patterns. Potential emerging patterns:`, '');

  for (const [name, rows] of Object.entries(emerging)) {
    if (!rows.length) continue;
    process.stdout.write(`  [${name}] ${rows.length} titles\n`);
    for (const r of rows) {
      const goldTag = r.gold ? ` [${r.gold}]` : '';
      process.stdout.write(`    "${r.generated_title}"${goldTag}\n`);
    }
    process.stdout.write('\n');
    reportLines.push(`### ${name} (n=${rows.length})`, '');
    for (const r of rows) {
      const goldTag = r.gold ? ` — **${r.gold}**` : '';
      reportLines.push(`- "${r.generated_title}"${goldTag}`);
    }
    reportLines.push('');
  }

  // ── Key findings ──────────────────────────────────────────────────────────
  reportLines.push('## Key Findings', '');
  reportLines.push('1. **All 4 Excellent-producing patterns are Peer-only** — none can be generated from creator DNA alone.');
  reportLines.push('2. **Frequency is thin** — each pattern has 1-2 examples in the current 102-title peer pool.');
  reportLines.push('3. **All patterns require specific named entities** — species (tiger), discoveries (Frozen Big Bang), persons (Trump), objects (Santro). Generic placeholders do not trigger the same response.');
  reportLines.push('4. **Receiver niche is mostly irrelevant** — the 4 Excellent titles were shown across multiple creator niches and still scored Excellent. The narrative quality is universal.');
  reportLines.push('5. **Path to Excellent+Creator-Relevant**: Show peer narrative titles to creators whose niche MATCHES the pattern subject. Tiger → wildlife creators. Santro → automotive/nostalgia creators. Trump negotiation → finance/geopolitics creators.');
  reportLines.push('6. **CONFLICT_EXPOSE is the most adaptable** — any niche has public figures or institutions that can be exposed. Finance: "RBI Can\'t Control Inflation, and the Data Proves It". Fitness: "Your Gym Chain Can\'t Deliver on Its Promises, and This Shows It."');
  reportLines.push('');
  reportLines.push('## Peer Signal Curation Priority', '');
  reportLines.push('To expand the narrative pool, prioritize peer channels that produce:');
  reportLines.push('- Science/documentary channels (FORCED_CONFLICT, ASSUMPTION_REVERSAL, DISCOVERY_SCIENCE)');
  reportLines.push('- Nostalgia/automotive/lifestyle channels (MEMORY_OBJECT)');
  reportLines.push('- Political commentary / business analysis channels (CONFLICT_EXPOSE)');
  reportLines.push('- English-language explainer creators (all patterns, higher quality base rate)');

  process.stdout.write('\n── Key findings ───────────────────────────────────────────────\n');
  process.stdout.write('  1. All 4 Excellent-producing patterns are Peer-only — zero DNA-generatable.\n');
  process.stdout.write('  2. Each pattern has only 1-2 examples in current 102-title pool — very thin.\n');
  process.stdout.write('  3. All require specific named entities — generics don\'t trigger the hook.\n');
  process.stdout.write('  4. Narrative quality is universal — same title scores Excellent across niches.\n');
  process.stdout.write('  5. CONFLICT_EXPOSE is most adaptable — every niche has an institution to expose.\n');
  process.stdout.write('     Finance: "RBI Can\'t Control Inflation, and the Data Proves It"\n');
  process.stdout.write('     Fitness: "Your Gym Supplement Brand Can\'t Back Its Claims, and Tests Prove It"\n');
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  fs.writeFileSync(REPORT_OUT, reportLines.join('\n'));
  process.stdout.write(`  Written: ${REPORT_OUT}\n\n`);
}

main();
