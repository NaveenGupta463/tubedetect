'use strict';

/**
 * Session 3B — Add Telugu discovery seeds
 *
 * Resolves each handle via YouTube API, then inserts into discovery_seeds
 * with language_code='te'. Safe to re-run — INSERT OR IGNORE skips duplicates.
 *
 * Run with:
 *   node server/scripts/addTeluguSeeds.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

const TELUGU_SEEDS = [
  // ── News / Current Affairs ────────────────────────────────────────────────
  { handle: '@TV9Telugu',              niche_hint: 'news',          note: 'TV9 Telugu — largest Telugu news, 10M+ subs' },
  { handle: '@TV5News',                niche_hint: 'news',          note: 'TV5 News Telugu' },
  { handle: '@NTVTelugu',              niche_hint: 'news',          note: 'NTV Telugu news' },
  { handle: '@ABNAndhraJyothy',        niche_hint: 'news',          note: 'ABN Telugu — Andhra Jyothy news group' },
  { handle: '@SakshiTV',              niche_hint: 'news',          note: 'Sakshi TV — Telugu news & current affairs' },
  { handle: '@10TVNewsTelugu',         niche_hint: 'news',          note: '10TV Telugu news' },

  // ── Entertainment ─────────────────────────────────────────────────────────
  { handle: '@StarMaa',                niche_hint: 'entertainment', note: 'Star Maa — largest Telugu GEC' },
  { handle: '@GeminiTV',               niche_hint: 'entertainment', note: 'Gemini TV — Telugu entertainment & serials' },
  { handle: '@ZeeTelugu',              niche_hint: 'entertainment', note: 'Zee Telugu — Telugu GEC' },
  { handle: '@ETVTelugu',              niche_hint: 'entertainment', note: 'ETV Telugu — entertainment & serials' },
  { handle: '@TeluguFilmNagar',        niche_hint: 'entertainment', note: 'Telugu Film Nagar — Telugu cinema news' },

  // ── Comedy ────────────────────────────────────────────────────────────────
  { handle: '@AdhireAbhi',             niche_hint: 'comedy',        note: 'Adhire Abhi — Telugu comedy, 7M+ subs' },
  { handle: '@VivaHarsha',             niche_hint: 'comedy',        note: 'Viva Harsha — Telugu comedy & entertainment' },

  // ── Food / Cooking ────────────────────────────────────────────────────────
  { handle: '@VismaiFood',             niche_hint: 'food',          note: 'Vismai Food — popular Telugu cooking channel' },
  { handle: '@HyderabadiRuchulu',      niche_hint: 'food',          note: 'Hyderabadi Ruchulu — Hyderabadi Telugu recipes' },
  { handle: '@TeluguKitchen',          niche_hint: 'food',          note: 'Telugu Kitchen — home cooking in Telugu' },

  // ── Technology ────────────────────────────────────────────────────────────
  { handle: '@TeluguTechTuts',         niche_hint: 'technology',    note: 'Telugu Tech Tuts — tech tutorials in Telugu' },
  { handle: '@TechMahesh',             niche_hint: 'technology',    note: 'Tech Mahesh — Telugu tech tips & tricks' },

  // ── Finance ───────────────────────────────────────────────────────────────
  { handle: '@ShareMarketTelugu',      niche_hint: 'finance',       note: 'Share Market Telugu — stock market in Telugu' },
  { handle: '@StockMarketTelugu',      niche_hint: 'finance',       note: 'Stock Market Telugu — investing in Telugu' },
  { handle: '@TeluguMoney',            niche_hint: 'finance',       note: 'Telugu Money — personal finance in Telugu' },

  // ── Education ─────────────────────────────────────────────────────────────
  { handle: '@TeluguAcademy',          niche_hint: 'education',     note: 'Telugu Academy — competitive exam prep' },
  { handle: '@GROUPSExamsTelugu',      niche_hint: 'education',     note: 'Groups exam prep in Telugu' },

  // ── Business / Motivation ─────────────────────────────────────────────────
  { handle: '@TeluguMotivation',       niche_hint: 'lifestyle',     note: 'Telugu Motivation — self-improvement in Telugu' },
  { handle: '@BusinessTeluguOfficial', niche_hint: 'business',      note: 'Business tips in Telugu' },
];

async function main() {
  const db = getDb();

  const results  = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addTeluguSeeds] Resolving ${TELUGU_SEEDS.length} channels via YouTube API...\n`);

  for (const seed of TELUGU_SEEDS) {
    try {
      const resolved  = await resolveSeedChannel(seed.handle);
      const channelId = resolved.channel_id;

      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'te', ?, 'curated', datetime('now'))`,
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

  console.log(`\n[addTeluguSeeds] Done.`);
  console.log(`  Added:   ${results.added}`);
  console.log(`  Skipped: ${results.skipped} (already existed)`);
  console.log(`  Failed:  ${results.failed}`);

  if (failures.length) {
    console.log('\nFailed handles (correct in addTeluguSeedsRetry.js):');
    failures.forEach(f => console.log(`  ${f.handle} — ${f.error}`));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'te'")?.n ?? 0;
  console.log(`\nTotal Telugu seeds in DB: ${total}\n`);
}

main().catch(e => {
  console.error('[addTeluguSeeds] Fatal:', e.message);
  process.exit(1);
});
