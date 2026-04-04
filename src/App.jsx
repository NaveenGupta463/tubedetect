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

export default function App() {
  const { tier, setTier, canUseAI, consumeAICall, remainingCalls } = useTier();
  const { token, profile: oauthProfile, isConnected, connect, disconnect } = useOAuth();

  const [activeView,    setActiveView]    = useState('search');
  const [channel,       setChannel]       = useState(null);
  const [videos,        setVideos]        = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
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

  const handleUpgrade = useCallback(() => setActiveView('pricing'), []);

  const handleChannelLoad = useCallback((ch, vids) => {
    setChannel(ch);
    setVideos(vids);
    saveLastChannel(ch, vids);
    setVideoSubView('grid');
    setActiveView('channel');
  }, []);

  const handleVideoSelect = useCallback((video) => {
    setSavedScrollY(window.scrollY);
    setSelectedVideo(video);
    setVideoSubView('video');
    setActiveView('video');
    window.scrollTo(0, 0);
  }, []);

  const handleBackToGrid = useCallback(() => {
    setVideoSubView('grid');
    setActiveView(channel ? 'video' : 'search');
    setTimeout(() => window.scrollTo(0, savedScrollY), 50);
  }, [channel, savedScrollY]);

  const handleNavigate = useCallback((view) => {
    // When navigating to 'video', always start at grid
    if (view === 'video') {
      setVideoSubView('grid');
    }
    setActiveView(view);
  }, []);

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
        return <ChannelSearch onLoad={handleChannelLoad} />;
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
