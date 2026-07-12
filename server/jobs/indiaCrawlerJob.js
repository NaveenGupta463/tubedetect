'use strict';

// ── India Channel Crawler ─────────────────────────────────────────────────────
// Runs daily at 01:00 UTC. Five discovery phases:
//
//   Phase 1 — Trending harvest (≈20 units)
//     mostPopular videos by regionCode=IN across all categories.
//     Each call costs 1 unit and yields up to 50 channel IDs.
//     Fresh channels guaranteed every day because trending rotates.
//
//   Phase 2 — Comment harvest (≈2,000 units)
//     Fetch comments on the top-viewed Indian videos in the DB.
//     Each commenter has a channelId — creators comment on other creators.
//     1 unit per 100 comments → massive channel ID yield at minimal cost.
//
//   Phase 3 — Video search, relevance (≈20,000 units)
//     type=video (NOT channel) so keywords match video *titles*, not channel names.
//     "cricket hindi" finds every creator who uploaded a cricket video in Hindi,
//     not just channels named "Cricket Hindi". 10-50× more diverse than before.
//
//   Phase 4 — Video search, date order (≈5,000 units)
//     Same search but order=date surfaces the newest uploads.
//     Discovers emerging creators before they appear in relevance results.
//
//   Phase 5 — Channel detail fetch (≈1,000 units)
//     Batch-verify all discovered IDs (50 per call) to get subscriber count,
//     uploads playlist, niche, etc. Filter by PROMOTION_MIN_SUBS.

const cron       = require('node-cron');
const { getDb }  = require('../db/init');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');
const { upsertCorpusChannel } = require('../db/corpusQueries');
const quotaGuard              = require('../services/quotaGuard');
const { withCronRetry }       = require('../utils/cronRetry');
const { detectNicheFromItem } = require('../services/nicheDetector');

let _budget = parseInt(process.env.CRAWLER_QUOTA_BUDGET || '70000', 10);

// YouTube video category IDs — covers all major content verticals in India
const YT_CATEGORIES = [
  1,   // Film & Animation
  2,   // Autos & Vehicles
  10,  // Music          ← massive in India
  15,  // Pets & Animals
  17,  // Sports         ← cricket
  19,  // Travel & Events
  20,  // Gaming
  22,  // People & Blogs ← biggest category in India
  23,  // Comedy
  24,  // Entertainment
  25,  // News & Politics
  26,  // Howto & Style
  27,  // Education
  28,  // Science & Technology
];

