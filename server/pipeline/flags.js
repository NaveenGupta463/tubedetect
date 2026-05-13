'use strict';

// ── Pipeline feature flags ─────────────────────────────────────────────────────
//
// New orchestrator pipeline is the default.
// Set USE_LEGACY_PIPELINE=1 to revert to the inline legacy path in analyze.js.
function isNewPipelineEnabled() {
  return process.env.USE_LEGACY_PIPELINE !== '1';
}

// Semantic corpus used for peer-score comparison alongside the user-submit pool.
// During the parallel-run validation period this is auto-enabled when corpus
// coverage reaches SEMANTIC_COVERAGE_THRESHOLD (100 embeddings).
// Hard-force below threshold: UNIFIED_EMBEDDING_POOL_ENABLED=1.
function isUnifiedEmbeddingEnabled() {
  return process.env.UNIFIED_EMBEDDING_POOL_ENABLED === '1';
}

// Semantic cluster prior applied as weak dampened signal in ensemble scoring.
// Max ±5 pts, scaled by cluster confidence and sample size.
// Off by default — enable with SEMANTIC_SCORING_ENABLED=1 after parallel-run
// validation confirms peer_context_score distributions are stable.
function isSemanticScoringEnabled() {
  return process.env.SEMANTIC_SCORING_ENABLED === '1';
}

module.exports = { isNewPipelineEnabled, isUnifiedEmbeddingEnabled, isSemanticScoringEnabled };
