'use strict';

// WTP Quality History — dashboard of historical benchmark trends.
//
// Reads saved snapshots from data/wtp-snapshots/ and shows score trends over time.
//
// Usage:
//   node server/scripts/wtpQualityHistory.js
//   node server/scripts/wtpQualityHistory.js --last=10
//   node server/scripts/wtpQualityHistory.js --category=Finance
//   node server/scripts/wtpQualityHistory.js --metric=specificity

const fs   = require('fs');
const path = require('path');

const SNAPSHOTS_DIR = path.resolve(__dirname, '../data/wtp-snapshots');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const LAST       = Number(args.last) || 30;
const CAT_FILTER = args.category ? String(args.category) : null;

// ── Load snapshots ────────────────────────────────────────────────────────────
function loadAllSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];
  return fs.readdirSync(SNAPSHOTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, LAST)
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, f), 'utf8')); }
      catch (_) { return null; }
    })
    .filter(Boolean)
    .reverse(); // chronological (oldest first)
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtDate(iso) {
  return iso.slice(0, 16).replace('T', ' ');
}

function fmtDelta(d, invert = false) {
  if (d === 0) return '  =';
  const eff  = invert ? -d : d;
  const sign = d >= 0 ? '+' : '';
  return (eff > 0 ? '▲' : '▼') + sign + d;
}

