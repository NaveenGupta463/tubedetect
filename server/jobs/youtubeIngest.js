const cron = require('node-cron');
const { getDb }           = require('../db/init');
const { extractFeatures } = require('../services/featureExtraction');
const {
  searchVideosByKeyword,
  fetchVideoStatsBatch,
  fetchChannelStatsBatch,
} = require('../services/youtubeMetrics');

const KEYWORDS = [
  'finance',
  'stock market',
  'business',
  'entrepreneurship',
  'ai tools',
  'make money online',
  'fitness',
  'workout',
  'health',
  'productivity',
];

const PAGES_PER_KEYWORD = 1;   // 1 × 50 = 50 candidates per keyword
const MIN_VIEWS         = 500; // quality filter
const MIN_AGE_DAYS      = 1;   // skip brand-new videos (stats not stable)

function daysBetween(dateStr) {
  const published = new Date(dateStr).getTime();
  return Math.max(0, Math.round((Date.now() - published) / (1000 * 60 * 60 * 24)));
}

function computePerfScore(views, channelSize) {
  return Math.log((views + 1) / Math.max(channelSize, 1));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch up to PAGES_PER_KEYWORD pages of search results for one keyword.
 * Returns flat array of { videoId, channelId, title, publishedAt }.
 */
async function fetchAllPages(keyword) {
  const results = [];
  let pageToken = null;

  for (let page = 0; page < PAGES_PER_KEYWORD; page++) {
    try {
      const { items, nextPageToken } = await searchVideosByKeyword(keyword, 50, pageToken);
      results.push(...items);
      if (!nextPageToken) break;
      pageToken = nextPageToken;
      await sleep(300); // brief pause between pages
    } catch (e) {
      console.warn(`[ingest:${keyword}] Page ${page + 1} failed:`, e.message);
      break;
    }
  }

  return results;
}

/**
 * Batch-fetch video stats in groups of 50 (API limit per call).
 */
async function batchVideoStats(videoIds) {
  const map = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    try {
      const batch = await fetchVideoStatsBatch(videoIds.slice(i, i + 50));
      for (const [id, stats] of batch) map.set(id, stats);
    } catch (e) {
      console.warn('[ingest] Video stats batch failed:', e.message);
    }
    if (i + 50 < videoIds.length) await sleep(200);
  }
  return map;
}

/**
 * Batch-fetch channel subscriber counts in groups of 50.
 */
async function batchChannelStats(channelIds) {
  const unique = [...new Set(channelIds)];
  const map    = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    try {
      const batch = await fetchChannelStatsBatch(unique.slice(i, i + 50));
      for (const [id, subs] of batch) map.set(id, subs);
    } catch (e) {
      console.warn('[ingest] Channel stats batch failed:', e.message);
    }
    if (i + 50 < unique.length) await sleep(200);
  }
  return map;
}

/**
 * Ingest YouTube videos for one keyword.
 * - Fetches PAGES_PER_KEYWORD pages (~100 candidates)
 * - Deduplicates against DB
 * - Filters: views >= MIN_VIEWS, age >= MIN_AGE_DAYS
 * - Inserts into videos + features + performance_metrics
 * - NO LLM. NO embeddings.
 */
