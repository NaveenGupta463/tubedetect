const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { getDb } = require('../db/init');
const { setNicheOverride, getChannelVideoTitles, saveChannelIdentity, getChannelsByTopicOverlap, getChannelTopics } = require('../db/queries');
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
const {
  detectChannelCountry,
  detectScript,
  hinglishScore,
} = require('../jobs/languageDetectionJob');

// ── Debug endpoint ────────────────────────────────────────────────────────────
router.get('/debug-country', async (req, res) => {
  try {
    const country = await detectChannelCountry(req.query.channel_id);
    res.json({ channel_id: req.query.channel_id, country });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Competitor channels ────────────────────────────────────────────────────────
//
// Primary filter: COUNTRY (stored in ingested_channels.region).
// Detection order: DB cache → channel_cache API data → corpus data →
//                  non-Latin titles → Hinglish titles → comment analysis.
// Result stored permanently so the API call is one-time per channel.

router.get('/competitor/channels', async (req, res) => {
  try {
    const db = getDb();
    const { niche, limit, community_id, channel_id } = req.query;
    const limitN = limit ? parseInt(limit) : 20;

    let rows = getTopChannelsByNiche(db, { niche, community_id, limit: 100 });
    if (!rows.length) return res.json({ channels: [] });

    // Exclude the target channel from its own competitor list
    if (channel_id) rows = rows.filter(r => r.channel_id !== channel_id);

    const ids = rows.map(r => r.channel_id);
    const ph  = ids.map(() => '?').join(',');

    // Bulk fetch stored country (region column) for all candidates
    const regionRows = db.all(
      `SELECT channel_id, region FROM ingested_channels WHERE channel_id IN (${ph})`,
      ids,
    );
    const regionMap = {};
    for (const { channel_id: cid, region } of regionRows) regionMap[cid] = region || null;

    // Detect target channel's country — DB cache first, then full detection (one-time cost)
    let targetCountry = channel_id ? (regionMap[channel_id] || null) : null;
    if (!targetCountry && channel_id) {
      targetCountry = await detectChannelCountry(channel_id);
      if (targetCountry) regionMap[channel_id] = targetCountry;
    }

    // Still null (freshly onboarded channel, no videos, no snippet.country) —
    // check their bio for Indian signals. No Indian signal → default to EN.
    // This prevents English creators from being shown Indian peers because
    // the else branch is designed for non-English creators.
    if (!targetCountry && channel_id) {
      const cacheRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel_id]);
      let hasIndianBio = false;
      if (cacheRow?.raw_json) {
        try {
          const parsed = JSON.parse(cacheRow.raw_json);
          const desc = parsed?.snippet?.description || '';
          hasIndianBio = detectScript(desc) !== null || hinglishScore(desc) > 0;
        } catch (_) {}
      }
      if (!hasIndianBio) targetCountry = 'EN';
    }

    console.log(`[competitor/channels] channel_id=${channel_id} country=${targetCountry} (${rows.length} candidates)`);

    const EN_REGIONS_SET = new Set(['EN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE']);
    const targetIsEnglish = targetCountry && EN_REGIONS_SET.has(targetCountry);

    // Bulk fetch titles for untagged competitors AND for EN-tagged ones when target is
    // English — so we can do a secondary Indian-signal check on soft EN tags.
    const needTitlesIds = rows.filter(r => {
      const country = regionMap[r.channel_id];
      if (!country) return true;
      if (targetIsEnglish && country === 'EN') return true;
      // Fetch titles for IN competitors when target is also IN — needed for regional language detection
      if (!targetIsEnglish && targetCountry === 'IN' && country === 'IN') return true;
      return false;
    }).map(r => r.channel_id);

    const titleMap = {};
    if (needTitlesIds.length > 0) {
      const uph = needTitlesIds.map(() => '?').join(',');
      // ROW_NUMBER() OVER PARTITION BY guarantees each channel gets its 20 most
      // recent titles regardless of how many other channels are in the IN list.
      const titleRows = db.all(
        `SELECT channel_id, title FROM (
           SELECT channel_id, title,
                  ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
           FROM ingested_videos
           WHERE channel_id IN (${uph}) AND title IS NOT NULL
         ) WHERE rn <= 20`,
        needTitlesIds,
      );
      for (const { channel_id: cid, title } of titleRows)
        (titleMap[cid] = titleMap[cid] || []).push(title);
    }

    function hasIndianSignal(channelId) {
      const titles = titleMap[channelId] || [];
      for (const t of titles) if (detectScript(t)) return true;
      return titles.some(t => hinglishScore(t) > 0);
    }

    function looksEnglish(channelRow) {
      const titles = titleMap[channelRow.channel_id] || [];
      if (!titles.length) return false;
      for (const t of titles) if (detectScript(t)) return false;
      const hasHinglish = titles.some(t => hinglishScore(t) > 0);
      return !hasHinglish;
    }

    if (targetCountry) {
      rows = rows.filter(ch => {
        const country = regionMap[ch.channel_id];

        if (country) {
          // EN-tagged competitor + English-speaking target: secondary Indian-signal check.
          // Catches channels tagged EN before South Indian scripts were added to the detector.
          if (targetIsEnglish && country === 'EN') {
            return !hasIndianSignal(ch.channel_id);
          }
          // English target also accepts other EN_REGIONS (US, GB, AU, etc.)
          if (targetIsEnglish && EN_REGIONS_SET.has(country)) return true;
          if (country !== targetCountry) return false;
          // Same country (IN) — exclude if competitor uses a different regional Indian language
          if (country === 'IN') {
            const REGIONAL_LANG_RE = /\b(tamil|telugu|kannada|malayalam|marathi|punjabi|gujarati|odia|bengali|assamese|bhojpuri)\b/i;
            const SOUTH_SCRIPT_RE  = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/; // Tamil, Telugu, Kannada, Malayalam scripts
            if (REGIONAL_LANG_RE.test(ch.channel_name)) return false;
            const titles = titleMap[ch.channel_id] || [];
            if (titles.some(t => SOUTH_SCRIPT_RE.test(t))) return false;
          }
          return true;
        }

        // Non-Latin script in any title → a specific non-English country
        const titles = titleMap[ch.channel_id] || [];
        for (const t of titles) {
          const c = detectScript(t);
          if (c) return c === targetCountry;
        }

        // Any Latin-only titles with zero Hinglish → clearly English-speaking
        if (titles.length > 0) {
          const hasHinglish = titles.some(t => hinglishScore(t) > 0);
          if (!hasHinglish) return targetIsEnglish;
        }

        // Zero titles — background job will tag later, keep for now
        return true;
      }).slice(0, limitN);

      console.log(`[competitor/channels] filtered → ${rows.length} channels (country=${targetCountry})`);
    } else {
      // Target country unknown — exclude channels that are clearly English-speaking
      // so we don't flood a non-English creator with US/UK channels
      rows = rows
        .filter(ch => {
          const country = regionMap[ch.channel_id];
          if (country === 'EN') return false;       // tagged English → exclude
          if (looksEnglish(ch)) return false;       // title heuristic English → exclude
          return true;
        })
        .slice(0, limitN);
      console.log(`[competitor/channels] target country unknown — defensive filter → ${rows.length} channels`);
    }

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

// ── Shared helper: fetch channel description from cached YouTube API response ──

function getChannelDescription(db, channel_id) {
  try {
    const row = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel_id]);
    if (!row?.raw_json) return null;
    const j = JSON.parse(row.raw_json);
    const desc = j.snippet?.description;
    return (desc && desc.trim().length > 10) ? desc.trim() : null;
  } catch (_) { return null; }
}

// ── Re-detect identity ────────────────────────────────────────────────────────

router.post('/channels/:id/redetect', async (req, res) => {
  try {
    const db      = getDb();
    const channel = db.get('SELECT * FROM ingested_channels WHERE id = ?', [req.params.id]);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const titles      = getChannelVideoTitles(db, channel.channel_id, 40);
    if (!titles.length) return res.status(400).json({ error: 'No ingested video titles found for this channel' });

    const description = getChannelDescription(db, channel.channel_id);
    const identity    = await classifyChannel({ channelName: channel.channel_name, titles, description });

    // If a human override exists, don't overwrite the niche — preserve it
    const nicheToSave = channel.niche_override ?? identity.primary_niche;
    identity.primary_niche = nicheToSave;

    saveChannelIdentity(db, channel.channel_id, {
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

  const newOnly      = req.query.new_only === 'true' || req.body?.new_only === true;
  const targetNiches = req.query.target_niches || req.body?.target_niches || null;
  const db           = getDb();

  let channels;
  if (targetNiches) {
    // Re-detect only channels in specific niches (comma-separated).
    // Combine with never-classified filter to minimize API cost.
    const niches = targetNiches.split(',').map(n => n.trim()).filter(Boolean);
    const ph     = niches.map(() => '?').join(',');
    channels     = db.all(
      `SELECT * FROM ingested_channels WHERE ingest_enabled = 1 AND niche IN (${ph}) AND identity_confidence IS NULL ORDER BY added_at ASC`,
      niches,
    );
  } else if (newOnly) {
    channels = db.all(`SELECT * FROM ingested_channels WHERE ingest_enabled = 1 AND (identity_last_detected_at IS NULL) ORDER BY added_at ASC`);
  } else {
    channels = db.all(`SELECT * FROM ingested_channels WHERE ingest_enabled = 1 ORDER BY added_at ASC`);
  }
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

        const description  = getChannelDescription(db, channel.channel_id);
        const identity     = await classifyChannel({ channelName: channel.channel_name, titles, description });
        const nicheToSave  = channel.niche_override ?? identity.primary_niche;
        identity.primary_niche = nicheToSave;

        (identity._discarded || []).forEach(v => { discardCounts[v] = (discardCounts[v] || 0) + 1; });

        saveChannelIdentity(db, channel.channel_id, {
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

// ── Region-aware filtering ────────────────────────────────────────────────────
// Channels with confirmed region='IN' are excluded from English/Western creator pools
// and vice-versa. Channels with NULL region are included in both pools (ambiguous).

const EN_REGIONS = new Set(['EN', 'US', 'GB', 'AU', 'CA', 'NZ', 'IE']);

function getRegionClause(userRegion) {
  if (userRegion === 'IN') return "AND (region = 'IN' OR region IS NULL)";
  if (userRegion && EN_REGIONS.has(userRegion))
    return "AND (region IN ('EN','US','GB','AU','CA','NZ','IE') OR region IS NULL)";
  return ''; // unknown region → no filter
}

// Stricter variant — excludes NULL-region channels. Used for adjacent ideas where the
// batch has already run; undetected NULLs are mostly non-English Latin-script channels.
function getStrictRegionClause(userRegion) {
  if (userRegion === 'IN') return "AND (region = 'IN' OR region IS NULL)";
  if (userRegion && EN_REGIONS.has(userRegion))
    return "AND region IN ('EN','US','GB','AU','CA','NZ','IE')";
  return '';
}

function isIndianRegion(r)  { return r === 'IN'; }
function isEnglishRegion(r) { return r && EN_REGIONS.has(r); }

// ── Adjacent niche map + foreign signal config ────────────────────────────────

const ADJACENCY_MAP = {
  politics:      ['news', 'geopolitics', 'philosophy', 'education'],
  geopolitics:   ['politics', 'defence', 'news', 'history'],
  defence:       ['geopolitics', 'politics', 'science', 'technology'],
  news:          ['politics', 'geopolitics', 'business', 'sports'],
  finance:       ['business', 'education', 'news'],
  business:      ['finance', 'technology', 'education'],
  technology:    ['science', 'business', 'gaming'],
  science:       ['technology', 'education', 'health'],
  education:     ['science', 'philosophy', 'technology'],
  philosophy:    ['education', 'politics', 'science'],
  health:        ['fitness', 'science', 'food'],
  fitness:       ['health', 'sports', 'yoga'],
  sports:        ['fitness', 'news', 'gaming'],
  food:          ['health', 'travel', 'lifestyle'],
  travel:        ['lifestyle', 'food', 'entertainment'],
  lifestyle:     ['beauty', 'food', 'travel'],
  beauty:        ['lifestyle', 'health'],
  yoga:          ['fitness', 'health', 'meditation'],
  meditation:    ['yoga', 'health', 'philosophy'],
  gaming:        ['technology', 'entertainment', 'sports'],
  entertainment: ['comedy', 'gaming', 'lifestyle'],
  comedy:        ['entertainment', 'lifestyle'],
  music:         ['entertainment', 'lifestyle'],
  other:         [],
};

// ── Niche clusters ─────────────────────────────────────────────────────────────
// Groups of niches that are the same creative space and same audience.
// Peer resolution always combines the full cluster — not just when the pool is thin.
// Different from ADJACENCY_MAP (which is "related but distinct").
// Rule: a creator in any niche of the cluster would naturally make content in the others.
const NICHE_CLUSTERS = {
  // Self-improvement space — all same audience, same content intent
  'selfimprovement':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivation':         ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal development': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'personal growth':    ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'leadership lessons': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'motivational speaking': ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],
  'mindset':            ['selfimprovement', 'motivation', 'personal development', 'personal growth', 'leadership lessons', 'motivational speaking', 'mindset'],

  // Finance space — personal finance and investing are the same audience as finance
  'finance':            ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'personal finance':   ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'investing':          ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'stock market':       ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],
  'cryptocurrency':     ['finance', 'personal finance', 'investing', 'stock market', 'cryptocurrency'],

  // Gym/athletic fitness — strength, muscle, workout performance. Does NOT include
  // yoga or sleep-wellness; those serve different audiences and produce different topics.
  'fitness':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building', 'calisthenics', 'powerlifting', 'weightlifting', 'home workouts', 'gym workouts', 'gym motivation', 'workout routines', 'bodybuilding workouts', 'bodybuilding tips'],
  'workout':            ['fitness', 'workout', 'bodybuilding', 'strength training', 'home workouts', 'gym workouts', 'workout routines'],
  'bodybuilding':       ['fitness', 'bodybuilding', 'workout', 'strength training', 'muscle building', 'powerlifting'],
  'strength training':  ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],
  'muscle building':    ['fitness', 'workout', 'bodybuilding', 'strength training', 'muscle building'],

  // Yoga — distinct content space: flexibility, movement, asanas. Separate from gym fitness.
  'yoga':               ['yoga', 'somatic yoga', 'yin yoga', 'vinyasa yoga', 'yoga practice', 'yoga poses', 'yoga routines', 'yoga therapy', 'yoga for weight loss', 'yoga exercises', 'yoga challenges', 'somatic movement', 'somatic healing', 'partner yoga', 'power yoga', 'daily yoga practice', 'pranayama techniques', 'yoga asanas'],

  // Health/wellness — medical, nutrition, general wellbeing. Not gym performance.
  'health':             ['health', 'nutrition', 'wellness', 'holistic health', 'natural remedies', 'ayurvedic medicine', 'health tips', 'healthy habits', 'healthy eating', 'gut health', 'heart health', 'nutrition tips', 'healthy recipes', 'longevity', 'anti-aging', 'men\'s health'],

  // Meditation/mindfulness/sleep — restfulness, inner calm, sleep content.
  'meditation':         ['meditation', 'guided meditation', 'mindfulness', 'mindfulness meditation', 'sleep meditation', 'guided sleep meditation', 'somatic meditation', 'breathwork techniques', 'chakra healing', 'christian meditation', 'emdr music', 'deep sleep', 'insomnia relief'],

  // Business/entrepreneurship — same audience across these
  'business':           ['business', 'entrepreneurship', 'startup'],
  'entrepreneurship':   ['business', 'entrepreneurship', 'startup'],
  'startup':            ['business', 'entrepreneurship', 'startup'],

  // News/current affairs
  'news':               ['news', 'current affairs', 'breaking news'],
  'current affairs':    ['news', 'current affairs', 'breaking news'],

  // Vlog space — all "life content" for the same casual audience
  'lifestyle':          ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily vlogs':        ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'daily life vlogs':   ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'personal vlogs':     ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],
  'vlog':               ['lifestyle', 'daily vlogs', 'daily life vlogs', 'personal vlogs', 'vlog'],

  // Family content
  'family vlogs':       ['family vlogs', 'family life'],
  'family life':        ['family vlogs', 'family life'],

  // Food content
  'food':               ['food', 'street food', 'cooking'],
  'street food':        ['food', 'street food', 'cooking'],
  'cooking':            ['food', 'street food', 'cooking'],

  // Travel
  'travel':             ['travel', 'travel vlogs'],
  'travel vlogs':       ['travel', 'travel vlogs'],

  // Comedy/entertainment
  'comedy':             ['comedy', 'entertainment', 'comedy sketches'],
  'comedy sketches':    ['comedy', 'entertainment', 'comedy sketches'],
  'entertainment':      ['comedy', 'entertainment', 'comedy sketches'],
};

function getNicheCluster(niche, secondaryNiche) {
  const set = new Set();
  const primary = (niche || '').toLowerCase();
  const secondary = (secondaryNiche || '').toLowerCase();
  const cluster = NICHE_CLUSTERS[primary] || [primary];
  cluster.forEach(n => set.add(n));
  if (secondary) {
    const secondCluster = NICHE_CLUSTERS[secondary] || [secondary];
    secondCluster.forEach(n => set.add(n));
  }
  return [...set];
}

// Niches where foreign (US/UK/AU) topic trends are genuinely relevant to non-English audiences.
// Geo-bound niches (news, politics, sports) are excluded — their topics don't travel.
const UNIVERSAL_NICHES = new Set([
  'technology', 'science', 'finance', 'business', 'education',
  'health', 'fitness', 'philosophy', 'gaming', 'yoga', 'meditation',
  'geopolitics', 'defence',
]);

const FOREIGN_REGIONS = ['US', 'GB', 'AU', 'CA'];

// ── Shared phrase analysis engine ─────────────────────────────────────────────
// Runs the same bigram/trigram extraction + scoring used by /what-to-post,
// but on any caller-supplied set of channel IDs. Callers supply userPhraseSet
// so already-covered topics are filtered out before scoring.

function analyzeTopics(db, channelIds, userPhraseSet, userSubs, communitySize, opts = {}) {
  const { maxResults = 10, minChannels = 2 } = opts;
  if (!channelIds.length) return [];

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const ph    = channelIds.map(() => '?').join(',');

  const videos = db.all(
    `SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
            iv.published_at, iv.duration_seconds, ic.channel_name
     FROM ingested_videos iv
     LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
     WHERE iv.channel_id IN (${ph})
       AND iv.published_at >= ?
       AND iv.title IS NOT NULL
       AND iv.views > 0
     ORDER BY iv.views DESC LIMIT 400`,
    [...channelIds, since],
  );
  if (!videos.length) return [];

  const videoIds = videos.map(v => v.youtube_video_id);
  const snapMap  = new Map();
  if (videoIds.length > 0) {
    const vph = videoIds.map(() => '?').join(',');
    db.all(
      `SELECT video_id, bucket, views, subscriber_adjusted_velocity AS sav
       FROM video_growth_snapshots
       WHERE video_id IN (${vph}) AND bucket IN ('7d', '30d')`,
      videoIds,
    ).forEach(s => {
      if (!snapMap.has(s.video_id)) snapMap.set(s.video_id, {});
      const e = snapMap.get(s.video_id);
      if (s.bucket === '7d')  e.v7  = s.views;
      if (s.bucket === '30d') { e.v30 = s.views; e.sav30 = s.sav; }
    });
  }

  const topicMap = new Map();
  const nowMs    = Date.now();

  for (const video of videos) {
    const phrases     = extractPhrases(video.title);
    const seenThisVid = new Set();
    const ageDays     = (nowMs - new Date(video.published_at).getTime()) / 86400000;
    const dur         = video.duration_seconds || 0;
    const fmtKey      = dur < 60 ? 'shorts' : dur < 300 ? 'quick' : dur < 900 ? 'mid' : 'long';
    const snap        = snapMap.get(video.youtube_video_id);

    for (const phrase of phrases) {
      if (seenThisVid.has(phrase)) continue;
      seenThisVid.add(phrase);
      if (!topicMap.has(phrase)) {
        topicMap.set(phrase, {
          videos: [], totalViews: 0, channels: new Set(),
          cnt_0_14: 0, cnt_15_30: 0, cnt_31_60: 0, cnt_61_90: 0,
          formats: {
            shorts: { count: 0, totalViews: 0 }, quick: { count: 0, totalViews: 0 },
            mid:    { count: 0, totalViews: 0 }, long:  { count: 0, totalViews: 0 },
          },
          vel_pairs: [], sav30_sum: 0, sav30_cnt: 0,
        });
      }
      const b = topicMap.get(phrase);
      if (b.videos.length < 5) b.videos.push(video);
      b.totalViews += (video.views || 0);
      b.channels.add(video.channel_id);
      if (ageDays <= 14)      b.cnt_0_14++;
      else if (ageDays <= 30) b.cnt_15_30++;
      else if (ageDays <= 60) b.cnt_31_60++;
      else                    b.cnt_61_90++;
      b.formats[fmtKey].count++;
      b.formats[fmtKey].totalViews += (video.views || 0);
      if (snap?.v7 && snap?.v30 && snap.v7 > 0) b.vel_pairs.push({ v7: snap.v7, v30: snap.v30 });
      if (snap?.sav30 != null) { b.sav30_sum += snap.sav30; b.sav30_cnt++; }
    }
  }

  const TREND_SCORE = { rising: 20, peaking: 10, evergreen: 8, fading: -15, dormant: -30 };
  const VEL_SCORE   = { fast: 12, growing: 5, peaked: -5 };
  const gaps = [];

  for (const [phrase, b] of topicMap.entries()) {
    if (b.channels.size < minChannels) continue;
    if (b.videos.length < 2)           continue;
    if (userPhraseSet.has(phrase))     continue;

    const avgViews        = b.totalViews / b.videos.length;
    const totalVidCount   = b.cnt_0_14 + b.cnt_15_30 + b.cnt_31_60 + b.cnt_61_90;
    const saturation_pct  = Math.round(b.channels.size / (communitySize || channelIds.length) * 100);
    const saturation_level= saturation_pct < 20 ? 'low' : saturation_pct < 60 ? 'medium' : 'high';
    const trend_status    = classifyTrend(b);
    const format_winner   = getFormatWinner(b.formats, totalVidCount);
    const velocity        = getVelocity(b.vel_pairs);

    let expected_low = null, expected_high = null;
    if (userSubs > 0 && b.sav30_cnt >= 2) {
      const avgSav  = b.sav30_sum / b.sav30_cnt;
      const baseExp = Math.round((userSubs / 1000) * avgSav * 720);
      expected_low  = Math.round(baseExp * 0.6);
      expected_high = Math.round(baseExp * 1.4);
    }

    const base_views  = Math.min(35, Math.log10(avgViews + 1) / 7 * 35);
    const spread      = Math.min(20, b.channels.size / 10 * 20);
    const trend_bonus = TREND_SCORE[trend_status] || 0;
    const vel_bonus   = velocity ? (VEL_SCORE[velocity.status] || 0) : 0;
    const sat_penalty = saturation_pct > 60 ? -(saturation_pct - 60) / 2 : 0;
    const gap_bonus   = saturation_pct < 20 && b.channels.size >= 2 ? 10 : 0;
    const score       = Math.max(1, Math.min(99, Math.round(base_views + spread + trend_bonus + vel_bonus + sat_penalty + gap_bonus)));

    gaps.push({
      topic:             phrase.replace(/\b\w/g, c => c.toUpperCase()),
      score,
      channel_count:     b.channels.size,
      avg_views:         Math.round(avgViews),
      trend_status,
      saturation_pct,
      saturation_level,
      format_winner,
      velocity,
      act_now:           trend_status === 'rising' && saturation_pct < 30,
      expected_low,
      expected_high,
      examples:          b.videos.slice(0, 3).map(v => ({
        title: v.title, views: v.views, channel_name: v.channel_name || 'Unknown',
      })),
    });
  }

  gaps.sort((a, b) => b.score - a.score);

  const deduped   = [];
  const usedWords = new Set();
  for (const gap of gaps) {
    const words   = gap.topic.toLowerCase().split(' ');
    const overlap = words.filter(w => usedWords.has(w)).length;
    if (overlap >= words.length - 1) continue;
    words.forEach(w => usedWords.add(w));
    deduped.push(gap);
    if (deduped.length >= maxResults) break;
  }
  return deduped;
}

// helper: build userPhraseSet from a channel's own videos
function buildUserPhraseSet(db, channel_id) {
  const set = new Set();
  if (!channel_id) return set;
  db.all(
    `SELECT title FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 200`,
    [channel_id],
  ).forEach(v => extractPhrases(v.title).forEach(p => set.add(p)));
  return set;
}

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

// ── What to Post ──────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a','an','the','in','on','of','for','to','and','or','is','are','was','were',
  'be','been','how','why','when','what','which','this','that','these','those',
  'my','your','his','her','our','its','with','by','at','from','will','can',
  'did','do','does','has','have','had','get','got','not','no','all','but',
  'so','if','as','up','out','now','just','only','also','even','than','then',
  'new','top','best','review','video','part','full','episode',
  // Pronouns missing from original set
  'you','he','she','they','we','it','me','him','them','us',
  // Modal verbs — never stand alone as topics
  'must','should','could','would','may','might','shall',
  // Imperative/hook fragments — "year old", "hello namaskar", "mind blowing"
  'old','hello','namaskar','namaste','blowing','doing','tells','about',
  // Month names — filter date phrases like "april 2026"
  'january','february','march','april','may','june','july','august',
  'september','october','november','december',
  // Romanised Hindi function words
  'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
  'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
  'bhi','toh','koi','kuch','sirf','sab','tha','thi','the','raha','rahi',
  'karo','karna','karte','karke','rehe','rahe','gaye','gaya','gaye',
  // Devanagari Hindi function words / verb fragments (not content topics)
  'रहे','हैं','है','हो','ने','भी','जो','तो','बहुत','कभी','सकते','करते',
  'आज','कल','यहां','वहां','इसे','उसे','हमें','आपको','उनका','इनका',
  'बनाए','जाते','करेंगे','होगा','मिलेगा','देगा','लेगा','बताया',
  // Marathi function words / verb fragments
  'करू','नका','आहे','आणि','हे','ते','मी','तू','तुम्ही','आम्ही','त्यांना',
  'करणे','केले','केली','करतो','करती','असेल','नाही','पण','किंवा','म्हणजे',
  // Hindi question/negation words
  'क्यों','नहीं','क्या','कैसे','कौन','कहाँ','कब',
  'देगी','देनी','छोड़ो','बनाओ','करोगे',
  'marathi','hindi',
  // Indonesian / Malay noise words (from unclassified channels in the pool)
  'kata','ibu','doa','untuk','bijak','mutiara','kekuatan',
  // Common hashtag-driven social words (not content topics)
  'love','like','life','time','come','know','feel','want','need',
  // Platform mechanics — not content topics
  'shorts','viral','trending','ytshorts','minivlog','youtubeshorts',
  'viralvideo','shortsfeed','ashortaday','shortvideo','reels','tiktok',
  'subscribe','comment','share','follow','notification','bell','click',
  'trend','trendy','explore','fyp','foryou','foryoupage',
]);

// Phrases that slip through word-level filtering but are hooks, not topics.
// "year old" spans "6 year old" / "35 year old" — completely different contexts.
const HOOK_PHRASES = new Set([
  'year old','years old',
  'you must','must do','must watch','must know',
  'no one','one tells',
  'mind blowing','mind blown',
  'about money','about life','about this',
  'hello namaskar','hello namaste',
  'real reason','real talk',
  'stop doing','stop this',
]);

const SOUTH_SCRIPT_RE  = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;
const DEVANAGARI_RE    = /[ऀ-ॿ]/;

function extractPhrases(title) {
  if (!title) return [];
  if (SOUTH_SCRIPT_RE.test(title)) return [];
  const tokens = title
    .replace(/#\w+/g, ' ')                        // strip hashtag compounds: #studymotivation
    .replace(/\|{2}[^|]+\|{2}/g, ' ')            // strip credit patterns: ||Prashant Kirad||
    .toLowerCase()
    .replace(/[|()[\]{}#@!?,।॥।\-''']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d{4}$/.test(w) && !DEVANAGARI_RE.test(w));

  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    if (!HOOK_PHRASES.has(bigram)) phrases.push(bigram);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return phrases;
}

function _fmtV(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Trend classifier ──────────────────────────────────────────────────────────
// Compares video density across four 90-day time windows to determine
// whether the community is accelerating into this topic or past it.

function classifyTrend(b) {
  const d0 = b.cnt_0_14  / 14;
  const d1 = b.cnt_15_30 / 16;
  const d2 = b.cnt_31_60 / 30;
  const d3 = b.cnt_61_90 / 30;

  if (d0 > 0 && d0 >= d1 * 1.8)                          return 'rising';

  const vals = [d0, d1, d2, d3];
  const mean = vals.reduce((s, v) => s + v, 0) / 4;
  if (mean > 0.02 && Math.max(...vals.map(v => Math.abs(v - mean))) / (mean || 1) < 0.6)
    return 'evergreen';

  if (d0 > 0 && d0 >= d1 * 0.5)                          return 'peaking';
  if (d3 > 0 && d0 < d3 * 0.4)                           return 'fading';
  return 'dormant';
}

const FORMAT_LABELS = { shorts: 'Shorts', quick: '1–5 min', mid: '8–15 min', long: '15+ min' };

function getFormatWinner(formats, totalVids) {
  if (totalVids < 3) return null;
  let best = null, bestAvg = 0;
  for (const [key, f] of Object.entries(formats)) {
    if (f.count > 0) {
      const avg = f.totalViews / f.count;
      if (avg > bestAvg) { bestAvg = avg; best = key; }
    }
  }
  if (!best) return null;
  return {
    key:       best,
    label:     FORMAT_LABELS[best],
    pct:       Math.round(formats[best].count / totalVids * 100),
    avg_views: Math.round(bestAvg),
  };
}

function getVelocity(pairs) {
  if (pairs.length < 2) return null;
  const avg = pairs.reduce((s, p) => s + p.v30 / p.v7, 0) / pairs.length;
  return {
    status: avg >= 3 ? 'fast' : avg >= 1.5 ? 'growing' : 'peaked',
    ratio:  parseFloat(avg.toFixed(1)),
  };
}

function buildWhyText(b, trend, avgViews, rec_type) {
  const base = `${b.channels.size} channels averaged ${_fmtV(Math.round(avgViews))} views on this.`;
  let trendLine;
  if (trend === 'rising')         trendLine = 'Trend is accelerating in your community right now.';
  else if (trend === 'evergreen') trendLine = 'Consistently performs — no peak, no crash.';
  else if (trend === 'peaking')   trendLine = 'At its peak — move quickly for maximum reach.';
  else if (trend === 'fading')    trendLine = 'Past its peak. A fresh angle could revive it.';
  else                            trendLine = 'Low recent activity — early mover advantage possible.';

  if (rec_type === 'long_form_opportunity') {
    return `${base} ${trendLine} This is a recurring theme in your community — ideal for a documentary, historical explainer, or deep-dive analysis. Covering it as long-form positions you as an authority rather than a breaking-news relay.`;
  }
  if (rec_type === 'context_gap') {
    return `${base} ${trendLine} The destination or occasion is the prompt — your voice, perspective, and experience make it entirely yours.`;
  }
  return `${base} ${trendLine}`;
}

// ── Niche → recommendation category ──────────────────────────────────────────
//   A = Topic Gap    — topic itself is safe to suggest (public knowledge)
//   B = Style Signal — creative IP; suggest format/emotion, not specific topics
//   C = Context Gap  — destination/occasion is generic; creator's angle is theirs

const NICHE_CATEGORY = {
  technology: 'A', business: 'A', education: 'A', science: 'A',
  finance: 'A',    news: 'A',     politics: 'A',  sports: 'A',
  health: 'A',     fitness: 'A',  philosophy: 'A', other: 'A',
  geopolitics: 'A', defence: 'A', selfimprovement: 'A',
  food: 'C',       travel: 'C',   lifestyle: 'C', beauty: 'C',
  yoga: 'C',       meditation: 'C', gaming: 'C',  entertainment: 'C',
  comedy: 'B',     music: 'B',
};

// Archetypes that override niche and force Category A regardless
const ARCHETYPE_FORCE_A = new Set([
  'authority_educator', 'analyst', 'commentator',
  'debater', 'investigative_creator', 'reviewer',
]);

// Behavior tags that hard-signal creative IP → Category B
const BEHAVIOR_FORCE_B = new Set([
  'music_video', 'audio_release', 'lyric_video',
  'performance', 'sketch', 'character_driven',
]);

// Behavior tags that hard-signal public knowledge → Category A
const BEHAVIOR_FORCE_A = new Set([
  'analytical', 'educational', 'comparison', 'review_based',
  'case_study', 'deep_dive', 'explainer', 'news_reaction', 'commentary',
]);

function getNicheCategory(niche, archetype, behaviorTags) {
  const tags = Array.isArray(behaviorTags) ? behaviorTags : [];
  if (ARCHETYPE_FORCE_A.has(archetype))           return 'A';
  if (archetype === 'entertainer')                return 'B';
  if (tags.some(t => BEHAVIOR_FORCE_B.has(t)))   return 'B';
  if (tags.some(t => BEHAVIOR_FORCE_A.has(t)))   return 'A';
  return NICHE_CATEGORY[niche] || 'A';
}

// ── Peer resolution ladder ────────────────────────────────────────────────────
// Used by both /community-hot and /what-to-post.
// Three levels — topic, shared-topics, niche cluster. Archetype/format (style)
// is intentionally excluded: it matches content style, not content space, and
// pulls in vloggers/entertainers who share a format but not an audience.
function resolvePeers(db, channel, { exclude_channel_id, minSize = 20, limit = 200 } = {}) {
  const results = [];

  // Compute cluster using PRIMARY niche only — never secondary_niche.
  // secondary_niche is hobby content (BeerBiceps covers fitness) but his AUDIENCE
  // follows him for selfimprovement. Including secondary would merge the entire
  // fitness cluster into his peer pool, pulling in Chloe Ting, ATHLEAN-X, etc.
  const primaryNiche = channel.primary_niche || channel.niche;
  const clusterNiches = NICHE_CLUSTERS[primaryNiche] || [primaryNiche];

  // Level 1: same primary inferred topic — most precise signal
  let topics = [];
  try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
  const primaryTopic = topics[0] || null;
  if (primaryTopic) {
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE json_extract(inferred_topics, '$[0]') = ?
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [primaryTopic, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }
  if (results.length >= minSize) return results;

  // Level 2: shared inferred_topic, constrained to same niche cluster.
  // Without the niche constraint, a hobby topic like 'fitness' would pull pure
  // workout channels into a selfimprovement creator's peer pool.
  if (topics.length > 0 && clusterNiches.length > 0) {
    const phTopics  = topics.map(() => '?').join(',');
    const phNiches  = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT DISTINCT ic.channel_id
       FROM ingested_channels ic, json_each(ic.inferred_topics) jt
       WHERE jt.value IN (${phTopics})
         AND (ic.primary_niche IN (${phNiches}) OR ic.niche IN (${phNiches}))
         AND ic.channel_id != ? AND ic.ingest_enabled = 1
       LIMIT ?`,
      [...topics, ...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // Level 3: full niche cluster — always runs regardless of pool size.
  // Uses NICHE_CLUSTERS so that 'selfimprovement' + 'motivation' + 'personal development'
  // are always one pool. Matches on both niche and primary_niche columns.
  if (clusterNiches.length > 0) {
    const ph = clusterNiches.map(() => '?').join(',');
    const rows = db.all(
      `SELECT channel_id FROM ingested_channels
       WHERE (niche IN (${ph}) OR primary_niche IN (${ph}))
         AND channel_id != ? AND ingest_enabled = 1 LIMIT ?`,
      [...clusterNiches, ...clusterNiches, exclude_channel_id, limit],
    );
    for (const r of rows) if (!results.includes(r.channel_id)) results.push(r.channel_id);
  }

  // If the target channel is IN, exclude channels explicitly tagged as Western/EN.
  const targetRegion = channel.region || null;
  if (targetRegion === 'IN' && results.length > 0) {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels WHERE channel_id IN (${ph}) AND region = 'EN'`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  // If the target channel is English-language, exclude channels in non-Indian languages.
  // Keeps en + hi + null; drops mr (Marathi), id (Indonesian), ar, tr, etc.
  const targetLang = channel.primary_language || null;
  if (targetLang === 'en' && results.length > 0) {
    const ph = results.map(() => '?').join(',');
    const excluded = new Set(
      db.all(
        `SELECT channel_id FROM ingested_channels
         WHERE channel_id IN (${ph})
           AND primary_language IS NOT NULL AND primary_language NOT IN ('en','hi')`,
        results,
      ).map(r => r.channel_id),
    );
    if (excluded.size > 0) results.splice(0, results.length, ...results.filter(id => !excluded.has(id)));
  }

  return results.slice(0, limit);
}

// ── GET /community-hot ────────────────────────────────────────────────────────
// What's performing well in true peer channels in the last 60 days.
// Returns topics with total views, channel count, and sample competitor titles.

router.get('/community-hot', (req, res) => {
  try {
    const db         = getDb();
    const { channel_id } = req.query;
    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });

    const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [channel_id]);
    if (!channel) return res.status(404).json({ ok: false, error: 'Channel not found' });

    const result = cache.wrap(`community_hot_v3:${channel_id}`, () => {
      // Channel's own recent titles (to exclude already-covered topics)
      const ownVideos = db.all(
        `SELECT title FROM ingested_videos WHERE channel_id = ? AND published_at > datetime('now', '-90 days') LIMIT 100`,
        [channel_id],
      );
      const ownText = ownVideos.map(r => (r.title || '').toLowerCase()).join(' ');

      // Resolve peers using the 4-level ladder
      let peerIds = resolvePeers(db, channel, { exclude_channel_id: channel_id });
      if (!peerIds.length) return { ok: true, items: [], peer_count: 0 };

      // Language filter: drop non-Indian-relevant language channels for English creators
      if (channel.primary_language === 'en' && peerIds.length > 0) {
        const lph = peerIds.map(() => '?').join(',');
        const bad = new Set(
          db.all(
            `SELECT channel_id FROM ingested_channels WHERE channel_id IN (${lph}) AND primary_language IS NOT NULL AND primary_language NOT IN ('en','hi')`,
            peerIds,
          ).map(r => r.channel_id),
        );
        if (bad.size > 0) peerIds = peerIds.filter(id => !bad.has(id));
      }

      // Indian-context filter: for IN creators, flip the logic — keep only channels with
      // a verified Indian signal rather than trying to exclude unknown foreign channels.
      // Covers region='IN' (explicitly tagged), language='hi', or any Indian script in
      // the channel name (Devanagari, Gurmukhi, Bengali). Falls back to full pool if
      // fewer than 10 Indian-verified channels are found.
      if (channel.region === 'IN' && peerIds.length > 0) {
        const iph = peerIds.map(() => '?').join(',');
        const rows = db.all(
          `SELECT channel_id, region, primary_language, channel_name FROM ingested_channels WHERE channel_id IN (${iph})`,
          peerIds,
        );
        const INDIAN_SCRIPT_RE  = /[ऀ-ॿ਀-੿ঀ-৿]/;
        // Western therapy/coaching credential markers — these channels were sometimes
        // bulk-tagged region='IN' by mistake; override that tag here.
        const WESTERN_MARKER_RE = /\b(somatic|trauma[- ]informed|msw|rsw|lcsw|mft|lmft|mind[- ]body coaching|nervous system regulation|psychotherap|counsell?ing)\b/i;
        const indianPeers = rows
          .filter(p =>
            !WESTERN_MARKER_RE.test(p.channel_name || '') &&
            (p.region === 'IN' || p.primary_language === 'hi' || INDIAN_SCRIPT_RE.test(p.channel_name || '')),
          )
          .map(p => p.channel_id);
        if (indianPeers.length >= 10) peerIds = indianPeers;
      }

      let topics = [];
      try { topics = JSON.parse(channel.inferred_topics || '[]'); } catch (_) {}
      const primaryTopic = topics[0] || null;

      // Per-channel sampling: top 10 videos per peer channel in last 90 days.
      // Window is 90d (up from 60d) because the tighter Indian peer pool is less
      // prolific — more window gives more phrases without losing recency signal.
      const ph = peerIds.map(() => '?').join(',');
      const videos = db.all(
        `SELECT youtube_video_id, title, views, published_at, channel_id, channel_name
         FROM (
           SELECT iv.youtube_video_id, iv.title, iv.views, iv.published_at,
                  iv.channel_id, ic.channel_name,
                  ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
           FROM ingested_videos iv
           JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
           WHERE iv.channel_id IN (${ph})
             AND iv.published_at > datetime('now', '-90 days')
             AND iv.title IS NOT NULL AND iv.title != ''
             AND iv.views > 0
         ) WHERE rn <= 10`,
        peerIds,
      );
      if (!videos.length) return { ok: true, items: [], peer_count: peerIds.length };

      // Extract topic clusters using the shared phrase engine
      const userPhraseSet = extractUserPhraseSet(ownText);
      const items = buildCommunityHotItems(videos, userPhraseSet, peerIds.length);

      return { ok: true, items, peer_count: peerIds.length, primary_topic: primaryTopic };
    }, 20 * 60 * 1000);

    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function extractUserPhraseSet(text) {
  const set = new Set();
  const words = text.split(/\s+/).filter(w => w.length > 3);
  for (let i = 0; i < words.length - 1; i++) {
    set.add(words[i] + ' ' + words[i + 1]);
    if (i < words.length - 2) set.add(words[i] + ' ' + words[i + 1] + ' ' + words[i + 2]);
  }
  return set;
}

const SOUTH_SCRIPT_RE_HOT = /[஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

function buildCommunityHotItems(videos, userPhraseSet, peerCount) {
  const STOP = new Set([
    // Grammar / function words
    'the','a','an','in','on','of','to','for','is','are','was','were',
    'and','or','but','not','with','by','from','at','this','that','it',
    'he','she','they','we','i','you','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'as','if','so','then','than','just','also','very','more','most',
    'its','his','her','our','their','your','my','into','up','out','over',
    'news','today','latest','new','big','breaking','live','watch','full',
    'video','episode','part','series','like','know','make','says','said',
    // Month names — filter date phrases like "april 2026"
    'january','february','march','april','june','july','august',
    'september','october','november','december',
    // Romanised Hindi function words
    'hai','hain','hoga','kya','kaise','mera','meri','mere','aap','main',
    'yeh','woh','ek','nahi','aur','se','ko','ka','ki','ke','mein','hum',
    'bhi','toh','koi','kuch','sirf','sab','tha','thi','raha','rahi',
    'karo','karna','karte','karke','rehe','rahe','gaye','gaya',
    // Devanagari Hindi function words / verb fragments
    'रहे','हैं','है','हो','ने','भी','जो','तो','बहुत','कभी','सकते','करते',
    'आज','कल','यहां','वहां','इसे','उसे','हमें','आपको','उनका','इनका',
    'बनाए','जाते','करेंगे','होगा','मिलेगा','देगा','लेगा','बताया',
    // Marathi function words / verb fragments
    'करू','नका','आहे','आणि','हे','ते','मी','तू','तुम्ही','आम्ही','त्यांना',
    'करणे','केले','केली','करतो','करती','असेल','नाही','पण','किंवा','म्हणजे',
    // Hindi question/negation words (prevent "क्यों नहीं" type fragments)
    'क्यों','नहीं','क्या','कैसे','कौन','कहाँ','कब',
    'देगी','देनी','छोड़ो','बनाओ','करोगे',
    'marathi','hindi',
    'kata','ibu','doa','untuk','bijak','mutiara','kekuatan',
    // Common hashtag-driven social words
    'love','life','time','come','feel','want','need',
    // Hook/imperative fragments — common title patterns that aren't content topics
    'must','old','hello','namaskar','namaste','blowing','doing','tells','about',
    // Social-media / hashtag noise — these are platform mechanics, not content topics
    'shorts','viral','trending','ytshorts','minivlog','youtubeshorts',
    'viralvideo','shortsfeed','ashortaday','shortvideo','reels','tiktok',
    'subscribe','comment','share','follow','notification','bell','click',
    'trend','trendy','explore','fyp','foryou','foryoupage',
  ]);

  // Build bigram/trigram topic map
  const topicMap = new Map();
  for (const video of videos) {
    const rawTitle = video.title || '';
    if (SOUTH_SCRIPT_RE_HOT.test(rawTitle)) continue;
    const tokens = rawTitle
      .replace(/#\w+/g, ' ')
      .replace(/\|{2}[^|]+\|{2}/g, ' ')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w) && !DEVANAGARI_RE.test(w));

    const phrases = new Set();
    for (let i = 0; i < tokens.length; i++) {
      if (i < tokens.length - 1) phrases.add(tokens[i] + ' ' + tokens[i+1]);
      if (i < tokens.length - 2) phrases.add(tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2]);
    }

    for (const phrase of phrases) {
      if (userPhraseSet.has(phrase)) continue;
      if (!topicMap.has(phrase)) {
        topicMap.set(phrase, { total_views: 0, channelIds: new Set(), channelMap: new Map() });
      }
      const b = topicMap.get(phrase);
      b.total_views += video.views || 0;
      b.channelIds.add(video.channel_id);
      if (!b.channelMap.has(video.channel_id)) {
        b.channelMap.set(video.channel_id, { channel_name: video.channel_name || '', views: 0 });
      }
      b.channelMap.get(video.channel_id).views += video.views || 0;
    }
  }

  return [...topicMap.entries()]
    .filter(([, b]) => b.channelIds.size >= 3)
    .sort((a, b) => b[1].total_views - a[1].total_views)
    .slice(0, 30)
    .map(([phrase, b]) => ({
      topic:         phrase,
      total_views:   b.total_views,
      channel_count: b.channelIds.size,
      peer_count:    peerCount,
      channels:      [...b.channelMap.values()]
                       .sort((a, z) => z.views - a.views)
                       .slice(0, 5),
    }));
}

// ── GET /world-signals ────────────────────────────────────────────────────────
// Combines internal velocity spikes (Option A) with Google Trends (Option B).
// Designed to be called async — returns whatever it has quickly.

router.get('/world-signals', async (req, res) => {
  try {
    const db         = getDb();
    const { channel_id } = req.query;
    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });

    const channel = db.get(
      'SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id],
    );
    let topics = [];
    try { topics = JSON.parse(channel?.inferred_topics || '[]'); } catch(_) {}

    const { getWorldSignals } = require('../services/worldSignals');
    const signals = await getWorldSignals(db, { channel_id, topics });

    res.json({ ok: true, ...signals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /what-to-post ─────────────────────────────────────────────────────────
router.get('/what-to-post', (req, res) => {
  try {
    const db       = getDb();
    const { channel_id, niche, community_id, subscriber_count } = req.query;
    const userSubs = parseInt(subscriber_count || '0', 10);

    if (!niche && !community_id && !channel_id) {
      return res.status(400).json({ error: 'niche, community_id, or channel_id required' });
    }

    // ── Resolve community + detect niche category ─────────────────────────
    let communityIds   = [];
    let resolvedNiche  = niche;
    let niche_category = 'A';

    let userRegion = null;
    let row = null;
    if (channel_id) {
      row = db.get(
        `SELECT community_id, niche, primary_niche, secondary_niche, content_archetype, format_type, behavior_tags, region, inferred_topics
         FROM ingested_channels WHERE channel_id = ?`,
        [channel_id],
      );
      if (row) {
        userRegion = row.region || null;
        const rc   = getRegionClause(userRegion);

        // ── 1. Community pool (highest priority — validated by dominant niche) ──
        if (row.community_id && row.niche) {
          const communityRows = db.all(
            `SELECT channel_id, niche FROM ingested_channels WHERE community_id = ? AND channel_id != ? ${rc} LIMIT 300`,
            [row.community_id, channel_id],
          );
          const nicheCounts = {};
          for (const r of communityRows) nicheCounts[r.niche] = (nicheCounts[r.niche] || 0) + 1;
          const dominantNiche = Object.entries(nicheCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (!dominantNiche || dominantNiche === row.niche) {
            communityIds = communityRows.map(r => r.channel_id);
          }
        }

        // ── 2. Topic fingerprint pool ─────────────────────────────────────────
        // Require minOverlap:2 so surface-level matches (single shared keyword like
        // "India" or "Modi") don't pull in unrelated niches as peers.
        const topicMatches = getChannelsByTopicOverlap(db, channel_id, { limit: 300, minOverlap: 2 });

        // Also get this channel's primary inferred topic so we can require peer
        // channels share it — prevents e.g. domestic-politics channels bleeding
        // into an international-geopolitics peer pool via shallow topic overlap.
        let userPrimaryTopic = null;
        try {
          const topicRow = db.get(
            `SELECT json_extract(inferred_topics, '$[0]') AS t FROM ingested_channels WHERE channel_id = ?`,
            [channel_id],
          );
          userPrimaryTopic = topicRow?.t?.toLowerCase() || null;
        } catch (_) {}

        const filteredTopicMatches = userPrimaryTopic
          ? topicMatches.filter(m => {
              try {
                const peerRow = db.get(
                  `SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?`, [m.channel_id],
                );
                const peerTopics = JSON.parse(peerRow?.inferred_topics || '[]');
                return peerTopics.some(t => (t || '').toLowerCase() === userPrimaryTopic);
              } catch (_) { return true; }
            })
          : topicMatches;

        const effectiveMatches = filteredTopicMatches.length >= 3 ? filteredTopicMatches : topicMatches;

        if (effectiveMatches.length > 0) {
          const topicScoreMap = new Map();
          for (const m of effectiveMatches) topicScoreMap.set(m.channel_id, m.topic_overlap);

          const communitySet = new Set(communityIds);
          const allIds = new Set([...communityIds, ...effectiveMatches.map(m => m.channel_id)]);
          allIds.delete(channel_id);

          communityIds = [...allIds].sort((a, b) => {
            const scoreB = (topicScoreMap.get(b) || 0) + (communitySet.has(b) ? 2 : 0);
            const scoreA = (topicScoreMap.get(a) || 0) + (communitySet.has(a) ? 2 : 0);
            return scoreB - scoreA;
          }).slice(0, 300);
        }

        // Always prefer DB niche (OpenAI-classified) over the query param niche
        resolvedNiche = row.primary_niche || row.niche || resolvedNiche;

        let behaviorTags = [];
        try { behaviorTags = JSON.parse(row.behavior_tags || '[]'); } catch (_) {}
        niche_category = getNicheCategory(row.niche, row.content_archetype, behaviorTags);
      }
    } else if (community_id) {
      communityIds = db.all(
        `SELECT channel_id FROM ingested_channels WHERE community_id = ? LIMIT 300`,
        [community_id],
      ).map(r => r.channel_id);
    }

    // ── Title-similarity filter: keeps community pool on-topic ────────────
    // Only apply when pool is already large (≥30) — for small pools the niche
    // fallback already ran and we don't want to discard channels just because
    // they write titles in a different script (Hindi, Bengali, etc.).
    if (channel_id && communityIds.length >= 30) {
      const targetTitles = db.all(
        `SELECT title FROM ingested_videos WHERE channel_id = ? AND title IS NOT NULL ORDER BY published_at DESC LIMIT 50`,
        [channel_id],
      );
      const targetPhraseSet = new Set();
      for (const { title } of targetTitles) {
        for (const p of extractPhrases(title)) targetPhraseSet.add(p);
      }

      if (targetPhraseSet.size > 0) {
        const cph2 = communityIds.map(() => '?').join(',');
        const poolTitleRows = db.all(
          `SELECT channel_id, title FROM (
             SELECT channel_id, title,
                    ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at DESC) AS rn
             FROM ingested_videos
             WHERE channel_id IN (${cph2}) AND title IS NOT NULL
           ) WHERE rn <= 20`,
          communityIds,
        );

        const simScore = {};
        for (const { channel_id: cid, title } of poolTitleRows) {
          if (!simScore[cid]) simScore[cid] = 0;
          for (const p of extractPhrases(title)) {
            if (targetPhraseSet.has(p)) simScore[cid]++;
          }
        }

        const filtered = communityIds.filter(cid => (simScore[cid] || 0) > 0);
        if (filtered.length >= 5) communityIds = filtered;
      }
    }

    // ── 3. Archetype/topic/niche ladder — runs after title-similarity filter ──
    // Adds format-matched peers that weren't in the original community pool.
    // These bypass the title filter because archetype+format is already a strong
    // signal — we don't need title overlap on top of it.
    if (communityIds.length < 30 && channel_id && row) {
      const extra = resolvePeers(db, row, { exclude_channel_id: channel_id, minSize: 30, limit: 300 });
      const merged = [...communityIds];
      for (const id of extra) if (!merged.includes(id)) merged.push(id);
      communityIds = merged.slice(0, 300);
    }

    // Language filter: for English-language creators, drop non-English non-Hindi peers.
    // Removes Indonesian (id), Marathi (mr), Arabic (ar), Turkish (tr), etc.
    // Channels with language=null pass through — they may just be unclassified.
    if (communityIds.length > 0 && row?.primary_language === 'en') {
      const langPh = communityIds.map(() => '?').join(',');
      const badIds = new Set(
        db.all(
          `SELECT channel_id FROM ingested_channels
           WHERE channel_id IN (${langPh})
             AND primary_language IS NOT NULL AND primary_language NOT IN ('en','hi')`,
          communityIds,

        ).map(r => r.channel_id),
      );
      if (badIds.size > 0) communityIds = communityIds.filter(id => !badIds.has(id));
    }

    if (communityIds.length === 0) {
      return res.json({ ok: true, niche_category, ideas: [], channel_count: 0, video_count: 0, summary: null });
    }

    // Category B channels (music, comedy + entertainer archetype) need style-signal
    // analysis, not topic phrases. Return the signal so the frontend shows the right UI.
    if (niche_category === 'B') {
      return res.json({
        ok:             true,
        niche_category: 'B',
        channel_count:  communityIds.length,
        video_count:    0,
        ideas:          [],
        summary:        null,
      });
    }

    // ── Community videos — extend window for small pools ──────────────────
    const windowDays = communityIds.length < 15 ? 180 : 90;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ph    = communityIds.map(() => '?').join(',');

    // Per-channel sampling: top 10 videos per channel by views.
    // Prevents high-volume channels (daily vloggers, viral one-hit channels) from
    // dominating topic extraction. Every channel in the pool contributes equally.
    const communityVideos = db.all(
      `SELECT youtube_video_id, title, views, channel_id, published_at, duration_seconds, channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, iv.duration_seconds, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at >= ?
           AND iv.title IS NOT NULL
           AND iv.views > 0
       ) WHERE rn <= 10`,
      [...communityIds, since],
    );

    // ── User's own phrases ─────────────────────────────────────────────────
    const userPhraseSet = new Set();
    if (channel_id) {
      db.all(
        `SELECT title FROM ingested_videos WHERE channel_id = ? ORDER BY published_at DESC LIMIT 100`,
        [channel_id],
      ).forEach(v => extractPhrases(v.title).forEach(p => userPhraseSet.add(p)));
    }

    // ── Bulk velocity snapshots (one query) ────────────────────────────────
    const videoIds = communityVideos.map(v => v.youtube_video_id);
    const snapMap  = new Map();

    if (videoIds.length > 0) {
      const vph = videoIds.map(() => '?').join(',');
      db.all(
        `SELECT video_id, bucket, views, subscriber_adjusted_velocity AS sav
         FROM video_growth_snapshots
         WHERE video_id IN (${vph}) AND bucket IN ('7d', '30d')`,
        videoIds,
      ).forEach(s => {
        if (!snapMap.has(s.video_id)) snapMap.set(s.video_id, {});
        const e = snapMap.get(s.video_id);
        if (s.bucket === '7d')  e.v7  = s.views;
        if (s.bucket === '30d') { e.v30 = s.views; e.sav30 = s.sav; }
      });
    }

    // ── Build topic buckets ─────────────────────────────────────────────────
    const topicMap = new Map();
    const nowMs    = Date.now();

    for (const video of communityVideos) {
      const phrases     = extractPhrases(video.title);
      const seenThisVid = new Set();
      const ageDays     = (nowMs - new Date(video.published_at).getTime()) / 86400000;
      const dur         = video.duration_seconds || 0;
      const fmtKey      = dur < 60 ? 'shorts' : dur < 300 ? 'quick' : dur < 900 ? 'mid' : 'long';
      const snap        = snapMap.get(video.youtube_video_id);

      for (const phrase of phrases) {
        if (seenThisVid.has(phrase)) continue;
        seenThisVid.add(phrase);

        if (!topicMap.has(phrase)) {
          topicMap.set(phrase, {
            videos:      [],
            totalViews:  0,
            channels:    new Set(),
            cnt_0_14:    0,
            cnt_15_30:   0,
            cnt_31_60:   0,
            cnt_61_90:   0,
            formats: {
              shorts: { count: 0, totalViews: 0 },
              quick:  { count: 0, totalViews: 0 },
              mid:    { count: 0, totalViews: 0 },
              long:   { count: 0, totalViews: 0 },
            },
            vel_pairs:   [],
            sav30_sum:   0,
            sav30_cnt:   0,
          });
        }

        const b = topicMap.get(phrase);
        // Skip regional-language titles in examples (channels may have null language in DB)
        const lowerTitle = (video.title || '').toLowerCase();
        const isRegional = /\bmarathi\b|\btelugu\b|\btamil\b|\bkannada\b|\bmalayalam\b|\bbengali\b|\bkata[\s-]kata\b/.test(lowerTitle);
        if (b.videos.length < 5 && !isRegional) b.videos.push(video);
        b.totalViews += (video.views || 0);
        b.channels.add(video.channel_id);

        if (ageDays <= 14)      b.cnt_0_14++;
        else if (ageDays <= 30) b.cnt_15_30++;
        else if (ageDays <= 60) b.cnt_31_60++;
        else                    b.cnt_61_90++;

        b.formats[fmtKey].count++;
        b.formats[fmtKey].totalViews += (video.views || 0);

        if (snap?.v7 && snap?.v30 && snap.v7 > 0) {
          b.vel_pairs.push({ v7: snap.v7, v30: snap.v30 });
        }
        if (snap?.sav30 != null) { b.sav30_sum += snap.sav30; b.sav30_cnt++; }
      }
    }

    // ── Score + classify ───────────────────────────────────────────────────
    // Niches where topics are time-bound events — filter out event spikes,
    // suggest only recurring themes suitable for documentary/explainer formats.
    // geopolitics and defence are analytical/documentary by nature — NOT breaking news.
    const IS_NEWS_NICHE = new Set(['news', 'politics', 'sports']).has(resolvedNiche);

    const TREND_SCORE = { rising: 20, peaking: 10, evergreen: 8, fading: -15, dormant: -30 };
    const VEL_SCORE   = { fast: 12, growing: 5, peaked: -5 };
    const gaps        = [];
    let risingCnt = 0, evergreenCnt = 0, unexploredCnt = 0, saturatedCnt = 0;

    // Scale thresholds to pool size:
    // ≤3 channels → require 1 channel, enforce 1K avg_views floor
    // ≤9 channels → require 2 channels, enforce 5K avg_views floor
    // 10+ channels → require 3 channels, enforce 8K avg_views floor
    // The avg_views floor removes grammatical phrase fragments (e.g. Hindi verb forms)
    // that appear in enough titles but represent no real content idea.
    const minChannels = communityIds.length <= 3 ? 1 : communityIds.length <= 9 ? 2 : 3;
    const minVideos   = 1;
    const minAvgViews = communityIds.length <= 3 ? 1000 : communityIds.length <= 9 ? 5000 : 8000;

    for (const [phrase, b] of topicMap.entries()) {
      if (b.channels.size < minChannels) continue;
      if (b.videos.length < minVideos)   continue;
      if (userPhraseSet.has(phrase))     continue;
      if (minAvgViews > 0 && (b.totalViews / b.videos.length) < minAvgViews) continue;

      // For news/politics/sports: discard topics with no historical coverage.
      // If all coverage is within the last 30 days and nothing older exists,
      // it's a breaking-news event — stale before it can be acted on.
      if (IS_NEWS_NICHE && (b.cnt_31_60 + b.cnt_61_90) < 2) continue;

      const avgViews        = b.totalViews / b.videos.length;
      const totalVidCount   = b.cnt_0_14 + b.cnt_15_30 + b.cnt_31_60 + b.cnt_61_90;
      const saturation_pct  = Math.round(b.channels.size / communityIds.length * 100);
      const saturation_level= saturation_pct < 20 ? 'low' : saturation_pct < 60 ? 'medium' : 'high';
      const trend_status    = classifyTrend(b);
      const format_winner   = getFormatWinner(b.formats, totalVidCount);
      const velocity        = getVelocity(b.vel_pairs);

      let expected_low = null, expected_high = null;
      if (userSubs > 0 && b.sav30_cnt >= 2) {
        const avgSav  = b.sav30_sum / b.sav30_cnt;
        const baseExp = Math.round((userSubs / 1000) * avgSav * 720);
        expected_low  = Math.round(baseExp * 0.6);
        expected_high = Math.round(baseExp * 1.4);
      }

      const base_views  = Math.min(35, Math.log10(avgViews + 1) / 7 * 35);
      const spread      = Math.min(20, b.channels.size / 10 * 20);
      const trend_bonus = TREND_SCORE[trend_status] || 0;
      const vel_bonus   = velocity ? (VEL_SCORE[velocity.status] || 0) : 0;
      const sat_penalty = saturation_pct > 60 ? -(saturation_pct - 60) / 2 : 0;
      const gap_bonus   = saturation_pct < 20 && b.channels.size >= 3 ? 10 : 0;
      const score       = Math.max(1, Math.min(99, Math.round(base_views + spread + trend_bonus + vel_bonus + sat_penalty + gap_bonus)));

      if (trend_status === 'rising')    risingCnt++;
      if (trend_status === 'evergreen') evergreenCnt++;
      if (saturation_pct < 20)          unexploredCnt++;
      if (saturation_pct > 60)          saturatedCnt++;

      const rec_type = IS_NEWS_NICHE    ? 'long_form_opportunity' :
                       niche_category === 'C' ? 'context_gap'    : 'topic_gap';

      gaps.push({
        topic:               phrase.replace(/\b\w/g, c => c.toUpperCase()),
        score,
        recommendation_type: rec_type,
        channel_count:       b.channels.size,
        avg_views:           Math.round(avgViews),
        trend_status,
        saturation_pct,
        saturation_level,
        format_winner,
        velocity,
        // News channels don't have urgency windows — documentaries aren't time-sensitive
        act_now:             !IS_NEWS_NICHE && trend_status === 'rising' && saturation_pct < 30,
        expected_low,
        expected_high,
        trending:            b.cnt_0_14 / Math.max(1, totalVidCount) >= 0.4,
        examples:            b.videos.slice(0, 3).map(v => ({
          title:        v.title,
          views:        v.views,
          channel_name: v.channel_name || 'Unknown',
        })),
        why: buildWhyText(b, trend_status, avgViews, rec_type),
      });
    }

    gaps.sort((a, b) => b.score - a.score);

    // ── Deduplicate overlapping phrases + same-video ideas ─────────────────
    // Two passes:
    // 1. Drop ideas whose example videos are already covered by a higher-scoring idea.
    //    This catches same-content-different-phrase cases (e.g. regional channel siblings
    //    all posting the same clip, producing two phrases that look unrelated).
    // 2. Drop ideas whose topic words mostly overlap with an already-accepted idea.
    const deduped        = [];
    const usedWords      = new Set();
    const usedVideoIds   = new Set();

    for (const gap of gaps) {
      const exampleIds = (gap.examples || []).map(e => e.title); // use title as proxy (no id in examples)
      const videoOverlap = exampleIds.filter(t => usedVideoIds.has(t)).length;
      if (videoOverlap >= 2) continue; // 2+ same example videos = same content

      const words  = gap.topic.toLowerCase().split(' ');
      const wOverlap = words.filter(w => usedWords.has(w)).length;
      if (wOverlap >= words.length - 1) continue;

      exampleIds.forEach(t => usedVideoIds.add(t));
      words.forEach(w => usedWords.add(w));
      deduped.push(gap);
      if (deduped.length >= 15) break;
    }

    res.json({
      ok:             true,
      niche_category,
      channel_count:  communityIds.length,
      video_count:    communityVideos.length,
      ideas:          deduped,
      summary:        { rising: risingCnt, evergreen: evergreenCnt, unexplored: unexploredCnt, saturated: saturatedCnt },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Topic search ─────────────────────────────────────────────────────────────
// User supplies a topic they want to make a video on. We search community +
// global ingested_videos for matching titles and return performance stats.

router.get('/topic-search', (req, res) => {
  try {
    const db       = getDb();
    const { q, channel_id, niche } = req.query;
    if (!q || q.trim().length < 2) return res.status(400).json({ error: 'query required (min 2 chars)' });

    const terms = q.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);

    // Resolve community (same logic as what-to-post)
    let resolvedNiche = niche;
    let communityIds  = [];
    if (channel_id) {
      const row = db.get(`SELECT niche, community_id FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      if (row) {
        resolvedNiche = resolvedNiche || row.niche;
        if (row.community_id) {
          communityIds = db.all(
            `SELECT channel_id FROM ingested_channels WHERE community_id = ? AND channel_id != ? LIMIT 300`,
            [row.community_id, channel_id],
          ).map(r => r.channel_id);
        }
      }
    }
    if (communityIds.length < 5 && resolvedNiche) {
      communityIds = db.all(
        `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? ${channel_id ? 'AND channel_id != ?' : ''} LIMIT 300`,
        channel_id ? [resolvedNiche, channel_id] : [resolvedNiche],
      ).map(r => r.channel_id);
    }

    // Match helper: any term hits the title
    const matches = (title) => {
      const t = title.toLowerCase();
      return terms.length === 1
        ? t.includes(terms[0])
        : terms.every(w => t.includes(w)) || (terms.length <= 3 && terms.filter(w => t.includes(w)).length >= Math.ceil(terms.length * 0.6));
    };

    // Community search
    let communityResult = null;
    if (communityIds.length > 0) {
      const ph         = communityIds.map(() => '?').join(',');
      const allVideos  = db.all(
        `SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, iv.duration_seconds, ic.channel_name
         FROM ingested_videos iv
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph}) AND iv.title IS NOT NULL AND iv.views > 0`,
        communityIds,
      );

      const matched      = allVideos.filter(v => matches(v.title));
      const channelSet   = new Set(matched.map(v => v.channel_id));
      const totalViews   = matched.reduce((s, v) => s + (v.views || 0), 0);
      const nowMs        = Date.now();
      const b            = { cnt_0_14: 0, cnt_15_30: 0, cnt_31_60: 0, cnt_61_90: 0 };
      for (const v of matched) {
        const ageDays = (nowMs - new Date(v.published_at).getTime()) / 86400000;
        if (ageDays <= 14)      b.cnt_0_14++;
        else if (ageDays <= 30) b.cnt_15_30++;
        else if (ageDays <= 60) b.cnt_31_60++;
        else                    b.cnt_61_90++;
      }

      communityResult = {
        video_count:      matched.length,
        channel_count:    channelSet.size,
        community_size:   communityIds.length,
        avg_views:        matched.length > 0 ? Math.round(totalViews / matched.length) : 0,
        trend_status:     matched.length >= 2 ? classifyTrend(b) : null,
        saturation_pct:   communityIds.length > 0 ? Math.round(channelSet.size / communityIds.length * 100) : 0,
        top_videos:       matched
          .sort((a, b) => (b.views || 0) - (a.views || 0))
          .slice(0, 8)
          .map(v => ({ title: v.title, views: v.views, channel_name: v.channel_name || 'Unknown' })),
      };
      communityResult.saturation_level = communityResult.saturation_pct < 20 ? 'low'
        : communityResult.saturation_pct < 60 ? 'medium' : 'high';
    }

    // Global search (across all ingested_videos, best performers)
    const globalVideos  = db.all(
      `SELECT iv.title, iv.views, iv.channel_id, ic.channel_name, ic.niche
       FROM ingested_videos iv
       LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
       WHERE iv.title IS NOT NULL AND iv.views > 10000
       ORDER BY iv.views DESC LIMIT 10000`,
    );
    const globalMatched = globalVideos.filter(v => matches(v.title));
    const globalResult  = {
      video_count: globalMatched.length,
      top_videos:  globalMatched
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 8)
        .map(v => ({ title: v.title, views: v.views, channel_name: v.channel_name || 'Unknown', niche: v.niche })),
    };

    res.json({ ok: true, query: q, community: communityResult, global: globalResult });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Adjacent niche ideas ──────────────────────────────────────────────────────
// Returns top ideas from up to 3 niches adjacent to the user's niche.
// Each source niche is returned separately so the frontend can label them.

router.get('/adjacent-ideas', (req, res) => {
  try {
    const db       = getDb();
    const { channel_id, niche, subscriber_count } = req.query;
    const userSubs = parseInt(subscriber_count || '0', 10);

    if (!niche && !channel_id) return res.status(400).json({ error: 'niche or channel_id required' });

    let resolvedNiche = niche;
    let userRegion    = null;
    if (channel_id) {
      const row = db.get(`SELECT niche, region FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      if (row?.niche && !resolvedNiche) resolvedNiche = row.niche;
      userRegion = row?.region || null;
    }

    const userPhraseSet  = buildUserPhraseSet(db, channel_id);
    const adjacentNiches = (ADJACENCY_MAP[resolvedNiche] || []).slice(0, 3);
    const rc             = getStrictRegionClause(userRegion);

    if (!adjacentNiches.length) return res.json({ ok: true, sources: [] });

    const sources = [];
    for (const adjNiche of adjacentNiches) {
      const channelIds = db.all(
        `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? ${rc} LIMIT 200`,
        [adjNiche],
      ).map(r => r.channel_id);

      if (channelIds.length < 3) continue;

      const ideas = analyzeTopics(db, channelIds, userPhraseSet, userSubs, channelIds.length, {
        maxResults: 5, minChannels: 2,
      });
      if (ideas.length) sources.push({ niche: adjNiche, channel_count: channelIds.length, ideas });
    }

    res.json({ ok: true, sources });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Foreign market signal ─────────────────────────────────────────────────────
// Shows topics trending in US/UK/AU channels of the same niche that haven't
// appeared yet in the user's community. Only for universal (non-geo-bound) niches.

router.get('/foreign-signal', (req, res) => {
  try {
    const db       = getDb();
    const { channel_id, niche, subscriber_count } = req.query;
    const userSubs = parseInt(subscriber_count || '0', 10);

    if (!niche && !channel_id) return res.status(400).json({ error: 'niche or channel_id required' });

    let resolvedNiche = niche;
    let userRegion    = null;
    if (channel_id) {
      const row = db.get(`SELECT niche, region FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      if (row?.niche && !resolvedNiche) resolvedNiche = row.niche;
      userRegion = row?.region || null;
    }

    // Foreign signal (US/UK → India) only makes sense for Indian/undetected creators.
    // English/Western creators are the foreign signal — don't show it to them.
    if (isEnglishRegion(userRegion)) {
      return res.json({ ok: true, supported: false, reason: 'not_applicable_for_region' });
    }

    if (!UNIVERSAL_NICHES.has(resolvedNiche)) {
      return res.json({ ok: true, supported: false, niche: resolvedNiche });
    }

    const userPhraseSet = buildUserPhraseSet(db, channel_id);

    const ph = FOREIGN_REGIONS.map(() => '?').join(',');
    const foreignIds = db.all(
      `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? AND region IN (${ph}) LIMIT 200`,
      [resolvedNiche, ...FOREIGN_REGIONS],
    ).map(r => r.channel_id);

    if (foreignIds.length < 3) {
      return res.json({ ok: true, supported: true, channel_count: foreignIds.length, ideas: [] });
    }

    const ideas = analyzeTopics(db, foreignIds, userPhraseSet, userSubs, foreignIds.length, {
      maxResults: 8, minChannels: 2,
    });

    res.json({ ok: true, supported: true, channel_count: foreignIds.length, ideas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Google Trends correlation ─────────────────────────────────────────────────
// Fetches daily trending searches in India, then cross-references each term
// against community video titles to surface topics where search demand is rising
// AND the niche community has proven those topics perform.

const googleTrends = require('google-trends-api');

router.get('/trending-topics', async (req, res) => {
  try {
    const db       = getDb();
    const { channel_id, niche, subscriber_count } = req.query;

    if (!niche && !channel_id) return res.status(400).json({ error: 'niche or channel_id required' });

    let resolvedNiche = niche;
    let userRegion    = null;
    if (channel_id) {
      const row = db.get(`SELECT niche, region FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      if (row?.niche && !resolvedNiche) resolvedNiche = row.niche;
      userRegion = row?.region || null;
    }

    // India trends only apply to Indian/undetected creators
    if (isEnglishRegion(userRegion)) {
      return res.json({ ok: true, ideas: [] });
    }

    // Fetch daily trending searches for India
    const raw = await googleTrends.dailyTrends({ geo: 'IN', trendDate: new Date() });
    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) throw new Error('Unexpected Google Trends response format');
    const json = JSON.parse(raw.slice(jsonStart));
    const trendingSearches = json.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

    const terms = trendingSearches
      .map(s => s.title?.query)
      .filter(Boolean)
      .slice(0, 30);

    if (!terms.length) return res.json({ ok: true, ideas: [] });

    // Get community videos for this niche (last 90d)
    const communityIds = db.all(
      `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? ${channel_id ? 'AND channel_id != ?' : ''} LIMIT 300`,
      channel_id ? [resolvedNiche, channel_id] : [resolvedNiche],
    ).map(r => r.channel_id);

    if (!communityIds.length) return res.json({ ok: true, ideas: [] });

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ph    = communityIds.map(() => '?').join(',');

    const videos = db.all(
      `SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
              iv.published_at, ic.channel_name
       FROM ingested_videos iv
       LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
       WHERE iv.channel_id IN (${ph})
         AND iv.published_at >= ?
         AND iv.title IS NOT NULL
         AND iv.views > 0`,
      [...communityIds, since],
    );

    const nowMs = Date.now();
    const ideas = [];

    for (const term of terms) {
      const termWords = term.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      if (!termWords.length) continue;

      const matched = videos.filter(v => {
        const t = v.title.toLowerCase();
        return termWords.some(w => t.includes(w));
      });

      if (matched.length < 2) continue;

      const channelSet = new Set(matched.map(v => v.channel_id));
      const totalViews = matched.reduce((s, v) => s + (v.views || 0), 0);
      const avgViews   = Math.round(totalViews / matched.length);

      const b = { cnt_0_14: 0, cnt_15_30: 0, cnt_31_60: 0, cnt_61_90: 0 };
      for (const v of matched) {
        const ageDays = (nowMs - new Date(v.published_at).getTime()) / 86400000;
        if (ageDays <= 14)      b.cnt_0_14++;
        else if (ageDays <= 30) b.cnt_15_30++;
        else if (ageDays <= 60) b.cnt_31_60++;
        else                    b.cnt_61_90++;
      }

      const trend_status    = classifyTrend(b);
      const saturation_pct  = Math.round(channelSet.size / communityIds.length * 100);
      const saturation_level= saturation_pct < 20 ? 'low' : saturation_pct < 60 ? 'medium' : 'high';
      const score           = Math.max(1, Math.min(99, Math.round(
        Math.min(35, Math.log10(avgViews + 1) / 7 * 35) +
        (trend_status === 'rising' ? 20 : trend_status === 'evergreen' ? 8 : trend_status === 'peaking' ? 10 : 0) +
        (saturation_pct < 20 ? 10 : saturation_pct > 60 ? -10 : 0),
      )));

      ideas.push({
        topic:            term,
        score,
        channel_count:    channelSet.size,
        avg_views:        avgViews,
        trend_status,
        saturation_pct,
        saturation_level,
        act_now:          trend_status === 'rising' && saturation_pct < 30,
        examples:         matched.slice(0, 3).map(v => ({
          title: v.title, views: v.views, channel_name: v.channel_name || 'Unknown',
        })),
      });
    }

    ideas.sort((a, b) => b.score - a.score);
    res.json({ ok: true, ideas: ideas.slice(0, 8) });
  } catch (e) {
    console.error('[trending-topics]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Topic trends ─────────────────────────────────────────────────────────────
// GET /api/intel/trends/topics?niche=fitness&limit=30
// Returns topics sorted by velocity (how fast they're being adopted across channels).
// also returns cross-niche spread: which niches each topic appears in.

const { getTopicVelocity } = require('../db/queries');

router.get('/trends/topics', (req, res) => {
  try {
    const db    = getDb();
    const niche = req.query.niche || null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

    const rows = getTopicVelocity(db, { niche, limit });

    // For the top 20, also fetch which niches each topic spans
    const top20 = rows.slice(0, 20);
    for (const row of top20) {
      const niches = db.all(
        `SELECT niche, COUNT(*) as cnt FROM channel_topics WHERE topic = ? AND niche IS NOT NULL GROUP BY niche ORDER BY cnt DESC`,
        [row.topic],
      );
      row.niches = niches.map(n => ({ niche: n.niche, channels: n.cnt }));
    }

    res.json({ ok: true, topics: rows, generated_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
