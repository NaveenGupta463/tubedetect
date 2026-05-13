'use strict';

// G3 / G11 — Incremental embedding ingest job.
// Processes one BATCH_SIZE batch of unembedded titles per cron tick.
// Runs hourly via cron; also callable on-demand via admin trigger.
//
// For large-scale ingestion, use embeddingQueue.runQueuedIngestion() instead.
//
// G11 PERFORMANCE RULES:
//   - Never embeds entire DB synchronously
//   - Never blocks ingestion pipeline
//   - Processes in BATCH_SIZE increments
//   - Rebuilds TF-IDF corpus before each batch

const cron    = require('node-cron');
const { getDb } = require('../db/init');

const { generateEmbedding, getSemanticProviderStatus } = require('../services/embeddingEngine');
const { upsertVector }             = require('../services/vectorStore');
const { buildTitleDNA, titleDnaToString } = require('../services/titleDnaBuilder');
const { classifyHookTypeMulti }    = require('../services/hookClassifier');
const { extractFeatures }          = require('../services/featureExtraction');
const { buildTfidfCorpus }         = require('../services/tfidfEngine');
const { normalize, isExactDuplicate, classifyTitleQuality } = require('../services/titlePreprocessor');
const metrics = require('../services/embeddingMetrics');

const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || '100', 10);

// ── Main batch ────────────────────────────────────────────────────────────────

async function runEmbeddingIngestBatch(db) {
  const t0 = Date.now();

  try { buildTfidfCorpus(db); } catch (e) {
    console.warn('[embedIngest] corpus build skipped:', e.message);
  }

  const provStatus = getSemanticProviderStatus();
  const model      = provStatus.model;
  const version    = provStatus.provider === 'openai_embedding' ? '1' : '1.0';

  const rows = db.all(`
    SELECT iv.youtube_video_id, iv.title, iv.niche
    FROM ingested_videos iv
    WHERE iv.title IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM semantic_embeddings se
        WHERE se.source_type     = 'title_dna'
          AND se.source_id       = iv.youtube_video_id
          AND se.embedding_model = ?
      )
    ORDER BY iv.published_at DESC
    LIMIT ?
  `, [model, BATCH_SIZE]);

  if (!rows.length) {
    return { ok: true, processed: 0, skipped: 'no_pending_titles', provider: provStatus.provider, ms: Date.now() - t0 };
  }

  const seenHashes = new Set();
  let processed = 0, errors = 0, skipped = 0;

  for (const row of rows) {
    try {
      const titleNorm = normalize(row.title);

      // Quality gate
      const quality = classifyTitleQuality(titleNorm);
      if (!quality.ok) {
        metrics.recordLowQualitySkip();
        skipped++;
        continue;
      }

      // Exact dedup within this batch
      if (isExactDuplicate(titleNorm, seenHashes)) {
        metrics.recordDuplicateSkip();
        skipped++;
        continue;
      }

      const hookProfile = classifyHookTypeMulti(titleNorm);
      const features    = extractFeatures({ title: titleNorm, hook: titleNorm });
      const dna         = buildTitleDNA(titleNorm, hookProfile, features);
      const dnaText     = titleDnaToString(dna);

      const apiT0 = Date.now();
      const emb   = await generateEmbedding(dnaText, { db });
      metrics.recordApiCall({ latency_ms: Date.now() - apiT0, success: !!emb });

      if (!emb || !emb.vector.length) continue;

      const clusterHint = hookProfile.primary_hook !== 'unknown' ? hookProfile.primary_hook : null;
      const insT0 = Date.now();
      upsertVector(db, {
        source_type:         'title_dna',
        source_id:           row.youtube_video_id,
        embedding_model:     emb.model,
        embedding_version:   emb.version,
        vector:              emb.vector,
        semantic_cluster:    clusterHint,
        semantic_confidence: emb.confidence,
      });
      metrics.recordVectorInsert(Date.now() - insT0);
      processed++;
    } catch (e) {
      errors++;
      console.warn('[embedIngest] failed:', row.youtube_video_id, e.message);
    }
  }

  const ms = Date.now() - t0;
  metrics.recordBatch({ processed, errors, latency_ms: ms, batch_size: rows.length, provider: provStatus.provider });

  console.log(`[embedIngest] ${processed}/${rows.length} embedded (${errors} errors, ${skipped} skipped) via ${provStatus.provider} in ${ms}ms`);
  return { ok: true, processed, total: rows.length, errors, skipped, provider: provStatus.provider, ms };
}

// ── Cron ──────────────────────────────────────────────────────────────────────

function startEmbeddingIngestCron() {
  cron.schedule('0 * * * *', async () => {
    try {
      const db     = getDb();
      const result = await runEmbeddingIngestBatch(db);
      console.log('[embedIngest] cron complete', JSON.stringify(result));
    } catch (e) {
      console.error('[embedIngest] cron error:', e.message);
    }
  });
  console.log('[embedIngest] cron scheduled: hourly');
}

module.exports = { runEmbeddingIngestBatch, startEmbeddingIngestCron };