function grade(s)   { return s >= 70 ? '✓' : s >= 50 ? '●' : '✗'; }
function miniBar(score, width = 10) {
  const filled = Math.min(width, Math.round((score / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── Spark line for a metric over time ─────────────────────────────────────────
// Maps value range to block chars: ▁▂▃▄▅▆▇█
const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
function sparkline(values) {
  if (!values.length) return '';
  const lo  = Math.min(...values);
  const hi  = Math.max(...values);
  const rng = hi - lo || 1;
  return values.map(v => SPARKS[Math.min(7, Math.floor(((v - lo) / rng) * 8))]).join('');
}

// ── Main ──────────────────────────────────────────────────────────────────────
const snapshots = loadAllSnapshots();

console.log('');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  WTP QUALITY HISTORY');
console.log(`  Snapshots: ${SNAPSHOTS_DIR}`);
console.log('══════════════════════════════════════════════════════════════════════════');

if (!snapshots.length) {
  console.log('');
  console.log('  No snapshots found.');
  console.log('  Save your first snapshot:');
  console.log('    node server/scripts/wtpQualityGate.js --save');
  console.log('');
  process.exit(0);
}

console.log(`  ${snapshots.length} snapshot(s) loaded  (oldest→newest)`);
console.log('');

// ── Single category view ──────────────────────────────────────────────────────
if (CAT_FILTER) {
  const catName    = CAT_FILTER;
  const withCat    = snapshots.filter(s => s.categories?.[catName]);

  if (!withCat.length) {
    console.log(`  No snapshots contain category "${catName}".`);
    console.log('');
    process.exit(0);
  }

  console.log(`  CATEGORY TREND:  ${catName.toUpperCase()}`);
  console.log('  ' + '─'.repeat(80));
  console.log('  ' + [
    'Date'.padEnd(17),
    'Score'.padStart(6), 'Δ'.padStart(5),
    'Spec'.padStart(5),  'Δ'.padStart(5),
    'Evid'.padStart(5),  'Pers'.padStart(5),
    'Generic'.padStart(8), 'Dupe'.padStart(5),
    'Words'.padStart(6),
  ].join('  '));
  console.log('  ' + '─'.repeat(80));

  let prev = null;
  for (const snap of withCat) {
    const s  = snap.categories[catName];
    const dt = fmtDate(snap.runAt);

    const fD = (field, inv = false) =>
      prev ? fmtDelta(s[field] - prev[field], inv).padStart(5) : '     ';

    console.log('  ' + [
      dt.padEnd(17),
      String(s.composite).padStart(6),
      fD('composite').padStart(5),
      String(s.specificity).padStart(5),
      fD('specificity').padStart(5),
      String(s.evidence).padStart(5),
      String(s.personalization).padStart(5),
      `${s.genericRate}%`.padStart(8),
      `${s.duplicateRate}%`.padStart(5),
      String(s.avgWords).padStart(6),
    ].join('  '));

    prev = s;
  }

  if (withCat.length >= 2) {
    const first = withCat[0].categories[catName];
    const last  = withCat[withCat.length - 1].categories[catName];
    console.log('  ' + '─'.repeat(80));
    const d = field => {
      const diff = last[field] - first[field];
      return (diff >= 0 ? '+' : '') + diff;
    };
    console.log(`  Net change:  composite ${d('composite')}  spec ${d('specificity')}  evid ${d('evidence')}  generic ${d('genericRate')}pp`);
  }

  console.log('');
  process.exit(0);
}

// ── Overall trend table ───────────────────────────────────────────────────────
console.log('  OVERALL SCORE HISTORY');
console.log('  ' + '─'.repeat(88));
console.log('  ' + [
  'Date'.padEnd(17),
  'Score'.padStart(6), 'Δ'.padStart(5),
  'Spec'.padStart(5),  'Δ'.padStart(5),
  'Evid'.padStart(5),
  'Pers'.padStart(5),
  'Generic'.padStart(8),
  'Dupe'.padStart(5),
  'Words'.padStart(6),
  'Long%'.padStart(6),
].join('  '));
console.log('  ' + '─'.repeat(88));

let prevOverall = null;
for (const snap of snapshots) {
  const O  = snap.overall;
  const dt = fmtDate(snap.runAt);

  const fD = (field, inv = false) =>
    prevOverall ? fmtDelta(O[field] - prevOverall[field], inv).padStart(5) : '     ';

  console.log('  ' + [
    dt.padEnd(17),
    String(O.composite).padStart(6),
    fD('composite').padStart(5),
    String(O.specificity).padStart(5),
    fD('specificity').padStart(5),
    String(O.evidence).padStart(5),
    String(O.personalization).padStart(5),
    `${O.genericRate}%`.padStart(8),
    `${O.duplicateRate}%`.padStart(5),
    String(O.avgWords).padStart(6),
    `${O.longPct}%`.padStart(6),
  ].join('  '));

  prevOverall = O;
}
console.log('  ' + '─'.repeat(88));

// ── Sparklines ────────────────────────────────────────────────────────────────
if (snapshots.length >= 3) {
  console.log('');
  console.log('  TREND SPARKLINES  (oldest → newest)');
  const metrics = [
    { label: 'Composite ',  field: 'composite',     inv: false },
    { label: 'Specificity', field: 'specificity',   inv: false },
    { label: 'Evidence   ', field: 'evidence',      inv: false },
    { label: 'Generic %  ', field: 'genericRate',   inv: true  },
    { label: 'Duplicate %', field: 'duplicateRate', inv: true  },
  ];
  for (const m of metrics) {
    const vals = snapshots.map(s => s.overall[m.field]);
    const last = vals[vals.length - 1];
    const dir  = m.inv ? (last <= vals[0] ? '↓ good' : '↑ bad') : (last >= vals[0] ? '↑ good' : '↓ bad');
    console.log(`  ${m.label}  ${sparkline(vals)}  ${String(last).padStart(3)}  ${dir}`);
  }
}

// ── Net change summary ────────────────────────────────────────────────────────
if (snapshots.length >= 2) {
  const first = snapshots[0].overall;
  const last  = snapshots[snapshots.length - 1].overall;
  const fd    = snapshots[0].runAt.slice(0, 10);
  const ld    = snapshots[snapshots.length - 1].runAt.slice(0, 10);
  const d     = (field) => {
    const diff = last[field] - first[field];
    return (diff >= 0 ? '+' : '') + diff;
  };

  console.log('');
  console.log(`  NET CHANGE  ${fd} → ${ld}`);
  console.log('  ' + '─'.repeat(50));
  console.log(`  Overall composite:  ${d('composite')} pts`);
  console.log(`  Specificity:        ${d('specificity')} pts`);
  console.log(`  Evidence:           ${d('evidence')} pts`);
  console.log(`  Personalization:    ${d('personalization')} pts`);
  console.log(`  Generic rate:       ${d('genericRate')} pp`);
  console.log(`  Avg topic words:    ${(last.avgWords - first.avgWords).toFixed(1)}`);
  console.log(`  4+ word topics:     ${d('longPct')} pp`);
}

// ── Latest per-category scores ────────────────────────────────────────────────
const latest  = snapshots[snapshots.length - 1];
const prevSnap = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;

console.log('');
console.log(`  LATEST CATEGORY SCORES  (${fmtDate(latest.runAt)})`);
console.log('  ' + '─'.repeat(78));
console.log('  ' + [
  'Category'.padEnd(16),
  'Score'.padStart(6), 'Δ'.padStart(5),
  'Spec'.padStart(5),
  'Evid'.padStart(5),
  'Pers'.padStart(5),
  'Generic'.padStart(8),
  'Dupe'.padStart(5),
  'Bar'.padStart(12),
].join('  '));
console.log('  ' + '─'.repeat(78));

const sortedLatest = Object.entries(latest.categories).sort((a, b) => b[1].composite - a[1].composite);
for (const [name, s] of sortedLatest) {
  const prev_cat  = prevSnap?.categories?.[name];
  const compDelta = prev_cat ? fmtDelta(s.composite - prev_cat.composite) : '   ';

  console.log('  ' + [
    name.padEnd(16),
    String(s.composite).padStart(6),
    compDelta.padStart(5),
    String(s.specificity).padStart(5),
    String(s.evidence).padStart(5),
    String(s.personalization).padStart(5),
    `${s.genericRate}%`.padStart(8),
    `${s.duplicateRate}%`.padStart(5),
    miniBar(s.composite).padStart(12),
  ].join('  '));
}

// ── Per-category sparklines (if enough snapshots) ─────────────────────────────
if (snapshots.length >= 3) {
  console.log('');
  console.log('  CATEGORY COMPOSITE SPARKLINES  (oldest → newest)');
  console.log('  ' + '─'.repeat(60));

  const allCats = [...new Set(snapshots.flatMap(s => Object.keys(s.categories || {})))].sort();
  for (const cat of allCats) {
    const vals   = snapshots.map(s => s.categories?.[cat]?.composite).filter(v => v != null);
    if (vals.length < 2) continue;
    const latest_v = vals[vals.length - 1];
    const g        = grade(latest_v);
    console.log(`  ${cat.padEnd(16)}  ${sparkline(vals)}  ${String(latest_v).padStart(3)}/100  ${g}`);
  }
}

console.log('');

// ── Snapshot inventory ────────────────────────────────────────────────────────
console.log(`  SNAPSHOTS  (${snapshots.length} stored in data/wtp-snapshots/)`);
console.log('  ' + '─'.repeat(50));
for (const snap of snapshots) {
  const O    = snap.overall;
  const date = fmtDate(snap.runAt);
  const ch   = `${snap.channelsPerCat}ch`;
  console.log(`  ${date}  score=${O.composite}  spec=${O.specificity}  evid=${O.evidence}  (${ch} top${snap.topN})`);
}

console.log('');
process.exit(0);
