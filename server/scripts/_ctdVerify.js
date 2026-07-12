'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });
const q  = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);

// 1. refresh_jobs (correct table name — not refresh_queue)
console.log('=== refresh_jobs TABLE ===');
try {
  const n = q1('SELECT COUNT(*) n FROM refresh_jobs');
  console.log('refresh_jobs rows:', n.n);
  const stat = q('SELECT status, job_type, COUNT(*) n FROM refresh_jobs GROUP BY status, job_type ORDER BY n DESC');
  console.log('Breakdown:');
  for (const r of stat) console.log('  ', r.status, '|', r.job_type, '|', r.n);
  const ts = q1('SELECT MIN(created_at) oldest, MAX(created_at) newest FROM refresh_jobs');
  console.log('Oldest:', ts?.oldest, '  Newest:', ts?.newest);
} catch(e) { console.log('refresh_jobs error:', e.message); }

// 2. Primary niche distribution (actual WTP peer pool sizes)
console.log('\n=== PRIMARY_NICHE DISTRIBUTION (actual peer pool sizes) ===');
const pn = q(`SELECT primary_niche, COUNT(*) n FROM ingested_channels
  WHERE ingest_enabled=1 AND primary_niche IS NOT NULL
  GROUP BY primary_niche ORDER BY n DESC LIMIT 25`);
for (const r of pn) console.log(' ', (r.primary_niche||'?').padEnd(25), r.n);

// 3. Did repair update primary_niche?
console.log('\n=== REPAIR vs PRIMARY_NICHE ===');
const rc = q(`
  SELECT crc.suggested_niche,
         ic.primary_niche AS live_primary,
         (crc.suggested_niche = ic.primary_niche) AS primary_updated,
         COUNT(*) n
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status IN ('reclassified','auto_repaired')
  GROUP BY crc.suggested_niche, ic.primary_niche, primary_updated
  ORDER BY n DESC
`);
const primaryUpdated    = rc.filter(r => r.primary_updated === 1).reduce((s,r)=>s+r.n, 0);
const primaryNotUpdated = rc.filter(r => r.primary_updated !== 1).reduce((s,r)=>s+r.n, 0);
console.log('  primary_niche = suggested_niche:', primaryUpdated);
console.log('  primary_niche != suggested_niche:', primaryNotUpdated);
console.log('  Mismatches:');
for (const r of rc.filter(r => r.primary_updated !== 1).slice(0,10)) {
  console.log('    repair→' + r.suggested_niche + ' but live_primary=' + r.live_primary + ' (' + r.n + ')');
}

// 4. Reclassification log analysis
console.log('\n=== RECLASSIFICATION LOG ACTIONS ===');
try {
  const logSchema = q('PRAGMA table_info(reclassification_log)');
  console.log('Columns:', logSchema.map(c => c.name).join(', '));
  const actions = q(`SELECT action, COUNT(*) n FROM reclassification_log GROUP BY action ORDER BY n DESC LIMIT 15`);
  for (const r of actions) console.log(' ', (r.action||'null').padEnd(35), r.n);
  const wtpActions = q(`SELECT * FROM reclassification_log WHERE action LIKE '%wtp%' OR action LIKE '%cache%' LIMIT 5`);
  console.log('WTP/cache actions found:', wtpActions.length);
} catch(e) { console.log('reclassification_log error:', e.message); }

// 5. getCachedOrComputeWhatToPost — is WTP called from routes?
// Check what API routes exist
console.log('\n=== ALL TABLES IN DB ===');
const tables = q(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
for (const t of tables) process.stdout.write(t.name + '  ');
console.log('');

// 6. NICHE_CLUSTERS effect: how many channels would selfimprovement channel get as peers?
// (selfimprovement cluster = selfimprovement + motivation + personal development + ...)
const selfimpCluster = q(`
  SELECT niche, primary_niche, COUNT(*) n FROM ingested_channels
  WHERE ingest_enabled=1
    AND (primary_niche IN ('selfimprovement','motivation')
      OR niche IN ('selfimprovement','motivation','personal development','personal growth'))
  GROUP BY niche, primary_niche ORDER BY n DESC LIMIT 15
`);
console.log('\n=== SELFIMPROVEMENT CLUSTER (actual peer pool) ===');
for (const r of selfimpCluster) {
  console.log('  primary=' + (r.primary_niche||'?').padEnd(20) + ' niche=' + (r.niche||'?').padEnd(30) + ' n=' + r.n);
}

// 7. How many channels use COALESCE(primary_niche, niche) vs just niche for peer selection
// Check: are there channels where primary_niche IS NULL?
const noPN = q1(`SELECT COUNT(*) n FROM ingested_channels WHERE primary_niche IS NULL AND ingest_enabled=1`);
console.log('\n=== CHANNELS WITH NULL primary_niche ===', noPN?.n);

db.close();
console.log('\nDone.');
