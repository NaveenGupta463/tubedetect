'use strict';
const path = require('path');
const Database = require(path.join(__dirname, '../node_modules/node-sqlite3-wasm')).Database;
const db = new Database(path.join(__dirname, '../data/scoring.db'));
const { runPatternMining } = require('../services/patternMiner');

db.exec('BEGIN');
try {
  const result = runPatternMining(db);
  db.exec('COMMIT');
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Error:', e.message);
  process.exit(1);
}
db.close();
