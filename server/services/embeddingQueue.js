'use strict';

// Phase 1 + Phase 6 — Scalable Embedding Queue
//
// Provides:
//   • Configurable batch size (env EMBEDDING_BATCH_SIZE, default 500)
//   • Adaptive sizing: scale up on consecutive success, halve on throttle
//   • Exponential backoff with jitter on rate-limit errors
//   • Per-item retry queue (up to MAX_RETRIES attempts)
//   • Cursor-based pagination for crash-safe resumption
//   • Job lifecycle: pending → running → paused / completed / failed
//   • Title preprocessing (normalize + exact dedup within batch)
//
// IMPORTANT: db calls are synchronous (node-sqlite3-wasm). Never await them.

const { getDb } = require('../db/init');
const { generateEmbedding, getSemanticProviderStatus } = require('./embeddingEngine');
const { upsertVector }                               = require('./vectorStore');
const { buildTitleDNA, titleDnaToString }            = require('./titleDnaBuilder');
const { classifyHookTypeMulti }                      = require('./hookClassifier');
const { extractFeatures }                            = require('./featureExtraction');
const { buildTfidfCorpus }                           = require('./tfidfEngine');
const { normalize, isExactDuplicate, classifyTitleQuality } = require('./titlePreprocessor');
const metrics = require('./embeddingMetrics');

const DEFAULT_BATCH_SIZE = Math.max(50, parseInt(process.env.EMBEDDING_BATCH_SIZE  || '500', 10));
const MAX_BATCH_SIZE     = Math.max(DEFAULT_BATCH_SIZE, parseInt(process.env.EMBEDDING_MAX_BATCH || '1000', 10));
const MIN_BATCH_SIZE     = 50;
const MAX_RETRIES        = 3;
const BASE_BACKOFF_MS    = 1000;

// ── Module-level job state ────────────────────────────────────────────────────

let _activeJobId = null;
let _paused      = false;

// ── Adaptive batch sizing ─────────────────────────────────────────────────────

const _adaptive = {
  currentSize:        DEFAULT_BATCH_SIZE,
  consecutiveSuccess: 0,
  consecutiveErrors:  0,
};

function adaptBatchSize(wasThrottled, highErrorRate) {
  if (wasThrottled) {
    _adaptive.currentSize       = Math.max(MIN_BATCH_SIZE, Math.floor(_adaptive.currentSize * 0.5));
    _adaptive.consecutiveSuccess = 0;
    _adaptive.consecutiveErrors++;
  } else if (highErrorRate) {
    _adaptive.consecutiveSuccess = 0;
    _adaptive.consecutiveErrors++;
  } else {
    _adaptive.consecutiveErrors  = 0;
    _adaptive.consecutiveSuccess++;
    if (_adaptive.consecutiveSuccess % 5 === 0) {
      _adaptive.currentSize = Math.min(MAX_BATCH_SIZE, Math.floor(_adaptive.currentSize * 1.25));
    }
  }
  return _adaptive.currentSize;
}

// ── Backoff ───────────────────────────────────────────────────────────────────

