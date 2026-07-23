'use strict';

// VIDEO-GROUNDED trend engine. The legacy trendSignalJob keys off channel_topics (a channel's
// AI-summary topics), so trends inherit a channel's ENTIRE viral output regardless of the specific
// video (a general-news channel tagged "public safety incidents" pollutes that trend with its Khan
// Sir court-drama hit). This engine instead derives topics from actual VIDEO TITLES: specific
// multi-word phrases covered by many DISTINCT channels in the window. Because a phrase is literally
// in the title, (a) example videos always match, (b) a channel's hit only counts for phrases in ITS
// title, and (c) niche/region are read from the matching videos. Writes `video_trend_signals`.

const { getDb } = require('../db/init');
const { classifyTopicNiche } = require('./trendSignalJob');
const OpenAI = require('openai');
const CANON_MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
let _aiClient = null;
function _ai() { if (_aiClient) return _aiClient; const k = process.env.OPENAI_API_KEY; if (!k) return null; _aiClient = new OpenAI({ apiKey: k }); return _aiClient; }

// LLM canonicalization — the durable fix for DIFFUSE-topic fragmentation the heuristic merge can't
// solve (Father's Day = "father day"/"happy fathers"/"day dad", spread across different videos). An
// LLM understands these are one topic while "Narendra Modi" ≠ "Lalit Modi". Runs over the top ~200
// (the only rows users ever see); keeps the strongest phrase per group and drops the rest. Cheap
// (1 call/run), best-effort (never breaks the job).
const CANON_SYS = `You clean a list of trending YouTube "topic" phrases. Do TWO things:
1. MERGE fragments of ONE real-world topic/event (e.g. "father day","happy fathers","day dad","first father" = Father's Day; several actor names may all be one movie). But keep phrases that merely SHARE A WORD but are DISTINCT (e.g. "narendra modi" vs "lalit modi" are different people; "india women" vs "india got latent" differ).
2. DROP phrases that are NOT real topics at all: calls-to-action / promo cruft ("link bio","out now","dm to buy","use code"), pure generic filler that names no subject ("coming soon","each other","really good","reality check","first day"), or platform noise. A real topic names a specific person, event, product, place, show, or subject.
Return ONLY JSON: {"merge":[{"canonical":"<clean topic name>","members":["<exact input phrase>",...]}], "drop":["<exact input phrase>",...]}. Only merge groups with 2+ members that are truly the same topic. Use phrases EXACTLY as given. Never invent phrases.`;

async function canonicalizeTopTrends(db) {
  const client = _ai();
  if (!client) return { merged: 0, reason: 'no_openai_key' };
  const rows = db.all(`SELECT topic FROM video_trend_signals ORDER BY signal_score DESC, channel_count_now DESC LIMIT 200`);
  if (rows.length < 10) return { merged: 0 };
  const list = rows.map(r => r.topic);
  let resp;
  try {
    resp = await Promise.race([
      client.chat.completions.create({ model: CANON_MODEL, max_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: CANON_SYS }, { role: 'user', content: 'Phrases:\n' + list.map((t, i) => `${i + 1}. ${t}`).join('\n') }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000)),
    ]);
  } catch (e) { console.warn('[videoTrend] canonicalize skipped:', e.message); return { merged: 0, err: e.message }; }
  const raw = resp.choices?.[0]?.message?.content || '';
  const mm = raw.match(/\{[\s\S]*\}/);
  if (!mm) { console.warn(`[videoTrend] canonicalize: no JSON in response (len=${raw.length}, finish=${resp.choices?.[0]?.finish_reason})`); return { merged: 0 }; }
  let parsed; try { parsed = JSON.parse(mm[0]); } catch (e) { console.warn(`[videoTrend] canonicalize: JSON parse failed (${e.message}, len=${raw.length}, finish=${resp.choices?.[0]?.finish_reason})`); return { merged: 0 }; }
  const groups = Array.isArray(parsed.merge) ? parsed.merge : [];
  const dropList = Array.isArray(parsed.drop) ? parsed.drop : [];
  const valid = new Map(list.map(s => [s.toLowerCase(), s]));
  let merged = 0, dropped = 0;
  const tx = db.transaction(() => {
    // Drop non-topics (CTA/filler) the model flagged.
    for (const d of dropList) {
      const real = valid.get(String(d).toLowerCase());
      if (real) { db.run(`DELETE FROM video_trend_signals WHERE topic = ?`, [real]); dropped++; }
    }
    for (const g of groups) {
      if (!g || !Array.isArray(g.members) || g.members.length < 2) continue;
      const mem = [...new Set(g.members.map(x => valid.get(String(x).toLowerCase())).filter(Boolean))];
      if (mem.length < 2) continue;
      const ph = mem.map(() => '?').join(',');
      const memRows = db.all(`SELECT topic, channel_count_now, signal_score FROM video_trend_signals WHERE topic IN (${ph})`, mem);
      if (memRows.length < 2) continue;
      memRows.sort((a, b) => b.channel_count_now - a.channel_count_now || b.signal_score - a.signal_score);
      const survivor = memRows[0].topic;
      for (const r of memRows.slice(1)) db.run(`DELETE FROM video_trend_signals WHERE topic = ?`, [r.topic]), merged++;
      // rename survivor to a clean canonical name if it doesn't collide with an existing row
      const canon = String(g.canonical || survivor).trim().slice(0, 70);
      if (canon && canon.toLowerCase() !== survivor.toLowerCase() && !db.get(`SELECT 1 FROM video_trend_signals WHERE topic = ?`, [canon])) {
        db.run(`UPDATE video_trend_signals SET topic = ? WHERE topic = ?`, [canon, survivor]);
        // The clean canonical name is often MORE classifiable than the raw phrase the niche was
        // computed from (e.g. "argentina switzerland" → "Argentina Football Matches" = sports). If the
        // renamed topic now matches a niche keyword, adopt it (only ever sharpens 'general'/'other').
        const rn = classifyTopicNiche(canon);
        if (rn && rn !== 'other') db.run(`UPDATE video_trend_signals SET niche = ? WHERE topic = ?`, [rn, canon]);
      }
    }
  });
  tx();
  console.log(`[videoTrend] LLM canonicalization: merged ${merged} fragment rows, dropped ${dropped} non-topics`);
  return { merged, dropped };
}

