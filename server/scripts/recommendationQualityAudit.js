'use strict';

/**
 * Recommendation Quality Audit
 *
 * Reads wtp_generation_traces + wtp_impressions + wtp_saves to compute
 * quality metrics for the concept-centric WTP pipeline.
 *
 * Usage:
 *   node recommendationQualityAudit.js [--days=N] [--channel=ID] [--verbose]
 *
 * Metrics reported:
 *   semantic_validity    — % of traced ideas NOT containing hard-reject patterns
 *   concept_coverage     — % of ideas with a concept_id assigned
 *   title_mutation_rate  — % of ideas whose generated_title closely echoes a source video title
 *   impression_save_rate — % of impressed ideas that were saved (engagement proxy)
 *
 * Targets: semantic_validity >90%, concept_coverage >75%, title_mutation_rate <5%
 */

const path    = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');

// ── Hard-reject patterns (mirrors originalBets.js + wtpRecommendationRefiner.js) ──
const HARD_REJECT_PATTERNS = [
  /\bchanges how you play\b/i,
  /\busing only beginner settings\b/i,
  /\bstrategy most players? miss\b/i,
  /\bone challenge run viewers? will want to finish\b/i,
  /\brisky choices that create the best comeback\b/i,
  /\b(don|dont)\s+(eat|try|watch|play|read)\b/i,
  /\bthe update in\b.*\bthat changes\b/i,
  /\bwin\s+\w+\s+\w+\s+using\b/i,
  /\b\w+\s+(earth|world|globe)\s*$/i,
  /\b(games?|shows?|series)\s+(season|episode|part|round|chapter)\s*\d*$/i,
];

function isHardRejected(title) {
  if (!title) return false;
  for (const pat of HARD_REJECT_PATTERNS) {
    if (pat.test(title)) return true;
  }
  return false;
}

// Simple token overlap ratio for mutation detection
function tokenOverlap(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const tok of ta) { if (tb.has(tok)) hits++; }
  return hits / Math.min(ta.size, tb.size);
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

function openDb() {
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
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Args ───────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args   = process.argv.slice(2);
  const days   = parseInt((args.find(a => a.startsWith('--days='))   || '--days=30').split('=')[1], 10)  || 30;
  const ch     = (args.find(a => a.startsWith('--channel=')) || '').split('=')[1] || null;
  const verbose = args.includes('--verbose');
  return { days, channelId: ch, verbose };
}

// ── Queries ────────────────────────────────────────────────────────────────────

function fetchTraces(db, days, channelId) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const sql = channelId
    ? `SELECT t.*, iv.title AS source_title
       FROM wtp_generation_traces t
       LEFT JOIN ingested_videos iv ON iv.channel_id = t.channel_id
       WHERE t.channel_id = ? AND t.created_at >= ?
       ORDER BY t.created_at DESC`
    : `SELECT t.*, iv.title AS source_title
       FROM wtp_generation_traces t
       LEFT JOIN ingested_videos iv ON iv.channel_id = t.channel_id
       WHERE t.created_at >= ?
       ORDER BY t.created_at DESC`;
  const params = channelId ? [channelId, since] : [since];
  return db.all(sql, params);
}

function fetchImpressionSaveMap(db, days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const impressions = db.all(
    `SELECT idea_key, COUNT(*) AS cnt FROM wtp_impressions WHERE created_at >= ? GROUP BY idea_key`,
    [since],
  );
  const saves = db.all(
    `SELECT idea_key, COUNT(*) AS cnt FROM wtp_saves WHERE created_at >= ? GROUP BY idea_key`,
    [since],
  );
  const impMap  = new Map(impressions.map(r => [r.idea_key, r.cnt]));
  const saveMap = new Map(saves.map(r => [r.idea_key, r.cnt]));
  return { impMap, saveMap };
}

// ── Metric computation ─────────────────────────────────────────────────────────

