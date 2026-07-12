'use strict';
// Cancel queued repair candidates that are now suppressed by the expanded
// CLOSE_NICHE_GROUPS (music+lifestyle, beauty+lifestyle added June 2026).

const path = require('path');
const DB   = require('../node_modules/better-sqlite3');
const db   = new DB(path.resolve(__dirname, '../data/scoring.db'), { timeout: 60000 });
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=60000');

// Before state
const before = db.prepare(
  "SELECT suggested_niche, COUNT(*) as n FROM classification_repair_candidates WHERE current_niche='lifestyle' AND status='queued' GROUP BY suggested_niche ORDER BY n DESC"
).all();
console.log('=== lifestyle queued before ===');
let totalBefore = 0;
for (const r of before) { console.log(`  → ${r.suggested_niche.padEnd(22)} ${r.n}`); totalBefore += r.n; }
console.log(`  TOTAL: ${totalBefore}`);

// Cancel lifestyle→music and lifestyle→beauty (now suppressed by close-niche)
const musicResult = db.prepare(
  "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='suppressed:music+lifestyle now close-niche (audit June 2026)' WHERE current_niche='lifestyle' AND suggested_niche='music' AND status='queued'"
).run();

const beautyResult = db.prepare(
  "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='suppressed:beauty+lifestyle now close-niche (audit June 2026)' WHERE current_niche='lifestyle' AND suggested_niche='beauty' AND status='queued'"
).run();

console.log(`\nCancelled lifestyle→music:  ${musicResult.changes}`);
console.log(`Cancelled lifestyle→beauty: ${beautyResult.changes}`);

// After state
const after = db.prepare(
  "SELECT suggested_niche, COUNT(*) as n FROM classification_repair_candidates WHERE current_niche='lifestyle' AND status='queued' GROUP BY suggested_niche ORDER BY n DESC"
).all();
console.log('\n=== lifestyle queued after ===');
let totalAfter = 0;
for (const r of after) { console.log(`  → ${r.suggested_niche.padEnd(22)} ${r.n}`); totalAfter += r.n; }
console.log(`  TOTAL: ${totalAfter}`);

// Total queue change
const totalBefore2 = db.prepare(
  "SELECT COUNT(*) as n FROM classification_repair_candidates WHERE status='queued'"
).get().n;
console.log(`\nFull queue remaining: ${totalBefore2}`);
db.close();
