'use strict';

// Phase H — Autonomous Strategy & Recommendation API
//
// POST /api/strategy/generate                    — generate + save recommendations for a niche
// GET  /api/strategy/recommendations             — list saved recommendations
// GET  /api/strategy/recommendations/:id         — single recommendation
// POST /api/strategy/recommendations/:id/feedback — submit user feedback
// POST /api/strategy/opportunities               — detect opportunities
// POST /api/strategy/plan                        — generate strategy plan from recommendations
// GET  /api/strategy/analytics                   — routing cost + recommendation stats + hook matrix
// GET  /api/strategy/experiment-queue            — saved experiment-type recommendations
// GET  /api/strategy/history                     — recommendation history with feedback
// GET  /api/strategy/context-digest              — compact context for Claude prompt injection

const express = require('express');
const { getDb } = require('../db/init');

const {
  generateRecommendations,
  detectOpportunities,
  buildStrategyPlan,
  buildContextDigest,
} = require('../services/recommendationEngine');

const {
  upsertStrategyRecommendation,
  getStrategyRecommendations,
  getStrategyRecommendationById,
  saveRecommendationFeedback,
  getRecommendationFeedbackStats,
  getStrategyAnalytics,
} = require('../db/queries');

const router = express.Router();

// ── POST /api/strategy/generate ───────────────────────────────────────────────
router.post('/strategy/generate', (req, res) => {
  try {
    const { niche, limit = 25 } = req.body ?? {};
    const db   = getDb();
    const recs = generateRecommendations(db, { niche: niche || null, limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 25)) });

    for (const rec of recs) {
      try { upsertStrategyRecommendation(db, rec); } catch (e) { /* non-fatal, continue */ }
    }

    res.json({
      ok: true,
      niche:           niche || null,
      count:           recs.length,
      recommendations: recs,
      generated_at:    new Date().toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/recommendations ─────────────────────────────────────────
router.get('/strategy/recommendations', (req, res) => {
  try {
    const { niche, category, limit = '50' } = req.query;
    const db   = getDb();
    const rows = getStrategyRecommendations(db, {
      niche:    niche    || undefined,
      category: category || undefined,
      limit:    Math.min(100, parseInt(limit, 10) || 50),
    });
    res.json({ ok: true, count: rows.length, recommendations: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/recommendations/:id ─────────────────────────────────────
router.get('/strategy/recommendations/:id', (req, res) => {
  try {
    const db  = getDb();
    const row = getStrategyRecommendationById(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'recommendation not found' });
    res.json({ ok: true, recommendation: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/strategy/recommendations/:id/feedback ───────────────────────────
router.post('/strategy/recommendations/:id/feedback', (req, res) => {
  try {
    const { feedback_type, notes } = req.body ?? {};
    const VALID = ['useful', 'irrelevant', 'risky', 'successful', 'failed'];
    if (!feedback_type || !VALID.includes(feedback_type)) {
      return res.status(400).json({ error: `feedback_type must be one of: ${VALID.join(', ')}` });
    }
    const db = getDb();
    saveRecommendationFeedback(db, { recommendation_id: req.params.id, feedback_type, notes: notes ?? null });
    res.json({ ok: true, recommendation_id: req.params.id, feedback_type });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/strategy/opportunities ──────────────────────────────────────────
router.post('/strategy/opportunities', (req, res) => {
  try {
    const { niche } = req.body ?? {};
    const db   = getDb();
    const opps = detectOpportunities(db, niche || null);
    res.json({ ok: true, niche: niche || null, count: opps.length, opportunities: opps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/strategy/plan ────────────────────────────────────────────────────
router.post('/strategy/plan', (req, res) => {
  try {
    const { niche, regenerate = false } = req.body ?? {};
    const db   = getDb();
    const recs = regenerate
      ? generateRecommendations(db, { niche: niche || null })
      : getStrategyRecommendations(db, { niche: niche || undefined, limit: 50 });
    const plan = buildStrategyPlan(recs);
    res.json({ ok: true, niche: niche || null, plan });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/analytics ───────────────────────────────────────────────
router.get('/strategy/analytics', (req, res) => {
  try {
    const db   = getDb();
    const data = getStrategyAnalytics(db);

    const routing = data.routing ?? {};
    const total   = routing.total_requests ?? 0;
    const localN  = routing.local_count ?? 0;
    const claudeN = routing.claude_count ?? 0;

    res.json({
      ok: true,
      routing: {
        total_requests:     total,
        local_count:        localN,
        claude_count:       claudeN,
        hybrid_count:       routing.hybrid_count ?? 0,
        autonomous_pct:     total > 0 ? parseFloat(((localN / total) * 100).toFixed(1)) : 0,
        tokens_saved:       routing.tokens_saved ?? 0,
      },
      recommendations: {
        ...data.recStats,
        by_category: data.byCategory,
      },
      hook_matrix:    data.hookMatrix,
      niches:         data.nicheList,
      cost_reduction: {
        recommendations_served: data.recStats?.total ?? 0,
        claude_calls_avoided:   localN,
        autonomous_pct:         total > 0 ? parseFloat(((localN / total) * 100).toFixed(1)) : 0,
        semantic_cache_reuse:   (() => {
          try { return db.get('SELECT COALESCE(SUM(cache_hit_count), 0) AS hits FROM semantic_query_cache')?.hits ?? 0; } catch { return 0; }
        })(),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/experiment-queue ────────────────────────────────────────
router.get('/strategy/experiment-queue', (req, res) => {
  try {
    const { niche } = req.query;
    const db   = getDb();
    const rows = getStrategyRecommendations(db, { niche: niche || undefined, category: 'experiment_suggestion', limit: 20 });
    res.json({ ok: true, count: rows.length, experiments: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/history ─────────────────────────────────────────────────
router.get('/strategy/history', (req, res) => {
  try {
    const db    = getDb();
    const stats = getRecommendationFeedbackStats(db);
    const all   = getStrategyRecommendations(db, { limit: 100 });
    res.json({ ok: true, total_recommendations: all.length, feedback_stats: stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/strategy/context-digest ─────────────────────────────────────────
router.get('/strategy/context-digest', (req, res) => {
  try {
    const { niche, limit = '5' } = req.query;
    const db     = getDb();
    const digest = buildContextDigest(db, { niche: niche || null, limit: parseInt(limit, 10) || 5 });
    res.json({ ok: true, ...digest });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
