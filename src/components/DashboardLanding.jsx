import { useState, useRef, useEffect } from 'react';
import { fetchVideoById, fetchChannel, fetchChannelVideos, searchChannels } from '../api/youtube';
import { formatNum } from '../utils/analysis';

// ── Helpers ───────────────────────────────────────────────────────────────────
const YT_VIDEO_RE = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const YT_CHAN_RE  = /youtube\.com\/(?:channel\/(UC[\w-]+)|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/;

function detectUrl(input) {
  const vm = input.match(YT_VIDEO_RE);
  if (vm) return { type: 'video', id: vm[1] };
  const cm = input.match(YT_CHAN_RE);
  if (cm) return { type: 'channel', raw: input };
  return null;
}

function isChannelLike(input) {
  return input.startsWith('@') || /^UC[\w-]{20,}$/.test(input);
}

const RECENT_KEY = 'tubeintel_recent_ch';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(ch) {
  const list = getRecent().filter(r => r.id !== ch.id).slice(0, 4);
  const entry = {
    id: ch.id,
    title: ch.snippet?.title || '',
    thumbnail: ch.snippet?.thumbnails?.default?.url || '',
  };
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([entry, ...list])); } catch {}
}

const PLAN_STEPS = [
  { step: 1, icon: '🔥', label: 'Research Niche',     view: 'trends',     desc: 'Find trending topics' },
  { step: 2, icon: '🧬', label: 'Decode What Works',  view: 'viral',      desc: 'Extract viral patterns' },
  { step: 3, icon: '✍️', label: 'Write Script',       view: 'script',     desc: 'Hook, chapters, CTA' },
  { step: 4, icon: '⚡', label: 'Score Your Idea',    view: 'scorer',     desc: 'Title + thumbnail' },
  { step: 5, icon: '🏷️', label: 'Optimise SEO',      view: 'seo',        desc: 'Tags & keywords' },
  { step: 6, icon: '🚀', label: 'Validate & Launch',  view: 'validator',  desc: 'Final 8-layer gate', gate: true },
];

