const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function wrap(key, fn, ttlMs = DEFAULT_TTL) {
  const cached = get(key);
  if (cached !== null) return cached;
  const result = fn();
  set(key, result, ttlMs);
  return result;
}

function stats() {
  let active = 0;
  const now = Date.now();
  for (const entry of store.values()) {
    if (now <= entry.expiresAt) active++;
  }
  return { total: store.size, active };
}

module.exports = { get, set, invalidate, wrap, stats };
