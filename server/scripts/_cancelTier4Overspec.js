'use strict';
// Cancel OVERSPEC candidates identified by queue audit before Tier 4 runs.
// Overspec migrations: music→lifestyle, beauty→lifestyle (now close-niche),
// entertainment→travel (historical FP rate 43%), comedy→education (archetype guard).

const path = require('path');
const DB   = require('../node_modules/better-sqlite3');
const db   = new DB(path.resolve(__dirname, '../data/scoring.db'), { timeout: 60000 });
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=60000');

const before = db.prepare("SELECT COUNT(*) as n FROM classification_repair_candidates WHERE status='queued'").get().n;
console.log('Queue before:', before);

const cancellations = [
  {
    reason: 'music→lifestyle now close-niche (June 2026 fix)',
    sql: "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='overspec:music+lifestyle now close-niche' WHERE current_niche='music' AND suggested_niche='lifestyle' AND status='queued'",
  },
  {
    reason: 'beauty→lifestyle now close-niche (June 2026 fix)',
    sql: "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='overspec:beauty+lifestyle now close-niche' WHERE current_niche='beauty' AND suggested_niche='lifestyle' AND status='queued'",
  },
  {
    reason: 'entertainment→travel historical FP rate 43%',
    sql: "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='overspec:entertainment→travel FP=43%' WHERE current_niche='entertainment' AND suggested_niche='travel' AND status='queued'",
  },
  {
    reason: 'comedy→education archetype guard (hard_conflict pair)',
    sql: "UPDATE classification_repair_candidates SET status='cancelled', repaired_at=datetime('now'), repair_applied='overspec:comedy+authority_educator is hard_conflict pair' WHERE current_niche='comedy' AND suggested_niche='education' AND status='queued'",
  },
];

let totalCancelled = 0;
for (const { reason, sql } of cancellations) {
  const result = db.prepare(sql).run();
  console.log(`  Cancelled ${result.changes.toString().padStart(3)}  [${reason}]`);
  totalCancelled += result.changes;
}

const after = db.prepare("SELECT COUNT(*) as n FROM classification_repair_candidates WHERE status='queued'").get().n;
console.log(`\nQueue after:  ${after}  (removed ${totalCancelled})`);
console.log('Ready for Tier 4.');
db.close();
