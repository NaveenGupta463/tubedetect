'use strict';

const crypto = require('crypto');

const CATEGORIES = {
  HOOK:       'hook_strategy',
  TIMING:     'upload_timing',
  SEMANTIC:   'semantic_opportunity',
  NICHE:      'niche_positioning',
  PATTERN:    'content_pattern',
  EXPERIMENT: 'experiment_suggestion',
};

const RISK    = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const HORIZON = { NOW: 'immediate', WEEK: '1-2 weeks', MONTH: '1-3 months', LONG: '3+ months' };

function recId(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function clamp(x, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x ?? 0)); }

function priorityScore(impact, confidence, reliability, risk = RISK.MEDIUM, momentumBonus = 0) {
  const rp = risk === RISK.HIGH ? 0.5 : risk === RISK.MEDIUM ? 0.2 : 0;
  const raw = (impact * confidence * reliability) / (1 + rp);
  return clamp(raw + momentumBonus);
}

// ── HOOK RECOMMENDATIONS ──────────────────────────────────────────────────────

function hookRecommendations(db, niche) {
  const recs = [];
  const rows = db.all(
    `SELECT hook_type, avg_vph, median_vph, p75_vph, momentum_score,
            trend_direction, sample_count, hook_score, confidence_score
     FROM hook_type_performance
     WHERE niche = ? AND duration_bucket = 'all' AND sample_count >= 5
     ORDER BY hook_score DESC NULLS LAST`,
    [niche],
  );
  if (!rows.length) return recs;

  const validVphs      = rows.map(r => r.median_vph ?? 0).filter(v => v > 0);
  const overallMedian  = validVphs.length ? validVphs.reduce((s, v) => s + v, 0) / validVphs.length : 0;
  const avgSampleCount = rows.reduce((s, r) => s + (r.sample_count ?? 0), 0) / rows.length;

  // Rising hooks
  const rising = rows.filter(r => r.trend_direction === 'rising' && (r.confidence_score ?? 0) >= 0.35);
  for (const r of rising.slice(0, 2)) {
    const upliftPct  = overallMedian > 0 ? ((r.median_vph - overallMedian) / overallMedian) * 100 : 0;
    const impact     = clamp(Math.abs(upliftPct) / 100);
    const confidence = r.confidence_score ?? 0.5;
    const reliability = clamp((r.sample_count ?? 0) / 50);
    recs.push({
      recommendation_id: recId(`hook:rising:${niche}:${r.hook_type}`),
      category:          CATEGORIES.HOOK,
      niche,
      priority:          priorityScore(impact, confidence, reliability, RISK.LOW, 0.1),
      confidence,
      expected_impact:   impact,
      risk_level:        RISK.LOW,
      estimated_uplift:  upliftPct > 0 ? Math.round(upliftPct) : null,
      time_horizon:      HORIZON.WEEK,
      title: `Rising hook: "${r.hook_type.replace(/_/g, ' ')}" patterns gaining momentum in ${niche}`,
      reasoning: `"${r.hook_type.replace(/_/g, ' ')}" hooks trend upward in ${niche} with ${r.median_vph?.toFixed(1) ?? '—'} median VPH (${upliftPct >= 0 ? '+' : ''}${upliftPct.toFixed(0)}% vs niche median of ${overallMedian.toFixed(1)}). Momentum score: ${r.momentum_score?.toFixed(2) ?? 'N/A'}. Trend: rising. Based on ${r.sample_count} videos.`,
      supporting_evidence: { hook_type: r.hook_type, median_vph: r.median_vph, p75_vph: r.p75_vph, sample_count: r.sample_count, trend: r.trend_direction, hook_score: r.hook_score },
      source_signals: ['hook_type_performance', 'momentum_score', 'trend_direction'],
    });
  }

  // Underused high-performers (high hook_score, low sample count relative to avg)
  const underused = rows.filter(r =>
    (r.sample_count ?? 0) < avgSampleCount * 0.5 &&
    (r.hook_score ?? 0) >= 0.55 &&
    (r.confidence_score ?? 0) >= 0.35,
  );
  for (const r of underused.slice(0, 2)) {
    const upliftPct  = overallMedian > 0 ? ((r.median_vph - overallMedian) / overallMedian) * 100 : 0;
    const impact     = clamp(Math.abs(upliftPct) / 100);
    const confidence = r.confidence_score ?? 0.45;
    const reliability = clamp((r.sample_count ?? 0) / 50);
    recs.push({
      recommendation_id: recId(`hook:underused:${niche}:${r.hook_type}`),
      category:    CATEGORIES.HOOK,
      niche,
      priority:    priorityScore(impact, confidence, reliability, RISK.MEDIUM),
      confidence,
      expected_impact:  impact,
      risk_level:  RISK.MEDIUM,
      estimated_uplift: upliftPct > 0 ? Math.round(upliftPct) : null,
      time_horizon: HORIZON.WEEK,
      title: `Underused opportunity: "${r.hook_type.replace(/_/g, ' ')}" outperforms average but is underutilised in ${niche}`,
      reasoning: `"${r.hook_type.replace(/_/g, ' ')}" achieves ${r.median_vph?.toFixed(1) ?? '—'} median VPH but represents only ${r.sample_count} videos vs niche average of ${Math.round(avgSampleCount)}. Low competition combined with above-median performance indicates differentiation opportunity. Hook score: ${r.hook_score?.toFixed(2) ?? 'N/A'}.`,
      supporting_evidence: { hook_type: r.hook_type, median_vph: r.median_vph, sample_count: r.sample_count, avg_sample_count: Math.round(avgSampleCount), hook_score: r.hook_score },
      source_signals: ['hook_type_performance'],
    });
  }

  // Top-performing hook if distinct from rising/underused
  const top = rows[0];
  if (top && !rising.includes(top) && !underused.includes(top) && (top.hook_score ?? 0) > 0.65) {
    const upliftPct  = overallMedian > 0 ? ((top.median_vph - overallMedian) / overallMedian) * 100 : 0;
    recs.push({
      recommendation_id: recId(`hook:top:${niche}:${top.hook_type}`),
      category:    CATEGORIES.HOOK,
      niche,
      priority:    priorityScore(clamp(Math.abs(upliftPct) / 100), top.confidence_score ?? 0.6, clamp((top.sample_count ?? 0) / 50), RISK.LOW),
      confidence:  top.confidence_score ?? 0.6,
      expected_impact: clamp(Math.abs(upliftPct) / 100),
      risk_level:  RISK.LOW,
      estimated_uplift: upliftPct > 0 ? Math.round(upliftPct) : null,
      time_horizon: HORIZON.NOW,
      title: `Top hook in ${niche}: "${top.hook_type.replace(/_/g, ' ')}" shows highest hook score (${top.hook_score?.toFixed(2)})`,
      reasoning: `"${top.hook_type.replace(/_/g, ' ')}" ranks #1 in ${niche} by hook score with ${top.median_vph?.toFixed(1) ?? '—'} median VPH across ${top.sample_count} videos. P75: ${top.p75_vph?.toFixed(1) ?? '—'} VPH. Trend: ${top.trend_direction ?? 'stable'}.`,
      supporting_evidence: { hook_type: top.hook_type, median_vph: top.median_vph, p75_vph: top.p75_vph, sample_count: top.sample_count, trend: top.trend_direction },
      source_signals: ['hook_type_performance'],
    });
  }

  return recs;
}

