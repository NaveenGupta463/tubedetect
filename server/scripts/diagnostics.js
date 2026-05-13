const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const DB_PATH = path.resolve(__dirname, '../data/scoring.db');
const db = new Database(DB_PATH);

function q(label, sql, params) {
  try {
    const rows = db.all(sql, params || []);
    console.log('\n=== ' + label + ' ===');
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.log('\n=== ' + label + ' === ERROR: ' + e.message);
  }
}

function s(label, sql, params) {
  try {
    const row = db.get(sql, params || []);
    console.log('\n=== ' + label + ' ===');
    console.log(JSON.stringify(row, null, 2));
  } catch (e) {
    console.log('\n=== ' + label + ' === ERROR: ' + e.message);
  }
}

// ── PHASE 1 ───────────────────────────────────────────────────────────────────
s('P1 video_outcomes overview',
  `SELECT COUNT(*) total,
     SUM(CASE WHEN actual_performance_score IS NOT NULL THEN 1 ELSE 0 END) scored,
     AVG(ABS(calibration_error)) mae
   FROM video_outcomes`);

// ── PHASE 3 ───────────────────────────────────────────────────────────────────
q('P3 pipeline_version breakdown',
  `SELECT COALESCE(pipeline_version,'NULL') pipeline_version, COUNT(*) n
   FROM video_outcomes GROUP BY pipeline_version`);

s('P3 synthetic_b weight check',
  `SELECT COUNT(*) total, AVG(calibration_weight) avg_weight,
     MIN(calibration_weight) min_weight, MAX(calibration_weight) max_weight
   FROM video_outcomes WHERE pipeline_version='synthetic_b'`);

// ── PHASE 4 ───────────────────────────────────────────────────────────────────
s('P4 score distribution stats',
  `SELECT MIN(actual_performance_score) mn, MAX(actual_performance_score) mx,
     AVG(actual_performance_score) avg_score, COUNT(*) n
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL`);

q('P4 score buckets',
  `SELECT ROUND(actual_performance_score/10)*10 AS bucket, COUNT(*) n
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL
   GROUP BY bucket ORDER BY bucket`);

// ── PHASE 5 ───────────────────────────────────────────────────────────────────
s('P5 ingested_videos with duration_seconds',
  `SELECT COUNT(*) total,
     SUM(CASE WHEN duration_seconds IS NOT NULL AND duration_seconds > 0 THEN 1 ELSE 0 END) has_duration,
     SUM(CASE WHEN duration_seconds IS NULL OR duration_seconds <= 0 THEN 1 ELSE 0 END) missing_duration
   FROM ingested_videos`);

s('P5 niche_benchmarks coverage',
  `SELECT COUNT(*) total,
     COUNT(DISTINCT niche) niches,
     COUNT(DISTINCT bucket) buckets,
     COUNT(DISTINCT duration_bucket) dur_buckets
   FROM niche_benchmarks WHERE median_vph IS NOT NULL`);

q('P5 benchmark duration bucket breakdown',
  `SELECT duration_bucket, COUNT(*) n FROM niche_benchmarks GROUP BY duration_bucket`);

q('P5 synthetic rows missing benchmark (sample)',
  `SELECT iv.niche,
     CASE
       WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
       WHEN iv.duration_seconds < 180 THEN 'short'
       WHEN iv.duration_seconds < 600 THEN 'medium'
       ELSE 'long'
     END AS dur_bucket,
     COUNT(*) n,
     SUM(CASE WHEN nb.niche IS NULL THEN 1 ELSE 0 END) no_benchmark
   FROM ingested_videos iv
   JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
   LEFT JOIN niche_benchmarks nb
     ON nb.niche = iv.niche AND nb.bucket = '7d'
     AND nb.duration_bucket = CASE
       WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
       WHEN iv.duration_seconds < 180 THEN 'short'
       WHEN iv.duration_seconds < 600 THEN 'medium'
       ELSE 'long'
     END
   GROUP BY iv.niche, dur_bucket ORDER BY no_benchmark DESC LIMIT 15`);

// ── PHASE 6 ───────────────────────────────────────────────────────────────────
q('P6 MAE by date',
  `SELECT DATE(last_refreshed_at) dt, AVG(ABS(calibration_error)) mae, COUNT(*) samples
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL
   GROUP BY dt ORDER BY dt`);

// ── PHASE 7 ───────────────────────────────────────────────────────────────────
q('P7 scoring_versions',
  `SELECT version_type, version_name, active, created_at FROM scoring_versions ORDER BY created_at DESC LIMIT 10`);

s('P7 weight_audit count', `SELECT COUNT(*) n FROM scoring_weight_audit`);

q('P7 calibration recommendations preview',
  `SELECT niche, AVG(calibration_error) avg_err, COUNT(*) n
   FROM video_outcomes WHERE calibration_error IS NOT NULL
   GROUP BY niche ORDER BY ABS(AVG(calibration_error)) DESC LIMIT 10`);

// ── PHASE 8 ───────────────────────────────────────────────────────────────────
s('P8 stale outcomes >7d',
  `SELECT COUNT(*) stale FROM video_outcomes WHERE last_refreshed_at < datetime('now','-7 days')`);

s('P8 latest refresh timestamp', `SELECT MAX(last_refreshed_at) latest FROM video_outcomes`);

s('P8 prediction_feedback count', `SELECT COUNT(*) n FROM prediction_feedback`);

s('P8 predictions total', `SELECT COUNT(*) n FROM predictions`);

// ── JOB STATE ─────────────────────────────────────────────────────────────────
const fs   = require('fs');
const STATE_PATH = path.resolve(__dirname, '../data/job_state.json');
console.log('\n=== Job State File ===');
try {
  const raw = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : {};
  console.log(JSON.stringify(raw, null, 2));
} catch (e) {
  console.log('ERROR: ' + e.message);
}

// ── INGESTED VIDEO GROWTH ─────────────────────────────────────────────────────
s('P5 video_growth_snapshots 7d count',
  `SELECT COUNT(*) n FROM video_growth_snapshots WHERE bucket='7d' AND views IS NOT NULL`);

s('P5 benchmark vph sanity check',
  `SELECT COUNT(*) corrupt FROM niche_benchmarks WHERE p75_vph < median_vph OR p90_vph < p75_vph`);

db.close();
console.log('\n=== DONE ===');
