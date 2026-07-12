'use strict';
// One-shot: rebuild creator DNA for native-script channels so the v2 native-topic
// extraction goes live now (the pipeline otherwise only rebuilds on ingest/onboarding).
// Targets non-English channels with a stale (v1) DNA and enough stored titles.
// Music channels are included but harmless (bets stay suppressed); skipping them isn't worth
// a second query. Idempotent: re-running only touches channels still below the current version.
const path = require('path');
const { getDb } = require('../db/init');
const { persistCreatorIdeaDnaForPipeline } = require('../services/creatorIdeaDnaPipeline');
const { CREATOR_IDEA_DNA_VERSION } = require('../services/creatorIdeaDna');

const db = getDb();
const COMMIT = process.argv.includes('--commit');

const rows = db.all(
  `SELECT d.channel_id
     FROM creator_idea_dna d
     JOIN ingested_channels ic ON ic.channel_id = d.channel_id
    WHERE ic.ingest_enabled = 1
      AND ic.primary_language IS NOT NULL AND ic.primary_language != 'en'
      AND COALESCE(d.source_version, 0) < ?`,
  [CREATOR_IDEA_DNA_VERSION]);

console.log(`native-script channels with stale DNA (v<${CREATOR_IDEA_DNA_VERSION}): ${rows.length}`);
if (!COMMIT) { console.log('DRY RUN — re-run with --commit to rebuild.'); db.close(); process.exit(0); }

let rebuilt = 0, skipped = 0, errors = 0;
const t0 = Date.now();
for (let i = 0; i < rows.length; i++) {
  const r = persistCreatorIdeaDnaForPipeline(db, rows[i].channel_id, { reason: 'native_topic_backfill' });
  if (r.ok && !r.skipped) rebuilt++; else if (r.ok || r.skipped) skipped++; else errors++;
  // clear stale WTP cache so the next view recomputes bets from the new DNA
  try { db.run(`DELETE FROM channel_wtp_cache WHERE channel_id=?`, [rows[i].channel_id]); } catch (_) {}
  if ((i + 1) % 500 === 0) console.log(`  ${i + 1}/${rows.length}  rebuilt=${rebuilt} skipped=${skipped} errors=${errors}  (${Math.round((Date.now() - t0) / 1000)}s)`);
}
console.log(`\nDONE — rebuilt=${rebuilt} skipped=${skipped} errors=${errors} of ${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s`);
db.close();