// ── UPLOAD TIMING RECOMMENDATIONS ─────────────────────────────────────────────

function timingRecommendations(db, niche) {
  const rows = db.all(
    `SELECT
       CAST(strftime('%H', published_at) AS INTEGER) AS publish_hour,
       COUNT(*) AS video_count,
       AVG(CAST(views AS REAL) / MAX(1.0, (julianday('now') - julianday(published_at)) * 24)) AS avg_vph
     FROM ingested_videos
     WHERE niche = ?
       AND published_at IS NOT NULL
       AND published_at > datetime('now', '-90 days')
       AND (julianday('now') - julianday(published_at)) * 24 > 48
     GROUP BY publish_hour
     HAVING video_count >= 3
     ORDER BY avg_vph DESC`,
    [niche],
  );
  if (rows.length < 2) return [];

  const best       = rows[0];
  const overall    = rows.reduce((s, r) => s + (r.avg_vph ?? 0), 0) / rows.length;
  const upliftPct  = overall > 0 ? ((best.avg_vph - overall) / overall) * 100 : 0;
  if (upliftPct < 12) return [];

  const hourLabel  = `${String(best.publish_hour).padStart(2, '0')}:00–${String((best.publish_hour + 2) % 24).padStart(2, '0')}:00 UTC`;
  const topHours   = rows.slice(0, 3).map(r => ({ hour: `${String(r.publish_hour).padStart(2, '0')}:00`, avg_vph: parseFloat((r.avg_vph ?? 0).toFixed(1)), count: r.video_count }));
  const reliability = clamp((best.video_count ?? 0) / 20);

  return [{
    recommendation_id: recId(`timing:${niche}:h${best.publish_hour}`),
    category:    CATEGORIES.TIMING,
    niche,
    priority:    priorityScore(clamp(upliftPct / 100), 0.6, reliability, RISK.LOW),
    confidence:  0.6,
    expected_impact: clamp(upliftPct / 100),
    risk_level:  RISK.LOW,
    estimated_uplift: Math.round(upliftPct),
    time_horizon: HORIZON.NOW,
    title: `Upload window ${hourLabel} shows ${upliftPct.toFixed(0)}% higher VPH in ${niche}`,
    reasoning: `Videos published in the ${hourLabel} window achieve ${best.avg_vph?.toFixed(1)} avg VPH vs niche average of ${overall.toFixed(1)} (+${upliftPct.toFixed(0)}%). Based on ${best.video_count} videos from the last 90 days. Low-risk, immediate-effect change.`,
    supporting_evidence: { best_hour: best.publish_hour, best_avg_vph: parseFloat(best.avg_vph?.toFixed(1)), overall_avg_vph: parseFloat(overall.toFixed(1)), video_count: best.video_count, top_hours: topHours },
    source_signals: ['ingested_videos', 'publish_timing_analysis'],
  }];
}

