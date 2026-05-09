const crypto = require('crypto');

const TTL_MS = 60 * 60 * 1000; // 1 hour

let _versionStamp = 0;
const _cache = new Map();

function bumpVersionStamp() {
  _versionStamp++;
}

function makeKey(title, hook, niche) {
  return crypto.createHash('md5')
    .update(`${title}|${hook}|${niche}|${_versionStamp}`)
    .digest('hex');
}

function get(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) { _cache.delete(key); return null; }
  return entry.data;
}

function set(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

function size() {
  return _cache.size;
}

module.exports = { makeKey, get, set, bumpVersionStamp, size };
