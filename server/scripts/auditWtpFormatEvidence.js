'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

function openReadonlyDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true,
    fileMustExist: true,
    timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const cache = new Map();
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  return {
    all: (sql, params = []) => stmt(sql).all(Array.isArray(params) ? params : [params]),
    get: (sql, params = []) => stmt(sql).get(Array.isArray(params) ? params : [params]),
    run: () => ({ changes: 0 }),
    exec: () => undefined,
    close: () => { cache.clear(); raw.close(); },
  };
}

function buildCtx() {
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
  return {
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
}

function runWorker(channelId, subs) {
  const { computeWhatToPost } = require('../services/whatToPost');
  const db = openReadonlyDb();
  const started = Date.now();
  try {
    const result = computeWhatToPost(db, {
      channel_id: channelId,
      subscriber_count: String(subs || 0),
    }, buildCtx());
    const ideas = result?.ideas || [];
    const evidence = {};
    const samples = [];
    for (const idea of ideas) {
      const key = idea.evidence_type || idea.format_evidence?.evidence_type || 'missing';
      evidence[key] = (evidence[key] || 0) + 1;
      if (samples.length < 5) {
        samples.push({
          title: idea.action_title || idea.title || idea.topic,
          source: idea.source || null,
          confidence: idea.confidence_tier || idea.confidence || null,
          evidence_type: key,
          format_evidence: idea.format_evidence || null,
        });
      }
    }
    console.log(JSON.stringify({
      ok: true,
      ms: Date.now() - started,
      niche_category: result?.niche_category || null,
      ideas: ideas.length,
      fallback: ideas.filter(i => i.source === 'fallback_evergreen').length,
      evidence,
      samples,
    }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, ms: Date.now() - started, error: e.message }));
  } finally {
    db.close();
  }
}

function inc(obj, key, by = 1) {
  obj[key] = (obj[key] || 0) + by;
}

function runParent() {
  const limit = Math.max(1, Math.min(parseInt(process.argv[2] || '100', 10), 500));
  const timeoutMs = Math.max(5000, Math.min(parseInt(process.argv[3] || '45000', 10), 120000));
  const db = openReadonlyDb();
  const rows = db.all(
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
  db.close();

  const summary = {
    sample: rows.length,
    completed: 0,
    timed_out: 0,
    errors: 0,
    zero: 0,
    low: 0,
    fallback_channels: 0,
    total_ideas: 0,
    total_fallback: 0,
    total_ms: 0,
    evidence: {},
    by_category: {},
    by_niche: {},
    slow_channels: [],
    samples: [],
  };

  rows.forEach((ch, idx) => {
    const child = spawnSync(process.execPath, [__filename, '--worker', ch.channel_id, String(ch.channel_subscribers || 0)], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
    });

    if (child.error && child.error.code === 'ETIMEDOUT') {
      summary.timed_out++;
      summary.slow_channels.push({ channel: ch.channel_name, niche: ch.niche, status: 'timeout', timeout_ms: timeoutMs });
      return;
    }

    const line = (child.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    let payload = null;
    try { payload = JSON.parse(line); } catch (_) {}

    if (!payload || !payload.ok) {
      summary.errors++;
      summary.slow_channels.push({ channel: ch.channel_name, niche: ch.niche, status: 'error', error: payload?.error || child.stderr || child.error?.message || 'unknown' });
      return;
    }

    summary.completed++;
    summary.total_ms += payload.ms || 0;
    summary.total_ideas += payload.ideas || 0;
    summary.total_fallback += payload.fallback || 0;
    if ((payload.ideas || 0) === 0) summary.zero++;
    if ((payload.ideas || 0) < 5) summary.low++;
    if ((payload.fallback || 0) > 0) summary.fallback_channels++;
    if ((payload.ms || 0) > 15000) summary.slow_channels.push({ channel: ch.channel_name, niche: ch.niche, ms: payload.ms, ideas: payload.ideas });

    const cat = payload.niche_category || 'unknown';
    if (!summary.by_category[cat]) summary.by_category[cat] = { channels: 0, fallback_channels: 0, total_ideas: 0 };
    summary.by_category[cat].channels++;
    summary.by_category[cat].fallback_channels += (payload.fallback || 0) > 0 ? 1 : 0;
    summary.by_category[cat].total_ideas += payload.ideas || 0;

    if (!summary.by_niche[ch.niche]) summary.by_niche[ch.niche] = { channels: 0, fallback_channels: 0, total_ideas: 0 };
    summary.by_niche[ch.niche].channels++;
    summary.by_niche[ch.niche].fallback_channels += (payload.fallback || 0) > 0 ? 1 : 0;
    summary.by_niche[ch.niche].total_ideas += payload.ideas || 0;

    for (const [key, value] of Object.entries(payload.evidence || {})) inc(summary.evidence, key, value);
    if (summary.samples.length < 12) {
      summary.samples.push({
        channel: ch.channel_name,
        niche: ch.niche,
        category: cat,
        ms: payload.ms,
        ideas: payload.ideas,
        fallback: payload.fallback,
        evidence: payload.evidence,
        top: payload.samples,
      });
    }

    if ((idx + 1) % 10 === 0) {
      console.error(`[audit] ${idx + 1}/${rows.length} done`);
    }
  });

  const compactGroups = (groups) => Object.fromEntries(
    Object.entries(groups)
      .map(([key, g]) => [key, {
        channels: g.channels,
        fallback_rate: +(g.fallback_channels / Math.max(g.channels, 1)).toFixed(2),
        avg_ideas: +(g.total_ideas / Math.max(g.channels, 1)).toFixed(2),
      }])
      .sort((a, b) => b[1].fallback_rate - a[1].fallback_rate || b[1].channels - a[1].channels)
      .slice(0, 12),
  );

  console.log(JSON.stringify({
    sample: summary.sample,
    completed: summary.completed,
    timed_out: summary.timed_out,
    errors: summary.errors,
    zero: summary.zero,
    low: summary.low,
    fallback_channels: summary.fallback_channels,
    fallback_rate_completed: +(summary.fallback_channels / Math.max(summary.completed, 1)).toFixed(2),
    avg_ideas_completed: +(summary.total_ideas / Math.max(summary.completed, 1)).toFixed(2),
    avg_ms_completed: Math.round(summary.total_ms / Math.max(summary.completed, 1)),
    evidence: summary.evidence,
    by_category: compactGroups(summary.by_category),
    by_niche: compactGroups(summary.by_niche),
    slow_channels: summary.slow_channels.slice(0, 15),
    samples: summary.samples,
  }, null, 2));
}

if (process.argv[2] === '--worker') {
  runWorker(process.argv[3], process.argv[4]);
} else {
  runParent();
}
