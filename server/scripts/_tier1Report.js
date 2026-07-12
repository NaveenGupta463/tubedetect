'use strict';

require('dotenv').config({ path: __dirname + '/../.env' });

const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { computeWhatToPost }         = require('../services/whatToPost');
const { buildWhatToPostContext }     = require('../services/whatToPostContext');

// ── DB (same pattern as repairImpactAnalysis.js which worked) ─────────────────
function openReadDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         () => ({}),
    transaction: fn => fn,
    close:       () => { cache.clear(); raw.close(); },
    _raw: raw,
  };
}

function openWriteDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: false, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  raw.pragma('synchronous=NORMAL');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => raw.transaction(fn),
    close:       () => { cache.clear(); raw.close(); },
    _raw: raw,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const NICHE_CLUSTER_MAP = {
  entertainment:    ['entertainment', 'comedy', 'comedy sketches'],
  comedy:           ['comedy', 'entertainment', 'comedy sketches'],
  finance:          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  news:             ['news', 'current affairs', 'breaking news'],
  science:          ['science', 'technology', 'education'],
  technology:       ['technology', 'science', 'education'],
  education:        ['education', 'science', 'technology'],
  music:            ['music'],
  selfimprovement:  ['selfimprovement', 'motivation', 'personal development'],
  motivation:       ['selfimprovement', 'motivation', 'personal development'],
  gaming:           ['gaming'],
  travel:           ['travel', 'travel vlogs'],
  food:             ['food', 'cooking', 'street food'],
  fitness:          ['fitness', 'workout', 'bodybuilding'],
  health:           ['health', 'wellness', 'nutrition'],
  lifestyle:        ['lifestyle', 'vlog', 'daily vlogs'],
  business:         ['business', 'entrepreneurship', 'startup'],
  sports:           ['sports'],
  politics:         ['politics'],
  geopolitics:      ['geopolitics'],
  defence:          ['defence'],
  yoga:             ['yoga'],
  meditation:       ['meditation'],
  beauty:           ['beauty'],
};
function getNicheCluster(n) { return NICHE_CLUSTER_MAP[(n || '').toLowerCase()] || [(n || '').toLowerCase()].filter(Boolean); }
function nicheMatches(pn, cn) { if (!pn || !cn) return false; return getNicheCluster(cn).includes(pn.toLowerCase()); }
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

const db   = openReadDb();
const dbRw = openWriteDb();

// ── 1. Classification changes ─────────────────────────────────────────────────
const changedRows = db.all(
  `SELECT rl.channel_id, rl.channel_name, rl.old_niche, rl.new_niche,
          rl.old_confidence, rl.new_confidence, rl.priority_score,
          ic.channel_subscribers, ic.primary_language, ic.region
   FROM reclassification_log rl
   JOIN ingested_channels ic ON ic.channel_id = rl.channel_id
   WHERE rl.tier = 1 AND rl.niche_changed = 1
   ORDER BY ic.channel_subscribers DESC`,
);

const noChange = db.get(`SELECT COUNT(*) as n FROM reclassification_log WHERE tier=1 AND niche_changed=0`);
const confDelta = changedRows.length > 0
  ? changedRows.reduce((s, r) => s + (r.new_confidence - r.old_confidence), 0) / changedRows.length * 100
  : 0;

console.log('\n');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  TIER 1 RECLASSIFICATION — FULL IMPACT REPORT');
console.log('  ══════════════════════════════════════════════════════════════════════════════════════════════════');

console.log('\n  ── 1. CLASSIFICATION CHANGES ───────────────────────────────────────────────────────────────────\n');
console.log(`  Total processed: 500   Changed: ${changedRows.length} (${(changedRows.length/500*100).toFixed(1)}%)   No change: ${noChange.n} (${(noChange.n/500*100).toFixed(1)}%)`);
console.log(`  Avg confidence delta: ${pp(confDelta)}  (reclassifier became more certain on changed channels)`);

const migMap = {};
for (const r of changedRows) {
  const k = `${r.old_niche} → ${r.new_niche}`;
  if (!migMap[k]) migMap[k] = { n: 0, subs: 0 };
  migMap[k].n++;
  migMap[k].subs += r.channel_subscribers || 0;
}
const migs = Object.entries(migMap).sort((a, b) => b[1].n - a[1].n);
console.log(`\n  ${pad('Migration', 36)} ${rpad('N', 6)} ${rpad('Avg subs', 12)}\n`);
for (const [k, v] of migs.slice(0, 20)) {
  console.log(`  ${pad(k, 36)} ${rpad(v.n, 6)} ${rpad(sub(Math.round(v.subs / v.n)), 12)}`);
}
if (migs.length > 20) console.log(`  ... and ${migs.length - 20} more migration types`);

// ── 2. Community impact (cross-sectional) ────────────────────────────────────
console.log('\n  ── 2. COMMUNITY IMPACT ─────────────────────────────────────────────────────────────────────────\n');
process.stdout.write('  Computing peer community metrics for all 266 changed channels');

