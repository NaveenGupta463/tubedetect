'use strict';

// WTP SAV Benchmark
// Measures whether subscriber-adjusted velocity (SAV) predicts creator engagement.
//
// SAV = views per video / (channel_subs / 1000) — stored in video_growth_snapshots
//       as subscriber_adjusted_velocity (30d bucket).
// avgSav per topic = b.sav30_sum / b.sav30_cnt — computed during WTP topic-bucket build.
//
// This script reads wtp_impressions (which must have avg_sav or can be joined to
// compute it from topic bucket data) and correlates SAV buckets with outcome rates.
//
// DECISION GATE:
//   If save_rate for avgSav >= 1.5 is materially higher (>2pp) than avgSav < 0.5,
//   proceed with adding sav_bonus to the scoring formula.
//   If no correlation: do NOT ship — the signal is noise.
//
// Usage:
//   node server/scripts/wtpSavBenchmark.js
//   node server/scripts/wtpSavBenchmark.js --days=60
//   node server/scripts/wtpSavBenchmark.js --channel=UCxxxxxx

require('dotenv').config({ path: __dirname + '/../.env' });

const path       = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v === undefined ? true : isNaN(v) ? v : Number(v)];
    }),
);
const DAYS      = Number(args.days) || 90;
const CHANNEL   = args.channel ? String(args.channel) : null;

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

