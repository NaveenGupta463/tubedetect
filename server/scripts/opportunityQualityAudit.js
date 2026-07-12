'use strict';

/**
 * Opportunity Quality Audit — Phase 4
 *
 * Measures opportunity extraction quality across wtp_generation_traces.
 *
 * Metrics:
 *   - extraction_coverage    % of traces with opportunity_id assigned
 *   - confidence_distribution mean/P25/P50/P75
 *   - opportunity_specificity top opportunities vs concept-level defaults
 *   - creator_relevance       opportunity distribution vs channel archetype
 *
 * Targets:
 *   - coverage > 70%
 *   - reviewer accuracy > 80% (requires human labels — deferred to after review)
 *
 * Usage:
 *   node opportunityQualityAudit.js [--days=N] [--verbose]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { OPPORTUNITY_TAXONOMY, CONCEPT_DEFAULT_OPPORTUNITY, COVERED_CONCEPTS } = require('../services/opportunityExtractor');

function openDb() {
  return new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    timeout:  60000,
  });
}

function pct(n, total) { return total > 0 ? (n / total * 100).toFixed(1) : '0.0'; }

function agg(vals) {
  if (!vals.length) return { mean: null, p25: null, p50: null, p75: null };
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const p = f => vals[Math.floor(vals.length * f)];
  return { mean: +mean.toFixed(3), p25: p(0.25), p50: p(0.50), p75: p(0.75) };
}

function main() {
  const args    = process.argv.slice(2);
  const days    = parseInt((args.find(a => a.startsWith('--days=')) || '--days=30').split('=')[1], 10) || 30;
  const verbose = args.includes('--verbose');

  const db    = openDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // ── 1. Coverage ────────────────────────────────────────────────────────────
    const total    = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces WHERE created_at >= ?`).get([since]).n;
    const withOpp  = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces WHERE created_at >= ? AND opportunity_id IS NOT NULL`).get([since]).n;
    const withConc = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces WHERE created_at >= ? AND concept_id IS NOT NULL`).get([since]).n;

    const coveragePct = pct(withOpp, total);
    const coveragePass = withOpp / Math.max(1, total) >= 0.70;

    // ── 2. Coverage by source ──────────────────────────────────────────────────
    const bySource = db.prepare(`
      SELECT rec_source,
             COUNT(*) as total,
             SUM(CASE WHEN opportunity_id IS NOT NULL THEN 1 ELSE 0 END) as with_opp,
             SUM(CASE WHEN concept_id IS NOT NULL THEN 1 ELSE 0 END) as with_concept
      FROM wtp_generation_traces
      WHERE created_at >= ?
      GROUP BY rec_source ORDER BY total DESC
    `).all([since]);

    // ── 3. Confidence distribution ────────────────────────────────────────────
    const confRows = db.prepare(`
      SELECT opportunity_confidence
      FROM wtp_generation_traces
      WHERE created_at >= ? AND opportunity_confidence IS NOT NULL
    `).all([since]).map(r => r.opportunity_confidence);
    const confDist = agg(confRows);

    const highConf   = confRows.filter(v => v >= 0.85).length;
    const medConf    = confRows.filter(v => v >= 0.70 && v < 0.85).length;
    const lowConf    = confRows.filter(v => v < 0.70).length;

    // ── 4. Opportunity specificity: specific vs default fallback ──────────────
    const defaultIds = new Set(Object.values(CONCEPT_DEFAULT_OPPORTUNITY).map(o => o.id));
    const specific   = db.prepare(`
      SELECT COUNT(*) as n FROM wtp_generation_traces
      WHERE created_at >= ? AND opportunity_id IS NOT NULL
    `).get([since]).n;
    // Count how many are default (general_*) vs specific
    const defaultCount = db.prepare(`
      SELECT COUNT(*) as n FROM wtp_generation_traces
      WHERE created_at >= ? AND opportunity_id LIKE 'general_%'
    `).get([since]).n;
    const specificCount = specific - defaultCount;

    // ── 5. Top opportunities ──────────────────────────────────────────────────
    const topOpps = db.prepare(`
      SELECT opportunity_id, opportunity_label, COUNT(*) as n,
             AVG(opportunity_confidence) as avg_conf
      FROM wtp_generation_traces
      WHERE created_at >= ? AND opportunity_id IS NOT NULL
      GROUP BY opportunity_id ORDER BY n DESC LIMIT 20
    `).all([since]);

    // ── 6. Concept coverage in taxonomy ──────────────────────────────────────
    const conceptsInTraces = db.prepare(`
      SELECT concept_id, COUNT(*) as n
      FROM wtp_generation_traces
      WHERE created_at >= ? AND concept_id IS NOT NULL
      GROUP BY concept_id ORDER BY n DESC
    `).all([since]);
    const coveredInTraces   = conceptsInTraces.filter(r => COVERED_CONCEPTS.has(r.concept_id)).length;
    const uncoveredConcepts = conceptsInTraces.filter(r => !COVERED_CONCEPTS.has(r.concept_id));

    // ── 7. Human review accuracy (only if labels exist) ───────────────────────
    const labelledRows = db.prepare(`
      SELECT human_label, COUNT(*) as n FROM wtp_human_quality_reviews
      WHERE human_label IS NOT NULL GROUP BY human_label ORDER BY n DESC
    `).all();
    const totalLabelled = labelledRows.reduce((s, r) => s + r.n, 0);
    const positiveLabels = labelledRows
      .filter(r => ['Excellent','Good'].includes(r.human_label))
      .reduce((s, r) => s + r.n, 0);
    const reviewerAccuracy = totalLabelled > 0
      ? (positiveLabels / totalLabelled * 100).toFixed(1)
      : null;

    // ── Output ─────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Opportunity Quality Audit');
    console.log(`  Window: last ${days} days  |  Traces sampled: ${total.toLocaleString()}`);
    console.log('══════════════════════════════════════════════════════════\n');

    // Coverage
    console.log('── 1. EXTRACTION COVERAGE ────────────────────────────────');
    console.log(`  Traces with opportunity_id:  ${withOpp.toLocaleString()} / ${total.toLocaleString()} = ${coveragePct}%`);
    console.log(`  Traces with concept_id:      ${withConc.toLocaleString()} / ${total.toLocaleString()} = ${pct(withConc, total)}%`);
    console.log(`  Target: >70%  →  ${coveragePass ? 'PASS ✓' : 'FAIL ✗'}`);

    console.log('\n  By source:');
    bySource.forEach(r => {
      const oppPct = pct(r.with_opp, r.total);
      console.log(`    ${r.rec_source.padEnd(24)} ${r.with_opp}/${r.total} (${oppPct}%)`);
    });

    // Confidence
    console.log('\n── 2. CONFIDENCE DISTRIBUTION ────────────────────────────');
    console.log(`  Mean: ${confDist.mean ?? '--'}  P25: ${confDist.p25 ?? '--'}  P50: ${confDist.p50 ?? '--'}  P75: ${confDist.p75 ?? '--'}`);
    if (confRows.length) {
      console.log(`  High (≥0.85):   ${highConf.toLocaleString()} (${pct(highConf, confRows.length)}%) — pattern match on title`);
      console.log(`  Medium (0.70):  ${medConf.toLocaleString()}  (${pct(medConf, confRows.length)}%) — pattern match on subject`);
      console.log(`  Low (0.55):     ${lowConf.toLocaleString()}  (${pct(lowConf, confRows.length)}%) — concept-level fallback`);
    }

    // Specificity
    console.log('\n── 3. OPPORTUNITY SPECIFICITY ────────────────────────────');
    console.log(`  Specific (non-default):  ${specificCount.toLocaleString()} (${pct(specificCount, withOpp)}%)`);
    console.log(`  Default (general_*):     ${defaultCount.toLocaleString()}  (${pct(defaultCount, withOpp)}%)`);

    // Taxonomy coverage
    console.log('\n── 4. TAXONOMY COVERAGE ──────────────────────────────────');
    console.log(`  Concept IDs seen in traces:   ${conceptsInTraces.length}`);
    console.log(`  Covered by opportunity taxonomy: ${coveredInTraces} / ${conceptsInTraces.length}`);
    if (uncoveredConcepts.length) {
      console.log('  Uncovered concepts (need taxonomy entries):');
      uncoveredConcepts.forEach(r => console.log(`    ${r.concept_id.padEnd(30)} ${r.n} traces`));
    } else {
      console.log('  All concept IDs in traces are covered ✓');
    }

    // Top opportunities
    console.log('\n── 5. TOP OPPORTUNITIES ──────────────────────────────────');
    topOpps.forEach(r => {
      const isDefault = r.opportunity_id.startsWith('general_');
      const tag = isDefault ? '[default]' : '[specific]';
      console.log(`  ${tag.padEnd(10)} ${r.opportunity_id.padEnd(32)} n=${r.n.toString().padStart(5)}  conf_avg=${r.avg_conf.toFixed(2)}`);
    });

    // Human review accuracy
    console.log('\n── 6. HUMAN REVIEW ACCURACY ──────────────────────────────');
    if (totalLabelled === 0) {
      console.log('  No labels yet — run wtpHumanQualityAudit.js and label recommendations');
      console.log('  Target: >80% (Excellent+Good) once labelling is complete');
    } else {
      console.log(`  Total labelled: ${totalLabelled}`);
      labelledRows.forEach(r => console.log(`    ${r.human_label.padEnd(10)} ${r.n}`));
      console.log(`  Positive rate (Excellent+Good): ${positiveLabels}/${totalLabelled} = ${reviewerAccuracy}%`);
      const accPass = parseFloat(reviewerAccuracy) >= 80;
      console.log(`  Target: >80%  →  ${accPass ? 'PASS ✓' : 'FAIL ✗ (label more recommendations)'}`);
    }

    // Overall verdict
    console.log('\n══════════════════════════════════════════════════════════');
    const overallPass = coveragePass;
    console.log(`  OVERALL: ${overallPass ? 'PASS ✓' : 'FAIL ✗'}`);
    console.log(`  Coverage ${coveragePct}% ${coveragePass ? '≥' : '<'} 70% target`);
    if (totalLabelled > 0) {
      const accPass = reviewerAccuracy && parseFloat(reviewerAccuracy) >= 80;
      console.log(`  Reviewer accuracy ${reviewerAccuracy}% ${accPass ? '≥' : '<'} 80% target`);
    } else {
      console.log('  Reviewer accuracy: PENDING (no human labels yet)');
    }
    console.log('══════════════════════════════════════════════════════════\n');

    if (verbose) {
      // Full opportunity distribution
      const allOpps = db.prepare(`
        SELECT opportunity_id, COUNT(*) as n FROM wtp_generation_traces
        WHERE created_at >= ? AND opportunity_id IS NOT NULL
        GROUP BY opportunity_id ORDER BY n DESC
      `).all([since]);
      console.log('Full opportunity distribution:');
      allOpps.forEach(r => console.log(`  ${r.opportunity_id.padEnd(36)} ${r.n}`));
    }

  } finally {
    db.close();
  }
}

main();
