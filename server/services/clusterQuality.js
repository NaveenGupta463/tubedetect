'use strict';

// Phase 4 — Cluster Quality Validation
//
// Measures per-cluster:
//   • Cohesion: avg cosine similarity of members to centroid
//   • Outlier frequency: members with similarity < (avg - 0.15)
//   • Inter-cluster separation: avg similarity between cluster centroids
//   • Weak / low-confidence / oversized cluster flags
//   • Nearest-neighbor sanity check
//   • Cluster stability estimate

const { findNearest, cosineSimilarity } = require('./vectorStore');

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr)  { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

function parseVec(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json) : json;
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch { return null; }
}

function centroidOf(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const c   = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) c[i] += v[i] / vectors.length;
  return c;
}

// ── Cohesion for one cluster ──────────────────────────────────────────────────

function computeClusterCohesion(db, clusterName, sampleLimit = 50) {
  const rows = db.all(`
    SELECT se.vector_json, iv.title
    FROM semantic_embeddings se
    LEFT JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
    WHERE se.source_type = 'title_dna' AND se.semantic_cluster = ?
    ORDER BY RANDOM()
    LIMIT ?
  `, [clusterName, sampleLimit]);

  if (rows.length < 3)
    return { cohesion: null, sample_size: rows.length, reason: 'insufficient_sample' };

  const vectors = rows.map(r => parseVec(r.vector_json)).filter(Boolean);
  if (vectors.length < 3)
    return { cohesion: null, sample_size: rows.length, reason: 'parse_error' };

  const centroid     = centroidOf(vectors);
  const sims         = vectors.map(v => cosineSimilarity(v, centroid));
  const avgCohesion  = mean(sims);
  const minSim       = Math.min(...sims);
  const outlierCount = sims.filter(s => s < avgCohesion - 0.15).length;

  return {
    cohesion:       parseFloat(avgCohesion.toFixed(4)),
    min_similarity: parseFloat(minSim.toFixed(4)),
    outlier_count:  outlierCount,
    outlier_rate:   parseFloat((outlierCount / vectors.length).toFixed(4)),
    sample_size:    vectors.length,
    quality:        avgCohesion > 0.7 ? 'high' : avgCohesion > 0.5 ? 'medium' : 'low',
    example_titles: rows.slice(0, 5).map(r => r.title).filter(Boolean),
  };
}

// ── Inter-cluster separation ──────────────────────────────────────────────────

function computeSeparation(db, clusterNames, samplePerCluster = 20) {
  const centroids = {};
  for (const name of clusterNames) {
    const rows    = db.all(`
      SELECT vector_json FROM semantic_embeddings
      WHERE source_type = 'title_dna' AND semantic_cluster = ?
      ORDER BY RANDOM() LIMIT ?
    `, [name, samplePerCluster]);
    const vectors = rows.map(r => parseVec(r.vector_json)).filter(Boolean);
    if (!vectors.length) continue;
    centroids[name] = centroidOf(vectors);
  }

  const names = Object.keys(centroids);
  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const sim = cosineSimilarity(centroids[names[i]], centroids[names[j]]);
      pairs.push({ a: names[i], b: names[j], similarity: parseFloat(sim.toFixed(4)) });
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);

  const avgSep      = pairs.length ? mean(pairs.map(p => p.similarity)) : 0;
  const highOverlap = pairs.filter(p => p.similarity > 0.85);

  return {
    avg_inter_cluster_similarity: parseFloat(avgSep.toFixed(4)),
    separation_quality:           avgSep < 0.6 ? 'high' : avgSep < 0.75 ? 'medium' : 'low',
    high_overlap_pairs:           highOverlap,
    top_pairs:                    pairs.slice(0, 20),
    centroid_count:               names.length,
  };
}

// ── Main report ───────────────────────────────────────────────────────────────

