// Root-cause audit: Stable → Volatile health transition
const { Database } = require('node-sqlite3-wasm');
const path = require('path');
const db = new Database(path.resolve(__dirname, '../data/scoring.db'));

function q(label, sql, params = []) {
  try {
    const rows = db.all(sql, params);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) { console.log(`\n=== ${label} === ERROR: ${e.message}`); }
}
function s(label, sql, params = []) {
  try {
    const row = db.get(sql, params);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(row, null, 2));
  } catch (e) { console.log(`\n=== ${label} === ERROR: ${e.message}`); }
}

// ── 1. INTELLIGENCE VERSIONS — ALL ROWS ──────────────────────────────────────
q('1A. All intelligence_versions (full)',
  `SELECT id, created_at, trigger, health_score, learning_velocity,
     changed_weights_json, prev_weights_json, new_weights_json, notes
   FROM intelligence_versions ORDER BY created_at DESC LIMIT 20`);

// ── 2. WEIGHT DELTA COMPUTATION — EXACT ──────────────────────────────────────
q('2A. changed_weights_json raw (last 5)',
  `SELECT created_at, trigger, changed_weights_json
   FROM intelligence_versions ORDER BY created_at DESC LIMIT 5`);

s('2B. Weight delta numeric (latest row)',
  `SELECT changed_weights_json FROM intelligence_versions ORDER BY created_at DESC LIMIT 1`);

// ── 3. SCORING_VERSIONS — WEIGHTS OVER TIME ───────────────────────────────────
q('3A. scoring_versions (all)',
  `SELECT id, version_name, version_type, weights_json, active, created_at, notes
   FROM scoring_versions ORDER BY created_at DESC LIMIT 10`);

// ── 4. SCORING WEIGHT AUDIT ───────────────────────────────────────────────────
q('4A. scoring_weight_audit (all)',
  `SELECT id, version_type, old_weights_json, new_weights_json,
     trigger_reason, applied_by, applied_at
   FROM scoring_weight_audit ORDER BY applied_at DESC LIMIT 10`);

// ── 5. CALIBRATION ERROR DISTRIBUTION — BEFORE/AFTER ─────────────────────────
s('5A. calibration_error stats (all synthetic_b)',
  `SELECT COUNT(*) n,
     ROUND(AVG(calibration_error),3) avg_err,
     ROUND(AVG(ABS(calibration_error)),3) mae,
     ROUND(MIN(calibration_error),2) min_err,
     ROUND(MAX(calibration_error),2) max_err,
     ROUND(SUM(CASE WHEN ABS(calibration_error) > 50 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) pct_extreme
   FROM video_outcomes WHERE pipeline_version = 'synthetic_b'`);

q('5B. calibration_band distribution (synthetic_b)',
  `SELECT calibration_band, COUNT(*) n,
     ROUND(AVG(calibration_error),2) avg_err,
     ROUND(AVG(ABS(calibration_error)),2) mae
   FROM video_outcomes WHERE pipeline_version = 'synthetic_b'
   GROUP BY calibration_band ORDER BY n DESC`);

q('5C. Per-niche calibration error (top 10 by |avg_err|)',
  `SELECT niche, COUNT(*) n,
     ROUND(AVG(calibration_error),2) avg_err,
     ROUND(AVG(ABS(calibration_error)),2) mae
   FROM video_outcomes WHERE pipeline_version = 'synthetic_b'
   GROUP BY niche ORDER BY ABS(AVG(calibration_error)) DESC LIMIT 10`);

// ── 6. VELOCITY COMPUTATION INPUTS ───────────────────────────────────────────
s('6A. calibration_freq last 30d',
  `SELECT COUNT(*) n FROM intelligence_versions
   WHERE trigger IN ('auto','manual') AND created_at >= datetime('now', '-30 days')`);

