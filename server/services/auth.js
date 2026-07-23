'use strict';

const crypto = require('crypto');

// Authentication core: Google Sign-In → a server-verified user record → a stateless, HMAC-signed
// session cookie. No new dependencies (Google's tokeninfo endpoint verifies the id_token; crypto signs
// the session). The owner's account is role=admin, which flows into req.isAdmin and exempts every limit.

function ensureAuthSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT, name TEXT, picture TEXT,
    role TEXT NOT NULL DEFAULT 'user',       -- 'user' | 'admin'
    tier TEXT NOT NULL DEFAULT 'free',        -- free | starter | pro | agency
    credits INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 1, -- bump to revoke all of a user's sessions
    created_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_sub ON users(google_sub)`);
}

// Verify a Google ID token server-side via Google's tokeninfo endpoint, then check audience, issuer,
// expiry, and email-verified. (Fine for launch scale; swap for local JWKS verification if volume grows.)
async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not configured');
  if (!idToken || typeof idToken !== 'string') throw new Error('missing id_token');
  const resp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
  if (!resp.ok) throw new Error('invalid id_token');
  const p = await resp.json();
  if (p.aud !== clientId) throw new Error('audience mismatch');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('bad issuer');
  if (Number(p.exp) * 1000 < Date.now()) throw new Error('token expired');
  if (p.email_verified !== 'true' && p.email_verified !== true) throw new Error('email not verified');
  return { sub: p.sub, email: p.email, name: p.name || p.email, picture: p.picture || null };
}

// Create or update the user. The account matching ADMIN_EMAIL (or the very first user) becomes admin.
function upsertUser(db, prof) {
  ensureAuthSchema(db);
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const isAdminEmail = adminEmail && prof.email && prof.email.toLowerCase() === adminEmail;
  const existing = db.get('SELECT * FROM users WHERE google_sub = ?', [prof.sub]);
  if (existing) {
    db.run(`UPDATE users SET email=?, name=?, picture=?, last_login_at=datetime('now') WHERE id=?`,
      [prof.email, prof.name, prof.picture, existing.id]);
    if (isAdminEmail && existing.role !== 'admin') db.run('UPDATE users SET role=? WHERE id=?', ['admin', existing.id]);
    return db.get('SELECT * FROM users WHERE id=?', [existing.id]);
  }
  const id = crypto.randomUUID();
  const firstUser = db.get('SELECT COUNT(*) c FROM users').c === 0;
  const admin = isAdminEmail || firstUser;
  db.run(`INSERT INTO users (id, google_sub, email, name, picture, role, tier, credits, last_login_at)
          VALUES (?,?,?,?,?,?,?,?, datetime('now'))`,
    [id, prof.sub, prof.email, prof.name, prof.picture, admin ? 'admin' : 'user', admin ? 'agency' : 'free', admin ? 0 : 5]);
  return db.get('SELECT * FROM users WHERE id=?', [id]);
}

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET missing or too short (min 16 chars)');
  return s;
}
const b64url = buf => Buffer.from(buf).toString('base64url');
const signPart = data => crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');

// Stateless session token: base64url(payload).hmac. Payload carries uid + token_version + expiry.
function signSession(user, { ttlMs = 7 * 24 * 3600 * 1000 } = {}) {
  const body = b64url(JSON.stringify({ uid: user.id, tv: user.token_version, exp: Date.now() + ttlMs }));
  return `${body}.${signPart(body)}`;
}
function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = signPart(body);
  const a = Buffer.from(sig || ''); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload; try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload; // { uid, tv, exp }
}

module.exports = { ensureAuthSchema, verifyGoogleIdToken, upsertUser, signSession, verifySession };
