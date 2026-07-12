'use strict';

// WTP Outcome Dashboard — CLI reporting for recommendation outcome metrics.
//
// Shows:
//   1. Overall funnel (impressions → saves → briefs → exports → published)
//   2. Per-source breakdown (peer_signal / dna / creative_engine / trend_engine / fallback)
//   3. Top converting topics
//   4. Recent events
//
// Usage:
//   node server/scripts/wtpOutcomeDashboard.js
//   node server/scripts/wtpOutcomeDashboard.js --days=90
//   node server/scripts/wtpOutcomeDashboard.js --channel=UCxxxxxx
//   node server/scripts/wtpOutcomeDashboard.js --top=30
//   node server/scripts/wtpOutcomeDashboard.js --recent=50

require('dotenv').config({ path: __dirname + '/../.env' });

const path          = require('path');
const BetterSqlite3 = require('../node_modules/better-sqlite3');
const {
  fetchFunnelMetrics,
  fetchSourceBreakdown,
  fetchTopTopics,
} = require('../services/wtpOutcomeTracker');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);

const DAYS       = Math.max(1, Math.min(365, Number(args.days)   || 30));
const CHANNEL_ID = args.channel ? String(args.channel) : null;
const TOP_LIMIT  = Math.max(5,  Math.min(100, Number(args.top)   || 20));
const RECENT_N   = Math.max(5,  Math.min(200, Number(args.recent) || 20));

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
    _stmt: sql => stmt(sql),
    close: ()            => { stmtCache.clear(); raw.close(); },
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────
function bar(pct, width = 16) {
  const filled = Math.min(width, Math.round((Math.min(pct, 100) / 100) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmtRate(pct) {
  return `${pct.toFixed(1)}%`.padStart(6);
}

function fmtN(n) {
  return String(n).padStart(7);
}

function truncate(s, n = 55) {
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

// ── Recent events query ───────────────────────────────────────────────────────
function fetchRecentEvents(db, { days, channelId, limit }) {
  const since    = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chFilter = channelId ? 'AND channel_id = ?' : '';
  const chP      = channelId ? [since, channelId, limit] : [since, limit];

  const saves = db.all(
    `SELECT 'save' AS event_type, channel_id, topic, rec_source, rec_type, score, created_at
     FROM wtp_saves WHERE created_at >= ? ${chFilter} ORDER BY created_at DESC LIMIT ?`, chP,
  );
  const briefs = db.all(
    `SELECT 'brief' AS event_type, channel_id, topic, rec_source, rec_type, score, created_at
     FROM wtp_brief_generations WHERE created_at >= ? ${chFilter} ORDER BY created_at DESC LIMIT ?`, chP,
  );
  const exports = db.all(
    `SELECT 'export' AS event_type, channel_id, topic, rec_source, rec_type, score, created_at
     FROM wtp_exports WHERE created_at >= ? ${chFilter} ORDER BY created_at DESC LIMIT ?`, chP,
  );
  const matches = db.all(
    `SELECT 'video_match' AS event_type, channel_id, topic, rec_source, rec_type, score, created_at
     FROM wtp_video_matches WHERE created_at >= ? ${chFilter} ORDER BY created_at DESC LIMIT ?`, chP,
  );

  return [...saves, ...briefs, ...exports, ...matches]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);
const db    = openDb();

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('  WTP OUTCOME DASHBOARD  —  ' + TODAY);
console.log(`  Window: last ${DAYS} days${CHANNEL_ID ? `  |  Channel: ${CHANNEL_ID}` : '  |  All channels'}`);
console.log('══════════════════════════════════════════════════════════════════════');

// ── 1. Overall funnel ─────────────────────────────────────────────────────────
const funnel = fetchFunnelMetrics(db, { days: DAYS, channelId: CHANNEL_ID });

console.log('');
console.log('  OVERALL FUNNEL');
console.log('  ' + '─'.repeat(66));

if (funnel.impressions === 0) {
  console.log('');
  console.log('  No data yet. Impressions are recorded when the WTP endpoint is called.');
  console.log('  Saves/briefs/exports are recorded via POST /api/intel/wtp-outcomes/...');
  console.log('');
} else {
  console.log('');
  const imp = funnel.impressions;
  const stages = [
    { label: 'Impressions  ', n: imp,                rate: 100,             note: '(ideas shown)' },
    { label: 'Saves        ', n: funnel.saves,        rate: funnel.saveRate,  note: '' },
    { label: 'Briefs       ', n: funnel.briefs,       rate: funnel.briefRate, note: '' },
    { label: 'Exports      ', n: funnel.exports,      rate: funnel.exportRate,note: '' },
    { label: 'Published    ', n: funnel.videoMatches, rate: funnel.publishRate,note: '(video matched)' },
  ];

  for (const s of stages) {
    const rateStr = fmtRate(s.rate);
    const nStr    = fmtN(s.n);
    const b       = bar(s.rate);
    console.log(`  ${s.label}  ${nStr}  ${rateStr}  ${b}  ${s.note}`);
  }

  console.log('');
  console.log(`  CTR (saves + briefs / impressions):  ${fmtRate(funnel.ctr)}`);
  console.log(`  Success rate (any action taken):     ${fmtRate(funnel.successRate)}`);
}

// ── 2. Per-source breakdown ───────────────────────────────────────────────────
const sources = fetchSourceBreakdown(db, { days: DAYS, channelId: CHANNEL_ID });

console.log('');
console.log('  PER-SOURCE BREAKDOWN');
console.log('  ' + '─'.repeat(78));
console.log('  ' + [
  'Source'.padEnd(17), 'Impr'.padStart(7), 'Saves'.padStart(6),
  'Briefs'.padStart(7), 'Exports'.padStart(8), 'Published'.padStart(10),
  'CTR'.padStart(6), 'Success'.padStart(8),
].join('  '));
console.log('  ' + '─'.repeat(78));

const sourceOrder = ['peer_signal', 'trend_engine', 'dna', 'creative_engine', 'fallback'];
for (const src of sourceOrder) {
  const s = sources[src];
  if (!s) continue;
  console.log('  ' + [
    (SOURCE_LABELS[src] || src).padEnd(17),
    fmtN(s.impressions),
    String(s.saves).padStart(6),
    String(s.briefs).padStart(7),
    String(s.exports).padStart(8),
    String(s.videoMatches).padStart(10),
    fmtRate(s.ctr),
    fmtRate(s.successRate),
  ].join('  '));
}

// Source quality chart — which source has best CTR?
const validSources = sourceOrder.filter(src => (sources[src]?.impressions || 0) >= 10);
if (validSources.length) {
  console.log('');
  console.log('  CTR by source  (min 10 impressions)');
  console.log('  ' + '─'.repeat(60));
  for (const src of validSources.sort((a, b) => (sources[b]?.ctr || 0) - (sources[a]?.ctr || 0))) {
    const s   = sources[src];
    const lbl = (SOURCE_LABELS[src] || src).padEnd(17);
    console.log(`  ${lbl}  ${fmtRate(s.ctr)}  ${bar(s.ctr)}`);
  }

  console.log('');
  console.log('  Publish rate by source');
  console.log('  ' + '─'.repeat(60));
  for (const src of validSources.sort((a, b) => (sources[b]?.publishRate || 0) - (sources[a]?.publishRate || 0))) {
    const s   = sources[src];
    const lbl = (SOURCE_LABELS[src] || src).padEnd(17);
    console.log(`  ${lbl}  ${fmtRate(s.publishRate)}  ${bar(s.publishRate)}`);
  }
}

// ── 3. Top converting topics ──────────────────────────────────────────────────
const topTopics = fetchTopTopics(db, { days: DAYS, channelId: CHANNEL_ID, limit: TOP_LIMIT });

if (topTopics.length) {
  console.log('');
  console.log(`  TOP ${TOP_LIMIT} TOPICS BY CONVERSIONS  (saves + briefs + exports + video matches)`);
  console.log('  ' + '─'.repeat(78));
  console.log('  ' + [
    '#'.padStart(3),
    'Topic'.padEnd(55),
    'Src'.padEnd(10),
    'Imp'.padStart(5),
    'Act'.padStart(4),
  ].join('  '));
  console.log('  ' + '─'.repeat(78));

  topTopics.forEach((row, i) => {
    const actions = (row.saves || 0) + (row.briefs || 0) + (row.exports || 0) + (row.video_matches || 0);
    const srcShort = {
      peer_signal:     'peer',
      dna:             'dna',
      creative_engine: 'creative',
      trend_engine:    'trend',
      fallback:        'fallback',
    }[row.rec_source] || row.rec_source;

    console.log('  ' + [
      String(i + 1).padStart(3),
      truncate(row.topic, 55).padEnd(55),
      srcShort.padEnd(10),
      String(row.impressions).padStart(5),
      String(actions).padStart(4),
    ].join('  '));
  });
}

// ── 4. Recent events ──────────────────────────────────────────────────────────
const recent = fetchRecentEvents(db, { days: DAYS, channelId: CHANNEL_ID, limit: RECENT_N });

if (recent.length) {
  console.log('');
  console.log(`  RECENT EVENTS  (last ${RECENT_N})`);
  console.log('  ' + '─'.repeat(78));
  console.log('  ' + [
    'When'.padEnd(16), 'Event'.padEnd(12), 'Source'.padEnd(16), 'Topic'.padEnd(50),
  ].join('  '));
  console.log('  ' + '─'.repeat(78));

  for (const ev of recent) {
    const when  = ev.created_at.slice(0, 16).replace('T', ' ');
    const event = ev.event_type.padEnd(12);
    const src   = (SOURCE_LABELS[ev.rec_source] || ev.rec_source || '').trim().padEnd(16);
    const topic = truncate(ev.topic, 50);
    console.log(`  ${when}  ${event}  ${src}  ${topic}`);
  }
} else if (funnel.impressions > 0) {
  console.log('');
  console.log('  No save/brief/export/video-match events in this window.');
  console.log('  Creators are viewing recommendations but not recording actions.');
  console.log('  Integrate the client-side tracking calls to capture these events.');
}

// ── 5. Data freshness note ────────────────────────────────────────────────────
const sinceDate = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
console.log('');
console.log('  ' + '═'.repeat(66));
console.log(`  Impressions: auto-recorded on every WTP response (via attachIdeaKeys)`);
console.log(`  Saves/briefs/exports/matches: recorded via client POST events`);
console.log(`  Window: ${sinceDate} → ${TODAY}  (${DAYS} days)`);
console.log('');
console.log('  Client integration endpoints:');
console.log('    POST /api/intel/wtp-outcomes/impression   (ideas shown)');
console.log('    POST /api/intel/wtp-outcomes/save         (saved)');
console.log('    POST /api/intel/wtp-outcomes/brief        (brief generated)');
console.log('    POST /api/intel/wtp-outcomes/export       (exported)');
console.log('    POST /api/intel/wtp-outcomes/video-match  (published)');
console.log('    GET  /api/intel/wtp-outcomes/metrics      (JSON metrics API)');
console.log('  ' + '═'.repeat(66));
console.log('');

db.close();
process.exit(0);
