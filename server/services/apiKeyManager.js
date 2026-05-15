'use strict';

// Reads up to 12 YouTube API keys from .env:
//   YT_API_KEY, YT_API_KEY_2 ... YT_API_KEY_12
// Each Google Cloud project gives 10,000 units/day — 12 keys = 120,000/day.
// Auto-rotates to next key on quota error; resets at midnight (YouTube's Pacific reset).

const KEYS = [
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

if (!KEYS.length) {
  throw new Error('[apiKeyManager] No YouTube API keys configured. Set YT_API_KEY in .env');
}

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

function getApiKey() {
  resetIfNewDay();
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
  };
}

module.exports = { getApiKey, markExhausted, isQuotaError, getStatus };