function computeMetrics(traces, impMap, saveMap, verbose) {
  if (!traces.length) {
    return { total: 0, message: 'No traces found for the requested window.' };
  }

  // Deduplicate by idea_key (keep latest per idea)
  const seen   = new Map();
  for (const t of traces) {
    const k = t.idea_key || t.generated_title || String(t.id);
    if (!seen.has(k)) seen.set(k, t);
  }
  const unique = [...seen.values()];
  const total  = unique.length;

  // 1. semantic_validity — idea does NOT contain hard-reject patterns
  const validCount = unique.filter(t => !isHardRejected(t.generated_title)).length;
  const semanticValidity = validCount / total;

  // 2. concept_coverage — idea has a concept_id
  const withConcept   = unique.filter(t => t.concept_id).length;
  const conceptCoverage = withConcept / total;

  // 3. title_mutation_rate — generated_title overlaps >60% with ANY ingested video title
  //    (uses source_title joined per row; may have multiple rows per idea)
  const mutated = new Set();
  for (const t of traces) {
    const k = t.idea_key || t.generated_title || String(t.id);
    if (t.source_title && tokenOverlap(t.generated_title, t.source_title) >= 0.60) {
      mutated.add(k);
    }
  }
  const titleMutationRate = mutated.size / total;

  // 4. impression_save_rate — of impressed ideas, what fraction got saved
  let impressedIdeas = 0;
  let savedIdeas     = 0;
  for (const t of unique) {
    const k = t.idea_key;
    if (!k) continue;
    if (impMap.has(k)) {
      impressedIdeas++;
      if (saveMap.has(k)) savedIdeas++;
    }
  }
  const impressionSaveRate = impressedIdeas > 0 ? savedIdeas / impressedIdeas : null;

  // 5. Concept distribution breakdown
  const conceptDist = {};
  for (const t of unique) {
    const cid = t.concept_id || '__none__';
    conceptDist[cid] = (conceptDist[cid] || 0) + 1;
  }
  const topConcepts = Object.entries(conceptDist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, n]) => `${id} (${n})`);

  // 6. Family distribution
  const familyDist = {};
  for (const t of unique) {
    const f = t.family || '__none__';
    familyDist[f] = (familyDist[f] || 0) + 1;
  }

  // 7. Hard-reject list (verbose)
  const rejected = verbose ? unique.filter(t => isHardRejected(t.generated_title)).map(t => ({
    channel_id: t.channel_id,
    title:      t.generated_title,
    concept:    t.concept_label || null,
    family:     t.family || null,
  })) : [];

  return {
    window_days:          traces[0] ? Math.ceil((Date.now() - new Date(traces[traces.length - 1].created_at).getTime()) / 86400_000) : null,
    total_unique_ideas:   total,
    semantic_validity:    +(semanticValidity   * 100).toFixed(1),
    concept_coverage:     +(conceptCoverage    * 100).toFixed(1),
    title_mutation_rate:  +(titleMutationRate  * 100).toFixed(1),
    impression_save_rate: impressionSaveRate !== null ? +(impressionSaveRate * 100).toFixed(1) : 'no_impression_data',
    impressed_ideas:      impressedIdeas,
    saved_ideas:          savedIdeas,
    top_concepts:         topConcepts,
    family_distribution:  familyDist,
    targets: {
      semantic_validity:   semanticValidity >= 0.90   ? 'PASS' : 'FAIL',
      concept_coverage:    conceptCoverage  >= 0.75   ? 'PASS' : 'FAIL',
      title_mutation_rate: titleMutationRate <= 0.05  ? 'PASS' : 'FAIL',
    },
    hard_rejected_sample: rejected.slice(0, 20),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const { days, channelId, verbose } = parseArgs();

  const db = openDb();
  try {
    // Check table exists before querying
    const tableExists = db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='wtp_generation_traces'`,
      [],
    );
    if (!tableExists) {
      console.log('wtp_generation_traces table does not exist yet. Run the server once to create it.');
      return;
    }

    const traces             = fetchTraces(db, days, channelId);
    const { impMap, saveMap } = fetchImpressionSaveMap(db, days);
    const metrics            = computeMetrics(traces, impMap, saveMap, verbose);

    console.log('\n=== Recommendation Quality Audit ===');
    if (channelId) console.log(`Channel filter: ${channelId}`);
    console.log(`Window: last ${days} days\n`);
    console.log(JSON.stringify(metrics, null, 2));

    const targets = metrics.targets || {};
    const allPass = Object.values(targets).every(v => v === 'PASS');
    console.log(`\nOverall: ${allPass ? 'ALL TARGETS MET' : 'TARGETS NOT MET — review metrics above'}`);
  } finally {
    db.close();
  }
}

main();
