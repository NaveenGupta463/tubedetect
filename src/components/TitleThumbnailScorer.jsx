import { useState } from 'react';
import { scoreTitle } from '../api/claude';
import ProGate from './ProGate';

function ScoreGauge({ label, score }) {
  const color = score >= 75 ? '#00c853' : score >= 55 ? '#ff9100' : score >= 40 ? '#ff6d00' : '#ff1744';
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto' }}>
        <svg width={80} height={80} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={40} cy={40} r={r} fill="none" stroke="#222" strokeWidth={8} />
          <circle
            cx={40} cy={40} r={r}
            fill="none" stroke={color} strokeWidth={8}
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.7s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', color,
        }}>
          <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: 9, opacity: 0.8 }}>/ 100</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#aaa', marginTop: 6 }}>{label}</div>
    </div>
  );
}

function ViralityBar({ label, score, color, icon }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon} {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color }}>{score}<span style={{ fontSize: 11, color: '#555', fontWeight: 400 }}>/10</span></span>
      </div>
      <div className="perf-bar-bg" style={{ height: 10 }}>
        <div
          className="perf-bar-fill"
          style={{ width: `${score * 10}%`, background: color, height: 10, borderRadius: 5, transition: 'width 0.7s ease' }}
        />
      </div>
    </div>
  );
}

