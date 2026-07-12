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
const { runCorpusCycle }           = require('./services/corpusScheduler');
const { bulkMineRegion }           = require('./services/discoveryAgent');
const { runHistoricalIngestCycle } = require('./jobs/historicalIngest');
const { runSnapshotCycle, runNeverRefreshedSnapshotCycle } = require('./jobs/snapshotCron');
const { runNewVideoSweep }         = require('./jobs/newVideoSweep');
const { runBulkIdentityDetection } = require('./jobs/identityDetectionJob');
const { runTrendSignalJob }        = require('./jobs/trendSignalJob');
const { runTrendOutcomeJob }       = require('./jobs/trendOutcomeJob');
const { runVideoTrendOutcomeJob }  = require('./jobs/videoTrendOutcomeJob');
const { runComingToIndiaJob }      = require('./jobs/comingToIndiaJob');
const { runVideoTrendJob }         = require('./jobs/videoTrendJob');
const { runFingerprintBackfill }   = require('./jobs/fingerprintBackfill');
const { recomputeChannelIdentity } = require('./jobs/intelligenceAggregatorJob');
const { generateFreshKeywords }    = require('./services/keywordGenerator');

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

  // Spend unused API quota on useful seeded-channel growth before the heavier jobs.
  process.env.CREATOR_GRAPH_RESOLVE_QUOTA ??= '5000';
  process.env.CREATOR_GRAPH_HANDLE_CAP ??= '1200';
  process.env.CORPUS_LIGHT_INGEST_LIMIT ??= '5000';
  process.env.CORPUS_NICHE_CLASSIFY_LIMIT ??= '3000';
  process.env.CORPUS_QUALITY_EVAL_LIMIT ??= '5000';
  process.env.CORPUS_DISCOVERY_SEARCH_FRACTION ??= '0.6';

  const steps = [
    { n: '0/11', label: 'Fingerprint Backfill — build content signatures for all channels', fn: runFingerprintBackfill },
    { n: '1/11', label: 'Keyword Generation — AI generates fresh search queries for underperforming niches', fn: () => generateFreshKeywords(getDb()) },
    { n: '2/11', label: 'Corpus Expansion — evaluate + ingest new channels', fn: () => runCorpusCycle({
        quotaBudget:             parseInt(process.env.CORPUS_PIPELINE_QUOTA ?? '15000', 10),
        allowSearch:             true,
        allowAIDiscovery:        true,
        allowVideoSearch:        true,
        allowHindiSearch:        true,
        allowTamilSearch:        true,
        allowTeluguSearch:       true,
        allowBengaliSearch:      true,
        allowKannadaSearch:      true,
        allowMalayalamSearch:    true,
        allowSpanishSearch:      true,
        allowPortugueseSearch:   true,
        allowIndonesianSearch:   true,
        allowArabicSearch:       true,
        allowPunjabiSearch:      true,
        allowUsSearch:           true,
        allowGbSearch:           true,
      }) },
    { n: '2b/11', label: 'US/UK Bulk Discovery — mine new US + UK channels at scale (full keyword bank, relevance+date, relaxed gate)', fn: async () => {
        const db = getDb();
        const total   = parseInt(process.env.USUK_MINE_QUOTA ?? '40000', 10);
        const usShare = parseFloat(process.env.USUK_MINE_US_SHARE ?? '0.65');
        const usCap   = Math.floor(total * usShare);
        const gbCap   = total - usCap;
        const gate    = {
          minSubs:   parseInt(process.env.USUK_MINE_MIN_SUBS ?? '100', 10),
          minVideos: parseInt(process.env.USUK_MINE_MIN_VIDEOS ?? '3', 10),
        };
        const us = await bulkMineRegion(db, 'us', { quotaCap: usCap, ...gate });
        const gb = await bulkMineRegion(db, 'gb', { quotaCap: gbCap, ...gate });
        return {
          us_admitted: us.admitted, us_searches: us.searches, us_stop: us.stopped,
          gb_admitted: gb.admitted, gb_searches: gb.searches, gb_stop: gb.stopped,
          quota_used:  us.quota_used + gb.quota_used,
        };
      } },
    { n: '3/11', label: 'Crawler — finding new Indian channels',    fn: () => runCrawlerCycle({ quotaBudget: parseInt(process.env.CRAWLER_QUOTA_BUDGET ?? '8000', 10) }) },
    { n: '4/11', label: 'Promotion — niche classification + queue', fn: runPromotionCycle },
    { n: '5/11', label: 'Historical Ingest — fetching video data',  fn: () => runHistoricalIngestCycle({ quotaBudget: parseInt(process.env.INGEST_QUOTA_BUDGET ?? '22000', 10) }) },
    { n: '6/11', label: 'Snapshot — refreshing video metrics',      fn: () => runSnapshotCycle({ quotaBudget: parseInt(process.env.SNAPSHOT_QUOTA_BUDGET ?? '20000', 10) }) },
    { n: '6b/11', label: 'Snapshot (never-refreshed) — first-time fetch for new videos', fn: runNeverRefreshedSnapshotCycle },
    { n: '6c/11', label: 'RSS Sweep — pull fresh videos for already-seeded channels (free RSS + 1u/new video)', fn: runNewVideoSweep },
    { n: '7/11', label: 'Identity Detection — OpenAI niche + archetype for unclassified channels', fn: runBulkIdentityDetection },
    { n: '8/11', label: 'Trend Signals — score topics',             fn: runTrendSignalJob },
    { n: '8b/11', label: 'Coming to India — foreign-led topics not yet domestic', fn: runComingToIndiaJob },
    { n: '8c/11', label: 'Video-grounded trends — specific title-phrase trends', fn: runVideoTrendJob },
    { n: '9/11', label: 'Trend Outcomes — evaluate 30-day predictions (fallback if server offline)', fn: runTrendOutcomeJob },
    { n: '9b/11', label: 'Video Trend Outcomes — evaluate 30-day predictions for the video-grounded engine', fn: runVideoTrendOutcomeJob },
    { n: '10/11', label: 'Fingerprint Refresh — update any channels with new videos since last run', fn: runFingerprintBackfill },
    { n: '11/11', label: 'Channel Identity — build/refresh identity for newly ingested channels', fn: () => { const db = getDb(); recomputeChannelIdentity(db); } },
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
