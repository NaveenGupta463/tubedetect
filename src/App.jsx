import { useState, useCallback, useEffect } from 'react';
import { useTier } from './hooks/useTier';
import { useOAuth } from './hooks/useOAuth';

import Sidebar from './components/Sidebar';
import Header from './components/Header';

// Core views
import ChannelSearch from './components/ChannelSearch';
import ChannelOverview from './components/ChannelOverview';
import VideoGrid, { saveLastChannel, loadLastChannel } from './components/VideoGrid';
import VideoAnalysis from './components/VideoAnalysis';
import { fetchChannel, fetchChannelVideos, fetchVideoById } from './api/youtube';

// Analytics
import BestTimeToPost from './components/BestTimeToPost';
import UploadCadenceTracker from './components/UploadCadenceTracker';
import SeoTagAnalyzer from './components/SeoTagAnalyzer';
import CompetitorComparison from './components/CompetitorComparison';

// AI Tools
import ViralFormulaDecoder from './components/ViralFormulaDecoder';
import TitleThumbnailScorer from './components/TitleThumbnailScorer';
import CommentSentimentMiner from './components/CommentSentimentMiner';
import ScriptOutlineGenerator from './components/ScriptOutlineGenerator';
import NicheTrendScanner from './components/NicheTrendScanner';

// Pre-Publish
import PrePublishValidator from './components/PrePublishValidator';

// My Analytics
import MyChannelAnalytics from './components/MyChannelAnalytics';

// Account
import SavedWorkspaces from './components/SavedWorkspaces';
import WeeklyPdfReport from './components/WeeklyPdfReport';
import PricingPage from './components/PricingPage';

// Improve hub (Fix My Video + Viral Playbook standalone view)
import ImproveHub from './components/ImproveHub';