export default function TitleThumbnailScorer({ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [title, setTitle]       = useState('');
  const [thumb, setThumb]       = useState('');
  const [niche, setNiche]       = useState('');
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(null);

  const handleScore = async () => {
    if (!title.trim()) { setError('Please enter a title to score.'); return; }
    if (!canUseAI()) { setError('No AI calls remaining this month. Upgrade for more.'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await scoreTitle(title, thumb, niche);
      consumeAICall();
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const copyTitle = (t) => {
    navigator.clipboard.writeText(t).catch(() => {});
    setCopied(t);
    setTimeout(() => setCopied(null), 2000);
  };

  const vb = result?.viralityScoreBreakdown;

  const getBarColor = (score) =>
    score >= 8 ? '#00c853' : score >= 6 ? '#ff9100' : score >= 4 ? '#ff6d00' : '#ff1744';

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">🎯 Title & Thumbnail Scorer</h2>
          <p className="feature-desc">
            Get an AI score out of 100 with specific improvement suggestions.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Enter Your Title</h3>
          <div className="scorer-form">
            <div className="scorer-input-group">
              <label className="scorer-label">Video Title *</label>
              <input
                className="search-filter"
                placeholder="e.g. I Tried Every AI Tool for 30 Days (Honest Review)"
                value={title}
                onChange={e => { setTitle(e.target.value); setError(''); }}
                style={{ flex: 1, fontSize: 14 }}
              />
              <span style={{ fontSize: 12, color: title.length > 100 ? '#ff1744' : '#666', whiteSpace: 'nowrap' }}>
                {title.length} chars
              </span>
            </div>
            <div className="scorer-input-group">
              <label className="scorer-label">Thumbnail Description</label>
              <input
                className="search-filter"
                placeholder="e.g. Split screen: shocked face on left, laptop with $ sign on right, red arrow overlay"
                value={thumb}
                onChange={e => setThumb(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <div className="scorer-input-group">
              <label className="scorer-label">Niche (optional)</label>
              <input
                className="search-filter"
                placeholder="e.g. Tech reviews, Personal finance, Gaming"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn-primary"
                onClick={handleScore}
                disabled={loading || !title.trim()}
              >
                {loading ? <><span className="btn-spinner" /> Scoring…</> : '🎯 Score It'}
              </button>
            </div>
          </div>
          {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
        </div>

        {loading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">🎯</div>
            <div className="ai-loading-text">Analyzing title and thumbnail…</div>
            <div className="ai-loading-sub">TubeIntel is evaluating CTR potential</div>
          </div>
        )}

        {result && (
          <>
            {/* Score Gauges */}
            <div className="chart-card">
              <h3 className="chart-title">Score Breakdown</h3>
              <div className="score-gauges-row">
                <ScoreGauge label="Title Score"     score={result.titleScore     ?? 50} />
                <ScoreGauge label="Thumbnail Score" score={result.thumbnailScore ?? 50} />
                <ScoreGauge label="Overall Score"   score={result.overallScore   ?? 50} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: result.ctrPrediction === 'high' ? '#00c853' : result.ctrPrediction === 'medium' ? '#ff9100' : '#ff1744',
                    marginBottom: 4,
                  }}>
                    {result.ctrPrediction === 'high' ? '🚀' : result.ctrPrediction === 'medium' ? '📊' : '⚠️'}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, textTransform: 'capitalize', color: '#aaa' }}>
                    CTR: {result.ctrPrediction || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Predicted</div>
                </div>
              </div>
              {result.reasoning && (
                <div className="ai-text-block" style={{ marginTop: 16 }}>{result.reasoning}</div>
              )}
            </div>

            {/* Virality Score Breakdown */}
            {vb && (() => {
              const avg = (((vb.titleStrength ?? 5) + (vb.thumbnailAppeal ?? 5) + (vb.hookPower ?? 5) + (vb.topicTiming ?? 5) + (vb.audienceMatch ?? 5)) / 5);
              const avgColor = getBarColor(avg);
              return (
                <div className="chart-card" style={{ borderTop: '3px solid #7c4dff' }}>
                  <h3 className="chart-title">🚀 Virality Score Breakdown</h3>
                  <p className="chart-subtitle">Five dimensions that determine whether this video will explode or flop</p>

                  {/* Overall score — large, at top */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, margin: '16px 0 20px', padding: '16px 20px', background: '#111', borderRadius: 12, border: `1px solid ${avgColor}33` }}>
                    <div style={{ textAlign: 'center', minWidth: 72 }}>
                      <div style={{ fontSize: 44, fontWeight: 900, color: avgColor, lineHeight: 1 }}>{avg.toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>/ 10</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: avgColor, marginBottom: 4 }}>
                        {avg >= 8 ? 'High Virality Potential' : avg >= 6 ? 'Moderate Virality Potential' : avg >= 4 ? 'Low Virality Potential' : 'Needs Significant Work'}
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>Average across all 5 virality dimensions</div>
                    </div>
                  </div>

                  <ViralityBar label="Title Strength"    score={vb.titleStrength    ?? 5} color={getBarColor(vb.titleStrength    ?? 5)} icon="📝" />
                  <ViralityBar label="Thumbnail Appeal"  score={vb.thumbnailAppeal  ?? 5} color={getBarColor(vb.thumbnailAppeal  ?? 5)} icon="🖼️" />
                  <ViralityBar label="Hook Power"        score={vb.hookPower        ?? 5} color={getBarColor(vb.hookPower        ?? 5)} icon="🎣" />
                  <ViralityBar label="Topic Timing"      score={vb.topicTiming      ?? 5} color={getBarColor(vb.topicTiming      ?? 5)} icon="⏰" />
                  <ViralityBar label="Audience Match"    score={vb.audienceMatch    ?? 5} color={getBarColor(vb.audienceMatch    ?? 5)} icon="🎯" />
                </div>
              );
            })()}

            {/* Strengths & Weaknesses */}
            <div className="two-col-grid">
              {result.titleStrengths?.length > 0 && (
                <div className="chart-card" style={{ borderTop: '3px solid #00c853' }}>
                  <h3 className="chart-title">✅ Title Strengths</h3>
                  {result.titleStrengths.map((s, i) => (
                    <div key={i} className="insight-item" style={{ cursor: 'default' }}>
                      <div className="insight-header" style={{ paddingBottom: 10 }}>
                        <span className="insight-icon">✓</span>
                        <span style={{ fontSize: 13, color: '#00c853' }}>{s}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {result.titleWeaknesses?.length > 0 && (
                <div className="chart-card" style={{ borderTop: '3px solid #ff9100' }}>
                  <h3 className="chart-title">⚠️ Title Weaknesses</h3>
                  {result.titleWeaknesses.map((w, i) => (
                    <div key={i} className="insight-item" style={{ cursor: 'default' }}>
                      <div className="insight-header" style={{ paddingBottom: 10 }}>
                        <span className="insight-icon">→</span>
                        <span style={{ fontSize: 13, color: '#ff9100' }}>{w}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Improved Titles */}
            {result.improvedTitles?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">🚀 Improved Title Variants</h3>
                <p className="chart-subtitle">Click to copy any variant</p>
                {result.improvedTitles.map((t, i) => (
                  <div key={i} className="improved-title-row" onClick={() => copyTitle(t)}>
                    <span className="improved-title-num">{i + 1}</span>
                    <span className="improved-title-text">{t}</span>
                    <span className="improved-title-copy">
                      {copied === t ? '✅ Copied' : '📋 Copy'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Thumbnail Suggestions */}
            {result.thumbnailSuggestions?.length > 0 && (
              <div className="chart-card">
                <h3 className="chart-title">🖼️ Thumbnail Suggestions</h3>
                {result.thumbnailSuggestions.map((s, i) => (
                  <div key={i} className="win-factor-item">
                    <span className="win-factor-num">{i + 1}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ProGate>
  );
}
