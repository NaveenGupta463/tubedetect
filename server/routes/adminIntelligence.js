const express = require('express');
const crypto  = require('crypto');
const { getDb }    = require('../db/init');
const quotaGuard   = require('../services/quotaGuard');
const { getApiKey, markExhausted, isQuotaError } = require('../services/apiKeyManager');
const {
  getAllIngestedChannels,
  upsertIngestedChannel,
  setChannelEnabled,
  deleteIngestedChannel,
  updateChannelNiche,
  updateChannelQuality,
  getIngestedVideoCount,
  getSnapshotCountByBucket,
  getAllNicheBenchmarks,
  getNicheBenchmarksByNiche,
  getChannelVideoTitles,
  getChannelIdentity,
  saveChannelIdentity,
} = require('../db/queries');
const { classifyChannel } = require('../services/channelClassifier');
const { runHistoricalIngestCycle } = require('../jobs/historicalIngest');
const { runFullBatchDetection }    = require('../jobs/languageDetectionJob');
const { runSnapshotCycle, runNeverRefreshedSnapshotCycle, isSnapshotRunning } = require('../jobs/snapshotCron');
const { runPatternMining }         = require('../services/patternMiner');
const { getLastRun }               = require('../services/jobState');
const { detectCommunities, summarizeCommunities } = require('../services/louvainClustering');

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

async function ytFetchAdmin(url) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const key = getApiKey();
    if (!key) throw new Error('all_api_keys_exhausted');
    const sep = url.includes('?') ? '&' : '?';
    const res  = await fetch(`${url}${sep}key=${key}`);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || String(res.status);
      if (isQuotaError(msg)) { markExhausted(key); continue; }
      throw new Error(msg);
    }
    return data;
  }
  throw new Error('all_api_keys_exhausted');
}

function parseChannelInput(raw) {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { type: 'channel_id', value: s };
  const channelMatch = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (channelMatch) return { type: 'channel_id', value: channelMatch[1] };
  const handleMatch = s.match(/(?:youtube\.com\/)?@([\w.-]+)/);
  if (handleMatch) return { type: 'handle', value: '@' + handleMatch[1] };
  const customMatch = s.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/);
  if (customMatch) return { type: 'handle', value: customMatch[1] };
  if (s.startsWith('@')) return { type: 'handle', value: s };
  return { type: 'handle', value: s };
}

async function resolveToChannelId(parsed) {
  if (parsed.type === 'channel_id') {
    return { channel_id: parsed.value, channel_name: null, resolved_via: 'direct' };
  }
  if (!getApiKey()) throw new Error('No API keys available — cannot resolve handles');

  const param = parsed.value.startsWith('@')
    ? `forHandle=${encodeURIComponent(parsed.value)}`
    : `forUsername=${encodeURIComponent(parsed.value)}`;

  const data = await ytFetchAdmin(`${YT_BASE}/channels?part=id,snippet&${param}`);
  const item = data.items?.[0];
  if (!item) throw new Error(`Channel not found: ${parsed.value}`);

  quotaGuard.recordUsage(1, 'ingest');
  return {
    channel_id:   item.id,
    channel_name: item.snippet?.title ?? null,
    resolved_via: 'api',
  };
}

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

