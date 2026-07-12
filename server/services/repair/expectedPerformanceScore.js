'use strict';

const { getBenchmarkRow, classifyDurationBucket } = require('../../db/queries');

const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];

/**
 * Compute expected-performance score by comparing actual VPH to niche benchmarks.
 * Uses 3-key lookup: niche + bucket + duration_bucket.
 *
 * Returns a 0–100 score where 100 = at or above p90, 50 = at median, 0 = far below.
 */
function computeExpectedPerformanceScore(db, snapshots, videoMeta) {
  const niche          = videoMeta.niche;
  const durationBucket = classifyDurationBucket(videoMeta.duration_seconds);

  // Use the latest available snapshot for comparison.
  const orderedBuckets = BUCKET_ORDER.filter(b => snapshots.some(s => s.bucket === b));
  if (orderedBuckets.length === 0) {
    return {
      expected_performance_score: 50,
      performance_ratio: null,
      benchmark_context: null,
      evidence: { reason: 'no_snapshots' },
    };
  }

  // Prefer freshest snapshot that has a benchmark row.
  let latestSnap = null;
  let benchRow   = null;
  for (let i = orderedBuckets.length - 1; i >= 0; i--) {
    const bucket = orderedBuckets[i];
    const snap   = snapshots.find(s => s.bucket === bucket);
    const row    = niche ? getBenchmarkRow(db, niche, bucket, durationBucket) : null;
    if (snap && row && row.median_vph != null && row.sample_size >= 5) {
      latestSnap = snap;
      benchRow   = row;
      break;
    }
    if (snap && !latestSnap) latestSnap = snap; // fallback: at least record latest snap
  }

  if (!benchRow || latestSnap?.views_per_hour == null) {
    // No usable benchmark — return neutral score, report why.
    return {
      expected_performance_score: 50,
      performance_ratio: null,
      benchmark_context: benchRow ? { bucket: benchRow.bucket, sample_size: benchRow.sample_size } : null,
      evidence: { reason: benchRow ? 'snapshot_vph_null' : 'no_benchmark', niche, duration_bucket: durationBucket },
    };
  }

  const actualVph  = latestSnap.views_per_hour;
  const medianVph  = benchRow.median_vph;
  const p75Vph     = benchRow.p75_vph;
  const p90Vph     = benchRow.p90_vph;

  // Ratio against median; capped for scoring.
  const ratio = medianVph > 0 ? actualVph / medianVph : null;

  let score;
  if (ratio == null) {
    score = 50;
  } else if (p90Vph != null && actualVph >= p90Vph) {
    score = 95;
  } else if (p75Vph != null && actualVph >= p75Vph) {
    // Linear interpolation p75→p90 maps to 75→95
    const t = p90Vph > p75Vph ? (actualVph - p75Vph) / (p90Vph - p75Vph) : 0;
    score = 75 + t * 20;
  } else if (actualVph >= medianVph) {
    // Linear interpolation median→p75 maps to 50→75
    const top = p75Vph ?? medianVph * 1.5;
    const t   = top > medianVph ? (actualVph - medianVph) / (top - medianVph) : 0;
    score = 50 + t * 25;
  } else {
    // Below median: ratio 0→1 maps to 5→50
    score = Math.max(5, ratio * 50);
  }

  return {
    expected_performance_score: Math.round(score),
    performance_ratio: ratio != null ? parseFloat(ratio.toFixed(3)) : null,
    benchmark_context: {
      niche,
      duration_bucket: durationBucket,
      bucket: benchRow.bucket,
      median_vph: medianVph,
      p75_vph: p75Vph,
      p90_vph: p90Vph,
      sample_size: benchRow.sample_size,
    },
    evidence: {
      actual_vph: actualVph,
      bucket_used: latestSnap.bucket,
    },
  };
}

module.exports = { computeExpectedPerformanceScore };
