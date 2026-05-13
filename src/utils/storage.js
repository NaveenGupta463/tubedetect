// localStorage abstraction — swap internals for electron-store or SQLite later
// without changing any callers. All persistence goes through these functions.

export function get(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function set(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch {}
}

export function getJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// TTL cache — stores { ts, data } envelope, same format as youtube.js cacheGet/cacheSet
export function getCached(key, ttlMs) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttlMs) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

export function setCached(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function removeByPrefix(prefix) {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => localStorage.removeItem(k));
  } catch {}
}

// ── Video Brief CRUD (wizard output, stored locally) ──────────────────────────
const BRIEFS_KEY = 'tubeintel_briefs_v1';

export function getBriefs() {
  return getJSON(BRIEFS_KEY) || [];
}

export function saveBrief(brief) {
  const list = getBriefs();
  const idx  = list.findIndex(b => b.id === brief.id);
  if (idx >= 0) list[idx] = brief; else list.unshift(brief);
  setJSON(BRIEFS_KEY, list);
}

export function deleteBrief(id) {
  setJSON(BRIEFS_KEY, getBriefs().filter(b => b.id !== id));
}
