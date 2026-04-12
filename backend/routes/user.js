'use strict';
const express = require('express');
const db      = require('../db/db');

const router = express.Router();

// GET /api/user/me — fresh user data from DB
router.get('/me', (req, res) => {
  const user = db.findByGoogleId(req.user.googleId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id:                user.id,
    email:             user.email,
    name:              user.name,
    thumbnail:         user.thumbnail,
    tier:              user.tier,
    aiCallsUsed:       user.ai_calls_used,
    aiCallsResetMonth: user.ai_calls_reset_month,
  });
});

// POST /api/user/tier — body: { tier }
// Wire to a Stripe webhook in production before exposing this publicly.
router.post('/tier', (req, res) => {
  const { tier } = req.body;
  const valid = ['free', 'starter', 'pro', 'agency'];
  if (!valid.includes(tier)) return res.status(400).json({ error: 'Invalid tier' });
  db.setTier(req.user.googleId, tier);
  const user = db.findByGoogleId(req.user.googleId);
  res.json({ tier: user.tier });
});

module.exports = router;
