'use strict';

/**
 * Country-gate existing edges in corpus_discovery_graph.
 *
 * Problem: search_co_occurrence edges are built between any two channels that
 * appear in the same search results. A US tech channel and an Indian tech channel
 * both appear in "tech tutorial" searches, so they get connected. When Louvain
 * runs, this cross-country edge would pull them into the same cluster.
 *
 * Fix (retroactive): mark cross-country edges as low-confidence so Louvain
 * naturally separates them. We set confidence = 0.05 (near-zero) on edges
 * where source and target have different, known, non-null countries.
 * We do NOT delete them — they carry provenance information.
 *
 * We also add a `cross_country` flag column (INTEGER 0/1) for easier filtering
 * in future Louvain runs.
 *
 * Run: node server/scripts/countryGateEdges.js [--dry-run]
 */

const path     = require('path');
const Database = require(path.join(__dirname, '../node_modules/better-sqlite3'));

const DB_PATH = path.join(__dirname, '../data/scoring.db');
const db      = new Database(DB_PATH);

const DRY_RUN = process.argv.includes('--dry-run');

// Check if cross_country column already exists (read-only check)
const cols = db.prepare("PRAGMA table_info(corpus_discovery_graph)").all().map(c => c.name);
const needsColumn = !cols.includes('cross_country');

// Find edges where both endpoints have a known country and those countries differ.
// featured_by and semantic_neighbor edges are kept as-is (more intentional signals).
const crossCountryEdges = db.prepare(`
  SELECT
    g.id,
    g.source_channel_id,
    g.target_channel_id,
    g.relationship_type,
    g.confidence,
    COALESCE(s.yt_country, s.country) AS src_country,
    COALESCE(t.yt_country, t.country) AS tgt_country
  FROM corpus_discovery_graph g
  JOIN corpus_channels s ON s.channel_id = g.source_channel_id
  JOIN corpus_channels t ON t.channel_id = g.target_channel_id
  WHERE g.relationship_type IN ('search_co_occurrence', 'niche_adjacent', 'niche_size_peer', 'video_search_adjacent')
    AND COALESCE(s.yt_country, s.country) IS NOT NULL
    AND COALESCE(t.yt_country, t.country) IS NOT NULL
    AND COALESCE(s.yt_country, s.country) != COALESCE(t.yt_country, t.country)
    ${needsColumn ? '' : 'AND (g.cross_country IS NULL OR g.cross_country = 0)'}
`).all();

// Country breakdown for reporting
const countryPairs = {};
for (const e of crossCountryEdges) {
  const key = `${e.src_country}↔${e.tgt_country}`;
  countryPairs[key] = (countryPairs[key] || 0) + 1;
}

console.log(`\nCross-country edges found: ${crossCountryEdges.length}`);
console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no changes written)' : 'LIVE'}`);
console.log('\nTop country pairs:');
const sorted = Object.entries(countryPairs).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [pair, count] of sorted) {
  console.log(`  ${pair.padEnd(20)} ${count}`);
}

if (DRY_RUN) {
  console.log('\nRe-run without --dry-run to apply changes.');
  db.close();
  process.exit(0);
}

// Add column now that we're in live mode
if (needsColumn) {
  db.prepare("ALTER TABLE corpus_discovery_graph ADD COLUMN cross_country INTEGER DEFAULT 0").run();
  console.log('Added cross_country column to corpus_discovery_graph.');
}

const flagEdge = db.prepare(
  'UPDATE corpus_discovery_graph SET confidence = 0.05, cross_country = 1 WHERE id = ?'
);

const applyGate = db.transaction(() => {
  for (const e of crossCountryEdges) {
    flagEdge.run(e.id);
  }
});

applyGate();

const after = db.prepare(
  'SELECT COUNT(*) AS n FROM corpus_discovery_graph WHERE cross_country = 1'
).get();

console.log(`\nDone.`);
console.log(`  Edges downweighted : ${crossCountryEdges.length}`);
console.log(`  Total cross-country: ${after.n}`);
console.log(`\nLouvain runs should filter WHERE cross_country = 0 OR cross_country IS NULL,`);
console.log(`or pass edge weights directly — cross-country edges have confidence = 0.05.`);

db.close();
