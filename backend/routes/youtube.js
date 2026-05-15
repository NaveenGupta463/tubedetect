'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const YT_BASE   = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, '../cache.json');

// Key rotation — reads YT_API_KEY … YT_API_KEY_12 from env
const YT_KEYS = [
  process.env.YT_API_KEY,
  process.env.YT_API_KEY_2,
  process.env.YT_API_KEY_3,
  process.env.YT_API_KEY_4,
  process.env.YT_API_KEY_5,
  process.env.YT_API_KEY_6,
  process.env.YT_API_KEY_7,
  process.env.YT_API_KEY_8,
  process.env.YT_API_KEY_9,
  process.env.YT_API_KEY_10,
  process.env.YT_API_KEY_11,
  process.env.YT_API_KEY_12,
].filter(Boolean);

const keyState = { index: 0, date: new Date().toDateString(), exhausted: new Set() };

function getYtKey() {
  const today = new Date().toDateString();
  if (keyState.date !== today) { keyState.date = today; keyState.exhausted.clear(); keyState.index = 0; }
  for (let i = 0; i < YT_KEYS.length; i++) {
    const k = YT_KEYS[(keyState.index + i) % YT_KEYS.length];
    if (!keyState.exhausted.has(k)) return k;
  }
  return YT_KEYS[0]; // all exhausted — fall back to first, YouTube will return 429
}

function markKeyExhausted(key) {
  keyState.exhausted.add(key);
  keyState.index = (keyState.index + 1) % YT_KEYS.length;
  console.warn(`[youtube proxy] Key ...${key.slice(-6)} exhausted. ${YT_KEYS.length - keyState.exhausted.size}/${YT_KEYS.length} remaining.`);
}

function isQuotaError(data) {
  const msg = (data?.error?.message || data?.error?.status || '').toLowerCase();
  return msg.includes('quota') || msg.includes('ratelimitexceeded') || msg.includes('dailylimitexceeded');
}

// ─── Persistent cache (survives server restarts) ──────────────────────────────
let cache = new Map();

function loadCacheFromDisk() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [k, v] of Object.entries(obj)) {
      if (now - v.ts < CACHE_TTL) cache.set(k, v);
    }
    console.log(`[cache] loaded ${cache.size} entries from disk`);
  } catch { /* first run — no file yet */ }
}

function saveCacheToDisk() {
  try {
    const obj = {};
    for (const [k, v] of cache) obj[k] = v;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
  } catch {}
}

loadCacheFromDisk();

// Save cache to disk every 5 minutes
setInterval(saveCacheToDisk, 5 * 60 * 1000);

// Also save on process exit
process.on('exit',    saveCacheToDisk);
process.on('SIGINT',  () => { saveCacheToDisk(); process.exit(); });
process.on('SIGTERM', () => { saveCacheToDisk(); process.exit(); });

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  // Prevent unbounded growth
  if (cache.size > 500) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { ts: Date.now(), data });
}

// GET /api/youtube/:endpoint?<same params as YouTube Data API>
// Injects server-side API key and proxies to YouTube. Rotates keys on quota errors.
router.get('/:endpoint', async (req, res) => {
  const { endpoint } = req.params;
  const forceRefresh = req.query.refresh === '1';

  const buildUrl = (key) => {
    const url = new URL(`${YT_BASE}/${endpoint}`);
    url.searchParams.set('key', key);
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'key' && k !== 'refresh') url.searchParams.set(k, v);
    }
    return url;
  };

  const cacheKey = buildUrl('__cache__').toString();
  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
  } else {
    cache.delete(cacheKey);
  }

  for (let attempt = 0; attempt < YT_KEYS.length; attempt++) {
    const key = getYtKey();
    try {
      const r    = await fetch(buildUrl(key).toString());
      const data = await r.json();
      if (r.ok) { setCache(cacheKey, data); return res.json(data); }
      if (isQuotaError(data)) { markKeyExhausted(key); continue; }
      return res.status(r.status).json(data);
    } catch {
      return res.status(502).json({ error: { message: 'YouTube API unreachable' } });
    }
  }

  return res.status(429).json({ error: { message: 'All YouTube API keys exhausted for today' } });
});

module.exports = router;
