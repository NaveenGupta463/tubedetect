'use strict';
/**
 * lifecycleValidation.js  —  Tasks 4 & 5
 *
 * Measures the before/after impact of lifecycle suppression on
 * What-to-Post idea quality and routing precision (POR / RP@5 / EAR).
 *
 * Usage:
 *   node server/scripts/lifecycleValidation.js
 *   node server/scripts/lifecycleValidation.js --channel=UCxxxxxxx  (single channel)
 */

const path = require('path');
const { getDb }              = require('../db/init.js');
const { computeWhatToPost }  = require('../routes/creatorIntel.js');

const db = getDb();

// ── Named channel targets (Task 4) ────────────────────────────────────────────
const TARGETS = ['Aaj Tak', 'NDTV', 'Warikoo', 'BeerBiceps'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function findChannel(name) {
  return db.get(
    `SELECT channel_id, channel_name, channel_subscribers,
            COALESCE(primary_niche, niche) AS niche, format_type, primary_language
     FROM ingested_channels WHERE channel_name LIKE ? AND ingest_enabled = 1 LIMIT 1`,
    [`%${name}%`],
  );
}

function fmt(n) { return (n || 0).toLocaleString(); }
function pct(n, t) { return t ? ((n / t) * 100).toFixed(1) + '%' : '0%'; }

// ── Task 4: Before vs After for each named channel ────────────────────────────
function runNamedValidation() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Task 4 — Named channel validation (before vs after)');
  console.log('══════════════════════════════════════════════════════════');

  for (const name of TARGETS) {
    const chan = findChannel(name);
    if (!chan) { console.log(`\n  [${name}] NOT FOUND`); continue; }

    // Lifecycle stats for this channel
    const lcRows = db.all(
      `SELECT stage, COUNT(*) as n FROM creator_topic_lifecycle WHERE channel_id = ? GROUP BY stage`,
      [chan.channel_id],
    );
    const lcMap  = Object.fromEntries(lcRows.map(r => [r.stage, r.n]));
    const lcTotal = lcRows.reduce((s, r) => s + r.n, 0);

    // BEFORE: disable lifecycle filter so all ideas are visible
    let before, after;
    try {
      before = computeWhatToPost(db, {
        channel_id:               chan.channel_id,
        subscriber_count:         String(chan.channel_subscribers || 0),
        debug:                    'true',
        disable_lifecycle_filter: 'true',
      });
    } catch (e) {
      console.log(`\n  [${chan.channel_name}] before call failed: ${e.message}`);
      continue;
    }

    // AFTER: lifecycle filter active (default)
    try {
      after = computeWhatToPost(db, {
        channel_id:       chan.channel_id,
        subscriber_count: String(chan.channel_subscribers || 0),
        debug:            'true',
      });
    } catch (e) {
      console.log(`\n  [${chan.channel_name}] after call failed: ${e.message}`);
      continue;
    }

    const beforeIdeas = before.ideas || [];
    const afterIdeas  = after.ideas  || [];
    const bs          = before.summary || {};
    const as_         = after.summary  || {};

    // Topics suppressed (present before, absent after)
    const afterTopics = new Set(afterIdeas.map(i => i.topic.toLowerCase()));
    const suppressed  = beforeIdeas.filter(i => !afterTopics.has(i.topic.toLowerCase()));

    console.log(`\n  ── ${chan.channel_name} (${chan.channel_id}) ──`);
    console.log(`     niche          : ${chan.niche || '(null)'}  format: ${chan.format_type || '(null)'}`);
    console.log(`     lifecycle rows : ${lcTotal}  ` +
      `regular=${lcMap.regular || 0}  saturated=${lcMap.saturated || 0}  ` +
      `exiting=${lcMap.exiting || 0}  seed=${lcMap.seed || 0}  early=${lcMap.early || 0}`);
    console.log(`     ideas BEFORE   : ${beforeIdeas.length}  (peer pool: ${before.channel_count})`);
    console.log(`     ideas AFTER    : ${afterIdeas.length}  (suppressed: ${as_.lifecycle_suppressed || 0})`);
    console.log(`       └ regular suppressed  : ${as_.lifecycle_regular    || 0}`);
    console.log(`       └ saturated suppressed: ${as_.lifecycle_saturated  || 0}`);
    console.log(`       └ exiting penalised   : ${as_.lifecycle_exiting    || 0}`);

    if (suppressed.length > 0) {
      console.log(`     suppressed topics (sample):`);
      for (const idea of suppressed.slice(0, 5)) {
        const lcRow = db.get(
          `SELECT stage FROM creator_topic_lifecycle WHERE channel_id = ? AND phrase = ?`,
          [chan.channel_id, idea.topic.toLowerCase()],
        );
        console.log(`       • ${idea.topic}  (score=${idea.score}  lc_stage=${lcRow?.stage || '?'})`);
      }
    }

    if (after.lifecycle_suppressed_sample?.length > 0) {
      console.log(`     lifecycle_suppressed_sample:`);
      for (const s of after.lifecycle_suppressed_sample) {
        console.log(`       • ${s.phrase}  stage=${s.stage}  reason=${s.suppressed_reason}`);
      }
    }

    if (afterIdeas.length > 0) {
      console.log(`     top 5 surviving ideas:`);
      for (const idea of afterIdeas.slice(0, 5)) {
        const lc = idea.idea_lifecycle_stage ? `  lc=${idea.idea_lifecycle_stage}` : '';
        console.log(`       ${idea.score.toString().padStart(2)}  ${idea.topic}${lc}`);
      }
    }
  }
}

