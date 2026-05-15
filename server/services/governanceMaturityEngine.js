'use strict';

/**
 * Governance Maturity Engine — Phase XIII
 *
 * Evaluates whether TubeIntel's corpus is mature enough for additional
 * governance layers. Produces a governance_maturity_score (0–100) that
 * supports plateauing, regression, and instability penalties.
 *
 * AUTHORITY MODEL:
 * The engine may advance layer status: future → monitoring → recommended → urgent.
 * Only admin may set: active | deferred.
 * The engine NEVER activates, mutates topology, or self-governs.
 */

const crypto = require('crypto');

// ── Live corpus metrics ───────────────────────────────────────────────────────

function readCorpusMetrics(db) {
  const channels       = db.get('SELECT COUNT(*) AS n FROM corpus_channels')?.n ?? 0;
  const training       = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE training_eligible=1')?.n ?? 0;
  const onProbation    = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE probation_state=1')?.n ?? 0;
  const unscored       = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE quality_score=0 OR quality_score IS NULL')?.n ?? 0;
  const videos         = db.get('SELECT COUNT(*) AS n FROM corpus_videos')?.n ?? 0;
  const embedded       = db.get(`SELECT COUNT(*) AS n FROM corpus_videos WHERE embedding_status='done'`)?.n ?? 0;
  const clusterCount   = db.get('SELECT COUNT(DISTINCT semantic_cluster) AS n FROM corpus_videos WHERE semantic_cluster IS NOT NULL')?.n ?? 0;
  const graphEdges     = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph')?.n ?? 0;
  const weakEdges      = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph WHERE edge_strength < 0.3')?.n ?? 0;

  // Archetype dominance: highest single-niche % of training corpus
  const nicheMax = db.get(
    `SELECT MAX(niche_count) AS mx FROM (
       SELECT COUNT(*) AS niche_count FROM corpus_channels
       WHERE training_eligible=1 AND niche IS NOT NULL GROUP BY niche
     )`,
  )?.mx ?? 0;
  const archetype_dominance_pct = training > 0 ? Math.round((nicheMax / training) * 100) : 0;

  // Average semantic novelty of corpus
  const avgNovelty = db.get(
    'SELECT AVG(semantic_novelty_score) AS v FROM corpus_channels WHERE semantic_novelty_score IS NOT NULL',
  )?.v ?? null;

  // Topology health: latest snapshot
  const topoSnap = db.get(
    `SELECT health_status, snapshot_at FROM topology_health_snapshots
     ORDER BY snapshot_at DESC LIMIT 1`,
  );
  const topoSnapAgeDays = topoSnap?.snapshot_at
    ? (Date.now() - new Date(topoSnap.snapshot_at).getTime()) / 86_400_000
    : 999;

  // Recent governance alert counts (last 7 days)
  const alertsHigh   = db.get(`SELECT COUNT(*) AS n FROM governance_alerts WHERE severity='high'   AND acknowledged=0 AND created_at > datetime('now','-7 days')`)?.n ?? 0;
  const alertsMedium = db.get(`SELECT COUNT(*) AS n FROM governance_alerts WHERE severity='medium' AND acknowledged=0 AND created_at > datetime('now','-7 days')`)?.n ?? 0;

  // Recent demotion pressure (last 30 days)
  const recentDemotions  = db.get(`SELECT COUNT(*) AS n FROM corpus_channels WHERE training_demoted_at > datetime('now','-30 days')`)?.n ?? 0;
  const recentPromotions = db.get(`SELECT COUNT(*) AS n FROM corpus_channels WHERE training_promoted_at > datetime('now','-30 days')`)?.n ?? 0;

  // Corpus data span (oldest created_at to now)
  const oldest = db.get('SELECT MIN(created_at) AS d FROM corpus_channels')?.d ?? null;
  const corpus_data_span_days = oldest
    ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000)
    : 0;

  // Average trust score
  const avgTrust = db.get(
    'SELECT AVG(training_trust_score) AS v FROM corpus_channels WHERE training_trust_score IS NOT NULL',
  )?.v ?? null;

  return {
    corpus_channels:         channels,
    training_corpus_size:    training,
    on_probation:            onProbation,
    unscored_channels:       unscored,
    corpus_videos:           videos,
    embedded_videos:         embedded,
    cluster_count:           clusterCount,
    graph_edges:             graphEdges,
    weak_edges:              weakEdges,
    archetype_dominance_pct,
    avg_novelty_score:       avgNovelty != null ? +avgNovelty.toFixed(1) : null,
    topology_health:         topoSnap?.health_status ?? 'no_data',
    topology_snapshot_age_days: +topoSnapAgeDays.toFixed(1),
    alerts_high_7d:          alertsHigh,
    alerts_medium_7d:        alertsMedium,
    recent_demotions_30d:    recentDemotions,
    recent_promotions_30d:   recentPromotions,
    corpus_data_span_days,
    avg_trust_score:         avgTrust != null ? +avgTrust.toFixed(1) : null,
  };
}

