const CALIBRATION_VERSION = '0.1.0-stub';

function calibrateScore(rawScore, _metadata) {
  return {
    adjustedScore:       rawScore,
    calibrationVersion:  CALIBRATION_VERSION,
    appliedAdjustments:  [],
  };
}

module.exports = { calibrateScore };
