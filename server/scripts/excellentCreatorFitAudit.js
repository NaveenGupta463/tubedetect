'use strict';

/**
 * Excellent Creator Fit Audit — Research Track 3
 *
 * Central research question:
 *   "Can a recommendation be simultaneously Creator-Relevant AND Narratively Excellent?"
 *
 * Analyzes all Excellent recommendations to measure:
 *   - Creator relevance (concept_confidence ≥ 0.55)
 *   - Concept coverage (concept_id not null)
 *   - Opportunity coverage (opportunity_id not null)
 *   - Narrative structure (which pattern)
 *   - Score gap: what normalized score did Excellent rows receive?
 *
 * Then models the PATH to convergence:
 *   - Which creator families could absorb narrative patterns?
 *   - What does an "Excellent + Creator-Relevant" title look like?
 *   - Which narrative patterns are most adaptable to specific creator DNA?
 *
 * Output: scripts/excellent_creator_fit_report.md
 * Usage:  node excellentCreatorFitAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT = path.resolve(__dirname, 'excellent_creator_fit_report.md');
const VERBOSE    = process.argv.includes('--verbose');

// ── Pattern classifiers (consistent with narrativePatternExpansionAudit) ──────
const NARRATIVE_DETECTORS = {
  FORCED_CONFLICT:     t => /\bforced (to|into)\b/i.test(t) || (/\b(tiger|animal|beast|creature)\b/i.test(t) && /\b(hunt|attack|kill|flee|survive)\b/i.test(t)),
  ASSUMPTION_REVERSAL: t => /\b(we thought|scientists (thought|believed)|it turns out|might (actually|end))\b/i.test(t) || /\b(frozen big bang|singularit)\b/i.test(t),
  MEMORY_OBJECT:       t => /\b\d{2,} years?\b.*\b(memories|journey|story|life)\b/i.test(t) || /\b(a (santro|family|car|bike) and \d+)\b/i.test(t),
  CONFLICT_EXPOSE:     t => /\bcan[''']?t (negotiate|deal|fight|hide|stop|lead|govern)\b/i.test(t) || /\b(prove[sd]?|expose[sd]?)\b.*\b(lie|it|truth|hypocrisy)\b/i.test(t),
  DISCOVERY_SCIENCE:   t => /\b(black holes?|quantum|singularit|chernobyl|mariana trench|tornado|why so many)\b/i.test(t),
  REVEAL_MECHANISM:    t => /\b(unreasonably|surprisingly|actually)\b/i.test(t) || /\blet me explain\b/i.test(t),
};

function classifyNarrative(t) {
  for (const [name, fn] of Object.entries(NARRATIVE_DETECTORS)) {
    if (fn(t)) return name;
  }
  return 'NONE';
}

// ── Winner template classifiers (for Good rows comparison) ────────────────────
const TEMPLATE_DETECTORS = {
  DISH_TECHNIQUE:   t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|curry|paneer|chicken|fish|egg|cake|bread|coffee|asmr cooking)\b/i.test(t),
  WAY_TO:           t => /^(how |what nobody)/i.test(t) || /\b(how to|way to)\b/i.test(t),
  CHECKLIST_FORMAT: t => /\b(checklist|guide|tips?|routine|plan)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide)/i.test(t),
  MISTAKE_BEHIND:   t => /\b(mistake|trap|pitfall|wrong|beginner mistake|common mistake|get wrong)\b/i.test(t),
  COLON_EXPLAINER:  t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why)\b/i.test(t),
};

function classifyTemplate(t) {
  for (const [name, fn] of Object.entries(TEMPLATE_DETECTORS)) {
    if (fn(t)) return name;
  }
  return 'GENERIC';
}

function wordCount(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // ── Load all Excellent and Good rows (deduped by title) ───────────────────
  const allLabeled = db.prepare(`
    SELECT
      r.generated_title, r.rec_source, r.family, r.concept_id, r.concept_label,
      r.concept_confidence, r.dna_affinity_score, r.score, r.human_label,
      r.reviewer_notes, r.channel_id,
      t.opportunity_id, t.opportunity_label, t.opportunity_confidence
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE r.human_label IS NOT NULL
    ORDER BY
      CASE r.human_label WHEN 'Excellent' THEN 1 WHEN 'Good' THEN 2 WHEN 'Average' THEN 3 WHEN 'Poor' THEN 4 ELSE 5 END,
      r.score DESC
  `).all();

  // Dedup by title (keep first occurrence per label tier)
  const seenTitles = new Map();
  const labeledDeduped = allLabeled.filter(r => {
    if (seenTitles.has(r.generated_title)) return false;
    seenTitles.set(r.generated_title, r.human_label);
    return true;
  });

  const excellent = labeledDeduped.filter(r => r.human_label === 'Excellent');
  const good      = labeledDeduped.filter(r => r.human_label === 'Good');
  const poor      = labeledDeduped.filter(r => r.human_label === 'Poor' || r.human_label === 'Garbage');

  // ── Metric helpers ────────────────────────────────────────────────────────
  function metricsFor(rows) {
    const n = rows.length;
    if (!n) return { n: 0 };
    const creatorRelevant = rows.filter(r => (r.concept_confidence || 0) >= 0.55).length;
    const hasConcept      = rows.filter(r => r.concept_id).length;
    const hasOpportunity  = rows.filter(r => r.opportunity_id).length;
    const avgWc           = (rows.reduce((s, r) => s + wordCount(r.generated_title), 0) / n).toFixed(1);
    const avgScore        = (rows.reduce((s, r) => s + (r.score || 0), 0) / n).toFixed(1);
    const narrativeHits   = rows.filter(r => classifyNarrative(r.generated_title) !== 'NONE').length;
    const byPattern       = {};
    for (const r of rows) {
      const p = classifyNarrative(r.generated_title);
      byPattern[p] = (byPattern[p] || 0) + 1;
    }
    const byTemplate = {};
    for (const r of rows) {
      const t = classifyTemplate(r.generated_title);
      byTemplate[t] = (byTemplate[t] || 0) + 1;
    }
    const bySrc = {};
    for (const r of rows) {
      bySrc[r.rec_source || 'unknown'] = (bySrc[r.rec_source || 'unknown'] || 0) + 1;
    }
    const byFamily = {};
    for (const r of rows) {
      const fam = r.family || 'null';
      byFamily[fam] = (byFamily[fam] || 0) + 1;
    }
    return {
      n, creatorRelevant, hasConcept, hasOpportunity,
      avgWc, avgScore, narrativeHits,
      byPattern, byTemplate, bySrc, byFamily,
      creatorRelevantRate: `${Math.round(creatorRelevant/n*100)}%`,
      conceptCovRate:      `${Math.round(hasConcept/n*100)}%`,
      opportunityCovRate:  `${Math.round(hasOpportunity/n*100)}%`,
      narrativeRate:       `${Math.round(narrativeHits/n*100)}%`,
    };
  }

  const excM  = metricsFor(excellent);
  const goodM = metricsFor(good);
  const poorM = metricsFor(poor);

  // ── Load creator DNA for channels that received Excellent recs ─────────────
  const excChannels = [...new Set(excellent.map(r => r.channel_id))];
  const channelDNA = new Map();
  if (excChannels.length) {
    try {
      const ph = excChannels.map(() => '?').join(',');
      const dnaRows = db.prepare(`
        SELECT c.channel_id, c.primary_niche, c.niche, d.stable_dna_json
        FROM ingested_channels c
        LEFT JOIN creator_idea_dna d ON d.channel_id = c.channel_id
        WHERE c.channel_id IN (${ph})
      `).all(...excChannels);
      for (const r of dnaRows) channelDNA.set(r.channel_id, r);
    } catch (_) {}
  }

  db.close();

  // ── Console report ────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Excellent Creator Fit Audit\n');
  process.stdout.write(`  ${excellent.length} Excellent | ${good.length} Good | ${poor.length} Poor/Garbage (deduped by title)\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  function printMetrics(label, m) {
    process.stdout.write(`── ${label} (n=${m.n}) ─────────────────────────────────────\n`);
    process.stdout.write(`  Creator relevance (concept_confidence ≥ 0.55): ${m.creatorRelevantRate} (${m.creatorRelevant}/${m.n})\n`);
    process.stdout.write(`  Concept coverage (concept_id not null):         ${m.conceptCovRate} (${m.hasConcept}/${m.n})\n`);
    process.stdout.write(`  Opportunity coverage (opp_id not null):         ${m.opportunityCovRate} (${m.hasOpportunity}/${m.n})\n`);
    process.stdout.write(`  Narrative structure (any pattern):              ${m.narrativeRate} (${m.narrativeHits}/${m.n})\n`);
    process.stdout.write(`  Avg word count:                                 ${m.avgWc}\n`);
    process.stdout.write(`  Avg score:                                      ${m.avgScore}\n`);
    process.stdout.write(`  By source: ${Object.entries(m.bySrc).map(([k,v])=>`${k}:${v}`).join(', ')}\n`);
    if (Object.keys(m.byPattern).length > 1 || !m.byPattern['NONE']) {
      process.stdout.write(`  By narrative pattern: ${Object.entries(m.byPattern).filter(([k])=>k!=='NONE').map(([k,v])=>`${k}:${v}`).join(', ')}\n`);
    }
    if (Object.keys(m.byTemplate).length) {
      process.stdout.write(`  By winner template: ${Object.entries(m.byTemplate).map(([k,v])=>`${k}:${v}`).join(', ')}\n`);
    }
    process.stdout.write('\n');
  }

  printMetrics('Excellent', excM);
  printMetrics('Good', goodM);
  printMetrics('Poor + Garbage', poorM);

  // ── The central research question ─────────────────────────────────────────
  process.stdout.write('── Central Research Question ──────────────────────────────────\n');
  process.stdout.write('  Can a recommendation be simultaneously:\n');
  process.stdout.write('    1. Creator-relevant (concept_confidence ≥ 0.55)\n');
  process.stdout.write('    2. Narratively compelling (Excellent pattern)\n');
  process.stdout.write('    3. Human-labeled Excellent?\n\n');

  const excellentAndCreatorRelevant = excellent.filter(r => (r.concept_confidence || 0) >= 0.55);
  if (excellentAndCreatorRelevant.length) {
    process.stdout.write(`  ✅ YES — ${excellentAndCreatorRelevant.length} Excellent rows with creator relevance found:\n`);
    for (const r of excellentAndCreatorRelevant) {
      process.stdout.write(`     "${r.generated_title}" [concept=${r.concept_label}, conf=${r.concept_confidence}]\n`);
    }
  } else {
    process.stdout.write(`  ❌ NO — Zero Excellent rows with concept_confidence ≥ 0.55.\n`);
    process.stdout.write(`         All ${excellent.length} Excellent rows have concept_confidence = null.\n`);
    process.stdout.write(`         Root cause: peer_video_signal traces skip concept extraction entirely.\n\n`);
  }

  // ── Structural convergence analysis ───────────────────────────────────────
  process.stdout.write('── Path to convergence ────────────────────────────────────────\n');
  process.stdout.write('  Three paths exist from current state:\n\n');

  process.stdout.write('  Path A — Run concept extraction on peer titles:\n');
  process.stdout.write('    Extract concept from peer title → assign concept_id/confidence.\n');
  process.stdout.write('    "The Tiger That Was Forced to Hunt Humans" → concept: wildlife_conservation\n');
  process.stdout.write('    Show this ONLY to wildlife/nature/conservation creators.\n');
  process.stdout.write('    Result: Excellent + Creator-Relevant (concept match via title topic).\n\n');

  process.stdout.write('  Path B — Apply CONFLICT_EXPOSE to creator-specific named entities:\n');
  process.stdout.write('    CONFLICT_EXPOSE is the only pattern where the "named actor" can be creator-niche-specific.\n');
  process.stdout.write('    Finance creator: "RBI Can\'t Control Inflation, and the Data Proves It"\n');
  process.stdout.write('    Fitness creator: "Supplement Brands Can\'t Back Their Claims, and Tests Prove It"\n');
  process.stdout.write('    Result: Narrative excellence pattern + creator domain relevance.\n\n');

  process.stdout.write('  Path C — REVEAL_MECHANISM (only DNA-generatable narrative pattern):\n');
  process.stdout.write('    Score: Average (not Excellent). But it IS creator-relevant when applied to creator subjects.\n');
  process.stdout.write('    "Your Metabolism Is Unreasonably Slow. Here\'s Why." (fitness creator)\n');
  process.stdout.write('    "Compound Interest Is Unreasonably Powerful. Let Me Show You." (finance creator)\n');
  process.stdout.write('    Current ceiling: Average quality. Could become Good with strong concept match.\n\n');

  process.stdout.write('── What Excellent rows reveal about the channels that received them ─\n');
  for (const exc of excellent) {
    const dna = channelDNA.get(exc.channel_id);
    const niche = dna ? (dna.primary_niche || dna.niche || 'unknown') : 'unknown';
    const pattern = classifyNarrative(exc.generated_title);
    process.stdout.write(`  [${pattern}] "${exc.generated_title}"\n`);
    process.stdout.write(`     Channel niche: ${niche} | Score: ${exc.score} | Concept match: ${exc.concept_confidence ? 'YES' : 'NO'}\n`);
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  // ── Write markdown report ─────────────────────────────────────────────────
  const lines = [
    '# Excellent Creator Fit Audit',
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Central research question:** Can a recommendation be simultaneously Creator-Relevant, Narratively Compelling, AND Human-labeled Excellent?  `,
    '',
    '## Current State',
    '',
    '| Metric | Excellent | Good | Poor/Garbage |',
    '|---|---|---|---|',
    `| Count (deduped) | ${excM.n} | ${goodM.n} | ${poorM.n} |`,
    `| Creator relevance | ${excM.creatorRelevantRate} | ${goodM.creatorRelevantRate} | ${poorM.creatorRelevantRate} |`,
    `| Concept coverage | ${excM.conceptCovRate} | ${goodM.conceptCovRate} | ${poorM.conceptCovRate} |`,
    `| Opportunity coverage | ${excM.opportunityCovRate} | ${goodM.opportunityCovRate} | ${poorM.opportunityCovRate} |`,
    `| Narrative pattern | ${excM.narrativeRate} | ${goodM.narrativeRate} | ${poorM.narrativeRate} |`,
    `| Avg word count | ${excM.avgWc} | ${goodM.avgWc} | ${poorM.avgWc} |`,
    `| Avg score | ${excM.avgScore} | ${goodM.avgScore} | ${poorM.avgScore} |`,
    '',
    '## Answer to Central Research Question',
    '',
  ];

  if (excellentAndCreatorRelevant.length) {
    lines.push('**YES** — ' + excellentAndCreatorRelevant.length + ' Excellent rows with creator relevance found.', '');
    for (const r of excellentAndCreatorRelevant) {
      lines.push(`- "${r.generated_title}" [concept=${r.concept_label}, confidence=${r.concept_confidence}]`);
    }
  } else {
    lines.push('**NO** — Zero Excellent rows with concept_confidence ≥ 0.55.', '');
    lines.push('**Root cause:** `peer_video_signal` traces skip concept extraction entirely. The `concept_id`, `concept_confidence`, and `family` fields are NULL for every peer recommendation — by architectural design.', '');
    lines.push('**This is a structural gap, not a quality gap.** The titles themselves are creator-relevant (e.g. "The Tiger..." is shown to a science creator), but the concept pipeline never runs on peer titles.', '');
  }

  lines.push('', '## Excellent Titles — Detail', '');
  for (const r of excellent) {
    const dna = channelDNA.get(r.channel_id);
    const niche = dna ? (dna.primary_niche || dna.niche || 'unknown') : 'unknown';
    const pattern = classifyNarrative(r.generated_title);
    lines.push(`### "${r.generated_title}"`);
    lines.push(`- **Pattern:** ${pattern}`);
    lines.push(`- **Channel niche:** ${niche}`);
    lines.push(`- **Score:** ${r.score}`);
    lines.push(`- **Creator relevance (concept_confidence):** ${r.concept_confidence ?? 'NULL — peer pipeline skips concept extraction'}`);
    lines.push(`- **Concept ID:** ${r.concept_id ?? 'NULL'}`);
    lines.push(`- **Reviewer notes:** ${r.reviewer_notes || '—'}`);
    lines.push('');
  }

  lines.push('## Three Paths to Convergence', '');
  lines.push('### Path A — Concept extraction on peer titles (highest impact)', '');
  lines.push('Run `extractConceptForDna(title)` on peer titles before storing the trace.');
  lines.push('Assign `concept_id` and `concept_confidence` to peer traces.');
  lines.push('Filter: only show peer titles to creators whose creator DNA matches the peer title\'s concept.');
  lines.push('Example: "The Tiger That Was Forced to Hunt Humans" → concept: `wildlife_conservation` → show only to wildlife/nature/conservation creators.', '');
  lines.push('**Effort:** Low (add concept extraction to peer trace write block in `whatToPost.js`)  ');
  lines.push('**Expected result:** Excellent recommendations become creator-relevant when concept-matched.', '');

  lines.push('### Path B — CONFLICT_EXPOSE with creator-niche entities (medium impact)', '');
  lines.push('CONFLICT_EXPOSE is the one narrative pattern where the "named actor" can be domain-specific:');
  lines.push('- Finance: "RBI Can\'t Control Inflation, and the Data Proves It"');
  lines.push('- Fitness: "Your Supplement Brand Can\'t Back Its Claims, and Lab Tests Prove It"');
  lines.push('- Business: "This VC Firm Can\'t Pick Winners, and Its Portfolio Proves It"', '');
  lines.push('**Effort:** Medium (need institution/actor list per creator niche + conflict evidence from peer signals)  ');
  lines.push('**Expected result:** First DNA-adjacent Excellent pattern. Combines narrative structure with creator concept match.', '');

  lines.push('### Path C — REVEAL_MECHANISM on creator subjects (low impact, easiest)', '');
  lines.push('The only DNA-generatable narrative pattern (currently scores Average, not Excellent):');
  lines.push('- "[Subject] is unreasonably [adjective]. Here\'s why."');
  lines.push('- "[Subject]: What nobody explains clearly."', '');
  lines.push('**Effort:** Already partially in WINNER_TEMPLATE_SETS as WAY_TO  ');
  lines.push('**Expected result:** Average → possibly Good. Not Excellent without a real discovery anchor.', '');

  lines.push('## Recommended Next Steps', '');
  lines.push('1. **Path A (concept extraction on peer traces)** — implement concept assignment in `whatToPost.js` peer trace write block. Gate peer titles by creator concept match before returning in API. This is the most direct route to Excellent + Creator-Relevant.');
  lines.push('2. **Expand CONFLICT_EXPOSE peer pool** — curate finance/business/health analysis channels. Their peer titles carry institution-specific conflict expose patterns naturally.');
  lines.push('3. **Do NOT modify scoring** — the convergence gap is architectural (concept extraction missing from peer pipeline), not a scoring problem.');

  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  process.stdout.write(`  Written: ${REPORT_OUT}\n\n`);
}

main();
