const OpenAI    = require('openai');
const { getDb } = require('../db/init');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const WINDOW_LIMIT    = 2000;
const MIN_MATCHES     = 3;
const DECAY_HALF_LIFE = 30;

let _openai = null;
function getClient() {
  if (_openai) return _openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

function hasEmbeddingSupport() {
  return !!process.env.OPENAI_API_KEY;
}

async function embed(text) {
  const client = getClient();
  if (!client) throw new Error('[similarityEngine] OPENAI_API_KEY not set');
  const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return res.data[0].embedding;
}

function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizePerformanceScore(perf) {
  const clipped = Math.max(-3, Math.min(3, perf ?? 0));
  return (clipped + 3) / 6; // [0, 1]
}

/**
 * Fetch top performers in the same niche with real view data.
 * Returns up to 20 rows sorted by performance_score DESC.
 */
function searchPerformancePeers(niche, excludeId) {
  const db = getDb();
  const rows = db.all(
    `SELECT v.id AS video_id, v.title, v.niche, v.upload_date,
            pm.performance_score, pm.views
     FROM performance_metrics pm
     JOIN videos v ON v.id = pm.video_id
     WHERE pm.training_ready = 1
       AND v.niche = ?
       AND pm.video_id != ?
     ORDER BY pm.performance_score DESC
     LIMIT 20`,
    [niche, excludeId ?? -1],
  );
  return rows.map(r => ({
    video_id:          r.video_id,
    title:             r.title,
    niche:             r.niche,
    performance_score: r.performance_score,
    normalized_perf:   normalizePerformanceScore(r.performance_score),
    views:             r.views,
    source:            'performance',
  }));
}

/**
 * Cosine similarity search against stored embeddings with freshness decay.
 */
function searchSimilarByVector(queryVector, niche, excludeId) {
  const db = getDb();

  const rows = db.all(
    `SELECT
       e.video_id, e.vector, e.created_at,
       v.title, v.niche, v.upload_date,
       pm.performance_score
     FROM embeddings e
     JOIN videos v ON v.id = e.video_id
     LEFT JOIN performance_metrics pm ON pm.video_id = e.video_id
     WHERE e.video_id != ?
     ORDER BY
       CASE WHEN v.niche = ? THEN 0 ELSE 1 END,
       e.created_at DESC
     LIMIT ?`,
    [excludeId ?? -1, niche, WINDOW_LIMIT],
  );

  if (!rows.length) return [];

  const now = Date.now();

  return rows
    .map(row => {
      const vec    = JSON.parse(row.vector);
      const rawSim = cosine(queryVector, vec);
      const uploadMs = row.upload_date ? new Date(row.upload_date).getTime() : now;
      const daysOld  = Math.max(0, (now - uploadMs) / 86400000);
      const decayed  = rawSim * Math.exp(-daysOld / DECAY_HALF_LIFE);

      return {
        video_id:          row.video_id,
        title:             row.title,
        niche:             row.niche,
        performance_score: row.performance_score ?? null,
        normalized_perf:   row.performance_score != null ? normalizePerformanceScore(row.performance_score) : null,
        similarity_score:  parseFloat((rawSim * 100).toFixed(2)),
        days_since_upload: Math.round(daysOld),
        source:            'embedding_only',
        _decayed:          decayed,
      };
    })
    .sort((a, b) => b._decayed - a._decayed)
    .slice(0, 10)
    .map(({ _decayed, ...rest }) => rest);
}

/**
 * Merge embedding matches and performance peers into a unified ranked list.
 * rank_score = (similarity * 0.4) + (normalized_perf * 0.6)
 * Missing components use a neutral baseline (0.5).
 */
function mergeResults(embeddingMatches, performancePeers) {
  const byId = new Map();

  for (const peer of performancePeers) {
    byId.set(peer.video_id, {
      ...peer,
      similarity_score: null,
      rank_score: peer.normalized_perf * 0.6,
      source: 'performance',
    });
  }

  for (const match of embeddingMatches) {
    const simNorm = match.similarity_score / 100;
    if (byId.has(match.video_id)) {
      const entry = byId.get(match.video_id);
      entry.similarity_score = match.similarity_score;
      entry.rank_score = simNorm * 0.4 + (entry.normalized_perf ?? 0.5) * 0.6;
      entry.source = 'hybrid';
    } else {
      const normPerf = match.normalized_perf ?? 0.5;
      byId.set(match.video_id, {
        ...match,
        rank_score: simNorm * 0.4 + normPerf * 0.6,
        source: match.performance_score != null ? 'hybrid' : 'embedding_only',
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, 5);
}

/**
 * Main entry point: generate + store embedding (if OpenAI available),
 * fetch performance peers, merge, and return unified result.
 */
async function processEmbeddingAndSearch(videoId, title, hook, niche) {
  const db = getDb();
  const performancePeers = searchPerformancePeers(niche, videoId);

  let embeddingMatches = [];
  if (hasEmbeddingSupport()) {
    try {
      const vector = await embed(`${title} ${hook} ${niche}`);
      db.run(
        'INSERT OR REPLACE INTO embeddings (video_id, vector, created_at) VALUES (?, ?, ?)',
        [videoId, JSON.stringify(vector), new Date().toISOString()],
      );
      embeddingMatches = searchSimilarByVector(vector, niche, videoId);
    } catch (e) {
      console.warn('[similarity] Embedding failed, using performance peers only:', e.message);
    }
  }

  const merged = mergeResults(embeddingMatches, performancePeers);

  const topPeers = performancePeers.slice(0, 5);
  const peerContextScore = topPeers.length > 0
    ? parseFloat((topPeers.reduce((s, p) => s + p.normalized_perf, 0) / topPeers.length * 100).toFixed(2))
    : null;

  const dataSource = embeddingMatches.length > 0
    ? (performancePeers.length > 0 ? 'hybrid' : 'embedding_only')
    : (performancePeers.length > 0 ? 'performance' : 'none');

  return {
    matches:            merged,
    peer_context_score: peerContextScore,
    peer_count:         performancePeers.length,
    source:             dataSource,
    low_confidence:     merged.length < MIN_MATCHES,
  };
}

module.exports = { processEmbeddingAndSearch, searchPerformancePeers, normalizePerformanceScore };
