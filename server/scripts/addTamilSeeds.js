'use strict';

/**
 * Session 3A — Add Tamil discovery seeds
 *
 * Resolves each handle via YouTube API, then inserts into discovery_seeds
 * with language_code='ta'. Safe to re-run — INSERT OR IGNORE skips duplicates.
 *
 * Run with:
 *   node server/scripts/addTamilSeeds.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

// ── Curated Tamil seed channels ───────────────────────────────────────────────
// Format: { handle, niche_hint, note }
// Handles resolved to UC channel IDs via YouTube API at runtime.

const TAMIL_SEEDS = [
  // ── News / Current Affairs ────────────────────────────────────────────────
  { handle: '@ThanthiTV',              niche_hint: 'news',        note: 'Thanthi TV — largest Tamil news channel, 10M+ subs' },
  { handle: '@PuthiyaThalaimurai',     niche_hint: 'news',        note: 'Puthiya Thalaimurai — Tamil news leader' },
  { handle: '@PolimerNews',            niche_hint: 'news',        note: 'Polimer News — Tamil news' },
  { handle: '@KalaignarTV',            niche_hint: 'news',        note: 'Kalaignar TV — political news in Tamil' },
  { handle: '@CapitanTV',              niche_hint: 'news',        note: 'Captain TV — Tamil news & current affairs' },

  // ── Entertainment ─────────────────────────────────────────────────────────
  { handle: '@VijayTelevision',        niche_hint: 'entertainment', note: 'Vijay TV — largest Tamil GEC, 40M+ subs' },
  { handle: '@SunTV',                  niche_hint: 'entertainment', note: 'Sun TV — Tamil entertainment & serials' },
  { handle: '@ZeeTamil',              niche_hint: 'entertainment', note: 'Zee Tamil — Tamil GEC' },

  // ── Comedy / Satire ───────────────────────────────────────────────────────
  { handle: '@PutChutney',             niche_hint: 'comedy',      note: 'Put Chutney — Tamil political satire, 3M+ subs' },
  { handle: '@NakkalBrothers',         niche_hint: 'comedy',      note: 'Nakkal Brothers — Tamil comedy sketches' },
  { handle: '@BlackSheepTamil',        niche_hint: 'entertainment', note: 'Black Sheep Tamil — short films & entertainment' },

  // ── Food / Cooking ────────────────────────────────────────────────────────
  { handle: '@ChefVenkateshBhat',      niche_hint: 'food',        note: 'Chef Venkatesh Bhat — authentic Tamil cooking' },
  { handle: '@KavithaKitchen',         niche_hint: 'food',        note: 'Kavitha Kitchen — Tamil home cooking' },
  { handle: '@MadrasCatering',         niche_hint: 'food',        note: 'Madras Catering — Tamil street food & recipes' },

  // ── Technology ────────────────────────────────────────────────────────────
  { handle: '@TamilTech',              niche_hint: 'technology',  note: 'Tamil Tech — technology reviews in Tamil' },
  { handle: '@TechnicalTamilan',       niche_hint: 'technology',  note: 'Technical Tamilan — Tamil tech tips & tricks' },
  { handle: '@TekTamilan',             niche_hint: 'technology',  note: 'Tek Tamilan — Tamil tech channel' },

  // ── Finance ───────────────────────────────────────────────────────────────
  { handle: '@TamilShareMarket',       niche_hint: 'finance',     note: 'Tamil Share Market — stock market in Tamil' },
  { handle: '@TamilMoneyManager',      niche_hint: 'finance',     note: 'Tamil Money Manager — personal finance in Tamil' },
  { handle: '@StockMarketTamil',       niche_hint: 'finance',     note: 'Stock market education in Tamil' },

  // ── Education ─────────────────────────────────────────────────────────────
  { handle: '@StudyIQTamil',           niche_hint: 'education',   note: 'StudyIQ Tamil — TNPSC & UPSC in Tamil' },
  { handle: '@TNPSCTamil',             niche_hint: 'education',   note: 'TNPSC exam preparation channel' },
  { handle: '@SamacheerKalvi',         niche_hint: 'education',   note: 'Samacheer Kalvi — school curriculum in Tamil' },

  // ── Business / Motivation ────────────────────────────────────────────────
  { handle: '@TamilMotivation',        niche_hint: 'lifestyle',   note: 'Tamil motivation & self-improvement' },
  { handle: '@ThozhilTips',            niche_hint: 'business',    note: 'Business tips & startup ideas in Tamil' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();

  const results  = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addTamilSeeds] Resolving ${TAMIL_SEEDS.length} channels via YouTube API...\n`);

  for (const seed of TAMIL_SEEDS) {
    try {
      const resolved  = await resolveSeedChannel(seed.handle);
      const channelId = resolved.channel_id;

      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'ta', ?, 'curated', datetime('now'))`,
        [channelId, seed.niche_hint],
      );

      if (resolved.resolved_via === 'api') {
        console.log(`  ✓ ${seed.handle.padEnd(28)} → ${channelId}  [${seed.niche_hint}]`);
        results.added++;
      } else {
        console.log(`  ~ ${seed.handle.padEnd(28)} already in seeds  [${seed.niche_hint}]`);
        results.skipped++;
      }
    } catch (e) {
      console.warn(`  ✗ ${seed.handle.padEnd(28)} FAILED: ${e.message}`);
      failures.push({ handle: seed.handle, error: e.message });
      results.failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[addTamilSeeds] Done.`);
  console.log(`  Added:   ${results.added}`);
  console.log(`  Skipped: ${results.skipped} (already existed)`);
  console.log(`  Failed:  ${results.failed}`);

  if (failures.length) {
    console.log('\nFailed handles (check on YouTube and correct in addTamilSeedsRetry.js):');
    failures.forEach(f => console.log(`  ${f.handle} — ${f.error}`));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'ta'")?.n ?? 0;
  console.log(`\nTotal Tamil seeds in DB: ${total}`);
  console.log('\nNext steps:');
  console.log('  1. Fix any failed handles → node server/scripts/addTamilSeedsRetry.js');
  console.log('  2. Ingest seed channels  → run the corpus scheduler cycle');
  console.log('  3. Run detection         → node server/scripts/runLanguageDetection.js\n');
}

main().catch(e => {
  console.error('[addTamilSeeds] Fatal:', e.message);
  process.exit(1);
});
