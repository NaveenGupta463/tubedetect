'use strict';
const { getDb } = require('../db/init');
const db = getDb();
const rows = db.all("SELECT channel_id, channel_name, creator_mode, primary_niche, format_type FROM ingested_channels WHERE channel_name LIKE '%Raj Shamani%' OR channel_name LIKE '%raj shamani%' LIMIT 5");
console.log(JSON.stringify(rows, null, 2));
