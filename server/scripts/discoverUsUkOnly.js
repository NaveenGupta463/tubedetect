'use strict';

// One-off: run a US/UK-ONLY discovery cycle and report discovery + corpus/seed coverage.
//   node scripts/discoverUsUkOnly.js

require('dotenv').config({ path: __dirname + '/../.env' });

const { getDb } = require('../db/init');
const { runDiscoveryCycle } = require('../services/discoveryAgent');

function coverage(db, label) {
  const row = db.get(
    `SELECT
       COUNT(*) AS corpus_total,
       SUM(CASE WHEN COALESCE(cc.video_count,0) >= 5 THEN 1 ELSE 0 END) AS ingestable,
       SUM(CASE WHEN ic.channel_id IS NOT NULL THEN 1 ELSE 0 END) AS seeded,
       SUM(CASE WHEN COALESCE(cc.video_count,0) >= 5 AND ic.channel_id IS NULL THEN 1 ELSE 0 END) AS ingestable_unseeded
     FROM corpus_channels cc
     LEFT JOIN ingested_channels ic ON ic.channel_id = cc.channel_id
     WHERE cc.yt_country IN ('US','GB') OR cc.country IN ('US','GB')`,
  );
  console.log(`\n── US/UK corpus coverage (${label}) ──`);
  console.log(`  corpus total (US/GB):     ${row.corpus_total}`);
  console.log(`  ingestable (>=5 videos):  ${row.ingestable}`);
  console.log(`  already seeded/ingested:  ${row.seeded}`);
  console.log(`  ingestable & NOT seeded:  ${row.ingestable_unseeded}`);
  return row;
}

(async () => {
  const db = getDb();
  coverage(db, 'before');

  console.log('\n── Running US/UK-only discovery cycle ──');
  const res = await runDiscoveryCycle(db, {
    allowUsSearch: true, maxUsSearches: parseInt(process.env.US_SEARCHES ?? '10', 10),
    allowGbSearch: true, maxGbSearches: parseInt(process.env.GB_SEARCHES ?? '6', 10),
  });

  console.log('\n── Discovery results ──');
  console.log(`  US searches run:   ${res.us_searches_run}`);
  console.log(`  US discovered:     ${res.us_discovered}`);
  console.log(`  GB searches run:   ${res.gb_searches_run}`);
  console.log(`  GB discovered:     ${res.gb_discovered}`);

  coverage(db, 'after');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
