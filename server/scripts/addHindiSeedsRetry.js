'use strict';

// Retry script for the 5 failed handles from addHindiSeeds.js
// @VivekBindra is already covered by @DrVivekBindra (succeeded)
// @NeerajAroraTruth was speculative — dropped

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

const RETRY_SEEDS = [
  { handle: '@RachanaPhadkeRanade', niche_hint: 'finance',    note: 'Stock market education in Hindi' },
  { handle: '@TechBurner',          niche_hint: 'technology', note: 'Tech unboxing & reviews' },
  { handle: '@StudyIQ',             niche_hint: 'education',  note: 'UPSC & competitive exam prep' },
];

async function main() {
  const db = getDb();
  console.log('\n[retry] Resolving failed handles...\n');

  for (const seed of RETRY_SEEDS) {
    try {
      const resolved = await resolveSeedChannel(seed.handle);
      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'hi', ?, 'curated', datetime('now'))`,
        [resolved.channel_id, seed.niche_hint],
      );
      console.log(`  ✓ ${seed.handle.padEnd(28)} → ${resolved.channel_id}  [${seed.niche_hint}]`);
    } catch (e) {
      console.warn(`  ✗ ${seed.handle.padEnd(28)} FAILED: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'hi'")?.n ?? 0;
  console.log(`\nTotal Hindi seeds in DB: ${total}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
