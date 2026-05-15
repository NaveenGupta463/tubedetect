'use strict';

/**
 * One-shot script: mine featured channel edges from all stored raw_json.
 * Zero API quota — reads from corpus_channels.raw_json only.
 * Run after server restart: node server/scripts/mineFeatureEdges.js
 */

const path   = require('path');
const crypto = require('crypto');

const Database = require(path.join(__dirname, '../node_modules/node-sqlite3-wasm')).Database;
const DB_PATH  = path.join(__dirname, '../data/scoring.db');

const db = new Database(DB_PATH);

function upsertDiscoveryEdge(source, target, type, confidence, via) {
  db.run(
    `INSERT INTO corpus_discovery_graph
       (id, source_channel_id, target_channel_id, relationship_type, confidence, discovered_via)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(source_channel_id, target_channel_id, relationship_type) DO UPDATE SET
       confidence   = MAX(excluded.confidence, confidence),
       discovered_at = datetime('now')`,
    [crypto.randomUUID(), source, target, type, confidence, via],
  );
}

const before = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;

const channels = db.all(
  `SELECT channel_id, niche, raw_json FROM corpus_channels
   WHERE raw_json IS NOT NULL
   ORDER BY quality_score DESC`,
);

console.log(`Processing ${channels.length} channels with raw_json...`);

let newChannels = 0;
let edges       = 0;

for (const ch of channels) {
  try {
    const json     = typeof ch.raw_json === 'string' ? JSON.parse(ch.raw_json) : ch.raw_json;
    const featured = json?.brandingSettings?.channel?.featuredChannelsUrls ?? [];
    for (const featuredId of featured) {
      if (!featuredId) continue;
      const exists = db.get('SELECT 1 FROM corpus_channels WHERE channel_id = ?', [featuredId]);
      if (!exists) {
        db.run(
          `INSERT OR IGNORE INTO corpus_channels (channel_id, title, niche, discovery_source, created_at)
           VALUES (?, ?, ?, 'featured_channels', datetime('now'))`,
          [featuredId, featuredId, ch.niche ?? null],
        );
        newChannels++;
      }
      upsertDiscoveryEdge(ch.channel_id, featuredId, 'featured_by', 0.75, 'featured_channels');
      edges++;
    }
  } catch (_) {}
}

const after = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;

console.log(`\nDone.`);
console.log(`  Channels processed : ${channels.length}`);
console.log(`  New channels added : ${newChannels}`);
console.log(`  Edges written      : ${edges}`);
console.log(`  Graph edges before : ${before}`);
console.log(`  Graph edges after  : ${after}`);
console.log(`  Net new edges      : ${after - before}`);

db.close();
