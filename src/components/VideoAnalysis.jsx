import { useState, useEffect, useRef } from 'react';
import { fetchVideoComments, fetchChannelVideosExpanded } from '../api/youtube';
import { analyzeVideoDeep, getVideoSignals, analyzeVideoDiagnosis, adjustScoreWithAI } from '../api/claude';
import { SCHEMA_VERSION } from '../scoring/truthEngine';
import { scoreVideoUnified } from '../scoring/unifiedScoring';
import { fetchPerVideoOAuthMetrics, fetchChannelImpressionsBaseline } from '../api/analyticsApi';
import { generateInsights } from '../scoring/insightsEngine';
import { buildFixCards } from '../scoring/fixEngine';
import { buildActionEngineOutput } from '../engine/actionEngine';
import { extractTimestamps, formatNum, parseDuration } from '../utils/analysis';
import { meetsRequirement } from '../utils/tierConfig';
import SummaryBox from './SummaryBox';

import {
  UpgradeModal, LockedTabContent, ProTeaserCard, AgencyBulkPanel,
} from './VideoAnalysisUpgrade';
import VideoAnalysisOverview from './VideoAnalysisOverview';
import VideoAnalysisTitleTab from './VideoAnalysisTitleTab';
import VideoAnalysisHookTab from './VideoAnalysisHookTab';
import VideoAnalysisPsychTab from './VideoAnalysisPsychTab';
import VideoAnalysisAlgoTab from './VideoAnalysisAlgoTab';
import VideoAnalysisBlueprintTab from './VideoAnalysisBlueprintTab';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getMessage(field) {
  if (!field) return '';
  if (typeof field === 'string') return field;
  return field.message ?? '';
}

