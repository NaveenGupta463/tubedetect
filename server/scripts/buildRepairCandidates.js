'use strict';

/**
 * buildRepairCandidates.js
 *
 * Classification Repair Pipeline — scans all enabled channels, identifies
 * misclassified ones, populates classification_repair_candidates table,
 * and applies auto-repairs for hard conflicts.
 *
 * Priority:
 *  1. HARD_NA_CONFLICT   → auto-repair  (sets niche_override, updates primary_niche)
 *  2. RAW_NICHE_MISMATCH → queue        (degrades identity_confidence for re-classification)
 *  3. BTAG_MISMATCH      → queue        (degrades identity_confidence for re-classification)
 *
 * Usage:
 *   node server/scripts/buildRepairCandidates.js
 *   node server/scripts/buildRepairCandidates.js --dry-run
 *   node server/scripts/buildRepairCandidates.js --min-subs=100000
 *   node server/scripts/buildRepairCandidates.js --top=50
 *   node server/scripts/buildRepairCandidates.js --priority=1    (only HARD conflicts)
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const {
  ensureRepairTable,
  buildRepairCandidates,
  repairClassificationCandidate,
  NICHE_VOCAB,
} = require('../services/classificationRepair');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : v];
    }),
);
const DRY_RUN    = args['dry-run'] === true || args['dry-run'] === 'true';
const MIN_SUBS   = Number(args['min-subs']) || 0;
const TOP        = Number(args.top) || 50;
const PRIORITY   = args.priority ? Number(args.priority) : null; // 1|2|3 or null for all

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb(readOnly) {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: readOnly, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  if (!readOnly) raw.pragma('synchronous=NORMAL');
  const cache = new Map();
  const stmt  = sql => {
    if (!cache.has(sql)) cache.set(sql, raw.prepare(sql));
    return cache.get(sql);
  };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run: (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => raw.transaction(fn),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────
function pad(s, n)  { return String(s ?? '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s ?? '').padStart(n).slice(-n); }

function fmtSubs(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function divider(char = '─', w = 120) { console.log('  ' + char.repeat(w)); }

function reasonColor(reason) {
  if (reason === 'hard_conflict')        return '\x1b[31m';
  if (reason === 'raw_niche_mismatch')   return '\x1b[33m';
  if (reason === 'behavior_tag_mismatch') return '\x1b[36m';
  return '';
}

// ── Impact estimation ─────────────────────────────────────────────────────────

function estimateImpact(db, candidates) {
  // 1. WTP cache rows invalidated
  const cacheTotal = (db.get('SELECT COUNT() as cnt FROM channel_wtp_cache', []) || {}).cnt || 0;
  const hardIds    = candidates.filter(c => c.repair_reason === 'hard_conflict').map(c => c.channel_id);
  const cacheHits  = hardIds.length > 0
    ? (db.get(
        `SELECT COUNT() as cnt FROM channel_wtp_cache WHERE channel_id IN (${hardIds.map(() => '?').join(',')})`,
        hardIds,
      ) || {}).cnt || 0
    : 0;

  // 2. Niche cluster size change — how many other channels share the old/new niche
  //    for each repaired channel. Approximation of peer pool disruption.
  const nicheDistrib = {};
  const niches = db.all(
    'SELECT primary_niche, COUNT() as cnt FROM ingested_channels WHERE ingest_enabled=1 GROUP BY primary_niche',
    [],
  );
  niches.forEach(r => { nicheDistrib[r.primary_niche] = r.cnt; });

  // 3. Channels affected per repair type
  const byReason = { hard_conflict: [], raw_niche_mismatch: [], behavior_tag_mismatch: [] };
  for (const c of candidates) byReason[c.repair_reason].push(c);

  // 4. Total subscriber reach of misclassified channels
  const totalSubsAffected = candidates.reduce((s, c) => s + (c.channel_subscribers || 0), 0);
  const hardSubsAffected  = byReason.hard_conflict.reduce((s, c) => s + (c.channel_subscribers || 0), 0);

  // 5. Original bets impact — channels whose niche changes → different subject pool
  //    Estimate: 1 domain subject set per niche change = completely new originalBets candidates
  const betsImpact = byReason.hard_conflict.length; // Only hard repairs change niche immediately

  // 6. Community (peer pool) impact — for each hard repair:
  //    The repaired channel leaves niche A's peer universe, enters niche B's.
  //    Channels in niche B that previously never saw this channel now may include it as a peer.
  const peerPoolImpact = byReason.hard_conflict.map(c => {
    const fromSize = nicheDistrib[c.current_niche] || 0;
    const toSize   = nicheDistrib[c.suggested_niche] || 0;
    return { channel: c.channel_name, from: c.current_niche, fromSize, to: c.suggested_niche, toSize };
  });

  return {
    cacheTotal,
    cacheHits,
    hardCount:  byReason.hard_conflict.length,
    rawCount:   byReason.raw_niche_mismatch.length,
    btagCount:  byReason.behavior_tag_mismatch.length,
    totalSubsAffected,
    hardSubsAffected,
    betsImpact,
    nicheDistrib,
    peerPoolImpact,
    byReason,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const dbRo = openDb(true);
const dbRw = DRY_RUN ? null : openDb(false);

console.log('');
console.log('  ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  CLASSIFICATION REPAIR PIPELINE  —  ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
if (DRY_RUN) console.log('  \x1b[33m⚠ DRY RUN — no changes will be written to the database\x1b[0m');
console.log('  ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');

// Step 1 — Scan
console.log('\n  [1/4] Scanning all enabled channels...');
let allCandidates = buildRepairCandidates(dbRo, { minSubs: MIN_SUBS });

// Filter by priority if requested
if (PRIORITY) {
  allCandidates = allCandidates.filter(c => c.repair_priority === PRIORITY);
}

const hardCandidates = allCandidates.filter(c => c.repair_reason === 'hard_conflict');
const rawCandidates  = allCandidates.filter(c => c.repair_reason === 'raw_niche_mismatch');
const btagCandidates = allCandidates.filter(c => c.repair_reason === 'behavior_tag_mismatch');

const totalEnabled = (dbRo.get('SELECT COUNT() as cnt FROM ingested_channels WHERE ingest_enabled=1', []) || {}).cnt || 0;

console.log(`  Channels scanned        : ${totalEnabled.toLocaleString()}`);
console.log(`  Total candidates found  : ${allCandidates.length.toLocaleString()}`);
console.log(`  Priority 1 HARD_CONFLICT: ${hardCandidates.length}`);
console.log(`  Priority 2 RAW_MISMATCH : ${rawCandidates.length}`);
console.log(`  Priority 3 BTAG_MISMATCH: ${btagCandidates.length}`);

// Step 2 — Write candidates to DB
if (!DRY_RUN) {
  console.log('\n  [2/4] Writing repair candidates to database...');
  ensureRepairTable(dbRw);

  const upsertCandidate = dbRw.transaction(candidates => {
    for (const c of candidates) {
      dbRw.run(
        `INSERT INTO classification_repair_candidates
           (channel_id, channel_name, current_niche, suggested_niche, confidence,
            repair_reason, repair_priority, conflict_detail, conflict_flags,
            content_archetype, format_type, channel_subscribers, impact_score, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')
         ON CONFLICT(channel_id) DO UPDATE SET
           channel_name      = excluded.channel_name,
           current_niche     = excluded.current_niche,
           suggested_niche   = excluded.suggested_niche,
           confidence        = excluded.confidence,
           repair_reason     = excluded.repair_reason,
           repair_priority   = excluded.repair_priority,
           conflict_detail   = excluded.conflict_detail,
           conflict_flags    = excluded.conflict_flags,
           content_archetype = excluded.content_archetype,
           format_type       = excluded.format_type,
           channel_subscribers = excluded.channel_subscribers,
           impact_score      = excluded.impact_score,
           status            = CASE WHEN status = 'auto_repaired' THEN 'auto_repaired' ELSE 'pending' END`,
        [
          c.channel_id, c.channel_name, c.current_niche, c.suggested_niche, c.confidence,
          c.repair_reason, c.repair_priority, c.conflict_detail, c.conflict_flags,
          c.content_archetype, c.format_type, c.channel_subscribers, c.impact_score,
        ],
      );
    }
  });

  upsertCandidate(allCandidates);
  console.log(`  Written ${allCandidates.length} candidates to classification_repair_candidates`);
} else {
  console.log('\n  [2/4] Skipped (dry run)');
}

// Step 3 — Apply repairs
console.log('\n  [3/4] Applying repairs...');
divider('·', 100);

const autoRepairResults = [];
const queueResults      = [];

for (const candidate of hardCandidates) {
  const statusLabel = '\x1b[31m[HARD]\x1b[0m';
  if (!DRY_RUN) {
    const result = repairClassificationCandidate(dbRw, candidate);
    autoRepairResults.push({ ...candidate, result });
    const mark = result.applied ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(
      `  ${mark} ${statusLabel} ${pad(candidate.channel_name, 35)}` +
      `  ${pad(candidate.current_niche, 15)} → ${pad(candidate.suggested_niche, 15)}` +
      `  ${fmtSubs(candidate.channel_subscribers)}  ${candidate.conflict_detail}`
    );
  } else {
    console.log(
      `  ~ ${statusLabel} ${pad(candidate.channel_name, 35)}` +
      `  ${pad(candidate.current_niche, 15)} → ${pad(candidate.suggested_niche, 15)}` +
      `  ${fmtSubs(candidate.channel_subscribers)}  [dry-run]`
    );
  }
}

for (const candidate of [...rawCandidates, ...btagCandidates].slice(0, 20)) {
  const priorityLabel = candidate.repair_reason === 'raw_niche_mismatch'
    ? '\x1b[33m[RAW] \x1b[0m'
    : '\x1b[36m[BTAG]\x1b[0m';
  if (!DRY_RUN) {
    const result = repairClassificationCandidate(dbRw, candidate);
    queueResults.push({ ...candidate, result });
    console.log(
      `  ⟳ ${priorityLabel} ${pad(candidate.channel_name, 35)}` +
      `  ${pad(candidate.current_niche, 15)} → ${pad(candidate.suggested_niche, 15)}` +
      `  ${fmtSubs(candidate.channel_subscribers)}  confidence degraded`
    );
  } else {
    console.log(
      `  ~ ${priorityLabel} ${pad(candidate.channel_name, 35)}` +
      `  ${pad(candidate.current_niche, 15)} → ${pad(candidate.suggested_niche, 15)}` +
      `  ${fmtSubs(candidate.channel_subscribers)}  [dry-run]`
    );
  }
}
if ([...rawCandidates, ...btagCandidates].length > 20) {
  const more = [...rawCandidates, ...btagCandidates].length - 20;
  console.log(`  \x1b[2m  ... and ${more} more queued channels (confidence degraded in DB)\x1b[0m`);
  if (!DRY_RUN) {
    for (const c of [...rawCandidates, ...btagCandidates].slice(20)) {
      repairClassificationCandidate(dbRw, c);
    }
  }
}

// Step 4 — Impact estimate
console.log('\n  [4/4] Impact estimate...');
const impact = estimateImpact(dbRo, allCandidates);

divider();
console.log('\n  IMPACT SUMMARY');
divider('·', 80);
console.log(`  Total channels repaired/queued  : ${allCandidates.length.toLocaleString()}`);
console.log(`  Auto-repaired (HARD, immediate) : ${impact.hardCount}  channels`);
console.log(`  Queued for reclassification     : ${impact.rawCount + impact.btagCount}  channels`);
console.log(`  WTP cache rows invalidated      : ${DRY_RUN ? impact.cacheHits + ' (would be)' : impact.cacheHits + ' / ' + impact.cacheTotal}`);
console.log(`  Original bets affected          : ${impact.betsImpact}  channels get new subject pool immediately`);

const totalSubs = impact.totalSubsAffected;
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n);
console.log(`  Total subscriber reach affected : ${fmt(totalSubs)} subs across all candidates`);
console.log(`    HARD repairs subscriber reach : ${fmt(impact.hardSubsAffected)} subs (immediate effect)`);

if (impact.peerPoolImpact.length > 0) {
  console.log('\n  COMMUNITY PEER POOL SHIFTS (hard repairs only)');
  divider('·', 80);
  console.log(`  ${'channel'.padEnd(35)} ${'from_niche'.padEnd(15)} ${'from_size'.padEnd(10)} → ${'to_niche'.padEnd(15)} ${'to_size'.padEnd(10)}`);
  divider('·', 80);
  for (const p of impact.peerPoolImpact) {
    console.log(
      `  ${pad(p.channel, 35)} ${pad(p.from, 15)} ${rpad(p.fromSize.toLocaleString(), 10)}   ` +
      `${pad(p.to, 15)} ${rpad(p.toSize.toLocaleString(), 10)}`
    );
  }
  console.log(`\n  \x1b[2mPeer pool shift interpretation:\x1b[0m`);
  console.log(`  \x1b[2m  "from_size" = channels the repaired channel was competing with for peers (old, wrong pool)\x1b[0m`);
  console.log(`  \x1b[2m  "to_size"   = channels in the correct new peer universe\x1b[0m`);
}

// ── Top N candidates table ────────────────────────────────────────────────────
const topN = allCandidates.slice(0, TOP);
console.log(`\n  TOP ${topN.length} REPAIR CANDIDATES  (by priority then impact score)`);
divider();
console.log(
  `  ${'#'.padEnd(4)} ${'channel'.padEnd(32)} ${'subs'.padStart(7)}  ${'reason'.padEnd(22)} ${'current'.padEnd(18)} → ${'suggested'.padEnd(18)} ${'conf'.padStart(5)}  detail`
);
divider('·', 120);

for (let i = 0; i < topN.length; i++) {
  const c = topN[i];
  const rc = reasonColor(c.repair_reason);
  const statusStr = DRY_RUN
    ? '\x1b[2m[dry]\x1b[0m'
    : c.repair_reason === 'hard_conflict'
      ? '\x1b[32m✓ repaired\x1b[0m'
      : '\x1b[33m⟳ queued\x1b[0m';
  console.log(
    `  ${rpad(i + 1, 4)} ${pad(c.channel_name, 32)} ${rpad(fmtSubs(c.channel_subscribers), 7)}` +
    `  ${rc}${pad(c.repair_reason, 22)}\x1b[0m ${pad(c.current_niche, 18)} → ${pad(c.suggested_niche, 18)}` +
    `  ${rpad(c.confidence + '%', 5)}  ${(c.conflict_detail || '').slice(0, 50)}`
  );
  if (i < 10) {
    // Show more detail for top 10
    console.log(`  ${' '.repeat(4)} \x1b[2mPriority ${c.repair_priority} | arch: ${c.content_archetype || '—'} | fmt: ${c.format_type || '—'} | ${statusStr}\x1b[0m`);
  }
}

// ── Niche change flow ─────────────────────────────────────────────────────────
console.log('\n  REPAIR FLOW BY NICHE (hard conflicts only)');
divider('·', 80);
const flowMap = {};
for (const c of hardCandidates) {
  const key = `${c.current_niche} → ${c.suggested_niche}`;
  flowMap[key] = (flowMap[key] || 0) + 1;
}
const sortedFlows = Object.entries(flowMap).sort((a, b) => b[1] - a[1]);
for (const [flow, cnt] of sortedFlows) {
  const bar = '█'.repeat(Math.min(20, cnt * 2));
  console.log(`  ${rpad(cnt, 4)}×  ${flow}  ${bar}`);
}

// ── Systematic patterns (RAW + BTAG) ─────────────────────────────────────────
console.log('\n  SYSTEMATIC MISMATCH PATTERNS');
divider('·', 80);
const patternMap = {};
for (const c of allCandidates) {
  const key = `${c.current_niche}  [${c.repair_reason}]`;
  if (!patternMap[key]) patternMap[key] = { count: 0, suggested: {} };
  patternMap[key].count++;
  patternMap[key].suggested[c.suggested_niche] = (patternMap[key].suggested[c.suggested_niche] || 0) + 1;
}
const sortedPatterns = Object.entries(patternMap).sort((a, b) => b[1].count - a[1].count).slice(0, 20);
for (const [pattern, { count, suggested }] of sortedPatterns) {
  const topSug = Object.entries(suggested).sort((a, b) => b[1] - a[1])[0];
  const color = pattern.includes('hard_conflict') ? '\x1b[31m' : pattern.includes('raw') ? '\x1b[33m' : '\x1b[36m';
  console.log(`  ${color}${rpad(count, 5)}×\x1b[0m  ${pad(pattern, 40)}  → usually: ${topSug ? topSug[0] : '?'}`);
}

// ── Recommendations ───────────────────────────────────────────────────────────
console.log(`
  WHAT HAPPENS NEXT
  ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  Auto-repaired channels (HARD conflicts):
    ✓ niche_override set  — survives future AI re-classifications
    ✓ primary_niche updated — WTP, originalBets, peer selection use this immediately
    ✓ identity_confidence = 0.45 — flags channel for human review if desired
    ✓ WTP cache invalidated — next request recomputes with correct niche

  Queued channels (RAW + BTAG conflicts):
    ✓ identity_confidence degraded — next scheduled AI re-detection will prioritise these
    ✗ primary_niche not changed yet — needs AI re-classification to confirm correct niche
    → Run channel classifier on queued channels to complete the repair

  To view pending queue:
    SELECT channel_id, channel_name, current_niche, suggested_niche, repair_reason
    FROM classification_repair_candidates
    WHERE status = 'queued'
    ORDER BY channel_subscribers DESC;

  To reclassify queued channels (requires OpenAI key):
    node server/scripts/reclassifyRepairQueue.js

  To re-run this pipeline (idempotent):
    node server/scripts/buildRepairCandidates.js
`);

divider();
if (!DRY_RUN) {
  console.log(`  Done. ${allCandidates.length} candidates written to classification_repair_candidates.`);
  console.log(`  ${hardCandidates.length} auto-repaired, ${rawCandidates.length + btagCandidates.length} queued.\n`);
} else {
  console.log(`  Dry run complete. ${allCandidates.length} candidates identified. Run without --dry-run to apply.\n`);
}

dbRo.close();
if (dbRw) dbRw.close();