// ── SEMANTIC CLUSTER RECOMMENDATIONS ─────────────────────────────────────────

function semanticRecommendations(db, niche) {
  const rows = db.all(
    `SELECT cluster_name, avg_vph, confidence, sample_size, trend_direction, niches_present, dominant_hooks,
            cohesion_tier, cohesion_score
     FROM semantic_clusters
     WHERE confidence >= 0.25 AND sample_size >= 3
     ORDER BY avg_vph DESC NULLS LAST
     LIMIT 20`,
  );
  if (!rows.length) return [];

  function cohesionHedge(r) {
    if (r.cohesion_tier === 'weak')
      return ' Note: this cluster has diffuse structural boundaries — patterns are loosely defined. Treat as a directional signal, not a strong recommendation.';
    if (r.cohesion_tier === 'moderate')
      return ' This cluster has moderate structural coherence — pattern correlates are observed but not tightly concentrated.';
    return '';
  }

  const recs = [];
  const rising = rows.filter(r => r.trend_direction === 'rising');

  for (const r of rising.slice(0, 2)) {
    let nichesPresent = [];
    try { nichesPresent = JSON.parse(r.niches_present ?? '[]'); } catch {}
    const inNiche = niche && nichesPresent.includes(niche);
    const hedge   = cohesionHedge(r);

    recs.push({
      recommendation_id: recId(`semantic:rising:${r.cluster_name}`),
      category:    CATEGORIES.SEMANTIC,
      niche:       niche ?? null,
      priority:    priorityScore(clamp((r.avg_vph ?? 0) / 200), r.confidence, clamp((r.sample_size ?? 0) / 30), inNiche ? RISK.LOW : RISK.MEDIUM, 0.08),
      confidence:  r.cohesion_tier === 'weak' ? r.confidence * 0.75 : r.confidence,
      expected_impact: clamp((r.avg_vph ?? 0) / 200),
      risk_level:  inNiche && r.cohesion_tier !== 'weak' ? RISK.LOW : RISK.MEDIUM,
      estimated_uplift: null,
      time_horizon: HORIZON.WEEK,
      title: `Rising semantic archetype: "${r.cluster_name}" cluster gaining momentum${inNiche ? ' in your niche' : ''}`,
      reasoning: `The "${r.cluster_name}" semantic cluster correlates with ${r.avg_vph?.toFixed(1) ?? 'N/A'} avg VPH across ${r.sample_size} videos (trend: rising). Signal confidence: ${(r.confidence * 100).toFixed(0)}%.${inNiche ? ` Active in ${niche}.` : ' Cross-niche transfer may apply.'}${hedge}`,
      supporting_evidence: { cluster: r.cluster_name, avg_vph: r.avg_vph, sample_size: r.sample_size, trend: r.trend_direction, niches: nichesPresent, cohesion_tier: r.cohesion_tier ?? null },
      source_signals: ['semantic_clusters', 'semantic_embeddings'],
    });
  }

  // Top non-rising high-VPH cluster as a stability signal
  const stable = rows.filter(r => r.trend_direction !== 'declining' && !rising.includes(r));
  if (stable[0]) {
    const r = stable[0];
    let nichesPresent = [];
    try { nichesPresent = JSON.parse(r.niches_present ?? '[]'); } catch {}
    const hedge = cohesionHedge(r);
    recs.push({
      recommendation_id: recId(`semantic:stable:${r.cluster_name}`),
      category:    CATEGORIES.SEMANTIC,
      niche:       niche ?? null,
      priority:    priorityScore(clamp((r.avg_vph ?? 0) / 200), r.confidence, clamp((r.sample_size ?? 0) / 30), RISK.LOW),
      confidence:  r.cohesion_tier === 'weak' ? r.confidence * 0.75 : r.confidence,
      expected_impact: clamp((r.avg_vph ?? 0) / 200),
      risk_level:  r.cohesion_tier === 'weak' ? RISK.MEDIUM : RISK.LOW,
      estimated_uplift: null,
      time_horizon: HORIZON.WEEK,
      title: `Proven semantic structure: "${r.cluster_name}" is the highest-VPH stable cluster${r.cohesion_tier === 'weak' ? ' (diffuse)' : ''}`,
      reasoning: `"${r.cluster_name}" correlates with ${r.avg_vph?.toFixed(1) ?? 'N/A'} avg VPH across ${r.sample_size} videos (stable trend). Adopting this semantic structure may reduce uncertainty vs experimenting with unproven archetypes.${hedge}`,
      supporting_evidence: { cluster: r.cluster_name, avg_vph: r.avg_vph, sample_size: r.sample_size, trend: r.trend_direction, niches: nichesPresent, cohesion_tier: r.cohesion_tier ?? null },
      source_signals: ['semantic_clusters'],
    });
  }

  return recs;
}

