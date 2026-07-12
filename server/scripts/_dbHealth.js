'use strict';
const path = require('path');
const BetterSqlite = require('../node_modules/better-sqlite3');
try {
  const db = new BetterSqlite(path.resolve(__dirname, '../data/scoring.db'), { timeout: 5000 });
  db.pragma('journal_mode=WAL');
  const integrity = db.pragma('integrity_check(5)');
  console.log('integrity_check:', JSON.stringify(integrity));
  const wal = db.pragma('wal_checkpoint(PASSIVE)');
  console.log('wal_checkpoint:', JSON.stringify(wal));
  const locks = db.pragma('lock_status');
  console.log('lock_status:', JSON.stringify(locks));
  db.close();
  console.log('DB healthy — opened and closed cleanly.');
} catch (e) {
  console.error('DB ERROR:', e.message);
}
