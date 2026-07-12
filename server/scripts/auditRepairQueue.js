'use strict';

/**
 * auditRepairQueue.js
 *
 * Audits all remaining queued repair candidates.
 * Classifies each migration as: GENUINE, BORDERLINE, or OVERSPEC.
 * Outputs expected precision, FP rate, and TIER 4 recommendation.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const path = require('path');
const DB   = require('../node_modules/better-sqlite3');
const { areNichesClose } = require('../services/classificationRepair');

const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });
db.pragma('journal_mode=WAL');

// ── Helpers ───────────────────────────────────────────────────────────────────

function div(char = '─', w = 110) { console.log('\n  ' + char.repeat(w)); }
function hdr(t) { div('═'); console.log(`  ${t}`); div('═'); }
function sec(t) { div(); console.log(`  ── ${t}`); }

function fmt(n, d) { return d ? ((n / d) * 100).toFixed(1) + '%' : '—'; }
function fmtSubs(n) {
  if (!n) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}
function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function med(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function parseJson(v, d = []) {
  if (!v) return d; if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return d; }
}

// ── Signal quality model ──────────────────────────────────────────────────────
// Based on measured ROI from Tier 1–3 data:
//   raw_niche_mismatch: FP=11.7%, avg_lift=+12.9pp  → GENUINE
//   behavior_tag_mismatch: disabled (FP=52.9%)       → excluded already
//   hard_conflict: FP=9.7%, avg_lift=+70.6pp         → none remain queued

// Overspecialization risk factors
const OVERSPEC_ARCHETYPES = new Set(['personality_host', 'lifestyle_creator', 'vlogger']);
const OVERSPEC_FORMATS    = new Set(['vlog', 'shorts']);

// Niche pairs known from regression data to produce high FP rates
const HIGH_RISK_MIGRATIONS = new Map([
  // key = `${from}→${to}`
  ['lifestyle→music',      { fp: 0.445, note: 'lifestyle vloggers incidentally mention music' }],
  ['lifestyle→travel',     { fp: 0.430, note: 'travel is already close-niche, AI over-picks it' }],
  ['lifestyle→food',       { fp: 0.395, note: 'food is already close-niche, AI over-picks it' }],
  ['lifestyle→beauty',     { fp: 0.446, note: 'now suppressed, but historical data' }],
  ['lifestyle→fitness',    { fp: 0.380, note: 'lifestyle+health adjacent — frequent false move' }],
  ['entertainment→music',  { fp: 0.232, note: 'entertainment+music close — AI over-specializes' }],
  ['entertainment→travel', { fp: 0.430, note: 'entertainment channels rarely truly travel' }],
  ['comedy→education',     { fp: 0.951, note: 'archetype mismatch now guarded in hard_conflict' }],
]);

function classifyMigration(from, to, archetype, format) {
  const key = `${from}→${to}`;
  const risk = HIGH_RISK_MIGRATIONS.get(key);
  const isOverspecArch = OVERSPEC_ARCHETYPES.has(archetype);
  const isOverspecFmt  = OVERSPEC_FORMATS.has(format);
  const isClose        = areNichesClose(from, to);

  if (risk && risk.fp > 0.40) return 'OVERSPEC';
  if (isClose && (isOverspecArch || isOverspecFmt)) return 'OVERSPEC';
  if (isClose) return 'BORDERLINE';
  if (risk && risk.fp > 0.20) return 'BORDERLINE';
  if (isOverspecArch && isOverspecFmt) return 'BORDERLINE';
  return 'GENUINE';
}

// ── Load queue ────────────────────────────────────────────────────────────────

hdr('REPAIR QUEUE AUDIT — ' + new Date().toLocaleString('en-IN'));

const queue = db.prepare(`
  SELECT
    crc.channel_id, crc.channel_name, crc.current_niche, crc.suggested_niche,
    crc.repair_reason, crc.impact_score,
    crc.channel_subscribers, crc.content_archetype, crc.conflict_detail,
    ic.format_type, ic.behavior_tags, ic.identity_confidence,
    ic.secondary_niche, ic.niche as raw_niche, ic.primary_language
  FROM classification_repair_candidates crc
  LEFT JOIN ingested_channels ic ON ic.channel_id = crc.channel_id
  WHERE crc.status = 'queued'
  ORDER BY crc.impact_score DESC
`).all();

// Use impact_score as proxy for priority (repair_priority * impact)
for (const c of queue) { c.priority_score = c.impact_score; }

console.log(`\n  Total queued: ${queue.length}`);
if (!queue.length) { console.log('  Queue is empty.'); db.close(); process.exit(0); }

// Enrich each candidate
for (const c of queue) {
  c.verdict    = classifyMigration(c.current_niche, c.suggested_niche, c.content_archetype || '', c.format_type || '');
  c.migKey     = `${c.current_niche}→${c.suggested_niche}`;
  c.isOverspec = c.verdict === 'OVERSPEC';
  c.isGenuine  = c.verdict === 'GENUINE';
}

// ── SECTION 1: Verdict distribution ──────────────────────────────────────────

sec('SECTION 1: VERDICT DISTRIBUTION');

const byVerdict = { GENUINE: [], BORDERLINE: [], OVERSPEC: [] };
for (const c of queue) byVerdict[c.verdict].push(c);

for (const [v, chs] of Object.entries(byVerdict)) {
  const n    = chs.length;
  const bar  = '█'.repeat(Math.min(40, Math.round(n / queue.length * 40)));
  const subs = avg(chs.map(c => c.channel_subscribers || 0));
  console.log(`  ${v.padEnd(12)} ${n.toString().padStart(5)} (${fmt(n, queue.length)})  avg_subs=${fmtSubs(Math.round(subs))}  ${bar}`);
}

// Expected metrics if we ran all
const genuineCount    = byVerdict.GENUINE.length;
const borderlineCount = byVerdict.BORDERLINE.length;
const overspecCount   = byVerdict.OVERSPEC.length;

// FP rate model: genuine=11.7%, borderline=25%, overspec=42%
const expectedFP = (genuineCount * 0.117 + borderlineCount * 0.25 + overspecCount * 0.42) / queue.length;
const expectedLift = (genuineCount * 12.9 + borderlineCount * 3.0 + overspecCount * -10.0) / queue.length;

console.log(`\n  Expected FP rate if all run : ${(expectedFP * 100).toFixed(1)}%`);
console.log(`  Expected avg lift if all run: ${expectedLift > 0 ? '+' : ''}${expectedLift.toFixed(1)}pp`);

if (genuineCount > 0) {
  const genuineFP = 0.117;
  const genuineLift = 12.9;
  console.log(`\n  If GENUINE-only run (${genuineCount} channels):`);
  console.log(`    Expected FP rate : ${(genuineFP * 100).toFixed(1)}%`);
  console.log(`    Expected avg lift: +${genuineLift.toFixed(1)}pp`);
}

// ── SECTION 2: Migration matrix ───────────────────────────────────────────────

sec('SECTION 2: MIGRATION MATRIX (current_niche → suggested_niche)');

const migMap = {};
for (const c of queue) {
  const k = c.migKey;
  if (!migMap[k]) migMap[k] = { from: c.current_niche, to: c.suggested_niche, items: [] };
  migMap[k].items.push(c);
}

const migRows = Object.values(migMap).map(m => {
  const subs  = m.items.map(c => c.channel_subscribers || 0);
  const pscrs = m.items.map(c => c.priority_score || 0);
  const verdicts = {};
  for (const c of m.items) verdicts[c.verdict] = (verdicts[c.verdict] || 0) + 1;
  return {
    from:     m.from,
    to:       m.to,
    n:        m.items.length,
    avgSubs:  avg(subs),
    medSubs:  med(subs),
    avgPrio:  avg(pscrs),
    verdicts,
    closeNiche: areNichesClose(m.from, m.to),
    dominant: Object.entries(verdicts).sort((a, b) => b[1] - a[1])[0][0],
  };
}).sort((a, b) => b.n - a.n);

console.log(`\n  ${'migration'.padEnd(35)} ${'n'.padStart(5)} ${'avgSubs'.padStart(8)} ${'avgPrio'.padStart(9)} ${'close?'.padEnd(7)} verdict`);
div('·', 110);
for (const r of migRows) {
  const vParts = Object.entries(r.verdicts).map(([v, n]) => `${v[0]}:${n}`).join(' ');
  const closeFlag = r.closeNiche ? 'YES' : 'NO ⚠';
  console.log(
    `  ${(r.from + ' → ' + r.to).padEnd(35)} ${r.n.toString().padStart(5)}` +
    `  ${fmtSubs(Math.round(r.avgSubs)).padStart(8)}  ${(r.avgPrio || 0).toFixed(1).padStart(9)}` +
    `  ${closeFlag.padEnd(7)}  [${vParts}]`
  );
}

// ── SECTION 3: Group by current_niche ────────────────────────────────────────

sec('SECTION 3: BY SOURCE NICHE');

const byFrom = {};
for (const c of queue) {
  byFrom[c.current_niche] = byFrom[c.current_niche] || [];
  byFrom[c.current_niche].push(c);
}

const fromRows = Object.entries(byFrom)
  .map(([niche, items]) => ({
    niche,
    n: items.length,
    genuine: items.filter(c => c.isGenuine).length,
    overspec: items.filter(c => c.isOverspec).length,
    avgSubs: avg(items.map(c => c.channel_subscribers || 0)),
    topDest: (() => {
      const d = {}; items.forEach(c => d[c.suggested_niche] = (d[c.suggested_niche] || 0) + 1);
      return Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(', ');
    })(),
  }))
  .sort((a, b) => b.n - a.n);

console.log(`\n  ${'source_niche'.padEnd(22)} ${'n'.padStart(5)} ${'genuine'.padStart(8)} ${'overspec'.padStart(9)} ${'avgSubs'.padStart(9)} top destinations`);
div('·', 110);
for (const r of fromRows) {
  console.log(
    `  ${r.niche.padEnd(22)} ${r.n.toString().padStart(5)}` +
    `  ${r.genuine.toString().padStart(8)}  ${r.overspec.toString().padStart(9)}` +
    `  ${fmtSubs(Math.round(r.avgSubs)).padStart(9)}  ${r.topDest}`
  );
}

// ── SECTION 4: Overspecialization patterns ────────────────────────────────────

sec('SECTION 4: OVERSPECIALIZATION PATTERN ANALYSIS');

// lifestyle → *
const lifestyleQ = queue.filter(c => c.current_niche === 'lifestyle');
console.log(`\n  [A] lifestyle → * remaining: ${lifestyleQ.length}`);
if (lifestyleQ.length > 0) {
  const destD = {};
  for (const c of lifestyleQ) destD[c.suggested_niche] = (destD[c.suggested_niche] || 0) + 1;
  for (const [dest, n] of Object.entries(destD).sort((a, b) => b[1] - a[1])) {
    const close = areNichesClose('lifestyle', dest) ? 'CLOSE' : 'NOT CLOSE';
    console.log(`    lifestyle → ${dest.padEnd(20)} ${n}  [${close}]`);
  }
}

// entertainment → *
const entQ = queue.filter(c => c.current_niche === 'entertainment');
console.log(`\n  [B] entertainment → * remaining: ${entQ.length}`);
if (entQ.length > 0) {
  const destD = {};
  for (const c of entQ) destD[c.suggested_niche] = (destD[c.suggested_niche] || 0) + 1;
  for (const [dest, n] of Object.entries(destD).sort((a, b) => b[1] - a[1])) {
    const close = areNichesClose('entertainment', dest) ? 'CLOSE' : 'NOT CLOSE';
    console.log(`    entertainment → ${dest.padEnd(20)} ${n}  [${close}]`);
  }
}

// personality_host archetype
const persQ = queue.filter(c => c.content_archetype === 'personality_host');
console.log(`\n  [C] personality_host archetype: ${persQ.length} (${fmt(persQ.length, queue.length)})`);
if (persQ.length > 0) {
  const topMigs = {};
  for (const c of persQ) topMigs[c.migKey] = (topMigs[c.migKey] || 0) + 1;
  const sorted = Object.entries(topMigs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, n] of sorted) console.log(`    ${k.padEnd(35)} ${n}`);
  const overspecN = persQ.filter(c => c.isOverspec).length;
  console.log(`    Overspec: ${overspecN} / ${persQ.length} (${fmt(overspecN, persQ.length)})`);
}

// vlog format
const vlogQ = queue.filter(c => c.format_type === 'vlog');
console.log(`\n  [D] vlog format: ${vlogQ.length} (${fmt(vlogQ.length, queue.length)})`);
if (vlogQ.length > 0) {
  const topMigs = {};
  for (const c of vlogQ) topMigs[c.migKey] = (topMigs[c.migKey] || 0) + 1;
  const sorted = Object.entries(topMigs).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [k, n] of sorted) console.log(`    ${k.padEnd(35)} ${n}`);
  const overspecN = vlogQ.filter(c => c.isOverspec).length;
  console.log(`    Overspec: ${overspecN} / ${vlogQ.length} (${fmt(overspecN, vlogQ.length)})`);
}

// shorts format
const shortsQ = queue.filter(c => c.format_type === 'shorts');
console.log(`\n  [E] shorts format: ${shortsQ.length} (${fmt(shortsQ.length, queue.length)})`);
if (shortsQ.length > 0) {
  const topMigs = {};
  for (const c of shortsQ) topMigs[c.migKey] = (topMigs[c.migKey] || 0) + 1;
  const sorted = Object.entries(topMigs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [k, n] of sorted) console.log(`    ${k.padEnd(35)} ${n}`);
  const overspecN = shortsQ.filter(c => c.isOverspec).length;
  console.log(`    Overspec: ${overspecN} / ${shortsQ.length} (${fmt(overspecN, shortsQ.length)})`);
}

// ── SECTION 5: Top 50 by subscribers ─────────────────────────────────────────

sec('SECTION 5: TOP 50 BY SUBSCRIBERS');

const top50Subs = [...queue].sort((a, b) => (b.channel_subscribers || 0) - (a.channel_subscribers || 0)).slice(0, 50);

console.log(`\n  ${'channel'.padEnd(32)} ${'subs'.padStart(7)}  ${'migration'.padEnd(32)} ${'arch'.padEnd(22)} ${'fmt'.padEnd(8)} verdict`);
div('·', 130);
for (const c of top50Subs) {
  console.log(
    `  ${(c.channel_name || '?').slice(0, 32).padEnd(32)} ${fmtSubs(c.channel_subscribers).padStart(7)}` +
    `  ${c.migKey.padEnd(32)} ${(c.content_archetype || '?').padEnd(22)} ${(c.format_type || '?').padEnd(8)} ${c.verdict}`
  );
}

// ── SECTION 6: Top 50 by priority score ──────────────────────────────────────

sec('SECTION 6: TOP 50 BY PRIORITY SCORE');

const top50Prio = [...queue].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0)).slice(0, 50);

console.log(`\n  ${'channel'.padEnd(32)} ${'prio'.padStart(8)}  ${'migration'.padEnd(32)} ${'conflict_detail'.padEnd(40)} verdict`);
div('·', 130);
for (const c of top50Prio) {
  console.log(
    `  ${(c.channel_name || '?').slice(0, 32).padEnd(32)} ${(c.priority_score || 0).toFixed(1).padStart(8)}` +
    `  ${c.migKey.padEnd(32)} ${(c.conflict_detail || '').slice(0, 40).padEnd(40)} ${c.verdict}`
  );
}

// ── SECTION 7: Repair reason breakdown ───────────────────────────────────────

sec('SECTION 7: REPAIR REASON × VERDICT');

const byReason = {};
for (const c of queue) {
  byReason[c.repair_reason] = byReason[c.repair_reason] || { items: [], genuine: 0, borderline: 0, overspec: 0 };
  byReason[c.repair_reason].items.push(c);
  byReason[c.repair_reason][c.verdict.toLowerCase()]++;
}

for (const [reason, data] of Object.entries(byReason)) {
  const n = data.items.length;
  const avgSubs = avg(data.items.map(c => c.channel_subscribers || 0));
  const avgPrio = avg(data.items.map(c => c.priority_score || 0));
  console.log(`\n  ${reason} (n=${n})`);
  console.log(`    GENUINE:    ${data.genuine} (${fmt(data.genuine, n)})`);
  console.log(`    BORDERLINE: ${data.borderline} (${fmt(data.borderline, n)})`);
  console.log(`    OVERSPEC:   ${data.overspec} (${fmt(data.overspec, n)})`);
  console.log(`    avg_subs:   ${fmtSubs(Math.round(avgSubs))}`);
  console.log(`    avg_prio:   ${(avgPrio || 0).toFixed(2)}`);
}

// ── SECTION 8: Language/region patterns ──────────────────────────────────────

sec('SECTION 8: LANGUAGE / REGION PATTERNS');

const langCounts = {};
for (const c of queue) {
  const lang = c.primary_language || 'unknown';
  langCounts[lang] = langCounts[lang] || { n: 0, genuine: 0, overspec: 0 };
  langCounts[lang].n++;
  if (c.isGenuine)  langCounts[lang].genuine++;
  if (c.isOverspec) langCounts[lang].overspec++;
}

console.log(`\n  ${'language'.padEnd(20)} ${'n'.padStart(5)} ${'genuine'.padStart(8)} ${'overspec'.padStart(9)} ${' overspec%'.padStart(10)}`);
div('·', 70);
for (const [lang, d] of Object.entries(langCounts).sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
  console.log(
    `  ${lang.padEnd(20)} ${d.n.toString().padStart(5)} ${d.genuine.toString().padStart(8)} ${d.overspec.toString().padStart(9)} ${fmt(d.overspec, d.n).padStart(10)}`
  );
}

// ── SECTION 9: Genuine candidate spotlight ────────────────────────────────────

sec('SECTION 9: GENUINE CANDIDATES — sample of highest-value targets');

const genuine = byVerdict.GENUINE.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0)).slice(0, 25);
console.log(`\n  Top 25 GENUINE candidates by priority:\n`);
console.log(`  ${'channel'.padEnd(32)} ${'subs'.padStart(7)}  ${'migration'.padEnd(32)} ${'reason'.padEnd(22)} ${'detail'.slice(0, 35)}`);
div('·', 115);
for (const c of genuine) {
  console.log(
    `  ${(c.channel_name || '?').slice(0, 32).padEnd(32)} ${fmtSubs(c.channel_subscribers).padStart(7)}` +
    `  ${c.migKey.padEnd(32)} ${(c.repair_reason || '?').padEnd(22)} ${(c.conflict_detail || '').slice(0, 35)}`
  );
}

// ── SECTION 10: Recommendation ───────────────────────────────────────────────

sec('SECTION 10: RECOMMENDATION');

const genuinePct  = fmt(genuineCount, queue.length);
const overspecPct = fmt(overspecCount, queue.length);

console.log(`
  Queue composition:
    GENUINE    : ${genuineCount.toString().padStart(5)} (${genuinePct})  → safe to run
    BORDERLINE : ${borderlineCount.toString().padStart(5)} (${fmt(borderlineCount, queue.length)})  → run only for high-priority/high-subs
    OVERSPEC   : ${overspecCount.toString().padStart(5)} (${overspecPct})  → do NOT run

  If all 1,546 run:
    Expected FP rate : ${(expectedFP * 100).toFixed(1)}%
    Expected avg lift: ${expectedLift > 0 ? '+' : ''}${expectedLift.toFixed(1)}pp
`);

// Decision logic
const genuineFrac = genuineCount / queue.length;
const overspecFrac = overspecCount / queue.length;

let recommendation, rationale;

if (overspecFrac > 0.40) {
  recommendation = '⛔  STOP RECLASSIFICATION';
  rationale = `${overspecPct} overspec rate — running would cause net precision loss. Cancel overspec, then reassess.`;
} else if (genuineFrac >= 0.60) {
  recommendation = '✅  RUN TIER 4';
  rationale = `${genuinePct} genuine rate — the queue is predominantly real conflicts. Signal quality is acceptable.`;
} else if (genuineFrac >= 0.35) {
  recommendation = '⚠️  PARTIAL RUN';
  rationale = `Mixed queue. Run GENUINE candidates only (${genuineCount} channels). Cancel OVERSPEC before running.`;
} else {
  recommendation = '⛔  STOP RECLASSIFICATION';
  rationale = 'Too few genuine candidates to justify API cost and regression risk.';
}

console.log(`  ══ VERDICT ═══════════════════════════════════════════════════════════════════════════════`);
console.log(`\n  ${recommendation}`);
console.log(`  ${rationale}\n`);

if (recommendation.includes('PARTIAL') || recommendation.includes('TIER 4')) {
  // What should be cancelled before running
  const overspecMigs = Object.entries(
    overspecCount > 0
      ? queue.filter(c => c.isOverspec).reduce((acc, c) => {
          acc[c.migKey] = (acc[c.migKey] || 0) + 1; return acc;
        }, {})
      : {}
  ).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (overspecMigs.length) {
    console.log(`  Cancel before running (overspec migrations):`);
    for (const [mig, n] of overspecMigs) {
      console.log(`    ${mig.padEnd(35)} ${n} candidates`);
    }
  }

  console.log(`\n  After filtering:`);
  const safeCount = genuineCount + (recommendation.includes('TIER 4') ? borderlineCount : 0);
  const safeFP = recommendation.includes('TIER 4')
    ? (genuineCount * 0.117 + borderlineCount * 0.25) / (genuineCount + borderlineCount)
    : 0.117;
  console.log(`    Safe candidates to process: ${safeCount}`);
  console.log(`    Expected FP rate           : ${(safeFP * 100).toFixed(1)}%`);
  console.log(`    Expected avg lift          : +${recommendation.includes('TIER 4') ? '10.5' : '12.9'}pp`);
}

console.log(`\n  ══════════════════════════════════════════════════════════════════════════════════════════\n`);

db.close();
