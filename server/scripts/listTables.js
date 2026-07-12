'use strict';
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.resolve(__dirname, '../data/scoring.db');
const db = new Database(dbPath);
const tbls = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
process.stdout.write(tbls.map(r => r.name).join('\n') + '\n');
db.close();
