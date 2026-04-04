import { useState, useEffect, useRef } from 'react';
import { fetchChannel, fetchChannelVideos, searchChannels } from '../api/youtube';
import { formatNum } from '../utils/analysis';
import { loadLastChannel } from './VideoGrid';

const HISTORY_KEY = 'tubeintel_search_history';

const TRENDING = [
  { handle: '@MrBeast',         label: 'MrBeast' },
  { handle: '@PewDiePie',       label: 'PewDiePie' },
  { handle: '@tseries',         label: 'T-Series' },
  { handle: '@carryminati',     label: 'CarryMinati' },
  { handle: '@BBKiVines',       label: 'BB Ki Vines' },
  { handle: '@TechnicalGuruji', label: 'Technical Guruji' },
];

const FEATURES = [
  {
    icon: '📊',
    title: 'Deep Video Analysis',
    desc: 'Understand exactly why each video over or underperformed against your channel baseline.',
  },
  {
    icon: '💬',
    title: 'Interaction Timeline',
    desc: 'See which moments viewers found compelling, extracted from comment timestamps.',
  },
  {
    icon: '📈',
    title: 'Channel Benchmarks',
    desc: 'Every metric compared against your own channel average — not generic industry standards.',
  },
  {
    icon: '🎯',
    title: 'Actionable Insights',
    desc: 'Specific recommendations on title, format, timing, and engagement strategy.',
  },
];

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveToHistory(channel) {
  const item = {
    id: channel.id,
    title: channel.snippet?.title || '',
    handle: channel.snippet?.customUrl || '',
    thumbnail: channel.snippet?.thumbnails?.default?.url || '',
    subscribers: channel.statistics?.subscriberCount || '0',
  };
  const hist = getHistory().filter(h => h.id !== item.id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([item, ...hist].slice(0, 5)));
}

