'use strict';

const DECAY_RATE_DEFAULT = parseFloat(process.env.GRAPH_DECAY_RATE ?? '0.85');
const MIN_EDGE_STRENGTH = 0.10;

const META_KEY_LAST_DECAY = 'graph_last_decay_at';

function reinforceRelationship(db, sourceId, targetId, relType, { strengthDelta = 0.15 } = {}) {
  db.run(
    `UPDATE corpus_discovery_graph
     SET edge_strength = MIN(1.0, COALESCE(edge_strength, 1.0) + ?),
         last_reinforced_at = datetime('now')
     WHERE source_channel_id = ? AND target_channel_id = ? AND relationship_type = ?`,
    [strengthDelta, sourceId, targetId, relType]
  );
}

function shouldDecay(db) {
  const row = db.get(
    'SELECT metadata_value FROM app_metadata WHERE metadata_key = ?',
    [META_KEY_LAST_DECAY]
  );
  if (!row || !row.metadata_value) return true;

  const lastDecay = new Date(row.metadata_value);
  const daysSince = (Date.now() - lastDecay.getTime()) / 86400000;
  return daysSince >= 7;
}

function decayRelationships(db) {
  const row = db.get(
    'SELECT metadata_value FROM app_metadata WHERE metadata_key = ?',
    [META_KEY_LAST_DECAY]
  );

  let elapsedDays = 30;
  if (row && row.metadata_value) {
    const lastDecay = new Date(row.metadata_value);
    elapsedDays = Math.max(1, Math.floor((Date.now() - lastDecay.getTime()) / 86400000));
  }

  // Pro-rate: DECAY_RATE_DEFAULT is monthly (30 days), scale to actual elapsed days
  const decayFactor = Math.pow(DECAY_RATE_DEFAULT, elapsedDays / 30);

  db.run(
    `UPDATE corpus_discovery_graph
     SET edge_strength = COALESCE(edge_strength, 1.0) * ?
     WHERE edge_strength IS NOT NULL`,
    [decayFactor]
  );

  const countRow = db.get('SELECT COUNT(*) as cnt FROM corpus_discovery_graph');
  const edgesDecayed = countRow ? countRow.cnt : 0;

  db.run(
    `INSERT INTO app_metadata (metadata_key, metadata_value) VALUES (?, datetime('now'))
     ON CONFLICT(metadata_key) DO UPDATE SET metadata_value = datetime('now')`,
    [META_KEY_LAST_DECAY]
  );

  return { edges_decayed: edgesDecayed, decay_factor: decayFactor };
}

function pruneWeakRelationships(db) {
  db.run(
    'DELETE FROM corpus_discovery_graph WHERE edge_strength < ?',
    [MIN_EDGE_STRENGTH]
  );

  // SQLite changes() not directly exposed; use a count before/after approach via run result
  const remaining = db.get('SELECT COUNT(*) as cnt FROM corpus_discovery_graph');
  return { pruned: true, remaining: remaining ? remaining.cnt : 0 };
}

function initializeEdgeStrengths(db) {
  db.run(
    `UPDATE corpus_discovery_graph
     SET edge_strength = 1.0,
         last_reinforced_at = datetime('now')
     WHERE edge_strength IS NULL OR last_reinforced_at IS NULL`
  );

  const row = db.get(
    'SELECT COUNT(*) as cnt FROM corpus_discovery_graph WHERE edge_strength = 1.0 AND last_reinforced_at IS NOT NULL'
  );
  return row ? row.cnt : 0;
}

function runDecayCycle(db) {
  if (!shouldDecay(db)) {
    return { skipped: true };
  }

  const { edges_decayed, decay_factor } = decayRelationships(db);
  const { pruned, remaining } = pruneWeakRelationships(db);

  const total = db.get('SELECT COUNT(*) as cnt FROM corpus_discovery_graph');
  const avgRow = db.get('SELECT AVG(edge_strength) as avg_strength FROM corpus_discovery_graph');

  return {
    skipped: false,
    decayed: edges_decayed,
    pruned,
    decay_factor,
    graph_stats: {
      total_edges: total ? total.cnt : 0,
      remaining_after_prune: remaining,
      avg_edge_strength: avgRow ? (avgRow.avg_strength || 0) : 0
    }
  };
}

module.exports = {
  DECAY_RATE_DEFAULT,
  MIN_EDGE_STRENGTH,
  reinforceRelationship,
  decayRelationships,
  pruneWeakRelationships,
  runDecayCycle,
  shouldDecay,
  initializeEdgeStrengths
};
