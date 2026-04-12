import { useState, useEffect, useRef } from 'react';
import { scoreTitle, battleTitles, analyzeThumbnailImage } from '../api/claude';
import ProGate from './ProGate';

const ANGLE_COLOR = { Curiosity: '#7c4dff', Emotion: '#ff4081', Clarity: '#00bcd4' };
const LABEL_COLOR = {
  'High Click Potential': '#00c853',
  'Good but Needs Optimization': '#ff9100',
  'Weak Hook': '#ff6d00',
  'Likely Ignored': '#ff1744',
};
const CLICK_COLOR = { Yes: '#00c853', Maybe: '#ff9100', No: '#ff1744' };
const WEAKNESS_COLOR = '#ff1744';
const LOAD_MSGS = [
  'Analyzing hook strength…',
  'Simulating viewer click…',
  'Scoring curiosity gap…',
  'Checking scroll stop power…',
  'Reading click psychology…',
  'Scanning visual impact…',
];

function MetricCard({ label, score, reason, estimated }) {
  const color = score >= 75 ? '#00c853' : score >= 55 ? '#ff9100' : score >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <div style={{
      flex: 1, minWidth: 0, background: '#111', borderRadius: 10, padding: '14px 16px',
      border: `1px solid ${estimated ? '#ff910033' : color + '33'}`, display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.4 }}>{reason}</div>
      {estimated && (
        <div style={{ fontSize: 11, color: '#ff9100', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>⚠️</span> Estimated without thumbnail
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ value }) {
  const color = value >= 70 ? '#00c853' : value >= 50 ? '#ff9100' : '#ff1744';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 72 }}>
      <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1 }}>{value}%</div>
      <div style={{ width: 72, height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>confidence</div>
    </div>
  );
}

