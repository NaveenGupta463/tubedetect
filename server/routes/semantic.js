'use strict';

// Phase G — Semantic Intelligence API
//
// Public routes (no auth):
//   GET  /api/semantic/status         — provider tier, coverage summary
//   GET  /api/semantic/clusters       — all semantic clusters with stats
//   GET  /api/semantic/coverage       — embedding coverage by source_type
//   POST /api/semantic/nearest        — nearest-neighbor title search
//   POST /api/semantic/embed-title    — DNA + embedding metadata for a title
//   GET  /api/semantic/cache/stats    — cache hit rate + latency metrics
//
// Admin routes:
//   POST /api/admin/semantic/ingest/trigger   — run embedding batch
//   POST /api/admin/semantic/cluster/run      — run clustering cycle
//   POST /api/admin/semantic/cluster/reseed   — force reseed clusters

const express  = require('express');
const crypto   = require('crypto');
const { getDb } = require('../db/init');

const { generateEmbedding, findNearestNeighbors, getSemanticProviderStatus } = require('../services/embeddingEngine');
const { cosineSimilarity } = require('../services/vectorStore');
const { buildTitleDNA, titleDnaToString }   = require('../services/titleDnaBuilder');
const { classifyHookTypeMulti }             = require('../services/hookClassifier');
const { extractFeatures }                   = require('../services/featureExtraction');
const { getCorpusStats }                    = require('../services/tfidfEngine');

const {
  getSemanticCoverage, getAllSemanticClusters, getSemanticCacheStats,
  cacheSemanticQuery, getSemanticQueryCache,
} = require('../db/queries');

const { runEmbeddingIngestBatch }  = require('../jobs/embeddingIngestJob');
const { runClusteringCycle, seedInitialClusters } = require('../jobs/semanticClusteringJob');

const {
  runQueuedIngestion, pauseIngestion, getQueueStatus, getScaleStatus,
  listJobs, getJob, STAGES,
} = require('../services/embeddingQueue');
const { getMetrics, getThroughputHistory } = require('../services/embeddingMetrics');
const { runValidation, runStressTest, getLastReport: getLastValidationReport } = require('../services/vectorValidation');
const {
  runClusterQualityReport, getNearestNeighborSample, getLastReport: getLastQualityReport,
} = require('../services/clusterQuality');

const router = express.Router();

function tryParse(s) {
  try { return typeof s === 'string' ? JSON.parse(s) : s; }
  catch { return s; }
}

function makeQueryHash(text, provider) {
  return crypto.createHash('sha256').update(`${text}||${provider}`).digest('hex').slice(0, 32);
}

// ── GET /api/semantic/status ──────────────────────────────────────────────────

