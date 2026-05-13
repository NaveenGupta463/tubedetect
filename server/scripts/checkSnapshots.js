const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

// Check what niches have 7d snapshots
const snapshotNiches = db.all(`
  SELECT iv.niche, COUNT(*) n
  FROM video_growth_snapshots vgs
  JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
  WHERE vgs.bucket = '7d' AND vgs.views IS NOT NULL AND vgs.views_per_hour IS NOT NULL
  GROUP BY iv.niche ORDER BY n DESC
`);
console.log('Niches with valid 7d snapshots:', JSON.stringify(snapshotNiches, null, 2));

// Total 7d snapshots
const total = db.get(`SELECT COUNT(*) n FROM video_growth_snapshots WHERE bucket='7d' AND views IS NOT NULL`);
console.log('Total 7d snapshots with views:', total);

// Sample snapshot rows to check video_id format
const sample = db.all(`SELECT video_id, bucket, views, views_per_hour FROM video_growth_snapshots WHERE bucket='7d' AND views_per_hour IS NOT NULL LIMIT 5`);
console.log('Sample snapshot rows:', JSON.stringify(sample, null, 2));

// Check if video_id in snapshots matches youtube_video_id in ingested_videos
const matched = db.get(`
  SELECT COUNT(*) n
  FROM video_growth_snapshots vgs
  JOIN ingested_videos iv ON iv.youtube_video_id = vgs.video_id
  WHERE vgs.bucket = '7d'
`);
console.log('Snapshots matched to ingested_videos:', matched);

db.close();