// The niche filter set exposed in the UI (must stay in sync with NICHES in TrendDetection.jsx).
const NICHE_SET = ['politics','news','entertainment','education','technology','finance','business','sports','music','lifestyle','gaming','health','fitness','food','travel','comedy','science','philosophy'];
const NICHE_SYS = `You label YouTube trending topics with ONE content niche for an Indian-audience creator tool.
Given a list of topic phrases, assign each to exactly one niche from this set:
${NICHE_SET.join(', ')}.
Prefer a SPECIFIC niche when the topic clearly belongs to one: a footballer/cricketer/UFC fighter → sports; a politician/bill/election → politics; a food brand/dish → food; a movie/actor/TV show → entertainment; a phone/AI/gadget → technology; a stock/crypto/economy topic → finance. Use "general" ONLY when the topic is genuinely cross-niche with no dominant category (a viral challenge or format anyone in any niche makes).
Return ONLY JSON: {"map":{"<exact input phrase>":"<niche>", ...}}. Include ONLY phrases you can confidently assign to a SPECIFIC niche (omit any that should stay general). Use phrases EXACTLY as given.`;

// LLM niche pass — the durable fix for topics the keyword classifier + channel-plurality fallback
// can't name, which land in 'general' (proper-noun entities: "Messi"→sports, "Mitch McConnell"→
// politics, "Krispy Kreme"→food). Sends the visible 'general' topics to the LLM to assign a specific
// niche where it's confident, else leaves them 'general'. One call/run, best-effort.
async function nicheGeneralTopics(db) {
  const client = _ai();
  if (!client) return { relabeled: 0, reason: 'no_openai_key' };
  const rows = db.all(`SELECT topic FROM video_trend_signals WHERE niche = 'general' AND signal_tier IN ('rising','emerging','stable') ORDER BY signal_score DESC, channel_count_now DESC LIMIT 300`);
  if (!rows.length) return { relabeled: 0 };
  const list = rows.map(r => r.topic);
  let resp;
  try {
    resp = await Promise.race([
      client.chat.completions.create({ model: CANON_MODEL, max_tokens: 6000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: NICHE_SYS }, { role: 'user', content: 'Topics:\n' + list.map((t, i) => `${i + 1}. ${t}`).join('\n') }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 90000)),
    ]);
  } catch (e) { console.warn('[videoTrend] niche-pass skipped:', e.message); return { relabeled: 0, err: e.message }; }
  const raw = resp.choices?.[0]?.message?.content || '';
  const mm = raw.match(/\{[\s\S]*\}/);
  if (!mm) { console.warn(`[videoTrend] niche-pass: no JSON (finish=${resp.choices?.[0]?.finish_reason})`); return { relabeled: 0 }; }
  let parsed; try { parsed = JSON.parse(mm[0]); } catch (e) { console.warn(`[videoTrend] niche-pass: parse failed (${e.message}, finish=${resp.choices?.[0]?.finish_reason})`); return { relabeled: 0 }; }
  const map = parsed.map && typeof parsed.map === 'object' ? parsed.map : {};
  const allowed = new Set(NICHE_SET);
  const valid = new Map(list.map(s => [s.toLowerCase(), s])); // guard: only relabel phrases we actually sent
  let relabeled = 0;
  const tx = db.transaction(() => {
    for (const [phrase, niche] of Object.entries(map)) {
      const real = valid.get(String(phrase).toLowerCase());
      const n = String(niche).toLowerCase().trim();
      if (real && allowed.has(n)) { db.run(`UPDATE video_trend_signals SET niche = ? WHERE topic = ? AND niche = 'general'`, [n, real]); relabeled++; }
    }
  });
  tx();
  console.log(`[videoTrend] LLM niche pass: relabeled ${relabeled}/${list.length} 'general' topics`);
  return { relabeled };
}

