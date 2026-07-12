'use strict';

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch (_) { return '{}'; }
}

function recordPipelineHealth(db, {
  job_name,
  status = 'ok',
  started_at = null,
  duration_ms = null,
  metrics = {},
  error_message = null,
} = {}) {
  if (!db || !job_name) return;
  try {
    db.run(
      `INSERT INTO pipeline_health_snapshots
         (job_name, status, started_at, completed_at, duration_ms, metrics_json, error_message)
       VALUES (?, ?, ?, datetime('now'), ?, ?, ?)`,
      [
        job_name,
        status,
        started_at,
        duration_ms,
        safeJson(metrics),
        error_message ? String(error_message).slice(0, 1000) : null,
      ],
    );
  } catch (e) {
    console.warn('[pipelineHealth] record failed:', e.message);
  }
}

function checkpointWalPassive(db, label = 'pipeline') {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  } catch (e) {
    console.warn(`[${label}] WAL checkpoint failed:`, e.message);
  }
}

module.exports = {
  recordPipelineHealth,
  checkpointWalPassive,
};
