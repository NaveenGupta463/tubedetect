const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { getDb } = require('../db/init');
const { setNicheOverride, getChannelVideoTitles, saveChannelIdentity } = require('../db/queries');
const { classifyChannel, ALLOWED_NICHES } = require('../services/channelClassifier');

// ── Bulk re-detect job store ──────────────────────────────────────────────────
const bulkJobs = new Map();
const {
  getTopChannelsByNiche,
  getTopVideosByViews,
  getTopVideosByVelocity,
  getUploadFrequency,
  getFormatBreakdown,
} = require('../services/competitorQueries');
const {
  getTopTitlesByNiche,
  getBestPerformingDurations,
  getRisingFormats,
  getContentPatterns,
} = require('../services/contentStrategyQueries');
const {
  getAccelerationSpikes,
  getBreakoutVideos,
  getBenchmarkDrift,
  getRisingArchetypes,
} = require('../services/trendQueries');
const cache = require('../services/queryCache');

// ── Competitor Intelligence ────────────────────────────────────────────────────

router.get('/competitor/channels', (req, res) => {
  try {
    const db = getDb();
    const { niche, limit } = req.query;
    const rows = getTopChannelsByNiche(db, { niche, limit: limit ? parseInt(limit) : 20 });
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/competitor/top-videos', (req, res) => {
  try {
    const db = getDb();
    const { niche, duration, days, limit } = req.query;
    const rows = getTopVideosByViews(db, {
      niche,
      duration,
      days: days ? parseInt(days) : undefined,
      limit: limit ? parseInt(limit) : 50,
    });
    res.json({ videos: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/competitor/velocity', (req, res) => {
  try {
    const db = getDb();
    const { niche, duration, limit } = req.query;
    const rows = getTopVideosByVelocity(db, {
      niche,
      duration,
      limit: limit ? parseInt(limit) : 50,
    });
    res.json({ videos: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/competitor/upload-frequency', (req, res) => {
  try {
    const db = getDb();
    const rows = getUploadFrequency(db, req.query.niche);
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/competitor/format-breakdown', (req, res) => {
  try {
    const db = getDb();
    const rows = getFormatBreakdown(db, req.query.niche);
    res.json({ formats: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── What To Post ──────────────────────────────────────────────────────────────

router.get('/content/top-titles', (req, res) => {
  try {
    const db = getDb();
    const { niche, days, limit } = req.query;
    const rows = getTopTitlesByNiche(db, {
      niche,
      days: days ? parseInt(days) : 90,
      limit: limit ? parseInt(limit) : 30,
    });
    res.json({ titles: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/content/durations', (req, res) => {
  try {
    const db = getDb();
    const rows = getBestPerformingDurations(db, req.query.niche);
    res.json({ durations: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/content/rising-formats', (req, res) => {
  try {
    const db = getDb();
    const rows = getRisingFormats(db, req.query.niche);
    res.json({ formats: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/content/patterns', (req, res) => {
  try {
    const db = getDb();
    const rows = getContentPatterns(db, req.query.niche);
    res.json({ patterns: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Trend Detection ───────────────────────────────────────────────────────────

router.get('/trends/acceleration', (req, res) => {
  try {
    const db = getDb();
    const { niche, limit } = req.query;
    const rows = getAccelerationSpikes(db, { niche, limit: limit ? parseInt(limit) : 30 });
    res.json({ spikes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trends/breakout', (req, res) => {
  try {
    const db = getDb();
    const { niche, days, limit } = req.query;
    const rows = getBreakoutVideos(db, {
      niche,
      days: days ? parseInt(days) : 14,
      limit: limit ? parseInt(limit) : 20,
    });
    res.json({ videos: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trends/benchmark-drift', (req, res) => {
  try {
    const db = getDb();
    const rows = getBenchmarkDrift(db, req.query.niche);
    res.json({ history: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/trends/rising-archetypes', (req, res) => {
  try {
    const db = getDb();
    const rows = getRisingArchetypes(db, req.query.niche);
    res.json({ archetypes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── System Maturity Metrics ───────────────────────────────────────────────────

router.get('/maturity', (req, res) => {
  try {
    const db = getDb();

    const videos     = db.get(`SELECT COUNT(*) AS n FROM ingested_videos`)?.n ?? 0;
    const channels   = db.get(`SELECT COUNT(*) AS n FROM ingested_channels`)?.n ?? 0;
    const identified = db.get(`SELECT COUNT(*) AS n FROM ingested_channels WHERE identity_source IS NOT NULL`)?.n ?? 0;

    const snapRow    = db.get(`SELECT COUNT(*) AS total, COUNT(DISTINCT video_id) AS vids FROM video_growth_snapshots`);
    const avgSnaps   = snapRow?.vids > 0 ? parseFloat((snapRow.total / snapRow.vids).toFixed(1)) : 0;

    const oldestSnap = db.get(`SELECT MIN(snapshot_at) AS oldest FROM video_growth_snapshots`)?.oldest;
    const depthDays  = oldestSnap
      ? Math.floor((Date.now() - new Date(oldestSnap).getTime()) / 86400000)
      : 0;

    const benchmarkBuckets = db.get(`SELECT COUNT(*) AS n FROM niche_benchmarks`)?.n ?? 0;
    const niches           = db.get(`SELECT COUNT(DISTINCT niche) AS n FROM niche_benchmarks`)?.n ?? 0;

    const identityCoverage = channels > 0 ? Math.round(identified / channels * 100) : 0;

    // Phase readiness — derived from hard thresholds in the roadmap
    const semanticReadiness   = Math.min(100, Math.round(videos / 10000 * 60 + identityCoverage * 0.40));
    const embeddingReadiness  = Math.min(100, Math.round(videos / 50000 * 70 + depthDays / 90 * 30));
    const predictionReadiness = Math.min(100, Math.round(videos / 100000 * 50 + depthDays / 180 * 50));

    res.json({
      videos_ingested:        videos,
      channels_tracked:       channels,
      avg_snapshots_per_video: avgSnaps,
      historical_depth_days:  depthDays,
      niche_coverage:         niches,
      benchmark_buckets:      benchmarkBuckets,
      identity_coverage_pct:  identityCoverage,
      phase_readiness: {
        semantic_pct:    semanticReadiness,
        embedding_pct:   embeddingReadiness,
        prediction_pct:  predictionReadiness,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Manual niche override ─────────────────────────────────────────────────────

router.post('/channels/:id/niche', (req, res) => {
  try {
    const db    = getDb();
    const niche = req.body.niche;
    if (!ALLOWED_NICHES.includes(niche)) {
      return res.status(400).json({ error: `Invalid niche. Allowed: ${ALLOWED_NICHES.join(', ')}` });
    }
    setNicheOverride(db, req.params.id, niche);
    cache.invalidate('competitor:');
    cache.invalidate('content:');
    cache.invalidate('trends:');
    res.json({ ok: true, niche });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Re-detect identity ────────────────────────────────────────────────────────

router.post('/channels/:id/redetect', async (req, res) => {
  try {
    const db      = getDb();
    const channel = db.get('SELECT * FROM ingested_channels WHERE id = ?', [req.params.id]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const titles = getChannelVideoTitles(db, channel.channel_id, 40);
    if (!titles.length) return res.status(400).json({ error: 'No ingested video titles found for this channel' });

    const identity = await classifyChannel({ channelName: channel.channel_name, titles });

    // If a human override exists, don't overwrite the niche — preserve it
    const nicheToSave = channel.niche_override ?? identity.primary_niche;
    identity.primary_niche = nicheToSave;

    saveChannelIdentity(db, req.params.id, {
      ...identity,
      identity_source: channel.niche_override ? 'ai_redetect_niche_locked' : 'ai_redetect',
    });

    // Cascade niche to videos only if no human override is in place
    if (!channel.niche_override) {
      db.run('UPDATE ingested_channels SET niche = ? WHERE id = ?', [nicheToSave, req.params.id]);
      db.run(
        'UPDATE ingested_videos SET niche = ? WHERE channel_id = ?',
        [nicheToSave, channel.channel_id],
      );
    }

    cache.invalidate('competitor:');
    cache.invalidate('content:');
    cache.invalidate('trends:');

    res.json({ ok: true, identity: { ...identity, niche_override: channel.niche_override } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bulk re-detect all channels ───────────────────────────────────────────────

router.post('/channels/redetect-all', (req, res) => {
  // Only one job at a time
  for (const job of bulkJobs.values()) {
    if (job.status === 'running') {
      return res.json({ jobId: job.id, already_running: true });
    }
  }

  const newOnly  = req.query.new_only === 'true' || req.body?.new_only === true;
  const db       = getDb();
  const channels = newOnly
    ? db.all(`SELECT * FROM ingested_channels WHERE ingest_enabled = 1 AND (identity_last_detected_at IS NULL) ORDER BY added_at ASC`)
    : db.all(`SELECT * FROM ingested_channels WHERE ingest_enabled = 1 ORDER BY added_at ASC`);
  const jobId    = crypto.randomUUID();

  const job = {
    id:          jobId,
    status:      'running',
    total:       channels.length,
    done:        0,
    skipped:     0,
    errors:      0,
    current:     null,
    started_at:  new Date().toISOString(),
    finished_at: null,
  };
  bulkJobs.set(jobId, job);
  res.json({ jobId });

  setImmediate(async () => {
    const discardCounts = {};

    for (const channel of channels) {
      job.current = channel.channel_name || channel.channel_id;
      try {
        const titles = getChannelVideoTitles(db, channel.channel_id, 40);
        if (!titles.length) { job.skipped++; continue; }

        const identity     = await classifyChannel({ channelName: channel.channel_name, titles });
        const nicheToSave  = channel.niche_override ?? identity.primary_niche;
        identity.primary_niche = nicheToSave;

        (identity._discarded || []).forEach(v => { discardCounts[v] = (discardCounts[v] || 0) + 1; });

        saveChannelIdentity(db, channel.id, {
          ...identity,
          identity_source: channel.niche_override ? 'ai_redetect_niche_locked' : 'ai_redetect',
        });

        if (!channel.niche_override) {
          db.run('UPDATE ingested_channels SET niche = ? WHERE id = ?', [nicheToSave, channel.id]);
          db.run('UPDATE ingested_videos SET niche = ? WHERE channel_id = ?', [nicheToSave, channel.channel_id]);
        }
        job.done++;
      } catch (e) {
        console.error('[redetect-all] Error on', channel.channel_id, e.message);
        job.errors++;
      }
    }

    if (Object.keys(discardCounts).length > 0) {
      const sorted = Object.entries(discardCounts).sort((a, b) => b[1] - a[1]);
      console.log('\n[redetect-all] ── Discarded values summary ──────────────────');
      sorted.forEach(([val, count]) => console.log(`  ${count}x  ${val}`));
      console.log('[redetect-all] ─────────────────────────────────────────────\n');
    } else {
      console.log('[redetect-all] No values discarded — all fields matched allowed lists.');
    }

    job.status      = 'complete';
    job.current     = null;
    job.finished_at = new Date().toISOString();
    cache.invalidate('competitor:');
    cache.invalidate('content:');
    cache.invalidate('trends:');
    // Prune old jobs after 1 hour
    setTimeout(() => bulkJobs.delete(jobId), 3_600_000);
  });
});

router.get('/channels/redetect-all/:jobId', (req, res) => {
  const job = bulkJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ── Allowed niches list (for dropdowns) ───────────────────────────────────────

router.get('/allowed-niches', (_req, res) => {
  res.json({ niches: ALLOWED_NICHES });
});

// ── Niches list ───────────────────────────────────────────────────────────────

router.get('/niches', (req, res) => {
  try {
    const db = getDb();
    const rows = db.all(`SELECT DISTINCT niche FROM ingested_channels WHERE niche IS NOT NULL ORDER BY niche`);
    res.json({ niches: rows.map(r => r.niche) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
