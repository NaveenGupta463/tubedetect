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
 *   Default MAX_QUOTA_PER_CYCLE = 2000 units (leaves headroom for user actions)
 *   The cycle tracks quota consumed and stops early if budget is exhausted.
 *   Set CORPUS_QUOTA_BUDGET env var to override (e.g. CORPUS_QUOTA_BUDGET=1000).
 */

const crypto = require('crypto');
const { getDb }                  = require('../db/init');
const quotaGuard                 = require('./quotaGuard');
const { runDiscoveryCycle }      = require('./discoveryAgent');
const { lightIngestChannelFull } = require('./lightIngestAgent');
const { evaluateChannelQuality } = require('./qualityAgent');
const { runFullEvaluationPass }  = require('./trainingAgent');
const { rescoreAllChannels, planQuotaAllocation, estimateChannelCapacity } = require('./priorityEngine');
const { runTrustEvaluationPass, initializeProbation }   = require('./trainingTrustEngine');
const { runAIDiscoveryCycle }                            = require('./aiDiscoveryAgent');
const { runDiversityPressurePass }                       = require('./diversityPressureEngine');
const { runDecayCycle, initializeEdgeStrengths }         = require('./relationshipDecayEngine');
const { captureTopologySnapshot }                        = require('./topologyHealthEngine');
const { runDriftDetection }                              = require('./semanticDriftEngine');
const { runMaturityCheck }                               = require('./governanceMaturityEngine');
const { runEcologyInferencePass }                        = require('./attentionEcologyEngine');
const {
  getAllCorpusChannels,
  getCorpusChannelsForQualityEval,
  getStaleChannels,
  markRefreshed,
  getAutoPromotionCandidates,
  markCorpusAutoPromoted,
  getUnclassifiedCorpusChannels,
  getCorpusVideoTitles,
  updateCorpusChannelNiche,
  migrateIngestedVideosToCorpus,
} = require('../db/corpusQueries');
const { upsertIngestedChannel } = require('../db/queries');
const { classifyChannel }       = require('./channelClassifier');

const MIN_RUN_INTERVAL_HOURS = parseInt(process.env.CORPUS_RUN_INTERVAL_HOURS ?? '24', 10);
const STARTUP_DELAY_MS       = 45_000;   // 45s after boot before first eligibility check
const CHECK_INTERVAL_MS      = 30 * 60 * 1000; // recheck every 30 minutes
const MAX_QUOTA_PER_CYCLE    = parseInt(process.env.CORPUS_QUOTA_BUDGET ?? '4000', 10);

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

// ── Main cycle ────────────────────────────────────────────────────────────────

