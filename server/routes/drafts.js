const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

function normalizeTopic(topic) {
  return String(topic || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120) || 'untitled';
}

function cardKey(card) {
  const type = card?.type || 'note';
  const data = card?.data || {};
  if (type === 'script') return `${type}:${data.part || 'body'}:${data.title || data.topic || ''}`.toLowerCase();
  if (type === 'outline') return `${type}:${data.topic || ''}`.toLowerCase();
  if (type === 'note') return `${type}:${data.section || data.title || ''}`.toLowerCase();
  return `${type}:${JSON.stringify(data).slice(0, 80)}`.toLowerCase();
}

function mergeCards(existingCards, incomingCards) {
  const merged = Array.isArray(existingCards) ? [...existingCards] : [];
  const positions = new Map(merged.map((c, i) => [cardKey(c), i]));

  for (const card of incomingCards) {
    const key = cardKey(card);
    if (positions.has(key)) {
      merged[positions.get(key)] = card;
    } else {
      positions.set(key, merged.length);
      merged.push(card);
    }
  }

  return merged;
}

function ensureDraftSchema(db) {
  const cols = new Set(db.all(`PRAGMA table_info(content_drafts)`).map(c => c.name));
  if (!cols.has('draft_key')) db.exec(`ALTER TABLE content_drafts ADD COLUMN draft_key TEXT`);
  if (!cols.has('thread_id')) db.exec(`ALTER TABLE content_drafts ADD COLUMN thread_id TEXT`);
  if (!cols.has('updated_at')) db.exec(`ALTER TABLE content_drafts ADD COLUMN updated_at TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_key ON content_drafts(draft_key) WHERE draft_key IS NOT NULL`);
}

// POST /api/drafts - save or update a reusable Copilot draft asset.
router.post('/drafts', (req, res) => {
  const { client_id, channel_id, topic, cards, thread_id, draft_key } = req.body;
  if (!client_id || !Array.isArray(cards) || !cards.length) {
    return res.status(400).json({ error: 'client_id and cards required' });
  }

  const db = getDb();
  ensureDraftSchema(db);
  const key = draft_key || [
    client_id,
    channel_id || 'no-channel',
    normalizeTopic(topic),
    thread_id || 'default',
  ].join(':');

  const existing = db.get(
    `SELECT id, cards_json FROM content_drafts WHERE draft_key = ?`,
    [key],
  );

  if (existing) {
    const existingCards = (() => {
      try { return JSON.parse(existing.cards_json || '[]'); } catch { return []; }
    })();
    const mergedCards = mergeCards(existingCards, cards);
    db.run(
      `UPDATE content_drafts
       SET topic = COALESCE(?, topic),
           channel_id = COALESCE(?, channel_id),
           thread_id = COALESCE(?, thread_id),
           cards_json = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [topic || null, channel_id || null, thread_id || null, JSON.stringify(mergedCards), existing.id],
    );
    return res.json({
      id: existing.id,
      topic,
      updated: true,
      cards: mergedCards.length,
      updated_at: new Date().toISOString(),
    });
  }

  const result = db.run(
    `INSERT INTO content_drafts (client_id, channel_id, topic, draft_key, thread_id, cards_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [client_id, channel_id || null, topic || null, key, thread_id || null, JSON.stringify(cards)],
  );

  res.json({
    id: result.lastInsertRowid,
    topic,
    updated: false,
    created_at: new Date().toISOString(),
  });
});

// GET /api/drafts?client_id=xxx - list all saved drafts.
router.get('/drafts', (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const db = getDb();
  ensureDraftSchema(db);
  const rows = db.all(
    `SELECT id, channel_id, topic, draft_key, thread_id, cards_json, created_at, updated_at
     FROM content_drafts
     WHERE client_id = ?
     ORDER BY COALESCE(updated_at, created_at) DESC
     LIMIT 100`,
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
