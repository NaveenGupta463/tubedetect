'use strict';

const { classifyHookTypeMulti } = require('./hookClassifier');

const SEED_CENTROID_TEXTS = {
  curiosity:      'what happens why nobody knows secret hidden truth revealed real reason behind',
  fear:           'stop avoid danger warning biggest mistake ruining destroying never should',
  authority:      'doctor expert scientist proven research study reveals according science facts',
  controversy:    'controversial debate unpopular opinion wrong everyone disagrees truth exposed',
  transformation: 'before after transformation journey changed completely progress results weeks months',
  tutorial:       'how to learn step guide beginner complete walkthrough tutorial course explained',
  urgency:        'now today immediately before too late last chance hurry urgent this week',
  challenge:      'challenge days week month impossible extreme hardest attempted tried result',
  myth:           'myth reality truth wrong misconception debunked actually really not true',
  reaction:       'react reaction watching first time trying unboxing reviewing response',
  comparison:     'vs versus better worse comparison which best choose between two options',
  list:           'top reasons ways things tips signs facts mistakes habits steps tricks',
  mistake:        'mistake error wrong fail avoid common biggest never make this again',
  secret:         'secret nobody tells hidden truth unknown underground forbidden revealed',
};

function getSemanticBenchmark(db, clusterName) {
  try {
    const row = db.get(
      `SELECT avg_vph, sample_size, confidence AS cluster_confidence, trend_direction,
              cohesion_score, cohesion_tier
       FROM semantic_clusters WHERE cluster_name = ? AND sample_size > 10`,
      [clusterName],
    );
    if (!row) return null;
    return {
      cluster:            clusterName,
      avg_vph:            row.avg_vph,
      sample_size:        row.sample_size,
      cluster_confidence: row.cluster_confidence,
      trend:              row.trend_direction,
      cohesion_score:     row.cohesion_score ?? null,
      cohesion_tier:      row.cohesion_tier  ?? null,
    };
  } catch { return null; }
}

function applySemanticBoundary(db, cluster, confidence, source) {
  const benchmark = getSemanticBenchmark(db, cluster);
  const cohesionDecay = benchmark?.cohesion_tier === 'weak'     ? 0.75
                      : benchmark?.cohesion_tier === 'moderate'  ? 0.90
                      : 1.0;
  return {
    cluster,
    confidence:           parseFloat((confidence * cohesionDecay).toFixed(3)),
    benchmark,
    source,
    secondary_archetypes: [],
  };
}

function resolveSemanticCluster(db, title, youtube_video_id) {
  try {
    if (youtube_video_id) {
      const row = db.get(
        `SELECT semantic_cluster, semantic_confidence FROM semantic_embeddings
         WHERE source_id = ? AND source_type = 'title_dna' ORDER BY created_at DESC LIMIT 1`,
        [youtube_video_id],
      );
      if (row?.semantic_cluster) {
        return applySemanticBoundary(db, row.semantic_cluster, row.semantic_confidence ?? 0.4, 'corpus');
      }
    }
    const cls = classifyHookTypeMulti(title);
    if (cls.primary_hook && cls.primary_hook !== 'unknown') {
      const conf = parseFloat(((cls.probabilities?.[cls.primary_hook] ?? 0.4) * 0.7).toFixed(3));
      return applySemanticBoundary(db, cls.primary_hook, conf, 'classifier');
    }
    const tl = title.toLowerCase();
    let best = null, bestScore = 0;
    for (const [cluster, text] of Object.entries(SEED_CENTROID_TEXTS)) {
      const score = text.split(/\s+/).filter(t => t.length > 3).reduce((s, t) => s + (tl.includes(t) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = cluster; }
    }
    if (bestScore > 0) {
      const conf = parseFloat(Math.min(0.28, 0.07 + bestScore * 0.04).toFixed(3));
      return applySemanticBoundary(db, best, conf, 'keyword');
    }
    return null;
  } catch { return null; }
}

module.exports = { SEED_CENTROID_TEXTS, getSemanticBenchmark, applySemanticBoundary, resolveSemanticCluster };