// mode: 'full' (default) | 'discover' (find+ingest only) | 'promote' (evaluate+promote only)
async function runCorpusCycle({ allowSearch = false, allowAIDiscovery = false, allowCulturalExpansion = false, allowHindiSearch = false, allowTamilSearch = false, allowTeluguSearch = false, allowBengaliSearch = false, allowKannadaSearch = false, allowMalayalamSearch = false, allowSpanishSearch = false, allowPortugueseSearch = false, allowIndonesianSearch = false, allowArabicSearch = false, allowPunjabiSearch = false, allowVideoSearch = false, quotaBudget, mode = 'full' } = {}) {
  if (isRunning) {
    console.log('[corpusScheduler] Cycle already running — skipping');
    return { skipped: true, reason: 'already_running' };
  }

  isRunning          = true;
  const db           = getDb();
  const startMs      = Date.now();
  const budget       = quotaBudget ?? MAX_QUOTA_PER_CYCLE;
  const log          = [];
  let   cycleQuota   = 0; // quota consumed this cycle

  const runId = startRunLog(db, budget);

  function record(step, data) {
    console.log(`[corpusScheduler] ${step}:`, JSON.stringify(data));
    log.push({ step, data, ts: new Date().toISOString() });
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

  const summary = {
    quota_used: 0, channels_ingested: 0, channels_evaluated: 0,
    channels_promoted: 0, channels_demoted: 0, discovery_synced: 0,
  };

  try {
    record('start', { budget, quota_left: quotaLeft(), run_id: runId });

    // ── Step 1: Quota plan ────────────────────────────────────────────────────
    const usedToday    = quotaGuard.getUsedToday?.() ?? 0;
    const noSearch     = !allowSearch && !allowHindiSearch && !allowTamilSearch && !allowTeluguSearch
                         && !allowBengaliSearch && !allowKannadaSearch && !allowMalayalamSearch
                         && !allowSpanishSearch && !allowPortugueseSearch && !allowIndonesianSearch
                         && !allowArabicSearch && !allowPunjabiSearch && !allowVideoSearch && !allowAIDiscovery;
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

    // ── Step 3: API-based keyword search across all underrepresented niches ──────
    if (mode === 'promote') { record('discovery_search_skipped', { reason: 'promote_mode' }); }
    else if ((allowSearch || allowHindiSearch || allowTamilSearch || allowTeluguSearch) && canSpend(100)) {
      const { runDiscoveryCycle: runSearch } = require('./discoveryAgent');
      // Reserve half the remaining budget for ingest; each search = 100 units
      const maxSearches = Math.max(1, Math.floor(quotaLeft() / 2 / 100));
      const searchResult = await runSearch(db, {
        allowSearch,            maxSearches,
        allowHindiSearch,       maxHindiSearches: 5,
        allowTamilSearch,       maxTamilSearches: 5,
        allowTeluguSearch,      maxTeluguSearches: 5,
        allowBengaliSearch,     maxBengaliSearches: 3,
        allowKannadaSearch,     maxKannadaSearches: 3,
        allowMalayalamSearch,   maxMalayalamSearches: 3,
        allowSpanishSearch,     maxSpanishSearches: 3,
        allowPortugueseSearch,  maxPortugueseSearches: 3,
        allowIndonesianSearch,  maxIndonesianSearches: 3,
        allowArabicSearch,      maxArabicSearches: 3,
        allowPunjabiSearch,     maxPunjabiSearches: 3,
        allowVideoSearch,       maxVideoSearches: 5,
      });
      // quota is recorded internally by discoverByNicheKeyword (100 units/call)
      const searchesRun = (searchResult.searches_run ?? 0) + (searchResult.hindi_searches_run ?? 0)
        + (searchResult.tamil_searches_run ?? 0) + (searchResult.telugu_searches_run ?? 0);
      spend(searchesRun * 100, 'corpus_search');
      record('discovery_search', searchResult);
    } else if (allowSearch || allowHindiSearch || allowTamilSearch || allowTeluguSearch) {
      record('discovery_search_skipped', { reason: 'quota_budget_too_low', left: quotaLeft() });
    }

    // ── Step 3b: AI diversity discovery (cheap, semantically governed) ────────
    if (mode !== 'promote' && allowAIDiscovery && canSpend(10)) {
      const aiResult = await runAIDiscoveryCycle(db, {
        maxNiches:             3,
        allowCulturalExpansion,
        maxQuota:              Math.min(60, quotaLeft()),
      });
      if (!aiResult.skipped) spend(aiResult.quota_used ?? 0, 'corpus_ai_discovery');
      record('ai_discovery', aiResult);
    }

    // ── Step 4: Re-score all channels by priority (no quota) ─────────────────
    const rescored = rescoreAllChannels(db);
    record('priority_rescore', rescored);

    // ── Step 4b: Zero-quota: copy ingested_videos → corpus_videos for sync'd channels ──
    if (mode !== 'promote') {
      try {
        const migrated = migrateIngestedVideosToCorpus(db);
        record('video_migration', migrated);
      } catch (e) {
        record('video_migration_error', { error: e.message });
      }
    }

    // ── Step 5: Light-ingest high-priority NEW channels (not already in ingested_channels) ──
    if (mode === 'promote') {
      record('light_ingest_skipped', { reason: 'promote_mode' });
    } else {
      const toIngest = getAllCorpusChannels(db, {
        limit: Math.min(expansionCap * 8, 3000),
      }).filter(ch => ch.ingest_depth < 1 && !ch.is_spam && ch.discovery_source !== 'ingested_channels_sync');

      const ingestRes = { attempted: 0, ok: 0, quota_exhausted: false, channels: [] };
      for (const ch of toIngest) {
        if (!canSpend(3)) { ingestRes.quota_exhausted = true; break; }
        ingestRes.attempted++;
        const result = await lightIngestChannelFull(db, ch.channel_id, {
          maxVideos: 50,
          discoverySource: ch.discovery_source,
        });
        if (result.ok) {
          ingestRes.ok++;
          summary.channels_ingested++;
          spend(3, 'corpus_ingest');
          ingestRes.channels.push({
            channel_id:       ch.channel_id,
            title:            ch.title ?? ch.handle ?? ch.channel_id,
            handle:           ch.handle ?? null,
            niche:            ch.niche ?? null,
            subscriber_count: ch.subscriber_count ?? 0,
            discovery_source: ch.discovery_source ?? null,
            videos_ingested:  result.videos?.stored ?? result.videos?.count ?? 0,
          });
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
      const unclassified = getUnclassifiedCorpusChannels(db, 100);
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
      toEvaluate = getCorpusChannelsForQualityEval(db, 500);
      const evalRes = { evaluated: 0, errors: 0 };
      for (const ch of toEvaluate) {
        try { evaluateChannelQuality(db, ch); evalRes.evaluated++; summary.channels_evaluated++; }
        catch (e) { evalRes.errors++; }
      }
      record('quality_eval', evalRes);
    }

    // ── Step 7: Training eligibility gate (no quota) ──────────────────────────
    if (mode !== 'discover') {
      const trainingRes = runFullEvaluationPass(db, toEvaluate);
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
        if (r.ok) { refreshRes.ok++; spend(2, 'corpus_refresh'); markRefreshed(db, ch.channel_id); }
        await new Promise(r2 => setTimeout(r2, 150));
      }
      record('stale_refresh', { ...refreshRes, quota_used_so_far: cycleQuota });
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

          const ytLang   = ch.yt_default_language?.split('-')[0]?.toLowerCase() ?? null;
          const langCode = ytLang ?? profilePrimary;
          const isEnglish = !langCode || langCode === 'en' || langCode === 'en-US' || langCode === 'en-GB';

          if (!isEnglish) continue;

          // Uncertain = Indian channel where only weak signal (franc/fallback) detected English.
          // Promote but exclude from benchmark aggregation.
          const ignoreFromBenchmarks = profileUncertain && ch.yt_country === 'IN';
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
              notes:                  `Auto-promoted from corpus. quality_score=${ch.quality_score?.toFixed(2)}${ignoreFromBenchmarks ? ' [lang:uncertain-IN]' : ''}`,
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
  // First eligibility check after server boot (give other services time to init)
  setTimeout(checkAndRunIfDue, STARTUP_DELAY_MS);

  // Recurring check — catches missed runs after downtime
  checkTimer = setInterval(checkAndRunIfDue, CHECK_INTERVAL_MS);

  console.log(
    `[corpusScheduler] Started — checks every ${CHECK_INTERVAL_MS / 60_000}min, ` +
    `runs when >${MIN_RUN_INTERVAL_HOURS}h since last success, ` +
    `quota budget: ${MAX_QUOTA_PER_CYCLE} units/cycle`,
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
    quota_budget_per_cycle: MAX_QUOTA_PER_CYCLE,
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
};
