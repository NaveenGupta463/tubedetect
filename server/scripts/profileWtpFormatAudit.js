'use strict';

const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const fs = require('fs');
const { computeWhatToPost } = require('../services/whatToPost');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const {
  STOPWORDS,
  HOOK_PHRASES,
  DEVANAGARI_RE,
  SOUTH_SCRIPT_RE,
  extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');
const { classifyTrend, getVelocity, getFormatWinner } = require('../services/topicAnalysis');

function openReadonlyDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    fileMustExist: true,
    timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');

  const cache = new Map();
  const timings = [];
  const traceFile = process.env.WTP_TRACE_FILE || null;
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  const timed = (kind, sql, params, fn) => {
    if (traceFile) {
      fs.appendFileSync(traceFile, JSON.stringify({
        at: new Date().toISOString(),
        phase: 'before',
        kind,
        sql: sql.replace(/\s+/g, ' ').slice(0, 220),
        params: Array.isArray(params) ? params.length : 1,
      }) + '\n');
    }
    const t = Date.now();
    const result = fn(stmt(sql), Array.isArray(params) ? params : [params]);
    const ms = Date.now() - t;
    if (traceFile) {
      fs.appendFileSync(traceFile, JSON.stringify({
        at: new Date().toISOString(),
        phase: 'after',
        kind,
        ms,
        rows: Array.isArray(result) ? result.length : (result ? 1 : 0),
      }) + '\n');
    }
    if (ms >= 100) timings.push({ kind, ms, rows: Array.isArray(result) ? result.length : (result ? 1 : 0), sql: sql.replace(/\s+/g, ' ').slice(0, 180) });
    return result;
  };

  return {
    all: (sql, params = []) => timed('all', sql, params, (s, p) => s.all(p)),
    get: (sql, params = []) => timed('get', sql, params, (s, p) => s.get(p)),
    run: () => ({ changes: 0 }),
    exec: () => undefined,
    timings,
    close: () => { cache.clear(); raw.close(); },
  };
}

const channelArgIndex = process.argv.indexOf('--channel');
const channelArg = channelArgIndex >= 0 ? process.argv[channelArgIndex + 1] : null;
const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '3', 10), 25));
const db = openReadonlyDb();
const ctx = {
  resolveCreatorPeerContext,
  extractPhrases,
  getVelocity,
  classifyTrend,
  getFormatWinner,
  PODCAST_META_TOKENS,
  STOPWORDS,
  HOOK_PHRASES,
  SOUTH_SCRIPT_RE,
  DEVANAGARI_RE,
};

const rows = channelArg
  ? db.all(
      `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
       FROM ingested_channels
       WHERE channel_id = ?`,
      [channelArg],
    )
  : db.all(
      `SELECT channel_id, channel_name, COALESCE(primary_niche, niche) AS niche, channel_subscribers
       FROM ingested_channels
       WHERE ingest_enabled = 1
         AND channel_id IS NOT NULL
         AND COALESCE(primary_niche, niche) IS NOT NULL
         AND channel_subscribers BETWEEN 1000 AND 20000000
         AND EXISTS (
           SELECT 1 FROM ingested_videos iv
           WHERE iv.channel_id = ingested_channels.channel_id
             AND iv.published_at > datetime('now', '-180 days')
           LIMIT 1
         )
       ORDER BY random()
       LIMIT ?`,
      [limit],
    );

for (const ch of rows) {
  const before = db.timings.length;
  const t = Date.now();
  let result = null;
  let error = null;
  try {
    result = computeWhatToPost(db, {
      channel_id: ch.channel_id,
      subscriber_count: String(ch.channel_subscribers || 0),
      debug: true,
    }, ctx);
  } catch (e) {
    error = e.message;
  }
  const timings = db.timings.slice(before).sort((a, b) => b.ms - a.ms).slice(0, 5);
  const ideas = result?.ideas || [];
  const evidence = {};
  for (const idea of ideas) {
    const key = idea.evidence_type || idea.format_evidence?.evidence_type || 'missing';
    evidence[key] = (evidence[key] || 0) + 1;
  }
  const top = ideas.slice(0, 8).map(idea => ({
    title: idea.action_title || idea.title || idea.topic,
    topic: idea.topic || null,
    source: idea.source || null,
    confidence: idea.confidence_tier || idea.confidence || null,
    evidence_type: idea.evidence_type || idea.format_evidence?.evidence_type || 'missing',
    channel_count: idea.channel_count ?? null,
    avg_views: idea.avg_views ?? null,
    parent_topic: idea.parent_topic || null,
  }));
  console.log(JSON.stringify({
    channel: ch.channel_name,
    niche: ch.niche,
    niche_category: result?.niche_category || null,
    channel_count: result?.channel_count ?? null,
    video_count: result?.video_count ?? null,
    lifecycle_suppressed: result?.summary?.lifecycle_suppressed ?? null,
    lifecycle_regular: result?.summary?.lifecycle_regular ?? null,
    lifecycle_saturated: result?.summary?.lifecycle_saturated ?? null,
    lifecycle_exiting: result?.summary?.lifecycle_exiting ?? null,
    lifecycle_suppressed_sample: result?.lifecycle_suppressed_sample || [],
    ms: Date.now() - t,
    ideas: ideas.length,
    fallback: ideas.filter(i => i.source === 'fallback_evergreen').length,
    evidence,
    top,
    error,
    slowest: timings,
  }, null, 2));
}

db.close();
