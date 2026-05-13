'use strict';

// Measures whether confidence scores actually correlate with prediction accuracy.
// The key question: do high-confidence niches have lower calibration error (MAE)?
//
// Healthy system:  autonomous MAE < high MAE < medium MAE < low MAE
// Unhealthy:       positive correlation (high conf → high MAE) → routing unsafe

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num  += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return parseFloat((num / Math.sqrt(denX * denY)).toFixed(3));
}

function avgArr(arr) {
  return arr.length ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2)) : null;
}

function confidenceTier(score) {
  if (score >= 80) return 'autonomous';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function computeRoutingAccuracyScore({ bucketed_mae, correlation, data_points, alerts }) {
  let score = 0;

  // Data volume (30 pts)
  if (data_points >= 10)      score += 30;
  else if (data_points >= 5)  score += 15;
  else if (data_points >= 3)  score += 5;

  // MAE ordering: autonomous < high (30 pts)
  const am = bucketed_mae.autonomous;
  const hm = bucketed_mae.high;
  if (am != null && hm != null) {
    if (am < hm) score += 30;
    // else 0 — ordering violated
  }

  // Negative correlation = healthy (30 pts)
  if (correlation != null) {
    if (correlation < -0.3)      score += 30;
    else if (correlation < 0)    score += 15;
    // positive correlation = 0 pts
  }

  // No red alerts (10 pts)
  if (alerts.filter(a => a.severity === 'red').length === 0) score += 10;

  return Math.min(100, score);
}

function computeConfidenceCorrectness(db) {
  // 1. Per-niche avg confidence from latest confidence_metrics run (last 48h)
  const nicheConf = db.all(
    `SELECT niche, AVG(confidence_score) AS avg_confidence, COUNT(*) AS n_features
     FROM confidence_metrics
     WHERE niche IS NOT NULL
       AND created_at >= datetime('now', '-2 days')
     GROUP BY niche
     HAVING n_features >= 3`,
  );

  // 2. Per-niche MAE from video_outcomes (need >= 5 rows for reliability)
  const nicheMae = db.all(
    `SELECT niche,
            ROUND(AVG(ABS(calibration_error)), 2) AS mae,
            COUNT(*) AS n
     FROM video_outcomes
     WHERE calibration_error IS NOT NULL AND niche IS NOT NULL
     GROUP BY niche
     HAVING n >= 5`,
  );

  // 3. Join niches present in both datasets
  const joined = [];
  for (const nc of nicheConf) {
    const nm = nicheMae.find(m => m.niche === nc.niche);
    if (nm) joined.push({ niche: nc.niche, confidence: nc.avg_confidence, mae: nm.mae, n: nm.n });
  }

  // 4. Bucket by confidence tier
  const buckets = { low: [], medium: [], high: [], autonomous: [] };
  for (const r of joined) {
    buckets[confidenceTier(r.confidence)].push(r.mae);
  }

  const bucketed_mae = {
    low:        avgArr(buckets.low),
    medium:     avgArr(buckets.medium),
    high:       avgArr(buckets.high),
    autonomous: avgArr(buckets.autonomous),
  };

  // 5. Pearson correlation: confidence vs MAE (negative = healthy)
  const correlation = joined.length >= 3
    ? pearsonCorrelation(joined.map(r => r.confidence), joined.map(r => r.mae))
    : null;

  // 6. Alerts
  const alerts = [];
  const tierCount = Object.values(buckets).filter(b => b.length > 0).length;

  if (joined.length < 3) {
    alerts.push({
      type: 'insufficient_data', severity: 'yellow',
      message: `Only ${joined.length} niches have both confidence and MAE data. Validation unreliable until more calibration outcomes accumulate.`,
    });
  }

  if (tierCount < 2) {
    alerts.push({
      type: 'no_tier_diversity', severity: 'yellow',
      message: 'All niches score in the same confidence tier. Cross-tier MAE ordering cannot be computed. Routing threshold validation requires niches in ≥2 tiers.',
    });
  }

  if (correlation != null && correlation > 0.2) {
    alerts.push({
      type: 'correlation_inversion', severity: 'red',
      message: `Confidence positively correlates with MAE (r=${correlation}). High-confidence niches have WORSE accuracy. Routing thresholds may be miscalibrated — investigate before expanding autonomous routing.`,
    });
  }

  const am = bucketed_mae.autonomous;
  const hm = bucketed_mae.high;
  if (am != null && hm != null && am > hm) {
    alerts.push({
      type: 'autonomous_mae_worse', severity: 'red',
      message: `Autonomous-tier niches (MAE ${am}) have HIGHER error than high-confidence niches (MAE ${hm}). Autonomous routing is producing less accurate results than local_first routing.`,
    });
  }

  const routing_accuracy_score = computeRoutingAccuracyScore({ bucketed_mae, correlation, data_points: joined.length, alerts });

  return {
    data_points:           joined.length,
    niche_breakdown:       joined,
    correlation,
    bucketed_mae,
    tier_counts: {
      low:        buckets.low.length,
      medium:     buckets.medium.length,
      high:       buckets.high.length,
      autonomous: buckets.autonomous.length,
    },
    routing_accuracy_score,
    alerts,
    healthy:   alerts.filter(a => a.severity === 'red').length === 0,
    validated: joined.length >= 5 && tierCount >= 2 && correlation !== null,
    computed_at: new Date().toISOString(),
  };
}

module.exports = { computeConfidenceCorrectness };
