'use strict';

// Cross-platform LEAD signal — the whole point of ingesting Instagram + TikTok. India YouTube is the
// DESTINATION; Instagram (India) and TikTok (US/UK) are UPSTREAM. For each upstream topic we check
// whether it has reached the YouTube corpus yet, and emit an opportunity:
//   • TikTok(West) hashtag absent from India YT & IG → 'coming_from_tiktok'  (longest lead — make it first)
//   • TikTok(West) hashtag already on India IG but not YT → 'coming_from_tiktok_and_ig' (mid-pipeline, hot)
//   • IG(India) topic absent from YT → 'early_on_instagram'  (short lead)
//   • IG(India) topic also on YT → 'both' + lead_days (IG first_seen vs YouTube first flag)
// Mirrors the "Coming to India" foreign-lead feature, but cross-PLATFORM. Feeds a head-start surface +
// WhatToPost idea candidates. Writes `platform_lead_signals`.

const { getDb } = require('../db/init');

// two normalizers: keyOf = sorted significant tokens (multi-word topics, "Cortisol Detox"≈"detox cortisol");
// concatKey = all alphanumerics glued, so a TikTok hashtag "loudbudgeting" matches a YT topic "Loud Budgeting".
function keyOf(topic) {
  return String(topic || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2).sort().join(' ');
}
function concatKey(topic) { return String(topic || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
// TikTok hashtags are single glued words ("worldcup"); YouTube topics are compound after entity-merge
// ("World Cup Final" → "worldcupfinal"), so exact concat-match misses them. Match by CONTAINMENT with a
// length guard so short tags ("ipl","ai") don't false-match inside unrelated words.
function concatMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 6 && b.includes(a)) return true; // topic contains the hashtag ("worldcupfinal" ⊃ "worldcup")
  if (b.length >= 6 && a.includes(b)) return true;
  return false;
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_lead_signals (
    topic TEXT PRIMARY KEY, niche TEXT, region TEXT,
    ig_score INTEGER, ig_accounts INTEGER, ig_first_seen TEXT,
    yt_score INTEGER, yt_channels INTEGER, yt_first_seen TEXT,
    lead_days INTEGER, status TEXT, computed_at TEXT
  )`);
  for (const c of ['source TEXT', 'upstream_strength INTEGER', 'source_detail TEXT']) {
    try { db.exec(`ALTER TABLE platform_lead_signals ADD COLUMN ${c}`); } catch (_) {}
  }
}

function runCrossPlatformLead(opts = {}) {
  const db = getDb();
  const start = Date.now();
  ensureSchema(db);

  // ── YouTube (destination) lookups ──
  const yt = db.all(`SELECT topic, signal_score, channel_count_now FROM video_trend_signals`);
  const ytFirst = db.all(`SELECT topic, MIN(flagged_at) f FROM video_trend_outcomes GROUP BY topic`);
  const ytByKey = new Map();
  const ytConcats = [];
  for (const r of yt) { ytByKey.set(keyOf(r.topic), r); ytConcats.push(concatKey(r.topic)); }
  const ytFirstByKey = new Map();
  for (const r of ytFirst) ytFirstByKey.set(keyOf(r.topic), r.f);
  const inYouTube = ck => ck.length >= 4 && ytConcats.some(k => concatMatch(ck, k));

  // ── Instagram (India, upstream) ──
  const ig = db.all(`SELECT topic, niche, region, signal_score, account_count_now, first_seen FROM instagram_trend_signals WHERE signal_tier IN ('rising','emerging')`);
  const igList = ig.map(r => ({ ...r, ck: concatKey(r.topic) }));
  const findIg = ck => ck.length >= 4 ? igList.find(r => concatMatch(ck, r.ck)) : null;

  // ── TikTok (West, upstream) ── strongest lead; only if the table exists
  let tt = [];
  try { tt = db.all(`SELECT hashtag, region, industry, post_count FROM tiktok_trends`); } catch (_) {}

  const ins = `INSERT OR REPLACE INTO platform_lead_signals
    (topic, niche, region, ig_score, ig_accounts, ig_first_seen, yt_score, yt_channels, yt_first_seen, lead_days, status, source, upstream_strength, source_detail, computed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`;

  let early = 0, both = 0, fromTiktok = 0;
  const rows = [];
  const tx = db.transaction(() => {
    db.run(`DELETE FROM platform_lead_signals`);

    // Instagram → YouTube
    for (const t of ig) {
      const k = keyOf(t.topic);
      const ytHit = ytByKey.get(k), ytF = ytFirstByKey.get(k);
      let status, leadDays = null, ytScore = null, ytCh = null;
      if (!ytHit) { status = 'early_on_instagram'; early++; }
      else { status = 'both'; both++; ytScore = ytHit.signal_score; ytCh = ytHit.channel_count_now; if (ytF && t.first_seen) leadDays = Math.round((new Date(ytF) - new Date(t.first_seen)) / 864e5); }
      db.run(ins, [t.topic, t.niche, t.region, t.signal_score, t.account_count_now, t.first_seen, ytScore, ytCh, ytF || null, leadDays, status, 'instagram', t.account_count_now, null]);
      rows.push({ topic: t.topic, niche: t.niche, status, strength: t.account_count_now, ytCh, source: 'instagram' });
    }

    // TikTok(West) → India (YT + IG). Dedup regions: keep the strongest post_count per hashtag.
    const ttByTag = new Map();
    for (const r of tt) { const cur = ttByTag.get(r.hashtag); if (!cur || (r.post_count || 0) > (cur.post_count || 0)) ttByTag.set(r.hashtag, r); }
    for (const r of ttByTag.values()) {
      const ck = concatKey(r.hashtag);
      if (inYouTube(ck)) continue; // already on India YouTube → not a head start
      const onIg = findIg(ck);
      const status = onIg ? 'coming_from_tiktok_and_ig' : 'coming_from_tiktok';
      fromTiktok++;
      const niche = r.industry || (onIg && onIg.niche) || 'general';
      // topic label: prefer the IG match's clean multi-word name, else the raw hashtag
      const topic = onIg ? onIg.topic : r.hashtag;
      db.run(ins, [topic, niche, r.region, null, null, null, null, null, null, null, status, 'tiktok', r.post_count, r.industry || null]);
      rows.push({ topic, niche, status, strength: r.post_count, ytCh: null, source: 'tiktok', region: r.region });
    }
  });
  tx();

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[xPlatform] ${early} early-on-instagram, ${both} on both, ${fromTiktok} coming-from-tiktok (${secs}s)`);
  return { early_on_instagram: early, both, coming_from_tiktok: fromTiktok, rows, duration_s: parseFloat(secs) };
}

module.exports = { runCrossPlatformLead, keyOf, concatKey, ensureSchema };
