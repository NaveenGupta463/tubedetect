'use strict';

// Audit: what drives data_adjustment > 0 in the PrePublish intelligence system?
// Backtest (834K rows, 2026-05-27) showed adj>0 beat_median=8.9% < neutral 9.5%.
// This script breaks down beat_median rates across all signal dimensions to find
// which subgroups (if any) have reliable positive signal.
//
// Usage:
//   node server/scripts/auditPrepublishAdjustmentDrivers.js
//   node server/scripts/auditPrepublishAdjustmentDrivers.js --buckets 1d,7d,14d
//   node server/scripts/auditPrepublishAdjustmentDrivers.js --limit 10000

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }                         = require('../db/init');
const { computePrepublishIntelligence } = require('../services/prepublishIntelligence');
const { classifyDurationBucket }        = require('../db/queries');

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const FLAG_BUCKS = getFlag('--buckets', '1d,7d,14d');
const FLAG_LIMIT = getFlag('--limit',   '5000');

function getFlag(name, def) {
  const i = args.indexOf(name);
  return (i !== -1 && i + 1 < args.length) ? args[i + 1] : def;
}

const TARGET_BUCKETS = FLAG_BUCKS.split(',').map(s => s.trim());
const LIMIT          = parseInt(FLAG_LIMIT, 10) || 5000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(s, n) {
  const str = String(s ?? '—');
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
}

function pct(a, b) {
  return b ? (100 * a / b).toFixed(1) + '%' : '—';
}

function topN(map, n, sortByBeatPct = false) {
  const entries = Object.entries(map).filter(([, v]) => v.total >= 10);
  if (sortByBeatPct) {
    entries.sort((a, b) => (b[1].beat / b[1].total) - (a[1].beat / a[1].total));
  } else {
    entries.sort((a, b) => b[1].total - a[1].total);
  }
  return entries.slice(0, n);
}

function printTable(header, rows) {
  const h = header.join(' | ');
  console.log('\n  ' + h);
  console.log('  ' + '─'.repeat(h.length));
  for (const row of rows) console.log('  ' + (Array.isArray(row) ? row.join(' | ') : row));
}

function buildNicheMedianMap(db) {
  const rows = db.all(`SELECT niche, duration_bucket, median_vph FROM niche_benchmarks WHERE bucket = '7d'`);
  const map  = {};
  for (const r of rows) map[`${r.niche}|${r.duration_bucket}`] = r.median_vph;
  return map;
}

// ── Load sample ───────────────────────────────────────────────────────────────

function loadSample(db) {
  const rows = [];
  const perBucket = Math.ceil(LIMIT / TARGET_BUCKETS.length);
  for (const bucket of TARGET_BUCKETS) {
    const nicheFilter = '';
    const batch = db.all(`
      SELECT iv.youtube_video_id AS video_id, iv.channel_id, iv.niche, iv.title,
             iv.duration_seconds, '${bucket}' AS bucket,
             vgs.views_per_hour AS vph, vgs.subscriber_adjusted_velocity AS sav
      FROM ingested_videos iv
      JOIN video_growth_snapshots vgs
        ON vgs.video_id = iv.youtube_video_id
       AND vgs.bucket = '${bucket}'
       AND vgs.views_per_hour IS NOT NULL
      WHERE iv.niche IS NOT NULL AND iv.niche != ''
        AND iv.is_short = 0
      ORDER BY RANDOM()
      LIMIT ?
    `, [perBucket]);
    rows.push(...batch);
  }
  return rows;
}

// ── Accumulate into dimension map ─────────────────────────────────────────────

