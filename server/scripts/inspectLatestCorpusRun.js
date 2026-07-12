'use strict';

const DB = require('../node_modules/better-sqlite3');

const db = new DB(require('path').join(__dirname, '../data/scoring.db'), {
  readonly: true,
  timeout: 60000,
});

const limit = parseInt(process.argv[2] || '1', 10);
const rows = db.prepare(`
  SELECT id, started_at, completed_at, status, quota_used, quota_budget,
         channels_ingested, channels_evaluated, channels_promoted,
         channels_demoted, discovery_synced, error, log_json
  FROM corpus_run_log
  ORDER BY started_at DESC
  LIMIT ?
`).all(limit);

for (const r of rows) {
  console.log('\n=== RUN ===');
  console.log(JSON.stringify({
    id: r.id,
    started_at: r.started_at,
    completed_at: r.completed_at,
    status: r.status,
    quota_used: r.quota_used,
    quota_budget: r.quota_budget,
    channels_ingested: r.channels_ingested,
    channels_evaluated: r.channels_evaluated,
    channels_promoted: r.channels_promoted,
    channels_demoted: r.channels_demoted,
    discovery_synced: r.discovery_synced,
    error: r.error,
  }, null, 2));

  const log = JSON.parse(r.log_json || '[]');
  for (const entry of log) {
    console.log(JSON.stringify(entry));
  }
}

db.close();
