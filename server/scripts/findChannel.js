'use strict';
require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');
const db = getDb();
const rows = db.all(
  "SELECT channel_id, channel_name, niche FROM ingested_channels WHERE channel_name LIKE '%Republic%' OR channel_name LIKE '%republic%' LIMIT 15"
);
rows.forEach(r => console.log(r.channel_id, '|', r.channel_name, '|', r.niche));
