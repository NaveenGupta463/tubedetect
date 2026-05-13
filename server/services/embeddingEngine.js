'use strict';

// G2 — Provider-abstracted embedding generation.
//
// Tier 1 — OpenAI text-embedding-3-small  (requires OPENAI_API_KEY)
// Tier 2 — TF-IDF fallback                (always available after corpus build)
// Tier 3 — Graceful degradation           (returns null, logs unavailability)
//
// ARCHITECTURE RULE: Callers never reference provider names.
// All provider switching happens in detectProvider() — one place.
// Future local/ONNX/transformer providers plug in here WITHOUT rewrites elsewhere.
//
// ROUTING SAFETY: semantic_confidence and behavioral_confidence are SEPARATE.
// Do NOT merge them. TF-IDF results carry a confidence penalty (0.65×).

const EMBEDDING_PROVIDERS = {
  OPENAI:      'openai_embedding',
  LOCAL:       'local_embedding',    // future — not yet implemented
  TFIDF:       'tfidf_fallback',
  UNAVAILABLE: 'unavailable',
};

const OPENAI_MODEL         = 'text-embedding-3-small';
const OPENAI_MODEL_VERSION = '1';
const TFIDF_MODEL          = 'tfidf_v1';
const TFIDF_MODEL_VERSION  = '1.0';

// Phase G9 — TF-IDF results carry this multiplier vs. learned embedding confidence.
const TFIDF_CONFIDENCE_PENALTY = 0.65;

// Semantic tier thresholds and trust weights.
// top: ≥ 0.82, borderline: [0.68, 0.82), outlier: < 0.68
const TIER_THRESHOLDS = { TOP: 0.82, BORDERLINE: 0.68 };
const TIER_DECAY      = { top: 1.0, borderline: 0.75, outlier: 0.45 };

function classifyNeighborTier(sim) {
  if (sim >= TIER_THRESHOLDS.TOP)        return { semantic_tier: 'top',        semantic_weight: 1.0 };
  if (sim >= TIER_THRESHOLDS.BORDERLINE) return { semantic_tier: 'borderline', semantic_weight: 0.5 };
  return                                        { semantic_tier: 'outlier',     semantic_weight: 0.2 };
}

// ── Provider detection ────────────────────────────────────────────────────────

function detectProvider() {
  if (process.env.OPENAI_API_KEY) return EMBEDDING_PROVIDERS.OPENAI;
  // Future: if (localModelExists()) return EMBEDDING_PROVIDERS.LOCAL;
  return EMBEDDING_PROVIDERS.TFIDF;
}

// ── OpenAI embedding (Tier 1) ─────────────────────────────────────────────────

async function generateOpenAIEmbedding(text) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resp   = await client.embeddings.create({
    model: OPENAI_MODEL,
    input: text.slice(0, 8000),
  });
  return resp.data[0].embedding;
}

// ── TF-IDF embedding (Tier 2, synchronous) ───────────────────────────────────

function generateTfidfEmbedding(db, text) {
  const { getOrBuildCorpus, computeTfidfVector } = require('./tfidfEngine');
  const corpus = getOrBuildCorpus(db);
  if (!corpus || !corpus.vocab.length) return null;
  return computeTfidfVector(text, corpus.vocab, corpus.idfMap, corpus.vocabIndex);
}

// ── Main generation API ───────────────────────────────────────────────────────

async function generateEmbedding(text, { provider, db } = {}) {
  const prov = provider ?? detectProvider();

  if (prov === EMBEDDING_PROVIDERS.OPENAI) {
    try {
      const vector = await generateOpenAIEmbedding(text);
      return {
        vector,
        provider:   EMBEDDING_PROVIDERS.OPENAI,
        model:      OPENAI_MODEL,
        version:    OPENAI_MODEL_VERSION,
        dim:        vector.length,
        confidence: 1.0,
      };
    } catch (e) {
      console.warn('[embed] OpenAI failed, falling back to TF-IDF:', e.message);
      // Fall through to TF-IDF
    }
  }

  if (db) {
    try {
      const vector = generateTfidfEmbedding(db, text);
      if (vector && vector.length > 0) {
        return {
          vector,
          provider:   EMBEDDING_PROVIDERS.TFIDF,
          model:      TFIDF_MODEL,
          version:    TFIDF_MODEL_VERSION,
          dim:        vector.length,
          confidence: TFIDF_CONFIDENCE_PENALTY,
        };
      }
    } catch (e) {
      console.warn('[embed] TF-IDF failed:', e.message);
    }
  }

  return null; // Tier 3: graceful degradation
}

