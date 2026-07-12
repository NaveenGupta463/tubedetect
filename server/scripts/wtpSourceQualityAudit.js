'use strict';

/**
 * WTP Source Quality Audit
 *
 * Measures label distribution (Excellent / Good / Average / Poor / Garbage)
 * for each recommendation source using wtp_human_quality_reviews gold set.
 *
 * Goal: Determine whether each source deserves continued investment based on
 * positive rate (Excellent + Good) and whether investment can be justified.
 *
 * Usage:
 *   node wtpSourceQualityAudit.js [--verbose]
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

function mean(arr)  { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(n, d)  { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }

function main() {
  const db      = openDb();
  const verbose = process.argv.includes('--verbose');

  const rows = db.prepare(`
    SELECT
      r.id,
      r.rec_source,
      r.batch_id,
      r.generated_title,
      r.concept_id,
      r.concept_label,
      r.concept_confidence,
      r.score          AS raw_score,
      r.dna_affinity_score,
      r.human_label,
      t.opportunity_id,
      t.opportunity_confidence
    FROM wtp_human_quality_reviews r
    LEFT JOIN wtp_generation_traces t ON t.id = r.trace_id
    WHERE r.human_label IS NOT NULL
    ORDER BY r.rec_source, r.id
  `).all();

  const n = rows.length;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  WTP Source Quality Audit');
  console.log(`  Gold set: ${n} labelled rows`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Group by source
  const bySrc = {};
  for (const r of rows) {
    const src = r.rec_source || 'unknown';
    if (!bySrc[src]) bySrc[src] = [];
    bySrc[src].push(r);
  }

  const sources = Object.keys(bySrc).sort((a, b) => {
    const posA = bySrc[a].filter(r => LABEL_SCORE[r.human_label] >= 4).length / bySrc[a].length;
    const posB = bySrc[b].filter(r => LABEL_SCORE[r.human_label] >= 4).length / bySrc[b].length;
    return posB - posA;
  });

  // Source summary table
  console.log('── 1. SOURCE QUALITY MATRIX ──────────────────────────────────');
  console.log('  Source                n    Excellent%  Good%   Avg%   Poor%  Garbage%  AvgQ  Verdict');
  const report = {};

  for (const src of sources) {
    const group   = bySrc[src];
    const counts  = {};
    for (const lbl of ORDER) counts[lbl] = 0;
    for (const r of group) counts[r.human_label] = (counts[r.human_label] || 0) + 1;

    const excellent = counts['Excellent'] || 0;
    const good      = counts['Good'] || 0;
    const average   = counts['Average'] || 0;
    const poor      = counts['Poor'] || 0;
    const garbage   = counts['Garbage'] || 0;
    const tot       = group.length;
    const posRate   = (excellent + good) / tot;
    const avgQ      = mean(group.map(r => LABEL_SCORE[r.human_label] || 0));

    const verdict = posRate >= 0.40  ? 'INVEST — high signal'
                  : posRate >= 0.20  ? 'MONITOR — mixed signal'
                  : posRate >= 0.10  ? 'IMPROVE — low signal'
                  : posRate > 0      ? 'RECONSIDER — very low signal'
                  : 'DISABLE or GATE — zero positive rate';

    report[src] = { counts, tot, posRate, avgQ, verdict };

    console.log(
      `  ${src.padEnd(24)} ${String(tot).padStart(3)}` +
      `   ${pct(excellent,tot).padStart(5)}%` +
      `   ${pct(good,tot).padStart(5)}%` +
      `   ${pct(average,tot).padStart(4)}%` +
      `   ${pct(poor,tot).padStart(5)}%` +
      `   ${pct(garbage,tot).padStart(7)}%` +
      `   ${avgQ.toFixed(2)}` +
      `   ${verdict}`,
    );
  }

  // Label breakdown per source
  console.log('\n── 2. LABEL COUNTS BY SOURCE ─────────────────────────────────');
  for (const src of sources) {
    const r = report[src];
    const bar = ORDER.map(lbl => `${lbl.slice(0,3)}:${r.counts[lbl]||0}`).join('  ');
    console.log(`  ${src.padEnd(24)} ${bar}  pos=${pct(r.posRate*r.tot, r.tot)}%`);
  }

  // Batch composition per source
  console.log('\n── 3. BATCH DISTRIBUTION (how gold rows were sampled) ────────');
  const byBatchSrc = {};
  for (const r of rows) {
    const key = `${r.batch_id}::${r.rec_source}`;
    byBatchSrc[key] = (byBatchSrc[key] || 0) + 1;
  }
  for (const [key, count] of Object.entries(byBatchSrc).sort()) {
    const [batch, src] = key.split('::');
    console.log(`  ${batch.padEnd(24)} ${src.padEnd(24)} n=${count}`);
  }

  // Representative examples per source
  if (verbose) {
    console.log('\n── 4. REPRESENTATIVE EXAMPLES ────────────────────────────────');
    for (const src of sources) {
      const group = bySrc[src];
      const excellent = group.filter(r => r.human_label === 'Excellent').slice(0, 3);
      const garbage   = group.filter(r => r.human_label === 'Garbage').slice(0, 3);
      console.log(`\n  Source: ${src} (n=${group.length}, pos=${pct(report[src].posRate * group.length, group.length)}%)`);
      if (excellent.length) {
        console.log('  EXCELLENT:');
        for (const r of excellent) console.log(`    "${r.generated_title}"`);
      }
      if (garbage.length) {
        console.log('  GARBAGE:');
        for (const r of garbage) console.log(`    "${r.generated_title}"`);
      }
    }
  }

  // Investment recommendation
  console.log('\n── 5. INVESTMENT DECISION ────────────────────────────────────');
  for (const src of sources) {
    const r = report[src];
    const posN = Math.round(r.posRate * r.tot);
    console.log(`\n  ${src.toUpperCase()}`);
    console.log(`  Positive rate: ${pct(posN, r.tot)}% (${posN}/${r.tot})`);
    console.log(`  Avg quality:   ${r.avgQ.toFixed(2)} / 5.00`);
    console.log(`  Verdict:       ${r.verdict}`);

    if (src === 'dna_original_bets') {
      console.log('  Action:        Continue investment. Best concept × DNA affinity matching.');
      console.log('                 Fix: normalize score to 0-100 before ranking (P0 — applied).');
    } else if (src === 'peer_video_signal') {
      console.log('  Action:        Continue investment. Strong signal from peer topic consensus.');
      console.log('                 Fix: apply specificity threshold, filter episode titles.');
    } else if (src === 'angle_gap') {
      console.log('  Action:        GATE with quality floor (P1 — applied). 63% of corpus');
      console.log('                 rejected as keyword dumps (< 6 words, no named entity).');
      console.log('                 If positive rate remains 0% post-filter → disable source.');
    } else if (src === 'territory_expansion') {
      console.log('  Action:        Monitor. Only 2 rows in gold set — insufficient to judge.');
      console.log('                 Apply same quality floor as angle_gap once corpus grows.');
    } else if (src === 'fallback_evergreen') {
      console.log('  Action:        Fallback only — not in gold set. Keep as last resort.');
    }
  }

  // Positive rate target
  const totalPos = rows.filter(r => LABEL_SCORE[r.human_label] >= 4).length;
  const overallPosRate = totalPos / n;
  console.log('\n── 6. OVERALL METRICS ────────────────────────────────────────');
  console.log(`  Overall positive rate:   ${pct(totalPos, n)}% (${totalPos}/${n})`);
  console.log(`  Target:                  >30%`);
  console.log(`  Status:                  ${overallPosRate >= 0.30 ? '✓ MET' : '✗ NOT MET'}`);
  console.log(`\n  For positive rate to reach 30%:`);
  const targetPos = Math.ceil(n * 0.30);
  const needed = targetPos - totalPos;
  console.log(`  Current: ${totalPos} positive rows out of ${n}`);
  console.log(`  Need:    ${targetPos} positive rows (+${needed} more Good/Excellent recommendations)`);
  console.log(`  Best path: reduce angle_gap contamination (currently ${report['angle_gap']?.tot || 0} rows, 0% positive)`);

  console.log('\n══════════════════════════════════════════════════════════════\n');
  db.close();
}

main();
