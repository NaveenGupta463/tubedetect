'use strict';

/**
 * reclassifyRepairQueue.js
 *
 * Processes queued niche misclassifications via OpenAI re-classification.
 * Prioritises channels by downstream impact before spending API budget.
 *
 * Priority score:
 *   priority = log(subs + 1) × confidence_gap × community_influence
 *
 *   confidence_gap      = (100 − classification_confidence) / 100
 *                         (larger gap = worse classification = higher urgency)
 *   community_influence = channel's subscriber percentile within its old-niche
 *                         cluster (0–1); top channel in its niche scores 1.0
 *
 * Tier cutoffs:
 *   Tier 1 → top 500 by priority (process by default)
 *   Tier 2 → rank 501–2500
 *   Tier 3 → rank 2501+ (deferred to future run)
 *
 * Exclusions routed to manual review before processing:
 *   - comedy + authority_educator
 *   - comedy + explainer
 *   - hybrid archetypes (content_archetype contains '+', ',' or 'hybrid')
 *
 * Usage:
 *   node server/scripts/reclassifyRepairQueue.js --dry-run
 *   node server/scripts/reclassifyRepairQueue.js --tier=1
 *   node server/scripts/reclassifyRepairQueue.js --tier=2 --limit=500
 *   node server/scripts/reclassifyRepairQueue.js --tier=1 --concurrency=8
 *   node server/scripts/reclassifyRepairQueue.js --tier=1 --impact
 *   node server/scripts/reclassifyRepairQueue.js --channel="Gulshan Kalra"
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const path     = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { classifyChannel, buildSystemPrompt, buildUserPrompt } = require('../services/channelClassifier');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { enqueueRefreshJob } = require('../services/refreshQueue');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const DRY_RUN     = !!args['dry-run'];
const TIER        = Math.max(1, Math.min(4, Number(args.tier) || 1));
const LIMIT       = args.limit   ? Math.min(5000, Number(args.limit))   : Infinity;
const CONCURRENCY = Math.max(1,  Math.min(20, Number(args.concurrency) || 5));
const RUN_IMPACT  = !!args.impact;
const CHAN_FILTER  = args.channel  ? String(args.channel).toLowerCase() : null;
const VALIDATE_N   = args.validate != null
  ? (args.validate === true ? 100 : Math.min(5000, Number(args.validate)))
  : null;

const TIER_RANGES = { 1: [1, 500], 2: [501, 2500], 3: [2501, Infinity], 4: [1, Infinity] };

// Signal precision measured from Tier 1 audit (improved / measurable channels)
const SIGNAL_WEIGHTS = {
  raw_niche_mismatch:    0.316,
  behavior_tag_mismatch: 0.000, // disabled — ROI=-6.3, FP rate=52.9%, avg lift=-13.3pp
  hard_conflict:         1.000,
};
// Channels with topic_precision_before > this threshold are already well-classified;
// reclassifying them would degrade their peer community precision. Skip them.
const TP_SAFETY_THRESHOLD = 70;

// GPT-4.1-mini pricing (USD per token, August 2025)
const COST_PER_INPUT_TOKEN  = 0.40 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 1.60 / 1_000_000;
const CHARS_PER_TOKEN       = 3.8;   // empirical: measured from actual prompt/output samples
const AVG_OUTPUT_TOKENS     = 185;   // measured: sample output JSON ~660-720 chars ÷ 3.8
const SYSTEM_PROMPT_CHARS   = buildSystemPrompt().length;  // computed once at startup (~5,086)

// ── Safety rule: skip channels already well-classified by their peer community ─
function computeTpBefore(db, channelId, niche) {
  try {
    const peers = resolveCreatorPeerContext(db, channelId);
    const ids   = peers?.peerIds || [];
    if (!ids.length) return null;
    const ph   = ids.map(() => '?').join(',');
    const rows = db.all(`SELECT primary_niche FROM ingested_channels WHERE channel_id IN (${ph})`, ids);
    if (!rows.length) return null;
    const matched = rows.filter(r => nicheMatches(r.primary_niche, niche)).length;
    return matched / rows.length * 100;
  } catch (_) { return null; }
}

// ── Exclusion rules ───────────────────────────────────────────────────────────
function isExcluded(ch) {
  const niche = (ch.primary_niche || '').toLowerCase();
  const arch  = (ch.content_archetype || '').toLowerCase();
  if (niche === 'comedy' && (arch === 'authority_educator' || arch === 'explainer')) return 'comedy+educator/explainer';
  if (arch.includes('+') || arch.includes(',') || arch.includes('hybrid')) return 'hybrid_archetype';
  return null;
}

// ── Niche cluster map (mirrors creatorPeerContext.js NICHE_CLUSTERS) ──────────
const NICHE_CLUSTER_MAP = {
  entertainment: ['entertainment', 'comedy', 'comedy sketches'],
  comedy:        ['comedy', 'entertainment', 'comedy sketches'],
  finance:       ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  news:          ['news', 'current affairs', 'breaking news'],
  science:       ['science', 'technology', 'education'],
  technology:    ['science', 'technology', 'education'],
  education:     ['education', 'science', 'technology'],
  music:         ['music'],
  selfimprovement: ['selfimprovement', 'motivation', 'personal development'],
  motivation:    ['selfimprovement', 'motivation', 'personal development'],
  gaming:        ['gaming'],
  travel:        ['travel', 'travel vlogs'],
  food:          ['food', 'cooking', 'street food'],
  fitness:       ['fitness', 'workout', 'bodybuilding'],
  health:        ['health', 'wellness', 'nutrition'],
  lifestyle:     ['lifestyle', 'vlog', 'daily vlogs'],
  business:      ['business', 'entrepreneurship', 'startup'],
  sports:        ['sports'],
  politics:      ['politics'],
  geopolitics:   ['geopolitics'],
  defence:       ['defence'],
  yoga:          ['yoga'],
  meditation:    ['meditation'],
  beauty:        ['beauty'],
  other:         ['other'],
};

function getNicheCluster(niche) {
  return NICHE_CLUSTER_MAP[(niche || '').toLowerCase()] || [(niche || '').toLowerCase()].filter(Boolean);
}
function nicheMatches(peerNiche, channelNiche) {
  if (!peerNiche || !channelNiche) return false;
  return getNicheCluster(channelNiche).includes(peerNiche.toLowerCase());
}

// ── DB helpers ────────────────────────────────────────────────────────────────
function openDb(readonly = true) {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  if (!readonly) raw.pragma('synchronous=NORMAL');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         (sql, p = []) => readonly ? {} : stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => readonly ? fn : raw.transaction(fn),
    close:       () => { cache.clear(); raw.close(); },
    _raw:        raw,
  };
}

// ── Schema setup ──────────────────────────────────────────────────────────────
function ensureReclassifyLog(db) {
  db._raw.exec(`
    CREATE TABLE IF NOT EXISTS reclassification_log (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id          TEXT NOT NULL,
      channel_name        TEXT NOT NULL,
      tier                INTEGER NOT NULL,
      old_niche           TEXT,
      new_niche           TEXT,
      old_archetype       TEXT,
      new_archetype       TEXT,
      old_confidence      REAL,
      new_confidence      REAL,
      reclassification_reason TEXT,
      priority_score      REAL,
      api_tokens_in       INTEGER,
      api_tokens_out      INTEGER,
      api_cost_usd        REAL,
      niche_changed       INTEGER DEFAULT 0,
      archetype_changed   INTEGER DEFAULT 0,
      status              TEXT DEFAULT 'pending',
      reclassified_at     TEXT DEFAULT (datetime('now')),
      error_message       TEXT
    );
    CREATE INDEX IF NOT EXISTS reclassify_log_channel ON reclassification_log(channel_id);
    CREATE INDEX IF NOT EXISTS reclassify_log_status  ON reclassification_log(status);
    CREATE INDEX IF NOT EXISTS reclassify_log_tier    ON reclassification_log(tier, priority_score DESC);
    CREATE TABLE IF NOT EXISTS reclassification_cost_log (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id              TEXT NOT NULL,
      channel_name            TEXT NOT NULL,
      tier                    INTEGER NOT NULL,
      model                   TEXT DEFAULT 'gpt-4.1-mini',
      input_tokens_estimated  INTEGER,
      output_tokens_estimated INTEGER,
      cost_estimated          REAL,
      input_tokens_actual     INTEGER,
      output_tokens_actual    INTEGER,
      cost_actual             REAL,
      estimation_error_pct    REAL,
      created_at              TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS rcl_cost_channel ON reclassification_cost_log(channel_id);
    CREATE INDEX IF NOT EXISTS rcl_cost_tier    ON reclassification_cost_log(tier, created_at);
  `);
}

// ── Channel data fetchers ─────────────────────────────────────────────────────
function getChannelTitles(db, channel_id, limit = 40) {
  const fromIngested = db.all(
    `SELECT title FROM ingested_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT ?`,
    [channel_id, limit],
  ).map(r => r.title);
  if (fromIngested.length > 0) return fromIngested;
  return db.all(
    `SELECT title FROM corpus_videos
     WHERE channel_id = ? AND title IS NOT NULL
     ORDER BY published_at DESC LIMIT ?`,
    [channel_id, limit],
  ).map(r => r.title);
}

function getChannelDescription(db, channel_id) {
  try {
    const row = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel_id]);
    if (!row?.raw_json) return null;
    const j = JSON.parse(row.raw_json);
    const d = j.snippet?.description;
    return (d && d.trim().length > 10) ? d.trim().slice(0, 800) : null;
  } catch (_) { return null; }
}

// ── Priority queue builder ────────────────────────────────────────────────────
function buildPriorityQueue(db) {
  // Load all queued candidates with channel metadata
  const candidates = db.all(
    `SELECT
       crc.channel_id, crc.channel_name, crc.current_niche, crc.suggested_niche,
       crc.repair_reason, crc.confidence AS classification_confidence,
       crc.repair_priority,
       ic.channel_subscribers, ic.primary_niche, ic.content_archetype,
       ic.format_type, ic.behavior_tags, ic.identity_confidence,
       ic.niche_override, ic.identity_source
     FROM classification_repair_candidates crc
     JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
     WHERE crc.status = 'queued'`,
  );

  // Build niche subscriber distributions for community influence scoring
  const uniqueOldNiches = [...new Set(candidates.map(c => c.current_niche).filter(Boolean))];
  const nicheSubsMap = {};
  for (const niche of uniqueOldNiches) {
    const rows = db.all(
      `SELECT channel_subscribers FROM ingested_channels
       WHERE primary_niche = ? AND ingest_enabled = 1
       ORDER BY channel_subscribers`,
      [niche],
    );
    nicheSubsMap[niche] = rows.map(r => r.channel_subscribers || 0);
  }

  function nichePercentileRank(niche, subs) {
    const arr = nicheSubsMap[niche] || [];
    if (!arr.length) return 0.5;
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < subs) lo = mid + 1;
      else hi = mid;
    }
    return lo / arr.length;
  }

  // Compute priority score for each candidate
  for (const c of candidates) {
    const subs        = c.channel_subscribers || 0;
    const confGap     = (100 - (c.classification_confidence || 0)) / 100;
    const influence   = nichePercentileRank(c.current_niche, subs);
    c.priority_score      = Math.log(subs + 1) * confGap * influence;
    c.community_influence = influence;
    c.signal_weight       = SIGNAL_WEIGHTS[c.repair_reason] ?? 0.5;
    c.repair_score        = c.signal_weight * c.priority_score;
  }

  // Sort by repair_score DESC (signal-precision-weighted priority)
  candidates.sort((a, b) => b.repair_score - a.repair_score);

  if (CHAN_FILTER) {
    return candidates.filter(c => c.channel_name.toLowerCase().includes(CHAN_FILTER));
  }
  return candidates;
}

// ── Apply reclassification to DB ──────────────────────────────────────────────
function applyReclassification(db, channel_id, channel_name, newIdentity, oldNiche) {
  const newNiche = newIdentity.primary_niche;
  const now      = new Date().toISOString();

  // Do NOT overwrite a human niche_override — only update if there's no human lock
  const current = db.get(
    'SELECT niche_override, identity_source FROM ingested_channels WHERE channel_id = ?',
    [channel_id],
  );
  const hasHumanOverride = current?.niche_override && current?.identity_source !== 'auto_repair';
  const nicheToSave      = hasHumanOverride ? current.niche_override : newNiche;

  db.run(
    `UPDATE ingested_channels SET
       primary_niche          = ?,
       niche                  = ?,
       secondary_niche        = ?,
       content_archetype      = ?,
       format_type            = ?,
       behavior_tags          = ?,
       audience_style         = ?,
       identity_confidence    = ?,
       identity_reasoning     = ?,
       identity_last_detected_at = ?,
       identity_strength      = ?,
       identity_source        = ?,
       inferred_topics        = ?
     WHERE channel_id = ?`,
    [
      nicheToSave,
      nicheToSave,
      newIdentity.secondary_niche ?? null,
      newIdentity.content_archetype ?? null,
      newIdentity.format_type ?? null,
      JSON.stringify(newIdentity.behavior_tags ?? []),
      newIdentity.audience_style ?? 'general',
      newIdentity.identity_confidence ?? 0.5,
      newIdentity.identity_reasoning ?? null,
      now,
      newIdentity.identity_strength ?? null,
      hasHumanOverride ? 'ai_reclassify_niche_locked' : 'ai_reclassify',
      JSON.stringify(newIdentity.inferred_topics ?? []),
      channel_id,
    ],
  );

  // Cascade niche to ingested_videos
  if (!hasHumanOverride) {
    db.run(
      'UPDATE ingested_videos SET niche = ? WHERE channel_id = ?',
      [newNiche, channel_id],
    );
  }

  // Invalidate WTP cache
  db.run('DELETE FROM channel_wtp_cache WHERE channel_id = ?', [channel_id]);
  if (!DRY_RUN) {
    enqueueRefreshJob(db, { job_type: 'wtp_cache', channel_id, priority: 50, reason: 'post_reclassification' });
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function pad(s, w)  { return String(s ?? '').padEnd(w).slice(0, w); }
function rpad(s, w) { return String(s ?? '').padStart(w).slice(-w); }
function pp(n)      { return (n >= 0 ? '+' : '') + n.toFixed(1) + 'pp'; }
function pct(n)     { return n == null ? '—' : n.toFixed(1) + '%'; }
function flt(n)     { return n == null ? '—' : n.toFixed(2); }
function subs(n)    {
  if (!n) return '—';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}
function dollar(n)  { return '$' + (n ?? 0).toFixed(4); }
function avg(arr)   { const v = arr.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; }

function estimateTokens(channelName, titles, description) {
  // buildUserPrompt internally applies .slice(0,20) on titles and .slice(0,600) on description,
  // so passing the raw DB arrays gives the same text the API will see.
  const userChars   = buildUserPrompt(channelName, titles, description).length;
  const inputTokens = Math.round((SYSTEM_PROMPT_CHARS + userChars) / CHARS_PER_TOKEN);
  return { inputTokens, outputTokens: AVG_OUTPUT_TOKENS };
}
function estimateCost(inputTokens, outputTokens) {
  return inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
}

// ── Concurrency helper ────────────────────────────────────────────────────────
async function withConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Impact measurement (cross-sectional, same as repairImpactAnalysis.js) ─────
function computeTopicPrecision(peersMeta, channelNiche) {
  if (!peersMeta?.length) return 0;
  const matched = peersMeta.filter(p => nicheMatches(p.primary_niche, channelNiche)).length;
  return matched / peersMeta.length * 100;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const db   = openDb(true);
  const dbRw = (DRY_RUN || VALIDATE_N != null) ? null : openDb(false);

  if (!DRY_RUN && VALIDATE_N == null) {
    ensureReclassifyLog(dbRw);

    if (!process.env.OPENAI_API_KEY) {
      console.error('\n  ✗ OPENAI_API_KEY not set in .env — cannot run reclassification.\n');
      process.exit(1);
    }
  }

  // ── Phase 1: Build priority queue ──────────────────────────────────────────
  console.log('\n');
  console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('  RECLASSIFY REPAIR QUEUE  —  ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '  UTC');
  console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('\n  Building priority queue...');

  const queue      = buildPriorityQueue(db);
  const excluded   = [];
  const actionable = [];

  for (const ch of queue) {
    const reason = isExcluded(ch);
    if (reason) excluded.push({ ...ch, exclusion_reason: reason });
    else        actionable.push(ch);
  }

  // Assign tiers (after exclusions, based on priority rank)
  const [t1lo, t1hi] = TIER_RANGES[1];
  const [t2lo, t2hi] = TIER_RANGES[2];
  const tier1 = actionable.slice(t1lo - 1, t1hi);
  const tier2 = actionable.slice(t2lo - 1, Math.min(t2hi, actionable.length));
  const tier3 = actionable.slice(Math.min(t2hi, actionable.length));
  const tier4 = actionable; // all remaining queued candidates

  const tierMap = { 1: tier1, 2: tier2, 3: tier3, 4: tier4 };

  // Print queue summary
  console.log(`\n  Total queued:  ${queue.length.toLocaleString()}   Actionable: ${actionable.length.toLocaleString()}   Excluded (manual review): ${excluded.length}`);
  console.log(`  Tier 1 (top 500):  ${tier1.length}   Tier 2 (501-2500): ${tier2.length}   Tier 3 (deferred): ${tier3.length}   Tier 4 (all): ${tier4.length}`);

  // Print exclusion breakdown
  if (excluded.length > 0) {
    const excByReason = {};
    for (const e of excluded) {
      excByReason[e.exclusion_reason] = (excByReason[e.exclusion_reason] || 0) + 1;
    }
    console.log('\n  Manual review exclusions:');
    for (const [r, n] of Object.entries(excByReason)) {
      console.log(`    ${r.padEnd(30)} ${n} channels`);
    }
  }

  // Print niche migration table for selected tier
  const target = tierMap[TIER] || tier1;
  const toLimitTarget = CHAN_FILTER ? target : target.slice(0, LIMIT);

  const migrationMap = {};
  for (const ch of toLimitTarget) {
    const key = `${ch.current_niche} → ${ch.suggested_niche || '?'}`;
    migrationMap[key] = (migrationMap[key] || 0) + 1;
  }

  console.log(`\n  ── TIER ${TIER} QUEUE SNAPSHOT (${toLimitTarget.length} channels) ─────────────────────────────────────────\n`);
  console.log(`  ${pad('Repair type', 32)} ${rpad('N', 6)} ${rpad('Avg priority', 14)} ${rpad('Avg subs', 12)}\n`);

  const byRepairType = {};
  for (const ch of toLimitTarget) {
    const key = `${ch.current_niche} → ${ch.suggested_niche || '?'} (${ch.repair_reason.replace('_mismatch','').replace('raw_niche','raw').replace('behavior_tag','btag')})`;
    if (!byRepairType[key]) byRepairType[key] = [];
    byRepairType[key].push(ch);
  }

  const sortedTypes = Object.entries(byRepairType)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);

  for (const [type, rows] of sortedTypes) {
    const avgPri  = avg(rows.map(r => r.priority_score));
    const avgSubs = avg(rows.map(r => r.channel_subscribers));
    console.log(`  ${pad(type, 32)} ${rpad(rows.length, 6)} ${rpad(avgPri.toFixed(3), 14)} ${rpad(subs(Math.round(avgSubs)), 12)}`);
  }

  // Print top 15 channels in this tier
  console.log(`\n  ── TOP 15 CHANNELS BY PRIORITY ─────────────────────────────────────────────────────────────────\n`);
  console.log(`  ${rpad('#', 4)} ${pad('Channel', 36)} ${pad('Old→New niche', 30)} ${rpad('Subs', 9)} ${rpad('Priority', 10)} ${rpad('Influence', 10)}\n`);
  toLimitTarget.slice(0, 15).forEach((ch, i) => {
    const migration = `${ch.current_niche} → ${ch.suggested_niche || '?'}`;
    console.log(
      `  ${rpad(i + 1, 4)}. ${pad(ch.channel_name, 36)} ${pad(migration, 30)} ` +
      `${rpad(subs(ch.channel_subscribers), 9)} ${rpad(ch.priority_score.toFixed(3), 10)} ${rpad(pct(ch.community_influence * 100), 10)}`,
    );
  });

  // ── Cost estimate: exact token sizing by sampling actual channel prompts ──────────────────────
  if (DRY_RUN || VALIDATE_N != null) {
    const sampleSet = VALIDATE_N != null ? actionable.slice(0, VALIDATE_N) : toLimitTarget;
    process.stdout.write(`\n  Sampling ${sampleSet.length} channel(s) for exact token estimation...`);
    const tokenEsts = [];
    for (const ch of sampleSet) {
      const titles = getChannelTitles(db, ch.channel_id, 40);
      const desc   = getChannelDescription(db, ch.channel_id);
      const est    = estimateTokens(ch.channel_name, titles, desc);
      tokenEsts.push({ ...ch, estIn: est.inputTokens });
    }
    process.stdout.write(' done.\n');

    const sorted  = tokenEsts.map(e => e.estIn).sort((a, b) => a - b);
    const p50in   = sorted[Math.floor(sorted.length * 0.50)] ?? 0;
    const p90in   = sorted[Math.floor(sorted.length * 0.90)] ?? 0;
    const p99in   = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
    const avgIn   = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    const totIn   = sorted.reduce((s, v) => s + v, 0);
    const totOut  = sampleSet.length * AVG_OUTPUT_TOKENS;
    const totCost = estimateCost(totIn, totOut);

    console.log(`\n  ── COST ESTIMATE (exact prompt sizing) ──────────────────────────────────────────────────────\n`);
    console.log(`  Channels: ${sampleSet.length}   Model: gpt-4.1-mini   Concurrency: ${CONCURRENCY}`);
    console.log(`  System prompt: ${SYSTEM_PROMPT_CHARS.toLocaleString()} chars (~${Math.round(SYSTEM_PROMPT_CHARS / CHARS_PER_TOKEN).toLocaleString()} tokens)`);
    console.log(`  Input tokens:   p50=${p50in.toLocaleString()}   p90=${p90in.toLocaleString()}   p99=${p99in.toLocaleString()}   avg=${avgIn.toLocaleString()}`);
    console.log(`  Output tokens:  ${AVG_OUTPUT_TOKENS} (empirically measured)`);
    console.log(`  Total: ${(totIn / 1_000).toFixed(0)}K input + ${(totOut / 1_000).toFixed(0)}K output tokens`);
    console.log(`  Estimated cost:   $${totCost.toFixed(3)}  (@ $0.40/1M input, $1.60/1M output)`);
    console.log(`  Avg cost/channel: $${(totCost / sampleSet.length).toFixed(5)}`);
    console.log(`  Estimated time:   ~${Math.ceil(sampleSet.length / CONCURRENCY * 2.5 / 60)} min at ${CONCURRENCY} concurrent`);

    const top20 = [...tokenEsts].sort((a, b) => b.estIn - a.estIn).slice(0, 20);
    console.log(`\n  ── TOP 20 CHANNELS BY ESTIMATED TOKENS ─────────────────────────────────────────────────────\n`);
    console.log(`  ${rpad('#', 4)} ${pad('Channel', 36)} ${pad('Migration', 28)} ${rpad('Est tokens', 12)} ${rpad('Est cost', 10)}\n`);
    top20.forEach((ch, i) => {
      const chCost = estimateCost(ch.estIn, AVG_OUTPUT_TOKENS);
      console.log(
        `  ${rpad(i + 1, 4)}. ${pad(ch.channel_name, 36)} ` +
        `${pad(`${ch.current_niche} → ${ch.suggested_niche || '?'}`, 28)} ` +
        `${rpad(ch.estIn.toLocaleString(), 12)} ${rpad('$' + chCost.toFixed(5), 10)}`,
      );
    });

    if (DRY_RUN) {
      console.log('\n  DRY RUN — no API calls made. Remove --dry-run to process.\n');
      console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');
      db.close();
      return;
    }
    // --validate exits here without API calls
    console.log(`\n  VALIDATE — token distribution for top ${sampleSet.length} channels. No API calls made.\n`);
    console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');
    db.close();
    return;
  }

  // Non-dry-run: show quick pre-run estimate (exact per-channel estimates tracked live during run)
  {
    const numToProcess = toLimitTarget.length;
    const quickAvgIn   = 1580;  // measured avg across sample channels
    const estCost      = estimateCost(numToProcess * quickAvgIn, numToProcess * AVG_OUTPUT_TOKENS);
    console.log(`\n  ── PRE-RUN COST ESTIMATE ────────────────────────────────────────────────────────────────────\n`);
    console.log(`  Channels: ${numToProcess}   Model: gpt-4.1-mini   Concurrency: ${CONCURRENCY}`);
    console.log(`  Avg input tokens: ~${quickAvgIn.toLocaleString()} (measured)   Avg output: ${AVG_OUTPUT_TOKENS}`);
    console.log(`  Estimated cost: $${estCost.toFixed(3)}  (@ $0.40/1M input, $1.60/1M output)`);
    console.log(`  Estimated time: ~${Math.ceil(numToProcess / CONCURRENCY * 2.5 / 60)} min at ${CONCURRENCY} concurrent`);
    console.log(`  Tip: add --dry-run for exact per-channel token estimates before committing.`);
  }

  // ── Phase 2: Mark excluded channels as manual_review ────────────────────────
  if (excluded.length > 0 && dbRw) {
    const tx = dbRw._raw.transaction(() => {
      for (const ch of excluded) {
        dbRw.run(
          `UPDATE classification_repair_candidates
           SET status = 'manual_review', repaired_at = datetime('now'),
               repair_applied = ?
           WHERE channel_id = ? AND status = 'queued'`,
          [ch.exclusion_reason, ch.channel_id],
        );
      }
    });
    tx();
    console.log(`\n  ✓ Marked ${excluded.length} channels as manual_review`);
  }

  // ── Phase 3: Process selected tier ──────────────────────────────────────────
  console.log(`\n  Processing Tier ${TIER} (${toLimitTarget.length} channels, ${CONCURRENCY} concurrent)...\n`);

  let processed = 0, nicheChanged = 0, noChange = 0, skipped = 0, errors = 0;
  let totalCostUSD = 0, totalTokensIn = 0, totalTokensOut = 0;
  let totalEstInputTokens = 0, totalEstCostUSD = 0;
  const startMs = Date.now();

  const perChannelResults = await withConcurrency(toLimitTarget, CONCURRENCY, async (ch, i) => {
    const channelNum = i + 1;

    // Fetch titles
    const titles = getChannelTitles(db, ch.channel_id);
    if (!titles.length) {
      const errMsg = 'No video titles available';
      dbRw.run(
        `INSERT OR REPLACE INTO reclassification_log
         (channel_id, channel_name, tier, old_niche, new_niche, old_archetype, old_confidence,
          priority_score, status, error_message)
         VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
        [ch.channel_id, ch.channel_name, TIER, ch.current_niche, ch.content_archetype,
         ch.identity_confidence, ch.priority_score, 'skipped_no_titles', errMsg],
      );
      dbRw.run(
        `UPDATE classification_repair_candidates SET status='skipped', repaired_at=datetime('now'),
         repair_applied='no_titles' WHERE channel_id=?`,
        [ch.channel_id],
      );
      skipped++;
      if (channelNum % 50 === 0 || channelNum === toLimitTarget.length) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
        process.stdout.write(`\r  ${channelNum}/${toLimitTarget.length} processed | changed: ${nicheChanged} | no change: ${noChange} | skip: ${skipped} | err: ${errors} | ${elapsed}s   `);
      }
      return null;
    }

    // Safety rule: skip channels whose peer community already matches their current niche.
    // These are false-positive repair candidates — reclassifying would degrade precision.
    const tpBefore = computeTpBefore(db, ch.channel_id, ch.current_niche);
    if (tpBefore != null && tpBefore > TP_SAFETY_THRESHOLD) {
      dbRw.run(
        `INSERT OR REPLACE INTO reclassification_log
         (channel_id, channel_name, tier, old_niche, new_niche, old_archetype, old_confidence,
          priority_score, status, error_message)
         VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
        [ch.channel_id, ch.channel_name, TIER, ch.current_niche, ch.content_archetype,
         ch.identity_confidence, ch.priority_score, 'safety_excluded',
         `tp_before=${tpBefore.toFixed(1)}% > ${TP_SAFETY_THRESHOLD}% threshold`],
      );
      dbRw.run(
        `UPDATE classification_repair_candidates SET status='safety_excluded', repaired_at=datetime('now'),
         repair_applied=? WHERE channel_id=? AND status='queued'`,
        [`tp_before=${tpBefore.toFixed(1)}%`, ch.channel_id],
      );
      skipped++;
      if (channelNum % 50 === 0 || channelNum === toLimitTarget.length) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
        process.stdout.write(`\r  ${channelNum}/${toLimitTarget.length} processed | changed: ${nicheChanged} | no change: ${noChange} | skip: ${skipped} | err: ${errors} | ${elapsed}s   `);
      }
      return null;
    }

    const description = getChannelDescription(db, ch.channel_id);

    // Compute pre-call estimate using the exact prompt the API will see
    const est       = estimateTokens(ch.channel_name, titles, description);
    const estCostCh = estimateCost(est.inputTokens, est.outputTokens);

    let newIdentity, tokensIn, tokensOut, costUSD;
    try {
      const apiResult = await classifyChannel({
        channelName: ch.channel_name,
        titles,
        description,
      });

      // Use actual token usage from API response; fall back to estimate if unavailable
      const usage = apiResult._usage;
      tokensIn  = usage?.prompt_tokens     ?? est.inputTokens;
      tokensOut = usage?.completion_tokens ?? est.outputTokens;
      costUSD   = estimateCost(tokensIn, tokensOut);
      totalTokensIn       += tokensIn;
      totalTokensOut      += tokensOut;
      totalCostUSD        += costUSD;
      totalEstInputTokens += est.inputTokens;
      totalEstCostUSD     += estCostCh;

      newIdentity = apiResult;
    } catch (e) {
      const errMsg = e.message?.slice(0, 120);
      dbRw.run(
        `INSERT OR REPLACE INTO reclassification_log
         (channel_id, channel_name, tier, old_niche, new_niche, old_archetype, old_confidence,
          priority_score, status, error_message)
         VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
        [ch.channel_id, ch.channel_name, TIER, ch.current_niche, ch.content_archetype,
         ch.identity_confidence, ch.priority_score, 'error', errMsg],
      );
      dbRw.run(
        `UPDATE classification_repair_candidates SET status='error', repaired_at=datetime('now'),
         repair_applied=? WHERE channel_id=?`,
        [errMsg?.slice(0, 80), ch.channel_id],
      );
      errors++;
      if (channelNum % 50 === 0 || channelNum === toLimitTarget.length) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
        process.stdout.write(`\r  ${channelNum}/${toLimitTarget.length} processed | changed: ${nicheChanged} | no change: ${noChange} | skip: ${skipped} | err: ${errors} | ${elapsed}s   `);
      }
      return null;
    }

    const changed      = newIdentity.primary_niche !== ch.current_niche;
    const archChanged  = newIdentity.content_archetype !== ch.content_archetype;
    const statusStr    = changed ? 'reclassified' : 'reclassified_no_change';

    // Log to reclassification_log
    dbRw.run(
      `INSERT OR REPLACE INTO reclassification_log
       (channel_id, channel_name, tier, old_niche, new_niche, old_archetype, new_archetype,
        old_confidence, new_confidence, reclassification_reason, priority_score,
        api_tokens_in, api_tokens_out, api_cost_usd, niche_changed, archetype_changed, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ch.channel_id, ch.channel_name, TIER,
        ch.current_niche, newIdentity.primary_niche,
        ch.content_archetype, newIdentity.content_archetype,
        ch.identity_confidence, newIdentity.identity_confidence,
        newIdentity.identity_reasoning?.slice(0, 200) ?? null,
        ch.priority_score,
        tokensIn, tokensOut, costUSD,
        changed ? 1 : 0, archChanged ? 1 : 0,
        statusStr,
      ],
    );

    // Log cost accuracy for this channel
    const estErrPct = estCostCh > 0 ? (costUSD - estCostCh) / estCostCh * 100 : 0;
    dbRw.run(
      `INSERT INTO reclassification_cost_log
       (channel_id, channel_name, tier, model, input_tokens_estimated, output_tokens_estimated,
        cost_estimated, input_tokens_actual, output_tokens_actual, cost_actual, estimation_error_pct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        ch.channel_id, ch.channel_name, TIER, 'gpt-4.1-mini',
        est.inputTokens, est.outputTokens, estCostCh,
        tokensIn, tokensOut, costUSD, estErrPct,
      ],
    );

    // Apply to ingested_channels if niche changed
    if (changed) {
      applyReclassification(dbRw, ch.channel_id, ch.channel_name, newIdentity, ch.current_niche);
      nicheChanged++;
    } else {
      // Even if niche didn't change, update confidence and archetype
      dbRw.run(
        `UPDATE ingested_channels SET
           identity_confidence = ?, identity_source = 'ai_reclassify',
           content_archetype = ?, identity_last_detected_at = datetime('now')
         WHERE channel_id = ?`,
        [newIdentity.identity_confidence, newIdentity.content_archetype, ch.channel_id],
      );
      noChange++;
    }

    // Update repair candidate status
    dbRw.run(
      `UPDATE classification_repair_candidates
       SET status = ?, repaired_at = datetime('now'),
           repair_applied = ?
       WHERE channel_id = ? AND status = 'queued'`,
      [
        statusStr,
        `${ch.current_niche} → ${newIdentity.primary_niche} (conf: ${newIdentity.identity_confidence?.toFixed(2)})`,
        ch.channel_id,
      ],
    );

    processed++;
    if (channelNum % 50 === 0 || channelNum === 1 || channelNum === toLimitTarget.length) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
      process.stdout.write(`\r  ${channelNum}/${toLimitTarget.length} processed | changed: ${nicheChanged} | no change: ${noChange} | skip: ${skipped} | err: ${errors} | ${elapsed}s   `);
    }

    return {
      channel_id:   ch.channel_id,
      channel_name: ch.channel_name,
      old_niche:    ch.current_niche,
      new_niche:    newIdentity.primary_niche,
      niche_changed: changed,
      subs:         ch.channel_subscribers,
      priority:     ch.priority_score,
    };
  });

  const totalElapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log('\n');
  console.log(`  ── PROCESSING COMPLETE ─────────────────────────────────────────────────────────────────────────\n`);
  console.log(`  Processed: ${processed + skipped + errors}   Changed: ${nicheChanged}   No change: ${noChange}   Skipped: ${skipped}   Errors: ${errors}`);
  console.log(`  Elapsed: ${totalElapsed}s   Total cost: $${totalCostUSD.toFixed(4)}`);
  console.log(`  Tokens used: ${(totalTokensIn / 1000).toFixed(0)}K input + ${(totalTokensOut / 1000).toFixed(0)}K output`);
  if (totalEstCostUSD > 0) {
    const runErrPct = (totalCostUSD - totalEstCostUSD) / totalEstCostUSD * 100;
    const errSign   = runErrPct >= 0 ? '+' : '';
    console.log(`  Cost accuracy:  Estimated $${totalEstCostUSD.toFixed(4)}  →  Actual $${totalCostUSD.toFixed(4)}  →  Error ${errSign}${runErrPct.toFixed(1)}%`);
  }

  // ── Phase 4: Reclassification Impact Report ──────────────────────────────────
  // Show migration breakdown
  const allLogs = dbRw.all(
    `SELECT old_niche, new_niche, COUNT(*) as n, SUM(niche_changed) as changed
     FROM reclassification_log
     WHERE tier = ? AND status IN ('reclassified', 'reclassified_no_change')
     GROUP BY old_niche, new_niche
     ORDER BY changed DESC, n DESC`,
    [TIER],
  );

  console.log(`\n  ── NICHE MIGRATION BREAKDOWN ───────────────────────────────────────────────────────────────────\n`);
  console.log(`  ${pad('Migration', 36)} ${rpad('Total', 8)} ${rpad('Changed', 9)} ${rpad('Unchanged', 11)} ${rpad('Change%', 9)}\n`);
  for (const row of allLogs.slice(0, 25)) {
    const pctChg = row.n > 0 ? (row.changed / row.n * 100).toFixed(0) + '%' : '—';
    console.log(
      `  ${pad(`${row.old_niche || '?'} → ${row.new_niche || '?'}`, 36)} ` +
      `${rpad(row.n, 8)} ${rpad(row.changed, 9)} ${rpad(row.n - row.changed, 11)} ${rpad(pctChg, 9)}`,
    );
  }

  // Cluster size deltas
  const changedNiches = new Set();
  const clusterDeltas = {};
  for (const r of perChannelResults.filter(Boolean)) {
    if (r.niche_changed) {
      changedNiches.add(r.old_niche);
      changedNiches.add(r.new_niche);
      clusterDeltas[r.old_niche] = (clusterDeltas[r.old_niche] || 0) - 1;
      clusterDeltas[r.new_niche] = (clusterDeltas[r.new_niche] || 0) + 1;
    }
  }

  if (Object.keys(clusterDeltas).length > 0) {
    console.log(`\n  ── NICHE CLUSTER SIZE DELTAS ───────────────────────────────────────────────────────────────────\n`);
    console.log(`  ${pad('Niche', 24)} ${rpad('Delta', 8)} ${rpad('Direction', 12)}\n`);
    for (const [niche, delta] of Object.entries(clusterDeltas).sort((a, b) => b[1] - a[1])) {
      const dir = delta > 0 ? 'GAINED' : 'LOST';
      console.log(`  ${pad(niche, 24)} ${rpad((delta > 0 ? '+' : '') + delta, 8)} ${rpad(dir, 12)}`);
    }
  }

  // Topic precision impact estimate (cross-sectional sample of top 30 changed)
  if (RUN_IMPACT && nicheChanged > 0) {
    const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');

    const changedSample = perChannelResults
      .filter(Boolean)
      .filter(r => r.niche_changed)
      .slice(0, 30);

    if (changedSample.length > 0) {
      console.log(`\n  ── TOPIC PRECISION DELTA (sample of ${changedSample.length} changed channels) ─────────────────────────\n`);
      console.log(`  ${pad('Channel', 36)} ${pad('Migration', 30)} ${rpad('Before', 8)} ${rpad('After', 8)} ${rpad('Lift', 8)}\n`);

      const lifts = [];
      for (const r of changedSample) {
        try {
          const peerResult = resolveCreatorPeerContext(db, r.channel_id);
          const peerIds    = peerResult.peerIds || [];
          if (peerIds.length === 0) continue;

          const ph       = peerIds.map(() => '?').join(',');
          const peerMeta = db.all(
            `SELECT primary_niche FROM ingested_channels WHERE channel_id IN (${ph})`,
            peerIds,
          );

          const before = computeTopicPrecision(peerMeta, r.old_niche);
          const after  = computeTopicPrecision(peerMeta, r.new_niche);
          const lift   = after - before;
          lifts.push(lift);

          console.log(
            `  ${pad(r.channel_name, 36)} ${pad(`${r.old_niche} → ${r.new_niche}`, 30)} ` +
            `${rpad(pct(before), 8)} ${rpad(pct(after), 8)} ${rpad(pp(lift), 8)}`,
          );
        } catch (_) {}
      }

      if (lifts.length > 0) {
        const avgLift = avg(lifts);
        const medLift = [...lifts].sort((a, b) => a - b)[Math.floor(lifts.length / 2)];
        console.log(`\n  Topic precision lift: avg ${pp(avgLift)}   median ${pp(medLift)}   (${lifts.length} channels sampled)`);
      }
    }
  }

  // WTP cache invalidations
  const wtpCleared = dbRw.get(
    `SELECT COUNT(*) as n FROM reclassification_log WHERE tier=? AND niche_changed=1`,
    [TIER],
  )?.n ?? 0;

  console.log(`\n  WTP cache entries cleared: ${wtpCleared}`);
  console.log(`  Average API cost per channel: $${(totalCostUSD / Math.max(1, processed + skipped)).toFixed(5)}`);
  console.log(`  Remaining queued: ${actionable.filter(c => !toLimitTarget.includes(c)).length + (TIER === 1 ? tier2.length + tier3.length : TIER === 2 ? tier3.length : 0)}`);

  // Verdict
  const changeRate = (processed > 0) ? nicheChanged / processed : 0;
  console.log(`\n  ── TIER ${TIER} VERDICT ──────────────────────────────────────────────────────────────────────────\n`);
  if (changeRate > 0.3) {
    console.log(`  ✅  HIGH SIGNAL — ${(changeRate * 100).toFixed(0)}% of channels had niche changed (${nicheChanged}/${processed}).`);
    console.log(`      The repair queue contained meaningful misclassifications. Tier ${TIER + 1} is warranted.`);
  } else if (changeRate > 0.1) {
    console.log(`  ⚠️   MODERATE — ${(changeRate * 100).toFixed(0)}% of channels had niche changed (${nicheChanged}/${processed}).`);
    console.log(`      Some misclassifications found. Consider running Tier ${TIER + 1} on the highest-priority channels.`);
  } else {
    console.log(`  ℹ️   LOW SIGNAL — only ${(changeRate * 100).toFixed(0)}% of channels changed (${nicheChanged}/${processed}).`);
    console.log(`      The queue may be mostly correctly classified. Investigate no-change cases before Tier ${TIER + 1}.`);
  }

  console.log(`\n  ── NEXT STEPS ────────────────────────────────────────────────────────────────────────────────────\n`);
  if (TIER < 3) {
    const nextTier     = TIER + 1;
    const nextSize     = tierMap[nextTier]?.length ?? 0;
    const nextCost     = estimateCost(nextSize * 1580, nextSize * AVG_OUTPUT_TOKENS);
    console.log(`  Run Tier ${nextTier} (${nextSize} channels, est. $${nextCost.toFixed(2)}):`);
    console.log(`    node server/scripts/reclassifyRepairQueue.js --tier=${nextTier}`);
  }
  console.log(`  Review manual-review exclusions:`);
  console.log(`    node server/scripts/classificationQualityAudit.js --min-subs=10000`);
  console.log(`  Measure cumulative impact:`);
  console.log(`    node server/scripts/repairImpactAnalysis.js`);
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');

  db.close();
  if (dbRw) dbRw.close();
}

main().catch(e => {
  console.error('\n  Fatal error:', e.message);
  process.exit(1);
});
