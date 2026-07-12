'use strict';

// Audits territory backfill quality on real stored channels.
// Usage:
//   node server/scripts/auditTerritories.js 300
//   node server/scripts/auditTerritories.js 50 --channel UC...

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { TERRITORY_CONFIG } = require('../services/territoryClassifier');

class DirectDb {
  constructor(dbPath) {
    this._db = new BetterSqlite3(dbPath, { readonly: true, timeout: 60000 });
  }
  all(sql, params = []) { return this._db.prepare(sql).all(params); }
  get(sql, params = []) { return this._db.prepare(sql).get(params); }
  close() { this._db.close(); }
}

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function fmt(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return 'n/a';
  return Number(n).toFixed(digits);
}

function main() {
  const db = new DirectDb(path.resolve(__dirname, '../data/scoring.db'));
  const sampleSize = Number(process.argv[2]) || 50;
  const channelId = argValue('--channel');

  const totals = {
    video_territories: db.get('SELECT COUNT(*) AS n FROM video_territories')?.n ?? 0,
    channel_profiles: db.get('SELECT COUNT(*) AS n FROM channel_territory_profiles')?.n ?? 0,
    profiled_channels: db.get('SELECT COUNT(DISTINCT channel_id) AS n FROM channel_territory_profiles')?.n ?? 0,
  };

  const roleRows = db.all(
    `SELECT role, COUNT(*) AS n
       FROM channel_territory_profiles
      GROUP BY role
      ORDER BY n DESC`,
  );

  const breadthRows = db.all(
    `SELECT bucket, COUNT(*) AS n FROM (
       SELECT channel_id,
              CASE
                WHEN SUM(CASE WHEN role IN ('core','accepted') AND COALESCE(view_lift, 0) >= 0.8 THEN 1 ELSE 0 END) >= 6 THEN 'broad_6_plus'
                WHEN SUM(CASE WHEN role IN ('core','accepted') AND COALESCE(view_lift, 0) >= 0.8 THEN 1 ELSE 0 END) >= 3 THEN 'medium_3_5'
                WHEN SUM(CASE WHEN role IN ('core','accepted') AND COALESCE(view_lift, 0) >= 0.8 THEN 1 ELSE 0 END) >= 1 THEN 'narrow_1_2'
                ELSE 'test_only'
              END AS bucket
         FROM channel_territory_profiles
        GROUP BY channel_id
      )
      GROUP BY bucket
      ORDER BY n DESC`,
  );

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  TERRITORY PROFILE AUDIT');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('Totals:');
  console.log(`  video_territories  : ${totals.video_territories.toLocaleString()}`);
  console.log(`  channel_profiles   : ${totals.channel_profiles.toLocaleString()}`);
  console.log(`  profiled_channels  : ${totals.profiled_channels.toLocaleString()}`);
  console.log('\nRoles:');
  for (const row of roleRows) console.log(`  ${row.role.padEnd(10)} ${row.n.toLocaleString()}`);
  console.log('\nBreadth:');
  for (const row of breadthRows) console.log(`  ${row.bucket.padEnd(14)} ${row.n.toLocaleString()}`);

  const channels = channelId
    ? db.all(`SELECT channel_id, channel_name, niche, channel_subscribers FROM ingested_channels WHERE channel_id = ?`, [channelId])
    : db.all(
      `SELECT ic.channel_id, ic.channel_name, ic.niche, ic.channel_subscribers
         FROM ingested_channels ic
        WHERE EXISTS (SELECT 1 FROM channel_territory_profiles ctp WHERE ctp.channel_id = ic.channel_id)
        ORDER BY RANDOM()
        LIMIT ?`,
      [sampleSize],
    );

  console.log('\nSamples:');
  for (const ch of channels) {
    const profiles = db.all(
      `SELECT *
         FROM channel_territory_profiles
        WHERE channel_id = ?
        ORDER BY CASE role WHEN 'core' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
                 COALESCE(view_lift, 0) DESC,
                 video_count DESC
        LIMIT 8`,
      [ch.channel_id],
    );
    console.log('\n──────────────────────────────────────────────────────────');
    console.log(`${ch.channel_name || ch.channel_id} | ${ch.niche || 'unknown'} | subs=${ch.channel_subscribers || 0}`);
    if (!profiles.length) {
      console.log('  no profiles');
      continue;
    }
    for (const p of profiles) {
      const label = TERRITORY_CONFIG[p.territory_id]?.label || p.territory_id;
      console.log(
        `  ${p.role.padEnd(8)} ${p.territory_id.padEnd(24)} ${label.padEnd(30)} ` +
        `videos=${String(p.video_count).padStart(3)} recent=${String(p.recent_video_count).padStart(2)} ` +
        `lift=${fmt(p.view_lift)} median=${Math.round(p.median_views || 0)}`,
      );
      let ids = [];
      try { ids = JSON.parse(p.evidence_video_ids || '[]'); } catch (_) {}
      if (ids.length) {
        const ph = ids.slice(0, 3).map(() => '?').join(',');
        const vids = db.all(
          `SELECT title, views FROM ingested_videos WHERE youtube_video_id IN (${ph}) ORDER BY views DESC`,
          ids.slice(0, 3),
        );
        for (const v of vids) console.log(`    - ${String(v.title || '').slice(0, 95)} (${v.views || 0})`);
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════════════\n');
  db.close();
}

try {
  main();
} catch (e) {
  console.error('[territory-audit] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}
