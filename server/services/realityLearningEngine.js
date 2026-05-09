const crypto = require('crypto');

function recId(scope, issue) {
  return crypto.createHash('sha1')
    .update(`reality_failure:${scope}:${issue}`)
    .digest('hex').slice(0, 12);
}

function computeRealityFailures(rows) {
  if (!rows || rows.length === 0) return [];

  const failures = [];

  for (const row of rows) {
    if (!row.youtube_video_id) continue;

    if (row.is_false_positive) {
      failures.push({
        id:                   recId(row.youtube_video_id, 'false_positive'),
        type:                 'reality_failure',
        failure_type:         'false_positive',
        youtube_video_id:     row.youtube_video_id,
        title:                row.title ?? null,
        niche:                row.niche ?? 'unknown',
        predicted_score:      row.predicted_score,
        velocity_state:       row.velocity_state,
        views_72h:            row.views_72h,
        breakout_multiplier:  row.breakout_multiplier,
        algorithm_push_score: row.algorithm_push_score,
        signal_quality:       row.signal_quality,
        recommendation:       `Review scoring signals for "${row.niche ?? 'unknown'}" — high prediction (${row.predicted_score}) but video ${row.velocity_state}`,
        rationale:            row.false_positive_reason ?? `Predicted ${row.predicted_score}, velocity: ${row.velocity_state}`,
        severity:             'warning',
        created_at:           row.reality_created_at ?? new Date().toISOString(),
      });
    }

    if (row.is_false_negative) {
      failures.push({
        id:                   recId(row.youtube_video_id, 'false_negative'),
        type:                 'reality_failure',
        failure_type:         'false_negative',
        youtube_video_id:     row.youtube_video_id,
        title:                row.title ?? null,
        niche:                row.niche ?? 'unknown',
        predicted_score:      row.predicted_score,
        velocity_state:       row.velocity_state,
        views_72h:            row.views_72h,
        breakout_multiplier:  row.breakout_multiplier,
        algorithm_push_score: row.algorithm_push_score,
        signal_quality:       row.signal_quality,
        recommendation:       `Low prediction (${row.predicted_score}) missed breakout at ${row.breakout_multiplier}x — scoring missed viral signals`,
        rationale:            row.false_negative_reason ?? `Predicted ${row.predicted_score}, breakout: ${row.breakout_multiplier}x`,
        severity:             'critical',
        created_at:           row.reality_created_at ?? new Date().toISOString(),
      });
    }

    // Numerically close but platform outcome wrong — the key signal
    if (!row.is_false_positive && !row.is_false_negative &&
        row.calibration_error != null && Math.abs(row.calibration_error) <= 10 &&
        (row.velocity_state === 'dead' || row.velocity_state === 'decaying') &&
        row.signal_quality !== 'insufficient') {
      failures.push({
        id:                recId(row.youtube_video_id, 'velocity_decay'),
        type:              'reality_failure',
        failure_type:      'velocity_decay_with_match',
        youtube_video_id:  row.youtube_video_id,
        title:             row.title ?? null,
        niche:             row.niche ?? 'unknown',
        predicted_score:   row.predicted_score,
        calibration_error: row.calibration_error,
        velocity_state:    row.velocity_state,
        views_72h:         row.views_72h,
        signal_quality:    row.signal_quality,
        recommendation:    `Score numerically accurate (error: ${row.calibration_error?.toFixed(1)}) but video ${row.velocity_state} — scoring optimises wrong target`,
        rationale:         `Calibration error within ±10 but velocity is ${row.velocity_state} — MAE metric misaligned with viral success`,
        severity:          'warning',
        created_at:        row.reality_created_at ?? new Date().toISOString(),
      });
    }
  }

  return failures;
}

module.exports = { computeRealityFailures };