s('6B. accuracy_slope — 7d vs 30d accurate rate',
  `SELECT
     (SELECT AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END)
      FROM video_outcomes WHERE actual_performance_score IS NOT NULL
        AND last_refreshed_at >= datetime('now', '-7 days'))  AS acc_7d,
     (SELECT AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END)
      FROM video_outcomes WHERE actual_performance_score IS NOT NULL
        AND last_refreshed_at >= datetime('now', '-30 days')) AS acc_30d`);

s('6C. benchmark_drift — available batches',
  `SELECT COUNT(DISTINCT snapshot_batch_id) AS n_batches,
     MIN(snapshot_at) AS oldest, MAX(snapshot_at) AS newest
   FROM niche_benchmark_history`);

q('6D. two latest snapshot batches',
  `SELECT snapshot_batch_id, MIN(snapshot_at) AS snapshot_at, COUNT(*) AS rows
   FROM niche_benchmark_history
   GROUP BY snapshot_batch_id ORDER BY snapshot_at DESC LIMIT 2`);

// ── 7. HEALTH SCORE COMPONENTS ────────────────────────────────────────────────
s('7A. accuracy component (30d window)',
  `SELECT COUNT(*) AS total,
     SUM(CASE WHEN ABS(calibration_error) <= 10 THEN 1 ELSE 0 END) AS accurate
   FROM video_outcomes
   WHERE actual_performance_score IS NOT NULL
     AND last_refreshed_at >= datetime('now', '-30 days')`);

s('7B. calibration component',
  `SELECT COUNT(*) AS n FROM intelligence_versions
   WHERE trigger IN ('auto','manual') AND created_at >= datetime('now', '-90 days')`);

q('7C. stability component — weekly accuracy',
  `SELECT strftime('%Y-W%W', last_refreshed_at) AS week,
     COUNT(*) n,
     ROUND(AVG(CASE WHEN ABS(calibration_error) <= 10 THEN 1.0 ELSE 0.0 END),4) AS acc
   FROM video_outcomes
   WHERE actual_performance_score IS NOT NULL
     AND last_refreshed_at >= datetime('now', '-30 days')
   GROUP BY week ORDER BY week ASC`);

// ── 8. SYNTHETIC INSERT VOLUME + TIMING ──────────────────────────────────────
q('8A. synthetic_b inserts by date',
  `SELECT DATE(created_at) AS dt, COUNT(*) n,
     ROUND(AVG(ABS(calibration_error)),2) mae
   FROM video_outcomes WHERE pipeline_version = 'synthetic_b'
   GROUP BY DATE(created_at) ORDER BY dt`);

s('8B. synthetic vs real totals',
  `SELECT
     SUM(CASE WHEN pipeline_version = 'synthetic_b' THEN 1 ELSE 0 END) synthetic,
     SUM(CASE WHEN pipeline_version != 'synthetic_b' THEN 1 ELSE 0 END) real,
     COUNT(*) total
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL`);

// ── 9. WEIGHTED AVERAGING VERIFICATION ───────────────────────────────────────
s('9A. calibration_weight distribution',
  `SELECT COALESCE(calibration_weight, 1.0) AS w,
     COUNT(*) n,
     pipeline_version
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL
   GROUP BY w, pipeline_version ORDER BY w`);

// ── 10. OUTCOME REFRESH WRITE FREQUENCY ──────────────────────────────────────
s('10A. outcome refresh recency',
  `SELECT
     COUNT(*) total,
     MAX(last_refreshed_at) most_recent,
     MIN(last_refreshed_at) oldest,
     SUM(CASE WHEN last_refreshed_at >= datetime('now', '-1 hours') THEN 1 ELSE 0 END) last_1h
   FROM video_outcomes WHERE actual_performance_score IS NOT NULL`);

s('10B. refresh_count distribution',
  `SELECT COALESCE(refresh_count, 0) AS rc, COUNT(*) n
   FROM video_outcomes GROUP BY rc ORDER BY rc`);

// ── 11. LEARNING SNAPSHOT TABLE ───────────────────────────────────────────────
q('11A. learning_health_snapshots all rows',
  `SELECT * FROM learning_health_snapshots ORDER BY snapshot_date`);

db.close();
console.log('\n=== AUDIT COMPLETE ===');
