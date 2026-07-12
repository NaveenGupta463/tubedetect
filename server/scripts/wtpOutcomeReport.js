'use strict';

// WTP Outcome Report — did our recommendations actually produce videos that
// outperformed creator baselines?
//
// Reports Recommendation Success Rate broken down by:
//   • Recommendation source (peer_signal / dna / creative_engine / trend_engine / fallback)
//   • Content category (niche)
//   • Recommendation type (topic_gap / angle_gap / dna_bet / ...)
//   • Confidence band (high / medium / low)
//
// "Success" = outcome_class IN ('breakout', 'above_average')
// i.e. the published video reached ≥1.5× the creator's own average.
//
// Usage:
//   node server/scripts/wtpOutcomeReport.js
//   node server/scripts/wtpOutcomeReport.js --days=180
//   node server/scripts/wtpOutcomeReport.js --min-samples=5
//   node server/scripts/wtpOutcomeReport.js --top=30

require('dotenv').config({ path: __dirname + '/../.env' });

const path          = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const {
  fetchSuccessRateByDimension,
  fetchOutcomeDistribution,
  fetchTopPerformingTopics,
  fetchRecentOutcomes,
  OUTCOME_THRESHOLDS,
} = require('../services/wtpOutcomeQuality');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const DAYS        = Math.max(7, Math.min(365, Number(args.days) || 90));
const MIN_SAMPLES = Math.max(1, Number(args['min-samples']) || 3);
const TOP_LIMIT   = Math.max(5, Math.min(100, Number(args.top) || 20));
const CHANNEL     = args.channel ? String(args.channel) : null;

