'use strict';

// Server-side intelligence router — Phase C.
// Determines route type (autonomous / hybrid / mandatory_claude) based on
// measured confidence scores AND confidence correctness validation.
// Frontend must never decide routing; it calls /api/intelligence/query and
// receives a complete response regardless of which path was taken.

const Anthropic = require('@anthropic-ai/sdk');
const { insertRoutingLog } = require('../db/queries');
const { computeConfidenceCorrectness } = require('./confidenceValidation');

const ROUTING_VERSION = 'v1';

// Features with local execution paths implemented in Phase C.
// Unlisted features fall back to hybrid (context-enriched Claude) even at
// autonomous confidence levels — they log route_type='autonomous_pending'.
const PHASE_C_LOCAL_FEATURES = new Set([
  'niche_research',
  'viral_formula',
  'pattern_ranking',
  'upload_timing',
  'channel_classification',
  'hook_intelligence',
  'semantic_memory',  // Phase G — find semantically similar titles/structures
]);

// Approximate token savings per route type vs a full Claude call.
const TOKEN_SAVINGS = {
  autonomous:     800,
  hybrid:         300,
  mandatory_claude: 0,
};

// ── Safety gates ──────────────────────────────────────────────────────────────

function canUseAutonomousRouting({ feature, confidenceScore, correctness, healthSnapshot }) {
  const reasons = [];

  if ((confidenceScore ?? 0) < 80) {
    reasons.push(`Confidence ${confidenceScore ?? 'unknown'} below autonomous threshold (80)`);
  }

  if (correctness?.healthy === false) {
    reasons.push('Confidence correctness validation failed — routing thresholds unreliable');
  }

  if (healthSnapshot) {
    if ((healthSnapshot.mae ?? 0) > 35) {
      reasons.push(`System MAE ${healthSnapshot.mae} exceeds autonomous gate (35)`);
    }
    if ((healthSnapshot.synthetic_ratio ?? 0) > 0.97) {
      reasons.push(`Synthetic ratio ${((healthSnapshot.synthetic_ratio ?? 0) * 100).toFixed(0)}% too high — calibration unreliable`);
    }
    if ((healthSnapshot.benchmark_drift ?? 0) > 25) {
      reasons.push(`Benchmark drift ${healthSnapshot.benchmark_drift} exceeds stability gate (25)`);
    }
  }

  if (!PHASE_C_LOCAL_FEATURES.has(feature)) {
    reasons.push(`Feature '${feature}' has no Phase-C local implementation — routed to hybrid`);
  }

  return { allowed: reasons.length === 0, reasons };
}

// ── Statistical context builder ───────────────────────────────────────────────

