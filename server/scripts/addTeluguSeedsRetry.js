'use strict';

/**
 * Session 3B — Telugu seeds retry
 *
 * Run tomorrow when quota resets. Retries the quota-failed channels
 * and attempts corrected handles for the 3 that genuinely failed.
 *
 * Run with:  node server/scripts/addTeluguSeedsRetry.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }              = require('../db/init');
const { resolveSeedChannel } = require('../services/discoveryFetcher');

const RETRY_SEEDS = [
  // ── Quota-failed (correct handles, just retry tomorrow) ───────────────────
  { handle: '@NTVTelugu',              niche_hint: 'news',          note: 'NTV Telugu news' },
  { handle: '@SakshiTV',              niche_hint: 'news',          note: 'Sakshi TV' },
  { handle: '@10TVNewsTelugu',         niche_hint: 'news',          note: '10TV Telugu news' },
  { handle: '@StarMaa',                niche_hint: 'entertainment', note: 'Star Maa — largest Telugu GEC' },
  { handle: '@ZeeTelugu',              niche_hint: 'entertainment', note: 'Zee Telugu' },
  { handle: '@ETVTelugu',              niche_hint: 'entertainment', note: 'ETV Telugu' },
  { handle: '@TeluguFilmNagar',        niche_hint: 'entertainment', note: 'Telugu Film Nagar' },
  { handle: '@VivaHarsha',             niche_hint: 'comedy',        note: 'Viva Harsha comedy' },
  { handle: '@VismaiFood',             niche_hint: 'food',          note: 'Vismai Food — Telugu cooking' },
  { handle: '@HyderabadiRuchulu',      niche_hint: 'food',          note: 'Hyderabadi Ruchulu' },
  { handle: '@TeluguTechTuts',         niche_hint: 'technology',    note: 'Telugu Tech Tuts' },
  { handle: '@TechMahesh',             niche_hint: 'technology',    note: 'Tech Mahesh' },
  { handle: '@TeluguMoney',            niche_hint: 'finance',       note: 'Telugu Money' },
  { handle: '@GROUPSExamsTelugu',      niche_hint: 'education',     note: 'Groups exam prep Telugu' },
  { handle: '@TeluguMotivation',       niche_hint: 'lifestyle',     note: 'Telugu Motivation' },
  { handle: '@BusinessTeluguOfficial', niche_hint: 'business',      note: 'Business Telugu' },

  // ── Corrected handles for genuine misses ──────────────────────────────────
  { handle: '@TV9TeluguLive',          niche_hint: 'news',          note: 'TV9 Telugu — corrected handle' },
  { handle: '@GeminiTVOfficial',       niche_hint: 'entertainment', note: 'Gemini TV — corrected handle' },
  { handle: '@AdhireAbhiOfficial',     niche_hint: 'comedy',        note: 'Adhire Abhi comedy — corrected handle' },

  // ── Extra channels to pad out the seed set ────────────────────────────────
  { handle: '@MahaaNewsChannel',       niche_hint: 'news',          note: 'Mahaa News — Telugu news channel' },
  { handle: '@TeluguOneChannel',       niche_hint: 'entertainment', note: 'Telugu One — entertainment' },
  { handle: '@SumanTV',                niche_hint: 'news',          note: 'Suman TV — Telugu news' },
  { handle: '@BhaktiTV',               niche_hint: 'other',         note: 'Bhakti TV — Telugu devotional' },
  { handle: '@TeluguBhakti',           niche_hint: 'other',         note: 'Telugu devotional content' },
];

async function main() {
  const db = getDb();

  const results  = { added: 0, skipped: 0, failed: 0 };
  const failures = [];

  console.log(`\n[addTeluguSeedsRetry] Trying ${RETRY_SEEDS.length} handles...\n`);

  for (const seed of RETRY_SEEDS) {
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
        console.log(`  ~ ${seed.handle.padEnd(28)} already in seeds`);
        results.skipped++;
      }
    } catch (e) {
      const isQuota = e.message.includes('quota');
      console.warn(`  ${isQuota ? '⏳' : '✗'} ${seed.handle.padEnd(28)} ${isQuota ? 'QUOTA — run again later' : 'FAILED: ' + e.message}`);
      failures.push({ handle: seed.handle, isQuota });
      results.failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n[addTeluguSeedsRetry] Done — added: ${results.added}  skipped: ${results.skipped}  failed: ${results.failed}`);

  const quotaFails = failures.filter(f => f.isQuota);
  const realFails  = failures.filter(f => !f.isQuota);
  if (quotaFails.length) console.log(`\n  ${quotaFails.length} quota failures — run again tomorrow`);
  if (realFails.length) {
    console.log('\n  Wrong handles (find correct ones on YouTube):');
    realFails.forEach(f => console.log('    ' + f.handle));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'te'")?.n ?? 0;
  console.log(`\nTotal Telugu seeds in DB: ${total}\n`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
