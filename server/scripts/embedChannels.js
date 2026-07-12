'use strict';
// One-shot backfill: generate a creator_profile embedding (OpenAI text-embedding-3-small) for
// every enabled channel with enough videos, so Layer-3 semantic peer ranking works corpus-wide
// (not just lazily on viewed channels). Idempotent: skips channels already embedded. Batched (64/
// call) — ~text-embedding-3-small is cheap (whole corpus ≈ $0.50). Cost-bearing → dry-run by
// default; pass --commit to run.
//
//   node source/server/scripts/embedChannels.js           (DRY RUN — counts only)
//   node source/server/scripts/embedChannels.js --commit  (embeds + caches)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getDb } = require('../db/init');
const { embedChannels, EMODEL } = require('../services/channelEmbeddings');

const COMMIT = process.argv.includes('--commit');
const db = getDb();

(async () => {
  const already = new Set(db.all(`SELECT source_id FROM semantic_embeddings WHERE source_type='creator_profile' AND embedding_model=?`, [EMODEL]).map(r => r.source_id));
  const todo = db.all(
    `SELECT channel_id FROM ingested_channels ic
     WHERE ingest_enabled=1
       AND (SELECT COUNT(*) FROM ingested_videos v WHERE v.channel_id=ic.channel_id) >= 8`,
  ).map(r => r.channel_id).filter(id => !already.has(id));

  console.log(`enabled w/≥8 videos not yet embedded: ${todo.length}  (already embedded: ${already.size})`);
  if (!COMMIT) { console.log('DRY RUN — re-run with --commit to embed (~$0.50 for the full corpus).'); db.close(); return; }

  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < todo.length; i += 256) {
    const chunk = todo.slice(i, i + 256);
    await embedChannels(db, chunk);   // batches internally (64/call), caches each
    done += chunk.length;
    console.log(`  ${done}/${todo.length}  (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  console.log(`DONE — embedded ${done} channels in ${Math.round((Date.now() - t0) / 1000)}s`);
  db.close();
})();
