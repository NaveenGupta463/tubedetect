'use strict';

/**
 * Phase 3 — Add opportunity columns to wtp_generation_traces and backfill.
 *
 * Adds (if not present):
 *   opportunity_id          TEXT
 *   opportunity_label       TEXT
 *   opportunity_confidence  REAL
 *
 * IMPORTANT: opportunity data is observational only.
 * These columns MUST NOT influence ranking, scoring, or recommendation selection.
 *
 * Usage: node migrateOpportunityColumns.js [--backfill] [--dry-run]
 */

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { extractOpportunity } = require('../services/opportunityExtractor');
const { extractConcept }    = require('../services/conceptNormalizer');

function openDb() {
  const db = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), { timeout: 60000 });
  db.pragma('busy_timeout = 60000');
  db.pragma('journal_mode = WAL');
  return db;
}

function main() {
  const args   = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const db = openDb();

  try {
    // ── 1. Add columns if missing ──────────────────────────────────────────────
    const existing = db.prepare(`PRAGMA table_info(wtp_generation_traces)`).all().map(r => r.name);

    const newCols = [
      { name: 'opportunity_id',         type: 'TEXT' },
      { name: 'opportunity_label',      type: 'TEXT' },
      { name: 'opportunity_confidence', type: 'REAL' },
    ];

    for (const col of newCols) {
      if (!existing.includes(col.name)) {
        if (!dryRun) {
          db.exec(`ALTER TABLE wtp_generation_traces ADD COLUMN ${col.name} ${col.type}`);
        }
        console.log(`  [${dryRun ? 'dry' : 'ok'}] added column: ${col.name} ${col.type}`);
      } else {
        console.log(`  [skip] column already exists: ${col.name}`);
      }
    }

    // ── 2. Create index for opportunity_id lookups ─────────────────────────────
    if (!dryRun) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wtp_traces_opp ON wtp_generation_traces(opportunity_id)`);
    }

    // ── 3. Backfill existing traces ────────────────────────────────────────────
    // Include traces without concept_id — we'll derive concept from title for those.
    const traces = db.prepare(`
      SELECT id, concept_id, generated_title, raw_subject, family, archetype
      FROM wtp_generation_traces
      WHERE opportunity_id IS NULL
    `).all();

    console.log(`\nTraces to backfill: ${traces.length.toLocaleString()}`);
    if (!traces.length) { console.log('Nothing to do.'); return; }

    const update = db.prepare(`
      UPDATE wtp_generation_traces
      SET opportunity_id         = @opportunity_id,
          opportunity_label      = @opportunity_label,
          opportunity_confidence = @opportunity_confidence
      WHERE id = @id
    `);

    let filled = 0, skipped = 0;

    const backfill = db.transaction(() => {
      for (const trace of traces) {
        // If concept_id missing, derive from generated_title (for angle_gap, peer, fallback)
        let t = trace;
        if (!t.concept_id && t.generated_title) {
          const inferred = extractConcept(t.generated_title);
          if (inferred.concept_id) {
            t = { ...trace, concept_id: inferred.concept_id };
          }
        }
        const opp = extractOpportunity(t);
        if (opp) {
          if (!dryRun) {
            update.run({ id: trace.id, ...opp });
          }
          filled++;
        } else {
          skipped++;
        }
      }
    });

    backfill();

    console.log(`Backfill complete:`);
    console.log(`  opportunity assigned: ${filled.toLocaleString()}`);
    console.log(`  no opportunity (null concept or no taxonomy): ${skipped.toLocaleString()}`);
    console.log(`  coverage: ${(filled / traces.length * 100).toFixed(1)}%`);

    if (dryRun) console.log('\n(dry-run — no changes written)');

    // ── 4. Quick coverage check ────────────────────────────────────────────────
    const total    = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces`).get().n;
    const withOpp  = db.prepare(`SELECT COUNT(*) as n FROM wtp_generation_traces WHERE opportunity_id IS NOT NULL`).get().n;
    const bySource = db.prepare(`
      SELECT rec_source,
             COUNT(*) as total,
             SUM(CASE WHEN opportunity_id IS NOT NULL THEN 1 ELSE 0 END) as with_opp
      FROM wtp_generation_traces
      GROUP BY rec_source ORDER BY total DESC
    `).all();

    console.log(`\nPost-migration coverage:`);
    console.log(`  Overall: ${withOpp}/${total} = ${(withOpp/total*100).toFixed(1)}%`);
    console.log('  By source:');
    bySource.forEach(r => {
      const pct = r.total > 0 ? (r.with_opp/r.total*100).toFixed(1) : '0.0';
      console.log(`    ${r.rec_source.padEnd(24)} ${r.with_opp}/${r.total} (${pct}%)`);
    });

  } finally {
    db.close();
  }
}

main();
