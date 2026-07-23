const { getDb } = require('../db/init');
const quotaGuard = require('../services/quotaGuard');
const { ingestChannel } = require('./historicalIngest');
const {
  claimRefreshJobs,
  completeRefreshJob,
  failRefreshJob,
} = require('../services/refreshQueue');

// Background backfill of the FULL video catalog + growth snapshots for channels that only got a LIGHT
// onboard (a user searched them → we stored just recent uploads and stamped last_ingested_at, so the
// daily historical-ingest cron — which selects `last_ingested_at IS NULL` — permanently skips them).
// Onboarding enqueues a 'full_ingest' job; this worker drains the queue off the request path, running
// the real ingestChannel (500+ writes, quota-heavy) one channel at a time. Mirrors wtpCacheRefreshJob,
// but async + quota-gated because it calls the YouTube API.
const INTERVAL_MS = Math.max(30_000, Number.parseInt(process.env.FULL_INGEST_REFRESH_INTERVAL_MS || '120000', 10));
const STARTUP_DELAY_MS = Math.max(0, Number.parseInt(process.env.FULL_INGEST_REFRESH_STARTUP_DELAY_MS || '30000', 10));
const BATCH_SIZE = Math.max(1, Math.min(5, Number.parseInt(process.env.FULL_INGEST_REFRESH_BATCH_SIZE || '1', 10)));
const MAX_VIDEOS = Math.max(1, Number.parseInt(process.env.FULL_INGEST_MAX_VIDEOS || '500', 10));

let timer = null;
let running = false;

async function processFullIngestBatch({ logger = console, workerId = `full-ingest-${process.pid}`, limit = BATCH_SIZE } = {}) {
  if (running) return { skipped: 'already_running' };
  // Full ingest is quota-heavy — don't even CLAIM jobs when quota is gone (leave them pending for a
  // later tick rather than burning attempts on a run that can't fetch).
  if (!quotaGuard.quotaAvailable()) return { skipped: 'quota_exhausted' };
  running = true;
  const db = getDb();
  let claimed = [];
  let completed = 0, failed = 0;
  try {
    claimed = claimRefreshJobs(db, { limit, worker_id: workerId, job_types: ['full_ingest'] });
    for (const job of claimed) {
      const ch = db.get(
        `SELECT channel_id, uploads_playlist_id, channel_subscribers, niche FROM ingested_channels WHERE channel_id = ?`,
        [job.channel_id],
      );
      if (!ch) { completeRefreshJob(db, job.id, { result: { ok: false, reason: 'channel_gone' } }); continue; }
      try {
        const r = await ingestChannel(ch, { maxVideos: job.payload?.max_videos || MAX_VIDEOS });
        completeRefreshJob(db, job.id, { result: { ok: true, inserted: r.inserted, snapshots: r.snapshots } });
        completed += 1;
        logger.info?.('[full-ingest]', `${job.channel_id} inserted=${r.inserted} snapshots=${r.snapshots}`);
      } catch (err) {
        failRefreshJob(db, job.id, { error_message: err.message || String(err) });
        failed += 1;
        logger.warn?.('[full-ingest]', `Job ${job.id} (${job.channel_id}) failed: ${err.message || err}`);
      }
      if (!quotaGuard.quotaAvailable()) break; // quota drained mid-batch — stop; remaining jobs stay pending
    }
  } finally {
    running = false;
  }

  if (completed || failed) {
    logger.info?.('[full-ingest]', `processed=${claimed.length} completed=${completed} failed=${failed}`);
  }
  return { claimed: claimed.length, completed, failed };
}

function startFullIngestRefreshCron({ logger = console } = {}) {
  if (timer) return timer;
  const run = () => { processFullIngestBatch({ logger }).catch(e => logger.warn?.('[full-ingest]', e.message || e)); };
  timer = setInterval(run, INTERVAL_MS);
  setTimeout(run, STARTUP_DELAY_MS);
  logger.info?.('[full-ingest]', `Scheduled every ${Math.round(INTERVAL_MS / 1000)}s`);
  return timer;
}

module.exports = {
  processFullIngestBatch,
  startFullIngestRefreshCron,
};
