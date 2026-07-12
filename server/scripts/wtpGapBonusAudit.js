'use strict';

// WTP Gap Bonus Audit
// Correlates gap_bonus (0 or 10) recorded in wtp_impressions with actual
// creator outcome rates (saves, briefs, exports, video matches).
//
// gap_bonus = 10 when: saturation_pct < 20 AND b.channels.size >= 3
//           = 0  otherwise
//
// saturation_pct = (channels covering this topic / total peer community) * 100
// Low saturation means few peer channels are covering the topic — a supply gap.
//
// WHAT THIS ANSWERS:
//   Do topics with a detected supply gap actually produce more creator saves/briefs?
//   Is the "unexplored topic" signal predictive of creator interest?
//   Or is low saturation just correlated with low viewer demand?
//
// DECISION GATES:
//   gap_bonus=10 save_rate > gap_bonus=0 save_rate by >2pp → KEEP gap_bonus
//   gap_bonus=10 save_rate ≈ gap_bonus=0 save_rate         → REDUCE from 10 to 3
//   gap_bonus=10 save_rate < gap_bonus=0 save_rate by >1pp → REMOVE gap_bonus
//
// REQUIREMENT: wtp_impressions must have gap_bonus column populated.
//   This column was added by Phase 1 of the WTP signal audit (2026-06).
//   Run after ≥30 days of instrumented data.
//
// Usage:
//   node server/scripts/wtpGapBonusAudit.js
//   node server/scripts/wtpGapBonusAudit.js --days=60
//   node server/scripts/wtpGapBonusAudit.js --min-impressions=5

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
const DAYS            = Number(args.days) || 30;
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

