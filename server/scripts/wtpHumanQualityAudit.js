'use strict';

/**
 * WTP Human Quality Audit — Phase 1
 *
 * Samples recommendations from wtp_generation_traces and stores them in
 * wtp_human_quality_reviews for human labelling.
 *
 * Batches:
 *   top_ranked_100  — top 100 by dna_affinity_score across all sources
 *   dna_50          — 50 DNA bets ranked by dna_affinity_score
 *   peer_signal_25  — 25 peer_video_signal traces
 *   angle_gap_25    — 25 angle_gap traces
 *
 * Usage:
 *   node wtpHumanQualityAudit.js               # seed review table + print queue
 *   node wtpHumanQualityAudit.js --print-queue  # print pending reviews only
 *   node wtpHumanQualityAudit.js --stats        # print label distribution
 *   node wtpHumanQualityAudit.js --export=FILE  # export queue to JSON for external review
 */

const path = require('path');
const fs   = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── DB ────────────────────────────────────────────────────────────────────────

function openDb(readonly = false) {
  const db = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly,
    timeout: 60000,
  });
  db.pragma('busy_timeout = 60000');
  if (!readonly) db.pragma('journal_mode = WAL');
  return db;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS wtp_human_quality_reviews (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id            TEXT    NOT NULL,
    trace_id            INTEGER,
    channel_id          TEXT    NOT NULL,
    rec_source          TEXT,
    family              TEXT,
    archetype           TEXT,
    raw_subject         TEXT,
    generated_title     TEXT,
    concept_id          TEXT,
    concept_label       TEXT,
    concept_confidence  REAL,
    dna_affinity_score  REAL,
    score               REAL,
    human_label         TEXT    CHECK(human_label IN ('Excellent','Good','Average','Poor','Garbage') OR human_label IS NULL),
    reviewer_notes      TEXT,
    reviewed_at         TEXT,
    created_at          TEXT    DEFAULT (datetime('now'))
  )
