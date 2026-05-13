// Phase 4 & 5 deep dive — score distribution root cause analysis
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

// What do the raw VPH values look like for a sample niche?
q('Raw VPH sample — beauty, 7d',
  `SELECT
     iv.youtube_video_id,
     CAST(vgs.views AS REAL) / (7*24) AS computed_vph,
     nb.median_vph, nb.p75_vph, nb.p90_vph,
     iv.duration_seconds,
     CASE
       WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
       WHEN iv.duration_seconds < 180 THEN 'short'
       WHEN iv.duration_seconds < 600 THEN 'medium'
       ELSE 'long'
     END AS dur_bucket
   FROM ingested_videos iv
   JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id AND vgs.bucket='7d'
   JOIN niche_benchmarks nb
     ON nb.niche = iv.niche AND nb.bucket='7d'
     AND nb.duration_bucket = CASE
       WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
       WHEN iv.duration_seconds < 180 THEN 'short'
       WHEN iv.duration_seconds < 600 THEN 'medium'
       ELSE 'long'
     END
   WHERE iv.niche = 'technology'
   LIMIT 10`);

// What are the actual benchmark values?
q('Benchmark VPH values by niche (7d)',
  `SELECT niche, duration_bucket, sample_size,
     ROUND(median_vph,2) median_vph,
     ROUND(p75_vph,2) p75_vph,
     ROUND(p90_vph,2) p90_vph
   FROM niche_benchmarks
   WHERE bucket='7d' AND median_vph IS NOT NULL
   ORDER BY niche, duration_bucket`);

// How many videos are above p90 in their niche?
s('Videos above p90 VPH',
  `SELECT
     COUNT(*) total,
     SUM(CASE WHEN (CAST(vgs.views AS REAL)/(7*24)) >= nb.p90_vph THEN 1 ELSE 0 END) above_p90,
     SUM(CASE WHEN (CAST(vgs.views AS REAL)/(7*24)) >= nb.p75_vph
               AND (CAST(vgs.views AS REAL)/(7*24)) < nb.p90_vph THEN 1 ELSE 0 END) p75_to_p90,
     SUM(CASE WHEN (CAST(vgs.views AS REAL)/(7*24)) >= nb.median_vph
               AND (CAST(vgs.views AS REAL)/(7*24)) < nb.p75_vph THEN 1 ELSE 0 END) median_to_p75,
     SUM(CASE WHEN (CAST(vgs.views AS REAL)/(7*24)) < nb.median_vph THEN 1 ELSE 0 END) below_median
   FROM ingested_videos iv
   JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id AND vgs.bucket='7d'
   JOIN niche_benchmarks nb
     ON nb.niche = iv.niche AND nb.bucket='7d'
     AND nb.duration_bucket = CASE
       WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
       WHEN iv.duration_seconds < 180 THEN 'short'
       WHEN iv.duration_seconds < 600 THEN 'medium'
       ELSE 'long'
     END`);

// Check what patternMiner actually stores as vph — is it raw or SAV?
q('PatternMiner stored fields sample',
  `SELECT niche, bucket, duration_bucket, sample_size,
     median_views, p75_views, p90_views,
     median_vph, p75_vph, p90_vph,
     median_sav
   FROM niche_benchmarks
   WHERE bucket='7d' AND niche='technology'
   LIMIT 5`);

// Predicted score distribution from synthetic rows
q('Predicted score distribution in synthetic_b',
  `SELECT ROUND(predicted_score/10)*10 AS bucket, COUNT(*) n
   FROM video_outcomes WHERE pipeline_version='synthetic_b'
   GROUP BY bucket ORDER BY bucket`);

// Calibration error distribution
q('Calibration error distribution',
  `SELECT calibration_band, COUNT(*) n
   FROM video_outcomes WHERE pipeline_version='synthetic_b'
   GROUP BY calibration_band ORDER BY n DESC`);

// Per niche calibration error stats
q('Per-niche calibration summary',
  `SELECT niche,
     COUNT(*) n,
     ROUND(AVG(predicted_score),1) avg_pred,
     ROUND(AVG(actual_performance_score),1) avg_actual,
     ROUND(AVG(calibration_error),1) avg_err,
     ROUND(AVG(ABS(calibration_error)),1) mae
   FROM video_outcomes WHERE pipeline_version='synthetic_b'
   GROUP BY niche ORDER BY ABS(AVG(calibration_error)) DESC`);

db.close();
console.log('\n=== DONE ===');