// ── BENCHMARK SPREAD RECOMMENDATIONS ─────────────────────────────────────────

function benchmarkRecommendations(db, niche) {
  const rows = db.all(
    `SELECT niche, bucket, median_vph, p75_vph, p90_vph, sample_size
     FROM niche_benchmarks
     WHERE bucket = '7d' AND duration_bucket = 'all' AND sample_size >= 5
       AND p90_vph IS NOT NULL AND median_vph IS NOT NULL AND median_vph > 0
     ORDER BY (p90_vph / median_vph) DESC NULLS LAST
     LIMIT 5`,
  );

  const recs = [];
  for (const r of rows) {
    const spread = r.p90_vph / r.median_vph;
    if (spread < 2.5) continue;
    const isCurrentNiche = r.niche === niche;
    const upliftEst = Math.round((spread - 1) * 100);
    recs.push({
      recommendation_id: recId(`benchmark:spread:${r.niche}`),
      category:    CATEGORIES.NICHE,
      niche:       r.niche,
      priority:    priorityScore(clamp((spread - 1) / 6), 0.7, clamp((r.sample_size ?? 0) / 30), isCurrentNiche ? RISK.LOW : RISK.MEDIUM),
      confidence:  0.7,
      expected_impact: clamp((spread - 1) / 6),
      risk_level:  isCurrentNiche ? RISK.LOW : RISK.MEDIUM,
      estimated_uplift: upliftEst,
      time_horizon: isCurrentNiche ? HORIZON.WEEK : HORIZON.MONTH,
      title: `High-upside niche: ${r.niche} shows ${spread.toFixed(1)}× spread between median and p90 VPH${isCurrentNiche ? ' — your niche' : ''}`,
      reasoning: `In ${r.niche}, median 7-day VPH is ${r.median_vph.toFixed(1)} but p90 reaches ${r.p90_vph.toFixed(1)} — a ${spread.toFixed(1)}× spread. Content near the p90 profile has ${upliftEst}% higher VPH than the median. P75: ${r.p75_vph?.toFixed(1) ?? '—'}. Based on ${r.sample_size} snapshots.`,
      supporting_evidence: { niche: r.niche, median_vph: r.median_vph, p75_vph: r.p75_vph, p90_vph: r.p90_vph, sample_size: r.sample_size, spread: parseFloat(spread.toFixed(2)) },
      source_signals: ['niche_benchmarks'],
    });
  }
  return recs;
}

// ── CONTENT PATTERN RECOMMENDATIONS ──────────────────────────────────────────

