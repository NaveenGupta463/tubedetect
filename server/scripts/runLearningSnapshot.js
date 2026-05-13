const { Database }            = require('node-sqlite3-wasm');
const path                    = require('path');
const { computeLearningSnapshot } = require('../services/intelligenceHealth');
const { insertLearningSnapshot, getLatestLearningSnapshot } = require('../db/queries');

const DB_PATH = path.resolve(__dirname, '../data/scoring.db');

// Standalone version that doesn't go through getDb() to avoid server lock conflict
const origGetDb = require('../db/init').getDb;
// Monkey-patch getDb for this standalone run
const db = new Database(DB_PATH);
require('../db/init').getDb = () => db;

const today = new Date().toISOString().slice(0, 10);
const existing = getLatestLearningSnapshot(db);

if (existing?.snapshot_date === today) {
  console.log('[snapshot] Already exists for today:', today, JSON.stringify(existing));
} else {
  const snap = computeLearningSnapshot(db);
  insertLearningSnapshot(db, snap);
  console.log('[snapshot] Saved:', JSON.stringify(snap, null, 2));
}

db.close();
