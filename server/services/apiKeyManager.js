'use strict';

// Reads up to 13 YouTube API keys from .env:
//   YT_API_KEY, YT_API_KEY_2 ... YT_API_KEY_13
// Each Google Cloud project gives 10,000 units/day — 13 keys = 130,000/day.
// Auto-rotates to next key on quota error; resets at midnight (YouTube's Pacific reset).

// YT_API_KEY_7 is reserved for the frontend search bar (NOT in the backend pool).
// Backend jobs use keys 1–6 and 8–13 (12 keys = 120,000 units/day).
const KEYS = [
  process.env.YT_API_KEY,     // 0
  process.env.YT_API_KEY_2,   // 1
  process.env.YT_API_KEY_3,   // 2
  process.env.YT_API_KEY_4,   // 3
  process.env.YT_API_KEY_5,   // 4
  process.env.YT_API_KEY_6,   // 5
  process.env.YT_API_KEY_8,   // 6
  process.env.YT_API_KEY_9,   // 7
  process.env.YT_API_KEY_10,  // 8
  process.env.YT_API_KEY_11,  // 9
  process.env.YT_API_KEY_12,  // 10
  process.env.YT_API_KEY_13,  // 11
].filter(Boolean);

if (!KEYS.length) {
  throw new Error('[apiKeyManager] No YouTube API keys configured. Set YT_API_KEY in .env');
}

// ── Per-task quota lanes (indices into KEYS) ──────────────────────────────────
// Each pipeline task gets PRIORITY on its own keys so heavy tasks (e.g. adding US/UK
// discovery+ingest) can't starve the others. If a lane's keys are all exhausted it
// SPILLS OVER to any idle backend key, so spare quota is never wasted and every task
// still completes. Tune the splits here. (Frontend search bar uses YT_API_KEY_7.)
//   discovery: search.list costs 100 units/call — the most expensive op (India + US/UK)
//   ingest:    corpus → ingested_channels, ~3 units/channel (India + US/UK)
//   refresh:   youtubeMetrics stat updates for the existing (growing) channel set
//   lookup:    on-demand frontend channel-cache + admin handle resolution
const LANES = {
  discovery: [0, 1, 2, 3],     // 4 keys ≈ 40k units/day
  ingest:    [4, 5, 6],        // 3 keys ≈ 30k units/day (~10k channels)
  refresh:   [7, 8, 9, 10],    // 4 keys ≈ 40k units/day
  lookup:    [11],             // 1 key  ≈ 10k units/day
};

const state = {
  date:      new Date().toDateString(),
  exhausted: new Set(),
  index:     0,
};

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (state.date !== today) {
    state.date = today;
    state.exhausted.clear();
    state.index = 0;
    console.log('[apiKeys] New day — quota reset, all keys active');
  }
}

// getApiKey(lane?) — lane-preferred with spillover. Pass a lane name ('discovery',
// 'ingest', 'refresh', 'lookup') to use that task's keys first; omit for any-key behaviour.
function getApiKey(lane) {
  resetIfNewDay();
  // 1. Lane-preferred: try this task's assigned keys first.
  const laneIdx = lane && LANES[lane];
  if (laneIdx) {
    for (const i of laneIdx) {
      const key = KEYS[i];
      if (key && !state.exhausted.has(key)) return key;
    }
  }
  // 2. Spillover: any non-exhausted backend key (round-robin), so idle quota is reused.
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[(state.index + i) % KEYS.length];
    if (!state.exhausted.has(key)) return key;
  }
  return null; // all keys exhausted for today
}

function markExhausted(key) {
  resetIfNewDay();
  if (!key || state.exhausted.has(key)) return;
  state.exhausted.add(key);
  const remaining = KEYS.filter(k => !state.exhausted.has(k)).length;
  console.warn(`[apiKeys] Key ...${key.slice(-6)} exhausted. ${remaining}/${KEYS.length} keys remaining today.`);
  state.index = (state.index + 1) % KEYS.length;
}

function isQuotaError(msg) {
  if (!msg) return false;
  const s = String(msg).toLowerCase();
  return s.includes('quota') || s.includes('rateLimitExceeded') || s.includes('dailylimitexceeded');
}

function getStatus() {
  resetIfNewDay();
  return {
    total:     KEYS.length,
    active:    KEYS.filter(k => !state.exhausted.has(k)).length,
    exhausted: state.exhausted.size,
    keys:      KEYS.map((k, i) => ({
      index:     i,
      suffix:    '...' + k.slice(-6),
      exhausted: state.exhausted.has(k),
    })),
    lanes: Object.fromEntries(Object.entries(LANES).map(([lane, idx]) => [
      lane,
      { keys: idx.length, active: idx.filter(i => KEYS[i] && !state.exhausted.has(KEYS[i])).length },
    ])),
  };
}

module.exports = { getApiKey, markExhausted, isQuotaError, getStatus, LANES };
