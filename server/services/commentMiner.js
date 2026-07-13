'use strict';

// Mines a channel's OWN video comments for recurring audience requests — a signal WTP's idea
// generator never had before (only used upload-history DNA). The core problem: a video can have
// hundreds of comments, almost all noise. Same funnel principle already proven in videoTrendJob.js
// for video titles: cheap filter -> cross-source frequency threshold -> a small LLM pass only on the
// distilled survivors, never raw text.
//   Stage 1 (free): order=relevance fetch + regex noise filter.
//   Stage 2 (free): phrase-extraction, keep only phrases recurring across >=2 DISTINCT VIDEOS (one
//     video's comment-section pile-on shouldn't outrank a real request appearing on several videos).
//   Stage 3 (one cheap LLM call): name the survivors cleanly, attach a real quote.
// v1 scope: the creator's OWN videos only (not peers) -- bounds quota, keeps "recurs across videos"
// meaningful. Best-effort throughout: any failure returns null, caller just omits the prompt block.

const crypto = require('crypto');
const OpenAI = require('openai');
const { getApiKey, markExhausted, isQuotaError } = require('./apiKeyManager');
const quotaGuard = require('./quotaGuard');

const MODEL = process.env.WTP_REFINER_MODEL || 'gpt-4.1-mini';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days -- audience requests shift slower than trends, and this bounds quota spend
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

let _client = null;
function _ai() { if (_client) return _client; const k = process.env.OPENAI_API_KEY; if (!k) return null; _client = new OpenAI({ apiKey: k }); return _client; }

