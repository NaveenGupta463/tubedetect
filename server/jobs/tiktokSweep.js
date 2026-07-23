'use strict';

// TikTok trend ingestion — the strongest LEADING indicator. Pulls TikTok Creative Center's official
// ranked trending hashtags for WESTERN regions (US/UK by default); each hashtag is a topic that, per
// the well-worn West→India pipeline, tends to reach Indian Reels/Shorts weeks later. Tiny pulls (ranked
// lists, not media) via the vendor-agnostic provider (default mock → keyless). Writes `tiktok_trends`.

const { getDb } = require('../db/init');
const { getTikTokProvider } = require('../services/tiktok/provider');

const DEFAULT_REGIONS = ['US', 'GB'];

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS tiktok_trends (
    hashtag TEXT, region TEXT, rank INTEGER, industry TEXT,
    post_count INTEGER, video_views INTEGER, trend_direction TEXT,
    window_days INTEGER, fetched_at TEXT,
    PRIMARY KEY (hashtag, region, window_days)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tt_region ON tiktok_trends(region)`);
}

async function runTikTokSweep(opts = {}) {
  const db = getDb();
  const start = Date.now();
  ensureSchema(db);
  const provider = getTikTokProvider(opts.provider);
  const regions = opts.regions || DEFAULT_REGIONS;
  const window = opts.window ?? 7;
  const limit = opts.limit ?? 100;

  const ins = `INSERT OR REPLACE INTO tiktok_trends
    (hashtag, region, rank, industry, post_count, video_views, trend_direction, window_days, fetched_at)
    VALUES (?,?,?,?,?,?,?,?, datetime('now'))`;

  let fetched = 0, errors = 0;
  for (const region of regions) {
    let trends = [];
    try { trends = await provider.trendingHashtags(region, { window, limit }); }
    catch (e) { errors++; console.warn(`[tiktokSweep] ${region}: ${e.message}`); continue; }
    const tx = db.transaction(() => {
      for (const t of trends) db.run(ins, [t.hashtag.toLowerCase(), region, t.rank | 0, t.industry || null,
        t.post_count | 0, t.video_views | 0, t.trend_direction || null, window]);
    });
    tx();
    fetched += trends.length;
  }
  // prune trends not refreshed this run (stale rank lists)
  db.run(`DELETE FROM tiktok_trends WHERE fetched_at < datetime('now','-3 days')`);

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[tiktokSweep] fetched ${fetched} trending hashtags across ${regions.length} regions (${errors} errors) in ${secs}s`);
  return { fetched, regions: regions.length, errors, duration_s: parseFloat(secs) };
}

module.exports = { runTikTokSweep, ensureSchema, DEFAULT_REGIONS };
