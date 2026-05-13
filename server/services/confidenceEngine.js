'use strict';

// Confidence Engine — measures whether TubeIntel has enough learning signal
// to operate each feature autonomously, without Claude API calls.
//
// Routing thresholds:
//   >= 80  → autonomous      (local inference only)
//   60–79  → local_first     (local result + optional Claude enrichment)
//   40–59  → hybrid          (statistical context injected into Claude prompt)
//   0–39   → mandatory_claude (full Claude reasoning required)
//
// IMPORTANT: real_ratio_score is ALWAYS 0 until real creator predictions exist
// in video_outcomes. Do NOT inflate this score artificially.

const FEATURES = [
  'niche_research',
  'viral_formula',
  'pattern_ranking',
  'title_generation',
  'upload_timing',
  'hook_intelligence',
  'channel_classification',
];

// ── Math helpers ──────────────────────────────────────────────────────────────

function clamp(n) { return Math.min(100, Math.max(0, n || 0)); }

function sampleDepthScore(n, threshold) {
  return clamp((n / threshold) * 100);
}

// Recency: how fresh is the underlying data?
function recencyScore(isoStr) {
  if (!isoStr) return 0;
  const ageDays = (Date.now() - new Date(isoStr).getTime()) / 86_400_000;
  if (ageDays <= 1)  return 100;
  if (ageDays <= 7)  return 80;
  if (ageDays <= 30) return 50;
  if (ageDays <= 90) return 20;
  return 0;
}

function routingDecision(score) {
  if (score >= 80) return 'autonomous';
  if (score >= 60) return 'local_first';
  if (score >= 40) return 'hybrid';
  return 'mandatory_claude';
}

function weightedScore(c) {
  return parseFloat((
    c.sample_depth_score * 0.30 +
    c.recency_score      * 0.20 +
    c.coverage_score     * 0.20 +
    c.real_ratio_score   * 0.20 +
    c.stability_score    * 0.10
  ).toFixed(1));
}

// ── Shared real-ratio helper (calibration pipeline outcomes) ─────────────────
// Returns 0 until real (non-synthetic) creator predictions exist.

