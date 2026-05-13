// Manual trigger for synthetic calibration — diagnostic use only.
// Uses ruleBasedScore directly and vgs.views_per_hour (actual age-adjusted VPH).

const { Database }       = require('node-sqlite3-wasm');
const path               = require('path');
const { extractFeatures }= require('../services/featureExtraction');
const { ruleBasedScore } = require('../services/ensembleScoring');
const {
  computeActualPerformanceScoreFromVph,
  computeCalibrationError,
  getCalibrationBand,
} = require('../services/calibration');
const { insertSyntheticOutcome } = require('../db/queries');

const DB_PATH   = path.resolve(__dirname, '../data/scoring.db');
const BATCH_LIMIT = 2000;

async function main() {
  const db = new Database(DB_PATH);

  const eligible = db.all(
    `SELECT iv.youtube_video_id, iv.title, iv.niche, iv.duration_seconds,
            vgs.views AS views_7d,
            vgs.views_per_hour AS vph_actual,
            nb.median_vph, nb.p75_vph, nb.p90_vph
     FROM ingested_videos iv
     JOIN video_growth_snapshots vgs ON vgs.video_id = iv.youtube_video_id AND vgs.bucket = '7d'
     JOIN niche_benchmarks nb
       ON nb.niche = iv.niche
      AND nb.bucket = '7d'
      AND nb.duration_bucket = CASE
            WHEN iv.duration_seconds IS NULL OR iv.duration_seconds <= 0 THEN 'unknown'
            WHEN iv.duration_seconds < 180  THEN 'short'
            WHEN iv.duration_seconds < 600  THEN 'medium'
            ELSE 'long'
          END
     WHERE vgs.views IS NOT NULL
       AND vgs.views_per_hour IS NOT NULL
       AND nb.median_vph IS NOT NULL AND nb.median_vph > 0
       AND nb.p75_vph IS NOT NULL AND nb.p75_vph > 0
       AND nb.p90_vph IS NOT NULL AND nb.p90_vph > 0
       AND NOT EXISTS (
         SELECT 1 FROM video_outcomes vo
         WHERE vo.youtube_video_id = iv.youtube_video_id
           AND vo.pipeline_version = 'synthetic_b'
       )
     ORDER BY RANDOM()
     LIMIT ?`,
    [BATCH_LIMIT],
  );

  console.log(`[trigger] Eligible videos: ${eligible.length}`);
  if (eligible.length === 0) {
    console.log('[trigger] Nothing to process');
    db.close();
    return;
  }

  let inserted = 0, skipped = 0;
  const t0 = Date.now();

  for (const row of eligible) {
    try {
      const features   = extractFeatures({ title: row.title ?? '', hook: '', niche: row.niche });
      const finalScore = ruleBasedScore(features);
      const vph        = row.vph_actual;

      const actualPerfScore = computeActualPerformanceScoreFromVph(vph, {
        median_vph: row.median_vph,
        p75_vph:    row.p75_vph,
        p90_vph:    row.p90_vph,
      });

      if (actualPerfScore == null) { skipped++; continue; }

      const calibError   = computeCalibrationError({ predicted_score: finalScore, actual_performance_score: actualPerfScore });
      const calibBand    = getCalibrationBand(calibError);
      const outcomeState = calibBand === 'large_overprediction'  ? 'overperformed'
        : calibBand === 'large_underprediction' ? 'underperformed'
        : 'as_predicted';

      insertSyntheticOutcome(db, {
        youtube_video_id:         row.youtube_video_id,
        niche:                    row.niche ?? null,
        title:                    row.title ?? null,
        predicted_score:          finalScore,
        actual_performance_score: actualPerfScore,
        calibration_error:        calibError,
        calibration_band:         calibBand,
        actual_views_7d:          row.views_7d,
        velocity_7d:              parseFloat(Number(vph).toFixed(4)),
        outcome_state:            outcomeState,
      });
      inserted++;
    } catch (e) {
      console.warn(`[trigger] Skipped ${row.youtube_video_id}: ${e.message}`);
      skipped++;
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[trigger] Done in ${elapsed}s — inserted=${inserted} skipped=${skipped}`);

  // Quick health check
  const stats = db.get(`
    SELECT COUNT(*) n,
      ROUND(AVG(actual_performance_score),2) avg_actual,
      ROUND(AVG(predicted_score),2) avg_pred,
      ROUND(AVG(ABS(calibration_error)),2) mae
    FROM video_outcomes WHERE pipeline_version = 'synthetic_b'
  `);
  console.log('[trigger] synthetic_b health check:', JSON.stringify(stats));

  db.close();
}

main().catch(e => { console.error('[trigger] FATAL:', e.message); process.exit(1); });
