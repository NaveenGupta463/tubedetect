'use strict';

// Phase 2 — Ingestion Observability
// In-memory circular buffers for real-time telemetry.
// Flush to embedding_telemetry table for persistence.

const _state = {
  batches:               [],   // { ts, processed, errors, latency_ms, batch_size, provider }
  apiCalls:              [],   // { ts, latency_ms, tokens, success }
  vectorInsertLatencies: [],   // ms values
  startTime:             Date.now(),
  totalProcessed:        0,
  totalErrors:           0,
  totalTokens:           0,
  totalApiCalls:         0,
  duplicatesSkipped:     0,
  lowQualitySkipped:     0,
};

function recordBatch({ processed, errors, latency_ms, batch_size, provider }) {
  _state.batches.push({ ts: Date.now(), processed, errors, latency_ms, batch_size, provider });
  if (_state.batches.length > 200) _state.batches.shift();
  _state.totalProcessed += processed;
  _state.totalErrors    += errors;
}

function recordApiCall({ latency_ms, tokens = 0, success = true }) {
  _state.apiCalls.push({ ts: Date.now(), latency_ms, tokens, success });
  if (_state.apiCalls.length > 2000) _state.apiCalls.shift();
  _state.totalTokens  += tokens;
  _state.totalApiCalls++;
}

function recordVectorInsert(latency_ms) {
  _state.vectorInsertLatencies.push(latency_ms);
  if (_state.vectorInsertLatencies.length > 2000) _state.vectorInsertLatencies.shift();
}

function recordDuplicateSkip()   { _state.duplicatesSkipped++; }
function recordLowQualitySkip()  { _state.lowQualitySkipped++; }

function getMetrics() {
  const now       = Date.now();
  const oneMinAgo = now - 60_000;

  const recentBatches = _state.batches.filter(b => b.ts > oneMinAgo);
  const recentCalls   = _state.apiCalls.filter(c => c.ts > oneMinAgo);

  const embPerMinute  = recentBatches.reduce((s, b) => s + b.processed, 0);
  const avgApiLatency = recentCalls.length
    ? recentCalls.reduce((s, c) => s + c.latency_ms, 0) / recentCalls.length : 0;

  const successfulCalls = _state.apiCalls.filter(c => c.success).length;
  const apiSuccessRate  = _state.apiCalls.length ? successfulCalls / _state.apiCalls.length : 1;

  const avgVecInsert = _state.vectorInsertLatencies.length
    ? _state.vectorInsertLatencies.reduce((s, l) => s + l, 0) / _state.vectorInsertLatencies.length : 0;

  return {
    embeddings_per_minute:        embPerMinute,
    avg_api_latency_ms:           Math.round(avgApiLatency),
    total_processed:              _state.totalProcessed,
    total_errors:                 _state.totalErrors,
    total_tokens_used:            _state.totalTokens,
    total_api_calls:              _state.totalApiCalls,
    api_success_rate:             parseFloat(apiSuccessRate.toFixed(4)),
    duplicates_skipped:           _state.duplicatesSkipped,
    low_quality_skipped:          _state.lowQualitySkipped,
    avg_vector_insert_latency_ms: Math.round(avgVecInsert),
    recent_batches_1m:            recentBatches.length,
    uptime_ms:                    now - _state.startTime,
  };
}

function getThroughputHistory() {
  const buckets = {};
  for (const b of _state.batches) {
    const minute = Math.floor(b.ts / 60_000) * 60_000;
    if (!buckets[minute]) buckets[minute] = { ts: minute, processed: 0, errors: 0 };
    buckets[minute].processed += b.processed;
    buckets[minute].errors    += b.errors;
  }
  return Object.values(buckets)
    .sort((a, b) => a.ts - b.ts)
    .slice(-30);
}

function persistMetrics(db, jobId) {
  const m = getMetrics();
  try {
    db.run(`
      INSERT INTO embedding_telemetry
        (job_id, recorded_at, embeddings_per_minute, avg_api_latency_ms,
         total_processed, total_errors, api_success_rate, duplicates_skipped,
         avg_vector_insert_latency_ms, total_tokens_used)
      VALUES (?,datetime('now'),?,?,?,?,?,?,?,?)
    `, [jobId ?? null, m.embeddings_per_minute, m.avg_api_latency_ms,
        m.total_processed, m.total_errors, m.api_success_rate,
        m.duplicates_skipped, m.avg_vector_insert_latency_ms, m.total_tokens_used]);
  } catch { /* non-fatal */ }
}

function resetCounters() {
  Object.assign(_state, {
    batches: [], apiCalls: [], vectorInsertLatencies: [],
    startTime: Date.now(),
    totalProcessed: 0, totalErrors: 0, totalTokens: 0,
    totalApiCalls: 0, duplicatesSkipped: 0, lowQualitySkipped: 0,
  });
}

module.exports = {
  recordBatch, recordApiCall, recordVectorInsert,
  recordDuplicateSkip, recordLowQualitySkip,
  getMetrics, getThroughputHistory, persistMetrics, resetCounters,
};
