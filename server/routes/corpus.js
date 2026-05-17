'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb }              = require('../db/init');
const {
  getCorpusStats,
  getAllCorpusChannels,
  getCorpusChannel,
  syncIngestedToCorpus,
  upsertCorpusChannel,
  promoteCorpusChannelTraining,
  demoteCorpusChannelTraining,
  upsertDiscoveryEdge,
} = require('../db/corpusQueries');
const { evaluateChannelQuality }  = require('../services/qualityAgent');
const { promoteToTrainingCorpus } = require('../services/trainingAgent');
const { runCorpusCycle, getSchedulerStatus, getRunHistory } = require('../services/corpusScheduler');

function adminOnly(req, res, next) {
  const envToken = process.env.ADMIN_TOKEN;
  if (!envToken) return next();
  const provided = req.headers['x-admin-token'] || req.query.admin_token;
  if (provided !== envToken) return res.status(403).json({ error: 'forbidden' });
  next();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

router.get('/corpus/stats', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const stats = getCorpusStats(db);
    res.json({ ok: true, stats });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Channel list ──────────────────────────────────────────────────────────────

router.get('/corpus/channels', adminOnly, (req, res) => {
  try {
    const db      = getDb();
    const limit   = Math.min(parseInt(req.query.limit  ?? '100', 10), 500);
    const offset  = parseInt(req.query.offset ?? '0', 10);
    const niche   = req.query.niche ?? null;
    const eligible = req.query.training_eligible != null
      ? req.query.training_eligible === '1' || req.query.training_eligible === 'true'
      : undefined;
    const minQuality = req.query.min_quality != null
      ? parseInt(req.query.min_quality, 10)
      : undefined;

    const channels = getAllCorpusChannels(db, { limit, offset, niche, training_eligible: eligible, min_quality: minQuality });
    res.json({ ok: true, count: channels.length, channels });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Quality distribution ──────────────────────────────────────────────────────

router.get('/corpus/quality-distribution', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const buckets = db.all(`
      SELECT
        CASE
          WHEN quality_score IS NULL  THEN 'unscored'
          WHEN quality_score < 20     THEN '0-19'
          WHEN quality_score < 40     THEN '20-39'
          WHEN quality_score < 60     THEN '40-59'
          WHEN quality_score < 80     THEN '60-79'
          ELSE '80-100'
        END AS bucket,
        COUNT(*) AS n,
        SUM(training_eligible) AS training_eligible
      FROM corpus_channels
      GROUP BY bucket
      ORDER BY bucket
    `);
    res.json({ ok: true, distribution: buckets });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Training set ──────────────────────────────────────────────────────────────

router.get('/corpus/training-set', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const niche = req.query.niche ?? null;
    const limit = Math.min(parseInt(req.query.limit ?? '500', 10), 2000);
    const channels = getAllCorpusChannels(db, { training_eligible: true, niche, limit });
    res.json({ ok: true, count: channels.length, channels });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Discovery graph ───────────────────────────────────────────────────────────

router.get('/corpus/discovery-graph', adminOnly, (req, res) => {
  try {
    const db    = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 1000);
    const edges = db.all(
      `SELECT source_channel_id, target_channel_id, relationship_type, confidence, discovered_via, created_at
       FROM corpus_discovery_graph ORDER BY discovered_at DESC LIMIT ?`,
      [limit],
    );
    res.json({ ok: true, count: edges.length, edges });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Single channel quality evaluation ────────────────────────────────────────

router.post('/corpus/evaluate-channel/:id', adminOnly, (req, res) => {
  try {
    const db      = getDb();
    const channel = getCorpusChannel(db, req.params.id);
    if (!channel) return res.status(404).json({ ok: false, error: 'channel_not_found' });
    const result  = evaluateChannelQuality(db, channel);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Promote channel to training corpus ───────────────────────────────────────

router.post('/corpus/promote/:id', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = promoteToTrainingCorpus(db, req.params.id);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Force-promote (bypass quality gate) ──────────────────────────────────────

router.post('/corpus/force-promote/:id', adminOnly, (req, res) => {
  try {
    const db = getDb();
    promoteCorpusChannelTraining(db, req.params.id);
    res.json({ ok: true, channel_id: req.params.id, promoted: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Demote channel from training corpus ──────────────────────────────────────

router.post('/corpus/demote/:id', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const reason = req.body?.reason ?? 'admin_manual';
    demoteCorpusChannelTraining(db, req.params.id);
    res.json({ ok: true, channel_id: req.params.id, demoted: true, reason });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Sync ingested_channels → corpus_channels (one-time migration) ─────────────

router.post('/corpus/sync-from-ingested', adminOnly, (req, res) => {
  try {
    const db     = getDb();
    const result = syncIngestedToCorpus(db);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Scheduler status ──────────────────────────────────────────────────────────

router.get('/corpus/scheduler/status', adminOnly, (req, res) => {
  try {
    const limit   = Math.min(parseInt(req.query.history ?? '10', 10), 50);
    const history = getRunHistory(limit);
    res.json({ ok: true, ...getSchedulerStatus(), history });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Manual scheduler trigger ──────────────────────────────────────────────────

router.post('/corpus/scheduler/run', adminOnly, async (req, res) => {
  try {
    const b = req.body ?? {};
    const allowSearch            = b.allow_search             === true;
    const allowAIDiscovery       = b.allow_ai_discovery       === true;
    const allowCulturalExpansion = b.allow_cultural_expansion === true;
    const allowHindiSearch       = b.allow_hindi_search       === true;
    const allowTamilSearch       = b.allow_tamil_search       === true;
    const allowTeluguSearch      = b.allow_telugu_search      === true;
    const allowBengaliSearch     = b.allow_bengali_search     === true;
    const allowKannadaSearch     = b.allow_kannada_search     === true;
    const allowMalayalamSearch   = b.allow_malayalam_search   === true;
    const allowSpanishSearch     = b.allow_spanish_search     === true;
    const allowPortugueseSearch  = b.allow_portuguese_search  === true;
    const allowIndonesianSearch  = b.allow_indonesian_search  === true;
    const allowArabicSearch      = b.allow_arabic_search      === true;
    const allowPunjabiSearch     = b.allow_punjabi_search     === true;
    const allowVideoSearch       = b.allow_video_search       === true;
    const quotaBudget = b.quota_budget
      ? Math.min(4000, Math.max(100, parseInt(b.quota_budget, 10)))
      : undefined;
    const mode = ['discover', 'promote', 'full'].includes(b.mode) ? b.mode : 'full';
    const result = await runCorpusCycle({
      allowSearch, allowAIDiscovery, allowCulturalExpansion,
      allowHindiSearch, allowTamilSearch, allowTeluguSearch,
      allowBengaliSearch, allowKannadaSearch, allowMalayalamSearch,
      allowSpanishSearch, allowPortugueseSearch, allowIndonesianSearch,
      allowArabicSearch, allowPunjabiSearch, allowVideoSearch,
      quotaBudget, mode,
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Niche gap report ──────────────────────────────────────────────────────────

router.get('/corpus/niche-gaps', adminOnly, (req, res) => {
  try {
    const db   = getDb();
    const gaps = db.all(`
      SELECT niche,
             COUNT(*)                        AS total,
             SUM(training_eligible)          AS training_eligible,
             ROUND(AVG(quality_score), 1)    AS avg_quality,
             ROUND(AVG(subscriber_count), 0) AS avg_subs
      FROM corpus_channels
      WHERE niche IS NOT NULL
      GROUP BY niche
      ORDER BY training_eligible ASC, total ASC
    `);
    res.json({ ok: true, niches: gaps });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Embedding queue status ────────────────────────────────────────────────────

router.get('/corpus/embedding-queue', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const summary = db.all(`
      SELECT status, entity_type, COUNT(*) AS n
      FROM corpus_embeddings_queue
      GROUP BY status, entity_type
      ORDER BY status, entity_type
    `);
    const oldest = db.get(`SELECT created_at FROM corpus_embeddings_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`);
    res.json({ ok: true, summary, oldest_pending: oldest?.created_at ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Build niche-proximity edges (zero quota) ──────────────────────────────────

router.post('/corpus/build-niche-edges', adminOnly, (req, res) => {
  try {
    const db       = getDb();
    const before   = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;
    const channels = db.all(`
      SELECT channel_id, niche, subscriber_count FROM corpus_channels
      WHERE niche IS NOT NULL AND niche != 'other'
        AND subscriber_count IS NOT NULL AND subscriber_count > 0
      ORDER BY niche, subscriber_count
    `);

    const byNiche = {};
    for (const ch of channels) (byNiche[ch.niche] = byNiche[ch.niche] || []).push(ch);

    const NEIGHBOURS = 8;
    const half       = Math.ceil(NEIGHBOURS / 2);
    const edges      = [];

    for (const members of Object.values(byNiche)) {
      for (let i = 0; i < members.length; i++) {
        const subs  = members[i].subscriber_count;
        const start = Math.max(0, i - half);
        const end   = Math.min(members.length - 1, i + half);
        let count   = 0;
        for (let j = start; j <= end && count < NEIGHBOURS; j++) {
          if (j === i) continue;
          const logRatio   = Math.abs(Math.log10((subs + 1) / (members[j].subscriber_count + 1)));
          const confidence = parseFloat(Math.max(0.2, 0.65 - logRatio * 0.1).toFixed(2));
          edges.push({ src: members[i].channel_id, tgt: members[j].channel_id, confidence });
          count++;
        }
      }
    }

    // Batch all writes in a single transaction — critical for DELETE journal mode on Windows
    db.run('BEGIN');
    try {
      for (const e of edges) {
        upsertDiscoveryEdge(db, {
          source_channel_id: e.src,
          target_channel_id: e.tgt,
          relationship_type: 'niche_size_peer',
          confidence:        e.confidence,
          discovered_via:    'niche_proximity_miner',
        });
      }
      db.run('COMMIT');
    } catch (inner) {
      db.run('ROLLBACK');
      throw inner;
    }

    const after = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph').n;
    res.json({ ok: true, written: edges.length, before, after, net_new: after - before, niches: Object.keys(byNiche).length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Corpus composition dashboard ─────────────────────────────────────────────

router.get('/corpus/composition', adminOnly, (req, res) => {
  try {
    const db = getDb();

    const summary = db.get(`
      SELECT
        COUNT(*) AS total_channels,
        SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) AS training_eligible,
        SUM(CASE WHEN is_spam = 1 THEN 1 ELSE 0 END) AS spam_count,
        SUM(CASE WHEN quality_score IS NULL THEN 1 ELSE 0 END) AS unscored,
        SUM(CASE WHEN last_ingested_at IS NOT NULL THEN 1 ELSE 0 END) AS ingested,
        ROUND(AVG(CASE WHEN quality_score IS NOT NULL THEN quality_score END), 1) AS avg_quality
      FROM corpus_channels
    `);

    const videoCount = db.get('SELECT COUNT(*) AS n FROM corpus_videos');
    const graphEdges = db.get('SELECT COUNT(*) AS n FROM corpus_discovery_graph');

    const languages = db.all(`
      SELECT
        COALESCE(yt_default_language, JSON_EXTRACT(language_profile, '$.primary'), 'unknown') AS lang,
        COUNT(*) AS total,
        SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) AS eligible,
        ROUND(AVG(quality_score), 1) AS avg_quality
      FROM corpus_channels
      GROUP BY lang
      ORDER BY total DESC
      LIMIT 25
    `);

    const niches = db.all(`
      SELECT niche,
        COUNT(*) AS total,
        SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) AS eligible,
        ROUND(AVG(quality_score), 1) AS avg_quality
      FROM corpus_channels
      WHERE niche IS NOT NULL
      GROUP BY niche ORDER BY total DESC
    `);

    const qualityDist = db.all(`
      SELECT
        CASE WHEN quality_score IS NULL THEN 'unscored'
             WHEN quality_score < 20    THEN '0-19'
             WHEN quality_score < 40    THEN '20-39'
             WHEN quality_score < 60    THEN '40-59'
             WHEN quality_score < 80    THEN '60-79'
             ELSE '80-100' END AS bucket,
        COUNT(*) AS n,
        SUM(CASE WHEN training_eligible = 1 THEN 1 ELSE 0 END) AS eligible
      FROM corpus_channels GROUP BY bucket ORDER BY bucket
    `);

    const growth = db.all(`
      SELECT DATE(created_at) AS day, COUNT(*) AS new_channels
      FROM corpus_channels
      WHERE created_at >= DATE('now', '-30 days') AND created_at IS NOT NULL
      GROUP BY day ORDER BY day
    `);

    res.json({
      ok: true,
      summary: { ...summary, video_count: videoCount?.n ?? 0, graph_edges: graphEdges?.n ?? 0 },
      languages,
      niches,
      qualityDist,
      growth,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Seen-channel capture (fires on every user channel search) ─────────────────
// POST /api/corpus/seen-channel
// Body: raw YouTube API channel object from the frontend.
// Saves to corpus_channels so it gets evaluated + clustered on next runs.
// Returns community_id immediately if the channel is already in corpus.
router.post('/corpus/seen-channel', (req, res) => {
  try {
    const db  = getDb();
    const raw = req.body ?? {};

    const channel_id          = raw.id;
    const title               = raw.snippet?.title ?? null;
    const handle              = raw.snippet?.customUrl ?? null;
    const thumbnail_url       = raw.snippet?.thumbnails?.medium?.url ?? raw.snippet?.thumbnails?.default?.url ?? null;
    const uploads_playlist_id = raw.contentDetails?.relatedPlaylists?.uploads ?? null;
    const subscriber_count    = parseInt(raw.statistics?.subscriberCount ?? '0', 10);
    const total_views         = parseInt(raw.statistics?.viewCount ?? '0', 10);
    const video_count         = parseInt(raw.statistics?.videoCount ?? '0', 10);
    const yt_default_language = raw.snippet?.defaultLanguage ?? raw.snippet?.defaultAudioLanguage ?? null;
    const yt_country          = raw.snippet?.country ?? null;
    const yt_topic_ids        = raw.topicDetails?.topicCategories
      ? JSON.stringify(raw.topicDetails.topicCategories)
      : null;

    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id missing' });

    // Check if already in corpus (may already have community_id)
    const existing = db.get(
      'SELECT community_id, niche, quality_score FROM corpus_channels WHERE channel_id = ?',
      [channel_id],
    );

    upsertCorpusChannel(db, {
      channel_id, title, handle, thumbnail_url, uploads_playlist_id,
      subscriber_count, total_views, video_count,
      yt_default_language, yt_country, yt_topic_ids,
      discovery_source: existing ? 'user_search_refresh' : 'user_search',
      language: yt_default_language ?? 'unknown',
      country:  yt_country ?? null,
    });

    let community_id = existing?.community_id ?? null;

    // If no community yet, infer from niche majority
    if (!community_id && existing?.niche) {
      const majority = db.get(
        `SELECT community_id FROM corpus_channels
         WHERE niche = ? AND community_id IS NOT NULL
         GROUP BY community_id ORDER BY COUNT(*) DESC LIMIT 1`,
        [existing.niche],
      );
      community_id = majority?.community_id ?? null;
    }

    res.json({ ok: true, channel_id, is_new: !existing, community_id });
  } catch (e) {
    console.error('[seen-channel]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Community inference (real-time, no save) ──────────────────────────────────
// GET /api/intel/community/infer?niche=fitness&subscribers=420000&language=hi
// Returns the best-matching community for a channel we haven't seen before.
router.get('/intel/community/infer', (req, res) => {
  try {
    const db          = getDb();
    const niche       = req.query.niche?.trim();
    const subscribers = parseInt(req.query.subscribers ?? '0', 10);
    const language    = req.query.language?.split('-')[0]?.toLowerCase() ?? null;

    if (!niche) return res.status(400).json({ ok: false, error: 'niche required' });

    // Subscriber range: ±1 order of magnitude (0.2x – 5x)
    const lo = Math.max(0, Math.floor(subscribers * 0.2));
    const hi = Math.ceil(subscribers * 5);

    // 3-signal match: niche + subscriber range + language (language optional)
    let row = null;
    if (language && language !== 'en') {
      row = db.get(
        `SELECT community_id, COUNT(*) AS n
         FROM corpus_channels
         WHERE niche = ?
           AND subscriber_count BETWEEN ? AND ?
           AND (yt_default_language LIKE ? OR language LIKE ?)
           AND community_id IS NOT NULL
         GROUP BY community_id ORDER BY n DESC LIMIT 1`,
        [niche, lo, hi, `${language}%`, `${language}%`],
      );
    }

    // Fallback 1: niche + subscriber range (ignore language)
    if (!row) {
      row = db.get(
        `SELECT community_id, COUNT(*) AS n
         FROM corpus_channels
         WHERE niche = ? AND subscriber_count BETWEEN ? AND ?
           AND community_id IS NOT NULL
         GROUP BY community_id ORDER BY n DESC LIMIT 1`,
        [niche, lo, hi],
      );
    }

    // Fallback 2: niche only
    if (!row) {
      row = db.get(
        `SELECT community_id, COUNT(*) AS n
         FROM corpus_channels
         WHERE niche = ? AND community_id IS NOT NULL
         GROUP BY community_id ORDER BY n DESC LIMIT 1`,
        [niche],
      );
    }

    if (!row) return res.json({ ok: true, community_id: null, reason: 'no_match' });

    // Peer stats for the matched community
    const peers = db.get(
      `SELECT COUNT(*) AS size,
              AVG(subscriber_count) AS avg_subscribers,
              MAX(subscriber_count) AS max_subscribers,
              MIN(subscriber_count) AS min_subscribers
       FROM corpus_channels
       WHERE community_id = ?`,
      [row.community_id],
    );

    const topNiche = db.get(
      `SELECT niche, COUNT(*) AS n FROM corpus_channels
       WHERE community_id = ? AND niche IS NOT NULL
       GROUP BY niche ORDER BY n DESC LIMIT 1`,
      [row.community_id],
    );

    res.json({
      ok:           true,
      community_id: row.community_id,
      peer_count:   peers?.size ?? 0,
      top_niche:    topNiche?.niche ?? niche,
      avg_subscribers:  Math.round(peers?.avg_subscribers ?? 0),
      max_subscribers:  peers?.max_subscribers ?? 0,
      min_subscribers:  peers?.min_subscribers ?? 0,
    });
  } catch (e) {
    console.error('[community-infer]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
