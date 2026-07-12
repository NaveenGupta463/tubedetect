'use strict';
const path = require('path');
const DB = require('../node_modules/better-sqlite3');
const db = new DB(path.resolve(__dirname, '../data/scoring.db'), { readonly: true });

const q = (sql, ...args) => db.prepare(sql).all(...args);
const q1 = (sql, ...args) => db.prepare(sql).get(...args);

// 1. Repair status values
console.log('=== REPAIR STATUS VALUES ===');
const statuses = q('SELECT status, COUNT(*) as n FROM classification_repair_candidates GROUP BY status ORDER BY n DESC');
for (const s of statuses) console.log(' ', s.status, ':', s.n);

// 2. WTP cache schema
console.log('\n=== channel_wtp_cache SCHEMA ===');
try {
  const wtp = q('PRAGMA table_info(channel_wtp_cache)');
  for (const c of wtp) console.log(' ', c.cid, c.name, c.type);
  const sample = q('SELECT * FROM channel_wtp_cache LIMIT 2');
  if (sample.length) console.log('Sample keys:', Object.keys(sample[0]).join(', '));
} catch(e) { console.log('ERROR:', e.message); }

// 3. Repair candidates schema
console.log('\n=== REPAIR CANDIDATES SCHEMA ===');
const rc = q('PRAGMA table_info(classification_repair_candidates)');
for (const c of rc) console.log(' ', c.cid, c.name, c.type);

// 4. List all tables
console.log('\n=== ALL TABLES ===');
const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
for (const t of tables) console.log(' ', t.name);

db.close();
