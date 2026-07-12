'use strict';

// D2 — Aggregation engine for hook_type_performance.
// Classifies every ingested video title, groups by (niche, hook_type, duration_bucket),
// computes VPH stats + hook_score, and upserts into hook_type_performance.
//
// Scheduled: Sunday 04:00 UTC (D8).
// Also callable on-demand: aggregateHookPerformance(db).

const cron = require('node-cron');
const { getDb } = require('../db/init');
const { classifyHookTypeMulti, CLASSIFIER_VERSION } = require('../services/hookClassifier');

// Duration bucket thresholds (seconds)
function durationBucket(seconds) {
  if (!seconds || seconds <= 0) return 'unknown';
  if (seconds < 240)  return 'short';    // <4 min
  if (seconds < 720)  return 'medium';   // 4–12 min
  if (seconds < 1800) return 'long';     // 12–30 min
  return 'ultralong';                    // 30+ min
}

// Percentile helper on a sorted array
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

// Median of unsorted array
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── D3: Hook score formula ────────────────────────────────────────────────────
// hook_score = avg_vph_percentile*0.40 + sample_depth*0.25 + recency*0.20 + consistency*0.15

function computeHookScore({ avg_vph, niche_p75_vph, sample_count, recency_days, consistency_score }) {
  // avg_vph percentile: 0–100 relative to niche p75 benchmark
  const vph_ref   = niche_p75_vph > 0 ? niche_p75_vph : 1;
  const vph_score = Math.min(100, Math.max(0, (avg_vph / vph_ref) * 100));

  // sample depth: 0–100 (saturates at 100 videos)
  const depth_score = Math.min(100, (sample_count / 100) * 100);

  // recency: based on most recent video in this group
  let recency_score = 0;
  if (recency_days <= 7)  recency_score = 100;
  else if (recency_days <= 30) recency_score = 70;
  else if (recency_days <= 90) recency_score = 40;
  else recency_score = 10;

  return parseFloat((
    vph_score        * 0.40 +
    depth_score      * 0.25 +
    recency_score    * 0.20 +
    (consistency_score ?? 50) * 0.15
  ).toFixed(1));
}

// ── D3.2: Confidence from sample depth + classification confidence ─────────
function computeConfidence(sample_count, avg_classifier_confidence) {
  const depth = Math.min(100, (sample_count / 50) * 100);
  const cls   = (avg_classifier_confidence ?? 0.7) * 100;
  return parseFloat((depth * 0.6 + cls * 0.4).toFixed(1));
}

// ── D2.5: Consistency score — lower variance = higher consistency ──────────
function computeConsistency(values) {
  if (values.length < 3) return 50;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 50;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // CV = 0 → 100%, CV >= 2 → 0%
  return parseFloat(Math.max(0, Math.min(100, (1 - cv / 2) * 100)).toFixed(1));
}

// ── D2.4: Momentum — recent 14d vs historical 90d baseline ───────────────
function computeMomentum(db, niche, hookType, durBucket) {
  try {
    const recentSql = `
      SELECT AVG(vgs.views_per_hour) avg_vph
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
      WHERE ic.primary_niche = ? AND iv.duration_seconds IS NOT NULL
        AND iv.published_at >= datetime('now', '-14 days')
        AND vgs.views_per_hour IS NOT NULL AND vgs.views_per_hour > 0`;

    const baseSql = `
      SELECT AVG(vgs.views_per_hour) avg_vph
      FROM ingested_videos iv
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
      WHERE ic.primary_niche = ? AND iv.duration_seconds IS NOT NULL
        AND iv.published_at BETWEEN datetime('now', '-90 days') AND datetime('now', '-14 days')
        AND vgs.views_per_hour IS NOT NULL AND vgs.views_per_hour > 0`;

    // We cannot filter by hook_type in SQL — use niche-level momentum as proxy
    const recent = db.get(recentSql, [niche])?.avg_vph ?? null;
    const base   = db.get(baseSql,   [niche])?.avg_vph ?? null;

    if (recent == null || base == null || base === 0) return 0;
    return parseFloat(((recent - base) / base * 100).toFixed(1));
  } catch { return 0; }
}