// ── Task 5: Benchmark POR / RP@5 / EAR ───────────────────────────────────────
// POR: of ideas surfaced, what % have the creator's own niche represented
//      in the peer pool's video topics? (proxy: % of peer channels in pool
//      that match niche)
// RP@5: of top-5 ideas, what % survive lifecycle filter (genuine novelty)?
// EAR:  ideas per channel before vs after — suppression efficiency.

function runBenchmark() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Task 5 — Benchmark: POR / RP@5 / EAR');
  console.log('══════════════════════════════════════════════════════════');

  // Sample: 40 channels across niches with lifecycle data
  const sample = db.all(
    `SELECT ic.channel_id, COALESCE(ic.primary_niche, ic.niche) AS niche,
            ic.format_type, ic.channel_subscribers
     FROM ingested_channels ic
     WHERE ic.ingest_enabled = 1
       AND ic.format_type IS NOT NULL
       AND ic.primary_niche IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM creator_topic_lifecycle ctl
         WHERE ctl.channel_id = ic.channel_id
           AND ctl.stage IN ('regular','saturated')
       )
     ORDER BY RANDOM() LIMIT 40`,
  );

  if (!sample.length) {
    console.log('  No channels with lifecycle data in regular/saturated stage — benchmark skipped.');
    return;
  }

  let bPOR = 0, bRP5 = 0, bEAR = 0;
  let aPOR = 0, aRP5 = 0, aEAR = 0;
  let measured = 0;

  for (const chan of sample) {
    let before, after;
    try {
      before = computeWhatToPost(db, {
        channel_id:               chan.channel_id,
        subscriber_count:         String(chan.channel_subscribers || 0),
        disable_lifecycle_filter: 'true',
      });
      after = computeWhatToPost(db, {
        channel_id:       chan.channel_id,
        subscriber_count: String(chan.channel_subscribers || 0),
      });
    } catch (_) { continue; }

    if (!before.ideas?.length && !after.ideas?.length) continue;

    const bIdeas = before.ideas || [];
    const aIdeas = after.ideas  || [];
    const bs     = before.summary || {};
    const as_    = after.summary  || {};
    const pool   = before.channel_count || 1;

    // POR: saturation_pct of top ideas → lower = more novel topic gaps (better routing)
    // We invert: POR = average (100 - saturation_pct) of top-5 ideas
    // Higher POR = ideas are from underexplored territory (good)
    const bPORval = bIdeas.slice(0, 5).reduce((s, i) => s + (100 - (i.saturation_pct || 50)), 0) / Math.min(5, bIdeas.length || 1);
    const aPORval = aIdeas.slice(0, 5).reduce((s, i) => s + (100 - (i.saturation_pct || 50)), 0) / Math.min(5, aIdeas.length || 1);
    bPOR += bPORval;
    aPOR += aPORval;

    // RP@5: % of top-5 ideas that are NOT in creator's lifecycle regular/saturated
    // Before filter: some ideas may be regular/saturated
    // After filter: should be 100% novel (no regular/saturated in results)
    const lcRows = db.all(
      `SELECT phrase, stage FROM creator_topic_lifecycle WHERE channel_id = ? AND stage IN ('regular','saturated')`,
      [chan.channel_id],
    );
    const suppressedPhrases = new Set(lcRows.map(r => r.phrase));
    const bRP5val = bIdeas.slice(0, 5).filter(i => !suppressedPhrases.has(i.topic.toLowerCase())).length / Math.min(5, bIdeas.length || 1);
    const aRP5val = aIdeas.slice(0, 5).filter(i => !suppressedPhrases.has(i.topic.toLowerCase())).length / Math.min(5, aIdeas.length || 1);
    bRP5 += bRP5val;
    aRP5 += aRP5val;

    // EAR: suppression efficiency = % of before-ideas removed by lifecycle filter
    // Higher = lifecycle filter is doing meaningful work
    const totalBefore = bIdeas.length;
    const suppressed  = as_.lifecycle_suppressed || 0;
    const earVal = totalBefore > 0 ? suppressed / (totalBefore + suppressed) : 0;
    bEAR += 0;   // before suppression = 0% removed by definition
    aEAR += earVal;

    measured++;
  }

  if (!measured) { console.log('  No channels produced ideas — benchmark skipped.'); return; }

  const d = n => n.toFixed(1);
  const bPORavg = bPOR / measured, aPORavg = aPOR / measured;
  const bRP5avg = bRP5 / measured * 100, aRP5avg = aRP5 / measured * 100;
  const aEARavg = aEAR / measured * 100;
  const delta   = n => (n >= 0 ? '+' : '') + n.toFixed(1);

  console.log(`\n  Sample: ${measured} channels with lifecycle data`);
  console.log(`\n  ┌────────────────────────────────────────────────────┐`);
  console.log(`  │ Metric          BEFORE   AFTER    DELTA            │`);
  console.log(`  ├────────────────────────────────────────────────────┤`);
  console.log(`  │ POR  (novelty%) ${d(bPORavg).padStart(6)}   ${d(aPORavg).padStart(6)}   ${delta(aPORavg - bPORavg).padStart(6)}pp          │`);
  console.log(`  │ RP@5 (top5 %)  ${d(bRP5avg).padStart(6)}%  ${d(aRP5avg).padStart(6)}%  ${delta(aRP5avg - bRP5avg).padStart(6)}pp          │`);
  console.log(`  │ EAR  (suppr.%) ${d(0).padStart(6)}%  ${d(aEARavg).padStart(6)}%  ${('+' + d(aEARavg)).padStart(6)}pp          │`);
  console.log(`  └────────────────────────────────────────────────────┘`);
  console.log(`  POR: avg (100 - saturation_pct) of top-5 ideas — higher = more novel`);
  console.log(`  RP@5: % of top-5 ideas NOT already in creator's regular/saturated lifecycle`);
  console.log(`  EAR: suppression efficiency — % of candidate ideas blocked by lifecycle filter`);
}