export default function TitleThumbnailScorer({ tier, canUseAI, consumeAICall, remainingCalls, onUpgrade }) {
  const [mode, setMode]             = useState('single');
  const [title, setTitle]           = useState('');
  const [thumb, setThumb]           = useState('');
  const [niche, setNiche]           = useState('');
  const [result, setResult]         = useState(null);
  const [noThumb, setNoThumb]       = useState(false);    // neither image nor description
  const [hasImage, setHasImage]     = useState(false);    // image was provided at score time
  const [loading, setLoading]       = useState(false);
  const [revealing, setRevealing]   = useState(false);
  const [error, setError]           = useState('');
  const [copied, setCopied]         = useState(null);
  const [loadMsgIdx, setLoadMsgIdx] = useState(0);

  // Image upload state
  const [imageSource, setImageSource]     = useState(null); // { type, data, mediaType, previewUrl }
  const [imageUrl, setImageUrl]           = useState('');
  const [thumbAnalysis, setThumbAnalysis] = useState(null);
  const [thumbAnalyzing, setThumbAnalyzing] = useState(false);
  const analyzedKeyRef = useRef(null); // cache key — avoids re-analyzing same image
  const fileInputRef   = useRef(null);

  // Battle mode
  const [titleA, setTitleA]                   = useState('');
  const [titleB, setTitleB]                   = useState('');
  const [battleResult, setBattleResult]       = useState(null);
  const [battleLoading, setBattleLoading]     = useState(false);
  const [battleRevealing, setBattleRevealing] = useState(false);
  const [savedIdeas, setSavedIdeas]           = useState(() => {
    try { return JSON.parse(localStorage.getItem('tubeintel_saved_ideas') || '[]'); } catch { return []; }
  });

  const isProcessing = loading || revealing || battleLoading || battleRevealing || thumbAnalyzing;
  useEffect(() => {
    if (!isProcessing) return;
    const iv = setInterval(() => setLoadMsgIdx(i => (i + 1) % LOAD_MSGS.length), 600);
    return () => clearInterval(iv);
  }, [isProcessing]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const base64  = dataUrl.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      setImageSource({ type: 'base64', data: base64, mediaType, previewUrl: dataUrl });
      setImageUrl('');
      setThumbAnalysis(null);
      analyzedKeyRef.current = null;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUrl = (url) => {
    setImageUrl(url);
    if (url.trim().length > 10) {
      setImageSource({ type: 'url', data: url.trim(), previewUrl: url.trim() });
      setThumbAnalysis(null);
      analyzedKeyRef.current = null;
    } else {
      setImageSource(null);
    }
  };

  const clearImage = () => {
    setImageSource(null);
    setImageUrl('');
    setThumbAnalysis(null);
    analyzedKeyRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runThumbAnalysis = async (src) => {
    const key = src.data.slice(0, 60);
    if (analyzedKeyRef.current === key && thumbAnalysis) return thumbAnalysis;
    setThumbAnalyzing(true);
    try {
      const r = await analyzeThumbnailImage(src);
      analyzedKeyRef.current = key;
      setThumbAnalysis(r);
      return r;
    } catch {
      return null;
    } finally {
      setThumbAnalyzing(false);
    }
  };

  const runScore = async (t) => {
    if (!canUseAI()) { setError('No AI calls remaining. Upgrade for more.'); return; }
    const imgPresent  = !!imageSource;
    const descPresent = thumb.trim().length >= 10;
    const bothMissing = !imgPresent && !descPresent;
    setNoThumb(bothMissing);
    setHasImage(imgPresent);
    setLoading(true);
    setRevealing(false);
    setError('');
    setResult(null);

    try {
      // Run title score + optional image analysis in parallel
      const [r, ta] = await Promise.all([
        scoreTitle(t, thumb, niche),
        imgPresent ? runThumbAnalysis(imageSource) : Promise.resolve(null),
      ]);
      consumeAICall();
      if (imgPresent && ta) setThumbAnalysis(ta);

      // Apply score adjustment: penalty when both missing, no penalty when image or desc present
      if (bothMissing && r.ideaScore != null) {
        r.ideaScore = Math.max(0, Math.round(r.ideaScore * 0.88));
      }
      setLoading(false);
      setRevealing(true);
      setTimeout(() => { setResult(r); setRevealing(false); }, 400);
    } catch (e) {
      setError(e.message);
      setLoading(false);
      setRevealing(false);
    }
  };

  const handleScore = () => {
    if (!title.trim()) { setError('Please enter a title.'); return; }
    runScore(title);
  };

  const useThis = (newTitle) => {
    setTitle(newTitle);
    runScore(newTitle);
  };

  const handleBattle = async () => {
    if (!titleA.trim() || !titleB.trim()) { setError('Enter both titles to compare.'); return; }
    if (!canUseAI()) { setError('No AI calls remaining. Upgrade for more.'); return; }
    setBattleLoading(true);
    setBattleRevealing(false);
    setError('');
    setBattleResult(null);
    try {
      const r = await battleTitles(titleA, titleB, thumb);
      consumeAICall();
      setBattleLoading(false);
      setBattleRevealing(true);
      setTimeout(() => { setBattleResult(r); setBattleRevealing(false); }, 400);
    } catch (e) {
      setError(e.message);
      setBattleLoading(false);
      setBattleRevealing(false);
    }
  };

  const saveWinner = (t) => {
    setSavedIdeas(prev => {
      if (prev.includes(t)) return prev;
      const updated = [t, ...prev].slice(0, 20);
      localStorage.setItem('tubeintel_saved_ideas', JSON.stringify(updated));
      return updated;
    });
  };

  const removeSaved = (t) => {
    setSavedIdeas(prev => {
      const updated = prev.filter(x => x !== t);
      localStorage.setItem('tubeintel_saved_ideas', JSON.stringify(updated));
      return updated;
    });
  };

  const copyTitle = (t) => {
    navigator.clipboard.writeText(t).catch(() => {});
    setCopied(t);
    setTimeout(() => setCopied(null), 2000);
  };

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setResult(null);
    setBattleResult(null);
  };

  const showSingleLoading = mode === 'single' && (loading || revealing || thumbAnalyzing);
  const showBattleLoading = mode === 'battle' && (battleLoading || battleRevealing);

  // Shared thumbnail input block (used in single mode)
  const ThumbnailInputs = (
    <>
      <div className="scorer-input-group">
        <label className="scorer-label">Thumbnail Description</label>
        <input className="search-filter" placeholder="e.g. Shocked face, laptop with dollar sign, red arrow overlay"
          value={thumb} onChange={e => setThumb(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="scorer-input-group" style={{ alignItems: 'flex-start', gap: 10 }}>
        <label className="scorer-label" style={{ paddingTop: 6 }}>Upload Thumbnail</label>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* File upload */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: '#7c4dff22', color: '#7c4dff', border: '1px solid #7c4dff44',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              📁 Upload Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <span style={{ fontSize: 11, color: '#555' }}>or paste URL</span>
            <input
              className="search-filter"
              placeholder="https://..."
              value={imageUrl}
              onChange={e => handleImageUrl(e.target.value)}
              style={{ flex: 1, fontSize: 12 }}
            />
          </div>
          {/* Preview */}
          {imageSource?.previewUrl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src={imageSource.previewUrl}
                alt="thumbnail preview"
                style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid #333' }}
                onError={() => setError('Image URL could not be loaded.')}
              />
              <button
                onClick={clearImage}
                style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 11,
                  background: 'transparent', color: '#555', border: '1px solid #333', cursor: 'pointer',
                }}
              >✕ Remove</button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">⚡ Idea Score</h2>
          <p className="feature-desc">
            Validate your video idea before you film it.
            <span className="tip-badge ai-badge">AI · {remainingCalls()} calls left</span>
          </p>
        </div>

        {/* Mode Toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['single', 'battle'].map(m => (
            <button key={m} onClick={() => switchMode(m)} style={{
              padding: '7px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${mode === m ? '#7c4dff' : '#333'}`,
              background: mode === m ? '#7c4dff22' : 'transparent',
              color: mode === m ? '#7c4dff' : '#666',
              transition: 'all 0.15s',
            }}>
              {m === 'single' ? '⚡ Single' : '⚔️ A/B Battle'}
            </button>
          ))}
        </div>

        {/* ── SINGLE MODE INPUT ── */}
        {mode === 'single' && (
          <div className="chart-card">
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
              {ThumbnailInputs}
              <div className="scorer-input-group">
                <label className="scorer-label">Niche (optional)</label>
                <input className="search-filter" placeholder="e.g. Tech reviews, Personal finance, Gaming"
                  value={niche} onChange={e => setNiche(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" onClick={handleScore} disabled={loading || revealing || thumbAnalyzing || !title.trim()}>
                  {showSingleLoading ? <><span className="btn-spinner" /> Scoring…</> : '⚡ Validate Idea'}
                </button>
              </div>
            </div>
            {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}

        {/* ── BATTLE MODE INPUT ── */}
        {mode === 'battle' && (
          <div className="chart-card">
            <div className="scorer-form">
              <div className="scorer-input-group">
                <label className="scorer-label">Title A *</label>
                <input className="search-filter" placeholder="Your first title idea"
                  value={titleA} onChange={e => { setTitleA(e.target.value); setError(''); }} style={{ flex: 1 }} />
              </div>
              <div className="scorer-input-group">
                <label className="scorer-label">Title B *</label>
                <input className="search-filter" placeholder="Your second title idea"
                  value={titleB} onChange={e => { setTitleB(e.target.value); setError(''); }} style={{ flex: 1 }} />
              </div>
              <div className="scorer-input-group">
                <label className="scorer-label">Thumbnail (shared)</label>
                <input className="search-filter" placeholder="e.g. Shocked face, red arrow overlay"
                  value={thumb} onChange={e => setThumb(e.target.value)} style={{ flex: 1 }} />
                <button className="btn-primary" onClick={handleBattle}
                  disabled={battleLoading || battleRevealing || !titleA.trim() || !titleB.trim()}>
                  {showBattleLoading ? <><span className="btn-spinner" /> Comparing…</> : '⚔️ Pick Winner'}
                </button>
              </div>
            </div>
            {error && <div className="search-error" style={{ marginTop: 10 }}>{error}</div>}

            {showBattleLoading && (
              <div className="ai-loading-card" style={{ marginTop: 12 }}>
                <div className="ai-loading-icon">⚔️</div>
                <div className="ai-loading-text">{LOAD_MSGS[loadMsgIdx]}</div>
              </div>
            )}

            {battleResult && (() => {
              const w = battleResult.winner;
              const winnerTitle = w === 'A' ? titleA : titleB;
              const loserLabel  = w === 'A' ? 'B' : 'A';
              const loserTitle  = w === 'A' ? titleB : titleA;
              const conf        = battleResult.confidence ?? 55;
              const alreadySaved = savedIdeas.includes(winnerTitle);
              return (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: '#00c85314', border: '1px solid #00c85344', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>🏆</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#00c853', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Winner — Title {w}</div>
                      <div style={{ fontSize: 14, color: '#eee' }}>{winnerTitle}</div>
                      {battleResult.reason && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{battleResult.reason}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <ConfidenceBar value={conf} />
                      <button onClick={() => saveWinner(winnerTitle)} disabled={alreadySaved} style={{
                        padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: alreadySaved ? '#33333388' : '#00c85322',
                        color: alreadySaved ? '#555' : '#00c853',
                        border: `1px solid ${alreadySaved ? '#333' : '#00c85344'}`,
                        cursor: alreadySaved ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      }}>
                        {alreadySaved ? '✅ Saved' : '💾 Save Winner'}
                      </button>
                    </div>
                  </div>
                  <div style={{ background: '#ff174411', border: '1px solid #ff174433', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>📉</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#ff174499', marginBottom: 3 }}>Title {loserLabel}</div>
                      <div style={{ fontSize: 13, color: '#555' }}>{loserTitle}</div>
                      {battleResult.loserReason && <div style={{ fontSize: 12, color: '#ff174499', marginTop: 4, fontStyle: 'italic' }}>{battleResult.loserReason}</div>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SINGLE MODE LOADING ── */}
        {showSingleLoading && (
          <div className="ai-loading-card">
            <div className="ai-loading-icon">⚡</div>
            <div className="ai-loading-text">{LOAD_MSGS[loadMsgIdx]}</div>
          </div>
        )}

        {/* ── THUMBNAIL STATUS BANNER ── */}
        {mode === 'single' && result && noThumb && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#ff910014', border: '1px solid #ff910044', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, color: '#ff9100',
          }}>
            <span style={{ flexShrink: 0 }}>⚠️</span>
            No thumbnail provided — generating ideas instead
          </div>
        )}
        {mode === 'single' && result && !hasImage && !noThumb && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#ff910014', border: '1px solid #ff910044', borderRadius: 10,
            padding: '10px 14px', fontSize: 13, color: '#ff9100',
          }}>
            <span style={{ flexShrink: 0 }}>⚠️</span>
            Thumbnail missing — scroll performance may be inaccurate
          </div>
        )}

        {/* ── SINGLE MODE RESULTS ── */}
        {mode === 'single' && result && (() => {
          const labelColor = LABEL_COLOR[result.ideaLabel] || '#ff9100';
          const scoreColor = (result.ideaScore ?? 50) >= 80 ? '#00c853'
            : (result.ideaScore ?? 50) >= 60 ? '#ff9100'
            : (result.ideaScore ?? 50) >= 40 ? '#ff6d00' : '#ff1744';

          return (
            <>
              {/* A — Main Idea Score */}
              <div className="chart-card" style={{ borderTop: `3px solid ${labelColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                  <div style={{ textAlign: 'center', minWidth: 90 }}>
                    <div style={{ fontSize: 56, fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
                      {result.ideaScore ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>IDEA SCORE</div>
                  </div>
                  <div>
                    <div style={{
                      display: 'inline-block', fontSize: 14, fontWeight: 700,
                      color: labelColor, background: labelColor + '18',
                      borderRadius: 20, padding: '5px 14px', border: `1px solid ${labelColor}44`,
                    }}>
                      {result.ideaLabel || '—'}
                    </div>
                    <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
                      "{title.slice(0, 80)}{title.length > 80 ? '…' : ''}"
                    </div>
                  </div>
                </div>
              </div>

              {/* B — 4 Metric Cards (hide when neither provided) */}
              {!noThumb && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {result.ctrPrediction    && <MetricCard label="CTR Prediction"    score={result.ctrPrediction.score    ?? 50} reason={result.ctrPrediction.reason}   estimated={!hasImage} />}
                  {result.scrollStopPower  && <MetricCard label="Scroll Stop Power" score={result.scrollStopPower.score  ?? 50} reason={result.scrollStopPower.reason} estimated={!hasImage} />}
                  {result.curiosityGap     && <MetricCard label="Curiosity Gap"     score={result.curiosityGap.score     ?? 50} reason={result.curiosityGap.reason} />}
                  {result.clarityScore     && <MetricCard label="Clarity Score"     score={result.clarityScore.score     ?? 50} reason={result.clarityScore.reason} />}
                </div>
              )}

              {/* C — Would You Click? */}
              {result.wouldYouClick && (
                <div className="chart-card" style={{ borderLeft: `4px solid ${CLICK_COLOR[result.wouldYouClick.answer] || '#ff9100'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>WOULD YOU CLICK?</div>
                    <div style={{
                      fontSize: 16, fontWeight: 800, color: CLICK_COLOR[result.wouldYouClick.answer] || '#ff9100',
                      background: (CLICK_COLOR[result.wouldYouClick.answer] || '#ff9100') + '18', borderRadius: 20,
                      padding: '4px 14px', border: `1px solid ${(CLICK_COLOR[result.wouldYouClick.answer] || '#ff9100')}44`,
                    }}>
                      {result.wouldYouClick.answer}
                    </div>
                    <div style={{ fontSize: 13, color: '#aaa', flex: 1 }}>{result.wouldYouClick.reason}</div>
                  </div>
                </div>
              )}

              {/* G — Why This Won't Click */}
              {result.weaknessPatterns?.length > 0 && (
                <div className="chart-card" style={{ borderLeft: `4px solid ${WEAKNESS_COLOR}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>WHY THIS WON'T CLICK</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {result.weaknessPatterns.slice(0, 3).map((tag, i) => (
                        <span key={i} style={{
                          fontSize: 12, fontWeight: 700, color: WEAKNESS_COLOR,
                          background: WEAKNESS_COLOR + '18', borderRadius: 20,
                          padding: '4px 12px', border: `1px solid ${WEAKNESS_COLOR}44`,
                        }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* D — Quick Fixes */}
              {result.quickFixes?.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">🔧 Quick Fixes</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.quickFixes.slice(0, 3).map((fix, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <span style={{
                          minWidth: 22, height: 22, borderRadius: '50%', background: '#ff910022', color: '#ff9100',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
                        }}>{i + 1}</span>
                        <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{fix}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* E — Improved Titles */}
              {result.improvedTitles?.length > 0 && (
                <div className="chart-card">
                  <h3 className="chart-title">🚀 Improved Titles</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {result.improvedTitles.map((item, i) => {
                      const t = typeof item === 'string' ? item : item.title;
                      const angle = typeof item === 'object' ? item.angle : null;
                      const reason = typeof item === 'object' ? item.reason : null;
                      const ac = ANGLE_COLOR[angle] || '#7c4dff';
                      return (
                        <div key={i} style={{ background: '#111', borderRadius: 10, padding: '12px 14px', border: '1px solid #222', display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                              {angle && <span style={{ fontSize: 10, fontWeight: 700, color: ac, background: ac + '18', borderRadius: 10, padding: '2px 8px', border: `1px solid ${ac}44`, textTransform: 'uppercase', letterSpacing: 0.5 }}>{angle}</span>}
                              {reason && <span style={{ fontSize: 11, color: '#555' }}>{reason}</span>}
                            </div>
                            <div style={{ fontSize: 14, color: '#eee', lineHeight: 1.4 }}>{t}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <button onClick={() => useThis(t)} disabled={loading || revealing} style={{
                              padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                              background: '#7c4dff22', color: '#7c4dff', border: '1px solid #7c4dff44',
                              cursor: (loading || revealing) ? 'not-allowed' : 'pointer',
                              opacity: (loading || revealing) ? 0.5 : 1, whiteSpace: 'nowrap',
                            }}>↩ Use This</button>
                            <button onClick={() => copyTitle(t)} style={{
                              padding: '5px 10px', borderRadius: 8, fontSize: 12,
                              background: 'transparent', color: copied === t ? '#00c853' : '#555',
                              border: `1px solid ${copied === t ? '#00c85344' : '#333'}`, cursor: 'pointer', whiteSpace: 'nowrap',
                            }}>{copied === t ? '✅' : '📋'}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* H — Thumbnail Analyzer (image provided) */}
              {hasImage && thumbAnalysis && (
                <div className="chart-card" style={{ borderTop: '3px solid #00bcd4' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <h3 className="chart-title" style={{ margin: 0 }}>🖼️ Thumbnail Analyzer</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {thumbAnalysis.lowQuality && (
                        <span style={{ fontSize: 11, color: '#ff9100', background: '#ff910018', borderRadius: 10, padding: '3px 10px', border: '1px solid #ff910044' }}>
                          ⚠️ Low quality image
                        </span>
                      )}
                      <div style={{ textAlign: 'center' }}>
                        <div style={{
                          fontSize: 28, fontWeight: 900, lineHeight: 1,
                          color: (thumbAnalysis.thumbnailScore ?? 50) >= 75 ? '#00c853' : (thumbAnalysis.thumbnailScore ?? 50) >= 55 ? '#ff9100' : '#ff1744',
                        }}>
                          {thumbAnalysis.thumbnailScore ?? '—'}
                        </div>
                        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>Thumbnail Score</div>
                      </div>
                    </div>
                  </div>

                  {/* 4 visual metrics */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    {[
                      { key: 'attentionGrab',      label: 'Attention Grab' },
                      { key: 'emotionVisibility',  label: 'Emotion Visibility' },
                      { key: 'clarityAtSmallSize', label: 'Clarity at Small Size' },
                      { key: 'visualContrast',     label: 'Visual Contrast' },
                    ].map(({ key, label }) => thumbAnalysis[key] && (
                      <MetricCard key={key} label={label} score={thumbAnalysis[key].score ?? 50} reason={thumbAnalysis[key].reason} />
                    ))}
                  </div>

                  {/* Would You Notice This? */}
                  {thumbAnalysis.wouldYouNotice && (() => {
                    const ans = thumbAnalysis.wouldYouNotice.answer;
                    const cc  = CLICK_COLOR[ans] || '#ff9100';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 13, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>WOULD YOU NOTICE THIS?</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: cc, background: cc + '18', borderRadius: 20, padding: '4px 12px', border: `1px solid ${cc}44` }}>{ans}</div>
                        <div style={{ fontSize: 12, color: '#aaa', flex: 1 }}>{thumbAnalysis.wouldYouNotice.reason}</div>
                      </div>
                    );
                  })()}

                  {/* Visual weakness tags */}
                  {thumbAnalysis.visualWeaknessTags?.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12, color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>VISUAL WEAKNESSES</div>
                      {thumbAnalysis.visualWeaknessTags.slice(0, 3).map((tag, i) => (
                        <span key={i} style={{
                          fontSize: 12, fontWeight: 700, color: WEAKNESS_COLOR,
                          background: WEAKNESS_COLOR + '18', borderRadius: 20,
                          padding: '3px 10px', border: `1px solid ${WEAKNESS_COLOR}44`,
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Quick visual fixes */}
                  {thumbAnalysis.quickVisualFixes?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 2 }}>QUICK VISUAL FIXES</div>
                      {thumbAnalysis.quickVisualFixes.slice(0, 3).map((fix, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{
                            minWidth: 20, height: 20, borderRadius: '50%', background: '#00bcd422', color: '#00bcd4',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
                          }}>{i + 1}</span>
                          <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{fix}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* F — Thumbnail section */}
              {noThumb ? (
                // Neither provided: show 3 generated thumbnail ideas
                result.thumbnailIdeas?.length > 0 && (
                  <div className="chart-card" style={{ borderLeft: '4px solid #ff9100' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 18 }}>🖼️</span>
                      <div style={{ fontSize: 13, color: '#ff9100', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Thumbnail Ideas
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {result.thumbnailIdeas.slice(0, 3).map((idea, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{
                            minWidth: 22, height: 22, borderRadius: '50%', background: '#ff910022', color: '#ff9100',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
                          }}>{i + 1}</span>
                          <span style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{idea}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : !hasImage && result.thumbnailUpgrade ? (
                // Description only: show upgrade tip
                <div className="chart-card" style={{ borderLeft: '4px solid #00bcd4' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>🖼️</span>
                    <div>
                      <div style={{ fontSize: 12, color: '#00bcd4', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Thumbnail Upgrade</div>
                      <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.5 }}>{result.thumbnailUpgrade}</div>
                    </div>
                  </div>
                </div>
              ) : null /* image provided: analyzer section above handles it */}
            </>
          );
        })()}

        {/* ── SAVED IDEAS ── */}
        {savedIdeas.length > 0 && (
          <div className="chart-card" style={{ borderTop: '3px solid #00c853' }}>
            <h3 className="chart-title">💾 Saved Ideas</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedIdeas.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#111', borderRadius: 8, padding: '10px 12px', border: '1px solid #222' }}>
                  <div style={{ flex: 1, fontSize: 13, color: '#ccc' }}>{t}</div>
                  <button onClick={() => copyTitle(t)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 12,
                    background: 'transparent', color: copied === t ? '#00c853' : '#555',
                    border: `1px solid ${copied === t ? '#00c85344' : '#333'}`, cursor: 'pointer',
                  }}>{copied === t ? '✅' : '📋'}</button>
                  <button onClick={() => removeSaved(t)} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 12,
                    background: 'transparent', color: '#444', border: '1px solid #333', cursor: 'pointer',
                  }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ProGate>
  );
}
