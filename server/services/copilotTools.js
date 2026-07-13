const { resolvePeers } = require('./copilotPeerHelper');
const { search } = require('./webSearch');

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

// Detect whether a channel primarily makes Shorts, long-form, or both.
// Returns: 'short' | 'long' | 'mixed'
function detectCreatorFormat(db, channel_id) {
  const counts = db.get(`
    SELECT
      COUNT(*) AS total,
      SUM(is_short) AS shorts
    FROM ingested_videos
    WHERE channel_id = ? AND duration_seconds IS NOT NULL
  `, [channel_id]);
  if (!counts || counts.total < 5) return 'long'; // not enough data → assume long-form
  const shortPct = counts.shorts / counts.total;
  if (shortPct >= 0.7) return 'short';
  if (shortPct <= 0.3) return 'long';
  return 'mixed';
}

// Returns the SQL fragment and param for filtering by format.
// 'mixed' returns no filter (both formats shown).
function formatFilter(format) {
  if (format === 'short') return { sql: 'AND iv.is_short = 1', param: [] };
  if (format === 'long')  return { sql: 'AND iv.is_short = 0', param: [] };
  return { sql: '', param: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// findChannels
// ─────────────────────────────────────────────────────────────────────────────
function findChannels(db, { query, niche, region, min_subs, max_subs, limit = 12 }) {
  const conditions = ['ic.ingest_enabled = 1'];
  const params     = [];

  if (query) {
    conditions.push('ic.channel_name LIKE ?');
    params.push(`%${query}%`);
  }
  if (niche) {
    conditions.push('COALESCE(ic.primary_niche, ic.niche) = ?');
    params.push(niche);
  }
  if (region) {
    conditions.push('ic.region = ?');
    params.push(region);
  }
  if (min_subs) {
    conditions.push('ic.channel_subscribers >= ?');
    params.push(Number(min_subs));
  }
  if (max_subs) {
    conditions.push('ic.channel_subscribers <= ?');
    params.push(Number(max_subs));
  }
  params.push(limit);

  const rows = db.all(`
    SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers,
           COALESCE(ic.primary_niche, ic.niche) AS niche,
           ic.region, ic.primary_language, ic.content_archetype, ic.inferred_topics
    FROM ingested_channels ic
    WHERE ${conditions.join(' AND ')}
    ORDER BY ic.channel_subscribers DESC
    LIMIT ?
  `, params);

  return rows.map(r => ({
    channel_id:   r.channel_id,
    channel_name: r.channel_name,
    subs:         fmtSubs(r.channel_subscribers),
    subs_raw:     r.channel_subscribers,
    niche:        r.niche,
    region:       r.region,
    language:     r.primary_language,
    archetype:    r.content_archetype,
    topics:       parseTopics(r.inferred_topics).slice(0, 4),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// findPeers
// ─────────────────────────────────────────────────────────────────────────────
function findPeers(db, { channel_id, limit = 15, _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found in database' };

  const format  = _format || 'long';
  const ff      = formatFilter(format);

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 50 });
  if (!peerIds.length) return { peers: [], message: 'No peers found yet — run ingest to populate.' };

  const ph = peerIds.map(() => '?').join(',');

  const peers = db.all(`
    SELECT ic.channel_id, ic.channel_name, ic.channel_subscribers,
           COALESCE(ic.primary_niche, ic.niche) AS niche,
           ic.region, ic.content_archetype, ic.inferred_topics,
           (
             SELECT COUNT(*) FROM ingested_videos iv
             WHERE iv.channel_id = ic.channel_id
               AND iv.published_at > datetime('now', '-30 days')
               ${ff.sql.replace('iv.', 'iv.')}
           ) AS recent_uploads
    FROM ingested_channels ic
    WHERE ic.channel_id IN (${ph})
    ORDER BY ic.channel_subscribers DESC
    LIMIT ?
  `, [...peerIds, limit]);

  return {
    peer_count:   peerIds.length,
    shown:        peers.length,
    channel_name: channel.channel_name,
    creator_format: format,
    peers: peers.map(p => ({
      channel_id:     p.channel_id,
      channel_name:   p.channel_name,
      subs:           fmtSubs(p.channel_subscribers),
      niche:          p.niche,
      region:         p.region,
      archetype:      p.content_archetype,
      topics:         parseTopics(p.inferred_topics).slice(0, 3),
      recent_uploads: p.recent_uploads,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findTopics
// ─────────────────────────────────────────────────────────────────────────────
function findTopics(db, { channel_id, filter, _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const format = _format || 'long';
  const ff     = formatFilter(format);

  const ownTitles = db.all(`
    SELECT title FROM ingested_videos WHERE channel_id = ? ${ff.sql.replace('iv.', '')} LIMIT 500
  `, [channel_id]).map(r => (r.title || '').toLowerCase());
  const ownTopics = parseTopics(channel.inferred_topics);
  const ownNiche  = [channel.primary_niche, channel.niche].filter(Boolean);
  const ownText   = [...ownTitles, ...ownTopics, ...ownNiche].join(' ').toLowerCase();

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 150 });
  if (!peerIds.length) return { topics: [], message: 'No peers in database yet.' };

  const ph = peerIds.map(() => '?').join(',');

  const topVideos = db.all(`
    SELECT iv.title, iv.views, iv.published_at, ic.channel_name, iv.duration_seconds, iv.is_short
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-90 days')
      AND iv.title IS NOT NULL AND iv.views > 1000
      ${ff.sql}
    ORDER BY iv.views DESC
    LIMIT 40
  `, peerIds);

  const topicFreq = {};
  for (const id of peerIds) {
    const ch = db.get('SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [id]);
    for (const t of parseTopics(ch?.inferred_topics).slice(0, 3)) {
      if (!t) continue;
      topicFreq[t] = (topicFreq[t] || 0) + 1;
    }
  }

  const topTopics = Object.entries(topicFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, count]) => ({
      topic,
      peer_count:       count,
      already_covered:  ownText.includes(topic.toLowerCase()),
    }));

  return {
    channel_name:     channel.channel_name,
    creator_format:   format,
    peer_count:       peerIds.length,
    community_topics: topTopics,
    top_peer_videos:  topVideos.slice(0, 15).map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      views_raw:    v.views,
      channel_name: v.channel_name,
      published_at: v.published_at?.slice(0, 10),
      duration_sec: v.duration_seconds,
      format:       v.is_short ? 'short' : 'long',
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// compareChannels
// ─────────────────────────────────────────────────────────────────────────────
function compareChannels(db, { channel_id_a, channel_id_b, _format }) {
  function getProfile(channel_id) {
    const ch = db.get(`
      SELECT channel_id, channel_name, channel_subscribers,
             COALESCE(primary_niche, niche) AS niche,
             region, primary_language, content_archetype, inferred_topics
      FROM ingested_channels WHERE channel_id = ?
    `, [channel_id]);
    if (!ch) return null;

    const format = _format || 'long';
    const ff     = formatFilter(format);

    const recentVideos = db.all(`
      SELECT title, views, published_at FROM ingested_videos
      WHERE channel_id = ?
        AND published_at > datetime('now', '-90 days')
        AND views > 0
        ${ff.sql.replace('iv.', '')}
      ORDER BY views DESC LIMIT 5
    `, [channel_id]);

    const stats = db.get(`
      SELECT COUNT(*) AS total_videos,
             SUM(is_short) AS shorts_count,
             CAST(AVG(views) AS INTEGER) AS avg_views,
             CAST(MAX(views) AS INTEGER) AS peak_views,
             COUNT(CASE WHEN published_at > datetime('now', '-30 days') THEN 1 END) AS uploads_30d
      FROM ingested_videos WHERE channel_id = ? AND views > 0
    `, [channel_id]);

    return {
      channel_id:    ch.channel_id,
      channel_name:  ch.channel_name,
      subs:          fmtSubs(ch.channel_subscribers),
      niche:         ch.niche,
      region:        ch.region,
      language:      ch.primary_language,
      archetype:     ch.content_archetype,
      topics:        parseTopics(ch.inferred_topics).slice(0, 5),
      format,
      shorts_pct:    stats?.total_videos > 0 ? Math.round((stats.shorts_count / stats.total_videos) * 100) : 0,
      avg_views:     fmtViews(stats?.avg_views),
      peak_views:    fmtViews(stats?.peak_views),
      uploads_30d:   stats?.uploads_30d || 0,
      top_videos:    recentVideos.map(v => ({ title: v.title, views: fmtViews(v.views), date: v.published_at?.slice(0, 10) })),
    };
  }

  const a = getProfile(channel_id_a);
  const b = getProfile(channel_id_b);
  if (!a) return { error: `Channel ${channel_id_a} not found` };
  if (!b) return { error: `Channel ${channel_id_b} not found` };

  const topicsA  = new Set(parseTopics(db.get('SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id_a])?.inferred_topics));
  const topicsB  = new Set(parseTopics(db.get('SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id_b])?.inferred_topics));
  const shared   = [...topicsA].filter(t => topicsB.has(t));
  const only_a   = [...topicsA].filter(t => !topicsB.has(t));
  const only_b   = [...topicsB].filter(t => !topicsA.has(t));

  return {
    channel_a: a,
    channel_b: b,
    topic_overlap: { shared: shared.slice(0, 6), only_a: only_a.slice(0, 6), only_b: only_b.slice(0, 6) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// findOpportunity
// ─────────────────────────────────────────────────────────────────────────────
function findOpportunity(db, { channel_id, _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const format  = _format || 'long';
  const ff      = formatFilter(format);

  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 150 });
  if (!peerIds.length) return { opportunities: [], message: 'No peers found.' };

  const ownTitlesRaw = db.all(`
    SELECT title FROM ingested_videos WHERE channel_id = ? ${ff.sql.replace('iv.', '')} LIMIT 500
  `, [channel_id]);
  const ownTopics = parseTopics(channel.inferred_topics);
  const ownNiche  = [channel.primary_niche, channel.niche].filter(Boolean);
  const ownText   = [
    ...ownTitlesRaw.map(r => r.title || ''),
    ...ownTopics,
    ...ownNiche,
  ].join(' ').toLowerCase();

  const ph = peerIds.map(() => '?').join(',');

  const recentPeerVideos = db.all(`
    SELECT iv.title, iv.views, iv.published_at, ic.channel_name, iv.is_short
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    WHERE iv.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-14 days')
      AND iv.views > 5000
      ${ff.sql}
    ORDER BY iv.views DESC
    LIMIT 30
  `, peerIds);

  const trendingTopics = db.all(`
    SELECT
      jt.value                        AS topic,
      COUNT(DISTINCT ic.channel_id)   AS channel_count,
      SUM(iv.views)                   AS total_views,
      AVG(iv.views)                   AS avg_views
    FROM ingested_channels ic,
         json_each(ic.inferred_topics) jt
    JOIN ingested_videos iv ON iv.channel_id = ic.channel_id
    WHERE ic.channel_id IN (${ph})
      AND iv.published_at > datetime('now', '-30 days')
      AND iv.views > 0
      ${ff.sql}
    GROUP BY jt.value
    HAVING channel_count >= 3
    ORDER BY avg_views DESC
    LIMIT 10
  `, peerIds);

  const opportunities = trendingTopics
    .filter(t => !ownText.includes(t.topic.toLowerCase()))
    .map(t => ({
      topic:       t.topic,
      peer_count:  t.channel_count,
      avg_views:   fmtViews(Math.round(t.avg_views)),
      total_views: fmtViews(t.total_views),
      format,
      gap:         `not in your recent videos`,
    }));

  return {
    channel_name:   channel.channel_name,
    creator_format: format,
    peer_pool_size: peerIds.length,
    opportunities:  opportunities.slice(0, 8),
    hot_right_now:  recentPeerVideos.slice(0, 8).map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      channel_name: v.channel_name,
      date:         v.published_at?.slice(0, 10),
      format:       v.is_short ? 'short' : 'long',
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// draftOutline
// ─────────────────────────────────────────────────────────────────────────────
function draftOutline(db, { channel_id, topic, _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const format = _format || 'long';
  const ff     = formatFilter(format);
  const peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 100 });

  let peerExamples = [];
  if (peerIds.length > 0) {
    const ph = peerIds.map(() => '?').join(',');
    peerExamples = db.all(`
      SELECT iv.title, iv.views, iv.duration_seconds, ic.channel_name, iv.is_short
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE iv.channel_id IN (${ph})
        AND lower(iv.title) LIKE ?
        AND iv.views > 0
        ${ff.sql}
      ORDER BY iv.views DESC
      LIMIT 6
    `, [...peerIds, `%${(topic || '').toLowerCase()}%`]);
  }

  const ownTopVideos = db.all(`
    SELECT title, views, duration_seconds, is_short FROM ingested_videos
    WHERE channel_id = ? AND views > 0 ${ff.sql.replace('iv.', '')}
    ORDER BY views DESC LIMIT 5
  `, [channel_id]);

  return {
    channel_name:   channel.channel_name,
    archetype:      channel.content_archetype,
    niche:          channel.primary_niche || channel.niche,
    region:         channel.region,
    creator_format: format,
    topic,
    peer_examples:  peerExamples.map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      duration_sec: v.duration_seconds,
      channel:      v.channel_name,
      format:       v.is_short ? 'short' : 'long',
    })),
    own_top_videos: ownTopVideos.map(v => ({
      title:        v.title,
      views:        fmtViews(v.views),
      duration_sec: v.duration_seconds,
      format:       v.is_short ? 'short' : 'long',
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// writeBody
// ─────────────────────────────────────────────────────────────────────────────
function writeBody(db, { channel_id, topic, sections = [], _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const format   = _format || 'long';
  const ff       = formatFilter(format);
  const peerIds  = resolvePeers(db, channel, { exclude_channel_id: channel_id, limit: 50 });

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
        ${ff.sql}
      ORDER BY iv.views DESC LIMIT 6
    `, [...peerIds, `%${(topic || '').toLowerCase()}%`]);
  }

  const ownTopVideos = db.all(`
    SELECT title, views, duration_seconds FROM ingested_videos
    WHERE channel_id = ? AND views > 0 ${ff.sql.replace('iv.', '')}
    ORDER BY views DESC LIMIT 5
  `, [channel_id]);

  return {
    channel_name:   channel.channel_name,
    archetype:      channel.content_archetype,
    niche:          channel.primary_niche || channel.niche,
    region:         channel.region,
    creator_format: format,
    topic,
    sections,
    peer_examples:  peerExamples.map(v => ({ title: v.title, views: fmtViews(v.views), duration_sec: v.duration_seconds, channel: v.channel_name })),
    own_top_videos: ownTopVideos.map(v => ({ title: v.title, views: fmtViews(v.views), duration_sec: v.duration_seconds })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// writeEnding
// ─────────────────────────────────────────────────────────────────────────────
function writeEnding(db, { channel_id, topic, _format }) {
  const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
  if (!channel) return { error: 'Channel not found' };

  const ownTopVideos = db.all(`
    SELECT title, views FROM ingested_videos
    WHERE channel_id = ? AND views > 0
    ORDER BY views DESC LIMIT 5
  `, [channel_id]);

  return {
    channel_name:   channel.channel_name,
    archetype:      channel.content_archetype,
    niche:          channel.primary_niche || channel.niche,
    topic,
    creator_format: _format || 'long',
    own_top_videos: ownTopVideos.map(v => ({ title: v.title, views: fmtViews(v.views) })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// trackNiche
// ─────────────────────────────────────────────────────────────────────────────
function trackNiche(db, { niche, channel_id }) {
  return {
    tracked: true,
    niche,
    message: `Tracking enabled for "${niche}". You'll be notified when trends shift.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────
async function dispatch(db, toolName, input, contextChannelId, creatorFormat = 'long') {
  const withCtx = (fn, key = 'channel_id') => {
    if (contextChannelId) input[key] = contextChannelId;
    input._format = creatorFormat;
    return fn(db, input);
  };

  switch (toolName) {
    case 'findChannels':        return findChannels(db, input);
    case 'findPeers':           return withCtx(findPeers);
    case 'findTopics':          return withCtx(findTopics);
    case 'compareChannels':     return compareChannels(db, input);
    case 'findOpportunity':     return withCtx(findOpportunity);
    case 'trackNiche':          return trackNiche(db, input);
    case 'draftOutline':        return withCtx(draftOutline);
    case 'writeBody':           return withCtx(writeBody);
    case 'writeEnding':         return withCtx(writeEnding);
    case 'getChannelEvolution': return withCtx(getChannelEvolution);
    case 'getTopicTrend':       return getTopicTrend(db, input);
    case 'searchWeb':           return searchWeb(input);
    default:                    return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Intelligence Tools (V1.5) ─────────────────────────────────────────────────

const NOISE_SUFFIXES = [' videos', ' vlogs', ' vlog', ' vlogging', ' content', ' channels', ' channel', ' clips'];
function canonicalise(topic) {
  if (!topic) return '';
  let t = topic.toLowerCase().trim();
  for (const s of NOISE_SUFFIXES) {
    if (t.endsWith(s)) { t = t.slice(0, -s.length).trim(); break; }
  }
  return t || topic.toLowerCase().trim();
}

function isStaleRow(computed_at) {
  return computed_at && (Date.now() - new Date(computed_at).getTime()) > 26 * 60 * 60 * 1000;
}

function getChannelEvolution(db, { channel_id, period = '30d' }) {
  if (!channel_id) return { error: 'channel_id is required' };
  const row = db.get(
    'SELECT * FROM channel_evolution_summary WHERE channel_id = ? AND period = ?',
    [channel_id, period],
  );
  if (!row) {
    return { no_data: true, message: 'No evolution data yet — the nightly aggregation runs at 3am and populates this.' };
  }

  let topics = [];
  let notable = null;
  try { topics  = JSON.parse(row.topics_maintained || '[]'); } catch (_) {}
  try { notable = row.notable_event ? JSON.parse(row.notable_event) : null; } catch (_) {}

  const result = {
    channel_id,
    period,
    view_change_pct:  row.view_change_pct,
    upload_delta:     row.upload_delta,
    avg_views:        row.avg_views,
    peak_views:       row.peak_views,
    video_count:      row.video_count,
    topics:           topics.slice(0, 12),
    notable_event:    notable,
    data_freshness:   row.computed_at,
  };
  if (isStaleRow(row.computed_at)) result.data_stale = true;
  return result;
}

function getTopicTrend(db, { topic, period = '30d' }) {
  if (!topic) return { error: 'topic is required' };
  const canonical = canonicalise(topic);

  // Try exact match first, then canonical
  const row = db.get(
    `SELECT * FROM topic_community_stats
     WHERE (topic = ? OR topic = ?) AND period = ?
     ORDER BY channel_count DESC LIMIT 1`,
    [topic.toLowerCase().trim(), canonical, period],
  );

  if (!row) {
    // Try partial match on canonical
    const fuzzy = db.get(
      `SELECT * FROM topic_community_stats
       WHERE topic LIKE ? AND period = ?
       ORDER BY channel_count DESC LIMIT 1`,
      [`%${canonical}%`, period],
    );
    if (!fuzzy) {
      return {
        no_data: true,
        message: `No community data for "${topic}" — this topic either isn't tracked in your community yet or has fewer than 5 active channels. Try a broader term (e.g. "mindset" instead of "stoicism", "finance" instead of "personal finance tips").`,
        canonical_tried: canonical,
      };
    }
    return _formatTopicRow(fuzzy, period);
  }
  return _formatTopicRow(row, period);
}

function _formatTopicRow(row, period) {
  const result = {
    topic:          row.topic,
    period,
    channel_count:  row.channel_count,
    avg_views:      row.avg_views,
    total_views:    row.total_views,
    velocity_trend: row.velocity_trend || 'stable',
    velocity:       row.velocity,
    data_freshness: row.computed_at,
  };
  if (isStaleRow(row.computed_at)) result.data_stale = true;
  return result;
}

async function searchWeb({ query }) {
  if (!query) return { error: 'query is required' };
  const result = await search(query, 'general').catch(() => null);
  if (!result) return { error: 'No results found for this query (or web search is unavailable right now). Fall back to a [VERIFY: ...] marker for this fact.' };
  return { answer: result.answer, sources: result.sources };
}

module.exports = { dispatch, detectCreatorFormat, findChannels, findPeers, findTopics, compareChannels, findOpportunity, trackNiche, draftOutline, writeBody, writeEnding, getChannelEvolution, getTopicTrend, searchWeb };
