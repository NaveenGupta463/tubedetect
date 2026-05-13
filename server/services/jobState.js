const fs   = require('fs');
const path = require('path');

const STATE_PATH = path.resolve(__dirname, '../data/job_state.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function getLastRun(job) {
  const raw = readState()[job];
  return raw ? new Date(raw) : null;
}

function setLastRun(job) {
  const state = readState();
  state[job]  = new Date().toISOString();
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[jobState] Could not write state file:', e.message);
  }
}

function hoursSinceLastRun(job) {
  const last = getLastRun(job);
  if (!last) return Infinity;
  return (Date.now() - last.getTime()) / 3_600_000;
}

module.exports = { getLastRun, setLastRun, hoursSinceLastRun };
