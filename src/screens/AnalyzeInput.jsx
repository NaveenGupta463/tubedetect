import { useState, useEffect, useRef } from 'react';
import { searchVideos, fetchVideoById } from '../api/youtube';

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

const MODES = [
  { id: 'paste',  label: 'Paste Link'   },
  { id: 'search', label: 'Search Video' },
];

const NICHES = [
  'News/Politics',
  'Education',
  'Entertainment',
  'Finance/Business',
  'Podcast/Long-form',
  'Commentary',
];

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

export default function AnalyzeInput({ onNavigate }) {
  const [mode,    setMode]    = useState('paste');
  const [niche,   setNiche]   = useState('');
  const [url,     setUrl]     = useState('');
  const [query,   setQuery]   = useState('');
  const [results,    setResults]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError,   setUrlError]   = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchVideos(query.trim(), 5);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  async function handleAnalyzeUrl() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!niche) { setUrlError('Select a niche category before analyzing.'); return; }
    const videoId = extractVideoId(trimmed);
    if (!videoId) { setUrlError('Enter a valid YouTube URL or video ID.'); return; }
    setUrlLoading(true);
    setUrlError('');
    try {
      const video = await fetchVideoById(videoId);
      onNavigate('analyze', { video, niche });
    } catch (error) {
      setUrlError('Could not load video. Check the URL and try again.');
    } finally {
      setUrlLoading(false);
    }
  }

  function handleSelectResult(result) {
    if (!niche) return;
    onNavigate('analyze', { video: result, niche });
  }

  return (
    <div style={{ display: 'flex', gap: 52, alignItems: 'flex-start', maxWidth: 940 }}>

      {/* Left column: input */}
      <div style={{ flex: '0 0 420px', maxWidth: 420 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#f0f0f0', letterSpacing: '-0.6px', lineHeight: 1.3, marginBottom: 10 }}>
          Fix Why Your Video<br />Isn't Performing
        </div>
        <div style={{ color: '#555', fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Paste a link or search for a video to analyze
        </div>

        {/* Niche selector */}
        <div style={{ marginBottom: 14 }}>
          <select
            value={niche}
            onChange={e => setNiche(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#111', border: `1px solid ${niche ? '#ff0000' : '#282828'}`,
              borderRadius: 10, padding: '12px 16px',
              color: niche ? '#f0f0f0' : '#555',
              fontSize: 13, outline: 'none', cursor: 'pointer',
              transition: 'border-color 0.16s',
              appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23555' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 14px center',
            }}
          >
            <option value="">Select content niche…</option>
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 18,
          background: '#111', border: '1px solid #1e1e1e', borderRadius: 10, padding: 4,
        }}>
          {MODES.map(m => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setResults([]); setQuery(''); setUrl(''); }}
              style={{
                flex: 1, background: mode === m.id ? '#1e1e1e' : 'transparent',
                border: 'none', borderRadius: 7, padding: '8px 0',
                color: mode === m.id ? '#f0f0f0' : '#555',
                fontWeight: mode === m.id ? 600 : 400,
                fontSize: 13, cursor: 'pointer', transition: 'all 0.16s',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* ── Paste mode ──────────────────────────────────────────────────── */}
        {mode === 'paste' && (
          <>
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
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAnalyzeUrl()}
                placeholder="https://www.youtube.com/watch?v=…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#111', border: '1px solid #282828', borderRadius: 10,
                  padding: '12px 16px 12px 40px', color: '#f0f0f0', fontSize: 13,
                  outline: 'none', transition: 'border-color 0.16s',
                }}
                onFocus={e => { e.target.style.borderColor = '#ff0000'; }}
                onBlur={e  => { e.target.style.borderColor = '#282828'; }}
              />
            </div>
            <button
              onClick={handleAnalyzeUrl}
              disabled={!url.trim() || urlLoading || !niche}
              style={{
                width: '100%',
                background: url.trim() && !urlLoading && niche ? '#ff0000' : '#1a1a1a',
                color:      url.trim() && !urlLoading && niche ? '#fff'    : '#444',
                border: 'none', borderRadius: 10, padding: '13px 24px',
                fontWeight: 700, fontSize: 14,
                cursor: url.trim() && !urlLoading && niche ? 'pointer' : 'not-allowed',
                transition: 'background 0.16s, color 0.16s',
              }}
              onMouseEnter={e => { if (url.trim() && !urlLoading && niche) e.currentTarget.style.background = '#cc0000'; }}
              onMouseLeave={e => { if (url.trim() && !urlLoading && niche) e.currentTarget.style.background = '#ff0000'; }}
            >
              {urlLoading ? 'Loading…' : !niche ? 'Select a niche above' : 'Analyze'}
            </button>
            {urlError && (
              <div style={{ marginTop: 10, color: '#ff1744', fontSize: 13, padding: '10px 14px', background: '#1a0808', borderRadius: 8, border: '1px solid #3a1010' }}>
                {urlError}
              </div>
            )}
          </>
        )}

        {/* ── Search mode ─────────────────────────────────────────────────── */}
        {mode === 'search' && (
          <>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by title, keyword, or topic…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#111', border: '1px solid #282828', borderRadius: 10,
                padding: '12px 16px', color: '#f0f0f0', fontSize: 13,
                outline: 'none', transition: 'border-color 0.16s', marginBottom: 12,
              }}
              onFocus={e => { e.target.style.borderColor = '#ff0000'; }}
              onBlur={e  => { e.target.style.borderColor = '#282828'; }}
            />

            {loading && (
              <div style={{ fontSize: 12, color: '#444', marginBottom: 8 }}>Searching…</div>
            )}

            {!loading && results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {results.map(r => {
                  const thumb   = r.snippet?.thumbnails?.medium?.url || r.snippet?.thumbnails?.default?.url || '';
                  const title   = r.snippet?.title || '';
                  const channel = r.snippet?.channelTitle || '';
                  return (
                    <button
                      key={r.id}
                      onClick={() => handleSelectResult(r)}
                      disabled={!niche}
                      style={{
                        display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left',
                        width: '100%', background: '#0e0e0e', border: '1px solid #1a1a1a',
                        borderRadius: 10, padding: '10px 12px', cursor: niche ? 'pointer' : 'not-allowed',
                        transition: 'border-color 0.16s, background 0.16s',
                        opacity: niche ? 1 : 0.4,
                      }}
                      onMouseEnter={e => { if (niche) { e.currentTarget.style.borderColor = '#ff0000'; e.currentTarget.style.background = '#111'; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.background = '#0e0e0e'; }}
                    >
                      {thumb && (
                        <img
                          src={thumb}
                          alt=""
                          style={{ width: 80, height: 45, borderRadius: 6, objectFit: 'cover', flexShrink: 0, background: '#111' }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: '#d0d0d0', lineHeight: 1.4, marginBottom: 3,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>
                          {title}
                        </div>
                        <div style={{ fontSize: 11, color: '#444' }}>{channel}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {!loading && query.trim() && results.length === 0 && (
              <div style={{ fontSize: 12, color: '#333', padding: '8px 0' }}>No results found.</div>
            )}
          </>
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
            ['Viral Playbook',    "Replicable pattern extracted from this video's format"],
          ].map(([title, desc]) => (
            <FeatureCard key={title} title={title} desc={desc} />
          ))}
        </div>
      </div>

    </div>
  );
}
