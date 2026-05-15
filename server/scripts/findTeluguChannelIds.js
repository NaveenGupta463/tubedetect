'use strict';

// Searches YouTube by channel name to find correct channel IDs
// for Telugu channels whose handles are unknown.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb }    = require('../db/init');
const quotaGuard   = require('../services/quotaGuard');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function ytSearch(query) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const qs  = new URLSearchParams({ part: 'snippet', type: 'channel', q: query, maxResults: '3', key }).toString();
    const res = await fetch(`${YT_BASE}/search?${qs}`);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || `YouTube ${res.status}`;
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    quotaGuard.recordUsage(100, 'ingest');
    return data.items ?? [];
  }
  throw new Error('all_api_keys_exhausted');
}

const SEARCH_QUERIES = [
  { query: 'Gemini TV Telugu official',    niche_hint: 'entertainment' },
  { query: 'Adhire Abhi Telugu comedy',    niche_hint: 'comedy' },
  { query: 'Mahaa News Telugu',            niche_hint: 'news' },
  { query: 'Suman TV Telugu news',         niche_hint: 'news' },
  { query: 'Viva Harsha Telugu comedy',    niche_hint: 'comedy' },
  { query: 'Business Telugu channel',      niche_hint: 'business' },
  { query: 'Tech Mahesh Telugu',           niche_hint: 'technology' },
  { query: 'Groups Exams Telugu',          niche_hint: 'education' },
];

async function main() {
  const db = getDb();

  console.log('\n[findTeluguChannelIds] Searching YouTube for 8 channels...\n');

  for (const { query, niche_hint } of SEARCH_QUERIES) {
    try {
      const items = await ytSearch(query);
      if (!items.length) { console.log(`  ✗ "${query}" — no results`); continue; }

      console.log(`  Query: "${query}"`);
      for (const item of items) {
        const channelId   = item.snippet?.channelId ?? item.id?.channelId;
        const channelName = item.snippet?.channelTitle ?? item.snippet?.title ?? '?';
        console.log(`    → ${channelId}  "${channelName}"`);

        if (channelId) {
          db.run(
            `INSERT OR IGNORE INTO discovery_seeds (channel_id, language_code, niche_hint, seed_quality, added_at)
             VALUES (?, 'te', ?, 'curated', datetime('now'))`,
            [channelId, niche_hint],
          );
        }
      }
      console.log('');
    } catch (e) {
      console.warn(`  ✗ "${query}" — ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const total = db.get("SELECT COUNT(*) AS n FROM discovery_seeds WHERE language_code = 'te'")?.n ?? 0;
  console.log(`Total Telugu seeds in DB: ${total}\n`);
  console.log('NOTE: Script inserts top 3 results per query — review the IDs above and remove any wrong ones via:');
  console.log('  node server/scripts/removeTeluguSeed.js <channelId>\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
