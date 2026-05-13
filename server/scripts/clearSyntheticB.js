const { Database } = require('node-sqlite3-wasm');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const db = new Database(DB_PATH);

const before = db.get(`SELECT COUNT(*) n FROM video_outcomes WHERE pipeline_version = 'synthetic_b'`);
console.log(`[clear] synthetic_b rows before delete: ${before?.n ?? 0}`);

db.run(`DELETE FROM video_outcomes WHERE pipeline_version = 'synthetic_b'`);

const after = db.get(`SELECT COUNT(*) n FROM video_outcomes WHERE pipeline_version = 'synthetic_b'`);
console.log(`[clear] synthetic_b rows after delete: ${after?.n ?? 0}`);

const total = db.get(`SELECT COUNT(*) n FROM video_outcomes`);
console.log(`[clear] total video_outcomes remaining: ${total?.n ?? 0}`);

db.close();
console.log('[clear] Done');
