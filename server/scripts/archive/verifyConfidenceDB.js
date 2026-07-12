'use strict';
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

const cm = db.get('SELECT COUNT(*) n FROM confidence_metrics');
const lch = db.get('SELECT COUNT(*) n FROM learning_confidence_history');
console.log('confidence_metrics rows:', cm.n);
console.log('learning_confidence_history rows:', lch.n);

const lchSample = db.all(
  `SELECT snapshot_date, feature, niche, avg_confidence, fallback_rate
   FROM learning_confidence_history ORDER BY snapshot_date DESC LIMIT 10`
);
console.log('\nSample learning_confidence_history:');
for (const r of lchSample) console.log(' ', JSON.stringify(r));

const dist = db.all(
  `SELECT routing_decision, COUNT(*) n
   FROM confidence_metrics GROUP BY routing_decision`
);
console.log('\nRouting distribution in confidence_metrics:');
for (const r of dist) console.log(' ', JSON.stringify(r));

// Verify no mandatory_claude rows for well-populated niches
const mandClaude = db.all(
  `SELECT feature, niche, confidence_score FROM confidence_metrics
   WHERE routing_decision = 'mandatory_claude' ORDER BY confidence_score ASC LIMIT 10`
);
console.log('\nmandatory_claude rows:', mandClaude.length);

db.close();
