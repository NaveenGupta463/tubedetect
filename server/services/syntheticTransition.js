'use strict';

// E2 — Synthetic Transition Policy.
// Per-niche budgets: as real outcomes accumulate, old synthetic rows are gradually expired.
// Never deletes rows — marks is_expired = 1 so they're excluded from weighted calibration.

// How many synthetic rows are allowed at each real-count tier.
function computeSyntheticBudget(realCount) {
  if (realCount >= 100) return 0.20; // max 20% synthetic
  if (realCount >= 50)  return 0.40;
  if (realCount >= 20)  return 0.60;
  return 1.0; // no restriction below 20 real outcomes
}

// For a single niche: expire excess synthetic rows oldest-first when real_count grows.
// Returns the number of rows newly marked expired.
function pruneSyntheticOutcomes(db, niche) {
  const n = (niche ?? '').toLowerCase().trim();

  const stats = db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_count,
       SUM(CASE WHEN pipeline_version = 'synthetic_b' AND COALESCE(is_expired,0) = 0 THEN 1 ELSE 0 END) AS live_synthetic
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND LOWER(TRIM(niche)) = ?`,
    [n],
  ) ?? {};

  const realCount    = stats.real_count    ?? 0;
  const liveSynth    = stats.live_synthetic ?? 0;
  const total        = stats.total          ?? 0;

  if (liveSynth === 0 || realCount === 0) return 0;

  const budget      = computeSyntheticBudget(realCount);
  const allowedSynth = Math.floor(total * budget);
  const toExpire    = Math.max(0, liveSynth - allowedSynth);

  if (toExpire === 0) return 0;

  // Expire oldest synthetic rows first
  const candidates = db.all(
    `SELECT id FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
       AND pipeline_version = 'synthetic_b'
       AND COALESCE(is_expired, 0) = 0
       AND LOWER(TRIM(niche)) = ?
     ORDER BY COALESCE(last_refreshed_at, created_at) ASC
     LIMIT ?`,
    [n, toExpire],
  );

  for (const row of candidates) {
    db.run(`UPDATE video_outcomes SET is_expired = 1, freshness_weight = 0.0 WHERE id = ?`, [row.id]);
  }

  return candidates.length;
}

// Run transition policy across all active niches.
// Returns { niches_processed, total_expired }
function runSyntheticTransition(db) {
  const niches = db.all(
    `SELECT DISTINCT LOWER(TRIM(niche)) AS niche
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     ORDER BY niche`,
  );

  let totalExpired = 0;
  for (const { niche } of niches) {
    const expired = pruneSyntheticOutcomes(db, niche);
    totalExpired += expired;
  }

  return { niches_processed: niches.length, total_expired: totalExpired };
}

// Summary of per-niche transition state — for the frontend visualizations.
function getSyntheticTransitionStatus(db) {
  const rows = db.all(
    `SELECT
       LOWER(TRIM(niche)) AS niche,
       COUNT(*) AS total,
       SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) AS real_count,
       SUM(CASE WHEN pipeline_version = 'synthetic_b' AND COALESCE(is_expired,0) = 0 THEN 1 ELSE 0 END) AS live_synthetic,
       SUM(CASE WHEN COALESCE(is_expired,0) = 1 THEN 1 ELSE 0 END) AS expired_count
     FROM video_outcomes
     WHERE actual_performance_score IS NOT NULL
     GROUP BY LOWER(TRIM(niche))
     ORDER BY niche`,
  );

  return rows.map(r => {
    const budget = computeSyntheticBudget(r.real_count ?? 0);
    const total  = r.total ?? 0;
    const allowed = Math.floor(total * budget);
    return {
      niche:          r.niche,
      real_count:     r.real_count    ?? 0,
      live_synthetic: r.live_synthetic ?? 0,
      expired_count:  r.expired_count  ?? 0,
      allowed_synthetic: allowed,
      budget_pct:     Math.round(budget * 100),
      transition_complete: (r.live_synthetic ?? 0) <= allowed,
    };
  });
}

module.exports = { computeSyntheticBudget, pruneSyntheticOutcomes, runSyntheticTransition, getSyntheticTransitionStatus };
