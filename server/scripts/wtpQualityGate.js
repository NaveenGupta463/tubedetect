'use strict';

// WTP Quality Gate — run benchmark, save snapshot, compare, detect regressions.
//
// Snapshots are stored in:  source/server/data/wtp-snapshots/
//
// Usage:
//   node server/scripts/wtpQualityGate.js
//   node server/scripts/wtpQualityGate.js --channels=8 --top=20
//   node server/scripts/wtpQualityGate.js --save
//   node server/scripts/wtpQualityGate.js --save --compare --fail-on-regression
//   node server/scripts/wtpQualityGate.js --compare --baseline=2026-06-12T10-30-00-000Z.json
//   node server/scripts/wtpQualityGate.js --category=Finance
//
// Exit codes:
//   0  — pass (no regression, or --fail-on-regression not set)
//   1  — regression detected (only when --fail-on-regression is set)
//   2  — benchmark could not run (no DB data)

require('dotenv').config({ path: __dirname + '/../.env' });

const fs   = require('fs');
const path = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const { runBenchmark } = require('./wtpBenchmarkRunner');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const CHANNELS_PER_CAT   = Math.max(2, Math.min(20, Number(args.channels) || 5));
const TOP_N              = Math.max(5, Math.min(50, Number(args.top) || 20));
const SAVE               = !!args.save;
const DO_COMPARE         = !!args.compare || !!args.baseline;
const FAIL_ON_REGRESSION = !!args['fail-on-regression'];
const CAT_FILTER         = args.category ? String(args.category).toLowerCase() : null;
const BASELINE_FILE      = args.baseline ? String(args.baseline) : null;

const SNAPSHOTS_DIR = path.resolve(__dirname, '../data/wtp-snapshots');

// ── Regression thresholds ─────────────────────────────────────────────────────
// Tuned to catch real engine regressions while tolerating sampling variance
// (channels are randomly selected, so ±2-3 pts is normal noise on a 5-channel run).
const THRESHOLDS = {
  overallDrop:     3,   // overall composite falls more than 3 pts
  specificityDrop: 5,   // avg specificity falls more than 5 pts
  genericRise:     5,   // generic rate rises more than 5 percentage points
  categoryDrop:    8,   // any single category composite falls more than 8 pts
};

// ── DB ────────────────────────────────────────────────────────────────────────
function openReadonlyDb() {
  const raw = new BetterSqlite3(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('query_only = ON');
  raw.pragma('busy_timeout = 60000');
  const stmtCache = new Map();
  const stmt = sql => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all:   (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:   (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:   ()            => ({ changes: 0 }),
    exec:  ()            => undefined,
    close: ()            => { stmtCache.clear(); raw.close(); },
  };
}

// ── Snapshot I/O ──────────────────────────────────────────────────────────────
function saveSnapshot(result) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const id   = result.runAt.replace(/[:.]/g, '-');
  const file = path.join(SNAPSHOTS_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  return file;
}

function loadLatestSnapshot() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return null;
  const files = fs.readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, files[0]), 'utf8')); }
  catch (_) { return null; }
}

