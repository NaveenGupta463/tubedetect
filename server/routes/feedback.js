const express = require('express');
const { getDb } = require('../db/init');

const router = express.Router();

/**
 * POST /api/feedback/:id
 * Body: { user_correction: number (0–100), reason: string }
 */
router.post('/feedback/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { user_correction, reason } = req.body;
  if (typeof user_correction !== 'number' || user_correction < 0 || user_correction > 100) {
    return res.status(400).json({ error: 'user_correction must be a number 0–100' });
  }

  const video = db.get('SELECT id FROM videos WHERE id = ?', [id]);
  if (!video) return res.status(404).json({ error: 'Video not found' });

  // Add feedback columns on first use (idempotent)
  try {
    db.exec('ALTER TABLE predictions ADD COLUMN user_correction REAL');
    db.exec('ALTER TABLE predictions ADD COLUMN correction_reason TEXT');
  } catch { /* columns already exist */ }

  db.run(
    'UPDATE predictions SET user_correction = ?, correction_reason = ? WHERE video_id = ?',
    [user_correction, reason ?? null, id],
  );

  res.json({ success: true, video_id: id, user_correction, reason });
});

module.exports = router;