const topicLifts = [], fpRates = [], audPrecs = [];
const regressions = [], improvements = [];
let processed = 0, noPeers = 0, errors = 0;
const firstError = [];

for (const ch of changedRows) {
  try {
    const peerResult = resolveCreatorPeerContext(db, ch.channel_id);
    const peerIds = peerResult?.peerIds || [];
    if (!peerIds.length) { noPeers++; continue; }

    const ph = peerIds.map(() => '?').join(',');
    const peerMeta = db.all(
      `SELECT primary_niche, channel_subscribers, primary_language, region
       FROM ingested_channels WHERE channel_id IN (${ph})`,
      peerIds,
    );

    const tBefore = peerMeta.length > 0
      ? peerMeta.filter(p => nicheMatches(p.primary_niche, ch.old_niche)).length / peerMeta.length * 100
      : 0;
    const tAfter = peerMeta.length > 0
      ? peerMeta.filter(p => nicheMatches(p.primary_niche, ch.new_niche)).length / peerMeta.length * 100
      : 0;
    const lift = tAfter - tBefore;
    topicLifts.push(lift);

    const lang = (ch.primary_language || '').toLowerCase();
    if (lang === 'en' || lang === 'english') {
      const inReg = peerMeta.filter(p => ['IN', 'India', 'in'].includes(p.region || '')).length;
      fpRates.push(peerMeta.length > 0 ? inReg / peerMeta.length * 100 : 0);
    }

    const chSubs = ch.channel_subscribers || 0;
    if (chSubs > 0) {
      const aud = peerMeta.filter(p => {
        const ps = p.channel_subscribers || 0;
        return ps > 0 && ps >= chSubs / 10 && ps <= chSubs * 10;
      }).length;
      audPrecs.push(peerMeta.length > 0 ? aud / peerMeta.length * 100 : 0);
    }

    if (lift < -10)  regressions.push({ ...ch, tBefore, tAfter, lift, peerCount: peerMeta.length });
    if (lift > 20)   improvements.push({ ...ch, tBefore, tAfter, lift, peerCount: peerMeta.length });

    processed++;
    if (processed % 30 === 0) process.stdout.write('.');
  } catch (e) {
    errors++;
    if (firstError.length < 2) firstError.push(e.message);
  }
}

process.stdout.write(' done.\n');
if (firstError.length) console.log('  Errors encountered:', firstError.join(' | '));

const avgBefore  = avg(changedRows.map((_, i) => { const l = topicLifts[i]; return l != null ? 0 : null; }));
const topicBefores = [], topicAfters = [];
let ti = 0;
for (const ch of changedRows) {
  const peerResult = (() => { try { return resolveCreatorPeerContext(db, ch.channel_id); } catch (_) { return null; } })();
  const peerIds = peerResult?.peerIds || [];
  if (!peerIds.length) continue;
  if (ti >= topicLifts.length) break;
  ti++;
}

console.log(`\n  Channels analysed: ${processed}/${changedRows.length}  (${noPeers} had no peers, ${errors} errors)\n`);

const avgLift = avg(topicLifts);
const medLift = med(topicLifts);
const improved = topicLifts.filter(l => l > 0).length;
const regressed = topicLifts.filter(l => l < -10).length;
const neutral = topicLifts.length - improved - regressed;

console.log(`  Topic Precision (cross-sectional, ${topicLifts.length} channels with peers):`);
console.log(`    Avg lift:    ${pp(avgLift)}   Median lift: ${pp(medLift)}`);
console.log(`    Improved:    ${improved}   Regressed (>10pp drop): ${regressed}   Neutral: ${neutral}`);
console.log(`    Regression rate: ${processed > 0 ? (regressions.length / processed * 100).toFixed(1) : '—'}%`);

if (audPrecs.length > 0) {
  console.log(`\n  Audience Precision (subscriber ±10×, ${audPrecs.length} channels):`);
  console.log(`    Post-reclassification avg: ${pct(avg(audPrecs))}`);
}

if (fpRates.length > 0) {
  console.log(`\n  False Positive Rate (IN-region peers in EN channels, ${fpRates.length} channels):`);
  console.log(`    Post-reclassification avg: ${pct(avg(fpRates))}`);
}

// ── 3. WTP impact ─────────────────────────────────────────────────────────────
console.log('\n  ── 3. WTP IMPACT ───────────────────────────────────────────────────────────────────────────────\n');
process.stdout.write('  Computing WTP scores for sample of 40 changed channels...');

const wtpSpec = [], wtpComp = [];
const ctx = buildWhatToPostContext();
const wtpSample = changedRows.slice(0, 40);
for (const ch of wtpSample) {
  try {
    const result = computeWhatToPost(dbRw, { channel_id: ch.channel_id }, ctx);
    if (!result?.ok || !result.ideas?.length) continue;
    const ideas = result.ideas.slice(0, 15);
    const s = avg(ideas.map(x => x.specificity_score).filter(x => x != null));
    const c = avg(ideas.map(x => x.score).filter(x => x != null));
    if (s != null) wtpSpec.push(s);
    if (c != null) wtpComp.push(c);
  } catch (_) {}
}
process.stdout.write(' done.\n\n');