function patternRecommendations(db, niche) {
  const recs = [];

  // Title length analysis
  const lengthRows = db.all(
    `SELECT
       CASE WHEN length(title) < 40 THEN 'short (<40)'
            WHEN length(title) < 60 THEN 'medium (40-60)'
            ELSE 'long (60+)'
       END AS len_bucket,
       COUNT(*) AS count,
       AVG(CAST(views AS REAL) / MAX(1.0, (julianday('now') - julianday(published_at)) * 24)) AS avg_vph
     FROM ingested_videos
     WHERE niche = ?
       AND published_at > datetime('now', '-90 days')
       AND (julianday('now') - julianday(published_at)) * 24 > 48
     GROUP BY len_bucket HAVING count >= 5
     ORDER BY avg_vph DESC`,
    [niche],
  );

  if (lengthRows.length >= 2) {
    const best  = lengthRows[0];
    const worst = lengthRows[lengthRows.length - 1];
    const upliftPct = worst.avg_vph > 0 ? ((best.avg_vph - worst.avg_vph) / worst.avg_vph) * 100 : 0;
    if (upliftPct >= 15) {
      recs.push({
        recommendation_id: recId(`pattern:length:${niche}:${best.len_bucket}`),
        category:    CATEGORIES.PATTERN,
        niche,
        priority:    priorityScore(clamp(upliftPct / 100), 0.65, clamp((best.count ?? 0) / 20), RISK.LOW),
        confidence:  0.65,
        expected_impact: clamp(upliftPct / 100),
        risk_level:  RISK.LOW,
        estimated_uplift: Math.round(upliftPct),
        time_horizon: HORIZON.NOW,
        title: `Title length: ${best.len_bucket} titles outperform ${worst.len_bucket} by ${upliftPct.toFixed(0)}% VPH in ${niche}`,
        reasoning: `${best.len_bucket} titles average ${best.avg_vph?.toFixed(1)} VPH vs ${worst.avg_vph?.toFixed(1)} for ${worst.len_bucket} titles in ${niche} (+${upliftPct.toFixed(0)}%). Based on ${best.count} vs ${worst.count} videos. No technical change required — purely structural.`,
        supporting_evidence: { best: { bucket: best.len_bucket, avg_vph: best.avg_vph, count: best.count }, worst: { bucket: worst.len_bucket, avg_vph: worst.avg_vph, count: worst.count }, all_buckets: lengthRows },
        source_signals: ['ingested_videos', 'title_length_analysis'],
      });
    }
  }

  // Number presence in titles
  const numRows = db.all(
    `SELECT
       CASE WHEN title GLOB '*[0-9]*' THEN 'with numbers' ELSE 'no numbers' END AS num_type,
       COUNT(*) AS count,
       AVG(CAST(views AS REAL) / MAX(1.0, (julianday('now') - julianday(published_at)) * 24)) AS avg_vph
     FROM ingested_videos
     WHERE niche = ?
       AND published_at > datetime('now', '-90 days')
       AND (julianday('now') - julianday(published_at)) * 24 > 48
     GROUP BY num_type HAVING count >= 5`,
    [niche],
  );

  if (numRows.length === 2) {
    const withNum = numRows.find(r => r.num_type === 'with numbers');
    const noNum   = numRows.find(r => r.num_type === 'no numbers');
    if (withNum && noNum) {
      const maxVph    = Math.max(withNum.avg_vph ?? 0, noNum.avg_vph ?? 0);
      const minVph    = Math.min(withNum.avg_vph ?? 0, noNum.avg_vph ?? 0);
      const diffPct   = minVph > 0 ? ((maxVph - minVph) / minVph) * 100 : 0;
      if (diffPct >= 15) {
        const better  = (withNum.avg_vph ?? 0) > (noNum.avg_vph ?? 0) ? withNum : noNum;
        const worse   = better === withNum ? noNum : withNum;
        recs.push({
          recommendation_id: recId(`pattern:numbers:${niche}`),
          category:    CATEGORIES.PATTERN,
          niche,
          priority:    priorityScore(clamp(diffPct / 100), 0.6, clamp((better.count ?? 0) / 20), RISK.LOW),
          confidence:  0.6,
          expected_impact: clamp(diffPct / 100),
          risk_level:  RISK.LOW,
          estimated_uplift: Math.round(diffPct),
          time_horizon: HORIZON.NOW,
          title: `${better.num_type === 'with numbers' ? 'Include' : 'Avoid'} numbers in titles — ${diffPct.toFixed(0)}% VPH difference in ${niche}`,
          reasoning: `Titles ${better.num_type} average ${better.avg_vph?.toFixed(1)} VPH vs ${worse.avg_vph?.toFixed(1)} for titles ${worse.num_type} in ${niche} (+${diffPct.toFixed(0)}%). Sample: ${(better.count ?? 0) + (worse.count ?? 0)} videos. Zero production cost to implement.`,
          supporting_evidence: { with_numbers: withNum, no_numbers: noNum },
          source_signals: ['ingested_videos', 'title_pattern_analysis'],
        });
      }
    }
  }

  return recs;
}

// ── EXPERIMENT SUGGESTIONS ────────────────────────────────────────────────────

