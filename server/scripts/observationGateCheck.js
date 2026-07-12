'use strict';

/**
 * Observation Gate Check
 *
 * Single-command status of all 3 gates for exiting Observation Mode.
 * No DB writes. No computation. Reads current state only.
 *
 * Usage: node observationGateCheck.js
 */

const path = require('path');
const fs   = require('fs');
const Database = require('../node_modules/better-sqlite3');

const DB_PATH  = path.resolve(__dirname, '../data/scoring.db');
const LOG_PATH = path.resolve(__dirname, 'narrative_affinity_log.json');

const GATE1_TARGET = 100;   // Excellent labels
const GATE2_TARGET = 1000;  // V2 traces
const GATE3_TARGET = 0.50;  // Excellent affinity rate

function bar(n, total, width = 30) {
  const filled = Math.round((n / total) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, timeout: 30000 });

  // Gate 1 — Excellent labels
  const excellentN = db.prepare(`
    SELECT COUNT(*) as n
    FROM wtp_generation_traces t
    JOIN wtp_human_quality_reviews r ON r.trace_id = t.id
    WHERE t.rec_source = 'peer_video_signal'
      AND r.human_label = 'Excellent'
  `).get().n;

  // Gate 2 — V2 traces
  const v2N = db.prepare(`
    SELECT COUNT(*) as n
    FROM wtp_generation_traces
    WHERE rec_source = 'dna_original_bets'
      AND created_at >= '2026-06-14'
  `).get().n;

  // Total labeled (context)
  const totalLabeled = db.prepare(`
    SELECT COUNT(*) as n
    FROM wtp_human_quality_reviews
    WHERE human_label IS NOT NULL
  `).get().n;

  db.close();

  // Gate 3 — affinity stability (from log)
  let affinityRate = null;
  let affinityN    = null;
  let logLen       = 0;
  if (fs.existsSync(LOG_PATH)) {
    const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    logLen = log.length;
    if (log.length) {
      const latest = log[log.length - 1];
      affinityRate = latest.excellent_affinity_rate;
      affinityN    = latest.excellent_n;
    }
  }

  const g1 = excellentN >= GATE1_TARGET;
  const g2 = v2N        >= GATE2_TARGET;
  const g3 = affinityRate !== null && affinityRate >= GATE3_TARGET;
  const allMet = g1 && g2 && g3;

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Observation Mode — Gate Check\n');
  process.stdout.write(`  ${now} UTC  |  Gold set: ${totalLabeled} total labels\n`);
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // Gate 1
  process.stdout.write(`  GATE 1  Excellent labels >= ${GATE1_TARGET}\n`);
  process.stdout.write(`    ${bar(excellentN, GATE1_TARGET)} ${excellentN} / ${GATE1_TARGET}  ${g1 ? '✅ MET' : `⏳ need ${GATE1_TARGET - excellentN} more`}\n\n`);

  // Gate 2
  process.stdout.write(`  GATE 2  Generator V2 traces >= ${GATE2_TARGET}\n`);
  process.stdout.write(`    ${bar(v2N, GATE2_TARGET)} ${v2N} / ${GATE2_TARGET}  ${g2 ? '✅ MET' : `⏳ need ${GATE2_TARGET - v2N} more`}\n\n`);

  // Gate 3
  const rateStr = affinityRate !== null ? (affinityRate * 100).toFixed(1) + '%' : 'no data';
  process.stdout.write(`  GATE 3  Excellent affinity rate > ${GATE3_TARGET * 100}%  (stable across expanded sample)\n`);
  process.stdout.write(`    Current: ${rateStr}  (n=${affinityN ?? 0}, ${logLen} monitor runs)  ${g3 ? '✅' : affinityRate === null ? '⏳ no data yet' : '❌'}\n\n`);

  // Summary
  if (allMet) {
    process.stdout.write('  ══ ALL GATES MET — run the following audits ══\n\n');
    process.stdout.write('    node scripts/narrativeAffinityMonitor.js\n');
    process.stdout.write('    node scripts/excellentCreatorFitAudit.js\n');
    process.stdout.write('    node scripts/generatorV2ImpactAudit.js\n');
    process.stdout.write('    node scripts/peerCreatorMatchAudit.js\n\n');
    process.stdout.write('  Then: begin Narrative Creator Match ranking design.\n');
  } else {
    const remaining = [!g1 && `Gate 1 (${GATE1_TARGET - excellentN} Excellent labels)`, !g2 && `Gate 2 (${GATE2_TARGET - v2N} V2 traces)`, !g3 && 'Gate 3 (affinity stability)'].filter(Boolean);
    process.stdout.write(`  ⏳ OBSERVATION MODE ACTIVE\n`);
    process.stdout.write(`     Blocking: ${remaining.join('  |  ')}\n`);
    process.stdout.write(`     Do not build: Narrative Generator, Hybrid V3, Ranking V4, Opportunity V3, Voice Profile V3\n`);
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');
}

main();