// GET /api/admin/intelligence/classification-stats
// Returns accurate counts for the bulk-detect UI.
router.get('/admin/intelligence/classification-stats', (_req, res) => {
  try {
    const db = getDb();
    const r  = db.get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN identity_last_detected_at IS NULL THEN 1 ELSE 0 END) AS never_detected,
        SUM(CASE WHEN identity_last_detected_at IS NULL
              AND (EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id)
                OR EXISTS (SELECT 1 FROM corpus_videos  cv WHERE cv.channel_id = ic.channel_id))
             THEN 1 ELSE 0 END) AS classifiable_now,
        SUM(CASE WHEN identity_last_detected_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM ingested_videos iv WHERE iv.channel_id = ic.channel_id)
              AND NOT EXISTS (SELECT 1 FROM corpus_videos  cv WHERE cv.channel_id = ic.channel_id)
              AND ingest_enabled = 1
             THEN 1 ELSE 0 END) AS awaiting_ingest
      FROM ingested_channels ic
    `);
    res.json({ ok: true, ...r });
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

    // Try direct corpus match first, then niche majority fallback
    const corpusRow = db.get(
      `SELECT community_id FROM corpus_channels WHERE channel_id = ? AND community_id IS NOT NULL`,
      [channel_id],
    );
    let community_id = corpusRow?.community_id ?? null;
    if (!community_id && niche) {
      const majority = db.get(
        `SELECT community_id FROM corpus_channels
         WHERE niche = ? AND community_id IS NOT NULL
         GROUP BY community_id ORDER BY COUNT(*) DESC LIMIT 1`,
        [niche],
      );
      community_id = majority?.community_id ?? null;
    }

    const id = crypto.randomUUID();
    upsertIngestedChannel(db, { id, channel_id, niche, added_by: 'admin', notes, community_id });
    res.json({ ok: true, id, channel_id, niche, community_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels/resolve
// Resolves raw inputs (URLs, @handles, channel IDs) to canonical channel IDs.
// Body: { inputs: ["@Fireship", "https://youtube.com/@MrBeast", "UCxxx"] }
router.post('/admin/intelligence/channels/resolve', async (req, res) => {
  try {
    const { inputs } = req.body ?? {};
    if (!Array.isArray(inputs) || !inputs.length) {
      return res.status(400).json({ error: 'inputs array is required' });
    }
    const results = [];
    for (const raw of inputs) {
      const parsed = parseChannelInput(raw);
      if (!parsed) { results.push({ raw, ok: false, reason: 'empty input' }); continue; }
      try {
        const resolved = await resolveToChannelId(parsed);
        results.push({ raw, ok: true, ...resolved });
      } catch (e) {
        results.push({ raw, ok: false, reason: e.message });
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels/bulk
// Body: { channels: [{ raw, niche, notes? }] } — raw can be URL/@handle/channel_id
router.post('/admin/intelligence/channels/bulk', async (req, res) => {
  try {
    const db = getDb();
    const { channels } = req.body ?? {};
    if (!Array.isArray(channels) || !channels.length) {
      return res.status(400).json({ error: 'channels array is required' });
    }
    const results = [];
    for (const { raw, channel_id: directId, niche, notes } of channels) {
      const input  = raw ?? directId;
      const parsed = parseChannelInput(input);
      if (!parsed || !niche) {
        results.push({ raw: input, ok: false, reason: 'missing input or niche' });
        continue;
      }
      try {
        const resolved = await resolveToChannelId(parsed);
        const corpusRow = db.get(
          `SELECT community_id FROM corpus_channels WHERE channel_id = ? AND community_id IS NOT NULL`,
          [resolved.channel_id],
        );
        let community_id = corpusRow?.community_id ?? null;
        if (!community_id && niche) {
          const majority = db.get(
            `SELECT community_id FROM corpus_channels
             WHERE niche = ? AND community_id IS NOT NULL
             GROUP BY community_id ORDER BY COUNT(*) DESC LIMIT 1`,
            [niche],
          );
          community_id = majority?.community_id ?? null;
        }
        const id = crypto.randomUUID();
        upsertIngestedChannel(db, {
          id, channel_id: resolved.channel_id,
          channel_name: resolved.channel_name, niche, added_by: 'admin', notes, community_id,
        });
        results.push({ raw: input, channel_id: resolved.channel_id, niche, community_id, ok: true });
      } catch (e) {
        results.push({ raw: input, ok: false, reason: e.message });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/admin/intelligence/channels/:id
// Body: { ingest_enabled?, trust_score?, weight_multiplier?, ignore_from_benchmarks? }
router.patch('/admin/intelligence/channels/:id', (req, res) => {
  try {
    const db = getDb();
    const { ingest_enabled, trust_score, weight_multiplier, ignore_from_benchmarks, niche } = req.body ?? {};
    if (ingest_enabled != null) setChannelEnabled(db, req.params.id, ingest_enabled);
    if (niche?.trim()) updateChannelNiche(db, req.params.id, niche.trim());
    if (trust_score != null || weight_multiplier != null || ignore_from_benchmarks != null) {
      updateChannelQuality(db, req.params.id, { trust_score, weight_multiplier, ignore_from_benchmarks });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/intelligence/channels/:id
router.delete('/admin/intelligence/channels/:id', (req, res) => {
  try {
    const db = getDb();
    deleteIngestedChannel(db, req.params.id);
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
// Fires snapshot cycle in background and returns immediately.
router.post('/admin/intelligence/snapshot/trigger', (req, res) => {
  if (!quotaGuard.quotaAvailable()) {
    return res.status(429).json({ error: 'quota exhausted — try again after midnight Pacific' });
  }
  if (isSnapshotRunning()) {
    return res.status(409).json({ error: 'Snapshot already running', running: true });
  }
  setImmediate(async () => {
    try { await runSnapshotCycle(); }
    catch (e) { console.error('[snapshot] Manual trigger error:', e.message); }
  });
  res.json({ ok: true, started: true, message: 'Snapshot running in background — check server logs for progress' });
});

// POST /api/admin/intelligence/snapshot/trigger-recent
// Only processes videos where last_refreshed_at IS NULL (never been refreshed).
router.post('/admin/intelligence/snapshot/trigger-recent', (req, res) => {
  if (!quotaGuard.quotaAvailable()) {
    return res.status(429).json({ error: 'quota exhausted — try again after midnight Pacific' });
  }
  if (isSnapshotRunning()) {
    return res.status(409).json({ error: 'Snapshot already running', running: true });
  }
  setImmediate(async () => {
    try { await runNeverRefreshedSnapshotCycle(); }
    catch (e) { console.error('[snapshot] Never-refreshed trigger error:', e.message); }
  });
  res.json({ ok: true, started: true, message: 'Never-refreshed snapshot running — check server logs' });
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

// POST /api/admin/intelligence/calibrate/trigger
// Trigger auto-calibration from observational + prediction signals.
router.post('/admin/intelligence/calibrate/trigger', async (req, res) => {
  try {
    const token    = process.env.ADMIN_TOKEN;
    const provided = token ? (req.headers['x-admin-token'] ?? req.query.admin_token) : token;
    const headers  = { 'Content-Type': 'application/json', ...(provided ? { 'x-admin-token': provided } : {}) };
    const baseUrl  = `http://localhost:${process.env.PORT || 3002}`;
    const r        = await fetch(`${baseUrl}/api/admin/learning/auto-calibrate`, { method: 'POST', headers });
    const data     = await r.json();
    res.status(r.status).json(data);
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
      job_last_run: {
        historical_ingest:  getLastRun('historical_ingest')?.toISOString()  ?? null,
        snapshot_refresh:   getLastRun('snapshot_refresh')?.toISOString()   ?? null,
        recompute_patterns: getLastRun('recompute_patterns')?.toISOString() ?? null,
        auto_calibrate:     getLastRun('auto_calibrate')?.toISOString()     ?? null,
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

// POST /api/admin/intelligence/channels/:id/detect-identity
// Uses OpenAI gpt-4.1-mini to classify the channel from its ingested video titles.
router.post('/admin/intelligence/channels/:id/detect-identity', async (req, res) => {
  try {
    const db      = getDb();
    const channel = getChannelIdentity(db, req.params.id);
    if (!channel) return res.status(404).json({ error: 'channel not found' });

    let titles = getChannelVideoTitles(db, channel.channel_id, 50);

    if (titles.length === 0) {
      const key = getYtKey();
      if (!key) return res.status(400).json({ error: 'No ingested videos and YT_API_KEY not set — cannot fetch titles' });
      const url  = `${YT_BASE}/search?part=snippet&channelId=${encodeURIComponent(channel.channel_id)}&maxResults=25&order=date&type=video&key=${key}`;
      const r    = await fetch(url);
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'YouTube API error' });
      titles = (data.items ?? []).map(i => i.snippet?.title).filter(Boolean);
      quotaGuard.recordUsage(100, 'ingest');
    }

    if (titles.length === 0) return res.status(400).json({ error: 'No titles found for this channel' });

    const descRow    = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel.channel_id]);
    const description = (() => { try { const j = JSON.parse(descRow?.raw_json || '{}'); const d = j.snippet?.description; return (d && d.trim().length > 10) ? d.trim() : null; } catch (_) { return null; } })();
    const result     = await classifyChannel({ channelName: channel.channel_name, titles, description });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function extractIdentityBody(body) {
  const {
    primary_niche, secondary_niche, behavior_tags, format_type, audience_style,
    identity_confidence, identity_reasoning, identity_strength,
    inferred_topics, content_archetype,
  } = body ?? {};

  const toArr = v => Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);

  return {
    primary_niche,
    secondary_niche:           secondary_niche ?? null,
    behavior_tags:             toArr(behavior_tags),
    format_type:               format_type ?? null,
    audience_style:            audience_style ?? null,
    identity_confidence:       identity_confidence ?? null,
    identity_reasoning:        identity_reasoning ?? null,
    identity_last_detected_at: new Date().toISOString(),
    identity_strength:         identity_strength ?? null,
    inferred_topics:           toArr(inferred_topics),
    content_archetype:         content_archetype ?? null,
  };
}