// 200+ keywords targeting video *titles* (not channel names).
// With type=video, "cricket hindi" finds every creator whose video title
// contains those words — regardless of what their channel is named.
const INDIA_KEYWORDS = [
  // ── Generic India ─────────────────────────────────────────────────────────
  'india vlog', 'desi vlog', 'bharat vlog', 'india daily vlog',
  'india life', 'india shorts', 'india reaction', 'india challenge',
  'indian youtuber', 'india travel', 'india food vlog',

  // ── Hindi / Hinglish ──────────────────────────────────────────────────────
  'hindi vlog', 'hindi video', 'hinglish vlog', 'hindi reaction',
  'meri life vlog', 'desi life', 'ghar pe khana', 'hindi comedy',
  'hindi motivation', 'hindi challenge video',

  // ── Tamil ─────────────────────────────────────────────────────────────────
  'tamil vlog', 'tamil daily vlog', 'tamil reaction', 'tamil review',
  'chennai vlog', 'tamil food', 'tamilnadu vlog', 'madurai vlog',
  'coimbatore vlog', 'tamil comedy video', 'tamil shorts video',
  'tamil travel vlog', 'salem vlog', 'trichy vlog',

  // ── Telugu ────────────────────────────────────────────────────────────────
  'telugu vlog', 'telugu daily vlog', 'telugu reaction', 'telugu review',
  'hyderabad vlog', 'telugu food', 'vizag vlog', 'telugu comedy',
  'warangal vlog', 'vijayawada vlog', 'telugu shorts video',
  'telugu travel vlog', 'tirupati vlog',

  // ── Malayalam ─────────────────────────────────────────────────────────────
  'malayalam vlog', 'kerala vlog', 'kerala food', 'kerala travel',
  'malayalam reaction', 'kochi vlog', 'trivandrum vlog', 'thrissur vlog',
  'malayalam comedy', 'kozhikode vlog', 'kannur vlog', 'palakkad vlog',

  // ── Kannada ───────────────────────────────────────────────────────────────
  'kannada vlog', 'bangalore vlog', 'bengaluru vlog', 'kannada video',
  'kannada comedy', 'mysore vlog', 'hubli vlog', 'mangalore vlog',
  'belgaum vlog', 'kannada shorts',

  // ── Bengali ───────────────────────────────────────────────────────────────
  'bangla vlog', 'bengali vlog', 'kolkata vlog', 'bangla reaction',
  'bangla comedy', 'bengali daily vlog', 'siliguri vlog', 'bangla shorts',

  // ── Marathi ───────────────────────────────────────────────────────────────
  'marathi vlog', 'pune vlog', 'marathi video', 'marathi comedy',
  'nashik vlog', 'aurangabad vlog', 'nagpur vlog', 'solapur vlog',
  'marathi shorts', 'kolhapur vlog',

  // ── Punjabi ───────────────────────────────────────────────────────────────
  'punjabi vlog', 'punjab vlog', 'amritsar vlog', 'punjabi comedy',
  'chandigarh vlog', 'ludhiana vlog', 'jalandhar vlog', 'punjabi shorts',

  // ── Gujarati ──────────────────────────────────────────────────────────────
  'gujarati vlog', 'ahmedabad vlog', 'surat vlog', 'vadodara vlog',
  'rajkot vlog', 'gujarati video',

  // ── Odia / Bhojpuri / Rajasthani ──────────────────────────────────────────
  'odia vlog', 'bhubaneswar vlog', 'cuttack vlog',
  'bhojpuri video', 'patna vlog', 'bhojpuri vlog',
  'rajasthani vlog', 'jaipur vlog', 'jodhpur vlog', 'udaipur vlog',

  // ── Other UP / MP cities ───────────────────────────────────────────────────
  'lucknow vlog', 'kanpur vlog', 'agra vlog', 'varanasi vlog',
  'meerut vlog', 'allahabad vlog', 'gorakhpur vlog',
  'bhopal vlog', 'indore vlog', 'gwalior vlog', 'jabalpur vlog',

  // ── Northeast ─────────────────────────────────────────────────────────────
  'assamese vlog', 'guwahati vlog', 'manipuri vlog', 'nagaland vlog',

  // ── Travel destinations ───────────────────────────────────────────────────
  'goa vlog india', 'shimla vlog', 'manali vlog', 'leh ladakh vlog',
  'rishikesh vlog', 'haridwar vlog', 'puri beach vlog',
  'ooty vlog', 'munnar vlog', 'coorg vlog', 'darjeeling vlog',

  // ── Street food ───────────────────────────────────────────────────────────
  'mumbai street food', 'delhi street food', 'india street food',
  'bangalore street food', 'chennai street food', 'kolkata street food',
  'hyderabad street food',

  // ── Gaming ────────────────────────────────────────────────────────────────
  'bgmi gameplay india', 'free fire india', 'minecraft hindi',
  'valorant india', 'gaming india hindi', 'gta india hindi',
  'cod mobile india', 'fc24 india', 'gaming shorts india',
  'among us india', 'stumble guys india',

  // ── Finance & Business ────────────────────────────────────────────────────
  'stock market hindi', 'mutual fund india', 'business idea hindi',
  'share market india', 'startup india hindi', 'paise kaise kamaye',
  'trading india hindi', 'crypto india hindi',

  // ── Tech ──────────────────────────────────────────────────────────────────
  'best phone india', 'smartphone review india', 'tech review hindi',
  'gadget review india', 'laptop review india', 'earphone review india',
  'smartwatch india', 'iphone india unboxing', 'samsung india review',

  // ── Food & Cooking ────────────────────────────────────────────────────────
  'homemade recipe india', 'indian cooking recipe', 'desi khana recipe',
  'biryani recipe hindi', 'dal recipe hindi', 'thali india',
  'baking india hindi',

  // ── Fitness & Health ──────────────────────────────────────────────────────
  'gym workout india', 'yoga hindi', 'fitness india hindi',
  'diet plan india hindi', 'weight loss india hindi', 'home workout india',

  // ── Education ─────────────────────────────────────────────────────────────
  'upsc preparation hindi', 'ssc preparation hindi', 'study motivation india',
  'english speaking india', 'neet preparation hindi', 'jee preparation hindi',
  'ielts india', 'skills development hindi',

  // ── Entertainment ─────────────────────────────────────────────────────────
  'bollywood reaction video', 'hindi movie review', 'web series review hindi',
  'cricket analysis hindi', 'ipl analysis hindi', 'ott review hindi',
  'stand up comedy india', 'roast video india',

  // ── Lifestyle ─────────────────────────────────────────────────────────────
  'morning routine india', 'room tour india', 'college life india vlog',
  'couple vlog india', 'family vlog india', 'student life india vlog',
  'village life india', 'farm life india',

  // ── Shorts-specific ───────────────────────────────────────────────────────
  'india shorts funny', 'desi shorts video', 'hindi shorts',
  'viral shorts india', 'comedy shorts india',
];

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── YouTube helper with key rotation + transient retry ────────────────────────

