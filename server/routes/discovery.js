const express = require('express');
const crypto  = require('crypto');
const { getDb } = require('../db/init');
const { enqueueDiscovery, getJob, getAllJobs } = require('../services/discoveryQueue');
const { upsertIngestedChannel, updateChannelNiche } = require('../db/queries');
const {
  getDiscoveredChannels,
  getDiscoveredChannelById,
  updateDiscoveredChannelStatus,
  bulkUpdateDiscoveredStatus,
  getDiscoveryStats,
} = require('../db/queries');

const router = express.Router();

function adminAuth(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return next();
  const provided = req.headers['x-admin-token'] ?? req.query.admin_token;
  if (provided !== token) return res.status(401).json({ error: 'unauthorized' });
  next();
}

router.use(adminAuth);

// POST /api/admin/discovery/run
// Body: { seed_input, topics? }
// Returns: { job_id }
router.post('/admin/discovery/run', (req, res) => {
  const { seed_input, topics } = req.body ?? {};
  if (!seed_input?.trim()) return res.status(400).json({ error: 'seed_input is required' });
  const jobId = enqueueDiscovery(seed_input.trim(), { topics });
  res.json({ ok: true, job_id: jobId });
});

// GET /api/admin/discovery/jobs/:id
router.get('/admin/discovery/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json(job);
});

// GET /api/admin/discovery/jobs
router.get('/admin/discovery/jobs', (_req, res) => {
  res.json({ jobs: getAllJobs().slice(0, 20) });
});

// GET /api/admin/discovery/candidates?status=pending&run_id=xxx
router.get('/admin/discovery/candidates', (req, res) => {
  try {
    const db   = getDb();
    const { status, run_id, limit, offset } = req.query;
    const rows = getDiscoveredChannels(db, {
      status:  status || null,
      run_id:  run_id || null,
      limit:   parseInt(limit || '200', 10),
      offset:  parseInt(offset || '0', 10),
    });
    const parsed = rows.map(r => ({
      ...r,
      inferred_topics: tryParse(r.inferred_topics, []),
      behavior_tags:   tryParse(r.behavior_tags,   []),
      titles_sample:   tryParse(r.titles_sample,   []),
    }));
    res.json({ candidates: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/discovery/candidates/:id
// Body: { status: 'approved' | 'rejected' | 'ignored' }
router.patch('/admin/discovery/candidates/:id', (req, res) => {
  try {
    const db     = getDb();
    const { status } = req.body ?? {};
    const allowed = ['approved', 'rejected', 'ignored', 'pending'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });

    updateDiscoveredChannelStatus(db, req.params.id, status);

    // If approved: add to ingested_channels and queue for historical ingest
    if (status === 'approved') {
      const candidate = getDiscoveredChannelById(db, req.params.id);
      if (candidate) {
        upsertIngestedChannel(db, {
          id:           crypto.randomUUID(),
          channel_id:   candidate.channel_id,
          channel_name: candidate.title,
          niche:        candidate.primary_niche ?? 'other',
          added_by:     'discovery',
          notes:        `Discovered from ${candidate.discovered_from_channel_id ?? 'unknown'} via ${candidate.discovery_source ?? 'unknown'}`,
        });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/discovery/candidates/bulk
// Body: { ids: [...], status: 'approved' | 'rejected' | 'ignored' }
router.post('/admin/discovery/candidates/bulk', (req, res) => {
  try {
    const db = getDb();
    const { ids, status } = req.body ?? {};
    const allowed = ['approved', 'rejected', 'ignored'];
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
    if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });

    bulkUpdateDiscoveredStatus(db, ids, status);

    if (status === 'approved') {
      for (const id of ids) {
        try {
          const candidate = getDiscoveredChannelById(db, id);
          if (candidate) {
            upsertIngestedChannel(db, {
              id:           crypto.randomUUID(),
              channel_id:   candidate.channel_id,
              channel_name: candidate.title,
              niche:        candidate.primary_niche ?? 'other',
              added_by:     'discovery',
              notes:        `Discovered from ${candidate.discovered_from_channel_id ?? 'unknown'} via ${candidate.discovery_source ?? 'unknown'}`,
            });
          }
        } catch (_) {}
      }
    }

    res.json({ ok: true, updated: ids.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/discovery/stats
router.get('/admin/discovery/stats', (_req, res) => {
  try {
    const db    = getDb();
    const stats = getDiscoveryStats(db);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function tryParse(val, fallback) {
  if (Array.isArray(val)) return val;
  try { return JSON.parse(val) ?? fallback; } catch { return fallback; }
}

module.exports = router;
