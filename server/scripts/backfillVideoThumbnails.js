'use strict';

// Backfill thumbnail_url for the ~12,240 corpus_videos rows that have none.
// Fetches in batches of 50 (1 quota unit each = ~245 units total).
// Run with:  node server/scripts/backfillVideoThumbnails.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb } = require('../db/init');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function ytFetch(videoIds) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const qs  = new URLSearchParams({ part: 'snippet', id: videoIds.join(','), key }).toString();
    const res = await fetch(`${YT_BASE}/videos?${qs}`);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `YouTube ${res.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    return data.items ?? [];
  }
  throw new Error('all_api_keys_exhausted');
}

async function main() {
  const db = getDb();

  const missing = db.all(
    `SELECT video_id FROM corpus_videos WHERE thumbnail_url IS NULL ORDER BY video_id`,
  );

  console.log(`\n[thumbnailBackfill] ${missing.length} videos need thumbnails. Fetching in batches of 50...\n`);

  let updated = 0, notFound = 0, errors = 0;
  const ids = missing.map(r => r.video_id);

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);

    try {
      const items = await ytFetch(batch);

      db.exec('BEGIN TRANSACTION');
      try {
        for (const item of items) {
          const thumb = item.snippet?.thumbnails?.maxres?.url
            ?? item.snippet?.thumbnails?.high?.url
            ?? item.snippet?.thumbnails?.default?.url
            ?? null;

          if (thumb) {
            db.run(
              `UPDATE corpus_videos SET thumbnail_url = ? WHERE video_id = ?`,
              [thumb, item.id],
            );
            updated++;
          } else {
            notFound++;
          }
        }
        // Videos in the batch not returned by API (deleted/private)
        notFound += batch.length - items.length;
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      const done = Math.min(i + 50, ids.length);
      process.stdout.write(`\r  ${done}/${ids.length} processed — updated: ${updated}  not found: ${notFound}`);

      if (i + 50 < ids.length) await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      errors++;
      console.warn(`\n  Batch error at offset ${i}: ${e.message}`);
      if (e.message === 'all_api_keys_exhausted') break;
    }
  }

  const stillMissing = db.get(`SELECT COUNT(*) AS n FROM corpus_videos WHERE thumbnail_url IS NULL`).n;

  console.log(`\n\n[thumbnailBackfill] Done`);
  console.log(`  Updated:      ${updated}`);
  console.log(`  Not on YT:    ${notFound}  (deleted/private videos)`);
  console.log(`  Errors:       ${errors}`);
  console.log(`  Still missing: ${stillMissing}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
