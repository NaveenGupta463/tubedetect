'use strict';

// Full creator DNA backfill runner in fixed-size batches.
//
// Usage:
//   node server/scripts/runCreatorDnaBackfillBatches.js --batch-size 5000
//   node server/scripts/runCreatorDnaBackfillBatches.js --batch-size 5000 --max-batches 2

const { getDb } = require('../db/init');
const {
  CREATOR_IDEA_DNA_VERSION,
  DEFAULT_VIDEO_LIMIT,
  persistCreatorIdeaDna,
} = require('../services/creatorIdeaDna');

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function countCoverage(db) {
  const eligible = db.get(
    `SELECT COUNT(*) AS n
       FROM ingested_channels ic
      WHERE ic.ingest_enabled = 1
        AND ic.channel_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ingested_videos iv
           WHERE iv.channel_id = ic.channel_id
             AND iv.title IS NOT NULL
             AND iv.title != ''
        )`,
  ).n;

  const withDna = db.get(
    `SELECT COUNT(*) AS n
       FROM ingested_channels ic
       JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND ic.channel_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ingested_videos iv
           WHERE iv.channel_id = ic.channel_id
             AND iv.title IS NOT NULL
             AND iv.title != ''
        )`,
  ).n;

  return {
    eligible,
    with_dna: withDna,
    missing: Math.max(0, eligible - withDna),
    coverage_pct: +((withDna / Math.max(eligible, 1)) * 100).toFixed(2),
  };
}

function selectBatch(db, limit) {
  return db.all(
    `SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers,
            COUNT(iv.youtube_video_id) AS video_count
       FROM ingested_channels ic
       JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
       LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND iv.title IS NOT NULL
        AND iv.title != ''
        AND (
          cid.channel_id IS NULL
          OR cid.source_version < ?
        )
      GROUP BY ic.channel_id
      ORDER BY ic.channel_subscribers DESC, video_count DESC
      LIMIT ?`,
    [CREATOR_IDEA_DNA_VERSION, limit],
  );
}

function main() {
  const db = getDb();
  const batchSize = toInt(argValue('--batch-size'), 5000);
  const maxBatches = toInt(argValue('--max-batches'), 999);
  const videoLimit = toInt(argValue('--video-limit'), DEFAULT_VIDEO_LIMIT);
  const progressEvery = toInt(argValue('--progress-every'), 100);
  const startedAt = Date.now();

  console.log('[creator-dna-full-backfill] starting', {
    batchSize,
    maxBatches,
    videoLimit,
    version: CREATOR_IDEA_DNA_VERSION,
  });
  console.log('[creator-dna-full-backfill] initial coverage', countCoverage(db));

  let totalOk = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let batchNo = 1; batchNo <= maxBatches; batchNo++) {
    const targets = selectBatch(db, batchSize);
    if (!targets.length) {
      console.log('[creator-dna-full-backfill] no remaining targets');
      break;
    }

    console.log(`[creator-dna-full-backfill] batch ${batchNo} targets=${targets.length}`);
    let ok = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      try {
        const result = persistCreatorIdeaDna(db, target.channel_id, {
          limit: videoLimit,
          snapshotReason: 'manual_full_backfill',
        });
        if (result.ok) ok++;
        else skipped++;
      } catch (e) {
        failed++;
        if (failed <= 10) {
          console.warn(`[creator-dna-full-backfill] fail ${target.channel_name || target.channel_id}: ${e.message}`);
        }
      }

      const done = i + 1;
      if (done % progressEvery === 0 || done === targets.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[creator-dna-full-backfill] batch=${batchNo} progress=${done}/${targets.length} ok=${ok} skipped=${skipped} failed=${failed} elapsed=${elapsed}s`);
      }
    }

    totalOk += ok;
    totalSkipped += skipped;
    totalFailed += failed;
    console.log(`[creator-dna-full-backfill] batch ${batchNo} done ok=${ok} skipped=${skipped} failed=${failed}`);
    console.log('[creator-dna-full-backfill] coverage', countCoverage(db));
  }

  const durationSec = +((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('[creator-dna-full-backfill] finished', {
    totalOk,
    totalSkipped,
    totalFailed,
    durationSec,
    finalCoverage: countCoverage(db),
  });
}

try {
  main();
} catch (e) {
  console.error('[creator-dna-full-backfill] fatal:', e.stack || e.message);
  process.exitCode = 1;
}
