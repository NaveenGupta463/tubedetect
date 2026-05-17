'use strict';

// ── Manual pipeline runner ────────────────────────────────────────────────────
// Run with:  npm run pipeline   (from the server/ directory)
//            node pipeline.js   (from the server/ directory)
//
// Runs the full discovery → classification → ingest → snapshot sequence
// in order, then exits. Safe to run overnight — each step is independent
// and a failure in one step is logged but does not stop the next step.

require('dotenv').config({ path: __dirname + '/.env' });

const { getDb } = require('./db/init');

const { runCrawlerCycle }          = require('./jobs/indiaCrawlerJob');
const { runPromotionCycle }        = require('./jobs/corpusPromotionJob');
const { runHistoricalIngestCycle } = require('./jobs/historicalIngest');
const { runSnapshotCycle }         = require('./jobs/snapshotCron');

function line(char = '─', width = 55) { return char.repeat(width); }

function header(step, label) {
  console.log('');
  console.log(line());
  console.log(`  STEP ${step}: ${label}`);
  console.log(`  Started: ${new Date().toLocaleTimeString()}`);
  console.log(line());
}

function done(label, result) {
  console.log(`  ✓ ${label} finished at ${new Date().toLocaleTimeString()}`);
  if (result && typeof result === 'object') {
    for (const [k, v] of Object.entries(result)) {
      if (v != null) console.log(`    ${k}: ${v}`);
    }
  }
}

function failed(label, err) {
  console.error(`  ✗ ${label} FAILED: ${err.message}`);
  console.error('    Continuing to next step...');
}

async function runPipeline() {
  console.log('');
  console.log(line('═'));
  console.log('  TUBEINTEL PIPELINE');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log(line('═'));

  // Initialise DB before any job runs
  getDb();

  const steps = [
    { n: '1/4', label: 'Crawler — finding new Indian channels',    fn: runCrawlerCycle },
    { n: '2/4', label: 'Promotion — niche classification + queue', fn: runPromotionCycle },
    { n: '3/4', label: 'Historical Ingest — fetching video data',  fn: runHistoricalIngestCycle },
    { n: '4/4', label: 'Snapshot — refreshing video metrics',      fn: runSnapshotCycle },
  ];

  const results = [];

  for (const { n, label, fn } of steps) {
    header(n, label);
    try {
      const result = await fn();
      done(label, result);
      results.push({ step: label, status: 'ok', ...result });
    } catch (e) {
      failed(label, e);
      results.push({ step: label, status: 'failed', error: e.message });
    }
  }

  console.log('');
  console.log(line('═'));
  console.log('  PIPELINE COMPLETE');
  console.log(`  Finished: ${new Date().toLocaleString()}`);
  console.log(line('═'));
  console.log('');

  process.exit(0);
}

runPipeline().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
