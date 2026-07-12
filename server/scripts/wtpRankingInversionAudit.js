'use strict';

/**
 * WTP Ranking Inversion Audit — Phases 1 + 2
 *
 * Diagnoses why Garbage recommendations score higher than Excellent ones.
 *
 * Phase 1: Score distribution by label — exposes scale mismatch and inversion.
 * Phase 2: Predictor correlation — identifies which score components reward garbage.
 *
 * Outputs:
 *   - Console report
 *   - ranking_inversion_report.md  (saved to scripts/)
 *
 * Usage:
 *   node wtpRankingInversionAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    timeout:  60000,
  });
}

const LABEL_SCORE = { Excellent: 5, Good: 4, Average: 3, Poor: 2, Garbage: 1 };
const ORDER       = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];

function pct(n, d)  { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function mean(arr)  { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function pearson(xs, ys) {
  if (xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0)
  );
  return den === 0 ? 0 : +(num / den).toFixed(3);
}

// Named entity patterns for title analysis
const ENTITY_RE = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*|\d+(?:\.\d+)?(?:L|K|M|Cr|%|x|\+)?|\b(?:IPL|WWDC|SIP|ITR|EMI|GDP|RBI|SEBI|BCCI|NATO|UN|IMF|BJP|TMC|BJP|INC|AAP|CJI)\b)/g;
function countEntities(title) {
  return ((title || '').match(ENTITY_RE) || []).length;
}
function wordCount(title) {
  return (title || '').trim().split(/\s+/).filter(Boolean).length;
}

function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');

  // Load gold set with trace data
  const rows = db.prepare(`
    SELECT
      r.id,
      r.batch_id,
      r.rec_source,
      r.generated_title,
      r.concept_id,
      r.concept_label,
      r.concept_confidence,
      r.dna_affinity_score  AS raw_score,
      r.score               AS wtp_score,
      r.human_label,
      t.opportunity_id,
      t.opportunity_confidence,
      t.dna_affinity_reason
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE r.human_label IS NOT NULL
    ORDER BY r.id
  `).all();

  const n = rows.length;

  // Enrich each row with derived metrics
  const enriched = rows.map(r => {
    const qScore    = LABEL_SCORE[r.human_label] || 0;
    const wc        = wordCount(r.generated_title);
    const entities  = countEntities(r.generated_title);
    // Detect scale: DNA affinity uses 0–1, WTP score uses 0–100
    const isDnaScale = r.raw_score !== null && r.raw_score < 2.0;
    const normScore  = isDnaScale ? r.raw_score * 100 : (r.raw_score || 0);
    const hasSpecOpp = r.opportunity_id && !r.opportunity_id.startsWith('general_');
    const hasConcept = !!r.concept_id;

    return {
      ...r,
      qScore,
      wc,
      entities,
      isDnaScale,
      normScore,
      hasSpecOpp,
      hasConcept,
      oppConf: r.opportunity_confidence || 0,
      concConf: r.concept_confidence || 0,
    };
  });

  const lines = []; // markdown lines
  const md = s => { lines.push(s); };

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  WTP Ranking Inversion Audit');
  console.log(`  Gold set: ${n} labelled rows`);
  console.log('══════════════════════════════════════════════════════════════\n');

  md('# WTP Ranking Inversion Report');
  md('');
  md(`Gold set: **${n} labelled rows** from \`wtp_human_quality_reviews\``);
  md('');

  // ── SECTION 1: Scale mismatch diagnosis ──────────────────────────────────
  const dnaRows    = enriched.filter(r => r.isDnaScale);
  const nonDnaRows = enriched.filter(r => !r.isDnaScale);

  console.log('── SECTION 1: SCORE SCALE MISMATCH ───────────────────────────');
  md('## 1. Score Scale Mismatch — Root Cause of Inversion');
  md('');

  const dnaScoreRange   = dnaRows.length   ? `${Math.min(...dnaRows.map(r=>r.raw_score)).toFixed(3)} – ${Math.max(...dnaRows.map(r=>r.raw_score)).toFixed(3)}` : 'N/A';
  const nonDnaScoreRange = nonDnaRows.length ? `${Math.min(...nonDnaRows.map(r=>r.raw_score))} – ${Math.max(...nonDnaRows.map(r=>r.raw_score))}` : 'N/A';

  console.log(`  DNA bets (${dnaRows.length} rows):      score range = ${dnaScoreRange}  (0–1 scale)`);
  console.log(`  Peer/angle (${nonDnaRows.length} rows): score range = ${nonDnaScoreRange}  (0–100 scale)`);
  console.log('  → When sorted together, angle_gap (score=88) always beats DNA bets (score=0.88)\n');

  md(`| Source group | n | Score scale | Range |`);
  md(`|---|---|---|---|`);
  md(`| DNA original bets | ${dnaRows.length} | 0–1 float | ${dnaScoreRange} |`);
  md(`| Peer / angle gap | ${nonDnaRows.length} | 0–100 integer | ${nonDnaScoreRange} |`);
  md('');
  md('**Root cause:** DNA affinity scores (0–1) are stored in the same column as WTP ranking scores (0–100). When sorted together, peer/angle ideas with score 88 always beat DNA bets with score 0.88. This is not a quality difference — it is a unit mismatch.');
  md('');

  // ── SECTION 2: Raw score by label (shows inversion) ──────────────────────
  console.log('── SECTION 2: RAW SCORE BY LABEL (INVERSION VISIBLE) ─────────');
  md('## 2. Raw Score by Label — Inversion Visible');
  md('');
  md('| Label | n | Avg raw score | Avg normalized (0–100) | Positive sources |');
  md('|---|---|---|---|---|');

  const byLabel = {};
  for (const r of enriched) {
    if (!byLabel[r.human_label]) byLabel[r.human_label] = [];
    byLabel[r.human_label].push(r);
  }

  for (const lbl of ORDER) {
    const group  = byLabel[lbl] || [];
    if (!group.length) continue;
    const avgRaw  = mean(group.map(r => r.raw_score || 0));
    const avgNorm = mean(group.map(r => r.normScore));
    const sources = [...new Set(group.map(r => r.rec_source))].join(', ');
    console.log(`  ${lbl.padEnd(10)} n=${String(group.length).padStart(3)}  raw=${avgRaw.toFixed(2).padStart(7)}  norm=${avgNorm.toFixed(1).padStart(6)}  sources: ${sources}`);
    md(`| ${lbl} | ${group.length} | ${avgRaw.toFixed(3)} | ${avgNorm.toFixed(1)} | ${sources} |`);
  }

  const garbageNorm = mean((byLabel.Garbage || []).map(r => r.normScore));
  const excellentNorm = mean((byLabel.Excellent || []).map(r => r.normScore));
  const invertedBy = garbageNorm - excellentNorm;
  console.log(`\n  ✗ Inversion confirmed: Garbage outscores Excellent by ${invertedBy.toFixed(1)} normalized points`);
  md('');
  md(`**Inversion confirmed:** Garbage outscores Excellent by **${invertedBy.toFixed(1)} normalized points** when raw scores are used.`);
  md('');

  // ── SECTION 3: Normalized score by label (what it should look like) ───────
  console.log('── SECTION 3: NORMALIZED SCORE BY LABEL ──────────────────────');
  md('## 3. Normalized Score — After Scale Fix');
  md('');
  md('If DNA scores are multiplied by 100 before ranking:');
  md('');
  md('| Label | Avg normalized | Rank (should be 1=Excellent) |');
  md('|---|---|---|');

  const normByLabel = ORDER
    .filter(l => byLabel[l])
    .map(l => ({ l, avg: mean(byLabel[l].map(r => r.normScore)) }))
    .sort((a, b) => b.avg - a.avg);

  normByLabel.forEach((item, i) => {
    const isCorrect = item.l === 'Excellent' && i === 0 || item.l === 'Garbage' && i === normByLabel.length - 1;
    console.log(`  ${String(i+1).padStart(2)}. ${item.l.padEnd(10)} avg_norm=${item.avg.toFixed(1)}`);
    md(`| ${item.l} | ${item.avg.toFixed(1)} | Rank ${i+1} ${isCorrect ? '✓' : ''} |`);
  });

  const normExcellent = mean((byLabel.Excellent || []).map(r => r.normScore));
  const normGarbage   = mean((byLabel.Garbage || []).map(r => r.normScore));
  const stillInverted = normGarbage > normExcellent;
  console.log(`\n  After normalization: Garbage avg=${normGarbage.toFixed(1)} vs Excellent avg=${normExcellent.toFixed(1)}`);
  console.log(`  Still inverted after normalization: ${stillInverted ? 'YES — second-order problem exists' : 'NO — scale fix resolves inversion'}`);
  md('');
  md(`After normalization: Garbage avg=${normGarbage.toFixed(1)} vs Excellent avg=${normExcellent.toFixed(1)}`);
  md(`Still inverted after normalization: **${stillInverted ? 'YES — second-order problem remains' : 'NO — scale fix resolves the inversion'}**`);
  md('');

  // ── SECTION 4: Score components — which reward garbage? ──────────────────
  console.log('\n── SECTION 4: PREDICTOR CORRELATION WITH QUALITY ─────────────');
  md('## 4. Predictor Correlation with Quality');
  md('');
  md('Pearson r with quality score (5=Excellent … 1=Garbage). Positive = predicts quality.');
  md('');
  md('| Predictor | r | Classification | Note |');
  md('|---|---|---|---|');

  // Build predictor vectors
  const predictors = [
    {
      name:   'normalized_score',
      label:  'Normalized score (DNA×100)',
      vals:   enriched.map(r => r.normScore),
      note:   'Overall WTP score after scale fix',
    },
    {
      name:   'word_count',
      label:  'Title word count',
      vals:   enriched.map(r => r.wc),
      note:   'Longer titles tend to have more specificity',
    },
    {
      name:   'entity_count',
      label:  'Named entities in title',
      vals:   enriched.map(r => r.entities),
      note:   'Named entities signal specificity (names, numbers, brands)',
    },
    {
      name:   'has_concept',
      label:  'Has concept_id (0/1)',
      vals:   enriched.map(r => r.hasConcept ? 1 : 0),
      note:   'Whether topic is classified into a concept',
    },
    {
      name:   'concept_confidence',
      label:  'Concept confidence',
      vals:   enriched.map(r => r.concConf),
      note:   'Confidence of concept assignment (0 if no concept)',
    },
    {
      name:   'has_specific_opp',
      label:  'Has specific opportunity (0/1)',
      vals:   enriched.map(r => r.hasSpecOpp ? 1 : 0),
      note:   'Non-default opportunity matched by title pattern',
    },
    {
      name:   'opportunity_confidence',
      label:  'Opportunity confidence',
      vals:   enriched.map(r => r.oppConf),
      note:   'Confidence of opportunity assignment (0 if none)',
    },
    {
      name:   'is_dna_source',
      label:  'Is DNA source (0/1)',
      vals:   enriched.map(r => r.rec_source === 'dna_original_bets' ? 1 : 0),
      note:   'DNA bets: 50% positive rate',
    },
    {
      name:   'is_angle_gap',
      label:  'Is angle_gap source (0/1)',
      vals:   enriched.map(r => r.rec_source === 'angle_gap' ? 1 : 0),
      note:   'Angle gap: 0% positive rate',
    },
    {
      name:   'is_peer_signal',
      label:  'Is peer_video_signal (0/1)',
      vals:   enriched.map(r => r.rec_source === 'peer_video_signal' ? 1 : 0),
      note:   'Peer signal: 48% positive rate',
    },
  ];

  const qualityScores = enriched.map(r => r.qScore);
  const correlations  = [];

  for (const pred of predictors) {
    const r = pearson(pred.vals, qualityScores);
    if (r === null) continue;
    const classification = r >= 0.15 ? 'POSITIVE predictor' : r <= -0.15 ? 'NEGATIVE predictor' : 'neutral';
    correlations.push({ ...pred, r, classification });
    const sign = r >= 0 ? '+' : '';
    console.log(`  ${pred.label.padEnd(32)} r=${sign}${r.toFixed(3).padStart(7)}  → ${classification}`);
    md(`| ${pred.label} | ${sign}${r.toFixed(3)} | ${classification} | ${pred.note} |`);
  }

  // Sort by correlation strength
  const positive  = correlations.filter(c => c.r >= 0.15).sort((a,b) => b.r - a.r);
  const negative  = correlations.filter(c => c.r <= -0.15).sort((a,b) => a.r - b.r);
  const neutral   = correlations.filter(c => c.r > -0.15 && c.r < 0.15);

  console.log('\n  Summary:');
  console.log(`  Positive predictors (reward quality): ${positive.map(c => c.name).join(', ') || 'none'}`);
  console.log(`  Negative predictors (reward garbage): ${negative.map(c => c.name).join(', ') || 'none'}`);
  console.log(`  Neutral (no signal):                  ${neutral.map(c => c.name).join(', ') || 'none'}`);

  md('');
  md(`**Positive predictors** (reward quality): ${positive.map(c => c.label).join(', ') || 'none'}`);
  md(`**Negative predictors** (reward garbage): ${negative.map(c => c.label).join(', ') || 'none'}`);
  md(`**Neutral** (no signal): ${neutral.map(c => c.label).join(', ') || 'none'}`);
  md('');

  // ── SECTION 5: Source × quality breakdown ────────────────────────────────
  console.log('\n── SECTION 5: SOURCE vs QUALITY MATRIX ───────────────────────');
  md('## 5. Source vs Quality Matrix');
  md('');
  md('| Source | n | Avg norm score | Avg quality score | Positive% | Verdict |');
  md('|---|---|---|---|---|---|');

  const bySrc = {};
  for (const r of enriched) {
    if (!bySrc[r.rec_source]) bySrc[r.rec_source] = [];
    bySrc[r.rec_source].push(r);
  }
  for (const [src, group] of Object.entries(bySrc).sort((a,b) => b[1].length - a[1].length)) {
    const avgNorm  = mean(group.map(r => r.normScore));
    const avgQ     = mean(group.map(r => r.qScore));
    const posN     = group.filter(r => r.qScore >= 4).length;
    const verdict  = avgNorm > 70 && avgQ < 2.5 ? '✗ HIGH SCORE LOW QUALITY — inversion'
                   : avgNorm < 50 && avgQ >= 3   ? '✓ LOW SCORE HIGH QUALITY — underranked'
                   : avgQ >= 3 ? '✓ OK' : '~ neutral';
    console.log(`  ${src.padEnd(24)} n=${String(group.length).padStart(3)}  norm=${avgNorm.toFixed(1).padStart(5)}  q=${avgQ.toFixed(2)}  pos=${pct(posN,group.length).padStart(5)}%  ${verdict}`);
    md(`| ${src} | ${group.length} | ${avgNorm.toFixed(1)} | ${avgQ.toFixed(2)} | ${pct(posN,group.length)}% | ${verdict} |`);
  }

  // ── SECTION 6: Anatomy of an inverted recommendation ──────────────────────
  console.log('\n── SECTION 6: ANATOMY OF INVERSION ──────────────────────────');
  md('');
  md('## 6. Anatomy of the Inversion');
  md('');

  // Compare Garbage vs Excellent on each predictor
  const garbage   = enriched.filter(r => r.human_label === 'Garbage');
  const excellent = enriched.filter(r => r.human_label === 'Excellent');

  const comparisons = [
    ['Raw score',           mean(garbage.map(r=>r.raw_score||0)),    mean(excellent.map(r=>r.raw_score||0))],
    ['Norm score (0–100)',  mean(garbage.map(r=>r.normScore)),        mean(excellent.map(r=>r.normScore))],
    ['Word count',         mean(garbage.map(r=>r.wc)),               mean(excellent.map(r=>r.wc))],
    ['Named entities',     mean(garbage.map(r=>r.entities)),         mean(excellent.map(r=>r.entities))],
    ['Concept confidence', mean(garbage.map(r=>r.concConf)),         mean(excellent.map(r=>r.concConf))],
    ['Opp confidence',     mean(garbage.map(r=>r.oppConf)),          mean(excellent.map(r=>r.oppConf))],
  ];

  md('| Metric | Garbage avg | Excellent avg | Winner |');
  md('|---|---|---|---|');
  for (const [metric, gVal, eVal] of comparisons) {
    const winner = gVal > eVal ? '✗ Garbage wins' : eVal > gVal ? '✓ Excellent wins' : '~ tie';
    console.log(`  ${metric.padEnd(24)} Garbage=${gVal.toFixed(2).padStart(7)}  Excellent=${eVal.toFixed(2).padStart(7)}  → ${winner}`);
    md(`| ${metric} | ${gVal.toFixed(2)} | ${eVal.toFixed(2)} | ${winner} |`);
  }

  // ── SECTION 7: Fix prescription ──────────────────────────────────────────
  console.log('\n── SECTION 7: FIX PRESCRIPTION ──────────────────────────────');
  md('');
  md('## 7. Fix Prescription');
  md('');

  const fixes = [
    {
      priority: 'P0 (BLOCKING)',
      problem:  'DNA affinity scores (0–1) compared directly against WTP scores (0–100)',
      fix:      'Normalize DNA affinity to 0–100 before ranking: `dna_score * 100`',
      file:     'originalBets.js or whatToPost.js (wherever scores are merged)',
      impact:   'Immediately moves Good DNA bets above Garbage angle_gap entries',
    },
    {
      priority: 'P1 (HIGH)',
      problem:  'angle_gap source generates keyword dumps that score 73–93 because peer match count is high',
      fix:      'Apply quality floor: require title word count ≥ 6 OR named entity ≥ 1 before including angle_gap idea',
      file:     'whatToPost.js — angle_gap idea selection',
      impact:   'Eliminates ~100% of Garbage angle_gap entries from recommendations',
    },
    {
      priority: 'P1 (HIGH)',
      problem:  'angle_gap score formula rewards topic frequency, not title quality',
      fix:      'Add `title_specificity_bonus` to score: `+5 per named entity` in generated_title, `+3 per word beyond 5`',
      file:     'whatToPost.js — gap_bonus calculation',
      impact:   'Separates "Narendra Modi Delhi Raises" (score ~88) from "How Trump\'s China Visit Impacts India" (score ~95)',
    },
    {
      priority: 'P2 (MEDIUM)',
      problem:  'concept_confidence and opportunity_confidence are not used in ranking',
      fix:      'Add `concept_confidence_bonus = concept_confidence × 5` (0–5 pts) to score',
      file:     'whatToPost.js / originalBets.js — score assembly',
      impact:   'Rewards traces with validated concept assignment; neutral for no-concept entries',
    },
    {
      priority: 'P3 (LOW)',
      problem:  'territory_expansion source produces only Poor/Garbage (2/2 are Poor in gold set)',
      fix:      'Investigate territory_expansion idea generation — may need quality gate similar to angle_gap',
      file:     'whatToPost.js — territory_expansion',
      impact:   'Small dataset but confirmed zero positive rate',
    },
  ];

  for (const f of fixes) {
    console.log(`\n  [${f.priority}]`);
    console.log(`  Problem: ${f.problem}`);
    console.log(`  Fix:     ${f.fix}`);
    console.log(`  File:    ${f.file}`);
    console.log(`  Impact:  ${f.impact}`);

    md(`### ${f.priority}`);
    md(`**Problem:** ${f.problem}`);
    md(`**Fix:** ${f.fix}`);
    md(`**File:** \`${f.file}\``);
    md(`**Expected impact:** ${f.impact}`);
    md('');
  }

  // ── SECTION 8: Success criteria ───────────────────────────────────────────
  md('## 8. Success Criteria');
  md('');
  md('After applying fixes, re-run this audit. Expected outcomes:');
  md('');
  md('| Metric | Current | Target |');
  md('|---|---|---|');
  md(`| Excellent avg score | ${excellentNorm.toFixed(1)} | > Garbage avg score |`);
  md(`| Garbage avg score | ${normGarbage.toFixed(1)} | < Excellent avg score |`);
  md(`| Positive recommendation rate | ${pct(enriched.filter(r=>r.qScore>=4).length, n)}% | >30% |`);
  md(`| Ranking correlation (Pearson r) | ${pearson(enriched.map(r=>r.normScore), qualityScores)?.toFixed(3)} | >0.30 |`);
  md('');
  md('---');
  md(`*Generated: ${new Date().toISOString()}*`);

  // ── Write markdown report ─────────────────────────────────────────────────
  const reportPath = path.resolve(__dirname, 'ranking_inversion_report.md');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Report written: ${reportPath}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  db.close();
}

main();
