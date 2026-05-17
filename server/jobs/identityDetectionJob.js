'use strict';

// ── Bulk identity detection ───────────────────────────────────────────────────
// Classifies all ingested channels that have video titles but no identity yet.
// Called from the pipeline (Step 5) and the admin bulk-detect button.

const { getDb }              = require('../db/init');
const { getAllIngestedChannels, getChannelVideoTitles, saveChannelIdentity, updateChannelNiche } = require('../db/queries');
const { classifyChannel }    = require('../services/channelClassifier');

// Shared module-level state — lets the admin progress endpoint read live counts
// whether the job was triggered by the pipeline or the admin button.
const jobState = {
  running:   false,
  total:     0,
  done:      0,
  detected:  0,
  failed:    0,
  startedAt: null,
};

function getJobState() { return { ...jobState }; }

async function runBulkIdentityDetection({ batchSize = 1, batchGapMs = 150 } = {}) {
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
  jobState.failed    = 0;
  jobState.startedAt = new Date().toISOString();

  console.log(`[identity] Starting bulk detection — ${pending.length} channels pending`);

  async function processOne(ch) {
    try {
      const titles = getChannelVideoTitles(db, ch.channel_id, 50);
      if (!titles.length) { jobState.failed++; jobState.done++; return; }

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
      if (jobState.failed <= 3) console.error(`[identity] classify error (${ch.channel_name}):`, e.message);
    }
    jobState.done++;
  }

  // Process in parallel batches — faster on paid OpenAI tiers
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    await Promise.all(batch.map(ch => processOne(ch)));
    if (i + batchSize < pending.length) await new Promise(r => setTimeout(r, batchGapMs));
  }

  jobState.running = false;
  console.log(`[identity] Done — detected=${jobState.detected} failed=${jobState.failed} total=${jobState.total}`);
  return { detected: jobState.detected, failed: jobState.failed, total: jobState.total };
}

module.exports = { runBulkIdentityDetection, getJobState };
