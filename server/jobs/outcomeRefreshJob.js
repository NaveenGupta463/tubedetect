const cron   = require('node-cron');
const { getDb } = require('../db/init');
const logger    = require('../utils/logger');

const MAX_REFRESHES_PER_RUN = 25;

let lastRun     = null;
let lastFlagged = 0;

function runOutcomeRefreshCycle() {
  const db = getDb();

  const stale = db.all(
    `SELECT id, youtube_video_id, prediction_id, refresh_attempts
     FROM video_outcomes
     WHERE youtube_video_id IS NOT NULL AND published_at IS NOT NULL
       AND (last_refreshed_at IS NULL
            OR last_refreshed_at < datetime('now', '-6 hours'))
     ORDER BY RANDOM()
     LIMIT ?`,
    [MAX_REFRESHES_PER_RUN],
  );

  lastRun = new Date().toISOString();

  if (stale.length === 0) {
    logger.info('outcomeRefreshJob', 'No stale outcomes');
    lastFlagged = 0;
    return;
  }

  const ids = stale.map(r => r.id);
  db.run(
    `UPDATE video_outcomes SET refresh_attempts = refresh_attempts + 1
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );

  logger.info('outcomeRefreshJob', `Flagged ${stale.length} stale outcomes — IDs: ${ids.join(',')}`);
  lastFlagged = stale.length;
}

function startOutcomeRefreshJob() {
  cron.schedule('0 */6 * * *', () => {
    try { runOutcomeRefreshCycle(); }
    catch (err) { logger.error('outcomeRefreshJob', err.message); }
  });
  logger.info('outcomeRefreshJob', 'Scheduled — every 6 hours');
}

function getOutcomeRefreshJobStats() {
  return { lastRun, lastFlagged };
}

module.exports = { startOutcomeRefreshJob, getOutcomeRefreshJobStats };
