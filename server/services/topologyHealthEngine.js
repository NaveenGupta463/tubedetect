'use strict';

const crypto = require('crypto');

const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  DRIFTING: 'drifting',
  UNSTABLE: 'unstable',
  COLLAPSING: 'collapsing',
};

function computeClusterMetrics(db, clusterName) {
  const videoCount = db.get(
    `SELECT COUNT(*) as cnt FROM corpus_videos WHERE semantic_cluster = ?`,
    [clusterName]
  ).cnt;

  if (videoCount === 0) {
    return {
      video_count: 0,
      channel_count: 0,
      entropy: 0,
      cohesion: 0,
      outlier_ratio: 0,
      semantic_bleed: 0,
      cluster_dominance_pct: 0,
      issues: ['low_entropy', 'low_cohesion', 'outlier_explosion', 'semantic_bleed'],
      health_status: HEALTH_STATUS.COLLAPSING,
    };
  }

  const channelCount = db.get(
    `SELECT COUNT(DISTINCT channel_id) as cnt FROM corpus_videos WHERE semantic_cluster = ?`,
    [clusterName]
  ).cnt;

  let entropy = 0;
  if (channelCount > 1) {
    const channelDist = db.all(
      `SELECT channel_id, COUNT(*) as cnt FROM corpus_videos WHERE semantic_cluster = ? GROUP BY channel_id`,
      [clusterName]
    );
    const total = channelDist.reduce((s, r) => s + r.cnt, 0);
    const rawEntropy = channelDist.reduce((s, r) => {
      const p = r.cnt / total;
      return s - p * Math.log2(p);
    }, 0);
    entropy = rawEntropy / Math.log2(channelCount);
    entropy = Math.min(1, Math.max(0, entropy));
  } else {
    entropy = channelCount === 1 ? 0 : 0;
  }

  const vphRows = db.all(
    `SELECT vph FROM corpus_videos WHERE semantic_cluster = ? AND vph > 0`,
    [clusterName]
  );

  let cohesion = 1.0;
  if (vphRows.length >= 3) {
    const mean = vphRows.reduce((s, r) => s + r.vph, 0) / vphRows.length;
    if (mean > 0) {
      const variance = vphRows.reduce((s, r) => s + Math.pow(r.vph - mean, 2), 0) / vphRows.length;
      const stddev = Math.sqrt(variance);
      const cv = stddev / mean;
      cohesion = 1 - Math.min(1, cv / 3);
    }
  }

  const singleVideoChannels = db.get(
    `SELECT COUNT(*) as cnt FROM (
      SELECT channel_id FROM corpus_videos WHERE semantic_cluster = ? GROUP BY channel_id HAVING COUNT(*) = 1
    )`,
    [clusterName]
  ).cnt;
  const outlierRatio = channelCount > 0 ? singleVideoChannels / channelCount : 0;

  const channelsInOtherClusters = db.get(
    `SELECT COUNT(DISTINCT channel_id) as cnt FROM corpus_videos
     WHERE semantic_cluster != ? AND semantic_cluster IS NOT NULL
     AND channel_id IN (
       SELECT DISTINCT channel_id FROM corpus_videos WHERE semantic_cluster = ?
     )`,
    [clusterName, clusterName]
  ).cnt;
  const semanticBleed = channelCount > 0 ? channelsInOtherClusters / channelCount : 0;

  const totalClustered = db.get(
    `SELECT COUNT(*) as cnt FROM corpus_videos WHERE semantic_cluster IS NOT NULL`
  ).cnt;
  const dominancePct = totalClustered > 0 ? videoCount / totalClustered : 0;

  const issues = [];
  if (entropy < 0.3) issues.push('low_entropy');
  if (cohesion < 0.3) issues.push('low_cohesion');
  if (outlierRatio > 0.7) issues.push('outlier_explosion');
  if (semanticBleed > 0.6) issues.push('semantic_bleed');
  if (dominancePct > 0.3) issues.push('giant_cluster');

  let healthStatus;
  if (issues.length === 0) healthStatus = HEALTH_STATUS.HEALTHY;
  else if (issues.length === 1) healthStatus = HEALTH_STATUS.DRIFTING;
  else if (issues.length <= 3) healthStatus = HEALTH_STATUS.UNSTABLE;
  else healthStatus = HEALTH_STATUS.COLLAPSING;

  return {
    video_count: videoCount,
    channel_count: channelCount,
    entropy,
    cohesion,
    outlier_ratio: outlierRatio,
    semantic_bleed: semanticBleed,
    cluster_dominance_pct: dominancePct,
    issues,
    health_status: healthStatus,
  };
}

