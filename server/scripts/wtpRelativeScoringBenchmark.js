'use strict';

// WTP Relative Scoring Benchmark
// Compares three scoring variants for base_views:
//
//   Variant 1 (current/production): absolute peer median views only
//     base_views = log10(peerMedianViews + 1) / 7 * 35  [0-35]
//
//   Variant 2 (relative only): peerMedianViews / creatorMedianViews
//     base_views = f(peerMedianViews / creatorMedianViews)  [4-35]
//
//   Variant 3 (hybrid): 60% absolute + 40% relative
//     base_views = 0.6 * V1 + 0.4 * V2
//
// DECISION GATE:
//   Variant 2 or 3 must show >5pp higher save_rate on channels where creator
//   median views is known, compared to Variant 1, before proceeding.
//   If no meaningful difference: do NOT modify base_views formula.
//
// Usage:
//   node server/scripts/wtpRelativeScoringBenchmark.js
//   node server/scripts/wtpRelativeScoringBenchmark.js --top=10
//   node server/scripts/wtpRelativeScoringBenchmark.js --days=60

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
const TOP_CHANNELS = Math.max(1, Math.min(50, Number(args.top) || 10));
const DAYS         = Number(args.days) || 90;

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

// ── Scoring variant formulas ──────────────────────────────────────────────────

function variantAbsolute(peerMedianViews) {
  return Math.min(35, Math.log10((peerMedianViews || 0) + 1) / 7 * 35);
}

function variantRelative(peerMedianViews, creatorMedianViews) {
  if (!creatorMedianViews || creatorMedianViews <= 0) return null;
  const ratio = peerMedianViews / creatorMedianViews;
  if (ratio >= 10)  return 35;
  if (ratio >= 5)   return 28;
  if (ratio >= 2)   return 22;
  if (ratio >= 1)   return 16;
  if (ratio >= 0.5) return 10;
  return 4;
}

function variantHybrid(peerMedianViews, creatorMedianViews) {
  const v1 = variantAbsolute(peerMedianViews);
  const v2 = variantRelative(peerMedianViews, creatorMedianViews);
  if (v2 == null) return null;
  return 0.6 * v1 + 0.4 * v2;
}

function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(2) + '%' : 'n/a'; }
function pad(s, n)  { return String(s || '').padEnd(n).slice(0, n); }
function rpad(s, n) { return String(s || '').padStart(n); }