async function runClusterQualityReport(db) {
  const t0 = Date.now();

  const clusters = db.all(`
    SELECT cluster_name, sample_size, confidence FROM semantic_clusters ORDER BY sample_size DESC
  `);

  if (!clusters.length) return { ok: false, error: 'no_clusters' };

  // Cohesion per cluster
  const cohesionMap = {};
  for (const cl of clusters) {
    cohesionMap[cl.cluster_name] = computeClusterCohesion(db, cl.cluster_name, 50);
  }

  // Separation
  const names      = clusters.map(c => c.cluster_name);
  const separation = computeSeparation(db, names, 20);

  // Flag weak / low-confidence / oversized
  const weakClusters    = clusters.filter(c =>
    (cohesionMap[c.cluster_name]?.cohesion ?? 0) < 0.5 || c.sample_size < 5
  );
  const lowConfidence   = clusters.filter(c => c.confidence < 0.3);
  const oversized       = clusters.filter(c => c.sample_size > 500);

  // Nearest-neighbor sanity check
  let nnCheck = null;
  const randomRow = db.get(`
    SELECT source_id, vector_json, semantic_cluster
    FROM semantic_embeddings
    WHERE source_type = 'title_dna' AND semantic_cluster IS NOT NULL
    ORDER BY RANDOM() LIMIT 1
  `);
  if (randomRow) {
    const qv = parseVec(randomRow.vector_json);
    if (qv) {
      const neighbors    = findNearest(db, { queryVector: qv, sourceType: 'title_dna', limit: 5 });
      const sameCluster  = neighbors.filter(n => n.semantic_cluster === randomRow.semantic_cluster).length;
      nnCheck = {
        source_cluster:            randomRow.semantic_cluster,
        neighbors_same_cluster:    sameCluster,
        total_neighbors:           neighbors.length,
        nn_cluster_consistency:    neighbors.length ? parseFloat((sameCluster / neighbors.length).toFixed(4)) : 0,
      };
    }
  }

  // Cluster stability estimate (check if seeded clusters still have members)
  const seededClusters = db.all(`SELECT cluster_name FROM semantic_clusters WHERE seeded = 1`);
  const seededWithData = seededClusters.filter(c => {
    const count = db.get(`
      SELECT COUNT(*) AS n FROM semantic_embeddings WHERE semantic_cluster = ?
    `, [c.cluster_name])?.n ?? 0;
    return count > 0;
  });
  const stabilityScore = seededClusters.length
    ? parseFloat((seededWithData.length / seededClusters.length).toFixed(4)) : 1.0;

  const allCohesions = Object.values(cohesionMap)
    .map(r => r.cohesion ?? 0)
    .filter(v => v > 0);

  const report = {
    ok:                        true,
    ran_at:                    new Date().toISOString(),
    total_clusters:            clusters.length,
    cohesion_by_cluster:       cohesionMap,
    separation,
    weak_clusters:             weakClusters.map(c => c.cluster_name),
    low_confidence_clusters:   lowConfidence.map(c => c.cluster_name),
    oversized_clusters:        oversized.map(c => c.cluster_name),
    nn_sanity_check:           nnCheck,
    seeded_stability_score:    stabilityScore,
    avg_cohesion:              parseFloat(mean(allCohesions).toFixed(4)),
    overall_quality:           weakClusters.length === 0 && separation.high_overlap_pairs.length === 0
      ? 'good' : weakClusters.length <= 2 ? 'acceptable' : 'needs_attention',
    validation_ms:             Date.now() - t0,
  };

  persistReport(db, report);
  return report;
}

// ── Random sample for inspection ─────────────────────────────────────────────

function getNearestNeighborSample(db, clusterName, limit = 10) {
  const row = db.get(`
    SELECT vector_json, source_id FROM semantic_embeddings
    WHERE source_type = 'title_dna' AND semantic_cluster = ?
    ORDER BY RANDOM() LIMIT 1
  `, [clusterName]);
  if (!row) return [];

  const qv = parseVec(row.vector_json);
  if (!qv) return [];

  const neighbors = findNearest(db, { queryVector: qv, sourceType: 'title_dna', limit });
  return neighbors.map(n => {
    let title = null;
    try {
      title = db.get(`SELECT title FROM ingested_videos WHERE youtube_video_id = ?`, [n.source_id])?.title ?? null;
    } catch {}
    return { ...n, title };
  });
}

// ── Get last report ───────────────────────────────────────────────────────────

function getLastReport(db) {
  const row = db.get(`SELECT * FROM cluster_quality_snapshots ORDER BY ran_at DESC LIMIT 1`);
  if (!row) return null;
  try { return { ...row, report: JSON.parse(row.report_json) }; }
  catch { return row; }
}

// ── Persist ───────────────────────────────────────────────────────────────────

function persistReport(db, report) {
  try {
    db.run(`
      INSERT INTO cluster_quality_snapshots
        (ran_at, total_clusters, weak_cluster_count, low_confidence_count,
         avg_cohesion, avg_separation, overall_quality, report_json)
      VALUES (?,?,?,?,?,?,?,?)
    `, [
      report.ran_at,
      report.total_clusters,
      report.weak_clusters.length,
      report.low_confidence_clusters.length,
      report.avg_cohesion,
      report.separation.avg_inter_cluster_similarity,
      report.overall_quality,
      JSON.stringify(report),
    ]);
  } catch { /* non-fatal */ }
}

module.exports = {
  runClusterQualityReport, computeClusterCohesion, computeSeparation,
  getNearestNeighborSample, getLastReport,
};
