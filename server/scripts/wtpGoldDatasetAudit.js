'use strict';

/**
 * Phase 2 — Gold Dataset Audit
 *
 * Analyses the 200 labelled rows in wtp_human_quality_reviews to answer:
 *
 *   - Label distribution overall and per source
 *   - Which concepts generate Excellent / Good recommendations?
 *   - Which concepts generate Garbage / Poor recommendations?
 *   - Which DNA families overperform? Underperform?
 *   - Does dna_affinity_score correlate with label quality?
 *   - What does the score/rank system get right and wrong?
 *
 * Usage:
 *   node wtpGoldDatasetAudit.js [--verbose]
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

// Numeric quality score for arithmetic (Excellent=5 → Garbage=1)
const LABEL_SCORE = { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 };
const ORDER = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];

function qualityScore(label) { return LABEL_SCORE[label] || 0; }
function labelBar(counts, total, width = 25) {
  return ORDER.map(l => {
    const n   = counts[l] || 0;
    const len = Math.round(n / total * width);
    return len > 0 ? `${'█'.repeat(len)}(${l[0]}${n})` : '';
  }).filter(Boolean).join(' ');
}

function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');

  const rows = db.prepare(`
    SELECT id, batch_id, rec_source, family, archetype,
           generated_title, concept_id, concept_label, concept_confidence,
           dna_affinity_score, score, human_label, reviewer_notes
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL
    ORDER BY id
  `).all();

  const n = rows.length;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Phase 2 — Gold Dataset Audit');
  console.log(`  Labelled rows: ${n}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── 1. Overall label distribution ─────────────────────────────────────────────
  const overallCounts = {};
  for (const r of rows) overallCounts[r.human_label] = (overallCounts[r.human_label] || 0) + 1;
  const positiveN = (overallCounts.Excellent || 0) + (overallCounts.Good || 0);
  const negativeN = (overallCounts.Poor || 0) + (overallCounts.Garbage || 0);
  const avgQuality = mean(rows.map(r => qualityScore(r.human_label)));

  console.log('── 1. OVERALL LABEL DISTRIBUTION ─────────────────────────────');
  for (const lbl of ORDER) {
    const cnt = overallCounts[lbl] || 0;
    const bar = '█'.repeat(Math.round(cnt / n * 30));
    console.log(`  ${lbl.padEnd(10)} ${String(cnt).padStart(3)}  ${pct(cnt, n).padStart(5)}%  ${bar}`);
  }
  console.log(`\n  Positive (Excellent+Good): ${positiveN} (${pct(positiveN, n)}%)`);
  console.log(`  Negative (Poor+Garbage):   ${negativeN} (${pct(negativeN, n)}%)`);
  console.log(`  Mean quality score:         ${avgQuality.toFixed(2)} / 5.00`);

  // ── 2. Distribution by source ─────────────────────────────────────────────────
  console.log('\n── 2. LABEL DISTRIBUTION BY SOURCE ────────────────────────────');
  const bySrc = {};
  for (const r of rows) {
    const s = r.rec_source || 'unknown';
    if (!bySrc[s]) bySrc[s] = { counts: {}, scores: [] };
    bySrc[s].counts[r.human_label] = (bySrc[s].counts[r.human_label] || 0) + 1;
    bySrc[s].scores.push(qualityScore(r.human_label));
  }
  for (const [src, data] of Object.entries(bySrc).sort((a, b) => b[1].scores.length - a[1].scores.length)) {
    const total = data.scores.length;
    const avg   = mean(data.scores).toFixed(2);
    const pos   = (data.counts.Excellent || 0) + (data.counts.Good || 0);
    console.log(`  ${src.padEnd(24)} n=${total.toString().padStart(3)}  avg=${avg}  pos=${pct(pos, total).padStart(5)}%  ${labelBar(data.counts, total)}`);
  }

  // ── 3. Distribution by batch ──────────────────────────────────────────────────
  console.log('\n── 3. LABEL DISTRIBUTION BY BATCH ─────────────────────────────');
  const byBatch = {};
  for (const r of rows) {
    if (!byBatch[r.batch_id]) byBatch[r.batch_id] = { counts: {}, scores: [] };
    byBatch[r.batch_id].counts[r.human_label] = (byBatch[r.batch_id].counts[r.human_label] || 0) + 1;
    byBatch[r.batch_id].scores.push(qualityScore(r.human_label));
  }
  for (const [batch, data] of Object.entries(byBatch)) {
    const total = data.scores.length;
    const avg   = mean(data.scores).toFixed(2);
    const pos   = (data.counts.Excellent || 0) + (data.counts.Good || 0);
    console.log(`  ${batch.padEnd(20)} n=${total.toString().padStart(3)}  avg=${avg}  pos=${pct(pos, total).padStart(5)}%`);
    for (const lbl of ORDER) {
      if (data.counts[lbl]) {
        console.log(`    ${lbl.padEnd(10)} ${data.counts[lbl].toString().padStart(3)}  (${pct(data.counts[lbl], total)}%)`);
      }
    }
  }

  // ── 4. Concepts that generate quality ─────────────────────────────────────────
  console.log('\n── 4. CONCEPT QUALITY ANALYSIS ───────────────────────────────');
  const byConcept = {};
  for (const r of rows) {
    const c = r.concept_id || 'NO_CONCEPT';
    if (!byConcept[c]) byConcept[c] = { counts: {}, scores: [], label: r.concept_label };
    byConcept[c].counts[r.human_label] = (byConcept[c].counts[r.human_label] || 0) + 1;
    byConcept[c].scores.push(qualityScore(r.human_label));
  }
  const conceptRanked = Object.entries(byConcept)
    .map(([id, d]) => ({ id, ...d, avg: mean(d.scores), total: d.scores.length }))
    .sort((a, b) => b.avg - a.avg);

  console.log('  Concepts ranked by mean quality score (5=Excellent, 1=Garbage):');
  console.log('  Concept ID               n    avg    Positive   Negative');
  for (const c of conceptRanked) {
    const pos = (c.counts.Excellent || 0) + (c.counts.Good || 0);
    const neg = (c.counts.Poor || 0) + (c.counts.Garbage || 0);
    const verdict = c.avg >= 4.0 ? '✓ overperform'
                  : c.avg <= 2.0 ? '✗ underperform'
                  : '  neutral';
    console.log(`  ${c.id.padEnd(25)} ${String(c.total).padStart(3)}  ${c.avg.toFixed(2)}  ${pct(pos, c.total).padStart(5)}%  ${pct(neg, c.total).padStart(5)}%  ${verdict}`);
  }

  // ── 5. DNA family overperformers / underperformers ───────────────────────────
  console.log('\n── 5. DNA FAMILY QUALITY ANALYSIS ────────────────────────────');
  const byFamily = {};
  for (const r of rows) {
    const f = r.family || 'NO_FAMILY';
    if (!byFamily[f]) byFamily[f] = { counts: {}, scores: [] };
    byFamily[f].counts[r.human_label] = (byFamily[f].counts[r.human_label] || 0) + 1;
    byFamily[f].scores.push(qualityScore(r.human_label));
  }
  const familyRanked = Object.entries(byFamily)
    .map(([f, d]) => ({ f, ...d, avg: mean(d.scores), total: d.scores.length }))
    .filter(d => d.total >= 3)
    .sort((a, b) => b.avg - a.avg);

  for (const fam of familyRanked) {
    const pos = (fam.counts.Excellent || 0) + (fam.counts.Good || 0);
    const verdict = fam.avg >= 4.0 ? '✓ overperform' : fam.avg <= 2.0 ? '✗ underperform' : '  neutral';
    console.log(`  ${fam.f.padEnd(22)} n=${String(fam.total).padStart(3)}  avg=${fam.avg.toFixed(2)}  pos=${pct(pos, fam.total)}%  ${verdict}`);
  }
  const noFamily = byFamily['NO_FAMILY'];
  if (noFamily) {
    const pos = (noFamily.counts.Excellent || 0) + (noFamily.counts.Good || 0);
    console.log(`  NO_FAMILY (peer/angle)  n=${String(noFamily.total).padStart(3)}  avg=${mean(noFamily.scores).toFixed(2)}  pos=${pct(pos, noFamily.total)}%  (peer/angle-gap, no DNA)`);
  }

  // ── 6. Score vs quality correlation ──────────────────────────────────────────
  console.log('\n── 6. SCORE vs QUALITY CORRELATION ────────────────────────────');
  const byLabel = {};
  for (const r of rows) {
    if (!byLabel[r.human_label]) byLabel[r.human_label] = [];
    const s = r.dna_affinity_score !== null ? parseFloat(r.dna_affinity_score) : null;
    if (s !== null) byLabel[r.human_label].push(s);
  }
  console.log('  Human label → avg system score (higher score = ranked higher by engine):');
  for (const lbl of ORDER) {
    const scores = byLabel[lbl] || [];
    if (scores.length) {
      console.log(`  ${lbl.padEnd(10)} avg_score=${mean(scores).toFixed(1).padStart(5)}  n=${scores.length}`);
    }
  }
  const excellentAvg = mean(byLabel.Excellent || []);
  const garbageAvg   = mean(byLabel.Garbage   || []);
  const diff         = excellentAvg - garbageAvg;
  console.log(`\n  Score gap (Excellent avg - Garbage avg): ${diff > 0 ? '+' : ''}${diff.toFixed(1)}`);
  if (Math.abs(diff) < 3) {
    console.log('  ⚠ FINDING: Score barely separates Excellent from Garbage — scoring system is not quality-aware.');
  } else if (diff > 0) {
    console.log('  ✓ Score correctly ranks better content higher on average.');
  } else {
    console.log('  ✗ Score is INVERSELY correlated — worse content is ranked higher.');
  }

  // ── 7. Top opportunities by quality ──────────────────────────────────────────
  // Join with traces to get opportunity data
  const traceRows = db.prepare(`
    SELECT r.human_label, t.opportunity_id, t.opportunity_label, t.opportunity_confidence
    FROM wtp_human_quality_reviews r
    JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE r.human_label IS NOT NULL
      AND r.trace_id IS NOT NULL
      AND t.opportunity_id IS NOT NULL
  `).all();

  if (traceRows.length > 0) {
    console.log('\n── 7. OPPORTUNITY QUALITY ANALYSIS ────────────────────────────');
    const byOpp = {};
    for (const r of traceRows) {
      const o = r.opportunity_id;
      if (!byOpp[o]) byOpp[o] = { counts: {}, scores: [], label: r.opportunity_label };
      byOpp[o].counts[r.human_label] = (byOpp[o].counts[r.human_label] || 0) + 1;
      byOpp[o].scores.push(qualityScore(r.human_label));
    }
    const oppRanked = Object.entries(byOpp)
      .map(([id, d]) => ({ id, ...d, avg: mean(d.scores), total: d.scores.length }))
      .filter(d => d.total >= 2)
      .sort((a, b) => b.avg - a.avg);

    console.log(`  Opportunities with quality data (${traceRows.length} rows with trace+label):`);
    for (const o of oppRanked.slice(0, 15)) {
      const pos = (o.counts.Excellent || 0) + (o.counts.Good || 0);
      console.log(`  ${o.id.padEnd(30)} n=${o.total}  avg=${o.avg.toFixed(2)}  pos=${pct(pos, o.total)}%`);
    }
  } else {
    console.log('\n── 7. OPPORTUNITY QUALITY ANALYSIS ────────────────────────────');
    console.log('  No trace_id matches found in wtp_generation_traces with opportunity data.');
    console.log('  (trace_id in human_quality_reviews does not link to the backfilled opportunity columns)');
  }

  // ── 8. Key findings ───────────────────────────────────────────────────────────
  console.log('\n── 8. KEY FINDINGS ───────────────────────────────────────────');

  // Best concept
  const bestConcept  = conceptRanked.find(c => c.id !== 'NO_CONCEPT' && c.total >= 5);
  const worstConcept = [...conceptRanked].reverse().find(c => c.id !== 'NO_CONCEPT' && c.total >= 5);
  if (bestConcept)  console.log(`  Best concept:   ${bestConcept.id} (avg ${bestConcept.avg.toFixed(2)}, ${pct((bestConcept.counts.Excellent || 0) + (bestConcept.counts.Good || 0), bestConcept.total)}% positive)`);
  if (worstConcept) console.log(`  Worst concept:  ${worstConcept.id} (avg ${worstConcept.avg.toFixed(2)}, ${pct((worstConcept.counts.Poor || 0) + (worstConcept.counts.Garbage || 0), worstConcept.total)}% negative)`);

  // Source quality ranking
  const srcRanked = Object.entries(bySrc)
    .map(([s, d]) => ({ s, avg: mean(d.scores), total: d.scores.length }))
    .sort((a, b) => b.avg - a.avg);
  console.log(`  Best source:    ${srcRanked[0]?.s} (avg ${srcRanked[0]?.avg.toFixed(2)})`);
  console.log(`  Worst source:   ${srcRanked[srcRanked.length - 1]?.s} (avg ${srcRanked[srcRanked.length - 1]?.avg.toFixed(2)})`);

  // Score discrimination
  console.log(`\n  Score discrimination: ${Math.abs(diff) < 3 ? 'NONE — score does not predict quality' : diff > 0 ? 'POSITIVE — higher score = better quality' : 'INVERTED — higher score = worse quality'}`);
  console.log(`  Positive recommendation rate: ${pct(positiveN, n)}% (target: >30%)`);

  // Stop-point check
  const posRate = positiveN / n;
  const goldComplete = n >= 100;
  console.log('\n── 9. STOP-POINT STATUS ──────────────────────────────────────');
  console.log(`  Gold dataset complete: ${goldComplete ? '✓' : '✗'} (${n}/200 labelled)`);
  console.log(`  Positive rate:        ${pct(positiveN, n)}% ${posRate >= 0.30 ? '✓' : '⚠ (low — quality problem)'}`);
  console.log(`  Next: Run Phase 3 (opportunityValidationAudit.js) to check opportunity accuracy`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (verbose) {
    // Print all Excellent rows
    const excellentRows = rows.filter(r => r.human_label === 'Excellent');
    console.log('  EXCELLENT recommendations:');
    for (const r of excellentRows) {
      const unique = !r.reviewer_notes?.includes('duplicate');
      if (unique) console.log(`    [${r.rec_source}] ${r.generated_title}`);
    }
    // Print a sample of Poor from DNA
    const dnaGood = rows.filter(r => r.rec_source === 'dna_original_bets' && r.human_label === 'Good');
    console.log(`\n  Good DNA bets (${dnaGood.length} unique+dup):`);
    const seenDna = new Set();
    for (const r of dnaGood) {
      if (!seenDna.has(r.generated_title)) {
        seenDna.add(r.generated_title);
        console.log(`    ${r.generated_title}`);
      }
    }
  }

  db.close();
}

main();
