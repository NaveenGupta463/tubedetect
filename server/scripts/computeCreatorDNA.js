'use strict';

// Session 3C — Compute Creator DNA for all corpus_channels that have video data.
// Stores result in corpus_channels.dna_features (JSON) and logs a dna_computed
// event to channel_events.
//
// Run with:  node server/scripts/computeCreatorDNA.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }          = require('../db/init');
const { computeCreatorDNA } = require('../services/creatorDNA');

async function main() {
  const db = getDb();

  // Load all corpus channels
  const channels = db.all(`
    SELECT channel_id, title, subscriber_count, video_count,
           language, language_profile, niche
    FROM corpus_channels
    ORDER BY subscriber_count DESC
  `);

  console.log(`\n[creatorDNA] Processing ${channels.length} channels...\n`);

  let computed = 0, skipped = 0, noVideos = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const ch of channels) {
      const videos = db.all(
        `SELECT title, published_at, views, likes
         FROM corpus_videos
         WHERE channel_id = ?
         ORDER BY published_at DESC`,
        [ch.channel_id],
      );

      if (!videos.length) {
        noVideos++;
        continue;
      }

      const dna  = computeCreatorDNA(ch, videos);
      const json = JSON.stringify(dna);

      db.run(
        `UPDATE corpus_channels SET dna_features = ?, updated_at = datetime('now') WHERE channel_id = ?`,
        [json, ch.channel_id],
      );
      db.run(
        `INSERT INTO channel_events (channel_id, event_type, event_data, recorded_at)
         VALUES (?, 'dna_computed', ?, datetime('now'))`,
        [ch.channel_id, json],
      );
      computed++;

      if (computed % 100 === 0) {
        console.log(`  [${computed}/${channels.length}] processed...`);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // Summary by size tier
  const tierCounts = db.all(`
    SELECT
      json_extract(dna_features, '$.size_tier') AS tier,
      COUNT(*) AS n
    FROM corpus_channels
    WHERE dna_features IS NOT NULL
    GROUP BY tier
    ORDER BY n DESC
  `);

  // Summary by upload cadence
  const cadenceCounts = db.all(`
    SELECT
      json_extract(dna_features, '$.upload_cadence') AS cadence,
      COUNT(*) AS n
    FROM corpus_channels
    WHERE dna_features IS NOT NULL
    GROUP BY cadence
    ORDER BY n DESC
  `);

  // Summary by language
  const langCounts = db.all(`
    SELECT
      json_extract(dna_features, '$.primary_language') AS lang,
      COUNT(*) AS n
    FROM corpus_channels
    WHERE dna_features IS NOT NULL
    GROUP BY lang
    ORDER BY n DESC
  `);

  console.log(`\n[creatorDNA] Done — computed: ${computed}  skipped (no videos): ${noVideos}  total: ${channels.length}`);

  console.log('\n  Size tier breakdown:');
  for (const { tier, n } of tierCounts) console.log(`    ${(tier ?? 'unknown').padEnd(10)} ${n}`);

  console.log('\n  Upload cadence breakdown:');
  for (const { cadence, n } of cadenceCounts) console.log(`    ${(cadence ?? 'unknown').padEnd(18)} ${n}`);

  console.log('\n  Language breakdown:');
  for (const { lang, n } of langCounts) console.log(`    ${(lang ?? '?').padEnd(6)} ${n}`);

  console.log('');
}

main().catch(e => { console.error(e.message); process.exit(1); });
