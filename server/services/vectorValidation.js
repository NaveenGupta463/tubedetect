'use strict';

// Phase 3 — Vector DB Stability Validation
//
// Checks:
//   1. Total vector count
//   2. Duplicate rows (same source_id + model, multiple rows)
//   3. Orphaned embeddings (source_id not in ingested_videos)
//   4. Dimensional consistency (all vectors same dim per model)
//   5. Null / zero vector_norm
//   6. Corrupted vector_json (random sample)
//   7. Unassigned clusters
//   8. k-NN retrieval latency
//   9. Embedding coverage % vs ingested_videos
//
// Stress test: repeated k-NN queries to measure latency consistency.

const { findNearest } = require('./vectorStore');

function tryParseVec(json) {
  try {
    const v = typeof json === 'string' ? JSON.parse(json) : json;
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch { return null; }
}

// ── Main validation ───────────────────────────────────────────────────────────

async function runValidation(db) {
  const t0     = Date.now();
  const checks = {};
  const warnings = [];
  const errors   = [];

  // 1. Total vectors
  checks.total_vectors = db.get(`SELECT COUNT(*) AS n FROM semantic_embeddings`)?.n ?? 0;

  // 2. Duplicate detection — same (source_type, source_id, embedding_model) more than once
  const dupes = db.all(`
    SELECT source_type, source_id, embedding_model, COUNT(*) AS cnt
    FROM semantic_embeddings
    GROUP BY source_type, source_id, embedding_model
    HAVING cnt > 1
    LIMIT 50
  `);
  checks.duplicate_vectors = dupes.length;
  if (dupes.length > 0)
    warnings.push(`${dupes.length} (source_id, model) pairs have duplicate rows`);

  // 3. Orphaned embeddings
  checks.orphaned_embeddings = db.get(`
    SELECT COUNT(*) AS n FROM semantic_embeddings se
    WHERE se.source_type = 'title_dna'
      AND NOT EXISTS (
        SELECT 1 FROM ingested_videos iv WHERE iv.youtube_video_id = se.source_id
      )
  `)?.n ?? 0;
  if (checks.orphaned_embeddings > 0)
    warnings.push(`${checks.orphaned_embeddings} orphaned embeddings (source missing from ingested_videos)`);

  // 4. Dimensional consistency
  const dimRows = db.all(`
    SELECT embedding_model, embedding_version,
           json_array_length(vector_json) AS dim,
           COUNT(*) AS cnt
    FROM semantic_embeddings
    GROUP BY embedding_model, embedding_version, dim
    ORDER BY embedding_model, cnt DESC
    LIMIT 30
  `);
  const dimGroups = {};
  for (const r of dimRows) {
    const key = `${r.embedding_model}@${r.embedding_version}`;
    if (!dimGroups[key]) dimGroups[key] = [];
    dimGroups[key].push({ dim: r.dim, count: r.cnt });
  }
  checks.dimension_groups = dimGroups;
  const inconsistent = Object.entries(dimGroups)
    .filter(([, dims]) => dims.length > 1)
    .map(([k]) => k);
  if (inconsistent.length > 0)
    errors.push(`Dimensional inconsistency for model(s): ${inconsistent.join(', ')}`);

  // 5. Bad norms
  checks.bad_vector_norm = db.get(`
    SELECT COUNT(*) AS n FROM semantic_embeddings
    WHERE vector_norm IS NULL OR vector_norm <= 0
  `)?.n ?? 0;
  if (checks.bad_vector_norm > 0)
    errors.push(`${checks.bad_vector_norm} vectors with null or non-positive norm`);

  // 6. Corrupted vector_json (sample 100 random rows)
  const sample     = db.all(`SELECT id, vector_json FROM semantic_embeddings ORDER BY RANDOM() LIMIT 100`);
  let corrupted    = 0;
  for (const row of sample) if (!tryParseVec(row.vector_json)) corrupted++;
  checks.corrupted_sample = { checked: sample.length, corrupted };
  checks.corrupted_sample_rate = sample.length ? parseFloat((corrupted / sample.length).toFixed(4)) : 0;
  if (corrupted > 0)
    errors.push(`${corrupted}/${sample.length} sampled vectors failed JSON parse`);

  // 7. Unassigned clusters
  checks.unassigned_clusters = db.get(`
    SELECT COUNT(*) AS n FROM semantic_embeddings
    WHERE source_type = 'title_dna' AND semantic_cluster IS NULL
  `)?.n ?? 0;
  if (checks.unassigned_clusters > checks.total_vectors * 0.5)
    warnings.push(`>50% of title_dna embeddings have no cluster assignment`);

  // 8. k-NN latency probe
  const probeRow = db.get(`
    SELECT vector_json FROM semantic_embeddings WHERE source_type = 'title_dna' ORDER BY RANDOM() LIMIT 1
  `);
  if (probeRow) {
    const qv = tryParseVec(probeRow.vector_json);
    if (qv) {
      const lt0 = Date.now();
      findNearest(db, { queryVector: qv, sourceType: 'title_dna', limit: 10 });
      checks.knn_latency_ms = Date.now() - lt0;
      if (checks.knn_latency_ms > 3000)
        warnings.push(`k-NN probe latency ${checks.knn_latency_ms}ms exceeds 3s`);
    }
  }

  // 9. Coverage
  const videoTotal = db.get(`SELECT COUNT(*) AS n FROM ingested_videos`)?.n ?? 0;
  const embCount   = db.get(`
    SELECT COUNT(*) AS n FROM semantic_embeddings WHERE source_type = 'title_dna'
  `)?.n ?? 0;
  checks.ingested_videos_total = videoTotal;
  checks.embedded_title_dna    = embCount;
  checks.pending_embeddings    = Math.max(0, videoTotal - embCount);
  checks.coverage_pct          = videoTotal
    ? parseFloat((embCount / videoTotal * 100).toFixed(2)) : 0;

  // 10. Coverage by model
  checks.coverage_by_model = db.all(`
    SELECT source_type, embedding_model, COUNT(*) AS count
    FROM semantic_embeddings
    GROUP BY source_type, embedding_model
    ORDER BY count DESC
  `);

  checks.validation_latency_ms = Date.now() - t0;

  const report = {
    ok:       errors.length === 0,
    ran_at:   new Date().toISOString(),
    checks,
    warnings,
    errors,
  };

  persistReport(db, report);
  return report;
}

// ── Stress test ───────────────────────────────────────────────────────────────

async function runStressTest(db, { count = 1000 } = {}) {
  const rows = db.all(`
    SELECT vector_json FROM semantic_embeddings WHERE source_type = 'title_dna'
    ORDER BY RANDOM() LIMIT ?
  `, [Math.min(count, 5000)]);

  if (!rows.length) return { ok: false, error: 'no_vectors_available' };

  const qv = tryParseVec(rows[0].vector_json);
  if (!qv) return { ok: false, error: 'invalid_probe_vector' };

  const REPS      = Math.min(20, Math.ceil(rows.length / 50));
  const latencies = [];

  for (let i = 0; i < REPS; i++) {
    const lt0 = Date.now();
    findNearest(db, { queryVector: qv, sourceType: 'title_dna', limit: 10 });
    latencies.push(Date.now() - lt0);
  }

  const avg = latencies.reduce((s, l) => s + l, 0) / latencies.length;
  const max = Math.max(...latencies);
  const min = Math.min(...latencies);
  const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? max;

  return {
    ok:              true,
    vectors_in_db:   rows.length,
    retrieval_reps:  REPS,
    avg_latency_ms:  Math.round(avg),
    min_latency_ms:  min,
    max_latency_ms:  max,
    p95_latency_ms:  p95,
    consistency:     (max - min) < 500 ? 'stable' : 'variable',
    ready_for_scale: avg < 1000 && (max - min) < 1000,
  };
}

// ── Get last report ───────────────────────────────────────────────────────────

function getLastReport(db) {
  const row = db.get(`
    SELECT * FROM vector_validation_log ORDER BY ran_at DESC LIMIT 1
  `);
  if (!row) return null;
  try { return { ...row, report: JSON.parse(row.report_json) }; }
  catch { return row; }
}

// ── Persist ───────────────────────────────────────────────────────────────────

function persistReport(db, report) {
  const c = report.checks;
  try {
    db.run(`
      INSERT INTO vector_validation_log
        (ran_at, total_vectors, duplicate_count, orphan_count, bad_norm_count,
         corrupted_sample_rate, unassigned_count, knn_latency_ms, coverage_pct,
         pending_count, error_count, warning_count, ok, report_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      report.ran_at,
      c.total_vectors            ?? 0,
      c.duplicate_vectors        ?? 0,
      c.orphaned_embeddings      ?? 0,
      c.bad_vector_norm          ?? 0,
      c.corrupted_sample_rate    ?? 0,
      c.unassigned_clusters      ?? 0,
      c.knn_latency_ms           ?? 0,
      c.coverage_pct             ?? 0,
      c.pending_embeddings       ?? 0,
      report.errors.length,
      report.warnings.length,
      report.ok ? 1 : 0,
      JSON.stringify(report),
    ]);
  } catch { /* non-fatal */ }
}

module.exports = { runValidation, runStressTest, getLastReport };
