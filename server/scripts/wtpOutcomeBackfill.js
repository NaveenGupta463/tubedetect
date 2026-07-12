'use strict';

// WTP Outcome Backfill — process wtp_video_matches rows that have a video_id
// and produce a wtp_outcomes row with actual performance data.
//
// Run this after new videos have been snapshotted (video_growth_snapshots populated).
// Safe to run repeatedly — uses ON CONFLICT upsert so re-runs just refresh stale data.
//
// Usage:
//   node server/scripts/wtpOutcomeBackfill.js
//   node server/scripts/wtpOutcomeBackfill.js --all           # reprocess even already-computed rows
//   node server/scripts/wtpOutcomeBackfill.js --channel=UCxxx # one channel only
//   node server/scripts/wtpOutcomeBackfill.js --dry-run       # print what would be processed
//   node server/scripts/wtpOutcomeBackfill.js --limit=50      # process at most N rows
//   node server/scripts/wtpOutcomeBackfill.js --verbose       # print per-video result

require('dotenv').config({ path: __dirname + '/../.env' });

const path          = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { computeAndStoreOutcome, OUTCOME_THRESHOLDS } = require('../services/wtpOutcomeQuality');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const ALL       = !!args.all;
const DRY_RUN   = !!args['dry-run'];
const VERBOSE   = !!args.verbose;
const LIMIT     = Number(args.limit) || 0;
const CHANNEL   = args.channel ? String(args.channel) : null;

