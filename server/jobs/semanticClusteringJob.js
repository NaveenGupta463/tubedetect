'use strict';

// G5 — Seeded semantic clustering job.
// Initializes 14 pre-seeded archetype clusters (same taxonomy as hook_type_performance).
// Assigns embeddings to clusters using hook classifier signals.
// Updates cluster stats (sample_size, avg_vph, niches_present, confidence).
//
// DESIGN: Semi-supervised clustering only.
//   - Seeded archetypes: immediate interpretability
//   - Centroid drift: allowed (cluster stats evolve as data grows)
//   - Subcluster discovery: future phase
//   - Hard-lock prevention: centroids are NOT frozen

const cron      = require('node-cron');
const { getDb } = require('../db/init');
const { classifyHookTypeMulti }   = require('../services/hookClassifier');
const { computeClusterCohesion }  = require('../services/clusterQuality');

// Keyword-based fallback for titles that don't match any hook pattern.
// Scores each cluster by token overlap with its seed centroid text.
// Returns null if no tokens match (title stays unassigned).
function keywordFallbackCluster(title) {
  const tl = title.toLowerCase();
  let bestCluster = null, bestScore = 0;
  for (const [cluster, seedText] of Object.entries(SEED_CENTROID_TEXTS)) {
    const tokens = seedText.split(/\s+/).filter(t => t.length > 3);
    const score  = tokens.reduce((s, t) => s + (tl.includes(t) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestCluster = cluster; }
  }
  return bestScore > 0
    ? { cluster: bestCluster, confidence: parseFloat(Math.min(0.35, 0.1 + bestScore * 0.05).toFixed(3)) }
    : null;
}

// 14 pre-seeded archetypes — same taxonomy as hook classifier
const SEED_CLUSTERS = [
  'curiosity', 'fear', 'authority', 'controversy', 'transformation',
  'tutorial', 'urgency', 'challenge', 'myth', 'reaction',
  'comparison', 'list', 'mistake', 'secret',
];

// Seed centroid text — used for initial cluster identity description
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

// ── Seed clusters ─────────────────────────────────────────────────────────────

async function seedInitialClusters(db) {
  let seeded = 0;
  for (const name of SEED_CLUSTERS) {
    try {
      const existing = db.get(`SELECT id FROM semantic_clusters WHERE cluster_name = ?`, [name]);
      if (existing) continue;
      db.run(`
        INSERT INTO semantic_clusters
          (cluster_name, cluster_centroid, sample_size, confidence, seeded, trend_direction)
        VALUES (?, ?, 0, 0.3, 1, 'stable')
        ON CONFLICT(cluster_name) DO NOTHING
      `, [name, JSON.stringify({ seed_text: SEED_CENTROID_TEXTS[name] ?? name })]);
      seeded++;
    } catch (e) {
      console.warn('[semanticCluster] seed failed:', name, e.message);
    }
  }
  if (seeded > 0) console.log(`[semanticCluster] seeded ${seeded} clusters`);
  return seeded;
}

// ── Assign unassigned embeddings to clusters ──────────────────────────────────

async function assignEmbeddingsToClusters(db) {
  const unassigned = db.all(`
    SELECT se.id, se.source_id
    FROM semantic_embeddings se
    WHERE se.source_type = 'title_dna'
      AND se.semantic_cluster IS NULL
    ORDER BY se.created_at DESC
    LIMIT 1000
  `);

  if (!unassigned.length) return 0;

  let assigned = 0;
  for (const emb of unassigned) {
    try {
      const video = db.get(
        `SELECT title FROM ingested_videos WHERE youtube_video_id = ?`,
        [emb.source_id],
      );
      if (!video?.title) continue;

      const cls = classifyHookTypeMulti(video.title);
      let targetCluster    = null;
      let targetConfidence = null;

      if (cls.primary_hook && cls.primary_hook !== 'unknown') {
        targetCluster = cls.primary_hook;
      } else {
        const fb = keywordFallbackCluster(video.title);
        if (fb) { targetCluster = fb.cluster; targetConfidence = fb.confidence; }
      }

      if (targetCluster) {
        db.run(
          `UPDATE semantic_embeddings
           SET semantic_cluster    = ?,
               semantic_confidence = COALESCE(?, semantic_confidence),
               updated_at          = datetime('now')
           WHERE id = ?`,
          [targetCluster, targetConfidence, emb.id],
        );
        assigned++;
      }
    } catch { /* non-fatal per-row */ }
  }

  return assigned;
}

// ── Update cluster statistics ─────────────────────────────────────────────────

async function updateClusterStats(db) {
  for (const name of SEED_CLUSTERS) {
    try {
      const stats = db.get(`
        SELECT COUNT(*) AS n,
               AVG(vgs.views_per_hour) AS avg_vph
        FROM semantic_embeddings se
        JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
        LEFT JOIN (
          SELECT video_id, views_per_hour,
                 ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshotted_at DESC) rn
          FROM video_growth_snapshots WHERE views_per_hour > 0
        ) vgs ON vgs.video_id = iv.youtube_video_id AND vgs.rn = 1
        WHERE se.semantic_cluster = ? AND se.source_type = 'title_dna'
      `, [name]);

      if (!stats?.n) continue;

      const niches = db.all(`
        SELECT DISTINCT iv.niche
        FROM semantic_embeddings se
        JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
        WHERE se.semantic_cluster = ? AND se.source_type = 'title_dna' AND iv.niche IS NOT NULL
        LIMIT 20
      `, [name]).map(r => r.niche).filter(Boolean);

      // Confidence grows with sample size, saturates at 1.0 around 100 samples
      const confidence = Math.min(1.0, 0.2 + (stats.n / 100) * 0.8);

      db.run(`
        UPDATE semantic_clusters
        SET sample_size    = ?,
            avg_vph        = ?,
            confidence     = ?,
            niches_present = ?,
            dominant_hooks = ?,
            updated_at     = datetime('now')
        WHERE cluster_name = ?
      `, [
        stats.n,
        stats.avg_vph ?? null,
        parseFloat(confidence.toFixed(3)),
        JSON.stringify(niches),
        JSON.stringify([name]),
        name,
      ]);

      try {
        const cq = computeClusterCohesion(db, name, 50);
        if (cq?.cohesion != null) {
          const tier = cq.cohesion > 0.7 ? 'high' : cq.cohesion > 0.5 ? 'moderate' : 'weak';
          db.run(
            `UPDATE semantic_clusters
             SET cohesion_score = ?, cohesion_tier = ?, outlier_ratio = ?, avg_centroid_similarity = ?,
                 updated_at = datetime('now')
             WHERE cluster_name = ?`,
            [
              parseFloat(cq.cohesion.toFixed(4)),
              tier,
              parseFloat((cq.outlier_rate ?? 0).toFixed(4)),
              parseFloat(cq.cohesion.toFixed(4)),
              name,
            ],
          );
        }
      } catch { /* non-fatal cohesion update */ }
    } catch (e) {
      console.warn('[semanticCluster] stats update failed:', name, e.message);
    }
  }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

async function runClusteringCycle(db) {
  const t0 = Date.now();
  await seedInitialClusters(db);
  const assigned = await assignEmbeddingsToClusters(db);
  await updateClusterStats(db);
  const ms = Date.now() - t0;
  console.log(`[semanticCluster] cycle complete — assigned ${assigned} embeddings in ${ms}ms`);
  return { ok: true, assigned, ms };
}

// ── Cron ──────────────────────────────────────────────────────────────────────

function startSemanticClusteringCron() {
  cron.schedule('0 */6 * * *', async () => {
    try {
      const db     = getDb();
      const result = await runClusteringCycle(db);
      console.log('[semanticCluster] cron complete', JSON.stringify(result));
    } catch (e) {
      console.error('[semanticCluster] cron error:', e.message);
    }
  });
  console.log('[semanticCluster] cron scheduled: every 6h');
}

module.exports = { seedInitialClusters, runClusteringCycle, startSemanticClusteringCron };