// ── Maturity dimensions (each 0–20) ──────────────────────────────────────────

function dimCorpusScale(m) {
  // Based on training corpus size (primary signal) and total channels
  const trainScore   = Math.min(10, (m.training_corpus_size / 500) * 10);
  const channelScore = Math.min(10, (m.corpus_channels / 2000) * 10);
  return Math.round(trainScore + channelScore);
}

function dimSemanticCoverage(m) {
  // Cluster count + embedding coverage
  const clusterScore   = Math.min(10, (m.cluster_count / 30) * 10);
  const embedCoverage  = m.corpus_videos > 0
    ? m.embedded_videos / m.corpus_videos
    : 0;
  const embedScore     = Math.min(10, embedCoverage * 10);
  return Math.round(clusterScore + embedScore);
}

function dimGovernanceHealth(m) {
  // Probation ratio (lower = healthier, more graduated)
  const total         = m.corpus_channels || 1;
  const probationRate = m.on_probation / total;
  const probScore     = Math.round(Math.max(0, (1 - probationRate * 2)) * 10);

  // Trust score coverage
  const trustScore    = m.avg_trust_score != null
    ? Math.min(10, (m.avg_trust_score / 100) * 10)
    : 3;
  return Math.round(probScore + trustScore);
}

function dimTopologyStability(m) {
  // Topology health status
  const healthScore = {
    healthy:    10,
    drifting:   7,
    unstable:   3,
    collapsing: 0,
    no_data:    5,
  }[m.topology_health] ?? 5;

  // Graph edge health (weak edge ratio)
  const edgeRatio  = m.graph_edges > 0 ? m.weak_edges / m.graph_edges : 0;
  const edgeScore  = Math.round(Math.max(0, (1 - edgeRatio * 2)) * 10);
  return Math.round(healthScore + edgeScore);
}

function dimDiversityHealth(m) {
  // Archetype dominance (lower = healthier)
  const dominanceScore = Math.round(Math.max(0, (1 - m.archetype_dominance_pct / 60)) * 10);

  // Novelty score (higher = better diversity)
  const noveltyScore = m.avg_novelty_score != null
    ? Math.min(10, (m.avg_novelty_score / 100) * 10)
    : 5;
  return Math.round(dominanceScore + noveltyScore);
}

// ── Instability & uncertainty → confidence_factor ─────────────────────────────

