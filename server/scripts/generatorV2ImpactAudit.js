'use strict';

/**
 * Generator V2 Impact Audit — Phase 1
 *
 * Compares V1 generation (pre-2026-06-14) against V2 generation on:
 *   - GENERIC share (using title pattern detection)
 *   - Positive rate (from gold set labels)
 *   - Structure score (avg across matched traces)
 *   - Creator relevance rate (concept_confidence >= 0.55)
 *   - Concept coverage (concept_id not null)
 *
 * V2 launched 2026-06-14 with:
 *   - WINNER_TEMPLATE_SETS replacing per-family templates
 *   - Phase 3 creator relevance gate (concept_confidence < 0.55 → skip)
 *   - generic family suppressed
 *   - angle_gap hidden from API
 *
 * Usage: node generatorV2ImpactAudit.js
 *
 * Wait condition: needs 1000+ V2 traces (rec_source = dna_original_bets,
 * created_at >= '2026-06-14'). Will exit early with progress if not ready.
 */

const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const { recommendationStructureScore } = require('./recommendationStructureScore');

const DB_PATH   = path.resolve(__dirname, '../data/scoring.db');
const V2_CUTOFF = '2026-06-14';
const V2_MIN    = 1000;

// ── Template detectors (mirrors genericTemplateRetirementReport.js) ───────────
const TEMPLATE_DETECTORS = {
  DISH_TECHNIQUE: t => /\b(biryani|vada pav|dosa|noodles|pasta|pizza|burger|sushi|kebab|curry|roti|naan|idli|samosa|paneer|chicken|mutton|fish|egg|asmr|cake|cookie|brownie|bread|coffee|milkshake|smoothie)\b/i.test(t) || /\bcan you make.*at home\b/i.test(t),
  WAY_TO:         t => /^(how |the way |a way to |why it matters|what nobody|the reason|what you need|the best way)/i.test(t) || /\b(how to|way to|the best way|what every|a way)\b/i.test(t),
  CHECKLIST_FORMAT: t => /\b(checklist|guide|tips?|routine|plan|framework)\s+(for|to)\b/i.test(t) || /\ba (practical|honest|quick|simple)\s+(checklist|guide|tips?)/i.test(t),
  MISTAKE_BEHIND: t => /\b(mistake|error|problem|flaw|trap|pitfall|wrong|hidden cost|beginner mistake|common mistake|get wrong|gets wrong|getting wrong)\b/i.test(t),
  COLON_EXPLAINER: t => /^[^:]+:\s+.{10,}$/i.test(t) && !/^(mistake|how|what|why|the trap|the mistake|the beginner|can you make)\b/i.test(t),
  COLON_VARIANT:  t => /^[^:]+:\s+.{5,10}$/i.test(t),
  GENERIC_HOOK:   t => /\b(check this|see this)\s*$/i.test(t),
};

function classifyTitle(title) {
  const t = String(title || '');
  if (TEMPLATE_DETECTORS.DISH_TECHNIQUE(t)) return 'DISH_TECHNIQUE';
  if (TEMPLATE_DETECTORS.WAY_TO(t))         return 'WAY_TO';
  if (TEMPLATE_DETECTORS.CHECKLIST_FORMAT(t)) return 'CHECKLIST_FORMAT';
  if (TEMPLATE_DETECTORS.MISTAKE_BEHIND(t)) return 'MISTAKE_BEHIND';
  if (TEMPLATE_DETECTORS.COLON_EXPLAINER(t)) return 'COLON_EXPLAINER';
  if (TEMPLATE_DETECTORS.COLON_VARIANT(t))  return 'COLON_VARIANT';
  if (TEMPLATE_DETECTORS.GENERIC_HOOK(t))   return 'GENERIC_HOOK';
  return 'GENERIC';
}

function isWinnerTemplate(cls) {
  return ['DISH_TECHNIQUE', 'WAY_TO', 'CHECKLIST_FORMAT', 'MISTAKE_BEHIND'].includes(cls);
}

