'use strict';
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });

// Check corpus run log
let runs = [];
try {
  runs = db.prepare('SELECT * FROM corpus_run_log ORDER BY started_at DESC LIMIT 5').all();
  console.log('\nRecent corpus runs:');
  for (const r of runs) console.log(' ', JSON.stringify(r));
} catch (e) {
  console.log('corpus_run_log:', e.message);
}

// Check reclassification_log for recent activity
try {
  const recent = db.prepare(`SELECT status, COUNT(*) as n, MAX(reclassified_at) as last FROM reclassification_log GROUP BY status ORDER BY last DESC`).all();
  console.log('\nReclassification log:');
  for (const r of recent) console.log(' ', JSON.stringify(r));
} catch (e) {
  console.log('reclassification_log:', e.message);
}

// Check ingested_channels recently updated
try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(identity_last_detected_at) as last FROM ingested_channels WHERE identity_last_detected_at > datetime('now', '-12 hours')`).get();
  console.log('\nChannels updated in last 12h:', r.n, '  last:', r.last);
} catch (e) {
  console.log('ingested_channels check:', e.message);
}

// Check ingested_videos recently added
try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(published_at) as last_pub FROM ingested_videos WHERE created_at > datetime('now', '-12 hours')`).get();
  console.log('Videos ingested in last 12h:', r.n);
} catch (e) {
  console.log('ingested_videos check:', e.message);
}

// Check corpus_channels
try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(last_ingested_at) as last FROM corpus_channels WHERE last_ingested_at > datetime('now', '-12 hours')`).get();
  console.log('Corpus channels ingested in last 12h:', r.n, '  last:', r.last);
} catch (e) {
  console.log('corpus_channels check:', e.message);
}

// Check trend signal job
try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(computed_at) as last FROM trend_signals WHERE computed_at > datetime('now', '-12 hours')`).get();
  console.log('Trend signals computed in last 12h:', r.n, '  last:', r.last);
} catch (e) {
  console.log('trend_signals check:', e.message);
}

db.close();
