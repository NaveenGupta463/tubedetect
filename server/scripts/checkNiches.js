const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

const niches = db.all(`SELECT niche, COUNT(*) n FROM video_outcomes WHERE pipeline_version='synthetic_b' GROUP BY niche ORDER BY n DESC`);
console.log('Niches in video_outcomes (synthetic_b):', JSON.stringify(niches, null, 2));

const srcNiches = db.all(`SELECT niche, COUNT(*) n FROM ingested_videos GROUP BY niche ORDER BY n DESC LIMIT 20`);
console.log('Niches in ingested_videos:', JSON.stringify(srcNiches, null, 2));

const sample = db.all(`SELECT youtube_video_id, niche, actual_performance_score, predicted_score FROM video_outcomes WHERE pipeline_version='synthetic_b' LIMIT 10`);
console.log('Sample rows:', JSON.stringify(sample, null, 2));

db.close();
