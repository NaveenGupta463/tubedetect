'use strict';

// Boundary input validators. Untrusted request input must be shape-checked before it reaches a DB
// query, an external API URL, or a prompt. SQL is already parameterized (better-sqlite3 `?`), so the
// priority here is identifiers that get interpolated into upstream URLs (YouTube channel/video ids)
// and bounding free-text / numeric params. Extend this module route-by-route (P1).

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/; // YouTube channel id: UC + 22 url-safe chars
const VIDEO_ID_RE   = /^[A-Za-z0-9_-]{11}$/;   // YouTube video id: 11 url-safe chars
const CONTROL_RE    = new RegExp('[\\u0000-\\u001f\\u007f]', 'g'); // C0 controls + DEL

function isChannelId(s) { return typeof s === 'string' && CHANNEL_ID_RE.test(s); }
function isVideoId(s)   { return typeof s === 'string' && VIDEO_ID_RE.test(s); }

// Parse + clamp an integer param (pagination, limits) to a safe range.
function clampInt(v, { min = 0, max = 1000, def = min } = {}) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// Strip control chars and cap length on free-text (search queries etc.) so oversized/odd input can't
// reach LIKE scans or logs.
function cleanText(s, max = 200) {
  return String(s || '').replace(CONTROL_RE, '').trim().slice(0, max);
}

module.exports = { isChannelId, isVideoId, clampInt, cleanText, CHANNEL_ID_RE, VIDEO_ID_RE };
