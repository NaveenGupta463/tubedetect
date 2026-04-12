'use strict';
const express = require('express');
const jwt     = require('jsonwebtoken');
const db      = require('../db/db');

const router = express.Router();

// POST /api/auth/google
// Body: { code, code_verifier, redirect_uri }  — PKCE authorization code flow
// Exchanges code with Google, upserts user, returns { token, user, access_token }
router.post('/google', async (req, res) => {
  const { code, code_verifier, redirect_uri } = req.body;
  if (!code || !code_verifier || !redirect_uri) {
    return res.status(400).json({ error: 'code, code_verifier, and redirect_uri are required' });
  }

  // 1. Exchange authorization code for tokens with Google
  let tokens;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        code,
        code_verifier,
        redirect_uri,
        grant_type:    'authorization_code',
      }),
    });
    tokens = await r.json();
    if (!r.ok || tokens.error) {
      console.error('[Auth] Google token exchange failed:', tokens);
      return res.status(401).json({ error: tokens.error_description || 'Google token exchange failed' });
    }
  } catch {
    return res.status(502).json({ error: 'Could not reach Google token endpoint' });
  }

  const access_token  = tokens.access_token;
  const refresh_token = tokens.refresh_token || null;

  // 2. Get user info from Google
  let googleUser;
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    googleUser = await r.json();
    if (!r.ok || !googleUser.sub) {
      return res.status(401).json({ error: 'Could not fetch Google user info' });
    }
  } catch {
    return res.status(502).json({ error: 'Could not reach Google userinfo endpoint' });
  }

  const google_id = googleUser.sub;
  const email     = googleUser.email     || '';
  const name      = googleUser.name      || email.split('@')[0] || 'User';
  const thumbnail = googleUser.picture   || '';

  // 3. Upsert user in DB (stores refresh token for future silent re-auth)
  const user = db.upsertUser({ google_id, email, name, thumbnail, refresh_token });

  // 4. Issue JWT (30 days)
  const token = jwt.sign(
    { userId: user.id, googleId: user.google_id, email: user.email, tier: user.tier },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  return res.json({
    token,
    access_token,
    user: {
      id:          user.id,
      email:       user.email,
      name:        user.name,
      thumbnail:   user.thumbnail,
      tier:        user.tier,
      aiCallsUsed: user.ai_calls_used,
    },
  });
});

module.exports = router;
