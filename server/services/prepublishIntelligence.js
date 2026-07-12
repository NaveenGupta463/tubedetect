'use strict';

const { resolveSemanticCluster, getSemanticBenchmark } = require('./semanticClusterService');
const { classifyDurationBucket } = require('../db/queries');

function getChannelProfile(db, channel_id) {
  if (!channel_id) return {};
  try {
    return db.get(
      'SELECT niche, primary_niche, routing_profile, format_profile FROM ingested_channels WHERE channel_id = ?',
      [channel_id],
    ) ?? {};
  } catch { return {}; }
}

// ── Empirical calibration lookup (Phase 2B shadow) ────────────────────────────

const CALIB_ALL_DIMS = [
  'calibNiche', 'routingProfile', 'formatProfile',
  'cluster', 'lifecycleStage', 'saturationLevel',
  'durationBucket', 'topicTier',
];

const CALIB_LEVELS = [
  { level: 1, dims: new Set(['calibNiche', 'routingProfile', 'formatProfile', 'cluster', 'lifecycleStage', 'saturationLevel', 'durationBucket', 'topicTier']) },
  { level: 2, dims: new Set(['calibNiche', 'cluster', 'lifecycleStage', 'saturationLevel']) },
  { level: 3, dims: new Set(['calibNiche', 'cluster', 'lifecycleStage']) },
  { level: 4, dims: new Set(['calibNiche', 'cluster']) },
  { level: 5, dims: new Set(['calibNiche', 'lifecycleStage']) },
  { level: 6, dims: new Set(['calibNiche']) },
];

function buildCalibCellKey(level, dims) {
  const { dims: included } = CALIB_LEVELS[level - 1];
  return CALIB_ALL_DIMS.map(d => (included.has(d) ? (dims[d] ?? '_') : '_')).join('|');
}

function lookupCalibrationCell(db, dims) {
  for (const { level } of CALIB_LEVELS) {
    const key = buildCalibCellKey(level, dims);
    try {
      const cell = db.get(
        'SELECT * FROM prepublish_calibration_cells WHERE cell_key = ? LIMIT 1',
        [key],
      );
      if (cell && ['medium', 'high'].includes(cell.calibration_confidence)) {
        return { cell, level };
      }
    } catch { /* table may not exist in dev */ }
  }
  return { cell: null, level: 7 };
}

function getNicheBenchmark(db, niche, durationBucket) {
  if (!niche) return null;
  try {
    return db.get(
      'SELECT * FROM niche_benchmarks WHERE niche = ? AND bucket = ? AND duration_bucket = ?',
      [niche, '7d', durationBucket ?? 'unknown'],
    ) ?? null;
  } catch { return null; }
}

function getTopicSignals(db, title, niche) {
  if (!niche) return null;
  try {
    const rows = db.all(
      `SELECT topic, signal_tier, signal_score, avg_vph_30d, vph_direction
       FROM topic_signal_stats WHERE niche = ? ORDER BY signal_score DESC LIMIT 50`,
      [niche],
    );
    if (!rows.length) return null;
    const titleLower = title.toLowerCase();
    const match = rows.find(r => titleLower.includes(r.topic.toLowerCase()));
    if (!match) return null;
    return {
      topic:     match.topic,
      tier:      match.signal_tier,
      score:     match.signal_score,
      avg_vph:   match.avg_vph_30d,
      direction: match.vph_direction,
    };
  } catch { return null; }
}

function getLifecycleData(db, channel_id, title) {
  if (!channel_id) return null;
  try {
    const rows = db.all(
      `SELECT phrase, stage, avg_views_on_topic
       FROM creator_topic_lifecycle WHERE channel_id = ? ORDER BY video_count DESC LIMIT 100`,
      [channel_id],
    );
    if (!rows.length) return null;
    const titleLower = title.toLowerCase();
    const match = rows.find(r => titleLower.includes(r.phrase.toLowerCase()));
    if (!match) return null;
    return { stage: match.stage, phrase: match.phrase, avg_views: match.avg_views_on_topic };
  } catch { return null; }
}

