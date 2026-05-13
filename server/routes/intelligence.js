'use strict';

const express = require('express');
const { getDb } = require('../db/init');
const { getRoutingAnalytics, getTopHooks, getRisingHooks, getDecliningHooks, getHooksByNiche, getHookSummaryStats } = require('../db/queries');
const { routeIntelligenceRequest } = require('../services/intelligenceRouter');
const { aggregateHookPerformance } = require('../jobs/aggregateHookPerformance');
const { classifyHookTypeMulti } = require('../services/hookClassifier');
const { buildContextDigest } = require('../services/recommendationEngine');

const router = express.Router();

// POST /api/intelligence/query
// Body: { feature, niche, payload }
// Response: { route_type, confidence, confidence_tier, correctness_score,
//             correctness_validated, response, metadata }
router.post('/intelligence/query', async (req, res) => {
  try {
    const { feature, niche, payload } = req.body ?? {};

    if (!feature) {
      return res.status(400).json({ error: 'feature is required' });
    }

    const db     = getDb();
    const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

    let context = null;
    try { context = buildContextDigest(db, { niche }); } catch {}

    const result = await routeIntelligenceRequest({ db, feature, niche, payload, apiKey, context });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/intelligence/routing/analytics?days=7
router.get('/intelligence/routing/analytics', (req, res) => {
  try {
    const db   = getDb();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '7', 10)));
    const data = getRoutingAnalytics(db, days);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── D4: Hook Intelligence API ─────────────────────────────────────────────────

// GET /api/intelligence/hooks/top?niche=&duration_bucket=&limit=20
router.get('/intelligence/hooks/top', (req, res) => {
  try {
    const db = getDb();
    const { niche, duration_bucket, limit } = req.query;
    const rows = getTopHooks(db, { niche, duration_bucket, limit: parseInt(limit ?? '20', 10) });
    res.json({ ok: true, rows, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/intelligence/hooks/rising?niche=&limit=20
router.get('/intelligence/hooks/rising', (req, res) => {
  try {
    const db = getDb();
    const { niche, limit } = req.query;
    const rows = getRisingHooks(db, { niche, limit: parseInt(limit ?? '20', 10) });
    res.json({ ok: true, rows, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/intelligence/hooks/declining?niche=&limit=20
router.get('/intelligence/hooks/declining', (req, res) => {
  try {
    const db = getDb();
    const { niche, limit } = req.query;
    const rows = getDecliningHooks(db, { niche, limit: parseInt(limit ?? '20', 10) });
    res.json({ ok: true, rows, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/intelligence/hooks/niche/:niche
router.get('/intelligence/hooks/niche/:niche', (req, res) => {
  try {
    const db   = getDb();
    const rows = getHooksByNiche(db, req.params.niche);
    res.json({ ok: true, niche: req.params.niche, rows, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/intelligence/hooks/stats — summary metrics
router.get('/intelligence/hooks/stats', (req, res) => {
  try {
    const db = getDb();
    res.json({ ok: true, ...getHookSummaryStats(db) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/intelligence/hooks/classify
// Body: { title }
// Returns full probabilistic multi-hook output (Phase D inference API)
router.post('/intelligence/hooks/classify', (req, res) => {
  try {
    const { title } = req.body ?? {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const result = classifyHookTypeMulti(title.trim());
    res.json({
      ok: true,
      ...result,
      analytics_note: 'Confidence values reflect inferred persuasion pattern likelihood — not measured behavioral causation. Observed correlations with outcomes do not imply causation.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/intelligence/hooks/aggregate — on-demand aggregation trigger (admin)
router.post('/intelligence/hooks/aggregate', (req, res) => {
  try {
    const db     = getDb();
    const result = aggregateHookPerformance(db);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