// ── Sub-components ────────────────────────────────────────────────────────────
function ChannelSuggestion({ ch, onSelect, loading }) {
  return (
    <button
      onClick={() => onSelect(ch)}
      disabled={loading}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', background: 'transparent',
        border: 'none', borderBottom: '1px solid #111',
        cursor: loading ? 'wait' : 'pointer', width: '100%', textAlign: 'left',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#111'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {ch.thumbnail
        ? <img src={ch.thumbnail} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} />
        : <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: '50%', flexShrink: 0 }} />
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ch.title}
        </div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
          {formatNum(ch.statistics?.subscriberCount)} subscribers
        </div>
      </div>
      {loading && <div className="btn-spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DashboardLanding({ channel, onChannelLoad, onVideoLoad, onNavigate }) {
  const [query, setQuery]             = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching]     = useState(false);
  const [loadingUrl, setLoadingUrl]   = useState(false);
  const [error, setError]             = useState('');
  const [showDrop, setShowDrop]       = useState(false);
  const [showPlan, setShowPlan]       = useState(false);
  const [recent, setRecent]         = useState(getRecent);
  const [urlDetected, setUrlDetected] = useState(null);

  const inputRef  = useRef(null);
  const dropRef   = useRef(null);
  const debounce  = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setShowDrop(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setError('');
    setSuggestions([]);
    setShowDrop(false);

    if (!val.trim()) { setUrlDetected(null); return; }

    // URL → show badge only, no suggestions needed
    const url = detectUrl(val);
    if (url) { setUrlDetected(url); return; }
    setUrlDetected(null);

    // All other text → channel name suggestions
    if (debounce.current) clearTimeout(debounce.current);
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const results = await searchChannels(val, 5);
      setSuggestions(results);
      setShowDrop(results.length > 0);
      setSearching(false);
    }, 300);
  };

  const loadVideoFromUrl = async (videoId) => {
    setLoadingUrl(true);
    setError('');
    try {
      const video = await fetchVideoById(videoId);
      let ch = null, vids = [];
      const chId = video.snippet?.channelId;
      if (chId) {
        try {
          ch   = await fetchChannel(chId);
          vids = await fetchChannelVideos(chId, 50);
          saveRecent(ch);
          setRecent(getRecent());
        } catch {}
      }
      onVideoLoad(video, ch, vids);
    } catch {
      setError('Could not load video. Check the URL and try again.');
    } finally {
      setLoadingUrl(false);
    }
  };

  const loadChannel = async (input) => {
    setSearching(true);
    setError('');
    setShowDrop(false);
    try {
      const ch   = await fetchChannel(input);
      const vids = await fetchChannelVideos(ch.id, 50);
      saveRecent(ch);
      setRecent(getRecent());
      onChannelLoad(ch, vids);
    } catch (err) {
      setError(err.message || 'Channel not found. Try @handle or paste a URL.');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    const val = query.trim();
    if (!val) return;
    if (urlDetected?.type === 'video')   { await loadVideoFromUrl(urlDetected.id); return; }
    if (urlDetected?.type === 'channel') { await loadChannel(val); return; }
    await loadChannel(val);
  };

  const handleSelectChannel = async (ch) => {
    setShowDrop(false);
    setQuery(ch.title);
    setSearching(true);
    setError('');
    try {
      const vids = await fetchChannelVideos(ch.id, 50);
      saveRecent(ch);
      setRecent(getRecent());
      onChannelLoad(ch, vids);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleRecentClick = async (entry) => {
    setSearching(true);
    setError('');
    try {
      const ch   = await fetchChannel(entry.id);
      const vids = await fetchChannelVideos(ch.id, 50);
      onChannelLoad(ch, vids);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const isBusy = searching || loadingUrl;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '48px 20px 80px' }}>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 44 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ff1744', marginBottom: 10 }}>
          TubeIntel
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: '#fff', margin: '0 0 10px', lineHeight: 1.2 }}>
          Stop guessing.<br />Start optimising.
        </h1>
        <p style={{ fontSize: 15, color: '#555', margin: 0 }}>
          What do you want to do today?
        </p>
      </div>

      {/* Two pillar cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 36 }}>

        {/* Fix My Video */}
        <button
          onClick={() => { setShowPlan(false); inputRef.current?.focus(); }}
          style={{
            background: '#0d0d0d', border: '1px solid #1e1e1e',
            borderTop: '3px solid #7c4dff',
            borderRadius: 14, padding: '24px 22px',
            textAlign: 'left', cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#111'; e.currentTarget.style.borderColor = '#7c4dff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0d0d0d'; e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.borderTopColor = '#7c4dff'; }}
        >
          <div style={{ fontSize: 28, marginBottom: 12 }}>🔴</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Fix My Video</div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 16 }}>
            Already posted? Diagnose why it underperformed and get AI fixes for title, hook, and thumbnail.
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff' }}>Search a channel or video below →</div>
        </button>

        {/* Plan My Video */}
        <button
          onClick={() => setShowPlan(p => !p)}
          style={{
            background: showPlan ? '#0a1a0f' : '#0d0d0d',
            border: `1px solid ${showPlan ? '#00b89444' : '#1e1e1e'}`,
            borderTop: '3px solid #00b894',
            borderRadius: 14, padding: '24px 22px',
            textAlign: 'left', cursor: 'pointer',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { if (!showPlan) { e.currentTarget.style.background = '#0a120d'; e.currentTarget.style.borderColor = '#00b89444'; }}}
          onMouseLeave={e => { if (!showPlan) { e.currentTarget.style.background = '#0d0d0d'; e.currentTarget.style.borderColor = '#1e1e1e'; }}}
        >
          <div style={{ fontSize: 28, marginBottom: 12 }}>🟢</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Plan My Video</div>
          <div style={{ fontSize: 13, color: '#555', lineHeight: 1.6, marginBottom: 16 }}>
            Haven't posted yet? Research your niche, build your script, score your idea, and validate before publishing.
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#00b894' }}>
            {showPlan ? 'Hide workflow ↑' : 'Start guided workflow →'}
          </div>
        </button>
      </div>

      {/* Plan My Video expanded workflow */}
      {showPlan && (
        <div style={{
          background: '#0a120d', border: '1px solid #00b89422',
          borderRadius: 14, padding: '20px 22px', marginBottom: 28,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#00b894', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
            6-Step Pre-Publish Workflow
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PLAN_STEPS.map((s, i) => (
              <button
                key={s.step}
                onClick={() => onNavigate(s.view)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: s.gate ? '#00b89411' : 'transparent',
                  border: s.gate ? '1px solid #00b89433' : '1px solid transparent',
                  borderRadius: 10, padding: '10px 14px',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = s.gate ? '#00b89422' : '#ffffff08'}
                onMouseLeave={e => e.currentTarget.style.background = s.gate ? '#00b89411' : 'transparent'}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: s.gate ? '#00b89433' : '#1a1a1a',
                  border: `1px solid ${s.gate ? '#00b89466' : '#2a2a2a'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800,
                  color: s.gate ? '#00b894' : '#555',
                }}>
                  {s.step}
                </div>
                <div style={{ fontSize: 16 }}>{s.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: s.gate ? '#00b894' : '#ccc' }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#444' }}>{s.desc}</div>
                </div>
                {s.gate && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, background: '#00b89433',
                    color: '#00b894', borderRadius: 4, padding: '2px 7px', letterSpacing: 0.4,
                  }}>GATE</span>
                )}
                <span style={{ fontSize: 12, color: '#333' }}>→</span>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: '#2a4a35', fontStyle: 'italic' }}>
            Each step feeds into the next. All data flows into the Pre-Publish Validator.
          </div>
        </div>
      )}

      {/* Fix My Video search */}
      <div style={{ marginBottom: 28 }} ref={dropRef}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Search a channel or video to get started
        </div>

        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', gap: 0,
            background: '#0d0d0d', border: '1px solid #2a2a2a',
            borderRadius: 10, overflow: 'visible',
            boxShadow: '0 0 0 0px #7c4dff',
            transition: 'box-shadow 0.15s',
          }}>
            <input
              ref={inputRef}
              value={query}
              onChange={handleQueryChange}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              onFocus={() => suggestions.length > 0 && setShowDrop(true)}
              placeholder="@channel, channel name, or paste a YouTube video URL…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                padding: '14px 16px', fontSize: 14, color: '#e0e0e0',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={isBusy || !query.trim()}
              style={{
                background: query.trim() ? '#7c4dff' : '#1a1a1a',
                border: 'none', borderRadius: '0 9px 9px 0',
                padding: '0 22px', fontSize: 13, fontWeight: 700,
                color: query.trim() ? '#fff' : '#333',
                cursor: isBusy || !query.trim() ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {isBusy
                ? <div className="btn-spinner" style={{ width: 14, height: 14 }} />
                : 'Search →'}
            </button>
          </div>

          {/* URL detected badge */}
          {urlDetected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{
                fontSize: 12, color: '#00c853', background: '#00c85311',
                border: '1px solid #00c85333', borderRadius: 6, padding: '4px 10px',
              }}>
                {urlDetected.type === 'video' ? '🎬 YouTube video URL detected — press Search to analyse' : '📺 YouTube channel URL detected'}
              </div>
            </div>
          )}

          {/* Dropdown suggestions */}
          {showDrop && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#0d0d0d', border: '1px solid #2a2a2a',
              borderRadius: '0 0 10px 10px', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              marginTop: 2,
            }}>
              <div style={{ padding: '8px 14px 4px', fontSize: 11, color: '#555', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {suggestions.length === 1 ? 'Best match' : 'Channels'}
              </div>
              {suggestions.map(ch => (
                <ChannelSuggestion
                  key={ch.id}
                  ch={ch}
                  onSelect={handleSelectChannel}
                  loading={searching}
                />
              ))}
            </div>
          )}

          {/* Searching spinner inline */}
          {searching && !showDrop && (
            <div style={{ position: 'absolute', right: 80, top: '50%', transform: 'translateY(-50%)' }}>
              <div className="btn-spinner" style={{ width: 14, height: 14 }} />
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 10, fontSize: 13, color: '#ff5252', background: '#1a0505', border: '1px solid #3a1010', borderRadius: 8, padding: '8px 14px' }}>
            {error}
          </div>
        )}
      </div>

      {/* Currently loaded channel */}
      {channel && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: '#111', border: '1px solid #1e1e1e',
          borderRadius: 10, padding: '12px 16px', marginBottom: 24,
        }}>
          {channel.snippet?.thumbnails?.default?.url && (
            <img src={channel.snippet.thumbnails.default.url} alt="" style={{ width: 36, height: 36, borderRadius: '50%' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ccc' }}>Currently loaded</div>
            <div style={{ fontSize: 12, color: '#555' }}>{channel.snippet?.title}</div>
          </div>
          <button
            onClick={() => onNavigate('analyze')}
            style={{ background: '#1a1030', border: '1px solid #7c4dff44', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, color: '#c084fc', cursor: 'pointer' }}
          >
            Analyze →
          </button>
        </div>
      )}

      {/* Recent channels */}
      {recent.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#333', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            Recent
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recent.map(r => (
              <button
                key={r.id}
                onClick={() => handleRecentClick(r)}
                disabled={isBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#0d0d0d', border: '1px solid #1e1e1e',
                  borderRadius: 8, padding: '7px 12px',
                  cursor: 'pointer', fontSize: 13, color: '#888',
                  transition: 'border-color 0.1s, color 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#ccc'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e1e1e'; e.currentTarget.style.color = '#888'; }}
              >
                {r.thumbnail && <img src={r.thumbnail} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />}
                {r.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