async function ingestByKeyword(keyword) {
  const db = getDb();
  let fetched = 0, inserted = 0, skipped = 0;

  // 1. Fetch all pages
  const searchResults = await fetchAllPages(keyword);
  fetched = searchResults.length;
  if (!fetched) return { fetched: 0, inserted: 0, skipped: 0 };

  // 2. Deduplicate against existing DB rows
  const placeholders = searchResults.map(() => '?').join(',');
  const existingIds  = new Set(
    db.all(
      `SELECT youtube_video_id FROM videos WHERE youtube_video_id IN (${placeholders})`,
      searchResults.map(v => v.videoId),
    ).map(r => r.youtube_video_id),
  );
  const fresh = searchResults.filter(v => !existingIds.has(v.videoId));
  skipped += searchResults.length - fresh.length;

  if (!fresh.length) {
    console.log(`[ingest:${keyword}] fetched=${fetched} inserted=0 skipped=${skipped} (all duplicates)`);
    return { fetched, inserted: 0, skipped };
  }

  // 3. Batch-fetch stats
  const videoIds   = fresh.map(v => v.videoId);
  const channelIds = fresh.map(v => v.channelId);
  const videoStats   = await batchVideoStats(videoIds);
  const channelStats = await batchChannelStats(channelIds);

  // 4. Apply quality filters + insert
  for (const video of fresh) {
    const stats       = videoStats.get(video.videoId)    ?? { views: 0, likes: 0 };
    const channelSize = channelStats.get(video.channelId) ?? 1000;
    const agedays     = daysBetween(video.publishedAt);

    // Quality filters
    if (stats.views < MIN_VIEWS) { skipped++; continue; }
    if (agedays < MIN_AGE_DAYS)  { skipped++; continue; }

    const title     = video.title ?? '';
    const perfScore = computePerfScore(stats.views, channelSize);

    try {
      const { lastInsertRowid: videoId } = db.run(
        `INSERT INTO videos
           (title, hook, niche, channel_size, upload_date, prediction_date, wing, youtube_video_id, last_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'post', ?, ?)`,
        [
          title, title, keyword, channelSize,
          video.publishedAt ?? new Date().toISOString(),
          new Date().toISOString(),
          video.videoId,
          new Date().toISOString(),
        ],
      );

      const f = extractFeatures({ title, hook: title, niche: keyword });
      db.run(
        `INSERT INTO features
           (video_id, title_length, has_number, has_power_word, hook_type,
            hook_question_present, upload_day, days_since_last_upload, niche_trend_score,
            curiosity_score, urgency_score, specificity_score, power_word_score, sentiment_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          videoId,
          f.title_length, f.has_number, f.has_power_word, f.hook_type,
          f.hook_question_present, f.upload_day, f.days_since_last_upload, f.niche_trend_score,
          f.curiosity_score, f.urgency_score, f.specificity_score, f.power_word_score, f.sentiment_score,
        ],
      );

      db.run(
        `INSERT INTO performance_metrics
           (video_id, views, likes, upload_age_days, performance_score, training_ready)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [videoId, stats.views, stats.likes, agedays, perfScore],
      );

      inserted++;
    } catch (e) {
      if (e.message?.includes('UNIQUE')) {
        skipped++;
      } else {
        console.warn(`[ingest:${keyword}] Insert failed (${video.videoId}):`, e.message);
      }
    }
  }

  console.log(`[ingest:${keyword}] fetched=${fetched} inserted=${inserted} skipped=${skipped}`);
  return { fetched, inserted, skipped };
}

async function runIngestCycle() {
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY) {
    console.warn('[ingest] YT_API_KEY not set — skipping');
    return { fetched: 0, inserted: 0, skipped: 0 };
  }

  console.log(`[ingest] Starting cycle — ${KEYWORDS.length} keywords, ${PAGES_PER_KEYWORD} pages each`);
  let totalFetched = 0, totalInserted = 0, totalSkipped = 0;

  for (const keyword of KEYWORDS) {
    const r = await ingestByKeyword(keyword);
    totalFetched  += r.fetched;
    totalInserted += r.inserted;
    totalSkipped  += r.skipped;
    await sleep(1000); // 1s between keywords
  }

  const db = getDb();
  const { total } = db.get('SELECT COUNT(*) AS total FROM videos');
  const { ready } = db.get('SELECT COUNT(*) AS ready FROM performance_metrics WHERE training_ready=1');

  console.log(`[ingest] Cycle complete — fetched=${totalFetched} inserted=${totalInserted} skipped=${totalSkipped}`);
  console.log(`[ingest] DB totals — videos=${total} training_ready=${ready}`);

  return { fetched: totalFetched, inserted: totalInserted, skipped: totalSkipped };
}

function startIngestCron() {
  cron.schedule('0 2 * * *', async () => {
    try { await runIngestCycle(); }
    catch (e) { console.error('[ingest] Cron error:', e.message); }
  });
  console.log('[Ingest Cron] Scheduled — daily at 02:00 UTC');
}

module.exports = { startIngestCron, runIngestCycle, ingestByKeyword };
