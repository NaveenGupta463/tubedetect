'use strict';

// ── Bulk identity detection ───────────────────────────────────────────────────
// Classifies all ingested channels that have video titles but no identity yet.
// Called from the pipeline (Step 5) and the admin bulk-detect button.

const { getDb }              = require('../db/init');
const { getAllIngestedChannels, getChannelVideoTitles, saveChannelIdentity, updateChannelNiche } = require('../db/queries');
const { classifyChannel }    = require('../services/channelClassifier');

const jobState = {
  running:   false,
  total:     0,
  done:      0,
  detected:  0,
  skipped:   0, // no video titles yet — not an error
  failed:    0, // actual AI/network errors
  startedAt: null,
};

function getJobState() { return { ...jobState }; }

async function runBulkIdentityDetection({ batchSize = 20, batchGapMs = 1000 } = {}) {
  if (jobState.running) {
    console.log('[identity] Bulk detection already running — skipping');
    return { skipped: true };
  }

  const db      = getDb();
  const all     = getAllIngestedChannels(db);
  const pending = all.filter(ch => !ch.identity_last_detected_at);

  if (!pending.length) {
    console.log('[identity] All channels already have identity — nothing to do');
    return { detected: 0, failed: 0, total: 0 };
  }

  jobState.running   = true;
  jobState.total     = pending.length;
  jobState.done      = 0;
  jobState.detected  = 0;
  jobState.skipped   = 0;
  jobState.failed    = 0;
  jobState.startedAt = new Date().toISOString();

  console.log(`[identity] Starting bulk detection — ${pending.length} channels pending`);

  const errorLog = new Map(); // error message → count, for deduplication

  async function processOne(ch) {
    try {
      const titles = getChannelVideoTitles(db, ch.channel_id, 50);
      if (!titles.length) { jobState.skipped++; jobState.done++; return; }

      const descRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [ch.channel_id]);
      const desc    = (() => {
        try {
          const j = JSON.parse(descRow?.raw_json || '{}');
          const d = j.snippet?.description;
          return (d && d.trim().length > 10) ? d.trim() : null;
        } catch (_) { return null; }
      })();

      const result = await classifyChannel({ channelName: ch.channel_name, titles, description: desc });
      saveChannelIdentity(db, ch.channel_id, {
        ...result,
        identity_last_detected_at: new Date().toISOString(),
        identity_source: 'ai_detected',
      });
      if (result.primary_niche) updateChannelNiche(db, ch.channel_id, result.primary_niche);
      jobState.detected++;
    } catch (e) {
      jobState.failed++;
      // Log each unique error type once; log first occurrence with channel name
      const key = e.message?.slice(0, 80) ?? 'unknown';
      const prev = errorLog.get(key) ?? 0;
      if (prev === 0) console.error(`[identity] error (${ch.channel_name}): ${e.message}`);
      errorLog.set(key, prev + 1);
    }
    jobState.done++;
  }

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    await Promise.all(batch.map(ch => processOne(ch)));

    // Log error summary every 10 batches so the console stays readable
    if (((i / batchSize) + 1) % 10 === 0 && errorLog.size > 0) {
      for (const [msg, count] of errorLog) {
        console.warn(`[identity] error x${count}: ${msg}`);
      }
    }

    if (i + batchSize < pending.length) await new Promise(r => setTimeout(r, batchGapMs));
  }

  if (errorLog.size > 0) {
    console.warn('[identity] Error summary:');
    for (const [msg, count] of errorLog) console.warn(`  x${count}: ${msg}`);
  }

  jobState.running = false;
  console.log(`[identity] Done — detected=${jobState.detected} skipped=${jobState.skipped} failed=${jobState.failed} total=${jobState.total}`);
  return { detected: jobState.detected, skipped: jobState.skipped, failed: jobState.failed, total: jobState.total };
}

module.exports = { runBulkIdentityDetection, getJobState };