function momentumDirection(score) {
  if (score >  10) return 'rising';
  if (score < -10) return 'declining';
  return 'stable';
}

// ── Main aggregation ──────────────────────────────────────────────────────────

function aggregateHookPerformance(db) {
  const t0 = Date.now();

  // Load all ingested videos with VPH data (latest snapshot per video)
  const rows = db.all(`
    SELECT iv.youtube_video_id, iv.title, ic.primary_niche AS niche, iv.duration_seconds,
           iv.published_at,
           vgs.views_per_hour
    FROM ingested_videos iv
    JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
    JOIN (
      SELECT video_id, views_per_hour, snapshotted_at,
             ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshotted_at DESC) rn
      FROM video_growth_snapshots
      WHERE views_per_hour IS NOT NULL AND views_per_hour > 0
    ) vgs ON vgs.video_id = iv.youtube_video_id AND vgs.rn = 1
    WHERE iv.title IS NOT NULL AND ic.primary_niche IS NOT NULL
  `);

  if (!rows.length) {
    return { ok: true, skipped: true, reason: 'no rows with VPH data', ms: Date.now() - t0 };
  }

  // Step 1: classify every title using probabilistic multi-hook inference (Phase D)
  const classified = rows.map(r => {
    const cls = classifyHookTypeMulti(r.title);
    return {
      ...r,
      hookType:        cls.primary_hook,
      cls_conf:        cls.primary_hook_confidence,
      ambiguity:       cls.ambiguity_score,
      topSignals:      cls.predicted_hooks?.[0]?.signals ?? [],
      allPredictions:  cls.predicted_hooks ?? [],
      durBucket:       durationBucket(r.duration_seconds),
      pubDaysAgo:      r.published_at
        ? (Date.now() - new Date(r.published_at).getTime()) / 86_400_000
        : 999,
    };
  });

  // Step 2: group by (niche, hook_type, duration_bucket), skip 'unknown'
  // Phase 4 safety: groups track correlation signals only — not behavioral causation
  const groups = {};
  for (const r of classified) {
    if (r.hookType === 'unknown') continue;
    const key = `${r.niche}||${r.hookType}||${r.durBucket}`;
    if (!groups[key]) {
      groups[key] = {
        niche: r.niche, hookType: r.hookType, durBucket: r.durBucket,
        vphs: [], confs: [], ambiguities: [], signalCounts: {}, minDaysAgo: 999, titles: [],
      };
    }
    groups[key].vphs.push(r.views_per_hour);
    groups[key].confs.push(r.cls_conf);
    groups[key].ambiguities.push(r.ambiguity);
    groups[key].minDaysAgo = Math.min(groups[key].minDaysAgo, r.pubDaysAgo);
    if (groups[key].titles.length < 5) groups[key].titles.push(r.title);
    for (const sig of r.topSignals) {
      groups[key].signalCounts[sig] = (groups[key].signalCounts[sig] ?? 0) + 1;
    }
  }

  // Step 3: get per-niche p75 vph benchmark for relative scoring
  const nicheBenchmarks = {};
  const benchRows = db.all(`
    SELECT niche, AVG(p75_vph) avg_p75
    FROM niche_benchmarks WHERE bucket = '7d' AND p75_vph > 0
    GROUP BY niche
  `);
  for (const b of benchRows) nicheBenchmarks[b.niche] = b.avg_p75;

  // Step 4: compute metrics per group
  let upserted = 0;
  const momentumCache = {};

  for (const [, g] of Object.entries(groups)) {
    const sorted = [...g.vphs].sort((a, b) => a - b);
    const avg_vph  = g.vphs.reduce((s, v) => s + v, 0) / g.vphs.length;
    const med_vph  = median(g.vphs);
    const p75_vph  = percentile(sorted, 75);
    const consistency = computeConsistency(g.vphs);
    const avg_conf    = g.confs.reduce((s, v) => s + v, 0) / g.confs.length;

    // Phase D probabilistic metadata
    const avg_ambiguity  = g.ambiguities.reduce((s, v) => s + (v ?? 0), 0) / g.ambiguities.length;
    const topSignals     = Object.entries(g.signalCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([sig, cnt]) => ({ sig, cnt }));

    const benchRef = nicheBenchmarks[g.niche] ?? avg_vph;
    const hook_score = computeHookScore({
      avg_vph,
      niche_p75_vph: benchRef,
      sample_count:  g.vphs.length,
      recency_days:  g.minDaysAgo,
      consistency_score: consistency,
    });
    const confidence = computeConfidence(g.vphs.length, avg_conf);

    // Momentum: cache per niche to avoid N duplicate queries
    const mcKey = `${g.niche}||${g.durBucket}`;
    if (!(mcKey in momentumCache)) {
      momentumCache[mcKey] = computeMomentum(db, g.niche, g.hookType, g.durBucket);
    }
    const momentum_score = momentumCache[mcKey];
    const trend_direction = momentumDirection(momentum_score);

    try {
      db.run(`
        INSERT INTO hook_type_performance
          (niche, hook_type, duration_bucket, avg_vph, median_vph, p75_vph,
           consistency_score, momentum_score, sample_count, hook_score,
           confidence_score, trend_direction, example_titles_json,
           primary_hook_confidence, avg_ambiguity_score, inference_version, top_signals_json,
           updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        ON CONFLICT(niche, hook_type, duration_bucket) DO UPDATE SET
          avg_vph                 = excluded.avg_vph,
          median_vph              = excluded.median_vph,
          p75_vph                 = excluded.p75_vph,
          consistency_score       = excluded.consistency_score,
          momentum_score          = excluded.momentum_score,
          sample_count            = excluded.sample_count,
          hook_score              = excluded.hook_score,
          confidence_score        = excluded.confidence_score,
          trend_direction         = excluded.trend_direction,
          example_titles_json     = excluded.example_titles_json,
          primary_hook_confidence = excluded.primary_hook_confidence,
          avg_ambiguity_score     = excluded.avg_ambiguity_score,
          inference_version       = excluded.inference_version,
          top_signals_json        = excluded.top_signals_json,
          updated_at              = datetime('now')
      `, [
        g.niche, g.hookType, g.durBucket,
        parseFloat(avg_vph.toFixed(2)),
        parseFloat(med_vph.toFixed(2)),
        parseFloat(p75_vph.toFixed(2)),
        consistency,
        momentum_score,
        g.vphs.length,
        hook_score,
        confidence,
        trend_direction,
        JSON.stringify(g.titles),
        parseFloat(avg_conf.toFixed(3)),
        parseFloat(avg_ambiguity.toFixed(3)),
        CLASSIFIER_VERSION,
        JSON.stringify(topSignals),
      ]);
      upserted++;
    } catch (e) {
      console.warn('[hookAgg] upsert failed:', g.niche, g.hookType, g.durBucket, e.message);
    }
  }

  const ms = Date.now() - t0;
  console.log(`[hookAgg] done — ${rows.length} videos → ${Object.keys(groups).length} groups → ${upserted} upserted in ${ms}ms`);
  return {
    ok: true,
    videos_processed: rows.length,
    classified_non_unknown: classified.filter(r => r.hookType !== 'unknown').length,
    unknown_count: classified.filter(r => r.hookType === 'unknown').length,
    groups: Object.keys(groups).length,
    upserted,
    ms,
  };
}

function startHookAggregationCron() {
  // Sunday 04:00 UTC (D8)
  cron.schedule('0 4 * * 0', () => {
    try {
      const db     = getDb();
      const result = aggregateHookPerformance(db);
      console.log('[hookAgg] cron complete', JSON.stringify(result));
    } catch (e) {
      console.error('[hookAgg] cron error:', e.message);
    }
  });
}

module.exports = { aggregateHookPerformance, startHookAggregationCron };
