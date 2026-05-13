const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

const snaps = db.all(`SELECT * FROM learning_health_snapshots ORDER BY snapshot_date DESC LIMIT 5`);
console.log('Snapshots:', JSON.stringify(snaps, null, 2));

// Also verify the table columns
const cols = db.all(`PRAGMA table_info(learning_health_snapshots)`).map(r => r.name);
console.log('Columns:', cols.join(', '));

db.close();
