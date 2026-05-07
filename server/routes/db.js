const express = require('express');
const { getDb }           = require('../db/init');
const { getAllWorkspaces, getDbStats } = require('../db/queries');
const logger              = require('../utils/logger');

const router = express.Router();

router.get('/db/health', (req, res) => {
  try {
    const db     = getDb();
    const result = db.get('PRAGMA integrity_check');
    const ok     = result?.integrity_check === 'ok';
    logger.info('DB', `integrity_check=${result?.integrity_check}`);
    res.json({ status: ok ? 'ok' : 'corrupted', detail: result?.integrity_check });
  } catch (e) {
    logger.error('DB', 'integrity_check failed', e);
    res.status(500).json({ status: 'error', detail: e.message });
  }
});

router.get('/db/stats', (req, res) => {
  try {
    res.json(getDbStats(getDb()));
  } catch (e) {
    logger.error('DB', 'stats failed', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/db/backup', (req, res) => {
  try {
    const db         = getDb();
    const workspaces = getAllWorkspaces(db);
    res.json({ exported_at: new Date().toISOString(), workspaces });
  } catch (e) {
    logger.error('DB', 'backup failed', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
