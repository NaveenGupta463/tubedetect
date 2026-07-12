'use strict';

const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];

/**
 * Compute packaging-risk score from VSR trend vs niche benchmark median_vsr.
 *
 * High packaging risk means the video's VSR is declining or stuck well below
 * the niche median — suggesting the title/thumbnail is not converting impressions.
 *
 * Uses median_vsr from niche_benchmarks (NOT p90_vsr which is not stored).
 *
 * Returns packaging_risk 0–100 where:
 *   0   = no packaging risk (strong VSR, growing or stable)
 *   100 = severe packaging risk (low VSR, declining)
 */
function computePackagingRiskScore(snapshots, benchmarkRows) {
  // Sort snapshots chronologically.
  const ordered = [...snapshots]
    .filter(s => s.views_to_subscriber_ratio != null)
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket));

  if (ordered.length === 0) {
    return {
      packaging_risk_score: 50,
      vsr_ratio: null,
      vsr_trend: null,
      evidence: { reason: 'no_vsr_data' },
    };
  }

  const latestSnap = ordered[ordered.length - 1];
  const latestVsr  = latestSnap.views_to_subscriber_ratio;

  // Pick the benchmark row that matches the latest snapshot's bucket.
  const benchRow = benchmarkRows?.find(r => r.bucket === latestSnap.bucket) ?? null;
  const medianVsr = benchRow?.median_vsr ?? null;

  // VSR ratio vs median benchmark.
  const vsrRatio = (medianVsr != null && medianVsr > 0) ? latestVsr / medianVsr : null;

  // VSR trend: compare earliest to latest (if 2+ points available).
  let vsrTrend = null;
  if (ordered.length >= 2) {
    const firstVsr = ordered[0].views_to_subscriber_ratio;
    vsrTrend = firstVsr > 0 ? (latestVsr - firstVsr) / firstVsr : null;
  }

  // Base risk from VSR ratio vs median.
  let baseRisk;
  if (vsrRatio == null) {
    baseRisk = 30; // unknown — mild risk
  } else if (vsrRatio >= 1.5) {
    baseRisk = 10; // well above median — low packaging risk
  } else if (vsrRatio >= 1.0) {
    baseRisk = 25;
  } else if (vsrRatio >= 0.5) {
    baseRisk = 55;
  } else {
    baseRisk = 80; // far below median
  }

  // Trend nudge: declining VSR raises risk, improving lowers it.
  let trendNudge = 0;
  if (vsrTrend != null) {
    if (vsrTrend < -0.3) trendNudge = +15;
    else if (vsrTrend < -0.1) trendNudge = +8;
    else if (vsrTrend > 0.3)  trendNudge = -10;
    else if (vsrTrend > 0.1)  trendNudge = -5;
  }

  const risk = Math.max(0, Math.min(100, baseRisk + trendNudge));

  return {
    packaging_risk_score: Math.round(risk),
    vsr_ratio: vsrRatio != null ? parseFloat(vsrRatio.toFixed(3)) : null,
    vsr_trend: vsrTrend != null ? parseFloat(vsrTrend.toFixed(3)) : null,
    evidence: {
      latest_vsr:   latestVsr,
      median_vsr:   medianVsr,
      bucket_used:  latestSnap.bucket,
      points_used:  ordered.length,
    },
  };
}

module.exports = { computePackagingRiskScore };
