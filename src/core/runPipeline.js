import { generateImprovements }                              from '../ai/generateImprovements.js';
import { computeProjectedScore, computeProjectedWeaknesses,
         computeDelta }                                      from '../scoring/computeScores.js';
import { selectBestRun }                                     from '../selection/selectBestRun.js';
import { buildEnvelope }                                     from '../contract/buildEnvelope.js';

/**
 * Post-publish optimization pipeline.
 * Runs N independent improvement generations, ranks by projected score,
 * and returns the best result with up to 5 variations.
 *
 * Receives pre-computed baseline data — does NOT call analyzeVideoDeep.
 *
 * @param {Object} params
 * @param {Object} params.videoData          - YouTube video data object
 * @param {Object} params.analysis           - result of analyzeVideoDeep (or cached)
 * @param {number} params.originalScore      - baseline viralScore (flat number)
 * @param {Object} params.originalWeaknesses - weakness flags from baseline analysis
 * @param {number} params.iterations         - number of independent improvement runs
 *
 * @returns {Promise<ResultEnvelope | ErrorEnvelope>}
 */
export async function runPipeline({
  videoData,
  analysis,
  originalScore,
  originalWeaknesses,
  iterations,
}) {
  const runs         = [];
  let anyGenerated   = false;
  const MAX_VARIATIONS = Math.min(iterations - 1, 5);

  // Step 1: run N independent improvement generations
  for (let i = 0; i < iterations; i++) {
    const improvements = await generateImprovements(videoData, analysis);
    if (!improvements) continue;
    anyGenerated = true;
    const projectedScore = computeProjectedScore(improvements);
    if (projectedScore === null) continue;
    runs.push({ projectedScore, improvements });
  }

  // Case 1: AI failed to generate improvements entirely
  if (!anyGenerated) {
    return { success: false, error: 'no_improvements_generated' };
  }

  // Case 2: improvements were generated but none had valid projected scores
  if (runs.length === 0) {
    return buildEnvelope({
      mode:         'post-publish',
      original:     analysis,
      improvements: null,
      weaknesses:   { original: originalWeaknesses, improved: null },
      originalScore,
      meta:         { reason: 'no_valid_projections' },
    });
  }

  // Case 3: normal success — select best run and build full envelope
  const { best, variations }   = selectBestRun(runs, MAX_VARIATIONS);
  const improvedWeaknesses     = computeProjectedWeaknesses(best.improvements);

  return buildEnvelope({
    mode:         'post-publish',
    original:     analysis,
    improvements: best.improvements,
    weaknesses:   { original: originalWeaknesses, improved: improvedWeaknesses },
    originalScore,
    improvedScore: best.projectedScore,
    delta:        computeDelta(originalScore, best.projectedScore, 'post-publish'),
    variations,
  });
}
