const VALID_LABELS  = ['accurate', 'inaccurate', 'partial'];
const VALID_REASONS = [
  'title_weak', 'thumbnail_weak', 'hook_weak',
  'niche_mismatch', 'misleading_peers', 'trend_shift', 'unknown',
];

function sanitizeNotes(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/<[^>]*>/g, '').slice(0, 500);
  return cleaned || null;
}

function capturePrediction({
  predictionId, videoId, final_score,
  confidence_state, predicted_state, degraded_mode,
  warnings, pipeline_version, predicted_at,
}) {
  const now = new Date().toISOString();
  return {
    prediction_id:    predictionId,
    video_id:         videoId,
    predicted_score:  final_score,
    predicted_state:  predicted_state ?? null,
    confidence_state: confidence_state ?? null,
    pipeline_version: pipeline_version ?? 'legacy',
    warnings_json:    Array.isArray(warnings) && warnings.length > 0
      ? JSON.stringify(warnings)
      : null,
    predicted_at,
    degraded_mode:    degraded_mode ?? false,
    created_at:       now,
    updated_at:       now,
  };
}

function attachUserFeedback({ label, reason, notes }) {
  if (!VALID_LABELS.includes(label)) {
    throw new Error(`Invalid feedback_label: "${label}". Allowed: ${VALID_LABELS.join(', ')}`);
  }
  if (reason != null && !VALID_REASONS.includes(reason)) {
    throw new Error(`Invalid feedback_reason: "${reason}". Allowed: ${VALID_REASONS.join(', ')}`);
  }
  return {
    feedback_label:  label,
    feedback_reason: reason ?? null,
    user_notes:      sanitizeNotes(notes),
    updated_at:      new Date().toISOString(),
  };
}

function updateOutcomeMetrics({ actual_views_24h, actual_views_7d, actual_ctr, actual_retention }) {
  return {
    actual_views_24h: actual_views_24h != null ? Number(actual_views_24h) : null,
    actual_views_7d:  actual_views_7d  != null ? Number(actual_views_7d)  : null,
    actual_ctr:       actual_ctr       != null ? Number(actual_ctr)       : null,
    actual_retention: actual_retention != null ? Number(actual_retention) : null,
    updated_at:       new Date().toISOString(),
  };
}

function computePredictionAccuracy(row) {
  if (!row) {
    return {
      totalTracked: 0, totalFeedback: 0,
      accuracyRate: null, partialRate: null, inaccurateRate: null,
      degradedAccuracy: null, confidenceAccuracy: null,
      degradedCount: 0, legacyCount: 0, pipelineV1Count: 0, lastFeedbackAt: null,
    };
  }

  const {
    total_snapshots, total_reviewed,
    accurate_count, inaccurate_count, partial_count,
    degraded_reviewed_count, degraded_accurate_count,
    degraded_count, legacy_count, pipeline_v1_count, last_feedback_at,
  } = row;

  const rev = total_reviewed ?? 0;
  const pct = (n) => rev > 0 ? parseFloat(((n ?? 0) / rev * 100).toFixed(1)) : null;
  const degRev = degraded_reviewed_count ?? 0;

  return {
    totalTracked:      total_snapshots ?? 0,
    totalFeedback:     rev,
    accuracyRate:      pct(accurate_count),
    partialRate:       pct(partial_count),
    inaccurateRate:    pct(inaccurate_count),
    degradedAccuracy:  degRev > 0
      ? parseFloat(((degraded_accurate_count ?? 0) / degRev * 100).toFixed(1))
      : null,
    confidenceAccuracy: null,
    degradedCount:     degraded_count    ?? 0,
    legacyCount:       legacy_count      ?? 0,
    pipelineV1Count:   pipeline_v1_count ?? 0,
    lastFeedbackAt:    last_feedback_at  ?? null,
  };
}

module.exports = { capturePrediction, attachUserFeedback, updateOutcomeMetrics, computePredictionAccuracy };
