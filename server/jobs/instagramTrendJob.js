'use strict';

// Instagram trend engine — the SAME video-grounded method as YouTube, applied to Reels. Topics are
// phrases many DISTINCT accounts use in the same window; adoption (accounts now vs prior) + momentum
// (avg plays) score them via the shared scoreTopic. Two IG-specific choices: (1) HASHTAGS are treated
// as first-class tokens — on IG a hashtag is a cleaner topic label than a caption, so we fold them into
// the token stream; (2) adoption counts distinct ACCOUNTS (usernames), the IG analogue of distinct
// channels. Writes `instagram_trend_signals` (mirrors video_trend_signals) + a per-topic first_seen so
// the cross-platform lead job can measure how far IG is ahead of YouTube.

const { getDb } = require('../db/init');
const { tokenize, phrasesOf, scoreTopic, resolveNiche, titleCase } = require('./videoTrendJob');
const { classifyTopicNiche } = require('./trendSignalJob');

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS instagram_trend_signals (
    topic TEXT PRIMARY KEY, niche TEXT, region TEXT,
    account_count_now INTEGER, account_count_prior INTEGER, media_count INTEGER,
    avg_plays INTEGER, accel_pct INTEGER, signal_score INTEGER, signal_tier TEXT,
    samples_json TEXT, first_seen TEXT, computed_at TEXT
  )`);
}

// IG-specific CTA/engagement cruft on TOP of the shared PHRASE_STOP (which already drops subscribe/
// link/bio/reels/trending). Reels captions are dense with "save this post", "follow for more", "dm to
// buy", "turn on notifications" — none of which name a topic. Filtered after the shared tokenizer.
const IG_STOP = new Set([
  'save', 'post', 'posts', 'follow', 'follows', 'follower', 'followers', 'following', 'unfollow',
  'notification', 'notifications', 'bell', 'turn', 'repost', 'reshare', 'collab', 'collaboration',
  'giveaway', 'contest', 'win', 'winner', 'join', 'sign', 'app', 'download', 'install', 'click', 'tap',
  'below', 'caption', 'captions', 'hashtag', 'hashtags', 'insta', 'instagram', 'reelitfeelit', 'trending',
  'account', 'profile', 'page', 'story', 'stories', 'highlight', 'highlights', 'dm', 'inbox', 'message',
]);
// hashtags become tokens too (split camel/hashtag words already handled by tokenize's non-letter split).
function tokensFor(row) {
  const tags = (() => { try { return JSON.parse(row.hashtags_json || '[]'); } catch { return []; } })();
  return tokenize(`${row.caption || ''} ${tags.join(' ')}`).filter(t => !IG_STOP.has(t));
}

async function runInstagramTrendJob(opts = {}) {
  const db = getDb();
  const start = Date.now();
  const runStart = db.get("SELECT datetime('now') AS t").t;
  // Hashtag-level scraping returns captions/authors/timestamps but usually NOT view or like counts
  // (Instagram hides those outside per-post fetches), so a play-count threshold would drop everything.
  // The IG trend signal is therefore ADOPTION-driven: a topic = many DISTINCT accounts posting the same
  // phrase in the window. minPlays defaults to 0 (include all) and only bites if a richer actor later
  // supplies real metrics; momentum then uses whatever plays exist (0 → contributes nothing, harmless).
  const MINPLAYS = opts.minPlays ?? 0;
  const MINACCT = opts.minAccounts ?? 4;
  ensureSchema(db);

  // now window (0–14d) vs prior (14–28d): Reels move faster than long-form, so the windows are tighter.
  const nowDays = opts.nowDays ?? 14, priorDays = opts.priorDays ?? 28;
  const now = db.all(
    `SELECT media_id id, username, caption, hashtags_json, play_count, niche, region, taken_at
       FROM instagram_media WHERE taken_at > datetime('now','-${nowDays} days') AND play_count >= ?`, [MINPLAYS]);
  const prior = db.all(
    `SELECT username, caption, hashtags_json FROM instagram_media
       WHERE taken_at BETWEEN datetime('now','-${priorDays} days') AND datetime('now','-${nowDays} days') AND play_count >= ?`, [MINPLAYS]);
  console.log(`[igTrend] now-window media: ${now.length}, prior: ${prior.length}`);

  const idx = new Map(); // phrase -> { accts:Set, media:[], nCount:{}, rCount:{}, firstSeen }
  for (const m of now) {
    const seen = new Set();
    for (const p of phrasesOf(tokensFor(m))) {
      if (seen.has(p)) continue; seen.add(p);
      let e = idx.get(p);
      if (!e) { e = { accts: new Set(), media: [], mediaIds: new Set(), nCount: {}, rCount: {}, firstSeen: m.taken_at }; idx.set(p, e); }
      e.accts.add(m.username);
      if (e.media.length < 40) e.media.push(m);
      if (e.mediaIds.size < 200) e.mediaIds.add(m.id);
      e.nCount[m.niche] = (e.nCount[m.niche] || 0) + 1;
      e.rCount[m.region] = (e.rCount[m.region] || 0) + 1;
      if (m.taken_at < e.firstSeen) e.firstSeen = m.taken_at;
    }
  }
  for (const [p, e] of idx) if (e.accts.size < MINACCT) idx.delete(p);

  const priorAcct = new Map();
  for (const m of prior) {
    const seen = new Set();
    for (const p of phrasesOf(tokensFor(m))) {
      if (seen.has(p) || !idx.has(p)) continue; seen.add(p);
      let s = priorAcct.get(p); if (!s) { s = new Set(); priorAcct.set(p, s); } s.add(m.username);
    }
  }

  const rows = [...idx.entries()].map(([topic, e]) => {
    const nNow = e.accts.size;
    const nPrior = priorAcct.get(topic)?.size || 0;
    const accel = nPrior > 0 ? (nNow - nPrior) / nPrior : (nNow >= MINACCT ? 1 : 0);
    const avgPlays = Math.round(e.media.reduce((s, m) => s + (m.play_count || 0), 0) / e.media.length);
    const score = scoreTopic(nNow, accel, avgPlays);
    const tier = nPrior === 0 && nNow >= MINACCT ? 'rising'
      : score >= 70 ? 'rising' : score >= 50 ? 'emerging' : score >= 35 ? 'stable' : 'noise';
    const niche = resolveNiche(classifyTopicNiche(topic), e.nCount);
    const region = Object.entries(e.rCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'IN';
    const samples = e.media.sort((a, b) => b.play_count - a.play_count).slice(0, 6)
      .map(m => ({ caption: (m.caption || '').slice(0, 120), plays: m.play_count, username: m.username, media_id: m.id }));
    return { topic, words: topic.split(' '), mediaIds: e.mediaIds, niche, region, nNow, nPrior,
      media_count: e.media.length, avgPlays, accel_pct: Math.round(accel * 100), score, tier, samples, firstSeen: e.firstSeen };
  }).filter(r => r.tier !== 'noise').sort((a, b) => b.score - a.score || b.nNow - a.nNow);

  // Same-event merge (ported from the YouTube engine): collapse fragments of ONE topic — "current
  // affairs" / "daily current" / "daily current affairs" — into the single strongest phrase, so a
  // topic isn't shattered across near-duplicate rows. A stemmed token index means each phrase is
  // compared only against already-kept phrases that SHARE A WORD; two merge when one is a token-subset
  // of the other OR they were extracted from the SAME posts (media-id overlap), which keeps genuinely
  // distinct same-word topics apart.
  const stem = w => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w;
  const kept = [];
  const tokenIdx = new Map();
  for (const e of rows) {
    const eStems = [...new Set(e.words.map(stem))];
    const cand = new Set();
    for (const s of eStems) { const arr = tokenIdx.get(s); if (arr) for (const k of arr) cand.add(k); }
    let merged = false;
    for (const k of cand) {
      const kStems = new Set(k.words.map(stem));
      const small = eStems.length <= kStems.size ? eStems : [...kStems];
      const big = eStems.length <= kStems.size ? kStems : new Set(eStems);
      let n = 0; for (const w of small) if (big.has(w)) n++;
      if (n === small.length) { merged = true; break; }
      let shared = 0; for (const id of e.mediaIds) if (k.mediaIds.has(id)) shared++;
      if (shared >= 2 && shared / Math.min(e.mediaIds.size, k.mediaIds.size) >= 0.3) { merged = true; break; }
    }
    if (!merged) { kept.push(e); for (const s of eStems) { let arr = tokenIdx.get(s); if (!arr) { arr = []; tokenIdx.set(s, arr); } arr.push(e); } }
  }

  const ins = `INSERT OR REPLACE INTO instagram_trend_signals
    (topic, niche, region, account_count_now, account_count_prior, media_count, avg_plays, accel_pct, signal_score, signal_tier, samples_json, first_seen, computed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`;
  const tx = db.transaction(() => {
    for (const r of kept) db.run(ins, [titleCase(r.topic), r.niche, r.region, r.nNow, r.nPrior, r.media_count, r.avgPlays, r.accel_pct, r.score, r.tier, JSON.stringify(r.samples), r.firstSeen]);
  });
  tx();
  db.run(`DELETE FROM instagram_trend_signals WHERE computed_at < ?`, [runStart]);

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[igTrend] Wrote ${kept.length} topics (merged ${rows.length - kept.length} fragments) in ${secs}s`);
  return { topics: kept.length, merged: rows.length - kept.length, duration_s: parseFloat(secs) };
}

module.exports = { runInstagramTrendJob, ensureSchema };
