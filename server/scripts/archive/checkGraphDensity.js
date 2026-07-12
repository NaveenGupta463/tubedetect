'use strict';

// Session 4A — Check graph density to determine if Louvain community detection is ready.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getDb } = require('../db/init');

const db = getDb();

const channels  = db.get('SELECT COUNT(*) AS n FROM corpus_channels').n;
const eligible  = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE training_eligible = 1').n;
const edges     = db.get('SELECT COUNT(*) AS n FROM creator_edges').n;
const connected = db.get('SELECT COUNT(DISTINCT source_channel) AS n FROM creator_edges').n;

const edgeTypes = db.all('SELECT edge_type, COUNT(*) AS n FROM creator_edges GROUP BY edge_type ORDER BY n DESC');

const seeds = db.all('SELECT language_code, COUNT(*) AS n FROM discovery_seeds GROUP BY language_code ORDER BY n DESC');

const corpusVideos = db.get('SELECT COUNT(*) AS n FROM corpus_videos').n;

const dnaComputed = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE dna_features IS NOT NULL').n;

const langDetected = db.get('SELECT COUNT(*) AS n FROM corpus_channels WHERE language_profile IS NOT NULL').n;

// Density = edges / (nodes * (nodes - 1)) — directed graph max edges
const maxEdges = channels * (channels - 1);
const density  = maxEdges > 0 ? (edges / maxEdges) : 0;

console.log('\n════════════════════════════════════════');
console.log('  SESSION 4A — Graph Density Report');
console.log('════════════════════════════════════════\n');

console.log('CORPUS SIZE');
console.log(`  Total channels:       ${channels.toLocaleString()}`);
console.log(`  Training eligible:    ${eligible.toLocaleString()}`);
console.log(`  Videos stored:        ${corpusVideos.toLocaleString()}`);
console.log(`  DNA computed:         ${dnaComputed.toLocaleString()}`);
console.log(`  Language detected:    ${langDetected.toLocaleString()}`);

console.log('\nGRAPH EDGES (creator_edges)');
console.log(`  Total edges:          ${edges.toLocaleString()}`);
console.log(`  Nodes with edges:     ${connected.toLocaleString()}`);
console.log(`  Graph density:        ${(density * 100).toFixed(4)}%`);
if (edgeTypes.length) {
  console.log('  By edge type:');
  for (const { edge_type, n } of edgeTypes) {
    console.log(`    ${(edge_type ?? 'unknown').padEnd(25)} ${n.toLocaleString()}`);
  }
} else {
  console.log('  (no edges yet)');
}

console.log('\nDISCOVERY SEEDS');
for (const { language_code, n } of seeds) {
  const label = { en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu' }[language_code] ?? language_code;
  console.log(`  ${label.padEnd(12)} ${n}`);
}

console.log('\nLOUVAIN READINESS CHECK');
const louvainThreshold = 5000;
const edgeThreshold    = 10000;
const ready = channels >= louvainThreshold && edges >= edgeThreshold;

console.log(`  Channels needed:      ${louvainThreshold.toLocaleString()}   current: ${channels.toLocaleString()}   ${channels >= louvainThreshold ? '✓' : `✗ need ${(louvainThreshold - channels).toLocaleString()} more`}`);
console.log(`  Edges needed:         ${edgeThreshold.toLocaleString()}   current: ${edges.toLocaleString()}   ${edges >= edgeThreshold ? '✓' : `✗ need ${(edgeThreshold - edges).toLocaleString()} more`}`);
console.log(`\n  VERDICT: Louvain is ${ready ? 'READY ✓' : 'NOT YET READY'}`);

if (!ready) {
  console.log('\n  WHAT TO DO INSTEAD:');
  if (channels < louvainThreshold) {
    console.log(`  → Grow corpus from ${channels.toLocaleString()} to ${louvainThreshold.toLocaleString()} channels (${(louvainThreshold - channels).toLocaleString()} to go)`);
    console.log('  → Run Hindi/Tamil/Telugu discovery cycles to ingest multilingual seeds');
  }
  if (edges < edgeThreshold) {
    console.log(`  → Build more graph edges — run featured-channel discovery to link channels`);
    console.log(`  → Each discovery cycle adds ~10-50 edges via featured channel relationships`);
  }
}
console.log('');
