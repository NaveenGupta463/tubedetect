const express  = require('express');
const crypto   = require('crypto');
const { getDb } = require('../db/init');
const {
  insertScoringVersion,
  getActiveScoringVersion,
  getActiveScoringVersionByType,
  getScoringVersionById,
  getScoringVersions,
  insertExperiment,
  getExperiment,
  getExperiments,
  updateExperimentRun,
  insertRecommendationAction,
  getRecommendationActions,
  updateRecommendationActionExperiment,
  getSimulationRowsEnsemble,
  getSimulationRowsNicheBias,
  activateScoringVersion,
  insertScoringWeightAudit,
} = require('../db/queries');
const { runSimulation }   = require('../services/simulationEngine');
const { compareVersions } = require('../services/comparisonAnalytics');
const scoreCache          = require('../services/scoreCache');

const router = express.Router();

// GET /api/recommendations/actions — list all recommendation actions
router.get('/recommendations/actions', (_req, res) => {
  try {
    const db      = getDb();
    const actions = getRecommendationActions(db);
    res.json({ actions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/recommendations/:id/approve
router.post('/recommendations/:id/approve', (req, res) => {
  try {
    const db     = getDb();
    const recId  = req.params.id;
    const { approved_by, recommendation_type, recommendation_snapshot } = req.body ?? {};

    const actionId = crypto.randomUUID();
    insertRecommendationAction(db, {
      id:                      actionId,
      recommendation_id:       recId,
      recommendation_type:     recommendation_type ?? null,
      status:                  'approved',
      approved_by:             approved_by ?? 'user',
      approved_at:             new Date().toISOString(),
      recommendation_snapshot: recommendation_snapshot ?? null,
    });

    res.json({ ok: true, action_id: actionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/recommendations/:id/reject
router.post('/recommendations/:id/reject', (req, res) => {
  try {
    const db     = getDb();
    const recId  = req.params.id;
    const { rejected_reason, approved_by, recommendation_type, recommendation_snapshot } = req.body ?? {};

    const actionId = crypto.randomUUID();
    insertRecommendationAction(db, {
      id:                      actionId,
      recommendation_id:       recId,
      recommendation_type:     recommendation_type ?? null,
      status:                  'rejected',
      approved_by:             approved_by ?? 'user',
      rejected_reason:         rejected_reason ?? null,
      recommendation_snapshot: recommendation_snapshot ?? null,
    });

    res.json({ ok: true, action_id: actionId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/experiments
router.get('/experiments', (_req, res) => {
  try {
    const db          = getDb();
    const experiments = getExperiments(db);
    const versions    = getScoringVersions(db);
    res.json({ experiments, versions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/experiments/:id
router.get('/experiments/:id', (req, res) => {
  try {
    const db  = getDb();
    const exp = getExperiment(db, req.params.id);
    if (!exp) return res.status(404).json({ error: 'experiment not found' });

    const baseline  = getScoringVersionById(db, exp.baseline_version);
    const candidate = getScoringVersionById(db, exp.candidate_version);
    const result    = exp.result_summary ? JSON.parse(exp.result_summary) : null;

    res.json({ experiment: exp, baseline, candidate, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/experiments/create — create experiment with inline candidate_config
router.post('/experiments/create', (req, res) => {
  try {
    const db = getDb();
    const {
      name, description, experiment_type,
      candidate_config,
      created_by,
    } = req.body ?? {};

    if (!name || !experiment_type || !candidate_config) {
      return res.status(400).json({ error: 'name, experiment_type, and candidate_config are required' });
    }

    const baseline = getActiveScoringVersion(db);
    if (!baseline) return res.status(400).json({ error: 'no active scoring version found — seed one first' });

    const candidateId = crypto.randomUUID();
    insertScoringVersion(db, {
      id:           candidateId,
      version_name: `${name}_candidate_${Date.now()}`,
      version_type: experiment_type,
      weights_json: candidate_config.weights ?? {},
      thresholds_json:       candidate_config.thresholds ?? null,
      confidence_rules_json: candidate_config.confidence_rules ?? null,
      created_by:   created_by ?? 'user',
      notes:        `Auto-created for experiment: ${name}`,
    });

    const expId = crypto.randomUUID();
    insertExperiment(db, {
      id:                expId,
      name,
      description:       description ?? null,
      experiment_type,
      baseline_version:  baseline.id,
      candidate_version: candidateId,
    });

    res.json({ ok: true, experiment_id: expId, candidate_version_id: candidateId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/experiments/run — synchronous simulation: draft → running → completed|aborted
router.post('/experiments/run', (req, res) => {
  try {
    const db = getDb();
    const { experiment_id } = req.body ?? {};

    if (!experiment_id) return res.status(400).json({ error: 'experiment_id is required' });

    const exp = getExperiment(db, experiment_id);
    if (!exp) return res.status(404).json({ error: 'experiment not found' });
    if (exp.status !== 'draft') return res.status(409).json({ error: `experiment status is ${exp.status}, only draft experiments can be run` });

    const candidate = getScoringVersionById(db, exp.candidate_version);
    if (!candidate) return res.status(400).json({ error: 'candidate scoring version not found' });

    const startedAt = new Date().toISOString();
    updateExperimentRun(db, experiment_id, { status: 'running', started_at: startedAt, completed_at: null, result_summary: null, winner: null });

    let simRows;
    if (exp.experiment_type === 'ensemble_weights') {
      simRows = getSimulationRowsEnsemble(db);
    } else {
      simRows = getSimulationRowsNicheBias(db);
    }

    let result, winner;
    try {
      const simResult = runSimulation(simRows, candidate);
      const comparison = compareVersions(simResult);
      result = { simulation: simResult, comparison };
      winner = comparison.winner;
    } catch (simErr) {
      updateExperimentRun(db, experiment_id, {
        status:         'aborted',
        started_at:     startedAt,
        completed_at:   new Date().toISOString(),
        result_summary: JSON.stringify({ error: simErr.message }),
        winner:         null,
      });
      return res.json({ ok: false, status: 'aborted', reason: simErr.message });
    }

    updateExperimentRun(db, experiment_id, {
      status:         'completed',
      started_at:     startedAt,
      completed_at:   new Date().toISOString(),
      result_summary: result,
      winner,
    });

    res.json({ ok: true, status: 'completed', winner, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/experiments/:id/apply — promote winning candidate to active production version
router.post('/experiments/:id/apply', (req, res) => {
  try {
    const db  = getDb();
    const exp = getExperiment(db, req.params.id);
    if (!exp) return res.status(404).json({ error: 'experiment not found' });
    if (exp.status !== 'completed') {
      return res.status(409).json({ error: `experiment status is "${exp.status}" — only completed experiments can be applied` });
    }
    if (exp.winner !== 'candidate') {
      return res.status(409).json({ error: `winner is "${exp.winner}" — only candidate-wins experiments can be applied` });
    }

    const candidate = getScoringVersionById(db, exp.candidate_version);
    if (!candidate) return res.status(400).json({ error: 'candidate scoring version not found' });

    const currentActive = getActiveScoringVersionByType(db, candidate.version_type);

    activateScoringVersion(db, candidate.id, candidate.version_type);

    const auditId = crypto.randomUUID();
    insertScoringWeightAudit(db, {
      id:               auditId,
      version_type:     candidate.version_type,
      old_version_id:   currentActive?.id ?? null,
      new_version_id:   candidate.id,
      old_weights_json: currentActive?.weights_json ?? null,
      new_weights_json: candidate.weights_json,
      trigger_reason:   `experiment_apply:${exp.id}`,
      experiment_id:    exp.id,
      applied_by:       req.body?.applied_by ?? 'user',
    });

    scoreCache.bumpVersionStamp();

    res.json({ ok: true, audit_id: auditId, activated_version_id: candidate.id, version_type: candidate.version_type });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
