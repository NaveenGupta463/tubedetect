'use strict';
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });

const runs = db.prepare('SELECT id, started_at, completed_at, status, quota_used, error FROM corpus_run_log ORDER BY started_at DESC LIMIT 5').all();
console.log('\n=== Recent corpus runs ===');
for (const r of runs) {
  const dur = r.completed_at ? Math.round((new Date(r.completed_at) - new Date(r.started_at)) / 60000) + 'min' : 'running?';
  console.log(` ${r.started_at}  ${r.status.padEnd(12)}  quota=${r.quota_used}  dur=${dur}${r.error ? '  err='+r.error.slice(0,80) : ''}`);
}

const h14 = "datetime('now','-14 hours')";

try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(last_ingested_at) as last FROM corpus_channels WHERE last_ingested_at > ${h14}`).get();
  console.log('\nCorpus channels ingested (14h):', r.n, '  last:', r.last);
} catch (e) { console.log('corpus_channels:', e.message); }

try {
  const r = db.prepare(`SELECT COUNT(*) as n FROM ingested_videos WHERE created_at > ${h14}`).get();
  console.log('Ingested videos added (14h):  ', r.n);
} catch (e) { console.log('ingested_videos:', e.message); }

try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(computed_at) as last FROM trend_signals WHERE computed_at > ${h14}`).get();
  console.log('Trend signals computed (14h): ', r.n, '  last:', r.last);
} catch (e) { console.log('trend_signals:', e.message); }

try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(updated_at) as last FROM channel_fingerprints WHERE updated_at > ${h14}`).get();
  console.log('Fingerprints updated (14h):   ', r.n, '  last:', r.last);
} catch (e) { console.log('channel_fingerprints:', e.message); }

try {
  const r = db.prepare(`SELECT COUNT(*) as n, MAX(detected_at) as last FROM identity_detection_log WHERE detected_at > ${h14}`).get();
  console.log('Identity detections (14h):    ', r.n, '  last:', r.last);
} catch (e) { console.log('identity_detection_log:', e.message); }

db.close();
