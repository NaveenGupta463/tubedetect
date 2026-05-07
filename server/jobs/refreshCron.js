const cron = require('node-cron');
const { getDb }                             = require('../db/init');
const { fetchVideoStatsBatch }              = require('../services/youtubeMetrics');
const { quotaAvailable, recordUsage }       = require('../services/quotaGuard');

const REFRESH_LIMIT     = 200;
const HIGH_PERF_THRESH  = 1.5; // normalized ~top 15%

let lastRun     = null;
let lastCount   = 0;

/**
 * Refresh views/likes/performance_score for:
 *   - videos uploaded < 7 days ago (stats still volatile)
 *   - videos with high performance_score (high-value training data)
 * Ordered by last_updated_at ASC (stalest first, NULL first).
 * LIMIT 200 per run = max 4 API calls (50 IDs/batch).
 */
async function runRefreshCycle() {
  if (!quotaAvailable()) {
    console.log('[refreshCron] Quota at limit — skipping');
    return;
  }

  const db = getDb();

  const candidates = db.all(
    `SELECT v.id, v.youtube_video_id, v.channel_size, v.upload_date
     FROM videos v
     JOIN performance_metrics pm ON pm.video_id = v.id
     WHERE v.youtube_video_id IS NOT NULL
       AND (
         (julianday('now') - julianday(v.upload_date)) < 7
         OR pm.performance_score > ?
       )
     ORDER BY v.last_updated_at ASC NULLS FIRST
     LIMIT ?`,
    [HIGH_PERF_THRESH, REFRESH_LIMIT],
  );

  if (!candidates.length) {
    console.log('[refreshCron] No candidates to refresh');
    return;
  }

  console.log(`[refreshCron] Refreshing ${candidates.length} videos`);

  const ytIds  = candidates.map(c => c.youtube_video_id);
  const idMap  = new Map(candidates.map(c => [c.youtube_video_id, c]));
  const now    = new Date().toISOString();
  let refreshed = 0;

  for (let i = 0; i < ytIds.length; i += 50) {
    if (!quotaAvailable()) { console.warn('[refreshCron] Quota hit mid-run, stopping'); break; }

    const batch = ytIds.slice(i, i + 50);
    try {
      const statsMap = await fetchVideoStatsBatch(batch);
      recordUsage(1, 'refresh');

      for (const [ytId, stats] of statsMap) {
        const row      = idMap.get(ytId);
        if (!row) continue;
        const ageDays  = row.upload_date
          ? Math.round((Date.now() - new Date(row.upload_date).getTime()) / 86400000)
          : null;
        const perfScore = Math.log((stats.views + 1) / Math.max(row.channel_size, 1));

        db.run(
          `UPDATE performance_metrics
           SET views=?, likes=?, upload_age_days=?, performance_score=?, training_ready=1
           WHERE video_id=?`,
          [stats.views, stats.likes, ageDays, perfScore, row.id],
        );
        db.run(
          `UPDATE videos SET last_updated_at=? WHERE id=?`,
          [now, row.id],
        );
        refreshed++;
      }
    } catch (e) {
      console.warn('[refreshCron] Batch failed:', e.message);
    }
  }

  lastRun   = now;
  lastCount = refreshed;
  console.log(`[refreshCron] Done — refreshed ${refreshed} videos`);
}

function getRefreshStats() {
  return { last_run: lastRun, last_count: lastCount };
}

function startRefreshCron() {
  cron.schedule('0 */6 * * *', async () => {
    try { await runRefreshCycle(); }
    catch (e) { console.error('[refreshCron] Error:', e.message); }
  });
  console.log('[Refresh Cron] Scheduled — every 6 hours');
}

module.exports = { startRefreshCron, runRefreshCycle, getRefreshStats };
