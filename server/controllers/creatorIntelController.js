'use strict';
const crypto  = require('crypto');
const { getDb } = require('../db/init');
const { getChannelVideoTitles, saveChannelIdentity, setNicheOverride, getTopicVelocity } = require('../db/queries');
const { classifyChannel, ALLOWED_NICHES } = require('../services/channelClassifier');
const cache = require('../services/queryCache');
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
const { computeWhatToPost } = require('../services/whatToPost');
const { getCachedOrComputeWhatToPost } = require('../services/wtpCache');
const { buildWhatToPostContext } = require('../services/whatToPostContext');
const { refineWtpRecommendations } = require('../services/wtpRecommendationRefiner');
const { attachIdeaKeys } = require('../services/wtpOutcomeTracker');
const { maybeLazyReclassify } = require('../services/lazyReclassify');
const { persistCreatorIdeaDnaForPipeline } = require('../services/creatorIdeaDnaPipeline');
const { generateOriginalBets, generateGuestPitches } = require('../services/wtpIdeaGenerator');
const { computeCommunityHot } = require('../services/communityHot');
const { resolveCreatorPeerContext } = require('../services/creatorPeerContext');
const { readLatestCreatorDnaSnapshot } = require('../services/creatorIdeaDna');
const { createOriginalBetIdeaKey } = require('../services/originalBets');
const {
  detectChannelCountry,
  detectScript,
  hinglishScore,
} = require('../jobs/languageDetectionJob');
const {
  STOPWORDS,
  HOOK_PHRASES,
  DEVANAGARI_RE,
  SOUTH_SCRIPT_RE,
  extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');
const {
  EN_REGIONS,
  getStrictRegionClause,
  isEnglishRegion,
  ADJACENCY_MAP,
  UNIVERSAL_NICHES,
  FOREIGN_REGIONS,
  classifyTrend,
  getVelocity,
  getFormatWinner,
  analyzeTopics,
  buildUserPhraseSet,
} = require('../services/topicAnalysis');
const googleTrends = require('google-trends-api');

const CSP_ADJACENT_NICHES = {
  founder_economy_conversation: ['finance', 'business'],
  business_case_study: ['finance'],
  finance_investment_education: ['business'],
  personal_finance_guest_show: ['business'],
  indian_business_selfimprovement_podcast: ['finance'],
};

const SUPPORT_ADJACENT_NICHE_LIMIT = 2;
const SUPPORT_CHANNEL_LIMIT = 80;
const SUPPORT_TREND_CHANNEL_LIMIT = 120;
const SUPPORT_GOOGLE_TRENDS_TIMEOUT_MS = 5000;

function getCspAwareAdjacentNiches(db, channelId, fallbackNiche) {
  if (!channelId) return (ADJACENCY_MAP[fallbackNiche] || []).slice(0, 3);
  const csp = db.get(
    `SELECT primary_csp FROM channel_content_strategy_profiles WHERE channel_id = ?`,
    [channelId],
  )?.primary_csp;
  return (CSP_ADJACENT_NICHES[csp] || ADJACENCY_MAP[fallbackNiche] || []).slice(0, 3);
}

// ── In-memory bulk re-detect job store ────────────────────────────────────────
const bulkJobs = new Map();

// ── Private helpers ───────────────────────────────────────────────────────────

function getChannelDescription(db, channel_id) {
  try {
    const row = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel_id]);
    if (!row?.raw_json) return null;
    const j = JSON.parse(row.raw_json);
    const desc = j.snippet?.description;
    return (desc && desc.trim().length > 10) ? desc.trim() : null;
  } catch (_) { return null; }
}

// ── GET /competitor/channels ──────────────────────────────────────────────────

