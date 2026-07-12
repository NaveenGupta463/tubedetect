'use strict';

// Layer 3: SEMANTIC peer matching. Lexical fingerprint matching ("shares words") can't tell a
// music-video channel from a talk-show clip channel even when both say "Ariana Grande". Neural
// embeddings put them in different regions of vector space, so cosine similarity is a far better
// "same KIND of channel" signal. Channel vector = OpenAI text-embedding-3-small of recent titles,
// cached in semantic_embeddings (source_type='creator_profile'). Used to RE-RANK the (already
// Layer-1-gated) peer pool — refinement on top of the gate, not a replacement.

const OpenAI = require('openai');

const EMODEL = 'text-embedding-3-small';
const EVERSION = '1.0';

let _client = null;
function client() {
  if (_client) return _client;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('[channelEmbeddings] missing OPENAI_API_KEY');
  _client = new OpenAI({ apiKey: key });
  return _client;
}

function channelText(db, channelId) {
  const titles = db.all(
    `SELECT title FROM ingested_videos WHERE channel_id=? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 40`,
    [channelId],
  ).map(r => r.title);
  return titles.join(' \n ').slice(0, 6000) || '.';
}

function readVec(db, channelId) {
  try {
    const r = db.get(`SELECT vector_json FROM semantic_embeddings WHERE source_type='creator_profile' AND source_id=? AND embedding_model=? AND embedding_version=? LIMIT 1`, [channelId, EMODEL, EVERSION]);
    return r ? JSON.parse(r.vector_json) : null;
  } catch (_) { return null; }
}
function vecNorm(v) { let s = 0; for (const x of v) s += x * x; return Math.sqrt(s) || 1; }
function writeVec(db, channelId, vec) {
  try {
    db.run(
      `INSERT INTO semantic_embeddings (source_type, source_id, embedding_model, embedding_version, vector_json, vector_norm)
       VALUES ('creator_profile', ?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id, embedding_model, embedding_version)
       DO UPDATE SET vector_json=excluded.vector_json, vector_norm=excluded.vector_norm, updated_at=datetime('now')`,
      [channelId, EMODEL, EVERSION, JSON.stringify(vec), vecNorm(vec)],
    );
  } catch (_) {}
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

// Embed a set of channels (batched, cached). Returns Map<channelId, vector>. Never throws.
async function embedChannels(db, channelIds) {
  const out = new Map();
  const need = [];
  for (const id of channelIds) { const v = readVec(db, id); if (v) out.set(id, v); else if (!need.includes(id)) need.push(id); }
  for (let i = 0; i < need.length; i += 64) {
    const batch = need.slice(i, i + 64);
    let resp;
    try { resp = await client().embeddings.create({ model: EMODEL, input: batch.map(id => channelText(db, id)) }); }
    catch (_) { continue; }
    (resp.data || []).forEach((d, j) => { const id = batch[j]; if (d?.embedding) { writeVec(db, id, d.embedding); out.set(id, d.embedding); } });
  }
  return out;
}

// Re-rank a (gated) peer pool by cosine similarity to the creator. Lazily embeds + caches the
// creator and the top `limit` candidates. Returns peerIds reordered (best-semantic first), with
// any tail beyond `limit` appended unchanged. No key / failure → returns input order unchanged.
async function rerankBySemantic(db, channelId, peerIds, { limit = 120 } = {}) {
  if (!channelId || !Array.isArray(peerIds) || peerIds.length < 2) return peerIds;
  const head = peerIds.slice(0, limit), tail = peerIds.slice(limit);
  let vecs;
  try { vecs = await embedChannels(db, [channelId, ...head]); } catch (_) { return peerIds; }
  const cv = vecs.get(channelId);
  if (!cv) return peerIds;
  const scored = head.map(id => ({ id, s: vecs.has(id) ? cosine(cv, vecs.get(id)) : -1 }));
  scored.sort((a, b) => b.s - a.s);
  return [...scored.map(x => x.id), ...tail];
}

// SYNCHRONOUS rerank using ONLY cached vectors (no API call) — safe to call from the sync core
// resolver, so every WTP surface benefits. No-op when the creator or too few peers are embedded
// (run scripts/embedChannels.js --commit to populate corpus-wide).
function rerankBySemanticSync(db, channelId, peerIds, { limit = 150 } = {}) {
  if (!channelId || !Array.isArray(peerIds) || peerIds.length < 3) return peerIds;
  const cv = readVec(db, channelId);
  if (!cv) return peerIds;
  const head = peerIds.slice(0, limit), tail = peerIds.slice(limit);
  const cached = new Map();
  try {
    const ph = head.map(() => '?').join(',');
    for (const r of db.all(`SELECT source_id, vector_json FROM semantic_embeddings WHERE source_type='creator_profile' AND embedding_model=? AND source_id IN (${ph})`, [EMODEL, ...head])) {
      try { cached.set(r.source_id, JSON.parse(r.vector_json)); } catch (_) {}
    }
  } catch (_) { return peerIds; }
  if (cached.size < Math.min(head.length, 5)) return peerIds; // too few embedded → keep resolver order
  const scored = head.map(id => ({ id, s: cached.has(id) ? cosine(cv, cached.get(id)) : -1 }));
  scored.sort((a, b) => b.s - a.s);
  return [...scored.map(x => x.id), ...tail];
}

// SYNCHRONOUS semantic FILTER (not just rerank) using cached vectors — for creators with no
// keyword sub-niche ("general") inside a coarse bucket: drop peers whose cosine to the creator is
// below `floor`. Unembedded peers are kept (benefit of the doubt). No-ops safely (returns input) if
// the creator isn't embedded, too few peers are embedded, or the result would fall below `minKeep`.
function filterBySemanticSync(db, channelId, peerIds, { floor = 0.34, minKeep = 15, limit = 200 } = {}) {
  if (!channelId || !Array.isArray(peerIds) || peerIds.length <= minKeep) return peerIds;
  const cv = readVec(db, channelId);
  if (!cv) return peerIds;
  const head = peerIds.slice(0, limit), tail = peerIds.slice(limit);
  const cached = new Map();
  try {
    const ph = head.map(() => '?').join(',');
    for (const r of db.all(`SELECT source_id, vector_json FROM semantic_embeddings WHERE source_type='creator_profile' AND embedding_model=? AND source_id IN (${ph})`, [EMODEL, ...head])) {
      try { cached.set(r.source_id, JSON.parse(r.vector_json)); } catch (_) {}
    }
  } catch (_) { return peerIds; }
  if (cached.size < Math.min(head.length, 8)) return peerIds; // too little signal to filter on
  const kept = head.filter(id => { const v = cached.get(id); return v ? cosine(cv, v) >= floor : true; });
  const result = [...kept, ...tail];
  return result.length >= minKeep ? result : peerIds; // coverage floor — never starve the pool
}

module.exports = { embedChannels, rerankBySemantic, rerankBySemanticSync, filterBySemanticSync, cosine, channelText, EMODEL };
