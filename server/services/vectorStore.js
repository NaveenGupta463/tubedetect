'use strict';

// G4/G5 — Provider-abstracted vector storage and retrieval.
// Current provider: sqlite_json (brute-force cosine scan with cluster pre-filter).
// Future providers: sqlite_vec_future, pgvector_future.
//
// ARCHITECTURE RULE: All vector operations go through this module.
// Never embed SQL or provider logic directly into routing or semantic services.
// Swap provider by changing ACTIVE_PROVIDER — interfaces stay identical.

const VECTOR_PROVIDERS = {
  SQLITE_JSON: 'sqlite_json',
  SQLITE_VEC:  'sqlite_vec_future',   // not yet implemented
  PGVECTOR:    'pgvector_future',     // not yet implemented
};

const ACTIVE_PROVIDER = VECTOR_PROVIDERS.SQLITE_JSON;

// ── Math helpers ──────────────────────────────────────────────────────────────

function computeNorm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

function normalizeVector(vec) {
  const norm = computeNorm(vec);
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── sqlite_json provider ──────────────────────────────────────────────────────
// Nearest-neighbor flow:
//   1. filter by cluster (reduces scan)
//   2. optional source_type filter
//   3. optional minConfidence filter
//   4. brute-force cosine similarity
//   5. top-k selection

const SQLITE_JSON_IMPL = {
  name: VECTOR_PROVIDERS.SQLITE_JSON,

  upsertVector(db, { source_type, source_id, embedding_model, embedding_version, vector, semantic_cluster, semantic_confidence }) {
    const vec     = Array.isArray(vector) ? vector : JSON.parse(vector);
    const norm    = computeNorm(vec);
    const vecJson = JSON.stringify(vec);
    db.run(`
      INSERT INTO semantic_embeddings
        (source_type, source_id, embedding_model, embedding_version,
         vector_json, vector_norm, semantic_cluster, semantic_confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(source_type, source_id, embedding_model, embedding_version) DO UPDATE SET
        vector_json         = excluded.vector_json,
        vector_norm         = excluded.vector_norm,
        semantic_cluster    = COALESCE(excluded.semantic_cluster, semantic_cluster),
        semantic_confidence = COALESCE(excluded.semantic_confidence, semantic_confidence),
        updated_at          = datetime('now')
    `, [source_type, source_id, embedding_model, embedding_version,
        vecJson, norm, semantic_cluster ?? null, semantic_confidence ?? 0.0]);
  },

  getVector(db, { source_type, source_id, embedding_model, embedding_version }) {
    const row = db.get(
      `SELECT * FROM semantic_embeddings
       WHERE source_type=? AND source_id=? AND embedding_model=? AND embedding_version=?`,
      [source_type, source_id, embedding_model, embedding_version],
    );
    if (!row) return null;
    return { ...row, vector: JSON.parse(row.vector_json) };
  },

  findNearest(db, { queryVector, sourceType, cluster, limit = 10, minConfidence = 0 }) {
    let sql = `SELECT id, source_type, source_id, embedding_model, embedding_version,
                      vector_json, vector_norm, semantic_cluster, semantic_confidence, created_at
               FROM semantic_embeddings WHERE vector_json IS NOT NULL`;
    const params = [];
    if (cluster)         { sql += ` AND semantic_cluster = ?`;     params.push(cluster); }
    if (sourceType)      { sql += ` AND source_type = ?`;          params.push(sourceType); }
    if (minConfidence > 0) { sql += ` AND semantic_confidence >= ?`; params.push(minConfidence); }

    const rows = db.all(sql, params);
    if (!rows.length) return [];

    const qVec   = Array.isArray(queryVector) ? queryVector : JSON.parse(queryVector);
    const scored = rows.map(row => ({
      ...row,
      similarity: cosineSimilarity(qVec, JSON.parse(row.vector_json)),
    }));

    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(r => ({
        id:                  r.id,
        source_type:         r.source_type,
        source_id:           r.source_id,
        embedding_model:     r.embedding_model,
        embedding_version:   r.embedding_version,
        similarity:          parseFloat(r.similarity.toFixed(4)),
        semantic_cluster:    r.semantic_cluster,
        semantic_confidence: r.semantic_confidence,
        created_at:          r.created_at,
      }));
  },

  countVectors(db, { sourceType } = {}) {
    if (sourceType) {
      return db.get(`SELECT COUNT(*) AS n FROM semantic_embeddings WHERE source_type=?`, [sourceType])?.n ?? 0;
    }
    return db.get(`SELECT COUNT(*) AS n FROM semantic_embeddings`)?.n ?? 0;
  },
};

// ── Future provider stubs ─────────────────────────────────────────────────────

const SQLITE_VEC_IMPL = {
  name: VECTOR_PROVIDERS.SQLITE_VEC,
  upsertVector() { throw new Error('sqlite-vec provider not yet implemented — upgrade path from sqlite_json'); },
  getVector()    { throw new Error('sqlite-vec provider not yet implemented'); },
  findNearest()  { throw new Error('sqlite-vec provider not yet implemented'); },
  countVectors() { throw new Error('sqlite-vec provider not yet implemented'); },
};

const PGVECTOR_IMPL = {
  name: VECTOR_PROVIDERS.PGVECTOR,
  upsertVector() { throw new Error('pgvector provider not yet implemented — upgrade path from sqlite_json'); },
  getVector()    { throw new Error('pgvector provider not yet implemented'); },
  findNearest()  { throw new Error('pgvector provider not yet implemented'); },
  countVectors() { throw new Error('pgvector provider not yet implemented'); },
};

// ── Provider registry ─────────────────────────────────────────────────────────

const PROVIDER_MAP = {
  [VECTOR_PROVIDERS.SQLITE_JSON]: SQLITE_JSON_IMPL,
  [VECTOR_PROVIDERS.SQLITE_VEC]:  SQLITE_VEC_IMPL,
  [VECTOR_PROVIDERS.PGVECTOR]:    PGVECTOR_IMPL,
};

function getProvider(name) {
  return PROVIDER_MAP[name ?? ACTIVE_PROVIDER] ?? SQLITE_JSON_IMPL;
}

// ── Public API ────────────────────────────────────────────────────────────────

module.exports = {
  VECTOR_PROVIDERS,
  ACTIVE_PROVIDER,
  cosineSimilarity,
  normalizeVector,
  computeNorm,
  upsertVector:  (db, params, providerName) => getProvider(providerName).upsertVector(db, params),
  getVector:     (db, params, providerName) => getProvider(providerName).getVector(db, params),
  findNearest:   (db, params, providerName) => getProvider(providerName).findNearest(db, params),
  countVectors:  (db, params, providerName) => getProvider(providerName).countVectors(db, params),
};
