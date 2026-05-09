const express = require('express');
const crypto  = require('crypto');
const { getDb }    = require('../db/init');
const quotaGuard   = require('../services/quotaGuard');
const {
  getIngestableChannels,
  getAllIngestedChannels,
  upsertIngestedChannel,
  setChannelEnabled,
  getIngestedVideoCount,
  getSnapshotCountByBucket,
  getAllNicheBenchmarks,
  getNicheBenchmarksByNiche,
} = require('../db/queries');
const { runHistoricalIngestCycle } = require('../jobs/historicalIngest');
const { runSnapshotCycle }         = require('../jobs/snapshotCron');
const { runPatternMining }         = require('../services/patternMiner');

const router = express.Router();

function adminAuth(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const provided = req.headers['x-admin-token'] ?? req.query.admin_token;
  if (provided !== token) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.use(adminAuth);

// ── Channel management ────────────────────────────────────────────────────────

// GET /api/admin/intelligence/channels
router.get('/admin/intelligence/channels', (_req, res) => {
  try {
    const db = getDb();
    res.json({ channels: getAllIngestedChannels(db) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels
// Body: { channel_id, niche, notes? }
router.post('/admin/intelligence/channels', (req, res) => {
  try {
    const db = getDb();
    const { channel_id, niche, notes } = req.body ?? {};
    if (!channel_id || !niche) {
      return res.status(400).json({ error: 'channel_id and niche are required' });
    }
    const id = crypto.randomUUID();
    upsertIngestedChannel(db, { id, channel_id, niche, added_by: 'admin', notes });
    res.json({ ok: true, id, channel_id, niche });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels/bulk
// Body: { channels: [{ channel_id, niche, notes? }] }
router.post('/admin/intelligence/channels/bulk', (req, res) => {
  try {
    const db = getDb();
    const { channels } = req.body ?? {};
    if (!Array.isArray(channels) || !channels.length) {
      return res.status(400).json({ error: 'channels array is required' });
    }
    const results = [];
    for (const { channel_id, niche, notes } of channels) {
      if (!channel_id || !niche) { results.push({ channel_id, ok: false, reason: 'missing channel_id or niche' }); continue; }
      const id = crypto.randomUUID();
      upsertIngestedChannel(db, { id, channel_id, niche, added_by: 'admin', notes });
      results.push({ channel_id, niche, ok: true });
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/intelligence/channels/:id
// Body: { ingest_enabled: true|false }
router.patch('/admin/intelligence/channels/:id', (req, res) => {
  try {
    const db = getDb();
    const { ingest_enabled } = req.body ?? {};
    if (ingest_enabled == null) return res.status(400).json({ error: 'ingest_enabled is required' });
    setChannelEnabled(db, req.params.id, ingest_enabled);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Ingest control ────────────────────────────────────────────────────────────

// POST /api/admin/intelligence/ingest/trigger
// Manually trigger a historical ingest cycle (quota-guarded).
router.post('/admin/intelligence/ingest/trigger', async (req, res) => {
  try {
    if (!quotaGuard.quotaAvailable()) {
      return res.status(429).json({ error: 'quota exhausted — try again after midnight Pacific' });
    }
    const result = await runHistoricalIngestCycle();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/snapshot/trigger
// Manually trigger a snapshot + pattern mining cycle.
router.post('/admin/intelligence/snapshot/trigger', async (req, res) => {
  try {
    if (!quotaGuard.quotaAvailable()) {
      return res.status(429).json({ error: 'quota exhausted — try again after midnight Pacific' });
    }
    const result = await runSnapshotCycle();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/patterns/recompute
// Recompute niche benchmarks from current snapshot data without refreshing stats.
router.post('/admin/intelligence/patterns/recompute', (req, res) => {
  try {
    const db     = getDb();
    const result = runPatternMining(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Status and inspection ─────────────────────────────────────────────────────

// GET /api/admin/intelligence/status
router.get('/admin/intelligence/status', (_req, res) => {
  try {
    const db    = getDb();
    const quota = quotaGuard.getStats();
    const channels = getAllIngestedChannels(db);
    res.json({
      quota,
      channels: {
        total:   channels.length,
        enabled: channels.filter(c => c.ingest_enabled).length,
        by_niche: Object.fromEntries(
          [...new Set(channels.map(c => c.niche))].map(n => [
            n,
            { total: channels.filter(c => c.niche === n).length, enabled: channels.filter(c => c.niche === n && c.ingest_enabled).length },
          ]),
        ),
      },
      videos: {
        ingested: getIngestedVideoCount(db),
      },
      snapshots: {
        by_bucket: getSnapshotCountByBucket(db),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/intelligence/patterns
// Returns all current niche benchmarks.
router.get('/admin/intelligence/patterns', (req, res) => {
  try {
    const db   = getDb();
    const { niche } = req.query;
    const rows = niche
      ? getNicheBenchmarksByNiche(db, niche)
      : getAllNicheBenchmarks(db);
    res.json({ benchmarks: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/intelligence/quota
router.get('/admin/intelligence/quota', (_req, res) => {
  res.json(quotaGuard.getStats());
});

module.exports = router;
