const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

const featHook = db.get('SELECT COUNT(*) n, SUM(CASE WHEN hook_type IS NOT NULL THEN 1 ELSE 0 END) with_hook FROM features');
console.log('features.hook_type:', JSON.stringify(featHook));

const featTotal = db.get('SELECT COUNT(*) n FROM features');
console.log('features total rows:', featTotal.n);

const videoTotal = db.get('SELECT COUNT(*) n FROM videos');
console.log('videos (scored) total rows:', videoTotal.n);

const ivCols = db.all('PRAGMA table_info(ingested_videos)').map(r => r.name);
console.log('ingested_videos cols:', ivCols.join(', '));

const ivNiche = db.all('SELECT niche, COUNT(*) n FROM ingested_videos GROUP BY niche ORDER BY n DESC LIMIT 10');
console.log('ingested_videos by niche:', JSON.stringify(ivNiche));

const ivTitle = db.all('SELECT video_id, title, niche, published_at FROM ingested_videos LIMIT 3');
console.log('sample ingested_videos:', JSON.stringify(ivTitle));

const vgsHour = db.get('SELECT COUNT(*) n FROM video_growth_snapshots WHERE views_per_hour IS NOT NULL AND views_per_hour > 0');
console.log('vgs rows with vph:', vgsHour.n);

const nicheCount = db.all('SELECT niche, COUNT(*) n FROM ingested_channels GROUP BY niche ORDER BY n DESC');
console.log('channels by niche:', JSON.stringify(nicheCount));

db.close();