// ── SAV bucket label ──────────────────────────────────────────────────────────
function savBucket(avgSav) {
  if (avgSav == null) return 'no_data';
  if (avgSav >= 3.0)  return '>=3.0 (high)';
  if (avgSav >= 1.5)  return '1.5-2.99 (strong)';
  if (avgSav >= 0.5)  return '0.5-1.49 (average)';
  return '<0.5 (weak)';
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(2) + '%' : 'n/a'; }
function pad(s, n)  { return String(s).padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s).padStart(n); }

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db   = openDb();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

  console.log(`\n${'='.repeat(72)}`);
  console.log('WTP SAV BENCHMARK');
  console.log(`Window: last ${DAYS} days (since ${since})`);
  if (CHANNEL) console.log(`Channel filter: ${CHANNEL}`);
  console.log('='.repeat(72));

  // ── Check data availability ───────────────────────────────────────────────
  const impTotal = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ?`,
    [since],
  )?.n || 0;

  if (impTotal === 0) {
    console.log('\n[NO DATA] wtp_impressions is empty for this window.');
    console.log('This benchmark requires outcome tracking data.');
    console.log('Once wtp_impressions begins receiving rows, re-run this script.');
    console.log('\nSAV coverage in video_growth_snapshots (30d bucket):');
    const savCov = db.get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN subscriber_adjusted_velocity IS NOT NULL THEN 1 ELSE 0 END) AS populated FROM video_growth_snapshots WHERE bucket='30d'`,
    );
    console.log(`  total_rows=${savCov.total}  populated=${savCov.populated}  coverage=${pct(savCov.populated, savCov.total)}`);
    console.log('\nSAV value distribution (sample from video_growth_snapshots, 30d bucket):');
    const savDist = db.all(`
      SELECT
        CASE
          WHEN subscriber_adjusted_velocity IS NULL  THEN 'null'
          WHEN subscriber_adjusted_velocity >= 3.0   THEN '>=3.0'
          WHEN subscriber_adjusted_velocity >= 1.5   THEN '1.5-2.99'
          WHEN subscriber_adjusted_velocity >= 0.5   THEN '0.5-1.49'
          ELSE '<0.5'
        END AS sav_bucket,
        COUNT(*) AS n,
        ROUND(AVG(subscriber_adjusted_velocity), 3) AS avg_sav
      FROM video_growth_snapshots
      WHERE bucket = '30d'
      GROUP BY sav_bucket
      ORDER BY MIN(COALESCE(subscriber_adjusted_velocity, -1))
    `);
    console.log(pad('sav_bucket', 18) + rpad('n', 10) + rpad('avg_sav', 10));
    console.log('-'.repeat(38));
    savDist.forEach(r => console.log(pad(r.sav_bucket, 18) + rpad(r.n, 10) + rpad(r.avg_sav ?? 'n/a', 10)));
    db.close();
    return;
  }

  // ── Join impressions to SAV data via topic ────────────────────────────────
  // Because wtp_impressions doesn't yet store avg_sav directly, we proxy it by
  // joining to video_growth_snapshots through ingested_videos → channel topic data.
  // This is an approximation: we compute the average SAV across all videos in
  // the impressions' channel's peer community that are related to the topic.
  //
  // Better: once avg_sav is added to wtp_impressions directly (a Phase 3 production
  // change pending benchmark confirmation), join directly.
  //
  // For now: group by topic, compute avg SAV from the snapshot table for channels
  // in the peer community, and correlate with impression outcomes.

  console.log(`\nTotal impressions in window: ${impTotal}`);

  const chFilter  = CHANNEL ? 'AND i.channel_id = ?' : '';
  const chParams  = CHANNEL ? [since, CHANNEL] : [since];

  // Per-topic outcome rates (all impressions, not SAV-bucketed yet)
  const topicRates = db.all(`
    SELECT
      i.topic,
      i.channel_id,
      COUNT(*)                                                               AS impressions,
      SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END)                     AS saves,
      SUM(CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END)                     AS briefs,
      SUM(CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END)                     AS exports
    FROM wtp_impressions i
    LEFT JOIN wtp_saves             s ON i.idea_key = s.idea_key
    LEFT JOIN wtp_brief_generations b ON i.idea_key = b.idea_key
    LEFT JOIN wtp_exports           e ON i.idea_key = e.idea_key
    WHERE i.created_at >= ? ${chFilter}
    GROUP BY i.topic, i.channel_id
    ORDER BY impressions DESC
  `, chParams);

  if (topicRates.length === 0) {
    console.log('[NO DATA] No topic-level impression data found.');
    db.close();
    return;
  }

  // For each topic+channel, look up avg SAV from the peer community snapshot data.
  // This is an offline proxy — in production, avg_sav would be stored on the impression.
  const savByTopic = new Map();
  for (const row of topicRates) {
    const topicLower = String(row.topic || '').toLowerCase();
    // Fetch avg SAV for videos whose titles contain the topic tokens.
    // Simplified heuristic: match by LIKE on topic keyword in video title.
    const tokens = topicLower.split(/\s+/).filter(w => w.length >= 4).slice(0, 3);
    if (tokens.length === 0) { savByTopic.set(row.topic + '|' + row.channel_id, null); continue; }

    const likeClause = tokens.map(() => 'LOWER(iv.title) LIKE ?').join(' AND ');
    const likeParams = tokens.map(t => '%' + t + '%');
    const savRow = db.get(`
      SELECT AVG(vgs.subscriber_adjusted_velocity) AS avg_sav, COUNT(*) AS n
      FROM video_growth_snapshots vgs
      JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
      WHERE vgs.bucket = '30d'
        AND vgs.subscriber_adjusted_velocity IS NOT NULL
        AND ${likeClause}
      LIMIT 1
    `, likeParams);
    savByTopic.set(row.topic + '|' + row.channel_id, savRow?.n >= 2 ? savRow.avg_sav : null);
  }

  // ── Aggregate by SAV bucket ───────────────────────────────────────────────
  const buckets = {
    '>=3.0 (high)':     { impressions: 0, saves: 0, briefs: 0, exports: 0, topics: 0 },
    '1.5-2.99 (strong)':{ impressions: 0, saves: 0, briefs: 0, exports: 0, topics: 0 },
    '0.5-1.49 (average)':{ impressions: 0, saves: 0, briefs: 0, exports: 0, topics: 0 },
    '<0.5 (weak)':      { impressions: 0, saves: 0, briefs: 0, exports: 0, topics: 0 },
    'no_data':          { impressions: 0, saves: 0, briefs: 0, exports: 0, topics: 0 },
  };

  for (const row of topicRates) {
    const avgSav = savByTopic.get(row.topic + '|' + row.channel_id) ?? null;
    const bkt    = savBucket(avgSav);
    const b      = buckets[bkt] || buckets['no_data'];
    b.impressions += row.impressions;
    b.saves       += row.saves;
    b.briefs      += row.briefs;
    b.exports     += row.exports;
    b.topics      += 1;
  }

  // ── Output ─────────────────────────────────────────────────────────────────
  console.log('\n── SAV Bucket vs. Outcome Rates ──────────────────────────────────────────');
  console.log(
    pad('sav_bucket', 22) +
    rpad('topics', 8) +
    rpad('impressions', 13) +
    rpad('saves', 8) +
    rpad('save_rate', 11) +
    rpad('briefs', 8) +
    rpad('brief_rate', 12) +
    rpad('exports', 8) +
    rpad('exp_rate', 10),
  );
  console.log('-'.repeat(100));
  for (const [bktName, b] of Object.entries(buckets)) {
    if (b.impressions === 0) continue;
    console.log(
      pad(bktName, 22) +
      rpad(b.topics, 8) +
      rpad(b.impressions, 13) +
      rpad(b.saves, 8) +
      rpad(pct(b.saves, b.impressions), 11) +
      rpad(b.briefs, 8) +
      rpad(pct(b.briefs, b.impressions), 12) +
      rpad(b.exports, 8) +
      rpad(pct(b.exports, b.impressions), 10),
    );
  }

  // ── Decision gate ──────────────────────────────────────────────────────────
  console.log('\n── Decision Gate ─────────────────────────────────────────────────────────');
  const high   = buckets['>=3.0 (high)'];
  const strong = buckets['1.5-2.99 (strong)'];
  const avg    = buckets['0.5-1.49 (average)'];
  const weak   = buckets['<0.5 (weak)'];

  const highRate = high.impressions   > 0 ? high.saves   / high.impressions   : null;
  const weakRate = weak.impressions   > 0 ? weak.saves   / weak.impressions   : null;
  const noData   = high.impressions   === 0 && strong.impressions === 0 && avg.impressions === 0 && weak.impressions === 0;

  if (noData) {
    console.log('RESULT: Insufficient data — no SAV-matched impressions found.');
    console.log('ACTION: Wait for impression data to accumulate, then re-run.');
  } else if (highRate == null || weakRate == null) {
    console.log('RESULT: Incomplete — some SAV buckets have no data.');
    console.log('ACTION: Collect more data before deciding.');
  } else {
    const diff = ((highRate - weakRate) * 100).toFixed(2);
    if (highRate > weakRate + 0.02) {
      console.log(`RESULT: POSITIVE — high-SAV topics have ${diff}pp higher save_rate.`);
      console.log('ACTION: Proceed with adding sav_bonus to scoring formula.');
    } else if (highRate < weakRate - 0.01) {
      console.log(`RESULT: NEGATIVE — high-SAV topics have lower save_rate (${diff}pp).`);
      console.log('ACTION: Do NOT ship sav_bonus. The signal is inverted or noisy.');
    } else {
      console.log(`RESULT: NEUTRAL — save_rate difference is only ${diff}pp.`);
      console.log('ACTION: Do NOT ship sav_bonus yet. Collect 30 more days of data.');
    }
  }

  console.log('\n── Coverage Note ─────────────────────────────────────────────────────────');
  console.log('avg_sav is approximated via title-token join — not stored per impression.');
  console.log('For precise correlation: add avg_sav to wtp_impressions after sav_bonus ships.');
  console.log('='.repeat(72) + '\n');

  db.close();
}

main();
