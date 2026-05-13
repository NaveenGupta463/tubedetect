const cron   = require('node-cron');
const { getDb }                    = require('../db/init');
const logger                       = require('../utils/logger');
const { buildEnsemble }            = require('../services/ensembleScoring');
const { extractFeatures }          = require('../services/featureExtraction');
const {
  computeActualPerformanceScoreFromVph,
  computeCalibrationError,
  getCalibrationBand,
}                                  = require('../services/calibration');
const {
  insertSyntheticOutcome,
  getActiveScoringVersionByType,
}                                  = require('../db/queries');

const BATCH_LIMIT = 500;

function readActiveWeights(db) {
  try {
    const v = getActiveScoringVersionByType(db, 'ensemble_weights');
    return v ? JSON.parse(v.weights_json) : null;
  } catch {
    return null;
  }
}

async function runSyntheticCalibrationCycle() {
  const db = getDb();

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
     LIMIT ?`,
    [BATCH_LIMIT],
  );

  if (eligible.length === 0) {
    logger.info('syntheticCalibration', 'No eligible videos — all caught up');
    return { processed: 0, inserted: 0 };
  }

  const activeWeights = readActiveWeights(db);
  let inserted = 0;

  for (const row of eligible) {
    try {
      const features = extractFeatures({ title: row.title ?? '', hook: '', niche: row.niche });

      const ensemble = await buildEnsemble({
        peer_context_score: null,
        matches_count:      0,
        features,
        activeWeights,
      });

      const vph = row.vph_actual;

      const actualPerfScore = computeActualPerformanceScoreFromVph(vph, {
        median_vph: row.median_vph,
        p75_vph:    row.p75_vph,
        p90_vph:    row.p90_vph,
      });

      if (actualPerfScore == null) continue;

      const calibError = computeCalibrationError({
        predicted_score:          ensemble.final_score,
        actual_performance_score: actualPerfScore,
      });
      const calibBand = getCalibrationBand(calibError);

      const outcomeState = calibBand === 'large_overprediction'  ? 'overperformed'
        : calibBand === 'large_underprediction' ? 'underperformed'
        : 'as_predicted';

      insertSyntheticOutcome(db, {
        youtube_video_id:         row.youtube_video_id,
        niche:                    row.niche ?? null,
        title:                    row.title ?? null,
        predicted_score:          ensemble.final_score,
        actual_performance_score: actualPerfScore,
        calibration_error:        calibError,
        calibration_band:         calibBand,
        actual_views_7d:          row.views_7d,
        velocity_7d:              vph != null ? parseFloat(Number(vph).toFixed(4)) : null,
        outcome_state:            outcomeState,
      });

      inserted++;
    } catch (e) {
      logger.warn('syntheticCalibration', `Skipped ${row.youtube_video_id}: ${e.message}`);
    }
  }

  logger.info('syntheticCalibration', `Processed ${eligible.length}, inserted ${inserted} synthetic outcomes`);
  return { processed: eligible.length, inserted };
}

function startSyntheticCalibrationCron() {
  cron.schedule('0 5 * * *', () => {
    runSyntheticCalibrationCycle().catch(err => logger.error('syntheticCalibration', err.message));
  });
  logger.info('syntheticCalibration', 'Scheduled — daily at 05:00 UTC');
}

module.exports = { runSyntheticCalibrationCycle, startSyntheticCalibrationCron };
