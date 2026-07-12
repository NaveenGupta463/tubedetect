'use strict';

// WTP Creator Fit Benchmark
// Runs What-to-Post for benchmark channels and shows opportunity_score,
// creator_fit_score, and combined (final) score — before vs. after ranking.
//
// Usage:
//   node server/scripts/wtpCreatorFitBenchmark.js
//   node server/scripts/wtpCreatorFitBenchmark.js --channel="Jimmy Fallon"
//   node server/scripts/wtpCreatorFitBenchmark.js --top=8

require('dotenv').config({ path: __dirname + '/../.env' });

const path         = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
const { computeWhatToPost } = require('../services/whatToPost');
const { buildWhatToPostContext } = require('../services/whatToPostContext');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);
const TOP       = Math.max(1, Math.min(20, Number(args.top) || 5));
const FILTER    = args.channel ? String(args.channel).toLowerCase() : null;

// ── DB ────────────────────────────────────────────────────────────────────────
function openDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=30000');
  const stmtCache = new Map();
  const stmt = sql => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    // dummy run/transaction for compatibility with computeWhatToPost
    run:         () => {},
    transaction: fn => fn,
  };
}

// ── Benchmark channel definitions ─────────────────────────────────────────────
const BENCHMARK_CHANNELS = [
  { name: 'Jimmy Fallon',   search: '%fallon%',        label: 'The Tonight Show / Jimmy Fallon',     expected_domains: 'entertainment, comedy, music' },
  { name: 'Joe Rogan',      search: '%rogan%',          label: 'Joe Rogan Experience',                expected_domains: 'podcast, health, tech, culture' },
  { name: 'BeerBiceps',     search: '%beerbiceps%',     label: 'BeerBiceps (Ranveer Allahbadia)',     expected_domains: 'self_improvement, podcast, spirituality' },
  { name: 'Tech Burner',    search: '%tech burner%',    label: 'Tech Burner',                         expected_domains: 'tech, gadgets, reviews' },
  { name: 'Aaj Tak',        search: '%aaj tak%',        label: 'Aaj Tak',                             expected_domains: 'news, politics, current affairs' },
  { name: 'Physics Wallah', search: '%physics wallah%', label: 'Physics Wallah',                      expected_domains: 'education, exam_prep, science' },
];

// ── Formatting ─────────────────────────────────────────────────────────────────
const W = { topic: 42, opp: 5, fit: 5, comb: 5, fitW: 7, domain: 18 };

