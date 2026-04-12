'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const YT_BASE   = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_FILE = path.join(__dirname, '../cache.json');

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
// Injects server-side API key and proxies to YouTube.
router.get('/:endpoint', async (req, res) => {
  const { endpoint } = req.params;

  const url = new URL(`${YT_BASE}/${endpoint}`);
  url.searchParams.set('key', process.env.YT_API_KEY);
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'key') url.searchParams.set(k, v);
  }

  // Remove the internal refresh flag before using as cache key / forwarding
  const forceRefresh = req.query.refresh === '1';
  url.searchParams.delete('refresh');

  const cacheKey = url.toString();
  if (!forceRefresh) {
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
  } else {
    cache.delete(cacheKey); // evict stale entry
  }

  try {
    const r    = await fetch(url.toString());
    const data = await r.json();
    if (r.ok) setCache(cacheKey, data);
    return res.status(r.status).json(data);
  } catch {
    return res.status(502).json({ error: { message: 'YouTube API unreachable' } });
  }
});

module.exports = router;