export default function ChannelSearch({ onLoad }) {
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [loadingStep, setLoadingStep] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [history, setHistory]       = useState(getHistory());
  const [didYouMean, setDidYouMean] = useState(null);
  const [lastChannel, setLastChannel] = useState(null);

  const debounceRef  = useRef(null);
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  // Load last channel from localStorage
  useEffect(() => {
    const saved = loadLastChannel();
    if (saved?.channel && saved?.videos?.length) {
      setLastChannel(saved);
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Debounced live suggestions
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setSugLoading(false);
      return;
    }
    setSugLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchChannels(q);
      setSuggestions(results);
      setSugLoading(false);
      if (results.length > 0) setShowDropdown(true);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [input]);

  const loadChannel = async (query) => {
    setLoading(true);
    setError('');
    setDidYouMean(null);
    setShowDropdown(false);
    setLoadingStep('Finding channel…');
    try {
      const channel = await fetchChannel(query);
      setLoadingStep(`Loading videos for ${channel.snippet?.title}…`);
      const videos = await fetchChannelVideos(channel.id, 50);
      saveToHistory(channel);
      setHistory(getHistory());
      onLoad(channel, videos);
    } catch (err) {
      // Fuzzy fallback: search for close match
      const fuzzy = await searchChannels(query.replace(/^@/, '').replace(/[^a-zA-Z0-9 ]/g, ''), 3);
      if (fuzzy.length > 0) {
        setDidYouMean(fuzzy[0]);
        setError(`Can't find "${query}". Did you mean "${fuzzy[0].title}"?`);
      } else {
        setError(`Can't find this channel. Try searching their exact YouTube handle starting with @`);
      }
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    const val = input.trim();
    if (!val) return;
    loadChannel(val);
  };

  const handleSuggestionClick = (sug) => {
    setInput(sug.title);
    setShowDropdown(false);
    loadChannel(sug.id);
  };

  const handleHistoryClick = (item) => {
    setInput(item.handle || item.title);
    setShowDropdown(false);
    loadChannel(item.handle || item.id);
  };

  const handleFocus = () => {
    if (input.trim().length < 3 && history.length > 0) setShowDropdown(true);
    else if (input.trim().length >= 3 && suggestions.length > 0) setShowDropdown(true);
  };

  const clearInput = () => {
    setInput('');
    setError('');
    setDidYouMean(null);
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  const showHistoryPanel     = showDropdown && input.trim().length < 3 && history.length > 0;
  const showSuggestionsPanel = showDropdown && input.trim().length >= 3 && (sugLoading || suggestions.length > 0);

  return (
    <div className="search-page">
      <div className="hero">
        <div className="hero-badge">
          <span className="hero-badge-dot" />
          YouTube Intelligence Dashboard
        </div>

        <h1 className="hero-title">
          Understand Why Your Videos<br />
          <span className="hero-accent">Succeed or Fail</span>
        </h1>

        <p className="hero-subtitle">
          Deep analysis of engagement metrics, audience behavior, and content
          performance — so you can make data-driven decisions on every upload.
        </p>

        <form className="search-form" onSubmit={handleSearch}>
          {/* Input row + dropdown container */}
          <div ref={containerRef} style={{ position: 'relative' }}>
            <div className="search-input-wrap">
              <svg className="search-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>

              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder="@handle, channel name, or paste YouTube URL…"
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); setDidYouMean(null); }}
                onFocus={handleFocus}
                disabled={loading}
                autoFocus
              />

              {/* Clear button */}
              {input && !loading && (
                <button
                  type="button"
                  onClick={clearInput}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#555', fontSize: 16, padding: '0 6px', lineHeight: 1,
                    flexShrink: 0,
                  }}
                  title="Clear"
                >
                  ✕
                </button>
              )}

              <button
                type="submit"
                className="search-btn"
                disabled={loading || !input.trim()}
              >
                {loading ? <span className="btn-spinner" /> : 'Analyze'}
              </button>
            </div>

            {/* Dropdown */}
            {(showHistoryPanel || showSuggestionsPanel) && (
              <div className="search-dropdown">
                {showHistoryPanel && (
                  <>
                    <div className="dropdown-section-label">Recent Searches</div>
                    {history.map(item => (
                      <div
                        key={item.id}
                        className="dropdown-item"
                        onClick={() => handleHistoryClick(item)}
                      >
                        {item.thumbnail
                          ? <img src={item.thumbnail} alt="" className="dropdown-thumb" />
                          : <div className="dropdown-thumb-placeholder">▶</div>
                        }
                        <div className="dropdown-item-info">
                          <div className="dropdown-item-name">{item.title}</div>
                          <div className="dropdown-item-sub">
                            {item.handle && <span>{item.handle} · </span>}
                            {formatNum(item.subscribers)} subs
                          </div>
                        </div>
                        <span style={{ color: '#444', fontSize: 13, flexShrink: 0 }}>🕐</span>
                      </div>
                    ))}
                  </>
                )}

                {showSuggestionsPanel && (
                  <>
                    <div className="dropdown-section-label">Channels</div>
                    {sugLoading ? (
                      <div style={{ padding: '12px 16px', color: '#555', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="btn-spinner" style={{ width: 14, height: 14 }} />
                        Searching…
                      </div>
                    ) : suggestions.map(sug => (
                      <div
                        key={sug.id}
                        className="dropdown-item"
                        onClick={() => handleSuggestionClick(sug)}
                      >
                        {sug.thumbnail
                          ? <img src={sug.thumbnail} alt="" className="dropdown-thumb" />
                          : <div className="dropdown-thumb-placeholder">▶</div>
                        }
                        <div className="dropdown-item-info">
                          <div className="dropdown-item-name">{sug.title}</div>
                          <div className="dropdown-item-sub">
                            {sug.statistics?.subscriberCount ? formatNum(sug.statistics.subscriberCount) + ' subs' : ''}
                            {sug.statistics?.subscriberCount && sug.statistics?.videoCount ? ' · ' : ''}
                            {sug.statistics?.videoCount ? formatNum(sug.statistics.videoCount) + ' videos' : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {loading && loadingStep && (
            <div className="loading-step">
              <span className="loading-dot" />
              {loadingStep}
            </div>
          )}

          {error && (
            <div className="search-error" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
              {didYouMean && (
                <button
                  type="button"
                  onClick={() => { setInput(didYouMean.title); loadChannel(didYouMean.id); }}
                  style={{
                    background: '#7c4dff22', border: '1px solid #7c4dff55',
                    borderRadius: 6, padding: '3px 10px',
                    color: '#7c4dff', fontWeight: 700, fontSize: 12,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Load "{didYouMean.title}"
                </button>
              )}
            </div>
          )}

          <div style={{ fontSize: 12, color: '#444', marginTop: 8, textAlign: 'center' }}>
            Supports: @handle · youtube.com/@handle · youtube.com/channel/UC… · paste any channel URL
          </div>
        </form>

        {/* Continue with last channel */}
        {lastChannel && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#0f0f0f', border: '1px solid #1e1e1e',
            borderRadius: 10, padding: '12px 16px',
            marginBottom: 16, maxWidth: 500, width: '100%',
          }}>
            {lastChannel.channel.snippet?.thumbnails?.default?.url && (
              <img
                src={lastChannel.channel.snippet.thumbnails.default.url}
                alt=""
                style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid #2a2a2a', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Continue with {lastChannel.channel.snippet?.title}
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>
                {formatNum(lastChannel.channel.statistics?.subscriberCount || 0)} subscribers · {lastChannel.videos.length} videos
              </div>
            </div>
            <button
              onClick={() => onLoad(lastChannel.channel, lastChannel.videos)}
              style={{
                background: '#7c4dff22', border: '1px solid #7c4dff55',
                borderRadius: 6, padding: '6px 14px',
                fontSize: 12, fontWeight: 700, color: '#b39ddb',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Trending channels */}
        <div className="examples">
          <span className="examples-label">Trending:</span>
          {TRENDING.map(t => (
            <button
              key={t.handle}
              className="example-chip"
              onClick={() => { setInput(t.handle); setError(''); setDidYouMean(null); loadChannel(t.handle); }}
              disabled={loading}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="features-grid">
        {FEATURES.map(f => (
          <div key={f.title} className="feature-card">
            <div className="feature-icon">{f.icon}</div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-desc">{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="search-note">
        Uses YouTube Data API v3 · Public channel data only · No login required
      </div>
    </div>
  );
}
