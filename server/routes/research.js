'use strict';
const express = require('express');
const { getDb } = require('../db/init');
const { searchPapers, isResearchRelevantPrepublish } = require('../services/researchGrounding');
const router = express.Router();

// POST /api/research/papers
// Body: { topic, category?, text?, limit? }
// Gating decision lives here (server-side) so the browser stays dumb — mirrors /api/semantic/nearest.
router.post('/research/papers', async (req, res) => {
  try {
    const { topic, category, text, limit } = req.body ?? {};
    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'topic is required' });
    }
    if (!isResearchRelevantPrepublish({ category, text })) {
      return res.json({ ok: true, papers: [], skipped: 'not_research_relevant' });
    }
    const db = getDb();
    const papers = await searchPapers(topic.trim(), { db, limit: Math.min(5, parseInt(limit, 10) || 5) });
    res.json({ ok: true, papers: papers || [], count: (papers || []).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