function ensureCache(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS audience_requests_cache (
    channel_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, computed_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
}

// Mirrors indiaCrawlerJob.js's ytGet exactly: rotating key pool, retry-with-backoff, quota-exhaustion
// handling, quotaGuard tracking. Copied rather than imported since indiaCrawlerJob.js doesn't export it.
async function ytGet(path, params, costUnits) {
  for (let keyAttempt = 0; keyAttempt < 13; keyAttempt++) {
    const key = getApiKey('comments');
    if (!key) throw new Error('all_api_keys_exhausted');

    const url = new URL(`${YT_BASE}/${path}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const full = url.toString();

    for (let t = 1; t <= 3; t++) {
      let res, data;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 25_000);
      try {
        res = await fetch(full, { signal: ac.signal });
        data = await res.json();
        clearTimeout(timer);
      } catch (e) {
        clearTimeout(timer);
        if (t < 3) { await new Promise(r => setTimeout(r, 2000 * t)); continue; }
        throw new Error('network_error_after_retries');
      }
      if (!res.ok) {
        const msg = data?.error?.message || `YouTube ${res.status}`;
        if (isQuotaError(msg) || res.status === 429) { markExhausted(key); break; }
        if (res.status === 403 && /comments (are )?disabled/i.test(msg)) return null; // not an error -- just skip this video
        if (res.status >= 500 && t < 3) { await new Promise(r => setTimeout(r, 3000 * t)); continue; }
        throw new Error(msg);
      }
      quotaGuard.recordUsage(costUnits, 'comments');
      return data;
    }
  }
  throw new Error('all_api_keys_exhausted');
}

// ── Stage 1: fetch + cheap regex filter ───────────────────────────────────────
const REQUEST_RE = /\b(can you|could you|please (do|make|cover)|why (don't|dont|didn't) you|next video|i wish you|what about|you should (do|cover|make|try)|do a video|make a video)\b/i;
const PROMO_RE = /\b(check out|subscribe to|follow me|dm me|link in|www\.|https?:\/\/)\b/i;
function isCandidateComment(text) {
  const t = String(text || '').trim();
  if (t.length < 15) return false;
  if (PROMO_RE.test(t)) return false;
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  if (letters < t.length * 0.3) return false; // mostly emoji/symbols
  return true;
}

async function fetchTopComments(videoId) {
  try {
    const data = await ytGet('commentThreads', { part: 'snippet', videoId, maxResults: 100, order: 'relevance', textFormat: 'plainText' }, 1);
    if (!data) return [];
    return (data.items || [])
      .map(it => it.snippet?.topLevelComment?.snippet?.textDisplay)
      .filter(isCandidateComment);
  } catch (e) {
    console.warn(`[commentMiner] fetch failed for ${videoId}:`, e.message);
    return [];
  }
}

// ── Stage 2: cross-video phrase clustering ────────────────────────────────────
// Conversational text needs its own stopword set -- distinct from videoTrendJob.js's title-tuned
// PHRASE_STOP, which assumes title-style phrasing, not "please/thanks/love you" comment chatter.
const COMMENT_STOP = new Set([
  'the','a','an','and','or','but','not','for','of','to','in','on','at','by','from','with','as','is',
  'are','was','were','be','been','this','that','these','those','it','its','his','her','their','our',
  'your','you','my','me','i','we','they','he','she','him','them','us','am','can','could','would',
  'should','will','shall','just','really','very','so','too','also','more','most','much','many',
  'video','videos','channel','content','please','thanks','thank','love','great','good','nice',
  'amazing','awesome','best','first','comment','watching','watched','watch','subscribed','subscribe',
  'like','likes','liked','new','one','two','get','got','make','made','do','did','done','have','has',
  'had','all','out','up','down','if','when','what','how','why','who','which','about','into','over',
]);
function tokenizeComment(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter(w => w && w.length > 2 && !COMMENT_STOP.has(w) && !/^\d+$/.test(w));
}
function phrasesOfComment(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i < tokens.length - 2) out.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return out;
}

function clusterByVideo(commentsByVideo) {
  const idx = new Map(); // phrase -> { videoIds:Set, sample: text }
  for (const [videoId, comments] of commentsByVideo) {
    for (const c of comments) {
      const isRequest = REQUEST_RE.test(c);
      for (const p of phrasesOfComment(tokenizeComment(c))) {
        let e = idx.get(p);
        if (!e) { e = { videoIds: new Set(), sample: c, requestWeight: 0 }; idx.set(p, e); }
        e.videoIds.add(videoId);
        if (isRequest && !e.requestWeight) { e.sample = c; e.requestWeight = 1; } // prefer a request-phrased sample
      }
    }
  }
  return [...idx.entries()]
    .filter(([, e]) => e.videoIds.size >= 2)
    .sort((a, b) => (b[1].requestWeight - a[1].requestWeight) || (b[1].videoIds.size - a[1].videoIds.size))
    .slice(0, 40) // cap what even reaches the LLM naming pass
    .map(([phrase, e]) => ({ phrase, video_count: e.videoIds.size, sample_quote: e.sample.slice(0, 200) }));
}

// ── Stage 3: small LLM naming pass on the distilled survivors only ───────────
const NAME_SYS = `You clean up a list of recurring phrase-clusters extracted from YouTube comment sections into short, human-readable AUDIENCE REQUESTS a creator could act on.
For each cluster given (a raw phrase + how many distinct videos it appeared under + a sample real comment), either:
- turn it into a clean, specific request sentence if it genuinely reads as an audience ask/interest, or
- DROP it if it's just generic chatter, praise, or noise with no real topical request (e.g. "so good", "love this").
Return ONLY JSON: {"requests":[{"phrase":"<clean readable request>","video_count":N,"sample_quote":"<the exact quote given, unchanged>"}]}. Keep at most 15. Never invent a quote — copy it exactly from what's given.`;

async function nameRequests(clusters) {
  const client = _ai();
  if (!client || !clusters.length) return clusters.slice(0, 15); // best-effort: fall back to raw phrases if no key
  const user = clusters.map((c, i) => `${i + 1}. PHRASE: "${c.phrase}" | video_count=${c.video_count} | QUOTE: "${c.sample_quote}"`).join('\n');
  try {
    const resp = await Promise.race([
      client.chat.completions.create({ model: MODEL, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: NAME_SYS }, { role: 'user', content: user }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
    ]);
    const raw = resp.choices?.[0]?.message?.content || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return clusters.slice(0, 15);
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed.requests) ? parsed.requests.slice(0, 15) : clusters.slice(0, 15);
  } catch (e) {
    console.warn('[commentMiner] naming pass failed:', e.message);
    return clusters.slice(0, 15);
  }
}

async function mineAudienceRequests(db, channelId) {
  if (!channelId) return null;
  try {
    ensureCache(db);
    const cached = db.get(`SELECT payload_json FROM audience_requests_cache WHERE channel_id=? AND expires_at>datetime('now')`, [channelId]);
    if (cached) { try { return JSON.parse(cached.payload_json); } catch (_) {} }

    const videos = db.all(`SELECT youtube_video_id id FROM ingested_videos WHERE channel_id=? ORDER BY views DESC LIMIT 10`, [channelId]);
    if (!videos.length) return null;

    const commentsByVideo = [];
    for (const v of videos) {
      if (!quotaGuard.quotaAvailable(1)) break; // stop quietly if the daily budget is tight -- best-effort, never blocks WTP
      const comments = await fetchTopComments(v.id);
      if (comments.length) commentsByVideo.push([v.id, comments]);
    }
    if (!commentsByVideo.length) return null;

    const clusters = clusterByVideo(commentsByVideo);
    if (!clusters.length) return null;

    const requests = await nameRequests(clusters);
    if (!requests.length) return null;

    const result = { requests, computed_at: new Date().toISOString() };
    try {
      db.run(`INSERT OR REPLACE INTO audience_requests_cache (channel_id, payload_json, computed_at, expires_at) VALUES (?,?,datetime('now'),?)`,
        [channelId, JSON.stringify(result), new Date(Date.now() + TTL_MS).toISOString()]);
    } catch (_) {}
    return result;
  } catch (e) {
    console.warn('[commentMiner] mineAudienceRequests failed:', e.message);
    return null;
  }
}

module.exports = { mineAudienceRequests };