function backoffMs(attempt) {
  return Math.min(30_000, BASE_BACKOFF_MS * Math.pow(2, attempt)) + Math.random() * 200;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Job DB helpers ────────────────────────────────────────────────────────────

function createJob(db, { batch_size, max_titles, stage = 1, label = 'manual' } = {}) {
  const id = `emb_${Date.now()}`;
  db.run(`
    INSERT INTO embedding_ingest_jobs
      (id, status, batch_size, max_titles, stage, label, created_at, updated_at)
    VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))
  `, [id, 'pending', batch_size ?? DEFAULT_BATCH_SIZE, max_titles ?? null, stage, label]);
  return id;
}

function patchJob(db, id, patch) {
  const keys   = Object.keys(patch);
  const fields = keys.map(k => `${k} = ?`).join(', ');
  db.run(
    `UPDATE embedding_ingest_jobs SET ${fields}, updated_at = datetime('now') WHERE id = ?`,
    [...keys.map(k => patch[k]), id]
  );
}

function getJob(db, id) {
  return db.get(`SELECT * FROM embedding_ingest_jobs WHERE id = ?`, [id]);
}

function listJobs(db, limit = 20) {
  return db.all(`SELECT * FROM embedding_ingest_jobs ORDER BY created_at DESC LIMIT ?`, [limit]);
}

function resumeOrCreate(db, opts) {
  const active = db.get(
    `SELECT id FROM embedding_ingest_jobs WHERE status IN ('running','paused') ORDER BY created_at DESC LIMIT 1`
  );
  if (active) return active.id;
  return createJob(db, opts);
}

// ── Retry queue ───────────────────────────────────────────────────────────────

class RetryQueue {
  constructor() { this._items = []; }
  push(item)  { this._items.push(item); }
  drain()     { return this._items.splice(0); }
  get size()  { return this._items.length; }
}

function isThrottleError(e) {
  return e.status === 429
    || /429|rate.?limit|too.?many.?request/i.test(e.message ?? '');
}

// ── Process one video row ─────────────────────────────────────────────────────

async function processItem(db, row, retryQueue, attempt = 0) {
  try {
    const normalizedTitle = normalize(row.title);
    const hookProfile     = classifyHookTypeMulti(normalizedTitle);
    const features        = extractFeatures({ title: normalizedTitle, hook: normalizedTitle });
    const dna             = buildTitleDNA(normalizedTitle, hookProfile, features);
    const dnaText         = titleDnaToString(dna);

    const apiT0 = Date.now();
    const emb   = await generateEmbedding(dnaText, { db });
    const apiMs = Date.now() - apiT0;
    metrics.recordApiCall({ latency_ms: apiMs, success: !!emb });

    if (!emb || !emb.vector.length) return { ok: false, reason: 'no_embedding' };

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

    return { ok: true, provider: emb.provider };
  } catch (e) {
    const throttled = isThrottleError(e);
    if (attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt + 1));
      return processItem(db, row, retryQueue, attempt + 1);
    }
    if (attempt === MAX_RETRIES) retryQueue.push({ ...row, _lastError: e.message, _throttled: throttled });
    return { ok: false, reason: e.message, throttled };
  }
}

// ── Main queue runner ─────────────────────────────────────────────────────────
// Returns immediately with { ok, jobId } — actual work runs async.
// Check job status via getJob() or getQueueStatus().

async function runQueuedIngestion(db, opts = {}) {
  if (_activeJobId) {
    return { ok: false, error: 'job_already_running', activeJobId: _activeJobId };
  }
  _paused = false;

  const jobId = resumeOrCreate(db, opts);
  _activeJobId = jobId;
  patchJob(db, jobId, { status: 'running', started_at: new Date().toISOString() });

  // Run async — caller gets jobId immediately
  _doIngest(db, jobId, opts).catch(e => {
    try { patchJob(db, jobId, { status: 'failed', error_message: e.message }); } catch {}
    _activeJobId = null;
    console.error('[embeddingQueue] fatal error:', e.message);
  });

  return { ok: true, jobId, started: true };
}

