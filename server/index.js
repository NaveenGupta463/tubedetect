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

  const { getDb }     = require('./db/init');
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
  const { startCron }                    = require('./jobs/feedbackCron');
  const { startIngestCron }              = require('./jobs/youtubeIngest');
  const { startRefreshCron }             = require('./jobs/refreshCron');
  const { startOutcomeRefreshJob }       = require('./jobs/outcomeRefreshJob');
  const { startHistoricalIngestCron }    = require('./jobs/historicalIngest');
  const { startSnapshotCron }            = require('./jobs/snapshotCron');

  const app = express();

  app.use(cors());
  app.use(express.json());

  getDb();

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
  app.use('/api', adminRoute);
  app.use('/api', adminIntelligenceRoute);

  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err.stack || err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  let cronStarted = false;
  const BASE_PORT = process.env.PORT || 3002;

  function startServer(port) {
    const server = app.listen(port, () => {
      logger.info('STARTUP', `Scoring Server listening on port ${port}`);
      if (!cronStarted) {
        cronStarted = true;
        startCron();
        startIngestCron();
        startRefreshCron();
        startOutcomeRefreshJob();
        startHistoricalIngestCron();
        startSnapshotCron();
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('STARTUP', `Port ${port} busy, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        logger.error('STARTUP', 'Server error', err);
      }
    });
  }

  startServer(BASE_PORT);

} catch (err) {
  console.error('FATAL STARTUP ERROR:', err);
  process.exit(1);
}
