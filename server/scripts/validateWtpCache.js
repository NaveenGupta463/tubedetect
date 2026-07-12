const assert = require('assert');
const { getDb, closeDb } = require('../db/init');
const { computeWhatToPost } = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');
const {
  getCachedOrComputeWhatToPost,
  getChannelWtpCache,
} = require('../services/wtpCache');
const { processWtpCacheRefreshBatch } = require('../jobs/wtpCacheRefreshJob');

const CHANNEL_ID = process.argv[2] || 'UCA295QVkf9O1RQ8_-s3FVXg';

function restoreCacheRow(db, row) {
  db.run(`DELETE FROM channel_wtp_cache WHERE channel_id = ?`, [CHANNEL_ID]);
  if (!row) return;
  db.run(
    `INSERT INTO channel_wtp_cache
       (channel_id, payload_json, computed_at, expires_at, status, source_versions_json,
        refresh_reason, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.channel_id,
      row.payload_json,
      row.computed_at,
      row.expires_at,
      row.status,
      row.source_versions_json,
      row.refresh_reason,
      row.error_message,
      row.created_at,
      row.updated_at,
    ],
  );
}

function main() {
  const db = getDb();
  const ctx = buildWhatToPostContext();
  const existingCache = db.get(`SELECT * FROM channel_wtp_cache WHERE channel_id = ?`, [CHANNEL_ID]);
  const existingJobIds = new Set(
    db.all(`SELECT id FROM refresh_jobs WHERE job_type = 'wtp_cache' AND channel_id = ?`, [CHANNEL_ID]).map(r => r.id),
  );

  try {
    db.run(`DELETE FROM channel_wtp_cache WHERE channel_id = ?`, [CHANNEL_ID]);
    db.run(`DELETE FROM refresh_jobs WHERE job_type = 'wtp_cache' AND channel_id = ?`, [CHANNEL_ID]);

    const cold = getCachedOrComputeWhatToPost(db, { channel_id: CHANNEL_ID }, ctx, computeWhatToPost);
    assert.strictEqual(cold.cache.status, 'fresh', 'cold compute should return fresh cache metadata');
    assert.strictEqual(cold.cache.source, 'api_cold', 'missing cache should compute once in the API lane');
    assert(Array.isArray(cold.ideas) && cold.ideas.length > 0, 'cold WTP should return ideas');

    const saved = getChannelWtpCache(db, CHANNEL_ID);
    assert(saved?.payload, 'cold compute should save channel_wtp_cache row');

    const fresh = getCachedOrComputeWhatToPost(db, { channel_id: CHANNEL_ID }, ctx, computeWhatToPost);
    assert.strictEqual(fresh.cache.status, 'fresh', 'second request should return fresh cache');
    assert.strictEqual(fresh.cache.source, 'cache', 'second request should read from cache');

    db.run(
      `UPDATE channel_wtp_cache
       SET expires_at = ?, updated_at = datetime('now')
       WHERE channel_id = ?`,
      [new Date(Date.now() - 60_000).toISOString(), CHANNEL_ID],
    );

    const stale = getCachedOrComputeWhatToPost(db, { channel_id: CHANNEL_ID }, ctx, computeWhatToPost);
    assert.strictEqual(stale.cache.status, 'stale', 'expired cache should return stale payload immediately');
    assert.strictEqual(stale.cache.queued_refresh, true, 'expired cache should enqueue refresh');

    const pending = db.get(
      `SELECT * FROM refresh_jobs WHERE job_type = 'wtp_cache' AND channel_id = ? AND status = 'pending'`,
      [CHANNEL_ID],
    );
    assert(pending?.id, 'stale request should create a pending refresh job');

    const workerResult = processWtpCacheRefreshBatch({
      logger: { info() {}, warn() {} },
      workerId: 'p2-validation',
      limit: 1,
    });
    assert.strictEqual(workerResult.completed, 1, 'worker batch should complete the queued WTP refresh');

    const refreshed = getChannelWtpCache(db, CHANNEL_ID);
    assert(refreshed?.expires_at && new Date(refreshed.expires_at).getTime() > Date.now(), 'worker refresh should write a non-stale cache row');

    const cachedAfterWorker = getCachedOrComputeWhatToPost(db, { channel_id: CHANNEL_ID }, ctx, computeWhatToPost);
    assert.strictEqual(cachedAfterWorker.cache.status, 'fresh', 'post-worker request should read fresh cache');
    assert.strictEqual(cachedAfterWorker.cache.source, 'cache', 'post-worker request should not recompute');

    console.log(JSON.stringify({
      ok: true,
      channel_id: CHANNEL_ID,
      cold_ideas: cold.ideas.length,
      fresh_source: fresh.cache.source,
      stale_refresh_job_id: pending.id,
      worker_completed: workerResult.completed,
      refreshed_expires_at: refreshed.expires_at,
    }, null, 2));
  } finally {
    const createdJobIds = db.all(
      `SELECT id FROM refresh_jobs WHERE job_type = 'wtp_cache' AND channel_id = ?`,
      [CHANNEL_ID],
    ).filter(r => !existingJobIds.has(r.id)).map(r => r.id);
    for (const id of createdJobIds) {
      db.run(`DELETE FROM refresh_jobs WHERE id = ?`, [id]);
    }
    restoreCacheRow(db, existingCache || null);
    closeDb();
  }
}

main();
