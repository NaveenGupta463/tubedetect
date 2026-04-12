import { useState, useEffect, useRef } from 'react';
import { fetchVideoComments } from '../api/youtube';
import { analyzeVideoDeep } from '../api/claude';
import { analyzeVideo, extractTimestamps, formatNum, parseDuration } from '../utils/analysis';
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
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const DEEP_CACHE_PREFIX = 'tubeintel_deep_';

const TABS = [
  { id: 'overview',   label: '📊 Overview',           ai: false, minTier: null },
  { id: 'title',      label: '🎯 Thumbnail & Title',  ai: true,  minTier: 'pro' },
  { id: 'hook',       label: '🪝 Hook & Structure',    ai: true,  minTier: 'pro' },
  { id: 'psych',      label: '🧠 Psychology',          ai: true,  minTier: 'pro' },
  { id: 'algo',       label: '⚡ Algorithm',           ai: true,  minTier: 'pro' },
  { id: 'blueprint',  label: '🏆 Blueprint & Score',  ai: true,  minTier: 'pro' },
];

export default function VideoAnalysis({
  video, allVideos, channelStats,
  tier, canUseAI, consumeAICall, remainingCalls, onUpgrade,
  onBack, onVideoSelect, onNavigate,
  aiData, setAiData,
}) {
  const isPro = meetsRequirement(tier, 'pro');
  const isAgency = meetsRequirement(tier, 'agency');

  const [activeTab, setActiveTab] = useState('overview');
  const [comments, setComments] = useState(null);
  const [loadingComments, setLoadingComments] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [progress, setProgress] = useState(0);
  const [copiedReport, setCopiedReport] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [bulkQueue, setBulkQueue] = useState([]);
  const progressTimerRef = useRef(null);
  const tabBarRef = useRef(null);

  // Load cached AI analysis when video changes (only if not already in global state)
  useEffect(() => {
    setAiError('');
    if (!video?.id) { setAiData(null); return; }
    if (aiData) return; // already loaded globally
    try {
      const cached = localStorage.getItem(DEEP_CACHE_PREFIX + video.id);
      if (cached) setAiData(JSON.parse(cached));
    } catch {}
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

  const result = analyzeVideo(video, allVideos, channelStats);
  const { score, grade, metrics, analysis, channelAvg } = result;
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

      const deepResult = await analyzeVideoDeep(videoData, commentsText);
      if (deepResult) {
        consumeAICall();
        setAiData(deepResult);   // writes to global App state
        setProgress(100);
        try { localStorage.setItem(DEEP_CACHE_PREFIX + video.id, JSON.stringify(deepResult)); } catch {}
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

  // ── Comparison chart data ───────────────────────────────────────────────────
  const comparisonData = [
    { metric: 'Views',    'This Video': views,        'Channel Avg': Math.round(channelAvg.views) },
    { metric: 'Likes',    'This Video': likes,        'Channel Avg': Math.round(allVideos.reduce((s, v) => s + parseInt(v.statistics?.likeCount || 0), 0) / allVideos.length) },
    { metric: 'Comments', 'This Video': commentCount, 'Channel Avg': Math.round(allVideos.reduce((s, v) => s + parseInt(v.statistics?.commentCount || 0), 0) / allVideos.length) },
  ];

  // ── Timestamps ──────────────────────────────────────────────────────────────
  const timestamps = comments && duration.total > 0 ? extractTimestamps(comments, duration.total) : [];
  const maxTimestampCount = Math.max(...timestamps.map(t => t.count), 1);

  // ── Blueprint score rings ───────────────────────────────────────────────────
  const bpScores = aiData?.blueprint?.scores || {};
  const overviewRings = [
    { score: bpScores.titleThumbnail ?? null,      label: 'Title &\nThumb' },
    { score: bpScores.hookRetention ?? null,       label: 'Hook &\nRetention' },
    { score: bpScores.contentStructure ?? null,    label: 'Structure' },
    { score: bpScores.engagement ?? null,          label: 'Engagement' },
    { score: bpScores.algorithm ?? null,           label: 'Algorithm' },
    { score: bpScores.seoDiscoverability ?? null,  label: 'SEO' },
    { score: bpScores.emotionalImpact ?? null,     label: 'Emotion' },
    { score: bpScores.valueDelivery ?? null,       label: 'Value' },
  ];

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
      lines.push(`Overall Score: ${bp.overallScore}/100 (${bp.grade})`);
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
      overviewRings={overviewRings}
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
    />
  );

  // ── Tab 3: Hook & Structure ─────────────────────────────────────────────────
  const renderHookTab = () => (
    <VideoAnalysisHookTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
    />
  );

  // ── Tab 4: Psychology & Retention ──────────────────────────────────────────
  const renderPsychTab = () => (
    <VideoAnalysisPsychTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
    />
  );

  // ── Tab 5: Algorithm & Virality ─────────────────────────────────────────────
  const renderAlgoTab = () => (
    <VideoAnalysisAlgoTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
    />
  );

  // ── Tab 6: Blueprint & Score ────────────────────────────────────────────────
  const renderBlueprintTab = () => (
    <VideoAnalysisBlueprintTab
      aiData={aiData} aiLoading={aiLoading}
      handleDeepAnalysis={handleDeepAnalysis}
      canUseAI={canUseAI} onUpgrade={onUpgrade}
      copiedReport={copiedReport} onCopyReport={handleCopyReport}
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
      <SummaryBox
        video={video}
        aiData={aiData}
        aiLoading={aiLoading}
        onAnalyze={handleRunDeepClick}
      />
      {aiData && !aiLoading && (
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
            onClick={() => onNavigate?.('improve')}
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
      )}
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

        {/* Prev / Next */}
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
