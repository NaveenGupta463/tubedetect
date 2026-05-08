// Pure confidence reliability aggregation — no DB access, no side effects.

const BUCKETS = ['high', 'medium', 'low', 'degraded', 'unknown'];

function emptyBucket() {
  return { total: 0, accurate_pct: null, mae: null, avg_actual: null, drift_rate: null };
}

function computeConfidenceMatrix(reliabilityRows) {
  const matrix = {};
  for (const b of BUCKETS) matrix[b] = emptyBucket();

  if (!reliabilityRows || reliabilityRows.length === 0) return matrix;

  for (const r of reliabilityRows) {
    const key   = r.confidence_bucket;
    const total = r.total ?? 0;
    if (!BUCKETS.includes(key) || total === 0) continue;
    matrix[key] = {
      total,
      accurate_pct: parseFloat(((r.accurate_count   ?? 0) / total * 100).toFixed(1)),
      mae:          r.mae       != null ? parseFloat(r.mae.toFixed(2))       : null,
      avg_actual:   r.avg_actual != null ? parseFloat(r.avg_actual.toFixed(2)) : null,
      drift_rate:   parseFloat(((r.inaccurate_count ?? 0) / total * 100).toFixed(1)),
    };
  }
  return matrix;
}

module.exports = { computeConfidenceMatrix };