async function competitorChannelsHandler(req, res) {
  try {
    const db = getDb();
    const { niche, limit, community_id, channel_id, subscribers } = req.query;
    const limitN    = limit ? parseInt(limit) : 20;
    const targetSubs = subscribers ? parseInt(subscribers) : null;

    let rows = getTopChannelsByNiche(db, { niche, community_id, limit: 60 });
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

    // Detect target channel's country — only for channels already ingested.
    // Fresh YouTube channels (not yet in ingested_channels) skip detection entirely
    // and use the defensive filter; the second loadDashboard call (post-onboarding)
    // will have the correct region stored.
    let targetCountry = null;
    let targetIsIndianEnglish = false;
    if (channel_id) {
      const targetRow = db.get('SELECT region, primary_language FROM ingested_channels WHERE channel_id = ?', [channel_id]);
      if (targetRow) {
        targetCountry = targetRow.region || null;
        if (!targetCountry) {
          targetCountry = await detectChannelCountry(channel_id);
          if (targetCountry) regionMap[channel_id] = targetCountry;
        }
        // Store whether target is an Indian English creator — used below to
        // accept both IN-region and EN-region peers (not one or the other).
        targetIsIndianEnglish = (targetCountry === 'IN' && targetRow.primary_language === 'en');
      } else {
        // Channel not yet ingested — check channel_cache for a fast country hint (no API call).
        // Default to 'EN' if no Indian signal found; avoids the defensive filter stripping
        // all English channels when target country is unknown.
        targetCountry = 'EN';
        const cacheRow = db.get('SELECT raw_json FROM channel_cache WHERE channel_id = ?', [channel_id]);
        if (cacheRow?.raw_json) {
          try {
            const parsed = JSON.parse(cacheRow.raw_json);
            const apiCountry = parsed?.snippet?.country;
            if (apiCountry) {
              targetCountry = apiCountry.toUpperCase();
            } else {
              const desc = parsed?.snippet?.description || '';
              if (detectScript(desc) || hinglishScore(desc) > 0) targetCountry = 'IN';
            }
          } catch (_) {}
        }
      }
    }

    console.log(`[competitor/channels] channel_id=${channel_id} country=${targetCountry} (${rows.length} candidates)`);

    const targetIsEnglish = targetCountry && EN_REGIONS.has(targetCountry);

    // Bulk fetch titles for untagged competitors AND for EN-tagged ones when target is
    // English — so we can do a secondary Indian-signal check on soft EN tags.
    const needTitlesIds = rows.filter(r => {
      const country = regionMap[r.channel_id];
      if (!country) return true;
      if (targetIsEnglish && country === 'EN') return true;
      if (targetIsEnglish && EN_REGIONS.has(country)) return false; // confirmed EN region, skip
      // Fetch titles for IN competitors when target is IN (including Indian English)
      if (targetCountry === 'IN' && country === 'IN') return true;
      // Indian English: also fetch EN-region titles for the soft-EN Indian-signal check
      if (targetIsIndianEnglish && country === 'EN') return true;
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
          // Indian English creator: accept EN-region channels (no Hindi signal) AND
          // IN-region channels (no regional Indian language). Priority sort handles
          // Indian-first ordering downstream.
          if (targetIsIndianEnglish) {
            if (EN_REGIONS.has(country)) return !hasIndianSignal(ch.channel_id);
            if (country === 'IN') {
              const REGIONAL_LANG_RE = /\b(tamil|telugu|kannada|malayalam|marathi|punjabi|gujarati|odia|bengali|assamese|bhojpuri)\b/i;
              if (REGIONAL_LANG_RE.test(ch.channel_name)) return false;
              const titles = titleMap[ch.channel_id] || [];
              if (titles.some(t => SOUTH_SCRIPT_RE.test(t))) return false;
              if (titles.length >= 3 && titles.some(t => DEVANAGARI_RE.test(t))) return false;
              return true;
            }
            return false;
          }

          // EN-tagged competitor + English-speaking target: secondary Indian-signal check.
          if (targetIsEnglish && country === 'EN') {
            return !hasIndianSignal(ch.channel_id);
          }
          // English target also accepts other EN_REGIONS (US, GB, AU, etc.)
          if (targetIsEnglish && EN_REGIONS.has(country)) return true;
          if (country !== targetCountry) return false;
          // Same country (IN) — exclude if competitor uses a different regional Indian language
          if (country === 'IN') {
            const REGIONAL_LANG_RE = /\b(tamil|telugu|kannada|malayalam|marathi|punjabi|gujarati|odia|bengali|assamese|bhojpuri)\b/i;
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
          if (c) return targetIsIndianEnglish ? false : c === targetCountry;
        }

        // Any Latin-only titles with zero Hinglish → clearly English-speaking
        if (titles.length > 0) {
          const hasHinglish = titles.some(t => hinglishScore(t) > 0);
          if (!hasHinglish) return targetIsEnglish || targetIsIndianEnglish;
          // Hinglish channel: include for Indian creators, exclude for pure EN creators
          return targetCountry === 'IN' && !targetIsIndianEnglish;
        }

        // Zero titles — background job will tag later, keep for now
        return true;
      });

      console.log(`[competitor/channels] filtered → ${rows.length} channels (country=${targetCountry})`);
    } else {
      // Target country unknown — exclude channels that are clearly English-speaking
      // so we don't flood a non-English creator with US/UK channels
      rows = rows.filter(ch => {
        const country = regionMap[ch.channel_id];
        if (country === 'EN') return false;
        if (looksEnglish(ch)) return false;
        return true;
      });
      console.log(`[competitor/channels] target country unknown — defensive filter → ${rows.length} channels`);
    }

    // Subscriber-band filter: show channels within 0.1× – 10× the user's size.
    // Only applied when the caller sends ?subscribers=N and the band yields enough results.
    if (targetSubs && targetSubs > 0) {
      const lo = targetSubs * 0.1;
      const hi = targetSubs * 10;
      const inBand = rows.filter(r => {
        const s = r.channel_subscribers || 0;
        return s >= lo && s <= hi;
      });
      if (inBand.length >= Math.min(limitN, 5)) rows = inBand;
    }

    const final = rows.slice(0, limitN);

    // Peer-relative engagement flag.
    // Compute engagement rate per channel, then flag channels ≥1.5× the group median.
    // Uses avg_comments + avg_likes against avg_views — all already in the row from getTopChannelsByNiche.
    const withEng = final.map(r => {
      const rate = r.avg_views > 0
        ? ((r.avg_likes || 0) + (r.avg_comments || 0)) / r.avg_views
        : 0;
      return { ...r, engagement_rate: rate };
    });
    const rates = withEng.map(r => r.engagement_rate).filter(v => v > 0).sort((a, b) => a - b);
    const median = rates.length ? rates[Math.floor(rates.length / 2)] : 0;
    const flagged = withEng.map(r => ({
      ...r,
      high_engagement: median > 0 && r.engagement_rate >= median * 1.5,
    }));

    res.json({ channels: flagged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /maturity ─────────────────────────────────────────────────────────────

function maturityHandler(req, res) {
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
}

// ── POST /channels/:id/redetect ───────────────────────────────────────────────

async function redetectChannelHandler(req, res) {
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
}

// ── POST /channels/redetect-all ───────────────────────────────────────────────

function redetectAllStart(req, res) {
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
}

// ── GET /channels/redetect-all/:jobId ────────────────────────────────────────

function redetectAllStatus(req, res) {
  const job = bulkJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
}

// ── GET /topic-search ─────────────────────────────────────────────────────────

function topicSearchHandler(req, res) {
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
}

// ── GET /adjacent-ideas ───────────────────────────────────────────────────────

function adjacentIdeasHandler(req, res) {
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
    const adjacentNiches = getCspAwareAdjacentNiches(db, channel_id, resolvedNiche)
      .slice(0, SUPPORT_ADJACENT_NICHE_LIMIT);
    const rc             = getStrictRegionClause(userRegion);

    if (!adjacentNiches.length) return res.json({ ok: true, sources: [] });

    const sources = [];
    for (const adjNiche of adjacentNiches) {
      const channelIds = db.all(
        `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? ${rc} LIMIT ?`,
        [adjNiche, SUPPORT_CHANNEL_LIMIT],
      ).map(r => r.channel_id);

      if (channelIds.length < 3) continue;

      const ideas = analyzeTopics(db, channelIds, userPhraseSet, userSubs, channelIds.length, {
        maxResults: 5, minChannels: 2, minScore: 45,
      });
      if (ideas.length) sources.push({ niche: adjNiche, channel_count: channelIds.length, ideas });
    }

    res.json({ ok: true, sources });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /foreign-signal ───────────────────────────────────────────────────────

// A coarse niche like "education" lumps UPSC/current-affairs channels together with kids shows
// (Numberblocks, Cocomelon). Gate the foreign pool by topic-token overlap so the global signal
// stays on the creator's actual subject, not just their niche label.
const GENERIC_TOPIC_STOP = new Set([
  'learning', 'educational', 'education', 'content', 'skills', 'tips', 'guide', 'basics',
  'knowledge', 'tutorial', 'lessons', 'lesson', 'online', 'course', 'courses', 'channel',
  'videos', 'video', 'daily', 'beginners', 'advanced', 'explained', 'through', 'with', 'your',
]);
function topicTokens(inferredTopicsJson) {
  let arr = [];
  try { arr = JSON.parse(inferredTopicsJson || '[]'); } catch (_) {}
  const out = new Set();
  for (const phrase of arr) {
    for (const w of String(phrase).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)) {
      if (w.length > 3 && !GENERIC_TOPIC_STOP.has(w)) out.add(w);
    }
  }
  return out;
}
const KIDS_TOPIC_RE = /\b(child|children|childhood|kids|kid|nursery|toddler|preschool|toy|toys|rhyme|rhymes|cartoon)\b/i;

function foreignSignalHandler(req, res) {
  try {
    const db       = getDb();
    const { channel_id, niche, subscriber_count } = req.query;
    const userSubs = parseInt(subscriber_count || '0', 10);

    if (!niche && !channel_id) return res.status(400).json({ error: 'niche or channel_id required' });

    let resolvedNiche = niche;
    let userRegion    = null;
    let userTopicsJson = null;
    if (channel_id) {
      const row = db.get(`SELECT niche, region, inferred_topics FROM ingested_channels WHERE channel_id = ?`, [channel_id]);
      if (row?.niche && !resolvedNiche) resolvedNiche = row.niche;
      userRegion = row?.region || null;
      userTopicsJson = row?.inferred_topics || null;
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
    const foreignRows = db.all(
      `SELECT channel_id, inferred_topics FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? AND region IN (${ph}) LIMIT ?`,
      [resolvedNiche, ...FOREIGN_REGIONS, SUPPORT_CHANNEL_LIMIT],
    );

    // Keep only foreign channels that share the creator's actual subject (token overlap), and
    // never surface kids content to a non-kids creator. This stops "education" from pairing a
    // UPSC/current-affairs channel with Numberblocks / nursery-rhyme shows.
    const userTok    = topicTokens(userTopicsJson);
    const userIsKids = KIDS_TOPIC_RE.test(userTopicsJson || '');
    const foreignIds = foreignRows.filter(r => {
      if (!userIsKids && KIDS_TOPIC_RE.test(r.inferred_topics || '')) return false;
      if (!userTok.size) return true; // no topic DNA to gate on — fall back to niche-only
      const ftok = topicTokens(r.inferred_topics);
      for (const t of ftok) if (userTok.has(t)) return true;
      return false;
    }).map(r => r.channel_id);

    if (foreignIds.length < 3) {
      return res.json({ ok: true, supported: true, channel_count: foreignIds.length, ideas: [] });
    }

    const ideas = analyzeTopics(db, foreignIds, userPhraseSet, userSubs, foreignIds.length, {
      maxResults: 8, minChannels: 2, minScore: 45,
    });

    res.json({ ok: true, supported: true, channel_count: foreignIds.length, ideas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /trending-topics ──────────────────────────────────────────────────────

async function trendingTopicsHandler(req, res) {
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

    // Fetch daily trending searches for India. This is an optional support panel,
    // so fail closed instead of letting Google Trends stall the WTP screen.
    let raw;
    try {
      raw = await Promise.race([
        googleTrends.dailyTrends({ geo: 'IN', trendDate: new Date() }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('google_trends_timeout')), SUPPORT_GOOGLE_TRENDS_TIMEOUT_MS)),
      ]);
    } catch (_) {
      return res.json({ ok: true, ideas: [], reason: 'trends_unavailable' });
    }
    const jsonStart = raw.indexOf('{');
    if (jsonStart === -1) {
      return res.json({ ok: true, ideas: [], reason: 'trends_unavailable' });
    }
    let json;
    try {
      json = JSON.parse(raw.slice(jsonStart));
    } catch (_) {
      return res.json({ ok: true, ideas: [], reason: 'trends_unavailable' });
    }
    const trendingSearches = json.default?.trendingSearchesDays?.[0]?.trendingSearches || [];

    const terms = trendingSearches
      .map(s => s.title?.query)
      .filter(Boolean)
      .slice(0, 30);

    if (!terms.length) return res.json({ ok: true, ideas: [] });

    // Get community videos for this niche (last 90d)
    const communityIds = db.all(
      `SELECT channel_id FROM ingested_channels WHERE COALESCE(primary_niche, niche) = ? ${channel_id ? 'AND channel_id != ?' : ''} LIMIT ?`,
      channel_id ? [resolvedNiche, channel_id, SUPPORT_TREND_CHANNEL_LIMIT] : [resolvedNiche, SUPPORT_TREND_CHANNEL_LIMIT],
    ).map(r => r.channel_id);

    if (!communityIds.length) return res.json({ ok: true, ideas: [] });

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ph    = communityIds.map(() => '?').join(',');

    const videos = db.all(
      `SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
              iv.published_at, iv.channel_name
       FROM (
         SELECT iv.youtube_video_id, iv.title, iv.views, iv.channel_id,
                iv.published_at, ic.channel_name,
                ROW_NUMBER() OVER (PARTITION BY iv.channel_id ORDER BY iv.views DESC) AS rn
         FROM ingested_videos iv
         LEFT JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
         WHERE iv.channel_id IN (${ph})
           AND iv.published_at >= ?
           AND iv.title IS NOT NULL
           AND iv.views > 0
       ) iv
       WHERE iv.rn <= 8`,
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
}

// ── GET /lifecycle-health ─────────────────────────────────────────────────────

function lifecycleHealthHandler(req, res) {
  try {
    const db = getDb();

    // ── Task 1: core metrics ───────────────────────────────────────────────
    const totalChannels = db.get(
      `SELECT COUNT(*) AS n FROM ingested_channels WHERE ingest_enabled = 1`,
    ).n;

    const corpus = db.get(`
      SELECT
        COUNT(*)                                               AS total_records,
        COUNT(DISTINCT channel_id)                            AS channels_with_lifecycle,
        SUM(CASE WHEN stage='regular'   THEN 1 ELSE 0 END)   AS regular_count,
        SUM(CASE WHEN stage='saturated' THEN 1 ELSE 0 END)   AS saturated_count,
        SUM(CASE WHEN stage='seed'      THEN 1 ELSE 0 END)   AS seed_count,
        SUM(CASE WHEN stage='early'     THEN 1 ELSE 0 END)   AS early_count,
        SUM(CASE WHEN stage='pre_topic' THEN 1 ELSE 0 END)   AS pre_topic_count,
        SUM(CASE WHEN stage='exiting'   THEN 1 ELSE 0 END)   AS exiting_count
      FROM creator_topic_lifecycle
    `);

    const brand = db.get(`
      SELECT
        AVG(COALESCE(brand_contamination_pct, 0))                                              AS avg_brand_pct,
        SUM(CASE WHEN content_phrases IS NOT NULL AND content_phrases != '' THEN 1 ELSE 0 END) AS content_match_count,
        COUNT(*)                                                                                AS total_identity
      FROM channel_identity
    `);

    const channelsWithSuppression = db.get(`
      SELECT COUNT(DISTINCT channel_id) AS n
      FROM creator_topic_lifecycle
      WHERE stage IN ('regular', 'saturated')
    `).n;

    const total = corpus.total_records || 1;
    const cwl   = corpus.channels_with_lifecycle || 1;

    // ── by_niche breakdown ─────────────────────────────────────────────────
    const nicheRows = db.all(`
      SELECT
        COALESCE(ic.primary_niche, ic.niche)                    AS niche,
        COUNT(DISTINCT ctl.channel_id)                          AS channels_with_lifecycle,
        COUNT(*)                                                AS total_records,
        SUM(CASE WHEN ctl.stage='regular'   THEN 1 ELSE 0 END) AS regular_count,
        SUM(CASE WHEN ctl.stage='saturated' THEN 1 ELSE 0 END) AS saturated_count,
        SUM(CASE WHEN ctl.stage='seed'      THEN 1 ELSE 0 END) AS seed_count
      FROM creator_topic_lifecycle ctl
      JOIN ingested_channels ic ON ic.channel_id = ctl.channel_id
      WHERE ic.ingest_enabled = 1
      GROUP BY 1
      ORDER BY channels_with_lifecycle DESC
      LIMIT 25
    `);

    const byNiche = {};
    for (const r of nicheRows) {
      if (!r.niche) continue;
      const t = r.total_records || 1;
      byNiche[r.niche] = {
        channels_with_lifecycle: r.channels_with_lifecycle,
        total_records:           r.total_records,
        regular_pct:             parseFloat(((r.regular_count   / t) * 100).toFixed(1)),
        saturated_pct:           parseFloat(((r.saturated_count / t) * 100).toFixed(1)),
        seed_pct:                parseFloat(((r.seed_count      / t) * 100).toFixed(1)),
      };
    }

    // ── Task 3: top tables ─────────────────────────────────────────────────
    const topSaturated = db.all(`
      SELECT ctl.channel_id, ic.channel_name,
             COALESCE(ic.primary_niche, ic.niche) AS niche,
             COUNT(*) AS saturated_count
      FROM creator_topic_lifecycle ctl
      JOIN ingested_channels ic ON ic.channel_id = ctl.channel_id
      WHERE ctl.stage = 'saturated' AND ic.ingest_enabled = 1
      GROUP BY ctl.channel_id
      ORDER BY saturated_count DESC
      LIMIT 10
    `);

    const topEvolved = db.all(`
      SELECT ctl.channel_id, ic.channel_name,
             COALESCE(ic.primary_niche, ic.niche) AS niche,
             SUM(CASE WHEN ctl.stage='regular'  THEN 1 ELSE 0 END) AS regular_count,
             SUM(CASE WHEN ctl.stage='early'    THEN 1 ELSE 0 END) AS early_count,
             COUNT(*) AS total_phrases
      FROM creator_topic_lifecycle ctl
      JOIN ingested_channels ic ON ic.channel_id = ctl.channel_id
      WHERE ic.ingest_enabled = 1
      GROUP BY ctl.channel_id
      HAVING regular_count >= 2
      ORDER BY regular_count DESC, early_count DESC
      LIMIT 10
    `);

    const weakQuality = db.all(`
      SELECT ic.channel_id, ic.channel_name,
             COALESCE(ic.primary_niche, ic.niche) AS niche,
             ci.brand_contamination_pct,
             ci.content_phrase_count,
             ci.confidence_tier
      FROM ingested_channels ic
      JOIN channel_identity ci ON ci.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND (ci.content_phrase_count < 2 OR ci.brand_contamination_pct > 0.80)
      ORDER BY ci.brand_contamination_pct DESC, ci.content_phrase_count ASC
      LIMIT 10
    `);

    // ── Task 4: warnings ───────────────────────────────────────────────────
    const brandWarnCount = db.get(
      `SELECT COUNT(*) AS n FROM channel_identity WHERE brand_contamination_pct > 0.70`,
    ).n;

    const lowContentCount = db.get(
      `SELECT COUNT(*) AS n FROM channel_identity WHERE content_phrase_count < 2`,
    ).n;

    const noRegularCount = db.get(`
      SELECT COUNT(*) AS n FROM ingested_channels ic
      JOIN channel_identity ci ON ci.channel_id = ic.channel_id
      WHERE ic.ingest_enabled = 1
        AND ic.added_at < datetime('now', '-60 days')
        AND EXISTS (
          SELECT 1 FROM creator_topic_lifecycle ctl
          WHERE ctl.channel_id = ic.channel_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM creator_topic_lifecycle ctl2
          WHERE ctl2.channel_id = ic.channel_id
            AND ctl2.stage IN ('regular', 'saturated')
        )
    `).n;

    // ── Task 2: trend history (last 14 daily snapshots) ────────────────────
    const trend = db.all(`
      SELECT snapshot_date, channels_with_lifecycle, total_records,
             regular_count, saturated_count, seed_count,
             brand_contamination_pct, content_match_pct
      FROM lifecycle_daily_snapshots
      ORDER BY snapshot_date DESC
      LIMIT 14
    `).reverse();

    res.json({
      ok: true,
      channels_total:           totalChannels,
      channels_with_lifecycle:  corpus.channels_with_lifecycle,
      lifecycle_coverage_pct:   parseFloat(((corpus.channels_with_lifecycle / totalChannels) * 100).toFixed(1)),
      total_records:            corpus.total_records,
      regular_pct:              parseFloat(((corpus.regular_count   / total) * 100).toFixed(1)),
      saturated_pct:            parseFloat(((corpus.saturated_count / total) * 100).toFixed(1)),
      seed_pct:                 parseFloat(((corpus.seed_count      / total) * 100).toFixed(1)),
      early_pct:                parseFloat(((corpus.early_count     / total) * 100).toFixed(1)),
      pre_topic_pct:            parseFloat(((corpus.pre_topic_count / total) * 100).toFixed(1)),
      brand_pct:                parseFloat(((brand.avg_brand_pct || 0) * 100).toFixed(1)),
      content_match_pct:        brand.total_identity > 0
        ? parseFloat(((brand.content_match_count / brand.total_identity) * 100).toFixed(1))
        : 0,
      suppression_rate:         parseFloat(((channelsWithSuppression / cwl) * 100).toFixed(1)),
      by_niche:                 byNiche,
      top_saturated:            topSaturated,
      top_evolved:              topEvolved,
      weak_quality:             weakQuality,
      warnings: {
        brand_contamination: { count: brandWarnCount,  threshold_pct: 70 },
        low_content_phrases: { count: lowContentCount, min_phrases:    2 },
        no_regular_topics:   { count: noRegularCount,  after_days:    60 },
      },
      trend,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /debug-country ────────────────────────────────────────────────────────

async function debugCountryHandler(req, res) {
  try {
    const country = await detectChannelCountry(req.query.channel_id);
    res.json({ channel_id: req.query.channel_id, country });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /competitor/top-videos ────────────────────────────────────────────────

function competitorTopVideosHandler(req, res) {
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
}

// ── GET /competitor/velocity ──────────────────────────────────────────────────

function competitorVelocityHandler(req, res) {
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
}

// ── GET /competitor/upload-frequency ─────────────────────────────────────────

function competitorUploadFrequencyHandler(req, res) {
  try {
    const db = getDb();
    const rows = getUploadFrequency(db, req.query.niche);
    res.json({ channels: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /competitor/format-breakdown ─────────────────────────────────────────

function competitorFormatBreakdownHandler(req, res) {
  try {
    const db = getDb();
    const rows = getFormatBreakdown(db, req.query.niche);
    res.json({ formats: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /content/top-titles ───────────────────────────────────────────────────

function contentTopTitlesHandler(req, res) {
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
}

// ── GET /content/durations ────────────────────────────────────────────────────

function contentDurationsHandler(req, res) {
  try {
    const db = getDb();
    const rows = getBestPerformingDurations(db, req.query.niche);
    res.json({ durations: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /content/rising-formats ──────────────────────────────────────────────

function contentRisingFormatsHandler(req, res) {
  try {
    const db = getDb();
    const rows = getRisingFormats(db, req.query.niche);
    res.json({ formats: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /content/patterns ─────────────────────────────────────────────────────

function contentPatternsHandler(req, res) {
  try {
    const db = getDb();
    const rows = getContentPatterns(db, req.query.niche);
    res.json({ patterns: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /trends/acceleration ──────────────────────────────────────────────────

function trendsAccelerationHandler(req, res) {
  try {
    const db = getDb();
    const { niche, limit } = req.query;
    const rows = getAccelerationSpikes(db, { niche, limit: limit ? parseInt(limit) : 30 });
    res.json({ spikes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /trends/breakout ──────────────────────────────────────────────────────

function trendsBreakoutHandler(req, res) {
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
}

// ── GET /trends/benchmark-drift ───────────────────────────────────────────────

function trendsBenchmarkDriftHandler(req, res) {
  try {
    const db = getDb();
    const rows = getBenchmarkDrift(db, req.query.niche);
    res.json({ history: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /trends/rising-archetypes ─────────────────────────────────────────────

function trendsRisingArchetypesHandler(req, res) {
  try {
    const db = getDb();
    const rows = getRisingArchetypes(db, req.query.niche);
    res.json({ archetypes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── POST /channels/:id/niche ──────────────────────────────────────────────────

function channelNicheHandler(req, res) {
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
}

// ── GET /allowed-niches ───────────────────────────────────────────────────────

function allowedNichesHandler(_req, res) {
  res.json({ niches: ALLOWED_NICHES });
}

// ── GET /niches ───────────────────────────────────────────────────────────────

function nichesHandler(_req, res) {
  try {
    const db = getDb();
    const rows = db.all(`SELECT DISTINCT niche FROM ingested_channels WHERE niche IS NOT NULL ORDER BY niche`);
    res.json({ niches: rows.map(r => r.niche) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── GET /community-hot ────────────────────────────────────────────────────────

function communityHotHandler(req, res) {
  try {
    const db      = getDb();
    if (!req.query.channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });
    const channel = db.get('SELECT * FROM ingested_channels WHERE channel_id = ?', [req.query.channel_id]);
    if (!channel)              return res.status(404).json({ ok: false, error: 'Channel not found' });
    res.json(computeCommunityHot(db, channel, { resolveCreatorPeerContext, cache, DEVANAGARI_RE }));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /world-signals ────────────────────────────────────────────────────────

async function worldSignalsHandler(req, res) {
  try {
    const db             = getDb();
    const { channel_id } = req.query;
    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });
    if (req.query.enable_world_signals !== '1') {
      return res.json({ ok: true, velocity: [], trends: [], reason: 'world_signals_disabled' });
    }

    const channel = db.get(
      'SELECT inferred_topics FROM ingested_channels WHERE channel_id = ?', [channel_id],
    );
    let topics = [];
    try { topics = JSON.parse(channel?.inferred_topics || '[]'); } catch (_) {}

    const { getWorldSignals } = require('../services/worldSignals');
    const signals = await getWorldSignals(db, { channel_id, topics });

    res.json({ ok: true, ...signals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /trends/video-signals ─────────────────────────────────────────────────
// Video-grounded trends (specific title-phrases, examples inline). Replaces the channel-topic
// signals for display — topics are specific and their sample videos always match.
function videoSignalsHandler(req, res) {
  try {
    const db = getDb();
    const { niche, tier, region } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '60', 10), 200);
    let sql = 'SELECT * FROM video_trend_signals WHERE 1=1';
    const params = [];
    if (niche && niche !== 'all')   { sql += ' AND niche = ?';       params.push(niche); }
    if (tier && tier !== 'all')     { sql += ' AND signal_tier = ?'; params.push(tier); }
    if (region && region !== 'all') { sql += ' AND region = ?';      params.push(region); }
    sql += ' ORDER BY signal_score DESC, channel_count_now DESC LIMIT ?';
    params.push(limit);
    let rows = [], computed_at = null, tierCounts = {};
    try {
      rows = db.all(sql, params);
      computed_at = db.get('SELECT MAX(computed_at) AS t FROM video_trend_signals')?.t || null;
      const cSql = niche && niche !== 'all'
        ? 'SELECT signal_tier, COUNT(*) c FROM video_trend_signals WHERE niche = ? GROUP BY signal_tier'
        : 'SELECT signal_tier, COUNT(*) c FROM video_trend_signals GROUP BY signal_tier';
      for (const r of db.all(cSql, niche && niche !== 'all' ? [niche] : [])) tierCounts[r.signal_tier] = r.c;
    } catch (_) { /* table not built yet */ }
    const stale = computed_at ? (Date.now() - new Date(computed_at).getTime()) > 30 * 60 * 60 * 1000 : false;
    // Shape to match the existing SignalCard (channel-topic engine) so the UI renders unchanged.
    // Only populate breakdown rows we HONESTLY have for video-grounded data: creator adoption
    // (channels now vs prior — the core signal) + direction. No fake outperformance/foreign rows.
    res.json({
      ok: true, computed_at, data_stale: stale, tier_counts: tierCounts,
      signals: rows.map(r => {
        const accel = (r.accel_pct || 0) / 100;
        return {
          topic: r.topic, niche: r.niche, region: r.region,
          signal_tier: r.signal_tier, signal_score: r.signal_score,
          channel_count_30d: r.channel_count_now,
          avg_views: r.avg_views,
          avg_outperformance_ratio: 0,
          foreign_channel_count_30d: 0,
          vph_direction: accel > 0.05 ? 'rising' : 'stable',
          samples: r.samples_json ? JSON.parse(r.samples_json) : [],
          score_breakdown: {
            adoption: { channels_now: r.channel_count_now, channels_prior: r.channel_count_prior, acceleration: +accel.toFixed(2), pts: 1 },
            trajectory: { vpd_now: 0, vpd_prior: 0, direction: accel > 0.05 ? 'rising' : 'stable' },
          },
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /trends/for-you ───────────────────────────────────────────────────────
// Personalized trends for a creator: DIRECT (trends in their niche) + CROSS-OVER (big cultural
// trends angled into their niche via AI). 24h-cached per channel.
async function forYouTrendsHandler(req, res) {
  try {
    const db = getDb();
    const { channel_id } = req.query;
    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });
    const { getPersonalizedTrends } = require('../services/personalizedTrends');
    const r = await getPersonalizedTrends(db, channel_id, {});
    res.json({ ok: true, direct: r.direct || [], crossover: r.crossover || [], computed_at: r.computed_at || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /trends/coming-to-india ───────────────────────────────────────────────
// Foreign-led topics (strong US/UK coverage, little/no domestic yet) — precomputed by
// comingToIndiaJob. Fast table read; optional niche filter.
function comingToIndiaHandler(req, res) {
  try {
    const db = getDb();
    const { niche } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);
    let sql = 'SELECT * FROM coming_to_india';
    const params = [];
    if (niche && niche !== 'all') { sql += ' WHERE niche = ?'; params.push(niche); }
    sql += ' ORDER BY foreign_ch DESC, foreign_views_30d DESC LIMIT ?';
    params.push(limit);
    let rows = [], computed_at = null, stale = false;
    try {
      rows = db.all(sql, params);
      computed_at = db.get('SELECT MAX(computed_at) AS t FROM coming_to_india')?.t || null;
      stale = computed_at ? (Date.now() - new Date(computed_at).getTime()) > 26 * 60 * 60 * 1000 : false;
    } catch (_) { /* table not built yet */ }
    res.json({ ok: true, computed_at, data_stale: stale, topics: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /current-events ───────────────────────────────────────────────────────
// Live current-events feed for current-affairs / news creators: the stories breaking on their
// beat (mined from the fresh news-pool corpus) that they haven't covered yet.
function currentEventsHandler(req, res) {
  try {
    const db = getDb();
    const { channel_id } = req.query;
    if (!channel_id) return res.status(400).json({ ok: false, error: 'channel_id required' });
    const { getCurrentEvents } = require('../services/currentEventsFeed');
    const feed = getCurrentEvents(db, channel_id, {
      maxResults: parseInt(req.query.limit || '12', 10),
    });
    res.json({ ok: true, ...feed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /what-to-post ─────────────────────────────────────────────────────────

async function whatToPostHandler(req, res) {
  try {
    const db = getDb();
    // Option A: lazily fix a stale/misclassified niche for THIS channel before computing
    // (once per channel, only when there's a cheap signal of error). Best-effort — never
    // blocks or breaks WTP. Clears its own cache on change so the recompute below uses the
    // corrected niche.
    const _wtpChannelId = String(req.query.channel_id || req.query.channelId || '').trim();
    try { await maybeLazyReclassify(db, _wtpChannelId); } catch (_) {}
    // Lazily refresh stale creator DNA (e.g. pre-native-topic v1 DNA) before computing, so
    // regional channels pick up native-script topics → original bets. The pipeline's
    // up_to_date check makes this a cheap no-op once a channel has been rebuilt to the
    // current version. Best-effort — never blocks WTP. Clears its own WTP cache on rebuild.
    try {
      const _dna = persistCreatorIdeaDnaForPipeline(db, _wtpChannelId, { reason: 'wtp_open_refresh' });
      if (_dna && _dna.ok && !_dna.skipped) { try { db.run(`DELETE FROM channel_wtp_cache WHERE channel_id=?`, [_wtpChannelId]); } catch (_) {} }
    } catch (_) {}
    const result = getCachedOrComputeWhatToPost(
      db,
      req.query,
      buildWhatToPostContext(),
      computeWhatToPost,
    );
    // Attach stable tracking keys — purely additive, idempotent on cache hits
    attachIdeaKeys(result?.ideas, req.query.channel_id);
    const refineOff = req.query.refine === '0' || req.query.refine === 'false';
    // Relevance floor on the peer-signal "ideas" deck: drop low-opportunity / "Quiet" items
    // (e.g. score-38 off-brand peer seeds). DNA original_bets and podcast panels are unaffected.
    // News/current-affairs/exam channels get a LOWER floor: their beat is inherently saturated, so
    // peer-topic opportunity scores are compressed (a real UPSC idea scores ~30-40, not 60+). At the
    // 42 default their deck was empty; now that peer pools are sub-niche/cross-niche clean, a lower
    // floor surfaces relevant-but-saturated ideas without re-admitting off-brand junk.
    const _fMeta = db.get(`SELECT creator_mode, format_profile, COALESCE(primary_niche,niche) AS niche FROM ingested_channels WHERE channel_id=?`, [_wtpChannelId]) || {};
    const _fNewsy = ['news', 'upsc'].includes(_fMeta.creator_mode) || _fMeta.format_profile === 'news_bulletin'
      || ['news', 'politics', 'geopolitics', 'current affairs', 'defence'].includes(String(_fMeta.niche).toLowerCase());
    const _ideasFloor = _fNewsy
      ? parseInt(process.env.WTP_IDEAS_MIN_SCORE_NEWS ?? '30', 10)
      : parseInt(process.env.WTP_IDEAS_MIN_SCORE ?? '42', 10);
    const _applyFloor = (payload) => {
      if (_ideasFloor > 0 && Array.isArray(payload?.ideas)) {
        payload.ideas = payload.ideas.filter(i => (i.score ?? i.wtp_score ?? 0) >= _ideasFloor);
      }
      return payload;
    };

    // The DNA Original Bets shown to the user must come from the AI generator. computeWhatToPost
    // emits legacy template "mad-libs" (e.g. "How X can change your approach", "The beginner mistake
    // behind Y") that exist ONLY as schema scaffolds for the AI to fill — they read as broken when
    // shown raw (esp. for kids/entertainment channels). Capture them as the scaffold, then BLANK the
    // user-facing bets so neither the cold-load partial (ai_pending) nor an AI failure ever surfaces
    // the templates. The AI fills them below; until then the section is empty/pending.
    const _betScaffold = Array.isArray(result?.original_bets?.ideas) ? result.original_bets.ideas
      : (Array.isArray(result?.original_bets) ? result.original_bets : []);
    if (result && result.original_bets && !Array.isArray(result.original_bets)) result.original_bets = { ...result.original_bets, ideas: [], status: 'pending', source: 'ai_generated' };
    else if (result) result.original_bets = [];

    // ── AI enrichment (DNA bets + guest pitches + recommendation refiner) ──────────
    // Each step is 24h-cached, so warm loads are ~instant, but a COLD first open runs two
    // sequential OpenAI calls (~20s) — long enough to trip client/proxy timeouts. This hit
    // current-affairs channels hardest (no cached bets, so they always saw the cold path).
    // Bound the synchronous wait: if enrichment overruns the budget, return the computed result
    // now with ai_pending:true and let enrichment finish in the BACKGROUND to warm the caches;
    // the client re-polls and the next fetch is a fast cache hit with the full AI output.
    const _enrich = (async () => {
      // Stream A — AI-generate the DNA Original Bets (channel DNA × region signal × novelty gate).
      try {
        const _meta = db.get(`SELECT channel_name, region, COALESCE(primary_niche,niche) AS niche, format_type, format_profile, content_archetype, primary_language FROM ingested_channels WHERE channel_id=?`, [_wtpChannelId]) || {};
        const _gen = await generateOriginalBets(db, _wtpChannelId, _betScaffold, { ..._meta, limit: parseInt(process.env.WTP_BET_LIMIT ?? '20', 10) });
        if (_gen && _gen.length) {
          if (result.original_bets && !Array.isArray(result.original_bets)) result.original_bets = { ...result.original_bets, ideas: _gen, status: 'ready', source: 'ai_generated' };
          else result.original_bets = _gen;
        }
      } catch (_) { /* leave bets blank (no mad-libs) on any failure */ }
      // Guest pitches — for net-new guests, attach a channel-fitted topic + fit line.
      try {
        const _guests = result?.podcast_intel?.guests;
        if (Array.isArray(_guests) && _guests.length) {
          const _gmeta = db.get(`SELECT channel_name, COALESCE(primary_niche,niche) AS niche FROM ingested_channels WHERE channel_id=?`, [_wtpChannelId]) || {};
          const _pitches = await generateGuestPitches(db, _wtpChannelId, _guests, { ..._gmeta, target_lanes: result.podcast_intel.target_lanes || [] });
          if (_pitches) {
            for (const g of _guests) {
              const p = _pitches[g.name];
              if (p) { g.suggested_topic = p.topic; g.fit_reason = p.fit; }
            }
            const _withTopic = _guests.filter(g => g.suggested_topic);
            if (_withTopic.length) result.podcast_intel.guests = _withTopic;
          }
        }
      } catch (_) { /* leave guests unchanged on any failure */ }
      // AI synthesis refiner (primary generator; lifts recs 1.56→3.45/5 on the audit).
      const refined = refineOff ? result : await refineWtpRecommendations(db, result, req.query);
      return _applyFloor(refined);
    })();

    const AI_BUDGET_MS = parseInt(process.env.WTP_AI_BUDGET_MS ?? '7000', 10);
    let _budgetTimer;
    const _budget = new Promise(r => { _budgetTimer = setTimeout(() => r('__WTP_AI_TIMEOUT__'), AI_BUDGET_MS); });
    const _raced = await Promise.race([_enrich, _budget]);
    if (_raced === '__WTP_AI_TIMEOUT__') {
      _enrich.catch(() => {}); // keep running to warm the 24h caches; swallow late rejection
      return res.json({ ..._applyFloor(result), ai_pending: true });
    }
    clearTimeout(_budgetTimer);
    res.json(_raced);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// ── GET /trends/topics ────────────────────────────────────────────────────────

const ORIGINAL_BET_FEEDBACK_ACTIONS = new Set(['shown', 'saved', 'dismissed', 'acted', 'published', 'rated']);
const SUGGESTION_HISTORY_ACTION_COLUMN = {
  shown: 'shown_at',
  saved: 'saved_at',
  dismissed: 'dismissed_at',
  acted: 'seen_at',
  published: 'published_at',
  rated: 'validated_at',
};

function normalizeRating(value) {
  if (value == null || value === '') return null;
  const rating = Number(value);
  if (!Number.isFinite(rating)) return NaN;
  return Math.max(1, Math.min(5, Math.round(rating)));
}

function originalBetFeedbackHandler(req, res) {
  try {
    const db = getDb();
    const body = req.body || {};
    const channelId = String(body.channel_id || body.channelId || '').trim();
    const topic = String(body.topic || body.title || '').trim();
    const action = String(body.action || '').trim().toLowerCase();

    if (!channelId) return res.status(400).json({ ok: false, error: 'channel_id required' });
    if (!topic) return res.status(400).json({ ok: false, error: 'topic required' });
    if (!ORIGINAL_BET_FEEDBACK_ACTIONS.has(action)) {
      return res.status(400).json({ ok: false, error: 'invalid action' });
    }

    const rating = normalizeRating(body.rating);
    if (Number.isNaN(rating)) return res.status(400).json({ ok: false, error: 'rating must be a number' });

    const ideaKey = String(body.idea_key || body.ideaKey || '').trim() ||
      createOriginalBetIdeaKey(channelId, topic);
    const latestSnapshot = readLatestCreatorDnaSnapshot(db, channelId);
    const sourceVersion = Number(body.source_version || body.sourceVersion || 1) || 1;
    const metadata = {
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      ui_source: body.ui_source || body.uiSource || 'wtp_v2',
    };
    const snapshotId = body.dna_snapshot_id || body.dnaSnapshotId || latestSnapshot?.id || null;

    const info = db.run(
      `INSERT INTO original_bet_feedback (
         channel_id, idea_key, topic, action, rating, notes,
         source_version, dna_snapshot_id, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        channelId,
        ideaKey,
        topic,
        action,
        rating,
        body.notes ? String(body.notes).slice(0, 2000) : null,
        sourceVersion,
        snapshotId,
        JSON.stringify(metadata),
      ],
    );

    const historyColumn = SUGGESTION_HISTORY_ACTION_COLUMN[action];
    if (historyColumn) {
      db.run(
        `INSERT INTO suggestion_history (
           channel_id, suggestion_key, raw_topic, source, shown_at, ${historyColumn}, metadata_json, created_at
         ) VALUES (?, ?, ?, 'original_bet', datetime('now'), datetime('now'), ?, datetime('now'))
         ON CONFLICT(channel_id, suggestion_key) DO UPDATE SET
           raw_topic = excluded.raw_topic,
           source = excluded.source,
           ${historyColumn} = excluded.${historyColumn},
           metadata_json = excluded.metadata_json`,
        [channelId, ideaKey, topic, JSON.stringify(metadata)],
      );
    }

    res.json({ ok: true, id: info.lastInsertRowid, idea_key: ideaKey, dna_snapshot_id: snapshotId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

function trendsTopicsHandler(req, res) {
  try {
    const db    = getDb();
    const niche = req.query.niche || null;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

    const rows = getTopicVelocity(db, { niche, limit });

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
}

// ── GET /evolution/:channel_id ────────────────────────────────────────────────

function evolutionHandler(req, res) {
  try {
    const db             = getDb();
    const { channel_id } = req.params;
    const period         = req.query.period || '30d';

    const row = db.get(
      'SELECT * FROM channel_evolution_summary WHERE channel_id = ? AND period = ?',
      [channel_id, period],
    );
    if (!row) return res.json({ ok: false, no_data: true });

    let topics = [];
    let notable = null;
    try { topics  = JSON.parse(row.topics_maintained || '[]'); } catch (_) {}
    try { notable = row.notable_event ? JSON.parse(row.notable_event) : null; } catch (_) {}

    const isStale = row.computed_at &&
      (Date.now() - new Date(row.computed_at).getTime()) > 26 * 60 * 60 * 1000;

    res.json({
      ok: true,
      channel_id,
      period,
      view_change_pct:  row.view_change_pct,
      upload_delta:     row.upload_delta,
      avg_views:        row.avg_views,
      peak_views:       row.peak_views,
      video_count:      row.video_count,
      topics:           topics.slice(0, 12),
      notable_event:    notable,
      data_freshness:   row.computed_at,
      data_stale:       isStale || undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /topic-trend ──────────────────────────────────────────────────────────

function topicTrendHandler(req, res) {
  try {
    const db     = getDb();
    const topic  = (req.query.topic || '').toLowerCase().trim();
    const period = req.query.period || '30d';
    if (!topic) return res.status(400).json({ ok: false, error: 'topic required' });

    const row = db.get(
      `SELECT * FROM topic_community_stats
       WHERE (topic = ? OR topic LIKE ?) AND period = ?
       ORDER BY channel_count DESC LIMIT 1`,
      [topic, `%${topic}%`, period],
    );
    if (!row) return res.json({ ok: false, no_data: true, topic });

    const isStale = row.computed_at &&
      (Date.now() - new Date(row.computed_at).getTime()) > 26 * 60 * 60 * 1000;

    res.json({
      ok: true,
      topic:          row.topic,
      period,
      channel_count:  row.channel_count,
      avg_views:      row.avg_views,
      total_views:    row.total_views,
      velocity_trend: row.velocity_trend || 'stable',
      data_freshness: row.computed_at,
      data_stale:     isStale || undefined,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /signals ──────────────────────────────────────────────────────────────

function signalsHandler(req, res) {
  try {
    const db    = getDb();
    const { niche, tier, sort = 'score', limit = '60' } = req.query;

    let sql = 'SELECT * FROM topic_signal_stats WHERE 1=1';
    const params = [];
    if (niche) { sql += ' AND niche = ?'; params.push(niche); }
    if (tier)  { sql += ' AND signal_tier = ?'; params.push(tier); }

    const orderCol = sort === 'channels' ? 'channel_count_30d DESC'
                   : sort === 'ratio'    ? 'avg_outperformance_ratio DESC'
                   : 'signal_score DESC, channel_count_30d DESC';
    sql += ` ORDER BY ${orderCol} LIMIT ?`;
    params.push(Math.min(parseInt(limit, 10) || 60, 200));

    const rows = db.all(sql, params);

    const isStale = rows[0]?.computed_at &&
      (Date.now() - new Date(rows[0].computed_at).getTime()) > 26 * 60 * 60 * 1000;

    const countsSql = niche
      ? 'SELECT signal_tier, COUNT(*) as cnt FROM topic_signal_stats WHERE niche = ? GROUP BY signal_tier'
      : 'SELECT signal_tier, COUNT(*) as cnt FROM topic_signal_stats GROUP BY signal_tier';
    const counts = db.all(countsSql, niche ? [niche] : []);
    const tierCounts = {};
    for (const r of counts) tierCounts[r.signal_tier] = r.cnt;

    res.json({
      ok:          true,
      data_stale:  isStale || false,
      computed_at: rows[0]?.computed_at || null,
      tier_counts: tierCounts,
      signals:     rows.map(r => ({
        ...r,
        score_breakdown: r.score_breakdown ? JSON.parse(r.score_breakdown) : null,
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

// ── GET /signals/videos ───────────────────────────────────────────────────────

function signalsVideosHandler(req, res) {
  try {
    const db    = getDb();
    const { topic } = req.query;
    if (!topic) return res.status(400).json({ error: 'topic required' });

    // The topic string is already specific — do NOT filter by ic.niche. The signal's niche is the
    // TOPIC's classified niche (e.g. "entertainment" for "arabic drama series"), but the channels
    // covering it carry their own niche label ("arabic drama series"), so a niche filter matched
    // nothing and showed zero example videos. Topic alone is the correct join.
    const sql = `
      SELECT iv.youtube_video_id, iv.title, iv.views, iv.published_at,
             ic.channel_name, ic.niche, ic.region
      FROM ingested_videos iv
      JOIN channel_topics  ct ON ct.channel_id = iv.channel_id
      JOIN ingested_channels ic ON ic.channel_id = iv.channel_id
      WHERE ct.topic = ?
        AND iv.published_at > datetime('now','-30 days')
        AND iv.views > 0
      GROUP BY iv.youtube_video_id ORDER BY iv.views DESC LIMIT 6
    `;
    res.json({ ok: true, videos: db.all(sql, [topic]) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = {
  competitorChannelsHandler,
  maturityHandler,
  redetectChannelHandler,
  redetectAllStart,
  redetectAllStatus,
  topicSearchHandler,
  adjacentIdeasHandler,
  foreignSignalHandler,
  trendingTopicsHandler,
  lifecycleHealthHandler,
  debugCountryHandler,
  competitorTopVideosHandler,
  competitorVelocityHandler,
  competitorUploadFrequencyHandler,
  competitorFormatBreakdownHandler,
  contentTopTitlesHandler,
  contentDurationsHandler,
  contentRisingFormatsHandler,
  contentPatternsHandler,
  trendsAccelerationHandler,
  trendsBreakoutHandler,
  trendsBenchmarkDriftHandler,
  trendsRisingArchetypesHandler,
  channelNicheHandler,
  allowedNichesHandler,
  nichesHandler,
  communityHotHandler,
  worldSignalsHandler,
  currentEventsHandler,
  comingToIndiaHandler,
  videoSignalsHandler,
  forYouTrendsHandler,
  whatToPostHandler,
  originalBetFeedbackHandler,
  trendsTopicsHandler,
  evolutionHandler,
  topicTrendHandler,
  signalsHandler,
  signalsVideosHandler,
};
