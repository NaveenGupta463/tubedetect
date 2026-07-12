'use strict';

/**
 * Corpus Scheduler — Phase XI Daily Autonomous Orchestration
 *
 * Runs the corpus expansion cycle whenever the system has been up for
 * at least MIN_RUN_INTERVAL_HOURS (default 24h) since the last successful run.
 *
 * SCHEDULING STRATEGY (no fixed cron time):
 *   - On startup: if last run was >24h ago (or never), run after STARTUP_DELAY_MS
 *   - Every CHECK_INTERVAL_MS: check again — catches missed runs after downtime
 *   This means the job runs ~daily but is resilient to offline periods.
 *
 * QUOTA BUDGET:
 *   Default MAX_QUOTA_PER_CYCLE = 10000 units (growth-first seeded pool expansion)
 *   The cycle tracks quota consumed and stops early if budget is exhausted.
 *   Set CORPUS_QUOTA_BUDGET env var to override (e.g. CORPUS_QUOTA_BUDGET=10000).
 */

const crypto = require('crypto');
const { getDb }                  = require('../db/init');
const quotaGuard                 = require('./quotaGuard');
const { runDiscoveryCycle }      = require('./discoveryAgent');
const { lightIngestChannelFull } = require('./lightIngestAgent');
const { evaluateChannelQuality } = require('./qualityAgent');
const { runFullEvaluationPass, runFullEvaluationPassAsync } = require('./trainingAgent');
const { rescoreAllChannels, planQuotaAllocation, estimateChannelCapacity } = require('./priorityEngine');
const { runTrustEvaluationPass, initializeProbation }   = require('./trainingTrustEngine');
const { runAIDiscoveryCycle }                            = require('./aiDiscoveryAgent');
const { runDiversityPressurePass }                       = require('./diversityPressureEngine');
const { runDecayCycle, initializeEdgeStrengths }         = require('./relationshipDecayEngine');
const { captureTopologySnapshot }                        = require('./topologyHealthEngine');
const { runDriftDetection }                              = require('./semanticDriftEngine');
const { runMaturityCheck }                               = require('./governanceMaturityEngine');
const { runEcologyInferencePass }                        = require('./attentionEcologyEngine');
const { runCreatorDiscoveryResolver }                    = require('../scripts/resolveCreatorDiscoveryCandidates');
const {
  getCorpusChannelsForQualityEval,
  getCorpusChannelsForLightIngest,
  getStaleChannels,
  markRefreshed,
  getAutoPromotionCandidates,
  markCorpusAutoPromoted,
  getUnclassifiedCorpusChannels,
  getCorpusVideoTitles,
  updateCorpusChannelNiche,
  migrateIngestedVideosToCorpus,
  normalizeGraphDiscoveryAdmissionState,
} = require('../db/corpusQueries');
const { upsertIngestedChannel } = require('../db/queries');
const { classifyChannel }       = require('./channelClassifier');

const MIN_RUN_INTERVAL_HOURS = parseInt(process.env.CORPUS_RUN_INTERVAL_HOURS ?? '24', 10);
const STARTUP_DELAY_MS       = 3 * 60_000;   // 3 min after boot — lets server handle requests first
const CHECK_INTERVAL_MS      = 30 * 60 * 1000; // recheck every 30 minutes
function maxQuotaPerCycle() {
  return parseInt(process.env.CORPUS_QUOTA_BUDGET ?? '50000', 10);
}

function creatorGraphResolveQuota() {
  return parseInt(process.env.CREATOR_GRAPH_RESOLVE_QUOTA ?? '300', 10);
}

function creatorGraphHandleCap() {
  return parseInt(process.env.CREATOR_GRAPH_HANDLE_CAP ?? '150', 10);
}

function aiDiscoveryQuotaCap() {
  return parseInt(process.env.CORPUS_AI_DISCOVERY_QUOTA ?? '25', 10);
}

function aiDiscoveryMaxNiches() {
  return parseInt(process.env.CORPUS_AI_DISCOVERY_MAX_NICHES ?? '1', 10);
}

function aiDiscoverySkipIfSearchAdded() {
  return parseInt(process.env.CORPUS_AI_SKIP_IF_SEARCH_ADDED ?? '500', 10);
}

function corpusLightIngestLimit() {
  return parseInt(process.env.CORPUS_LIGHT_INGEST_LIMIT ?? '3000', 10);
}

function isReferenceLikeTitle(title = '') {
  const s = String(title || '').toLowerCase();
  return [
    'windows', 'burger king', 'visit dubai', 'visit qatar', 'epidemic sound',
    'alienware', 'marine corps', 'live nation', 'microsoft', 'adobe',
    'makeup by mario', 'kaybykatrina', 'mahindra thar',
  ].some(x => s.includes(x));
}

function shouldSkipGrowthLightIngest(ch) {
  if (process.env.CORPUS_GROWTH_ONLY !== '1') return false;
  const source = ch.discovery_source || '';
  const subs = ch.subscriber_count ?? 0;
  const videos = ch.video_count ?? 0;
  const isIndiaTagged = ch.yt_country === 'IN' || ch.country === 'IN';
  const foreignSearchBacklog = new Set([
    'video_search_es',
    'video_search_pt',
    'video_search_id',
    'spanish_keyword_search',
    'portuguese_keyword_search',
    'indonesian_keyword_search',
  ]);

  if (foreignSearchBacklog.has(source) && !isIndiaTagged) return true;
  if (
    (
      source.startsWith('video_search') ||
      source.includes('keyword_search') ||
      source === 'trending_IN' ||
      source === 'emerging_IN'
    ) &&
    videos < 5
  ) return true;

  if (source === 'description_handle_link') {
    if (isReferenceLikeTitle(ch.title)) return true;
    if (subs < 1000 || subs > 10000000) return true;
    if (videos > 0 && videos < 5) return true;
  }

  if (source === 'comment_harvest_IN' && (subs < 2000 || videos < 10)) return true;
  return false;
}

