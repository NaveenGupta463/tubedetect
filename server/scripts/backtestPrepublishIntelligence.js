'use strict';

// Calibration backtest — in-sample, not held-out.
// Evaluates PrePublish intelligence scoring against observed VPH outcomes.
// Usage:
//   node server/scripts/backtestPrepublishIntelligence.js
//   node server/scripts/backtestPrepublishIntelligence.js --limit 500
//   node server/scripts/backtestPrepublishIntelligence.js --limit all --balanced --buckets 1d,7d,14d
//   node server/scripts/backtestPrepublishIntelligence.js --niche education --limit 1000

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb }                         = require('../db/init');
const { computePrepublishIntelligence } = require('../services/prepublishIntelligence');
const { classifyDurationBucket }        = require('../db/queries');

// ── CLI flags ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const FLAG_LIMIT  = getFlag('--limit',   'all');
const FLAG_BAL    = args.includes('--balanced');
const FLAG_NICHES = getFlag('--niche',   null);
const FLAG_BUCKS  = getFlag('--buckets', '1d,7d,14d');
const MAX_PER_CHAN = 20;  // balanced mode: max videos per channel per niche slot
const BATCH_SIZE  = 5000; // rows loaded per DB fetch in all-rows mode

function getFlag(name, def) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return def;
  return args[i + 1];
}

const LIMIT          = FLAG_LIMIT === 'all' ? Infinity : parseInt(FLAG_LIMIT, 10);
const TARGET_BUCKETS = FLAG_BUCKS.split(',').map(s => s.trim());
const NICHE_FILTER   = FLAG_NICHES ? FLAG_NICHES.split(',').map(s => s.trim().toLowerCase()) : null;

// ── Score buckets ──────────────────────────────────────────────────────────────

const SCORE_BUCKETS = [
  { label: '0–34',   lo: 0,  hi: 34  },
  { label: '35–49',  lo: 35, hi: 49  },
  { label: '50–64',  lo: 50, hi: 64  },
  { label: '65–74',  lo: 65, hi: 74  },
  { label: '75–100', lo: 75, hi: 100 },
];

function getBucket(score) {
  return SCORE_BUCKETS.find(b => score >= b.lo && score <= b.hi);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(s, n) {
  const str = String(s ?? '—');
  return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length);
}

function pct(a, b) {
  if (!b) return '—';
  return (100 * a / b).toFixed(1) + '%';
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : +(num / denom).toFixed(3);
}

// ── Pre-compute niche median map ──────────────────────────────────────────────
// Key: "niche|duration_bucket" → median_vph
// Avoids a JOIN per video during the eligibility load query.

function buildNicheMedianMap(db) {
  const rows = db.all(`SELECT niche, duration_bucket, median_vph FROM niche_benchmarks WHERE bucket = '7d'`);
  const map  = {};
  for (const r of rows) map[`${r.niche}|${r.duration_bucket}`] = r.median_vph;
  return map;
}

function getNicheMedian(map, niche, duration_seconds) {
  const dur = classifyDurationBucket(duration_seconds);
  return map[`${niche}|${dur}`] ?? null;
}

// ── Build eligibility base query ──────────────────────────────────────────────

function buildBaseQuery(bucket) {
  const nicheFilter = NICHE_FILTER
    ? `AND LOWER(iv.niche) IN (${NICHE_FILTER.map(() => '?').join(',')})`
    : '';
  const sql = `
    SELECT
      iv.youtube_video_id  AS video_id,
      iv.channel_id,
      iv.niche,
      iv.title,
      iv.duration_seconds,
      '${bucket}'          AS bucket,
      vgs.views_per_hour   AS vph,
      vgs.subscriber_adjusted_velocity AS sav
    FROM ingested_videos iv
    JOIN video_growth_snapshots vgs
      ON vgs.video_id = iv.youtube_video_id
     AND vgs.bucket = '${bucket}'
     AND vgs.views_per_hour IS NOT NULL
    WHERE iv.niche IS NOT NULL AND iv.niche != ''
      AND iv.is_short = 0
      ${nicheFilter}
  `;
  return { sql, params: NICHE_FILTER ?? [] };
}

