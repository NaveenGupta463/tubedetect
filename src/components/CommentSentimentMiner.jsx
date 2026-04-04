import { useState } from 'react';
import { fetchVideoComments } from '../api/youtube';
import { analyzeCommentSentiment } from '../api/claude';
import { formatNum } from '../utils/analysis';
import ProGate from './ProGate';

const SENTIMENT_COLORS = { positive: '#00c853', neutral: '#ff9100', negative: '#ff1744' };
const EMOTION_COLORS = {
  curiosity: '#7c4dff',
  excitement: '#ff9100',
  disappointment: '#ff1744',
  humor: '#00c853',
};

function EmotionBar({ label, value, color, emoji }) {
  return (
    <div className="sentiment-bar-row">
      <span style={{ color, width: 110, fontWeight: 600, fontSize: 13 }}>{emoji} {label}</span>
      <div className="perf-bar-bg" style={{ flex: 1, height: 12 }}>
        <div
          className="perf-bar-fill"
          style={{ width: `${value}%`, background: color, height: 12, borderRadius: 6, transition: 'width 0.6s ease' }}
        />
      </div>
      <span style={{ color, fontWeight: 700, width: 40, textAlign: 'right' }}>{value}%</span>
    </div>
  );
}

export default function CommentSentimentMiner({ video, videos, tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [selectedId, setSelectedId] = useState(video?.id || '');
  const [result, setResult]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const sortedVideos = [...videos].sort((a, b) =>
    parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
  );

  const handleMine = async () => {
    const vid = videos.find(v => v.id === selectedId);
    if (!vid) return;
    if (!canUseAI()) { setError('No AI calls remaining. Upgrade for more.'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const rawComments = await fetchVideoComments(vid.id, 100);
      const text = rawComments
        .slice(0, 50)
        .map(c => c.snippet?.topLevelComment?.snippet?.textDisplay || '')
        .filter(Boolean)
        .join('\n---\n');
      if (!text) throw new Error('No comments found for this video.');
      const r = await analyzeCommentSentiment(text, vid.snippet?.title || '');
      consumeAICall();
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const breakdown = result?.sentimentBreakdown || { positive: 0, neutral: 0, negative: 0 };
  const emotions = result?.emotionBreakdown || { curiosity: 0, excitement: 0, disappointment: 0, humor: 0 };

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">💬 Comment Sentiment Miner</h2>
          <p className="feature-desc">
            Deep AI analysis of audience emotions, questions, and content gaps.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Select Video to Analyze</h3>
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
                  {v.snippet?.title?.slice(0, 70)} — {formatNum(v.statistics?.commentCount)} comments
                </option>
              ))}
            </select>
            <button className="btn-primary" onClick={handleMine} disabled={!selectedId || loading}>
              {loading ? <><span className="btn-spinner" /> Mining…</> : '💬 Mine Comments'}
            </button>
          </div>
          {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        {loading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">💬</div>
            <div className="ai-loading-text">Fetching and analyzing comments…</div>
            <div className="ai-loading-sub">TubeIntel is mining sentiment patterns</div>
          </div>
        )}

        {result && (
          <>
            {/* Sentiment Overview */}
            <div className="chart-card">
              <h3 className="chart-title">Sentiment Overview</h3>
              <div className="sentiment-overview">
                <div className="sentiment-bars">
                  {[
                    ['Positive', breakdown.positive, '#00c853'],
                    ['Neutral',  breakdown.neutral,  '#ff9100'],
                    ['Negative', breakdown.negative, '#ff1744'],
                  ].map(([label, val, color]) => (
                    <div key={label} className="sentiment-bar-row">
                      <span style={{ color, width: 65, fontWeight: 600, fontSize: 13 }}>{label}</span>
                      <div className="perf-bar-bg" style={{ flex: 1, height: 12 }}>
                        <div className="perf-bar-fill" style={{ width: `${val}%`, background: color, height: 12, borderRadius: 6 }} />
                      </div>
                      <span style={{ color, fontWeight: 700, width: 40, textAlign: 'right' }}>{val}%</span>
                    </div>
                  ))}
                </div>
                <div className="sentiment-badge-wrap">
                  <div className="sentiment-badge" style={{ background: SENTIMENT_COLORS[result.overallSentiment] + '22', borderColor: SENTIMENT_COLORS[result.overallSentiment] + '55', color: SENTIMENT_COLORS[result.overallSentiment] }}>
                    {result.overallSentiment?.toUpperCase()}
                  </div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>Overall Sentiment</div>
                </div>
              </div>
              {result.audiencePersona && (
                <div className="ai-text-block" style={{ marginTop: 14 }}>
                  <strong>Audience Persona:</strong> {result.audiencePersona}
                </div>
              )}
            </div>

            {/* Emotion Breakdown */}
            <div className="chart-card">
              <h3 className="chart-title">🧠 Emotion Breakdown</h3>
              <p className="chart-subtitle">What your audience is actually feeling in the comments</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                <EmotionBar label="Curiosity"      value={emotions.curiosity}      color={EMOTION_COLORS.curiosity}      emoji="🤔" />
                <EmotionBar label="Excitement"     value={emotions.excitement}     color={EMOTION_COLORS.excitement}     emoji="🔥" />
                <EmotionBar label="Disappointment" value={emotions.disappointment} color={EMOTION_COLORS.disappointment} emoji="😞" />
                <EmotionBar label="Humor"          value={emotions.humor}          color={EMOTION_COLORS.humor}          emoji="😂" />
              </div>
            </div>

            {/* Themes */}
            {result.topThemes?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">🎭 Top Themes</h3>
                <div className="themes-grid">
                  {result.topThemes.map((t, i) => {
                    const tc = SENTIMENT_COLORS[t.sentiment] || '#888';
                    return (
                      <div key={i} className="theme-card" style={{ borderColor: tc + '44' }}>
                        <div className="theme-header">
                          <span className="theme-name">{t.theme}</span>
                          <span className="theme-sentiment" style={{ color: tc }}>{t.sentiment}</span>
                          <span className="theme-freq">{t.frequency}</span>
                        </div>
                        {t.example && <div className="theme-example">"{t.example}"</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="two-col-grid">
              {/* Top Questions */}
              {result.topQuestions?.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">❓ Questions Your Audience Asks</h3>
                  <p className="chart-subtitle">These are potential video ideas</p>
                  {result.topQuestions.map((q, i) => (
                    <div key={i} className="win-factor-item">
                      <span className="win-factor-num">Q{i+1}</span>
                      <span>{q}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Complaints */}
              {result.topComplaints?.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">🔴 Top Complaints</h3>
                  <p className="chart-subtitle">Pain points to address in future videos</p>
                  {result.topComplaints.map((c, i) => (
                    <div key={i} className="win-factor-item" style={{ borderLeftColor: '#ff1744' }}>
                      <span className="win-factor-num" style={{ background: '#ff174422', color: '#ff1744' }}>!</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Content Gap Video Titles */}
            {result.contentGapTitles?.length > 0 && (
              <div className="chart-card" style={{ borderTop: '3px solid #00c853' }}>
                <h3 className="chart-title">💡 5 Videos Your Competitor Should Have Made</h3>
                <p className="chart-subtitle">Publish-ready titles based on what this audience is actively requesting — steal these ideas</p>
                {result.contentGapTitles.map((title, i) => (
                  <div key={i} className="win-factor-item" style={{ borderLeftColor: '#00c853', alignItems: 'flex-start' }}>
                    <span className="win-factor-num" style={{ background: '#00c85322', color: '#00c853', flexShrink: 0 }}>{i+1}</span>
                    <span style={{ fontWeight: 600, color: '#fff', lineHeight: 1.4 }}>{title}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Content Gaps (context) */}
            {result.contentGaps?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">🔍 Content Gap Analysis</h3>
                <p className="chart-subtitle">Underlying gaps this audience has that aren't being addressed</p>
                {result.contentGaps.map((idea, i) => (
                  <div key={i} className="win-factor-item" style={{ borderLeftColor: '#7c4dff' }}>
                    <span className="win-factor-num" style={{ background: '#7c4dff22', color: '#7c4dff' }}>{i+1}</span>
                    <span>{idea}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Emotional Triggers */}
            {result.emotionalTriggers?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">⚡ Emotional Triggers</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {result.emotionalTriggers.map((t, i) => (
                    <span key={i} className="ts-peak-chip">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </ProGate>
  );
}
