'use strict';

// G2.2 — TF-IDF fallback semantic engine.
// Provides Tier 2 semantic capability when embedding providers (OpenAI, local) are unavailable.
//
// Properties:
// - Lightweight: no external calls, no GPU
// - Deterministic: same input → same vector every time
// - Cacheable: corpus and IDF are computed once, reused
// - Explainable: every dimension maps to a human-readable term
//
// Architecture:
//   1. Build vocabulary from corpus (all ingested video titles)
//   2. Compute IDF weights per term
//   3. For any text: compute TF-IDF dense vector (fixed vocabulary dimension)
//   4. Cosine similarity for nearest-neighbor retrieval

const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should','may','might',
  'of','in','on','at','to','for','with','by','from','as','into','out','up','about',
  'and','or','but','not','this','that','these','those','it','its','you','your','i',
  'my','me','we','our','they','their','he','she','him','her','what','which','who',
  'when','where','how','why','all','any','few','more','most','other','can','just',
  'also','no','only','so','than','too','very','s','t','re','ve','ll','d','m',
  'then','else','each','every','both','either','neither','nor','yet','such',
]);

const MAX_VOCAB_SIZE = 2000;
const MIN_DOC_FREQ   = 2;

// ── Module state (lazy corpus) ────────────────────────────────────────────────

let _corpus = null;
// { vocab: string[], idfMap: {term: float}, vocabIndex: {term: int}, size: int, builtAt: Date }

// ── Tokenization ──────────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// ── TF computation ────────────────────────────────────────────────────────────

function computeTF(tokens) {
  const tf    = {};
  const total = tokens.length;
  if (total === 0) return tf;
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  for (const k of Object.keys(tf)) tf[k] /= total;
  return tf;
}

// ── IDF computation ───────────────────────────────────────────────────────────

function computeIDF(tokenizedDocs) {
  const docFreq = {};
  const N       = tokenizedDocs.length;
  for (const doc of tokenizedDocs) {
    const seen = new Set(doc);
    for (const t of seen) docFreq[t] = (docFreq[t] ?? 0) + 1;
  }
  const idfMap = {};
  for (const [term, freq] of Object.entries(docFreq)) {
    if (freq >= MIN_DOC_FREQ) {
      idfMap[term] = Math.log((N + 1) / (freq + 1)) + 1; // smoothed IDF
    }
  }
  return idfMap;
}

// ── Corpus building ───────────────────────────────────────────────────────────

function buildTfidfCorpus(db) {
  let rows = [];
  try {
    rows = db.all(`SELECT title FROM ingested_videos WHERE title IS NOT NULL LIMIT 20000`);
  } catch (e) {
    console.warn('[tfidf] corpus build failed:', e.message);
  }

  if (rows.length < 5) {
    _corpus = { vocab: [], idfMap: {}, vocabIndex: {}, size: rows.length, builtAt: new Date() };
    return _corpus;
  }

  const tokenizedDocs = rows.map(r => tokenize(r.title));
  const idfMap        = computeIDF(tokenizedDocs);

  // Select top-N terms by IDF score (rarest useful terms first)
  const vocab = Object.entries(idfMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VOCAB_SIZE)
    .map(([term]) => term);

  const vocabIndex = {};
  for (let i = 0; i < vocab.length; i++) vocabIndex[vocab[i]] = i;

  _corpus = { vocab, idfMap, vocabIndex, size: rows.length, builtAt: new Date() };
  console.log(`[tfidf] corpus built: ${rows.length} docs → ${vocab.length} vocab terms`);
  return _corpus;
}

function getOrBuildCorpus(db) {
  if (_corpus && _corpus.size > 0) return _corpus;
  return buildTfidfCorpus(db);
}

function invalidateCorpus() {
  _corpus = null;
}

// ── Vector computation ────────────────────────────────────────────────────────

function computeTfidfVector(text, vocab, idfMap, vocabIndex) {
  if (!vocab || vocab.length === 0) return [];
  const tokens = tokenize(text);
  const tf     = computeTF(tokens);
  const vec    = new Float64Array(vocab.length).fill(0);
  for (const [term, tfScore] of Object.entries(tf)) {
    const idx = vocabIndex[term];
    if (idx !== undefined && idfMap[term]) {
      vec[idx] = tfScore * idfMap[term];
    }
  }
  return Array.from(vec);
}

// ── Nearest-neighbor search (direct scan) ─────────────────────────────────────
// Used when stored embeddings are not available — scans raw titles directly.

function findNearestByTfidf(db, queryText, { limit = 10, niche } = {}) {
  const corpus = getOrBuildCorpus(db);
  if (!corpus.vocab.length) return [];

  const { cosineSimilarity } = require('./vectorStore');
  const queryVec = computeTfidfVector(queryText, corpus.vocab, corpus.idfMap, corpus.vocabIndex);

  let sql    = `SELECT youtube_video_id, title, niche FROM ingested_videos WHERE title IS NOT NULL`;
  const params = [];
  if (niche) { sql += ` AND niche = ?`; params.push(niche); }
  sql += ` LIMIT 5000`;

  const rows = db.all(sql, params);

  const scored = rows.map(row => {
    const docVec = computeTfidfVector(row.title, corpus.vocab, corpus.idfMap, corpus.vocabIndex);
    return { ...row, similarity: cosineSimilarity(queryVec, docVec) };
  });

  return scored
    .filter(r => r.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(r => ({
      source_id:    r.youtube_video_id,
      source_type:  'ingested_video',
      title:        r.title,
      niche:        r.niche,
      similarity:   parseFloat(r.similarity.toFixed(4)),
      provider:     'tfidf_fallback',
      confidence:   parseFloat((r.similarity * 0.65).toFixed(4)),
    }));
}

// ── Incremental update ────────────────────────────────────────────────────────

function updateCorpusIncrementally(db, newTitles) {
  // Invalidate: corpus will rebuild lazily on next call.
  // Full incremental IDF is complex; rebuild is fast enough at current scale (<1s for 10k docs).
  invalidateCorpus();
}

// ── Corpus stats ──────────────────────────────────────────────────────────────

function getCorpusStats() {
  if (!_corpus) return { built: false };
  return {
    built:      true,
    vocab_size: _corpus.vocab.length,
    corpus_size: _corpus.size,
    built_at:   _corpus.builtAt?.toISOString(),
  };
}

module.exports = {
  buildTfidfCorpus,
  getOrBuildCorpus,
  invalidateCorpus,
  computeTfidfVector,
  findNearestByTfidf,
  updateCorpusIncrementally,
  getCorpusStats,
  tokenize,
};
