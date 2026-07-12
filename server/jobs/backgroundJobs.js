const { startLanguageDetectionCron } = require('./languageDetectionJob');
const { startHistoricalIngestCron } = require('./historicalIngest');
const { startSnapshotCron } = require('./snapshotCron');
const { startNewVideoSweepCron } = require('./newVideoSweep');
const { startHookAggregationCron } = require('./aggregateHookPerformance');
const { startCorpusScheduler } = require('../services/corpusScheduler');
const { startCrawlerCron } = require('./indiaCrawlerJob');
const { startPromotionCron } = require('./corpusPromotionJob');
const { startBackupCron } = require('./backupJob');
const { startIntelligenceAggregatorCron } = require('./intelligenceAggregatorJob');
const { startNarrativeLifecycleCron } = require('./narrativeLifecycleJob');
const { startCreatorIdeaDnaCron } = require('./creatorIdeaDnaJob');
const { startWtpCacheRefreshCron } = require('./wtpCacheRefreshJob');
const { startWtpAttributionCron } = require('./wtpAttributionJob');

// Removed from cron schedule — files retained for admin CLI and route imports:
//   feedbackCron, youtubeIngest, refreshCron, outcomeRefreshJob, syntheticCalibration,
//   learningSnapshotCron, learningConfidenceCron, learningCohortCron,
//   embeddingIngestJob, semanticClusteringJob, primaryLanguageJob

const BACKGROUND_JOBS = [
  ['historical_ingest', startHistoricalIngestCron],
  ['snapshots', startSnapshotCron],
  ['new_video_sweep', startNewVideoSweepCron],
  ['hook_aggregation', startHookAggregationCron],
  ['corpus_scheduler', startCorpusScheduler],
  ['language_detection', startLanguageDetectionCron],
  ['india_crawler', startCrawlerCron],
  ['corpus_promotion', startPromotionCron],
  ['backup', startBackupCron],
  ['intelligence_aggregator', startIntelligenceAggregatorCron],
  ['narrative_lifecycle', startNarrativeLifecycleCron],
  ['creator_idea_dna', startCreatorIdeaDnaCron],
  ['wtp_cache_refresh', startWtpCacheRefreshCron],
  ['wtp_attribution', startWtpAttributionCron],
];

function startBackgroundJobs({ logger = require('../utils/logger'), source = 'worker' } = {}) {
  logger.info('WORKER', `Starting ${BACKGROUND_JOBS.length} background job schedulers from ${source}`);

  let started = 0;
  for (const [name, start] of BACKGROUND_JOBS) {
    try {
      start();
      started += 1;
    } catch (err) {
      logger.error('WORKER', `Failed to start background job scheduler: ${name}`, err);
    }
  }

  logger.info('WORKER', `Background job scheduler startup complete: ${started}/${BACKGROUND_JOBS.length} started`);
  return { total: BACKGROUND_JOBS.length, started };
}

module.exports = {
  BACKGROUND_JOBS,
  startBackgroundJobs,
};