function calibrationRealRatio(db, niche) {
  const row = niche
    ? db.get(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) real_rows
         FROM video_outcomes WHERE niche = ?`,
        [niche])
    : db.get(
        `SELECT COUNT(*) total,
                SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) real_rows
         FROM video_outcomes`);
  const total = row?.total ?? 0;
  const real  = row?.real_rows ?? 0;
  // SPEC: must be 0 when real outcome rows = 0
  return total > 0 && real > 0 ? clamp((real / total) * 100) : 0;
}

// ── Per-feature signal computations ──────────────────────────────────────────
// Each returns { sample_depth_score, recency_score, coverage_score,
//                real_ratio_score, stability_score, _raw }
// _raw contains the underlying counts used for debugging/display.

function signalsNicheResearch(db, niche) {
  const vids = niche
    ? db.get('SELECT COUNT(*) n, MAX(last_refreshed_at) recent FROM ingested_videos WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(*) n, MAX(last_refreshed_at) recent FROM ingested_videos');

  // Coverage: how many benchmark rows exist with usable p75_vph data
  const bench = niche
    ? db.get('SELECT COUNT(*) n FROM niche_benchmarks WHERE p75_vph > 0 AND niche = ?', [niche])
    : db.get('SELECT COUNT(*) n FROM niche_benchmarks WHERE p75_vph > 0');

  // Stability: distinct benchmark snapshot batches (more = more stable history)
  const batches = niche
    ? db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history');

  return {
    sample_depth_score: sampleDepthScore(vids?.n ?? 0, 500),
    recency_score:      recencyScore(vids?.recent),
    coverage_score:     clamp(((bench?.n ?? 0) / 15) * 100),
    real_ratio_score:   calibrationRealRatio(db, niche),
    stability_score:    clamp(((batches?.n ?? 0) / 4) * 100),
    _raw: {
      videos:           vids?.n ?? 0,
      benchmark_rows:   bench?.n ?? 0,
      batches:          batches?.n ?? 0,
      note: 'real_ratio=0 until real creator predictions exist',
    },
  };
}

function signalsViralFormula(db, niche) {
  const vids = niche
    ? db.get('SELECT COUNT(*) n, MAX(last_refreshed_at) recent FROM ingested_videos WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(*) n, MAX(last_refreshed_at) recent FROM ingested_videos');

  // Coverage: benchmark rows with p75_vph for the primary 7d bucket
  const bench = niche
    ? db.get("SELECT COUNT(*) n FROM niche_benchmarks WHERE p75_vph > 0 AND bucket = '7d' AND niche = ?", [niche])
    : db.get("SELECT COUNT(*) n FROM niche_benchmarks WHERE p75_vph > 0 AND bucket = '7d'");

  const batches = niche
    ? db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history');

  return {
    sample_depth_score: sampleDepthScore(vids?.n ?? 0, 300),
    recency_score:      recencyScore(vids?.recent),
    coverage_score:     clamp(((bench?.n ?? 0) / 10) * 100),
    real_ratio_score:   calibrationRealRatio(db, niche),
    stability_score:    clamp(((batches?.n ?? 0) / 3) * 100),
    _raw: {
      videos:          vids?.n ?? 0,
      bench_7d_rows:   bench?.n ?? 0,
      batches:         batches?.n ?? 0,
      note: 'viral_formula needs real outcome validation for full confidence',
    },
  };
}

function signalsPatternRanking(db, niche) {
  // Videos with actual VPH data = the corpus for pattern ranking
  const vphData = niche
    ? db.get(
        `SELECT COUNT(DISTINCT iv.youtube_video_id) n, MAX(vgs.snapshotted_at) recent
         FROM ingested_videos iv
         JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
         WHERE vgs.views_per_hour IS NOT NULL AND iv.niche = ?`,
        [niche])
    : db.get(
        `SELECT COUNT(DISTINCT iv.youtube_video_id) n, MAX(vgs.snapshotted_at) recent
         FROM ingested_videos iv
         JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id
         WHERE vgs.views_per_hour IS NOT NULL`);

  // Coverage: how many distinct duration buckets exist (short/medium/long = 3 max)
  const durBuckets = niche
    ? db.get('SELECT COUNT(DISTINCT duration_bucket) n FROM niche_benchmarks WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(DISTINCT duration_bucket) n FROM niche_benchmarks');

  const batches = niche
    ? db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(DISTINCT snapshot_batch_id) n FROM niche_benchmark_history');

  return {
    sample_depth_score: sampleDepthScore(vphData?.n ?? 0, 200),
    recency_score:      recencyScore(vphData?.recent),
    coverage_score:     clamp(((durBuckets?.n ?? 0) / 3) * 100),
    real_ratio_score:   calibrationRealRatio(db, niche),
    stability_score:    clamp(((batches?.n ?? 0) / 3) * 100),
    _raw: {
      videos_with_vph:  vphData?.n ?? 0,
      duration_buckets: durBuckets?.n ?? 0,
      batches:          batches?.n ?? 0,
    },
  };
}

function signalsTitleGeneration(db, niche) {
  // Only count titles published in the last 90 days (fresh corpus matters for title patterns)
  const recent = niche
    ? db.get(
        `SELECT COUNT(*) n, MAX(published_at) newest
         FROM ingested_videos
         WHERE published_at >= date('now', '-90 days') AND niche = ?`,
        [niche])
    : db.get(
        `SELECT COUNT(*) n, MAX(published_at) newest
         FROM ingested_videos
         WHERE published_at >= date('now', '-90 days')`);

  // Coverage: number of distinct source channels (diversity of title styles)
  const sources = niche
    ? db.get('SELECT COUNT(DISTINCT channel_id) n FROM ingested_videos WHERE niche = ?', [niche])
    : db.get('SELECT COUNT(DISTINCT channel_id) n FROM ingested_videos');

  return {
    sample_depth_score: sampleDepthScore(recent?.n ?? 0, 200),
    recency_score:      recencyScore(recent?.newest),
    coverage_score:     clamp(((sources?.n ?? 0) / 10) * 100),
    real_ratio_score:   calibrationRealRatio(db, niche),
    // Stability fixed at 50 until title_templates table has multi-day history
    stability_score:    50,
    _raw: {
      recent_90d_titles: recent?.n ?? 0,
      source_channels:   sources?.n ?? 0,
      note: 'stability=50 baseline until title_templates table is populated (Phase E)',
    },
  };
}

function signalsUploadTiming(db, niche) {
  // Count distinct hour×day cells with >= 5 videos (enough to be statistically useful)
  const cellsSql = niche
    ? `SELECT COUNT(*) n FROM (
         SELECT strftime('%H', published_at) h, strftime('%w', published_at) d
         FROM ingested_videos
         WHERE published_at IS NOT NULL AND niche = ?
         GROUP BY h, d HAVING COUNT(*) >= 5
       )`
    : `SELECT COUNT(*) n FROM (
         SELECT strftime('%H', published_at) h, strftime('%w', published_at) d
         FROM ingested_videos
         WHERE published_at IS NOT NULL
         GROUP BY h, d HAVING COUNT(*) >= 5
       )`;
  const cells = niche
    ? db.get(cellsSql, [niche])
    : db.get(cellsSql);

  const recentPub = niche
    ? db.get('SELECT MAX(published_at) newest FROM ingested_videos WHERE niche = ?', [niche])
    : db.get('SELECT MAX(published_at) newest FROM ingested_videos');

  // Coverage: fraction of 24 hours covered by at least 1 video
  const hoursCov = niche
    ? db.get(
        `SELECT COUNT(DISTINCT strftime('%H', published_at)) n
         FROM ingested_videos WHERE published_at IS NOT NULL AND niche = ?`,
        [niche])
    : db.get(
        `SELECT COUNT(DISTINCT strftime('%H', published_at)) n
         FROM ingested_videos WHERE published_at IS NOT NULL`);

  // Real ratio: fraction of ingested videos that have a VPH snapshot (7d bucket)
  // NOTE: for upload_timing, "real" means VPH data availability, NOT calibration outcomes
  const vphCov = niche
    ? db.get(
        `SELECT SUM(CASE WHEN vgs.video_id IS NOT NULL THEN 1 ELSE 0 END) has_vph,
                COUNT(iv.youtube_video_id) total
         FROM ingested_videos iv
         LEFT JOIN video_growth_snapshots vgs
           ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
         WHERE iv.niche = ?`,
        [niche])
    : db.get(
        `SELECT SUM(CASE WHEN vgs.video_id IS NOT NULL THEN 1 ELSE 0 END) has_vph,
                COUNT(iv.youtube_video_id) total
         FROM ingested_videos iv
         LEFT JOIN video_growth_snapshots vgs
           ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'`);

  const totalVph  = vphCov?.total ?? 0;
  const realRatio = totalVph > 0 ? clamp((vphCov.has_vph / totalVph) * 100) : 0;

  return {
    sample_depth_score: clamp(((cells?.n ?? 0) / 50) * 100),
    recency_score:      recencyScore(recentPub?.newest),
    coverage_score:     clamp(((hoursCov?.n ?? 0) / 24) * 100),
    real_ratio_score:   realRatio,
    // Timing is inherently stable — the best hour to post doesn't shift week-to-week
    stability_score:    100,
    _raw: {
      cells_min5:        cells?.n ?? 0,
      hours_covered:     hoursCov?.n ?? 0,
      vph_coverage_pct:  totalVph > 0 ? +((vphCov.has_vph / totalVph) * 100).toFixed(1) : 0,
      note: 'real_ratio = VPH data coverage, not calibration outcomes',
    },
  };
}