function experimentSuggestions(db, niche, allRecs) {
  const experiments = [];

  // Test low-confidence hook recommendations
  const hookRecs = allRecs
    .filter(r => r.category === CATEGORIES.HOOK && r.confidence < 0.7)
    .slice(0, 2);

  for (const rec of hookRecs) {
    experiments.push({
      recommendation_id: recId(`exp:hook:${rec.recommendation_id}`),
      category:    CATEGORIES.EXPERIMENT,
      niche,
      priority:    Math.max(0, rec.priority * 0.85),
      confidence:  0.5,
      expected_impact: rec.expected_impact * 0.7,
      risk_level:  RISK.LOW,
      estimated_uplift: rec.estimated_uplift ? Math.round(rec.estimated_uplift * 0.7) : null,
      time_horizon: HORIZON.WEEK,
      title: `Low-risk test: publish 3-5 videos using "${rec.supporting_evidence?.hook_type ?? 'this hook'}" patterns to validate ${niche} signal`,
      reasoning: `The "${rec.supporting_evidence?.hook_type ?? 'hook'}" pattern shows promise (priority ${rec.priority.toFixed(2)}) but moderate confidence (${(rec.confidence * 100).toFixed(0)}%) due to limited sample depth (n=${rec.supporting_evidence?.sample_count ?? '?'}). A 3–5 video controlled test establishes statistical basis before full commitment. Suggested test size: 5 videos, measured at 7d VPH.`,
      supporting_evidence: { parent_recommendation: rec.recommendation_id, parent_confidence: rec.confidence, suggested_test_size: 5, measurement: '7d VPH comparison vs your current median' },
      source_signals: ['recommendation_engine', 'experiment_framework'],
    });
  }

  // Semantic variant test
  const semRecs = allRecs.filter(r => r.category === CATEGORIES.SEMANTIC);
  if (semRecs.length) {
    const top = semRecs[0];
    const cluster = top.supporting_evidence?.cluster ?? 'rising archetype';
    experiments.push({
      recommendation_id: recId(`exp:semantic:${niche}:${cluster}`),
      category:    CATEGORIES.EXPERIMENT,
      niche,
      priority:    0.38,
      confidence:  0.45,
      expected_impact: 0.28,
      risk_level:  RISK.LOW,
      estimated_uplift: 15,
      time_horizon: HORIZON.WEEK,
      title: `Semantic variant test: adapt 2 existing concepts to match "${cluster}" cluster structural patterns`,
      reasoning: `Semantic clustering indicates the "${cluster}" archetype is gaining traction (avg VPH: ${top.supporting_evidence?.avg_vph?.toFixed(1) ?? '—'}, trend: ${top.supporting_evidence?.trend ?? 'rising'}). Test whether reframing existing content ideas with this cluster's structural patterns improves early-hour VPH without changing the underlying topic.`,
      supporting_evidence: { cluster, parent_rec: top.recommendation_id, suggested_pairs: 2, measurement: '1h and 24h VPH vs baseline' },
      source_signals: ['semantic_clusters', 'recommendation_engine'],
    });
  }

  // Timing test if no strong timing signal
  const hasTiming = allRecs.some(r => r.category === CATEGORIES.TIMING);
  if (!hasTiming) {
    experiments.push({
      recommendation_id: recId(`exp:timing:${niche}`),
      category:    CATEGORIES.EXPERIMENT,
      niche,
      priority:    0.25,
      confidence:  0.4,
      expected_impact: 0.2,
      risk_level:  RISK.LOW,
      estimated_uplift: 10,
      time_horizon: HORIZON.MONTH,
      title: `Timing experiment: test early-morning vs evening publish windows in ${niche} over 4 weeks`,
      reasoning: `Insufficient timing signal in current data (< 3 videos per hour bucket). A structured 4-week test alternating publish windows (08:00 UTC vs 18:00 UTC) would establish whether timing has measurable VPH impact in ${niche}. Track 24h VPH as primary metric.`,
      supporting_evidence: { suggested_windows: ['08:00 UTC', '18:00 UTC'], duration: '4 weeks', measurement: '24h VPH, n=6+ per window' },
      source_signals: ['recommendation_engine', 'timing_analysis'],
    });
  }

  return experiments;
}

// ── STRATEGY PLAN ─────────────────────────────────────────────────────────────

function buildStrategyPlan(recommendations) {
  const byHorizon = {};
  for (const r of recommendations) {
    const h = r.time_horizon ?? 'other';
    if (!byHorizon[h]) byHorizon[h] = [];
    byHorizon[h].push(r);
  }

  const catCounts = {};
  for (const r of recommendations) catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
  const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const getPri = r => r.priority ?? r.priority_score ?? 0;
  const avgConf    = recommendations.length ? recommendations.reduce((s, r) => s + (r.confidence ?? 0), 0) / recommendations.length : 0;
  const avgPriority = recommendations.length ? recommendations.reduce((s, r) => s + getPri(r), 0) / recommendations.length : 0;

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_recommendations: recommendations.length,
      avg_confidence:        parseFloat(avgConf.toFixed(3)),
      avg_priority:          parseFloat(avgPriority.toFixed(3)),
      top_category:          topCategory,
      high_confidence_count: recommendations.filter(r => (r.confidence ?? 0) >= 0.65).length,
      low_risk_count:        recommendations.filter(r => r.risk_level === RISK.LOW).length,
      top_priority_score:    recommendations.length ? parseFloat(Math.max(...recommendations.map(r => getPri(r))).toFixed(3)) : null,
    },
    immediate_actions: (byHorizon[HORIZON.NOW] ?? []).slice(0, 3).map(r => ({
      title: r.title, priority: getPri(r), confidence: r.confidence,
      risk: r.risk_level, uplift_est: r.estimated_uplift,
    })),
    short_term_strategy:      (byHorizon[HORIZON.WEEK] ?? []).slice(0, 4),
    medium_term_positioning:  (byHorizon[HORIZON.MONTH] ?? []).slice(0, 3),
    long_term_vision:         (byHorizon[HORIZON.LONG] ?? []).slice(0, 2),
    experiments:              recommendations.filter(r => r.category === CATEGORIES.EXPERIMENT).slice(0, 4),
    risk_managed_tests:       recommendations.filter(r => r.risk_level === RISK.LOW && (r.confidence ?? 0) < 0.6).slice(0, 3),
  };
}

