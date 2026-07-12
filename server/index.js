process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

// Graceful shutdown — close DB before exit so no in-progress writes are torn.
// Called by SIGTERM (nodemon restart, OS stop) and SIGINT (Ctrl+C).
function shutdown(signal) {
  console.log(`\n[shutdown] ${signal} received — closing DB and exiting cleanly`);
  try {
    const { closeDb } = require('./db/init');
    closeDb();
    console.log('[shutdown] DB closed');
  } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

try {
  require('dotenv').config({ path: __dirname + '/.env' });

  const logger  = require('./utils/logger');
  const express = require('express');
  const cors    = require('cors');
  const API_SLOW_MS = Math.max(0, parseInt(process.env.API_SLOW_MS || '1000', 10));
  const API_TIMING_DEBUG = process.env.API_TIMING_DEBUG === '1';
  const API_TIMING_ALWAYS = new Set([
    '/api/intel/what-to-post',
    '/api/intel/community-hot',
    '/api/intel/adjacent-ideas',
    '/api/intel/foreign-signal',
    '/api/intel/trending-topics',
  ]);

  function routeForTiming(req) {
    return String(req.originalUrl || req.url || req.path || '')
      .replace(/\?.*$/, '')
      .slice(0, 180);
  }

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
  const copilotRoute                     = require('./routes/copilot');
  const creditsRoute                     = require('./routes/credits');
  const draftsRoute                      = require('./routes/drafts');
  const { router: channelSignalsRoute }  = require('./routes/channelSignals');
  const intelligenceRoute       = require('./routes/intelligence');
  const semanticRoute           = require('./routes/semantic');
  const researchRoute           = require('./routes/research');
  const strategyRoute           = require('./routes/strategy');
  const channelCacheRoute       = require('./routes/channelCache');
  const corpusRoute             = require('./routes/corpus');
  const governanceRoute         = require('./routes/governance');
  const videoRepairRoute              = require('./routes/videoRepair');
  const prepublishIntelligenceRoute   = require('./routes/prepublishIntelligence');
  const wtpOutcomesRoute              = require('./routes/wtpOutcomes');
  const wtpAttributionRoute           = require('./routes/wtpAttribution');
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use((req, res, next) => {
    const started = Date.now();
    const route = routeForTiming(req);
    res.on('finish', () => {
      const ms = Date.now() - started;
      const always = API_TIMING_ALWAYS.has(route);
      if (!API_TIMING_DEBUG && !always && (API_SLOW_MS <= 0 || ms < API_SLOW_MS)) return;
      const level = API_SLOW_MS > 0 && ms >= API_SLOW_MS ? 'warn' : 'info';
      logger[level]('API_TIMING', `${req.method} ${route} status=${res.statusCode} ms=${ms}`);
    });
    next();
  });

  // Kill requests that hang longer than their allowed time.
  // Copilot/AI routes get 90s (Claude streaming can take 40-60s).
  // All other routes get 20s.
  app.use((req, res, next) => {
    const isAiRoute = req.path.startsWith('/api/copilot') || req.path.match(/\/api\/repair\/[^/]+\/ai$/);
    const timeout = isAiRoute ? 90000 : 20000;
    res.setTimeout(timeout, () => {
      if (!res.headersSent) res.status(503).json({ error: 'Request timed out' });
    });
    next();
  });

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
  app.use('/api/copilot', copilotRoute);
  app.use('/api', creditsRoute);
  app.use('/api', draftsRoute);
  app.use('/api', channelSignalsRoute);
  app.use('/api', intelligenceRoute);
  app.use('/api', semanticRoute);
  app.use('/api', researchRoute);
  app.use('/api', strategyRoute);
  app.use('/api', channelCacheRoute);
  app.use('/api', corpusRoute);
  app.use('/api', governanceRoute);
  app.use('/api', videoRepairRoute);
  app.use('/api/intel', prepublishIntelligenceRoute);
  app.use('/api/intel', wtpOutcomesRoute);
  app.use('/api/intel', wtpAttributionRoute);

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
  const legacyCronBlock = process.env.E2E_NO_CRONS === '1' || process.env.DISABLE_STARTUP_CRONS === '1';
  const apiCronsEnabled = process.env.ENABLE_API_CRONS === '1' && !legacyCronBlock;

  const server = app.listen(BASE_PORT, () => {
    logger.info('STARTUP', `Scoring Server listening on port ${BASE_PORT}`);
    if (legacyCronBlock) {
      logger.warn('STARTUP', 'Startup crons disabled by E2E_NO_CRONS/DISABLE_STARTUP_CRONS');
      return;
    }
    if (!apiCronsEnabled) {
      logger.warn('STARTUP', 'API process running without background crons. Start server/worker.js for jobs, or set ENABLE_API_CRONS=1 for legacy single-process behavior.');
      return;
    }
    const { startBackgroundJobs } = require('./jobs/backgroundJobs');
    startBackgroundJobs({ logger, source: 'api_legacy' });
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
