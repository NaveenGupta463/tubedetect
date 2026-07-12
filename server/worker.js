process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

function shutdown(signal) {
  console.log(`\n[worker shutdown] ${signal} received - closing DB and exiting cleanly`);
  try {
    const { closeDb } = require('./db/init');
    closeDb();
    console.log('[worker shutdown] DB closed');
  } catch (_) {}
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  require('dotenv').config({ path: __dirname + '/.env' });
  process.env.TUBEINTEL_PROCESS = process.env.TUBEINTEL_PROCESS || 'worker';

  const path = require('path');
  const logger = require('./utils/logger');
  const { getDb } = require('./db/init');
  const { startBackgroundJobs } = require('./jobs/backgroundJobs');

  logger.info('WORKER', `TubeIntel Background Worker - Node ${process.version} - PID ${process.pid}`);
  logger.info('WORKER', `__dirname : ${__dirname}`);
  logger.info('WORKER', `cwd       : ${process.cwd()}`);
  logger.info('WORKER', `DB_PATH   : ${path.resolve(__dirname, 'data/scoring.db')}`);

  getDb();
  startBackgroundJobs({ logger, source: 'worker' });
} catch (err) {
  console.error('FATAL WORKER STARTUP ERROR:', err);
  process.exit(1);
}
