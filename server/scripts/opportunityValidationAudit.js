'use strict';

/**
 * Phase 3 — Opportunity Validation Audit
 *
 * Compares extracted opportunity_id against human quality labels to measure:
 *
 *   - opportunity_accuracy:   does the opportunity match the actual content?
 *   - opportunity_usefulness: do recommendations with opportunities score higher?
 *   - opportunity_specificity_gain: does a specific opportunity (non-default) correlate
 *                                   with better quality than a concept-level default?
 *   - reviewer_agreement:     % of Excellent+Good rows that have a valid specific opportunity
 *
 * Target: reviewer agreement >80% (opportunity accuracy validated)
 *
 * Usage:
 *   node opportunityValidationAudit.js [--verbose]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    timeout:  60000,
  });
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function mean(arr)  { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

const LABEL_SCORE = { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 };
const POSITIVE    = new Set(['Excellent', 'Good']);
const NEGATIVE    = new Set(['Poor', 'Garbage']);
const ORDER       = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];

function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');

  // Join labelled reviews with trace opportunity data
  const rows = db.prepare(`
    SELECT
      r.id,
      r.batch_id,
      r.rec_source,
      r.generated_title,
      r.concept_id       AS r_concept_id,
      r.concept_label    AS r_concept_label,
      r.human_label,
      r.reviewer_notes,
      t.opportunity_id,
      t.opportunity_label,
      t.opportunity_confidence,
      t.concept_id       AS t_concept_id
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE r.human_label IS NOT NULL
    ORDER BY r.id
  `).all();

  const n             = rows.length;
  const withTrace     = rows.filter(r => r.opportunity_id !== undefined);
  const withOpp       = rows.filter(r => r.opportunity_id != null);
  const withSpecific  = rows.filter(r => r.opportunity_id != null && !r.opportunity_id.startsWith('general_'));
  const withDefault   = rows.filter(r => r.opportunity_id != null && r.opportunity_id.startsWith('general_'));
  const noOpp         = rows.filter(r => r.opportunity_id == null);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 3 — Opportunity Validation Audit');
  console.log(`  Labelled rows: ${n}   With trace match: ${withTrace.length}   With opportunity: ${withOpp.length}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── 1. Coverage ───────────────────────────────────────────────────────────────
  console.log('── 1. OPPORTUNITY COVERAGE IN GOLD SET ───────────────────────');
  console.log(`  Rows with opportunity_id:      ${withOpp.length} / ${n} (${pct(withOpp.length, n)}%)`);
  console.log(`  Rows with specific opportunity: ${withSpecific.length} / ${n} (${pct(withSpecific.length, n)}%)`);
  console.log(`  Rows with default (general_*):  ${withDefault.length} / ${n} (${pct(withDefault.length, n)}%)`);
  console.log(`  Rows with NO opportunity:       ${noOpp.length} / ${n} (${pct(noOpp.length, n)}%)`);

  // ── 2. Usefulness — do labelled Excellent/Good have opportunities? ────────────
  console.log('\n── 2. OPPORTUNITY USEFULNESS ─────────────────────────────────');
  const positive = rows.filter(r => POSITIVE.has(r.human_label));
  const negative = rows.filter(r => NEGATIVE.has(r.human_label));
  const posWithOpp   = positive.filter(r => r.opportunity_id != null);
  const posWithSpec  = positive.filter(r => r.opportunity_id != null && !r.opportunity_id.startsWith('general_'));
  const negWithOpp   = negative.filter(r => r.opportunity_id != null);
  const negWithSpec  = negative.filter(r => r.opportunity_id != null && !r.opportunity_id.startsWith('general_'));

  console.log('  Positive (Excellent+Good):');
  console.log(`    With any opportunity:       ${posWithOpp.length} / ${positive.length} (${pct(posWithOpp.length, positive.length)}%)`);
  console.log(`    With specific opportunity:  ${posWithSpec.length} / ${positive.length} (${pct(posWithSpec.length, positive.length)}%)`);
  console.log('  Negative (Poor+Garbage):');
  console.log(`    With any opportunity:       ${negWithOpp.length} / ${negative.length} (${pct(negWithOpp.length, negative.length)}%)`);
  console.log(`    With specific opportunity:  ${negWithSpec.length} / ${negative.length} (${pct(negWithSpec.length, negative.length)}%)`);

  // Uplift: does having an opportunity correlate with better quality?
  const avgScoreWithOpp   = mean(withOpp.map(r => LABEL_SCORE[r.human_label] || 0));
  const avgScoreNoOpp     = mean(noOpp.map(r => LABEL_SCORE[r.human_label] || 0));
  const avgScoreSpecific  = mean(withSpecific.map(r => LABEL_SCORE[r.human_label] || 0));
  const avgScoreDefault   = mean(withDefault.map(r => LABEL_SCORE[r.human_label] || 0));

  console.log('\n  Quality score (5=Excellent, 1=Garbage):');
  console.log(`    With opportunity:        avg = ${avgScoreWithOpp.toFixed(2)}`);
  console.log(`    Without opportunity:     avg = ${avgScoreNoOpp.toFixed(2)}`);
  console.log(`    With specific opp:       avg = ${avgScoreSpecific.toFixed(2)}`);
  console.log(`    With default (general_): avg = ${avgScoreDefault.toFixed(2)}`);
  const uplift = avgScoreWithOpp - avgScoreNoOpp;
  console.log(`    Opportunity uplift:      ${uplift > 0 ? '+' : ''}${uplift.toFixed(2)} pts — ${uplift > 0.3 ? 'POSITIVE signal' : uplift < -0.1 ? 'NEGATIVE — opportunity assignment is not predictive' : 'NEGLIGIBLE'}`);

  // ── 3. Opportunity accuracy per opportunity_id ─────────────────────────────
  console.log('\n── 3. OPPORTUNITY ACCURACY BY OPPORTUNITY_ID ─────────────────');
  const byOppId = {};
  for (const r of withOpp) {
    const id = r.opportunity_id;
    if (!byOppId[id]) byOppId[id] = { counts: {}, total: 0 };
    byOppId[id].counts[r.human_label] = (byOppId[id].counts[r.human_label] || 0) + 1;
    byOppId[id].total++;
  }

  const oppRanked = Object.entries(byOppId)
    .map(([id, d]) => {
      const pos = (d.counts.Excellent || 0) + (d.counts.Good || 0);
      const neg = (d.counts.Poor || 0) + (d.counts.Garbage || 0);
      const avg = mean(ORDER.map(l => (d.counts[l] || 0) * (LABEL_SCORE[l] || 0))) / (d.total / d.total);
      const score = mean(
        Object.entries(d.counts).flatMap(([l, cnt]) => Array(cnt).fill(LABEL_SCORE[l] || 0))
      );
      return { id, ...d, pos, neg, posRate: pos / d.total, score };
    })
    .sort((a, b) => b.posRate - a.posRate || b.total - a.total);

  console.log('  Opportunity ID                 n    pos%   neg%   avg_quality  validated?');
  for (const o of oppRanked) {
    const isDefault  = o.id.startsWith('general_');
    const tag        = isDefault ? '[default]' : '[specific]';
    const validated  = o.posRate >= 0.80 ? '✓ YES' : o.posRate >= 0.50 ? '~ PARTIAL' : '✗ NO';
    console.log(`  ${tag.padEnd(10)} ${o.id.padEnd(30)} ${String(o.total).padStart(3)}  ${pct(o.pos, o.total).padStart(5)}%  ${pct(o.neg, o.total).padStart(5)}%  ${o.score.toFixed(2)}  ${validated}`);
  }

  // ── 4. Specificity gain — specific vs default for same concept ────────────────
  console.log('\n── 4. SPECIFICITY GAIN (specific vs default fallback) ─────────');
  const conceptGroups = {};
  for (const r of withOpp) {
    const c = r.t_concept_id || r.r_concept_id || 'unknown';
    if (!conceptGroups[c]) conceptGroups[c] = { specific: [], default: [] };
    if (r.opportunity_id.startsWith('general_')) {
      conceptGroups[c].default.push(r);
    } else {
      conceptGroups[c].specific.push(r);
    }
  }
  let gainCount = 0, gainTotal = 0;
  for (const [concept, g] of Object.entries(conceptGroups)) {
    if (g.specific.length >= 2 && g.default.length >= 2) {
      const specAvg = mean(g.specific.map(r => LABEL_SCORE[r.human_label] || 0));
      const defAvg  = mean(g.default.map(r => LABEL_SCORE[r.human_label] || 0));
      const gain    = specAvg - defAvg;
      if (Math.abs(gain) > 0.1) gainTotal++;
      if (gain > 0.1) gainCount++;
      console.log(`  ${concept.padEnd(28)} specific(n=${g.specific.length}) avg=${specAvg.toFixed(2)}  default(n=${g.default.length}) avg=${defAvg.toFixed(2)}  gain=${gain > 0 ? '+' : ''}${gain.toFixed(2)}`);
    }
  }
  if (gainTotal > 0) {
    console.log(`\n  Specificity improvement in ${gainCount}/${gainTotal} concepts with enough data.`);
  } else {
    console.log('  Not enough split data (need ≥2 specific AND ≥2 default per concept) to measure gain.');
  }

  // ── 5. Reviewer agreement (the key target metric) ─────────────────────────────
  console.log('\n── 5. REVIEWER AGREEMENT TARGET (>80%) ──────────────────────');
  // Definition: among Excellent+Good rows that have an opportunity assigned,
  // what % have a SPECIFIC (non-default, confidence ≥ 0.70) opportunity?
  const posWithConfidentOpp = positive.filter(r =>
    r.opportunity_id != null &&
    !r.opportunity_id.startsWith('general_') &&
    (r.opportunity_confidence || 0) >= 0.70
  );
  const reviewerAgreement = positive.length > 0
    ? (posWithConfidentOpp.length / positive.length * 100).toFixed(1)
    : null;

  console.log(`  Positive rows (Excellent+Good):          ${positive.length}`);
  console.log(`  With specific opp (conf ≥ 0.70):         ${posWithConfidentOpp.length}`);
  console.log(`  Reviewer agreement:                       ${reviewerAgreement ?? 'N/A'}%`);
  console.log(`  Target: >80%  →  ${parseFloat(reviewerAgreement) >= 80 ? 'PASS ✓' : `FAIL ✗  (${reviewerAgreement}%)`}`);

  // ── 6. Opportunities validated for ranking use ────────────────────────────────
  console.log('\n── 6. OPPORTUNITIES VALIDATED FOR RANKING (pos ≥ 80%) ────────');
  const validated     = oppRanked.filter(o => o.posRate >= 0.80 && o.total >= 3 && !o.id.startsWith('general_'));
  const notValidated  = oppRanked.filter(o => o.posRate < 0.50 && o.total >= 3);

  if (validated.length > 0) {
    console.log('  ✓ Validated opportunities (can be used to boost ranking):');
    for (const o of validated) {
      console.log(`    ${o.id.padEnd(32)} pos=${pct(o.pos, o.total)}%  n=${o.total}`);
    }
  } else {
    console.log('  ✗ No opportunities meet the ≥80% positive AND ≥3 rows threshold yet.');
  }

  if (notValidated.length > 0) {
    console.log('\n  ✗ Poor-performing opportunities (should NOT influence ranking):');
    for (const o of notValidated.slice(0, 8)) {
      console.log(`    ${o.id.padEnd(32)} pos=${pct(o.pos, o.total)}%  neg=${pct(o.neg, o.total)}%  n=${o.total}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  OPPORTUNITY VALIDATION VERDICT');
  console.log(`  Coverage in gold set:      ${pct(withOpp.length, n)}%`);
  console.log(`  Opportunity uplift:        ${uplift > 0 ? '+' : ''}${uplift.toFixed(2)} quality pts`);
  console.log(`  Reviewer agreement:        ${reviewerAgreement ?? 'N/A'}% (target >80%)`);
  console.log(`  Validated opportunities:   ${validated.length}`);
  const agreementPass = parseFloat(reviewerAgreement) >= 80;
  console.log(`\n  Status: ${agreementPass ? 'PASS ✓ — Opportunities validated for ranking use' : 'NOT VALIDATED — collect more labels or expand taxonomy before using opportunities in ranking'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  db.close();
}

main();