function pct(num, den) {
  if (!den) return 'N/A';
  return (num / den * 100).toFixed(1) + '%';
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // ── Count V2 traces ───────────────────────────────────────────────────────
  const v2Count = db.prepare(
    "SELECT COUNT(*) as n FROM wtp_generation_traces WHERE rec_source='dna_original_bets' AND DATE(created_at) >= ?"
  ).get(V2_CUTOFF).n;

  const v1Count = db.prepare(
    "SELECT COUNT(*) as n FROM wtp_generation_traces WHERE rec_source='dna_original_bets' AND DATE(created_at) < ?"
  ).get(V2_CUTOFF).n;

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Generator V2 Impact Audit\n');
  process.stdout.write(`  V2 cutoff: ${V2_CUTOFF} | V1 traces: ${v1Count} | V2 traces: ${v2Count}\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  if (v2Count < V2_MIN) {
    process.stdout.write(`  ⏳ NOT READY: V2 has ${v2Count}/${V2_MIN} required traces.\n`);
    process.stdout.write(`  Re-run after ${V2_MIN - v2Count} more DNA bets are generated via the server.\n\n`);
    process.stdout.write('  V2 changes to validate when ready:\n');
    process.stdout.write('    • GENERIC share target:        < 20%  (V1 baseline: 47.3%)\n');
    process.stdout.write('    • Winner template share:       > 50%  (V1 baseline: 52.7%)\n');
    process.stdout.write('    • Creator relevance rate:      > 70%  (concept_confidence ≥ 0.55)\n');
    process.stdout.write('    • Concept coverage:            > 95%  (concept_id not null)\n');
    process.stdout.write('    • Structure score avg:         > 30   (V1 gold avg: 54.6 winners / 5.5 losers)\n');
    process.stdout.write('\n  V2 features:\n');
    process.stdout.write('    • buildWinnerTemplateCandidates() routes by WINNER_TEMPLATE_SETS first\n');
    process.stdout.write('    • Phase 3 gate: concept_confidence < 0.55 AND NOT boosted → skip subject\n');
    process.stdout.write('    • generic family: buildFamilyCandidates returns [] immediately\n');
    process.stdout.write('    • angle_gap: completely hidden from API (traces still written)\n');
    process.stdout.write('    • FAMILY_TEMPLATES fixed: conversation_spiritual, general_education,\n');
    process.stdout.write('      spiritual_teaching, conversation_finance, conversation_business, tech_review\n\n');
    db.close();
    return;
  }

  // ── Load V1 and V2 traces ─────────────────────────────────────────────────
  const v1Rows = db.prepare(
    "SELECT generated_title, concept_id, concept_confidence, family FROM wtp_generation_traces WHERE rec_source='dna_original_bets' AND DATE(created_at) < ? AND generated_title IS NOT NULL"
  ).all(V2_CUTOFF);

  const v2Rows = db.prepare(
    "SELECT generated_title, concept_id, concept_confidence, family FROM wtp_generation_traces WHERE rec_source='dna_original_bets' AND DATE(created_at) >= ? AND generated_title IS NOT NULL"
  ).all(V2_CUTOFF);

  // ── Load gold set labels for V1/V2 rows (joined by generated_title) ────────
  const goldByTitle = new Map();
  const goldRows = db.prepare(
    "SELECT generated_title, human_label FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL AND generated_title IS NOT NULL"
  ).all();
  for (const r of goldRows) {
    goldByTitle.set(r.generated_title, r.human_label);
  }

  db.close();

  // ── Compute metrics for a set of traces ──────────────────────────────────
  function computeMetrics(rows, label) {
    let generic = 0, winner = 0, colon = 0;
    let creatorRelevant = 0, hasConceptId = 0;
    const structureScores = [];
    let goldPositive = 0, goldLabeled = 0;

    for (const row of rows) {
      const cls = classifyTitle(row.generated_title);
      if (cls === 'GENERIC' || cls === 'GENERIC_HOOK') generic++;
      else if (isWinnerTemplate(cls)) winner++;
      else colon++;

      if ((row.concept_confidence || 0) >= 0.55) creatorRelevant++;
      if (row.concept_id) hasConceptId++;

      const { score } = recommendationStructureScore(row.generated_title);
      structureScores.push(score);

      const goldLabel = goldByTitle.get(row.generated_title);
      if (goldLabel) {
        goldLabeled++;
        if (goldLabel === 'Excellent' || goldLabel === 'Good') goldPositive++;
      }
    }

    const n = rows.length;
    return {
      label,
      n,
      generic_share: pct(generic, n),
      winner_share: pct(winner, n),
      colon_share: pct(colon, n),
      creator_relevance_rate: pct(creatorRelevant, n),
      concept_coverage: pct(hasConceptId, n),
      structure_score_avg: avg(structureScores).toFixed(1),
      gold_positive_rate: goldLabeled ? pct(goldPositive, goldLabeled) : 'no gold labels',
      gold_labeled: goldLabeled,
    };
  }

  const v1m = computeMetrics(v1Rows, 'V1 (pre-' + V2_CUTOFF + ')');
  const v2m = computeMetrics(v2Rows, 'V2 (post-' + V2_CUTOFF + ')');

  // ── Print comparison ──────────────────────────────────────────────────────
  const metrics = [
    ['Traces', v1m.n, v2m.n, null],
    ['GENERIC share', v1m.generic_share, v2m.generic_share, 'lower'],
    ['Winner template share', v1m.winner_share, v2m.winner_share, 'higher'],
    ['Creator relevance rate', v1m.creator_relevance_rate, v2m.creator_relevance_rate, 'higher'],
    ['Concept coverage', v1m.concept_coverage, v2m.concept_coverage, 'higher'],
    ['Structure score avg', v1m.structure_score_avg, v2m.structure_score_avg, 'higher'],
    ['Positive rate (gold)', v1m.gold_positive_rate, v2m.gold_positive_rate, 'higher'],
  ];

  process.stdout.write('  Metric                        V1              V2              Target\n');
  process.stdout.write('  ' + '─'.repeat(70) + '\n');
  for (const [metric, v1val, v2val, dir] of metrics) {
    const arrow = dir ? (dir === 'lower' ? '↓' : '↑') : '';
    process.stdout.write(`  ${metric.padEnd(30)} ${String(v1val).padEnd(16)} ${String(v2val).padEnd(16)} ${arrow}\n`);
  }

  process.stdout.write('\n  V1 targets vs actuals:\n');
  process.stdout.write(`    GENERIC < 20%:    V2 actual ${v2m.generic_share}\n`);
  process.stdout.write(`    Winner > 50%:     V2 actual ${v2m.winner_share}\n`);
  process.stdout.write(`    Relevance > 70%:  V2 actual ${v2m.creator_relevance_rate}\n`);
  process.stdout.write(`    Coverage > 95%:   V2 actual ${v2m.concept_coverage}\n`);
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');
}

main();
