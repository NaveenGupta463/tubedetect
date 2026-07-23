'use strict';

// Instagram ingestion — the leading-indicator corpus. Thesis: a format/topic usually blows up on
// Reels BEFORE it reaches YouTube, so IG coverage is an early-warning feed for the YouTube-based trend
// engine + WTP. Seeded HASHTAGS-FIRST (cheapest, cleanest topic signal, no handle-mapping needed); a
// later pass can add per-creator handle sweeps for richer niche/region. All data comes through the
// vendor-agnostic provider (default mock → keyless), so this runs today with zero spend and swaps to a
// paid key by setting INSTAGRAM_PROVIDER + the key.

const { getDb } = require('../db/init');
const { getProvider } = require('../services/instagram/provider');

// niche → seed hashtags. Starter set; intended to grow (and eventually be derived from the same niche
// taxonomy the YouTube engine uses). Keep lists tight — every hashtag is a paid request per sweep.
const SEED_HASHTAGS = {
  education:     ['upsc', 'neet', 'jee'],
  food:          ['streetfood', 'indianstreetfood', 'foodie'],
  fitness:       ['fitnessmotivation', 'homeworkout'],
  technology:    ['techreels', 'smartphone'],
  entertainment: ['reelsindia', 'comedyreels'],
  sports:        ['cricket', 'ipl'],
  finance:       ['stockmarket', 'sharemarket'],
  health:        ['guthealth', 'wellness'],
};

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS instagram_media (
    media_id TEXT PRIMARY KEY, username TEXT, caption TEXT, hashtags_json TEXT,
    play_count INTEGER, like_count INTEGER, comment_count INTEGER,
    taken_at TEXT, niche TEXT, region TEXT, source_hashtag TEXT, fetched_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ig_media_taken ON instagram_media(taken_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ig_media_niche ON instagram_media(niche)`);
}

async function runInstagramSweep(opts = {}) {
  const db = getDb();
  const start = Date.now();
  ensureSchema(db);
  const provider = getProvider(opts.provider);
  const limit = opts.limit ?? 50;
  const sinceDays = opts.sinceDays ?? 14;
  const seeds = opts.seedHashtags || SEED_HASHTAGS;
  const region = opts.region || 'IN';

  const ins = `INSERT OR REPLACE INTO instagram_media
    (media_id, username, caption, hashtags_json, play_count, like_count, comment_count, taken_at, niche, region, source_hashtag, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`;

  let fetched = 0, tags = 0, errors = 0;
  for (const [niche, hashtags] of Object.entries(seeds)) {
    for (const tag of hashtags) {
      tags++;
      let media = [];
      try { media = await provider.recentByHashtag(tag, { limit, sinceDays }); }
      catch (e) { errors++; console.warn(`[igSweep] ${tag}: ${e.message}`); continue; }
      const tx = db.transaction(() => {
        for (const m of media) {
          db.run(ins, [m.media_id, m.username, m.caption || '', JSON.stringify(m.hashtags || []),
            m.play_count | 0, m.like_count | 0, m.comment_count | 0, m.taken_at, niche, region, tag]);
        }
      });
      tx();
      fetched += media.length;
    }
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[igSweep] fetched ${fetched} media across ${tags} hashtags (${errors} errors) in ${secs}s`);
  return { fetched, hashtags: tags, errors, duration_s: parseFloat(secs) };
}

module.exports = { runInstagramSweep, SEED_HASHTAGS, ensureSchema };
