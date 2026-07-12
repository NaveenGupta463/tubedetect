'use strict';

const path = require('path');
const DB = require('../node_modules/better-sqlite3');

const cutoff = process.argv[2];
if (!cutoff) {
  console.error('Usage: node server/scripts/checkPipelineIngestedChannels.js "YYYY-MM-DD HH:mm:ss"');
  process.exit(1);
}

const db = new DB(path.resolve(__dirname, '../data/scoring.db'), {
  readonly: true,
  fileMustExist: true,
  timeout: 60000,
});

const total = db.prepare(
  `SELECT COUNT(*) AS n
   FROM ingested_channels
   WHERE added_at >= ?`,
).get(cutoff).n;

const byAddedBy = db.prepare(
  `SELECT COALESCE(added_by, 'unknown') AS added_by, COUNT(*) AS n
   FROM ingested_channels
   WHERE added_at >= ?
   GROUP BY COALESCE(added_by, 'unknown')
   ORDER BY n DESC`,
).all(cutoff);

const byNiche = db.prepare(
  `SELECT COALESCE(primary_niche, niche, 'unknown') AS niche, COUNT(*) AS n
   FROM ingested_channels
   WHERE added_at >= ?
   GROUP BY COALESCE(primary_niche, niche, 'unknown')
   ORDER BY n DESC
   LIMIT 20`,
).all(cutoff);

const samples = db.prepare(
  `SELECT channel_name, channel_id, COALESCE(primary_niche, niche) AS niche,
          channel_subscribers, added_by, added_at
   FROM ingested_channels
   WHERE added_at >= ?
   ORDER BY added_at DESC
   LIMIT 20`,
).all(cutoff);

console.log('cutoff', cutoff);
console.log('channels_added', total);
console.log('BY_ADDED_BY');
console.table(byAddedBy);
console.log('TOP_NICHES');
console.table(byNiche);
console.log('RECENT_SAMPLES');
console.table(samples);

db.close();
