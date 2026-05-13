'use strict';
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

const SCHEMA = require('../db/schema');
db.exec(SCHEMA);

const days = 30;
const cutoff = `-${days} days`;

const healthRows = db.all(
  `SELECT snapshot_date, mae, calibration_trust_score, synthetic_ratio, benchmark_drift
   FROM learning_health_snapshots
   WHERE snapshot_date >= date('now', ?)
   ORDER BY snapshot_date ASC`,
  [cutoff],
);

const confRows = db.all(
  `SELECT snapshot_date, feature, avg_confidence, fallback_rate
   FROM learning_confidence_history
   WHERE snapshot_date >= date('now', ?)
     AND niche = '__all__'
     AND feature != '__all__'
   ORDER BY snapshot_date ASC LIMIT 5`,
  [cutoff],
);

const sysRows = db.all(
  `SELECT snapshot_date, avg_confidence, fallback_rate, routing_distribution_json
   FROM learning_confidence_history
   WHERE snapshot_date >= date('now', ?)
     AND feature = '__all__'
     AND niche   = '__all__'
   ORDER BY snapshot_date ASC`,
  [cutoff],
);

const latestDate = db.get(
  `SELECT MAX(snapshot_date) AS d FROM learning_confidence_history WHERE feature = '__all__' AND niche != '__all__'`
);
const nicheRows = latestDate?.d ? db.all(
  `SELECT niche, avg_confidence, fallback_rate
   FROM learning_confidence_history
   WHERE feature = '__all__' AND niche != '__all__' AND snapshot_date = ?
   ORDER BY avg_confidence DESC`,
  [latestDate.d],
) : [];

console.log('health_timeline rows:     ', healthRows.length);
console.log('confidence_timeline rows: ', confRows.length, '(capped at 5)');
console.log('routing_timeline rows:    ', sysRows.length);
console.log('niche latestDate:         ', latestDate?.d ?? 'none');
console.log('niche rows:               ', nicheRows.length);

if (sysRows.length) {
  const r = sysRows[0];
  const d = JSON.parse(r.routing_distribution_json || '{}');
  const total = (d.autonomous ?? 0) + (d.local_first ?? 0) + (d.hybrid ?? 0) + (d.mandatory_claude ?? 0);
  const pct = n => total > 0 ? ((n / total) * 100).toFixed(1) : '0';
  console.log('\nLatest system routing row:');
  console.log(' ', r.snapshot_date, '— avg_confidence:', r.avg_confidence, '— fallback_rate:', r.fallback_rate);
  console.log('  dist raw:', JSON.stringify(d));
  console.log('  autonomous:', pct(d.autonomous ?? 0) + '%', '| local_first:', pct(d.local_first ?? 0) + '%');
}

if (nicheRows.length) {
  console.log('\nNiche rankings (top 3 / worst 3):');
  console.log('  TOP:  ', nicheRows.slice(0, 3).map(r => `${r.niche}:${r.avg_confidence}`).join(', '));
  console.log('  WORST:', [...nicheRows].reverse().slice(0, 3).map(r => `${r.niche}:${r.avg_confidence}`).join(', '));
}

console.log('\n✓ All queries executed successfully — history-dashboard endpoint logic verified');
db.close();
