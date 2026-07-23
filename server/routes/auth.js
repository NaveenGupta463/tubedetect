'use strict';

const express = require('express');
const { getDb } = require('../db/init');
const { verifyGoogleIdToken, upsertUser, signSession } = require('../services/auth');

const router = express.Router();

const MAX_AGE = 7 * 24 * 3600; // seconds
function setSessionCookie(res, token) {
  const parts = [`sid=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${MAX_AGE}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}
const publicUser = u => ({ email: u.email, name: u.name, role: u.role, tier: u.tier, credits: u.credits });

// Exchange a Google ID token for a session. Frontend gets a Google credential (GIS) and POSTs it here;
// we verify server-side, upsert the user, and set an httpOnly session cookie (token never touches JS).
router.post('/auth/google', async (req, res) => {
  try {
    const prof = await verifyGoogleIdToken(req.body?.id_token);
    const user = upsertUser(getDb(), prof);
    setSessionCookie(res, signSession(user));
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    console.warn('[auth] google sign-in failed:', e.message);
    res.status(401).json({ error: 'sign-in failed' });
  }
});

// Logout: bump token_version (revokes every existing session for this user) + clear the cookie.
router.post('/auth/logout', (req, res) => {
  try { if (req.user) getDb().run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]); } catch (_) {}
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Who am I — the frontend calls this on load to know the session state (cookie is httpOnly).
router.get('/auth/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

module.exports = router;