router.get('/semantic/status', (req, res) => {
  try {
    const db     = getDb();
    const status = getSemanticProviderStatus();
    const cov    = getSemanticCoverage(db);
    const corpus = getCorpusStats();
    res.json({ ok: true, ...status, coverage: cov, tfidf_corpus: corpus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/semantic/clusters ────────────────────────────────────────────────

router.get('/semantic/clusters', (req, res) => {
  try {
    const db   = getDb();
    const rows = getAllSemanticClusters(db).map(r => ({
      ...r,
      niches_present: tryParse(r.niches_present) ?? [],
      dominant_hooks: tryParse(r.dominant_hooks) ?? [],
    }));
    res.json({ ok: true, clusters: rows, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/semantic/coverage ────────────────────────────────────────────────

router.get('/semantic/coverage', (req, res) => {
  try {
    const db  = getDb();
    const cov = getSemanticCoverage(db);
    res.json({ ok: true, ...cov });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/semantic/nearest ────────────────────────────────────────────────
// Body: { title, limit?, cluster?, niche?, useCache? }

router.post('/semantic/nearest', async (req, res) => {
  try {
    const { title, limit = 10, cluster, niche, useCache = true } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const db       = getDb();
    const provStatus = getSemanticProviderStatus();
    const t0       = Date.now();
    const cacheKey = makeQueryHash(title.trim(), provStatus.provider);

    if (useCache) {
      const cached = getSemanticQueryCache(db, cacheKey, provStatus.provider);
      if (cached) {
        const result = tryParse(cached.result_json);
        return res.json({ ok: true, ...result, cache_hit: true });
      }
    }

    const neighbors = await findNearestNeighbors(db, {
      text: title.trim(), sourceType: 'title_dna', cluster, niche,
      limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 10)),
    });

    const latency = Date.now() - t0;
    const result  = {
      title:             title.trim(),
      neighbors,
      semantic_provider: provStatus.provider,
      semantic_tier:     provStatus.semantic_tier,
      latency_ms:        latency,
    };

    cacheSemanticQuery(db, {
      query_hash:  cacheKey,
      source_type: 'title_dna',
      provider:    provStatus.provider,
      query_text:  title.trim(),
      result_json: JSON.stringify(result),
      latency_ms:  latency,
    });

    res.json({ ok: true, ...result, cache_hit: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/semantic/embed-title ────────────────────────────────────────────
// Body: { title }

router.post('/semantic/embed-title', async (req, res) => {
  try {
    const { title } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }

    const db          = getDb();
    const hookProfile = classifyHookTypeMulti(title.trim());
    const features    = extractFeatures({ title: title.trim(), hook: title.trim() });
    const dna         = buildTitleDNA(title.trim(), hookProfile, features);
    const dnaText     = titleDnaToString(dna);
    const emb         = await generateEmbedding(dnaText, { db });

    res.json({
      ok:         true,
      title:      title.trim(),
      dna,
      dna_text:   dnaText,
      provider:   emb?.provider ?? 'unavailable',
      model:      emb?.model ?? null,
      version:    emb?.version ?? null,
      dim:        emb?.dim ?? null,
      confidence: emb?.confidence ?? 0,
      embedded:   !!emb,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/semantic/cache/stats ─────────────────────────────────────────────

router.get('/semantic/cache/stats', (req, res) => {
  try {
    const db = getDb();
    res.json({ ok: true, ...getSemanticCacheStats(db) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/admin/semantic/ingest/trigger ───────────────────────────────────

router.post('/admin/semantic/ingest/trigger', async (req, res) => {
  try {
    const db     = getDb();
    const result = await runEmbeddingIngestBatch(db);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/admin/semantic/cluster/run ──────────────────────────────────────

router.post('/admin/semantic/cluster/run', async (req, res) => {
  try {
    const db     = getDb();
    const result = await runClusteringCycle(db);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/admin/semantic/cluster/reseed ───────────────────────────────────

router.post('/admin/semantic/cluster/reseed', async (req, res) => {
  try {
    const db = getDb();
    db.run(`DELETE FROM semantic_clusters WHERE seeded = 1`);
    await seedInitialClusters(db);
    const clusters = getAllSemanticClusters(db);
    res.json({ ok: true, clusters_seeded: clusters.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 1-7: Scaled Ingestion Queue ────────────────────────────────────────

// GET /api/admin/semantic/ingest/queue — queue + adaptive batch status
router.get('/admin/semantic/ingest/queue', (req, res) => {
  try {
    const db = getDb();
    res.json({ ok: true, ...getQueueStatus(db), metrics: getMetrics() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/semantic/ingest/queue/start — start a queued ingestion job
// Body: { max_titles?, stage?, batch_size?, label? }
router.post('/admin/semantic/ingest/queue/start', async (req, res) => {
  try {
    const db  = getDb();
    const { max_titles, stage, batch_size, label } = req.body ?? {};
    const result = await runQueuedIngestion(db, {
      max_titles: max_titles ? parseInt(max_titles, 10) : undefined,
      stage:      stage      ? parseInt(stage, 10)      : undefined,
      batch_size: batch_size ? parseInt(batch_size, 10) : undefined,
      label:      label ?? 'admin_trigger',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/semantic/ingest/queue/pause — pause active job
router.post('/admin/semantic/ingest/queue/pause', (req, res) => {
  try {
    res.json({ ok: true, ...pauseIngestion() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/ingest/jobs — job history
router.get('/admin/semantic/ingest/jobs', (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(100, parseInt(req.query.limit ?? '20', 10));
    res.json({ ok: true, jobs: listJobs(db, limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/ingest/jobs/:id — specific job
router.get('/admin/semantic/ingest/jobs/:id', (req, res) => {
  try {
    const db  = getDb();
    const job = getJob(db, req.params.id);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    res.json({ ok: true, job });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 2: Telemetry ────────────────────────────────────────────────────────

// GET /api/admin/semantic/telemetry — live metrics + throughput history
router.get('/admin/semantic/telemetry', (req, res) => {
  try {
    const db = getDb();
    const recentTelemetry = db.all(`
      SELECT * FROM embedding_telemetry ORDER BY recorded_at DESC LIMIT 30
    `);
    res.json({
      ok:          true,
      live:        getMetrics(),
      throughput:  getThroughputHistory(),
      history:     recentTelemetry,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 3: Vector DB Validation ────────────────────────────────────────────

// POST /api/admin/semantic/validate — run full validation
router.post('/admin/semantic/validate', async (req, res) => {
  try {
    const db     = getDb();
    const report = await runValidation(db);
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/semantic/validate/stress — stress test with N vectors
// Body: { count? }
router.post('/admin/semantic/validate/stress', async (req, res) => {
  try {
    const db    = getDb();
    const count = Math.min(5000, parseInt(req.body?.count ?? '1000', 10));
    const result = await runStressTest(db, { count });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/validate/report — last validation report
router.get('/admin/semantic/validate/report', (req, res) => {
  try {
    const db     = getDb();
    const report = getLastValidationReport(db);
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/validate/history — validation run history
router.get('/admin/semantic/validate/history', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.all(`
      SELECT id, ran_at, total_vectors, duplicate_count, orphan_count,
             coverage_pct, pending_count, knn_latency_ms, error_count, warning_count, ok
      FROM vector_validation_log
      ORDER BY ran_at DESC LIMIT 20
    `);
    res.json({ ok: true, history: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 4: Cluster Quality ──────────────────────────────────────────────────

// POST /api/admin/semantic/cluster/quality — run quality report
router.post('/admin/semantic/cluster/quality', async (req, res) => {
  try {
    const db     = getDb();
    const report = await runClusterQualityReport(db);
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/cluster/quality — last quality report
router.get('/admin/semantic/cluster/quality', (req, res) => {
  try {
    const db     = getDb();
    const report = getLastQualityReport(db);
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/semantic/cluster/quality/sample/:cluster — NN inspection
router.get('/admin/semantic/cluster/quality/sample/:cluster', (req, res) => {
  try {
    const db      = getDb();
    const limit   = Math.min(20, parseInt(req.query.limit ?? '10', 10));
    const samples = getNearestNeighborSample(db, req.params.cluster, limit);
    res.json({ ok: true, cluster: req.params.cluster, samples });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Phase 7: Scale status ─────────────────────────────────────────────────────

// GET /api/admin/semantic/scale-status — current stage readiness
router.get('/admin/semantic/scale-status', (req, res) => {
  try {
    const db = getDb();
    res.json({ ok: true, ...getScaleStatus(db), stages_config: STAGES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/semantic/scale-advance — start next stage job
router.post('/admin/semantic/scale-advance', async (req, res) => {
  try {
    const db     = getDb();
    const status = getScaleStatus(db);
    const next   = status.next_stage;
    if (!next) return res.status(400).json({ error: 'all_stages_completed' });
    const result = await runQueuedIngestion(db, {
      max_titles: next.max_titles,
      stage:      next.stage,
      batch_size: next.batch_size,
      label:      next.label,
    });
    res.json({ ok: true, stage: next, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stage 5: Semantic video performance check ─────────────────────────────────
// GET /api/semantic/video-check/:ytid
// Returns cluster assignment + performance relative to semantic neighborhood.

router.get('/semantic/video-check/:ytid', async (req, res) => {
  try {
    const { ytid } = req.params;
    const db       = getDb();

    const embRow = db.get(
      `SELECT semantic_cluster, semantic_confidence, vector_json
       FROM semantic_embeddings
       WHERE source_id = ? AND source_type = 'title_dna'
       ORDER BY created_at DESC LIMIT 1`,
      [ytid],
    );

    const vidRow = db.get(
      `SELECT title, niche FROM ingested_videos WHERE youtube_video_id = ?`,
      [ytid],
    );

    const snapRow = db.get(
      `SELECT views_per_hour FROM video_growth_snapshots
       WHERE video_id = ? AND views_per_hour > 0
       ORDER BY snapshotted_at DESC LIMIT 1`,
      [ytid],
    );

    if (!embRow?.semantic_cluster) {
      return res.json({ ok: true, status: 'not_embedded', ytid, title: vidRow?.title ?? null });
    }

    const clusterRow = db.get(
      `SELECT avg_vph, sample_size, confidence, trend_direction
       FROM semantic_clusters WHERE cluster_name = ? AND sample_size > 10`,
      [embRow.semantic_cluster],
    );

    const vph       = snapRow?.views_per_hour ?? null;
    const avgVph    = clusterRow?.avg_vph ?? null;
    const ratio     = (vph && avgVph && avgVph > 0) ? parseFloat((vph / avgVph).toFixed(3)) : null;
    const isUnder   = ratio != null && ratio < 0.6 && clusterRow?.sample_size >= 25 && (embRow.semantic_confidence ?? 0) >= 0.35;

    let nearestLeaders = [];
    if (embRow.vector_json && vidRow?.title) {
      {
        const neighbors = await findNearestNeighbors(db, { text: vidRow.title, sourceType: 'title_dna', limit: 6 });
        nearestLeaders = neighbors
          .filter(n => n.source_id !== ytid)
          .map(n => {
            const nVid  = db.get(`SELECT title, niche FROM ingested_videos WHERE youtube_video_id = ?`, [n.source_id]);
            const nSnap = db.get(`SELECT views_per_hour FROM video_growth_snapshots WHERE video_id = ? AND views_per_hour > 0 ORDER BY snapshotted_at DESC LIMIT 1`, [n.source_id]);
            return { title: nVid?.title, niche: nVid?.niche, similarity: n.similarity, views_per_hour: nSnap?.views_per_hour ?? null };
          })
          .filter(n => n.title)
          .slice(0, 5);
      }
    }

    const leaderAvgVph = nearestLeaders.filter(n => n.views_per_hour).length > 0
      ? nearestLeaders.filter(n => n.views_per_hour).reduce((s, n) => s + n.views_per_hour, 0) / nearestLeaders.filter(n => n.views_per_hour).length
      : null;

    res.json({
      ok:                   true,
      status:               'checked',
      ytid,
      title:                vidRow?.title ?? null,
      niche:                vidRow?.niche ?? null,
      semantic_cluster:     embRow.semantic_cluster,
      semantic_confidence:  embRow.semantic_confidence,
      views_per_hour:       vph,
      cluster_avg_vph:      avgVph,
      vph_ratio:            ratio,
      underperforming:      isUnder,
      cluster_sample_size:  clusterRow?.sample_size ?? null,
      cluster_trend:        clusterRow?.trend_direction ?? null,
      nearest_leaders:      nearestLeaders,
      leader_avg_vph:       leaderAvgVph ? parseFloat(leaderAvgVph.toFixed(2)) : null,
      note: 'VPH ratio is observational. Low ratio correlates with underperformance relative to semantic neighborhood — not causal attribution.',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cluster Explorer: per-cluster title samples ───────────────────────────────
// GET /api/admin/semantic/clusters/:name/titles?mode=top|random|borderline|outlier&limit=20

router.get('/admin/semantic/clusters/:name/titles', (req, res) => {
  try {
    const { name } = req.params;
    const mode     = req.query.mode ?? 'random';
    const limit    = Math.min(50, parseInt(req.query.limit ?? '20', 10));
    const db       = getDb();

    if (mode === 'top') {
      const rows = db.all(`
        SELECT se.source_id, se.semantic_confidence, iv.title, iv.niche,
               COALESCE(vgs.views_per_hour, 0) AS views_per_hour
        FROM semantic_embeddings se
        JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
        LEFT JOIN (
          SELECT video_id, views_per_hour,
                 ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshotted_at DESC) rn
          FROM video_growth_snapshots WHERE views_per_hour > 0
        ) vgs ON vgs.video_id = iv.youtube_video_id AND vgs.rn = 1
        WHERE se.source_type = 'title_dna' AND se.semantic_cluster = ?
        ORDER BY COALESCE(vgs.views_per_hour, 0) DESC
        LIMIT ?
      `, [name, limit]);
      return res.json({ ok: true, mode, cluster: name, titles: rows });
    }

    if (mode === 'random') {
      const rows = db.all(`
        SELECT se.source_id, se.semantic_confidence, iv.title, iv.niche
        FROM semantic_embeddings se
        JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
        WHERE se.source_type = 'title_dna' AND se.semantic_cluster = ?
        ORDER BY RANDOM()
        LIMIT ?
      `, [name, limit]);
      return res.json({ ok: true, mode, cluster: name, titles: rows });
    }

    // borderline / outlier — compute centroid similarity from a sample
    const allRows = db.all(`
      SELECT se.source_id, se.vector_json, se.semantic_confidence, iv.title, iv.niche
      FROM semantic_embeddings se
      JOIN ingested_videos iv ON iv.youtube_video_id = se.source_id
      WHERE se.source_type = 'title_dna' AND se.semantic_cluster = ?
      ORDER BY RANDOM()
      LIMIT 300
    `, [name]);

    if (!allRows.length) return res.json({ ok: true, mode, cluster: name, titles: [] });

    function parseV(json) {
      try { const v = typeof json === 'string' ? JSON.parse(json) : json; return Array.isArray(v) ? v : null; }
      catch { return null; }
    }
    const parsed = allRows.map(r => ({ ...r, vec: parseV(r.vector_json) })).filter(r => r.vec);
    if (!parsed.length) return res.json({ ok: true, mode, cluster: name, titles: [] });

    const dim      = parsed[0].vec.length;
    const centroid = new Array(dim).fill(0);
    for (const r of parsed) for (let i = 0; i < dim; i++) centroid[i] += r.vec[i] / parsed.length;

    const withSim = parsed.map(r => ({
      source_id:           r.source_id,
      title:               r.title,
      niche:               r.niche,
      semantic_confidence: r.semantic_confidence,
      centroid_similarity: parseFloat(cosineSimilarity(r.vec, centroid).toFixed(4)),
    }));
    const avgSim = withSim.reduce((s, r) => s + r.centroid_similarity, 0) / withSim.length;

    const sorted = mode === 'outlier'
      ? withSim.sort((a, b) => a.centroid_similarity - b.centroid_similarity)
      : withSim.sort((a, b) => Math.abs(a.centroid_similarity - avgSim) - Math.abs(b.centroid_similarity - avgSim));

    res.json({
      ok: true, mode, cluster: name,
      titles: sorted.slice(0, limit),
      avg_centroid_similarity: parseFloat(avgSim.toFixed(4)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cluster Explorer: update label override ───────────────────────────────────
// PATCH /api/admin/semantic/clusters/:name

router.patch('/admin/semantic/clusters/:name', (req, res) => {
  try {
    const { name } = req.params;
    const { label_override } = req.body ?? {};
    const db = getDb();
    db.run(
      `UPDATE semantic_clusters SET label_override = ?, updated_at = datetime('now') WHERE cluster_name = ?`,
      [label_override ?? null, name],
    );
    res.json({ ok: true, cluster: name, label_override: label_override ?? null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cluster Explorer: overview (live clusters + last quality report) ───────────
// GET /api/admin/semantic/cluster/quality/overview

router.get('/admin/semantic/cluster/quality/overview', (req, res) => {
  try {
    const db         = getDb();
    const clusters   = getAllSemanticClusters(db).map(r => ({
      ...r,
      niches_present: tryParse(r.niches_present) ?? [],
      dominant_hooks: tryParse(r.dominant_hooks) ?? [],
    }));
    const lastReport  = getLastQualityReport(db);
    const cohesionMap = lastReport?.report?.cohesion_by_cluster ?? {};
    const separation  = lastReport?.report?.separation ?? null;

    const enriched = clusters.map(c => ({
      ...c,
      cohesion:     cohesionMap[c.cluster_name]?.cohesion     ?? c.cohesion_score ?? null,
      outlier_rate: cohesionMap[c.cluster_name]?.outlier_rate ?? c.outlier_ratio  ?? null,
      quality_flag: cohesionMap[c.cluster_name]?.quality      ?? c.cohesion_tier  ?? null,
      example_titles: cohesionMap[c.cluster_name]?.example_titles ?? [],
    }));

    const stabilityWarnings = enriched
      .filter(c => c.cohesion != null)
      .flatMap(c => {
        const w = [];
        if (c.cohesion < 0.5 && (c.outlier_rate ?? 0) > 0.3)
          w.push({ cluster: c.cluster_name, type: 'high_semantic_bleed',     detail: `outlier_rate=${(c.outlier_rate * 100).toFixed(0)}%, cohesion=${(c.cohesion * 100).toFixed(0)}%` });
        if (c.cohesion < 0.5 && (c.sample_size ?? 0) > 10)
          w.push({ cluster: c.cluster_name, type: 'weak_centroid_identity',  detail: `cohesion=${(c.cohesion * 100).toFixed(0)}%, n=${c.sample_size}` });
        if ((c.confidence ?? 0) < 0.3 && c.cohesion < 0.5)
          w.push({ cluster: c.cluster_name, type: 'cluster_instability_risk', detail: `conf=${Math.round((c.confidence ?? 0) * 100)}%, cohesion=${(c.cohesion * 100).toFixed(0)}%` });
        return w;
      });

    res.json({
      ok:                true,
      clusters:          enriched,
      separation,
      overall_quality:   lastReport?.report?.overall_quality ?? null,
      avg_cohesion:      lastReport?.report?.avg_cohesion    ?? null,
      last_report_at:    lastReport?.ran_at ?? null,
      stability_warnings: stabilityWarnings,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