function buildStatisticalContext(db, feature, niche) {
  const ctx = { feature, niche, generated_at: new Date().toISOString() };

  // Benchmarks for this niche (7-day bucket, all duration buckets)
  try {
    ctx.benchmarks = db.all(
      `SELECT bucket, duration_bucket, median_vph, p75_vph, p90_vph, sample_size
       FROM niche_benchmarks
       WHERE niche = ? AND bucket IN ('7d', '14d', '30d')
       ORDER BY bucket, duration_bucket`,
      [niche],
    );
  } catch { ctx.benchmarks = []; }

  // Top performers in niche
  try {
    ctx.top_performers = db.all(
      `SELECT title, views, likes, duration_seconds, published_at
       FROM ingested_videos
       WHERE niche = ? AND views IS NOT NULL
       ORDER BY views DESC LIMIT 10`,
      [niche],
    );
  } catch { ctx.top_performers = []; }

  // Recent top performers (last 30 days)
  try {
    ctx.recent_top = db.all(
      `SELECT title, views, duration_seconds, published_at
       FROM ingested_videos
       WHERE niche = ? AND published_at >= datetime('now', '-30 days') AND views IS NOT NULL
       ORDER BY views DESC LIMIT 10`,
      [niche],
    );
  } catch { ctx.recent_top = []; }

  // Niche stats summary
  try {
    ctx.niche_stats = db.get(
      `SELECT COUNT(*) AS total_videos,
              AVG(views) AS avg_views, MAX(views) AS max_views,
              AVG(duration_seconds) AS avg_duration_s
       FROM ingested_videos WHERE niche = ?`,
      [niche],
    );
  } catch { ctx.niche_stats = null; }

  // Feature-specific additions
  if (feature === 'upload_timing') {
    try {
      ctx.timing_by_day = db.all(
        `SELECT CAST(strftime('%w', published_at) AS INTEGER) AS day_of_week,
                ROUND(AVG(views * 1.0 / MAX(1,
                  (julianday('now') - julianday(published_at)) * 24)), 1) AS avg_vph,
                COUNT(*) AS n
         FROM ingested_videos
         WHERE niche = ? AND published_at IS NOT NULL AND views > 1000
         GROUP BY day_of_week
         HAVING n >= 3
         ORDER BY avg_vph DESC`,
        [niche],
      );
    } catch { ctx.timing_by_day = []; }
  }

  if (feature === 'channel_classification' || feature === 'niche_research') {
    try {
      ctx.channel_archetypes = db.all(
        `SELECT content_archetype, format_type, audience_style, COUNT(*) AS n
         FROM ingested_channels
         WHERE niche = ? AND content_archetype IS NOT NULL
         GROUP BY content_archetype, format_type, audience_style
         ORDER BY n DESC LIMIT 10`,
        [niche],
      );
    } catch { ctx.channel_archetypes = []; }
  }

  if (feature === 'semantic_memory') {
    try {
      ctx.semantic_clusters = db.all(
        `SELECT cluster_name, sample_size, avg_vph, confidence, trend_direction
         FROM semantic_clusters WHERE sample_size > 0
         ORDER BY confidence DESC LIMIT 10`,
      );
      ctx.semantic_coverage = db.get(`SELECT COUNT(*) AS total FROM semantic_embeddings`);
    } catch { ctx.semantic_clusters = []; ctx.semantic_coverage = null; }
  }

  if (feature === 'hook_intelligence') {
    try {
      ctx.hook_performance = {
        top: db.all(
          `SELECT hook_type, hook_score, avg_vph, median_vph, sample_count,
                  trend_direction, consistency_score, confidence_score, example_titles_json
           FROM hook_type_performance
           WHERE niche = ? AND sample_count >= 5
           ORDER BY hook_score DESC LIMIT 8`,
          [niche],
        ),
        rising: db.all(
          `SELECT hook_type, hook_score, momentum_score, avg_vph, sample_count
           FROM hook_type_performance
           WHERE niche = ? AND trend_direction = 'rising' AND sample_count >= 5
           ORDER BY momentum_score DESC LIMIT 5`,
          [niche],
        ),
        declining: db.all(
          `SELECT hook_type, hook_score, momentum_score, avg_vph, sample_count
           FROM hook_type_performance
           WHERE niche = ? AND trend_direction = 'declining' AND sample_count >= 5
           ORDER BY momentum_score ASC LIMIT 5`,
          [niche],
        ),
      };
    } catch { ctx.hook_performance = { top: [], rising: [], declining: [] }; }
  }

  return ctx;
}

