const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));
const today = new Date().toISOString().slice(0, 10);
db.run(`DELETE FROM learning_health_snapshots WHERE snapshot_date = ?`, [today]);
console.log('Deleted snapshot for', today);
db.close();
