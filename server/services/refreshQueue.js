const DEFAULT_JOB_TYPE = 'wtp_cache';
const DEFAULT_PRIORITY = 100;
const FORCE_PRIORITY = 0;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function isoFrom(value) {
  if (!value) return nowIso();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? nowIso() : date.toISOString();
}

function normalizeJobType(value) {
  const jobType = String(value || DEFAULT_JOB_TYPE).trim();
  if (!/^[a-z0-9_.:-]+$/i.test(jobType)) {
    throw new Error(`Invalid refresh job type: ${jobType}`);
  }
  return jobType;
}

function normalizeChannelId(value) {
  return String(value || '').trim();
}

function normalizePriority(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : DEFAULT_PRIORITY;
}

function encodePayload(payload) {
  if (payload == null) return null;
  return typeof payload === 'string' ? payload : JSON.stringify(payload);
}

function decodePayload(row) {
  if (!row || !row.payload_json) return row;
  try {
    return { ...row, payload: JSON.parse(row.payload_json) };
  } catch (_) {
    return { ...row, payload: null };
  }
}

function getRefreshJob(db, id) {
  const row = db.get(`SELECT * FROM refresh_jobs WHERE id = ?`, [id]);
  return decodePayload(row || null);
}

function enqueueRefreshJob(db, input = {}) {
  const jobType = normalizeJobType(input.job_type || input.jobType);
  const channelId = normalizeChannelId(input.channel_id || input.channelId);
  const priority = normalizePriority(input.priority);
  const runAfter = isoFrom(input.run_after || input.runAfter);
  const payloadJson = encodePayload(input.payload_json || input.payload);
  const reason = input.reason ? String(input.reason).slice(0, 120) : null;

  const result = db.run(
    `INSERT INTO refresh_jobs
       (job_type, channel_id, priority, status, run_after, payload_json, refresh_reason, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(job_type, channel_id) WHERE status = 'pending'
     DO UPDATE SET
       priority = CASE
         WHEN excluded.priority < refresh_jobs.priority THEN excluded.priority
         ELSE refresh_jobs.priority
       END,
       run_after = CASE
         WHEN datetime(excluded.run_after) < datetime(refresh_jobs.run_after) THEN excluded.run_after
         ELSE refresh_jobs.run_after
       END,
       payload_json = COALESCE(excluded.payload_json, refresh_jobs.payload_json),
       refresh_reason = COALESCE(excluded.refresh_reason, refresh_jobs.refresh_reason),
       error_message = NULL,
       updated_at = datetime('now')`,
    [jobType, channelId, priority, runAfter, payloadJson, reason],
  );

  const row = db.get(
    `SELECT * FROM refresh_jobs
     WHERE job_type = ? AND channel_id = ? AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    [jobType, channelId],
  );

  return decodePayload({ ...row, inserted: result.changes === 1 && result.lastInsertRowid === row?.id });
}

function forceRefreshJob(db, input = {}) {
  return enqueueRefreshJob(db, {
    ...input,
    priority: FORCE_PRIORITY,
    run_after: nowIso(),
    reason: input.reason || 'force_refresh',
  });
}

function claimRefreshJobs(db, options = {}) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit || '10', 10)));
  const workerId = String(options.worker_id || options.workerId || `worker-${process.pid}`).slice(0, 120);
  const jobTypes = Array.isArray(options.job_types || options.jobTypes)
    ? (options.job_types || options.jobTypes).map(normalizeJobType)
    : [];
  const now = nowIso();

  const tx = db.transaction(() => {
    const typeWhere = jobTypes.length
      ? `AND job_type IN (${jobTypes.map(() => '?').join(',')})`
      : '';
    const rows = db.all(
      `SELECT * FROM refresh_jobs
       WHERE status = 'pending'
         AND datetime(run_after) <= datetime(?)
         ${typeWhere}
       ORDER BY priority ASC, datetime(run_after) ASC, id ASC
       LIMIT ${limit}`,
      [now, ...jobTypes],
    );

    const claimed = [];
    for (const row of rows) {
      const updated = db.run(
        `UPDATE refresh_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_by = ?,
             locked_at = datetime('now'),
             started_at = COALESCE(started_at, datetime('now')),
             updated_at = datetime('now'),
             error_message = NULL
         WHERE id = ? AND status = 'pending'`,
        [workerId, row.id],
      );
      if ((updated.changes || 0) === 1) {
        claimed.push(getRefreshJob(db, row.id));
      }
    }
    return claimed;
  });

  return tx();
}

function completeRefreshJob(db, id, options = {}) {
  const resultPayload = encodePayload(options.result || options.result_json);
  const result = db.run(
    `UPDATE refresh_jobs
     SET status = 'done',
         completed_at = datetime('now'),
         locked_by = NULL,
         locked_at = NULL,
         result_json = COALESCE(?, result_json),
         error_message = NULL,
         updated_at = datetime('now')
     WHERE id = ? AND status = 'running'`,
    [resultPayload, id],
  );
  return { ok: (result.changes || 0) === 1, job: getRefreshJob(db, id) };
}

function failRefreshJob(db, id, options = {}) {
  const maxAttempts = Math.max(1, Number.parseInt(options.max_attempts || options.maxAttempts || DEFAULT_MAX_ATTEMPTS, 10));
  const retryDelayMs = Math.max(0, Number.parseInt(options.retry_delay_ms || options.retryDelayMs || DEFAULT_RETRY_DELAY_MS, 10));
  const errorMessage = String(options.error_message || options.errorMessage || 'refresh job failed').slice(0, 500);
  const row = db.get(`SELECT * FROM refresh_jobs WHERE id = ?`, [id]);
  if (!row || row.status !== 'running') return { ok: false, job: decodePayload(row || null) };

  const shouldRetry = options.retry === false ? false : row.attempts < maxAttempts;
  const nextStatus = shouldRetry ? 'pending' : 'failed';
  const runAfter = new Date(Date.now() + retryDelayMs).toISOString();
  const result = db.run(
    `UPDATE refresh_jobs
     SET status = ?,
         run_after = CASE WHEN ? = 'pending' THEN ? ELSE run_after END,
         failed_at = CASE WHEN ? = 'failed' THEN datetime('now') ELSE failed_at END,
         locked_by = NULL,
         locked_at = NULL,
         error_message = ?,
         updated_at = datetime('now')
     WHERE id = ? AND status = 'running'`,
    [nextStatus, nextStatus, runAfter, nextStatus, errorMessage, id],
  );

  return { ok: (result.changes || 0) === 1, retrying: shouldRetry, job: getRefreshJob(db, id) };
}

function getRefreshQueueStats(db) {
  const rows = db.all(
    `SELECT job_type, status, COUNT(*) AS count, MIN(priority) AS best_priority, MIN(run_after) AS next_run_after
     FROM refresh_jobs
     GROUP BY job_type, status
     ORDER BY job_type, status`,
  );
  return rows;
}

module.exports = {
  DEFAULT_JOB_TYPE,
  DEFAULT_PRIORITY,
  FORCE_PRIORITY,
  enqueueRefreshJob,
  forceRefreshJob,
  claimRefreshJobs,
  completeRefreshJob,
  failRefreshJob,
  getRefreshJob,
  getRefreshQueueStats,
};
