const assert = require('assert');
const { getDb, closeDb } = require('../db/init');
const {
  enqueueRefreshJob,
  forceRefreshJob,
  claimRefreshJobs,
  completeRefreshJob,
  failRefreshJob,
  getRefreshJob,
} = require('../services/refreshQueue');

const TEST_CHANNEL = `__p4_refresh_queue_test_${Date.now()}`;

function cleanup(db) {
  db.run(`DELETE FROM refresh_jobs WHERE channel_id = ?`, [TEST_CHANNEL]);
}

function main() {
  const db = getDb();
  cleanup(db);

  try {
    const first = enqueueRefreshJob(db, {
      job_type: 'wtp_cache',
      channel_id: TEST_CHANNEL,
      priority: 100,
      reason: 'p4_validation',
    });
    assert(first?.id, 'first enqueue should create a pending job');

    const deduped = enqueueRefreshJob(db, {
      job_type: 'wtp_cache',
      channel_id: TEST_CHANNEL,
      priority: 50,
      run_after: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.strictEqual(deduped.id, first.id, 'pending enqueue should be idempotent by job_type/channel_id');
    assert.strictEqual(deduped.priority, 50, 'dedupe should keep the higher queue priority');

    const forced = forceRefreshJob(db, {
      job_type: 'wtp_cache',
      channel_id: TEST_CHANNEL,
    });
    assert.strictEqual(forced.id, first.id, 'force refresh should bump the same pending job');
    assert.strictEqual(forced.priority, 0, 'force refresh should set tier-0 priority');

    const claimed = claimRefreshJobs(db, {
      limit: 1,
      worker_id: 'p4-validation',
      job_types: ['wtp_cache'],
    });
    assert.strictEqual(claimed.length, 1, 'claim should return one due job');
    assert.strictEqual(claimed[0].id, first.id, 'claim should pick the pending job');
    assert.strictEqual(claimed[0].status, 'running', 'claim should mark job running');
    assert.strictEqual(claimed[0].attempts, 1, 'claim should increment attempts');

    const complete = completeRefreshJob(db, claimed[0].id, { result: { ok: true } });
    assert.strictEqual(complete.ok, true, 'complete should update a running job');
    assert.strictEqual(complete.job.status, 'done', 'completed job should be done');

    const second = enqueueRefreshJob(db, {
      job_type: 'wtp_cache',
      channel_id: TEST_CHANNEL,
      priority: 80,
    });
    assert.notStrictEqual(second.id, first.id, 'done job should not block a new pending refresh');

    const retryClaim = claimRefreshJobs(db, { limit: 1, worker_id: 'p4-validation' });
    assert.strictEqual(retryClaim.length, 1, 'second job should be claimable');
    const failed = failRefreshJob(db, retryClaim[0].id, {
      error_message: 'synthetic failure',
      retry_delay_ms: 1,
      max_attempts: 3,
    });
    assert.strictEqual(failed.ok, true, 'fail should update a running job');
    assert.strictEqual(failed.retrying, true, 'first failure should be retried');
    assert.strictEqual(failed.job.status, 'pending', 'retryable failure should return job to pending');

    const finalRow = getRefreshJob(db, retryClaim[0].id);
    assert.strictEqual(finalRow.error_message, 'synthetic failure', 'failure reason should be stored');

    console.log(JSON.stringify({
      ok: true,
      test_channel: TEST_CHANNEL,
      first_job_id: first.id,
      second_job_id: second.id,
      checks: [
        'enqueue',
        'dedupe_pending',
        'force_priority',
        'claim',
        'complete',
        'requeue_after_done',
        'fail_retry',
      ],
    }, null, 2));
  } finally {
    cleanup(db);
    closeDb();
  }
}

main();
