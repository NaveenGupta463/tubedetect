'use strict';

/**
 * Session 3A — Tamil seeds retry (corrected handles)
 *
 * Retries the 10 handles that failed in addTamilSeeds.js, plus adds
 * replacement channels for any that still can't be found.
 *
 * Run with:  node server/scripts/addTamilSeedsRetry.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

const RETRY_SEEDS = [
  // ── Corrected handles for failed channels ─────────────────────────────────
  { handle: '@PuthiyaThalaimuraiTV',   niche_hint: 'news',        note: 'Puthiya Thalaimurai — corrected handle' },
  { handle: '@NakkalBros',             niche_hint: 'comedy',      note: 'Nakkal Brothers comedy — alt handle' },
  { handle: '@VenkateshBhat',          niche_hint: 'food',        note: 'Chef Venkatesh Bhat — alt handle' },
  { handle: '@TamilTechOfficial',      niche_hint: 'technology',  note: 'Tamil Tech by Kishore — alt handle' },
  { handle: '@TekTamilanOfficial',     niche_hint: 'technology',  note: 'Tek Tamilan — alt handle' },
  { handle: '@TamilMoney',             niche_hint: 'finance',     note: 'Tamil Money — alt handle' },
  { handle: '@TNPSCGroup1Group2',      niche_hint: 'education',   note: 'TNPSC prep — alt handle' },
  { handle: '@SamacheerKalviTN',       niche_hint: 'education',   note: 'Samacheer Kalvi — alt handle' },

  // ── Replacement channels (high-confidence Tamil handles) ──────────────────
  { handle: '@GalattaTamil',           niche_hint: 'entertainment', note: 'Galatta — Tamil film news & entertainment' },
  { handle: '@Behindwoods',            niche_hint: 'entertainment', note: 'Behindwoods — Tamil cinema news' },
  { handle: '@5StarComedyTV',          niche_hint: 'comedy',       note: '5 Star Comedy — Tamil comedy channel' },
  { handle: '@TamilPadam',             niche_hint: 'comedy',       note: 'Tamil Padam — Tamil movie parody' },
  { handle: '@SivaKarthikeyanProductions', niche_hint: 'entertainment', note: 'SK Productions — Tamil films' },
  { handle: '@SathiyamTV',             niche_hint: 'news',         note: 'Sathiyam TV — Tamil news' },
  { handle: '@RajTVOfficial',          niche_hint: 'entertainment', note: 'Raj TV — Tamil GEC' },
  { handle: '@IASCoachingTamil',       niche_hint: 'education',    note: 'IAS coaching in Tamil medium' },
  { handle: '@MotivationTamil',        niche_hint: 'lifestyle',    note: 'Motivation & self-improvement in Tamil' },
  { handle: '@ThozhilTamilOfficial',   niche_hint: 'business',     note: 'Business & startup in Tamil' },
];

async function main() {
  const db = getDb();

  const results  = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addTamilSeedsRetry] Trying ${RETRY_SEEDS.length} handles...\n`);

  for (const seed of RETRY_SEEDS) {
    try {
      const resolved  = await resolveSeedChannel(seed.handle);
      const channelId = resolved.channel_id;

      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'ta', ?, 'curated', datetime('now'))`,
        [channelId, seed.niche_hint],
      );

      if (resolved.resolved_via === 'api') {
        console.log(`  ✓ ${seed.handle.padEnd(30)} → ${channelId}  [${seed.niche_hint}]`);
        results.added++;
      } else {
        console.log(`  ~ ${seed.handle.padEnd(30)} already in seeds`);
        results.skipped++;
      }
    } catch (e) {
      console.warn(`  ✗ ${seed.handle.padEnd(30)} FAILED: ${e.message}`);
      failures.push(seed.handle);
      results.failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[addTamilSeedsRetry] Done — added: ${results.added}  skipped: ${results.skipped}  failed: ${results.failed}`);
  if (failures.length) {
    console.log('\nStill failing (find correct handles by searching YouTube manually):');
    failures.forEach(h => console.log('  ' + h));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'ta'")?.n ?? 0;
  console.log(`\nTotal Tamil seeds in DB: ${total}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
