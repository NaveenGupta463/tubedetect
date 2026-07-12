'use strict';

const { getDb } = require('../db/init');
const { buildCorpusIndex, computeChannelIdentity, upsertChannelIdentity } = require('../lib/channelIdentity');

async function run() {
  const db = getDb();

  const candidates = db.all(
    `SELECT ic.channel_id, ic.channel_subscribers
     FROM ingested_channels ic
     LEFT JOIN channel_identity ci ON ci.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND ic.content_fingerprint IS NOT NULL
       AND (
         ci.channel_id IS NULL
         OR ci.computed_at < datetime('now', '-30 days')
       )
     ORDER BY ic.channel_subscribers DESC NULLS LAST`,
  );

  console.log(`[backfill-identity] ${candidates.length} channels to process`);
  console.log('[backfill-identity] Building corpus index...');
  const corpusIndex = buildCorpusIndex(db);
  console.log(`[backfill-identity] Corpus index ready — ${corpusIndex.size} channels, ${corpusIndex.phraseCount.size} unique phrases`);

  let ok = 0, skipped = 0, err = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { channel_id } = candidates[i];
    try {
      const identity = computeChannelIdentity(db, channel_id, corpusIndex);
      upsertChannelIdentity(db, identity);
      ok++;
    } catch (e) {
      err++;
      console.error(`[backfill-identity] error channel=${channel_id}:`, e.message);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`[backfill-identity] ${i + 1}/${candidates.length} — ok=${ok} err=${err}`);
    }
  }

  console.log(`[backfill-identity] Done. ok=${ok} skipped=${skipped} err=${err} / ${candidates.length} total`);
}

run().catch(e => {
  console.error('[backfill-identity] Fatal:', e.message);
  process.exit(1);
});