function discoverySearchFraction() {
  const raw = parseFloat(process.env.CORPUS_DISCOVERY_SEARCH_FRACTION ?? '0.55');
  if (!Number.isFinite(raw)) return 0.55;
  return Math.min(0.75, Math.max(0.1, raw));
}

function searchPlanForQuota(units) {
  const slots = Math.max(0, Math.floor(units / 101));
  const plan = {
    maxSearches: 0, maxVideoSearches: 0,
    maxUsSearches: 0, maxGbSearches: 0,
    maxHindiSearches: 0, maxTamilSearches: 0, maxTeluguSearches: 0,
    maxBengaliSearches: 0, maxKannadaSearches: 0, maxMalayalamSearches: 0,
    maxSpanishSearches: 0, maxPortugueseSearches: 0, maxIndonesianSearches: 0,
    maxArabicSearches: 0, maxPunjabiSearches: 0,
  };
  if (slots <= 0) return plan;

  let remaining = slots;
  function take(desired, cap) {
    const n = Math.max(0, Math.min(cap, desired, remaining));
    remaining -= n;
    return n;
  }

  // Video search is the best scalable source now: it returns uploader channels
  // from thin niches, while channel-search keywords saturate faster.
  plan.maxVideoSearches = take(
    Math.max(1, Math.floor(slots * 0.45)),
    parseInt(process.env.DISCOVERY_MAX_VIDEO_SEARCHES ?? '160', 10),
  );
  plan.maxSearches = take(
    Math.max(1, Math.floor(slots * 0.18)),
    parseInt(process.env.DISCOVERY_MAX_EN_SEARCHES ?? '60', 10),
  );
  // US/UK expansion — region-targeted English. Prioritized ahead of regional langs so
  // the pipeline focuses on these markets going forward. Tune via DISCOVERY_MAX_US/GB_SEARCHES.
  plan.maxUsSearches = take(
    Math.max(1, Math.floor(slots * 0.15)),
    parseInt(process.env.DISCOVERY_MAX_US_SEARCHES ?? '80', 10),
  );
  plan.maxGbSearches = take(
    Math.max(1, Math.floor(slots * 0.08)),
    parseInt(process.env.DISCOVERY_MAX_GB_SEARCHES ?? '40', 10),
  );

  const regionalOrder = [
    ['maxHindiSearches',      'DISCOVERY_MAX_HINDI_SEARCHES',      40, 2],
    ['maxTamilSearches',      'DISCOVERY_MAX_TAMIL_SEARCHES',      28, 1],
    ['maxTeluguSearches',     'DISCOVERY_MAX_TELUGU_SEARCHES',     28, 1],
    ['maxPunjabiSearches',    'DISCOVERY_MAX_PUNJABI_SEARCHES',    24, 1],
    ['maxBengaliSearches',    'DISCOVERY_MAX_BENGALI_SEARCHES',    24, 1],
    ['maxKannadaSearches',    'DISCOVERY_MAX_KANNADA_SEARCHES',    24, 1],
    ['maxMalayalamSearches',  'DISCOVERY_MAX_MALAYALAM_SEARCHES',  24, 1],
    ['maxArabicSearches',     'DISCOVERY_MAX_ARABIC_SEARCHES',     12, 1],
    ['maxSpanishSearches',    'DISCOVERY_MAX_SPANISH_SEARCHES',    12, 1],
    ['maxPortugueseSearches', 'DISCOVERY_MAX_PORTUGUESE_SEARCHES', 12, 1],
    ['maxIndonesianSearches', 'DISCOVERY_MAX_INDONESIAN_SEARCHES', 12, 1],
  ];

  let idx = 0;
  while (remaining > 0 && idx < regionalOrder.length * 50) {
    const [key, envKey, defaultCap, weight] = regionalOrder[idx % regionalOrder.length];
    const cap = parseInt(process.env[envKey] ?? String(defaultCap), 10);
    if (plan[key] < cap) {
      const grant = Math.min(weight, cap - plan[key], remaining);
      plan[key] += grant;
      remaining -= grant;
    }
    idx++;
  }

  return plan;
}

let isRunning    = false;
let checkTimer   = null;

// ── DB-persisted run log ──────────────────────────────────────────────────────

function getLastCompletedRun(db) {
  return db.get(
    `SELECT * FROM corpus_run_log WHERE status = 'complete' ORDER BY started_at DESC LIMIT 1`,
  );
}

