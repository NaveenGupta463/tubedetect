'use strict';

// E1 — Calibration Engine.
// Freshness-weighted MAE, per-niche reliability scoring.
// All functions synchronous, no side effects.

// Piecewise-linear freshness decay:
//   0–7d  → 1.0
//   7–30d → 1.0 → 0.70  (linear)
//  30–90d → 0.70 → 0.35 (linear)
// 90–180d → 0.35 → 0.10 (linear)
// 180d+   → 0.10
function computeFreshnessMultiplier(ageDays) {
  if (ageDays <= 7)   return 1.0;
  if (ageDays <= 30)  return 1.0  - ((ageDays - 7)  / 23)  * 0.30;
  if (ageDays <= 90)  return 0.70 - ((ageDays - 30) / 60)  * 0.35;
  if (ageDays <= 180) return 0.35 - ((ageDays - 90) / 90)  * 0.25;
  return 0.10;
}

// Compute weighted-average MAE across outcomes within a time window.
// Uses freshness_weight if already stored; falls back to computing from last_refreshed_at.
function computeTrustWeightedMAE(db, niche, windowDays) {
  const window = Math.max(1, Math.min(365, windowDays ?? 90));
  const rows = db.all(
    `SELECT ABS(calibration_error) AS abs_err,
            COALESCE(freshness_weight, 1.0)        AS fw,
            pipeline_version,
            CAST(
              (julianday('now') - julianday(COALESCE(last_refreshed_at, created_at)))
            AS REAL) AS age_days
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND calibration_error IS NOT NULL
       AND COALESCE(last_refreshed_at, created_at) >= datetime('now', ?)
       ${niche ? "AND LOWER(TRIM(niche)) = ?" : ""}
     LIMIT 2000`,
    niche
      ? [`-${window} days`, niche.toLowerCase().trim()]
      : [`-${window} days`],
  );

  if (!rows.length) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of rows) {
    const ageDays = Math.max(0, r.age_days ?? 0);
    const fw = r.fw ?? computeFreshnessMultiplier(ageDays);
    // Synthetic outcomes get half the weight of real ones
    const typeWeight = (r.pipeline_version === 'synthetic_b') ? 0.5 : 1.0;
    const w = fw * typeWeight;
    weightedSum += r.abs_err * w;
    totalWeight += w;
  }

  return totalWeight > 0 ? parseFloat((weightedSum / totalWeight).toFixed(3)) : null;
}

// Compute per-niche reliability: how well the model performs on this specific niche.
// Returns { reliability_score 0-100, real_outcome_count, avg_mae, mae_7d, mae_30d, mae_90d,
//           trust_weight, synthetic_ratio, disagreement_rate }
function computeNicheReliability(db, niche) {
  const n = (niche ?? '').toLowerCase().trim();

  const counts = db.get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real,
            SUM(CASE WHEN pipeline_version = 'synthetic_b'  THEN 1 ELSE 0 END) AS synthetic,
            AVG(ABS(calibration_error)) AS mae_all
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND calibration_error IS NOT NULL
       AND LOWER(TRIM(niche)) = ?`,
    [n],
  ) ?? {};

  const total   = counts.total ?? 0;
  const real    = counts.real  ?? 0;
  const synthetic = counts.synthetic ?? 0;
  const maeAll  = counts.mae_all != null ? parseFloat(Number(counts.mae_all).toFixed(3)) : null;

  const mae7d  = computeTrustWeightedMAE(db, n, 7);
  const mae30d = computeTrustWeightedMAE(db, n, 30);
  const mae90d = computeTrustWeightedMAE(db, n, 90);

  // Disagreement rate — what fraction of feedback rows have a score_override
  const disRow = db.get(
    `SELECT COUNT(*) AS total_fb,
            SUM(CASE WHEN pf.score_override IS NOT NULL THEN 1 ELSE 0 END) AS overrides
     FROM prediction_feedback pf
     JOIN video_outcomes vo ON vo.prediction_id = pf.prediction_id
     WHERE LOWER(TRIM(vo.niche)) = ?`,
    [n],
  ) ?? {};
  const disagreement_rate = (disRow.total_fb ?? 0) > 0
    ? parseFloat((disRow.overrides / disRow.total_fb).toFixed(4))
    : null;

  // Reliability score (0–100):
  //   sample_score   (25%): real >= 100 → 100, linear below
  //   accuracy_score (35%): based on mae30d; mae=0 → 100, mae=50 → 0
  //   real_ratio     (25%): fraction real vs total
  //   freshness      (15%): fraction of outcomes updated in last 30d
  const sampleScore = Math.min(100, (real / 100) * 100);
  const refMae = mae30d ?? maeAll ?? 50;
  const accuracyScore = Math.max(0, 100 - refMae * 2);
  const realRatioScore = total > 0 ? (real / total) * 100 : 0;

  const fresh = db.get(
    `SELECT COUNT(*) AS n FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND LOWER(TRIM(niche)) = ?
       AND COALESCE(last_refreshed_at, created_at) >= datetime('now', '-30 days')`,
    [n],
  )?.n ?? 0;
  const freshnessScore = total > 0 ? Math.min(100, (fresh / total) * 100) : 0;

  const reliability_score = parseFloat((
    sampleScore    * 0.25 +
    accuracyScore  * 0.35 +
    realRatioScore * 0.25 +
    freshnessScore * 0.15
  ).toFixed(1));

  // trust_weight: reliability mapped to [0.3, 1.0]
  const trust_weight = parseFloat((0.3 + (reliability_score / 100) * 0.7).toFixed(3));

  return {
    niche: n,
    reliability_score,
    real_outcome_count: real,
    avg_mae:  maeAll,
    mae_7d:   mae7d,
    mae_30d:  mae30d,
    mae_90d:  mae90d,
    trust_weight,
    synthetic_ratio: total > 0 ? parseFloat((synthetic / total).toFixed(4)) : null,
    disagreement_rate,
  };
}

// Backfill freshness_weight on video_outcomes rows that still have the default 1.0
// (run once at startup or on-demand — safe to call multiple times).
function backfillFreshnessWeights(db) {
  const rows = db.all(
    `SELECT id,
            CAST((julianday('now') - julianday(COALESCE(last_refreshed_at, created_at))) AS REAL) AS age_days
     FROM video_outcomes
     WHERE freshness_weight = 1.0 OR freshness_weight IS NULL
     LIMIT 5000`,
  );
  if (!rows.length) return 0;
  let updated = 0;
  for (const r of rows) {
    const fw = computeFreshnessMultiplier(Math.max(0, r.age_days ?? 0));
    const expired = r.age_days > 365 ? 1 : 0;
    db.run(
      `UPDATE video_outcomes SET freshness_weight = ?, is_expired = ? WHERE id = ?`,
      [fw, expired, r.id],
    );
    updated++;
  }
  return updated;
}

module.exports = { computeFreshnessMultiplier, computeTrustWeightedMAE, computeNicheReliability, backfillFreshnessWeights };