export default function App() {
  const { tier, setTier, canUseAI, consumeAICall, remainingCalls } = useTier();
  const { token, profile: oauthProfile, isConnected, connect, disconnect } = useOAuth();

  const [activeView,    setActiveView]    = useState('discover');
  const [channel,       setChannel]       = useState(null);
  const [videos,        setVideos]        = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoAiData,   setVideoAiData]   = useState(null);
  const [competitors,   setCompetitors]   = useState([]);
  // 'grid' sub-view for the video section: show grid or individual video
  const [videoSubView,  setVideoSubView]  = useState('grid'); // 'grid' | 'video'
  const [savedScrollY,  setSavedScrollY]  = useState(0);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [deepLinkError,   setDeepLinkError]   = useState('');

  // ── Deep-link via URL query params (from Chrome extension) ──────────────
  // Extension opens: http://localhost:5173?action=video&id=XXX
  //                  http://localhost:5173?action=channel&q=@handle
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const id     = params.get('id');
    const q      = params.get('q');

    if (!action) return;

    // Clean URL immediately so refresh doesn't re-trigger
    window.history.replaceState(null, '', window.location.pathname);

    if (action === 'video' && id) {
      setDeepLinkLoading(true);
      setDeepLinkError('');
      (async () => {
        try {
          const video = await fetchVideoById(id);
          const chId  = video.snippet?.channelId;
          let ch = null, vids = [];
          if (chId) {
            try {
              ch   = await fetchChannel(chId);
              vids = await fetchChannelVideos(chId, 50);
            } catch {}
          }
          setChannel(ch);
          setVideos(vids);
          setSelectedVideo(video);
          setVideoSubView('video');
          setActiveView('video');
        } catch (e) {
          setDeepLinkError(`Could not load video: ${e.message}`);
          setActiveView('search');
        } finally {
          setDeepLinkLoading(false);
        }
      })();
    } else if (action === 'channel' && q) {
      setDeepLinkLoading(true);
      setDeepLinkError('');
      (async () => {
        try {
          const ch   = await fetchChannel(q);
          const vids = await fetchChannelVideos(ch.id, 50);
          setChannel(ch);
          setVideos(vids);
          saveLastChannel(ch, vids);
          setVideoSubView('grid');
          setActiveView('channel');
        } catch (e) {
          setDeepLinkError(`Could not load channel: ${e.message}`);
          setActiveView('search');
        } finally {
          setDeepLinkLoading(false);
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── History API: push a state entry on every navigation ──────────────────
  const pushNav = useCallback((state) => {
    window.history.pushState(state, '');
  }, []);

  // Restore state when user hits back/forward
  useEffect(() => {
    // Stamp the initial entry so the very first back press has somewhere to land
    window.history.replaceState({ view: 'search' }, '');

    function onPop(e) {
      const s = e.state;
      if (!s) return;

      if (s.view === 'video' && s.videoId) {
        // Find video in current videos array by id
        setVideos(prev => {
          const vid = prev.find(v => v.id === s.videoId);
          if (vid) {
            setSelectedVideo(vid);
            setVideoSubView('video');
          } else {
            setVideoSubView('grid');
          }
          return prev;
        });
        setActiveView('video');
        if (s.scrollY != null) setTimeout(() => window.scrollTo(0, s.scrollY), 50);
      } else if (s.view === 'grid') {
        setVideoSubView('grid');
        setActiveView('video');
        if (s.scrollY != null) setTimeout(() => window.scrollTo(0, s.scrollY), 50);
      } else {
        setActiveView(s.view || 'search');
      }
    }

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpgrade = useCallback(() => {
    pushNav({ view: 'pricing' });
    setActiveView('pricing');
  }, [pushNav]);

  const handleChannelLoad = useCallback((ch, vids) => {
    setChannel(ch);
    setVideos(vids);
    saveLastChannel(ch, vids);
    setVideoSubView('grid');
    pushNav({ view: 'discover' });
    setActiveView('discover');
  }, [pushNav]);

  const handleVideoSelect = useCallback((video) => {
    const scrollY = window.scrollY;
    setSavedScrollY(scrollY);
    setSelectedVideo(video);
    try {
      const cached = localStorage.getItem('tubeintel_deep_' + video.id);
      setVideoAiData(cached ? JSON.parse(cached) : null);
    } catch {
      setVideoAiData(null);
    }
    setVideoSubView('video');
    pushNav({ view: 'video', videoId: video.id, scrollY });
    setActiveView('video');
    window.scrollTo(0, 0);
  }, [pushNav]);

  const handleBackToGrid = useCallback(() => {
    // Use browser back — popstate will restore the grid state
    window.history.back();
  }, []);

  const handleNavigate = useCallback((view) => {
    // 'analyze' from sidebar = browse grid; everywhere else, preserve videoSubView
    if (view === 'analyze') setVideoSubView('grid');
    pushNav({ view });
    setActiveView(view);
  }, [pushNav]);

  // Navigate to the current video's analysis page without resetting to grid
  const handleGoToCurrentVideo = useCallback(() => {
    if (selectedVideo) setVideoSubView('video');
    setActiveView('analyze');
  }, [selectedVideo]);

  const handleLoadWorkspace = useCallback((ws) => {
    if (ws.primary) {
      setChannel(ws.primary.channelData);
      setVideos(ws.primary.videos || []);
      setCompetitors(ws.competitors || []);
      setVideoSubView('grid');
      setActiveView('channel');
    }
  }, []);

  const handleSelectTier = useCallback((tierId) => {
    setTier(tierId);
    setActiveView(channel ? 'channel' : 'search');
  }, [setTier, channel]);

  // AI props bundle passed to all AI components
  const aiProps = { tier, canUseAI, consumeAICall, remainingCalls, onUpgrade: handleUpgrade };

  const renderView = () => {
    switch (activeView) {
      // ── New primary nav views ──────────────────────────────────────────────
      case 'discover':
        if (!channel) return <ChannelSearch onLoad={handleChannelLoad} />;
        return (
          <>
            <div style={{
              background: 'linear-gradient(135deg, #08080f 0%, #0d0d0d 100%)',
              border: '1px solid #1a1a2e', borderRadius: 14, padding: '18px 22px',
              marginBottom: 20,
            }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#333', marginBottom: 12 }}>
                What do you want to do today?
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleNavigate('analyze')}
                  style={{
                    flex: 1, minWidth: 140, background: '#111', border: '1px solid #222',
                    borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>🎬</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ccc' }}>Analyze a Video</span>
                  <span style={{ fontSize: '0.72rem', color: '#444' }}>Deep performance breakdown</span>
                </button>
                <button
                  onClick={() => handleNavigate('improve')}
                  style={{
                    flex: 1, minWidth: 140, position: 'relative', overflow: 'hidden',
                    background: 'linear-gradient(135deg, #1a0e35 0%, #2d1065 100%)',
                    border: '1px solid #7c3aed66', borderRadius: 10, padding: '12px 16px',
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    boxShadow: '0 0 20px rgba(124,58,237,0.2)',
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>✨</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#e9d5ff' }}>Fix My Video</span>
                  <span style={{ fontSize: '0.72rem', color: '#7c5bb5' }}>AI rewrites, hooks &amp; CTAs</span>
                  <span style={{
                    position: 'absolute', top: 8, right: 8,
                    fontSize: 8, fontWeight: 800, background: '#7c3aed', color: '#fff',
                    borderRadius: 4, padding: '2px 6px', letterSpacing: 0.3,
                  }}>MOST POWERFUL</span>
                </button>
                <button
                  onClick={() => handleNavigate('trends')}
                  style={{
                    flex: 1, minWidth: 140, background: '#111', border: '1px solid #222',
                    borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>🔥</span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ccc' }}>Research Niche</span>
                  <span style={{ fontSize: '0.72rem', color: '#444' }}>Trend gaps &amp; video ideas</span>
                </button>
              </div>
            </div>
            <ChannelOverview channel={channel} videos={videos} onVideoSelect={handleVideoSelect} competitors={competitors} />
          </>
        );

      case 'analyze':
        if (videoSubView === 'video' && selectedVideo) {
          return (
            <VideoAnalysis
              video={selectedVideo}
              allVideos={videos}
              channelStats={channel?.statistics}
              onBack={handleBackToGrid}
              onVideoSelect={handleVideoSelect}
              onNavigate={handleNavigate}
              aiData={videoAiData}
              setAiData={setVideoAiData}
              {...aiProps}
            />
          );
        }
        return channel
          ? <VideoGrid channel={channel} videos={videos} onVideoSelect={handleVideoSelect} onSwitchChannel={() => handleNavigate('discover')} />
          : <ChannelSearch onLoad={handleChannelLoad} />;

      case 'improve':
        return (
          <ImproveHub
            video={selectedVideo}
            aiData={videoAiData}
            onNavigate={handleNavigate}
            onGoToVideo={handleGoToCurrentVideo}
            {...aiProps}
          />
        );

      // ── Legacy IDs kept for extension deep-links ───────────────────────────
      case 'search':
        return <ChannelSearch onLoad={handleChannelLoad} />;

      case 'channel':
        return channel
          ? <ChannelOverview channel={channel} videos={videos} onVideoSelect={handleVideoSelect} competitors={competitors} />
          : <ChannelSearch onLoad={handleChannelLoad} />;

      case 'video':
        // Sub-view routing: grid vs individual
        if (videoSubView === 'video' && selectedVideo) {
          return (
            <VideoAnalysis
              video={selectedVideo}
              allVideos={videos}
              channelStats={channel?.statistics}
              onBack={handleBackToGrid}
              onVideoSelect={handleVideoSelect}
              onNavigate={handleNavigate}
              aiData={videoAiData}
              setAiData={setVideoAiData}
              {...aiProps}
            />
          );
        }
        // Grid view (or fallback to search if no channel)
        return (
          <VideoGrid
            channel={channel}
            videos={videos}
            onVideoSelect={handleVideoSelect}
            onSwitchChannel={() => setActiveView('search')}
          />
        );

      case 'timing':
        return <BestTimeToPost videos={videos} />;

      case 'cadence':
        return <UploadCadenceTracker videos={videos} />;

      case 'seo':
        return <SeoTagAnalyzer videos={videos} />;

      case 'competitor':
        return (
          <CompetitorComparison
            primaryChannel={channel}
            primaryVideos={videos}
            {...aiProps}
          />
        );

      case 'validator':
        return (
          <PrePublishValidator
            channel={channel}
            videos={videos}
            {...aiProps}
          />
        );

      case 'myanalytics':
        return (
          <MyChannelAnalytics
            tier={tier}
            isConnected={isConnected}
            profile={oauthProfile}
            onConnect={connect}
            onDisconnect={disconnect}
            canUseAI={canUseAI}
            consumeAICall={consumeAICall}
            remainingCalls={remainingCalls}
            onUpgrade={handleUpgrade}
          />
        );

      case 'viral':
        return (
          <ViralFormulaDecoder
            videos={videos}
            channel={channel}
            {...aiProps}
          />
        );

      case 'scorer':
        return <TitleThumbnailScorer {...aiProps} />;

      case 'sentiment':
        return (
          <CommentSentimentMiner
            video={selectedVideo}
            videos={videos}
            {...aiProps}
          />
        );

      case 'script':
        return <ScriptOutlineGenerator {...aiProps} />;

      case 'trends':
        return <NicheTrendScanner {...aiProps} />;

      case 'workspaces':
        return (
          <SavedWorkspaces
            tier={tier}
            channel={channel}
            videos={videos}
            competitors={competitors}
            onLoadWorkspace={handleLoadWorkspace}
          />
        );

      case 'report':
        return (
          <WeeklyPdfReport
            channel={channel}
            videos={videos}
            tier={tier}
            onUpgrade={handleUpgrade}
          />
        );

      case 'pricing':
        return <PricingPage currentTier={tier} onSelectTier={handleSelectTier} />;

      default:
        return channel
          ? <ChannelOverview channel={channel} videos={videos} onVideoSelect={handleVideoSelect} competitors={competitors} />
          : <ChannelSearch onLoad={handleChannelLoad} />;
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        hasChannel={!!channel}
        tier={tier}
        isOAuthConnected={isConnected}
      />
      <div className="app-content">
        <Header
          channel={channel}
          tier={tier}
          activeView={activeView}
          onNavigate={handleNavigate}
          oauthProfile={oauthProfile}
          onConnect={connect}
          onDisconnect={disconnect}
        />
        <main className="main-scroll">
          {deepLinkLoading ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', minHeight: '60vh', gap: 16,
            }}>
              <span className="btn-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
              <div style={{ fontSize: 15, color: '#666', fontWeight: 600 }}>
                Loading from TubeIntel Extension…
              </div>
            </div>
          ) : deepLinkError ? (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div className="search-error" style={{ display: 'inline-flex', maxWidth: 480 }}>
                {deepLinkError}
              </div>
            </div>
          ) : renderView()}
        </main>
      </div>
    </div>
  );
}