// ── DB (read-only) ────────────────────────────────────────────────────────────
function openDb() {
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
    close: ()            => { stmtCache.clear(); raw.close(); },
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────
function bar(pct, width = 20) {
  const filled = Math.min(width, Math.round((Math.min(pct, 100) / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pct(n) {
  return `${n.toFixed(1)}%`.padStart(7);
}

function liftStr(l) {
  if (l == null) return '  n/a';
  return `${l.toFixed(2)}×`.padStart(6);
}

function truncate(s, n = 52) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

const SOURCE_LABELS = {
  peer_signal:     'Peer Signal    ',
  dna:             'DNA Bets       ',
  creative_engine: 'Creative Engine',
  trend_engine:    'Trend Engine   ',
  fallback:        'Fallback Pool  ',
};

const CLASS_ICONS = {
  breakout:      '🚀',
  above_average: '▲',
  average:       '●',
  below_average: '▼',
  failed:        '✗',
};

// ── Outcome distribution stacked bar ─────────────────────────────────────────
function outcomeBar(row, width = 30) {
  if (!row.sampleSize) return '░'.repeat(width);
  const slots = {
    breakout:      Math.round((row.breakoutRate / 100)   * width),
    above_average: Math.round((row.aboveAvgRate / 100)   * width),
    average:       Math.round((row.avgRate / 100)        * width),
    below_average: Math.round((row.belowAvgRate / 100)   * width),
    failed:        0,
  };
  // Fill remainder to exactly `width`
  const used = Object.values(slots).reduce((s, v) => s + v, 0);
  slots.failed = Math.max(0, width - used);

  return (
    '█'.repeat(slots.breakout)      +   // dark — breakout
    '▓'.repeat(slots.above_average) +   // medium — above avg
    '░'.repeat(slots.average)       +   // light — average
    '▒'.repeat(slots.below_average) +   // dim — below avg
    ' '.repeat(slots.failed)            // empty — failed
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const db    = openDb();

console.log('');
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('  WTP OUTCOME REPORT  —  ' + TODAY);
console.log(`  Window: last ${DAYS} days  |  Min samples: ${MIN_SAMPLES}`);
console.log(`  Success = outcome_class IN (breakout, above_average) — ≥${OUTCOME_THRESHOLDS.above_average}× channel avg`);
console.log('══════════════════════════════════════════════════════════════════════════');

// ── 1. Overall distribution ───────────────────────────────────────────────────
const dist = fetchOutcomeDistribution(db, { days: DAYS });

console.log('');
console.log('  OVERALL OUTCOME DISTRIBUTION');
console.log('  ' + '─'.repeat(70));

if (!dist || !dist.total) {
  console.log('');
  console.log('  No wtp_outcomes data yet.');
  console.log('  Steps to populate:');
  console.log('  1. Add video_id to wtp_video_matches via POST /api/intel/wtp-outcomes/video-match');
  console.log('  2. Wait for video_growth_snapshots at bucket=7d (runs automatically)');
  console.log('  3. Run: node server/scripts/wtpOutcomeBackfill.js');
  console.log('');
  db.close();
  process.exit(0);
}

const total = dist.total;
const sr    = total > 0 ? +((dist.breakout + dist.above_average) / total * 100).toFixed(1) : 0;

console.log('');
console.log(`  Total matched outcomes:  ${total}`);
console.log(`  Overall success rate:    ${sr}%  (breakout + above_average)`);
console.log(`  Average lift vs channel: ${dist.avg_lift != null ? dist.avg_lift.toFixed(2) + '×' : 'n/a'}`);
console.log(`  Avg percentile in channel catalog: ${dist.avg_pct_channel != null ? dist.avg_pct_channel + 'th' : 'n/a'}`);
console.log('');

const classes = [
  { key: 'breakout',      n: dist.breakout,      icon: '🚀', label: 'Breakout      (≥3× avg)' },
  { key: 'above_average', n: dist.above_average, icon: '▲',  label: 'Above average (≥1.5× avg)' },
  { key: 'average',       n: dist.average,       icon: '●',  label: 'Average       (0.6–1.5×)' },
  { key: 'below_average', n: dist.below_average, icon: '▼',  label: 'Below average (0.15–0.6×)' },
  { key: 'failed',        n: dist.failed,        icon: '✗',  label: 'Failed        (<0.15×)' },
];

for (const c of classes) {
  const rate   = total > 0 ? +(c.n / total * 100).toFixed(1) : 0;
  const b      = bar(rate, 24);
  console.log(`  ${c.icon}  ${c.label.padEnd(28)}  ${String(c.n).padStart(5)}  ${pct(rate)}  ${b}`);
}

console.log('');
console.log('  Legend:  █ breakout  ▓ above avg  ░ average  ▒ below avg  (space) failed');

// ── 2. Success rate by source ─────────────────────────────────────────────────
const bySource = fetchSuccessRateByDimension(db, { dimension: 'rec_source', days: DAYS, minSamples: MIN_SAMPLES });

console.log('');
console.log('  SUCCESS RATE BY RECOMMENDATION SOURCE');
console.log('  ' + '─'.repeat(82));
console.log('  ' + [
  'Source'.padEnd(17),
  'N'.padStart(5),
  'Success%'.padStart(9),
  'Breakout'.padStart(9),
  'AboveAvg'.padStart(9),
  'Failed'.padStart(7),
  'Avg Lift'.padStart(9),
  'Bar (█=break ▓=above ░=avg ▒=below)',
].join('  '));
console.log('  ' + '─'.repeat(82));

const sourceOrder = ['peer_signal', 'trend_engine', 'dna', 'creative_engine', 'fallback'];
for (const src of sourceOrder) {
  const r = bySource.find(x => x.dimension === src);
  if (!r) { console.log(`  ${(SOURCE_LABELS[src] || src).padEnd(17)}  (no data)`); continue; }

  console.log('  ' + [
    (SOURCE_LABELS[r.dimension] || r.dimension).padEnd(17),
    String(r.sampleSize).padStart(5),
    pct(r.successRate),
    pct(r.breakoutRate),
    pct(r.aboveAvgRate),
    pct(r.failedRate),
    liftStr(r.avgLift),
    outcomeBar(r, 28),
  ].join('  '));
}

// Winner highlight
if (bySource.length >= 2) {
  const best  = [...bySource].sort((a, b) => b.successRate - a.successRate)[0];
  const worst = [...bySource].sort((a, b) => a.successRate - b.successRate)[0];
  const bestLabel  = SOURCE_LABELS[best.dimension]  || best.dimension;
  const worstLabel = SOURCE_LABELS[worst.dimension] || worst.dimension;
  console.log('');
  console.log(`  Best source:  ${bestLabel.trim()} — ${best.successRate}% success, avg lift ${liftStr(best.avgLift).trim()}`);
  console.log(`  Worst source: ${worstLabel.trim()} — ${worst.successRate}% success, avg lift ${liftStr(worst.avgLift).trim()}`);
}

// ── 3. Success rate by niche ──────────────────────────────────────────────────
const byNiche = fetchSuccessRateByDimension(db, { dimension: 'niche', days: DAYS, minSamples: MIN_SAMPLES });

if (byNiche.length) {
  console.log('');
  console.log('  SUCCESS RATE BY CATEGORY (NICHE)');
  console.log('  ' + '─'.repeat(72));
  console.log('  ' + [
    'Niche'.padEnd(20),
    'N'.padStart(5), 'Success%'.padStart(9), 'Breakout'.padStart(9),
    'Failed'.padStart(7), 'Avg Lift'.padStart(9), 'Bar',
  ].join('  '));
  console.log('  ' + '─'.repeat(72));

  for (const r of byNiche.slice(0, 15)) {
    console.log('  ' + [
      String(r.dimension || 'unknown').padEnd(20),
      String(r.sampleSize).padStart(5),
      pct(r.successRate),
      pct(r.breakoutRate),
      pct(r.failedRate),
      liftStr(r.avgLift),
      outcomeBar(r, 20),
    ].join('  '));
  }
}

// ── 4. Success rate by rec_type ───────────────────────────────────────────────
const byRecType = fetchSuccessRateByDimension(db, { dimension: 'rec_type', days: DAYS, minSamples: MIN_SAMPLES });

if (byRecType.length) {
  console.log('');
  console.log('  SUCCESS RATE BY RECOMMENDATION TYPE');
  console.log('  ' + '─'.repeat(72));
  console.log('  ' + [
    'Rec Type'.padEnd(24),
    'N'.padStart(5), 'Success%'.padStart(9), 'Breakout'.padStart(9),
    'Failed'.padStart(7), 'Avg Lift'.padStart(9), 'Bar',
  ].join('  '));
  console.log('  ' + '─'.repeat(72));

  for (const r of byRecType.slice(0, 15)) {
    console.log('  ' + [
      String(r.dimension || 'unknown').padEnd(24),
      String(r.sampleSize).padStart(5),
      pct(r.successRate),
      pct(r.breakoutRate),
      pct(r.failedRate),
      liftStr(r.avgLift),
      outcomeBar(r, 18),
    ].join('  '));
  }
}

// ── 5. Success rate by confidence band ───────────────────────────────────────
const byConf = fetchSuccessRateByDimension(db, { dimension: 'confidence', days: DAYS, minSamples: MIN_SAMPLES });

if (byConf.length) {
  console.log('');
  console.log('  SUCCESS RATE BY ENGINE CONFIDENCE BAND');
  console.log('  ' + '─'.repeat(60));

  const confOrder = ['high', 'medium', 'low'];
  for (const conf of confOrder) {
    const r = byConf.find(x => x.dimension === conf);
    if (!r) continue;
    console.log(`  ${conf.padEnd(8)}  N=${String(r.sampleSize).padStart(4)}  success=${pct(r.successRate)}  lift=${liftStr(r.avgLift)}  ${outcomeBar(r, 20)}`);
  }

  // Key insight: does confidence predict success?
  const high = byConf.find(x => x.dimension === 'high');
  const low  = byConf.find(x => x.dimension === 'low');
  if (high && low) {
    const delta = high.successRate - low.successRate;
    const sign  = delta >= 0 ? '+' : '';
    console.log('');
    console.log(`  Confidence signal accuracy: high vs low confidence success delta = ${sign}${delta.toFixed(1)}pp`);
    if (Math.abs(delta) < 5) {
      console.log('  ⚠  Confidence band has low predictive power for actual video success.');
    } else if (delta > 0) {
      console.log('  ✓  High-confidence recommendations outperform low-confidence. Confidence is predictive.');
    } else {
      console.log('  ✗  Low-confidence recommendations outperform high-confidence. Review scoring signals.');
    }
  }
}

// ── 6. Top performing topics ──────────────────────────────────────────────────
const topTopics = fetchTopPerformingTopics(db, { days: DAYS, limit: TOP_LIMIT });

if (topTopics.length) {
  console.log('');
  console.log(`  TOP PERFORMING TOPICS  (by avg lift, min 1 match, last ${DAYS} days)`);
  console.log('  ' + '─'.repeat(80));
  console.log('  ' + [
    '#'.padStart(3),
    'Topic'.padEnd(52),
    'Src'.padEnd(9),
    'N'.padStart(3),
    'AvgLift'.padStart(8),
    'Wins'.padStart(5),
  ].join('  '));
  console.log('  ' + '─'.repeat(80));

  topTopics.forEach((r, i) => {
    const srcShort = ({ peer_signal:'peer', dna:'dna', creative_engine:'creative', trend_engine:'trend', fallback:'fallback' })[r.rec_source] || r.rec_source;
    console.log('  ' + [
      String(i + 1).padStart(3),
      truncate(r.topic, 52).padEnd(52),
      srcShort.padEnd(9),
      String(r.times_matched).padStart(3),
      liftStr(r.avg_lift),
      String(r.successes).padStart(5),
    ].join('  '));
  });
}

// ── 7. Recent outcomes ────────────────────────────────────────────────────────
const recent = fetchRecentOutcomes(db, { days: DAYS, channelId: CHANNEL, limit: 20 });

if (recent.length) {
  console.log('');
  console.log('  RECENT OUTCOMES  (by lift, desc)');
  console.log('  ' + '─'.repeat(82));
  console.log('  ' + [
    'Outcome'.padEnd(14),
    'Lift'.padStart(6),
    'v7d'.padStart(8),
    'Pct'.padStart(4),
    'Source'.padEnd(16),
    'Topic',
  ].join('  '));
  console.log('  ' + '─'.repeat(82));

  for (const r of recent) {
    const icon  = CLASS_ICONS[r.outcome_class] || '?';
    const label = `${icon} ${r.outcome_class}`.padEnd(14);
    const lift  = liftStr(r.relative_lift);
    const v7d   = r.views_7d != null ? String(r.views_7d).padStart(8) : '     n/a';
    const pctC  = r.percentile_vs_channel != null ? `${r.percentile_vs_channel}p`.padStart(4) : ' n/a';
    const src   = (SOURCE_LABELS[r.rec_source] || r.rec_source || '').trim().padEnd(16);
    const topic = truncate(r.topic, 40);
    console.log(`  ${label}  ${lift}  ${v7d}  ${pctC}  ${src}  ${topic}`);
  }
}

// ── 8. Summary insight ────────────────────────────────────────────────────────
console.log('');
console.log('  ══════════════════════════════════════════════════════════════════════════');
console.log('  WHAT ACTUALLY WORKS');
console.log('  ' + '─'.repeat(70));

if (bySource.length) {
  const bestSource  = [...bySource].sort((a, b) => b.avgLift - a.avgLift)[0];
  const bestLiftSrc = SOURCE_LABELS[bestSource.dimension] || bestSource.dimension;
  console.log(`  Highest avg lift:    ${bestLiftSrc.trim()} — ${liftStr(bestSource.avgLift).trim()} avg`);

  const mostReliable = [...bySource].filter(r => r.sampleSize >= MIN_SAMPLES)
    .sort((a, b) => b.successRate - a.successRate)[0];
  if (mostReliable) {
    const reliableLabel = SOURCE_LABELS[mostReliable.dimension] || mostReliable.dimension;
    console.log(`  Most reliable:       ${reliableLabel.trim()} — ${mostReliable.successRate}% success rate (n=${mostReliable.sampleSize})`);
  }
}

if (byNiche.length) {
  const bestNiche = byNiche[0];
  console.log(`  Best performing niche: ${bestNiche.dimension} — ${bestNiche.successRate}% success rate`);
}

console.log('');
console.log(`  Window: last ${DAYS} days  |  min-samples=${MIN_SAMPLES}  |  n=${total} matched outcomes`);
console.log('  Run wtpOutcomeBackfill.js to compute outcomes for new matches.');
console.log('  ══════════════════════════════════════════════════════════════════════════');
console.log('');

db.close();
process.exit(0);