function startRunLog(db, quotaBudget) {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO corpus_run_log (id, started_at, status, quota_budget)
     VALUES (?, datetime('now'), 'running', ?)`,
    [id, quotaBudget],
  );
  return id;
}

function cleanupStaleRunLogs(db, maxAgeHours = 12) {
  const info = db.run(
    `UPDATE corpus_run_log
     SET status = 'failed',
         completed_at = COALESCE(completed_at, datetime('now')),
         error = COALESCE(error, 'stale running corpus cycle marked failed on scheduler startup')
     WHERE status = 'running'
       AND started_at < datetime('now', ?)`,
    [`-${maxAgeHours} hours`],
  );
  return info.changes ?? 0;
}

function getPendingCreatorGraphCandidates(db) {
  try {
    return db.get(
      `SELECT COUNT(*) AS n
       FROM creator_discovery_candidates
       WHERE status = 'pending'
         AND score >= 40`,
    )?.n ?? 0;
  } catch (_) {
    return 0;
  }
}

function finalizeRunLog(db, id, { ok, quota_used, channels_ingested, channels_evaluated,
                                   channels_promoted, channels_demoted, discovery_synced,
                                   error, log }) {
  db.run(
    `UPDATE corpus_run_log SET
       completed_at        = datetime('now'),
       status              = ?,
       quota_used          = ?,
       channels_ingested   = ?,
       channels_evaluated  = ?,
       channels_promoted   = ?,
       channels_demoted    = ?,
       discovery_synced    = ?,
       error               = ?,
       log_json            = ?
     WHERE id = ?`,
    [
      ok ? 'complete' : 'failed',
      quota_used ?? 0,
      channels_ingested ?? 0,
      channels_evaluated ?? 0,
      channels_promoted ?? 0,
      channels_demoted ?? 0,
      discovery_synced ?? 0,
      error ?? null,
      JSON.stringify(log ?? []),
      id,
    ],
  );
}

// ── Eligibility check ─────────────────────────────────────────────────────────

function shouldRun(db) {
  if (isRunning) return false;
  const last = getLastCompletedRun(db);
  if (!last) return true; // never run
  const hoursAgo = (Date.now() - new Date(last.started_at).getTime()) / 3_600_000;
  return hoursAgo >= MIN_RUN_INTERVAL_HOURS;
}

function runAutoPromotePass(db, record) {
  const qualityThreshold = Math.max(50, parseFloat(process.env.CORPUS_AUTO_PROMOTE_THRESHOLD ?? '60'));
  const candidates       = getAutoPromotionCandidates(db, { qualityThreshold });
  let promoted = 0;
  for (const ch of candidates) {
    const isIndian = ch.yt_country === 'IN' || ch.country === 'IN';
    const langCode = ch.yt_default_language?.split('-')[0]?.toLowerCase()
      ?? ch.language?.split?.('-')?.[0]?.toLowerCase?.()
      ?? null;
    const isEnglish = !langCode || langCode === 'en';
    const allowIndianLocalLanguage = process.env.CORPUS_PROMOTE_INDIAN_LOCAL_LANG !== '0';
    if (!isEnglish && !(isIndian && allowIndianLocalLanguage)) continue;
    if (!ch.training_eligible || ch.is_spam || (ch.quality_score ?? 0) < qualityThreshold || !ch.niche) continue;

    try {
      upsertIngestedChannel(db, {
        id:                     crypto.randomUUID(),
        channel_id:             ch.channel_id,
        channel_name:           ch.title ?? ch.handle ?? ch.channel_id,
        niche:                  ch.niche,
        uploads_playlist_id:    ch.uploads_playlist_id ?? null,
        channel_subscribers:    ch.subscriber_count ?? null,
        added_by:               'auto_promote',
        ignore_from_benchmarks: ch.yt_country && ch.yt_country !== 'IN',
        community_id:           ch.community_id ?? null,
        notes:                  `Auto-promoted from corpus. quality_score=${ch.quality_score?.toFixed(2)}`,
      });
      markCorpusAutoPromoted(db, ch.channel_id);
      promoted++;
    } catch (e) {
      record('auto_promote_channel_error', { channel_id: ch.channel_id, error: e.message });
    }
  }
  const result = { promoted, candidates: candidates.length, threshold: qualityThreshold };
  record('auto_promote', result);
  return result;
}

// ── Main cycle ────────────────────────────────────────────────────────────────

// mode: 'full' (default) | 'discover' (find+ingest only) | 'promote' (evaluate+promote only)
async function runCorpusCycle({ allowSearch = false, allowAIDiscovery = false, allowCulturalExpansion = false, allowHindiSearch = false, allowTamilSearch = false, allowTeluguSearch = false, allowBengaliSearch = false, allowKannadaSearch = false, allowMalayalamSearch = false, allowSpanishSearch = false, allowPortugueseSearch = false, allowIndonesianSearch = false, allowArabicSearch = false, allowPunjabiSearch = false, allowUsSearch = false, allowGbSearch = false, allowVideoSearch = false, quotaBudget, mode = 'full' } = {}) {
  if (isRunning) {
    console.log('[corpusScheduler] Cycle already running — skipping');
    return { skipped: true, reason: 'already_running' };
  }

  isRunning          = true;
  const db           = getDb();
  const startMs      = Date.now();
  const budget       = quotaBudget ?? maxQuotaPerCycle();
  const log          = [];
  let   cycleQuota   = 0; // quota consumed this cycle

  const staleRunsMarked = cleanupStaleRunLogs(db);
  const runId = startRunLog(db, budget);

  function record(step, data) {
    // Strip niche_gaps from console output — it's huge and unreadable in logs
    const { niche_gaps: _ng, ...printable } = (data && typeof data === 'object') ? data : { _: data };
    console.log(`[corpusScheduler] ${step}:`, JSON.stringify(printable));
    log.push({ step, data, ts: new Date().toISOString() });
    try {
      db.run('UPDATE corpus_run_log SET log_json = ? WHERE id = ?', [JSON.stringify(log), runId]);
    } catch (_) {}
  }

  function quotaLeft() { return budget - cycleQuota; }

  function canSpend(units) {
    if (cycleQuota + units > budget) return false;
    return quotaGuard.quotaAvailable(units);
  }

  function spend(units, tag = 'corpus') {
    cycleQuota += units;
    quotaGuard.recordUsage(units, tag);
  }

  function accountExternalQuota(units) {
    cycleQuota += units;
  }

  const summary = {
    quota_used: 0, channels_ingested: 0, channels_evaluated: 0,
    channels_promoted: 0, channels_demoted: 0, discovery_synced: 0,
  };

  try {
    record('start', { budget, quota_left: quotaLeft(), run_id: runId, stale_runs_marked: staleRunsMarked });

    // ── Step 1: Quota plan ────────────────────────────────────────────────────
    const usedToday    = quotaGuard.getUsedToday?.() ?? 0;
    const noSearch     = !allowSearch && !allowHindiSearch && !allowTamilSearch && !allowTeluguSearch
                         && !allowBengaliSearch && !allowKannadaSearch && !allowMalayalamSearch
                         && !allowSpanishSearch && !allowPortugueseSearch && !allowIndonesianSearch
                         && !allowArabicSearch && !allowPunjabiSearch && !allowUsSearch && !allowGbSearch && !allowVideoSearch && !allowAIDiscovery;
    // When no search flags are set (ingest-only mode), give the full budget to ingestion
    // instead of splitting it via planQuotaAllocation which only allocates 50% to expansion.
    const allocation   = noSearch
      ? { corpus_expansion: budget, refresh_update: 0, user_actions: 0, experimental_discovery: 0 }
      : planQuotaAllocation(Math.max(0, budget - usedToday));
    const expansionCap = estimateChannelCapacity(allocation.corpus_expansion);
    const refreshCap   = estimateChannelCapacity(allocation.refresh_update);
    record('quota_plan', { budget, used_today: usedToday, allocation, expansionCap, refreshCap });

    // ── Step 2: Zero-quota discovery (no API calls) ───────────────────────────
    const discovery = await runDiscoveryCycle(db, { allowSearch: false });

    summary.discovery_synced = (discovery.synced_ingested ?? 0) + (discovery.synced_approved ?? 0);
    record('discovery', discovery);
    let searchNewChannels = 0;

    // ── Step 3: API-based keyword search across all underrepresented niches ──────
    if (mode === 'promote') { record('discovery_search_skipped', { reason: 'promote_mode' }); }
    else if ((allowSearch || allowHindiSearch || allowTamilSearch || allowTeluguSearch
      || allowBengaliSearch || allowKannadaSearch || allowMalayalamSearch
      || allowSpanishSearch || allowPortugueseSearch || allowIndonesianSearch
      || allowArabicSearch || allowPunjabiSearch || allowUsSearch || allowGbSearch || allowVideoSearch) && canSpend(100)) {
      const { runDiscoveryCycle: runSearch } = require('./discoveryAgent');
      const searchBudget = Math.floor(quotaLeft() * discoverySearchFraction());
      const searchPlan = searchPlanForQuota(searchBudget);
      const searchResult = await runSearch(db, {
        allowSearch,            maxSearches: searchPlan.maxSearches,
        allowHindiSearch,       maxHindiSearches: searchPlan.maxHindiSearches,
        allowTamilSearch,       maxTamilSearches: searchPlan.maxTamilSearches,
        allowTeluguSearch,      maxTeluguSearches: searchPlan.maxTeluguSearches,
        allowBengaliSearch,     maxBengaliSearches: searchPlan.maxBengaliSearches,
        allowKannadaSearch,     maxKannadaSearches: searchPlan.maxKannadaSearches,
        allowMalayalamSearch,   maxMalayalamSearches: searchPlan.maxMalayalamSearches,
        allowSpanishSearch,     maxSpanishSearches: searchPlan.maxSpanishSearches,
        allowPortugueseSearch,  maxPortugueseSearches: searchPlan.maxPortugueseSearches,
        allowIndonesianSearch,  maxIndonesianSearches: searchPlan.maxIndonesianSearches,
        allowArabicSearch,      maxArabicSearches: searchPlan.maxArabicSearches,
        allowPunjabiSearch,     maxPunjabiSearches: searchPlan.maxPunjabiSearches,
        allowUsSearch,          maxUsSearches: searchPlan.maxUsSearches,
        allowGbSearch,          maxGbSearches: searchPlan.maxGbSearches,
        allowVideoSearch,       maxVideoSearches: searchPlan.maxVideoSearches,
      });
      // quotaGuard is recorded inside discoveryAgent; account here only for this cycle's budget.
      const keywordSearchesRun = (searchResult.searches_run ?? 0) + (searchResult.hindi_searches_run ?? 0)
        + (searchResult.tamil_searches_run ?? 0) + (searchResult.telugu_searches_run ?? 0)
        + (searchResult.bengali_searches_run ?? 0) + (searchResult.kannada_searches_run ?? 0)
        + (searchResult.malayalam_searches_run ?? 0) + (searchResult.spanish_searches_run ?? 0)
        + (searchResult.portuguese_searches_run ?? 0) + (searchResult.indonesian_searches_run ?? 0)
        + (searchResult.arabic_searches_run ?? 0) + (searchResult.punjabi_searches_run ?? 0)
        + (searchResult.us_searches_run ?? 0) + (searchResult.gb_searches_run ?? 0);
      const searchQuotaUsed = keywordSearchesRun * 101 + (searchResult.video_searches_run ?? 0) * 101;
      searchNewChannels = (searchResult.search_discovered ?? 0)
        + (searchResult.hindi_discovered ?? 0)
        + (searchResult.tamil_discovered ?? 0)
        + (searchResult.telugu_discovered ?? 0)
        + (searchResult.bengali_discovered ?? 0)
        + (searchResult.kannada_discovered ?? 0)
        + (searchResult.malayalam_discovered ?? 0)
        + (searchResult.spanish_discovered ?? 0)
        + (searchResult.portuguese_discovered ?? 0)
        + (searchResult.indonesian_discovered ?? 0)
        + (searchResult.arabic_discovered ?? 0)
        + (searchResult.punjabi_discovered ?? 0)
        + (searchResult.us_discovered ?? 0)
        + (searchResult.gb_discovered ?? 0)
        + (searchResult.video_discovered ?? 0);
      accountExternalQuota(searchQuotaUsed);
      record('discovery_search', { ...searchResult, search_plan: searchPlan, quota_accounted: searchQuotaUsed });
    } else if (allowSearch || allowHindiSearch || allowTamilSearch || allowTeluguSearch
      || allowBengaliSearch || allowKannadaSearch || allowMalayalamSearch
      || allowSpanishSearch || allowPortugueseSearch || allowIndonesianSearch
      || allowArabicSearch || allowPunjabiSearch || allowVideoSearch) {
      record('discovery_search_skipped', { reason: 'quota_budget_too_low', left: quotaLeft() });
    }

    // ── Step 3b: AI diversity discovery (cheap, semantically governed) ────────
    const pendingGraphCandidates = getPendingCreatorGraphCandidates(db);
    const aiQuotaCap = Math.max(0, aiDiscoveryQuotaCap());
    const aiSearchSkipThreshold = aiDiscoverySkipIfSearchAdded();
    if (mode !== 'promote' && allowAIDiscovery && searchNewChannels >= aiSearchSkipThreshold) {
      record('ai_discovery_skipped', {
        reason: 'search_discovery_sufficient',
        search_new_channels: searchNewChannels,
        threshold: aiSearchSkipThreshold,
      });
    } else if (mode !== 'promote' && allowAIDiscovery && pendingGraphCandidates >= 500) {
      record('ai_discovery_skipped', {
        reason: 'creator_graph_queue_available',
        pending_graph_candidates: pendingGraphCandidates,
      });
    } else if (mode !== 'promote' && allowAIDiscovery && aiQuotaCap <= 0) {
      record('ai_discovery_skipped', {
        reason: 'ai_quota_cap_disabled',
        ai_quota_cap: aiQuotaCap,
      });
    } else if (mode !== 'promote' && allowAIDiscovery && canSpend(Math.min(10, aiQuotaCap))) {
      const aiResult = await runAIDiscoveryCycle(db, {
        maxNiches:             Math.max(1, aiDiscoveryMaxNiches()),
        allowCulturalExpansion,
        maxQuota:              Math.min(aiQuotaCap, quotaLeft()),
      });
      if (!aiResult.skipped) spend(aiResult.quota_used ?? 0, 'corpus_ai_discovery');
      record('ai_discovery', aiResult);
    }

    // ── Step 3c: Resolve creator-graph candidates into corpus rows ───────────
    if (mode !== 'promote' && pendingGraphCandidates > 0) {
      const ingestReserve = Math.min(500, Math.max(50, Math.floor(budget * 0.4)));
      const graphQuota = Math.min(creatorGraphResolveQuota(), Math.max(0, quotaLeft() - ingestReserve));
      if (graphQuota >= 2 && canSpend(2)) {
        try {
          const graphResult = await runCreatorDiscoveryResolver(db, {
            handleCap: creatorGraphHandleCap(),
            maxQuota: graphQuota,
          });
          accountExternalQuota(graphResult.quota_used ?? 0);
          record('creator_graph_resolver', graphResult);
        } catch (e) {
          record('creator_graph_resolver_error', { error: e.message });
        }
      } else {
        record('creator_graph_resolver_skipped', {
          reason: 'quota_budget_too_low',
          pending_graph_candidates: pendingGraphCandidates,
          ingest_reserve: ingestReserve,
          left: quotaLeft(),
        });
      }
    }

    // ── Step 4: Re-score all channels by priority (no quota) ─────────────────
    if (process.env.CORPUS_SKIP_PRIORITY_RESCORE === '1') {
      record('priority_rescore_skipped', { reason: 'CORPUS_SKIP_PRIORITY_RESCORE=1' });
    } else {
      const rescored = rescoreAllChannels(db);
      record('priority_rescore', rescored);
    }

    // ── Step 4b: Zero-quota: copy ingested_videos → corpus_videos for sync'd channels ──
    if (mode !== 'promote') {
      try {
        const migrated = migrateIngestedVideosToCorpus(db);
        const normalized = normalizeGraphDiscoveryAdmissionState(db);
        record('video_migration', { ...migrated, ...normalized });
      } catch (e) {
        record('video_migration_error', { error: e.message });
      }
    }

    // ── Step 5: Light-ingest high-priority NEW channels (not already in ingested_channels) ──
    if (mode === 'promote') {
      record('light_ingest_skipped', { reason: 'promote_mode' });
    } else {
      const toIngest = getCorpusChannelsForLightIngest(db, Math.min(expansionCap * 8, corpusLightIngestLimit()));

      const ingestRes = { attempted: 0, ok: 0, failed: 0, skipped_policy: 0, quota_exhausted: false, failure_reasons: {}, channels: [] };
      for (const ch of toIngest) {
        if (shouldSkipGrowthLightIngest(ch)) {
          ingestRes.skipped_policy++;
          continue;
        }
        if (!canSpend(3)) { ingestRes.quota_exhausted = true; break; }
        ingestRes.attempted++;
        const result = await lightIngestChannelFull(db, ch.channel_id, {
          maxVideos: 50,
          discoverySource: ch.discovery_source,
        });
        if (result.ok) {
          ingestRes.ok++;
          summary.channels_ingested++;
          accountExternalQuota(3);
          ingestRes.channels.push({
            channel_id:       ch.channel_id,
            title:            ch.title ?? ch.handle ?? ch.channel_id,
            handle:           ch.handle ?? null,
            niche:            ch.niche ?? null,
            subscriber_count: ch.subscriber_count ?? 0,
            discovery_source: ch.discovery_source ?? null,
            videos_ingested:  result.videos?.stored ?? result.videos?.count ?? 0,
          });
        } else {
          ingestRes.failed++;
          const reason = result.reason ?? result.videos?.reason ?? 'unknown';
          ingestRes.failure_reasons[reason] = (ingestRes.failure_reasons[reason] ?? 0) + 1;
          if (reason !== 'no_api_key' && reason !== 'all_api_keys_exhausted' && reason !== 'quota_exhausted') {
            accountExternalQuota(1);
          }
        }
        if (result.reason === 'quota_exhausted' || result.videos?.reason === 'quota_exhausted') {
          ingestRes.quota_exhausted = true; break;
        }
        if (ingestRes.ok > 0) await new Promise(r => setTimeout(r, 200));
      }
      record('light_ingest', { ...ingestRes, quota_used_so_far: cycleQuota });
    }

    // ── Step 5b: Classify unclassified channels (niche = NULL) ───────────────
    if (mode === 'discover') {
      record('niche_classify_skipped', { reason: 'discover_mode' });
    } else {
      const classifyLimit = Math.max(100, parseInt(process.env.CORPUS_NICHE_CLASSIFY_LIMIT ?? '500', 10));
      const unclassified = getUnclassifiedCorpusChannels(db, classifyLimit);
      const classifyRes  = { attempted: 0, classified: 0, errors: 0, skipped_no_titles: 0 };
      for (const ch of unclassified) {
        const titles = getCorpusVideoTitles(db, ch.channel_id, 40);
        if (titles.length === 0) { classifyRes.skipped_no_titles++; continue; }
        classifyRes.attempted++;
        try {
          const result = await classifyChannel({ channelName: ch.title, titles });
          if (result.primary_niche) {
            updateCorpusChannelNiche(db, ch.channel_id, result.primary_niche);
            classifyRes.classified++;
          }
        } catch (e) {
          classifyRes.errors++;
          if (e.message?.includes('quota') || e.message?.includes('rate')) break;
        }
        await new Promise(r => setTimeout(r, 150));
      }
      record('niche_classify', classifyRes);
    }

    // ── Step 6: Quality evaluation (no quota) ─────────────────────────────────
    let toEvaluate = [];
    if (mode !== 'discover') {
      const qualityEvalLimit = Math.max(500, parseInt(process.env.CORPUS_QUALITY_EVAL_LIMIT ?? '1500', 10));
      toEvaluate = getCorpusChannelsForQualityEval(db, qualityEvalLimit);
      const evalRes = { evaluated: 0, errors: 0 };
      for (let i = 0; i < toEvaluate.length; i++) {
        try { evaluateChannelQuality(db, toEvaluate[i]); evalRes.evaluated++; summary.channels_evaluated++; }
        catch (e) { evalRes.errors++; }
        if (i % 20 === 0) await new Promise(r => setImmediate(r)); // yield every 20
      }
      record('quality_eval', evalRes);
    }

    // ── Step 7: Training eligibility gate (no quota) ──────────────────────────
    if (mode !== 'discover') {
      const trainingRes = await runFullEvaluationPassAsync(db, toEvaluate);
      summary.channels_promoted = trainingRes.promoted;
      summary.channels_demoted  = trainingRes.demoted;
      record('training_gate', trainingRes);
    }

    // ── Step 8: Stale channel refresh (quota-guarded) ─────────────────────────
    if (mode === 'promote') {
      record('stale_refresh_skipped', { reason: 'promote_mode' });
    } else {
      const stale      = getStaleChannels(db, Math.min(refreshCap, 10));
      const refreshRes = { attempted: 0, ok: 0, skipped_quota: 0 };
      for (const ch of stale) {
        if (!canSpend(2)) { refreshRes.skipped_quota++; continue; }
        const r = await lightIngestChannelFull(db, ch.channel_id, { maxVideos: 20, discoverySource: 'refresh' });
        refreshRes.attempted++;
        if (r.ok) {
          refreshRes.ok++;
          accountExternalQuota(2);
          markRefreshed(db, ch.channel_id);
        } else if (r.reason !== 'no_api_key' && r.reason !== 'all_api_keys_exhausted' && r.reason !== 'quota_exhausted') {
          accountExternalQuota(1);
        }
        await new Promise(r2 => setTimeout(r2, 150));
      }
      record('stale_refresh', { ...refreshRes, quota_used_so_far: cycleQuota });
    }

    if (process.env.CORPUS_GROWTH_ONLY === '1') {
      try {
        const autoRes = runAutoPromotePass(db, record);
        summary.channels_promoted = Math.max(summary.channels_promoted, autoRes.promoted ?? 0);
      } catch (e) {
        record('auto_promote_error', { error: e.message });
      }
      record('growth_only_complete', { reason: 'CORPUS_GROWTH_ONLY=1' });
      const duration = Date.now() - startMs;
      summary.quota_used = cycleQuota;
      record('complete', { duration_ms: duration, quota_used: cycleQuota, budget_remaining: quotaLeft() });
      finalizeRunLog(db, runId, { ok: true, ...summary, log });
      return { ok: true, duration_ms: duration, quota_used: cycleQuota, log };
    }

    if (mode === 'discover') {
      record('governance_skipped', { reason: 'discover_mode' });
    } else {
      // ── Step 9: Diversity pressure pass (no quota) ──────────────────────────
      try {
        const diversityRes = runDiversityPressurePass(db, 2000);
        record('diversity_pressure', { updated: diversityRes.updated });
      } catch (e) { record('diversity_pressure_error', { error: e.message }); }

      // ── Step 10: Trust evaluation pass ──────────────────────────────────────
      try {
        initializeProbation(db);
        const trustRes = runTrustEvaluationPass(db, toEvaluate);
        record('trust_evaluation', trustRes);
      } catch (e) { record('trust_evaluation_error', { error: e.message }); }

      // ── Step 11: Relationship decay (weekly, skips if too soon) ─────────────
      try {
        initializeEdgeStrengths(db);
        const decayRes = runDecayCycle(db);
        record('relationship_decay', decayRes);
      } catch (e) { record('relationship_decay_error', { error: e.message }); }

      // ── Step 12: Topology snapshot + drift detection ─────────────────────────
      try {
        const topoRes  = captureTopologySnapshot(db);
        const driftRes = runDriftDetection(db);
        record('governance', { topology: topoRes.overall_health, drift_alerts: driftRes.alerts_emitted });
      } catch (e) { record('governance_error', { error: e.message }); }

      // ── Step 13: Governance maturity check ───────────────────────────────────
      try {
        const maturityRes = runMaturityCheck(db);
        record('governance_maturity', {
          effective_score:  maturityRes.effective_score,
          stage:            maturityRes.stage,
          status_changes:   maturityRes.status_changes,
          layers_evaluated: maturityRes.layers_evaluated,
        });
      } catch (e) { record('governance_maturity_error', { error: e.message }); }

      // ── Step 14: Attention ecology inference ─────────────────────────────────
      try {
        const ecologyRes = runEcologyInferencePass(db, { limit: 200 });
        record('ecology_inference', {
          processed:          ecologyRes.processed,
          drift_alerts:       ecologyRes.drift_alerts,
          insufficient_data:  ecologyRes.insufficient_data,
          errors:             ecologyRes.errors,
          eligible_remaining: ecologyRes.eligible_remaining,
        });
      } catch (e) { record('ecology_inference_error', { error: e.message }); }

      // ── Step 15: Auto-promote corpus channels → ingested_channels ────────────
      try {
        const qualityThreshold = Math.max(50, parseFloat(process.env.CORPUS_AUTO_PROMOTE_THRESHOLD ?? '60'));
        const candidates       = getAutoPromotionCandidates(db, { qualityThreshold });
        let promoted = 0;
        for (const ch of candidates) {
          // Language gate: only promote English channels into the scoring pipeline.
          // Non-English channels (hi/ta/te/etc.) stay in corpus_channels only.
          //
          // Special case — Indian channels with English titles (extremely common):
          // 90% of Hindi creators write English titles for SEO but speak Hindi.
          // These channels ARE promoted (so Indian creators aren't excluded) but
          // ignore_from_benchmarks=1 keeps their view-velocity out of English VPH
          // benchmark calculations until a Hindi benchmark layer is built.
          let profilePrimary  = null;
          let profileMethod   = null;
          let profileUncertain = false;
          if (ch.language_profile) {
            try {
              const lp = typeof ch.language_profile === 'string'
                ? JSON.parse(ch.language_profile) : ch.language_profile;
              profilePrimary   = lp.primary   ?? null;
              profileMethod    = lp.method    ?? null;
              profileUncertain = lp.uncertain ?? false;
            } catch (_) {}
          }

          const ytLang      = ch.yt_default_language?.split('-')[0]?.toLowerCase() ?? null;
          const profileLang = profilePrimary?.split?.('-')?.[0]?.toLowerCase?.() ?? null;
          const corpusLang  = ch.language?.split?.('-')?.[0]?.toLowerCase?.() ?? null;
          const isIndian    = ch.yt_country === 'IN' || ch.country === 'IN';
          const langCode    = ytLang ?? profileLang ?? corpusLang;
          const isEnglish   = !langCode || langCode === 'en';
          const corpusSaysEnglish = corpusLang === 'en' || profileLang === 'en';
          const allowIndianLocalLanguage = process.env.CORPUS_PROMOTE_INDIAN_LOCAL_LANG !== '0';
          const canPromoteByLanguage = isEnglish || corpusSaysEnglish || (isIndian && allowIndianLocalLanguage);

          if (!canPromoteByLanguage) continue;

          // Foreign channels (non-IN country) go in as reference-only — never affect Indian benchmarks.
          // Indian local-language/uncertain channels are promoted for recommendations,
          // but excluded from English benchmark math until language-specific benchmarks exist.
          const isForeign = ch.yt_country && ch.yt_country !== 'IN';
          const ignoreFromBenchmarks = isForeign || (isIndian && (!isEnglish || profileUncertain));
          if (
            !ch.training_eligible ||
            ch.is_spam ||
            (ch.quality_score ?? 0) < qualityThreshold ||
            !ch.niche
          ) continue;
          try {
            upsertIngestedChannel(db, {
              id:                     crypto.randomUUID(),
              channel_id:             ch.channel_id,
              channel_name:           ch.title ?? ch.handle ?? ch.channel_id,
              niche:                  ch.niche,
              uploads_playlist_id:    ch.uploads_playlist_id ?? null,
              channel_subscribers:    ch.subscriber_count ?? null,
              added_by:               'auto_promote',
              ignore_from_benchmarks: ignoreFromBenchmarks,
              community_id:           ch.community_id ?? null,
              notes:                  `Auto-promoted from corpus. quality_score=${ch.quality_score?.toFixed(2)}${ignoreFromBenchmarks ? ' [benchmark-excluded]' : ''}`,
            });
            markCorpusAutoPromoted(db, ch.channel_id);
            promoted++;
          } catch (e) {
            record('auto_promote_channel_error', { channel_id: ch.channel_id, error: e.message });
          }
        }
        record('auto_promote', { promoted, candidates: candidates.length, threshold: qualityThreshold });
      } catch (e) { record('auto_promote_error', { error: e.message }); }
    }

    const duration    = Date.now() - startMs;
    summary.quota_used = cycleQuota;
    record('complete', { duration_ms: duration, quota_used: cycleQuota, budget_remaining: quotaLeft() });

    finalizeRunLog(db, runId, { ok: true, ...summary, log });
    return { ok: true, duration_ms: duration, quota_used: cycleQuota, log };

  } catch (e) {
    console.error('[corpusScheduler] Cycle error:', e.message);
    summary.quota_used = cycleQuota;
    finalizeRunLog(db, runId, { ok: false, ...summary, error: e.message, log });
    return { ok: false, error: e.message, quota_used: cycleQuota, log };
  } finally {
    isRunning = false;
  }
}

// ── Periodic eligibility check ────────────────────────────────────────────────

function checkAndRunIfDue() {
  const db = getDb();
  if (!shouldRun(db)) return;

  const last = getLastCompletedRun(db);
  const hoursAgo = last
    ? ((Date.now() - new Date(last.started_at).getTime()) / 3_600_000).toFixed(1)
    : 'never';

  console.log(`[corpusScheduler] Due (last run: ${hoursAgo}h ago) — starting cycle`);
  runCorpusCycle({
    allowSearch: true, allowAIDiscovery: true, allowVideoSearch: true,
    allowHindiSearch: true, allowTamilSearch: true, allowTeluguSearch: true,
    allowBengaliSearch: true, allowKannadaSearch: true, allowMalayalamSearch: true,
    allowSpanishSearch: true, allowPortugueseSearch: true, allowIndonesianSearch: true,
    allowArabicSearch: true, allowPunjabiSearch: true,
  }).catch(e => console.error('[corpusScheduler] Uncaught cycle error:', e.message));
}

// ── Start scheduler ───────────────────────────────────────────────────────────

function startCorpusScheduler() {
  // No startup catch-up — run via: node pipeline.js
  // Recurring check — catches missed runs after downtime
  checkTimer = setInterval(checkAndRunIfDue, CHECK_INTERVAL_MS);

  console.log(
    `[corpusScheduler] Started — checks every ${CHECK_INTERVAL_MS / 60_000}min, ` +
    `runs when >${MIN_RUN_INTERVAL_HOURS}h since last success, ` +
    `quota budget: ${maxQuotaPerCycle()} units/cycle`,
  );
}

function stopCorpusScheduler() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

function getSchedulerStatus() {
  const db   = getDb();
  const last = getLastCompletedRun(db);
  const hoursAgo = last
    ? (Date.now() - new Date(last.started_at).getTime()) / 3_600_000
    : null;
  return {
    running:              isRunning,
    last_run_at:          last?.started_at ?? null,
    last_run_quota_used:  last?.quota_used ?? null,
    hours_since_last_run: hoursAgo != null ? +hoursAgo.toFixed(1) : null,
    next_run_eligible_in: hoursAgo != null
      ? Math.max(0, +(MIN_RUN_INTERVAL_HOURS - hoursAgo).toFixed(1))
      : 0,
    quota_budget_per_cycle: maxQuotaPerCycle(),
    run_interval_hours:     MIN_RUN_INTERVAL_HOURS,
  };
}

function getRunHistory(limit = 10) {
  const db = getDb();
  return db.all(
    `SELECT id, started_at, completed_at, status, quota_used, quota_budget,
            channels_ingested, channels_evaluated, channels_promoted, channels_demoted,
            discovery_synced, error
     FROM corpus_run_log ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
}

module.exports = {
  startCorpusScheduler,
  stopCorpusScheduler,
  runCorpusCycle,
  getSchedulerStatus,
  getRunHistory,
  _searchPlanForQuota: searchPlanForQuota,
};