function captureTopologySnapshot(db) {
  const clusterRows = db.all(
    `SELECT DISTINCT semantic_cluster FROM corpus_videos WHERE semantic_cluster IS NOT NULL`
  );

  const statusOrder = {
    [HEALTH_STATUS.COLLAPSING]: 3,
    [HEALTH_STATUS.UNSTABLE]: 2,
    [HEALTH_STATUS.DRIFTING]: 1,
    [HEALTH_STATUS.HEALTHY]: 0,
  };

  const snapshotAt = new Date().toISOString();
  const healthSummary = { healthy: 0, drifting: 0, unstable: 0, collapsing: 0 };
  let snapshotsWritten = 0;
  let worstStatusRank = 0;
  const nonHealthyClusters = [];

  for (const row of clusterRows) {
    const name = row.semantic_cluster;
    const metrics = computeClusterMetrics(db, name);

    healthSummary[metrics.health_status]++;
    const rank = statusOrder[metrics.health_status] || 0;
    if (rank > worstStatusRank) worstStatusRank = rank;

    if (metrics.health_status !== HEALTH_STATUS.HEALTHY) {
      nonHealthyClusters.push({ name, issues: metrics.issues, health_status: metrics.health_status });
    }

    db.run(
      `INSERT INTO topology_health_snapshots
        (id, cluster_name, snapshot_at, video_count, channel_count, entropy, cohesion,
         overlap_pressure, outlier_ratio, archetype_inflation, giant_cluster_size,
         centroid_instability, semantic_bleed, health_status, metrics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        name,
        snapshotAt,
        metrics.video_count,
        metrics.channel_count,
        metrics.entropy,
        metrics.cohesion,
        0,
        metrics.outlier_ratio,
        0,
        metrics.cluster_dominance_pct,
        0,
        metrics.semantic_bleed,
        metrics.health_status,
        JSON.stringify(metrics),
      ]
    );
    snapshotsWritten++;
  }

  const overallStatusMap = ['healthy', 'drifting', 'unstable', 'collapsing'];
  const overallHealth = overallStatusMap[worstStatusRank];

  const worstClusters = nonHealthyClusters
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 5);

  return {
    clusters_evaluated: clusterRows.length,
    snapshots_written: snapshotsWritten,
    overall_health: overallHealth,
    health_summary: healthSummary,
    worst_clusters: worstClusters,
  };
}

function getLatestTopologySnapshot(db) {
  const latest = db.get(
    `SELECT MAX(snapshot_at) as max_at FROM topology_health_snapshots`
  );

  if (!latest || !latest.max_at) {
    return { snapshot_at: null, clusters: [], health_summary: { healthy: 0, drifting: 0, unstable: 0, collapsing: 0 } };
  }

  const snapshotAt = latest.max_at;
  const clusters = db.all(
    `SELECT * FROM topology_health_snapshots WHERE snapshot_at = ?`,
    [snapshotAt]
  );

  const healthSummary = { healthy: 0, drifting: 0, unstable: 0, collapsing: 0 };
  for (const c of clusters) {
    if (healthSummary[c.health_status] !== undefined) {
      healthSummary[c.health_status]++;
    }
  }

  return { snapshot_at: snapshotAt, clusters, health_summary: healthSummary };
}

module.exports = {
  HEALTH_STATUS,
  computeClusterMetrics,
  captureTopologySnapshot,
  getLatestTopologySnapshot,
};
