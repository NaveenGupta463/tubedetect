const CALIBRATION_VERSION = 'adaptive_v1';

function calibrateScore(rawScore, metadata) {
  const { niche, nicheBiasWeights } = metadata ?? {};

  let adjustedScore = rawScore;
  const appliedAdjustments = [];

  if (nicheBiasWeights && niche) {
    const key  = (niche ?? '').toLowerCase().trim();
    const bias = nicheBiasWeights[key] ?? 0;
    if (bias !== 0) {
      adjustedScore = parseFloat(Math.max(0, Math.min(100, adjustedScore + bias)).toFixed(2));
      appliedAdjustments.push({ type: 'niche_bias', niche: key, bias });
    }
  }

  return {
    adjustedScore:      parseFloat(Math.max(0, Math.min(100, adjustedScore)).toFixed(2)),
    calibrationVersion: CALIBRATION_VERSION,
    appliedAdjustments,
  };
}

module.exports = { calibrateScore };
