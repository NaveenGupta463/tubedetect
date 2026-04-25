import { useState, useEffect } from 'react';
import { fetchVideoById } from '../api/youtube';
import { runVideoOptimization } from '../engines/videoOptimizationEngine';

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId(url) {
  const str = url.trim();
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = str.match(p);
    if (m) return m[1];
  }
  return null;
}

function parseDuration(iso = '') {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h   = parseInt(m[1] || 0);
  const min = parseInt(m[2] || 0);
  const s   = parseInt(m[3] || 0);
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

function buildVideoData(ytVideo) {
  const { snippet = {}, statistics = {}, contentDetails = {} } = ytVideo;
  const views    = parseInt(statistics.viewCount    || 0);
  const likes    = parseInt(statistics.likeCount    || 0);
  const comments = parseInt(statistics.commentCount || 0);
  const likeRate       = views ? ((likes    / views) * 100).toFixed(1) : '0';
  const commentRate    = views ? ((comments / views) * 100).toFixed(1) : '0';
  const engagementRate = views ? (((likes + comments) / views) * 100).toFixed(1) : '0';
  return {
    title:           snippet.title || '',
    description:     snippet.description || '',
    views:           String(statistics.viewCount    || 0),
    likes:           String(statistics.likeCount    || 0),
    comments:        String(statistics.commentCount || 0),
    commentCount:    String(statistics.commentCount || 0),
    engagementRate,
    likeRate,
    commentRate,
    duration:        parseDuration(contentDetails.duration),
    publishedAt:     (snippet.publishedAt || '').slice(0, 10),
    vsChannelAvg:    '+0',
    tags:            (snippet.tags || []).join(', '),
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOAD_STEPS = [
  'Detecting weaknesses',
  'Generating improvements',
  'Testing variations',
  'Selecting best version',
];

const WEAKNESS_LABELS = { hook: 'Hook', title: 'Title', thumbnail: 'Thumbnail', retention: 'Retention' };

// ── Mini helpers ──────────────────────────────────────────────────────────────

function weakColor(v)  { return v === true ? '#ff1744' : v === false ? '#00c853' : '#444'; }
function weakLabel(v)  { return v === true ? 'Weak'    : v === false ? 'Strong'  : 'Unknown'; }
function fixedColor(v) { return v === false ? '#00c853' : v === true ? '#ff9100' : '#333'; }
function fixedLabel(v) { return v === false ? 'Fixed'   : v === true ? 'Still weak' : '—'; }
function angleColor(a) {
  return a === 'curiosity' ? '#3b82f6' : a === 'emotion' ? '#ec4899' : a === 'clarity' ? '#22c55e' : '#666';
}
const fmt = n => (typeof n === 'number' ? Math.round(n) : n);

// ── FeatureCard (idle state) ──────────────────────────────────────────────────

function FeatureCard({ title, desc }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   hovered ? '#151515' : '#0f0f0f',
        border:       `1px solid ${hovered ? '#2c2c2c' : '#1e1e1e'}`,
        borderRadius: 10,
        padding:      '14px 16px',
        transition:   'background 0.16s, border-color 0.16s',
        cursor:       'default',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: hovered ? '#d0d0d0' : '#888', marginBottom: 5, transition: 'color 0.16s' }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: hovered ? '#555' : '#383838', lineHeight: 1.5, transition: 'color 0.16s' }}>
        {desc}
      </div>
    </div>
  );
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text, copyKey, copiedKey, onCopy, style = {} }) {
  const copied = copiedKey === copyKey;
  return (
    <button
      onClick={() => onCopy(text, copyKey)}
      style={{
        background:   copied ? '#0e2a0e' : '#1a1a1a',
        border:       `1px solid ${copied ? '#1a4a1a' : '#2a2a2a'}`,
        color:        copied ? '#00c853' : '#888',
        borderRadius: 7, padding: '6px 14px', fontSize: 12,
        fontWeight:   600, cursor: 'pointer',
        transition:   'all 0.16s',
        ...style,
      }}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Analyze({ canUseAI, consumeAICall, remainingCalls, onUpgrade, defaultUrl = '', onClearDefaultUrl }) {
  const [url,          setUrl]          = useState(defaultUrl);
  const [phase,        setPhase]        = useState('idle');
  const [step,         setStep]         = useState(0);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');
  const [videoTitle,   setVideoTitle]   = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [copiedKey,    setCopiedKey]    = useState(null);
  const [weakOpen,     setWeakOpen]     = useState(false);

  // Auto-trigger when navigated to with a pre-filled URL from Dashboard
  useEffect(() => {
    if (defaultUrl) {
      onClearDefaultUrl?.();
      handleAnalyze(defaultUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyText(text, key) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => {});
  }

  async function handleAnalyze(overrideUrl) {
    const trimmed = (overrideUrl || url).trim();
    const videoId = extractVideoId(trimmed);
    if (!videoId) {
      setError('Enter a valid YouTube URL or 11-character video ID.');
      return;
    }
    if (!canUseAI) {
      onUpgrade?.();
      return;
    }

    setPhase('loading');
    setStep(0);
    setError('');
    setResult(null);
    setVideoTitle('');
    setThumbnailUrl('');

    const timers = [
      setTimeout(() => setStep(1), 2000),
      setTimeout(() => setStep(2), 8000),
      setTimeout(() => setStep(3), 16000),
    ];

    try {
      const ytVideo = await fetchVideoById(videoId);
      setVideoTitle(ytVideo.snippet?.title || '');
      setThumbnailUrl(ytVideo.snippet?.thumbnails?.high?.url || '');
      const videoData = buildVideoData(ytVideo);

      const res = await runVideoOptimization({
        mode:       'post-publish',
        input:      { videoData, commentsText: '' },
        iterations: 3,
      });

      timers.forEach(clearTimeout);

      if (!res.success) {
        setError('AI could not generate improvements for this video. Please try again.');
        setPhase('error');
        return;
      }

      consumeAICall?.();
      setResult(res);
      setStep(3);
      setTimeout(() => setPhase('done'), 300);
    } catch (e) {
      timers.forEach(clearTimeout);
      setError(e.message || 'Analysis failed. Please try again.');
      setPhase('error');
    }
  }

  // ── Idle / Error ──────────────────────────────────────────────────────────

  if (phase === 'idle' || phase === 'error') {
    return (
      <div style={{ display: 'flex', gap: 52, alignItems: 'flex-start', maxWidth: 940 }}>

        {/* Left column: input */}
        <div style={{ flex: '0 0 420px', maxWidth: 420 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#f0f0f0', letterSpacing: '-0.6px', lineHeight: 1.3, marginBottom: 10 }}>
            Fix Why Your Video<br />Isn't Performing
          </div>
          <div style={{ color: '#555', fontSize: 13, marginBottom: 22, lineHeight: 1.6 }}>
            Paste your video or analyze a competitor's video
          </div>

          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{
              position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
              pointerEvents: 'none', display: 'flex', alignItems: 'center',
            }}>
              <svg width="18" height="13" viewBox="0 0 18 13" fill="none">
                <rect width="18" height="13" rx="2.5" fill="#ff0000" />
                <path d="M7.5 4l4.5 2.5-4.5 2.5V4z" fill="white" />
              </svg>
            </div>
            <input
              value={url}
              onChange={e => { setUrl(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
              placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
              style={{
                width: '100%', background: '#111', border: '1px solid #282828', borderRadius: 10,
                padding: '12px 16px 12px 40px', color: '#f0f0f0', fontSize: 13, outline: 'none',
                transition: 'border-color 0.16s',
              }}
              onFocus={e => { e.target.style.borderColor = '#ff0000'; }}
              onBlur={e  => { e.target.style.borderColor = '#282828'; }}
            />
          </div>

          <button
            onClick={handleAnalyze}
            style={{
              width: '100%', background: '#ff0000', color: '#fff', border: 'none',
              borderRadius: 10, padding: '13px 24px', fontWeight: 700,
              fontSize: 14, cursor: 'pointer', marginBottom: 12,
              transition: 'background 0.16s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#cc0000'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ff0000'; }}
          >
            Run Deep Analysis
          </button>

          {error && (
            <div style={{ marginBottom: 10, color: '#ff1744', fontSize: 13, padding: '10px 14px', background: '#1a0808', borderRadius: 8, border: '1px solid #3a1010' }}>
              {error}
            </div>
          )}

          {!canUseAI && (
            <div style={{ padding: '12px 16px', background: '#140e00', border: '1px solid #3a2800', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#ff9100', fontSize: 13 }}>AI call limit reached — {remainingCalls ?? 0} remaining</span>
              <button
                onClick={onUpgrade}
                style={{ background: '#ff9100', color: '#000', border: 'none', borderRadius: 6, padding: '5px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
              >
                Upgrade
              </button>
            </div>
          )}
        </div>

        {/* Right column: feature cards */}
        <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#333', marginBottom: 14 }}>
            What you get
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Optimized Titles',  'Three angle-specific rewrites with projected score improvements'],
              ['Hook Script',       'First 30 seconds rewritten for maximum retention'],
              ['Score Delta',       'Before/after comparison with confidence rating'],
              ['Viral Playbook',    'Replicable pattern extracted from this video\'s format'],
            ].map(([title, desc]) => (
              <FeatureCard key={title} title={title} desc={desc} />
            ))}
          </div>
        </div>

      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div style={{ maxWidth: 460, margin: '50px auto 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 13, color: '#444', marginBottom: 8 }}>Analyzing</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {videoTitle || url}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LOAD_STEPS.map((s, i) => {
            const done   = i < step;
            const active = i === step;
            return (
              <div key={s} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10,
                background: active ? '#0e0e0e' : 'transparent',
                border: `1px solid ${active ? '#222' : 'transparent'}`,
                transition: 'all 0.2s',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? '#00c85320' : active ? '#ff000020' : '#111',
                  border: `2px solid ${done ? '#00c853' : active ? '#ff0000' : '#222'}`,
                  fontSize: 11, fontWeight: 700,
                }}>
                  {done   ? <span style={{ color: '#00c853', fontSize: 12 }}>✓</span>
                  : active ? <span className="btn-spinner" style={{ width: 10, height: 10, borderWidth: 2 }} />
                  : null}
                </div>
                <span style={{
                  fontSize: 13,
                  color: done ? '#00c853' : active ? '#f0f0f0' : '#2a2a2a',
                  fontWeight: active ? 600 : 400,
                  transition: 'color 0.2s',
                }}>
                  {s}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  if (phase !== 'done' || !result) return null;

  const { improvements, variations, delta, weaknesses, originalScore, improvedScore } = result;
  const origW = weaknesses?.original || {};
  const imprW = weaknesses?.improved  || {};

  // Derived values
  const activeWeaknesses = Object.entries(origW)
    .filter(([, v]) => v === true)
    .map(([k]) => WEAKNESS_LABELS[k]);

  const bestTitle    = improvements?.titles?.[0]?.text   || '';
  const bestHook     = improvements?.hook?.text          || '';
  const whyItWorks   = improvements?.titles?.[0]?.reason || improvements?.hook?.reason || null;
  const viralPlaybook = improvements?.viral_playbook;

  const sectionLabel = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: '#333', marginBottom: 14,
  };

  return (
    <div style={{ maxWidth: 860, paddingBottom: 88 }}>

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#333', marginBottom: 4 }}>Results for</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#ccc', maxWidth: 580, lineHeight: 1.4 }}>
            {videoTitle}
          </div>
        </div>
        <button
          onClick={() => { setPhase('idle'); setResult(null); setUrl(''); setVideoTitle(''); setThumbnailUrl(''); }}
          style={{ background: '#141414', border: '1px solid #252525', color: '#666', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
        >
          Analyze another
        </button>
      </div>

      {/* ── Hero: primary diagnosis ─────────────────────────────────────── */}
      <div style={{ background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 14, padding: '20px 22px', marginBottom: 20, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            style={{ width: 160, height: 90, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: '#111' }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            Your video is underperforming because:
          </div>
          {activeWeaknesses.length > 0 ? (
            <ul style={{ margin: '0 0 12px', padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {activeWeaknesses.map(w => (
                <li key={w} style={{ fontSize: 14, color: '#ff6b6b', fontWeight: 600 }}>
                  {w} is underperforming
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: 14, color: '#00c853', marginBottom: 12 }}>No major weaknesses detected</div>
          )}
          {delta && (
            <div style={{ fontSize: 13, color: '#555' }}>
              Estimated improvement:&nbsp;
              <span style={{ color: '#00c853', fontWeight: 700 }}>+{fmt(delta.value)} points</span>
              <span style={{ color: '#333', marginLeft: 8 }}>({delta.confidence} confidence)</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Score + Delta ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={sectionLabel}>Performance Score</div>
        <div style={{ background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 14, padding: '22px 24px', display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>

          {/* Original */}
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 11, color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Current</div>
            <div style={{ fontSize: 38, fontWeight: 900, color: '#f0f0f0', lineHeight: 1, marginBottom: 10 }}>
              {fmt(originalScore)}<span style={{ fontSize: 16, color: '#333', fontWeight: 400 }}>/100</span>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: 999, height: 5, overflow: 'hidden' }}>
              <div style={{ background: '#ff9100', width: `${Math.min(originalScore, 100)}%`, height: '100%', borderRadius: 999 }} />
            </div>
          </div>

          {/* Arrow */}
          <div style={{ color: '#2a2a2a', fontSize: 22, flexShrink: 0 }}>→</div>

          {/* Projected */}
          {improvedScore != null && (
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 11, color: '#2d6a2d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Projected</div>
              <div style={{ fontSize: 38, fontWeight: 900, color: '#00c853', lineHeight: 1, marginBottom: 10 }}>
                {fmt(improvedScore)}<span style={{ fontSize: 16, color: '#1a4a1a', fontWeight: 400 }}>/100</span>
              </div>
              <div style={{ background: '#1a1a1a', borderRadius: 999, height: 5, overflow: 'hidden' }}>
                <div style={{ background: '#00c853', width: `${Math.min(improvedScore, 100)}%`, height: '100%', borderRadius: 999 }} />
              </div>
            </div>
          )}

          {/* Delta pill */}
          {delta && (
            <div style={{ flexShrink: 0, textAlign: 'center', background: '#080e08', border: '1px solid #1a2e1a', borderRadius: 12, padding: '14px 20px' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#00c853', lineHeight: 1 }}>
                +{fmt(delta.value)}
              </div>
              <div style={{ fontSize: 11, color: '#2d6a2d', marginTop: 6, fontWeight: 600 }}>
                {delta.confidence} confidence
              </div>
              <div style={{ fontSize: 10, color: '#1a4a1a', marginTop: 2 }}>{delta.type}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Best Version ────────────────────────────────────────────────── */}
      {improvements && (bestTitle || bestHook) && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>AI Recommendation</div>
          <div style={{
            background: 'linear-gradient(135deg, #0a0e18 0%, #0c1220 100%)',
            border: '1px solid #1a2a3a',
            borderRadius: 14, padding: '22px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <span style={{ fontSize: 16 }}>🏆</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Best Version
              </span>
              {improvements.titles?.[0]?.projectedOverall != null && (
                <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#00c853' }}>
                  {fmt(improvements.titles[0].projectedOverall)} projected
                </span>
              )}
            </div>

            {bestTitle && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#2a3a5a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Optimized Title
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f0f0', lineHeight: 1.5 }}>
                  {bestTitle}
                </div>
                {improvements.titles?.[0]?.angle && (
                  <span style={{
                    display: 'inline-block', marginTop: 6, fontSize: 10, fontWeight: 700,
                    background: angleColor(improvements.titles[0].angle) + '22',
                    color: angleColor(improvements.titles[0].angle),
                    borderRadius: 4, padding: '2px 8px', textTransform: 'capitalize',
                  }}>
                    {improvements.titles[0].angle}
                  </span>
                )}
              </div>
            )}

            {bestHook && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#2a3a5a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Hook Script
                </div>
                <div style={{ fontSize: 14, color: '#a0b0c0', fontStyle: 'italic', lineHeight: 1.7 }}>
                  "{bestHook}"
                </div>
              </div>
            )}

            {whyItWorks && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#2a3a5a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Why It Works
                </div>
                <div style={{ fontSize: 13, color: '#556', lineHeight: 1.6 }}>{whyItWorks}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => copyText(bestTitle, 'best-title')}
                style={{
                  background: copiedKey === 'best-title' ? '#0a1a0a' : '#111',
                  border: `1px solid ${copiedKey === 'best-title' ? '#1a4a1a' : '#252525'}`,
                  color: copiedKey === 'best-title' ? '#00c853' : '#aaa',
                  borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.16s',
                }}
              >
                {copiedKey === 'best-title' ? 'Copied ✓' : 'Copy Title'}
              </button>
              <button
                onClick={() => copyText(bestHook, 'best-hook')}
                style={{
                  background: copiedKey === 'best-hook' ? '#0a1a0a' : '#111',
                  border: `1px solid ${copiedKey === 'best-hook' ? '#1a4a1a' : '#252525'}`,
                  color: copiedKey === 'best-hook' ? '#00c853' : '#aaa',
                  borderRadius: 7, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.16s',
                }}
              >
                {copiedKey === 'best-hook' ? 'Copied ✓' : 'Copy Hook'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Variations A / B / C ────────────────────────────────────────── */}
      {variations?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Alternative Strategies</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {variations.slice(0, 3).map((v, i) => (
              <div
                key={i}
                style={{
                  background: '#0e0e0e', border: '1px solid #1a1a1a',
                  borderRadius: 12, padding: '16px', cursor: 'default',
                  transition: 'transform 0.16s, border-color 0.16s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.borderColor = '#2a2a2a'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = '#1a1a1a'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#3a3a3a', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {['A', 'B', 'C'][i]}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#bbb' }}>
                    {fmt(v.projectedScore)}<span style={{ fontSize: 10, color: '#333', fontWeight: 400 }}>/100</span>
                  </span>
                </div>

                {v.improvements?.titles?.[0]?.text && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0', marginBottom: 8, lineHeight: 1.4 }}>
                    {v.improvements.titles[0].text}
                  </div>
                )}

                {v.improvements?.hook?.text && (
                  <div style={{ fontSize: 11, color: '#333', fontStyle: 'italic', marginBottom: 14, lineHeight: 1.5 }}>
                    "{v.improvements.hook.text.slice(0, 100)}{v.improvements.hook.text.length > 100 ? '…' : ''}"
                  </div>
                )}

                <CopyButton
                  text={v.improvements?.titles?.[0]?.text || ''}
                  copyKey={`var-${i}`}
                  copiedKey={copiedKey}
                  onCopy={copyText}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Viral Playbook ───────────────────────────────────────────────── */}
      {viralPlaybook && (
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Viral Pattern</div>
          <div style={{ background: '#090912', border: '1px solid #181828', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13 }}>⚡</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#5b7ab5', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Viral Pattern Detected
              </span>
            </div>

            {viralPlaybook.hook_pattern && (
              <div style={{ fontSize: 14, color: '#777', lineHeight: 1.7, marginBottom: 16, paddingLeft: 4, borderLeft: '2px solid #1e1e3a' , paddingLeft: 12 }}>
                {viralPlaybook.hook_pattern}
              </div>
            )}

            {viralPlaybook.replication_steps?.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3b5a9a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  How to Use
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {viralPlaybook.replication_steps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                        background: '#14142a', border: '1px solid #1e1e3a',
                        color: '#5b7ab5', fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginTop: 2,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>{s}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Weaknesses (collapsible) ─────────────────────────────────────── */}
      {Object.keys(origW).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setWeakOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
              cursor: 'pointer', padding: '0 0 14px', width: '100%', textAlign: 'left',
            }}
          >
            <span style={{ ...sectionLabel, marginBottom: 0 }}>Weakness Breakdown</span>
            <span style={{ fontSize: 11, color: '#444', marginLeft: 'auto', fontWeight: 600 }}>
              {weakOpen ? 'Hide ▲' : 'Show ▼'}
            </span>
          </button>

          {weakOpen && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {Object.keys(WEAKNESS_LABELS).map(k => {
                const orig = origW[k];
                const impr = imprW[k];
                return (
                  <div key={k} style={{ background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px' }}>
                    <div style={{ fontSize: 10, color: '#333', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      {WEAKNESS_LABELS[k]}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: weakColor(orig), marginBottom: improvements ? 6 : 0 }}>
                      {weakLabel(orig)}
                    </div>
                    {improvements && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: fixedColor(impr) }}>
                        → {fixedLabel(impr)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── No-improvements partial state ───────────────────────────────── */}
      {result.meta?.reason === 'no_improvements' && (
        <div style={{ padding: '18px 20px', background: '#0e0e0e', border: '1px solid #222', borderRadius: 12, color: '#666', fontSize: 14, marginBottom: 20 }}>
          AI could not generate improvements for this video. The content may already be well-optimized.
        </div>
      )}

      {/* ── Sticky action bar ───────────────────────────────────────────── */}
      <div style={{
        position: 'fixed', bottom: 0, left: 220, right: 0,
        background: '#090909', borderTop: '1px solid #1a1a1a',
        padding: '12px 32px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 100,
      }}>
        <button
          onClick={() => copyText(`${bestTitle}\n\n${bestHook}`, 'all')}
          style={{
            background: copiedKey === 'all' ? '#0a1a0a' : '#ff0000',
            border: 'none', color: copiedKey === 'all' ? '#00c853' : '#fff',
            borderRadius: 8, padding: '9px 20px', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', transition: 'all 0.16s',
          }}
          onMouseEnter={e => { if (copiedKey !== 'all') e.currentTarget.style.background = '#cc0000'; }}
          onMouseLeave={e => { if (copiedKey !== 'all') e.currentTarget.style.background = '#ff0000'; }}
        >
          {copiedKey === 'all' ? 'Copied ✓' : 'Copy Everything'}
        </button>

        <button
          onClick={handleAnalyze}
          style={{
            background: '#141414', border: '1px solid #252525', color: '#aaa',
            borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', transition: 'border-color 0.16s, color 0.16s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#f0f0f0'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#aaa'; }}
        >
          Regenerate
        </button>

        <button
          style={{
            background: '#141414', border: '1px solid #252525', color: '#555',
            borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 13,
            cursor: 'not-allowed', opacity: 0.5,
          }}
          disabled
        >
          Apply Fix
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#2a2a2a', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {videoTitle}
        </div>
      </div>

    </div>
  );
}
