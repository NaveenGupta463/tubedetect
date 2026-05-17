'use strict';

// Runs an async job function and auto-retries on failure with exponential backoff.
// Never throws — errors are logged and retried in the background via setTimeout.
// Each cron tick gets a fresh attempt counter, so stale retries from a previous
// tick don't block a new scheduled run.

function withCronRetry(fn, label, { maxAttempts = 3, retryDelayMs = 20 * 60 * 1000 } = {}) {
  let left = maxAttempts;

  const run = async () => {
    try {
      await fn();
    } catch (e) {
      console.error(`[${label}] Run failed: ${e.message}`);
      if (--left > 0) {
        const mins = Math.round(retryDelayMs / 60000);
        console.warn(`[${label}] Auto-retry in ${mins}m (${left} attempt${left > 1 ? 's' : ''} left)`);
        setTimeout(run, retryDelayMs);
      } else {
        console.error(`[${label}] All ${maxAttempts} attempts exhausted — will retry at next scheduled run`);
      }
    }
  };

  run(); // fire-and-forget; never awaited so cron tick doesn't block
}

module.exports = { withCronRetry };
