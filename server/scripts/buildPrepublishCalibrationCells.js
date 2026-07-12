'use strict';

/*
  server/scripts/buildPrepublishCalibrationCells.js

  Historical calibration backtest — not live user validation.

  Builds prepublish_calibration_cells from the full historical corpus.
  Train / holdout split: older 80% of unique videos by published_at → train,
  newer 20% → holdout. All snapshot buckets (1d / 7d / 14d) for a given video
  stay in the same split to prevent data leakage.

  Usage:
    node server/scripts/buildPrepublishCalibrationCells.js
*/

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }                  = require('../db/init');
const { classifyDurationBucket } = require('../db/queries');
const { classifyHookTypeMulti }  = require('../services/hookClassifier');

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE     = 5_000;
const BUCKETS        = ['1d', '7d', '14d'];
const TRAIN_RATIO    = 0.80;
const PROGRESS_EVERY = 20_000;

// Lifecycle stage → saturation level mapping (mirrors prepublishIntelligence.js)
const STAGE_SAT_LEVEL = {
  pre_topic: 'low',
  seed:      'low',
  early:     'low',
  regular:   'medium',
  exiting:   'high',
  saturated: 'very_high',
};

// Seed centroid texts for cluster fallback (mirrors semanticClusterService.js)
const SEED_CENTROID_TEXTS = {
  curiosity:      'what happens why nobody knows secret hidden truth revealed real reason behind',
  fear:           'stop avoid danger warning biggest mistake ruining destroying never should',
  authority:      'doctor expert scientist proven research study reveals according science facts',
  controversy:    'controversial debate unpopular opinion wrong everyone disagrees truth exposed',
  transformation: 'before after transformation journey changed completely progress results weeks months',
  tutorial:       'how to learn step guide beginner complete walkthrough tutorial course explained',
  urgency:        'now today immediately before too late last chance hurry urgent this week',
  challenge:      'challenge days week month impossible extreme hardest attempted tried result',
  myth:           'myth reality truth wrong misconception debunked actually really not true',
  reaction:       'react reaction watching first time trying unboxing reviewing response',
  comparison:     'vs versus better worse comparison which best choose between two options',
  list:           'top reasons ways things tips signs facts mistakes habits steps tricks',
  mistake:        'mistake error wrong fail avoid common biggest never make this again',
  secret:         'secret nobody tells hidden truth unknown underground forbidden revealed',
};

// Pre-tokenise centroid texts once for fast matching
const SEED_TOKENS = Object.entries(SEED_CENTROID_TEXTS).map(([cluster, text]) => ({
  cluster,
  tokens: text.split(/\s+/).filter(t => t.length > 3),
}));

// ── Cell-level definitions ─────────────────────────────────────────────────────
// Dimension order used in every cell key — must be stable.
const ALL_DIMS = [
  'calibNiche', 'routingProfile', 'formatProfile',
  'cluster', 'lifecycleStage', 'saturationLevel',
  'durationBucket', 'topicTier',
];

const CELL_LEVELS = [
  { level: 1, dims: new Set(['calibNiche', 'routingProfile', 'formatProfile', 'cluster', 'lifecycleStage', 'saturationLevel', 'durationBucket', 'topicTier']) },
  { level: 2, dims: new Set(['calibNiche', 'cluster', 'lifecycleStage', 'saturationLevel']) },
  { level: 3, dims: new Set(['calibNiche', 'cluster', 'lifecycleStage']) },
  { level: 4, dims: new Set(['calibNiche', 'cluster']) },
  { level: 5, dims: new Set(['calibNiche', 'lifecycleStage']) },
  { level: 6, dims: new Set(['calibNiche']) },
];

function buildCellKey(level, dims) {
  const { dims: included } = CELL_LEVELS[level - 1];
  return ALL_DIMS.map(d => (included.has(d) ? (dims[d] ?? '_') : '_')).join('|');
}

// A row is only added to a level when ALL the level's required dims are non-null.
function isEligibleForLevel(level, dims) {
  for (const d of CELL_LEVELS[level - 1].dims) {
    if (dims[d] == null) return false;
  }
  return true;
}

// ── Adjustment thresholds ──────────────────────────────────────────────────────

const MIN_N_POSITIVE  = 100;
const MIN_N_NEGATIVE  = 50;
const MIN_LIFT_POS    = 0.05;
const MIN_LIFT_NEG    = -0.04;
const MIN_CONSISTENT  = 2;

// ── Preload maps ──────────────────────────────────────────────────────────────

function buildChannelMap(db) {
  const rows = db.all(`
    SELECT channel_id, niche, primary_niche, routing_profile, format_profile
    FROM ingested_channels
  `);
  const map = {};
  for (const r of rows) map[r.channel_id] = r;
  return map;
}

