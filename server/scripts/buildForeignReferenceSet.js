'use strict';

/**
 * Build a global reference set of top English-language channels per niche.
 *
 * These channels are ingested with ignore_from_benchmarks = 1, meaning:
 *   - Their videos ARE tracked and their title patterns DO feed pattern recognition
 *   - They DO NOT affect niche benchmark calculations (median VPH, like rates, etc.)
 *   - Indian benchmark numbers stay pure and Indian-calibrated
 *
 * Targets US + GB + AU — the three largest English YouTube markets.
 * Picks top channels by subscriber count, minimum 100K subs per channel.
 * Caps at TOP_PER_NICHE channels per niche per country to keep it a reference set,
 * not a full foreign ingestion.
 *
 * Quota cost: ~20 niches × 3 countries × 100 units = ~6,000 units total.
 *
 * Run: node server/scripts/buildForeignReferenceSet.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path   = require('path');
const crypto = require('crypto');

const Database = require(path.join(__dirname, '../node_modules/better-sqlite3'));
const DB_PATH  = path.join(__dirname, '../data/scoring.db');
const db       = new Database(DB_PATH);

const DRY_RUN      = process.argv.includes('--dry-run');
const TOP_PER_NICHE = 25;   // max channels to keep per niche per country
const MIN_SUBS      = 100_000;

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ── API key (standalone — reads directly from env, no server state) ───────────

const API_KEYS = [
  process.env.YT_API_KEY,
  process.env.YT_API_KEY_2,
  process.env.YT_API_KEY_3,
  process.env.YT_API_KEY_4,
  process.env.YT_API_KEY_5,
  process.env.YT_API_KEY_6,
  process.env.YT_API_KEY_8,
  process.env.YT_API_KEY_9,
].filter(Boolean);

if (!API_KEYS.length) {
  console.error('No YouTube API keys found in .env');
  process.exit(1);
}

let keyIndex   = 0;
let quotaUsed  = 0;

function getKey() { return API_KEYS[keyIndex % API_KEYS.length]; }
function rotateKey() { keyIndex++; console.warn(`  [key] Rotating to next key (${keyIndex % API_KEYS.length + 1}/${API_KEYS.length})`); }

async function ytFetch(endpoint, params) {
  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getKey();
    if (!key) throw new Error('all_keys_exhausted');
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message ?? `HTTP ${resp.status}`;
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('ratelimit')) {
        rotateKey();
        continue;
      }
      throw new Error(msg);
    }
    return data;
  }
  throw new Error('all_keys_exhausted');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Target niches and their English search terms ──────────────────────────────

const NICHES = {
  technology:    ['tech channel', 'programming tutorial', 'software engineering', 'AI tools'],
  finance:       ['personal finance', 'investing for beginners', 'stock market analysis', 'financial independence'],
  education:     ['educational youtube', 'science explained', 'history channel', 'explainer channel'],
  gaming:        ['gaming channel', 'game review', 'let\'s play gaming', 'esports commentary'],
  health:        ['health and wellness', 'nutrition advice', 'mental health channel', 'medical explained'],
  fitness:       ['fitness channel', 'workout tutorial', 'gym training', 'home workout'],
  food:          ['cooking channel', 'recipe tutorial', 'food review', 'baking channel'],
  travel:        ['travel vlog', 'travel channel', 'solo travel', 'budget travel'],
  productivity:  ['productivity channel', 'self improvement youtube', 'study tips', 'time management'],
  business:      ['entrepreneurship channel', 'business tips', 'startup advice', 'marketing youtube'],
  lifestyle:     ['lifestyle channel', 'daily vlog', 'minimalism channel', 'life advice'],
  comedy:        ['comedy channel', 'sketch comedy', 'stand up comedy', 'funny videos'],
  beauty:        ['beauty channel', 'makeup tutorial', 'skincare routine', 'fashion youtube'],
  science:       ['science channel', 'physics explained', 'space exploration', 'biology channel'],
  sports:        ['sports analysis', 'football analysis', 'sports commentary', 'athlete training'],
  music:         ['music channel', 'guitar tutorial', 'music production', 'singing lessons'],
  meditation:    ['meditation channel', 'mindfulness youtube', 'yoga channel', 'breathing exercises'],
  news:          ['news analysis', 'current events channel', 'journalism youtube', 'world news'],
  entertainment: ['entertainment channel', 'pop culture', 'movie review', 'celebrity news'],
};

const COUNTRIES = ['US', 'GB', 'AU'];

// ── DB helpers ────────────────────────────────────────────────────────────────

const insertCorpus = db.prepare(`
  INSERT INTO corpus_channels
    (channel_id, title, handle, subscriber_count, total_views, video_count,
     niche, language, country, yt_country, discovery_source, ingest_depth,
     is_spam, is_low_quality, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, 'foreign_reference', 1, 0, 0, datetime('now'), datetime('now'))
  ON CONFLICT(channel_id) DO UPDATE SET
    subscriber_count = MAX(excluded.subscriber_count, subscriber_count),
    ingest_depth     = MAX(excluded.ingest_depth, ingest_depth),
    updated_at       = datetime('now')
`);

const insertIngested = db.prepare(`
  INSERT INTO ingested_channels
    (id, channel_id, channel_name, niche, uploads_playlist_id, channel_subscribers,
     added_by, notes, ignore_from_benchmarks)
  VALUES (?, ?, ?, ?, ?, ?, 'foreign_reference', ?, 1)
  ON CONFLICT(channel_id) DO UPDATE SET
    ignore_from_benchmarks = 1
`);

// ── Main ──────────────────────────────────────────────────────────────────────

const results = { added: 0, skipped: 0, byNiche: {} };

async function searchNicheCountry(niche, keyword, country) {
  quotaUsed += 100;
  const data = await ytFetch('search', {
    part:               'snippet',
    type:               'channel',
    q:                  keyword,
    regionCode:         country,
    relevanceLanguage:  'en',
    maxResults:         50,
    order:              'relevance',
  });
  return (data.items ?? []).map(i => i.id?.channelId).filter(Boolean);
}

async function fetchChannelMeta(ids) {
  if (!ids.length) return [];
  quotaUsed += 1;
  const data = await ytFetch('channels', {
    part: 'snippet,statistics,contentDetails',
    id:   ids.join(','),
  });
  return data.items ?? [];
}

async function run() {
  console.log(`\nBuilding foreign reference set`);
  console.log(`  Countries  : ${COUNTRIES.join(', ')}`);
  console.log(`  Niches     : ${Object.keys(NICHES).length}`);
  console.log(`  Min subs   : ${MIN_SUBS.toLocaleString()}`);
  console.log(`  Max/niche  : ${TOP_PER_NICHE} per country`);
  console.log(`  Mode       : ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  for (const [niche, keywords] of Object.entries(NICHES)) {
    results.byNiche[niche] = 0;

    for (const country of COUNTRIES) {
      // Use only the first two keywords per niche per country to save quota
      const keywordsToTry = keywords.slice(0, 2);
      const allIds = new Set();

      for (const keyword of keywordsToTry) {
        try {
          const ids = await searchNicheCountry(niche, keyword, country);
          ids.forEach(id => allIds.add(id));
          await sleep(300);
        } catch (e) {
          console.warn(`  [warn] ${niche}/${country} "${keyword}": ${e.message}`);
        }
      }

      if (!allIds.size) continue;

      // Batch-fetch metadata for all discovered channel IDs
      const idList    = [...allIds];
      const batchSize = 50;
      const allMeta   = [];

      for (let i = 0; i < idList.length; i += batchSize) {
        try {
          const batch = await fetchChannelMeta(idList.slice(i, i + batchSize));
          allMeta.push(...batch);
          await sleep(200);
        } catch (e) {
          console.warn(`  [warn] channels.list batch failed: ${e.message}`);
        }
      }

      // Filter: min subs, not Indian (already tracked separately), dedupe by ID
      const seen = new Set();
      const qualified = allMeta
        .filter(ch => {
          if (seen.has(ch.id)) return false;
          seen.add(ch.id);
          const subs        = parseInt(ch.statistics?.subscriberCount ?? '0', 10);
          const chCountry   = ch.snippet?.country ?? null;
          // Skip channels that are actually Indian — YouTube surfaces them globally
          // because they make English content, but they're already in our Indian corpus
          if (chCountry === 'IN') return false;
          return subs >= MIN_SUBS;
        })
        .sort((a, b) =>
          parseInt(b.statistics?.subscriberCount ?? '0', 10) -
          parseInt(a.statistics?.subscriberCount ?? '0', 10)
        )
        .slice(0, TOP_PER_NICHE);

      if (!qualified.length) continue;

      console.log(`  ${niche.padEnd(14)} ${country}  →  ${qualified.length} channels (top: ${qualified[0]?.snippet?.title}, ${parseInt(qualified[0]?.statistics?.subscriberCount ?? '0').toLocaleString()} subs)`);

      if (DRY_RUN) {
        results.byNiche[niche] += qualified.length;
        results.added += qualified.length;
        continue;
      }

      const promote = db.transaction(() => {
        for (const ch of qualified) {
          const channelId    = ch.id;
          const title        = ch.snippet?.title ?? null;
          const handle       = ch.snippet?.customUrl ?? null;
          const subs         = parseInt(ch.statistics?.subscriberCount ?? '0', 10);
          const views        = parseInt(ch.statistics?.viewCount ?? '0', 10);
          const videoCount   = parseInt(ch.statistics?.videoCount ?? '0', 10);
          const uploadsId    = ch.contentDetails?.relatedPlaylists?.uploads ?? null;
          const chCountry    = ch.snippet?.country ?? country; // use channel's own country if set

          const alreadyIngested = db.prepare(
            'SELECT 1 FROM ingested_channels WHERE channel_id = ? AND ignore_from_benchmarks = 0'
          ).get(channelId);

          if (alreadyIngested) {
            results.skipped++;
            continue;
          }

          insertCorpus.run(channelId, title, handle, subs, views, videoCount, niche, chCountry, chCountry);
          insertIngested.run(
            crypto.randomUUID(), channelId, title, niche, uploadsId, subs,
            `Foreign reference — ${country} ${niche}, ${subs.toLocaleString()} subs`,
          );

          results.added++;
          results.byNiche[niche]++;
        }
      });

      promote();
    }

    // Pace between niches — avoid hammering the API
    await sleep(500);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Done.`);
  console.log(`  Added   : ${results.added} channels`);
  console.log(`  Skipped : ${results.skipped} (already ingested as real channels)`);
  console.log(`  Quota   : ~${quotaUsed} units used`);
  if (DRY_RUN) console.log(`\nRe-run without --dry-run to apply.`);
  else console.log(`\nAll added with ignore_from_benchmarks=1. Indian benchmarks unaffected.`);

  db.close();
}

run().catch(e => {
  console.error('Fatal:', e.message);
  db.close();
  process.exit(1);
});
