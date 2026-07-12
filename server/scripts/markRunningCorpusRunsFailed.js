'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { getDb, closeDb } = require('../db/init');

const reason = process.argv.slice(2).join(' ') || 'manual interrupted run marked failed';

const db = getDb();
const info = db.run(`
  UPDATE corpus_run_log
  SET status = 'failed',
      completed_at = COALESCE(completed_at, datetime('now')),
      error = ?
  WHERE status = 'running'
`, [reason]);

console.log(JSON.stringify({ marked_failed: info.changes ?? 0, reason }, null, 2));
closeDb();