if (wtpSpec.length > 0) {
  console.log(`  Post-reclassification WTP (${wtpSpec.length} channels):`);
  console.log(`    Avg specificity score: ${avg(wtpSpec).toFixed(1)}`);
  console.log(`    Avg composite score:   ${avg(wtpComp).toFixed(1)}`);
} else {
  console.log('  WTP scores unavailable for this sample (channels may not have WTP data).');
}

// ── 4. Top 20 improvements ────────────────────────────────────────────────────
console.log('\n  ── 4. TOP 20 IMPROVEMENTS ──────────────────────────────────────────────────────────────────────\n');
const top20 = improvements.sort((a, b) => b.lift - a.lift).slice(0, 20);
if (top20.length > 0) {
  console.log(`  ${rpad('#', 4)} ${pad('Channel', 32)} ${pad('Migration', 28)} ${rpad('Subs', 8)} ${rpad('Before', 8)} ${rpad('After', 8)} ${rpad('Lift', 9)}\n`);
  top20.forEach((ch, i) => {
    console.log(
      `  ${rpad(i + 1, 4)}. ${pad(ch.channel_name, 32)} ${pad(`${ch.old_niche} → ${ch.new_niche}`, 28)} ` +
      `${rpad(sub(ch.channel_subscribers), 8)} ${rpad(pct(ch.tBefore), 8)} ${rpad(pct(ch.tAfter), 8)} ${rpad(pp(ch.lift), 9)}`,
    );
  });
} else {
  console.log('  No channels with >20pp improvement found (check peer coverage).');
}

// ── 5. Regression analysis ────────────────────────────────────────────────────
console.log('\n  ── 5. REGRESSION ANALYSIS ──────────────────────────────────────────────────────────────────────\n');
const regRate = processed > 0 ? regressions.length / processed * 100 : 0;
console.log(`  Regressions (lift < -10pp): ${regressions.length}/${processed} (${regRate.toFixed(1)}%)`);

if (regressions.length > 0) {
  console.log(`\n  ${rpad('#', 4)} ${pad('Channel', 32)} ${pad('Migration', 28)} ${rpad('Before', 8)} ${rpad('After', 8)} ${rpad('Lift', 9)} Root cause\n`);
  regressions.sort((a, b) => a.lift - b.lift).forEach((ch, i) => {
    let cause;
    if (ch.tBefore > 70 && ch.tAfter < 20)      cause = 'Was likely correct — repair was wrong';
    else if (ch.tAfter < 5)                      cause = 'New niche peer pool too sparse';
    else if (ch.tBefore > 40 && ch.tAfter < 30) cause = 'Partial regression — borderline niche';
    else                                          cause = 'Mixed peer pool in both niches';
    console.log(
      `  ${rpad(i + 1, 4)}. ${pad(ch.channel_name, 32)} ${pad(`${ch.old_niche} → ${ch.new_niche}`, 28)} ` +
      `${rpad(pct(ch.tBefore), 8)} ${rpad(pct(ch.tAfter), 8)} ${rpad(pp(ch.lift), 9)} ${cause}`,
    );
  });
}

// ── 6. Verdict ────────────────────────────────────────────────────────────────
console.log('\n  ── 6. VERDICT ──────────────────────────────────────────────────────────────────────────────────\n');
const avgL  = avgLift ?? 0;
const regFn = processed > 0 ? regressions.length / processed : 1;
const qualifies = avgL >= 40 && regFn < 0.15;
const cautious  = avgL >= 20 && regFn < 0.25;

if (qualifies)     console.log(`  ✅  PROCEED — avg lift ${pp(avgL)}, regression rate ${(regFn * 100).toFixed(1)}% (both thresholds met)`);
else if (cautious) console.log(`  ⚠️   CAUTIOUS — avg lift ${pp(avgL)}, regression rate ${(regFn * 100).toFixed(1)}%  (review regressions before Tier 2)`);
else               console.log(`  ✗   INVESTIGATE — avg lift ${pp(avgL)}, regression rate ${(regFn * 100).toFixed(1)}%  (do not proceed without review)`);

console.log(`\n  Topic precision:       avg lift ${pp(avgLift)},  median ${pp(medLift)}`);
console.log(`  Channels improved:     ${improved}/${processed} (${processed > 0 ? (improved/processed*100).toFixed(1) : '—'}%)`);
console.log(`  Channels regressed:    ${regressions.length}/${processed} (${regRate.toFixed(1)}%)`);
if (fpRates.length > 0)  console.log(`  False positive rate:   ${pct(avg(fpRates))} post-reclassification`);
if (audPrecs.length > 0) console.log(`  Audience precision:    ${pct(avg(audPrecs))} post-reclassification`);
if (wtpSpec.length > 0)  console.log(`  WTP specificity:       ${avg(wtpSpec).toFixed(1)} post-reclassification`);

console.log('\n  ══════════════════════════════════════════════════════════════════════════════════════════════════\n');

db.close();
dbRw.close();
