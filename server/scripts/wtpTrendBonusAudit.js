'use strict';

// WTP Trend Bonus Audit
// Correlates trend_bonus values recorded in wtp_impressions with actual creator
// outcome rates (saves, briefs, exports).
//
// trend_bonus maps:
//   'rising'   → +20    (supply-side: more creators uploading in last 14d)
//   'peaking'  → +10
//   'evergreen'→  +8
//   'fading'   → -15
//   'dormant'  → -30
//
// WHAT THIS ANSWERS:
//   Does a topic labeled 'rising' (high upload density) actually produce more
//   creator saves and briefs than an 'evergreen' or unlabeled topic?
//   If yes → the supply-side proxy is predictive. Keep the formula.
//   If no  → the bonus rewards the wrong signal. Reduce or remove.
//
// DECISION GATES:
//   trend_bonus=20 (rising) save_rate > trend_bonus=8 (evergreen) save_rate by >2pp → KEEP
//   trend_bonus=-30 (dormant) save_rate ≈ trend_bonus=0 → REMOVE dormant penalty
//   trend_bonus=20 save_rate ≤ trend_bonus=8 save_rate → REDUCE rising bonus to 10
//
// REQUIREMENT: wtp_impressions must have trend_bonus column populated.
//   This column was added by Phase 1 of the WTP signal audit (2026-06).
//   Run after ≥30 days of instrumented data.
//
// Usage:
//   node server/scripts/wtpTrendBonusAudit.js
//   node server/scripts/wtpTrendBonusAudit.js --days=60
//   node server/scripts/wtpTrendBonusAudit.js --min-impressions=5

require('dotenv').config({ path: __dirname + '/../.env' });

const path         = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);
const DAYS           = Number(args.days) || 30;
const MIN_IMPRESSIONS = Number(args['min-impressions']) || 3;

