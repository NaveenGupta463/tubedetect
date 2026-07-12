'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { timeout: 60000 });
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=60000');

// Before counts
const before = db.prepare(
  "SELECT repair_reason, COUNT(*) as n FROM classification_repair_candidates WHERE status='queued' GROUP BY repair_reason ORDER BY n DESC"
).all();
console.log('=== QUEUE BEFORE ===');
let totalBefore = 0;
for (const r of before) { console.log('  ' + r.repair_reason.padEnd(28) + r.n); totalBefore += r.n; }
console.log('  TOTAL queued:               ' + totalBefore);

// Cancel behavior_tag_mismatch
const result = db.prepare(
  "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='disabled:roi=-6.3,fp_rate=52.9%,avg_lift=-13.3pp' WHERE repair_reason='behavior_tag_mismatch' AND status='queued'"
).run();
console.log('\nCancelled: ' + result.changes + ' behavior_tag_mismatch candidates');

// After counts
const after = db.prepare(
  "SELECT repair_reason, COUNT(*) as n FROM classification_repair_candidates WHERE status='queued' GROUP BY repair_reason ORDER BY n DESC"
).all();
console.log('\n=== QUEUE AFTER ===');
let totalAfter = 0;
for (const r of after) { console.log('  ' + r.repair_reason.padEnd(28) + r.n); totalAfter += r.n; }
console.log('  TOTAL queued:               ' + totalAfter);

// Expected precision improvement
const weightedFpBefore = (1721 * 0.117 + 779 * 0.529) / (1721 + 779);
const weightedFpAfter = 0.117;
const weightedLiftBefore = (1721 * 12.9 + 779 * -13.3) / (1721 + 779);
const weightedLiftAfter = 12.9;
console.log('\n=== EXPECTED PRECISION IMPACT ===');
console.log('  Weighted FP rate before removal: ' + (weightedFpBefore * 100).toFixed(1) + '%');
console.log('  Weighted FP rate after removal:  ' + (weightedFpAfter * 100).toFixed(1) + '%');
console.log('  Weighted avg lift before:        +' + weightedLiftBefore.toFixed(1) + 'pp');
console.log('  Weighted avg lift after:         +' + weightedLiftAfter.toFixed(1) + 'pp');
console.log('  Channels removed from queue:     ' + result.changes);
console.log('  Remaining actionable queue:      ' + totalAfter);

db.close();
