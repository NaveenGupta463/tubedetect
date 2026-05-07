import { useState } from 'react';
import { lookup, explain as explainApi } from '../api/scoringApi';
import { NICHES, scoreColor } from '../utils/constants';

function formatViews(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}K`;
  return String(v);
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#444' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ccc', marginTop: 2 }}>{value ?? '—'}</div>
    </div>
  );
}

function Badge({ label, color = '#555' }) {
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      background: color + '22', color, border: `1px solid ${color}44`,
      borderRadius: 6, padding: '3px 8px',
    }}>
      {label}
    </span>
  );
}

function QualityBadge({ label, quality }) {
  const colors = { strong: '#22c55e', average: '#f59e0b', weak: '#ef4444' };
  const c = colors[quality] || '#666';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: c + '11', border: `1px solid ${c}33`,
      borderRadius: 8, padding: '6px 12px',
    }}>
      <span style={{ fontSize: '0.68rem', color: '#555', fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: c, textTransform: 'capitalize' }}>{quality ?? '—'}</span>
    </div>
  );
}

export default function CompetitorAnalyzer() {
  const [url,        setUrl]        = useState('');
  const [niche,      setNiche]      = useState('finance');
  const [result,     setResult]     = useState(null);
  const [explain,    setExplain]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error,      setError]      = useState('');

  async function handleAnalyze() {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setExplain(null);
    try {
      const data = await lookup(url.trim(), niche);
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleExplain() {
    if (!result) return;
    setExplaining(true);
    try {
      const data = await explainApi(result.title, result.title, result.niche, result.channel_size);
      setExplain(data);
    } catch (e) {
      setExplain({ error: e.message });
    } finally {
      setExplaining(false);
    }
  }

  const score = result?.final_score;
  const sc    = score != null ? scoreColor(score) : '#555';

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '0 0 60px' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#fff', margin: 0 }}>
          Analyze Viral Video
        </h1>
        <p style={{ color: '#555', fontSize: '0.85rem', marginTop: 6, margin: '6px 0 0' }}>
          Paste a competitor's YouTube URL to understand why it worked.
        </p>
      </div>

      {/* Input panel */}
      <div style={{
        background: '#0d0d0d', border: '1px solid #1e1e1e',
        borderRadius: 14, padding: '18px 20px', marginBottom: 20,
      }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleAnalyze()}
            placeholder="https://youtube.com/watch?v=..."
            style={{
              flex: 1, minWidth: 240,
              background: '#111', border: '1px solid #2a2a2a', borderRadius: 8,
              padding: '10px 14px', color: '#fff', fontSize: '0.875rem', outline: 'none',
            }}
          />
          <select
            value={niche}
            onChange={e => setNiche(e.target.value)}
            style={{
              background: '#111', border: '1px solid #2a2a2a', borderRadius: 8,
              padding: '10px 12px', color: '#ccc', fontSize: '0.875rem', cursor: 'pointer',
            }}
          >
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={handleAnalyze}
            disabled={loading || !url.trim()}
            style={{
              background: loading || !url.trim() ? '#1a1a1a' : '#3b82f6',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 22px', fontWeight: 700, fontSize: '0.875rem',
              cursor: loading || !url.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}
          >
            {loading
              ? <><span className="btn-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />Analyzing...</>
              : 'Analyze'
            }
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#1a0808', border: '1px solid #3a1010', borderRadius: 10,
          padding: '14px 18px', marginBottom: 20, color: '#f87171', fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Score card */}
          <div style={{
            background: '#0d0d0d', border: '1px solid #1e1e1e',
            borderRadius: 14, padding: '20px 22px', marginBottom: 14,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', marginBottom: 6 }}>
                  Video
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e5e7eb', lineHeight: 1.4 }}>
                  {result.title}
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
                  <Stat label="Views"        value={formatViews(result.views)} />
                  <Stat label="Channel Size" value={formatViews(result.channel_size)} />
                  <Stat label="Niche"        value={result.niche} />
                </div>
              </div>

              {/* Score ring */}
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <div style={{
                  width: 88, height: 88, borderRadius: '50%',
                  border: `4px solid ${sc}`,
                  background: sc + '11',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <div style={{ fontSize: '1.55rem', fontWeight: 900, color: sc, lineHeight: 1 }}>
                    {Math.round(score)}
                  </div>
                  <div style={{ fontSize: '0.58rem', color: '#555', fontWeight: 700, marginTop: 2 }}>SCORE</div>
                </div>
              </div>
            </div>

            {/* Meta badges */}
            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              <Badge label={result.data_source?.replace(/_/g, ' ')}     color="#3b82f6" />
              <Badge label={result.freshness}                            color={result.freshness === 'stale' ? '#f59e0b' : '#22c55e'} />
              <Badge label={result.scoring_source?.replace(/_/g, ' ')}  color="#7c3aed" />
              {result.ml_score != null && <Badge label={`ML ${Math.round(result.ml_score)}`} color="#06b6d4" />}
              {result.peer_count > 0    && <Badge label={`${result.peer_count} peers`}        color="#8b5cf6" />}
            </div>
          </div>

          {/* Performance comparison bar */}
          {result.peer_context_score != null && (
            <div style={{
              background: '#0d0d0d', border: '1px solid #1e1e1e',
              borderRadius: 14, padding: '16px 20px', marginBottom: 14,
            }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', marginBottom: 10 }}>
                Performance vs Niche
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, score)}%`, height: '100%', borderRadius: 6,
                    background: sc, transition: 'width 0.7s ease',
                  }} />
                </div>
                <span style={{ fontSize: '0.8rem', color: '#777', minWidth: 44 }}>{Math.round(score)}/100</span>
              </div>
              <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#555' }}>
                Niche average:{' '}
                <span style={{ color: '#ccc', fontWeight: 700 }}>{Math.round(result.peer_context_score)}/100</span>
                {' '}(from {result.peer_count} real videos)
              </div>
            </div>
          )}

          {/* Similar high performers */}
          {result.similar_videos?.length > 0 && (
            <div style={{
              background: '#0d0d0d', border: '1px solid #1e1e1e',
              borderRadius: 14, padding: '16px 20px', marginBottom: 14,
            }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', marginBottom: 10 }}>
                Similar High Performers
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.similar_videos.map((v, i) => (
                  <div key={v.video_id ?? i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 12px', background: '#111', borderRadius: 8,
                  }}>
                    <span style={{ fontSize: '0.8rem', color: '#ccc', flex: 1, marginRight: 12, lineHeight: 1.4 }}>
                      {v.title}
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      {v.views != null && (
                        <span style={{ fontSize: '0.72rem', color: '#555' }}>{formatViews(v.views)}</span>
                      )}
                      <span style={{ fontSize: '0.62rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {v.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Why did this work — trigger */}
          {!explain && (
            <button
              onClick={handleExplain}
              disabled={explaining}
              style={{
                width: '100%',
                background: explaining
                  ? '#111'
                  : 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                border: '1px solid #3730a3', borderRadius: 12,
                padding: '14px 22px', color: '#a5b4fc', fontWeight: 700,
                fontSize: '0.9rem', cursor: explaining ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              {explaining
                ? <><span className="btn-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />Generating insights...</>
                : 'Why did this work?'
              }
            </button>
          )}

          {/* Explain panel */}
          {explain && !explain.error && (
            <div style={{
              background: 'linear-gradient(135deg, #0f0f1e 0%, #1a1630 100%)',
              border: '1px solid #312e81', borderRadius: 14, padding: '20px 22px',
            }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6366f1', marginBottom: 12 }}>
                Why It Worked{explain.source === 'llm' ? ' · AI Analysis' : ' · Rule-Based'}
                {explain.cached && <span style={{ marginLeft: 8, color: '#4f46e5' }}>· cached</span>}
              </div>

              <p style={{ color: '#c4b5fd', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 14px' }}>
                {explain.reasoning}
              </p>

              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <QualityBadge label="Hook"  quality={explain.hook_quality} />
                <QualityBadge label="Title" quality={explain.title_quality} />
              </div>

              {explain.suggestions?.length > 0 && (
                <>
                  <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4f46e5', marginBottom: 8 }}>
                    Key Insights
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {explain.suggestions.map((s, i) => (
                      <li key={i} style={{ fontSize: '0.8rem', color: '#a5b4fc', lineHeight: 1.5 }}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {explain?.error && (
            <div style={{ padding: '12px 16px', background: '#1a0808', borderRadius: 10, color: '#f87171', fontSize: '0.8rem' }}>
              Could not load insights: {explain.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