// ── Corpus-wide lifecycle stats ───────────────────────────────────────────────
function printCorpusStats() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Task 3 — Corpus lifecycle metrics');
  console.log('══════════════════════════════════════════════════════════');

  const stages = db.all(`SELECT stage, COUNT(*) as n FROM creator_topic_lifecycle GROUP BY stage ORDER BY n DESC`);
  const total  = stages.reduce((s, r) => s + r.n, 0);
  const channels = db.get(`SELECT COUNT(DISTINCT channel_id) as n FROM creator_topic_lifecycle`).n;

  console.log(`\n  Total lifecycle records : ${fmt(total)}`);
  console.log(`  Channels with lifecycle : ${fmt(channels)}`);
  console.log(`\n  Stage distribution:`);
  for (const { stage, n } of stages) {
    const bar = '█'.repeat(Math.round(n / total * 40));
    console.log(`    ${stage.padEnd(12)}: ${String(n).padStart(6)}  (${pct(n, total).padStart(5)})  ${bar}`);
  }

  const suppRes = db.get(
    `SELECT COUNT(DISTINCT channel_id) as n FROM creator_topic_lifecycle WHERE stage IN ('regular','saturated')`,
  );
  console.log(`\n  Channels with regular/saturated topics : ${fmt(suppRes.n)}  (${pct(suppRes.n, channels)})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
(function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log('  lifecycleValidation — lifecycle suppression audit');
  console.log('══════════════════════════════════════════════════════════');

  printCorpusStats();
  runNamedValidation();
  runBenchmark();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Done.');
  console.log('══════════════════════════════════════════════════════════');

  process.exit(0);
})();
