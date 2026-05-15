'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

// Corrected handles for the 9 that failed in addTeluguSeedsRetry.js
const FINAL_SEEDS = [
  { handle: '@ETVWin',              niche_hint: 'entertainment', note: 'ETV Telugu — rebranded to ETV Win' },
  { handle: '@GeminiTV',            niche_hint: 'entertainment', note: 'Gemini TV — without Official suffix' },
  { handle: '@AdhireAbhi',          niche_hint: 'comedy',        note: 'Adhire Abhi — without Official suffix' },
  { handle: '@MahaaTv',             niche_hint: 'news',          note: 'Mahaa News/TV Telugu' },
  { handle: '@SumanTvOfficial',     niche_hint: 'news',          note: 'Suman TV Telugu' },
  { handle: '@VivaHarshaComedy',    niche_hint: 'comedy',        note: 'Viva Harsha comedy' },
  { handle: '@BusinessTelugu',      niche_hint: 'business',      note: 'Business Telugu — without Official suffix' },
  { handle: '@TechMaheshTelugu',    niche_hint: 'technology',    note: 'Tech Mahesh — alternate handle' },
  { handle: '@GroupsExamsTelugu',   niche_hint: 'education',     note: 'Groups Exams Telugu prep' },
];

async function main() {
  const db = getDb();
  const results  = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addTeluguSeedsFinal] Trying ${FINAL_SEEDS.length} corrected handles...\n`);

  for (const seed of FINAL_SEEDS) {
    try {
      const resolved  = await resolveSeedChannel(seed.handle);
      const channelId = resolved.channel_id;

      db.run(
        `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
         VALUES (?, 'te', ?, 'curated', datetime('now'))`,
        [channelId, seed.niche_hint],
      );

      console.log(`  ✓ ${seed.handle.padEnd(26)} → ${channelId}  [${seed.niche_hint}] — ${seed.note}`);
      results.added++;
    } catch (e) {
      console.warn(`  ✗ ${seed.handle.padEnd(26)} FAILED: ${e.message}`);
      failures.push(seed.handle);
      results.failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[addTeluguSeedsFinal] Done — added: ${results.added}  failed: ${results.failed}`);
  if (failures.length) {
    console.log('\n  Still wrong (need manual YouTube lookup):');
    failures.forEach(h => console.log('    ' + h));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'te'")?.n ?? 0;
  console.log(`\nTotal Telugu seeds in DB: ${total}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
