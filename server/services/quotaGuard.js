// YouTube Data API v3 quota tracking
// Each Google Cloud project = 10,000 units/day
// videos.list / channels.list = 1 unit per call (up to 50 IDs per call)
// search.list = 100 units per call
//
// Set QUOTA_DAILY_BUDGET in .env to match your total across all API keys.
// Default: 115,000 (12 backend keys × 10,000 − 5,000 safety buffer).

const DAILY_LIMIT = parseInt(process.env.QUOTA_DAILY_BUDGET || '110000', 10);
const CUTOFF      = DAILY_LIMIT;

const state = {
  date:          new Date().toDateString(),
  used:          0,
  refresh_calls: 0,
  miss_calls:    0,
  ingest_calls:  0,
  crawler_calls: 0,
};

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (state.date !== today) {
    Object.assign(state, {
      date: today, used: 0,
      refresh_calls: 0, miss_calls: 0, ingest_calls: 0, crawler_calls: 0,
    });
  }
}

function quotaAvailable(units = 1) {
  resetIfNewDay();
  return state.used + units <= CUTOFF;
}

function recordUsage(units = 1, type = 'general') {
  resetIfNewDay();
  state.used += units;
  if (type === 'refresh') state.refresh_calls++;
  if (type === 'miss')    state.miss_calls++;
  if (type === 'ingest')  state.ingest_calls++;
  if (type === 'crawler') state.crawler_calls++;
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
    crawler_calls: state.crawler_calls,
  };
}

module.exports = { quotaAvailable, recordUsage, getStats };
