process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

try {
  require('dotenv').config({ path: __dirname + '/.env' });

  console.log('=== ENV CHECK ===');
  console.log('OPENAI_API_KEY:    ', process.env.OPENAI_API_KEY    ? 'Loaded' : 'Missing');
  console.log('ANTHROPIC_API_KEY: ', process.env.ANTHROPIC_API_KEY ? 'Loaded' : 'Missing');
  console.log('YT_API_KEY:        ', process.env.YT_API_KEY        ? 'Loaded' : 'Missing');
  console.log('=================');

  if (!process.env.OPENAI_API_KEY)
    console.warn('[WARN] OPENAI_API_KEY not set — embeddings disabled, performance peers only');
  if (!process.env.ANTHROPIC_API_KEY)
    console.warn('[WARN] ANTHROPIC_API_KEY not set — /api/explain will use rule-based fallback');
  if (!process.env.YT_API_KEY && !process.env.YOUTUBE_API_KEY)
    console.warn('[WARN] YT_API_KEY not set — feedback cron and ingestion will not run');

  const express = require('express');
  const cors    = require('cors');
  const { getDb }        = require('./db/init');
  const analyzeRoute     = require('./routes/analyze');
  const resultsRoute     = require('./routes/results');
  const feedbackRoute    = require('./routes/feedback');
  const explainRoute     = require('./routes/explain');
  const lookupRoute      = require('./routes/lookup');
  const metricsRoute     = require('./routes/metrics');
  const workspacesRoute  = require('./routes/workspaces');
  const { startCron }         = require('./jobs/feedbackCron');
  const { startIngestCron }   = require('./jobs/youtubeIngest');
  const { startRefreshCron }  = require('./jobs/refreshCron');

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

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use((err, _req, res, _next) => {
    console.error('[Server Error]', err.stack || err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  let cronStarted = false;
  const BASE_PORT = process.env.PORT || 3002;

  function startServer(port) {
    const server = app.listen(port, () => {
      console.log(`Scoring Server running on port ${port}`);
      if (!cronStarted) {
        cronStarted = true;
        startCron();
        startIngestCron();
        startRefreshCron();
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${port} busy, trying ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('SERVER ERROR:', err);
      }
    });
  }

  startServer(BASE_PORT);

} catch (err) {
  console.error('FATAL STARTUP ERROR:', err);
  process.exit(1);
}
