'use strict';

// Phase 2 territory backfill.
// Local DB only. No YouTube API calls.
//
// Usage:
//   node server/scripts/backfillTerritories.js
//   node server/scripts/backfillTerritories.js --limit-channels 500
//   node server/scripts/backfillTerritories.js --channel UC...
//   node server/scripts/backfillTerritories.js --reset

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { classifyAndStoreChannelVideos, ensureTerritoryTables } = require('../services/territoryProfiles');

class DirectDb {
  constructor(dbPath) {
    this._db = new BetterSqlite3(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('busy_timeout = 60000');
  }
  all(sql, params = []) { return this._db.prepare(sql).all(params); }
  get(sql, params = []) { return this._db.prepare(sql).get(params); }
  run(sql, params = []) { return this._db.prepare(sql).run(params); }
  exec(sql) { return this._db.exec(sql); }
  transaction(fn) { return this._db.transaction(fn); }
  close() { this._db.close(); }
}

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function main() {
  const db = new DirectDb(path.resolve(__dirname, '../data/scoring.db'));
  ensureTerritoryTables(db);
  const reset = hasFlag('--reset');
  const channelId = argValue('--channel');
  const limitChannels = Number(argValue('--limit-channels', 0)) || 0;
  const limitVideosPerChannel = Number(argValue('--limit-videos-per-channel', 0)) || null;

  if (reset) {
    console.log('[territory-backfill] Resetting territory tables...');
    db.exec('DELETE FROM channel_territory_profiles; DELETE FROM video_territories;');
  }

  const channels = channelId
    ? [{ channel_id: channelId }]
    : db.all(
      `SELECT iv.channel_id, COUNT(*) AS video_count
         FROM ingested_videos iv
         JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
        WHERE iv.title IS NOT NULL AND iv.title != ''
          AND ic.ingest_enabled = 1
        GROUP BY iv.channel_id
        ORDER BY video_count DESC
        ${limitChannels > 0 ? `LIMIT ${limitChannels}` : ''}`,
    );

  console.log(`[territory-backfill] Channels: ${channels.length.toLocaleString()}`);
  const started = Date.now();
  let totalVideos = 0;
  let totalAssignments = 0;
  let totalProfiles = 0;
  let errors = 0;

  const tx = db.transaction((batch) => {
    for (const ch of batch) {
      const res = classifyAndStoreChannelVideos(db, ch.channel_id, { limit: limitVideosPerChannel });
      totalVideos += res.videos;
      totalAssignments += res.assignments;
      totalProfiles += res.profiles;
    }
  });

  const BATCH = 50;
  for (let i = 0; i < channels.length; i += BATCH) {
    const batch = channels.slice(i, i + BATCH);
    try {
      tx(batch);
    } catch (e) {
      errors++;
      console.warn(`[territory-backfill] Batch ${i}-${i + batch.length} failed: ${e.message}`);
      for (const ch of batch) {
        try {
          const res = classifyAndStoreChannelVideos(db, ch.channel_id, { limit: limitVideosPerChannel });
          totalVideos += res.videos;
          totalAssignments += res.assignments;
          totalProfiles += res.profiles;
        } catch (inner) {
          errors++;
          console.warn(`[territory-backfill] Channel ${ch.channel_id} failed: ${inner.message}`);
        }
      }
    }

    const done = Math.min(i + BATCH, channels.length);
    if (done % 500 === 0 || done === channels.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[territory-backfill] ${done}/${channels.length} channels | ` +
        `${totalVideos.toLocaleString()} videos | ${totalAssignments.toLocaleString()} assignments | ` +
        `${totalProfiles.toLocaleString()} profiles | ${elapsed}s`,
      );
    }
  }

  const videoRows = db.get('SELECT COUNT(*) AS n FROM video_territories')?.n ?? 0;
  const profileRows = db.get('SELECT COUNT(*) AS n FROM channel_territory_profiles')?.n ?? 0;
  console.log('\n[territory-backfill] Done');
  console.log(`  processed_channels : ${channels.length}`);
  console.log(`  processed_videos   : ${totalVideos}`);
  console.log(`  assignments_written: ${totalAssignments}`);
  console.log(`  profiles_written   : ${totalProfiles}`);
  console.log(`  table_video_rows   : ${videoRows}`);
  console.log(`  table_profile_rows : ${profileRows}`);
  console.log(`  errors             : ${errors}`);
  db.close();
}

try {
  main();
} catch (e) {
  console.error('[territory-backfill] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}
