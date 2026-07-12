'use strict';
const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'), { readonly: true, timeout: 60000 });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
process.stdout.write('Tables: ' + tables.map(t => t.name).join(', ') + '\n');

const dnaInfo = db.prepare('PRAGMA table_info(creator_idea_dna)').all();
process.stdout.write('creator_idea_dna cols: ' + dnaInfo.map(c => c.name).join(', ') + '\n');

const peerSample = db.prepare("SELECT channel_id, generated_title, wtp_score FROM wtp_generation_traces WHERE rec_source='peer_video_signal' AND generated_title IS NOT NULL ORDER BY wtp_score DESC LIMIT 20").all();
process.stdout.write('Top peer titles:\n');
peerSample.forEach(r => process.stdout.write('  [' + r.wtp_score + '] ' + r.generated_title + '\n'));

const dnaChannels = db.prepare("SELECT channel_id, COUNT(*) as n FROM wtp_generation_traces WHERE rec_source='dna_original_bets' GROUP BY channel_id LIMIT 5").all();
process.stdout.write('Sample DNA channels: ' + dnaChannels.map(r => r.channel_id + '(' + r.n + ')').join(', ') + '\n');

const dnaRow = db.prepare('SELECT channel_id, confidence_score, confidence, family, csp FROM creator_idea_dna WHERE channel_id IS NOT NULL LIMIT 1').get();
if (dnaRow) {
  process.stdout.write('Sample DNA row: ' + JSON.stringify(dnaRow) + '\n');
  const fullDna = db.prepare('SELECT * FROM creator_idea_dna WHERE channel_id = ?').get(dnaRow.channel_id);
  const keys = Object.keys(fullDna || {});
  process.stdout.write('DNA keys (' + keys.length + '): ' + keys.join(', ') + '\n');
}

db.close();
