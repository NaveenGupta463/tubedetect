'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'scoring.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 30_000 });

function parseMetrics(row) {
  try { return JSON.parse(row.metrics_json || '{}'); } catch (_) { return {}; }
}

const rows = db.prepare(`
  SELECT *
  FROM pipeline_health_snapshots
  WHERE id IN (
    SELECT MAX(id)
    FROM pipeline_health_snapshots
    GROUP BY job_name
  )
  ORDER BY completed_at DESC
`).all();

console.log('\n=== Latest Pipeline Health ===');
console.table(rows.map(r => ({
  job_name: r.job_name,
  status: r.status,
  completed_at: r.completed_at,
  duration_s: r.duration_ms != null ? +(r.duration_ms / 1000).toFixed(1) : null,
  ...parseMetrics(r),
})));

console.log('\n=== Last 20 Health Events ===');
console.table(db.prepare(`
  SELECT job_name, status, completed_at, ROUND(duration_ms / 1000.0, 1) AS duration_s, error_message
  FROM pipeline_health_snapshots
  ORDER BY completed_at DESC
  LIMIT 20
`).all());
