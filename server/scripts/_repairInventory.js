'use strict';
// Quick inventory: what repair populations actually exist in the DB?
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 30000 });

// 1. Reclassification log by tier
try {
  const rows = db.prepare(`
    SELECT tier, status,
           COUNT(*) as n,
           SUM(niche_changed) as changed,
           MIN(reclassified_at) as first,
           MAX(reclassified_at) as last
    FROM reclassification_log
    GROUP BY tier, status
    ORDER BY tier, status
  `).all();
  console.log('\n=== reclassification_log by tier+status ===');
  for (const r of rows) console.log(` tier=${r.tier} status=${r.status.padEnd(24)} n=${r.n} changed=${r.changed||0}  ${r.first?.slice(0,16)} → ${r.last?.slice(0,16)}`);
} catch(e) { console.log('reclassification_log:', e.message); }

// 2. Auto repairs (identity_source)
try {
  const rows = db.prepare(`
    SELECT identity_source, COUNT(*) as n FROM ingested_channels
    WHERE identity_source LIKE '%repair%' OR identity_source LIKE '%reclassify%'
    GROUP BY identity_source ORDER BY n DESC
  `).all();
  console.log('\n=== identity_source repair/reclassify counts ===');
  for (const r of rows) console.log(` ${r.identity_source}: ${r.n}`);
} catch(e) { console.log('identity_source:', e.message); }

// 3. repair_reason distribution in original queue
try {
  const rows = db.prepare(`
    SELECT repair_reason, status, COUNT(*) as n
    FROM classification_repair_candidates
    GROUP BY repair_reason, status
    ORDER BY repair_reason, status
  `).all();
  console.log('\n=== classification_repair_candidates by reason+status ===');
  for (const r of rows) console.log(` ${(r.repair_reason||'?').padEnd(26)} ${r.status.padEnd(20)} n=${r.n}`);
} catch(e) { console.log('crc:', e.message); }

// 4. WTP cache tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
const wtpTables = tables.filter(t => t.toLowerCase().includes('wtp'));
console.log('\n=== WTP-related tables ===');
console.log(wtpTables.join(', ') || '(none)');

// 5. Channel identity_source breakdown for all
try {
  const rows = db.prepare(`SELECT identity_source, COUNT(*) as n FROM ingested_channels GROUP BY identity_source ORDER BY n DESC LIMIT 15`).all();
  console.log('\n=== ingested_channels identity_source ===');
  for (const r of rows) console.log(` ${(r.identity_source||'null').padEnd(30)} ${r.n}`);
} catch(e) { console.log('identity_source all:', e.message); }

// 6. Check for "auto repairs" (pre-tier manual/AI repairs)
try {
  const r = db.prepare(`SELECT COUNT(*) as n, MIN(identity_last_detected_at) as first, MAX(identity_last_detected_at) as last
    FROM ingested_channels WHERE identity_source = 'auto_repair'`).get();
  console.log('\nauto_repair channels:', r.n, ' ', r.first?.slice(0,16), '→', r.last?.slice(0,16));
} catch(e) {}

try {
  const r = db.prepare(`SELECT COUNT(*) as n FROM ingested_channels WHERE niche_override IS NOT NULL AND identity_source NOT LIKE '%human%'`).get();
  console.log('niche_override (non-human):', r.n);
} catch(e) {}

db.close();
