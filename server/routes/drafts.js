const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');

// POST /api/drafts — save a script draft from Copilot
router.post('/drafts', (req, res) => {
  const { client_id, channel_id, topic, cards } = req.body;
  if (!client_id || !Array.isArray(cards) || !cards.length) {
    return res.status(400).json({ error: 'client_id and cards required' });
  }
  const db     = getDb();
  const result = db.run(
    `INSERT INTO content_drafts (client_id, channel_id, topic, cards_json) VALUES (?, ?, ?, ?)`,
    [client_id, channel_id || null, topic || null, JSON.stringify(cards)],
  );
  res.json({ id: result.lastInsertRowid, topic, created_at: new Date().toISOString() });
});

// GET /api/drafts?client_id=xxx — list all saved drafts
router.get('/drafts', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const db   = getDb();
  const rows = db.all(
    `SELECT id, channel_id, topic, cards_json, created_at
     FROM content_drafts WHERE client_id = ? ORDER BY created_at DESC LIMIT 100`,
    [client_id],
  );
  res.json(rows.map(r => ({ ...r, cards: JSON.parse(r.cards_json || '[]') })));
});

// DELETE /api/drafts/:id?client_id=xxx
router.delete('/drafts/:id', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const db = getDb();
  db.run(`DELETE FROM content_drafts WHERE id = ? AND client_id = ?`, [req.params.id, client_id]);
  res.json({ deleted: true });
});

module.exports = router;
