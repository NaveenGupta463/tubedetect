// CopilotTools — one function per tool Claude can call.
// Each function takes (db, input) and returns a plain JS object.
// Claude receives this as the tool_result and synthesises it into an answer.
//
// Extensibility hooks (not implemented yet):
//   memory   — pass user memory blob alongside db
//   workspace — pass workspace_id to persist discoveries
//   canvas   — return { card_type, data } objects; router renders them

const { resolvePeers } = require('./copilotPeerHelper');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtSubs(n) {
  if (!n) return 'unknown';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtViews(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function parseTopics(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// findChannels — search ingested_channels by name/niche/region/size
// ─────────────────────────────────────────────────────────────────────────────
function findChannels(db, { query, niche, region, min_subs, max_subs, limit = 12 }) {
  const conditions = ['ic.ingest_enabled = 1'];
  const params     = [];

  if (query) {
    conditions.push("ic.channel_name LIKE ?");
    params.push(`%${query}%`);
  }
  if (niche) {
    conditions.push("COALESCE(ic.primary_niche, ic.niche) = ?");
    params.push(niche);
  }
  if (region) {
    conditions.push("ic.region = ?");
    params.push(region);
  }
  if (min_subs) {
    conditions.push("ic.subscriber_count >= ?");
    params.push(Number(min_subs));
  }
  if (max_subs) {
    conditions.push("ic.subscriber_count <= ?");
    params.push(Number(max_subs));
  }
  params.push(limit);

  const rows = db.all(`
    SELECT
      ic.channel_id,
      ic.channel_name,
      ic.subscriber_count,
      COALESCE(ic.primary_niche, ic.niche) AS niche,
      ic.region,
      ic.primary_language,
      ic.content_archetype,
      ic.inferred_topics
    FROM ingested_channels ic
    WHERE ${conditions.join(' AND ')}
    ORDER BY ic.subscriber_count DESC
    LIMIT ?
  `, params);

  return rows.map(r => ({
    channel_id:    r.channel_id,
    channel_name:  r.channel_name,
    subs:          fmtSubs(r.subscriber_count),
    subs_raw:      r.subscriber_count,
    niche:         r.niche,
    region:        r.region,
    language:      r.primary_language,
    archetype:     r.content_archetype,
    topics:        parseTopics(r.inferred_topics).slice(0, 4),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// findPeers — resolve true community peers + show what they're posting
// ─────────────────────────────────────────────────────────────────────────────
function findPeers(db, { channel_id, limit = 15 }) {
  const channel = db.get(`
    SELECT * FROM ingested_channels WHERE channel_id = ?
  `, [channel_id]);
  if (!channel) return { error: 'Channel not found in database' };

  const peerIds = resolvePeers(db, channel, {
    exclude_channel_id: channel_id,
    limit: 50,
  });
  if (!peerIds.length) return { peers: [], message: 'No peers found yet — run ingest to populate.' };

  const ph = peerIds.map(() => '?').join(',');

  const peers = db.all(`
    SELECT
      ic.channel_id,
      ic.channel_name,
      ic.subscriber_count,
      COALESCE(ic.primary_niche, ic.niche) AS niche,
      ic.region,
      ic.content_archetype,
      ic.inferred_topics,
      (
        SELECT COUNT(*) FROM ingested_videos iv
        WHERE iv.channel_id = ic.channel_id
          AND iv.published_at > datetime('now', '-30 days')
      ) AS recent_uploads
    FROM ingested_channels ic
    WHERE ic.channel_id IN (${ph})
    ORDER BY ic.subscriber_count DESC
    LIMIT ?
  `, [...peerIds, limit]);

  return {
    peer_count:  peerIds.length,
    shown:       peers.length,
    channel_name: channel.channel_name,
    peers: peers.map(p => ({
      channel_id:     p.channel_id,
      channel_name:   p.channel_name,
      subs:           fmtSubs(p.subscriber_count),
      niche:          p.niche,
      region:         p.region,
      archetype:      p.content_archetype,
      topics:         parseTopics(p.inferred_topics).slice(0, 3),
      recent_uploads: p.recent_uploads,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findTopics — what topics are the community covering + performance signals
// ─────────────────────────────────────────────────────────────────────────────
function findTopics(db, { channel_id, filter }) {
  const channel = db.get(`
    SELECT * FROM ingested_channels WHERE channel_id = ?
  `, [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  // Own titles + niche/topics — same logic as findOpportunity to avoid false "not covered" flags
  const ownTitles  = db.all(`
    SELECT title FROM ingested_videos WHERE channel_id = ? LIMIT 500
  `, [channel_id]).map(r => (r.title || '').toLowerCase());
  const ownTopics  = parseTopics(channel.inferred_topics);
  const ownNiche   = [channel.primary_niche, channel.niche].filter(Boolean);
  const ownText    = [...ownTitles, ...ownTopics, ...ownNiche].join(' ').toLowerCase();

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 150 });
  if (!peerIds.length) return { topics: [], message: 'No peers in database yet.' };

  const ph = peerIds.map(() => '?').join(',');

  // Top performing peer videos in last 90d — give Claude the raw signal
  const topVideos = db.all(`
    SELECT iv.title, iv.views, iv.published_at, ic.channel_name,
           iv.duration_seconds
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-90 days')
      AND iv.title IS NOT NULL AND iv.views > 1000
    ORDER BY iv.views DESC
    LIMIT 40
  `, peerIds);

  // Aggregate by simple keyword clusters using inferred_topics on channels
  const topicFreq = {};
  for (const id of peerIds) {
    const ch = db.get(`
      SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?
    `, [id]);
    const topics = parseTopics(ch?.inferred_topics);
    for (const t of topics.slice(0, 3)) {
      if (!t) continue;
      topicFreq[t] = (topicFreq[t] || 0) + 1;
    }
  }

  const topTopics = Object.entries(topicFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, count]) => ({
      topic,
      peer_count: count,
      already_covered: ownText.includes(topic.toLowerCase()),
    }));

  return {
    channel_name: channel.channel_name,
    peer_count:   peerIds.length,
    community_topics: topTopics,
    top_peer_videos:  topVideos.slice(0, 15).map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      views_raw:    v.views,
      channel_name: v.channel_name,
      published_at: v.published_at?.slice(0, 10),
      duration_sec: v.duration_seconds,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// compareChannels — side-by-side profile + topic overlap
// ─────────────────────────────────────────────────────────────────────────────
function compareChannels(db, { channel_id_a, channel_id_b }) {
  function getProfile(channel_id) {
    const ch = db.get(`
      SELECT channel_id, channel_name, subscriber_count,
             COALESCE(primary_niche, niche) AS niche,
             region, primary_language, content_archetype, inferred_topics
      FROM ingested_channels WHERE channel_id = ?
    `, [channel_id]);
    if (!ch) return null;

    const recentVideos = db.all(`
      SELECT title, views, published_at FROM ingested_videos
      WHERE channel_id = ?
        AND published_at > datetime('now', '-90 days')
        AND views > 0
      ORDER BY views DESC
      LIMIT 5
    `, [channel_id]);

    const stats = db.get(`
      SELECT
        COUNT(*)                           AS total_videos,
        CAST(AVG(views) AS INTEGER)        AS avg_views,
        CAST(MAX(views) AS INTEGER)        AS peak_views,
        COUNT(CASE WHEN published_at > datetime('now', '-30 days') THEN 1 END) AS uploads_30d
      FROM ingested_videos
      WHERE channel_id = ? AND views > 0
    `, [channel_id]);

    return {
      channel_id:    ch.channel_id,
      channel_name:  ch.channel_name,
      subs:          fmtSubs(ch.subscriber_count),
      niche:         ch.niche,
      region:        ch.region,
      language:      ch.primary_language,
      archetype:     ch.content_archetype,
      topics:        parseTopics(ch.inferred_topics).slice(0, 5),
      avg_views:     fmtViews(stats?.avg_views),
      peak_views:    fmtViews(stats?.peak_views),
      uploads_30d:   stats?.uploads_30d || 0,
      top_videos:    recentVideos.map(v => ({
        title: v.title,
        views: fmtViews(v.views),
        date:  v.published_at?.slice(0, 10),
      })),
    };
  }

  const a = getProfile(channel_id_a);
  const b = getProfile(channel_id_b);

  if (!a) return { error: `Channel ${channel_id_a} not found` };
  if (!b) return { error: `Channel ${channel_id_b} not found` };

  // Topic overlap
  const topicsA = new Set(parseTopics(
    db.get('SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id_a])?.inferred_topics
  ));
  const topicsB = new Set(parseTopics(
    db.get('SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id_b])?.inferred_topics
  ));
  const shared   = [...topicsA].filter(t => topicsB.has(t));
  const only_a   = [...topicsA].filter(t => !topicsB.has(t));
  const only_b   = [...topicsB].filter(t => !topicsA.has(t));

  return {
    channel_a: a,
    channel_b: b,
    topic_overlap: {
      shared:  shared.slice(0, 6),
      only_a:  only_a.slice(0, 6),
      only_b:  only_b.slice(0, 6),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findOpportunity — best content opportunity RIGHT NOW for this creator
// ─────────────────────────────────────────────────────────────────────────────
function findOpportunity(db, { channel_id }) {
  const channel = db.get(`
    SELECT * FROM ingested_channels WHERE channel_id = ?
  `, [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 150 });
  if (!peerIds.length) return { opportunities: [], message: 'No peers found.' };

  // Own topics — video titles + channel's own niche/inferred_topics.
  // Including niche/topics catches cases where the channel's entire identity IS the topic
  // (e.g. a defence channel covers "Indian Military Technology" without using that phrase in titles).
  const ownTitlesRaw = db.all(`
    SELECT title FROM ingested_videos WHERE channel_id = ? LIMIT 500
  `, [channel_id]);
  const ownTopics = parseTopics(channel.inferred_topics);
  const ownNiche  = [channel.primary_niche, channel.niche].filter(Boolean);
  const ownText   = [
    ...ownTitlesRaw.map(r => r.title || ''),
    ...ownTopics,
    ...ownNiche,
  ].join(' ').toLowerCase();

  const ph = peerIds.map(() => '?').join(',');

  // Peer videos in last 14 days (most recent signal)
  const recentPeerVideos = db.all(`
    SELECT iv.title, iv.views, iv.published_at,
           ic.channel_name, ic.channel_id
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-14 days')
      AND iv.views > 5000
    ORDER BY iv.views DESC
    LIMIT 30
  `, peerIds);

  // Peer topics trending (community inferred topics, last 30d active)
  const trendingTopics = db.all(`
    SELECT
      jt.value                           AS topic,
      COUNT(DISTINCT ic.channel_id)      AS channel_count,
      SUM(iv.views)                      AS total_views,
      AVG(iv.views)                      AS avg_views
    FROM ingested_channels ic,
         json_each(ic.inferred_topics) jt
    JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
    WHERE ic.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-30 days')
      AND iv.views > 0
    GROUP BY jt.value
    HAVING channel_count >= 3
    ORDER BY avg_views DESC
    LIMIT 10
  `, [...peerIds, ...peerIds]);

  const opportunities = trendingTopics
    .filter(t => !ownText.includes(t.topic.toLowerCase()))
    .map(t => ({
      topic:         t.topic,
      peer_count:    t.channel_count,
      avg_views:     fmtViews(Math.round(t.avg_views)),
      total_views:   fmtViews(t.total_views),
      gap:           'not covered by you in last 90 days',
    }));

  return {
    channel_name:   channel.channel_name,
    peer_pool_size: peerIds.length,
    opportunities:  opportunities.slice(0, 8),
    hot_right_now:  recentPeerVideos.slice(0, 8).map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      channel_name: v.channel_name,
      date:         v.published_at?.slice(0, 10),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// draftOutline — fetch context data so Claude can write a structured video outline
// ─────────────────────────────────────────────────────────────────────────────
function draftOutline(db, { channel_id, topic }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 100 });

  // Best peer videos on this topic — title/views/duration for style reference
  let peerExamples = [];
  if (peerIds.length > 0) {
    const ph = peerIds.map(() => '?').join(',');
    peerExamples = db.all(`
      SELECT iv.title, iv.views, iv.duration_seconds, ic.channel_name
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE iv.channel_id IN (${ph})
        AND lower(iv.title) LIKE ?
        AND iv.views > 0
      ORDER BY iv.views DESC
      LIMIT 6
    `, [...peerIds, `%${(topic || '').toLowerCase()}%`]);
  }

  // Creator's own top videos — for tone/format reference
  const ownTopVideos = db.all(`
    SELECT title, views, duration_seconds FROM ingested_videos
    WHERE channel_id = ? AND views > 0
    ORDER BY views DESC LIMIT 5
  `, [channel_id]);

  return {
    channel_name:      channel.channel_name,
    archetype:         channel.content_archetype,
    niche:             channel.primary_niche || channel.niche,
    region:            channel.region,
    topic,
    peer_examples: peerExamples.map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      duration_sec: v.duration_seconds,
      channel:      v.channel_name,
    })),
    own_top_videos: ownTopVideos.map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      duration_sec: v.duration_seconds,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// trackNiche — V0: acknowledge + stub for future DB writes
// Future: write to user_tracking table, set up monitoring cron
// ─────────────────────────────────────────────────────────────────────────────
function trackNiche(db, { niche, channel_id }) {
  // Stub — future: INSERT INTO user_tracking (user_id, niche, channel_id, created_at)
  return {
    tracked:  true,
    niche,
    message:  `Tracking enabled for "${niche}". You'll be notified when trends shift.`,
    // Future hook: { workspace_id, investigation_id } for memory layer
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch — maps tool name → function
// ─────────────────────────────────────────────────────────────────────────────
function dispatch(db, toolName, input, contextChannelId) {
  // Always force context channel_id for single-channel tools — never trust Claude's guess.
  const withCtx = (fn, key = 'channel_id') => {
    if (contextChannelId) input[key] = contextChannelId;
    return fn(db, input);
  };

  switch (toolName) {
    case 'findChannels':   return findChannels(db, input);
    case 'findPeers':      return withCtx(findPeers);
    case 'findTopics':     return withCtx(findTopics);
    case 'compareChannels':return compareChannels(db, input);
    case 'findOpportunity':return withCtx(findOpportunity);
    case 'trackNiche':     return trackNiche(db, input);
    case 'draftOutline':   return withCtx(draftOutline);
    default:               return { error: `Unknown tool: ${toolName}` };
  }
}

module.exports = { dispatch, findChannels, findPeers, findTopics, compareChannels, findOpportunity, trackNiche, draftOutline };