// ── OPPORTUNITY DETECTION ─────────────────────────────────────────────────────

function detectOpportunities(db, niche) {
  const opps = [];

  // Rising semantic archetypes
  const risingClusters = db.all(
    `SELECT cluster_name, avg_vph, confidence, sample_size, trend_direction, niches_present
     FROM semantic_clusters
     WHERE trend_direction = 'rising' AND confidence >= 0.25
     ORDER BY avg_vph DESC NULLS LAST LIMIT 5`,
  );
  for (const c of risingClusters) {
    opps.push({
      type: 'rising_semantic_archetype',
      label: c.cluster_name,
      strength: parseFloat((c.confidence ?? 0).toFixed(3)),
      avg_vph: c.avg_vph,
      evidence: `${c.sample_size} videos, confidence ${((c.confidence ?? 0) * 100).toFixed(0)}%, trend: rising`,
    });
  }

  // Underexploited hooks (high hook_score, low sample count)
  if (niche) {
    const hookOpps = db.all(
      `SELECT hook_type, hook_score, confidence_score, sample_count, trend_direction, median_vph
       FROM hook_type_performance
       WHERE niche = ? AND COALESCE(hook_score, 0) >= 0.5 AND COALESCE(sample_count, 0) < 25 AND COALESCE(confidence_score, 0) >= 0.25
       ORDER BY hook_score DESC NULLS LAST LIMIT 4`,
      [niche],
    );
    for (const h of hookOpps) {
      opps.push({
        type: 'underexploited_hook',
        label: h.hook_type?.replace(/_/g, ' ') ?? h.hook_type,
        strength: parseFloat((h.hook_score ?? 0).toFixed(3)),
        avg_vph: h.median_vph,
        evidence: `Only ${h.sample_count} videos in ${niche}, hook score ${h.hook_score?.toFixed(2) ?? '—'}`,
      });
    }
  }

  // Benchmark anomalies
  const benchOpps = db.all(
    `SELECT niche, median_vph, p90_vph, sample_size
     FROM niche_benchmarks
     WHERE bucket = '7d' AND duration_bucket = 'all' AND sample_size >= 5
       AND p90_vph > median_vph * 3 AND median_vph > 0
     ORDER BY (p90_vph / median_vph) DESC NULLS LAST LIMIT 3`,
  );
  for (const b of benchOpps) {
    const spread = b.p90_vph / b.median_vph;
    opps.push({
      type: 'benchmark_anomaly',
      label: `${b.niche} — high-variance niche`,
      strength: parseFloat(clamp((spread - 1) / 6).toFixed(3)),
      avg_vph: b.p90_vph,
      evidence: `p90 VPH is ${spread.toFixed(1)}× median in ${b.niche} (n=${b.sample_size})`,
    });
  }

  // Niche with rising benchmark (compare two most recent benchmark snapshots)
  const batches = db.all(
    `SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at
     FROM niche_benchmark_history GROUP BY snapshot_batch_id
     ORDER BY snapshot_at DESC LIMIT 2`,
  );
  if (batches.length === 2) {
    const [recent, older] = batches;
    const nicheGrowth = db.all(
      `SELECT h1.niche,
              h1.median_vph AS recent_vph, h2.median_vph AS older_vph,
              (h1.median_vph - h2.median_vph) / NULLIF(h2.median_vph, 0) * 100 AS growth_pct
       FROM niche_benchmark_history h1
       JOIN niche_benchmark_history h2
         ON h1.niche = h2.niche AND h1.bucket = h2.bucket AND h1.duration_bucket = h2.duration_bucket
       WHERE h1.snapshot_batch_id = ? AND h2.snapshot_batch_id = ?
         AND h1.bucket = '7d' AND h1.duration_bucket = 'all'
         AND h1.median_vph > h2.median_vph * 1.1
       ORDER BY growth_pct DESC NULLS LAST LIMIT 3`,
      [recent.snapshot_batch_id, older.snapshot_batch_id],
    );
    for (const n of nicheGrowth) {
      opps.push({
        type: 'accelerating_niche',
        label: n.niche,
        strength: parseFloat(clamp((n.growth_pct ?? 0) / 50).toFixed(3)),
        avg_vph: n.recent_vph,
        evidence: `+${n.growth_pct?.toFixed(0) ?? '?'}% median VPH growth vs prior snapshot`,
      });
    }
  }

  return opps.sort((a, b) => b.strength - a.strength);
}