// POST /api/admin/intelligence/channels/:id/save-identity
// Persists identity metadata. Silently syncs primary_niche → niche column.
router.post('/admin/intelligence/channels/:id/save-identity', (req, res) => {
  try {
    const db = getDb();
    const fields = extractIdentityBody(req.body);
    if (!fields.primary_niche) return res.status(400).json({ error: 'primary_niche is required' });
    saveChannelIdentity(db, req.params.id, { ...fields, identity_source: 'ai_detected' });
    updateChannelNiche(db, req.params.id, fields.primary_niche);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels/:id/save-identity-manual
// Operator manually overrides identity. Sets identity_source = 'operator_modified'.
router.post('/admin/intelligence/channels/:id/save-identity-manual', (req, res) => {
  try {
    const db = getDb();
    const fields = extractIdentityBody(req.body);
    if (!fields.primary_niche) return res.status(400).json({ error: 'primary_niche is required' });
    saveChannelIdentity(db, req.params.id, { ...fields, identity_source: 'operator_modified' });
    updateChannelNiche(db, req.params.id, fields.primary_niche);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/intelligence/channels/bulk-detect-identity
// Auto-detects and saves niche + identity for all channels where identity_last_detected_at IS NULL.
// Skips channels that have already been auto-detected. Sequential to avoid rate-limiting.
router.post('/admin/intelligence/channels/bulk-detect-identity', async (req, res) => {
  try {
    const db       = getDb();
    const all      = getAllIngestedChannels(db);
    const pending  = all.filter(ch => !ch.identity_last_detected_at);

    if (!pending.length) {
      return res.json({ ok: true, detected: 0, failed: 0, errors: [], message: 'All channels already detected.' });
    }

    let detected = 0;
    const errors = [];

    for (const ch of pending) {
      try {
        const titles = getChannelVideoTitles(db, ch.channel_id, 50);

        // Never call YouTube API in bulk — only use locally ingested titles.
        // Channels with no local titles haven't been ingested yet; skip them.
        if (!titles.length) { errors.push({ channel_id: ch.channel_id, channel_name: ch.channel_name, reason: 'no ingested titles yet — run ingest first' }); continue; }

        const descRowBulk   = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [ch.channel_id]);
        const descBulk      = (() => { try { const j = JSON.parse(descRowBulk?.raw_json || '{}'); const d = j.snippet?.description; return (d && d.trim().length > 10) ? d.trim() : null; } catch (_) { return null; } })();
        const result        = await classifyChannel({ channelName: ch.channel_name, titles, description: descBulk });
        saveChannelIdentity(db, ch.id, {
          ...result,
          identity_last_detected_at: new Date().toISOString(),
          identity_source: 'ai_detected',
        });
        if (result.primary_niche) updateChannelNiche(db, ch.id, result.primary_niche);
        detected++;
      } catch (e) {
        errors.push({ channel_id: ch.channel_id, channel_name: ch.channel_name, reason: e.message });
      }
    }

    res.json({ ok: true, detected, failed: errors.length, total_pending: pending.length, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/intelligence/channels/auto-promoted
// Returns all ingested_channels added via corpus auto-promotion.
router.get('/admin/intelligence/channels/auto-promoted', (req, res) => {
  try {
    const db = getDb();
    const rows = db.all(
      `SELECT * FROM ingested_channels WHERE added_by = 'auto_promote' ORDER BY added_at DESC`,
    );
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Community viewer ──────────────────────────────────────────────────────────
router.get('/admin/intelligence/communities', adminAuth, (req, res) => {
  try {
    const db = getDb();

    const assigned = db.all(`
      SELECT channel_id, title, niche, subscriber_count, community_id
      FROM corpus_channels
      WHERE community_id IS NOT NULL
      ORDER BY subscriber_count DESC
    `);

    if (assigned.length === 0) {
      return res.json({ ok: true, total_communities: 0, total_assigned: 0, communities: [] });
    }

    // Aggregate per community in JS
    const commMap = new Map();
    for (const ch of assigned) {
      if (!commMap.has(ch.community_id)) {
        commMap.set(ch.community_id, { size: 0, niches: new Map(), top_channels: [] });
      }
      const c = commMap.get(ch.community_id);
      c.size++;
      if (ch.niche) c.niches.set(ch.niche, (c.niches.get(ch.niche) || 0) + 1);
      if (c.top_channels.length < 5) c.top_channels.push({ title: ch.title, subscriber_count: ch.subscriber_count, niche: ch.niche });
    }

    const communities = Array.from(commMap.entries())
      .map(([id, { size, niches, top_channels }]) => {
        const sorted = [...niches.entries()].sort((a, b) => b[1] - a[1]);
        return {
          community_id: id,
          size,
          top_niche:    sorted[0]?.[0] ?? 'unknown',
          niches:       Object.fromEntries(sorted),
          top_channels,
        };
      })
      .sort((a, b) => b.size - a.size);

    res.json({ ok: true, total_communities: communities.length, total_assigned: assigned.length, communities });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Louvain community detection ───────────────────────────────────────────────
router.post('/admin/intelligence/louvain/run', adminAuth, async (req, res) => {
  try {
    const db    = getDb();
    const start = Date.now();

    // Load all channels (nodes)
    const channels = db.all('SELECT channel_id, niche FROM corpus_channels');
    const nodeIds  = channels.map(c => c.channel_id);
    const nicheMap = new Map(channels.map(c => [c.channel_id, c.niche]));

    // Load all edges — use edge_strength as weight (falls back to confidence then 1.0)
    const edges = db.all(`
      SELECT source_channel_id AS source,
             target_channel_id AS target,
             COALESCE(edge_strength, confidence, 1.0) AS weight
      FROM corpus_discovery_graph
    `);

    console.log(`[louvain] Running on ${nodeIds.length} nodes, ${edges.length} edges`);

    // Run algorithm (synchronous, ~1-5s for 5K nodes)
    const assignments = detectCommunities(nodeIds, edges);
    const summary     = summarizeCommunities(assignments, nicheMap);
    const elapsed     = Date.now() - start;

    // Write community_id back to corpus_channels in one transaction
    db.run('BEGIN');
    try {
      for (const [channelId, commId] of assignments) {
        db.run('UPDATE corpus_channels SET community_id = ? WHERE channel_id = ?', [commId, channelId]);
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }

    console.log(`[louvain] Done — ${summary.length} communities in ${elapsed}ms`);
    res.json({
      ok:           true,
      channels:     nodeIds.length,
      edges:        edges.length,
      communities:  summary.length,
      duration_ms:  elapsed,
      top_communities: summary.slice(0, 20),
    });
  } catch (e) {
    console.error('[louvain] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/admin/intelligence/community/backfill
// Step 1: copy community_id from corpus_channels WHERE channel_id matches ingested_channels
// Step 2: for ingested_channels still NULL, assign most common community_id for their niche
router.post('/admin/intelligence/community/backfill', (req, res) => {
  try {
    const db = getDb();

    // Step 1: direct corpus match
    db.run(`
      UPDATE ingested_channels
      SET community_id = (
        SELECT corpus_channels.community_id
        FROM corpus_channels
        WHERE corpus_channels.channel_id = ingested_channels.channel_id
          AND corpus_channels.community_id IS NOT NULL
      )
      WHERE community_id IS NULL
    `);

    const afterDirect = db.get(`SELECT COUNT(*) AS n FROM ingested_channels WHERE community_id IS NULL`);

    // Step 2: niche majority fallback for channels not in corpus
    // Build niche → most common community_id map from corpus_channels
    const nicheMajority = db.all(`
      SELECT niche, community_id, COUNT(*) AS cnt
      FROM corpus_channels
      WHERE community_id IS NOT NULL AND niche IS NOT NULL
      GROUP BY niche, community_id
      ORDER BY niche, cnt DESC
    `);

    const nicheTop = new Map();
    for (const row of nicheMajority) {
      if (!nicheTop.has(row.niche)) nicheTop.set(row.niche, row.community_id);
    }

    let fallbackAssigned = 0;
    const unassigned = db.all(`
      SELECT channel_id, niche FROM ingested_channels WHERE community_id IS NULL
    `);
    db.run('BEGIN');
    try {
      for (const ch of unassigned) {
        const commId = nicheTop.get(ch.niche);
        if (commId) {
          db.run(
            `UPDATE ingested_channels SET community_id = ? WHERE channel_id = ?`,
            [commId, ch.channel_id],
          );
          fallbackAssigned++;
        }
      }
      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }

    const afterFallback = db.get(`SELECT COUNT(*) AS n FROM ingested_channels WHERE community_id IS NULL`);
    const total         = db.get(`SELECT COUNT(*) AS n FROM ingested_channels`);
    const assigned      = db.get(`SELECT COUNT(*) AS n FROM ingested_channels WHERE community_id IS NOT NULL`);

    res.json({
      ok:               true,
      total_channels:   total.n,
      assigned:         assigned.n,
      still_unassigned: afterFallback.n,
      direct_from_corpus: total.n - afterFallback.n - fallbackAssigned,
      fallback_assigned: fallbackAssigned,
    });
  } catch (e) {
    console.error('[community-backfill] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/admin/intelligence/country-detect/trigger
// Run country detection on ALL untagged channels in one background pass.
// Fast-path channels (snippet.country, bio, script, Hinglish) resolve instantly.
// API-bound channels (comment analysis) are paced at 100ms each.
router.post('/admin/intelligence/country-detect/trigger', (req, res) => {
  const db    = getDb();
  const total = db.get(
    `SELECT COUNT(*) AS cnt FROM ingested_channels WHERE ingest_enabled = 1 AND region IS NULL`,
  )?.cnt || 0;

  setImmediate(async () => {
    try { await runFullBatchDetection(); }
    catch (e) { console.error('[country-detect] Full batch error:', e.message); }
  });

  res.json({
    ok:      true,
    queued:  total,
    message: `Country detection batch started for ${total} untagged channels — runs in background, check server logs`,
  });
});

module.exports = router;