function calculateConfidenceFactor(m) {
  let penalty = 0;

  // Active alert pressure
  penalty += Math.min(0.10, m.alerts_high_7d   * 0.04);
  penalty += Math.min(0.06, m.alerts_medium_7d * 0.015);

  // Topology degradation
  if (m.topology_health === 'unstable')   penalty += 0.06;
  if (m.topology_health === 'collapsing') penalty += 0.12;
  if (m.topology_snapshot_age_days > 3)   penalty += 0.04;

  // Trust instability: more demotions than promotions = regression signal
  const netDemotion = m.recent_demotions_30d - m.recent_promotions_30d;
  if (netDemotion > 5)  penalty += Math.min(0.08, (netDemotion / 20) * 0.08);

  // Data coverage gaps (uncertainty, not instability)
  const total = m.corpus_channels || 1;
  const unscoredRate = m.unscored_channels / total;
  penalty += Math.min(0.06, unscoredRate * 0.12);

  const embedRate = m.corpus_videos > 0 ? 1 - (m.embedded_videos / m.corpus_videos) : 0.5;
  penalty += Math.min(0.05, embedRate * 0.08);

  // High probation rate = topology not settled yet
  const probRate = m.on_probation / total;
  penalty += Math.min(0.04, probRate * 0.06);

  return +Math.max(0.4, 1 - penalty).toFixed(3);
}

// ── Main score calculation ────────────────────────────────────────────────────

function calculateGovernanceMaturity(db) {
  const m = readCorpusMetrics(db);

  const dims = {
    corpus_scale:        dimCorpusScale(m),       // 0–20
    semantic_coverage:   dimSemanticCoverage(m),  // 0–20
    governance_health:   dimGovernanceHealth(m),  // 0–20
    topology_stability:  dimTopologyStability(m), // 0–20
    diversity_health:    dimDiversityHealth(m),   // 0–20
  };

  const raw_score        = Object.values(dims).reduce((s, v) => s + v, 0); // 0–100
  const confidence       = calculateConfidenceFactor(m);
  const effective_score  = Math.round(raw_score * confidence);

  const stage = (() => {
    if (effective_score < 20) return 'early_corpus';
    if (effective_score < 40) return 'stable_semantic_topology';
    if (effective_score < 60) return 'governed_semantic_ecosystem';
    if (effective_score < 80) return 'advanced_topology_intelligence';
    return 'self_regulating_semantic_infrastructure';
  })();

  return {
    raw_score,
    effective_score,
    confidence,
    stage,
    dimensions: dims,
    metrics:    m,
    evaluated_at: new Date().toISOString(),
  };
}

// ── Layer readiness evaluation ────────────────────────────────────────────────

function evaluateLayerReadiness(db, layer, metrics, governanceScore) {
  const conditions = (() => {
    try { return JSON.parse(layer.readiness_conditions ?? '{}'); } catch (_) { return {}; }
  })();

  const live = {
    ...metrics,
    governance_maturity_score:    governanceScore,
    recommendation_engine_exists: false, // not yet implemented
    autonomous_topology_mutation: false, // not yet implemented
    topology_cohesion_stable:     metrics.topology_health === 'healthy' || metrics.topology_health === 'drifting',
    graph_centralization_risk:    metrics.archetype_dominance_pct > 30,
  };

  const results = Object.entries(conditions).map(([key, rule]) => {
    const value = live[key] ?? null;
    let met = false;

    if (rule.gte != null) met = value != null && value >= rule.gte;
    else if (rule.lte != null) met = value != null && value <= rule.lte;
    else if (rule.eq  != null) met = value === rule.eq;

    return { condition: key, required: rule, current_value: value, met };
  });

  const metCount   = results.filter(r => r.met).length;
  const totalCount = results.length;
  const readiness_pct = totalCount > 0 ? Math.round((metCount / totalCount) * 100) : 0;
  const blocking = results.filter(r => !r.met);

  return { readiness_pct, met: metCount, total: totalCount, blocking, conditions: results };
}

// ── Status advancement logic ──────────────────────────────────────────────────

// Engine may advance: future → monitoring → recommended → urgent
// Admin-only: active, deferred
const ENGINE_ADVANCEABLE = new Set(['future', 'monitoring', 'recommended', 'urgent']);
const ADMIN_ONLY_STATUSES = new Set(['active', 'deferred']);

function computeTargetStatus(currentStatus, readiness_pct) {
  if (ADMIN_ONLY_STATUSES.has(currentStatus)) return currentStatus; // engine never touches these
  if (readiness_pct >= 90) return 'urgent';
  if (readiness_pct >= 65) return 'recommended';
  if (readiness_pct >= 35) return 'monitoring';
  return 'future';
}