function signalsHookIntelligence(db, niche) {
  const vids = niche
    ? db.get(
        'SELECT COUNT(*) n, MAX(ingested_at) recent FROM ingested_videos WHERE title IS NOT NULL AND niche = ?',
        [niche])
    : db.get(
        'SELECT COUNT(*) n, MAX(ingested_at) recent FROM ingested_videos WHERE title IS NOT NULL');

  const n = vids?.n ?? 0;

  // Real ratio: fraction of (niche, hook_type) rows in hook_type_performance that have
  // enough sample depth (≥10) to be trustworthy
  let real_ratio_score = 0;
  let stability_score  = 50;
  try {
    const htp = niche
      ? db.get(
          `SELECT COUNT(*) total,
                  SUM(CASE WHEN sample_count >= 10 THEN 1 ELSE 0 END) reliable
           FROM hook_type_performance WHERE niche = ?`,
          [niche])
      : db.get(
          `SELECT COUNT(*) total,
                  SUM(CASE WHEN sample_count >= 10 THEN 1 ELSE 0 END) reliable
           FROM hook_type_performance`);

    const total = htp?.total ?? 0;
    const rel   = htp?.reliable ?? 0;
    if (total > 0) {
      real_ratio_score = clamp((rel / total) * 100);
      // Stability: coverage of 14 hook types across niches
      const hookTypes = niche
        ? db.get('SELECT COUNT(DISTINCT hook_type) n FROM hook_type_performance WHERE niche = ?', [niche])
        : db.get('SELECT COUNT(DISTINCT hook_type) n FROM hook_type_performance');
      stability_score = clamp(((hookTypes?.n ?? 0) / 14) * 100);
    }
  } catch { /* non-fatal — hook_type_performance may not exist yet */ }

  return {
    sample_depth_score: sampleDepthScore(n, 200),
    recency_score:      recencyScore(vids?.recent),
    coverage_score:     clamp((n / 140) * 100),
    real_ratio_score,
    stability_score,
    _raw: {
      videos_with_title: n,
      note: 'real_ratio derived from hook_type_performance reliability after Phase D aggregation',
    },
  };
}

