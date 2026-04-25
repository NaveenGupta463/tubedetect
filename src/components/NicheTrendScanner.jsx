import { useState } from 'react';
import { searchTrendingVideos } from '../api/youtube';
import { analyzeTrends } from '../api/claude';
import { formatNum, parseDuration } from '../utils/analysis';
import ProGate from './ProGate';

const MOMENTUM_COLORS = { rising: '#00c853', peaking: '#ff9100', declining: '#ff1744' };
const URGENCY_COLORS  = { high: '#ff1744', medium: '#ff9100', low: '#888' };

function TrendAngleCard({ a }) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const accentColor = MOMENTUM_COLORS[a.momentum] || '#444';

  // Extract a suggested title from howToMakeYourVersion if it contains quoted text
  const titleMatch = a.howToMakeYourVersion?.match(/"([^"]{10,})"/);
  const suggestedTitle = titleMatch ? titleMatch[1] : null;

  const copyTitle = () => {
    const text = suggestedTitle || a.howToMakeYourVersion || '';
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      background: '#1a1a1a',
      border: `1px solid ${accentColor}33`,
      borderLeft: `3px solid ${accentColor}`,
      borderRadius: 10,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{a.angle}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          color: accentColor, background: accentColor + '22',
          padding: '3px 8px', borderRadius: 4, flexShrink: 0,
        }}>
          {a.momentum}
        </span>
      </div>

      {/* Opportunity — always visible */}
      {a.opportunity && (
        <div style={{ padding: '0 16px 12px', fontSize: 13, color: '#bbb', lineHeight: 1.6 }}>
          {a.opportunity}
        </div>
      )}

      {/* Why It's Trending — expandable */}
      {a.whyTrending && (
        <div style={{ borderTop: '1px solid #252525' }}>
          <button
            onClick={() => setWhyOpen(o => !o)}
            style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1 }}>
              🔍 Why It's Trending
            </span>
            <span style={{ color: '#555', fontSize: 11 }}>{whyOpen ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {whyOpen && (
            <div style={{ padding: '4px 16px 14px', fontSize: 13, color: '#bbb', lineHeight: 1.7 }}>
              {a.whyTrending}
            </div>
          )}
        </div>
      )}

      {/* Make Your Version — expandable */}
      {a.howToMakeYourVersion && (
        <div style={{ borderTop: '1px solid #252525' }}>
          <button
            onClick={() => setMakeOpen(o => !o)}
            style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1 }}>
              🎬 Make Your Version
            </span>
            <span style={{ color: '#555', fontSize: 11 }}>{makeOpen ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {makeOpen && (
            <div style={{ padding: '4px 16px 14px' }}>
              <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.7, marginBottom: suggestedTitle ? 10 : 0 }}>
                {a.howToMakeYourVersion}
              </div>
              {/* Highlighted copyable suggested title */}
              {suggestedTitle && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#111', border: '1px solid #00c85333',
                  borderRadius: 8, padding: '10px 14px',
                }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#fff' }}>
                    "{suggestedTitle}"
                  </span>
                  <button
                    onClick={copyTitle}
                    style={{
                      background: copied ? '#00c85322' : '#1a1a1a',
                      border: `1px solid ${copied ? '#00c853' : '#333'}`,
                      borderRadius: 6, padding: '4px 10px',
                      fontSize: 11, fontWeight: 700,
                      color: copied ? '#00c853' : '#888',
                      cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                    }}
                  >
                    {copied ? '✅ Copied' : '📋 Copy Title'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NicheTrendScanner({ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade, onNavigate }) {
  const [query, setQuery]      = useState('');
  const [videos, setVideos]    = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [step, setStep]        = useState('');
  const [loading, setLoading]  = useState(false);
  const [error, setError]      = useState('');

  const handleScan = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setVideos([]);
    setAnalysis(null);
    setStep('Searching YouTube for trending videos…');
    try {
      const vids = await searchTrendingVideos(query, 20);
      setVideos(vids);
      if (!canUseAI()) {
        setStep('');
        setLoading(false);
        return;
      }
      setStep('Analyzing trends with AI…');
      const searchResults = vids.slice(0, 15).map(v => ({
        title:   v.snippet?.title || '',
        views:   formatNum(v.statistics?.viewCount),
        channel: v.snippet?.channelTitle || '',
      }));
      const r = await analyzeTrends(searchResults, query);
      consumeAICall();
      setAnalysis(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setStep('');
    }
  };

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">🔥 Niche Trend Scanner</h2>
          <p className="feature-desc">
            Search a keyword/niche, scan the top 20 videos from the last 30 days, and get AI trend analysis.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
          <div className="quota-note">⚠️ Uses YouTube Search API (100 quota units per search)</div>
        </div>

        <div className="chart-card">
          <div className="scorer-input-group">
            <input
              className="search-filter"
              placeholder="Enter niche or keyword, e.g. 'AI tools for creators', 'budget travel 2025'"
              value={query}
              onChange={e => { setQuery(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && !loading && handleScan()}
              style={{ flex: 1, fontSize: 14 }}
              disabled={loading}
            />
            <button className="btn-primary" onClick={handleScan} disabled={loading || !query.trim()}>
              {loading ? <><span className="btn-spinner" /> {step || 'Scanning…'}</> : '🔥 Scan Trends'}
            </button>
          </div>
          {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        {loading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">🔥</div>
            <div className="ai-loading-text">{step}</div>
            <div className="ai-loading-sub">Scanning last 30 days of YouTube</div>
          </div>
        )}

        {/* AI Analysis */}
        {analysis && (
          <>
            {analysis.summary && (
              <div className="chart-card">
                <h3 className="chart-title">📊 Trend Summary</h3>
                <div className="ai-text-block">{analysis.summary}</div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#666' }}>Saturation:</span>
                  <span className="theme-freq" style={{
                    background: analysis.saturationLevel === 'low' ? '#00c85322' : analysis.saturationLevel === 'high' ? '#ff174422' : '#ff910022',
                    color: analysis.saturationLevel === 'low' ? '#00c853' : analysis.saturationLevel === 'high' ? '#ff1744' : '#ff9100',
                  }}>
                    {(analysis.saturationLevel || '').toUpperCase()}
                  </span>
                </div>
              </div>
            )}

            {analysis.trendingAngles?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">📈 Trending Content Angles</h3>
                <p className="chart-subtitle">Expand each card to see why it's trending and how to make your version</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {analysis.trendingAngles.map((a, i) => (
                    <TrendAngleCard key={i} a={a} />
                  ))}
                </div>
              </div>
            )}

            {analysis.contentOpportunities?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">💡 Content Opportunities Right Now</h3>
                {analysis.contentOpportunities.map((opp, i) => (
                  <div key={i} className="opportunity-row">
                    <div className="opp-header">
                      <span className="opp-idea">{opp.idea}</span>
                      <span className="opp-urgency" style={{ color: URGENCY_COLORS[opp.urgency] || '#888' }}>
                        {opp.urgency} urgency
                      </span>
                    </div>
                    {opp.reason && <div className="opp-reason">{opp.reason}</div>}
                  </div>
                ))}
              </div>
            )}

            {analysis.titlePatterns?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">✍️ Winning Title Patterns</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {analysis.titlePatterns.map((p, i) => <span key={i} className="ts-peak-chip">{p}</span>)}
                </div>
              </div>
            )}

            {analysis.emergingFormats?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">🎬 Emerging Formats</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {analysis.emergingFormats.map((f, i) => (
                    <span key={i} className="missing-tag-chip" style={{ borderColor: '#ff910044', color: '#ff9100', background: '#ff910011' }}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Raw Results Table */}
        {videos.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-title">
              Top {videos.length} Videos — Last 30 Days
              {!canUseAI() && <span className="tip-badge" style={{ marginLeft: 8 }}>Upgrade for AI analysis</span>}
            </h3>
            <div className="table-wrap">
              <table className="video-table">
                <thead>
                  <tr>
                    <th className="th-title">Video</th>
                    <th className="th-num">Views</th>
                    <th className="th-num">Likes</th>
                    <th className="th-num">Duration</th>
                    <th className="th-num">Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map(v => (
                    <tr key={v.id} className="video-row" onClick={() => window.open(`https://youtube.com/watch?v=${v.id}`, '_blank')}>
                      <td className="td-video">
                        <img src={v.snippet?.thumbnails?.default?.url || ''} alt="" className="video-thumb" />
                        <span className="video-title">{v.snippet?.title}</span>
                      </td>
                      <td className="td-num">{formatNum(v.statistics?.viewCount)}</td>
                      <td className="td-num">{formatNum(v.statistics?.likeCount)}</td>
                      <td className="td-num">{parseDuration(v.contentDetails?.duration).formatted}</td>
                      <td className="td-num" style={{ color: '#888', maxWidth: 130 }}>{v.snippet?.channelTitle?.slice(0, 18)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {analysis && onNavigate && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <button
              onClick={() => onNavigate('validator', { niche: query })}
              style={{ background: 'linear-gradient(135deg,#7c4dff,#5b2be8)', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
            >
              🚀 Validate Before Publishing →
            </button>
          </div>
        )}
      </div>
    </ProGate>
  );
}