// ── History recording ─────────────────────────────────────────────────────────

function recordLayerHistory(db, {
  layerId, governanceLayer, previousStatus, newStatus,
  triggeringMetrics, relevantAlerts, maturityBefore, maturityAfter, rationale,
  changedBy = 'system_evaluation',
}) {
  db.run(
    `INSERT INTO governance_layer_history
       (id, layer_id, governance_layer, previous_status, new_status,
        triggering_metrics, relevant_alerts,
        maturity_score_before, maturity_score_after, maturity_delta,
        rationale, changed_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      crypto.randomUUID(), layerId, governanceLayer,
      previousStatus, newStatus,
      JSON.stringify(triggeringMetrics ?? {}),
      JSON.stringify(relevantAlerts ?? []),
      maturityBefore ?? null, maturityAfter ?? null,
      maturityAfter != null && maturityBefore != null ? maturityAfter - maturityBefore : null,
      rationale ?? null, changedBy,
    ],
  );
}

// ── Active alert IDs for history ──────────────────────────────────────────────

function getRecentAlertIds(db, limit = 10) {
  return db.all(
    `SELECT id FROM governance_alerts WHERE acknowledged=0 ORDER BY created_at DESC LIMIT ?`,
    [limit],
  ).map(r => r.id);
}

// ── Main maturity check (runs in scheduler) ───────────────────────────────────

function runMaturityCheck(db) {
  const maturity   = calculateGovernanceMaturity(db);
  const metrics    = maturity.metrics;
  const score      = maturity.effective_score;
  const alertIds   = getRecentAlertIds(db);

  const layers     = db.all('SELECT * FROM governance_roadmap ORDER BY implementation_priority ASC');
  const updates    = [];

  for (const layer of layers) {
    if (ADMIN_ONLY_STATUSES.has(layer.current_status)) continue;

    const readiness     = evaluateLayerReadiness(db, layer, metrics, score);
    const targetStatus  = computeTargetStatus(layer.current_status, readiness.readiness_pct);
    const statusChanged = targetStatus !== layer.current_status;

    // Always update readiness_pct and last_evaluated_at
    db.run(
      `UPDATE governance_roadmap SET readiness_pct=?, last_evaluated_at=datetime('now') WHERE id=?`,
      [readiness.readiness_pct, layer.id],
    );

    if (statusChanged) {
      db.run(
        `UPDATE governance_roadmap SET current_status=? WHERE id=?`,
        [targetStatus, layer.id],
      );

      const rationale = buildRationale(layer.governance_layer, layer.current_status, targetStatus, readiness, metrics);

      recordLayerHistory(db, {
        layerId:          layer.id,
        governanceLayer:  layer.governance_layer,
        previousStatus:   layer.current_status,
        newStatus:        targetStatus,
        triggeringMetrics: {
          corpus_channels:      metrics.corpus_channels,
          training_corpus_size: metrics.training_corpus_size,
          cluster_count:        metrics.cluster_count,
          archetype_dominance:  metrics.archetype_dominance_pct,
          effective_score:      score,
          confidence:           maturity.confidence,
        },
        relevantAlerts:   alertIds,
        maturityBefore:   null, // previous score not tracked here
        maturityAfter:    score,
        rationale,
      });

      updates.push({
        layer:    layer.governance_layer,
        from:     layer.current_status,
        to:       targetStatus,
        readiness_pct: readiness.readiness_pct,
      });

      // Emit governance alert when layer becomes recommended or urgent
      if (targetStatus === 'recommended' || targetStatus === 'urgent') {
        try {
          db.run(
            `INSERT INTO governance_alerts (id, alert_type, severity, cluster, drift_score, explanation)
             VALUES (?,?,?,?,?,?)`,
            [
              crypto.randomUUID(),
              'governance_layer_ready',
              targetStatus === 'urgent' ? 'high' : 'medium',
              layer.governance_layer,
              readiness.readiness_pct,
              rationale,
            ],
          );
        } catch (_) {}
      }

      console.log(`[governanceMaturity] ${layer.governance_layer}: ${layer.current_status} → ${targetStatus} (${readiness.readiness_pct}% ready)`);
    }
  }

  return {
    effective_score: score,
    raw_score:       maturity.raw_score,
    confidence:      maturity.confidence,
    stage:           maturity.stage,
    layers_evaluated: layers.length,
    status_changes:  updates,
  };
}

function buildRationale(layer, from, to, readiness, metrics) {
  const blocking = readiness.blocking.map(b => `${b.condition} (need ${JSON.stringify(b.required)}, have ${b.current_value})`).join('; ');
  const met      = readiness.conditions.filter(c => c.met).map(c => c.condition).join(', ');

  if (to === 'urgent') {
    return `${layer} is now urgent (${readiness.readiness_pct}% ready). All critical conditions met: ${met}. Immediate admin review recommended.`;
  }
  if (to === 'recommended') {
    return `${layer} is recommended for implementation (${readiness.readiness_pct}% ready). Conditions met: ${met}. Remaining: ${blocking || 'none'}.`;
  }
  if (to === 'monitoring') {
    return `${layer} moved to monitoring (${readiness.readiness_pct}% ready). Conditions partially met: ${met}. Blocking: ${blocking}.`;
  }
  return `${layer} reverted to future stage (${readiness.readiness_pct}% ready). Blocking conditions: ${blocking}.`;
}

// ── Maturity report ───────────────────────────────────────────────────────────

function generateMaturityReport(db) {
  const maturity = calculateGovernanceMaturity(db);
  const layers   = db.all('SELECT * FROM governance_roadmap ORDER BY implementation_priority ASC');

  const byStatus = layers.reduce((acc, l) => {
    acc[l.current_status] = (acc[l.current_status] ?? 0) + 1;
    return acc;
  }, {});

  const urgentLayers     = layers.filter(l => l.current_status === 'urgent');
  const recommendedLayers = layers.filter(l => l.current_status === 'recommended');
  const monitoringLayers = layers.filter(l => l.current_status === 'monitoring');

  const recentHistory = db.all(
    `SELECT * FROM governance_layer_history ORDER BY changed_at DESC LIMIT 20`,
  );

  const ecosystemRisks = [];
  const m = maturity.metrics;
  if (m.archetype_dominance_pct > 35)   ecosystemRisks.push({ risk: 'archetype_saturation',    detail: `Dominant archetype at ${m.archetype_dominance_pct}% of training corpus` });
  if (m.alerts_high_7d > 2)             ecosystemRisks.push({ risk: 'elevated_alert_pressure',  detail: `${m.alerts_high_7d} high-severity alerts in last 7 days` });
  if (m.topology_health === 'unstable')  ecosystemRisks.push({ risk: 'topology_instability',    detail: 'Semantic topology classified as unstable' });
  if (m.recent_demotions_30d > m.recent_promotions_30d + 5)
    ecosystemRisks.push({ risk: 'trust_regression', detail: `Net demotion pressure: ${m.recent_demotions_30d} demotions vs ${m.recent_promotions_30d} promotions in 30d` });

  return {
    generated_at:         new Date().toISOString(),
    governance_maturity:  maturity,
    layer_summary:        byStatus,
    urgent:               urgentLayers,
    recommended:          recommendedLayers,
    monitoring:           monitoringLayers,
    recent_transitions:   recentHistory,
    ecosystem_risks:      ecosystemRisks,
    governance_gaps: layers
      .filter(l => l.current_status === 'future' && l.implementation_priority <= 3)
      .map(l => ({ layer: l.governance_layer, priority: l.implementation_priority, description: l.description })),
  };
}

module.exports = {
  readCorpusMetrics,
  calculateGovernanceMaturity,
  evaluateLayerReadiness,
  runMaturityCheck,
  generateMaturityReport,
  recordLayerHistory,
};