// ── Load strategy ─────────────────────────────────────────────────────────────
// For finite LIMIT: use SQL random sampling per niche×bucket.
// For all + balanced: load per niche in batches, apply max-per-channel cap.
// For all + unbalanced: load in batches of BATCH_SIZE per bucket.

function loadFiniteSample(db, limitPerGroup) {
  const rows = [];
  for (const bucket of TARGET_BUCKETS) {
    const { sql, params } = buildBaseQuery(bucket);
    // Random sample, larger than needed so channel-cap has something to work with
    const overSample = Math.min(limitPerGroup * 5, 200000);
    const sampled = db.all(`${sql} ORDER BY RANDOM() LIMIT ?`, [...params, overSample]);
    rows.push(...sampled);
  }
  return rows;
}

function applyChannelCap(rows) {
  if (!FLAG_BAL) return rows;
  const groups = {};
  for (const r of rows) {
    const key = `${r.niche}|${r.bucket}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const result = [];
  for (const key of Object.keys(groups)) {
    const chanCount = {};
    for (const r of groups[key]) {
      chanCount[r.channel_id] = (chanCount[r.channel_id] ?? 0) + 1;
      if (chanCount[r.channel_id] <= MAX_PER_CHAN) result.push(r);
    }
  }
  return result;
}

function loadAllRows(db) {
  const rows = [];
  for (const bucket of TARGET_BUCKETS) {
    const { sql, params } = buildBaseQuery(bucket);
    const nicheFilter = NICHE_FILTER
      ? `AND LOWER(iv.niche) IN (${NICHE_FILTER.map(() => '?').join(',')})`
      : '';
    // Cursor-based pagination avoids O(N²) OFFSET scanning on large tables.
    let cursor = '';
    let bucketCount = 0;
    process.stdout.write(`  Loading ${bucket}…`);
    while (true) {
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
          AND iv.youtube_video_id > ?
          ${nicheFilter}
        ORDER BY iv.youtube_video_id
        LIMIT ?
      `, [cursor, ...(NICHE_FILTER ?? []), BATCH_SIZE]);
      if (!batch.length) break;
      rows.push(...batch);
      bucketCount += batch.length;
      cursor = batch[batch.length - 1].video_id;
      process.stdout.write(`\r  Loading ${bucket}… ${bucketCount.toLocaleString()} rows`);
      if (batch.length < BATCH_SIZE) break;
    }
    console.log(`\r  Loaded  ${bucket}: ${bucketCount.toLocaleString()} rows`);
  }
  return rows;
}