function getNearestPeers(db, cluster, niche, limit) {
  try {
    return db.all(
      `SELECT iv.title, iv.channel_name, vgs.views_per_hour AS vph_7d
       FROM ingested_videos iv
       JOIN semantic_embeddings se
         ON se.source_id = iv.youtube_video_id
        AND se.source_type = 'title_dna'
        AND se.semantic_cluster = ?
       LEFT JOIN video_growth_snapshots vgs
         ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
       WHERE iv.niche = ? AND iv.youtube_video_id IS NOT NULL
       ORDER BY COALESCE(vgs.views_per_hour, -1) DESC
       LIMIT ?`,
      [cluster, niche, limit],
    ).map(r => ({ title: r.title, channel_name: r.channel_name, vph_7d: r.vph_7d ?? null }));
  } catch { return []; }
}

const TIER_TOPIC_SCORE = { rising: 30, emerging: 22, stable: 15, peaking: 10, noise: 3 };
const STAGE_SAT_SCORE  = { pre_topic: 30, seed: 30, early: 24, regular: 15, exiting: 8, saturated: 3 };
const STAGE_SAT_LEVEL  = { pre_topic: 'low', seed: 'low', early: 'low', regular: 'medium', exiting: 'high', saturated: 'very_high' };

// Guard 2 — archetype component ceiling based on available evidence quality.
// Returns the max value archetypeScore may take (out of 40).
function computeArchetypeCap(nicheBenchmark, peerCount, peerAvgVph) {
  let cap = 40;
  // Rule 2c — niche median VPH < 10 makes raw global-cluster ratios unreliable
  if (nicheBenchmark?.median_vph != null && nicheBenchmark.median_vph < 10) cap = Math.min(cap, 30);
  // Rule 2b — no niche-cluster peer VPH data; scoring off global avg only
  if (peerAvgVph == null) cap = Math.min(cap, 30);
  // Rule 2a — fewer than 3 peers with actual VPH evidence (tightest guard)
  if (peerCount < 3) cap = Math.min(cap, 25);
  return cap;
}

// Guard 1 — confidence gate on final adjustment magnitude.
function applyConfidenceGuard(dataAdjustment, dataConfidence) {
  if (dataConfidence === 'none') return 0;
  if (dataConfidence === 'low')  return Math.max(-3, Math.min(3, dataAdjustment));
  return dataAdjustment;
}

function computeScores({ clusterBenchmark, nicheBenchmark, topicSignals, lifecycleData, peerCount, peerAvgVph }) {
  // Component 1 — archetype performance vs niche (0–40, capped by evidence guards)
  const archetypeCap = computeArchetypeCap(nicheBenchmark, peerCount ?? 0, peerAvgVph ?? null);
  let archetypeScore = 20;
  if (clusterBenchmark?.avg_vph && nicheBenchmark?.median_vph && nicheBenchmark.median_vph > 0) {
    const ratio = clusterBenchmark.avg_vph / nicheBenchmark.median_vph;
    let raw;
    if      (ratio >= 2.0) raw = 40;
    else if (ratio >= 1.5) raw = 32;
    else if (ratio >= 1.0) raw = 24;
    else if (ratio >= 0.7) raw = 14;
    else                   raw = 6;
    archetypeScore = Math.min(raw, archetypeCap);
  } else if (!clusterBenchmark) {
    archetypeScore = 0;
  } else {
    // cluster present but no niche benchmark — neutral default, still subject to cap
    archetypeScore = Math.min(20, archetypeCap);
  }

  // Component 2 — topic trend signal (0–30)
  const topicScore = topicSignals ? (TIER_TOPIC_SCORE[topicSignals.tier] ?? 15) : 15;

  // Component 3 — saturation / lifecycle (0–30)
  const saturationScore = lifecycleData ? (STAGE_SAT_SCORE[lifecycleData.stage] ?? 15) : 15;

  const intelligenceFitScore = Math.min(100, archetypeScore + topicScore + saturationScore);

  // data_adjustment: neutral zone 35–65, max ±10 (confidence guard applied separately)
  let dataAdjustment = 0;
  if (intelligenceFitScore > 65) {
    dataAdjustment = Math.max(1, Math.round((intelligenceFitScore - 65) / 35 * 10));
  } else if (intelligenceFitScore < 35) {
    dataAdjustment = Math.min(-1, Math.round((intelligenceFitScore - 35) / 35 * 10));
  }
  dataAdjustment = Math.max(-10, Math.min(10, dataAdjustment));

  return { intelligenceFitScore, archetypeScore, topicScore, saturationScore, dataAdjustment };
}

