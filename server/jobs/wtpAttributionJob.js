'use strict';

// WTP Attribution Job — nightly background automation for attribution + outcome backfill.
// Runs buildCandidates/upsertCandidate/promoteToVideoMatch for new videos on channels
// with WTP impressions, then runs computeAndStoreOutcome for matches with 7d snapshots.
//
// Scheduled: nightly 02:00 UTC (after snapshot windows close).
// Single-run guard prevents overlap if the job overruns its interval.

const cron = require('node-cron');
const { getDb } = require('../db/init');
const {
  buildCandidates,
  upsertCandidate,
  promoteToVideoMatch,
  MAX_LOOKBACK_DAYS,
} = require('../services/wtpAttributionMatcher');
const { computeAndStoreOutcome } = require('../services/wtpOutcomeQuality');

const BATCH_LIMIT = Number(process.env.WTP_ATTRIBUTION_BATCH || 500);

let running = false;

function fetchNewVideos(db) {
  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  return db.all(
    `SELECT iv.youtube_video_id AS video_id, iv.channel_id,
            COALESCE(iv.title, '') AS video_title, iv.published_at
     FROM ingested_videos iv
     WHERE iv.published_at >= ?
       AND iv.published_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM wtp_attribution_candidates wac
         WHERE wac.video_id = iv.youtube_video_id AND wac.channel_id = iv.channel_id
       )
       AND EXISTS (
         SELECT 1 FROM wtp_impressions wi WHERE wi.channel_id = iv.channel_id LIMIT 1
       )
     ORDER BY iv.published_at DESC
     LIMIT ?`,
    [since, BATCH_LIMIT],
  );
}

function fetchBackfillCandidates(db) {
  return db.all(
    `SELECT m.id, m.channel_id, m.idea_key, m.video_id, m.topic,
            m.rec_source, m.rec_type, m.score, m.confidence,
            m.days_to_publish, m.match_confidence
     FROM wtp_video_matches m
     WHERE m.video_id IS NOT NULL
       AND m.performance_computed_at IS NULL
       AND EXISTS (
         SELECT 1 FROM video_growth_snapshots
         WHERE video_id = m.video_id AND bucket = '7d' AND views IS NOT NULL LIMIT 1
       )
     ORDER BY m.created_at DESC
     LIMIT ?`,
    [BATCH_LIMIT],
  );
}

function runAttributionJob() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  const db = getDb();

  let attributed = 0;
  let promoted = 0;
  let backfilled = 0;
  let errors = 0;

  try {
    const videos = fetchNewVideos(db);
    for (const video of videos) {
      try {
        const candidates = buildCandidates(
          db, video.channel_id, video.video_id, video.video_title, video.published_at,
        );
        const tx = db.transaction(() => {
          for (const c of candidates) {
            if (c.match_confidence === 'unlikely') continue;
            upsertCandidate(db, c);
            attributed++;
            if (c.match_confidence === 'highly_likely' && promoteToVideoMatch(db, c)) promoted++;
          }
        });
        tx();
      } catch (e) {
        errors++;
      }
    }

    const backfillRows = fetchBackfillCandidates(db);
    for (const match of backfillRows) {
      try {
        const result = computeAndStoreOutcome(db, match);
        if (result) backfilled++;
      } catch (e) {
        errors++;
      }
    }

    const ms = Date.now() - t0;
    console.log(
      `[wtpAttribution] done — attributed=${attributed} promoted=${promoted} backfilled=${backfilled} errors=${errors} ms=${ms}`,
    );
  } catch (e) {
    console.error('[wtpAttribution] fatal:', e.message);
  } finally {
    running = false;
  }
}

function startWtpAttributionCron() {
  // 02:00 UTC nightly — after snapshot windows close
  cron.schedule('0 2 * * *', () => {
    try { runAttributionJob(); }
    catch (e) { console.error('[wtpAttribution] cron error:', e.message); }
  });
}

module.exports = { startWtpAttributionCron, runAttributionJob };
