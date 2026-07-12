'use strict';
require('dotenv').config({ path: __dirname + '/../.env' });
const { getDb } = require('../db/init');
const db = getDb();
const q = (sql, p = []) => { try { return db.get(sql, p); } catch (e) { return { err: e.message }; } };

console.log('=== SCALE ===');
console.log('channels:', q(`SELECT COUNT(*) n FROM ingested_channels`).n, '| ingest_enabled:', q(`SELECT COUNT(*) n FROM ingested_channels WHERE ingest_enabled=1`).n);
console.log('videos  :', q(`SELECT COUNT(*) n FROM ingested_videos`).n);
console.log('snapshots:', q(`SELECT COUNT(*) n FROM video_growth_snapshots`).n);

console.log('\n=== SEEDING GROWTH (new channels) ===');
['-1 day','-7 days','-30 days'].forEach(w => console.log(`  channels first-seen ${w}:`, q(`SELECT COUNT(*) n FROM ingested_channels WHERE created_at >= datetime('now','${w}')`).n ?? q(`SELECT COUNT(*) n FROM ingested_channels WHERE first_ingested_at >= datetime('now','${w}')`).n));
['-1 day','-7 days','-30 days'].forEach(w => console.log(`  videos ingested ${w}:`, q(`SELECT COUNT(*) n FROM ingested_videos WHERE ingested_at >= datetime('now','${w}')`).n));

console.log('\n=== SNAPSHOT FRESHNESS / COVERAGE ===');
console.log('  snapshots written -7d:', q(`SELECT COUNT(*) n FROM video_growth_snapshots WHERE captured_at >= datetime('now','-7 days')`).n);
console.log('  videos with 7d snap:', q(`SELECT COUNT(DISTINCT video_id) n FROM video_growth_snapshots WHERE bucket='7d'`).n);
console.log('  videos with BOTH 7d+30d (velocity-usable):', q(`SELECT COUNT(*) n FROM (SELECT video_id FROM video_growth_snapshots WHERE bucket IN ('7d','30d') GROUP BY video_id HAVING COUNT(DISTINCT bucket)=2)`).n);

console.log('\n=== NICHE SPREAD (peer-pool relevance) ===');
db.all(`SELECT COALESCE(primary_niche,niche) niche, COUNT(*) n FROM ingested_channels GROUP BY 1 ORDER BY n DESC LIMIT 12`).forEach(r => console.log(`  ${r.n}\t${r.niche}`));
process.exit(0);