// Recomputes videoType/insightMode from existing video data without an AI call.
// Used when a v5 cache entry is missing insightMode (safety net, not normal path).
function recomputeClassification(cached, video, allVideos, niche) {
  const unified          = scoreVideoUnified(video, allVideos || [], null, niche);
  const computedInsights = generateInsights(unified, null);
  const patched = {
    ...cached,
    blueprint: {
      ...cached.blueprint,
      videoType:    unified.videoType,
      videoAgeDays: unified.videoAgeDays,
      insightMode:  computedInsights.insightMode,
      diagnostics:  computedInsights.diagnostics,
    },
  };
  try {
    localStorage.setItem(DEEP_CACHE_PREFIX + video.id, JSON.stringify(patched));
  } catch {}
  return patched;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const DEEP_CACHE_PREFIX = 'tubeintel_deep_';

function buildTabs(vType) {
  if (vType === 'LEGACY_VIRAL') {
    return [
      { id: 'overview',   label: '📊 Overview',             ai: false, minTier: null },
      { id: 'title',      label: '🎯 Title Intelligence',    ai: true,  minTier: 'pro' },
      { id: 'hook',       label: '🪝 Viewer Entry Analysis', ai: true,  minTier: 'pro' },
      { id: 'psych',      label: '🧠 Psychological Drivers', ai: true,  minTier: 'pro' },
      { id: 'algo',       label: '⚡ Distribution Engine',   ai: true,  minTier: 'pro' },
      { id: 'blueprint',  label: '🏆 Pattern Extraction',   ai: true,  minTier: 'pro' },
    ];
  }
  return [
    { id: 'overview',   label: '📊 Overview',           ai: false, minTier: null },
    { id: 'title',      label: '🎯 Thumbnail & Title',  ai: true,  minTier: 'pro' },
    { id: 'hook',       label: '🪝 Hook & Structure',    ai: true,  minTier: 'pro' },
    { id: 'psych',      label: '🧠 Psychology',          ai: true,  minTier: 'pro' },
    { id: 'algo',       label: '⚡ Algorithm',           ai: true,  minTier: 'pro' },
    { id: 'blueprint',  label: '🏆 Blueprint & Score',  ai: true,  minTier: 'pro' },
  ];
}

export default function VideoAnalysis({
  video, allVideos, channelStats,
  tier, canUseAI, consumeAICall, remainingCalls, onUpgrade,
  onBack, onVideoSelect, onNavigate,
  aiData, setAiData,
  pendingTab,
  niche,
  token, oauthProfile,
}) {
  const isPro = meetsRequirement(tier, 'pro');
  const isAgency = meetsRequirement(tier, 'agency');

  const [activeTab, setActiveTab] = useState('overview');
  const [comments, setComments] = useState(null);
  const [loadingComments, setLoadingComments] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [insights, setInsights] = useState(null);
  const [fixes, setFixes] = useState(null);
  const [progress, setProgress] = useState(0);
  const [copiedReport, setCopiedReport] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [bulkQueue, setBulkQueue] = useState([]);
  const [channelVideos, setChannelVideos] = useState(null);
  const progressTimerRef = useRef(null);
  const tabBarRef = useRef(null);

  useEffect(() => {
    if (pendingTab) setActiveTab(pendingTab);
  }, [pendingTab]);

  // Load cached AI analysis when video changes
  useEffect(() => {
    setAiError('');
    if (!video?.id) {
      setAiData(null);
      return;
    }
    setAiData(null);
    setInsights(null);
    setFixes(null);
    try {
      const cached = localStorage.getItem(DEEP_CACHE_PREFIX + video.id);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed?.blueprint?.scores && parsed.schemaVersion === SCHEMA_VERSION) {
          // Stale LEGACY_VIRAL entries from before intelligence mode — force re-run
          if (parsed.blueprint?.videoType === 'LEGACY_VIRAL' && !parsed.intelligence) return;
          if (parsed.blueprint.insightMode) {
            if (!parsed.diagnosis) {
              parsed._diagnosisOutdated = true;
            }
            setAiData(parsed);
          } else {
            // v5 cache missing insightMode — recompute scoring layer without AI call
            const patched = recomputeClassification(parsed, video, allVideos, niche);
            if (!patched.diagnosis) patched._diagnosisOutdated = true;
            setAiData(patched);
          }
        }
      }
    } catch {}
  }, [video?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch channel videos for unified scoring baseline
  useEffect(() => {
    if (!video?.snippet?.channelId) return;
    setChannelVideos(null);
    fetchChannelVideosExpanded(video.snippet.channelId)
      .then(expanded => {
        setChannelVideos(expanded.length >= 5 ? expanded : (allVideos || []));
      })
      .catch(() => setChannelVideos(allVideos || []));
  }, [video?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch comments
  useEffect(() => {
    if (!video?.id) return;
    setComments(null);
    setLoadingComments(true);
    fetchVideoComments(video.id, 100).then(c => {
      setComments(c);
      setLoadingComments(false);
    });
  }, [video?.id]);

  // Fake progress animation
  useEffect(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (!aiLoading) { setProgress(0); return; }
    setProgress(5);
    progressTimerRef.current = setInterval(() => {
      setProgress(p => p >= 90 ? 90 : p + Math.random() * 5 + 2);
    }, 700);
    return () => clearInterval(progressTimerRef.current);
  }, [aiLoading]);

  const unified = scoreVideoUnified(video, channelVideos, null, niche);
  const { scores, metrics, analysis, channelAvg, ratios, baseline: unifiedBaseline } = unified;
  const score = scores.finalScore;
  const grade = scores.grade;

  const channelBaselineForUI = unifiedBaseline ? {
    likeRate:    unifiedBaseline.medianLikeRate,
    commentRate: unifiedBaseline.medianCommentRate,
  } : null;

  const insightMode = aiData?.blueprint?.insightMode ?? null;
  const videoType   = aiData?.blueprint?.videoType   ?? null;
  const TABS        = buildTabs(videoType);
  const { views, likes, comments: commentCount, engagementRate, duration } = metrics;

  const publishDate = video.snippet?.publishedAt
    ? new Date(video.snippet.publishedAt).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  // Prev / Next
  const vidIdx = allVideos.findIndex(v => v.id === video.id);
  const prevVid = vidIdx > 0 ? allVideos[vidIdx - 1] : null;
  const nextVid = vidIdx < allVideos.length - 1 ? allVideos[vidIdx + 1] : null;

  const handleDeepAnalysis = async () => {
    if (!canUseAI || !canUseAI()) {
      setAiError('No AI calls remaining. Upgrade to unlock deep analysis.');
      return;
    }
    setAiData(null);
    setAiLoading(true);
    setAiError('');
    try {
      const dur = parseDuration(video.contentDetails?.duration);
      const stats = video.statistics || {};
      const vws = parseInt(stats.viewCount || 0);
      const lks = parseInt(stats.likeCount || 0);
      const cms = parseInt(stats.commentCount || 0);

      const videoData = {
        title: video.snippet?.title || '',
        views: formatNum(vws),
        likes: formatNum(lks),
        commentCount: formatNum(cms),
        engagementRate: vws > 0 ? ((lks + cms) / vws * 100).toFixed(2) : '0',
        likeRate: vws > 0 ? (lks / vws * 100).toFixed(2) : '0',
        commentRate: vws > 0 ? (cms / vws * 100).toFixed(3) : '0',
        duration: dur.formatted,
        publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString() : '',
        vsChannelAvg: Math.round(metrics.viewsRatio * 100),
        tags: (video.snippet?.tags || []).slice(0, 10).join(', ') || 'none',
      };

      const commentsText = comments?.length
        ? comments.slice(0, 30).map(c =>
            (c.snippet?.topLevelComment?.snippet?.textDisplay || '').replace(/<[^>]+>/g, '')
          ).filter(Boolean).join('\n')
        : 'No comments available';

      // Use already-loaded channel videos, or fetch if not yet available
      const baselineSource = channelVideos?.length
        ? channelVideos
        : await fetchChannelVideosExpanded(video.snippet?.channelId).catch(() => allVideos || []);

      // Fetch OAuth metrics when this video belongs to the authenticated user's channel
      let oauthMetrics = null;
      const isOwnChannel = token && oauthProfile?.channelId &&
        video.snippet?.channelId === oauthProfile.channelId;
      if (isOwnChannel) {
        const [perVideo, chBaseline] = await Promise.all([
          fetchPerVideoOAuthMetrics(token, video.id, video.snippet?.publishedAt),
          fetchChannelImpressionsBaseline(token, oauthProfile.channelId),
        ]);
        if (perVideo) {
          oauthMetrics = {
            ...perVideo,
            videoLength:           dur.total || 0,
            avgImpressionsPerHour: chBaseline.avgImpressionsPerHour,
            channelAvgCtr:         chBaseline.channelAvgCtr,
          };
        }
      }

      // Unified scoring — single source of truth for both render and analysis
      const unifiedResult = scoreVideoUnified(video, baselineSource, oauthMetrics, niche);
      videoData.videoType   = unifiedResult.videoType;
      videoData.sampleLevel       = unifiedResult.sampleLevel;
      videoData.lowVolume         = unifiedResult.lowVolume;
      videoData.signalState       = unifiedResult.signalState;
      videoData.engagementQuality = unifiedResult.engagementQuality;
      videoData.mismatch          = unifiedResult.mismatch;
      console.log('UNIFIED SCORE:', unifiedResult.scores.finalScore, 'grade:', unifiedResult.scores.grade, 'lowSample:', unifiedResult.lowSample, 'sampleLevel:', unifiedResult.sampleLevel, 'signalState:', unifiedResult.signalState);

      const [deepResult, diagnosis] = await Promise.all([
        analyzeVideoDeep(videoData, commentsText),
        analyzeVideoDiagnosis({ video, unifiedResult }).catch(err => {
          console.warn('[analyzeVideoDiagnosis] failed:', err?.message);
          return null;
        }),
      ]);

      if (deepResult) {
        const isIntelligenceMode = unifiedResult.videoType === 'LEGACY_VIRAL';

        if (!deepResult.blueprint) deepResult.blueprint = {};

        if (!isIntelligenceMode) {
          const aiSignals = await getVideoSignals(videoData).catch(() => null);
          const computedInsights = generateInsights(unifiedResult, aiSignals);
          setInsights(computedInsights);
          setFixes(buildFixCards(computedInsights.actions, unifiedResult.dimensionScores, null));

          deepResult.blueprint.actions              = computedInsights.insightMode === 'OPTIMIZE'
            ? buildActionEngineOutput({ ...unifiedResult, ...computedInsights }).actions
            : [];
          deepResult.blueprint.primaryIssue         = computedInsights.primaryIssue;
          deepResult.blueprint.biggestOpportunity   = computedInsights.biggestOpportunity;
          deepResult.blueprint.diagnosis            = computedInsights.diagnosis;
          deepResult.blueprint.diagnostics          = computedInsights.diagnostics;
          deepResult.blueprint.strengths            = computedInsights.strengths;
          deepResult.blueprint.weaknesses           = computedInsights.weaknesses;
          deepResult.blueprint.insightMode          = computedInsights.insightMode;
        } else {
          // Intelligence mode — no optimization scoring, no action cards
          const computedInsights = generateInsights(unifiedResult, null);
          setInsights(computedInsights);
          setFixes([]);

          deepResult.blueprint.actions              = [];
          deepResult.blueprint.primaryIssue         = computedInsights.primaryIssue;
          deepResult.blueprint.biggestOpportunity   = null;
          deepResult.blueprint.diagnosis            = computedInsights.diagnosis;
          deepResult.blueprint.diagnostics          = computedInsights.diagnostics;
          deepResult.blueprint.strengths            = computedInsights.strengths;
          deepResult.blueprint.weaknesses           = computedInsights.weaknesses;
          deepResult.blueprint.insightMode          = computedInsights.insightMode;
        }

        deepResult.blueprint.confidenceScore      = unifiedResult.confidenceScore;
        deepResult.blueprint.dimensionConfidence  = unifiedResult.dimensionConfidence;
        deepResult.blueprint.mode                 = unifiedResult.mode;
        deepResult.blueprint.format               = unifiedResult.format;
        deepResult.blueprint.oauthDisplay         = unifiedResult.oauthDisplay;
        deepResult.blueprint.scores               = unifiedResult.dimensionScores;
        deepResult.blueprint.viralScore           = unifiedResult.viralScore;
        deepResult.blueprint.grade                = unifiedResult.grade;
        deepResult.blueprint.videoType            = unifiedResult.videoType;
        deepResult.blueprint.videoAgeDays         = unifiedResult.videoAgeDays;
        deepResult.blueprint.baseScore            = unifiedResult.scores.finalScore;
        deepResult.blueprint.finalScore           = adjustScoreWithAI(unifiedResult.scores.finalScore, deepResult.blueprint?.contentType);
        console.log('BLUEPRINT SCORES — base:', deepResult.blueprint.baseScore, 'final:', deepResult.blueprint.finalScore, 'contentType:', deepResult.blueprint.contentType);

        deepResult.diagnosis = diagnosis;
        console.log('[analyzeVideoDiagnosis]', deepResult.diagnosis);

        consumeAICall();
        setAiData(deepResult);
        setProgress(100);
        try {
          if (deepResult?.blueprint?.scores) {
            localStorage.setItem(
              DEEP_CACHE_PREFIX + video.id,
              JSON.stringify({ ...deepResult, schemaVersion: SCHEMA_VERSION })
            );
          }
        } catch {}
      } else {
        setAiError('Analysis returned an unexpected format. Please try again.');
      }
    } catch (e) {
      setAiError(e?.message || String(e) || 'Analysis failed. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  // Routes to upgrade modal (free) or runs analysis (pro)
  const handleRunDeepClick = () => {
    if (!isPro) { setShowUpgradeModal(true); return; }
    if (!canUseAI?.()) { onUpgrade?.(); return; }
    handleDeepAnalysis();
  };

  // ── Comparison chart data (median-based) ───────────────────────────────────
  const medianLikes    = unifiedBaseline ? unifiedBaseline.medianViews * unifiedBaseline.medianLikeRate / 100 : 0;
  const medianComments = unifiedBaseline ? unifiedBaseline.medianViews * unifiedBaseline.medianCommentRate / 100 : 0;
  const comparisonData = [
    { metric: 'Views',    pct: channelAvg.views > 0 ? Math.round(views        / channelAvg.views * 100) : 0, raw: views,        avg: Math.round(channelAvg.views) },
    { metric: 'Likes',    pct: medianLikes       > 0 ? Math.round(likes        / medianLikes       * 100) : 0, raw: likes,        avg: Math.round(medianLikes) },
    { metric: 'Comments', pct: medianComments    > 0 ? Math.round(commentCount / medianComments    * 100) : 0, raw: commentCount, avg: Math.round(medianComments) },
  ];

  // ── Timestamps ──────────────────────────────────────────────────────────────
  const timestamps = comments && duration.total > 0 ? extractTimestamps(comments, duration.total) : [];
  const maxTimestampCount = Math.max(...timestamps.map(t => t.count), 1);

  // ── Blueprint dimension scores ──────────────────────────────────────────────
  const bpScores = aiData?.blueprint?.scores || {};

  // ── Copy full report ────────────────────────────────────────────────────────
  const handleCopyReport = () => {
    const lines = [
      `=== TubeIntel Deep Analysis ===`,
      `Video: "${video.snippet?.title}"`,
      `Published: ${publishDate || '—'} | Duration: ${duration.formatted}`,
      `Views: ${formatNum(views)} | Likes: ${formatNum(likes)} | Engagement: ${engagementRate.toFixed(2)}%`,
      '',
    ];
    if (aiData?.blueprint) {
      const bp = aiData.blueprint;
      lines.push(`Overall Score: ${bp.viralScore}/100 (${bp.grade})`);
      lines.push(`Content DNA: ${bp.contentDNA}`);
      lines.push('');
      if (bp.replicationBlueprint?.length) {
        lines.push('--- Replication Blueprint ---');
        bp.replicationBlueprint.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        lines.push('');
      }
      if (bp.lessons?.length) {
        lines.push('--- Actionable Lessons ---');
        bp.lessons.forEach(l => lines.push(`• ${l.title}: ${l.detail}`));
        lines.push('');
      }
      lines.push(`Strengths: ${bp.strengths}`);
      lines.push(`Improvements: ${bp.improvements}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // ── TAB RENDERERS ───────────────────────────────────────────────────────────

  const renderOverviewTab = () => (
    <VideoAnalysisOverview
      aiData={aiData} aiLoading={aiLoading}
      handleRunDeepClick={handleRunDeepClick} isPro={isPro}
      grade={grade} score={score} metrics={metrics}
      video={video} allVideos={allVideos} channelAvg={channelAvg}
      canUseAI={canUseAI} consumeAICall={consumeAICall}
      remainingCalls={remainingCalls} onUpgrade={onUpgrade}
      analysis={analysis}
      comparisonData={comparisonData}
      loadingComments={loadingComments} timestamps={timestamps}
      maxTimestampCount={maxTimestampCount} comments={comments}
    />
  );

  // ── Tab 2: Thumbnail & Title ────────────────────────────────────────────────
  const renderTitleTab = () => (
    <VideoAnalysisTitleTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      videoType={videoType}
    />
  );

  // ── Tab 3: Hook & Structure ─────────────────────────────────────────────────
  const renderHookTab = () => (
    <VideoAnalysisHookTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      videoType={videoType}
    />
  );

  // ── Tab 4: Psychology & Retention ──────────────────────────────────────────
  const renderPsychTab = () => (
    <VideoAnalysisPsychTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      videoType={videoType}
    />
  );

  // ── Tab 5: Algorithm & Virality ─────────────────────────────────────────────
  const renderAlgoTab = () => (
    <VideoAnalysisAlgoTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      videoType={videoType}
    />
  );

  const handleActionClick = (action) => {
    onNavigate('improve', { actionType: action.type, insightMode, videoType });
  };

  // ── Tab 6: Blueprint & Score ────────────────────────────────────────────────
  const renderBlueprintTab = () => (
    <VideoAnalysisBlueprintTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      copiedReport={copiedReport} onCopyReport={handleCopyReport}
      onActionClick={handleActionClick}
      insightMode={insightMode}
      sampleLevel={unified.sampleLevel}
    />
  );

  const tabContent = {
    overview:  renderOverviewTab,
    title:     renderTitleTab,
    hook:      renderHookTab,
    psych:     renderPsychTab,
    algo:      renderAlgoTab,
    blueprint: renderBlueprintTab,
  };

  // ── JSX ─────────────────────────────────────────────────────────────────────
  return (
    <div className="analysis-page">
      {/* Video Header */}
      <div className="video-header-card">
        <div className="video-header-inner">
          <div className="video-thumb-wrap">
            {video.snippet?.thumbnails?.high?.url && (
              <img src={video.snippet.thumbnails.high.url} alt="" className="video-header-thumb" />
            )}
            <a href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank" rel="noreferrer" className="watch-btn">
              ▶ Watch on YouTube
            </a>
          </div>
          <div className="video-header-info">
            <h2 className="video-analysis-title">{video.snippet?.title}</h2>
            <div className="video-meta-row">
              {publishDate && <span className="video-meta-item">📅 {publishDate}</span>}
              <span className="video-meta-item">⏱ {duration.formatted}</span>
            </div>
            <div className="video-quick-stats">
              <div className="vqs-item"><div className="vqs-val">{formatNum(views)}</div><div className="vqs-label">Views</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item"><div className="vqs-val">{formatNum(likes)}</div><div className="vqs-label">Likes</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item"><div className="vqs-val">{formatNum(commentCount)}</div><div className="vqs-label">Comments</div></div>
              <div className="vqs-sep" />
              <div className="vqs-item">
                <div className="vqs-val" style={{ color: engagementRate > 3 ? '#00c853' : engagementRate > 1.5 ? '#ff9100' : '#ff1744' }}>
                  {engagementRate.toFixed(2)}%
                </div>
                <div className="vqs-label">Engagement</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Breadcrumb + Nav */}
      <div style={{
        padding: '10px 0 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 0, fontSize: 12 }}>
            ← Back to Videos
          </button>
          <span>/</span>
          <span style={{ color: '#888', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {video.snippet?.title}
          </span>
        </div>
        {onVideoSelect && allVideos.length > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => prevVid && onVideoSelect(prevVid)}
              disabled={!prevVid}
              style={{
                background: '#111', border: '1px solid #222', borderRadius: 6,
                padding: '5px 12px', fontSize: 12, color: prevVid ? '#bbb' : '#333',
                cursor: prevVid ? 'pointer' : 'not-allowed',
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: '#444', alignSelf: 'center' }}>
              {vidIdx + 1}/{allVideos.length}
            </span>
            <button
              onClick={() => nextVid && onVideoSelect(nextVid)}
              disabled={!nextVid}
              style={{
                background: '#111', border: '1px solid #222', borderRadius: 6,
                padding: '5px 12px', fontSize: 12, color: nextVid ? '#bbb' : '#333',
                cursor: nextVid ? 'pointer' : 'not-allowed',
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      <SummaryBox
        video={video}
        aiData={aiData}
        aiLoading={aiLoading}
        onAnalyze={handleRunDeepClick}
        insightMode={insightMode}
        metrics={metrics}
        channelAvg={channelAvg}
        channelBaseline={channelBaselineForUI}
        sampleLevel={unified.sampleLevel}
        lowVolume={unified.lowVolume}
        signalState={unified.signalState}
        engagementQuality={unified.engagementQuality}
        mismatch={unified.mismatch}
      />
      {aiData && !aiLoading && (
        insightMode === 'CONTEXT' ? (
          <div style={{
            background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 12,
            padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            marginTop: 4,
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#6b7280', marginBottom: 4 }}>
                {videoType === 'EARLY' ? '🕐 Early distribution phase' : '📖 Historical context available'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#4b5563', lineHeight: 1.6 }}>
                {videoType === 'EARLY'
                  ? 'Signals are not yet stable — check back after 48–72 hours for reliable data.'
                  : 'This video has reached peak distribution — view contextual performance data.'}
              </div>
            </div>
            <button
              onClick={() => onNavigate?.('improve', { insightMode, videoType })}
              style={{
                background: '#111', border: '1px solid #2a2a2a', borderRadius: 8,
                padding: '10px 20px', fontWeight: 800, fontSize: '0.82rem',
                color: '#6b7280', cursor: 'pointer', flexShrink: 0,
              }}
            >
              View Context →
            </button>
          </div>
        ) : insightMode === 'DIAGNOSE' ? (
          <div style={{
            background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 12,
            padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            marginTop: 4,
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#9ca3af', marginBottom: 4 }}>
                📊 Performance Breakdown available
              </div>
              <div style={{ fontSize: '0.75rem', color: '#4b5563', lineHeight: 1.6 }}>
                This video is not in an active growth phase — see what influenced its performance.
              </div>
            </div>
            <button
              onClick={() => onNavigate?.('improve', { insightMode, videoType })}
              style={{
                background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
                padding: '10px 20px', fontWeight: 800, fontSize: '0.82rem',
                color: '#9ca3af', cursor: 'pointer', flexShrink: 0,
              }}
            >
              View Analysis →
            </button>
          </div>
        ) : (
          <div style={{
            background: 'linear-gradient(135deg, #0d0920 0%, #0a0a12 100%)',
            border: '1px solid #2a1060', borderRadius: 12,
            padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            marginTop: 4,
          }}>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#e9d5ff', marginBottom: 4 }}>
                ✨ Ready to fix this video?
              </div>
              <div style={{ fontSize: '0.75rem', color: '#5a4a7a', lineHeight: 1.6 }}>
                Generate AI-written title rewrites, hook scripts, CTAs, and a viral playbook — specific to this video.
              </div>
            </div>
            <button
              onClick={() => onNavigate?.('improve', { insightMode, videoType })}
              style={{
                background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
                color: '#f3e8ff', border: 'none', borderRadius: 8,
                padding: '10px 20px', fontWeight: 800, fontSize: '0.82rem',
                cursor: 'pointer', flexShrink: 0,
                boxShadow: '0 0 16px rgba(124,58,237,0.3)',
              }}
            >
              Fix My Video →
            </button>
          </div>
        )
      )}
      {/* Sticky Tab Bar */}
      <div ref={tabBarRef} className="video-tabs">
        {TABS.map(tab => {
          const locked = tab.minTier && !meetsRequirement(tier, tab.minTier);
          return (
            <button
              key={tab.id}
              className={`video-tab${activeTab === tab.id ? ' active' : ''}${locked ? ' locked' : ''}`}
              onClick={() => {
                if (locked) { setShowUpgradeModal(true); return; }
                setActiveTab(tab.id);
              }}
              title={locked ? 'Pro feature — upgrade to unlock' : undefined}
            >
              {tab.label}
              {locked && <span style={{ marginLeft: 5, fontSize: 10, verticalAlign: 'middle' }}>🔒</span>}
              {!locked && tab.ai && aiData && <span style={{ marginLeft: 5, fontSize: 9, color: '#00c853', verticalAlign: 'middle' }}>●</span>}
            </button>
          );
        })}
      </div>

      {/* ── Run Deep Analysis CTA — prominent, below header ── */}
      {!aiData && !aiLoading && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '20px 0 12px', gap: 10,
        }}>
          <button
            onClick={handleRunDeepClick}
            disabled={aiLoading}
            className="run-analysis-glow-btn"
          >
            {aiLoading && <span className="btn-spinner" />}
            🧠 Run Deep Analysis
          </button>
          <div style={{ fontSize: 12, color: '#444' }}>
            {!isPro
              ? '🔒 Pro & Agency only — click to upgrade'
              : canUseAI?.()
              ? `Unlocks all 5 AI tabs · ${remainingCalls?.() ?? '?'} AI calls remaining`
              : 'No AI calls left — upgrade for more'}
          </div>
        </div>
      )}
      {aiLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ fontSize: 13, color: '#666', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="btn-spinner" />
            Running analysis…
          </div>
        </div>
      )}

      {/* AI Progress Bar */}
      {aiLoading && (
        <div style={{ padding: '14px 0 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13, color: '#888' }}>
            <span>
              🧠 TubeIntel is analyzing {
                progress < 20 ? 'title & thumbnail' :
                progress < 40 ? 'hook & structure' :
                progress < 60 ? 'psychology & retention' :
                progress < 80 ? 'algorithm factors' : 'final blueprint'
              }…
            </span>
            <span style={{ color: '#555' }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 4, background: '#111', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #7c4dff, #00c853)', borderRadius: 2, transition: 'width 0.5s ease' }} />
          </div>
        </div>
      )}

      {/* Sticky mini-CTA bar — shows on AI tabs when analysis not yet run */}
      {!aiData && !aiLoading && TABS.find(t => t.id === activeTab)?.ai && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
          padding: '10px 0', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, color: '#666' }}>
            🧠 Run Deep Analysis to unlock AI-powered insights for all 5 dimensions
          </span>
          <button
            onClick={handleRunDeepClick}
            className="run-analysis-glow-btn"
            style={{ padding: '7px 18px', fontSize: 12, flexShrink: 0 }}
          >
            {!isPro ? '🔒 Pro Feature' : '🧠 Run Deep Analysis'}
          </button>
        </div>
      )}

      {aiError && <div className="search-error" style={{ marginTop: 12 }}>{aiError}</div>}

      {/* Tab Content */}
      <div style={{ paddingTop: 8 }}>
        {(() => {
          const tab = TABS.find(t => t.id === activeTab);
          const locked = tab?.minTier && !meetsRequirement(tier, tab.minTier);
          if (locked) {
            return <LockedTabContent tabLabel={tab.label} onUpgrade={() => setShowUpgradeModal(true)} />;
          }
          const content = (tabContent[activeTab] || tabContent.overview)();
          // For overview tab on free tier, append the teaser card
          if (activeTab === 'overview' && !isPro) {
            return (
              <>
                {content}
                <ProTeaserCard score={score} onUpgrade={() => setShowUpgradeModal(true)} />
              </>
            );
          }
          return content;
        })()}
      </div>

      {/* Insights Layer */}
      {insights && (
        <div style={{ marginTop: 20, padding: '16px 20px', background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: 12 }}>
          {insights.strengths?.length > 0 && (
            <>
              <h3 style={{ color: '#00c853', fontSize: '0.85rem', fontWeight: 700, marginBottom: 8 }}>Strengths</h3>
              <p style={{ margin: '0 0 16px', color: '#aaa', fontSize: '0.82rem', lineHeight: 1.6 }}>{insights.strengths}</p>
            </>
          )}
          {insights.weaknesses?.length > 0 && (
            <>
              <h3 style={{ color: '#ff1744', fontSize: '0.85rem', fontWeight: 700, marginBottom: 8 }}>Weaknesses</h3>
              <p style={{ margin: '0 0 16px', color: '#aaa', fontSize: '0.82rem', lineHeight: 1.6 }}>{insights.weaknesses}</p>
            </>
          )}
          {insights.actions.length > 0 && (
            <>
              <h3 style={{ color: '#ff9100', fontSize: '0.85rem', fontWeight: 700, marginBottom: 10 }}>Actions</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.actions.map((a, i) => {
                  const priorityColor = a.priority === 'HIGH' ? '#ff1744' : a.priority === 'MEDIUM' ? '#ff9100' : '#4a9eff';
                  return (
                    <div key={i} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
                          color: priorityColor, background: priorityColor + '18',
                          borderRadius: 4, padding: '2px 7px',
                        }}>
                          {a.priority}
                        </span>
                      </div>
                      <div style={{ color: '#ddd', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: 6 }}>{a.fix}</div>
                      <div style={{ color: '#555', fontSize: '0.75rem', lineHeight: 1.5 }}>→ {a.impact}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Fix Cards */}
      {fixes && fixes.length > 0 && (() => {
        const QUICK_FIX_DIMS = new Set(['packaging', 'engagement', 'seo']);
        const sorted = [...fixes].sort((a, b) => {
          const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
          return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
        });

        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#333', marginBottom: 14 }}>
              Fix Plan
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sorted.map((card, i) => {
                const isHigh = card.priority === 'HIGH';
                const isMed  = card.priority === 'MEDIUM';
                const priorityColor = isHigh ? '#ff1744' : isMed ? '#ff9100' : '#4a8cff';

                const isQuick = QUICK_FIX_DIMS.has(card.dimension);
                const fixLabel = isQuick ? '🟢 Fix in 2 mins' : '🔴 Requires re-upload';

                const delta = card.expectedImpact?.scoreDelta;
                const gain  = card.expectedImpact?.viralScoreGain;
                const impactLine = [delta, gain].filter(Boolean).join('  ·  ');

                const DIM_LABELS = {
                  packaging:  'Packaging',
                  engagement: 'Engagement',
                  seo:        'SEO',
                  velocity:   'Velocity',
                };

                return (
                  <div
                    key={i}
                    style={{
                      background: '#0c0c0c',
                      border: `1px solid ${priorityColor}${isHigh ? '44' : '28'}`,
                      borderLeft: `3px solid ${priorityColor}`,
                      borderRadius: 10,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Row 1: priority + fix-type */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '9px 14px', background: priorityColor + '0a',
                    }}>
                      <span style={{
                        fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.12em',
                        color: priorityColor, background: priorityColor + '1a',
                        borderRadius: 4, padding: '2px 8px',
                      }}>
                        {card.priority}
                      </span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#888', flex: 1 }}>
                        {DIM_LABELS[card.dimension] || card.dimension}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: '#555', flexShrink: 0 }}>
                        {fixLabel}
                      </span>
                    </div>

                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Row 2: issue */}
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isHigh ? '#eee' : '#ccc', lineHeight: 1.4 }}>
                        {card.issue}
                      </div>

                      {/* Row 3: exact fix — command style */}
                      <div style={{ fontSize: '0.8rem', color: '#888', lineHeight: 1.6 }}>
                        {card.exactFix}
                      </div>

                      {/* Row 4: before / after example */}
                      {card.example && (
                        <div style={{
                          background: '#111', border: '1px solid #1e1e1e',
                          borderRadius: 8, overflow: 'hidden',
                        }}>
                          {/* Before */}
                          <div style={{
                            display: 'flex', gap: 8, alignItems: 'flex-start',
                            padding: '8px 12px', borderBottom: '1px solid #181818',
                          }}>
                            <span style={{ fontSize: '0.75rem', flexShrink: 0, marginTop: 1 }}>❌</span>
                            <div>
                              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#3a3a3a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                                Instead of
                              </div>
                              <div style={{ fontSize: '0.76rem', color: '#555', lineHeight: 1.5 }}>
                                {card.example.pattern.replace(/^Instead of:\s*/i, '')}
                              </div>
                            </div>
                          </div>
                          {/* After */}
                          <div style={{
                            display: 'flex', gap: 8, alignItems: 'flex-start',
                            padding: '8px 12px',
                          }}>
                            <span style={{ fontSize: '0.75rem', flexShrink: 0, marginTop: 1 }}>✅</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#3a3a3a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                  Use
                                </span>
                                {card.example.source === 'ai' && (
                                  <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#7c3aed', background: '#7c3aed18', borderRadius: 3, padding: '1px 5px' }}>
                                    AI
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.76rem', color: '#bbb', lineHeight: 1.55, fontStyle: card.example.source === 'ai' ? 'italic' : 'normal' }}>
                                {card.example.use.replace(/^Use:\s*/i, '')}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Row 5: impact */}
                      {impactLine && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#00c853' }}>
                            🔥 {impactLine} potential
                          </span>
                          {card.expectedImpact?.mechanism && (
                            <span style={{ fontSize: '0.7rem', color: '#333' }}>
                              · {DIM_LABELS[card.dimension] || card.dimension}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Agency: Bulk Analyze */}
      {isAgency && activeTab === 'overview' && allVideos.length > 1 && (
        <AgencyBulkPanel
          videos={allVideos}
          currentVideoId={video.id}
          bulkQueue={bulkQueue}
          setBulkQueue={setBulkQueue}
          onVideoSelect={onVideoSelect}
        />
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <UpgradeModal onUpgrade={onUpgrade} onClose={() => setShowUpgradeModal(false)} />
      )}
    </div>
  );
}
