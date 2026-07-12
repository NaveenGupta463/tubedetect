'use strict';

const cron = require('node-cron');
const { getDb } = require('../db/init');
const { persistCreatorIdeaDna, DEFAULT_VIDEO_LIMIT } = require('../services/creatorIdeaDna');
const { recordPipelineHealth } = require('../services/pipelineHealth');

const DEFAULT_LIMIT = parseInt(process.env.CREATOR_DNA_REFRESH_LIMIT || '200', 10);
const STARTUP_LIMIT = parseInt(process.env.CREATOR_DNA_STARTUP_LIMIT || '50', 10);
const VIDEO_LIMIT = parseInt(process.env.CREATOR_DNA_REFRESH_VIDEO_LIMIT || String(DEFAULT_VIDEO_LIMIT), 10);
const STALE_HOURS = parseInt(process.env.CREATOR_DNA_STALE_HOURS || String(7 * 24), 10);
const STARTUP_DELAY_MS = parseInt(process.env.CREATOR_DNA_STARTUP_DELAY_MS || '180000', 10);

let running = false;
let started = false;

function selectDueChannels(db, limit) {
  const staleModifier = `-${STALE_HOURS} hours`;
  const rows = [];
  const seen = new Set();

  function add(batch) {
    for (const row of batch) {
      if (seen.has(row.channel_id)) continue;
      seen.add(row.channel_id);
      rows.push(row);
      if (rows.length >= limit) break;
    }
  }

  const baseSelect = `
    SELECT ic.channel_id,
           ic.channel_name,
           cid.updated_at AS dna_updated_at,
           cid.last_video_published_at AS dna_last_video_at
      FROM ingested_channels ic
      LEFT JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
     WHERE ic.ingest_enabled = 1
       AND EXISTS (
         SELECT 1 FROM ingested_videos iv
          WHERE iv.channel_id = ic.channel_id
            AND iv.title IS NOT NULL
            AND iv.title != ''
       )`;

  add(db.all(
    `${baseSelect}
       AND cid.channel_id IS NULL
     ORDER BY ic.channel_subscribers DESC
     LIMIT ?`,
    [limit],
  ));

  if (rows.length < limit) {
    add(db.all(
      `${baseSelect}
         AND cid.channel_id IS NOT NULL
         AND datetime(cid.updated_at) < datetime('now', ?)
       ORDER BY datetime(cid.updated_at) ASC
       LIMIT ?`,
      [staleModifier, limit - rows.length],
    ));
  }

  if (rows.length < limit) {
    add(db.all(
      `${baseSelect}
         AND cid.channel_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM ingested_videos iv
            WHERE iv.channel_id = ic.channel_id
              AND iv.title IS NOT NULL
              AND iv.title != ''
              AND (
                cid.last_video_published_at IS NULL
                OR datetime(iv.published_at) > datetime(cid.last_video_published_at)
              )
         )
       ORDER BY ic.channel_subscribers DESC
       LIMIT ?`,
      [limit - rows.length],
    ));
  }

  return rows;
}

function runCreatorIdeaDnaRefresh(options = {}) {
  if (running) {
    console.warn('[creator-dna-job] Already running - skipping');
    return { skipped: true, reason: 'already_running' };
  }

  const startedAt = Date.now();
  const limit = Number(options.limit || DEFAULT_LIMIT);
  const videoLimit = Number(options.videoLimit || VIDEO_LIMIT);
  const db = getDb();
  const targets = selectDueChannels(db, limit);

  running = true;
  let ok = 0;
  let failed = 0;
  const errors = [];

  try {
    for (const target of targets) {
      try {
        const result = persistCreatorIdeaDna(db, target.channel_id, { limit: videoLimit });
        if (result.ok) ok++;
        else {
          failed++;
          if (errors.length < 5) errors.push(`${target.channel_name || target.channel_id}: ${result.reason}`);
        }
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(`${target.channel_name || target.channel_id}: ${e.message}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[creator-dna-job] Done - targets=${targets.length} ok=${ok} failed=${failed} ` +
      `limit=${limit} video_limit=${videoLimit} ${durationMs}ms`,
    );

    try {
      recordPipelineHealth(db, {
        job_name: 'creator_idea_dna_refresh',
        status: failed > 0 ? 'warn' : 'ok',
        started_at: new Date(startedAt).toISOString(),
        duration_ms: durationMs,
        metrics: {
          targets: targets.length,
          ok,
          failed,
          limit,
          video_limit: videoLimit,
          stale_hours: STALE_HOURS,
          errors,
        },
        error_message: errors.join('; ') || null,
      });
    } catch (_) {}

    return { targets: targets.length, ok, failed, errors };
  } finally {
    running = false;
  }
}

function scheduleStartupCatchup() {
  if (process.env.CREATOR_DNA_STARTUP_CATCHUP === '0') return;
  const timer = setTimeout(() => {
    try {
      runCreatorIdeaDnaRefresh({ limit: STARTUP_LIMIT, videoLimit: VIDEO_LIMIT });
    } catch (e) {
      console.warn('[creator-dna-job] Startup catch-up failed:', e.message);
    }
  }, STARTUP_DELAY_MS);
  timer.unref?.();
}

function startCreatorIdeaDnaCron() {
  if (started) return;
  started = true;

  cron.schedule('30 */6 * * *', () => {
    try {
      runCreatorIdeaDnaRefresh();
    } catch (e) {
      console.error('[creator-dna-job] Cron failed:', e.message);
    }
  });

  scheduleStartupCatchup();
  console.log('[creator-dna-job] Cron scheduled - every 6h at minute 30');
}

module.exports = {
  startCreatorIdeaDnaCron,
  runCreatorIdeaDnaRefresh,
  selectDueChannels,
};
