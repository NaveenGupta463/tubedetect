'use strict';

// Backend-only WTP suggestion sample audit.
//
// Usage:
//   node server/scripts/auditWtpSuggestionsSample.js --limit 30
//   node server/scripts/auditWtpSuggestionsSample.js --limit 30 --random

const path = require('path');
const fs = require('fs');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
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
const {
  classifyTrend,
  getVelocity,
  getFormatWinner,
} = require('../services/topicAnalysis');

const AEVY_CHANNEL_ID = 'UCA295QVkf9O1RQ8_-s3FVXg';

function argValue(name, fallback = null) {
  const exact = process.argv.indexOf(name);
  if (exact !== -1 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

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

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function selectChannels(db, limit, options = {}) {
  const selected = [];
  const seen = new Set();

  function add(row) {
    if (!row || seen.has(row.channel_id)) return;
    seen.add(row.channel_id);
    selected.push(row);
  }

  if (options.includeAevy) {
    add(db.get(
      `SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche,
              ic.channel_subscribers, cid.confidence, cid.confidence_score, cid.sample_count,
              cid.drift_status, cid.negative_dna_json, ccsp.primary_csp
         FROM ingested_channels ic
         JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
         LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
        WHERE ic.channel_id = ?`,
      [AEVY_CHANNEL_ID],
    ));
  }

  const orderBy = options.random
    ? 'random()'
    : 'niche_rank ASC, confidence_score DESC, channel_subscribers DESC';
  const rows = db.all(
    `WITH ranked AS (
       SELECT ic.channel_id, ic.channel_name, COALESCE(ic.primary_niche, ic.niche) AS niche,
              ic.channel_subscribers, cid.confidence, cid.confidence_score, cid.sample_count,
              cid.drift_status, cid.negative_dna_json, ccsp.primary_csp,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(ic.primary_niche, ic.niche)
                ORDER BY cid.confidence_score DESC, ic.channel_subscribers DESC
              ) AS niche_rank
         FROM ingested_channels ic
         JOIN creator_idea_dna cid ON cid.channel_id = ic.channel_id
         LEFT JOIN channel_content_strategy_profiles ccsp ON ccsp.channel_id = ic.channel_id
        WHERE ic.ingest_enabled = 1
          AND ic.channel_id IS NOT NULL
          AND COALESCE(ic.primary_niche, ic.niche) IS NOT NULL
          AND cid.confidence IN ('medium', 'high')
          AND cid.sample_count >= 20
      )
      SELECT * FROM ranked
       WHERE niche_rank <= 4
       ORDER BY ${orderBy}
       LIMIT ?`,
    [Math.max(limit * 3, limit)],
  );

  for (const row of rows) {
    add(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function compactIdea(idea) {
  return {
    topic: idea.topic || idea.title || idea.action_title || '',
    source: idea.source || null,
    score: idea.score || null,
    confidence: idea.confidence || idea.confidence_tier || null,
    channel_count: idea.channel_count || 0,
    examples: (idea.examples || []).slice(0, 2).map(ex => ({
      title: ex.title,
      channel: ex.channel_name,
      views: ex.views || 0,
    })),
  };
}

function quietCompute(fn) {
  if (hasFlag('--verbose')) return fn();
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function mismatchHits(ideas, negativeDna) {
  const families = negativeDna?.mismatch_families || [];
  const hits = [];
  for (const idea of ideas) {
    const text = `${idea.topic || ''} ${idea.title || ''}`.toLowerCase();
    for (const family of families) {
      const matched = (family.match_terms || []).find(term => text.includes(String(term).toLowerCase()));
      if (matched) {
        hits.push({
          family: family.id,
          term: matched,
          topic: idea.topic || idea.title || '',
          source: idea.source || null,
        });
      }
    }
  }
  return hits;
}

function run() {
  const limit = Math.max(1, Math.min(toInt(argValue('--limit'), 30), 100));
  const topOriginal = Math.max(1, Math.min(toInt(argValue('--top-original'), 3), 10));
  const topPeer = Math.max(1, Math.min(toInt(argValue('--top-peer'), 3), 10));
  const outputPath = argValue('--output');
  const db = openReadonlyDb();
  const channels = selectChannels(db, limit, {
    includeAevy: !hasFlag('--no-aevy'),
    random: hasFlag('--random'),
  });

  const summary = {
    requested: limit,
    tested: channels.length,
    errors: 0,
    zero_peer_ideas: 0,
    channels_with_original_bets: 0,
    channels_with_fallback: 0,
    total_peer_ideas: 0,
    total_original_bets: 0,
    total_fallback: 0,
    total_mismatch_hits: 0,
  };
  const results = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    let result;
    try {
      result = quietCompute(() => computeWhatToPost(db, {
        channel_id: ch.channel_id,
        subscriber_count: String(ch.channel_subscribers || 0),
        debug: true,
      }, ctx));
    } catch (e) {
      summary.errors++;
      results.push({
        index: i + 1,
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        niche: ch.niche,
        error: e.message,
      });
      continue;
    }

    const ideas = result.ideas || [];
    const original = result.original_bets?.ideas || [];
    const fallback = ideas.filter(idea => idea.source === 'fallback_evergreen');
    const negativeDna = parseJson(ch.negative_dna_json, null);
    const hits = mismatchHits([...original, ...ideas], negativeDna);

    summary.total_peer_ideas += ideas.length;
    summary.total_original_bets += original.length;
    summary.total_fallback += fallback.length;
    summary.total_mismatch_hits += hits.length;
    if (!ideas.length) summary.zero_peer_ideas++;
    if (original.length) summary.channels_with_original_bets++;
    if (fallback.length) summary.channels_with_fallback++;

    results.push({
      index: i + 1,
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      niche: ch.niche,
      subscribers: ch.channel_subscribers || 0,
      csp: result.csp_primary || ch.primary_csp || null,
      format_profile: result.format_profile || null,
      dna: {
        confidence: ch.confidence,
        score: ch.confidence_score,
        sample_count: ch.sample_count,
        drift_status: ch.drift_status,
      },
      wtp: {
        category: result.niche_category,
        peer_channels: result.channel_count || 0,
        peer_videos: result.video_count || 0,
        peer_ideas: ideas.length,
        fallback_ideas: fallback.length,
        original_status: result.original_bets?.status || null,
        original_ideas: original.length,
        guest_intel_active: !!result.guest_intel_active,
      },
      original_bets: original.slice(0, topOriginal).map(compactIdea),
      peer_ideas: ideas.slice(0, topPeer).map(compactIdea),
      mismatch_hits: hits.slice(0, 6),
    });
  }

  summary.avg_peer_ideas = +(summary.total_peer_ideas / Math.max(channels.length, 1)).toFixed(2);
  summary.avg_original_bets = +(summary.total_original_bets / Math.max(channels.length, 1)).toFixed(2);
  summary.avg_fallback = +(summary.total_fallback / Math.max(channels.length, 1)).toFixed(2);
  summary.original_bet_coverage = +(summary.channels_with_original_bets / Math.max(channels.length, 1)).toFixed(2);
  summary.fallback_channel_rate = +(summary.channels_with_fallback / Math.max(channels.length, 1)).toFixed(2);

  const payload = { summary, results };
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${path.resolve(outputPath)}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
  db.close();
}

try {
  run();
} catch (e) {
  console.error('[audit-wtp-suggestions-sample] Fatal:', e.stack || e.message);
  process.exitCode = 1;
}
