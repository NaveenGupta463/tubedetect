import { useState } from 'react';
import { predictGrowth } from '../api/claude';
import { formatNum, parseDuration } from '../utils/analysis';

export default function GrowthPrediction({ video, allVideos, channelAvg, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const stats = video.statistics || {};
  const views = parseInt(stats.viewCount || 0);
  const likes = parseInt(stats.likeCount || 0);
  const comments = parseInt(stats.commentCount || 0);

  const handlePredict = async () => {
    if (!canUseAI || !canUseAI()) {
      setError('No AI calls remaining. Upgrade to Pro for growth predictions.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const dur = parseDuration(video.contentDetails?.duration);
      const videoData = {
        title: video.snippet?.title,
        views: formatNum(views),
        likes: formatNum(likes),
        likeRate: views > 0 ? ((likes / views) * 100).toFixed(2) : '0',
        commentRate: views > 0 ? ((comments / views) * 100).toFixed(3) : '0',
        duration: dur.formatted,
        publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt).toLocaleDateString() : '',
      };
      const r = await predictGrowth(videoData, formatNum(Math.round(channelAvg.views)));
      consumeAICall();
      setPrediction(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const longevityType  = prediction?.longevityType;
  const longevityColor = longevityType === 'Evergreen' ? '#00c853' : longevityType === 'Trending' ? '#ff9100' : '#ff1744';
  const longevityIcon  = longevityType === 'Evergreen' ? '🌲' : longevityType === 'Trending' ? '🔥' : '📉';
  const growthScore    = prediction?.growthScore ?? null;
  const growthScoreColor = growthScore >= 7 ? '#00c853' : growthScore >= 5 ? '#ff9100' : '#ff1744';
  const confidence     = prediction?.confidencePercent ?? null;

  return (
    <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
      <div className="chart-title-row">
        <h3 className="chart-title">📈 Growth Prediction</h3>
        {!prediction && !loading && (
          <button className="btn-primary btn-small" onClick={handlePredict} disabled={loading}>
            {loading ? <><span className="btn-spinner" /> Predicting…</> : '🔮 Predict Growth'}
          </button>
        )}
        {prediction && (
          <button className="btn-small" onClick={() => { setPrediction(null); setError(''); }}
            style={{ fontSize: 12, color: '#666', background: 'none', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            ↺ Re-run
          </button>
        )}
      </div>
      <p className="chart-subtitle">AI predicts 30-day views, content longevity, and follow-up opportunity</p>

      {!prediction && !loading && !error && (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#555', fontSize: 13 }}>
          {canUseAI && canUseAI()
            ? `${remainingCalls ? remainingCalls() : '?'} AI calls remaining — click to predict growth`
            : 'Upgrade to Pro to unlock growth predictions'}
        </div>
      )}

      {error && <div className="search-error" style={{ marginTop: 8 }}>{error}</div>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#888', fontSize: 13 }}>
          <span className="btn-spinner" style={{ marginRight: 8 }} />
          TubeIntel is analyzing trajectory…
        </div>
      )}

      {prediction && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#7c4dff', marginBottom: 2, lineHeight: 1.2 }}>
                {prediction.expectedViews30Days || '—'}
              </div>
              {confidence !== null && (
                <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                  <span style={{ color: confidence >= 70 ? '#00c853' : confidence >= 50 ? '#ff9100' : '#ff1744', fontWeight: 700 }}>
                    {confidence}%
                  </span> confidence
                </div>
              )}
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Expected Views (30d)</div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 2 }}>{longevityIcon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: longevityColor, marginBottom: 2 }}>{longevityType || '—'}</div>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Content Longevity</div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: growthScoreColor, marginBottom: 2 }}>{growthScore !== null ? growthScore : '—'}</div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>/ 10</div>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>Growth Score</div>
            </div>
          </div>
          {prediction.vsChannelAverage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 12, color: '#666' }}>vs Channel Average:</span>
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: prediction.vsChannelAverage === 'above' ? '#00c853' : prediction.vsChannelAverage === 'below' ? '#ff1744' : '#ff9100',
                background: (prediction.vsChannelAverage === 'above' ? '#00c853' : prediction.vsChannelAverage === 'below' ? '#ff1744' : '#ff9100') + '22',
                padding: '3px 10px', borderRadius: 4,
              }}>
                {prediction.vsChannelAveragePercent || prediction.vsChannelAverage}
              </span>
            </div>
          )}
          {prediction.longevityExplanation && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: longevityColor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {longevityIcon} Longevity Explained
              </div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{prediction.longevityExplanation}</div>
            </div>
          )}
          {prediction.followUpVideo && (
            <div style={{ background: '#111', border: '1px solid #00c85333', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                🎬 Follow-Up Video Suggestion
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 6, lineHeight: 1.4 }}>
                "{prediction.followUpVideo.title}"
              </div>
              {(prediction.followUpVideo.angle || prediction.followUpVideo.reason) && (
                <div style={{ fontSize: 13, color: '#888', lineHeight: 1.6 }}>
                  {prediction.followUpVideo.angle || prediction.followUpVideo.reason}
                </div>
              )}
            </div>
          )}
          {prediction.prediction && <div className="ai-text-block">{prediction.prediction}</div>}
        </div>
      )}
    </div>
  );
}