function loadSnapshotByName(filename) {
  const p = path.isAbsolute(filename) ? filename : path.join(SNAPSHOTS_DIR, filename);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Regression detection ──────────────────────────────────────────────────────
function detectRegressions(current, baseline) {
  const regressions = [];

  const overallDrop = baseline.overall.composite - current.overall.composite;
  if (overallDrop > THRESHOLDS.overallDrop) {
    regressions.push({
      metric:    'overall_composite',
      baseline:  baseline.overall.composite,
      current:   current.overall.composite,
      delta:     current.overall.composite - baseline.overall.composite,
      threshold: THRESHOLDS.overallDrop,
    });
  }

  const specDrop = baseline.overall.specificity - current.overall.specificity;
  if (specDrop > THRESHOLDS.specificityDrop) {
    regressions.push({
      metric:    'overall_specificity',
      baseline:  baseline.overall.specificity,
      current:   current.overall.specificity,
      delta:     current.overall.specificity - baseline.overall.specificity,
      threshold: THRESHOLDS.specificityDrop,
    });
  }

  const genericRise = current.overall.genericRate - baseline.overall.genericRate;
  if (genericRise > THRESHOLDS.genericRise) {
    regressions.push({
      metric:    'generic_rate',
      baseline:  baseline.overall.genericRate,
      current:   current.overall.genericRate,
      delta:     genericRise,
      threshold: THRESHOLDS.genericRise,
    });
  }

  for (const [cat, scores] of Object.entries(current.categories)) {
    const base = baseline.categories?.[cat];
    if (!base) continue;
    const catDrop = base.composite - scores.composite;
    if (catDrop > THRESHOLDS.categoryDrop) {
      regressions.push({
        metric:    `category_${cat.toLowerCase()}`,
        baseline:  base.composite,
        current:   scores.composite,
        delta:     scores.composite - base.composite,
        threshold: THRESHOLDS.categoryDrop,
      });
    }
  }

  return regressions;
}

// ── Display helpers ───────────────────────────────────────────────────────────
function bar(score, width = 20) {
  const filled = Math.min(width, Math.round((score / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
function grade(s)      { return s >= 70 ? '✓' : s >= 50 ? '●' : '✗'; }
function rateGrade(p)  { return p <=  5 ? '✓' : p <= 15 ? '●' : '✗'; }

function fmtDelta(d, invert = false, unit = '') {
  if (d === 0) return '   =';
  const effective = invert ? -d : d;
  const sign = effective > 0 ? '+' : '';
  const arrow = effective > 0 ? '▲' : '▼';
  return `${arrow}${sign}${d}${unit}`;
}

// ── Category block printer ────────────────────────────────────────────────────
function printCategoryBlock(name, s, baseline_cat) {
  const b = baseline_cat;
  const D = b
    ? (field, inv = false, unit = '') => `  ${fmtDelta(s[field] - b[field], inv, unit)}`
    : () => '';

  console.log(`  ┌─ ${name.toUpperCase().padEnd(14)}  ${s.composite}/100  ${grade(s.composite)}${b ? `  (was ${b.composite})` : ''}`);
  console.log(`  │  Specificity      ${String(s.specificity).padStart(3)}/100  ${bar(s.specificity)}  ${grade(s.specificity)}${D('specificity')}`);
  console.log(`  │  Evidence         ${String(s.evidence).padStart(3)}/100  ${bar(s.evidence)}  ${grade(s.evidence)}${D('evidence')}`);
  console.log(`  │  Personalization  ${String(s.personalization).padStart(3)}/100  ${bar(s.personalization)}  ${grade(s.personalization)}${D('personalization')}`);
  console.log(`  │  Generic rate      ${String(s.genericRate).padStart(2)}%        ${rateGrade(s.genericRate)}${D('genericRate', true, '%')}`);
  console.log(`  │  Fallback rate     ${String(s.fallbackRate).padStart(2)}%        ${rateGrade(s.fallbackRate)}${D('fallbackRate', true, '%')}`);
  console.log(`  │  Duplicate rate    ${String(s.duplicateRate).padStart(2)}%        ${rateGrade(s.duplicateRate)}${D('duplicateRate', true, '%')}`);
  console.log(`  │  Diversity        ${String(s.diversity).padStart(3)}/100  ${bar(s.diversity)}  ${grade(s.diversity)}${D('diversity')}`);
  console.log(`  │  Avg phrase words  ${String(s.avgWords).padStart(3)}       (bigrams:${s.bigramPct}%  4+words:${s.longPct}%)`);
  console.log(`  └${'─'.repeat(64)}`);
}

// ── Comparison summary table ──────────────────────────────────────────────────
function printComparisonSummary(current, baseline, regressions) {
  const O  = current.overall;
  const B  = baseline.overall;
  const bd = baseline.runAt.slice(0, 16).replace('T', ' ');
  const cd = current.runAt.slice(0, 16).replace('T', ' ');

  console.log('');
  console.log('  ══════════════════════════════════════════════════════════════════');
  console.log('  BEFORE / AFTER COMPARISON');
  console.log(`  Baseline: ${bd}  (${baseline.channelsPerCat} ch, top ${baseline.topN})`);
  console.log(`  Current:  ${cd}  (${current.channelsPerCat} ch, top ${current.topN})`);
  console.log('  ══════════════════════════════════════════════════════════════════');
  console.log('');

  const metricRow = (label, field, invert = false, fmt = v => String(v)) => {
    const bv  = B[field];
    const cv  = O[field];
    const d   = cv - bv;
    const eff = invert ? -d : d;
    const arrow = d === 0 ? ' =' : eff > 0 ? ' ▲' : ' ▼';
    const sign  = eff > 0 ? '+' : '';
    const dStr  = d === 0 ? '    =' : `${arrow} ${sign}${d}`;
    console.log(`  ${label.padEnd(22)}  ${fmt(bv).padStart(6)} → ${fmt(cv).padStart(6)}  ${dStr}`);
  };

  metricRow('Composite',       'composite');
  metricRow('Specificity',     'specificity');
  metricRow('Personalization', 'personalization');
  metricRow('Evidence',        'evidence');
  metricRow('Generic rate',    'genericRate',   true, v => `${v}%`);
  metricRow('Fallback rate',   'fallbackRate',  true, v => `${v}%`);
  metricRow('Duplicate rate',  'duplicateRate', true, v => `${v}%`);
  metricRow('Diversity',       'diversity');
  metricRow('Avg topic words', 'avgWords');
  metricRow('4+ word topics',  'longPct',             v => `${v}%`);

  console.log('');
  console.log('  CATEGORY BREAKDOWN');
  console.log('  ' + '─'.repeat(72));
  console.log('  ' + [
    'Category'.padEnd(16), 'Score'.padStart(7), 'Δ'.padStart(5),
    'Spec'.padStart(5), 'Evid'.padStart(5), 'Generic'.padStart(8), 'Dupe'.padStart(6),
  ].join('  '));
  console.log('  ' + '─'.repeat(72));

  const cats = [...new Set([...Object.keys(B.categories || {}), ...Object.keys(O.categories || {})])].sort();
  for (const cat of cats) {
    const bc = B.categories?.[cat];
    const cc = O.categories?.[cat];
    if (!bc || !cc) continue;

    const compDrop = bc.composite - cc.composite;
    const isReg    = compDrop > THRESHOLDS.categoryDrop;

    const fmt = (d, inv = false) => {
      if (d === 0) return '  =';
      const good = inv ? d < 0 : d > 0;
      return `${good ? '+' : ''}${d}`.padStart(3);
    };

    console.log('  ' + [
      cat.padEnd(16),
      `${bc.composite}→${cc.composite}`.padStart(7),
      fmt(cc.composite - bc.composite).padStart(5),
      fmt(cc.specificity - bc.specificity).padStart(5),
      fmt(cc.evidence - bc.evidence).padStart(5),
      fmt(cc.genericRate - bc.genericRate, true).padStart(8),
      fmt(cc.duplicateRate - bc.duplicateRate, true).padStart(6),
      isReg ? '  ◀ REGRESSION' : '',
    ].join('  '));
  }

  console.log('');

  if (regressions.length) {
    console.log('  ⚠  REGRESSIONS DETECTED');
    console.log('  ' + '─'.repeat(72));
    for (const r of regressions) {
      const sign = r.delta >= 0 ? '+' : '';
      console.log(`  ✗  ${r.metric.replace(/_/g, ' ')}:  ${r.baseline} → ${r.current}  (${sign}${r.delta}, limit ±${r.threshold})`);
    }
    console.log('');
  } else {
    console.log('  ✓  No regressions detected.');
    console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);

console.log('');
console.log('══════════════════════════════════════════════════════════════════');
console.log('  WTP QUALITY GATE  —  ' + TODAY);
console.log(`  channels=${CHANNELS_PER_CAT}  top=${TOP_N}  save=${SAVE}  compare=${DO_COMPARE}  fail-on-regression=${FAIL_ON_REGRESSION}`);
if (CAT_FILTER) console.log(`  category filter: ${args.category}`);
console.log('══════════════════════════════════════════════════════════════════');
console.log('');

// Load baseline BEFORE running so --save + --compare compares vs the previous snapshot
let baseline = null;
if (DO_COMPARE) {
  if (BASELINE_FILE) {
    try { baseline = loadSnapshotByName(BASELINE_FILE); }
    catch (e) { console.log(`  [warn] Could not load baseline "${BASELINE_FILE}": ${e.message}`); }
  } else {
    baseline = loadLatestSnapshot();
    if (!baseline) console.log('  [info] No previous snapshot found — comparison will be skipped.');
  }
}

// Run benchmark
const db = openReadonlyDb();
let result;
try {
  result = runBenchmark(db, {
    channelsPerCat: CHANNELS_PER_CAT,
    topN:           TOP_N,
    categoryFilter: CAT_FILTER,
    onProgress:     ({ category }) => process.stdout.write(`  Sampling ${category}...          \r`),
  });
} catch (e) {
  console.error(`\n  [fatal] Benchmark error: ${e.message}`);
  db.close();
  process.exit(2);
}
db.close();

process.stdout.write('                                                  \r');

if (!result) {
  console.error('  [fatal] No results — verify ingested_channels has rows and the DB path is correct.');
  process.exit(2);
}

// ── Print category scores ─────────────────────────────────────────────────────
console.log('  CATEGORY SCORES');
console.log('  ' + '─'.repeat(66));
console.log('');

const sortedCats = Object.entries(result.categories).sort((a, b) => b[1].composite - a[1].composite);
for (const [name, scores] of sortedCats) {
  const base_cat = baseline?.categories?.[name];
  printCategoryBlock(name, scores, base_cat);
  console.log('');
}

// ── Overall summary ───────────────────────────────────────────────────────────
const O = result.overall;
const B = baseline?.overall;

console.log('  ' + '═'.repeat(66));
console.log(`  OVERALL QUALITY SCORE:  ${O.composite}/100  ${grade(O.composite)}${B ? `  (was ${B.composite}, delta ${O.composite >= B.composite ? '+' : ''}${O.composite - B.composite})` : ''}`);
console.log('');
console.log(`  Avg specificity:      ${O.specificity}/100${B ? `  (was ${B.specificity})` : ''}`);
console.log(`  Avg personalization:  ${O.personalization}/100${B ? `  (was ${B.personalization})` : ''}`);
console.log(`  Avg evidence:         ${O.evidence}/100${B ? `  (was ${B.evidence})` : ''}`);
console.log(`  Avg generic rate:     ${O.genericRate}%  ${rateGrade(O.genericRate)}${B ? `  (was ${B.genericRate}%)` : ''}`);
console.log(`  Avg fallback rate:    ${O.fallbackRate}%  ${rateGrade(O.fallbackRate)}${B ? `  (was ${B.fallbackRate}%)` : ''}`);
console.log(`  Avg duplicate rate:   ${O.duplicateRate}%  ${rateGrade(O.duplicateRate)}${B ? `  (was ${B.duplicateRate}%)` : ''}`);
console.log(`  Avg diversity:        ${O.diversity}/100${B ? `  (was ${B.diversity})` : ''}`);
console.log(`  Avg topic words:      ${O.avgWords}  (bigrams:${O.bigramPct}%  4+words:${O.longPct}%)`);
console.log('  ' + '═'.repeat(66));
console.log('');

// ── Save snapshot ─────────────────────────────────────────────────────────────
if (SAVE) {
  const file = saveSnapshot(result);
  console.log(`  ✓ Snapshot saved: ${path.relative(path.resolve(__dirname, '../../..'), file)}`);
  console.log('');
}

// ── Before/after comparison ───────────────────────────────────────────────────
let regressions = [];
if (DO_COMPARE && baseline) {
  regressions = detectRegressions(result, baseline);
  printComparisonSummary(result, baseline, regressions);
}

// ── Regression gate ───────────────────────────────────────────────────────────
if (FAIL_ON_REGRESSION && regressions.length > 0) {
  console.log('  ✗  EXIT 1 — quality regression detected. Fix or revert before merging.');
  console.log('');
  process.exit(1);
}

process.exit(0);