function pad(s, n) { return String(s || '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s || '').padStart(n).slice(-n); }

function fitBar(score) {
  const filled = Math.round(score / 10);
  return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
}

function printIdea(rank, idea, label) {
  const opp  = idea.opportunity_score ?? idea.score ?? 0;
  const fit  = idea.creator_fit_score ?? '—';
  const comb = idea.score ?? 0;
  const wt   = idea.creator_fit_weight != null ? idea.creator_fit_weight.toFixed(2) : '—';
  const domain = idea.creator_fit_breakdown
    ? Object.entries(idea.creator_fit_breakdown)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}:${v}`)
        .join(', ')
    : '';

  const rank_label = `${label ? `[${label}]` : ''}${String(rank).padStart(2)}.`;
  console.log(
    `   ${pad(rank_label, 8)} ${pad(idea.topic, W.topic)}` +
    `  opp:${rpad(opp, W.opp)}` +
    `  fit:${rpad(fit, W.fit)}  ${fitBar(Number(fit) || 0)}` +
    `  x${wt}` +
    `  → ${rpad(comb, W.comb)}`,
  );
  if (domain) console.log(`             ${'\x1b[2m'}${domain}${'\x1b[0m'}`);
}

function printDivider(char = '─', w = 110) { console.log('  ' + char.repeat(w)); }

// ── Main ──────────────────────────────────────────────────────────────────────
const db  = openDb();
const ctx = buildWhatToPostContext();

// Open a writable handle just for computeWhatToPost (it may run WAL reads needing write lock)
const dbRw = (() => {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: false, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=60000');
  raw.pragma('synchronous=NORMAL');
  const stmtCache = new Map();
  const stmt = sql => {
    if (!stmtCache.has(sql)) stmtCache.set(sql, raw.prepare(sql));
    return stmtCache.get(sql);
  };
  return {
    all:         (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get:         (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    run:         (sql, p = []) => stmt(sql).run(Array.isArray(p) ? p : [p]),
    transaction: fn => raw.transaction(fn),
    close:       () => { stmtCache.clear(); raw.close(); },
  };
})();

const channels = FILTER
  ? BENCHMARK_CHANNELS.filter(c => c.name.toLowerCase().includes(FILTER))
  : BENCHMARK_CHANNELS;

console.log('\n');
console.log('  ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('  WTP CREATOR FIT BENCHMARK  —  ' + new Date().toISOString().slice(0, 16).replace('T', ' '));
console.log('  Scoring: final_score = opportunity_score × fit_weight  |  fit_weight = 0.20 + 0.80 × (fit_score / 100)');
console.log('  ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════\n');

for (const bench of channels) {
  // Find channel in DB
  const channelRow = db.get(
    `SELECT channel_id, channel_name, primary_niche, niche, format_type, primary_language, channel_subscribers
     FROM ingested_channels WHERE channel_name LIKE ? ORDER BY channel_subscribers DESC LIMIT 1`,
    [bench.search],
  );

  console.log(`\n  ┌─ ${bench.label}`);
  console.log(`  │  Expected domains: ${bench.expected_domains}`);

  if (!channelRow) {
    console.log(`  │  \x1b[33m⚠ Channel not found in DB (search: "${bench.search}") — skipping\x1b[0m`);
    printDivider();
    continue;
  }

  console.log(`  │  Found: ${channelRow.channel_name}  (${channelRow.channel_id})`);
  console.log(`  │  Niche: ${channelRow.primary_niche || channelRow.niche || '—'}  |  Format: ${channelRow.format_type || '—'}  |  Lang: ${channelRow.primary_language || '—'}  |  Subs: ${channelRow.channel_subscribers?.toLocaleString() || '—'}`);

  let result;
  try {
    result = computeWhatToPost(dbRw, { channel_id: channelRow.channel_id }, ctx);
  } catch (e) {
    console.log(`  │  \x1b[31m✗ Error: ${e.message}\x1b[0m`);
    printDivider();
    continue;
  }

  const ideas = result?.ideas || [];
  if (!ideas.length) {
    console.log(`  │  \x1b[33m⚠ No ideas returned\x1b[0m`);
    printDivider();
    continue;
  }

  // "Before" order: sorted by opportunity_score (raw peer signal score)
  const beforeOrder = [...ideas].sort((a, b) =>
    ((b.opportunity_score ?? b.score) || 0) - ((a.opportunity_score ?? a.score) || 0),
  );
  // "After" order: already sorted by combined score (default sort from engine)
  const afterOrder = ideas.slice();

  console.log(`  │`);
  console.log(`  │  ${'\x1b[1m'}BEFORE (by opportunity score — peers only, no creator fit):${'\x1b[0m'}`);
  printDivider('·', 104);
  console.log(`  │  ${'#'.padEnd(8)} ${'topic'.padEnd(W.topic)}  opp    fit  ${' '.repeat(12)} weight  → comb`);
  printDivider('·', 104);
  beforeOrder.slice(0, TOP).forEach((idea, i) => printIdea(i + 1, idea, ''));

  console.log(`  │`);
  console.log(`  │  ${'\x1b[1m'}AFTER  (by combined score = opportunity × creator fit weight):${'\x1b[0m'}`);
  printDivider('·', 104);
  console.log(`  │  ${'#'.padEnd(8)} ${'topic'.padEnd(W.topic)}  opp    fit  ${' '.repeat(12)} weight  → comb`);
  printDivider('·', 104);
  afterOrder.slice(0, TOP).forEach((idea, i) => {
    // Highlight ideas with low creator fit that got demoted
    const fit = idea.creator_fit_score ?? 100;
    const marker = fit < 30 ? '\x1b[31m✗\x1b[0m' : fit < 60 ? '\x1b[33m~\x1b[0m' : '\x1b[32m✓\x1b[0m';
    process.stdout.write(`  │  ${marker} `);
    printIdea(i + 1, idea, '');
  });

  // Show suppressed ideas (high opp, low fit)
  const suppressed = afterOrder.filter(i => (i.creator_fit_score ?? 100) < 35).slice(0, 5);
  if (suppressed.length) {
    console.log(`  │`);
    console.log(`  │  \x1b[31mSuppressed (low creator fit — would have ranked higher without fit scoring):\x1b[0m`);
    suppressed.forEach(idea => {
      const opp = idea.opportunity_score ?? idea.score;
      console.log(`  │    × "${idea.topic}"  (opp:${opp}, fit:${idea.creator_fit_score}, domain mismatch)`);
    });
  }

  printDivider();
}

console.log('\n  Legend:  opp = raw opportunity score  |  fit = creator fit score (0-100)');
console.log('           ██████████ fit bar  |  weight = fit_weight (0.20-1.00)  |  → comb = final combined score');
console.log('  \x1b[32m✓\x1b[0m fit≥60  \x1b[33m~\x1b[0m fit 30-59  \x1b[31m✗\x1b[0m fit<30\n');

dbRw.close();
