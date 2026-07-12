'use strict';

// Backfills format_profile, format_profile_confidence, format_profile_version,
// and format_profile_debug for every channel with ≥10 ingested videos.
//
// Usage:
//   node server/scripts/backfillFormatProfile.js              # process stale only
//   node server/scripts/backfillFormatProfile.js --dry-run    # preview, no writes
//   node server/scripts/backfillFormatProfile.js --force      # recompute all

const { getDb } = require('../db/init');
const { computeFormatProfile, FORMAT_PROFILE_VERSION } = require('../lib/formatProfile');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE   = process.argv.includes('--force');

async function main() {
  const db = getDb();

  const channels = db.all(`
    SELECT c.channel_id, c.channel_name, c.creator_mode, c.routing_profile,
           c.primary_niche, c.niche, c.format_type,
           c.format_profile, c.format_profile_version
    FROM ingested_channels c
    WHERE c.ingest_enabled = 1
      AND (
        SELECT COUNT(*) FROM ingested_videos v WHERE v.channel_id = c.channel_id
      ) >= 10
    ORDER BY c.channel_subscribers DESC
  `);

  console.log(`[backfill-fp] ${channels.length} channels eligible  (dry-run=${DRY_RUN}  force=${FORCE}  target_version=${FORMAT_PROFILE_VERSION})`);

  let updated   = 0;
  let skipped   = 0;
  let noProfile = 0;
  const profileCounts = {};

  function tally(profile) {
    const k = profile || '_none';
    profileCounts[k] = (profileCounts[k] || 0) + 1;
    if (!profile || profile === 'unknown') noProfile++;
  }

  for (const ch of channels) {
    const isCurrent = (ch.format_profile_version || 0) >= FORMAT_PROFILE_VERSION;

    if (isCurrent && !FORCE) {
      tally(ch.format_profile);
      skipped++;
      continue;
    }

    const titles = db.all(
      `SELECT title FROM ingested_videos
       WHERE channel_id = ? AND title IS NOT NULL
       ORDER BY published_at DESC LIMIT 60`,
      [ch.channel_id],
    ).map(r => r.title);

    const result = computeFormatProfile(titles, ch);

    if (!DRY_RUN) {
      db.run(
        `UPDATE ingested_channels
         SET format_profile=?, format_profile_confidence=?, format_profile_version=?,
             format_profile_debug=?
         WHERE channel_id=?`,
        [
          result.format_profile,
          result.confidence,
          FORMAT_PROFILE_VERSION,
          JSON.stringify(result.signals),
          ch.channel_id,
        ],
      );
    }

    tally(result.format_profile);
    updated++;
    if (updated % 500 === 0) console.log(`  [backfill-fp] processed ${updated}…`);
  }

  console.log('\n=== Format profile distribution (all eligible channels) ===');
  const sorted = Object.entries(profileCounts).sort((a, b) => b[1] - a[1]);
  for (const [p, n] of sorted) console.log(`  ${p.padEnd(30)} ${n}`);

  console.log(`\n[backfill-fp] done — updated=${updated}  skipped=${skipped}  no_profile_or_unknown=${noProfile}`);
  if (DRY_RUN) console.log('[backfill-fp] DRY RUN — no writes made');
}

main().catch(err => { console.error(err); process.exit(1); });