async function _doIngest(db, jobId, opts) {
  const { max_titles } = opts;
  const job = getJob(db, jobId);

  try { buildTfidfCorpus(db); } catch { /* non-fatal */ }

  const provStatus    = getSemanticProviderStatus();
  const model         = provStatus.model;
  const retryQueue    = new RetryQueue();
  const seenHashes    = new Set();      // exact dedup within this run
  let processed       = 0;
  let errors          = 0;
  let duplicatesSkipped = 0;
  let throttleCount   = 0;
  let checkpointId    = job.last_checkpoint_id ?? null;
  let batchSize       = _adaptive.currentSize;
  const maxTitles     = max_titles ?? job.max_titles ?? Infinity;

  while (!_paused && processed + errors < maxTitles) {
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
        ${checkpointId ? 'AND iv.youtube_video_id > ?' : ''}
      ORDER BY iv.youtube_video_id
      LIMIT ?
    `, checkpointId ? [model, checkpointId, batchSize] : [model, batchSize]);

    if (!rows.length && retryQueue.size === 0) break;

    const batchT0        = Date.now();
    let batchOk          = 0;
    let batchErr         = 0;
    let batchThrottled   = false;

    for (const row of rows) {
      if (_paused) break;

      const titleNorm = normalize(row.title);

      // Quality gate
      const quality = classifyTitleQuality(titleNorm);
      if (!quality.ok) {
        metrics.recordLowQualitySkip();
        checkpointId = row.youtube_video_id;
        continue;
      }

      // Exact dedup within this batch run
      if (isExactDuplicate(titleNorm, seenHashes)) {
        metrics.recordDuplicateSkip();
        duplicatesSkipped++;
        checkpointId = row.youtube_video_id;
        continue;
      }

      const result = await processItem(db, row, retryQueue);
      if (result.ok) { batchOk++; processed++; }
      else           { batchErr++; errors++; if (result.throttled) { batchThrottled = true; throttleCount++; } }
      checkpointId = row.youtube_video_id;
    }

    // Drain retry queue
    for (const item of retryQueue.drain()) {
      if (_paused) { retryQueue.push(item); break; }
      const result = await processItem(db, item, retryQueue);
      if (result.ok) { batchOk++; processed++; }
      else           { batchErr++; errors++; }
    }

    const batchMs = Date.now() - batchT0;
    metrics.recordBatch({ processed: batchOk, errors: batchErr, latency_ms: batchMs, batch_size: rows.length, provider: provStatus.provider });
    metrics.persistMetrics(db, jobId);

    patchJob(db, jobId, {
      processed_count:    processed,
      error_count:        errors,
      skipped_count:      duplicatesSkipped,
      last_checkpoint_id: checkpointId,
      retry_queue_size:   retryQueue.size,
    });

    batchSize = adaptBatchSize(batchThrottled, batchErr > Math.max(1, batchOk) * 0.3);
    if (batchThrottled) await sleep(backoffMs(throttleCount));
  }

  const status = _paused ? 'paused' : 'completed';
  patchJob(db, jobId, {
    status,
    completed_at:     _paused ? null : new Date().toISOString(),
    processed_count:  processed,
    error_count:      errors,
    skipped_count:    duplicatesSkipped,
    final_batch_size: batchSize,
  });

  _activeJobId = null;
  console.log(`[embeddingQueue] job ${jobId} ${status}: ${processed} processed, ${errors} errors, ${duplicatesSkipped} skipped`);
}

// ── Control ───────────────────────────────────────────────────────────────────

function pauseIngestion() {
  _paused = true;
  return { ok: true, paused: true, activeJobId: _activeJobId };
}

function getQueueStatus(db) {
  const active = _activeJobId ? getJob(db, _activeJobId) : null;
  return {
    is_running:         !!_activeJobId,
    is_paused:          _paused,
    active_job_id:      _activeJobId,
    adaptive_batch_size: _adaptive.currentSize,
    consecutive_success: _adaptive.consecutiveSuccess,
    consecutive_errors:  _adaptive.consecutiveErrors,
    active_job:         active,
    queue_backlog:       active?.retry_queue_size ?? 0,
    default_batch_size:  DEFAULT_BATCH_SIZE,
    max_batch_size:      MAX_BATCH_SIZE,
  };
}

// ── Scale stages ──────────────────────────────────────────────────────────────
// Stage 1: 500 batch / 500 titles    → validate retrieval quality
// Stage 2: 1000 batch / 1000 titles  → validate clustering quality
// Stage 3: 1000 batch / 5000 titles  → full cluster eval
// Stage 4: unrestricted              → aggressive ingestion

const STAGES = [
  { stage: 1, label: 'Stage 1 — 500 batch, 500 titles',   batch_size: 500,  max_titles: 500  },
  { stage: 2, label: 'Stage 2 — 1000 batch, 1000 titles', batch_size: 1000, max_titles: 1000 },
  { stage: 3, label: 'Stage 3 — 1000 batch, 5000 titles', batch_size: 1000, max_titles: 5000 },
  { stage: 4, label: 'Stage 4 — Full corpus ingestion',   batch_size: 1000, max_titles: null },
];

function getScaleStatus(db) {
  const jobs      = listJobs(db, 50);
  const maxStage  = jobs.reduce((m, j) => Math.max(m, j.stage ?? 1), 1);
  const stageJobs = STAGES.map(s => ({
    ...s,
    completed: jobs.some(j => j.stage === s.stage && j.status === 'completed'),
    total_processed: jobs.filter(j => j.stage === s.stage).reduce((sum, j) => sum + (j.processed_count ?? 0), 0),
  }));
  const nextStage = stageJobs.find(s => !s.completed) ?? null;
  return { stages: stageJobs, current_max_stage: maxStage, next_stage: nextStage };
}

module.exports = {
  runQueuedIngestion, pauseIngestion, getQueueStatus, getScaleStatus,
  createJob, listJobs, getJob, STAGES,
  DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE,
};
