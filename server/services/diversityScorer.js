// Scores how much a candidate improves dataset diversity.
// 1.0 = highly diverse (new niche/archetype not well represented)
// 0.0 = highly redundant (niche/archetype already saturated)

const SATURATION_THRESHOLD = 0.40; // flag if a niche exceeds 40% of total

function buildDensityMap(channels, field) {
  const counts = {};
  let total = 0;
  for (const ch of channels) {
    const val = ch[field];
    if (!val) continue;
    counts[val] = (counts[val] ?? 0) + 1;
    total++;
  }
  return { counts, total };
}

function computeDiversityScore(candidate, existingChannels) {
  if (!existingChannels.length) return 1.0;

  const niche     = candidate.primary_niche;
  const archetype = candidate.content_archetype;

  const nicheDensity     = buildDensityMap(existingChannels, 'niche');
  const archetypeDensity = buildDensityMap(existingChannels, 'content_archetype');

  // Niche share: what fraction of existing channels are in this niche?
  const nicheCount  = nicheDensity.counts[niche] ?? 0;
  const nicheShare  = nicheDensity.total > 0 ? nicheCount / nicheDensity.total : 0;

  // Archetype share
  const archCount  = archetypeDensity.counts[archetype] ?? 0;
  const archShare  = archetypeDensity.total > 0 ? archCount / archetypeDensity.total : 0;

  // Diversity is inverse of saturation — lower share = more diverse
  const nicheDiversity    = Math.max(0, 1 - nicheShare / SATURATION_THRESHOLD);
  const archetypeDiversity = Math.max(0, 1 - archShare / SATURATION_THRESHOLD);

  // Weighted: niche matters more than archetype for diversity
  const score = (nicheDiversity * 0.65) + (archetypeDiversity * 0.35);
  return parseFloat(Math.min(1, Math.max(0, score)).toFixed(3));
}

function isDiversityWarning(score) {
  return score < 0.35;
}

module.exports = { computeDiversityScore, isDiversityWarning };