function signalsChannelClassification(db, niche) {
  const channels = niche
    ? db.get(
        `SELECT COUNT(*) total, SUM(ingest_enabled) active,
                AVG(trust_score) avg_trust, MAX(added_at) recent
         FROM ingested_channels WHERE niche = ?`,
        [niche])
    : db.get(
        `SELECT COUNT(*) total, SUM(ingest_enabled) active,
                AVG(trust_score) avg_trust, MAX(added_at) recent
         FROM ingested_channels`);

  // Coverage: how many of the 19 known niches have at least 1 active channel
  const nichesCov = db.get(
    `SELECT COUNT(DISTINCT niche) n FROM ingested_channels WHERE ingest_enabled = 1`);

  const total    = channels?.total ?? 0;
  const active   = channels?.active ?? 0;
  const avgTrust = channels?.avg_trust ?? 0;

  return {
    sample_depth_score: sampleDepthScore(total, 20),
    recency_score:      recencyScore(channels?.recent),
    coverage_score:     clamp(((nichesCov?.n ?? 0) / 19) * 100),
    // trust_score (0–1) used as a proxy for classification quality
    real_ratio_score:   clamp(avgTrust * 100),
    stability_score:    total > 0 ? clamp((active / total) * 100) : 0,
    _raw: {
      total_channels:  total,
      active_channels: active,
      avg_trust:       +avgTrust.toFixed(3),
      niches_covered:  nichesCov?.n ?? 0,
      note: 'real_ratio uses avg trust_score as classification quality proxy',
    },
  };
}

// ── Dispatch table ────────────────────────────────────────────────────────────

const SIGNAL_FNS = {
  niche_research:       signalsNicheResearch,
  viral_formula:        signalsViralFormula,
  pattern_ranking:      signalsPatternRanking,
  title_generation:     signalsTitleGeneration,
  upload_timing:        signalsUploadTiming,
  hook_intelligence:    signalsHookIntelligence,
  channel_classification: signalsChannelClassification,
};

// ── Public API ────────────────────────────────────────────────────────────────

function computeFeatureConfidence(db, { feature, niche = null }) {
  const fn = SIGNAL_FNS[feature];
  if (!fn) {
    return {
      feature, niche, confidence: 0,
      routing_decision: 'mandatory_claude',
      components: {},
      reasons: [`Unknown feature: ${feature}`],
    };
  }

  const { _raw, ...components } = fn(db, niche);
  const confidence = weightedScore(components);
  const decision   = routingDecision(confidence);

  // Build human-readable reason list
  const reasons = [];
  if (components.real_ratio_score === 0)
    reasons.push('real_ratio=0 — no real outcome rows yet; max attainable confidence is 80');
  if (components.sample_depth_score < 30)
    reasons.push(`Low sample depth (${Math.round(components.sample_depth_score)}/100)`);
  if (components.recency_score < 50)
    reasons.push('Data is stale — last refresh >7 days ago');
  if (components.coverage_score < 40)
    reasons.push(`Coverage gap — insufficient niche/format diversity (${Math.round(components.coverage_score)}/100)`);
  if (components.stability_score < 40)
    reasons.push(`Low stability — benchmark history is thin (${Math.round(components.stability_score)}/100)`);
  if (reasons.length === 0)
    reasons.push('All signals healthy');

  return {
    feature,
    niche,
    confidence,
    routing_decision: decision,
    components,
    reasons,
    raw: _raw,
  };
}

function computeAllConfidences(db, niches = [null]) {
  const results = [];
  for (const niche of niches) {
    for (const feature of FEATURES) {
      try {
        results.push(computeFeatureConfidence(db, { feature, niche }));
      } catch (e) {
        results.push({
          feature, niche, confidence: 0,
          routing_decision: 'mandatory_claude',
          components: {}, reasons: [e.message],
        });
      }
    }
  }
  return results;
}

function computeRoutingDistribution(results) {
  const counts = { autonomous: 0, local_first: 0, hybrid: 0, mandatory_claude: 0 };
  for (const r of results) counts[r.routing_decision] = (counts[r.routing_decision] || 0) + 1;
  const total = results.length || 1;
  return {
    counts,
    pcts: Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, +((v / total) * 100).toFixed(1)]),
    ),
    fallback_rate: +((counts.mandatory_claude / total) * 100).toFixed(1),
  };
}

// Niches currently active in the ingested_videos corpus
function getActiveNiches(db) {
  return db.all('SELECT DISTINCT niche FROM ingested_videos ORDER BY niche').map(r => r.niche);
}

module.exports = {
  FEATURES,
  computeFeatureConfidence,
  computeAllConfidences,
  computeRoutingDistribution,
  getActiveNiches,
};
