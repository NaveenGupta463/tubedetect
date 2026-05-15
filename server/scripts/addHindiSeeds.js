'use strict';

/**
 * Session 1F — Add Hindi discovery seeds
 *
 * Resolves each handle via YouTube API, then inserts into discovery_seeds
 * with language_code='hi'. Safe to re-run — INSERT OR IGNORE skips duplicates.
 *
 * Run with:
 *   node server/scripts/addHindiSeeds.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }             = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

// ── Curated Hindi seed channels ───────────────────────────────────────────────
// Format: { handle, niche_hint, note }
// Handles are resolved to UC channel IDs via YouTube API at runtime.

const HINDI_SEEDS = [
  // ── Finance ──────────────────────────────────────────────────────────────────
  { handle: '@PranjalKamra',         niche_hint: 'finance',    note: 'Personal finance & stock market' },
  { handle: '@CARachanaPhadkeRanade',niche_hint: 'finance',    note: 'Stock market education in Hindi' },
  { handle: '@LabourLawAdvisor',     niche_hint: 'finance',    note: 'Taxation, salary & compliance' },
  { handle: '@FinancewithSharan',    niche_hint: 'finance',    note: 'Personal finance, FIRE movement' },
  { handle: '@warikoo',              niche_hint: 'business',   note: 'Entrepreneurship & money (Hinglish)' },
  { handle: '@NeerajAroraTruth',     niche_hint: 'finance',    note: 'Stock market & mutual funds' },
  { handle: '@InvestmentDost',       niche_hint: 'finance',    note: 'Investing basics in Hindi' },

  // ── Technology ───────────────────────────────────────────────────────────────
  { handle: '@TechnicalGuruji',      niche_hint: 'technology', note: 'Gadget reviews in Hindi — 23M+ subs' },
  { handle: '@GeekyRanjit',          niche_hint: 'technology', note: 'Smartphone & laptop reviews' },
  { handle: '@TechnicalDost',        niche_hint: 'technology', note: 'Tech tips & tricks in Hindi' },
  { handle: '@KyaKaise',             niche_hint: 'technology', note: 'How-to technology in Hindi' },
  { handle: '@TechBurnerr',          niche_hint: 'technology', note: 'Tech unboxing & reviews' },
  { handle: '@iGyaan',               niche_hint: 'technology', note: 'Tech & gadgets — pioneer Hindi tech channel' },
  { handle: '@TechnoRuhez',          niche_hint: 'technology', note: 'Hindi tech reviews & tips' },

  // ── Education ────────────────────────────────────────────────────────────────
  { handle: '@PhysicsWallah',        niche_hint: 'education',  note: 'Science education — one of India\'s largest channels' },
  { handle: '@dhruvrathee',          niche_hint: 'politics',   note: 'Science, politics & current affairs — 25M+ subs' },
  { handle: '@SandeepMaheshwari',    niche_hint: 'education',  note: 'Life advice & motivation — 30M+ subs' },
  { handle: '@KhanGSSir',            niche_hint: 'education',  note: 'GK & current affairs — massive Hindi audience' },
  { handle: '@AmanDhattarwal',       niche_hint: 'education',  note: 'Academic education & study tips' },
  { handle: '@StudyIQEducation',     niche_hint: 'education',  note: 'UPSC & competitive exam prep' },
  { handle: '@unacademy',            niche_hint: 'education',  note: 'Largest online education platform in India' },

  // ── Business / Entrepreneurship ───────────────────────────────────────────────
  { handle: '@VivekBindra',          niche_hint: 'business',   note: 'Business motivation & strategy — 22M+ subs' },
  { handle: '@DrVivekBindra',        niche_hint: 'business',   note: 'BMS channel — business management' },
  { handle: '@PushkarRajThakur',     niche_hint: 'business',   note: 'Direct sales & business growth' },
  { handle: '@SharkTankIndia',       niche_hint: 'business',   note: 'Startup ecosystem — Hindi audience' },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();

  const results = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addHindiSeeds] Resolving ${HINDI_SEEDS.length} channels via YouTube API...\n`);

  for (const seed of HINDI_SEEDS) {
    try {
      const resolved = await resolveSeedChannel(seed.handle);
      const channelId = resolved.channel_id;

      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'hi', ?, 'curated', datetime('now'))`,
        [channelId, seed.niche_hint],
      );

      const wasInserted = db.get(
        'SELECT added_at FROM discovery_seeds WHERE channel_id = ?', [channelId],
      );

      if (resolved.resolved_via === 'api') {
        console.log(`  ✓ ${seed.handle.padEnd(30)} → ${channelId}  [${seed.niche_hint}]`);
        results.added++;
      } else {
        console.log(`  ~ ${seed.handle.padEnd(30)} already in seeds [${seed.niche_hint}]`);
        results.skipped++;
      }
    } catch (e) {
      console.warn(`  ✗ ${seed.handle.padEnd(30)} FAILED: ${e.message}`);
      failures.push({ handle: seed.handle, error: e.message });
      results.failed++;
    }

    // Small delay to avoid hitting API rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[addHindiSeeds] Done.`);
  console.log(`  Added:   ${results.added}`);
  console.log(`  Skipped: ${results.skipped} (already existed)`);
  console.log(`  Failed:  ${results.failed}`);

  if (failures.length) {
    console.log('\nFailed channels (check handles manually on YouTube):');
    failures.forEach(f => console.log(`  ${f.handle} — ${f.error}`));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'hi'")?.n ?? 0;
  console.log(`\nTotal Hindi seeds in DB: ${total}`);
}

main().catch(e => {
  console.error('[addHindiSeeds] Fatal:', e.message);
  process.exit(1);
});
