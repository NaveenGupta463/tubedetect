// Central config — all URLs, ports, and env-dependent values live here.
// Components and services import from this file, never from import.meta.env directly.
// In Electron: replace BACKEND_URL / SCORING_URL with IPC channel names in this file only.

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
export const SCORING_URL = import.meta.env.VITE_SCORING_URL || 'http://localhost:3002';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Claude model used for all frontend-initiated AI calls
export const CLAUDE_MODEL = 'claude-sonnet-4-6';
export const IS_DEV = import.meta.env.DEV ?? false;

// YouTube cache TTL
export const YT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Scoring server cache TTL (in-memory, server-side — mirrored here for client awareness)
export const SCORE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// API route paths (change once here if routes move)
export const ROUTES = {
  // Backend (3001)
  claude:    `${BACKEND_URL}/api/claude`,
  youtube:   `${BACKEND_URL}/api/youtube`,
  authGoogle: `${BACKEND_URL}/api/auth/google`,
  userMe:    `${BACKEND_URL}/api/user/me`,
  userTier:  `${BACKEND_URL}/api/user/tier`,

  // Scoring server (3002)
  analyze:   `${SCORING_URL}/api/analyze`,
  lookup:    `${SCORING_URL}/api/lookup`,
  explain:   `${SCORING_URL}/api/explain`,
  metrics:    `${SCORING_URL}/api/metrics`,
  modelStatus: `${SCORING_URL}/api/model/status`,
  results:    (id) => `${SCORING_URL}/api/results/${id}`,
  workspaces: `${SCORING_URL}/api/workspaces`,
  workspace:  (id) => `${SCORING_URL}/api/workspaces/${id}`,
  dbHealth:          `${SCORING_URL}/api/db/health`,
  dbStats:           `${SCORING_URL}/api/db/stats`,
  dbBackup:          `${SCORING_URL}/api/db/backup`,
  predictionFeedback:    `${SCORING_URL}/api/prediction-feedback`,
  outcomesRefresh:       `${SCORING_URL}/api/outcomes/refresh`,
  outcomesPublish:       `${SCORING_URL}/api/outcomes/publish`,
  outcomesVideoRefresh:  `${SCORING_URL}/api/outcomes/video-refresh`,
  learningReport:        `${SCORING_URL}/api/learning/report`,
  recommendationActions: `${SCORING_URL}/api/recommendations/actions`,
  recommendationApprove: (id) => `${SCORING_URL}/api/recommendations/${id}/approve`,
  recommendationReject:  (id) => `${SCORING_URL}/api/recommendations/${id}/reject`,
  experiments:           `${SCORING_URL}/api/experiments`,
  experiment:            (id) => `${SCORING_URL}/api/experiments/${id}`,
  experimentsCreate:     `${SCORING_URL}/api/experiments/create`,
  experimentsRun:        `${SCORING_URL}/api/experiments/run`,
  outcomesReality:       `${SCORING_URL}/api/outcomes/reality`,
  outcomesRealityById:   (ytId) => `${SCORING_URL}/api/outcomes/reality/${ytId}`,
  experimentsApply:      (id) => `${SCORING_URL}/api/experiments/${id}/apply`,
  adminAutoCalibrate:    `${SCORING_URL}/api/admin/learning/auto-calibrate`,
  adminScoringRollback:  `${SCORING_URL}/api/admin/scoring/rollback`,
  adminScoringActive:    `${SCORING_URL}/api/admin/scoring/active`,
  adminScoringVersions:  `${SCORING_URL}/api/admin/scoring/versions`,
  adminScoringAuditLog:  `${SCORING_URL}/api/admin/scoring/audit-log`,
  adminCacheStats:       `${SCORING_URL}/api/admin/cache/stats`,
  adminIntelChannels:        `${SCORING_URL}/api/admin/intelligence/channels`,
  adminIntelChannelsBulk:    `${SCORING_URL}/api/admin/intelligence/channels/bulk`,
  adminIntelChannelPatch:    (id) => `${SCORING_URL}/api/admin/intelligence/channels/${id}`,
  adminIntelChannelDelete:   (id) => `${SCORING_URL}/api/admin/intelligence/channels/${id}`,
  adminIntelIngestTrigger:   `${SCORING_URL}/api/admin/intelligence/ingest/trigger`,
  adminIntelSnapshotTrigger:       `${SCORING_URL}/api/admin/intelligence/snapshot/trigger`,
  adminIntelSnapshotRecentTrigger: `${SCORING_URL}/api/admin/intelligence/snapshot/trigger-recent`,
  adminIntelPatternsRecompute: `${SCORING_URL}/api/admin/intelligence/patterns/recompute`,
  adminIntelStatus:          `${SCORING_URL}/api/admin/intelligence/status`,
  adminIntelPatterns:        `${SCORING_URL}/api/admin/intelligence/patterns`,
  adminIntelQuota:           `${SCORING_URL}/api/admin/intelligence/quota`,
  adminIntelResolve:         `${SCORING_URL}/api/admin/intelligence/channels/resolve`,
  adminIntelCalibrateTrigger: `${SCORING_URL}/api/admin/intelligence/calibrate/trigger`,
  adminIntelDetectIdentity:       (id) => `${SCORING_URL}/api/admin/intelligence/channels/${id}/detect-identity`,
  adminIntelSaveIdentity:         (id) => `${SCORING_URL}/api/admin/intelligence/channels/${id}/save-identity`,
  adminIntelSaveIdentityManual:   (id) => `${SCORING_URL}/api/admin/intelligence/channels/${id}/save-identity-manual`,
  adminIntelBulkDetectIdentity:         `${SCORING_URL}/api/admin/intelligence/channels/bulk-detect-identity`,
  adminIntelBulkDetectIdentityProgress: `${SCORING_URL}/api/admin/intelligence/channels/bulk-detect-identity/progress`,
  adminIntelClassificationStats:  `${SCORING_URL}/api/admin/intelligence/classification-stats`,
  adminIntelCountryDetectTrigger: `${SCORING_URL}/api/admin/intelligence/country-detect/trigger`,
  adminIntelAutoPromoted:         `${SCORING_URL}/api/admin/intelligence/channels/auto-promoted`,
  adminIntelLouvainRun:           `${SCORING_URL}/api/admin/intelligence/louvain/run`,
  adminIntelCommunities:          `${SCORING_URL}/api/admin/intelligence/communities`,
  adminIntelCommunityBackfill:    `${SCORING_URL}/api/admin/intelligence/community/backfill`,
  corpusSeenChannel:              `${SCORING_URL}/api/corpus/seen-channel`,
  communityInfer:                 `${SCORING_URL}/api/intel/community/infer`,

  // Evolution observability
  adminEvolutionCalibrationHistory: `${SCORING_URL}/api/admin/evolution/calibration-history`,
  adminEvolutionPredictionAccuracy: `${SCORING_URL}/api/admin/evolution/prediction-accuracy`,
  adminEvolutionScoreDistribution:  `${SCORING_URL}/api/admin/evolution/score-distribution`,
  adminEvolutionSignalWeights:      `${SCORING_URL}/api/admin/evolution/signal-weights`,
  adminEvolutionBenchmarkDrift:     `${SCORING_URL}/api/admin/evolution/benchmark-drift`,
  adminEvolutionHealthScore:        `${SCORING_URL}/api/admin/evolution/health-score`,
  adminEvolutionBenchmarkTimeline:  `${SCORING_URL}/api/admin/evolution/benchmark-timeline`,
  adminEvolutionVersions:           `${SCORING_URL}/api/admin/evolution/versions`,
  adminEvolutionConfidence:         `${SCORING_URL}/api/admin/evolution/confidence`,
  adminEvolutionCalibrationOverview: `${SCORING_URL}/api/admin/evolution/calibration-overview`,
  adminEvolutionStaleOutcomes:      `${SCORING_URL}/api/admin/evolution/stale-outcomes`,

  // Learning Intelligence Dashboard
  // Confidence system (Phase A)
  adminConfidenceReport:       `${SCORING_URL}/api/admin/confidence/report`,
  adminConfidenceHistory:      `${SCORING_URL}/api/admin/confidence/history`,
  adminConfidenceSnapshot:     `${SCORING_URL}/api/admin/confidence/snapshot`,

  adminLearningKpis:           `${SCORING_URL}/api/admin/evolution/learning-kpis`,
  adminLearningHistory:        `${SCORING_URL}/api/admin/evolution/learning-history`,
  adminLearningNicheIntel:     `${SCORING_URL}/api/admin/evolution/niche-intelligence`,
  adminLearningDistributions:  `${SCORING_URL}/api/admin/evolution/calibration-distributions`,
  adminLearningEvents:         `${SCORING_URL}/api/admin/evolution/learning-events`,
  adminLearningSnapshot:       `${SCORING_URL}/api/admin/evolution/learning-snapshot`,
  adminLearningHistoryDashboard: `${SCORING_URL}/api/admin/evolution/history-dashboard`,

  // Discovery
  adminDiscoveryRun:        `${SCORING_URL}/api/admin/discovery/run`,
  adminDiscoveryJob:        (id) => `${SCORING_URL}/api/admin/discovery/jobs/${id}`,
  adminDiscoveryJobs:       `${SCORING_URL}/api/admin/discovery/jobs`,
  adminDiscoveryCandidates: `${SCORING_URL}/api/admin/discovery/candidates`,
  adminDiscoveryCandidate:  (id) => `${SCORING_URL}/api/admin/discovery/candidates/${id}`,
  adminDiscoveryBulk:       `${SCORING_URL}/api/admin/discovery/candidates/bulk`,
  adminDiscoveryStats:      `${SCORING_URL}/api/admin/discovery/stats`,

  // Autonomous Intelligence Routing (Phase C)
  intelligenceQuery:            `${SCORING_URL}/api/intelligence/query`,
  intelligenceRoutingAnalytics: `${SCORING_URL}/api/intelligence/routing/analytics`,
  adminConfidenceCorrectness:   `${SCORING_URL}/api/admin/confidence/correctness`,
  adminRoutingAnalytics:        `${SCORING_URL}/api/admin/intelligence/routing/analytics`,

  // Phase E: Real Feedback Intelligence
  adminLearningNicheReliability:   `${SCORING_URL}/api/admin/learning/niche-reliability`,
  adminLearningCohortAnalysis:     `${SCORING_URL}/api/admin/learning/cohort-analysis`,
  adminLearningDecayAnalysis:      `${SCORING_URL}/api/admin/learning/decay-analysis`,
  adminLearningDisagreementStats:  `${SCORING_URL}/api/admin/learning/disagreement-stats`,
  adminLearningSyntheticTransition:`${SCORING_URL}/api/admin/learning/synthetic-transition`,

  // Hook Intelligence (Phase D)
  hooksTop:       `${SCORING_URL}/api/intelligence/hooks/top`,
  hooksRising:    `${SCORING_URL}/api/intelligence/hooks/rising`,
  hooksDeclining: `${SCORING_URL}/api/intelligence/hooks/declining`,
  hooksNiche:     (niche) => `${SCORING_URL}/api/intelligence/hooks/niche/${niche}`,
  hooksStats:     `${SCORING_URL}/api/intelligence/hooks/stats`,
  hooksAggregate: `${SCORING_URL}/api/intelligence/hooks/aggregate`,
  hooksClassify:  `${SCORING_URL}/api/intelligence/hooks/classify`,

  // Semantic Intelligence (Phase G)
  semanticStatus:        `${SCORING_URL}/api/semantic/status`,
  semanticClusters:      `${SCORING_URL}/api/semantic/clusters`,
  semanticCoverage:      `${SCORING_URL}/api/semantic/coverage`,
  semanticNearest:       `${SCORING_URL}/api/semantic/nearest`,
  semanticEmbedTitle:    `${SCORING_URL}/api/semantic/embed-title`,
  semanticCacheStats:    `${SCORING_URL}/api/semantic/cache/stats`,
  adminSemanticIngest:   `${SCORING_URL}/api/admin/semantic/ingest/trigger`,
  adminSemanticCluster:  `${SCORING_URL}/api/admin/semantic/cluster/run`,
  adminSemanticReseed:   `${SCORING_URL}/api/admin/semantic/cluster/reseed`,

  // Phase 1-7: Scaled ingestion queue
  adminSemanticQueue:            `${SCORING_URL}/api/admin/semantic/ingest/queue`,
  adminSemanticQueueStart:       `${SCORING_URL}/api/admin/semantic/ingest/queue/start`,
  adminSemanticQueuePause:       `${SCORING_URL}/api/admin/semantic/ingest/queue/pause`,
  adminSemanticIngestJobs:       `${SCORING_URL}/api/admin/semantic/ingest/jobs`,
  adminSemanticIngestJob:        (id) => `${SCORING_URL}/api/admin/semantic/ingest/jobs/${id}`,
  adminSemanticTelemetry:        `${SCORING_URL}/api/admin/semantic/telemetry`,
  adminSemanticValidate:         `${SCORING_URL}/api/admin/semantic/validate`,
  adminSemanticValidateStress:   `${SCORING_URL}/api/admin/semantic/validate/stress`,
  adminSemanticValidateReport:   `${SCORING_URL}/api/admin/semantic/validate/report`,
  adminSemanticValidateHistory:  `${SCORING_URL}/api/admin/semantic/validate/history`,
  adminSemanticClusterQualityRun: `${SCORING_URL}/api/admin/semantic/cluster/quality`,
  adminSemanticClusterQualitySample: (cluster) => `${SCORING_URL}/api/admin/semantic/cluster/quality/sample/${cluster}`,
  adminSemanticScaleStatus:      `${SCORING_URL}/api/admin/semantic/scale-status`,
  adminSemanticScaleAdvance:     `${SCORING_URL}/api/admin/semantic/scale-advance`,
  adminSemanticClusterTitles:    (name) => `${SCORING_URL}/api/admin/semantic/clusters/${encodeURIComponent(name)}/titles`,
  adminSemanticClusterPatch:     (name) => `${SCORING_URL}/api/admin/semantic/clusters/${encodeURIComponent(name)}`,
  adminSemanticQualityOverview:  `${SCORING_URL}/api/admin/semantic/cluster/quality/overview`,
  semanticVideoCheck:            (ytid) => `${SCORING_URL}/api/semantic/video-check/${encodeURIComponent(ytid)}`,

  // Creator Intelligence
  intelNiches:              `${SCORING_URL}/api/intel/niches`,
  intelCompetitorChannels:  `${SCORING_URL}/api/intel/competitor/channels`,
  intelTopVideos:           `${SCORING_URL}/api/intel/competitor/top-videos`,
  intelVelocity:            `${SCORING_URL}/api/intel/competitor/velocity`,
  intelUploadFreq:          `${SCORING_URL}/api/intel/competitor/upload-frequency`,
  intelFormatBreakdown:     `${SCORING_URL}/api/intel/competitor/format-breakdown`,
  intelTopTitles:           `${SCORING_URL}/api/intel/content/top-titles`,
  intelDurations:           `${SCORING_URL}/api/intel/content/durations`,
  intelRisingFormats:       `${SCORING_URL}/api/intel/content/rising-formats`,
  intelContentPatterns:     `${SCORING_URL}/api/intel/content/patterns`,
  intelMaturity:            `${SCORING_URL}/api/intel/maturity`,
  intelAcceleration:        `${SCORING_URL}/api/intel/trends/acceleration`,
  intelBreakout:            `${SCORING_URL}/api/intel/trends/breakout`,
  intelBenchmarkDrift:      `${SCORING_URL}/api/intel/trends/benchmark-drift`,
  intelRisingArchetypes:    `${SCORING_URL}/api/intel/trends/rising-archetypes`,
  // Phase H — Strategy Intelligence
  strategyGenerate:         `${SCORING_URL}/api/strategy/generate`,
  strategyRecommendations:  `${SCORING_URL}/api/strategy/recommendations`,
  strategyRecommendation:   (id) => `${SCORING_URL}/api/strategy/recommendations/${id}`,
  strategyFeedback:         (id) => `${SCORING_URL}/api/strategy/recommendations/${id}/feedback`,
  strategyOpportunities:    `${SCORING_URL}/api/strategy/opportunities`,
  strategyPlan:             `${SCORING_URL}/api/strategy/plan`,
  strategyAnalytics:        `${SCORING_URL}/api/strategy/analytics`,
  strategyExperimentQueue:  `${SCORING_URL}/api/strategy/experiment-queue`,
  strategyHistory:          `${SCORING_URL}/api/strategy/history`,
  strategyContextDigest:    `${SCORING_URL}/api/strategy/context-digest`,

  intelChannelNiche:        (id) => `${SCORING_URL}/api/intel/channels/${id}/niche`,
  intelChannelRedetect:     (id) => `${SCORING_URL}/api/intel/channels/${id}/redetect`,
  intelAllowedNiches:       `${SCORING_URL}/api/intel/allowed-niches`,
  intelRedetectAll:         `${SCORING_URL}/api/intel/channels/redetect-all`,
  intelRedetectAllJob:      (id) => `${SCORING_URL}/api/intel/channels/redetect-all/${id}`,

  // Channel / Video DB cache (zero-quota local-first reads)
  channelCacheLookup:       `${SCORING_URL}/api/channel-cache/channel`,
  channelCacheStore:        `${SCORING_URL}/api/channel-cache/channel`,
  channelCacheVideos:       (id) => `${SCORING_URL}/api/channel-cache/channel/${id}/videos`,
  channelCacheStoreVideos:  `${SCORING_URL}/api/channel-cache/videos`,
  channelCacheVideoById:    (id) => `${SCORING_URL}/api/channel-cache/video/${id}`,
  channelCacheRefreshStats: (id) => `${SCORING_URL}/api/channel-cache/channel/${id}/refresh-stats`,
  channelCacheStats:        `${SCORING_URL}/api/channel-cache/stats`,

  // Phase XI — Corpus Observability (admin only)
  corpusComposition:        `${SCORING_URL}/api/corpus/composition`,
  corpusStats:              `${SCORING_URL}/api/corpus/stats`,
  corpusChannels:           `${SCORING_URL}/api/corpus/channels`,
  corpusQualityDist:        `${SCORING_URL}/api/corpus/quality-distribution`,
  corpusTrainingSet:        `${SCORING_URL}/api/corpus/training-set`,
  corpusDiscoveryGraph:     `${SCORING_URL}/api/corpus/discovery-graph`,
  corpusNicheGaps:          `${SCORING_URL}/api/corpus/niche-gaps`,
  corpusEmbeddingQueue:     `${SCORING_URL}/api/corpus/embedding-queue`,
  corpusEvaluateChannel:    (id) => `${SCORING_URL}/api/corpus/evaluate-channel/${id}`,
  corpusPromote:            (id) => `${SCORING_URL}/api/corpus/promote/${id}`,
  corpusForcePromote:       (id) => `${SCORING_URL}/api/corpus/force-promote/${id}`,
  corpusDemote:             (id) => `${SCORING_URL}/api/corpus/demote/${id}`,
  corpusSyncFromIngested:   `${SCORING_URL}/api/corpus/sync-from-ingested`,
  corpusSchedulerStatus:    `${SCORING_URL}/api/corpus/scheduler/status`,
  corpusSchedulerRun:       `${SCORING_URL}/api/corpus/scheduler/run`,
  corpusRunHistory:         `${SCORING_URL}/api/corpus/scheduler/status`, // history included in status response

  // Phase XII — Semantic Governance Observability (admin only)
  governanceOverview:          `${SCORING_URL}/api/corpus/governance/overview`,
  governanceTopology:          `${SCORING_URL}/api/corpus/governance/topology`,
  governanceTopologySnapshot:  `${SCORING_URL}/api/corpus/governance/topology/snapshot`,
  governanceDrift:             `${SCORING_URL}/api/corpus/governance/drift`,
  governanceDriftDetect:       `${SCORING_URL}/api/corpus/governance/drift/detect`,
  governanceDriftAcknowledge:  (id) => `${SCORING_URL}/api/corpus/governance/drift/acknowledge/${id}`,
  governanceDiversity:         `${SCORING_URL}/api/corpus/governance/diversity`,
  governanceDiversityRefresh:  `${SCORING_URL}/api/corpus/governance/diversity/refresh`,
  governanceTrust:             `${SCORING_URL}/api/corpus/governance/trust`,
  governanceRelationships:     `${SCORING_URL}/api/corpus/governance/relationships`,
  governanceRelationshipsDecay:`${SCORING_URL}/api/corpus/governance/relationships/decay`,
  governanceFeedback:          `${SCORING_URL}/api/corpus/governance/feedback`,
  governanceFeedbackStats:     `${SCORING_URL}/api/corpus/governance/feedback/stats`,

  // Phase XIII — AI Discovery Observability
  governanceAIDiscoveryStats:  `${SCORING_URL}/api/corpus/governance/ai-discovery/stats`,
  governanceAIDiscoveryLog:    `${SCORING_URL}/api/corpus/governance/ai-discovery/log`,
  governanceAIDiscoveryRun:    `${SCORING_URL}/api/corpus/governance/ai-discovery/run`,
  governanceCreatorTiers:      `${SCORING_URL}/api/corpus/governance/creator-tiers`,

  // Phase XIV — Attention Ecology Observability (admin only, read-only)
  governanceEcologyOverview:      `${SCORING_URL}/api/corpus/governance/ecology/overview`,
  governanceEcologyDistribution:  `${SCORING_URL}/api/corpus/governance/ecology/distribution`,
  governanceEcologyChannel:       (id) => `${SCORING_URL}/api/corpus/governance/ecology/channel/${id}`,
  governanceEcologyDrift:         `${SCORING_URL}/api/corpus/governance/ecology/drift`,
  governanceEcologyUncertain:     `${SCORING_URL}/api/corpus/governance/ecology/uncertain`,
  governanceEcologyRun:           `${SCORING_URL}/api/corpus/governance/ecology/run`,
  governanceEcologyOverride:      (id) => `${SCORING_URL}/api/corpus/governance/ecology/channel/${id}/override`,
  governanceEcologyProbe:         `${SCORING_URL}/api/corpus/governance/ecology/probe`,

  // Phase XIII — Governance Maturity Roadmap
  governanceMaturity:          `${SCORING_URL}/api/corpus/governance/maturity`,
  governanceMaturityCheck:     `${SCORING_URL}/api/corpus/governance/maturity/check`,
  governanceMaturityReport:    `${SCORING_URL}/api/corpus/governance/maturity-report`,
  governanceRoadmap:           `${SCORING_URL}/api/corpus/governance/roadmap`,
  governanceRoadmapLayer:      (id) => `${SCORING_URL}/api/corpus/governance/roadmap/${id}`,
  governanceRoadmapHistory:    (id) => `${SCORING_URL}/api/corpus/governance/roadmap/${id}/history`,
  governanceRoadmapEvaluate:   (id) => `${SCORING_URL}/api/corpus/governance/roadmap/${id}/evaluate`,
  governanceRoadmapStatus:     (id) => `${SCORING_URL}/api/corpus/governance/roadmap/${id}/status`,
};
