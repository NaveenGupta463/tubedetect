'use strict';

const {
  CREATOR_IDEA_DNA_VERSION,
  DEFAULT_VIDEO_LIMIT,
  persistCreatorIdeaDna,
} = require('./creatorIdeaDna');

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const DEFAULT_MIN_VIDEOS = positiveInt(process.env.CREATOR_DNA_PIPELINE_MIN_VIDEOS, 10);

function countStoredTitles(db, channelId) {
  return db.get(
    `SELECT COUNT(*) AS n,
            MAX(datetime(published_at)) AS latest_published_at
       FROM ingested_videos
      WHERE channel_id = ?
        AND title IS NOT NULL
        AND title != ''`,
    [channelId],
  ) || { n: 0, latest_published_at: null };
}

function readExistingDnaMeta(db, channelId) {
  return db.get(
    `SELECT sample_count, source_version, last_video_published_at, updated_at
       FROM creator_idea_dna
      WHERE channel_id = ?`,
    [channelId],
  ) || null;
}

function normalizeSqliteTime(value) {
  if (!value) return null;
  return String(value).replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

function persistCreatorIdeaDnaForPipeline(db, channelId, options = {}) {
  try {
    if (process.env.CREATOR_DNA_PIPELINE_DISABLE === '1') {
      return { ok: false, skipped: true, reason: 'pipeline_dna_disabled', channel_id: channelId };
    }

    const minVideos = positiveInt(options.minVideos, DEFAULT_MIN_VIDEOS);
    const limit = positiveInt(options.limit, DEFAULT_VIDEO_LIMIT);
    const counts = countStoredTitles(db, channelId);
    const storedTitles = Number(counts.n || 0);

    if (storedTitles < minVideos) {
      return {
        ok: false,
        skipped: true,
        reason: 'not_enough_stored_titles',
        channel_id: channelId,
        stored_titles: storedTitles,
        min_videos: minVideos,
      };
    }

    const existing = readExistingDnaMeta(db, channelId);
    const expectedSample = Math.min(storedTitles, limit);
    const latestStored = normalizeSqliteTime(counts.latest_published_at);
    const latestDna = normalizeSqliteTime(existing?.last_video_published_at);
    const upToDate = existing &&
      Number(existing.source_version || 0) >= CREATOR_IDEA_DNA_VERSION &&
      Number(existing.sample_count || 0) >= expectedSample &&
      (!latestStored || latestStored === latestDna);

    if (upToDate && !options.force) {
      return {
        ok: true,
        skipped: true,
        reason: 'creator_dna_up_to_date',
        channel_id: channelId,
        stored_titles: storedTitles,
        sample_count: existing.sample_count,
        updated_at: existing.updated_at,
      };
    }

    const result = persistCreatorIdeaDna(db, channelId, {
      limit,
      snapshotReason: options.reason || 'pipeline_ingest',
      forceSnapshot: !!options.forceSnapshot,
    });

    if (!result.ok) {
      return {
        ...result,
        skipped: true,
        stored_titles: storedTitles,
      };
    }

    return {
      ok: true,
      skipped: false,
      reason: options.reason || 'pipeline_ingest',
      channel_id: channelId,
      stored_titles: storedTitles,
      sample_count: result.dna.sample_count,
      confidence: result.dna.confidence,
      confidence_score: result.dna.confidence_score,
      drift_status: result.dna.drift_status,
      snapshot: result.snapshot || null,
    };
  } catch (e) {
    return {
      ok: false,
      skipped: true,
      reason: 'creator_dna_pipeline_failed',
      channel_id: channelId,
      error: e.message,
    };
  }
}

module.exports = {
  persistCreatorIdeaDnaForPipeline,
  countStoredTitles,
};