async function loadEligibleVideos(db) {
  let rows;
  if (!isFinite(LIMIT)) {
    console.log('  Loading all eligible videos in batches…');
    rows = loadAllRows(db);
    rows = applyChannelCap(rows);
  } else {
    const perGroup = Math.ceil(LIMIT / (TARGET_BUCKETS.length));
    rows = loadFiniteSample(db, perGroup);
    rows = applyChannelCap(rows);
    // Trim to LIMIT proportionally
    if (rows.length > LIMIT) {
      // Proportional trim by niche×bucket group
      const groups = {};
      for (const r of rows) {
        const k = `${r.niche}|${r.bucket}`;
        if (!groups[k]) groups[k] = [];
        groups[k].push(r);
      }
      const keys  = Object.keys(groups);
      const alloc = Math.max(1, Math.floor(LIMIT / keys.length));
      rows = keys.flatMap(k => groups[k].slice(0, alloc)).slice(0, LIMIT);
    }
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db          = getDb();
  const nicheMedian = buildNicheMedianMap(db);

  console.log('\n── Calibration backtest — in-sample, not held-out. ───────────────────────────');
  console.log(`  Buckets : ${TARGET_BUCKETS.join(', ')}`);
  console.log(`  Limit   : ${isFinite(LIMIT) ? LIMIT : 'all'}`);
  console.log(`  Balanced: ${FLAG_BAL}`);
  console.log(`  Niches  : ${NICHE_FILTER?.join(', ') ?? 'all'}`);
  console.log('');
  console.log('  Loading eligible videos…');

  const sampled = await loadEligibleVideos(db);

  const uVideos = new Set(sampled.map(r => r.video_id)).size;
  const uChans  = new Set(sampled.map(r => r.channel_id)).size;
  const uNiches = new Set(sampled.map(r => r.niche)).size;
  console.log(`  Sampled: ${sampled.length.toLocaleString()} rows | ${uVideos.toLocaleString()} unique videos | ${uChans.toLocaleString()} channels | ${uNiches} niches`);
  console.log('');

  if (!sampled.length) {
    console.log('  No eligible rows — nothing to backtest.');
    return;
  }

  // ── Score every row ──────────────────────────────────────────────────────────

  console.log('  Scoring…');

  const byBucket   = {}; // bucket → { fitScores, beatArr, adjDir, savCovered }
  const byNiche    = {}; // niche  → { fitScores, beatArr }
  const allFit     = [], allBeat = [];
  const adjHitRate = { neg: { beat: 0, miss: 0 }, zero: { beat: 0, miss: 0 }, pos: { beat: 0, miss: 0 } };
  const bucketGrid = {}; // bucket → scoreBucket.label → { beat: 0, total: 0 }

  let processed = 0;
  const PROGRESS_EVERY = 500;

  for (const row of sampled) {
    const intel = await computePrepublishIntelligence(db, {
      title:            row.title,
      niche:            row.niche,
      channel_id:       row.channel_id,
      duration_seconds: row.duration_seconds,
    });

    const fitScore  = intel.intelligence_fit_score;
    const dataAdj   = intel.data_adjustment;
    const nicheM    = getNicheMedian(nicheMedian, row.niche, row.duration_seconds);
    const beatMedian = (nicheM != null && nicheM > 0 && row.vph != null)
      ? row.vph > nicheM
      : null;
    const savCovered = row.sav != null;

    // Per-bucket accumulation
    if (!byBucket[row.bucket]) byBucket[row.bucket] = { fitForCorr: [], beatArr: [], savCount: 0, total: 0 };
    byBucket[row.bucket].total++;
    if (savCovered) byBucket[row.bucket].savCount++;
    if (beatMedian != null) {
      byBucket[row.bucket].beatArr.push(beatMedian ? 1 : 0);
      byBucket[row.bucket].fitForCorr.push(fitScore);
    }

    // Per-niche accumulation
    if (!byNiche[row.niche]) byNiche[row.niche] = { fitForCorr: [], beatArr: [], total: 0 };
    byNiche[row.niche].total++;
    if (beatMedian != null) {
      byNiche[row.niche].beatArr.push(beatMedian ? 1 : 0);
      byNiche[row.niche].fitForCorr.push(fitScore);
    }

    // Global Pearson
    if (beatMedian != null) {
      allFit.push(fitScore);
      allBeat.push(beatMedian ? 1 : 0);
    }

    // Adj hit-rate
    if (beatMedian != null) {
      const adjKey = dataAdj < 0 ? 'neg' : dataAdj > 0 ? 'pos' : 'zero';
      adjHitRate[adjKey][beatMedian ? 'beat' : 'miss']++;
    }

    // Monotonicity grid
    if (beatMedian != null) {
      if (!bucketGrid[row.bucket]) bucketGrid[row.bucket] = {};
      const sb = getBucket(fitScore);
      if (sb) {
        if (!bucketGrid[row.bucket][sb.label]) bucketGrid[row.bucket][sb.label] = { beat: 0, total: 0 };
        bucketGrid[row.bucket][sb.label].total++;
        if (beatMedian) bucketGrid[row.bucket][sb.label].beat++;
      }
    }

    processed++;
    if (processed % PROGRESS_EVERY === 0) {
      process.stdout.write(`\r  Progress: ${processed.toLocaleString()} / ${sampled.length.toLocaleString()}`);
    }
  }
  if (processed >= PROGRESS_EVERY) console.log('');

  // ── Per-bucket results ───────────────────────────────────────────────────────

  console.log('\n── Per-snapshot-bucket results ─────────────────────────────────────────────────');

  let anyInversion = false;

  for (const bucket of TARGET_BUCKETS) {
    const bdata = byBucket[bucket];
    if (!bdata || !bdata.total) {
      console.log(`\n  [${bucket}] — no data`);
      continue;
    }

    const savCov = bdata.savCount / bdata.total;
    const withM  = bdata.beatArr.length;
    const beatN  = bdata.beatArr.filter(b => b).length;

    console.log(`\n  [${bucket}] — ${bdata.total.toLocaleString()} rows | ${withM.toLocaleString()} with niche baseline`);
    console.log(`  SAV coverage: ${(savCov * 100).toFixed(1)}%${savCov < 0.6 ? ' (low — using VPH hit-rate as primary)' : ''}`);

    // Score-bucket monotonicity table
    const grid = bucketGrid[bucket] ?? {};
    const HDR = [pad('FitScore', 10), pad('Videos', 8), pad('Beat%', 8), 'Monotone?'].join(' | ');
    console.log('\n  ' + HDR);
    console.log('  ' + '─'.repeat(HDR.length));

    let prevRate = null;
    let inverts  = 0;

    for (const sb of SCORE_BUCKETS) {
      const cell = grid[sb.label] ?? { beat: 0, total: 0 };
      const rate = cell.total > 0 ? cell.beat / cell.total : null;
      const mono = rate == null || prevRate == null ? '—'
                 : rate >= prevRate ? '✓' : '✗';
      if (mono === '✗') { inverts++; anyInversion = true; }
      if (rate != null) prevRate = rate;

      const beatPct = cell.total > 0 ? pct(cell.beat, cell.total) : '—';
      console.log('  ' + [pad(sb.label, 10), pad(cell.total, 8), pad(beatPct, 8), mono].join(' | '));
    }

    if (inverts === 0) {
      console.log(`\n  Monotonicity: PASS — higher score → higher beat rate`);
    } else {
      console.log(`\n  Monotonicity: WARN (${inverts} inversion${inverts > 1 ? 's' : ''}). May be expected while archetype caps suppress differentiation.`);
    }

    console.log(`  Overall beat-median rate: ${pct(beatN, withM)} (${beatN.toLocaleString()} / ${withM.toLocaleString()})`);

    const r_pb = pearson(bdata.fitForCorr, bdata.beatArr);
    if (r_pb != null) {
      console.log(`  Point-biserial r (fit_score vs beat_median): ${r_pb} (footnote — near-zero expected due to cap distribution)`);
    }
  }

  // ── Adjustment hit-rate table ─────────────────────────────────────────────────

  console.log('\n── Adjustment direction hit-rate (all buckets combined) ─────────────────────');
  const adjRows = [
    ['adj < 0 (penalised)', adjHitRate.neg],
    ['adj = 0 (neutral)',   adjHitRate.zero],
    ['adj > 0 (boosted)',   adjHitRate.pos],
  ];
  const ADJ_H = [pad('Direction', 24), pad('Beat', 8), pad('Miss', 8), pad('Total', 8), pad('Beat%', 8)].join(' | ');
  console.log('\n  ' + ADJ_H);
  console.log('  ' + '─'.repeat(ADJ_H.length));
  for (const [label, cell] of adjRows) {
    const total = cell.beat + cell.miss;
    console.log('  ' + [pad(label, 24), pad(cell.beat, 8), pad(cell.miss, 8), pad(total, 8), pad(pct(cell.beat, total), 8)].join(' | '));
  }
  console.log('\n  Interpretation: adj>0 should have higher beat% than adj=0; adj<0 should have lower.');

  const negTotal = adjHitRate.neg.beat + adjHitRate.neg.miss;
  const posTotal = adjHitRate.pos.beat + adjHitRate.pos.miss;
  const negBeat  = negTotal ? adjHitRate.neg.beat / negTotal : null;
  const posBeat  = posTotal ? adjHitRate.pos.beat / posTotal : null;
  if (posBeat != null && negBeat != null) {
    if (posBeat < negBeat) {
      console.log(`\n  ⚠  INVERSION: boosted ${pct(adjHitRate.pos.beat, posTotal)} < penalised ${pct(adjHitRate.neg.beat, negTotal)} — adjustment direction may be reversed.`);
    } else {
      console.log(`\n  ✓  Direction correct: boosted ${pct(adjHitRate.pos.beat, posTotal)} ≥ penalised ${pct(adjHitRate.neg.beat, negTotal)}`);
    }
  }

  // ── Per-niche table ───────────────────────────────────────────────────────────

  console.log('\n── Per-niche macro summary (top 20 by volume) ──────────────────────────────────');
  const nicheList = Object.entries(byNiche)
    .map(([niche, d]) => {
      const avgFit = d.fitForCorr.length
        ? Math.round(d.fitForCorr.reduce((a, b) => a + b, 0) / d.fitForCorr.length)
        : null;
      const beatN = d.beatArr.filter(b => b).length;
      const r_pb  = d.beatArr.length >= 10
        ? pearson(d.fitForCorr, d.beatArr)
        : null;
      return { niche, total: d.total, withM: d.beatArr.length, beatN, avgFit, r_pb };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  const NICHE_H = [pad('Niche', 18), pad('Videos', 8), pad('Beat%', 8), pad('AvgFit', 8), pad('r_pb', 6), 'Signal?'].join(' | ');
  console.log('\n  ' + NICHE_H);
  console.log('  ' + '─'.repeat(NICHE_H.length));
  for (const n of nicheList) {
    const beatPct = pct(n.beatN, n.withM);
    const signal  = n.r_pb == null ? '—' : Math.abs(n.r_pb) >= 0.05 ? (n.r_pb > 0 ? '+signal' : '-signal') : 'flat';
    console.log('  ' + [pad(n.niche, 18), pad(n.total, 8), pad(beatPct, 8), pad(n.avgFit, 8), pad(n.r_pb ?? '—', 6), signal].join(' | '));
  }

  // ── Global summary ────────────────────────────────────────────────────────────

  const globalR     = pearson(allFit, allBeat);
  const globalBeatN = allBeat.filter(b => b).length;
  const totalSav    = Object.values(byBucket).reduce((s, b) => s + b.savCount, 0);
  const totalRows   = Object.values(byBucket).reduce((s, b) => s + b.total, 0);

  console.log('\n── Summary ──────────────────────────────────────────────────────────────────────');
  console.log(`  Rows scored        : ${sampled.length.toLocaleString()}`);
  console.log(`  With niche baseline: ${allBeat.length.toLocaleString()} (${pct(allBeat.length, sampled.length)})`);
  console.log(`  Global beat-median : ${pct(globalBeatN, allBeat.length)} (${globalBeatN.toLocaleString()} / ${allBeat.length.toLocaleString()})`);
  console.log(`  Global r_pb        : ${globalR ?? '—'} (fit_score vs beat_median — footnote)`);
  console.log(`  SAV coverage       : ${pct(totalSav, totalRows)}`);
  console.log('');
  if (!anyInversion) {
    console.log('  Monotonicity: PASS across all buckets');
  } else {
    console.log('  Monotonicity: WARN — inversions present (expected while archetype caps are active)');
  }
  console.log('');
}

main().catch(err => {
  console.error('FATAL:', err.message, err.stack);
  process.exit(1);
});
