const cron = require('node-cron');
const { getDb }             = require('../db/init');
const { fetchVideoMetrics } = require('../services/youtubeMetrics');

/**
 * performance_score = log(views_30d / channel_size)
 * Returns null for invalid inputs — spec: skip row, do not compute.
 *   views_30d < 1      → null
 *   channel_size <= 0  → null
 */
function computePerformanceScore(views30d, channelSize) {
  if (!views30d || views30d < 1)        return null;
  if (!channelSize || channelSize <= 0) return null;
  return Math.log(views30d / channelSize);
}

async function processVideo(video) {
  const db = getDb();
  if (!video.youtube_video_id) return;

  let metrics;
  try {
    metrics = await fetchVideoMetrics(video.youtube_video_id);
  } catch (e) {
    console.warn(`[cron] Metrics fetch failed for ${video.youtube_video_id}:`, e.message);
    return;
  }

  const now      = Date.now();
  const daysOld  = (now - new Date(video.upload_date).getTime()) / (1000 * 60 * 60 * 24);
  const pm       = db.get('SELECT * FROM performance_metrics WHERE video_id = ?', [video.id]);
  if (!pm) return;

  // 7-day feedback
  if (daysOld >= 7 && !pm.feedback_7d_collected) {
    db.run(
      `UPDATE performance_metrics
       SET views_7d = ?, ctr_7d = ?, retention_7d = ?, feedback_7d_collected = 1
       WHERE video_id = ?`,
      [metrics.views, metrics.ctr, metrics.retention, video.id],
    );
    console.log(`[cron] 7d feedback collected — video ${video.id}`);
  }

  // 30-day feedback + mark training_ready
  if (daysOld >= 30 && !pm.feedback_30d_collected) {
    const perf = computePerformanceScore(metrics.views, video.channel_size);
    db.run(
      `UPDATE performance_metrics
       SET views_30d = ?, ctr_30d = ?, retention_30d = ?,
           feedback_30d_collected = 1, performance_score = ?, training_ready = ?
       WHERE video_id = ?`,
      [
        metrics.views, metrics.ctr, metrics.retention,
        perf,
        perf !== null ? 1 : 0,
        video.id,
      ],
    );
    console.log(
      `[cron] 30d feedback collected — video ${video.id} ` +
      `perf=${perf?.toFixed(3) ?? 'null'} training_ready=${perf !== null ? 1 : 0}`,
    );
  }
}

async function runFeedbackCollection() {
  const db = getDb();
  console.log('[cron] Running feedback collection...');

  // Only Wing 2 videos with incomplete feedback
  const pending = db.all(
    `SELECT v.id, v.youtube_video_id, v.upload_date, v.channel_size
     FROM videos v
     JOIN performance_metrics pm ON pm.video_id = v.id
     WHERE v.wing = 'post'
       AND v.youtube_video_id IS NOT NULL
       AND (pm.feedback_7d_collected = 0 OR pm.feedback_30d_collected = 0)
       AND pm.training_ready = 0`,
    [],
  );

  console.log(`[cron] ${pending.length} video(s) pending`);
  for (const video of pending) await processVideo(video);
  console.log('[cron] Tick complete');
}

function startCron() {
  cron.schedule('0 2 * * *', async () => {
    try { await runFeedbackCollection(); }
    catch (e) { console.error('[cron] Error:', e.message); }
  });
  console.log('[Cron] Scheduled — daily at 02:00 UTC');
}

module.exports = { startCron, runFeedbackCollection };
