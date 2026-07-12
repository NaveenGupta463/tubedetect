'use strict';

/**
 * Peer Concept Trace Extension — Phase 2
 *
 * 1. Adds peer_concept_id, peer_concept_label, peer_concept_confidence
 *    columns to wtp_generation_traces (idempotent — skips if already present).
 * 2. Backfills all historical peer_video_signal traces using extractConcept()
 *    on their generated_title.
 *
 * This is write-only schema extension + backfill.
 * No generation logic is modified.
 *
 * Usage: node peerConceptTraceExtension.js [--dry-run]
 */

const path     = require('path');
const Database = require('../node_modules/better-sqlite3');
const { extractConcept } = require('../services/conceptNormalizer');

const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const DRY_RUN = process.argv.includes('--dry-run');

function main() {
  const db = new Database(DB_PATH, { timeout: 60000 });

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n');
  process.stdout.write('  Peer Concept Trace Extension — Phase 2\n');
  if (DRY_RUN) process.stdout.write('  DRY-RUN mode: no writes\n');
  process.stdout.write('══════════════════════════════════════════════════════════════\n\n');

  // Step 1: Add columns (idempotent)
  const existingCols = db.prepare('PRAGMA table_info(wtp_generation_traces)').all().map(c => c.name);
  const toAdd = [
    ['peer_concept_id',         'TEXT'],
    ['peer_concept_label',      'TEXT'],
    ['peer_concept_confidence', 'REAL'],
  ];

  for (const [col, type] of toAdd) {
    if (existingCols.includes(col)) {
      process.stdout.write(`  Column already exists: ${col} — skipping\n`);
    } else if (!DRY_RUN) {
      db.prepare(`ALTER TABLE wtp_generation_traces ADD COLUMN ${col} ${type}`).run();
      process.stdout.write(`  Added column: ${col} ${type}\n`);
    } else {
      process.stdout.write(`  [dry-run] Would add column: ${col} ${type}\n`);
    }
  }

  // Step 2: Load all peer traces
  // Only select the concept columns if they actually exist (they might not in dry-run)
  const colsNow = db.prepare('PRAGMA table_info(wtp_generation_traces)').all().map(c => c.name);
  const hasConceptCols = colsNow.includes('peer_concept_id');
  const extraCols = hasConceptCols ? ', peer_concept_id, peer_concept_confidence' : '';
  const peerTraces = db.prepare(`
    SELECT id, generated_title${extraCols}
    FROM wtp_generation_traces
    WHERE rec_source = 'peer_video_signal' AND generated_title IS NOT NULL AND generated_title != ''
  `).all();

  process.stdout.write(`\n  Peer traces to backfill: ${peerTraces.length}\n`);

  // Step 3: Backfill
  const updateStmt = DRY_RUN ? null : db.prepare(
    `UPDATE wtp_generation_traces
     SET peer_concept_id=?, peer_concept_label=?, peer_concept_confidence=?
     WHERE id=?`,
  );

  const summary = { total: 0, updated: 0, skipped: 0, covered: 0, byConceptId: {} };

  for (const row of peerTraces) {
    summary.total++;
    const { concept_id, concept_label, concept_confidence } = extractConcept(row.generated_title);

    // Skip if already set to same values (only possible if columns exist)
    if (hasConceptCols && row.peer_concept_id === (concept_id || null) && row.peer_concept_confidence === (concept_confidence || null)) {
      summary.skipped++;
      continue;
    }

    if (!DRY_RUN) {
      updateStmt.run(concept_id || null, concept_label || null, concept_confidence || null, row.id);
    }

    summary.updated++;
    if (concept_id) {
      summary.covered++;
      summary.byConceptId[concept_id] = (summary.byConceptId[concept_id] || 0) + 1;
    }
  }

  process.stdout.write(`\n── Backfill results ──────────────────────────────────────────\n`);
  process.stdout.write(`  Total processed: ${summary.total}\n`);
  process.stdout.write(`  Updated:         ${summary.updated}\n`);
  process.stdout.write(`  Skipped (same):  ${summary.skipped}\n`);
  process.stdout.write(`  Got concept:     ${summary.covered} / ${summary.total} (${(summary.covered / Math.max(1, summary.total) * 100).toFixed(1)}%)\n`);

  process.stdout.write(`\n── Concept distribution in backfilled traces ─────────────────\n`);
  const sorted = Object.entries(summary.byConceptId).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sorted) {
    process.stdout.write(`  ${String(n).padEnd(5)} ${id}\n`);
  }

  if (!DRY_RUN) {
    process.stdout.write(`\n  ✅ Backfill complete. Schema extension done.\n`);
  } else {
    process.stdout.write(`\n  [dry-run] No writes made.\n`);
  }

  process.stdout.write('\n══════════════════════════════════════════════════════════════\n\n');
  db.close();
}

main();