function buildAdjustmentReasons({ clusterBenchmark, nicheBenchmark, topicSignals, lifecycleData }) {
  const reasons = [];
  if (clusterBenchmark?.avg_vph && nicheBenchmark?.median_vph && nicheBenchmark.median_vph > 0) {
    const ratio = clusterBenchmark.avg_vph / nicheBenchmark.median_vph;
    if (ratio >= 1.5) {
      reasons.push(`"${clusterBenchmark.cluster}" archetype earns ${ratio.toFixed(1)}× niche median VPH`);
    } else if (ratio < 0.7) {
      reasons.push(`"${clusterBenchmark.cluster}" archetype underperforms niche median by ${Math.round((1 - ratio) * 100)}%`);
    }
  }
  if (topicSignals) {
    const labels = { rising: 'rising', emerging: 'emerging', stable: 'stable', peaking: 'peaking', noise: 'declining' };
    reasons.push(`Topic "${topicSignals.topic}" is ${labels[topicSignals.tier] ?? topicSignals.tier} in this niche`);
  }
  if (lifecycleData) {
    const labels = { pre_topic: 'not yet covered', seed: 'freshly introduced', early: 'gaining early traction', regular: 'well-covered', exiting: 'fading from your channel', saturated: 'saturated on your channel' };
    reasons.push(`You have ${labels[lifecycleData.stage] ?? lifecycleData.stage} history on "${lifecycleData.phrase}"`);
  }
  return reasons;
}

function computeDataConfidence(clusterBenchmark, nicheBenchmark) {
  const hasBoth = clusterBenchmark && nicheBenchmark;
  if (hasBoth && clusterBenchmark.sample_size > 50 && nicheBenchmark.sample_size > 20) return 'high';
  if (hasBoth && (clusterBenchmark.sample_size > 20 || nicheBenchmark.sample_size > 10)) return 'medium';
  if (clusterBenchmark || nicheBenchmark) return 'low';
  return 'none';
}

