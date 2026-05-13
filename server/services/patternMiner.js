const crypto = require('crypto');
const {
  getAggregatableCombinations,
  getSnapshotRowsForAggregation,
  upsertNicheBenchmark,
  getAllNicheBenchmarks,
  insertBenchmarkHistory,
} = require('../db/queries');

const MIN_SAMPLE        = 5;
const DURATION_BUCKETS  = { short: [0, 180], medium: [180, 600], long: [600, Infinity] };

function classifyDuration(seconds) {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 180)  return 'short';
  if (seconds < 600)  return 'medium';
  return 'long';
}

// Compute percentile from a sorted ascending array.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.floor(p * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function computePercentiles(values) {
  if (!values.length) return { median: null, p75: null, p90: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p75:    percentile(sorted, 0.75),
    p90:    percentile(sorted, 0.9),
  };
}

function roundStat(v) {
  return v != null ? parseFloat(v.toFixed(4)) : null;
}

/**
 * Recompute niche_benchmarks for all (niche, bucket) pairs that meet MIN_SAMPLE.
 * Aggregates per duration_bucket (short/medium/long) with no cross-niche mixing.
 * Pure SQL reads + in-process percentile computation.
 */
function runPatternMining(db) {
  const combinations      = getAggregatableCombinations(db, MIN_SAMPLE);
  const snapshot_batch_id = crypto.randomUUID();
  const snapshot_at       = new Date().toISOString();
  let upserted = 0, skipped = 0;

  for (const { niche, bucket } of combinations) {
    const rows = getSnapshotRowsForAggregation(db, niche, bucket);
    if (!rows.length) continue;

    // Split by duration bucket
    const byDuration = { short: [], medium: [], long: [], unknown: [] };
    for (const row of rows) {
      const db_key = classifyDuration(row.duration_seconds) ?? 'unknown';
      byDuration[db_key].push(row);
    }

    for (const [durBucket, subset] of Object.entries(byDuration)) {
      if (subset.length < MIN_SAMPLE) { skipped++; continue; }

      const views    = subset.map(r => r.views).filter(v => v != null);
      const vphs     = subset.map(r => r.views_per_hour).filter(v => v != null);
      const savs     = subset.map(r => r.subscriber_adjusted_velocity).filter(v => v != null);
      const vsrs     = subset.map(r => r.views_to_subscriber_ratio).filter(v => v != null);
      const accels   = subset.map(r => r.velocity_acceleration).filter(v => v != null);

      const vPerc   = computePercentiles(views);
      const vphPerc = computePercentiles(vphs);

      const medSav = savs.length
        ? savs.sort((a, b) => a - b)[Math.floor(savs.length * 0.5)]
        : null;
      const medVsr = vsrs.length
        ? vsrs.sort((a, b) => a - b)[Math.floor(vsrs.length * 0.5)]
        : null;
      const medAccel = accels.length
        ? accels.sort((a, b) => a - b)[Math.floor(accels.length * 0.5)]
        : null;

      const benchRow = {
        niche,
        bucket,
        duration_bucket: durBucket,
        sample_size:     subset.length,
        median_views:    roundStat(vPerc.median),
        p75_views:       roundStat(vPerc.p75),
        p90_views:       roundStat(vPerc.p90),
        median_vph:      roundStat(vphPerc.median),
        p75_vph:         roundStat(vphPerc.p75),
        p90_vph:         roundStat(vphPerc.p90),
        median_sav:      roundStat(medSav),
        median_vsr:      roundStat(medVsr),
        median_accel:    roundStat(medAccel),
      };
      upsertNicheBenchmark(db, { id: crypto.randomUUID(), ...benchRow });
      insertBenchmarkHistory(db, {
        id:               crypto.randomUUID(),
        snapshot_batch_id,
        snapshot_at,
        ...benchRow,
      });
      upserted++;
    }
  }

  return { combinations: combinations.length, upserted, skipped, snapshot_batch_id };
}

/**
 * Read current benchmarks — used by the scoring feed (Commit 4).
 * Returns a nested map: { [niche]: { [bucket]: { [duration_bucket]: row } } }
 */
function loadBenchmarkMap(db) {
  const rows = getAllNicheBenchmarks(db);
  const map  = {};
  for (const row of rows) {
    if (!map[row.niche])                        map[row.niche] = {};
    if (!map[row.niche][row.bucket])            map[row.niche][row.bucket] = {};
    map[row.niche][row.bucket][row.duration_bucket] = row;
  }
  return map;
}

module.exports = { runPatternMining, loadBenchmarkMap, classifyDuration };
