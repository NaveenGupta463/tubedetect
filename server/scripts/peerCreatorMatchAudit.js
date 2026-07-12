'use strict';

/**
 * Peer Creator Match Audit — Phase 3
 *
 * For every gold-labeled peer_video_signal trace:
 *   - Load the channel's creator DNA
 *   - Run computeConceptAffinity(dna, peer_concept_id)
 *   - Report affinity score by gold label tier (Excellent/Good/Average/Poor/Garbage)
 *
 * The central question:
 *   Do Excellent recommendations already have creator concept affinity > 0?
 *   (i.e., does the peer concept match the creator's DNA content domain?)
 *
 * This is pure measurement — no DB writes, no schema changes.
 *
 * Usage:  node peerCreatorMatchAudit.js [--verbose]
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');
const { computeConceptAffinity } = require('../services/conceptNormalizer');

const DB_PATH    = path.resolve(__dirname, '../data/scoring.db');
const REPORT_OUT = path.resolve(__dirname, 'peer_creator_match_report.md');
const VERBOSE    = process.argv.includes('--verbose');

function pct(n, d) {
  if (!d) return '—';
  return (n / d * 100).toFixed(1) + '%';
}
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 60000 });

  // All labeled peer traces with concept assignments
  const labeledPeerTraces = db.prepare(`
    SELECT
      t.id,
      t.channel_id,
      t.generated_title,
      t.peer_concept_id,
      t.peer_concept_label,
      t.peer_concept_confidence,
      t.peer_narrative,
      r.human_label
    FROM wtp_generation_traces t
    JOIN wtp_human_quality_reviews r ON r.trace_id = t.id
    WHERE t.rec_source = 'peer_video_signal'
      AND r.human_label IS NOT NULL
    ORDER BY r.human_label, t.channel_id
  `).all();

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Peer Creator Match Audit — Phase 3\n');
  process.stdout.write(`  ${labeledPeerTraces.length} labeled peer traces\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // Cache DNA per channel (use db.prepare().get() — raw better-sqlite3 has no db.get())
  const dnaStmt = db.prepare('SELECT * FROM creator_idea_dna WHERE channel_id = ?');
  const dnaCache = new Map();
  function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch (_) { return fallback; } }
  function getDna(channel_id) {
    if (!dnaCache.has(channel_id)) {
      const row = dnaStmt.get(channel_id);
      if (!row) { dnaCache.set(channel_id, null); }
      else {
        dnaCache.set(channel_id, {
          ...row,
          stable_dna:       safeJson(row.stable_dna_json, null),
          entities:         safeJson(row.entities_json, []),
          micro_topics:     safeJson(row.micro_topics_json, []),
          hook_templates:   safeJson(row.hook_templates_json, []),
          thesis_patterns:  safeJson(row.thesis_patterns_json, []),
          domain_tags:      safeJson(row.domain_tags_json, []),
        });
      }
    }
    return dnaCache.get(channel_id);
  }

  // Compute per-trace results
  const results = [];
  for (const row of labeledPeerTraces) {
    const dna = getDna(row.channel_id);
    let affinity_score = 0;
    let affinity_reason = 'no_dna';

    if (dna && row.peer_concept_id) {
      const r = computeConceptAffinity(dna, row.peer_concept_id);
      affinity_score  = r.affinity_score;
      affinity_reason = r.affinity_reason;
    } else if (!dna) {
      affinity_reason = 'no_dna';
    } else if (!row.peer_concept_id) {
      affinity_reason = 'no_concept';
    }

    results.push({
      ...row,
      dna_found:       !!dna,
      affinity_score,
      affinity_reason,
      has_concept:     !!row.peer_concept_id,
      affinity_pos:    affinity_score > 0,
    });
  }

  // Group by gold label
  const tiers = ['Excellent', 'Good', 'Average', 'Poor', 'Garbage'];
  const byTier = {};
  for (const t of tiers) byTier[t] = results.filter(r => r.human_label === t);

  // ── Summary by tier ──────────────────────────────────────────────────────
  process.stdout.write('── Affinity score by gold tier ───────────────────────────────\n');
  process.stdout.write(`  ${'Tier'.padEnd(12)} ${'n'.padEnd(6)} ${'with_concept'.padEnd(14)} ${'affinity>0'.padEnd(12)} ${'avg_affinity'.padEnd(14)} ${'max_affinity'}\n`);
  for (const tier of tiers) {
    const rows  = byTier[tier];
    if (!rows.length) continue;
    const withConcept = rows.filter(r => r.has_concept);
    const affinityPos = rows.filter(r => r.affinity_pos);
    const scores = rows.map(r => r.affinity_score);
    process.stdout.write(
      `  ${tier.padEnd(12)} ${String(rows.length).padEnd(6)} ${pct(withConcept.length, rows.length).padEnd(14)} ${pct(affinityPos.length, rows.length).padEnd(12)} ${avg(scores).toFixed(3).padEnd(14)} ${Math.max(...scores).toFixed(3)}\n`
    );
  }

  // ── Excellent deep-dive ──────────────────────────────────────────────────
  process.stdout.write('\n── Excellent traces — per-row affinity ───────────────────────\n');
  for (const r of byTier['Excellent'] || []) {
    process.stdout.write(`  channel: ${r.channel_id}\n`);
    process.stdout.write(`  title:   "${r.generated_title?.slice(0, 70)}"\n`);
    process.stdout.write(`  concept: ${r.peer_concept_id || 'NULL'} (conf=${r.peer_concept_confidence || 0})\n`);
    process.stdout.write(`  affinity: ${r.affinity_score.toFixed(3)} — ${r.affinity_reason}\n`);
    process.stdout.write(`  DNA found: ${r.dna_found}\n\n`);
  }

  // ── Concept distribution in gold set ────────────────────────────────────
  process.stdout.write('── Concept distribution in labeled peer traces ────────────────\n');
  const conceptByLabel = {};
  for (const r of results.filter(r2 => r2.has_concept)) {
    const key = r.peer_concept_id;
    if (!conceptByLabel[key]) conceptByLabel[key] = { label: r.peer_concept_label, counts: {} };
    conceptByLabel[key].counts[r.human_label] = (conceptByLabel[key].counts[r.human_label] || 0) + 1;
  }
  const sortedConcepts = Object.entries(conceptByLabel).sort((a, b) => {
    const aTotal = Object.values(a[1].counts).reduce((s, v) => s + v, 0);
    const bTotal = Object.values(b[1].counts).reduce((s, v) => s + v, 0);
    return bTotal - aTotal;
  });
  for (const [id, { counts }] of sortedConcepts) {
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    const dist  = tiers.filter(t => counts[t]).map(t => `${t}:${counts[t]}`).join(', ');
    process.stdout.write(`  ${String(total).padEnd(4)} ${id.padEnd(30)} [${dist}]\n`);
  }

  // ── Key finding ──────────────────────────────────────────────────────────
  const excellentRows    = byTier['Excellent'] || [];
  const excellentConcept = excellentRows.filter(r => r.has_concept).length;
  const excellentAffPos  = excellentRows.filter(r => r.affinity_pos).length;

  process.stdout.write('\n── Key finding ───────────────────────────────────────────────\n');
  process.stdout.write(`  Excellent traces:                ${excellentRows.length}\n`);
  process.stdout.write(`  Excellent with concept:          ${excellentConcept} / ${excellentRows.length} (${pct(excellentConcept, excellentRows.length)})\n`);
  process.stdout.write(`  Excellent with affinity > 0:     ${excellentAffPos} / ${excellentRows.length} (${pct(excellentAffPos, excellentRows.length)})\n`);
  process.stdout.write(`  Avg affinity (Excellent):        ${avg(excellentRows.map(r => r.affinity_score)).toFixed(3)}\n`);
  process.stdout.write(`  Avg affinity (Good):             ${avg((byTier['Good'] || []).map(r => r.affinity_score)).toFixed(3)}\n`);
  process.stdout.write(`  Avg affinity (Poor+Garbage):     ${avg([...(byTier['Poor'] || []), ...(byTier['Garbage'] || [])].map(r => r.affinity_score)).toFixed(3)}\n`);

  if (excellentAffPos > 0) {
    process.stdout.write(`\n  ✅ ${excellentAffPos} Excellent titles show creator affinity > 0.\n`);
    process.stdout.write('  → Path A hypothesis partially confirmed: peer concept → DNA bridge works for some Excellent titles.\n');
  } else {
    process.stdout.write('\n  ❌ Zero Excellent titles show creator affinity > 0.\n');
    process.stdout.write('  → Narrative excellence and creator concept affinity are structurally orthogonal.\n');
    process.stdout.write('  → The 4 Excellent peer topics (wildlife, cosmology, nostalgia, news) do not match any creator\'s DNA domain.\n');
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');

  // ── Verbose: per-title breakdown ─────────────────────────────────────────
  if (VERBOSE) {
    for (const tier of tiers) {
      const rows = byTier[tier] || [];
      if (!rows.length) continue;
      process.stdout.write(`\n── ${tier} (${rows.length}) ──────────────────────────────────────────\n`);
      for (const r of rows) {
        process.stdout.write(`  [${r.peer_concept_id || 'NO_CONCEPT'}] aff=${r.affinity_score.toFixed(3)} "${r.generated_title?.slice(0, 60)}"\n`);
      }
    }
  }

  // ── Write markdown report ────────────────────────────────────────────────
  const lines = [
    '# Peer Creator Match Report',
    '',
    `**Date:** ${new Date().toISOString().slice(0, 10)}  `,
    `**Labeled peer traces:** ${labeledPeerTraces.length}  `,
    `**Channels with DNA:** ${[...dnaCache.values()].filter(Boolean).length} / ${dnaCache.size}  `,
    '',
    '## Affinity Score by Gold Tier',
    '',
    '| Tier | n | with_concept | affinity>0 | avg_affinity | max_affinity |',
    '|---|---|---|---|---|---|',
  ];
  for (const tier of tiers) {
    const rows  = byTier[tier];
    if (!rows) continue;
    const withConcept = rows.filter(r => r.has_concept).length;
    const affinityPos = rows.filter(r => r.affinity_pos).length;
    const scores = rows.map(r => r.affinity_score);
    lines.push(`| ${tier} | ${rows.length} | ${pct(withConcept, rows.length)} | ${pct(affinityPos, rows.length)} | ${avg(scores).toFixed(3)} | ${scores.length ? Math.max(...scores).toFixed(3) : '—'} |`);
  }

  lines.push('', '## Excellent Traces — Per-row Detail', '');
  for (const r of byTier['Excellent'] || []) {
    lines.push(`### "${r.generated_title}"`);
    lines.push(`- **Channel:** ${r.channel_id}`);
    lines.push(`- **Concept:** \`${r.peer_concept_id || 'NULL'}\` (conf=${r.peer_concept_confidence || 0})`);
    lines.push(`- **Affinity:** ${r.affinity_score.toFixed(3)} — ${r.affinity_reason}`);
    lines.push(`- **DNA found:** ${r.dna_found}`);
    lines.push('');
  }

  lines.push('## Key Finding', '');
  lines.push(`- Excellent traces: **${excellentRows.length}**`);
  lines.push(`- Excellent with concept: **${excellentConcept}/${excellentRows.length}** (${pct(excellentConcept, excellentRows.length)})`);
  lines.push(`- Excellent with affinity > 0: **${excellentAffPos}/${excellentRows.length}** (${pct(excellentAffPos, excellentRows.length)})`);
  lines.push(`- Avg affinity (Excellent): **${avg(excellentRows.map(r => r.affinity_score)).toFixed(3)}**`);
  lines.push(`- Avg affinity (Good): **${avg((byTier['Good'] || []).map(r => r.affinity_score)).toFixed(3)}**`);
  lines.push('');
  if (excellentAffPos > 0) {
    lines.push(`**✅ ${excellentAffPos} Excellent titles show creator affinity > 0.** Path A hypothesis partially confirmed.`);
  } else {
    lines.push('**❌ Zero Excellent titles show creator affinity > 0.** Narrative excellence and creator concept affinity are structurally orthogonal with current taxonomy + DNA coverage.');
  }

  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  process.stdout.write(`  Written: ${REPORT_OUT}\n\n`);

  db.close();
}

main();