// ── CONTEXT DIGEST (for H8 Claude injection) ─────────────────────────────────

function buildContextDigest(db, { niche, limit = 5 } = {}) {
  const recs  = require('../db/queries').getStrategyRecommendations(db, { niche, limit });
  const opps  = detectOpportunities(db, niche).slice(0, 3);
  const hooks = db.all(
    `SELECT hook_type, median_vph, trend_direction, sample_count
     FROM hook_type_performance
     WHERE ${niche ? 'niche = ?' : '1=1'} AND duration_bucket = 'all' AND sample_count >= 5
     ORDER BY hook_score DESC NULLS LAST LIMIT 5`,
    niche ? [niche] : [],
  );

  // Semantic cluster context: top clusters by avg_vph with example titles
  const semanticClusters = db.all(
    `SELECT sc.cluster_name, sc.avg_vph, sc.confidence, sc.sample_size, sc.trend_direction,
            iv.title AS example_title
     FROM semantic_clusters sc
     LEFT JOIN (
       SELECT se.semantic_cluster, iv2.title,
              ROW_NUMBER() OVER (PARTITION BY se.semantic_cluster ORDER BY COALESCE(vgs.views_per_hour, 0) DESC) AS rn
       FROM semantic_embeddings se
       JOIN ingested_videos iv2 ON se.source_id = iv2.youtube_video_id
       LEFT JOIN video_growth_snapshots vgs ON vgs.video_id = se.source_id AND vgs.views_per_hour > 0
       WHERE se.source_type = 'title_dna'
     ) iv ON iv.semantic_cluster = sc.cluster_name AND iv.rn = 1
     WHERE sc.confidence >= 0.3 AND sc.sample_size >= 10
     ORDER BY sc.avg_vph DESC NULLS LAST LIMIT 5`,
  );

  const lines = ['[TubeIntel Strategy Context]'];
  if (niche) lines.push(`Niche: ${niche}`);
  if (recs.length) {
    lines.push('\nTop Recommendations:');
    for (const r of recs.slice(0, 3)) {
      lines.push(`• ${r.title} (confidence: ${(r.confidence * 100).toFixed(0)}%, est. uplift: ${r.estimated_uplift ?? 'N/A'}%)`);
    }
  }
  if (hooks.length) {
    lines.push('\nTop Hook Patterns:');
    for (const h of hooks) {
      lines.push(`• ${h.hook_type?.replace(/_/g, ' ')}: ${h.median_vph?.toFixed(1)} median VPH [${h.trend_direction ?? 'stable'}]`);
    }
  }
  if (semanticClusters.length) {
    lines.push('\nTop Semantic Archetypes (by avg VPH):');
    for (const c of semanticClusters) {
      const trendTag = c.trend_direction ? ` [${c.trend_direction}]` : '';
      const exampleTag = c.example_title ? ` — e.g. "${c.example_title}"` : '';
      lines.push(`• ${c.cluster_name.replace(/_/g, ' ')}: ${c.avg_vph?.toFixed(1) ?? '—'} avg VPH, ${c.sample_size} videos${trendTag}${exampleTag}`);
    }
  }
  if (opps.length) {
    lines.push('\nDetected Opportunities:');
    for (const o of opps) {
      lines.push(`• ${o.label}: ${o.evidence}`);
    }
  }
  lines.push('\nNote: All metrics are observational benchmarks. Confidence values reflect data depth, not behavioral causation.');

  return {
    digest_text: lines.join('\n'),
    top_recommendations: recs.slice(0, 3),
    top_hooks: hooks,
    opportunities: opps,
    semantic_clusters: semanticClusters,
    generated_at: new Date().toISOString(),
  };
}

// ── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

function generateRecommendations(db, { niche = null, limit = 25 } = {}) {
  const n = niche && niche !== '__all__' ? niche : null;

  const base = [
    ...(n ? hookRecommendations(db, n)       : []),
    ...(n ? timingRecommendations(db, n)     : []),
    ...semanticRecommendations(db, n),
    ...benchmarkRecommendations(db, n),
    ...(n ? patternRecommendations(db, n)    : []),
  ];

  const exps = experimentSuggestions(db, n, base);
  const all  = [...base, ...exps]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return all;
}

module.exports = {
  generateRecommendations,
  detectOpportunities,
  buildStrategyPlan,
  buildContextDigest,
  CATEGORIES,
  RISK,
  HORIZON,
};