// Serialise context to a compact text block for Claude prompt injection.
function contextToPromptBlock(ctx) {
  const lines = [`[NICHE INTELLIGENCE: ${ctx.niche} | generated ${ctx.generated_at?.slice(0, 10)}]`];

  if (ctx.niche_stats) {
    const s = ctx.niche_stats;
    lines.push(`Dataset: ${s.total_videos} videos | avg ${Math.round(s.avg_views ?? 0).toLocaleString()} views | avg ${Math.round((s.avg_duration_s ?? 0) / 60)}m duration`);
  }

  if (ctx.benchmarks?.length) {
    lines.push('');
    lines.push('Benchmark VPH (views/hour) by duration:');
    for (const b of ctx.benchmarks.filter(r => r.bucket === '7d')) {
      lines.push(`  ${b.duration_bucket.padEnd(8)} — median ${(b.median_vph ?? 0).toFixed(1)} | p75 ${(b.p75_vph ?? 0).toFixed(1)} | p90 ${(b.p90_vph ?? 0).toFixed(1)} (n=${b.sample_size})`);
    }
  }

  if (ctx.recent_top?.length) {
    lines.push('');
    lines.push('Top recent titles (last 30 days):');
    for (const v of ctx.recent_top.slice(0, 5)) {
      lines.push(`  - "${v.title}" — ${(v.views ?? 0).toLocaleString()} views`);
    }
  }

  if (ctx.timing_by_day?.length) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    lines.push('');
    lines.push('Upload timing (avg VPH by day):');
    for (const t of ctx.timing_by_day.slice(0, 3)) {
      lines.push(`  ${DAYS[t.day_of_week] ?? t.day_of_week}: ${t.avg_vph} avg VPH`);
    }
  }

  // D6.2 — Hook intelligence context injection
  if (ctx.hook_performance?.top?.length) {
    lines.push('');
    lines.push('Hook intelligence (top performing hooks by VPH):');
    for (const h of ctx.hook_performance.top.slice(0, 5)) {
      lines.push(`  ${h.hook_type.padEnd(16)} score=${h.hook_score?.toFixed(1).padStart(5)} | avg=${(h.avg_vph ?? 0).toFixed(1)} vph | n=${h.sample_count} | ${h.trend_direction}`);
    }
    if (ctx.hook_performance.rising?.length) {
      lines.push(`Rising: ${ctx.hook_performance.rising.map(h => h.hook_type).join(', ')}`);
    }
    if (ctx.hook_performance.declining?.length) {
      lines.push(`Declining: ${ctx.hook_performance.declining.map(h => h.hook_type).join(', ')}`);
    }
  }

  return lines.join('\n');
}

// ── Local execution paths (Phase C implementations) ───────────────────────────

function executeLocally(feature, niche, ctx) {
  switch (feature) {
    case 'niche_research':
      return {
        benchmarks:       ctx.benchmarks,
        top_performers:   ctx.top_performers,
        recent_top:       ctx.recent_top,
        channel_archetypes: ctx.channel_archetypes ?? [],
        niche_stats:      ctx.niche_stats,
        summary: `${ctx.niche} niche: ${ctx.niche_stats?.total_videos ?? 0} videos indexed. ` +
          `7-day short-form median VPH: ${ctx.benchmarks?.find(b => b.bucket === '7d' && b.duration_bucket === 'short')?.median_vph?.toFixed(1) ?? 'N/A'}.`,
      };

    case 'viral_formula':
      return {
        top_performers:   ctx.top_performers,
        recent_top:       ctx.recent_top,
        benchmarks:       ctx.benchmarks,
        summary: `Top ${ctx.top_performers?.length ?? 0} viral videos in ${ctx.niche} analysed from ${ctx.niche_stats?.total_videos ?? 0} indexed.`,
      };

    case 'pattern_ranking':
      return {
        top_performers:   ctx.top_performers,
        benchmarks:       ctx.benchmarks,
        niche_stats:      ctx.niche_stats,
        summary: `Pattern analysis from ${ctx.niche_stats?.total_videos ?? 0} ${ctx.niche} videos.`,
      };

    case 'upload_timing':
      return {
        timing_by_day:  ctx.timing_by_day ?? [],
        benchmarks:     ctx.benchmarks,
        niche_stats:    ctx.niche_stats,
        summary: ctx.timing_by_day?.length
          ? `Best upload day: ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][ctx.timing_by_day[0]?.day_of_week] ?? '?'} (${ctx.timing_by_day[0]?.avg_vph} avg VPH)`
          : `Insufficient timing data for ${ctx.niche}`,
      };

    case 'channel_classification':
      return {
        channel_archetypes: ctx.channel_archetypes ?? [],
        niche_stats:        ctx.niche_stats,
        benchmarks:         ctx.benchmarks,
        summary: `${ctx.channel_archetypes?.length ?? 0} archetype patterns in ${ctx.niche}.`,
      };

    case 'hook_intelligence': {
      const top      = ctx.hook_performance?.top      ?? [];
      const rising   = ctx.hook_performance?.rising   ?? [];
      const declining = ctx.hook_performance?.declining ?? [];
      return {
        top_hooks:        top,
        rising_hooks:     rising,
        declining_hooks:  declining,
        niche_stats:      ctx.niche_stats,
        summary: top.length
          ? `Top hook in ${ctx.niche}: "${top[0]?.hook_type}" (score ${top[0]?.hook_score?.toFixed(1)}, ${top[0]?.sample_count} samples). ` +
            `${rising.length} rising, ${declining.length} declining hook types.`
          : `No hook performance data yet for ${ctx.niche} — run aggregateHookPerformance first.`,
      };
    }

    case 'semantic_memory':
      // semantic_memory uses async path in routeIntelligenceRequest — this sync path is a fallback
      return {
        semantic_clusters: ctx.semantic_clusters ?? [],
        semantic_coverage: ctx.semantic_coverage ?? null,
        summary: ctx.semantic_clusters?.length
          ? `${ctx.semantic_clusters.length} semantic clusters active, ${ctx.semantic_coverage?.total ?? 0} embeddings stored`
          : 'Semantic memory not yet populated — run embedding ingest first',
      };

    default:
      return null;
  }
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude({ apiKey, systemPrompt, userMessage, model }) {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model:      model ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });
  return msg.content?.[0]?.text ?? '';
}

