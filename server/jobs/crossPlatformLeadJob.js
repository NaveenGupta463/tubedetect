'use strict';

// Cross-platform LEAD signal — the whole point of ingesting Instagram. For each strong IG topic, check
// whether it has reached the YouTube corpus yet:
//   • absent on YouTube  → status 'early_on_instagram' = a HEAD START (make it before it lands on YT).
//   • present on YouTube → status 'both' + lead_days (how long IG was ahead), using IG first_seen vs the
//     topic's first YouTube flag (video_trend_outcomes.flagged_at, the earliest we saw it rising there).
// This mirrors the existing "Coming to India" foreign-lead feature, but cross-PLATFORM instead of
// cross-country. Feeds a "🚀 Early on Instagram" surface + WTP idea candidates. Writes `platform_lead_signals`.

const { getDb } = require('../db/init');

// normalized topic key = sorted significant tokens, so "Cortisol Detox" ≈ "detox cortisol". Cheap,
// good enough for scaffold; a later pass can add fuzzy/stemmed matching for near-duplicates.
function keyOf(topic) {
  return String(topic || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w.length > 2).sort().join(' ');
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_lead_signals (
    topic TEXT PRIMARY KEY, niche TEXT, region TEXT,
    ig_score INTEGER, ig_accounts INTEGER, ig_first_seen TEXT,
    yt_score INTEGER, yt_channels INTEGER, yt_first_seen TEXT,
    lead_days INTEGER, status TEXT, computed_at TEXT
  )`);
}

function runCrossPlatformLead(opts = {}) {
  const db = getDb();
  const start = Date.now();
  ensureSchema(db);

  const ig = db.all(`SELECT topic, niche, region, signal_score, account_count_now, first_seen, signal_tier
                       FROM instagram_trend_signals WHERE signal_tier IN ('rising','emerging')`);

  // YouTube side: current topic strengths + the earliest we ever flagged each topic (first-seen proxy).
  const yt = db.all(`SELECT topic, signal_score, channel_count_now FROM video_trend_signals`);
  const ytFirst = db.all(`SELECT topic, MIN(flagged_at) f FROM video_trend_outcomes GROUP BY topic`);
  const ytByKey = new Map();
  for (const r of yt) ytByKey.set(keyOf(r.topic), r);
  const ytFirstByKey = new Map();
  for (const r of ytFirst) ytFirstByKey.set(keyOf(r.topic), r.f);

  const ins = `INSERT OR REPLACE INTO platform_lead_signals
    (topic, niche, region, ig_score, ig_accounts, ig_first_seen, yt_score, yt_channels, yt_first_seen, lead_days, status, computed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`;

  let early = 0, both = 0;
  const rows = [];
  const tx = db.transaction(() => {
    db.run(`DELETE FROM platform_lead_signals`);
    for (const t of ig) {
      const k = keyOf(t.topic);
      const ytHit = ytByKey.get(k);
      const ytF = ytFirstByKey.get(k);
      let status, leadDays = null, ytScore = null, ytCh = null;
      if (!ytHit) { status = 'early_on_instagram'; early++; }
      else {
        status = 'both'; both++; ytScore = ytHit.signal_score; ytCh = ytHit.channel_count_now;
        if (ytF && t.first_seen) leadDays = Math.round((new Date(ytF) - new Date(t.first_seen)) / 864e5);
      }
      db.run(ins, [t.topic, t.niche, t.region, t.signal_score, t.account_count_now, t.first_seen, ytScore, ytCh, ytF || null, leadDays, status]);
      rows.push({ topic: t.topic, niche: t.niche, status, ig: t.account_count_now, leadDays, ytCh });
    }
  });
  tx();

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[xPlatform] ${early} early-on-instagram, ${both} on both platforms (${secs}s)`);
  return { early_on_instagram: early, both, rows, duration_s: parseFloat(secs) };
}

module.exports = { runCrossPlatformLead, keyOf, ensureSchema };
