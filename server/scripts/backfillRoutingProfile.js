'use strict';

// Backfills routing_profile, routing_profile_confidence, routing_profile_version,
// and routing_profile_debug for every channel with ≥10 ingested videos.
//
// Usage:
//   node server/scripts/backfillRoutingProfile.js              # process stale only
//   node server/scripts/backfillRoutingProfile.js --dry-run    # preview, no writes
//   node server/scripts/backfillRoutingProfile.js --force      # recompute all (e.g. after rule change)

const { getDb } = require('../db/init');
const { computeRoutingProfile, ROUTING_PROFILE_VERSION } = require('../lib/routingProfiles');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

async function main() {
  const db = getDb();

  const channels = db.all(`
    SELECT c.channel_id, c.channel_name, c.creator_mode, c.primary_niche, c.niche,
           c.routing_profile, c.routing_profile_version
    FROM ingested_channels c
    WHERE c.ingest_enabled = 1
      AND (
        SELECT COUNT(*) FROM ingested_videos v WHERE v.channel_id = c.channel_id
      ) >= 10
    ORDER BY c.channel_subscribers DESC
  `);

  console.log(`[backfill] ${channels.length} channels eligible  (dry-run=${DRY_RUN}  force=${FORCE}  target_version=${ROUTING_PROFILE_VERSION})`);

  let updated   = 0;
  let skipped   = 0;
  let noProfile = 0;
  const profileCounts = {};
  const distribution  = {};

  function tally(ch, profile) {
    const pKey   = profile || '_none';
    const distKey = `${ch.creator_mode || 'unknown'}__${ch.primary_niche || ch.niche || 'unknown'}`;
    profileCounts[pKey] = (profileCounts[pKey] || 0) + 1;
    if (!distribution[distKey]) distribution[distKey] = {};
    distribution[distKey][pKey] = (distribution[distKey][pKey] || 0) + 1;
    if (!profile) noProfile++;
  }

  for (const ch of channels) {
    const isCurrentVersion = (ch.routing_profile_version || 0) >= ROUTING_PROFILE_VERSION;

    if (isCurrentVersion && !FORCE) {
      // Already up-to-date: include in distribution using stored value so dry-run
      // shows the full picture, not just the delta.
      tally(ch, ch.routing_profile);
      skipped++;
      continue;
    }

    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL
       ORDER BY published_at DESC LIMIT 60`,
      [ch.channel_id],
    ).map(r => r.title);

    const result = computeRoutingProfile(titles);

    if (!DRY_RUN) {
      db.run(
        `UPDATE ingested_channels
         SET routing_profile            = ?,
             routing_profile_confidence = ?,
             routing_profile_version    = ?,
             routing_profile_debug      = ?
         WHERE channel_id = ?`,
        [
          result.profile,
          result.confidence,
          ROUTING_PROFILE_VERSION,
          JSON.stringify({ positive_hits: result.positive_hits, negative_hits: result.negative_hits, titles_checked: titles.length }),
          ch.channel_id,
        ],
      );
    }

    tally(ch, result.profile);
    updated++;
    if (updated % 500 === 0) console.log(`  [backfill] processed ${updated}…`);
  }

  console.log('\n=== Profile distribution (all eligible channels) ===');
  const sorted = Object.entries(profileCounts).sort((a, b) => b[1] - a[1]);
  for (const [p, n] of sorted) console.log(`  ${p.padEnd(30)} ${n}`);

  console.log('\n=== By creator_mode × primary_niche (top 3 profiles each) ===');
  for (const [key, counts] of Object.entries(distribution)) {
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([p, n]) => `${p}:${n}`).join('  ');
    console.log(`  ${key.padEnd(50)} ${top}`);
  }

  console.log(`\n[backfill] done — updated=${updated}  skipped=${skipped}  no_profile=${noProfile}`);
  if (DRY_RUN) console.log('[backfill] DRY RUN — no writes made');
}

main().catch(err => { console.error(err); process.exit(1); });
