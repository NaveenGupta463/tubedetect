import { isValidNumber, getWeakness } from '../utils/guards.js';

/**
 * Normalizes both analysis schemas into a flat object, all values 0–100.
 * Both modes produce { hook, title, thumbnail, retention } for symmetric shapes.
 *
 * Pre-publish:
 *   categoryScores are 0–10 → multiply by 10
 *   thumbnail from thumbnailAnalysis.scrollStoppingPower (already 0–100)
 *   retention proxied from hookPotential (no independent retention signal)
 *
 * Post-publish:
 *   blueprint.scores are already 0–100
 *   thumbnail proxied from titleThumbnail (no separate thumbnail dimension)
 *   retention proxied from hookRetention (same source as hook)
 *
 * Note: hook === retention in both modes by design — they share the same source signal.
 */
export function normalizeScores(result, mode) {
  if (mode === 'pre-publish') {
    const cs        = result.categoryScores || {};
    const hookScore = (cs.hookPotential ?? 0) * 10;
    return {
      hook:      hookScore,
      title:     (cs.titleStrength ?? 0) * 10,
      thumbnail: result.thumbnailAnalysis?.scrollStoppingPower ?? 0,
      retention: hookScore, // proxy — no independent retention signal in pre-publish
    };
  }

  // post-publish
  const scores             = result.blueprint?.scores || {};
  const hookRetentionScore = scores.hookRetention ?? 0;
  return {
    hook:      hookRetentionScore,
    title:     scores.titleThumbnail ?? 0,
    thumbnail: scores.titleThumbnail ?? 0,    // proxy — no separate thumbnail dimension
    retention: hookRetentionScore,             // proxy — same source as hook
  };
}

/**
 * Converts normalized scores (all 0–100) into weakness booleans.
 * Threshold: < 60 = weak.
 * Only sets keys that exist in the input object.
 */
export function detectWeaknesses(normalizedScores) {
  const THRESHOLD = 60;
  const weaknesses = {};
  if ('hook'      in normalizedScores) weaknesses.hook      = normalizedScores.hook      < THRESHOLD;
  if ('title'     in normalizedScores) weaknesses.title     = normalizedScores.title     < THRESHOLD;
  if ('thumbnail' in normalizedScores) weaknesses.thumbnail = normalizedScores.thumbnail < THRESHOLD;
  if ('retention' in normalizedScores) weaknesses.retention = normalizedScores.retention < THRESHOLD;
  return weaknesses;
}

/**
 * Weighted projected score for a single generateVideoImprovements result.
 * score = 0.7 * max(titleScores) + 0.3 * avg(titleScores)
 * Balances peak potential (best title) with consistency (all three titles).
 * Returns null if no valid projected scores are present.
 */
export function computeProjectedScore(improvements) {
  const scores = (improvements.titles || [])
    .map(t => t.projectedOverall)
    .filter(isValidNumber);

  if (scores.length === 0) return null;

  const max = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round((0.7 * max + 0.3 * avg) * 10) / 10;
}

/**
 * Computes projected weakness flags from generateVideoImprovements output.
 * Uses getWeakness for all fields — tri-state, never assumes missing = weak.
 *
 * Sources:
 *   hook      ← improvements.hook.projectedHookStrength
 *   title     ← improvements.titles[0].projectedDimensions.titleThumbnail
 *   thumbnail ← improvements.thumbnails[0].projectedDimensions.titleThumbnail
 *   retention ← improvements.hook.projectedDimensions.hookRetention
 */
export function computeProjectedWeaknesses(improvements) {
  return {
    hook:      getWeakness(improvements.hook?.projectedHookStrength),
    title:     getWeakness(improvements.titles?.[0]?.projectedDimensions?.titleThumbnail),
    thumbnail: getWeakness(improvements.thumbnails?.[0]?.projectedDimensions?.titleThumbnail),
    retention: getWeakness(improvements.hook?.projectedDimensions?.hookRetention),
  };
}

/**
 * Computes the delta between original and final scores.
 * Pre-publish: real scores from two actual validateVideo calls → confidence: high
 * Post-publish: projected scores from AI estimates → confidence: medium
 */
export function computeDelta(originalScore, improvedScore, mode) {
  return {
    value:      Math.round((improvedScore - originalScore) * 10) / 10,
    type:       mode === 'pre-publish' ? 'real' : 'projected',
    confidence: mode === 'pre-publish' ? 'high' : 'medium',
  };
}