// ── Main router ───────────────────────────────────────────────────────────────

async function routeIntelligenceRequest({ db, feature, niche, payload, apiKey, context = null }) {
  const t0 = Date.now();

  // 1. Get current confidence for this (feature, niche)
  let confidenceScore = null;
  let routingDecision = 'mandatory_claude';
  try {
    const cm = db.get(
      `SELECT confidence_score, routing_decision FROM confidence_metrics
       WHERE feature = ? AND niche = ?
       ORDER BY created_at DESC LIMIT 1`,
      [feature, niche ?? null],
    );
    if (cm) { confidenceScore = cm.confidence_score; routingDecision = cm.routing_decision; }
  } catch { /* no confidence data yet */ }

  // 2. Get latest correctness snapshot
  let correctness = null;
  try {
    correctness = computeConfidenceCorrectness(db);
  } catch { /* non-fatal */ }

  // 3. Get latest health snapshot
  let healthSnapshot = null;
  try {
    healthSnapshot = db.get('SELECT * FROM learning_health_snapshots ORDER BY snapshot_date DESC LIMIT 1');
  } catch { /* non-fatal */ }

  // 4. Determine route type with safety gates
  let route_type;
  let fallback_reason = null;

  if (routingDecision === 'mandatory_claude' || (confidenceScore ?? 0) < 40) {
    route_type = 'mandatory_claude';
    fallback_reason = `Confidence ${confidenceScore ?? 'unknown'} below mandatory threshold`;
  } else if (routingDecision === 'autonomous' || (confidenceScore ?? 0) >= 80) {
    const gate = canUseAutonomousRouting({ feature, confidenceScore, correctness, healthSnapshot });
    if (gate.allowed) {
      route_type = 'autonomous';
    } else {
      route_type = PHASE_C_LOCAL_FEATURES.has(feature) ? 'hybrid' : 'mandatory_claude';
      fallback_reason = gate.reasons[0] ?? 'Safety gate blocked autonomous routing';
    }
  } else {
    route_type = 'hybrid';
  }

  // 5. Build statistical context (always — cheap, used in all routes)
  const ctx = buildStatisticalContext(db, feature, niche ?? 'general');
  const contextBlock = contextToPromptBlock(ctx);

  // 6. Execute route
  let response;
  let tokens_saved = TOKEN_SAVINGS[route_type] ?? 0;

  if (route_type === 'autonomous') {
    // Phase G: semantic_memory has an async local path
    if (feature === 'semantic_memory') {
      try {
        const { findNearestNeighbors, getSemanticProviderStatus } = require('./embeddingEngine');
        const queryTitle = payload?.title ?? payload?.query ?? '';
        const semLimit   = Math.min(20, payload?.limit ?? 10);
        const semCluster = payload?.cluster ?? null;
        const semNiche   = payload?.niche   ?? niche ?? null;

        if (queryTitle) {
          const neighbors = await findNearestNeighbors(db, {
            text: queryTitle, sourceType: 'title_dna',
            cluster: semCluster, niche: semNiche, limit: semLimit,
          });
          const provStatus = getSemanticProviderStatus();
          response = {
            source: 'local_semantic',
            data: {
              neighbors,
              query_title:      queryTitle,
              semantic_provider: provStatus.provider,
              semantic_tier:    provStatus.semantic_tier,
              // ROUTING SAFETY: semantic_confidence ≠ behavioral_confidence
              semantic_confidence: neighbors.length > 0
                ? neighbors[0].semantic_confidence ?? neighbors[0].similarity
                : 0,
              summary: neighbors.length
                ? `Found ${neighbors.length} semantically similar structures via ${provStatus.provider}`
                : 'No semantic neighbors — run embedding ingest or provide more titles',
            },
          };
        } else {
          // No title provided: return cluster overview
          const local = executeLocally(feature, niche, ctx);
          response = { source: 'local', data: local };
        }
      } catch (e) {
        route_type  = 'hybrid';
        fallback_reason = `semantic_memory local failed: ${e.message}`;
        tokens_saved = TOKEN_SAVINGS.hybrid;
      }
    } else {
      const local = executeLocally(feature, niche, ctx);
      if (local) {
        response = { source: 'local', data: local };
      } else {
        route_type  = 'hybrid';
        fallback_reason = `No local executor for '${feature}' in Phase C`;
        tokens_saved = TOKEN_SAVINGS.hybrid;
      }
    }
  }

  if (route_type === 'hybrid' || route_type === 'mandatory_claude') {
    if (!apiKey) {
      response = {
        source: 'no_api_key',
        context: ctx,
        context_block: contextBlock,
        message: 'ANTHROPIC_API_KEY not set — returning statistical context only',
      };
    } else {
      const strategyBlock = context?.digest_text
        ? `\n\n[STRATEGY INTELLIGENCE]\n${context.digest_text}`
        : '';
      const systemPrompt = route_type === 'hybrid'
        ? `You are TubeIntel, a YouTube content intelligence assistant. Use the provided niche data to give grounded, specific advice. Base your response on the real benchmark data provided.\n\n${contextBlock}${strategyBlock}`
        : `You are TubeIntel, a YouTube content intelligence assistant. Provide specific, actionable insights.${strategyBlock}`;

      const userMessage = typeof payload?.query === 'string'
        ? payload.query
        : JSON.stringify(payload ?? {});

      try {
        const claudeText = await callClaude({ apiKey, systemPrompt, userMessage });
        response = { source: route_type === 'hybrid' ? 'hybrid_claude' : 'claude', text: claudeText, context_injected: route_type === 'hybrid' };
      } catch (e) {
        response = { source: 'claude_error', error: e.message, context: ctx };
        fallback_reason = `Claude call failed: ${e.message}`;
      }
    }
  }

  const latency_ms = Date.now() - t0;

  // 7. Log routing decision
  try {
    insertRoutingLog(db, {
      feature, niche, route_type,
      confidence_score:      confidenceScore,
      correctness_score:     correctness?.routing_accuracy_score ?? null,
      fallback_reason,
      tokens_saved_estimate: tokens_saved,
      latency_ms,
      cache_hit:             0,
      routing_version:       ROUTING_VERSION,
    });
  } catch { /* non-fatal */ }

  return {
    route_type,
    confidence:            confidenceScore,
    confidence_tier:       routingDecision,
    correctness_score:     correctness?.routing_accuracy_score ?? null,
    correctness_validated: correctness?.validated ?? false,
    response,
    metadata: {
      feature, niche,
      tokens_saved_estimate: tokens_saved,
      latency_ms,
      fallback_reason,
      routing_version:  ROUTING_VERSION,
      safety_gates_checked: true,
      context_data_points: ctx.niche_stats?.total_videos ?? 0,
    },
  };
}

module.exports = {
  routeIntelligenceRequest,
  canUseAutonomousRouting,
  buildStatisticalContext,
  contextToPromptBlock,
  PHASE_C_LOCAL_FEATURES,
  ROUTING_VERSION,
};
