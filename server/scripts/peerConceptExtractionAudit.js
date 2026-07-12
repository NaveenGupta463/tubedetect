'use strict';

/**
 * Peer Concept Extraction Audit — Phase 1
 *
 * Runs extractConcept() on every distinct peer_video_signal title and measures:
 *   - concept coverage rate (% of titles that get a concept_id)
 *   - confidence distribution (high ≥0.80, mid 0.60-0.79, low <0.60)
 *   - concept frequency (which concepts appear most often)
 *   - quality correlation (concept coverage vs gold labels)
 *   - Excellent title coverage (do the 4 Excellent titles get concepts?)
 *
 * This is pure measurement — no DB writes, no schema changes.
 *
 * Output: Console report + scripts/peer_concept_coverage_report.md
 * Usage:  node peerConceptExtractionAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database   = require('../node_modules/better-sqlite3');
const { extractConcept } = require('../services/conceptNormalizer');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT = path.resolve(__dirname, 'peer_concept_coverage_report.md');
const VERBOSE    = process.argv.includes('--verbose');

function pct(n, d) {
  if (!d) return '—';
  return (n / d * 100).toFixed(1) + '%';
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // All distinct peer titles with enrichment metadata
  const peerTitles = db.prepare(`
    SELECT DISTINCT
      generated_title,
      MAX(peer_language)    as peer_language,
      MAX(peer_narrative)   as peer_narrative,
      MAX(peer_adaptability)as peer_adaptability,
      COUNT(DISTINCT channel_id) as shown_to_channels
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal'
      AND generated_title IS NOT NULL AND generated_title != ''
    GROUP BY generated_title
    ORDER BY MAX(peer_narrative) DESC, MAX(peer_adaptability) DESC
  `).all();

  // Gold labels
  const goldByTitle = new Map();
  db.prepare(`
    SELECT generated_title, human_label
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL
  `).all().forEach(r => {
    if (!goldByTitle.has(r.generated_title)) goldByTitle.set(r.generated_title, r.human_label);
  });

  db.close();

  // ── Run extractConcept on every title ─────────────────────────────────────
  const results = peerTitles.map(row => {
    const { concept_id, concept_label, concept_confidence } = extractConcept(row.generated_title);
    return {
      title:           row.generated_title,
      peer_language:   row.peer_language,
      peer_narrative:  row.peer_narrative  || 0,
      peer_adaptability: row.peer_adaptability || 0,
      shown_to_channels: row.shown_to_channels,
      concept_id,
      concept_label,
      concept_confidence,
      gold: goldByTitle.get(row.generated_title) || null,
    };
  });

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const total    = results.length;
  const covered  = results.filter(r => r.concept_id).length;
  const highConf = results.filter(r => r.concept_confidence >= 0.80).length;
  const midConf  = results.filter(r => r.concept_confidence >= 0.60 && r.concept_confidence < 0.80).length;
  const lowConf  = results.filter(r => r.concept_confidence > 0 && r.concept_confidence < 0.60).length;
  const noConf   = results.filter(r => !r.concept_id).length;

  // Concept frequency
  const conceptFreq = {};
  for (const r of results.filter(r => r.concept_id)) {
    conceptFreq[r.concept_id] = (conceptFreq[r.concept_id] || { label: r.concept_label, n: 0, gold: {} });
    conceptFreq[r.concept_id].n++;
    if (r.gold) conceptFreq[r.concept_id].gold[r.gold] = (conceptFreq[r.concept_id].gold[r.gold] || 0) + 1;
  }

  // Coverage by quality tier
  const byTier = {
    excellent: results.filter(r => r.gold === 'Excellent'),
    good:      results.filter(r => r.gold === 'Good'),
    average:   results.filter(r => r.gold === 'Average'),
    poor_gar:  results.filter(r => r.gold === 'Poor' || r.gold === 'Garbage'),
    unlabeled: results.filter(r => !r.gold),
  };

  function tierCoverage(rows) {
    const covered = rows.filter(r => r.concept_id).length;
    return { n: rows.length, covered, pct: pct(covered, rows.length) };
  }

  // Coverage by narrative tier
  const byNarrTier = {
    narrative: results.filter(r => r.peer_narrative >= 70),
    adaptable: results.filter(r => r.peer_adaptability >= 65 && r.peer_narrative < 70),
    english_no_pattern: results.filter(r => r.peer_language === 'english' && r.peer_narrative < 70 && r.peer_adaptability < 65),
    non_english: results.filter(r => r.peer_language !== 'english'),
  };

  // ── Console report ────────────────────────────────────────────────────────
  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Peer Concept Extraction Audit — Phase 1\n');
  process.stdout.write(`  ${total} distinct peer titles | extractConcept() applied to all\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  process.stdout.write('── Concept coverage ──────────────────────────────────────────\n');
  process.stdout.write(`  Overall coverage:   ${pct(covered, total)}  (${covered}/${total})\n`);
  process.stdout.write(`  High confidence (≥0.80): ${pct(highConf, total)} (${highConf})\n`);
  process.stdout.write(`  Mid confidence (0.60-0.79): ${pct(midConf, total)} (${midConf})\n`);
  process.stdout.write(`  Low confidence (<0.60): ${pct(lowConf, total)} (${lowConf})\n`);
  process.stdout.write(`  No concept assigned: ${pct(noConf, total)} (${noConf})\n\n`);

  process.stdout.write('── Coverage by gold label tier ───────────────────────────────\n');
  for (const [name, rows] of Object.entries(byTier)) {
    const c = tierCoverage(rows);
    process.stdout.write(`  ${name.padEnd(12)} n=${c.n.toString().padEnd(5)} covered=${c.covered.toString().padEnd(5)} (${c.pct})\n`);
  }

  process.stdout.write('\n── Coverage by narrative tier ────────────────────────────────\n');
  const tierNames = { narrative: 'Narrative ≥70', adaptable: 'Adaptable ≥65', english_no_pattern: 'English/no-pattern', non_english: 'Non-English' };
  for (const [key, rows] of Object.entries(byNarrTier)) {
    const c = tierCoverage(rows);
    process.stdout.write(`  ${tierNames[key].padEnd(22)} n=${c.n.toString().padEnd(5)} covered=${c.covered.toString().padEnd(5)} (${c.pct})\n`);
  }

  process.stdout.write('\n── Concept frequency ─────────────────────────────────────────\n');
  const sorted = Object.entries(conceptFreq).sort((a,b) => b[1].n - a[1].n);
  for (const [id, { label, n, gold }] of sorted) {
    const goldStr = Object.entries(gold).map(([l,v]) => `${l}:${v}`).join(', ');
    process.stdout.write(`  ${String(n).padEnd(4)} ${id.padEnd(30)} ${label.slice(0, 40)} [${goldStr || '—'}]\n`);
  }

  process.stdout.write('\n── Excellent title concept extraction ────────────────────────\n');
  const excellentRows = results.filter(r => r.gold === 'Excellent');
  for (const r of excellentRows) {
    const cov = r.concept_id ? `✅ ${r.concept_id} (conf=${r.concept_confidence})` : '❌ no concept';
    process.stdout.write(`  "${r.title.slice(0, 60)}"\n`);
    process.stdout.write(`    → ${cov}\n`);
  }

  if (VERBOSE) {
    process.stdout.write('\n── All uncovered English titles ──────────────────────────────\n');
    const uncoveredEnglish = results.filter(r => !r.concept_id && r.peer_language === 'english');
    for (const r of uncoveredEnglish) {
      const goldTag = r.gold ? ` [${r.gold}]` : '';
      process.stdout.write(`  "${r.title}"${goldTag}\n`);
    }

    process.stdout.write('\n── All covered titles with concepts ──────────────────────────\n');
    for (const r of results.filter(r => r.concept_id)) {
      const goldTag = r.gold ? ` [${r.gold}]` : '';
      process.stdout.write(`  [${r.concept_id}] (${r.concept_confidence}) "${r.title}"${goldTag}\n`);
    }
  }

  // ── Key finding ────────────────────────────────────────────────────────────
  const excellentCovered = excellentRows.filter(r => r.concept_id).length;
  process.stdout.write('\n── Key finding ───────────────────────────────────────────────\n');
  process.stdout.write(`  Excellent title concept coverage: ${pct(excellentCovered, excellentRows.length)} (${excellentCovered}/${excellentRows.length})\n`);
  if (excellentCovered === 0) {
    process.stdout.write('  ❌ None of the 4 Excellent titles map to a concept in the taxonomy.\n');
    process.stdout.write('  The current taxonomy is calibrated for structured content (food, fitness, finance).\n');
    process.stdout.write('  Narrative patterns (Forced Conflict, Assumption Reversal) have no taxonomy entry.\n');
    process.stdout.write('  → Phase 2 recommendation: extend taxonomy with narrative-specific concepts.\n');
  } else {
    process.stdout.write(`  ✅ ${excellentCovered} Excellent titles have concept assignments.\n`);
    process.stdout.write('  → Proceed to Phase 2: backfill peer_concept_id/label/confidence in traces.\n');
  }

  const target70 = covered >= Math.round(total * 0.70);
  process.stdout.write(`\n  Coverage target (>70%): ${target70 ? '✅ MET' : '❌ NOT MET'} (${pct(covered, total)})\n`);

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  // ── Write markdown report ─────────────────────────────────────────────────
  const lines = [
    '# Peer Concept Coverage Report',
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Total distinct peer titles:** ${total}  `,
    `**Concept coverage (overall):** ${pct(covered, total)} (${covered}/${total})  `,
    `**Coverage target >70%:** ${target70 ? '✅ MET' : '❌ NOT MET'}  `,
    '',
    '## Coverage Summary',
    '',
    '| Confidence tier | Count | % |',
    '|---|---|---|',
    `| High (≥0.80) | ${highConf} | ${pct(highConf, total)} |`,
    `| Mid (0.60-0.79) | ${midConf} | ${pct(midConf, total)} |`,
    `| Low (<0.60) | ${lowConf} | ${pct(lowConf, total)} |`,
    `| No concept | ${noConf} | ${pct(noConf, total)} |`,
    '',
    '## Coverage by Gold Label Tier',
    '',
    '| Label | n | Covered | Coverage % |',
    '|---|---|---|---|',
  ];
  for (const [name, rows] of Object.entries(byTier)) {
    const c = tierCoverage(rows);
    lines.push(`| ${name} | ${c.n} | ${c.covered} | ${c.pct} |`);
  }
  lines.push('', '## Coverage by Narrative Tier', '', '| Tier | n | Covered | Coverage % |', '|---|---|---|---|');
  for (const [key, rows] of Object.entries(byNarrTier)) {
    const c = tierCoverage(rows);
    lines.push(`| ${tierNames[key]} | ${c.n} | ${c.covered} | ${c.pct} |`);
  }

  lines.push('', '## Excellent Titles — Concept Extraction', '');
  for (const r of excellentRows) {
    lines.push(`- **"${r.title}"**`);
    lines.push(`  - Concept: ${r.concept_id ? `\`${r.concept_id}\` (conf=${r.concept_confidence})` : 'NULL — no taxonomy match'}`);
    lines.push('');
  }

  lines.push('## Concept Frequency', '', '| Concept ID | Count | Gold breakdown |', '|---|---|---|');
  for (const [id, { n, gold }] of sorted) {
    lines.push(`| \`${id}\` | ${n} | ${Object.entries(gold).map(([l,v])=>`${l}:${v}`).join(', ') || '—'} |`);
  }

  lines.push('', '## Key Finding', '');
  lines.push(`**Excellent concept coverage: ${pct(excellentCovered, excellentRows.length)}** (${excellentCovered}/${excellentRows.length})`);
  lines.push('');
  if (excellentCovered === 0) {
    lines.push('None of the 4 Excellent titles match any concept in `CONCEPT_TAXONOMY`.');
    lines.push('');
    lines.push('**Why:** The current taxonomy was built for structured content (food, fitness, finance, gaming). It has no patterns for:');
    lines.push('- FORCED_CONFLICT ("The Tiger That Was Forced to Hunt Humans")');
    lines.push('- ASSUMPTION_REVERSAL ("We Thought Black Holes...") ');
    lines.push('- MEMORY_OBJECT ("A Santro, A Family and 20 Years of Memories")');
    lines.push('- CONFLICT_EXPOSE ("Trump Can\'t Negotiate...")');
    lines.push('');
    lines.push('**Implication for Path A:** Adding concept extraction to peer traces will assign concepts to ~' + pct(covered, total) + ' of peer titles, but will MISS all 4 Excellent titles. Concept extraction alone cannot bridge the Excellent relevance gap — the taxonomy must be extended with narrative-aware concepts first.');
  }

  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  process.stdout.write(`  Written: ${REPORT_OUT}\n\n`);
}

main();
