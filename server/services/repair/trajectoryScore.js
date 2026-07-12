'use strict';

const BUCKET_ORDER = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];
const BUCKET_DAYS  = { '1d':1, '3d':3, '7d':7, '14d':14, '30d':30, '90d':90, '365d':365 };

// Linear regression slope (VPH per day) across ordered snapshots.
// Returns null if fewer than 2 points.
function vphSlope(snapshots) {
  const pts = snapshots
    .filter(s => s.views_per_hour != null)
    .map(s => ({ x: BUCKET_DAYS[s.bucket] ?? 0, y: s.views_per_hour }));
  if (pts.length < 2) return null;

  const n  = pts.length;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

// Converts slope + latest acceleration into a 0–100 trajectory score and status.
// slope is VPH/day — positive = growing, negative = declining.
// latestAccel is (vph_t - vph_prev) / vph_prev.
function scoreFromSignals(slope, latestAccel, snapshotCount) {
  // With only 1 snapshot rely purely on acceleration.
  if (snapshotCount === 1) {
    if (latestAccel == null) return { status: 'unknown', score: 50 };
    if (latestAccel > 0.5)  return { status: 'viral',    score: 90 };
    if (latestAccel > 0.1)  return { status: 'growing',  score: 70 };
    if (latestAccel > -0.1) return { status: 'stable',   score: 50 };
    if (latestAccel > -0.4) return { status: 'declining', score: 30 };
    return { status: 'stalled', score: 15 };
  }

  // Multi-bucket: primary signal is slope, accent from latest acceleration.
  if (slope == null) return { status: 'unknown', score: 50 };

  let status;
  let base;
  if (slope > 5) {
    status = 'viral'; base = 90;
  } else if (slope > 0.5) {
    status = 'growing'; base = 70;
  } else if (slope >= -0.5) {
    status = 'stable'; base = 50;
  } else if (slope >= -5) {
    status = 'declining'; base = 30;
  } else {
    status = 'stalled'; base = 15;
  }

  // Nudge by latest acceleration (±10 pts max).
  let accelNudge = 0;
  if (latestAccel != null) {
    accelNudge = Math.max(-10, Math.min(10, latestAccel * 20));
  }

  const score = Math.max(0, Math.min(100, base + accelNudge));
  return { status, score };
}

/**
 * Compute trajectory assessment from all snapshots for a video.
 *
 * @param {Array} snapshots  Rows from video_growth_snapshots (any order).
 * @returns {{ trajectory_status, trajectory_score, slope, latest_accel, snapshot_count, evidence }}
 */
function computeTrajectoryScore(snapshots) {
  const ordered = [...snapshots].sort(
    (a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket),
  );

  const latest = ordered[ordered.length - 1] ?? null;
  const latestAccel = latest?.velocity_acceleration ?? null;
  const slope = vphSlope(ordered);
  const { status, score } = scoreFromSignals(slope, latestAccel, ordered.length);

  return {
    trajectory_status: status,
    trajectory_score:  Math.round(score),
    slope:             slope != null ? parseFloat(slope.toFixed(4)) : null,
    latest_accel:      latestAccel,
    snapshot_count:    ordered.length,
    evidence: {
      buckets_available: ordered.map(s => s.bucket),
      vph_series: ordered.map(s => ({ bucket: s.bucket, vph: s.views_per_hour })),
      latest_bucket: latest?.bucket ?? null,
      latest_vph: latest?.views_per_hour ?? null,
    },
  };
}

module.exports = { computeTrajectoryScore };