function pct(n, d)  { return d > 0 ? (n / d * 100).toFixed(2) + '%' : 'n/a'; }
function pad(s, n)  { return String(s ?? '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s ?? '').padStart(n); }

function main() {
  const db    = openDb();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

  console.log(`\n${'='.repeat(72)}`);
  console.log('WTP GAP BONUS AUDIT');
  console.log(`Window: last ${DAYS} days (since ${since})`);
  console.log(`Minimum impressions per group: ${MIN_IMPRESSIONS}`);
  console.log('='.repeat(72));

  // ── Check column existence ─────────────────────────────────────────────────
  const hasGapBonus = db.all(`PRAGMA table_info(wtp_impressions)`)
    .some(c => c.name === 'gap_bonus');

  if (!hasGapBonus) {
    console.log('\n[ERROR] gap_bonus column does not exist in wtp_impressions.');
    console.log('Run the Phase 1 migration (init.js ALTER TABLE) before this audit.');
    db.close();
    return;
  }

  // ── Check data availability ───────────────────────────────────────────────
  const impTotal = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ? AND gap_bonus IS NOT NULL`,
    [since],
  )?.n || 0;

  const impAny = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ?`, [since],
  )?.n || 0;

  if (impTotal === 0) {
    if (impAny === 0) {
      console.log('\n[NO DATA] wtp_impressions has no rows for this window.');
      console.log('Run after ≥30 days of traffic with the Phase 1 instrumentation active.');
    } else {
      console.log(`\n[NO DATA] ${impAny} impressions exist but none have gap_bonus populated.`);
      console.log('These were recorded before Phase 1 instrumentation. Wait for new data.');
    }
    db.close();
    return;
  }

  console.log(`\nTotal impressions with gap_bonus: ${impTotal} (of ${impAny} total in window)`);

  // ── Primary analysis: gap_bonus=10 vs gap_bonus=0 ─────────────────────────
  const rows = db.all(`
    SELECT
      i.gap_bonus,
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
      AND i.gap_bonus IS NOT NULL
    GROUP BY i.gap_bonus
    ORDER BY i.gap_bonus DESC
  `, [since]);

  if (rows.length === 0 || rows.every(r => r.impressions < MIN_IMPRESSIONS)) {
    console.log(`\n[INSUFFICIENT DATA] No group has ≥${MIN_IMPRESSIONS} impressions.`);
    console.log('Collect more data before making formula decisions.');
    db.close();
    return;
  }

  console.log('\n── gap_bonus vs. Outcome Rates ──────────────────────────────────────────');
  console.log(
    pad('gap_bonus', 12) +
    pad('label', 28) +
    rpad('impr', 8) +
    rpad('saves', 7) +
    rpad('save%', 9) +
    rpad('briefs', 7) +
    rpad('brief%', 9) +
    rpad('exports', 8) +
    rpad('matches', 8) +
    rpad('success%', 10),
  );
  console.log('-'.repeat(106));

  const byBonus = {};
  for (const r of rows) {
    if (r.impressions < MIN_IMPRESSIONS) continue;
    byBonus[r.gap_bonus] = r;
    const label   = r.gap_bonus === 10 ? 'low saturation (<20%)' : 'normal/high saturation';
    const success = r.saves + r.briefs + r.exports + r.video_matches;
    console.log(
      pad(r.gap_bonus, 12) +
      pad(label, 28) +
      rpad(r.impressions, 8) +
      rpad(r.saves, 7) +
      rpad(pct(r.saves, r.impressions), 9) +
      rpad(r.briefs, 7) +
      rpad(pct(r.briefs, r.impressions), 9) +
      rpad(r.exports, 8) +
      rpad(r.video_matches, 8) +
      rpad(pct(success, r.impressions), 10),
    );
  }

  // ── Decision gate ──────────────────────────────────────────────────────────
  console.log('\n── Decision Gate ─────────────────────────────────────────────────────────');

  const gap    = byBonus[10];
  const noGap  = byBonus[0];

  if (!gap || !noGap) {
    console.log('RESULT: One group has insufficient data for comparison.');
    if (!gap)   console.log('  gap_bonus=10 group has no data — all recommendations are saturated topics.');
    if (!noGap) console.log('  gap_bonus=0  group has no data — all recommendations are gap topics.');
    console.log('ACTION: Collect more impressions across both saturation levels.');
    db.close();
    return;
  }

  const gapSaveRate   = gap.saves   / gap.impressions;
  const noGapSaveRate = noGap.saves / noGap.impressions;
  const gapSuccessRate   = (gap.saves + gap.briefs + gap.exports + gap.video_matches) / gap.impressions;
  const noGapSuccessRate = (noGap.saves + noGap.briefs + noGap.exports + noGap.video_matches) / noGap.impressions;

  const saveDiff    = ((gapSaveRate - noGapSaveRate) * 100).toFixed(2);
  const successDiff = ((gapSuccessRate - noGapSuccessRate) * 100).toFixed(2);

  console.log(`gap_bonus=10 save_rate:    ${pct(gap.saves, gap.impressions)}`);
  console.log(`gap_bonus=0  save_rate:    ${pct(noGap.saves, noGap.impressions)}`);
  console.log(`Difference (save):         ${saveDiff}pp`);
  console.log(`Difference (success):      ${successDiff}pp`);
  console.log('');

  if (gapSaveRate > noGapSaveRate + 0.02) {
    console.log(`RESULT: POSITIVE — gap topics have ${saveDiff}pp higher save_rate.`);
    console.log('ACTION: KEEP gap_bonus=10. The supply gap is predictive of creator interest.');
  } else if (gapSaveRate < noGapSaveRate - 0.01) {
    console.log(`RESULT: NEGATIVE — gap topics have ${Math.abs(saveDiff)}pp LOWER save_rate.`);
    console.log('ACTION: REMOVE gap_bonus. Low saturation correlates with low creator interest.');
    console.log('  → Change: gap_bonus = saturation_pct < 20 && b.channels.size >= 3 ? 0 : 0');
  } else {
    console.log(`RESULT: NEUTRAL — difference is only ${saveDiff}pp.`);
    console.log('ACTION: REDUCE gap_bonus from 10 to 3 (signal exists but weak).');
    console.log('  → Change: gap_bonus = saturation_pct < 20 && b.channels.size >= 3 ? 3 : 0');
  }

  // ── Per-source breakdown ──────────────────────────────────────────────────
  console.log('\n── gap_bonus by rec_source ──────────────────────────────────────────────');
  const bySource = db.all(`
    SELECT
      rec_source,
      gap_bonus,
      COUNT(*) AS impressions,
      SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) AS saves
    FROM wtp_impressions i
    LEFT JOIN wtp_saves s ON i.idea_key = s.idea_key
    WHERE i.created_at >= ? AND i.gap_bonus IS NOT NULL
    GROUP BY rec_source, gap_bonus
    ORDER BY rec_source, gap_bonus DESC
  `, [since]);

  if (bySource.length > 0) {
    console.log(
      pad('rec_source', 18) + pad('gap_bonus', 12) +
      rpad('impr', 8) + rpad('saves', 7) + rpad('save%', 9),
    );
    console.log('-'.repeat(54));
    bySource.forEach(r =>
      console.log(
        pad(r.rec_source, 18) + pad(r.gap_bonus, 12) +
        rpad(r.impressions, 8) + rpad(r.saves, 7) + rpad(pct(r.saves, r.impressions), 9),
      ),
    );
  }

  // ── Top gap topics by save rate ────────────────────────────────────────────
  console.log('\n── Top gap_bonus=10 Topics (by save rate, min 2 impressions) ─────────────');
  const topGap = db.all(`
    SELECT
      i.topic,
      COUNT(*) AS impressions,
      SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) AS saves,
      ROUND(100.0 * SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS save_pct
    FROM wtp_impressions i
    LEFT JOIN wtp_saves s ON i.idea_key = s.idea_key
    WHERE i.created_at >= ? AND i.gap_bonus = 10
    GROUP BY i.topic
    HAVING COUNT(*) >= 2
    ORDER BY save_pct DESC, impressions DESC
    LIMIT 15
  `, [since]);

  if (topGap.length > 0) {
    console.log(pad('topic', 40) + rpad('impr', 8) + rpad('saves', 7) + rpad('save%', 8));
    console.log('-'.repeat(63));
    topGap.forEach(r =>
      console.log(pad(r.topic, 40) + rpad(r.impressions, 8) + rpad(r.saves, 7) + rpad(r.save_pct + '%', 8)),
    );
  } else {
    console.log('No gap topics with ≥2 impressions found.');
  }

  console.log('\n='.repeat(72) + '\n');
  db.close();
}

main();
