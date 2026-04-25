/**
 * Assembles the standard result envelope returned by all flows.
 *
 * Required: mode, original, improvements, weaknesses, originalScore
 * Optional (default null/[]): improved, improvedScore, delta, variations
 * meta: included in output only when explicitly passed — partial/early-exit states only
 *
 * Shape:
 * {
 *   success:      true
 *   mode:         'pre-publish' | 'post-publish'
 *   original:     full analysis result — first run, never mutated
 *   improved:     final validated result (pre-publish) | null
 *   improvements: best improvement set | null
 *   weaknesses: {
 *     original: { hook, title, thumbnail, retention }  — booleans, from real scores
 *     improved: { hook, title, thumbnail, retention }  — booleans (pre) or tri-state (post) | null
 *   }
 *   originalScore: number
 *   improvedScore: number | null
 *   delta:        { value, type, confidence } | null
 *   variations:   { projectedScore, improvements }[]
 *   meta?:        { reason: string }  — present only for partial/early-exit states
 * }
 */
export function buildEnvelope({
  mode, original, improved = null, improvements,
  weaknesses, originalScore, improvedScore = null,
  delta = null, variations = [], meta,
}) {
  return {
    success: true,
    mode,
    original,
    improved,
    improvements,
    weaknesses,
    originalScore,
    improvedScore,
    delta,
    variations,
    ...(meta !== undefined && { meta }),
  };
}
