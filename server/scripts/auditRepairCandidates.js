'use strict';

/**
 * auditRepairCandidates.js
 *
 * Audits classification_repair_candidates quality using Tier 1 outcomes.
 *
 * Safety rule (corrected):
 *   topic_precision_before > 70% → do not enqueue for repair
 *
 *   Note: the confidence gate (confidence > 80%) is structurally impossible to trigger
 *   because all repair candidates were admitted with classification_confidence < 70 by
 *   buildRepairCandidates.js, and identity_confidence is capped at 0.80 for Tier 1 channels.
 *   topic_precision_before alone is the actionable filter.
 *
 * New repair_score:
 *   repair_score = signal_weight × confidence_gap × community_influence
 *   where signal_weight = signal_precision measured from Tier 1
 *
 * Usage:
 *   node server/scripts/auditRepairCandidates.js
 *   node server/scripts/auditRepairCandidates.js --tier2-sample=500
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : isNaN(v) ? v : Number(v)]; }),
);
const TIER2_SAMPLE = args['tier2-sample'] ? Math.min(2000, Number(args['tier2-sample'])) : 2000;

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => { cache.clear(); raw.close(); },
  };
}

// ── Niche cluster map ─────────────────────────────────────────────────────────
const NICHE_CLUSTER_MAP = {
  entertainment:   ['entertainment', 'comedy', 'comedy sketches'],
  comedy:          ['comedy', 'entertainment', 'comedy sketches'],
  finance:         ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  news:            ['news', 'current affairs', 'breaking news'],
  science:         ['science', 'technology', 'education'],
  technology:      ['technology', 'science', 'education'],
  education:       ['education', 'science', 'technology'],
  music:           ['music'],
  selfimprovement: ['selfimprovement', 'motivation', 'personal development'],
  motivation:      ['selfimprovement', 'motivation', 'personal development'],
  gaming:          ['gaming'],
  travel:          ['travel', 'travel vlogs'],
  food:            ['food', 'cooking', 'street food'],
  fitness:         ['fitness', 'workout', 'bodybuilding'],
  health:          ['health', 'wellness', 'nutrition'],
  lifestyle:       ['lifestyle', 'vlog', 'daily vlogs'],
  business:        ['business', 'entrepreneurship', 'startup'],
  sports:          ['sports'],
  politics:        ['politics'],
  geopolitics:     ['geopolitics'],
  defence:         ['defence'],
  yoga:            ['yoga'],
  meditation:      ['meditation'],
  beauty:          ['beauty'],
  other:           ['other'],
};
function getNicheCluster(n) { return NICHE_CLUSTER_MAP[(n || '').toLowerCase()] || [(n || '').toLowerCase()].filter(Boolean); }
function nicheMatches(pn, cn) { return !!(pn && cn && getNicheCluster(cn).includes(pn.toLowerCase())); }
function computeTP(peerMeta, niche) {
  if (!peerMeta?.length || !niche) return null;
  return peerMeta.filter(p => nicheMatches(p.primary_niche, niche)).length / peerMeta.length * 100;
}
function resolvePeerMeta(db, channelId) {
  try {
    const r = resolveCreatorPeerContext(db, channelId);
    const ids = r?.peerIds || [];
    if (!ids.length) return null;
    const ph = ids.map(() => '?').join(',');
    return db.all(`SELECT primary_niche FROM ingested_channels WHERE channel_id IN (${ph})`, ids);
  } catch (_) { return null; }
}

function avg(arr) { const v = arr.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
function med(arr) {
  const v = [...arr.filter(x => x != null)].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[m - 1] + v[m]) / 2 : v[m];
}
function pp(n)   { return n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + 'pp'; }
function pct(n)  { return n == null ? '—' : n.toFixed(1) + '%'; }
function sub(n)  { if (!n) return '—'; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1000) return (n/1000).toFixed(0)+'K'; return String(n); }
function pad(s, w)  { return String(s ?? '').padEnd(w).slice(0, w); }
function rpad(s, w) { return String(s ?? '').padStart(w).slice(-w); }

const TP_SAFETY_THRESHOLD = 70;  // tp_before > 70% → exclude from repair queue

const db = openDb();

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: Tier 1 audit
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  REPAIR CANDIDATE QUALITY AUDIT');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
console.log(`\n  Phase 1: Topic precision for all 500 Tier 1 channels...`);

const tier1 = db.all(`
  SELECT rl.channel_id, rl.channel_name, rl.old_niche, rl.new_niche,
         rl.old_confidence, rl.new_confidence, rl.niche_changed,
         crc.repair_reason, crc.confidence AS crc_confidence,
         ic.channel_subscribers
  FROM reclassification_log rl
  JOIN classification_repair_candidates crc ON crc.channel_id = rl.channel_id
  JOIN ingested_channels ic ON ic.channel_id = rl.channel_id
  WHERE rl.tier = 1
  ORDER BY ic.channel_subscribers DESC
`);

let done = 0;
for (const ch of tier1) {
  const peerMeta = resolvePeerMeta(db, ch.channel_id);
  ch.tp_before = computeTP(peerMeta, ch.old_niche);
  ch.tp_after  = ch.niche_changed === 1
    ? computeTP(peerMeta, ch.new_niche)
    : ch.tp_before;
  ch.lift = (ch.tp_before != null && ch.tp_after != null) ? ch.tp_after - ch.tp_before : null;

  // Safety rule: tp_before > 70% → this channel should not have been queued
  ch.safety_excluded = (ch.tp_before ?? 0) > TP_SAFETY_THRESHOLD;

  // Outcome
  if (ch.niche_changed === 0) {
    ch.outcome = (ch.tp_before ?? 0) > TP_SAFETY_THRESHOLD ? 'fp_no_change' : 'ok_no_change';
  } else if (ch.lift == null) {
    ch.outcome = 'no_peers';
  } else if (ch.lift > 10) {
    ch.outcome = 'improved';
  } else if (ch.lift < -10) {
    ch.outcome = 'regressed';
  } else {
    ch.outcome = 'neutral';
  }

  done++;
  if (done % 50 === 0) process.stdout.write(`\r    ${done}/${tier1.length}...`);
}
process.stdout.write(`\r    ${tier1.length}/${tier1.length} done.   \n`);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: Signal precision
// ─────────────────────────────────────────────────────────────────────────────
const sigStats = {};
for (const ch of tier1) {
  const sig = ch.repair_reason || 'unknown';
  if (!sigStats[sig]) sigStats[sig] = {
    total: 0, improved: 0, neutral: 0, regressed: 0,
    fp_no_change: 0, ok_no_change: 0, no_peers: 0,
    safety_excluded: 0, safety_correct: 0, safety_wrong: 0,
    lifts: [], tp_befores: [],
  };
  const s = sigStats[sig];
  s.total++;
  s[ch.outcome]++;
  if (ch.safety_excluded) {
    s.safety_excluded++;
    // Was the exclusion correct?
    if (ch.outcome === 'improved')               s.safety_wrong++;   // excluded a genuine improvement
    else if (ch.outcome === 'fp_no_change' || ch.outcome === 'regressed') s.safety_correct++; // correctly excluded
  }
  if (ch.lift != null) s.lifts.push(ch.lift);
  if (ch.tp_before != null) s.tp_befores.push(ch.tp_before);
}

for (const [sig, s] of Object.entries(sigStats)) {
  const measurable = s.total - s.no_peers;
  s.precision     = measurable > 0 ? s.improved / measurable : 0;
  s.fp_rate       = measurable > 0 ? (s.fp_no_change + s.regressed) / measurable : 0;
  s.signal_weight = s.precision;
  s.avg_lift      = avg(s.lifts);
  s.med_lift      = med(s.lifts);
  s.avg_tp_before = avg(s.tp_befores);
  s.safety_precision = s.safety_excluded > 0 ? s.safety_correct / s.safety_excluded : 0;
}

// Print Phase 2
console.log('\n  ── TIER 1 OUTCOMES BY SIGNAL ─────────────────────────────────────────────────────────────────\n');
console.log(`  ${'Signal'.padEnd(24)} ${'Total'.padStart(7)} ${'Improved'.padStart(10)} ${'Neutral'.padStart(9)} ${'Regressed'.padStart(11)} ${'FP(no-chg)'.padStart(12)} ${'Precision'.padStart(11)} ${'FP Rate'.padStart(9)}\n`);
const sigOrder = ['raw_niche_mismatch', 'behavior_tag_mismatch', 'hard_conflict'];
for (const sig of [...sigOrder, ...Object.keys(sigStats).filter(k => !sigOrder.includes(k))]) {
  const s = sigStats[sig];
  if (!s) continue;
  console.log(
    `  ${pad(sig, 24)} ${rpad(s.total, 7)} ${rpad(s.improved, 10)} ${rpad(s.neutral, 9)} ` +
    `${rpad(s.regressed, 11)} ${rpad(s.fp_no_change, 12)} ` +
    `${rpad(pct(s.precision * 100), 11)} ${rpad(pct(s.fp_rate * 100), 9)}`,
  );
}

console.log(`\n  ${'Signal'.padEnd(24)} ${'Avg lift'.padStart(10)} ${'Med lift'.padStart(10)} ${'Avg TP before'.padStart(15)}\n`);
for (const sig of [...sigOrder, ...Object.keys(sigStats).filter(k => !sigOrder.includes(k))]) {
  const s = sigStats[sig];
  if (!s) continue;
  console.log(`  ${pad(sig, 24)} ${rpad(pp(s.avg_lift), 10)} ${rpad(pp(s.med_lift), 10)} ${rpad(pct(s.avg_tp_before), 15)}`);
}

// Safety rule on Tier 1
const t1safetyExcl   = tier1.filter(ch => ch.safety_excluded);
const t1safetyCorr   = t1safetyExcl.filter(ch => ch.outcome === 'fp_no_change' || ch.outcome === 'regressed');
const t1safetyWrong  = t1safetyExcl.filter(ch => ch.outcome === 'improved');
const t1safetyPrec   = t1safetyExcl.length > 0 ? t1safetyCorr.length / t1safetyExcl.length : 0;

console.log(`\n  ── SAFETY RULE: topic_precision_before > ${TP_SAFETY_THRESHOLD}% ─────────────────────────────────────────────────────\n`);
console.log(`  Tier 1 channels that would be excluded: ${t1safetyExcl.length}/${tier1.length} (${(t1safetyExcl.length/tier1.length*100).toFixed(1)}%)`);
console.log(`    Correctly excluded (FP or regression): ${t1safetyCorr.length}  (${pct(t1safetyPrec*100)} of excluded)`);
console.log(`    Incorrectly excluded (was improved):   ${t1safetyWrong.length}  (false exclusion rate: ${pct(t1safetyWrong.length / Math.max(1, t1safetyExcl.length) * 100)})`);

if (t1safetyWrong.length > 0) {
  console.log(`\n  Improvements that would have been blocked by safety rule:`);
  t1safetyWrong.slice(0, 10).forEach(ch => {
    console.log(`    ${pad(ch.channel_name, 36)} ${ch.old_niche} → ${ch.new_niche}   tp_before=${pct(ch.tp_before)}  lift=${pp(ch.lift)}`);
  });
}

// Per-signal safety breakdown
console.log(`\n  Safety rule coverage by signal:`);
for (const [sig, s] of Object.entries(sigStats)) {
  console.log(`    ${pad(sig, 26)}  excluded=${s.safety_excluded}/${s.total}  correct=${s.safety_correct}  wrong=${s.safety_wrong}  safety_precision=${pct(s.safety_precision*100)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: Tier 2 queue — build, compute TP, apply safety rule
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n  Phase 3: Tier 2 queue (safety rule + signal weights)...`);

const t2all = db.all(`
  SELECT crc.channel_id, crc.channel_name, crc.current_niche, crc.suggested_niche,
         crc.repair_reason, crc.confidence, crc.repair_priority,
         ic.channel_subscribers, ic.primary_niche, ic.content_archetype, ic.identity_confidence
  FROM classification_repair_candidates crc
  JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status = 'queued'
`);

// Priority queue
const uniqueNiches = [...new Set(t2all.map(c => c.current_niche).filter(Boolean))];
const nicheSubsMap = {};
for (const niche of uniqueNiches) {
  const rows = db.all(
    `SELECT channel_subscribers FROM ingested_channels WHERE primary_niche = ? AND ingest_enabled = 1 ORDER BY channel_subscribers`,
    [niche],
  );
  nicheSubsMap[niche] = rows.map(r => r.channel_subscribers || 0);
}
function nichePercentileRank(niche, subs) {
  const arr = nicheSubsMap[niche] || [];
  if (!arr.length) return 0.5;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < subs) lo = mid + 1; else hi = mid; }
  return lo / arr.length;
}
for (const c of t2all) {
  const subs    = c.channel_subscribers || 0;
  const confGap = (100 - (c.confidence || 0)) / 100;
  const infl    = nichePercentileRank(c.current_niche, subs);
  c.community_influence = infl;
  c.priority_score = Math.log(subs + 1) * confGap * infl;
  const sw = sigStats[c.repair_reason]?.signal_weight ?? 0.5;
  c.repair_score = sw * c.priority_score;
}
t2all.sort((a, b) => b.priority_score - a.priority_score);

// Tier 2 = ranks 501-2500 of the full remaining queue
const tier2orig = t2all.slice(0, 2000);
const tier2analyse = tier2orig.slice(0, TIER2_SAMPLE);

process.stdout.write(`    Computing tp_before for ${tier2analyse.length} Tier 2 candidates`);
let t2done = 0;
for (const ch of tier2analyse) {
  const peerMeta = resolvePeerMeta(db, ch.channel_id);
  ch.tp_before      = computeTP(peerMeta, ch.current_niche);
  ch.safety_excluded = (ch.tp_before ?? 0) > TP_SAFETY_THRESHOLD;
  t2done++;
  if (t2done % 100 === 0) process.stdout.write('.');
}
// Channels beyond sample: heuristic (signal precision < 50% + no peer data → flag uncertain)
for (const ch of tier2orig.slice(TIER2_SAMPLE)) {
  ch.tp_before = null;
  ch.safety_excluded = false;  // insufficient data — keep (conservative)
}
process.stdout.write(` done.\n`);

const tier2filtered = tier2orig.filter(ch => !ch.safety_excluded);
const tier2removed  = tier2orig.filter(ch =>  ch.safety_excluded);
tier2filtered.sort((a, b) => b.repair_score - a.repair_score);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: Comparison report
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n  ── SIGNAL PRECISION SUMMARY ──────────────────────────────────────────────────────────────────\n');
const precThreshold = 0.50;
for (const [sig, s] of Object.entries(sigStats)) {
  let rec;
  if (s.precision >= 0.70)         rec = '✅  KEEP  (precision ≥ 70%)';
  else if (s.precision >= precThreshold) rec = '⚠️   KEEP with signal_weight down-ranking';
  else                              rec = '✗   DOWN-RANK (signal_weight = ' + s.precision.toFixed(2) + ')';
  const sw = s.signal_weight.toFixed(2);
  console.log(`  ${pad(sig, 26)}  precision=${pct(s.precision*100)}  fp_rate=${pct(s.fp_rate*100)}  weight=${sw}  ${rec}`);
}

console.log('\n  ── TIER 2 QUEUE COMPARISON ───────────────────────────────────────────────────────────────────\n');
const analysed = tier2analyse.length;
const highTPinAnalysed = tier2analyse.filter(ch => (ch.tp_before ?? 0) > TP_SAFETY_THRESHOLD).length;
const lowTPinAnalysed  = tier2analyse.filter(ch => ch.tp_before != null && ch.tp_before < 30).length;

console.log(`  Original Tier 2:          ${tier2orig.length.toLocaleString()} channels`);
console.log(`  Analysed (TP computed):   ${analysed.toLocaleString()} channels`);
console.log(`\n  Topic precision distribution in Tier 2 (${analysed} sampled):`);
console.log(`    Avg:     ${pct(avg(tier2analyse.map(ch => ch.tp_before).filter(v => v != null)))}`);
console.log(`    High (>70%): ${highTPinAnalysed} channels  (${(highTPinAnalysed/analysed*100).toFixed(1)}%)  → excluded by safety rule`);
console.log(`    Low (<30%):  ${lowTPinAnalysed} channels  (${(lowTPinAnalysed/analysed*100).toFixed(1)}%)  → genuine repair candidates`);

console.log(`\n  After safety rule (tp_before > ${TP_SAFETY_THRESHOLD}%):`);
console.log(`    Filtered Tier 2:    ${tier2filtered.length.toLocaleString()} channels`);
console.log(`    Removed:            ${tier2removed.length.toLocaleString()} channels (${(tier2removed.length/tier2orig.length*100).toFixed(1)}%)`);

// Estimated FP reduction
const t1FPRate = tier1.filter(ch => ch.outcome === 'fp_no_change' || ch.outcome === 'regressed').length / tier1.length;
const safetyFPCapture = t1safetyPrec;
const estFPOrig   = Math.round(tier2orig.length * t1FPRate);
const estFPRemoved = Math.round(tier2removed.length * safetyFPCapture);
const estFPFilt    = estFPOrig - estFPRemoved;
console.log(`\n  Estimated FP reduction:`);
console.log(`    Tier 1 FP+regression rate:          ${pct(t1FPRate * 100)}`);
console.log(`    Estimated FPs in original Tier 2:   ~${estFPOrig}`);
console.log(`    Estimated FPs removed by filter:    ~${estFPRemoved} (safety rule precision: ${pct(safetyFPCapture * 100)})`);
console.log(`    Estimated FPs remaining:            ~${estFPFilt}`);

// Removed by signal breakdown
const remBySig = {};
for (const ch of tier2removed) {
  const k = ch.repair_reason || 'unknown';
  if (!remBySig[k]) remBySig[k] = { n: 0, highTP: 0 };
  remBySig[k].n++;
  if ((ch.tp_before ?? 0) > 70) remBySig[k].highTP++;
}
console.log(`\n  Removed by signal:`);
for (const [sig, v] of Object.entries(remBySig)) {
  console.log(`    ${pad(sig, 26)} ${v.n} removed  (${v.highTP} with TP > ${TP_SAFETY_THRESHOLD}%)`);
}

// Top 20 removed channels
const top20Rem = tier2removed.sort((a, b) => (b.channel_subscribers||0) - (a.channel_subscribers||0)).slice(0, 20);
console.log(`\n  ── TOP 20 REMOVED CHANNELS (by subscriber count) ──────────────────────────────────────────────\n`);
console.log(`  ${rpad('#', 4)} ${pad('Channel', 34)} ${pad('Old niche → suggested', 30)} ${rpad('Subs', 8)} ${rpad('TP before', 11)} ${rpad('Signal', 24)}\n`);
top20Rem.forEach((ch, i) => {
  console.log(
    `  ${rpad(i+1, 4)}. ${pad(ch.channel_name, 34)} ${pad(`${ch.current_niche} → ${ch.suggested_niche||'?'}`, 30)} ` +
    `${rpad(sub(ch.channel_subscribers), 8)} ${rpad(pct(ch.tp_before), 11)} ${pad(ch.repair_reason||'—', 24)}`,
  );
});

// Top 20 in filtered Tier 2
console.log(`\n  ── TOP 20 REVISED TIER 2 QUEUE (by repair_score) ──────────────────────────────────────────────\n`);
console.log(`  ${rpad('#', 4)} ${pad('Channel', 34)} ${pad('Migration', 28)} ${rpad('Subs', 8)} ${rpad('TP before', 11)} ${rpad('Repair score', 13)}\n`);
tier2filtered.slice(0, 20).forEach((ch, i) => {
  console.log(
    `  ${rpad(i+1, 4)}. ${pad(ch.channel_name, 34)} ${pad(`${ch.current_niche} → ${ch.suggested_niche||'?'}`, 28)} ` +
    `${rpad(sub(ch.channel_subscribers), 8)} ${rpad(ch.tp_before != null ? pct(ch.tp_before) : '—', 11)} ` +
    `${rpad(ch.repair_score.toFixed(3), 13)}`,
  );
});

// ── Verdict ───────────────────────────────────────────────────────────────────
console.log(`\n  ── VERDICT AND NEXT STEPS ────────────────────────────────────────────────────────────────────\n`);

const recText = [];
for (const [sig, s] of Object.entries(sigStats)) {
  if (s.precision < precThreshold) {
    recText.push(`  ✗ ${sig}: precision ${pct(s.precision*100)}, FP rate ${pct(s.fp_rate*100)} — down-rank with weight=${s.signal_weight.toFixed(2)}`);
  }
}
recText.forEach(r => console.log(r));

console.log(`\n  Safety rule (tp_before > ${TP_SAFETY_THRESHOLD}%):`);
console.log(`    Removes ${tier2removed.length}/${tier2orig.length} Tier 2 channels (${(tier2removed.length/tier2orig.length*100).toFixed(1)}%)`);
console.log(`    Safety rule precision on Tier 1: ${pct(t1safetyPrec*100)}  (${t1safetyCorr.length} correct, ${t1safetyWrong.length} false exclusions)`);
if (t1safetyWrong.length === 0) {
  console.log(`    ✅ Zero false exclusions in Tier 1 — safe to apply.`);
} else {
  console.log(`    ⚠️  ${t1safetyWrong.length} false exclusions in Tier 1 — review before applying.`);
}

console.log(`\n  Recommended Tier 2 configuration:`);
console.log(`    1. Add safety check in reclassifyRepairQueue.js --tier=2:`);
console.log(`       Compute tp_before before each API call; skip if > ${TP_SAFETY_THRESHOLD}%`);
console.log(`    2. Apply signal_weight to priority_score:`);
for (const [sig, s] of Object.entries(sigStats)) {
  console.log(`       ${sig}: weight = ${s.signal_weight.toFixed(2)}`);
}
console.log(`    3. Expected Tier 2 after filter: ~${tier2filtered.length} channels`);
const sw_raw  = sigStats['raw_niche_mismatch']?.signal_weight ?? 0.5;
const sw_btag = sigStats['behavior_tag_mismatch']?.signal_weight ?? 0.5;
const avgSW   = (sw_raw + sw_btag) / 2;
const estCostFilt = tier2filtered.length * 1580 * (0.40/1e6) + tier2filtered.length * 185 * (1.60/1e6);
console.log(`    4. Estimated Tier 2 cost after filter: $${estCostFilt.toFixed(2)}`);

console.log('\n  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');
db.close();
