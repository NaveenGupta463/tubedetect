'use strict';

function getArchetypeDensity(db) {
  const rows = db.all(
    'SELECT niche, COUNT(*) as total, SUM(training_eligible) as trained FROM corpus_channels WHERE niche IS NOT NULL GROUP BY niche'
  );
  const totalTrained = db.get('SELECT COUNT(*) as cnt FROM corpus_channels WHERE training_eligible = 1');
  const corpusTotal = totalTrained ? (totalTrained.cnt || 1) : 1;

  const density = {};
  for (const row of rows) {
    const trained = row.trained || 0;
    density[row.niche] = {
      total: row.total,
      trained,
      density: trained / corpusTotal,
      trained_pct: row.total > 0 ? trained / row.total : 0
    };
  }
  return density;
}

function getClusterDominance(db) {
  const rows = db.all(
    'SELECT semantic_cluster, COUNT(*) as video_count FROM corpus_videos WHERE semantic_cluster IS NOT NULL GROUP BY semantic_cluster'
  );
  const totalRow = db.get('SELECT COUNT(*) as cnt FROM corpus_videos WHERE semantic_cluster IS NOT NULL');
  const total = totalRow ? (totalRow.cnt || 1) : 1;

  const dominance = {};
  for (const row of rows) {
    dominance[row.semantic_cluster] = {
      video_count: row.video_count,
      dominance: row.video_count / total
    };
  }
  return dominance;
}

function calculateDiversityDiscount(db, channel) {
  const niche = channel.niche;
  if (!niche || niche === 'other') return 1.05;

  const densityMap = getArchetypeDensity(db);
  const entry = densityMap[niche];
  if (!entry) return 1.05;

  const density = entry.density;
  const baseline = 0.20;
  const diff = density - baseline;

  if (diff <= 0) {
    return parseFloat(Math.min(1.1, 1 + Math.abs(diff) * 0.5).toFixed(3));
  }

  const discount = Math.min(0.6, diff * 1.5);
  return parseFloat((1 - discount).toFixed(3));
}

function calculateSemanticNovelty(db, channel) {
  const niche = channel.niche;
  const densityMap = getArchetypeDensity(db);

  let score = 50;

  // Niche sparsity
  if (!niche || niche === 'other') {
    score += 25;
  } else {
    const entry = densityMap[niche];
    const density = entry ? entry.density : 0;
    score += Math.round((1 - Math.min(1, density * 3)) * 30);
  }

  // Semantic status
  const semStatus = channel.semantic_status || '';
  if (semStatus === 'pending' || !semStatus) score += 15;
  else if (semStatus === 'embedded') score += 8;
  else if (semStatus === 'clustered' || semStatus === 'mapped') score += 3;

  // Sparse cluster count
  const clusterDom = getClusterDominance(db);
  const channelVideos = db.all(
    'SELECT semantic_cluster FROM corpus_videos WHERE channel_id = ? AND semantic_cluster IS NOT NULL',
    [channel.channel_id]
  );
  let sparseCount = 0;
  for (const v of channelVideos) {
    const clust = clusterDom[v.semantic_cluster];
    if (!clust || clust.video_count < 10) sparseCount++;
  }
  score += Math.min(10, sparseCount * 2);

  // Oversaturation penalty
  if (niche && niche !== 'other') {
    const entry = densityMap[niche];
    const density = entry ? entry.density : 0;
    if (density > 0.3) {
      score -= Math.round((density - 0.3) * 40);
    }
  }

  return Math.max(0, Math.min(100, score));
}

function applyDiversityPressure(db, channel) {
  const noveltyScore = calculateSemanticNovelty(db, channel);
  const diversityDiscount = calculateDiversityDiscount(db, channel);

  db.run(
    'UPDATE corpus_channels SET semantic_novelty_score = ? WHERE channel_id = ?',
    [noveltyScore, channel.channel_id]
  );

  return { novelty_score: noveltyScore, diversity_discount: diversityDiscount };
}

function runDiversityPressurePass(db, limit = 2000) {
  const channels = db.all(
    'SELECT * FROM corpus_channels LIMIT ?',
    [limit]
  );

  let updated = 0;
  for (const channel of channels) {
    try {
      applyDiversityPressure(db, channel);
      updated++;
    } catch (e) {
      // skip errored channels
    }
  }

  const density = getArchetypeDensity(db);
  return { updated, density };
}

function getDominanceReport(db) {
  const nicheDensity = getArchetypeDensity(db);
  const clusterDominance = getClusterDominance(db);

  const riskyNiches = Object.entries(nicheDensity)
    .filter(([, v]) => v.density > 0.3)
    .map(([niche, v]) => ({ niche, ...v }));

  const giantClusters = Object.entries(clusterDominance)
    .filter(([, v]) => v.dominance > 0.25)
    .map(([cluster, v]) => ({ cluster, ...v }));

  const echoChamberRisk = riskyNiches.length > 0 || giantClusters.length > 0;

  return {
    niche_density: nicheDensity,
    cluster_dominance: clusterDominance,
    risky_niches: riskyNiches,
    giant_clusters: giantClusters,
    echo_chamber_risk: echoChamberRisk
  };
}

module.exports = {
  getArchetypeDensity,
  getClusterDominance,
  calculateDiversityDiscount,
  calculateSemanticNovelty,
  applyDiversityPressure,
  runDiversityPressurePass,
  getDominanceReport
};