function acc(map, key, beat, isAdj) {
  if (!map[key]) map[key] = { beat: 0, miss: 0, total: 0, adjPos: 0, adjNeg: 0, adjZero: 0 };
  map[key].total++;
  if (beat === true)  map[key].beat++;
  if (beat === false) map[key].miss++;
  if (isAdj > 0)  map[key].adjPos++;
  if (isAdj < 0)  map[key].adjNeg++;
  if (isAdj === 0) map[key].adjZero++;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db          = getDb();
  const nicheMedian = buildNicheMedianMap(db);

  console.log('\n── Audit: PrepublishIntelligence adjustment drivers ─────────────────────────────');
  console.log(`  Buckets: ${TARGET_BUCKETS.join(', ')}  |  Sample limit: ${LIMIT.toLocaleString()}`);
  console.log('  Loading sample…');

  const rows = loadSample(db);
  console.log(`  Loaded ${rows.length.toLocaleString()} rows. Scoring…`);

  // Dimension accumulators — beat_median rate by:
  const byNiche         = {};
  const byCluster       = {};
  const byTopic         = {};
  const byTopicTier     = {};
  const bySatLevel      = {};
  const byStage         = {};
  const byDurBucket     = {};
  const byConf          = {};
  const byAdjDir        = {};
  // Component score averages by adj direction
  const compAvg = { neg: { arch:[], topic:[], sat:[] }, zero: { arch:[], topic:[], sat:[] }, pos: { arch:[], topic:[], sat:[] } };
  // Top booster candidates
  const boostedRows = [];

  let processed = 0;
  const PROGRESS_EVERY = 200;

  for (const row of rows) {
    const intel = await computePrepublishIntelligence(db, {
      title:            row.title,
      niche:            row.niche,
      channel_id:       row.channel_id,
      duration_seconds: row.duration_seconds,
    });

    const adj      = intel.data_adjustment;
    const fit      = intel.intelligence_fit_score;
    const conf     = intel.data_confidence;
    const cluster  = intel.semantic_cluster  ?? '(none)';
    const topic    = intel.topic_signals?.topic ?? '(none)';
    const tier     = intel.topic_signals?.tier  ?? '(none)';
    const satLevel = intel.saturation_level ?? '(none)';
    const stage    = intel.lifecycle_stage  ?? '(none)';
    const durBuck  = classifyDurationBucket(row.duration_seconds);

    const nicheM = (() => {
      const k = `${row.niche}|${durBuck}`;
      return nicheMedian[k] ?? null;
    })();
    const beatMedian = (nicheM != null && nicheM > 0 && row.vph != null)
      ? row.vph > nicheM : null;

    const adjDir = adj < 0 ? 'neg' : adj > 0 ? 'pos' : 'zero';

    // Accumulate
    acc(byNiche,     row.niche, beatMedian, adj);
    acc(byCluster,   cluster,   beatMedian, adj);
    acc(byTopic,     topic,     beatMedian, adj);
    acc(byTopicTier, tier,      beatMedian, adj);
    acc(bySatLevel,  satLevel,  beatMedian, adj);
    acc(byStage,     stage,     beatMedian, adj);
    acc(byDurBucket, durBuck,   beatMedian, adj);
    acc(byConf,      conf,      beatMedian, adj);
    acc(byAdjDir,    adjDir,    beatMedian, adj);

    // Component averages
    if (adjDir === 'neg' || adjDir === 'zero' || adjDir === 'pos') {
      compAvg[adjDir].arch.push(fit);   // proxy — would need archetypeScore exposed separately
    }

    // Track boosted rows with beatMedian info for suspicious analysis
    if (adj > 0 && beatMedian != null) {
      boostedRows.push({ niche: row.niche, cluster, topic, tier, satLevel, stage, durBuck, conf, beat: beatMedian, adj });
    }

    processed++;
    if (processed % PROGRESS_EVERY === 0) {
      process.stdout.write(`\r  Progress: ${processed.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }
  if (processed >= PROGRESS_EVERY) console.log('');

  // ── Section 1: adj direction overall ──────────────────────────────────────

  console.log('\n── 1. Adjustment direction hit-rates ───────────────────────────────────────────');
  printTable(
    [pad('Direction', 8), pad('Total', 8), pad('Beat%', 8)],
    ['neg', 'zero', 'pos'].map(k => {
      const d = byAdjDir[k] ?? { beat: 0, total: 0 };
      return [pad(k, 8), pad(d.total, 8), pad(pct(d.beat, d.total), 8)];
    }),
  );

  // ── Section 2: beat_median by data_confidence ─────────────────────────────

  console.log('\n── 2. Beat-median by data_confidence ───────────────────────────────────────────');
  printTable(
    [pad('Confidence', 12), pad('Total', 8), pad('Beat%', 8), pad('adj>0 cnt', 10), pad('adj>0 beat%', 12)],
    Object.entries(byConf).sort((a,b)=>b[1].total-a[1].total).map(([k, v]) => {
      const adjPosBeat = boostedRows.filter(r => r.conf === k && r.beat).length;
      const adjPosTotal = boostedRows.filter(r => r.conf === k).length;
      return [pad(k, 12), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(adjPosTotal, 10), pad(pct(adjPosBeat, adjPosTotal), 12)].join(' | ');
    }),
  );

  // ── Section 3: top niches driving adj>0 ──────────────────────────────────

  console.log('\n── 3. Top niches where adj > 0 ─────────────────────────────────────────────────');
  const adjPosByNiche = {};
  for (const r of boostedRows) {
    if (!adjPosByNiche[r.niche]) adjPosByNiche[r.niche] = { beat: 0, total: 0 };
    adjPosByNiche[r.niche].total++;
    if (r.beat) adjPosByNiche[r.niche].beat++;
  }
  const nichesSorted = Object.entries(adjPosByNiche).sort((a,b) => b[1].total - a[1].total).slice(0, 15);
  printTable(
    [pad('Niche', 18), pad('adj>0 cnt', 10), pad('Beat% (adj>0)', 14), pad('Niche overall Beat%', 20)],
    nichesSorted.map(([niche, v]) => {
      const overall = byNiche[niche] ?? { beat: 0, total: 0 };
      return [pad(niche, 18), pad(v.total, 10), pad(pct(v.beat, v.total), 14), pad(pct(overall.beat, overall.total), 20)].join(' | ');
    }),
  );

  // ── Section 4: top semantic clusters driving adj>0 ───────────────────────

  console.log('\n── 4. Top semantic clusters where adj > 0 ──────────────────────────────────────');
  const adjPosByCluster = {};
  for (const r of boostedRows) {
    if (!adjPosByCluster[r.cluster]) adjPosByCluster[r.cluster] = { beat: 0, total: 0 };
    adjPosByCluster[r.cluster].total++;
    if (r.beat) adjPosByCluster[r.cluster].beat++;
  }
  const clustersSorted = Object.entries(adjPosByCluster).sort((a,b) => b[1].total - a[1].total).slice(0, 15);
  printTable(
    [pad('Cluster', 18), pad('adj>0 cnt', 10), pad('Beat% (adj>0)', 14), pad('Cluster overall Beat%', 22)],
    clustersSorted.map(([cluster, v]) => {
      const overall = byCluster[cluster] ?? { beat: 0, total: 0 };
      return [pad(cluster, 18), pad(v.total, 10), pad(pct(v.beat, v.total), 14), pad(pct(overall.beat, overall.total), 22)].join(' | ');
    }),
  );

  // ── Section 5: top matched topics driving adj>0 ──────────────────────────

  console.log('\n── 5. Top topics where adj > 0 ─────────────────────────────────────────────────');
  const adjPosByTopic = {};
  for (const r of boostedRows) {
    if (r.topic === '(none)') continue;
    if (!adjPosByTopic[r.topic]) adjPosByTopic[r.topic] = { beat: 0, total: 0 };
    adjPosByTopic[r.topic].total++;
    if (r.beat) adjPosByTopic[r.topic].beat++;
  }
  const topicsSorted = Object.entries(adjPosByTopic).sort((a,b) => b[1].total - a[1].total).slice(0, 15);
  if (topicsSorted.length) {
    printTable(
      [pad('Topic', 22), pad('adj>0 cnt', 10), pad('Beat%', 8)],
      topicsSorted.map(([t, v]) => [pad(t, 22), pad(v.total, 10), pad(pct(v.beat, v.total), 8)].join(' | ')),
    );
  } else {
    console.log('\n  No topic matches found in boosted rows (topic_signal_stats may be sparse).');
  }

  // ── Section 6: beat_median by topic signal tier ──────────────────────────

  console.log('\n── 6. Beat-median by topic signal tier ─────────────────────────────────────────');
  printTable(
    [pad('Tier', 12), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
    Object.entries(byTopicTier).sort((a,b)=>b[1].total-a[1].total).map(([k, v]) =>
      [pad(k, 12), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(pct(v.adjPos, v.total), 8)].join(' | ')
    ),
  );

  // ── Section 7: beat_median by saturation_level ───────────────────────────

  console.log('\n── 7. Beat-median by saturation_level ──────────────────────────────────────────');
  printTable(
    [pad('Sat level', 14), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
    Object.entries(bySatLevel).sort((a,b)=>b[1].total-a[1].total).map(([k, v]) =>
      [pad(k, 14), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(pct(v.adjPos, v.total), 8)].join(' | ')
    ),
  );

  // ── Section 8: beat_median by lifecycle_stage ────────────────────────────

  console.log('\n── 8. Beat-median by lifecycle_stage ───────────────────────────────────────────');
  printTable(
    [pad('Stage', 14), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
    Object.entries(byStage).sort((a,b)=>b[1].total-a[1].total).map(([k, v]) =>
      [pad(k, 14), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(pct(v.adjPos, v.total), 8)].join(' | ')
    ),
  );

  // ── Section 9: beat_median by duration_bucket ────────────────────────────

  console.log('\n── 9. Beat-median by duration_bucket ───────────────────────────────────────────');
  printTable(
    [pad('Duration', 12), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
    Object.entries(byDurBucket).sort((a,b)=>b[1].total-a[1].total).map(([k, v]) =>
      [pad(k, 12), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(pct(v.adjPos, v.total), 8)].join(' | ')
    ),
  );

  // ── Section 10: beat_median by niche (top 20) ────────────────────────────

  console.log('\n── 10. Beat-median by niche (all, sorted by volume) ────────────────────────────');
  printTable(
    [pad('Niche', 18), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
    Object.entries(byNiche).sort((a,b)=>b[1].total-a[1].total).slice(0,20).map(([k, v]) =>
      [pad(k, 18), pad(v.total, 8), pad(pct(v.beat, v.total), 8), pad(pct(v.adjPos, v.total), 8)].join(' | ')
    ),
  );

  // ── Section 11: suspicious boosted groups ────────────────────────────────

  console.log('\n── 11. Suspicious boosted groups (adj>0 but beat% < neutral) ──────────────────');
  const neutralBeat = (byAdjDir['zero']?.beat ?? 0) / (byAdjDir['zero']?.total || 1);
  const suspect = [];

  for (const [niche, v] of Object.entries(adjPosByNiche)) {
    if (v.total >= 10 && (v.beat / v.total) < neutralBeat) {
      suspect.push({ dim: 'niche', key: niche, adjTotal: v.total, beat: pct(v.beat, v.total), neutral: pct(Math.round(neutralBeat * 100), 100) });
    }
  }
  for (const [cluster, v] of Object.entries(adjPosByCluster)) {
    if (v.total >= 10 && (v.beat / v.total) < neutralBeat) {
      suspect.push({ dim: 'cluster', key: cluster, adjTotal: v.total, beat: pct(v.beat, v.total), neutral: pct(Math.round(neutralBeat * 100), 100) });
    }
  }

  if (suspect.length) {
    printTable(
      [pad('Dim', 10), pad('Key', 20), pad('adj>0 cnt', 10), pad('Beat%', 8), pad('Neutral beat%', 14)],
      suspect.sort((a,b)=>b.adjTotal-a.adjTotal).slice(0,20).map(s =>
        [pad(s.dim, 10), pad(s.key, 20), pad(s.adjTotal, 10), pad(s.beat, 8), pad(s.neutral, 14)].join(' | ')
      ),
    );
  } else {
    console.log('\n  No suspicious groups with n>=10 found in this sample.');
  }

  // ── Section 12: subgroups with positive signal ───────────────────────────

  console.log('\n── 12. Subgroups with reliable positive signal (beat% > neutral + 3pp, n>=20) ─');
  const reliable = [];
  const THRESHOLD = neutralBeat + 0.03;

  const allDims = [
    ...Object.entries(byNiche).map(([k,v])=>({dim:'niche',k,v})),
    ...Object.entries(byCluster).map(([k,v])=>({dim:'cluster',k,v})),
    ...Object.entries(byTopicTier).map(([k,v])=>({dim:'tier',k,v})),
    ...Object.entries(bySatLevel).map(([k,v])=>({dim:'saturation',k,v})),
    ...Object.entries(byStage).map(([k,v])=>({dim:'stage',k,v})),
    ...Object.entries(byDurBucket).map(([k,v])=>({dim:'duration',k,v})),
    ...Object.entries(byConf).map(([k,v])=>({dim:'confidence',k,v})),
  ];

  for (const { dim, k, v } of allDims) {
    if (v.total >= 20 && v.beat / v.total >= THRESHOLD) {
      reliable.push({ dim, key: k, total: v.total, beatPct: v.beat / v.total, adjPosPct: v.adjPos / v.total });
    }
  }

  if (reliable.length) {
    printTable(
      [pad('Dim', 12), pad('Key', 20), pad('Total', 8), pad('Beat%', 8), pad('adj>0%', 8)],
      reliable.sort((a,b)=>b.beatPct-a.beatPct).map(r =>
        [pad(r.dim, 12), pad(r.key, 20), pad(r.total, 8), pad(pct(Math.round(r.beatPct*100),100), 8), pad(pct(Math.round(r.adjPosPct*100),100), 8)].join(' | ')
      ),
    );
  } else {
    console.log('\n  No subgroups exceed neutral+3pp threshold. Signal is flat across all dimensions.');
  }

  console.log('\n── Summary ──────────────────────────────────────────────────────────────────────');
  console.log(`  Sample scored     : ${rows.length.toLocaleString()}`);
  console.log(`  Boosted rows      : ${boostedRows.length.toLocaleString()} (adj>0)`);
  console.log(`  Reliable signal   : ${reliable.length > 0 ? reliable.length + ' subgroup(s) found' : 'none found — adjustment needs redesign'}`);
  console.log(`  Suspicious boosts : ${suspect.length}`);
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
