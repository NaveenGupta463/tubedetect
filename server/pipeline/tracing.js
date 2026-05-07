const logger = require('../utils/logger');

function createTrace(requestId) {
  const stages  = [];
  const warnings = [];
  let   _active  = null;

  return {
    startStage(name) {
      _active = { name, startedAt: Date.now() };
    },

    endStage(name, meta = {}) {
      const duration = _active?.name === name
        ? Date.now() - _active.startedAt
        : null;
      _active = null;
      stages.push({ name, duration, ...meta });
      logger.debug('PIPELINE', `[${requestId}] ${name} completed in ${duration}ms`);
    },

    warn(message) {
      warnings.push({ ts: Date.now(), message });
      logger.warn('PIPELINE', `[${requestId}] ${message}`);
    },

    fail(stageName, error) {
      stages.push({ name: stageName, failed: true, error: error?.message ?? String(error) });
      logger.error('PIPELINE', `[${requestId}] ${stageName} failed: ${error?.message ?? error}`);
    },

    serialize() {
      return {
        requestId,
        stages,
        warnings,
        timings: Object.fromEntries(
          stages.filter(s => s.duration != null).map(s => [s.name, s.duration])
        ),
      };
    },
  };
}

module.exports = { createTrace };