`;

const CREATE_IDX = [
  `CREATE INDEX IF NOT EXISTS idx_wtp_hqr_batch   ON wtp_human_quality_reviews(batch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wtp_hqr_label   ON wtp_human_quality_reviews(human_label)`,
  `CREATE INDEX IF NOT EXISTS idx_wtp_hqr_channel ON wtp_human_quality_reviews(channel_id)`,
];

function ensureSchema(db) {
  db.exec(CREATE_TABLE);
  for (const idx of CREATE_IDX) db.exec(idx);
}

// ── Sampling ──────────────────────────────────────────────────────────────────

// Normalize legacy dna_affinity_score to 0-100 scale for cross-source comparison.
// Old DNA rows store concept affinity (0-1 float); old peer/angle rows store
// creator_fit_score (0-100 int). New rows use wtp_score (the actual ranking score).
const NORMALIZED_SCORE_SQL = `COALESCE(
  wtp_score,
  CASE
    WHEN dna_affinity_score IS NULL THEN NULL
    WHEN dna_affinity_score > 2     THEN CAST(dna_affinity_score AS INTEGER)
    ELSE                                 CAST(dna_affinity_score * 100 AS INTEGER)
  END
)`;

const BATCHES = [
  {
    id:     'top_ranked_100',
    label:  'Top 100 ranked (all sources, by wtp_score)',
    query:  `SELECT id, channel_id, rec_source, family, archetype, raw_subject,
                    generated_title, concept_id, concept_label,
                    concept_confidence, dna_affinity_score,
                    ${NORMALIZED_SCORE_SQL} AS score
             FROM wtp_generation_traces
             WHERE generated_title IS NOT NULL
               AND generated_title != ''
               AND (wtp_score IS NOT NULL OR dna_affinity_score IS NOT NULL)
             ORDER BY ${NORMALIZED_SCORE_SQL} DESC
             LIMIT 100`,
  },
  {
    id:    'dna_50',
    label: '50 DNA bets (dna_original_bets, top by wtp_score)',
    query: `SELECT id, channel_id, rec_source, family, archetype, raw_subject,
                   generated_title, concept_id, concept_label,
                   concept_confidence, dna_affinity_score,
                   ${NORMALIZED_SCORE_SQL} AS score
            FROM wtp_generation_traces
            WHERE rec_source = 'dna_original_bets'
              AND generated_title IS NOT NULL
              AND generated_title != ''
            ORDER BY ${NORMALIZED_SCORE_SQL} DESC NULLS LAST, RANDOM()
            LIMIT 50`,
  },
  {
    id:    'peer_signal_25',
    label: '25 peer_video_signal traces',
    query: `SELECT id, channel_id, rec_source, family, archetype, raw_subject,
                   generated_title, concept_id, concept_label,
                   concept_confidence, dna_affinity_score,
                   ${NORMALIZED_SCORE_SQL} AS score
            FROM wtp_generation_traces
            WHERE rec_source = 'peer_video_signal'
              AND generated_title IS NOT NULL
              AND generated_title != ''
            ORDER BY ${NORMALIZED_SCORE_SQL} DESC NULLS LAST, RANDOM()
            LIMIT 25`,
  },
  {
    id:    'angle_gap_25',
    label: '25 angle_gap traces',
    query: `SELECT id, channel_id, rec_source, family, archetype, raw_subject,
                   generated_title, concept_id, concept_label,
                   concept_confidence, dna_affinity_score,
                   ${NORMALIZED_SCORE_SQL} AS score
            FROM wtp_generation_traces
            WHERE rec_source = 'angle_gap'
              AND generated_title IS NOT NULL
              AND generated_title != ''
            ORDER BY ${NORMALIZED_SCORE_SQL} DESC NULLS LAST, RANDOM()
            LIMIT 25`,
  },
];

function seedBatch(rdb, wdb, batch) {
  const existing = wdb.prepare(
    `SELECT COUNT(*) as n FROM wtp_human_quality_reviews WHERE batch_id = ?`
  ).get([batch.id]);

  if (existing.n > 0) {
    console.log(`  [skip] ${batch.id} already has ${existing.n} rows`);
    return existing.n;
  }

  const rows = rdb.prepare(batch.query).all();
  if (!rows.length) {
    console.log(`  [warn] ${batch.id}: no traces found`);
    return 0;
  }

  const insert = wdb.prepare(`
    INSERT INTO wtp_human_quality_reviews
      (batch_id, trace_id, channel_id, rec_source, family, archetype, raw_subject,
       generated_title, concept_id, concept_label, concept_confidence,
       dna_affinity_score, score)
    VALUES
      (@batch_id, @trace_id, @channel_id, @rec_source, @family, @archetype, @raw_subject,
       @generated_title, @concept_id, @concept_label, @concept_confidence,
       @dna_affinity_score, @score)
  `);

  const insertMany = wdb.transaction(rows => {
    for (const r of rows) {
      insert.run({
        batch_id:           batch.id,
        trace_id:           r.id,
        channel_id:         r.channel_id,
        rec_source:         r.rec_source,
        family:             r.family,
        archetype:          r.archetype,
        raw_subject:        r.raw_subject,
        generated_title:    r.generated_title,
        concept_id:         r.concept_id,
        concept_label:      r.concept_label,
        concept_confidence: r.concept_confidence,
        dna_affinity_score: r.dna_affinity_score,
        score:              r.score,
      });
    }
  });

  insertMany(rows);
  console.log(`  [ok]   ${batch.id}: inserted ${rows.length} rows`);
  return rows.length;
}

// ── Print review queue ────────────────────────────────────────────────────────

const LABEL_PALETTE = {
  Excellent: '★★★★★',
  Good:      '★★★★☆',
  Average:   '★★★☆☆',
  Poor:      '★★☆☆☆',
  Garbage:   '★☆☆☆☆',
};

function printReviewQueue(db, exportFile) {
  const pending = db.prepare(`
    SELECT id, batch_id, rec_source, family, concept_id, concept_label,
           concept_confidence, dna_affinity_score, score, generated_title,
           raw_subject, archetype, channel_id, human_label
    FROM wtp_human_quality_reviews
    ORDER BY batch_id, score DESC
  `).all();

  if (!pending.length) {
    console.log('No rows in wtp_human_quality_reviews.');
    return;
  }

  if (exportFile) {
    fs.writeFileSync(exportFile, JSON.stringify(pending, null, 2), 'utf8');
    console.log(`Exported ${pending.length} rows to ${exportFile}`);
    return;
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  WTP Human Quality Review Queue');
  console.log('  Labels: Excellent | Good | Average | Poor | Garbage');
  console.log('══════════════════════════════════════════════════════════');
  console.log('  Format: [id] [batch] [source] fit=XX | TITLE');
  console.log('  Review: UPDATE wtp_human_quality_reviews SET human_label=\'Good\', reviewed_at=datetime(\'now\') WHERE id=N;');

  let currentBatch = null;
  for (const r of pending) {
    if (r.batch_id !== currentBatch) {
      currentBatch = r.batch_id;
      const batchDef = BATCHES.find(b => b.id === r.batch_id);
      console.log(`\n── ${batchDef ? batchDef.label : r.batch_id} ─────────────────────`);
    }
    const label  = r.human_label ? `[${r.human_label}]` : '[?    ]';
    const fit    = r.dna_affinity_score != null ? r.dna_affinity_score.toFixed(0) : '--';
    const conf   = r.concept_confidence != null ? r.concept_confidence.toFixed(2) : '--';
    const family = (r.family || 'unknown').slice(0, 16).padEnd(16);
    const src    = (r.rec_source || '?').slice(0, 18).padEnd(18);
    console.log(
      `  ${label} [${String(r.id).padEnd(4)}] [${src}] [${family}] fit=${fit.padStart(3)} conf=${conf}` +
      `\n            ${(r.generated_title || '(no title)').slice(0, 90)}`
    );
    if (r.concept_id) {
      console.log(`            concept: ${r.concept_id} (${r.concept_label || ''})`);
    }
  }
  console.log('');
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function printStats(db) {
  const total    = db.prepare(`SELECT COUNT(*) as n FROM wtp_human_quality_reviews`).get().n;
  const reviewed = db.prepare(`SELECT COUNT(*) as n FROM wtp_human_quality_reviews WHERE human_label IS NOT NULL`).get().n;
  const byLabel  = db.prepare(`
    SELECT COALESCE(human_label,'(unlabelled)') as label, COUNT(*) as n
    FROM wtp_human_quality_reviews
    GROUP BY human_label ORDER BY n DESC
  `).all();
  const byBatch  = db.prepare(`
    SELECT batch_id,
           COUNT(*) as total,
           SUM(CASE WHEN human_label IS NOT NULL THEN 1 ELSE 0 END) as reviewed
    FROM wtp_human_quality_reviews GROUP BY batch_id
  `).all();

  console.log('\n=== WTP Human Quality Review Stats ===');
  console.log(`Total rows: ${total}  |  Reviewed: ${reviewed}  |  Pending: ${total - reviewed}`);
  console.log('\nBy label:');
  for (const r of byLabel) {
    const bar = r.label !== '(unlabelled)' ? (LABEL_PALETTE[r.label] || '') : '';
    console.log(`  ${(r.label).padEnd(14)} ${bar}  ${r.n}`);
  }
  console.log('\nBy batch:');
  for (const r of byBatch) {
    const pct = total > 0 ? (r.reviewed / r.total * 100).toFixed(0) : '0';
    console.log(`  ${r.batch_id.padEnd(20)} ${r.reviewed}/${r.total} reviewed (${pct}%)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const args        = process.argv.slice(2);
  const printQueue  = args.includes('--print-queue');
  const showStats   = args.includes('--stats');
  const exportFile  = (args.find(a => a.startsWith('--export=')) || '').split('=')[1] || null;

  const rdb = openDb(true);   // read traces
  const wdb = openDb(false);  // write reviews

  try {
    ensureSchema(wdb);

    if (showStats) {
      printStats(wdb);
      return;
    }

    if (printQueue || exportFile) {
      printReviewQueue(wdb, exportFile);
      return;
    }

    // Default: seed all batches, then print queue
    console.log('\n=== Seeding wtp_human_quality_reviews ===');
    let totalInserted = 0;
    for (const batch of BATCHES) {
      totalInserted += seedBatch(rdb, wdb, batch);
    }
    console.log(`\nTotal rows inserted: ${totalInserted}`);

    printStats(wdb);
    printReviewQueue(wdb, null);

  } finally {
    rdb.close();
    wdb.close();
  }
}

main();
