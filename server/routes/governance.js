'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { getDb } = require('../db/init');
const { getLatestTopologySnapshot, captureTopologySnapshot } = require('../services/topologyHealthEngine');
const { runAIDiscoveryCycle, getAIDiscoveryStats }           = require('../services/aiDiscoveryAgent');
const { runDriftDetection, getActiveAlerts, acknowledgeAlert } = require('../services/semanticDriftEngine');
const { getDominanceReport, runDiversityPressurePass }         = require('../services/diversityPressureEngine');
const { getSchedulerStatus }   = require('../services/corpusScheduler');
const { runDecayCycle }        = require('../services/relationshipDecayEngine');
const {
  calculateGovernanceMaturity,
  generateMaturityReport,
  runMaturityCheck,
  evaluateLayerReadiness,
  recordLayerHistory,
} = require('../services/governanceMaturityEngine');
const {
  inferEcologyProfile,
  inferEcologyProfileFromData,
  runEcologyInferencePass,
  saveEcologyProfile,
  setManualEcologyOverride,
  releaseManualOverride,
  getEcologyDistribution,
  ECOLOGY_DIMS,
  CONFIDENT_THRESHOLD,
  PROVISIONAL_THRESHOLD,
} = require('../services/attentionEcologyEngine');
const { fetchPlaylistItems, fetchVideoFullBatch } = require('../services/youtubeMetrics');
const { upsertCorpusChannel } = require('../db/corpusQueries');
const quotaGuard = require('../services/quotaGuard');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
function getYtKey() {
  return process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
}

function adminOnly(req, res, next) {
  const envToken = process.env.ADMIN_TOKEN;
  if (!envToken) return next();
  const provided = req.headers['x-admin-token'] || req.query.admin_token;
  if (provided !== envToken) return res.status(403).json({ error: 'forbidden' });
  next();
}

// ── Topology health ───────────────────────────────────────────────────────────

