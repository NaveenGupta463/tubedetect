'use strict';

const { verifySession } = require('../services/auth');
const { getDb } = require('../db/init');

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Best-effort: attach req.user from the session cookie. Also sets req.isAdmin when the logged-in user
// is an admin — composing with attachAdmin's x-admin-token path, so EITHER a valid admin token or an
// admin session grants the same all-limits-exempt status. Never throws (missing table / no cookie →
// req.user stays undefined). Fetches the row each request so role/tier/credits and revocation are live.
function attachUser(req, _res, next) {
  try {
    const sid = parseCookies(req).sid;
    const payload = sid ? verifySession(sid) : null;
    if (payload) {
      const u = getDb().get(
        'SELECT id, email, name, role, tier, credits, token_version FROM users WHERE id = ?',
        [payload.uid],
      );
      if (u && u.token_version === payload.tv) {
        req.user = u;
        if (u.role === 'admin') req.isAdmin = true;
      }
    }
  } catch (_) { /* auth is best-effort; unauth requests proceed as anonymous */ }
  next();
}

// Enforcement is OPT-IN via AUTH_ENFORCED=1 so switching auth on doesn't lock out an app whose frontend
// sign-in hasn't shipped yet. Off ⇒ pass-through (pre-launch). On ⇒ a logged-in user (or admin) required.
function requireAuth(req, res, next) {
  if (process.env.AUTH_ENFORCED !== '1') return next();
  if (req.user || req.isAdmin) return next();
  return res.status(401).json({ error: 'authentication required' });
}

module.exports = { attachUser, requireAuth, parseCookies };
