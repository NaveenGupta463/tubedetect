// YouTube Data API v3 free tier: 10,000 units/day
// videos.list  = 1 unit per call (up to 50 IDs)
// channels.list = 1 unit per call
// search.list  = 100 units per call
// Disable API at 80% = 8,000 units

const DAILY_LIMIT = 10000;
const CUTOFF      = Math.floor(DAILY_LIMIT * 0.80); // 8000

const state = {
  date:          new Date().toDateString(),
  used:          0,
  refresh_calls: 0,
  miss_calls:    0,
  ingest_calls:  0,
};

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (state.date !== today) {
    Object.assign(state, {
      date: today, used: 0,
      refresh_calls: 0, miss_calls: 0, ingest_calls: 0,
    });
  }
}

function quotaAvailable() {
  resetIfNewDay();
  return state.used < CUTOFF;
}

/**
 * Record API usage.
 * @param {number} units - quota units consumed
 * @param {'refresh'|'miss'|'ingest'|'general'} type
 */
function recordUsage(units = 1, type = 'general') {
  resetIfNewDay();
  state.used += units;
  if (type === 'refresh') state.refresh_calls++;
  if (type === 'miss')    state.miss_calls++;
  if (type === 'ingest')  state.ingest_calls++;
  console.log(`[quota] used=${state.used}/${CUTOFF} type=${type} units=${units}`);
}

function getStats() {
  resetIfNewDay();
  return {
    date:          state.date,
    used:          state.used,
    limit:         DAILY_LIMIT,
    cutoff:        CUTOFF,
    pct_used:      parseFloat(((state.used / DAILY_LIMIT) * 100).toFixed(1)),
    available:     quotaAvailable(),
    refresh_calls: state.refresh_calls,
    miss_calls:    state.miss_calls,
    ingest_calls:  state.ingest_calls,
  };
}

module.exports = { quotaAvailable, recordUsage, getStats };