// ── Semantic similarity ───────────────────────────────────────────────────────
// Returns SEPARATE semantic_confidence — never merged with behavioral_confidence.

function computeSemanticSimilarity(vecA, vecB, provider) {
  const { cosineSimilarity } = require('./vectorStore');
  const raw        = cosineSimilarity(vecA, vecB);
  const confidence = provider === EMBEDDING_PROVIDERS.TFIDF
    ? raw * TFIDF_CONFIDENCE_PENALTY
    : raw;
  return {
    similarity:        parseFloat(raw.toFixed(4)),
    semantic_confidence: parseFloat(confidence.toFixed(4)),  // NOT behavioral_confidence
    provider,
    is_tfidf_fallback: provider === EMBEDDING_PROVIDERS.TFIDF,
  };
}

// ── Store + retrieve ──────────────────────────────────────────────────────────

async function storeEmbedding(db, { source_type, source_id, text, provider, semantic_cluster, semantic_confidence }) {
  const prov = provider ?? detectProvider();
  const emb  = await generateEmbedding(text, { provider: prov, db });
  if (!emb) return null;

  const { upsertVector } = require('./vectorStore');
  upsertVector(db, {
    source_type,
    source_id,
    embedding_model:    emb.model,
    embedding_version:  emb.version,
    vector:             emb.vector,
    semantic_cluster:   semantic_cluster ?? null,
    semantic_confidence: semantic_confidence ?? emb.confidence,
  });
  return emb;
}

async function findNearestNeighbors(db, { text, sourceType, cluster, niche, limit = 10, provider } = {}) {
  const prov = provider ?? detectProvider();
  const emb  = await generateEmbedding(text, { provider: prov, db });

  if (!emb) {
    // TF-IDF direct scan fallback (no stored vectors needed)
    const { findNearestByTfidf } = require('./tfidfEngine');
    return findNearestByTfidf(db, text, { limit, niche });
  }

  const { findNearest } = require('./vectorStore');
  const neighbors = findNearest(db, {
    queryVector: emb.vector,
    sourceType:  sourceType ?? 'title_dna',
    cluster,
    limit,
  });

  // No stored vectors yet — fall back to TF-IDF direct scan
  if (!neighbors.length) {
    const { findNearestByTfidf } = require('./tfidfEngine');
    return findNearestByTfidf(db, text, { limit, niche });
  }

  return neighbors.map(n => {
    let title = null, titleNiche = null;
    try {
      const row = db.get(`SELECT title, niche FROM ingested_videos WHERE youtube_video_id = ?`, [n.source_id]);
      title = row?.title ?? null;
      titleNiche = row?.niche ?? null;
    } catch { /* non-fatal */ }
    const sim = n.similarity ?? 0;
    const { semantic_tier, semantic_weight } = classifyNeighborTier(sim);
    const tierDecay  = TIER_DECAY[semantic_tier] ?? 1.0;
    const rawConf    = emb.provider === EMBEDDING_PROVIDERS.TFIDF
      ? sim * TFIDF_CONFIDENCE_PENALTY
      : sim;
    return {
      ...n,
      title,
      niche:               titleNiche,
      provider:            emb.provider,
      semantic_confidence: parseFloat((rawConf * tierDecay).toFixed(4)),
      is_tfidf_fallback:   emb.provider === EMBEDDING_PROVIDERS.TFIDF,
      semantic_tier,
      semantic_weight,
      outlier_reason: semantic_tier === 'outlier'
        ? `similarity ${(sim * 100).toFixed(0)}% falls below structural similarity threshold (68%)`
        : null,
      secondary_archetypes: [],
    };
  });
}

// ── Provider status (for routing + dashboard) ─────────────────────────────────

function getSemanticProviderStatus() {
  const prov = detectProvider();
  return {
    provider:                prov,
    openai_available:        prov === EMBEDDING_PROVIDERS.OPENAI,
    tfidf_available:         true,
    local_available:         false,
    semantic_tier:           prov === EMBEDDING_PROVIDERS.OPENAI ? 1 : 2,
    tfidf_confidence_penalty: TFIDF_CONFIDENCE_PENALTY,
    model:                   prov === EMBEDDING_PROVIDERS.OPENAI ? OPENAI_MODEL : TFIDF_MODEL,
  };
}

module.exports = {
  EMBEDDING_PROVIDERS,
  OPENAI_MODEL,
  TFIDF_MODEL,
  TFIDF_CONFIDENCE_PENALTY,
  TIER_THRESHOLDS,
  TIER_DECAY,
  detectProvider,
  generateEmbedding,
  storeEmbedding,
  findNearestNeighbors,
  computeSemanticSimilarity,
  getSemanticProviderStatus,
};
