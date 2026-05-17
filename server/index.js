process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

try {
  require('dotenv').config({ path: __dirname + '/.env' });

  const logger  = require('./utils/logger');
  const express = require('express');
  const cors    = require('cors');

  logger.info('STARTUP', `TubeIntel Scoring Server — Node ${process.version} — PID ${process.pid}`);
  logger.info('STARTUP', `OPENAI_API_KEY   : ${process.env.OPENAI_API_KEY    ? '✓ loaded' : '✗ missing — embeddings disabled'}`);
  logger.info('STARTUP', `ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✓ loaded' : '✗ missing — explain uses rule-based fallback'}`);
  logger.info('STARTUP', `YT_API_KEY       : ${(process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY) ? '✓ loaded' : '✗ missing — cron/ingest disabled'}`);

  if (!process.env.OPENAI_API_KEY)
    logger.warn('STARTUP', 'Embeddings disabled — similarity scoring will use performance peers only');
  if (!process.env.ANTHROPIC_API_KEY)
    logger.warn('STARTUP', '/api/explain will use rule-based fallback');
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY)
    logger.warn('STARTUP', 'Feedback cron and YouTube ingestion will not run');

  const path          = require('path');
  const { getDb }     = require('./db/init');
  logger.info('STARTUP', `__dirname : ${__dirname}`);
  logger.info('STARTUP', `cwd       : ${process.cwd()}`);
  logger.info('STARTUP', `DB_PATH   : ${path.resolve(__dirname, 'data/scoring.db')}`);
  const analyzeRoute  = require('./routes/analyze');
  const resultsRoute  = require('./routes/results');
  const feedbackRoute = require('./routes/feedback');
  const explainRoute  = require('./routes/explain');
  const lookupRoute   = require('./routes/lookup');
  const metricsRoute  = require('./routes/metrics');
  const workspacesRoute         = require('./routes/workspaces');
  const dbRoute                 = require('./routes/db');
  const predictionFeedbackRoute = require('./routes/predictionFeedback');
  const outcomesRoute           = require('./routes/outcomes');
  const learningRoute           = require('./routes/learning');
  const experimentsRoute        = require('./routes/experiments');
  const adminRoute              = require('./routes/admin');
  const adminIntelligenceRoute  = require('./routes/adminIntelligence');
  const adminEvolutionRoute     = require('./routes/adminEvolution');
  const discoveryRoute          = require('./routes/discovery');
  const creatorIntelRoute                = require('./routes/creatorIntel');
  const onboardingRoute                  = require('./routes/onboarding');
  const { router: channelSignalsRoute }  = require('./routes/channelSignals');
  const { startLanguageDetectionCron }   = require('./jobs/languageDetectionJob');
  const intelligenceRoute       = require('./routes/intelligence');
  const semanticRoute           = require('./routes/semantic');
  const strategyRoute           = require('./routes/strategy');
  const channelCacheRoute       = require('./routes/channelCache');
  const corpusRoute             = require('./routes/corpus');
  const governanceRoute         = require('./routes/governance');
  const { startCron }                    = require('./jobs/feedbackCron');
  const { startIngestCron }              = require('./jobs/youtubeIngest');
  const { startRefreshCron }             = require('./jobs/refreshCron');
  const { startOutcomeRefreshJob }       = require('./jobs/outcomeRefreshJob');
  const { startHistoricalIngestCron }    = require('./jobs/historicalIngest');
  const { startSnapshotCron }            = require('./jobs/snapshotCron');
  const { startSyntheticCalibrationCron } = require('./jobs/syntheticCalibration');
  const { startLearningSnapshotCron }     = require('./jobs/learningSnapshotCron');
  const { startLearningConfidenceCron }   = require('./jobs/learningConfidenceCron');
  const { startHookAggregationCron }      = require('./jobs/aggregateHookPerformance');
  const { startLearningCohortCron }       = require('./jobs/learningCohortCron');
  const { startEmbeddingIngestCron }      = require('./jobs/embeddingIngestJob');
  const { startSemanticClusteringCron }   = require('./jobs/semanticClusteringJob');
  const { startCorpusScheduler }          = require('./services/corpusScheduler');
  const { startCrawlerCron }             = require('./jobs/indiaCrawlerJob');
  const { startPromotionCron }           = require('./jobs/corpusPromotionJob');

  const app = express();

  app.use(cors());
  app.use(express.json());

  getDb();

  // ── Public routes (no auth) — must come BEFORE adminRoute ──────────────────
  app.use('/api', analyzeRoute);
  app.use('/api', resultsRoute);
  app.use('/api', feedbackRoute);
  app.use('/api', explainRoute);
  app.use('/api', lookupRoute);
  app.use('/api', metricsRoute);
  app.use('/api', workspacesRoute);
  app.use('/api', dbRoute);
  app.use('/api', predictionFeedbackRoute);
  app.use('/api', outcomesRoute);
  app.use('/api', learningRoute);
  app.use('/api', experimentsRoute);
  app.use('/api/intel', creatorIntelRoute);
  app.use('/api/intel', onboardingRoute);
  app.use('/api', channelSignalsRoute);
  app.use('/api', intelligenceRoute);
  app.use('/api', semanticRoute);
  app.use('/api', strategyRoute);
  app.use('/api', channelCacheRoute);
  app.use('/api', corpusRoute);
  app.use('/api', governanceRoute);

  // ── Admin routes (token-protected) ───────────────────────────────────────────
  app.use('/api', adminRoute);
  app.use('/api', adminIntelligenceRoute);
  app.use('/api', adminEvolutionRoute);
  app.use('/api', discoveryRoute);

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err.stack || err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  const BASE_PORT = parseInt(process.env.PORT || '3002', 10);

  const server = app.listen(BASE_PORT, () => {
    logger.info('STARTUP', `Scoring Server listening on port ${BASE_PORT}`);
    startCron();
    startIngestCron();
    startRefreshCron();
    startOutcomeRefreshJob();
    startHistoricalIngestCron();
    startSnapshotCron();
    startSyntheticCalibrationCron();
    startLearningSnapshotCron();
    startLearningConfidenceCron();
    startHookAggregationCron();
    startLearningCohortCron();
    startEmbeddingIngestCron();
    startSemanticClusteringCron();
    startCorpusScheduler();
    startLanguageDetectionCron();
    startCrawlerCron();
    startPromotionCron();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('STARTUP', `Port ${BASE_PORT} is already in use. Kill the existing process and restart. Exiting.`);
      process.exit(1);
    } else {
      logger.error('STARTUP', 'Server error', err);
      process.exit(1);
    }
  });

} catch (err) {
  console.error('FATAL STARTUP ERROR:', err);
  process.exit(1);
}