async function computePrepublishIntelligence(db, { title, niche, channel_id, duration_seconds }) {
  const channelProfile   = getChannelProfile(db, channel_id);
  const resolvedNiche    = niche || channelProfile.niche || null;
  const durationBucket   = classifyDurationBucket(duration_seconds);
  const semantic         = resolveSemanticCluster(db, title, null);
  const cluster          = semantic?.cluster ?? null;
  const clusterBenchmark = cluster ? getSemanticBenchmark(db, cluster) : null;
  const nicheBenchmark   = getNicheBenchmark(db, resolvedNiche, durationBucket);
  const topicSignals     = getTopicSignals(db, title, resolvedNiche);
  const lifecycleData    = getLifecycleData(db, channel_id, title);

  // Peers computed before scores — peer count and avg VPH feed the archetype cap guards
  const nearestPeers  = (cluster && resolvedNiche) ? getNearestPeers(db, cluster, resolvedNiche, 5) : [];
  const peersWithVph  = nearestPeers.filter(p => p.vph_7d != null);
  const peerCount     = peersWithVph.length;
  const peerAvgVph    = peerCount > 0
    ? Math.round(peersWithVph.reduce((s, p) => s + p.vph_7d, 0) / peerCount)
    : null;

  const { intelligenceFitScore, archetypeScore, topicScore, saturationScore, dataAdjustment } =
    computeScores({ clusterBenchmark, nicheBenchmark, topicSignals, lifecycleData, peerCount, peerAvgVph });

  const adjustmentReasons = buildAdjustmentReasons({ clusterBenchmark, nicheBenchmark, topicSignals, lifecycleData });
  const dataConfidence    = computeDataConfidence(clusterBenchmark, nicheBenchmark);

  // Guard 1 — confidence gate applied after all other scoring
  const guardedAdjustment = applyConfidenceGuard(dataAdjustment, dataConfidence);

  const saturationLevel = lifecycleData ? (STAGE_SAT_LEVEL[lifecycleData.stage] ?? 'medium') : null;

  // ── Phase 2B shadow calibration lookup ─────────────────────────────────────
  const calibNiche = channelProfile.routing_profile || channelProfile.primary_niche || resolvedNiche;
  const topicTier  = topicSignals?.tier ?? null;

  const { cell: calibCell, level: calibLevel } = lookupCalibrationCell(db, {
    calibNiche,
    routingProfile:  channelProfile.routing_profile ?? null,
    formatProfile:   channelProfile.format_profile  ?? null,
    cluster,
    lifecycleStage:  lifecycleData?.stage ?? null,
    saturationLevel,
    durationBucket,
    topicTier,
  });

  const empiricalAdj  = calibCell?.empirical_adjustment ?? 0;
  const negativeStatus = empiricalAdj < 0 ? 'shadow_only_unsafe' : null;

  const calibExplanation = calibCell
    ? `${calibCell.niche} (L${calibLevel}): ${((calibCell.beat_median_rate_7d ?? 0) * 100).toFixed(1)}% beat vs ${((calibCell.baseline_niche_rate_7d ?? 0) * 100).toFixed(1)}% baseline (${calibCell.lift_vs_baseline >= 0 ? '+' : ''}${((calibCell.lift_vs_baseline ?? 0) * 100).toFixed(1)}pp, n=${calibCell.sample_size_7d})`
    : null;

  return {
    semantic_cluster:       cluster,
    cluster_avg_vph:        clusterBenchmark?.avg_vph       ?? null,
    cluster_cohesion_tier:  clusterBenchmark?.cohesion_tier ?? null,
    cluster_sample_size:    clusterBenchmark?.sample_size   ?? null,
    nearest_peers:          nearestPeers,
    peer_avg_vph:           peerAvgVph,
    peer_count:             peerCount,
    niche_benchmark:        nicheBenchmark ? {
      median_vph:      nicheBenchmark.median_vph,
      p75_vph:         nicheBenchmark.p75_vph,
      p90_vph:         nicheBenchmark.p90_vph,
      median_sav:      nicheBenchmark.median_sav,
      median_vsr:      nicheBenchmark.median_vsr,
      sample_size:     nicheBenchmark.sample_size,
      duration_bucket: durationBucket,
    } : null,
    topic_signals:          topicSignals,
    saturation_level:       saturationLevel,
    lifecycle_stage:        lifecycleData?.stage ?? null,
    intelligence_fit_score: intelligenceFitScore,
    data_adjustment:        guardedAdjustment,
    adjustment_reasons:     adjustmentReasons,
    data_confidence:        dataConfidence,
    // Phase 2B shadow calibration — not applied to score
    empirical_adjustment:        empiricalAdj,
    calibration_cell_used:       calibCell?.cell_key ?? null,
    calibration_confidence:      calibCell?.calibration_confidence ?? null,
    observed_beat_rate:          calibCell?.beat_median_rate_7d ?? null,
    baseline_beat_rate:          calibCell?.baseline_niche_rate_7d ?? null,
    lift_vs_baseline:            calibCell?.lift_vs_baseline ?? null,
    cell_level:                  calibLevel,
    calibration_explanation:     calibExplanation,
    calibration_mode:            'shadow',
    negative_adjustment_status:  negativeStatus,
    calibration_niche:           calibNiche,
  };
}

module.exports = { computePrepublishIntelligence };