function buildCorpusClusterMap(db) {
  // ~9K entries from full corpus semantic embeddings
  const rows = db.all(`
    SELECT source_id AS video_id, semantic_cluster AS cluster
    FROM semantic_embeddings
    WHERE source_type = 'title_dna' AND semantic_cluster IS NOT NULL
  `);
  const map = {};
  for (const r of rows) map[r.video_id] = r.cluster;
  return map;
}

function buildLifecycleMap(db) {
  // Longest phrase first so keyword matching prefers the most specific match
  const rows = db.all(`
    SELECT channel_id, phrase, stage
    FROM creator_topic_lifecycle
    WHERE phrase IS NOT NULL AND stage IS NOT NULL
    ORDER BY length(phrase) DESC
  `);
  const map = {};
  for (const r of rows) {
    if (!map[r.channel_id]) map[r.channel_id] = [];
    map[r.channel_id].push({ phrase: r.phrase.toLowerCase(), stage: r.stage });
  }
  return map;
}

function buildTopicMap(db) {
  // Highest signal_score first so we match the most relevant topic
  const rows = db.all(`
    SELECT niche, topic, signal_tier
    FROM topic_signal_stats
    WHERE topic IS NOT NULL AND signal_tier IS NOT NULL
    ORDER BY signal_score DESC
  `);
  const map = {};
  for (const r of rows) {
    if (!map[r.niche]) map[r.niche] = [];
    map[r.niche].push({ topic: r.topic.toLowerCase(), tier: r.signal_tier });
  }
  return map;
}

function buildNicheMedianMaps(db) {
  const rows = db.all(`
    SELECT niche, duration_bucket, bucket, median_vph, p75_vph
    FROM niche_benchmarks
    WHERE median_vph IS NOT NULL
  `);
  const medianMap = {}, p75Map = {};
  for (const r of rows) {
    const key = `${r.niche}|${r.duration_bucket}|${r.bucket}`;
    medianMap[key] = r.median_vph;
    p75Map[key]    = r.p75_vph;
  }
  return { medianMap, p75Map };
}

// ── Cluster name resolution (DB-free for non-corpus videos) ──────────────────