function openDb() {
  const raw = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), {
    readonly: true, fileMustExist: true, timeout: 60000,
  });
  raw.pragma('journal_mode=WAL');
  raw.pragma('busy_timeout=30000');
  const cache = new Map();
  const stmt  = sql => { if (!cache.has(sql)) cache.set(sql, raw.prepare(sql)); return cache.get(sql); };
  return {
    all: (sql, p = []) => stmt(sql).all(Array.isArray(p) ? p : [p]),
    get: (sql, p = []) => stmt(sql).get(Array.isArray(p) ? p : [p]),
    close: () => raw.close(),
  };
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(2) + '%' : 'n/a'; }
function pad(s, n)  { return String(s ?? '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s ?? '').padStart(n); }

// Known trend_bonus values and their meaning
const TREND_BONUS_LABELS = {
  20:  'rising    (supply ↑↑)',
  10:  'peaking   (supply ↑)',
  8:   'evergreen (stable)',
  0:   'neutral   (no trend)',
  '-6':  'peaking  (trend_signal peak)',  // trend_signal_bonus
  '-15': 'fading   (supply ↓)',
  '-30': 'dormant  (supply ↓↓)',
};

function main() {
  const db    = openDb();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

  console.log(`\n${'='.repeat(72)}`);
  console.log('WTP TREND BONUS AUDIT');
  console.log(`Window: last ${DAYS} days (since ${since})`);
  console.log(`Minimum impressions per bucket: ${MIN_IMPRESSIONS}`);
  console.log('='.repeat(72));

  // ── Check column existence ────────────────────────────────────────────────
  const colCheck = db.get(`PRAGMA table_info(wtp_impressions)`);
  const hasTrendBonus = db.all(`PRAGMA table_info(wtp_impressions)`)
    .some(c => c.name === 'trend_bonus');

  if (!hasTrendBonus) {
    console.log('\n[ERROR] trend_bonus column does not exist in wtp_impressions.');
    console.log('Run the Phase 1 migration (init.js ALTER TABLE) before this audit.');
    db.close();
    return;
  }

  // ── Check data availability ───────────────────────────────────────────────
  const impTotal = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ? AND trend_bonus IS NOT NULL`,
    [since],
  )?.n || 0;

  const impAny = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ?`,
    [since],
  )?.n || 0;

  if (impTotal === 0) {
    if (impAny === 0) {
      console.log('\n[NO DATA] wtp_impressions has no rows for this window.');
      console.log('The trend_bonus column exists but no impressions have been recorded yet.');
      console.log('Run after ≥30 days of traffic with the Phase 1 instrumentation active.');
    } else {
      console.log(`\n[NO DATA] ${impAny} impressions exist but none have trend_bonus populated.`);
      console.log('These were recorded before Phase 1 instrumentation. Wait for new data.');
    }
    db.close();
    return;
  }

  console.log(`\nTotal impressions with trend_bonus: ${impTotal} (of ${impAny} total in window)`);

  // ── Main correlation query ────────────────────────────────────────────────
  const rows = db.all(`
    SELECT
      i.trend_bonus,
      COUNT(*)                                               AS impressions,
      SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END)     AS saves,
      SUM(CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END)     AS briefs,
      SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END)     AS exports,
      SUM(CASE WHEN vm.id IS NOT NULL THEN 1 ELSE 0 END)    AS video_matches
    FROM wtp_impressions i
    LEFT JOIN wtp_saves             s  ON i.idea_key = s.idea_key
    LEFT JOIN wtp_brief_generations b  ON i.idea_key = b.idea_key
    LEFT JOIN wtp_exports           e  ON i.idea_key = e.idea_key
    LEFT JOIN wtp_video_matches     vm ON i.idea_key = vm.idea_key
    WHERE i.created_at >= ?
      AND i.trend_bonus IS NOT NULL
    GROUP BY i.trend_bonus
    ORDER BY i.trend_bonus DESC
  `, [since]);

  const filtered = rows.filter(r => r.impressions >= MIN_IMPRESSIONS);

  if (filtered.length === 0) {
    console.log(`\n[INSUFFICIENT DATA] No trend_bonus bucket has ≥${MIN_IMPRESSIONS} impressions.`);
    console.log('Collect more data before making formula decisions.');
    db.close();
    return;
  }

  // ── Output table ──────────────────────────────────────────────────────────
  console.log('\n── trend_bonus vs. Outcome Rates ────────────────────────────────────────');
  console.log(
    pad('trend_bonus', 8) +
    pad('label', 28) +
    rpad('impr', 8) +
    rpad('saves', 7) +
    rpad('save%', 9) +
    rpad('briefs', 7) +
    rpad('brief%', 9) +
    rpad('exports', 8) +
    rpad('success%', 10),
  );
  console.log('-'.repeat(94));

  for (const r of filtered) {
    const label   = TREND_BONUS_LABELS[String(r.trend_bonus)] || '';
    const success = r.saves + r.briefs + r.exports + r.video_matches;
    console.log(
      pad(r.trend_bonus, 8) +
      pad(label, 28) +
      rpad(r.impressions, 8) +
      rpad(r.saves, 7) +
      rpad(pct(r.saves, r.impressions), 9) +
      rpad(r.briefs, 7) +
      rpad(pct(r.briefs, r.impressions), 9) +
      rpad(r.exports, 8) +
      rpad(pct(success, r.impressions), 10),
    );
  }

  // ── Decision gate ──────────────────────────────────────────────────────────
  console.log('\n── Decision Gate ─────────────────────────────────────────────────────────');

  const byBonus = {};
  for (const r of filtered) { byBonus[r.trend_bonus] = r; }

  const rising   = byBonus[20];
  const evergreen= byBonus[8];
  const dormant  = byBonus[-30];
  const neutral  = byBonus[0];

  if (!rising && !evergreen) {
    console.log('RESULT: Not enough distinct trend_bonus values with data.');
    console.log('ACTION: Collect more impressions across different trend statuses.');
    db.close();
    return;
  }

  let decision = [];

  if (rising && evergreen && rising.impressions >= MIN_IMPRESSIONS && evergreen.impressions >= MIN_IMPRESSIONS) {
    const risingRate   = rising.saves / rising.impressions;
    const evergreenRate= evergreen.saves / evergreen.impressions;
    const diff = ((risingRate - evergreenRate) * 100).toFixed(2);
    if (risingRate > evergreenRate + 0.02) {
      decision.push(`KEEP rising bonus (+20): 'rising' topics have ${diff}pp higher save_rate than 'evergreen'.`);
    } else if (risingRate < evergreenRate - 0.01) {
      decision.push(`REDUCE rising bonus: 'rising' topics have ${Math.abs(diff)}pp LOWER save_rate than 'evergreen'.`);
      decision.push('  → Change rising bonus from +20 to +10 (same as peaking).');
    } else {
      decision.push(`NEUTRAL: rising vs evergreen save_rate difference is only ${diff}pp.`);
      decision.push('  → Collect 30 more days before deciding.');
    }
  }

  if (dormant && neutral && dormant.impressions >= MIN_IMPRESSIONS && neutral.impressions >= MIN_IMPRESSIONS) {
    const dormantRate = dormant.saves / dormant.impressions;
    const neutralRate = neutral.saves / neutral.impressions;
    const diff = ((dormantRate - neutralRate) * 100).toFixed(2);
    if (Math.abs(dormantRate - neutralRate) < 0.01) {
      decision.push(`REMOVE dormant penalty (-30): 'dormant' save_rate ≈ neutral (${diff}pp diff).`);
      decision.push('  → The penalty suppresses valid content with no outcome benefit.');
    } else if (dormantRate < neutralRate - 0.02) {
      decision.push(`KEEP dormant penalty: 'dormant' has ${Math.abs(diff)}pp lower save_rate than neutral.`);
    }
  }

  if (decision.length === 0) {
    console.log('RESULT: Not enough bucket pairs with sufficient data for conclusions.');
    console.log('ACTION: Re-run after more impression data accumulates.');
  } else {
    decision.forEach(d => console.log(d));
  }

  // ── Source breakdown ───────────────────────────────────────────────────────
  console.log('\n── trend_bonus distribution by rec_source ───────────────────────────────');
  const bySource = db.all(`
    SELECT
      rec_source,
      trend_bonus,
      COUNT(*) AS n
    FROM wtp_impressions
    WHERE created_at >= ? AND trend_bonus IS NOT NULL
    GROUP BY rec_source, trend_bonus
    ORDER BY rec_source, trend_bonus DESC
  `, [since]);

  if (bySource.length > 0) {
    console.log(pad('rec_source', 18) + rpad('trend_bonus', 13) + rpad('impressions', 13));
    console.log('-'.repeat(44));
    bySource.forEach(r =>
      console.log(pad(r.rec_source, 18) + rpad(r.trend_bonus, 13) + rpad(r.n, 13)),
    );
  }

  console.log('\n='.repeat(72) + '\n');
  db.close();
}

main();
