import { useState } from 'react';
import { fetchVideoComments } from '../api/youtube';
import { analyzeViralFormula } from '../api/claude';
import { parseDuration, formatNum } from '../utils/analysis';
import ProGate from './ProGate';

export default function ViralFormulaDecoder({ videos, tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [selectedId, setSelectedId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState(null);

  const sortedVideos = [...videos].sort((a, b) =>
    parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
  );

  const handleDecode = async () => {
    const video = videos.find(v => v.id === selectedId);
    if (!video) return;
    if (!canUseAI()) {
      setError('No AI calls remaining this month. Upgrade for more.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const comments = await fetchVideoComments(video.id, 60);
      const commentsText = comments
        .slice(0, 30)
        .map(c => c.snippet?.topLevelComment?.snippet?.textDisplay || '')
        .filter(Boolean)
        .join('\n---\n');

      const stats = video.statistics || {};
      const views = parseInt(stats.viewCount || 0);
      const likes = parseInt(stats.likeCount || 0);
      const comments_ = parseInt(stats.commentCount || 0);
      const dur = parseDuration(video.contentDetails?.duration);

      const videoData = {
        title:       video.snippet?.title,
        views:       formatNum(views),
        likes:       formatNum(likes),
        duration:    dur.formatted,
        likeRate:    views > 0 ? ((likes / views) * 100).toFixed(2) : '0',
        commentRate: views > 0 ? ((comments_ / views) * 100).toFixed(3) : '0',
        publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString() : '',
      };

      const r = await analyzeViralFormula(videoData, commentsText || 'No comments available.');
      consumeAICall();
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyText = (text, field) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const selectedVideo = videos.find(v => v.id === selectedId);

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">🧬 Viral Formula Decoder</h2>
          <p className="feature-desc">
            AI decodes exactly why a video went viral and gives you a replicable template.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Select a Video to Decode</h3>
          <div className="scorer-input-group">
            <select
              className="search-filter"
              value={selectedId}
              onChange={e => { setSelectedId(e.target.value); setResult(null); setError(''); }}
              style={{ flex: 1, cursor: 'pointer' }}
            >
              <option value="">Choose a video…</option>
              {sortedVideos.map(v => (
                <option key={v.id} value={v.id}>
                  {v.snippet?.title?.slice(0, 70)} — {formatNum(v.statistics?.viewCount)} views
                </option>
              ))}
            </select>
            <button
              className="btn-primary"
              onClick={handleDecode}
              disabled={!selectedId || loading}
            >
              {loading ? <><span className="btn-spinner" /> Decoding…</> : '🧬 Decode Formula'}
            </button>
          </div>
          {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        {selectedVideo && !result && !loading && (
          <div className="video-preview-card">
            <img src={selectedVideo.snippet?.thumbnails?.medium?.url || selectedVideo.snippet?.thumbnails?.default?.url || ''} alt="" className="video-preview-thumb" />
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{selectedVideo.snippet?.title}</div>
              <div style={{ fontSize: 13, color: '#888' }}>
                {formatNum(selectedVideo.statistics?.viewCount)} views ·{' '}
                {parseDuration(selectedVideo.contentDetails?.duration).formatted} ·{' '}
                {selectedVideo.snippet?.publishedAt ? new Date(selectedVideo.snippet.publishedAt).toLocaleDateString() : ''}
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">🧬</div>
            <div className="ai-loading-text">Analyzing video data and comments…</div>
            <div className="ai-loading-sub">TubeIntel is decoding the viral formula</div>
          </div>
        )}

        {result && (
          <div className="viral-result">
            <div className="viral-grid">
              {[
                { icon: '🎣', label: 'Hook Style',           key: 'hookStyle' },
                { icon: '📝', label: 'Title Pattern',        key: 'titlePattern' },
                { icon: '🖼️', label: 'Thumbnail Strategy',  key: 'thumbnailStrategy' },
                { icon: '⏱️', label: 'Optimal Length',       key: 'optimalLength' },
                { icon: '💬', label: 'Pacing Signals',       key: 'pacingSignals' },
              ].map(item => result[item.key] ? (
                <div key={item.key} className="viral-card">
                  <div className="viral-card-icon">{item.icon}</div>
                  <div className="viral-card-label">{item.label}</div>
                  <div className="viral-card-text">{result[item.key]}</div>
                </div>
              ) : null)}
            </div>

            {result.replicableTemplate && (
              <div className="chart-card" style={{ marginTop: 16 }}>
                <h3 className="chart-title">🎯 Replicable Template</h3>
                <div className="ai-text-block">{result.replicableTemplate}</div>
              </div>
            )}

            {result.winFactors?.length > 0 && (
              <div className="chart-card" style={{ marginTop: 16 }}>
                <h3 className="chart-title">⚡ Win Factors</h3>
                <div className="win-factors">
                  {result.winFactors.map((f, i) => (
                    <div key={i} className="win-factor-item">
                      <span className="win-factor-num">{i + 1}</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.stealThisFormula && (
              <div className="chart-card" style={{ marginTop: 16, borderTop: '3px solid #ff9100' }}>
                <h3 className="chart-title">🔥 Steal This Formula</h3>
                <p className="chart-subtitle">Copy-paste ready assets you can use for your next video</p>

                {result.stealThisFormula.titleTemplate && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1 }}>
                        📝 Title Template
                      </div>
                      <button
                        className="btn-small btn-primary"
                        onClick={() => copyText(result.stealThisFormula.titleTemplate, 'title')}
                        style={{ fontSize: 11 }}
                      >
                        {copiedField === 'title' ? '✅ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      background: '#1a1a1a',
                      border: '1px solid #ff910033',
                      borderRadius: 8,
                      padding: '12px 16px',
                      fontSize: 15,
                      fontWeight: 600,
                      color: '#fff',
                      lineHeight: 1.5,
                    }}>
                      {result.stealThisFormula.titleTemplate}
                    </div>
                  </div>
                )}

                {result.stealThisFormula.hookScript && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1 }}>
                        🎬 Hook Script (First 30 Seconds)
                      </div>
                      <button
                        className="btn-small btn-primary"
                        onClick={() => copyText(result.stealThisFormula.hookScript, 'hook')}
                        style={{ fontSize: 11 }}
                      >
                        {copiedField === 'hook' ? '✅ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      background: '#1a1a1a',
                      border: '1px solid #ff910033',
                      borderRadius: 8,
                      padding: '14px 16px',
                      fontSize: 13,
                      color: '#ddd',
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                    }}>
                      {result.stealThisFormula.hookScript}
                    </div>
                  </div>
                )}

                {result.stealThisFormula.thumbnailDescription && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1 }}>
                        🖼️ Thumbnail Blueprint
                      </div>
                      <button
                        className="btn-small btn-primary"
                        onClick={() => copyText(result.stealThisFormula.thumbnailDescription, 'thumb')}
                        style={{ fontSize: 11 }}
                      >
                        {copiedField === 'thumb' ? '✅ Copied' : '📋 Copy'}
                      </button>
                    </div>
                    <div style={{
                      background: '#1a1a1a',
                      border: '1px solid #ff910033',
                      borderRadius: 8,
                      padding: '12px 16px',
                      fontSize: 13,
                      color: '#ddd',
                      lineHeight: 1.7,
                    }}>
                      {result.stealThisFormula.thumbnailDescription}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </ProGate>
  );
}
