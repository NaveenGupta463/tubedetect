const express = require('express');
const crypto  = require('crypto');
const { getDb }  = require('../db/init');
const {
  getLearningOutcomeRows,
  getActiveScoringVersionByType,
  getScoringVersionById,
  getScoringVersions,
  insertScoringVersion,
  activateScoringVersion,
  insertScoringWeightAudit,
  getScoringWeightAuditLog,
  getMostRecentAuditForType,
} = require('../db/queries');
const { computeCalibrationRecommendations, computeObservationalRecommendations } = require('../services/learningEngine');
const { loadBenchmarkMap } = require('../services/patternMiner');
const scoreCache = require('../services/scoreCache');

const router = express.Router();

const AUTO_CALIBRATE_SAMPLE_MIN      = 20;
const AUTO_CALIBRATE_CONFIDENCE_MIN  = 0.7;
const AUTO_CALIBRATE_ADJUSTMENT_MAX  = 10;

function adminAuth(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const provided = req.headers['x-admin-token'] ?? req.query.admin_token;
  if (provided !== token) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.use(adminAuth);

// POST /api/admin/learning/auto-calibrate
// Reads current calibration recommendations and auto-applies a fresh niche_bias
// scoring version for all niches that meet the qualification thresholds.
// Uses REPLACE strategy — only currently qualifying niches are included.
router.post('/admin/learning/auto-calibrate', (req, res) => {
  try {
    const db   = getDb();

    // Signal 1: Prediction-based calibration (our own prediction errors)
    const outcomeRows      = getLearningOutcomeRows(db);
    const predictionRecs   = computeCalibrationRecommendations(outcomeRows);

    // Signal 2: Observational benchmarks (market behavior from ingested videos)
    let obsRecs = [];
    try {
      const benchmarkMap = loadBenchmarkMap(db);
      obsRecs = computeObservationalRecommendations(benchmarkMap);
    } catch (_) {}

    // Merge: prediction-based wins if present for a niche; observational fills gaps
    const predNiches = new Set(predictionRecs.map(r => r.niche));
    const mergedRecs = [
      ...predictionRecs,
      ...obsRecs.filter(r => !predNiches.has(r.niche)),
    ];

    const recs = mergedRecs;

    const qualifying = recs.filter(r =>
      r.sample_size   >= AUTO_CALIBRATE_SAMPLE_MIN     &&
      r.confidence    >= AUTO_CALIBRATE_CONFIDENCE_MIN  &&
      Math.abs(r.suggested_adjustment) <= AUTO_CALIBRATE_ADJUSTMENT_MAX &&
      r.suggested_adjustment !== 0,
    );

    if (qualifying.length === 0) {
      return res.json({
        ok:               true,
        applied:          false,
        reason:           'no niches met qualification thresholds',
        qualifying_count: 0,
        thresholds:       { sample_min: AUTO_CALIBRATE_SAMPLE_MIN, confidence_min: AUTO_CALIBRATE_CONFIDENCE_MIN, adjustment_max: AUTO_CALIBRATE_ADJUSTMENT_MAX },
      });
    }

    const weights = {};
    for (const rec of qualifying) {
      weights[rec.niche] = rec.suggested_adjustment;
    }

    const currentActive = getActiveScoringVersionByType(db, 'niche_bias');

    const newVersionId = crypto.randomUUID();
    insertScoringVersion(db, {
      id:           newVersionId,
      version_name: `auto_calibration_${Date.now()}`,
      version_type: 'niche_bias',
      weights_json: weights,
      created_by:   'auto_calibration',
      notes:        `Auto-applied: ${qualifying.length} qualifying niches (sample≥${AUTO_CALIBRATE_SAMPLE_MIN}, conf≥${AUTO_CALIBRATE_CONFIDENCE_MIN}, adj≤±${AUTO_CALIBRATE_ADJUSTMENT_MAX})`,
    });

    activateScoringVersion(db, newVersionId, 'niche_bias');

    const auditId = crypto.randomUUID();
    insertScoringWeightAudit(db, {
      id:               auditId,
      version_type:     'niche_bias',
      old_version_id:   currentActive?.id ?? null,
      new_version_id:   newVersionId,
      old_weights_json: currentActive?.weights_json ?? null,
      new_weights_json: weights,
      trigger_reason:   'auto_calibration_niche_bias',
      experiment_id:    null,
      applied_by:       'system',
    });

    scoreCache.bumpVersionStamp();

    res.json({
      ok:               true,
      applied:          true,
      new_version_id:   newVersionId,
      audit_id:         auditId,
      qualifying_count: qualifying.length,
      prediction_signal_count:    qualifying.filter(r => r.type === 'score_bias').length,
      observational_signal_count: qualifying.filter(r => r.type === 'observational_niche_signal').length,
      weights,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/scoring/rollback
// Reverts the active scoring version for a given type to the previous one.
// Provide version_id to target a specific version, or omit to auto-detect from audit log.
router.post('/admin/scoring/rollback', (req, res) => {
  try {
    const db = getDb();
    const { version_type, version_id, applied_by } = req.body ?? {};

    if (!version_type) return res.status(400).json({ error: 'version_type is required (ensemble_weights or niche_bias)' });

    const currentActive  = getActiveScoringVersionByType(db, version_type);
    let targetVersionId  = version_id ?? null;
    let rollbackOfAuditId = null;

    if (!targetVersionId) {
      const lastAudit = getMostRecentAuditForType(db, version_type);
      if (!lastAudit) {
        return res.status(400).json({ error: 'no audit history found for this version_type — specify version_id explicitly' });
      }
      targetVersionId   = lastAudit.old_version_id ?? null;
      rollbackOfAuditId = lastAudit.id;
    }

    db.run('UPDATE scoring_versions SET active = 0 WHERE version_type = ?', [version_type]);
    if (targetVersionId) {
      db.run('UPDATE scoring_versions SET active = 1 WHERE id = ?', [targetVersionId]);
    }

    const targetVersion = targetVersionId ? getScoringVersionById(db, targetVersionId) : null;

    const auditId = crypto.randomUUID();
    insertScoringWeightAudit(db, {
      id:                   auditId,
      version_type,
      old_version_id:       currentActive?.id ?? null,
      new_version_id:       targetVersionId ?? 'defaults',
      old_weights_json:     currentActive?.weights_json ?? null,
      new_weights_json:     targetVersion?.weights_json ?? '{}',
      trigger_reason:       'manual_rollback',
      experiment_id:        null,
      applied_by:           applied_by ?? 'user',
      rollback_of_audit_id: rollbackOfAuditId,
    });

    scoreCache.bumpVersionStamp();

    res.json({
      ok:          true,
      audit_id:    auditId,
      reverted_to: targetVersionId ?? 'defaults',
      version_type,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scoring/active — current active versions per type
router.get('/admin/scoring/active', (_req, res) => {
  try {
    const db = getDb();
    res.json({
      ensemble_weights: getActiveScoringVersionByType(db, 'ensemble_weights') ?? null,
      niche_bias:       getActiveScoringVersionByType(db, 'niche_bias')       ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scoring/versions — all scoring versions
router.get('/admin/scoring/versions', (_req, res) => {
  try {
    const db = getDb();
    res.json({ versions: getScoringVersions(db) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/scoring/audit-log — weight change history
router.get('/admin/scoring/audit-log', (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    res.json({ log: getScoringWeightAuditLog(db, limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/cache/stats
router.get('/admin/cache/stats', (_req, res) => {
  res.json({ cache_size: scoreCache.size() });
});

module.exports = router;