// Ground-truth accuracy loop for THIS engine (video_trend_signals). Flags every rising/emerging
// topic the first time it's seen, then 30 days later videoTrendOutcomeJob checks whether it actually
// held up — giving a real confirm-rate to calibrate tiers/thresholds against, instead of manual
// spot-checks. Dedupes against topics already pending evaluation so a topic isn't re-flagged every
// run while it stays rising.
function flagNewTrendsForOutcomeTracking(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS video_trend_outcomes (
    topic TEXT, niche TEXT, flagged_at TEXT, signal_tier TEXT, signal_score INTEGER,
    channel_count_at_flag INTEGER, video_count_at_flag INTEGER, niche_spread_at_flag INTEGER,
    channel_count_60d_later INTEGER, adoption_change_pct REAL, outcome_confirmed INTEGER, evaluated_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vto_pending ON video_trend_outcomes(evaluated_at, flagged_at)`);

  const trackedKeys = new Set(
    db.all(`SELECT topic || '||' || niche AS key FROM video_trend_outcomes WHERE evaluated_at IS NULL`)
      .map(r => r.key)
  );
  const toLog = db.all(
    `SELECT topic, niche, signal_tier, signal_score, channel_count_now, video_count, niche_spread
     FROM video_trend_signals WHERE signal_tier IN ('rising','emerging')`
  ).filter(s => !trackedKeys.has(`${s.topic}||${s.niche}`));

  if (toLog.length > 0) {
    const logSql = `INSERT INTO video_trend_outcomes
      (topic, niche, flagged_at, signal_tier, signal_score, channel_count_at_flag, video_count_at_flag, niche_spread_at_flag)
      VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`;
    const tx = db.transaction(() => {
      for (const s of toLog) db.run(logSql, [s.topic, s.niche, s.signal_tier, s.signal_score, s.channel_count_now, s.video_count, s.niche_spread]);
    });
    tx();
  }
  console.log(`[videoTrend] Outcome tracking: ${toLog.length} new topics logged`);
}

const PHRASE_STOP = new Set([
  'the','a','an','and','or','but','not','for','of','to','in','on','at','by','from','with','as','is',
  'are','was','were','be','been','this','that','these','those','it','its','his','her','their','our',
  'your','my','into','about','over','after','before','new','latest','breaking','live','today','update',
  'updates','full','video','episode','part','series','watch','big','top','best','why','how','what',
  'when','will','shorts','short','viral','ft','feat','official','song','video','vlog','status',
  // function words that must never anchor a topic phrase (kills fragments like "during world",
  // "when india", "after match" so the clean content phrase — "world cup" — surfaces instead)
  'during','while','where','which','who','whom','whose','than','then','out','off','via','amid',
  'despite','without','within','between','among','through','across','against','toward','towards',
  'since','until','unless','because','although','though','whether','being','having','does','did',
  'doing','done','has','have','had','can','could','would','should','may','might','must','shall',
  'up','down','out','now','just','also','very','more','most','so','if','you','we','they','he','she',
  // contraction remnants (apostrophe stripped → "couldn't" → "couldn")
  'couldn','wouldn','shouldn','didn','doesn','isn','wasn','aren','weren','don','won','hasn','haven',
  'hadn','ain','mustn','needn','cant','wont','dont','ll','ve','theyre','youre','thats',
  // platform / hashtag / engagement spam
  'trending','trend','trends','shorts','shortsfeed','shortsvideo','shortvideo','ytshorts',
  'trendingshorts','comedyshorts','comedyvideo','comedyvideos','funnyshorts','reels','reel','fyp',
  'foryou','subscribe','comment','share','explore','viral','trendingvideo','statusvideo',
  'minivlog','minivlogs','shortvideos','viralvideo','viralvideos','viralshort','viralshorts',
  'ytshort','shortsviral','funnyvideo','funnyvideos','viralshortsvideo','trendingreels',
  // call-to-action / promo cruft ("link in bio", "swipe up", "dm to buy", giveaways)
  'link','bio','swipe','giveaway','sponsor','sponsored','promo','coupon','presale','discount',
  // generic filler adjectives / adverbs / weak verbs (removing them surfaces the real phrase)
  'really','real','good','great','amazing','ultimate','huge','crazy','insane','epic','one','two',
  'three','thing','things','stuff','everyone','everything','nothing','someone','something','anyone',
  'anything','way','ways','too','ever','never','seen','long','right','many','much','them','dream',
  'come','comes','truth','reason','behind','changed','change','caught','ready','believe','need',
  'needs','let','lets','want','wants','every','gift','free','gone','back','bye','get','gets','got',
  'make','makes','made','put','give','giving','take','takes','went','goes','going','look','looks',
  'looking','tried','try','trying','wait','end','like','love','life','last','main','tera','sath',
  'happens','happen','happened','happening', // "what happens to your body when..." collapses to "happens <topic>"
  // romanised Hindi filler / verbs
  'kar','rahe','raha','rahi','hain','tha','thi','gaya','gayi','hoga','karo','karta','karti','mera',
  'mere','meri','teri','liye','kaise','kyun','kyu','kyon','jab','tab','phir','abhi','sirf','bahut',
  'kuch','koi','sab','sabse','woh','yeh','iska','uska','apna','apni','naa','toh',
  'ka','ki','ke','hai','aur','kya','se','me','par','ko','ek','bhi','hi','nahi','wala','wale',
  'का','की','के','है','और','क्या','से','में','पर','को','एक','भी','ही','नहीं','यह','पर',
]);

function tokenize(title) {
  return String(title || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w && w.length > 2 && !PHRASE_STOP.has(w) && !/^\d+$/.test(w));
}
function phrasesOf(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] !== tokens[i + 1]) out.push(`${tokens[i]} ${tokens[i + 1]}`); // skip "ios ios"
    if (i < tokens.length - 2) out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return out;
}
const domClass = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
// Fallback niche for topics the PHRASE can't classify: trust the covering channels' plurality ONLY
// when it's a real one. Generalist-shorts niches (food/entertainment/comedy) otherwise win genuinely
// cross-niche topics by a thin margin — the root cause of "meta glasses"/"rich poor" landing in food.
// A topic with no clear owning niche (no majority AND no ≥2× lead over the runner-up) is genuinely
// cross-niche → label it 'general' rather than fabricate whichever niche happened to edge ahead.
function confidentNiche(nCount) {
  const entries = Object.entries(nCount).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'general';
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const [topNiche, topC] = entries[0];
  // Trust a real plurality (≥40% of covering channels own it — e.g. "Messi" is ~sports 0.43); below
  // that the topic is genuinely cross-niche (food barely led "meta glasses" at 0.25) → 'general'.
  // ALSO require an absolute minimum of 4 channels backing the winning niche — a percentage alone can
  // look confident on a thin sample ("Worth Penny": finance 3/7 = 43%, but 3 channels is noise, not
  // evidence). 4 matches the topic's own MINCH floor, so a unanimous 4-channel topic still qualifies.
  if (topC / total >= 0.4 && topC >= 4) return topNiche;
  return 'general';
}

// A phrase-keyword hit used to win unconditionally over channel evidence, even when the keyword is a
// coincidental homonym. Proof case: "Ghee Roast" (a cooking dish) matched comedy's bare 'roast'
// keyword and got classified 'comedy' despite 71% of its covering channels (10/14) being food
// channels. Now channel evidence can override the keyword ONLY when it's both strong (≥60% — well
// above confidentNiche's 40% bar) AND disagrees with a DIFFERENT niche than the keyword match — so a
// genuine keyword match with no strong contradiction (the normal case) still wins as before.
function resolveNiche(phraseNiche, nCount) {
  if (!phraseNiche || phraseNiche === 'other') return confidentNiche(nCount);
  const entries = Object.entries(nCount).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return phraseNiche;
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const [topNiche, topC] = entries[0];
  if (topNiche !== phraseNiche && topC >= 4 && topC / total >= 0.6) return topNiche;
  return phraseNiche;
}
const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

// Shared scorer for a topic's adoption + momentum, used by both the per-phrase pass and the
// entity-merged story pass so the two never drift. MAGNITUDE term: an exceptionally broad AND still-
// growing story (many distinct channels, positive acceleration) is a major trend even when its accel
// RATIO is modest because it was already large last window — without this a 200-channel breaking story
// sits below tiny brand-new blips that merely maxed the novelty terms. Gated on accel>0 so evergreen
// high-footprint clusters (old-song compilations, perennial genres) are NOT vaulted.
function scoreTopic(chNow, accel, avgViews) {
  let score = 0;
  if (chNow >= 4) score += 20;
  if (chNow >= 8) score += 15;
  if (accel >= 0.5) score += 20;
  if (accel >= 1.0) score += 10;
  score += Math.min(35, Math.round(Math.log10(avgViews + 1) * 6)); // momentum
  // Require GENUINE growth (≥20%), not merely accel>0: a perennial phrase ("year old","happy birthday")
  // covered by hundreds of channels every month barely grows (accel≈0.05) and must NOT be vaulted; a
  // real breaking story (a protest, a war, a climaxing tournament) grows far faster and earns the floor.
  if (accel >= 0.2 && chNow >= 80) score = 100;
  else if (accel >= 0.2 && chNow >= 40) score = Math.min(100, score + 6);
  return Math.max(0, Math.min(100, score));
}

async function runVideoTrendJob(opts = {}) {
  const db = getDb();
  const start = Date.now();
  const runStart = db.get("SELECT datetime('now') AS t").t;
  const MINVIEWS = opts.minViews ?? 15000;   // only videos with real traction
  const MINCH    = opts.minChannels ?? 4;     // a trend = many distinct channels, not one
  console.log(`[videoTrend] Starting (minViews=${MINVIEWS}, minChannels=${MINCH})...`);

  db.exec(`CREATE TABLE IF NOT EXISTS video_trend_signals (
    topic TEXT PRIMARY KEY, niche TEXT, region TEXT,
    channel_count_now INTEGER, channel_count_prior INTEGER, video_count INTEGER,
    avg_views INTEGER, accel_pct INTEGER, signal_score INTEGER, signal_tier TEXT,
    samples_json TEXT, niche_spread INTEGER, niches_json TEXT, computed_at TEXT
  )`);
  // niche_spread = # of distinct niches whose channels cover the topic → angle-ability: a HIGH
  // spread ("World Cup" seen in sports+news+comedy+food…) is a cultural trend anyone can angle
  // into; a low spread is niche-locked. niches_json = the distribution (for direct-vs-crossover).
  try { db.exec(`ALTER TABLE video_trend_signals ADD COLUMN niche_spread INTEGER`); } catch (_) {}
  try { db.exec(`ALTER TABLE video_trend_signals ADD COLUMN niches_json TEXT`); } catch (_) {}

  // ── now window (0-30d) with per-video meta ──
  const now = db.all(
    `SELECT iv.youtube_video_id id, iv.channel_id, iv.title, iv.views,
            COALESCE(ic.primary_niche, ic.niche) niche, ic.channel_name, COALESCE(ic.region,'IN') region,
            CASE WHEN iv.published_at > datetime('now','-10 days') THEN 1 ELSE 0 END recent
     FROM ingested_videos iv JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE iv.published_at > datetime('now','-30 days') AND iv.views > ? AND iv.title IS NOT NULL`,
    [MINVIEWS]);
  console.log(`[videoTrend] now-window videos: ${now.length}`);

  const idx = new Map(); // phrase -> { chans:Set, vids:[], nCount:{}, rCount:{} }
  for (const v of now) {
    const seen = new Set();
    for (const p of phrasesOf(tokenize(v.title))) {
      if (seen.has(p)) continue; seen.add(p);
      let e = idx.get(p);
      if (!e) { e = { chans: new Map(), vids: [], vidIds: new Set(), nCount: {}, rCount: {}, recentN: 0, earlierN: 0 }; idx.set(p, e); }
      e.chans.set(v.channel_id, (e.chans.get(v.channel_id) || 0) + 1); // channel -> # videos (for dominance)
      if (v.recent) e.recentN++; else e.earlierN++;
      if (e.vids.length < 40) e.vids.push(v);
      if (e.vidIds.size < 200) e.vidIds.add(v.id);
      e.nCount[v.niche] = (e.nCount[v.niche] || 0) + 1;
      e.rCount[v.region] = (e.rCount[v.region] || 0) + 1;
    }
  }
  // Drop phrases below the channel floor early (frees memory before the prior pass).
  for (const [p, e] of idx) if (e.chans.size < MINCH) idx.delete(p);
  console.log(`[videoTrend] phrases with >=${MINCH} channels: ${idx.size}`);

  // ── prior window (30-60d) — only need distinct-channel counts for phrases we kept ──
  const prior = db.all(
    `SELECT iv.channel_id, iv.title FROM ingested_videos iv
     WHERE iv.published_at BETWEEN datetime('now','-60 days') AND datetime('now','-30 days')
       AND iv.views > ? AND iv.title IS NOT NULL`,
    [MINVIEWS]);
  const priorCh = new Map(); // phrase -> Set(channel)
  for (const v of prior) {
    const seen = new Set();
    for (const p of phrasesOf(tokenize(v.title))) {
      if (seen.has(p) || !idx.has(p)) continue; seen.add(p);
      let s = priorCh.get(p); if (!s) { s = new Set(); priorCh.set(p, s); } s.add(v.channel_id);
    }
  }

  // ── score + dedupe near-identical phrases (token-subset), keep the stronger ──
  let ranked = [...idx.entries()].map(([topic, e]) => {
    const chNow = e.chans.size;
    const chPrior = priorCh.get(topic)?.size || 0;
    const accel = chPrior > 0 ? (chNow - chPrior) / chPrior : (chNow >= MINCH ? 1 : 0);
    const avgViews = Math.round(e.vids.reduce((s, v) => s + (v.views || 0), 0) / e.vids.length);
    let score = scoreTopic(chNow, accel, avgViews);
    let tier = chPrior === 0 && chNow >= MINCH ? 'rising'
      : score >= 70 ? 'rising' : score >= 50 ? 'emerging' : score >= 35 ? 'stable' : 'noise';
    // Recency guard: a past spike still inside the 30d window (e.g. a festival ~3 weeks ago)
    // otherwise reads as "rising" because the 30-60d adoption baseline predates it. Measure what
    // fraction of the topic's window activity falls in the recent 10 days — uniform activity over
    // 30d gives ≈0.33, so a topic well below that is front-loaded in the PAST = fading, not rising.
    // Works for small topics too (the rate-ratio version missed 4-video seasonal fragments). Strong
    // decay → 'noise' (dropped); moderate → capped at 'stable'. Brand-new topics are safe (recent-heavy).
    const total = e.recentN + e.earlierN;
    const recentShare = total > 0 ? e.recentN / total : 1;
    if (total >= 4 && recentShare < 0.25) {
      score = Math.round(score * Math.max(0.15, recentShare / 0.33));
      tier = recentShare < 0.1 ? 'noise' : (score >= 35 ? 'stable' : 'noise');
    }
    // Single-uploader dominance guard: a real cross-creator trend isn't carried by one channel. A
    // single song/status-video mirrored across a few re-upload channels (one channel posting most of
    // the videos) otherwise passes the ≥4-channel floor and ranks as "rising". If one channel produced
    // >40% of the topic's videos, downweight by that dominance and cap it out of the live tiers.
    const chCounts = [...e.chans.values()];
    const totalVids = chCounts.reduce((a, b) => a + b, 0);
    const topShare = totalVids > 0 ? Math.max(...chCounts) / totalVids : 0;
    if (topShare > 0.4) {
      score = Math.round(score * (1 - topShare));
      tier = (score < 35 || tier === 'noise') ? 'noise' : 'stable'; // only ever demotes
    }
    // Niche from the PHRASE first (strongest, unambiguous signal: "football comedy" → sports),
    // falling back to the dominant STANDARD primary_niche of covering channels. Avoids the old bug
    // where a topic inherited a noisy plurality of ultra-granular channel labels.
    const phraseNiche = classifyTopicNiche(topic);
    // niche distribution across covering channels → spread (angle-ability) + which niches cover it.
    const nicheDist = Object.entries(e.nCount).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
    const nicheSpread = nicheDist.length;
    return {
      topic, words: topic.split(' '), vidIds: e.vidIds, chanSet: new Set(e.chans.keys()),
      niche: resolveNiche(phraseNiche, e.nCount),
      region: domClass(e.rCount),
      niche_spread: nicheSpread,
      niches: nicheDist.slice(0, 8).map(([n, c]) => ({ niche: n, channels: c })),
      channel_count_now: chNow, channel_count_prior: chPrior, video_count: e.vids.length,
      avg_views: avgViews, accel_pct: Math.round(accel * 100), signal_score: score, signal_tier: tier,
      samples: (() => { // diversify: at most 2 per channel so examples reflect the spread of creators, not one channel's re-uploads
        const out = [], perCh = {};
        for (const v of e.vids.sort((a, b) => b.views - a.views)) {
          if ((perCh[v.channel_id] || 0) >= 2) continue;
          perCh[v.channel_id] = (perCh[v.channel_id] || 0) + 1;
          out.push({ title: v.title, views: v.views, channel_name: v.channel_name, video_id: v.id });
          if (out.length >= 6) break;
        }
        return out;
      })(),
    };
  }).filter(e => e.signal_tier !== 'noise')
    .sort((a, b) => b.signal_score - a.signal_score || b.channel_count_now - a.channel_count_now);

  // Same-event merge — collapse the fragments of one event (Father's Day → "father day"/"fathers
  // day"/"happy father"/"day dad") into the single strongest phrase. Efficient: a token index means
  // each phrase is only compared against already-kept phrases that SHARE A WORD (light stemming folds
  // father/fathers). Two share-a-word phrases merge when either one is a token-subset of the other,
  // OR they were extracted from the SAME source videos (video-id overlap) — the latter keeps genuinely
  // distinct same-word topics apart ("Modi Seychelles" vs "Modi Cabinet" have different videos).
  const stem = w => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w;
  const kept = [];
  const tokenIdx = new Map(); // stemmed token -> kept phrases containing it
  for (const e of ranked) {
    const eStems = [...new Set(e.words.map(stem))];
    const cand = new Set();
    for (const s of eStems) { const arr = tokenIdx.get(s); if (arr) for (const k of arr) cand.add(k); }
    let merged = false;
    for (const k of cand) {
      const kStems = new Set(k.words.map(stem));
      const small = eStems.length <= kStems.size ? eStems : [...kStems];
      const big = eStems.length <= kStems.size ? kStems : new Set(eStems);
      let n = 0; for (const w of small) if (big.has(w)) n++;
      if (n === small.length) { merged = true; break; } // token-subset (stemmed)
      let shared = 0; for (const id of e.vidIds) if (k.vidIds.has(id)) shared++;
      if (shared >= 2 && shared / Math.min(e.vidIds.size, k.vidIds.size) >= 0.3) { merged = true; break; }
    }
    if (!merged) { kept.push(e); for (const s of eStems) { let arr = tokenIdx.get(s); if (!arr) { arr = []; tokenIdx.set(s, arr); } arr.push(e); } }
  }

  // ── Entity-anchored merge — collapse a big multi-angle NEWS story ───────────────────────────────
  // A major breaking story (a protest, a scandal) fragments into many phrases that share a DISTINCTIVE
  // proper-noun anchor ("Sonam Wangchuk"/"Wangchuk Jantar"/"Mantar Delhi"/"CJP Protest") but are
  // extracted from DIFFERENT videos (each covers a different angle: hunger strike, removal, lathi
  // charge, health). The video-overlap same-event merge above therefore can't join them, and each
  // fragment carries only a slice of the footprint — so the single biggest real story in the corpus
  // scatters into dozens of mid-ranked rows and never surfaces. Here we cluster the survivors by
  // (shared distinctive anchor token) AND (covering-channel overlap): fragments of one ongoing story
  // are covered by largely the SAME channels even when the specific videos differ, while two genuinely
  // different stories that merely share a word ("Narendra Modi" vs "Lalit Modi") are covered by
  // different channels and stay apart. We UNION the channel footprints so the merged story ranks by
  // its true reach and recompute its score, vaulting it to the top where it belongs.
  const ENT_OVERLAP = opts.entityOverlap ?? 0.4; // ≥40% of the smaller topic's channels also cover the other
  // Generic words that must NOT act as a story anchor (they co-occur across unrelated news): the anchor
  // has to be a distinctive entity, not a topic category.
  const ANCHOR_STOP = new Set(['police','protest','protests','delhi','india','indian','news','student',
    'students','march','city','court','case','minister','ministry','govt','government','party','leader',
    'people','woman','video','viral','live','update','support','rally','arrest','arrested','death',
    'attack','issue','crisis','matter','public','national','breaking','clash','action','order','statement']);
  // Scope to NEWS EVENTS: the "one event shatters into many phrases from different videos" problem is a
  // breaking-news phenomenon. In sports/music/entertainment a shared word ("world"/"cup","bhojpuri") +
  // shared genre channels would collapse GENUINELY DISTINCT trends (World Cup vs a war; different songs;
  // different matches) into a category blob — those are handled by the video-overlap merge + LLM
  // canonicalizer. Only news-adjacent niches participate, and a cluster only becomes a merged story if it
  // actually contains a news/politics fragment; a story's general/education/health angles (a viral
  // "Sonam Wangchuk" edit, "NEET protest") get absorbed, but a pure-general word-blob ("year old") does not.
  const MERGE_NICHES = new Set(['news', 'politics', 'geopolitics', 'general', 'education', 'health']);
  const canMerge = e => MERGE_NICHES.has(e.niche);
  const isNews = e => e.niche === 'news' || e.niche === 'politics' || e.niche === 'geopolitics';
  const anchorsOf = e => new Set(e.words.map(stem).filter(s => s.length >= 4 && !ANCHOR_STOP.has(s)));
  // GREEDY clustering against each cluster's accumulated channel UNION — deliberately NOT transitive
  // union-find. Union-find chains A→B→C whenever consecutive pairs look related, so a bridging phrase
  // ("world war") silently fused football's "World Cup" into the "Iran War" story. Growing biggest-first
  // and testing a fragment's overlap against the cluster's WHOLE footprint means a fragment can't join a
  // cluster whose channels it doesn't broadly share, even if it shares a word with one member.
  const order = kept.map((_, i) => i).sort((a, b) => kept[b].chanSet.size - kept[a].chanSet.size);
  const clist = []; // { tokens:Set, chans:Set, members:[idx], hasNews }
  const singles = []; // fragments not eligible to merge (sports/music/… niches) → pass through unchanged
  for (const i of order) {
    const e = kept[i];
    if (!canMerge(e)) { singles.push(i); continue; }
    const toks = anchorsOf(e);
    let best = null, bestOv = 0;
    for (const c of clist) {
      let shares = false; for (const t of toks) if (c.tokens.has(t)) { shares = true; break; }
      if (!shares) continue;                            // must share a distinctive anchor with the cluster
      let n = 0; for (const ch of e.chanSet) if (c.chans.has(ch)) n++;
      const ov = e.chanSet.size ? n / e.chanSet.size : 0; // fragment's channels covered by the cluster union
      if (ov >= ENT_OVERLAP && ov > bestOv) { best = c; bestOv = ov; }
    }
    if (best) {
      best.members.push(i);
      for (const ch of e.chanSet) best.chans.add(ch);
      for (const t of toks) best.tokens.add(t);
      best.hasNews = best.hasNews || isNews(e);
    } else {
      clist.push({ tokens: toks, chans: new Set(e.chanSet), members: [i], hasNews: isNews(e) });
    }
  }
  // Emit a cluster as one merged story only when it's a genuine news event (has ≥1 news/politics member
  // AND >1 fragment); everything else stays a singleton.
  const clusters = new Map();
  let cid = 0;
  for (const s of singles) clusters.set('s' + s, [s]);
  for (const c of clist) {
    if (c.members.length > 1 && c.hasNews) clusters.set('c' + (cid++), c.members);
    else for (const m of c.members) clusters.set('s' + m, [m]);
  }
  const kept2 = [];
  const mergeReport = [];
  let entityMerged = 0;
  for (const members of clusters.values()) {
    if (members.length === 1) { kept2.push(kept[members[0]]); continue; }
    const ms = members.map(i => kept[i]).sort((a, b) => b.channel_count_now - a.channel_count_now || b.signal_score - a.signal_score);
    const survivor = ms[0];
    const chanUnion = new Set(), priorUnion = new Set(), nAgg = {}, rAgg = {};
    let pooledSamples = [], vidCount = 0, maxAvg = 0;
    for (const m of ms) {
      m.chanSet.forEach(c => chanUnion.add(c));
      (priorCh.get(m.topic) || new Set()).forEach(c => priorUnion.add(c));
      (m.niches || []).forEach(({ niche, channels }) => { nAgg[niche] = (nAgg[niche] || 0) + channels; });
      rAgg[m.region] = (rAgg[m.region] || 0) + m.channel_count_now;
      pooledSamples = pooledSamples.concat(m.samples || []);
      vidCount += m.video_count || 0;
      if (m.avg_views > maxAvg) maxAvg = m.avg_views;
    }
    const chNow = chanUnion.size, chPrior = priorUnion.size;
    const accel = chPrior > 0 ? (chNow - chPrior) / chPrior : 1;
    const score = scoreTopic(chNow, accel, maxAvg);
    const tier = (chPrior === 0 && chNow >= MINCH) ? 'rising' : score >= 70 ? 'rising' : score >= 50 ? 'emerging' : score >= 35 ? 'stable' : 'noise';
    const nicheDist = Object.entries(nAgg).sort((a, b) => b[1] - a[1]);
    const samples = (() => { // re-diversify pooled examples: at most 2 per channel
      const out = [], perCh = {};
      for (const v of pooledSamples.sort((a, b) => b.views - a.views)) {
        const key = v.channel_name || v.video_id;
        if ((perCh[key] || 0) >= 2) continue; perCh[key] = (perCh[key] || 0) + 1;
        out.push(v); if (out.length >= 6) break;
      }
      return out;
    })();
    kept2.push({
      ...survivor,
      niche: resolveNiche(classifyTopicNiche(survivor.topic), nAgg),
      region: domClass(rAgg) || survivor.region,
      channel_count_now: chNow, channel_count_prior: chPrior,
      video_count: vidCount, avg_views: maxAvg, accel_pct: Math.round(accel * 100),
      signal_score: score, signal_tier: tier,
      niche_spread: nicheDist.length, niches: nicheDist.slice(0, 8).map(([niche, channels]) => ({ niche, channels })),
      samples,
    });
    entityMerged += members.length - 1;
    mergeReport.push({ canonical: survivor.topic, chNow, score, tier, niche: kept2[kept2.length - 1].niche, members: ms.map(m => `${m.topic} (${m.channel_count_now}ch/${m.signal_score})`) });
  }
  const kept3 = kept2.filter(e => e.signal_tier !== 'noise')
    .sort((a, b) => b.signal_score - a.signal_score || b.channel_count_now - a.channel_count_now);
  console.log(`[videoTrend] Entity-anchor merge: collapsed ${entityMerged} fragment rows into ${mergeReport.length} multi-fragment stories`);

  if (opts.dryRun) {
    mergeReport.sort((a, b) => b.chNow - a.chNow);
    console.log('\n[videoTrend] DRY RUN — table NOT written. Top merged stories:');
    for (const r of mergeReport.slice(0, 12)) {
      console.log(`\n● ${r.canonical}  [${r.niche} · ${r.tier} · score ${r.score} · ${r.chNow} channels]`);
      r.members.slice(0, 12).forEach(m => console.log(`    - ${m}`));
      if (r.members.length > 12) console.log(`    …+${r.members.length - 12} more fragments`);
    }
    console.log('\n[videoTrend] DRY RUN — new top-15 overall:');
    kept3.slice(0, 15).forEach((e, i) => console.log(`${String(i + 1).padStart(2)}. [${e.signal_score}] ${String(e.channel_count_now).padStart(3)}ch  ${titleCase(e.topic)}  (${e.niche})`));
    return { dryRun: true, entity_merged: entityMerged, stories: mergeReport.length, topics: kept3.length };
  }

  const ins = `INSERT OR REPLACE INTO video_trend_signals (topic,niche,region,channel_count_now,channel_count_prior,video_count,avg_views,accel_pct,signal_score,signal_tier,samples_json,niche_spread,niches_json,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`;
  const tx = db.transaction(() => {
    for (const e of kept3) db.run(ins, [titleCase(e.topic), e.niche, e.region, e.channel_count_now, e.channel_count_prior, e.video_count, e.avg_views, e.accel_pct, e.signal_score, e.signal_tier, JSON.stringify(e.samples), e.niche_spread, JSON.stringify(e.niches)]);
  });
  tx();
  db.run(`DELETE FROM video_trend_signals WHERE computed_at < ?`, [runStart]);

  // LLM pass: collapse diffuse-topic fragments the heuristic merge can't (Father's Day etc.).
  let canon = { merged: 0 };
  try { canon = await canonicalizeTopTrends(db); } catch (e) { console.warn('[videoTrend] canonicalize error:', e.message); }
  // LLM pass: name the 'general' (cross-niche fallback) topics the classifier couldn't (Messi→sports).
  let np = { relabeled: 0 };
  try { np = await nicheGeneralTopics(db); } catch (e) { console.warn('[videoTrend] niche-pass error:', e.message); }

  // ── Outcome tracking: flag new rising/emerging topics for 30-day accuracy evaluation ──────────
  // There was previously NO ground-truth loop for this engine (the only one that exists,
  // trend_signal_outcomes, evaluates the legacy channel-topic engine, not this one). Flag AFTER the
  // LLM passes so we log the final, cleaned topic string this run actually shows users, and re-check
  // each flagged topic's channel coverage directly against ingested_videos at evaluation time — not
  // against video_trend_signals — since a later run's canonicalizer may rename/merge a persisting
  // topic, which would falsely look "gone" if we depended on that row still existing under this name.
  try { flagNewTrendsForOutcomeTracking(db); } catch (e) { console.warn('[videoTrend] outcome-flagging error:', e.message); }

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[videoTrend] Wrote ${kept3.length} topics (entity-merged ${entityMerged}, LLM-merged ${canon.merged || 0}, niche-relabeled ${np.relabeled || 0}) in ${secs}s`);
  return { topics: kept3.length, entity_merged: entityMerged, llm_merged: canon.merged || 0, niche_relabeled: np.relabeled || 0, duration_s: parseFloat(secs) };
}

module.exports = {
  runVideoTrendJob, canonicalizeTopTrends, nicheGeneralTopics, flagNewTrendsForOutcomeTracking,
  // exposed so the Instagram trend job reuses the EXACT same phrase extraction + scoring (no drift):
  tokenize, phrasesOf, scoreTopic, confidentNiche, resolveNiche, titleCase,
};
