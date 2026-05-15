'use strict';

/**
 * Zero-quota script: build real channel-to-channel edges from existing corpus data.
 *
 * Strategy: within each niche, connect each channel to its N closest neighbours
 * by subscriber count. Channels competing for the same audience at similar size
 * are adjacent. Confidence scales with size-tier similarity.
 *
 * Run: node server/scripts/buildNicheEdges.js
 */

const path   = require('path');
const crypto = require('crypto');

const Database = require(path.join(__dirname, '../node_modules/node-sqlite3-wasm')).Database;
const DB_PATH  = path.join(__dirname, '../data/scoring.db');
const db       = new Database(DB_PATH);

const NEIGHBOURS_PER_CHANNEL = 8;  // each channel gets at most 8 niche-proximity edges

function upsertEdge(source, target, type, confidence, via) {
  db.run(
    `INSERT INTO corpus_discovery_graph
       (id, source_channel_id, target_channel_id, relationship_type, confidence, discovered_via)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(source_channel_id, target_channel_id, relationship_type) DO UPDATE SET
       confidence    = MAX(excluded.confidence, confidence),
       discovered_at = datetime('now')`,
    [crypto.randomUUID(), source, target, type, confidence, via],
  );
}

const before = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;

// Pull all channels that have a niche assigned
const channels = db.all(`
  SELECT channel_id, niche, subscriber_count
  FROM corpus_channels
  WHERE niche IS NOT NULL AND niche != 'other' AND subscriber_count IS NOT NULL AND subscriber_count > 0
  ORDER BY niche, subscriber_count
`);

// Group by niche
const byNiche = {};
for (const ch of channels) {
  (byNiche[ch.niche] = byNiche[ch.niche] || []).push(ch);
}

let totalEdges = 0;

for (const [niche, members] of Object.entries(byNiche)) {
  // Already sorted by subscriber_count
  for (let i = 0; i < members.length; i++) {
    const ch   = members[i];
    const subs = ch.subscriber_count;

    // Gather nearest neighbours: look N before and N after in sorted order
    const candidates = [];
    const half = Math.ceil(NEIGHBOURS_PER_CHANNEL / 2);
    for (let j = Math.max(0, i - half); j <= Math.min(members.length - 1, i + half); j++) {
      if (j === i) continue;
      candidates.push(members[j]);
    }

    for (const nb of candidates.slice(0, NEIGHBOURS_PER_CHANNEL)) {
      // Confidence based on subscriber count proximity (log scale)
      const logRatio = Math.abs(Math.log10((subs + 1) / (nb.subscriber_count + 1)));
      const confidence = Math.max(0.2, 0.65 - logRatio * 0.1);

      upsertEdge(ch.channel_id, nb.channel_id, 'niche_size_peer', parseFloat(confidence.toFixed(2)), 'niche_proximity_miner');
      totalEdges++;
    }
  }
  console.log(`  ${niche}: ${members.length} channels → ~${members.length * NEIGHBOURS_PER_CHANNEL} edges`);
}

const after = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;

console.log(`\nDone.`);
console.log(`  Niches processed : ${Object.keys(byNiche).length}`);
console.log(`  Edges written    : ${totalEdges}`);
console.log(`  Graph before     : ${before}`);
console.log(`  Graph after      : ${after}`);
console.log(`  Net new edges    : ${after - before}`);

db.close();
