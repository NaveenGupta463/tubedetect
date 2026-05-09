const express = require('express');
const { getDb }                    = require('../db/init');
const {
  getLearningOutcomeRows,
  getDegradedModeRows,
  getHookTypeOutcomeRows,
  getRealityRowsForLearning,
}                                  = require('../db/queries');
const {
  computeCalibrationRecommendations,
  computeConfidenceReliability,
  computeNicheLearning,
  computePatternFailures,
  computeLearningHealth,
}                                  = require('../services/learningEngine');
const { computeRealityFailures }   = require('../services/realityLearningEngine');

const router = express.Router();

let _cache   = null;
let _expiry  = 0;
const TTL_MS = 60_000;

router.get('/learning/report', (_req, res) => {
  const now = Date.now();
  if (_cache && now < _expiry) return res.json(_cache);

  try {
    const db          = getDb();
    const outcomeRows  = getLearningOutcomeRows(db);
    const degradedRows = getDegradedModeRows(db);
    const hookRows     = getHookTypeOutcomeRows(db);

    const realityRows                = getRealityRowsForLearning(db);
    const calibrationRecommendations = computeCalibrationRecommendations(outcomeRows);
    const confidenceReliability      = computeConfidenceReliability(outcomeRows);
    const nicheLearning              = computeNicheLearning(outcomeRows);
    const patternFailures            = computePatternFailures(outcomeRows, degradedRows, hookRows);
    const realityFailures            = computeRealityFailures(realityRows);

    const allRecs = [...calibrationRecommendations, ...nicheLearning, ...patternFailures];
    const learningHealth = computeLearningHealth(allRecs, outcomeRows);

    const report = {
      calibrationRecommendations,
      confidenceReliability,
      nicheLearning,
      patternFailures,
      learningHealth,
      realityFailures,
    };

    _cache  = report;
    _expiry = now + TTL_MS;

    res.json(report);
  } catch (err) {
    console.error('[learning]', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate learning report' });
  }
});

module.exports = router;