async function ytGet(path, params, costUnits) {
  for (let keyAttempt = 0; keyAttempt < 13; keyAttempt++) {
    const key = getApiKey('discovery');
    if (!key) throw new Error('all_api_keys_exhausted');

    const url = new URL(`${YT_BASE}/${path}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const full = url.toString();

    for (let t = 1; t <= 3; t++) {
      let res, data;
      const ac    = new AbortController();
      const timer = setTimeout(() => ac.abort(), 25_000);
      try {
        res  = await fetch(full, { signal: ac.signal });
        data = await res.json();
        clearTimeout(timer);
      } catch (e) {
        clearTimeout(timer);
        const isTimeout = e.name === 'AbortError';
        if (isTimeout) console.warn(`[indiaCrawler] ytFetch timeout (25s), attempt ${t}`);
        if (t < 3) { await sleep(2000 * t); continue; }
        throw new Error('network_error_after_retries');
      }

      if (!res.ok) {
        const msg = data?.error?.message || `YouTube ${res.status}`;
        if (isQuotaError(msg) || res.status === 429) { markExhausted(key); break; }
        if (res.status >= 500 && t < 3) { await sleep(3000 * t); continue; }
        throw new Error(msg);
      }

      quotaGuard.recordUsage(costUnits, 'crawler');
      return data;
    }
  }
  throw new Error('all_api_keys_exhausted');
}

// ── Dedup set ─────────────────────────────────────────────────────────────────

function buildKnownSet(db) {
  const corpus   = db.all('SELECT channel_id FROM corpus_channels').map(r => r.channel_id);
  const ingested = db.all('SELECT channel_id FROM ingested_channels').map(r => r.channel_id);
  return new Set([...corpus, ...ingested]);
}

// ── India filter ──────────────────────────────────────────────────────────────

function isLikelyIndian(item) {
  const country = item.snippet?.country || null;
  if (country && country !== 'IN') return false;
  return true;
}

// ── Save a raw YouTube channels.list item to corpus_channels ──────────────────

function saveItem(db, item, source) {
  try {
    const niche = detectNicheFromItem(item);
    upsertCorpusChannel(db, {
      channel_id:          item.id,
      title:               item.snippet?.title                              || null,
      handle:              item.snippet?.customUrl                          || null,
      thumbnail_url:       item.snippet?.thumbnails?.medium?.url
                        || item.snippet?.thumbnails?.default?.url           || null,
      uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads   || null,
      subscriber_count:    parseInt(item.statistics?.subscriberCount || '0', 10),
      video_count:         parseInt(item.statistics?.videoCount      || '0', 10),
      language:            item.snippet?.defaultLanguage
                        || item.snippet?.defaultAudioLanguage               || null,
      country:             item.snippet?.country                            || null,
      niche,
      discovery_source:    source,
      raw_json:            JSON.stringify(item),
    });
  } catch (e) {
    console.warn(`[crawler] saveItem failed for ${item.id}:`, e.message);
  }
}

// ── Batch: fetch + save channel details for up to 50 IDs (1 unit each) ────────

async function fetchAndSave(db, newIds, source, budgetUsed, opts = {}) {
  const {
    minSubs              = 0,
    minVideos            = 0,
    requireUploadsPlaylist = false,
    allowCountries       = null,   // null = India default (null/IN); Set = accept those countries (or null country)
  } = opts;

  let saved = 0, gated = 0;
  for (let i = 0; i < newIds.length; i += 50) {
    if (budgetUsed[0] + 1 > _budget) break;
    const batch = newIds.slice(i, i + 50);
    try {
      const data = await ytGet('channels', {
        part:       'snippet,statistics,contentDetails,topicDetails',
        id:         batch.join(','),
        maxResults: 50,
      }, 1);
      budgetUsed[0] += 1;
      for (const item of (data.items || [])) {
        if (allowCountries) {
          const c = item.snippet?.country || null;
          if (c && !allowCountries.has(c)) continue;
        } else if (!isLikelyIndian(item)) continue;
        // Creator quality gate — enforced per-source via opts.
        // statistics and contentDetails are always fetched above, so no extra API cost.
        if (minSubs > 0 && parseInt(item.statistics?.subscriberCount || '0', 10) < minSubs) { gated++; continue; }
        if (minVideos > 0 && parseInt(item.statistics?.videoCount || '0', 10) < minVideos) { gated++; continue; }
        if (requireUploadsPlaylist && !item.contentDetails?.relatedPlaylists?.uploads) { gated++; continue; }
        saveItem(db, item, source);
        saved++;
      }
      await sleep(100);
    } catch (e) {
      if (e.message === 'all_api_keys_exhausted') break;
      console.warn('[crawler] fetchAndSave batch error:', e.message);
    }
  }
  if (gated > 0) console.log(`[crawler] fetchAndSave (${source}): ${gated} channels blocked by quality gate, ${saved} saved`);
  return saved;
}

// ── Phase 1: Trending harvest ─────────────────────────────────────────────────
// videos?chart=mostPopular&regionCode=IN costs 1 unit and returns 50 channel IDs.
// Run for each category → guaranteed fresh Indian channels every day.

async function runTrendingPhase(db, knownIds, budgetUsed, region = 'IN') {
  const newIds = [];

  // General trending (no category)
  try {
    if (budgetUsed[0] + 1 <= _budget) {
      const data = await ytGet('videos', {
        part:       'snippet',
        chart:      'mostPopular',
        regionCode: region,
        maxResults: 50,
      }, 1);
      budgetUsed[0] += 1;
      for (const item of (data.items || [])) {
        const id = item.snippet?.channelId;
        if (id && !knownIds.has(id)) { newIds.push(id); knownIds.add(id); }
      }
    }
  } catch (e) {
    console.warn('[crawler] Trending (general) error:', e.message);
  }

  // Per-category trending
  for (const catId of YT_CATEGORIES) {
    if (budgetUsed[0] + 1 > _budget) break;
    try {
      const data = await ytGet('videos', {
        part:              'snippet',
        chart:             'mostPopular',
        regionCode:        region,
        videoCategoryId:   catId,
        maxResults:        50,
      }, 1);
      budgetUsed[0] += 1;
      for (const item of (data.items || [])) {
        const id = item.snippet?.channelId;
        if (id && !knownIds.has(id)) { newIds.push(id); knownIds.add(id); }
      }
      await sleep(80);
    } catch (_) {
      // Some categories return no results for IN — silently skip
    }
  }

  const allowCountries = region === 'IN' ? null : new Set([region]);
  const saved = await fetchAndSave(db, newIds, `trending_${region}`, budgetUsed, { allowCountries });
  console.log(`[crawler] Phase 1 (trending ${region}) done — newFound=${newIds.length} saved=${saved} quota=${budgetUsed[0]}`);
  return { newFound: newIds.length, saved };
}

// ── Phase 2: Comment harvest ──────────────────────────────────────────────────
// Every commenter on a popular Indian video has a channelId.
// Creators actively comment on other creators' videos — high creator density.
// Cost: 1 unit per 100 comments. Far cheaper than search.list.

async function runCommentHarvestPhase(db, knownIds, budgetUsed) {
  const COMMENT_BUDGET = Math.floor(_budget * 0.08); // 8% of total budget

  // Pick the highest-viewed Indian videos in our DB
  const topVideos = db.all(`
    SELECT youtube_video_id FROM ingested_videos
    WHERE views > 500000
    ORDER BY views DESC
    LIMIT 300
  `).map(r => r.youtube_video_id);

  if (!topVideos.length) {
    console.log('[crawler] Phase 2 (comments) — no high-view videos yet, skipping');
    return { scanned: 0, newFound: 0, saved: 0 };
  }

  const newIds     = [];
  let   scanned    = 0;
  const phaseStart = budgetUsed[0];

  for (const videoId of topVideos) {
    if (budgetUsed[0] >= _budget) break;
    if (budgetUsed[0] - phaseStart >= COMMENT_BUDGET) break;

    try {
      const data = await ytGet('commentThreads', {
        part:       'snippet',
        videoId,
        maxResults: 100,
        order:      'relevance',
      }, 1);
      budgetUsed[0] += 1;
      scanned++;

      for (const item of (data.items || [])) {
        const id = item.snippet?.topLevelComment?.snippet?.authorChannelId?.value;
        if (id && !knownIds.has(id)) { newIds.push(id); knownIds.add(id); }
      }
      await sleep(120);
    } catch (_) {
      // Comments disabled on this video — skip silently
    }
  }

  const saved = await fetchAndSave(db, newIds, 'comment_harvest_IN', budgetUsed, {
    minSubs:               1000,
    minVideos:             10,
    requireUploadsPlaylist: true,
  });
  console.log(`[crawler] Phase 2 (comments) done — scanned=${scanned} newFound=${newIds.length} saved=${saved} quota=${budgetUsed[0]}`);
  return { scanned, newFound: newIds.length, saved };
}

// ── Phase 3: Video search, relevance order ────────────────────────────────────
// type=video matches video TITLES not channel names.
// "cricket hindi" finds every creator whose video title contains those words.
// Orders by relevance (most popular first) — high signal, established channels.

async function runVideoSearchPhase(db, knownIds, budgetUsed) {
  const SEARCH_BUDGET = Math.floor(_budget * 0.40); // 40% of total budget
  const dayOfYear     = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const startOffset   = (dayOfYear * 7) % INDIA_KEYWORDS.length;
  const newIds        = [];
  let   searched      = 0;
  const phaseStart    = budgetUsed[0];

  for (let k = 0; k < INDIA_KEYWORDS.length; k++) {
    if (budgetUsed[0] + 100 > _budget) break;
    if (budgetUsed[0] - phaseStart + 100 > SEARCH_BUDGET) break;

    const keyword = INDIA_KEYWORDS[(startOffset + k) % INDIA_KEYWORDS.length];

    try {
      const data = await ytGet('search', {
        part:       'snippet',
        type:       'video',
        q:          keyword,
        regionCode: 'IN',
        maxResults: 50,
      }, 100);
      budgetUsed[0] += 100;
      searched++;

      for (const item of (data.items || [])) {
        const id = item.snippet?.channelId;
        if (id && !knownIds.has(id)) { newIds.push(id); knownIds.add(id); }
      }
      await sleep(350);
    } catch (e) {
      if (e.message === 'all_api_keys_exhausted') break;
      console.warn(`[crawler] Phase 3 error "${keyword}":`, e.message);
    }
  }

  const saved = await fetchAndSave(db, newIds, 'video_search_IN', budgetUsed);
  console.log(`[crawler] Phase 3 (video search) done — keywords=${searched} newFound=${newIds.length} saved=${saved} quota=${budgetUsed[0]}`);
  return { searched, newFound: newIds.length, saved };
}

// ── Phase 4: Emerging creators (newest uploads) ────────────────────────────────
// order=date surfaces the most recently uploaded videos.
// Discovers new/emerging creators before they appear in relevance results.
// Uses a rotating subset of keywords — budget-capped.

async function runEmergingCreatorsPhase(db, knownIds, budgetUsed) {
  const EMERGING_BUDGET = Math.floor(_budget * 0.12); // 12% of total budget

  // Keywords most likely to surface emerging creators (vlogs, shorts, new content)
  const EMERGING_KEYWORDS = [
    'india vlog', 'desi vlog', 'hindi vlog', 'tamil vlog', 'telugu vlog',
    'malayalam vlog', 'kannada vlog', 'bangla vlog', 'marathi vlog', 'punjabi vlog',
    'india shorts', 'hindi shorts', 'desi shorts video', 'viral shorts india',
    'india daily vlog', 'gaming india hindi', 'india reaction', 'india comedy',
  ];

  const dayOfYear   = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const startOffset = (dayOfYear * 3) % EMERGING_KEYWORDS.length;
  const newIds      = [];
  let   searched    = 0;
  const phaseStart  = budgetUsed[0];

  for (let k = 0; k < EMERGING_KEYWORDS.length; k++) {
    if (budgetUsed[0] + 100 > _budget) break;
    if (budgetUsed[0] - phaseStart + 100 > EMERGING_BUDGET) break;

    const keyword = EMERGING_KEYWORDS[(startOffset + k) % EMERGING_KEYWORDS.length];

    try {
      const data = await ytGet('search', {
        part:          'snippet',
        type:          'video',
        q:             keyword,
        regionCode:    'IN',
        order:         'date',
        maxResults:    50,
      }, 100);
      budgetUsed[0] += 100;
      searched++;

      for (const item of (data.items || [])) {
        const id = item.snippet?.channelId;
        if (id && !knownIds.has(id)) { newIds.push(id); knownIds.add(id); }
      }
      await sleep(350);
    } catch (e) {
      if (e.message === 'all_api_keys_exhausted') break;
      console.warn(`[crawler] Phase 4 error "${keyword}":`, e.message);
    }
  }

  const saved = await fetchAndSave(db, newIds, 'emerging_IN', budgetUsed);
  console.log(`[crawler] Phase 4 (emerging) done — keywords=${searched} newFound=${newIds.length} saved=${saved} quota=${budgetUsed[0]}`);
  return { searched, newFound: newIds.length, saved };
}

// ── Main crawl cycle ──────────────────────────────────────────────────────────

async function runCrawlerCycle({ quotaBudget } = {}) {
  _budget = quotaBudget || CRAWLER_BUDGET;
  const db = getDb();
  console.log(`[crawler] Cycle start — budget=${_budget} units`);

  const knownIds   = buildKnownSet(db);
  const budgetUsed = [0];
  const before     = db.get('SELECT COUNT(*) AS n FROM corpus_channels').n;

  const p1 = await runTrendingPhase(db, knownIds, budgetUsed);
  // Foreign-expansion: trending harvest for US + UK (cheap mostPopular passes, 1u each).
  const p1us = await runTrendingPhase(db, knownIds, budgetUsed, 'US');
  const p1gb = await runTrendingPhase(db, knownIds, budgetUsed, 'GB');
  const p2 = await runCommentHarvestPhase(db, knownIds, budgetUsed);
  const p3 = await runVideoSearchPhase(db, knownIds, budgetUsed);
  const p4 = await runEmergingCreatorsPhase(db, knownIds, budgetUsed);

  const after = db.get('SELECT COUNT(*) AS n FROM corpus_channels').n;

  console.log(
    `[crawler] Cycle complete — new channels: ${after - before} | quota used: ${budgetUsed[0]} ` +
    `| corpus total: ${after}`,
  );

  return {
    p1, p1us, p1gb, p2, p3, p4,
    quota_used:   budgetUsed[0],
    corpus_total: after,
    new_channels: after - before,
  };
}

// ── Cron: daily at 01:00 UTC ──────────────────────────────────────────────────

function startCrawlerCron() {
  const apiKey = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[crawler] No YouTube API key — crawler disabled');
    return;
  }

  cron.schedule('0 1 * * *', () => {
    withCronRetry(runCrawlerCycle, 'crawler', { maxAttempts: 3, retryDelayMs: 15 * 60 * 1000 });
  }, { timezone: 'UTC' });

  console.log('[crawler] Scheduled — daily at 01:00 UTC');
}

module.exports = { startCrawlerCron, runCrawlerCycle };
