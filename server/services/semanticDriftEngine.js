'use strict';

const crypto = require('crypto');

function emitAlert(db, { alert_type, severity = 'medium', cluster = null, drift_score = 0, explanation }) {
  const existing = db.get(
    `SELECT id FROM governance_alerts WHERE alert_type = ? AND cluster IS ? AND created_at > datetime('now', '-24 hours')`,
    [alert_type, cluster]
  );

  if (existing) return null;

  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO governance_alerts (id, alert_type, severity, cluster, drift_score, explanation, acknowledged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
    [id, alert_type, severity, cluster, drift_score, explanation]
  );

  console.warn(`[SemanticDriftEngine] Alert emitted: type=${alert_type} cluster=${cluster} severity=${severity} score=${drift_score}`);
  return id;
}

function detectClusterDilution(db) {
  const totalClustered = db.get(
    `SELECT COUNT(*) as cnt FROM corpus_videos WHERE semantic_cluster IS NOT NULL`
  ).cnt;

  const clusters = db.all(
    `SELECT semantic_cluster, COUNT(*) as video_count FROM corpus_videos
     WHERE semantic_cluster IS NOT NULL
     GROUP BY semantic_cluster
     HAVING COUNT(*) >= 10`
  );

  const emitted = [];

  for (const row of clusters) {
    const dominance = totalClustered > 0 ? row.video_count / totalClustered : 0;

    if (dominance > 0.3) {
      const severity = dominance > 0.5 ? 'high' : 'medium';
      const id = emitAlert(db, {
        alert_type: 'giant_cluster_growth',
        severity,
        cluster: row.semantic_cluster,
        drift_score: Math.round(dominance * 100),
        explanation: `Cluster "${row.semantic_cluster}" contains ${Math.round(dominance * 100)}% of all clustered videos`,
      });
      if (id) emitted.push({ id, alert_type: 'giant_cluster_growth', cluster: row.semantic_cluster, severity });
    }

    const channelCount = db.get(
      `SELECT COUNT(DISTINCT channel_id) as cnt FROM corpus_videos WHERE semantic_cluster = ?`,
      [row.semantic_cluster]
    ).cnt;

    if (channelCount > 0) {
      const singleVideoChannels = db.get(
        `SELECT COUNT(*) as cnt FROM (
          SELECT channel_id FROM corpus_videos WHERE semantic_cluster = ? GROUP BY channel_id HAVING COUNT(*) = 1
        )`,
        [row.semantic_cluster]
      ).cnt;
      const outlierFraction = singleVideoChannels / channelCount;

      if (outlierFraction > 0.6) {
        const id = emitAlert(db, {
          alert_type: 'cluster_dilution',
          severity: 'medium',
          cluster: row.semantic_cluster,
          drift_score: Math.round(outlierFraction * 100),
          explanation: `Cluster "${row.semantic_cluster}" has ${Math.round(outlierFraction * 100)}% single-video channels (outlier fraction)`,
        });
        if (id) emitted.push({ id, alert_type: 'cluster_dilution', cluster: row.semantic_cluster, severity: 'medium' });
      }
    }
  }

  return emitted;
}

function detectArchetypeSaturation(db) {
  const totalTrained = db.get(
    `SELECT COUNT(*) as cnt FROM corpus_channels WHERE training_eligible = 1`
  ).cnt;

  if (totalTrained === 0) return [];

  const niches = db.all(
    `SELECT niche, COUNT(*) as total, SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) as trained
     FROM corpus_channels
     GROUP BY niche`
  );

  const emitted = [];

  for (const row of niches) {
    if (!row.niche || row.trained === 0) continue;
    const density = row.trained / totalTrained;

    if (density > 0.35) {
      const severity = density > 0.5 ? 'high' : 'medium';
      const id = emitAlert(db, {
        alert_type: 'archetype_saturation',
        severity,
        cluster: row.niche,
        drift_score: Math.round(density * 100),
        explanation: `Niche "${row.niche}" accounts for ${Math.round(density * 100)}% of all trained channels`,
      });
      if (id) emitted.push({ id, alert_type: 'archetype_saturation', cluster: row.niche, severity });
    }
  }

  return emitted;
}

function detectEntropyCollapse(db) {
  const rows = db.all(
    `SELECT cluster_name, entropy, health_status
     FROM topology_health_snapshots
     WHERE entropy < ? AND snapshot_at > datetime('now', '-48 hours')
     GROUP BY cluster_name
     HAVING MAX(snapshot_at)`,
    [0.35]
  );

  const emitted = [];

  for (const row of rows) {
    const severity = row.entropy < 0.2 ? 'high' : 'medium';
    const driftScore = Math.round((1 - row.entropy) * 100);
    const id = emitAlert(db, {
      alert_type: 'entropy_collapse',
      severity,
      cluster: row.cluster_name,
      drift_score: driftScore,
      explanation: `Cluster "${row.cluster_name}" has critically low entropy of ${row.entropy.toFixed(3)} indicating content convergence`,
    });
    if (id) emitted.push({ id, alert_type: 'entropy_collapse', cluster: row.cluster_name, severity, drift_score: driftScore });
  }

  return emitted;
}

function runDriftDetection(db) {
  const dilution = detectClusterDilution(db);
  const saturation = detectArchetypeSaturation(db);
  const entropy = detectEntropyCollapse(db);

  return {
    alerts_emitted: dilution.length + saturation.length + entropy.length,
    dilution,
    saturation,
    entropy,
  };
}

function getActiveAlerts(db, { severity, limit = 50 } = {}) {
  if (severity) {
    return db.all(
      `SELECT * FROM governance_alerts WHERE acknowledged = 0 AND severity = ? ORDER BY created_at DESC LIMIT ?`,
      [severity, limit]
    );
  }
  return db.all(
    `SELECT * FROM governance_alerts WHERE acknowledged = 0 ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

function acknowledgeAlert(db, alertId) {
  db.run(
    `UPDATE governance_alerts SET acknowledged = 1 WHERE id = ?`,
    [alertId]
  );
}

module.exports = {
  emitAlert,
  detectClusterDilution,
  detectArchetypeSaturation,
  detectEntropyCollapse,
  runDriftDetection,
  getActiveAlerts,
  acknowledgeAlert,
};
