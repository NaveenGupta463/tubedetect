const { getDb } = require('../db/init');
const { computeWhatToPost } = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');
const {
  claimRefreshJobs,
  completeRefreshJob,
  failRefreshJob,
} = require('../services/refreshQueue');
const {
  computeAndSaveWhatToPostCache,
  markChannelWtpCacheError,
} = require('../services/wtpCache');

const INTERVAL_MS = Math.max(10_000, Number.parseInt(process.env.WTP_CACHE_REFRESH_INTERVAL_MS || '60000', 10));
const STARTUP_DELAY_MS = Math.max(0, Number.parseInt(process.env.WTP_CACHE_REFRESH_STARTUP_DELAY_MS || '15000', 10));
const BATCH_SIZE = Math.max(1, Math.min(25, Number.parseInt(process.env.WTP_CACHE_REFRESH_BATCH_SIZE || '5', 10)));

let timer = null;
let running = false;

function processWtpCacheRefreshBatch({ logger = console, workerId = `wtp-cache-${process.pid}`, limit = BATCH_SIZE } = {}) {
  if (running) return { skipped: 'already_running' };
  running = true;
  const db = getDb();
  const ctx = buildWhatToPostContext();
  const claimed = claimRefreshJobs(db, {
    limit,
    worker_id: workerId,
    job_types: ['wtp_cache'],
  });

  let completed = 0;
  let failed = 0;
  try {
    for (const job of claimed) {
      const params = job.payload?.params || { channel_id: job.channel_id };
      try {
        computeAndSaveWhatToPostCache(db, params, ctx, computeWhatToPost, {
          computed_by: 'worker',
          refresh_reason: job.refresh_reason || 'queue_refresh',
        });
        completeRefreshJob(db, job.id, { result: { ok: true } });
        completed += 1;
      } catch (err) {
        markChannelWtpCacheError(db, job.channel_id, err, { refresh_reason: 'queue_refresh_error' });
        failRefreshJob(db, job.id, { error_message: err.message || String(err) });
        failed += 1;
        logger.warn?.('[wtp-cache-refresh]', `Job ${job.id} failed: ${err.message || err}`);
      }
    }
  } finally {
    running = false;
  }

  if (completed || failed) {
    logger.info?.('[wtp-cache-refresh]', `processed=${claimed.length} completed=${completed} failed=${failed}`);
  }
  return { claimed: claimed.length, completed, failed };
}

function startWtpCacheRefreshCron({ logger = console } = {}) {
  if (timer) return timer;
  const run = () => processWtpCacheRefreshBatch({ logger });
  timer = setInterval(run, INTERVAL_MS);
  setTimeout(run, STARTUP_DELAY_MS);
  logger.info?.('[wtp-cache-refresh]', `Scheduled every ${Math.round(INTERVAL_MS / 1000)}s`);
  return timer;
}

module.exports = {
  processWtpCacheRefreshBatch,
  startWtpCacheRefreshCron,
};