function resolveClusterName(videoId, title, corpusMap, titleCache) {
  if (corpusMap[videoId]) return corpusMap[videoId];
  if (titleCache.has(title)) return titleCache.get(title);

  let cluster = null;
  try {
    const cls = classifyHookTypeMulti(title);
    if (cls?.primary_hook && cls.primary_hook !== 'unknown') {
      cluster = cls.primary_hook;
    } else {
      // Seed centroid fallback
      const tl = title.toLowerCase();
      let best = null, bestScore = 0;
      for (const { cluster: c, tokens } of SEED_TOKENS) {
        const score = tokens.reduce((s, t) => s + (tl.includes(t) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (bestScore > 0) cluster = best;
    }
  } catch (_) {}

  titleCache.set(title, cluster);
  return cluster;
}

// ── Dimension extraction ──────────────────────────────────────────────────────

function extractDimensions(row, channelMap, corpusClusterMap, lifecycleMap, topicMap, titleClusterCache) {
  const ch = channelMap[row.channel_id] ?? {};

  const calibNiche     = ch.routing_profile || ch.primary_niche || row.niche;
  const routingProfile = ch.routing_profile ?? null;
  const formatProfile  = ch.format_profile  ?? null;
  const durationBucket = classifyDurationBucket(row.duration_seconds);

  const cluster = resolveClusterName(row.video_id, row.title ?? '', corpusClusterMap, titleClusterCache);

  const titleLower   = (row.title ?? '').toLowerCase();
  const lcPhrases    = lifecycleMap[row.channel_id] ?? [];
  const lcMatch      = lcPhrases.find(p => titleLower.includes(p.phrase));
  const lifecycleStage = lcMatch?.stage ?? null;
  const saturationLevel = lifecycleStage ? (STAGE_SAT_LEVEL[lifecycleStage] ?? null) : null;

  const topicEntries = topicMap[row.niche] ?? [];
  const topicMatch   = topicEntries.find(t => titleLower.includes(t.topic));
  const topicTier    = topicMatch?.tier ?? null;

  return { calibNiche, routingProfile, formatProfile, durationBucket, cluster, lifecycleStage, saturationLevel, topicTier };
}

// ── Load all eligible rows via cursor pagination ───────────────────────────────

function loadAllRows(db) {
  const rows = [];
  for (const bucket of BUCKETS) {
    let cursor = '', count = 0;
    process.stdout.write(`  Loading ${bucket}…`);
    while (true) {
      const batch = db.all(`
        SELECT iv.youtube_video_id  AS video_id,
               iv.channel_id,
               iv.niche,
               iv.title,
               iv.duration_seconds,
               iv.published_at,
               '${bucket}'                       AS bucket,
               vgs.views_per_hour                AS vph,
               vgs.subscriber_adjusted_velocity  AS sav
        FROM ingested_videos iv
        JOIN video_growth_snapshots vgs
          ON vgs.video_id = iv.youtube_video_id
         AND vgs.bucket   = '${bucket}'
         AND vgs.views_per_hour IS NOT NULL
        WHERE iv.niche IS NOT NULL AND iv.niche != ''
          AND iv.is_short = 0
          AND iv.youtube_video_id > ?
        ORDER BY iv.youtube_video_id
        LIMIT ?
      `, [cursor, BATCH_SIZE]);
      if (!batch.length) break;
      rows.push(...batch);
      count  += batch.length;
      cursor  = batch[batch.length - 1].video_id;
      process.stdout.write(`\r  Loading ${bucket}… ${count.toLocaleString()} rows`);
      if (batch.length < BATCH_SIZE) break;
    }
    console.log(`\r  Loaded  ${bucket}: ${count.toLocaleString()} rows`);
  }
  return rows;
}

// ── Train / holdout split by published_at ─────────────────────────────────────
// All snapshot buckets for the same video_id stay together in the same split.

function buildSplitSets(rows) {
  const videoDateMap = {};
  for (const r of rows) {
    if (!videoDateMap[r.video_id]) videoDateMap[r.video_id] = r.published_at ?? '';
  }
  const sorted    = Object.entries(videoDateMap).sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  const cutoffIdx = Math.floor(sorted.length * TRAIN_RATIO);
  const trainSet   = new Set(sorted.slice(0, cutoffIdx).map(([vid]) => vid));
  const holdoutSet = new Set(sorted.slice(cutoffIdx).map(([vid]) => vid));
  const cutoffDate = sorted[cutoffIdx]?.[1] ?? 'unknown';
  return { trainSet, holdoutSet, cutoffDate };
}

// ── Cell accumulator factory ──────────────────────────────────────────────────

function makeAccum(level, dims) {
  return {
    level,
    calibNiche:     dims.calibNiche,
    rawNiche:       null,
    routingProfile: CELL_LEVELS[level - 1].dims.has('routingProfile') ? dims.routingProfile : null,
    formatProfile:  CELL_LEVELS[level - 1].dims.has('formatProfile')  ? dims.formatProfile  : null,
    cluster:        CELL_LEVELS[level - 1].dims.has('cluster')         ? dims.cluster         : null,
    lifecycleStage: CELL_LEVELS[level - 1].dims.has('lifecycleStage')  ? dims.lifecycleStage  : null,
    saturationLevel:CELL_LEVELS[level - 1].dims.has('saturationLevel') ? dims.saturationLevel : null,
    durationBucket: CELL_LEVELS[level - 1].dims.has('durationBucket')  ? dims.durationBucket  : null,
    topicTier:      CELL_LEVELS[level - 1].dims.has('topicTier')        ? dims.topicTier        : null,
    beats_1d: 0,  total_1d: 0,
    beats_7d: 0,  total_7d: 0,
    beats_14d: 0, total_14d: 0,
    p75_beats_7d: 0, p75_total_7d: 0,
    sav_sum_7d: 0, sav_count_7d: 0,
  };
}

// ── Confidence ────────────────────────────────────────────────────────────────

function computeConfidence(n7d, lift7d, posConsistent, negConsistent) {
  if (lift7d == null) return 'none';
  const relevant = lift7d >= 0 ? posConsistent : negConsistent;
  const absLift  = Math.abs(lift7d);
  if (n7d >= 200 && relevant >= 3 && absLift >= 0.05) return 'high';
  if (n7d >= 100 && relevant >= 2 && absLift >= 0.03) return 'medium';
  if (n7d >= 50  && relevant >= 1 && absLift >= 0.02) return 'low';
  return 'none';
}

function computeEmpiricalAdj(confidence, n7d, lift, posConsistent, negConsistent) {
  if (!['medium', 'high'].includes(confidence)) return 0;
  if (lift >= MIN_LIFT_POS && n7d >= MIN_N_POSITIVE && posConsistent >= MIN_CONSISTENT) {
    return Math.min(8, Math.round(lift * 60));
  }
  if (lift <= MIN_LIFT_NEG && n7d >= MIN_N_NEGATIVE && negConsistent >= MIN_CONSISTENT) {
    return Math.max(-6, -Math.round(Math.abs(lift) * 50));
  }
  return 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const pad  = (s, n) => { const str = String(s ?? '—'); return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length); };
const pct  = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');

// ── Validation simulation ─────────────────────────────────────────────────────

function lookupCell(dims, cellLookup) {
  for (const { level } of CELL_LEVELS) {
    const key  = buildCellKey(level, dims);
    const cell = cellLookup.get(key);
    if (cell && ['medium', 'high'].includes(cell.calibration_confidence)) {
      return { cell, level };
    }
  }
  return { cell: null, level: 7 };
}

function runValidation(rows7d, dims7d, cellLookup, medianMap) {
  const byAdj    = { pos: { beat: 0, miss: 0 }, zero: { beat: 0, miss: 0 }, neg: { beat: 0, miss: 0 } };
  const levelCnt = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };

  for (let i = 0; i < rows7d.length; i++) {
    const row  = rows7d[i];
    const dims = dims7d[i];
    const nicheMedian = medianMap[`${row.niche}|${dims.durationBucket}|7d`] ?? null;
    const beatMedian  = (nicheMedian != null && nicheMedian > 0 && row.vph != null)
      ? row.vph > nicheMedian : null;
    if (beatMedian == null) continue;

    const { cell, level } = lookupCell(dims, cellLookup);
    levelCnt[level]++;

    const adj = cell?.empirical_adjustment ?? 0;
    const key = adj > 0 ? 'pos' : adj < 0 ? 'neg' : 'zero';
    byAdj[key][beatMedian ? 'beat' : 'miss']++;
  }
  return { byAdj, levelCnt };
}

function printMonotonicity(label, byAdj) {
  const negT  = byAdj.neg.beat  + byAdj.neg.miss;
  const zeroT = byAdj.zero.beat + byAdj.zero.miss;
  const posT  = byAdj.pos.beat  + byAdj.pos.miss;
  const negR  = negT  ? byAdj.neg.beat  / negT  : null;
  const zeroR = zeroT ? byAdj.zero.beat / zeroT : null;
  const posR  = posT  ? byAdj.pos.beat  / posT  : null;

  console.log(`\n── ${label} monotonicity (adj>0 beat% > adj=0 beat% > adj<0 beat%) ──`);
  const H = [pad('Direction', 10), pad('N', 8), pad('Beat%', 8)].join(' | ');
  console.log(`\n  ${H}`);
  console.log('  ' + '─'.repeat(H.length));
  console.log('  ' + [pad('adj < 0', 10), pad(negT,  8), pad(pct(byAdj.neg.beat,  negT),  8)].join(' | '));
  console.log('  ' + [pad('adj = 0', 10), pad(zeroT, 8), pad(pct(byAdj.zero.beat, zeroT), 8)].join(' | '));
  console.log('  ' + [pad('adj > 0', 10), pad(posT,  8), pad(pct(byAdj.pos.beat,  posT),  8)].join(' | '));

  const mono = (posR != null && zeroR != null && negR != null)
    ? (posR > zeroR && zeroR > negR
        ? 'PASS ✓'
        : posR > negR
          ? 'PARTIAL (pos > neg but zero not ordered)'
          : 'FAIL ✗')
    : 'INSUFFICIENT DATA';
  console.log(`\n  Result: ${mono}`);
  return { posR, zeroR, negR, mono };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();

  console.log('\n── Historical calibration backtest — not live user validation. ────────────────');
  console.log('  Building prepublish_calibration_cells from full historical corpus.');
  console.log(`  Train / holdout: ${Math.round(TRAIN_RATIO * 100)}% / ${Math.round((1 - TRAIN_RATIO) * 100)}% split by published_at`);
  console.log('');

  // ── Preload reference maps ───────────────────────────────────────────────────

  console.log('  Preloading reference maps…');
  const channelMap      = buildChannelMap(db);
  const corpusClusterMap = buildCorpusClusterMap(db);
  const lifecycleMap    = buildLifecycleMap(db);
  const topicMap        = buildTopicMap(db);
  const { medianMap, p75Map } = buildNicheMedianMaps(db);
  const titleClusterCache = new Map();

  console.log(`    Channels loaded       : ${Object.keys(channelMap).length.toLocaleString()}`);
  console.log(`    Corpus clusters       : ${Object.keys(corpusClusterMap).length.toLocaleString()}`);
  console.log(`    Lifecycle channels    : ${Object.keys(lifecycleMap).length.toLocaleString()}`);
  console.log(`    Niche topic maps      : ${Object.keys(topicMap).length.toLocaleString()}`);
  console.log(`    Niche median entries  : ${Object.keys(medianMap).length.toLocaleString()}`);
  console.log('');

  // ── Load rows ────────────────────────────────────────────────────────────────

  console.log('  Loading eligible video rows…');
  const allRows = loadAllRows(db);
  const uVideos = new Set(allRows.map(r => r.video_id)).size;
  console.log(`  Total rows: ${allRows.length.toLocaleString()} | Unique videos: ${uVideos.toLocaleString()}`);
  console.log('');

  // ── Train / holdout split ────────────────────────────────────────────────────

  const { trainSet, holdoutSet, cutoffDate } = buildSplitSets(allRows);
  const trainRows   = allRows.filter(r => trainSet.has(r.video_id));
  const holdoutRows = allRows.filter(r => holdoutSet.has(r.video_id));
  console.log(`  Train  videos : ${trainSet.size.toLocaleString()} (published before ${cutoffDate.slice(0, 10)})`);
  console.log(`  Holdout videos: ${holdoutSet.size.toLocaleString()} (published on/after ${cutoffDate.slice(0, 10)})`);
  console.log(`  Train  rows   : ${trainRows.length.toLocaleString()}`);
  console.log(`  Holdout rows  : ${holdoutRows.length.toLocaleString()}`);
  console.log('');

  // ── Process train rows: extract dims + accumulate ────────────────────────────

  console.log('  Extracting dimensions and accumulating cells (train set)…');

  const cellAccums  = {};   // cell_key → accum object
  const nicheAccums = {};   // `calibNiche|bucket` → { beats, total }

  // Pre-computed dims for train rows reused in validation
  const trainDimsCache = new Array(trainRows.length);

  let processed = 0;
  for (let ri = 0; ri < trainRows.length; ri++) {
    const row  = trainRows[ri];
    const dims = extractDimensions(row, channelMap, corpusClusterMap, lifecycleMap, topicMap, titleClusterCache);
    trainDimsCache[ri] = dims;

    const mKey       = `${row.niche}|${dims.durationBucket}|${row.bucket}`;
    const nicheMedian = medianMap[mKey] ?? null;
    const beatMedian  = (nicheMedian != null && nicheMedian > 0 && row.vph != null)
      ? row.vph > nicheMedian : null;
    const p75Thresh   = (row.bucket === '7d') ? (p75Map[`${row.niche}|${dims.durationBucket}|7d`] ?? null) : null;
    const beatP75     = (p75Thresh != null && row.vph != null) ? row.vph > p75Thresh : null;

    // Niche baseline accumulation
    const nKey = `${dims.calibNiche}|${row.bucket}`;
    if (!nicheAccums[nKey]) nicheAccums[nKey] = { beats: 0, total: 0 };
    if (beatMedian != null) {
      nicheAccums[nKey].total++;
      if (beatMedian) nicheAccums[nKey].beats++;
    }

    // Cell accumulation — only for levels where required dims are all non-null
    for (const { level } of CELL_LEVELS) {
      if (!isEligibleForLevel(level, dims)) continue;
      const key = buildCellKey(level, dims);
      if (!cellAccums[key]) {
        const acc = makeAccum(level, dims);
        acc.rawNiche = row.niche;
        cellAccums[key] = acc;
      }
      const acc = cellAccums[key];
      if (beatMedian == null) continue;
      if (row.bucket === '1d') { acc.total_1d++;  if (beatMedian) acc.beats_1d++; }
      else if (row.bucket === '7d') {
        acc.total_7d++;
        if (beatMedian) acc.beats_7d++;
        if (row.sav != null) { acc.sav_sum_7d += row.sav; acc.sav_count_7d++; }
        if (beatP75 != null) { acc.p75_total_7d++; if (beatP75) acc.p75_beats_7d++; }
      }
      else if (row.bucket === '14d') { acc.total_14d++; if (beatMedian) acc.beats_14d++; }
    }

    processed++;
    if (processed % PROGRESS_EVERY === 0) {
      process.stdout.write(`\r  Processed: ${processed.toLocaleString()} / ${trainRows.length.toLocaleString()}`);
    }
  }
  console.log(`\r  Processed: ${processed.toLocaleString()} / ${trainRows.length.toLocaleString()}`);
  console.log('');

  // ── Compute niche baselines ───────────────────────────────────────────────────

  const baseline = {};  // calibNiche|bucket → rate
  for (const [key, { beats, total }] of Object.entries(nicheAccums)) {
    baseline[key] = total > 0 ? beats / total : null;
  }
  const nicheCount7d = Object.keys(nicheAccums).filter(k => k.endsWith('|7d') && baseline[k] != null).length;
  console.log(`  Niche baselines computed: ${nicheCount7d} niches (7d)`);

  // ── Compute per-cell stats, confidence, empirical_adjustment ─────────────────

  console.log('  Computing cell statistics…');
  const cells = [];

  for (const [key, acc] of Object.entries(cellAccums)) {
    const b7d  = baseline[`${acc.calibNiche}|7d`]  ?? null;
    const b1d  = baseline[`${acc.calibNiche}|1d`]  ?? null;
    const b14d = baseline[`${acc.calibNiche}|14d`] ?? null;

    const bmr7d  = acc.total_7d  > 0 ? acc.beats_7d  / acc.total_7d  : null;
    const bmr1d  = acc.total_1d  > 0 ? acc.beats_1d  / acc.total_1d  : null;
    const bmr14d = acc.total_14d > 0 ? acc.beats_14d / acc.total_14d : null;

    const lift7d  = (bmr7d  != null && b7d  != null) ? bmr7d  - b7d  : null;
    const lift1d  = (bmr1d  != null && b1d  != null) ? bmr1d  - b1d  : null;
    const lift14d = (bmr14d != null && b14d != null) ? bmr14d - b14d : null;

    const lifts = [lift1d, lift7d, lift14d].filter(l => l != null);
    const posConsistent = lifts.filter(l => l > 0).length;
    const negConsistent = lifts.filter(l => l < 0).length;

    const confidence   = computeConfidence(acc.total_7d, lift7d, posConsistent, negConsistent);
    const empiricalAdj = (lift7d != null)
      ? computeEmpiricalAdj(confidence, acc.total_7d, lift7d, posConsistent, negConsistent)
      : 0;

    const p75Rate7d = acc.p75_total_7d > 0 ? acc.p75_beats_7d / acc.p75_total_7d : null;
    const avgSav7d  = acc.sav_count_7d  > 0 ? acc.sav_sum_7d  / acc.sav_count_7d  : null;

    cells.push({
      cell_key:                    key,
      cell_level:                  acc.level,
      niche:                       acc.calibNiche,
      raw_niche:                   acc.rawNiche,
      routing_profile:             acc.routingProfile,
      format_profile:              acc.formatProfile,
      semantic_cluster:            acc.cluster,
      lifecycle_stage:             acc.lifecycleStage,
      saturation_level:            acc.saturationLevel,
      duration_bucket:             acc.durationBucket,
      topic_signal_tier:           acc.topicTier,
      sample_size_1d:              acc.total_1d,
      sample_size_7d:              acc.total_7d,
      sample_size_14d:             acc.total_14d,
      beat_median_rate_1d:         bmr1d,
      beat_median_rate_7d:         bmr7d,
      beat_median_rate_14d:        bmr14d,
      beat_p75_rate_7d:            p75Rate7d,
      avg_sav_ratio_7d:            avgSav7d,
      baseline_niche_rate_7d:      b7d,
      lift_vs_baseline:            lift7d,
      lift_1d:                     lift1d,
      lift_14d:                    lift14d,
      positive_consistent_buckets: posConsistent,
      negative_consistent_buckets: negConsistent,
      calibration_confidence:      confidence,
      empirical_adjustment:        empiricalAdj,
      computed_at:                 Date.now(),
      backtest_rows_used:          acc.total_7d,
    });
  }

  const posCount  = cells.filter(c => c.empirical_adjustment > 0).length;
  const negCount  = cells.filter(c => c.empirical_adjustment < 0).length;
  const neutCount = cells.filter(c => c.empirical_adjustment === 0).length;
  console.log(`  Total cells computed: ${cells.length.toLocaleString()}`);
  console.log(`  Positive adj: ${posCount}  |  Negative adj: ${negCount}  |  Neutral: ${neutCount}`);
  console.log('');

  // ── Upsert into DB ────────────────────────────────────────────────────────────

  console.log('  Writing cells to DB…');
  const SQL = `
    INSERT OR REPLACE INTO prepublish_calibration_cells (
      cell_key, cell_level, niche, raw_niche, routing_profile, format_profile,
      semantic_cluster, lifecycle_stage, saturation_level, duration_bucket, topic_signal_tier,
      sample_size_1d, sample_size_7d, sample_size_14d,
      beat_median_rate_1d, beat_median_rate_7d, beat_median_rate_14d,
      beat_p75_rate_7d, avg_sav_ratio_7d,
      baseline_niche_rate_7d, lift_vs_baseline, lift_1d, lift_14d,
      positive_consistent_buckets, negative_consistent_buckets,
      calibration_confidence, empirical_adjustment,
      computed_at, backtest_rows_used
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?
    )`;

  const writeAll = db.transaction((batch) => {
    for (const c of batch) {
      db.run(SQL, [
        c.cell_key, c.cell_level, c.niche, c.raw_niche, c.routing_profile, c.format_profile,
        c.semantic_cluster, c.lifecycle_stage, c.saturation_level, c.duration_bucket, c.topic_signal_tier,
        c.sample_size_1d, c.sample_size_7d, c.sample_size_14d,
        c.beat_median_rate_1d, c.beat_median_rate_7d, c.beat_median_rate_14d,
        c.beat_p75_rate_7d, c.avg_sav_ratio_7d,
        c.baseline_niche_rate_7d, c.lift_vs_baseline, c.lift_1d, c.lift_14d,
        c.positive_consistent_buckets, c.negative_consistent_buckets,
        c.calibration_confidence, c.empirical_adjustment,
        c.computed_at, c.backtest_rows_used,
      ]);
    }
  });
  writeAll(cells);

  // Global beat rate for meta row (average of niche-only Level-6 cells)
  const l6cells = cells.filter(c => c.cell_level === 6 && c.beat_median_rate_7d != null);
  const globalBeatRate = l6cells.length
    ? l6cells.reduce((s, c) => s + c.beat_median_rate_7d, 0) / l6cells.length
    : null;

  db.run(`
    INSERT INTO prepublish_calibration_meta (
      run_at, total_cells, total_rows_processed, global_beat_rate_7d,
      niche_count, cells_with_positive, cells_with_negative, cells_neutral,
      min_sample_positive, min_sample_negative, min_lift_positive, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    Date.now(), cells.length, trainRows.length, globalBeatRate,
    nicheCount7d, posCount, negCount, neutCount,
    MIN_N_POSITIVE, MIN_N_NEGATIVE, MIN_LIFT_POS,
    `Train: ${trainSet.size} videos, Holdout: ${holdoutSet.size} videos, cutoff: ${cutoffDate.slice(0, 10)}`,
  ]);

  console.log(`  ✓ ${cells.length.toLocaleString()} cells written`);
  console.log('');

  // ── Validation ────────────────────────────────────────────────────────────────

  console.log('── Validation ────────────────────────────────────────────────────────────────');

  // Fast in-memory lookup map (cell_key → cell)
  const cellLookup = new Map(cells.map(c => [c.cell_key, c]));

  // Pre-compute dims for holdout rows
  console.log(`\n  Pre-extracting holdout dimensions (${holdoutRows.length.toLocaleString()} rows)…`);
  const holdoutDimsCache = new Array(holdoutRows.length);
  for (let i = 0; i < holdoutRows.length; i++) {
    holdoutDimsCache[i] = extractDimensions(
      holdoutRows[i], channelMap, corpusClusterMap, lifecycleMap, topicMap, titleClusterCache,
    );
  }

  // Filter to 7d only for clear monotonicity test
  const train7d     = [], trainDims7d     = [];
  const holdout7d   = [], holdoutDims7d   = [];
  for (let i = 0; i < trainRows.length;   i++) { if (trainRows[i].bucket   === '7d') { train7d.push(trainRows[i]);     trainDims7d.push(trainDimsCache[i]);    } }
  for (let i = 0; i < holdoutRows.length; i++) { if (holdoutRows[i].bucket === '7d') { holdout7d.push(holdoutRows[i]); holdoutDims7d.push(holdoutDimsCache[i]); } }

  console.log(`  Train  7d rows: ${train7d.length.toLocaleString()}`);
  console.log(`  Holdout 7d rows: ${holdout7d.length.toLocaleString()}`);

  const trainVal   = runValidation(train7d,   trainDims7d,   cellLookup, medianMap);
  const holdoutVal = runValidation(holdout7d, holdoutDims7d, cellLookup, medianMap);

  const trainM   = printMonotonicity('Train set',   trainVal.byAdj);
  const holdoutM = printMonotonicity('Holdout set', holdoutVal.byAdj);

  // ── Level fallback distribution (train 7d) ─────────────────────────────────
  console.log('\n── Level fallback distribution (train 7d) ──────────────────────────────────');
  const trainLevelTotal = Object.values(trainVal.levelCnt).reduce((a, b) => a + b, 0);
  for (let lv = 1; lv <= 7; lv++) {
    const n   = trainVal.levelCnt[lv] ?? 0;
    const lbl = lv === 7 ? 'Level 7 — global neutral' : `Level ${lv}`;
    console.log(`  ${lbl}: ${n.toLocaleString()} (${pct(n, trainLevelTotal)})`);
  }

  // ── Top positive cells ─────────────────────────────────────────────────────
  console.log('\n── Top 10 positive cells (by lift, min n=100) ──────────────────────────────');
  cells
    .filter(c => c.empirical_adjustment > 0 && c.sample_size_7d >= 100)
    .sort((a, b) => (b.lift_vs_baseline ?? 0) - (a.lift_vs_baseline ?? 0))
    .slice(0, 10)
    .forEach(c => {
      const lift = c.lift_vs_baseline != null ? (c.lift_vs_baseline * 100).toFixed(1) + 'pp' : '—';
      console.log(`  [L${c.cell_level}] adj=+${c.empirical_adjustment} | lift=${lift} | n=${c.sample_size_7d} | conf=${c.calibration_confidence}`);
      console.log(`       ${c.cell_key}`);
    });

  // ── Top negative cells ─────────────────────────────────────────────────────
  console.log('\n── Top 10 negative cells (by lift, min n=50) ───────────────────────────────');
  cells
    .filter(c => c.empirical_adjustment < 0 && c.sample_size_7d >= 50)
    .sort((a, b) => (a.lift_vs_baseline ?? 0) - (b.lift_vs_baseline ?? 0))
    .slice(0, 10)
    .forEach(c => {
      const lift = c.lift_vs_baseline != null ? (c.lift_vs_baseline * 100).toFixed(1) + 'pp' : '—';
      console.log(`  [L${c.cell_level}] adj=${c.empirical_adjustment} | lift=${lift} | n=${c.sample_size_7d} | conf=${c.calibration_confidence}`);
      console.log(`       ${c.cell_key}`);
    });

  // ── Holdout failures ───────────────────────────────────────────────────────
  console.log('\n── Holdout failures (train adj>0 but holdout beat < niche baseline) ─────────');
  const holdoutCellAcc = {};
  for (let i = 0; i < holdout7d.length; i++) {
    const row  = holdout7d[i];
    const dims = holdoutDims7d[i];
    const nMedian = medianMap[`${row.niche}|${dims.durationBucket}|7d`] ?? null;
    const beat    = (nMedian != null && nMedian > 0 && row.vph != null) ? row.vph > nMedian : null;
    if (beat == null) continue;
    const { cell } = lookupCell(dims, cellLookup);
    if (!cell || cell.empirical_adjustment <= 0) continue;
    if (!holdoutCellAcc[cell.cell_key]) holdoutCellAcc[cell.cell_key] = { beats: 0, total: 0, cell };
    holdoutCellAcc[cell.cell_key].total++;
    if (beat) holdoutCellAcc[cell.cell_key].beats++;
  }

  const failures = [];
  for (const { beats, total, cell } of Object.values(holdoutCellAcc)) {
    if (total < 20) continue;
    const hRate = beats / total;
    if (hRate < (cell.baseline_niche_rate_7d ?? 0)) {
      failures.push({ hRate, cell, total });
    }
  }
  failures.sort((a, b) => a.hRate - b.hRate);

  if (!failures.length) {
    console.log('  None — all adj>0 cells with holdout n≥20 have positive holdout lift. ✓');
  } else {
    for (const { hRate, cell, total } of failures.slice(0, 10)) {
      console.log(`  [L${cell.cell_level}] holdout_beat=${(hRate * 100).toFixed(1)}% | train_beat=${(cell.beat_median_rate_7d * 100).toFixed(1)}% | baseline=${((cell.baseline_niche_rate_7d ?? 0) * 100).toFixed(1)}% | holdout_n=${total} | adj=+${cell.empirical_adjustment}`);
      console.log(`       ${cell.cell_key}`);
    }
    if (failures.length > 10) console.log(`  … and ${failures.length - 10} more`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────────────────────────');
  console.log(`  Train videos        : ${trainSet.size.toLocaleString()}`);
  console.log(`  Holdout videos      : ${holdoutSet.size.toLocaleString()}`);
  console.log(`  Total cells built   : ${cells.length.toLocaleString()}`);
  console.log(`  Positive adj cells  : ${posCount}`);
  console.log(`  Negative adj cells  : ${negCount}`);
  console.log(`  Neutral cells       : ${neutCount}`);
  console.log(`  Train monotonicity  : ${trainM.mono}`);
  console.log(`  Holdout monotonicity: ${holdoutM.mono}`);
  console.log(`  Holdout failures    : ${failures.length}`);
  console.log('');

  const monoPass = holdoutM.mono.startsWith('PASS') || holdoutM.mono.startsWith('PARTIAL');
  if (holdoutM.mono.startsWith('PASS') && failures.length === 0) {
    console.log('  Phase 2B shadow mode: SAFE ✓');
    console.log('  → Empirical adj validated on held-out data. Shadow wiring recommended.');
  } else if (monoPass && failures.length > 0) {
    console.log(`  Phase 2B shadow mode: CONDITIONAL (${failures.length} holdout failure${failures.length > 1 ? 's' : ''})`);
    console.log('  → Monotonicity passes but some cells invert on holdout. Review failures above.');
  } else {
    console.log('  Phase 2B shadow mode: NOT RECOMMENDED ✗');
    console.log('  → Holdout monotonicity does not pass. Investigate thresholds or coverage.');
  }
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
