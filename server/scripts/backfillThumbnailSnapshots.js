'use strict';

// Session 3D — Backfill thumbnail_url into existing title_snapshot events.
// corpus_videos already has thumbnail_url stored. This script reads each
// title_snapshot from channel_events, looks up the thumbnail for each
// video_id in corpus_videos, and rewrites the event_data with thumbnails added.
//
// Run with:  node server/scripts/backfillThumbnailSnapshots.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb } = require('../db/init');

async function main() {
  const db = getDb();

  const snapshots = db.all(
    `SELECT id, channel_id, event_data FROM channel_events WHERE event_type = 'title_snapshot'`,
  );

  console.log(`\n[thumbnailBackfill] Found ${snapshots.length} title_snapshot events to backfill...\n`);

  let updated = 0, alreadyDone = 0, noVideos = 0;

  db.exec('BEGIN TRANSACTION');
  try {
    for (const snap of snapshots) {
      let data;
      try { data = JSON.parse(snap.event_data); } catch { continue; }

      const videos = data.videos ?? [];
      if (!videos.length) { noVideos++; continue; }

      // Check if first item already has thumbnail_url
      if (videos[0]?.thumbnail_url !== undefined) { alreadyDone++; continue; }

      // Look up thumbnail for each video_id in corpus_videos
      const enriched = videos.map(v => {
        const row = db.get(
          `SELECT thumbnail_url FROM corpus_videos WHERE video_id = ?`,
          [v.video_id],
        );
        return { ...v, thumbnail_url: row?.thumbnail_url ?? null };
      });

      db.run(
        `UPDATE channel_events SET event_data = ? WHERE id = ?`,
        [JSON.stringify({ ...data, videos: enriched }), snap.id],
      );
      updated++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log(`[thumbnailBackfill] Done — updated: ${updated}  already had thumbnails: ${alreadyDone}  empty snapshots: ${noVideos}`);

  // Verify a sample
  const sample = db.get(
    `SELECT event_data FROM channel_events WHERE event_type = 'title_snapshot' LIMIT 1`,
  );
  if (sample) {
    try {
      const d = JSON.parse(sample.event_data);
      const firstVideo = d.videos?.[0];
      console.log(`\n  Sample first video in snapshot:`);
      console.log(`    title:         ${firstVideo?.title?.slice(0, 60)}`);
      console.log(`    thumbnail_url: ${firstVideo?.thumbnail_url ?? '(none)'}`);
    } catch {}
  }
  console.log('');
}

main().catch(e => { console.error(e.message); process.exit(1); });