// ── Weighted median (mirrors whatToPost.js weightedMedian) ───────────────────
function median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const db    = openDb();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);

  console.log(`\n${'='.repeat(80)}`);
  console.log('WTP RELATIVE SCORING BENCHMARK');
  console.log(`Window: last ${DAYS} days (since ${since})`);
  console.log(`Channels analyzed: top ${TOP_CHANNELS} by impression count`);
  console.log('='.repeat(80));

  // ── Check impression availability ─────────────────────────────────────────
  const impTotal = db.get(
    `SELECT COUNT(*) AS n FROM wtp_impressions WHERE created_at >= ?`, [since],
  )?.n || 0;

  if (impTotal === 0) {
    console.log('\n[NO DATA] wtp_impressions is empty for this window.');
    console.log('This benchmark requires outcome tracking data to compute save-rate correlation.');
    console.log('\nRunning SCORE DISTRIBUTION analysis on existing WTP cache instead...\n');

    // Show scoring variant comparison on cached WTP results
    const cachedChannels = db.all(
      `SELECT channel_id, payload_json FROM channel_wtp_cache WHERE status = 'ready' LIMIT ?`,
      [TOP_CHANNELS],
    );
    if (cachedChannels.length === 0) {
      console.log('[NO DATA] No WTP cache entries found either.');
      db.close();
      return;
    }

    console.log(`Found ${cachedChannels.length} cached WTP result(s) to analyze.\n`);

    for (const cacheRow of cachedChannels) {
      let payload;
      try { payload = JSON.parse(cacheRow.payload_json); } catch (_) { continue; }
      const ideas = payload?.ideas || payload?.result?.ideas || [];
      if (ideas.length === 0) continue;

      // Get creator median views
      const creatorViews = db.all(
        `SELECT views FROM ingested_videos WHERE channel_id = ? AND views IS NOT NULL ORDER BY views LIMIT 200`,
        [cacheRow.channel_id],
      ).map(r => r.views);
      const creatorMedianViews = median(creatorViews);
      const subsRow = db.get(
        `SELECT channel_subscribers FROM ingested_channels WHERE channel_id = ? LIMIT 1`,
        [cacheRow.channel_id],
      );

      console.log(`Channel: ${cacheRow.channel_id}`);
      console.log(`  Creator median views: ${Math.round(creatorMedianViews).toLocaleString()}`);
      console.log(`  Subscriber count:     ${(subsRow?.channel_subscribers || 0).toLocaleString()}`);
      console.log(`  Ideas analyzed:       ${ideas.length}`);
      console.log('');
      console.log(
        pad('topic', 38) +
        rpad('peer_med', 12) +
        rpad('V1_abs', 8) +
        rpad('V2_rel', 8) +
        rpad('V3_hyb', 8) +
        rpad('ratio', 8),
      );
      console.log('-'.repeat(82));

      let rankDiffsV1V2 = 0;
      let rankDiffsV1V3 = 0;
      let topicsWithRelative = 0;

      for (const idea of ideas.slice(0, 15)) {
        const peerViews = idea.avg_views || 0;
        const v1 = variantAbsolute(peerViews);
        const v2 = variantRelative(peerViews, creatorMedianViews);
        const v3 = variantHybrid(peerViews, creatorMedianViews);
        const ratio = creatorMedianViews > 0 ? (peerViews / creatorMedianViews).toFixed(2) : 'n/a';
        if (v2 != null) topicsWithRelative++;
        console.log(
          pad(idea.topic, 38) +
          rpad(Math.round(peerViews).toLocaleString(), 12) +
          rpad(v1.toFixed(1), 8) +
          rpad(v2 != null ? v2.toFixed(1) : 'n/a', 8) +
          rpad(v3 != null ? v3.toFixed(1) : 'n/a', 8) +
          rpad(ratio, 8),
        );
      }

      // Check if relative scoring would change top-5 ranking
      if (creatorMedianViews > 0 && ideas.length >= 2) {
        const rankedV1 = [...ideas].sort((a, b) =>
          variantAbsolute(b.avg_views || 0) - variantAbsolute(a.avg_views || 0),
        );
        const rankedV2 = [...ideas].filter(i => variantRelative(i.avg_views || 0, creatorMedianViews) != null)
          .sort((a, b) =>
            variantRelative(b.avg_views || 0, creatorMedianViews) - variantRelative(a.avg_views || 0, creatorMedianViews),
          );
        const top5V1Topics = new Set(rankedV1.slice(0, 5).map(i => i.topic));
        const top5V2Topics = new Set(rankedV2.slice(0, 5).map(i => i.topic));
        const rankChanges  = [...top5V2Topics].filter(t => !top5V1Topics.has(t)).length;
        console.log(`\n  Ranking impact: ${rankChanges}/5 top ideas would change with Variant 2`);
        console.log(`  Topics with relative data: ${topicsWithRelative}/${ideas.length}`);
      }
      console.log('');
    }

    console.log('\n[LIMITATION] Cannot compute save-rate correlation without wtp_impressions data.');
    console.log('Score distribution analysis complete. Re-run after impressions accumulate.');
    db.close();
    return;
  }

  // ── Full correlation analysis (when impression data is available) ──────────
  const topChannels = db.all(`
    SELECT channel_id, COUNT(*) AS impressions
    FROM wtp_impressions
    WHERE created_at >= ?
    GROUP BY channel_id
    ORDER BY impressions DESC
    LIMIT ?
  `, [since, TOP_CHANNELS]);

  const variantStats = {
    v1: { rank_sum: 0, n: 0, save_top5: 0, save_all: 0 },
    v2: { rank_sum: 0, n: 0, save_top5: 0, save_all: 0 },
    v3: { rank_sum: 0, n: 0, save_top5: 0, save_all: 0 },
  };

  for (const ch of topChannels) {
    const creatorViews = db.all(
      `SELECT views FROM ingested_videos WHERE channel_id = ? AND views IS NOT NULL ORDER BY views LIMIT 200`,
      [ch.channel_id],
    ).map(r => r.views);
    const creatorMedianViews = median(creatorViews);

    const topics = db.all(`
      SELECT
        i.topic,
        i.score,
        AVG(i.score) AS avg_score,
        COUNT(*) AS impressions,
        SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) AS saves,
        SUM(CASE WHEN b.id IS NOT NULL THEN 1 ELSE 0 END) AS briefs
      FROM wtp_impressions i
      LEFT JOIN wtp_saves             s ON i.idea_key = s.idea_key
      LEFT JOIN wtp_brief_generations b ON i.idea_key = b.idea_key
      WHERE i.channel_id = ? AND i.created_at >= ?
      GROUP BY i.topic
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `, [ch.channel_id, since]);

    // For each topic, get peer median views from ingested_videos by title match
    for (const t of topics) {
      const tokens = String(t.topic || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4).slice(0, 2);
      if (tokens.length === 0) continue;
      const likeClause = tokens.map(() => 'LOWER(iv.title) LIKE ?').join(' AND ');
      const likeParams = tokens.map(w => '%' + w + '%');
      const peerRow = db.get(`
        SELECT AVG(iv.views) AS peer_avg
        FROM ingested_videos iv
        WHERE ${likeClause} AND iv.channel_id != ? AND iv.views IS NOT NULL
        LIMIT 1
      `, [...likeParams, ch.channel_id]);
      const peerMedianViews = peerRow?.peer_avg || 0;

      const v1 = variantAbsolute(peerMedianViews);
      const v2 = variantRelative(peerMedianViews, creatorMedianViews);
      const v3 = variantHybrid(peerMedianViews, creatorMedianViews);

      if (v2 == null) continue;

      variantStats.v1.rank_sum  += v1;
      variantStats.v1.n         += 1;
      variantStats.v1.save_all  += t.saves;
      variantStats.v2.rank_sum  += v2;
      variantStats.v2.n         += 1;
      variantStats.v2.save_all  += t.saves;
      variantStats.v3.rank_sum  += v3;
      variantStats.v3.n         += 1;
      variantStats.v3.save_all  += t.saves;
    }
  }

  console.log('\n── Variant Score Distribution ────────────────────────────────────────────');
  console.log(pad('variant', 20) + rpad('topics', 10) + rpad('avg_base_views', 16) + rpad('total_saves', 14));
  console.log('-'.repeat(60));
  for (const [vName, vs] of Object.entries(variantStats)) {
    if (vs.n === 0) { console.log(pad(vName, 20) + rpad('no data', 10)); continue; }
    console.log(
      pad(vName, 20) +
      rpad(vs.n, 10) +
      rpad((vs.rank_sum / vs.n).toFixed(2), 16) +
      rpad(vs.save_all, 14),
    );
  }

  console.log('\n── Decision Gate ─────────────────────────────────────────────────────────');
  const saveRateV1 = variantStats.v1.n > 0 ? variantStats.v1.save_all / variantStats.v1.n : null;
  const saveRateV2 = variantStats.v2.n > 0 ? variantStats.v2.save_all / variantStats.v2.n : null;
  const saveRateV3 = variantStats.v3.n > 0 ? variantStats.v3.save_all / variantStats.v3.n : null;

  if (saveRateV2 != null && saveRateV1 != null) {
    const diffV2 = ((saveRateV2 - saveRateV1) * 100).toFixed(2);
    const diffV3 = saveRateV3 != null ? ((saveRateV3 - saveRateV1) * 100).toFixed(2) : 'n/a';
    console.log(`V2 vs V1 save_rate difference: ${diffV2}pp`);
    console.log(`V3 vs V1 save_rate difference: ${diffV3}pp`);
    if (saveRateV2 > saveRateV1 + 0.05) {
      console.log('RESULT: V2 shows meaningful improvement. Hybrid (V3) recommended for safety.');
      console.log('ACTION: Proceed with Variant 3 (hybrid) implementation.');
    } else {
      console.log('RESULT: No meaningful improvement. Do NOT modify base_views formula.');
    }
  } else {
    console.log('RESULT: Insufficient data for decision. Collect more impressions and re-run.');
  }
  console.log('='.repeat(80) + '\n');

  db.close();
}

main();