// ── DB (writable) ─────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: false, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  raw.pragma('synchronous=NORMAL');
  const stmtCache = new Map();
  const stmt = sql => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all:   (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:   (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:   (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    _stmt: sql => stmt(sql),
    transaction: fn => raw.transaction(fn),
    close: ()   => { stmtCache.clear(); raw.close(); },
  };
}

// ── Candidate fetch ───────────────────────────────────────────────────────────
function fetchCandidates(db) {
  const chFilter  = CHANNEL ? 'AND m.channel_id = ?' : '';
  const chParams  = CHANNEL ? [CHANNEL] : [];

  // Candidates: rows that have video_id and a 7d snapshot exists for that video.
  // If --all, include rows already processed (performance_computed_at IS NOT NULL).
  // Otherwise, only unprocessed rows.
  const processedFilter = ALL ? '' : 'AND m.performance_computed_at IS NULL';

  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : '';

  const rows = db.all(
    `SELECT
       m.id, m.channel_id, m.idea_key, m.video_id, m.topic,
       m.rec_source, m.rec_type, m.score, m.confidence,
       m.days_to_publish, m.match_confidence,
       m.performance_computed_at
     FROM wtp_video_matches m
     WHERE m.video_id IS NOT NULL
       ${processedFilter}
       ${chFilter}
     ORDER BY m.created_at DESC
     ${limitClause}`,
    chParams,
  );

  // Filter to those that have at least a 7d snapshot
  return rows.filter(r => {
    const snap = db.get(
      `SELECT 1 FROM video_growth_snapshots WHERE video_id = ? AND bucket = '7d' AND views IS NOT NULL LIMIT 1`,
      [r.video_id],
    );
    return !!snap;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const db    = openDb();

console.log('');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  WTP OUTCOME BACKFILL  —  ' + TODAY);
if (DRY_RUN)  console.log('  MODE: dry-run (no writes)');
if (ALL)      console.log('  MODE: --all (reprocess already-computed rows)');
if (CHANNEL)  console.log(`  Channel filter: ${CHANNEL}`);
if (LIMIT)    console.log(`  Row limit: ${LIMIT}`);
console.log('══════════════════════════════════════════════════════════════════');
console.log('');

console.log('  Scanning wtp_video_matches for processable rows...');
const candidates = fetchCandidates(db);
console.log(`  Found ${candidates.length} candidate(s) with 7d snapshots.`);

if (!candidates.length) {
  console.log('');
  console.log('  Nothing to process. Possible reasons:');
  console.log('  • No video_id entries in wtp_video_matches yet');
  console.log('  • No video_growth_snapshots at bucket=7d for matched videos');
  console.log('  • All rows already processed (run --all to force reprocess)');
  console.log('');
  db.close();
  process.exit(0);
}

// ── Process candidates ────────────────────────────────────────────────────────
const counts = { ok: 0, skipped: 0, error: 0 };
const classCounts = {};

console.log('');
console.log('  Processing...');
console.log('');

const BAR_WIDTH = 30;

for (let i = 0; i < candidates.length; i++) {
  const match = candidates[i];

  // Progress line
  const pct    = Math.round((i / candidates.length) * 100);
  const filled = Math.round((i / candidates.length) * BAR_WIDTH);
  process.stdout.write(`  [${('█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled))}] ${pct}% (${i}/${candidates.length})\r`);

  if (DRY_RUN) {
    if (VERBOSE) {
      console.log(`  [dry] ${match.idea_key}  video=${match.video_id}  topic=${String(match.topic).slice(0, 40)}`);
    }
    counts.ok++;
    continue;
  }

  try {
    const result = computeAndStoreOutcome(db, match);
    if (!result) {
      counts.skipped++;
      if (VERBOSE) console.log(`  [skip] ${match.video_id} — no 7d snapshot or missing fields`);
      continue;
    }

    counts.ok++;
    classCounts[result.outcomeClass] = (classCounts[result.outcomeClass] || 0) + 1;

    if (VERBOSE) {
      const liftStr = result.relativeLift != null ? `${result.relativeLift.toFixed(2)}×` : 'n/a';
      const pctStr  = result.pctChannel   != null ? `${result.pctChannel}th pct` : '';
      console.log(
        `  [${result.outcomeClass.padEnd(13)}]  lift=${liftStr.padStart(6)}  ${pctStr.padStart(10)}  ` +
        `v7d=${String(result.views7d || 0).padStart(7)}  ${String(match.topic || '').slice(0, 45)}`
      );
    }
  } catch (e) {
    counts.error++;
    if (VERBOSE) console.log(`  [error] ${match.video_id}: ${e.message}`);
  }
}

process.stdout.write(`  [${'█'.repeat(BAR_WIDTH)}] 100% (${candidates.length}/${candidates.length})\n`);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
console.log('  ══════════════════════════════════════════════════════════════════');
console.log(`  BACKFILL COMPLETE  (${DRY_RUN ? 'dry run — no writes' : 'writes committed'})`);
console.log('');
console.log(`  Processed: ${counts.ok}  |  Skipped: ${counts.skipped}  |  Errors: ${counts.error}`);

if (Object.keys(classCounts).length) {
  console.log('');
  console.log('  Outcome distribution from this run:');
  const classOrder = ['breakout', 'above_average', 'average', 'below_average', 'failed'];
  for (const cls of classOrder) {
    if (classCounts[cls]) {
      const bar = '█'.repeat(Math.min(20, classCounts[cls]));
      console.log(`    ${cls.padEnd(15)}  ${String(classCounts[cls]).padStart(4)}  ${bar}`);
    }
  }
}

console.log('');
console.log('  Thresholds used:');
console.log(`    breakout      ≥ ${OUTCOME_THRESHOLDS.breakout}×   channel baseline`);
console.log(`    above_average ≥ ${OUTCOME_THRESHOLDS.above_average}×   channel baseline`);
console.log(`    average       ≥ ${OUTCOME_THRESHOLDS.average}×   channel baseline`);
console.log(`    below_average ≥ ${OUTCOME_THRESHOLDS.below_average}×   channel baseline`);
console.log(`    failed        <  ${OUTCOME_THRESHOLDS.below_average}×   channel baseline`);
console.log('');
console.log('  Next step: node server/scripts/wtpOutcomeReport.js');
console.log('  ══════════════════════════════════════════════════════════════════');
console.log('');

db.close();
process.exit(counts.error > 0 ? 1 : 0);
