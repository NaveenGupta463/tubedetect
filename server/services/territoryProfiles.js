'use strict';

const { classifyVideoTerritories } = require('./territoryClassifier');

const RECENT_DAYS = 90;
const EVIDENCE_VIDEO_LIMIT = 10;

function ensureTerritoryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_territories (
      video_id       TEXT NOT NULL,
      channel_id     TEXT NOT NULL,
      territory_id   TEXT NOT NULL,
      confidence     TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
      evidence_terms TEXT,
      source         TEXT NOT NULL CHECK (source IN ('title','description','fingerprint','hint')),
      classified_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (video_id, territory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_vt_channel ON video_territories(channel_id, territory_id);
    CREATE INDEX IF NOT EXISTS idx_vt_territory ON video_territories(territory_id, confidence);

    CREATE TABLE IF NOT EXISTS channel_territory_profiles (
      channel_id          TEXT NOT NULL,
      territory_id        TEXT NOT NULL,
      role                TEXT NOT NULL CHECK (role IN ('core','accepted','test')),
      confidence          TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
      video_count         INTEGER NOT NULL DEFAULT 0,
      recent_video_count  INTEGER NOT NULL DEFAULT 0,
      median_views        REAL,
      view_lift           REAL,
      first_seen_at       TEXT,
      last_seen_at        TEXT,
      evidence_video_ids  TEXT,
      updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, territory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ctp_channel ON channel_territory_profiles(channel_id, role);
    CREATE INDEX IF NOT EXISTS idx_ctp_territory ON channel_territory_profiles(territory_id, role);
  `);
}

function median(nums) {
  const values = nums.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function confidenceRank(confidence) {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0;
}

function strongestConfidence(rows) {
  return rows.some(r => r.confidence === 'high') ? 'high' : 'medium';
}

function loadChannelHints(db, channelId) {
  const row = db.get(
    `SELECT ic.channel_id, ic.niche, ic.creator_mode, ic.format_profile, ccsp.primary_csp AS csp
       FROM ingested_channels ic
       LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
      WHERE ic.channel_id = ?`,
    [channelId],
  ) || {};
  return {
    niche: row.niche || '',
    creator_mode: row.creator_mode || '',
    format_profile: row.format_profile || '',
    csp: row.csp || '',
  };
}

function classifyAndStoreVideoTerritories(db, video, hints = {}) {
  if (!video?.youtube_video_id || !video?.channel_id || !video?.title) return 0;
  const matches = classifyVideoTerritories(video.title, {
    niche: hints.niche || video.niche || '',
    csp: hints.csp || '',
    creator_mode: hints.creator_mode || '',
    format_profile: hints.format_profile || '',
  }).filter(r => r.confidence === 'high' || r.confidence === 'medium');

  if (!matches.length) return 0;

  const stmt = db._db
    ? db._db.prepare(
      `INSERT OR REPLACE INTO video_territories
         (video_id, channel_id, territory_id, confidence, evidence_terms, source, classified_at)
       VALUES (?, ?, ?, ?, ?, 'title', datetime('now'))`,
    )
    : null;

  let stored = 0;
  for (const match of matches) {
    const evidence = JSON.stringify((match.evidence_terms || []).slice(0, 5));
    if (stmt) {
      stmt.run(video.youtube_video_id, video.channel_id, match.territory_id, match.confidence, evidence);
    } else {
      db.run(
        `INSERT OR REPLACE INTO video_territories
           (video_id, channel_id, territory_id, confidence, evidence_terms, source, classified_at)
         VALUES (?, ?, ?, ?, ?, 'title', datetime('now'))`,
        [video.youtube_video_id, video.channel_id, match.territory_id, match.confidence, evidence],
      );
    }
    stored++;
  }
  return stored;
}

function inferTerritoryRole({ videoCount, recentVideoCount, totalVideos, territoryMedianViews, channelMedianViews, confidence }) {
  const share = totalVideos > 0 ? videoCount / totalVideos : 0;
  const viewLift = channelMedianViews && territoryMedianViews ? territoryMedianViews / channelMedianViews : null;

  if (totalVideos < 15) {
    if (videoCount >= 2 || confidence === 'high') return { role: 'test', viewLift };
    return { role: null, viewLift };
  }

  if (
    videoCount >= 5 &&
    recentVideoCount >= 1 &&
    (share >= 0.10 || (viewLift != null && viewLift >= 1.0)) &&
    confidenceRank(confidence) >= confidenceRank('medium')
  ) {
    return { role: 'core', viewLift };
  }

  if (videoCount >= 3 && viewLift != null && viewLift >= 1.0) {
    return { role: 'accepted', viewLift };
  }

  if (
    (videoCount >= 1 && videoCount <= 2 && (viewLift == null || viewLift >= 1.0 || confidence === 'high')) ||
    (videoCount >= 3 && viewLift != null && viewLift >= 0.7 && viewLift < 1.0)
  ) {
    return { role: 'test', viewLift };
  }

  return { role: null, viewLift };
}

function recomputeChannelTerritoryProfile(db, channelId, { now = new Date() } = {}) {
  const videos = db.all(
    `SELECT youtube_video_id, channel_id, title, niche, views, published_at
       FROM ingested_videos
      WHERE channel_id = ? AND title IS NOT NULL`,
    [channelId],
  );
  const totalVideos = videos.length;
  const channelMedianViews = median(videos.map(v => Number(v.views || 0)));

  db.run(`DELETE FROM channel_territory_profiles WHERE channel_id = ?`, [channelId]);
  if (!totalVideos) return { channel_id: channelId, profiles: 0, total_videos: 0 };

  const territoryRows = db.all(
    `SELECT vt.territory_id, vt.confidence, vt.evidence_terms,
            iv.youtube_video_id, iv.views, iv.published_at
       FROM video_territories vt
       JOIN ingested_videos iv ON iv.youtube_video_id = vt.video_id
      WHERE vt.channel_id = ?`,
    [channelId],
  );

  const byTerritory = new Map();
  for (const row of territoryRows) {
    if (!byTerritory.has(row.territory_id)) byTerritory.set(row.territory_id, []);
    byTerritory.get(row.territory_id).push(row);
  }

  const recentCutoff = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const insert = db._db
    ? db._db.prepare(
      `INSERT OR REPLACE INTO channel_territory_profiles
         (channel_id, territory_id, role, confidence, video_count, recent_video_count,
          median_views, view_lift, first_seen_at, last_seen_at, evidence_video_ids, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    : null;

  let profiles = 0;
  for (const [territoryId, rows] of byTerritory) {
    const videoCount = rows.length;
    const recentVideoCount = rows.filter(r => r.published_at && new Date(r.published_at).getTime() >= recentCutoff).length;
    const territoryMedianViews = median(rows.map(r => Number(r.views || 0)));
    const confidence = strongestConfidence(rows);
    const firstSeen = rows.map(r => r.published_at).filter(Boolean).sort()[0] || null;
    const lastSeen = rows.map(r => r.published_at).filter(Boolean).sort().slice(-1)[0] || null;
    const roleResult = inferTerritoryRole({
      videoCount,
      recentVideoCount,
      totalVideos,
      territoryMedianViews,
      channelMedianViews,
      confidence,
    });
    if (!roleResult.role) continue;

    const evidenceIds = rows
      .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
      .slice(0, EVIDENCE_VIDEO_LIMIT)
      .map(r => r.youtube_video_id);

    const params = [
      channelId,
      territoryId,
      roleResult.role,
      confidence,
      videoCount,
      recentVideoCount,
      territoryMedianViews,
      roleResult.viewLift,
      firstSeen,
      lastSeen,
      JSON.stringify(evidenceIds),
    ];
    if (insert) insert.run(...params);
    else {
      db.run(
        `INSERT OR REPLACE INTO channel_territory_profiles
           (channel_id, territory_id, role, confidence, video_count, recent_video_count,
            median_views, view_lift, first_seen_at, last_seen_at, evidence_video_ids, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        params,
      );
    }
    profiles++;
  }

  return {
    channel_id: channelId,
    total_videos: totalVideos,
    channel_median_views: channelMedianViews,
    profiles,
  };
}

function classifyAndStoreChannelVideos(db, channelId, { limit = null } = {}) {
  const hints = loadChannelHints(db, channelId);
  const sql =
    `SELECT youtube_video_id, channel_id, title, niche, views, published_at
       FROM ingested_videos
      WHERE channel_id = ? AND title IS NOT NULL
      ORDER BY published_at DESC` + (limit ? ` LIMIT ${Number(limit)}` : '');
  const videos = db.all(sql, [channelId]);
  let assignments = 0;
  for (const video of videos) assignments += classifyAndStoreVideoTerritories(db, video, hints);
  const profile = recomputeChannelTerritoryProfile(db, channelId);
  return { channel_id: channelId, videos: videos.length, assignments, profiles: profile.profiles };
}

module.exports = {
  RECENT_DAYS,
  median,
  ensureTerritoryTables,
  loadChannelHints,
  classifyAndStoreVideoTerritories,
  classifyAndStoreChannelVideos,
  recomputeChannelTerritoryProfile,
  inferTerritoryRole,
};
