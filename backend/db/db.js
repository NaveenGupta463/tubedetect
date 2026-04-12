'use strict';
/**
 * Simple JSON file database — no native compilation required.
 * Stored at backend/db.json. Fine for development and early production.
 * Swap for SQLite/Postgres when you need concurrent writes at scale.
 */
const fs   = require('fs');
const path = require('path');

// DATA_DIR lets you point the database at a mounted Cloud Run volume.
// Default: backend/db.json (ephemeral in containers — mount a volume for persistence).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH  = path.join(DATA_DIR, 'db.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

let _nextId = null;

function nextId() {
  if (_nextId === null) {
    const db = read();
    _nextId = db.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
  }
  return _nextId++;
}

// ── Public API ──────────────────────────────────────────────────────────────

function findByGoogleId(googleId) {
  return read().users.find(u => u.google_id === googleId) || null;
}

function findById(id) {
  return read().users.find(u => u.id === id) || null;
}

function upsertUser({ google_id, email, name, thumbnail, refresh_token }) {
  const db = read();
  const idx = db.users.findIndex(u => u.google_id === google_id);

  if (idx === -1) {
    const user = {
      id:                   nextId(),
      google_id,
      email,
      name,
      thumbnail,
      refresh_token:        refresh_token || null,
      tier:                 'free',
      ai_calls_used:        0,
      ai_calls_reset_month: '',
    };
    db.users.push(user);
    write(db);
    return user;
  }

  // Update profile fields + refresh token if a new one was issued
  db.users[idx] = {
    ...db.users[idx],
    email,
    name,
    thumbnail,
    ...(refresh_token ? { refresh_token } : {}),
  };
  write(db);
  return db.users[idx];
}

/**
 * Check AI call limit and increment if allowed.
 * Returns { allowed: true } or { allowed: false, error, tier, limit, used }
 */
function checkAndConsumeAICall(googleId, tierLimits) {
  const db  = read();
  const idx = db.users.findIndex(u => u.google_id === googleId);
  if (idx === -1) return { allowed: false, error: 'User not found' };

  const user         = db.users[idx];
  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-04"
  const limit        = tierLimits[user.tier] ?? 0;

  if (user.ai_calls_reset_month !== currentMonth) {
    // New month — reset to 1 (this call is the first)
    db.users[idx].ai_calls_used        = 1;
    db.users[idx].ai_calls_reset_month = currentMonth;
    write(db);
    return { allowed: true };
  }

  if (limit !== Infinity && user.ai_calls_used >= limit) {
    return { allowed: false, error: 'AI call limit reached for this month. Upgrade your plan to continue.', tier: user.tier, limit, used: user.ai_calls_used };
  }

  db.users[idx].ai_calls_used += 1;
  write(db);
  return { allowed: true };
}

function setTier(googleId, tier) {
  const db  = read();
  const idx = db.users.findIndex(u => u.google_id === googleId);
  if (idx !== -1) {
    db.users[idx].tier = tier;
    write(db);
  }
}

module.exports = { findByGoogleId, findById, upsertUser, checkAndConsumeAICall, setTier };