router.get('/corpus/governance/topology', adminOnly, (req, res) => {
  try {
    const db       = getDb();
    const snapshot = getLatestTopologySnapshot(db);
    res.json({ ok: true, ...snapshot });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/topology/snapshot', adminOnly, async (req, res) => {
  try {
    const db     = getDb();
    const result = captureTopologySnapshot(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Semantic drift ────────────────────────────────────────────────────────────

router.get('/corpus/governance/drift', adminOnly, (req, res) => {
  try {
    const db      = getDb();
    const limit   = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const severity = req.query.severity ?? null;
    const alerts  = getActiveAlerts(db, { severity, limit });
    const counts  = db.all(
      `SELECT severity, COUNT(*) AS n FROM governance_alerts WHERE acknowledged=0 GROUP BY severity`,
    );
    res.json({ ok: true, alerts, counts });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/drift/detect', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = runDriftDetection(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/drift/acknowledge/:id', adminOnly, (req, res) => {
  try {
    const db = getDb();
    acknowledgeAlert(db, req.params.id);
    res.json({ ok: true, acknowledged: req.params.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Semantic diversity ────────────────────────────────────────────────────────

router.get('/corpus/governance/diversity', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const report = getDominanceReport(db);

    // Training distribution by niche
    const trainingDist = db.all(
      `SELECT niche, COUNT(*) AS total, SUM(training_eligible) AS trained,
              ROUND(AVG(quality_score),1) AS avg_quality,
              ROUND(AVG(semantic_novelty_score),1) AS avg_novelty
       FROM corpus_channels WHERE niche IS NOT NULL
       GROUP BY niche ORDER BY trained DESC`,
    );

    // Novelty score distribution
    const noveltyDist = db.all(
      `SELECT
         SUM(CASE WHEN semantic_novelty_score >= 75 THEN 1 ELSE 0 END) AS high,
         SUM(CASE WHEN semantic_novelty_score >= 50 AND semantic_novelty_score < 75 THEN 1 ELSE 0 END) AS medium,
         SUM(CASE WHEN semantic_novelty_score >= 25 AND semantic_novelty_score < 50 THEN 1 ELSE 0 END) AS low,
         SUM(CASE WHEN semantic_novelty_score < 25 THEN 1 ELSE 0 END) AS very_low,
         SUM(CASE WHEN semantic_novelty_score IS NULL THEN 1 ELSE 0 END) AS unscored
       FROM corpus_channels`,
    );

    res.json({
      ok: true,
      dominance_report:  report,
      training_dist:     trainingDist,
      novelty_dist:      noveltyDist[0] ?? {},
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/diversity/refresh', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = runDiversityPressurePass(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Training trust distribution ───────────────────────────────────────────────

router.get('/corpus/governance/trust', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const trustDist = db.all(
      `SELECT
         SUM(CASE WHEN training_trust_score >= 80 THEN 1 ELSE 0 END) AS high,
         SUM(CASE WHEN training_trust_score >= 55 AND training_trust_score < 80 THEN 1 ELSE 0 END) AS medium,
         SUM(CASE WHEN training_trust_score >= 30 AND training_trust_score < 55 THEN 1 ELSE 0 END) AS low,
         SUM(CASE WHEN training_trust_score < 30 THEN 1 ELSE 0 END) AS very_low,
         SUM(CASE WHEN training_trust_score IS NULL THEN 1 ELSE 0 END) AS unscored
       FROM corpus_channels`,
    );

    const probationCount = db.get(
      `SELECT COUNT(*) AS n FROM corpus_channels WHERE probation_state = 1`,
    )?.n ?? 0;

    const promotedCount = db.get(
      `SELECT COUNT(*) AS n FROM corpus_channels WHERE training_eligible = 1 AND probation_state = 0`,
    )?.n ?? 0;

    const avgTrustByNiche = db.all(
      `SELECT niche, ROUND(AVG(training_trust_score),1) AS avg_trust, COUNT(*) AS n
       FROM corpus_channels WHERE niche IS NOT NULL AND training_trust_score IS NOT NULL
       GROUP BY niche ORDER BY avg_trust DESC`,
    );

    // Channels close to promotion threshold (trust 45-54 with minimums met)
    const nearPromotion = db.all(
      `SELECT channel_id, title, niche, training_trust_score, trust_maturity_score,
              probation_state, created_at
       FROM corpus_channels
       WHERE training_trust_score >= 45 AND training_trust_score < 55
         AND training_eligible = 0
       ORDER BY training_trust_score DESC LIMIT 20`,
    );

    res.json({
      ok: true,
      trust_distribution: trustDist[0] ?? {},
      probation_count:    probationCount,
      promoted_count:     promotedCount,
      avg_trust_by_niche: avgTrustByNiche,
      near_promotion:     nearPromotion,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Relationship / graph decay ────────────────────────────────────────────────

router.get('/corpus/governance/relationships', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const graphStats = db.get(
      `SELECT COUNT(*) AS total_edges,
              ROUND(AVG(edge_strength),3) AS avg_strength,
              ROUND(MIN(edge_strength),3) AS min_strength,
              ROUND(MAX(edge_strength),3) AS max_strength,
              SUM(CASE WHEN edge_strength < 0.3 THEN 1 ELSE 0 END) AS weak_edges,
              SUM(CASE WHEN edge_strength >= 0.8 THEN 1 ELSE 0 END) AS strong_edges
       FROM corpus_discovery_graph`,
    );

    const decayMeta = db.get(
      `SELECT metadata_value AS last_decay FROM app_metadata WHERE metadata_key = 'corpus_graph_last_decay'`,
    );

    const byType = db.all(
      `SELECT relationship_type,
              COUNT(*) AS n,
              ROUND(AVG(edge_strength),3) AS avg_strength
       FROM corpus_discovery_graph
       GROUP BY relationship_type ORDER BY n DESC`,
    );

    res.json({
      ok: true,
      graph_stats:  graphStats ?? {},
      last_decay_at: decayMeta?.last_decay ?? null,
      by_type:      byType,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/relationships/decay', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = runDecayCycle(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Governance overview (all signals in one call) ─────────────────────────────

router.get('/corpus/governance/overview', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const alerts = db.get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN severity='high' THEN 1 ELSE 0 END) AS high,
              SUM(CASE WHEN severity='medium' THEN 1 ELSE 0 END) AS medium
       FROM governance_alerts WHERE acknowledged = 0`,
    );

    const topology = db.get(
      `SELECT health_status, COUNT(*) AS n FROM topology_health_snapshots
       WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM topology_health_snapshots)
       GROUP BY health_status ORDER BY n DESC LIMIT 1`,
    );

    const diversity = getDominanceReport(db);

    const trust = db.get(
      `SELECT
         SUM(probation_state) AS on_probation,
         SUM(training_eligible) AS in_training,
         COUNT(*) AS total
       FROM corpus_channels`,
    );

    const graphHealth = db.get(
      `SELECT ROUND(AVG(edge_strength),3) AS avg_strength, COUNT(*) AS edges
       FROM corpus_discovery_graph`,
    );

    res.json({
      ok: true,
      alerts:       { total: alerts?.total ?? 0, high: alerts?.high ?? 0, medium: alerts?.medium ?? 0 },
      topology:     { dominant_status: topology?.health_status ?? 'no_data' },
      diversity:    { echo_chamber_risk: diversity.echo_chamber_risk, risky_niches: diversity.risky_niches.length },
      trust:        { on_probation: trust?.on_probation ?? 0, in_training: trust?.in_training ?? 0, total: trust?.total ?? 0 },
      graph:        { avg_strength: graphHealth?.avg_strength ?? null, edges: graphHealth?.edges ?? 0 },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI discovery observability ────────────────────────────────────────────────

router.get('/corpus/governance/ai-discovery/stats', adminOnly, (req, res) => {
  try {
    const db   = getDb();
    const days = Math.min(parseInt(req.query.days ?? '30', 10), 365);
    const stats = getAIDiscoveryStats(db, { days });
    res.json({ ok: true, ...stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/corpus/governance/ai-discovery/log', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const limit  = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    const niche  = req.query.niche ?? null;
    const status = req.query.admission_status ?? null;

    let sql    = 'SELECT * FROM ai_discovery_log WHERE 1=1';
    const params = [];
    if (niche)  { sql += ' AND niche = ?';            params.push(niche); }
    if (status) { sql += ' AND admission_status = ?'; params.push(status); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = db.all(sql, params);
    res.json({ ok: true, count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/corpus/governance/ai-discovery/run', adminOnly, async (req, res) => {
  try {
    const db                    = getDb();
    const niches                = req.body?.niches ?? null;
    const allowCulturalExpansion = req.body?.allow_cultural_expansion === true;
    const maxQuota              = Math.min(parseInt(req.body?.max_quota ?? '60', 10), 200);

    const result = await runAIDiscoveryCycle(db, {
      niches, allowCulturalExpansion, maxQuota,
      sizeFocus:     req.body?.size_focus     ?? null,
      temporalFocus: req.body?.temporal_focus ?? null,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Creator size tier distribution ────────────────────────────────────────────

router.get('/corpus/governance/creator-tiers', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const dist = db.all(
      `SELECT COALESCE(creator_size_tier, 'unclassified') AS tier,
              COUNT(*) AS total,
              SUM(training_eligible) AS training_eligible,
              ROUND(AVG(quality_score), 1) AS avg_quality,
              ROUND(AVG(semantic_novelty_score), 1) AS avg_novelty
       FROM corpus_channels
       GROUP BY tier
       ORDER BY CASE tier
         WHEN 'mega'         THEN 1
         WHEN 'large'        THEN 2
         WHEN 'medium'       THEN 3
         WHEN 'small'        THEN 4
         WHEN 'emerging'     THEN 5
         ELSE 6
       END`,
    );
    res.json({ ok: true, tiers: dist });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Behavioral feedback storage ───────────────────────────────────────────────

router.post('/corpus/governance/feedback', (req, res) => {
  try {
    const db   = getDb();
    const {
      event_type, session_id, channel_id,
      video_id, suggestion_id, payload,
    } = req.body ?? {};

    if (!event_type) return res.status(400).json({ ok: false, error: 'event_type required' });

    const ALLOWED_EVENTS = [
      'suggestion_shown', 'suggestion_accepted', 'suggestion_rejected',
      'title_changed', 'validator_feedback', 'recommendation_clicked',
    ];
    if (!ALLOWED_EVENTS.includes(event_type)) {
      return res.status(400).json({ ok: false, error: 'unknown event_type' });
    }

    db.run(
      `INSERT INTO behavioral_feedback_log
         (id, event_type, session_id, channel_id, video_id, suggestion_id, payload_json)
       VALUES (?,?,?,?,?,?,?)`,
      [
        crypto.randomUUID(), event_type, session_id ?? null,
        channel_id ?? null, video_id ?? null, suggestion_id ?? null,
        payload ? JSON.stringify(payload) : null,
      ],
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/corpus/governance/feedback/stats', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const since = req.query.since ?? '7 days';
    const stats = db.all(
      `SELECT event_type, COUNT(*) AS n
       FROM behavioral_feedback_log
       WHERE created_at > datetime('now', ?)
       GROUP BY event_type ORDER BY n DESC`,
      [`-${since}`],
    );
    res.json({ ok: true, since, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Governance maturity score ─────────────────────────────────────────────────

router.get('/corpus/governance/maturity', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = calculateGovernanceMaturity(db);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Full maturity report ──────────────────────────────────────────────────────

router.get('/corpus/governance/maturity-report', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const report = generateMaturityReport(db);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Roadmap — all layers ──────────────────────────────────────────────────────

router.get('/corpus/governance/roadmap', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const metrics = null; // lazy — evaluateLayerReadiness reads db itself
    const layers  = db.all(
      `SELECT id, governance_layer, current_status, implementation_priority,
              readiness_conditions, readiness_pct, last_evaluated_at,
              activated_at, deferred_at, notes
       FROM governance_roadmap ORDER BY implementation_priority ASC`,
    );

    res.json({ ok: true, count: layers.length, layers });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Roadmap — single layer ────────────────────────────────────────────────────

router.get('/corpus/governance/roadmap/:id', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const layer = db.get(
      `SELECT * FROM governance_roadmap WHERE id = ?`,
      [req.params.id],
    );
    if (!layer) return res.status(404).json({ ok: false, error: 'layer_not_found' });

    const history = db.all(
      `SELECT * FROM governance_layer_history
       WHERE layer_id = ? ORDER BY recorded_at DESC LIMIT 50`,
      [req.params.id],
    );

    res.json({ ok: true, layer, history });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Roadmap — layer history ───────────────────────────────────────────────────

router.get('/corpus/governance/roadmap/:id/history', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    const rows  = db.all(
      `SELECT * FROM governance_layer_history
       WHERE layer_id = ? ORDER BY recorded_at DESC LIMIT ?`,
      [req.params.id, limit],
    );
    res.json({ ok: true, count: rows.length, history: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Roadmap — re-evaluate single layer ───────────────────────────────────────

router.post('/corpus/governance/roadmap/:id/evaluate', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const layer = db.get(
      `SELECT * FROM governance_roadmap WHERE id = ?`,
      [req.params.id],
    );
    if (!layer) return res.status(404).json({ ok: false, error: 'layer_not_found' });

    const metrics  = calculateGovernanceMaturity(db);
    const readiness = evaluateLayerReadiness(db, layer, metrics);

    db.run(
      `UPDATE governance_roadmap SET readiness_pct = ?, last_evaluated_at = datetime('now') WHERE id = ?`,
      [readiness.readiness_pct, req.params.id],
    );

    res.json({ ok: true, layer_id: req.params.id, ...readiness });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Roadmap — admin status override (active / deferred only) ─────────────────

router.post('/corpus/governance/roadmap/:id/status', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const status = req.body?.status;
    const notes  = req.body?.notes ?? null;

    if (!['active', 'deferred'].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: 'status must be "active" or "deferred" — engine controls all other transitions',
      });
    }

    const layer = db.get(
      `SELECT * FROM governance_roadmap WHERE id = ?`,
      [req.params.id],
    );
    if (!layer) return res.status(404).json({ ok: false, error: 'layer_not_found' });

    const previousStatus = layer.current_status;
    const tsCol          = status === 'active' ? 'activated_at' : 'deferred_at';

    db.run(
      `UPDATE governance_roadmap
       SET current_status = ?, ${tsCol} = datetime('now'), notes = COALESCE(?, notes)
       WHERE id = ?`,
      [status, notes, req.params.id],
    );

    recordLayerHistory(db, {
      layer_id:        req.params.id,
      previous_status: previousStatus,
      new_status:      status,
      readiness_pct:   layer.readiness_pct ?? 0,
      trigger:         'admin_override',
      rationale:       notes ?? 'Manual admin status change',
    });

    res.json({ ok: true, layer_id: req.params.id, previous_status: previousStatus, new_status: status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Maturity check (trigger full engine pass) ─────────────────────────────────

router.post('/corpus/governance/maturity/check', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = runMaturityCheck(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Ecology overview ──────────────────────────────────────────────────────────

router.get('/corpus/governance/ecology/overview', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const distribution = getEcologyDistribution(db);

    // Coverage stats
    const coverage = db.get(
      `SELECT
         COUNT(*)                                                             AS total,
         SUM(CASE WHEN ecology_profile IS NOT NULL THEN 1 ELSE 0 END)        AS classified,
         SUM(CASE WHEN ecology_confidence >= ?     THEN 1 ELSE 0 END)        AS confident,
         SUM(CASE WHEN ecology_confidence >= ? AND ecology_confidence < ? THEN 1 ELSE 0 END) AS provisional,
         SUM(CASE WHEN ecology_confidence IS NULL OR ecology_confidence < ?  THEN 1 ELSE 0 END) AS uncertain,
         SUM(CASE WHEN ecology_manual_override = 1 THEN 1 ELSE 0 END)        AS manual_overrides
       FROM corpus_channels`,
      [CONFIDENT_THRESHOLD, PROVISIONAL_THRESHOLD, CONFIDENT_THRESHOLD, PROVISIONAL_THRESHOLD],
    );

    // Entropy distribution
    const entropyBuckets = db.all(
      `SELECT
         SUM(CASE WHEN ecology_entropy < 0.25 THEN 1 ELSE 0 END) AS very_low,
         SUM(CASE WHEN ecology_entropy >= 0.25 AND ecology_entropy < 0.50 THEN 1 ELSE 0 END) AS low,
         SUM(CASE WHEN ecology_entropy >= 0.50 AND ecology_entropy < 0.75 THEN 1 ELSE 0 END) AS medium,
         SUM(CASE WHEN ecology_entropy >= 0.75 THEN 1 ELSE 0 END) AS high,
         SUM(CASE WHEN ecology_entropy IS NULL THEN 1 ELSE 0 END) AS unclassified
       FROM corpus_channels`,
    );

    // Drift alerts in last 7 days
    const recentDrift = db.get(
      `SELECT COUNT(*) AS n FROM corpus_ecology_history
       WHERE drift_alert = 1 AND recorded_at > datetime('now', '-7 days')`,
    );

    res.json({
      ok: true,
      coverage:    coverage ?? {},
      distribution,
      entropy_distribution: entropyBuckets[0] ?? {},
      recent_drift_alerts:  recentDrift?.n ?? 0,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Ecology distribution (cross-tabs by niche, tier) ─────────────────────────

router.get('/corpus/governance/ecology/distribution', adminOnly, (req, res) => {
  try {
    const db = getDb();

    // Per-niche dominant ecology
    const byNiche = db.all(
      `SELECT niche,
              COUNT(*)                                                      AS total,
              ROUND(AVG(ecology_confidence), 3)                             AS avg_confidence,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.spectacle')     AS REAL)), 4) AS avg_spectacle,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.calm_trust')    AS REAL)), 4) AS avg_calm_trust,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.competence')    AS REAL)), 4) AS avg_competence,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.parasocial')    AS REAL)), 4) AS avg_parasocial,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.ritual_ambient') AS REAL)), 4) AS avg_ritual_ambient
       FROM corpus_channels
       WHERE ecology_profile IS NOT NULL AND niche IS NOT NULL
       GROUP BY niche ORDER BY total DESC`,
    );

    // Per creator tier dominant ecology
    const byTier = db.all(
      `SELECT COALESCE(creator_size_tier, 'unclassified') AS tier,
              COUNT(*)                                                       AS total,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.spectacle')     AS REAL)), 4) AS avg_spectacle,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.calm_trust')    AS REAL)), 4) AS avg_calm_trust,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.competence')    AS REAL)), 4) AS avg_competence,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.parasocial')    AS REAL)), 4) AS avg_parasocial,
              ROUND(AVG(CAST(json_extract(ecology_profile, '$.ritual_ambient') AS REAL)), 4) AS avg_ritual_ambient
       FROM corpus_channels
       WHERE ecology_profile IS NOT NULL
       GROUP BY tier`,
    );

    res.json({ ok: true, by_niche: byNiche, by_tier: byTier });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Single channel ecology profile ───────────────────────────────────────────

router.get('/corpus/governance/ecology/channel/:id', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const channel = db.get(
      `SELECT channel_id, title, niche, ecology_profile, ecology_confidence, ecology_entropy,
              ecology_last_updated_at, ecology_source, ecology_version,
              ecology_manual_override, ecology_override_notes
       FROM corpus_channels WHERE channel_id = ?`,
      [req.params.id],
    );
    if (!channel) return res.status(404).json({ ok: false, error: 'channel_not_found' });

    const history = db.all(
      `SELECT * FROM corpus_ecology_history
       WHERE channel_id = ? ORDER BY recorded_at DESC LIMIT 12`,
      [req.params.id],
    );

    const parsedProfile = channel.ecology_profile
      ? (() => { try { return JSON.parse(channel.ecology_profile); } catch (_) { return null; } })()
      : null;

    res.json({ ok: true, channel, profile: parsedProfile, history });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Ecology drift events ──────────────────────────────────────────────────────

router.get('/corpus/governance/ecology/drift', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
    const days  = Math.min(parseInt(req.query.days  ?? '30', 10), 365);

    const events = db.all(
      `SELECT h.*, c.title, c.niche
       FROM corpus_ecology_history h
       LEFT JOIN corpus_channels c ON c.channel_id = h.channel_id
       WHERE h.drift_alert = 1
         AND h.recorded_at > datetime('now', ?)
       ORDER BY h.drift_distance DESC, h.recorded_at DESC
       LIMIT ?`,
      [`-${days} days`, limit],
    );

    res.json({ ok: true, count: events.length, since_days: days, events });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Uncertain channels ────────────────────────────────────────────────────────

router.get('/corpus/governance/ecology/uncertain', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);

    const channels = db.all(
      `SELECT channel_id, title, niche, creator_size_tier,
              ecology_profile, ecology_confidence, ecology_entropy,
              ecology_last_updated_at, ecology_source
       FROM corpus_channels
       WHERE ecology_profile IS NULL
          OR ecology_confidence IS NULL
          OR ecology_confidence < ?
       ORDER BY ecology_confidence ASC NULLS FIRST,
                ecology_last_updated_at ASC NULLS FIRST
       LIMIT ?`,
      [PROVISIONAL_THRESHOLD, limit],
    );

    res.json({ ok: true, count: channels.length, threshold: PROVISIONAL_THRESHOLD, channels });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Trigger ecology inference pass ───────────────────────────────────────────

router.post('/corpus/governance/ecology/run', adminOnly, (req, res) => {
  try {
    const db       = getDb();
    const limit    = Math.min(parseInt(req.body?.limit ?? '200', 10), 500);
    const forceAll = req.body?.force_all === true;
    const result   = runEcologyInferencePass(db, { limit, forceAll });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Manual override (spot-check validation) ───────────────────────────────────

router.post('/corpus/governance/ecology/channel/:id/override', adminOnly, (req, res) => {
  try {
    const db      = getDb();
    const profile = req.body?.profile;
    const notes   = req.body?.notes ?? null;

    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({ ok: false, error: 'profile object required' });
    }
    const validDims = ECOLOGY_DIMS.every(d => typeof profile[d] === 'number');
    if (!validDims) {
      return res.status(400).json({
        ok: false,
        error: `profile must contain numeric values for all dimensions: ${ECOLOGY_DIMS.join(', ')}`,
      });
    }

    const channel = db.get('SELECT channel_id FROM corpus_channels WHERE channel_id = ?', [req.params.id]);
    if (!channel) return res.status(404).json({ ok: false, error: 'channel_not_found' });

    setManualEcologyOverride(db, req.params.id, profile, notes);
    res.json({ ok: true, channel_id: req.params.id, profile, notes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Release manual override ───────────────────────────────────────────────────

router.delete('/corpus/governance/ecology/channel/:id/override', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const channel = db.get('SELECT channel_id FROM corpus_channels WHERE channel_id = ?', [req.params.id]);
    if (!channel) return res.status(404).json({ ok: false, error: 'channel_not_found' });

    releaseManualOverride(db, req.params.id);
    res.json({ ok: true, channel_id: req.params.id, override_released: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── On-demand ecology probe (any YouTube channel, no corpus membership required) ──

router.post('/corpus/governance/ecology/probe', adminOnly, async (req, res) => {
  const ytKey = getYtKey();
  if (!ytKey) return res.status(503).json({ ok: false, error: 'YT_API_KEY not configured' });

  const { channel_id, handle, niche, seed = false } = req.body ?? {};
  if (!channel_id && !handle) {
    return res.status(400).json({ ok: false, error: 'channel_id or handle required' });
  }

  if (!quotaGuard.quotaAvailable(4)) {
    return res.status(429).json({ ok: false, error: 'quota_exhausted' });
  }

  let quotaUsed = 0;

  try {
    // ── Step 1: Resolve channel (handle or ID) → full metadata ───────────────
    const param = handle
      ? `forHandle=${encodeURIComponent(handle.startsWith('@') ? handle : `@${handle}`)}`
      : `id=${channel_id}`;

    const chRes  = await fetch(
      `${YT_BASE}/channels?part=contentDetails,snippet,statistics&${param}&key=${ytKey}`,
    );
    const chData = await chRes.json();
    quotaUsed++;
    quotaGuard.recordUsage(1, 'ecology_probe');

    if (!chRes.ok) {
      return res.status(502).json({ ok: false, error: chData?.error?.message ?? 'YouTube API error', quota_used: quotaUsed });
    }

    const item = chData.items?.[0];
    if (!item) {
      return res.status(404).json({ ok: false, error: 'channel_not_found_on_youtube', quota_used: quotaUsed });
    }

    const resolvedId      = item.id;
    const uploadsPlaylist = item.contentDetails?.relatedPlaylists?.uploads;
    const subscriberCount = parseInt(item.statistics?.subscriberCount ?? '0', 10);
    const channelTitle    = item.snippet?.title ?? '';
    const channelHandle   = item.snippet?.customUrl?.replace(/^@/, '').toLowerCase() ?? null;
    const thumbnailUrl    = item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? null;
    const videoCount      = parseInt(item.statistics?.videoCount ?? '0', 10);
    const totalViews      = parseInt(item.statistics?.viewCount   ?? '0', 10);

    if (!uploadsPlaylist) {
      return res.status(422).json({
        ok: false, error: 'uploads_playlist_unavailable',
        channel_id: resolvedId, title: channelTitle, quota_used: quotaUsed,
      });
    }

    // ── Step 2: Fetch recent video IDs ───────────────────────────────────────
    let videoIds = [];
    try {
      const playlist = await fetchPlaylistItems(uploadsPlaylist, null, 50);
      videoIds = playlist.videoIds;
      quotaUsed++;
      quotaGuard.recordUsage(1, 'ecology_probe');
    } catch (e) {
      return res.status(502).json({ ok: false, error: `playlistItems failed: ${e.message}`, quota_used: quotaUsed });
    }

    // ── Step 3: Fetch video details (titles, durations, stats) ───────────────
    let videos = [];
    if (videoIds.length > 0) {
      try {
        const videoMap = await fetchVideoFullBatch(videoIds.slice(0, 50));
        quotaUsed++;
        quotaGuard.recordUsage(1, 'ecology_probe');

        for (const [, v] of videoMap) {
          videos.push({
            title:            v.title,
            duration_seconds: v.duration_seconds,
            published_at:     v.published_at,
            views:            v.views,
            comments:         v.comments,
          });
        }
      } catch (e) {
        // Continue with empty video list — still return channel-level inference
        console.warn(`[ecologyProbe:${resolvedId}] videos.list failed:`, e.message);
      }
    }

    // ── Step 4: Run inference on live data ───────────────────────────────────
    const result = inferEcologyProfileFromData(videos, { subscriber_count: subscriberCount });

    // ── Step 5: Check if channel already exists in corpus ────────────────────
    const db = getDb();
    const existingCorpus = db.get(
      `SELECT channel_id, ecology_profile, ecology_confidence FROM corpus_channels WHERE channel_id = ?`,
      [resolvedId],
    );

    // ── Step 6: Optionally seed into corpus with ecology profile ─────────────
    let seeded = false;
    if (seed) {
      upsertCorpusChannel(db, {
        channel_id:          resolvedId,
        title:               channelTitle,
        handle:              channelHandle,
        thumbnail_url:       thumbnailUrl,
        uploads_playlist_id: uploadsPlaylist,
        niche:               niche ?? null,
        subscriber_count:    subscriberCount,
        video_count:         videoCount,
        total_views:         totalViews,
        discovery_source:    'ecology_probe',
      });
      saveEcologyProfile(db, resolvedId, result);
      seeded = true;
    }

    res.json({
      ok:            true,
      channel_id:    resolvedId,
      title:         channelTitle,
      handle:        channelHandle,
      subscriber_count: subscriberCount,
      video_count:   videoCount,
      already_in_corpus: !!existingCorpus,
      existing_corpus_ecology: existingCorpus?.ecology_profile
        ? (() => { try { return JSON.parse(existingCorpus.ecology_profile); } catch (_) { return null; } })()
        : null,
      ecology:       result,
      seeded,
      quota_used:    quotaUsed,
    });

  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, quota_used: quotaUsed });
  }
});

module.exports = router;
