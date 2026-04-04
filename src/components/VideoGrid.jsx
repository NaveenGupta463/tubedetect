import { useState, useEffect, useRef } from 'react';
import { formatNum, parseDuration } from '../utils/analysis';
import { searchVideos } from '../api/youtube';

export const LAST_CHANNEL_KEY = 'tubeintel_last_channel';

export function saveLastChannel(channel, videos) {
  try {
    localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify({
      channel,
      videos: videos.slice(0, 50),
      savedAt: Date.now(),
    }));
  } catch {}
}

export function loadLastChannel() {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function EngBadge({ rate }) {
  const color = rate >= 3 ? '#00c853' : rate >= 1.5 ? '#ff9100' : '#ff1744';
  return (
    <span style={{
      background: color + '22', color, border: `1px solid ${color}44`,
      borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700,
    }}>
      {rate.toFixed(1)}%
    </span>
  );
}

function VideoSearchWidget({ onVideoFound }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (q.length < 3) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const vids = await searchVideos(q, 8);
      setResults(vids);
      setLoading(false);
      if (vids.length) setShow(true);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [input]);

  useEffect(() => {
    const handler = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setShow(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div style={{ maxWidth: 600, margin: '60px auto 0', padding: '0 24px' }}>
      <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', textAlign: 'center', marginBottom: 8 }}>
        Find a Video to Analyze
      </h3>
      <p style={{ fontSize: 13, color: '#555', textAlign: 'center', marginBottom: 24, lineHeight: 1.6 }}>
        Load a channel first for full grid view, or search any YouTube video directly
      </p>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <div className="search-input-wrap">
          <svg className="search-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="search-input"
            placeholder="Search any YouTube video or paste URL..."
            value={input}
            onChange={e => { setInput(e.target.value); setShow(false); }}
            onFocus={() => (results.length > 0 || loading) && setShow(true)}
          />
        </div>

        {show && (results.length > 0 || loading) && (
          <div className="search-dropdown">
            {loading ? (
              <div style={{ padding: '12px 16px', color: '#555', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="btn-spinner" style={{ width: 14, height: 14 }} />
                Searching…
              </div>
            ) : results.map(v => {
              const views = parseInt(v.statistics?.viewCount || 0);
              const dur = parseDuration(v.contentDetails?.duration);
              return (
                <div
                  key={v.id}
                  className="dropdown-item"
                  onClick={() => { setShow(false); onVideoFound(v); }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      src={v.snippet?.thumbnails?.default?.url || ''}
                      alt=""
                      className="dropdown-thumb"
                      style={{ borderRadius: 4 }}
                    />
                    {dur.total > 0 && (
                      <span style={{
                        position: 'absolute', bottom: 2, right: 2,
                        background: 'rgba(0,0,0,0.85)', color: '#fff',
                        fontSize: 10, padding: '1px 3px', borderRadius: 2,
                      }}>
                        {dur.formatted}
                      </span>
                    )}
                  </div>
                  <div className="dropdown-item-info">
                    <div className="dropdown-item-name" style={{ WebkitLineClamp: 2 }}>
                      {v.snippet?.title}
                    </div>
                    <div className="dropdown-item-sub">
                      {v.snippet?.channelTitle} · {formatNum(views)} views
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: 'latest',    label: 'Latest' },
  { value: 'views',     label: 'Most Views' },
  { value: 'eng_best',  label: 'Best Engagement' },
  { value: 'eng_worst', label: 'Worst Engagement' },
];

export default function VideoGrid({ channel, videos, onVideoSelect, onSwitchChannel }) {
  const [sortBy, setSortBy] = useState('latest');
  const [filter, setFilter] = useState('');

  if (!channel) {
    return <VideoSearchWidget onVideoFound={onVideoSelect} />;
  }

  const sorted = [...videos]
    .filter(v => !filter || (v.snippet?.title || '').toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'latest') {
        return new Date(b.snippet?.publishedAt || 0) - new Date(a.snippet?.publishedAt || 0);
      }
      if (sortBy === 'views') {
        return parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0);
      }
      if (sortBy === 'eng_best' || sortBy === 'eng_worst') {
        const eng = v => {
          const vws = parseInt(v.statistics?.viewCount || 1);
          return (parseInt(v.statistics?.likeCount || 0) + parseInt(v.statistics?.commentCount || 0)) / vws;
        };
        return sortBy === 'eng_best' ? eng(b) - eng(a) : eng(a) - eng(b);
      }
      return 0;
    });

  const thumb = channel.snippet?.thumbnails?.default?.url;

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* Channel header */}
      <div style={{
        background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
        padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        {thumb && (
          <img src={thumb} alt="" style={{ width: 42, height: 42, borderRadius: '50%', border: '2px solid #2a2a2a', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 1 }}>
            {channel.snippet?.title}
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>
            {formatNum(channel.statistics?.subscriberCount || 0)} subscribers · {videos.length} videos loaded
          </div>
        </div>
        <button
          onClick={onSwitchChannel}
          style={{
            background: '#111', border: '1px solid #2a2a2a', borderRadius: 6,
            padding: '7px 14px', fontSize: 12, fontWeight: 600, color: '#777',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          ⇄ Switch Channel
        </button>
      </div>

      {/* Controls */}
      <div style={{
        padding: '10px 24px', display: 'flex', gap: 10,
        alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #111',
      }}>
        <input
          type="text"
          placeholder="Filter videos..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{
            background: '#111', border: '1px solid #1e1e1e', borderRadius: 6,
            padding: '6px 12px', color: '#ddd', fontSize: 13, width: 180,
          }}
        />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              style={{
                background: sortBy === opt.value ? '#7c4dff22' : '#111',
                border: `1px solid ${sortBy === opt.value ? '#7c4dff' : '#1e1e1e'}`,
                borderRadius: 6, padding: '5px 10px', fontSize: 12,
                fontWeight: sortBy === opt.value ? 700 : 400,
                color: sortBy === opt.value ? '#7c4dff' : '#777',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#444' }}>
          {sorted.length} videos
        </div>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 14,
        padding: '18px 24px',
      }}>
        {sorted.map(v => {
          const stats = v.statistics || {};
          const views = parseInt(stats.viewCount || 0);
          const likes = parseInt(stats.likeCount || 0);
          const comments = parseInt(stats.commentCount || 0);
          const eng = views > 0 ? ((likes + comments) / views * 100) : 0;
          const dur = parseDuration(v.contentDetails?.duration);
          const date = v.snippet?.publishedAt
            ? new Date(v.snippet.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
          const thumbUrl = v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || '';

          return (
            <div
              key={v.id}
              className="vgrid-card"
              onClick={() => onVideoSelect(v)}
            >
              <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: '#111' }}>
                {thumbUrl
                  ? <img src={thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 28 }}>▶</div>
                }
                {dur.total > 0 && (
                  <span style={{
                    position: 'absolute', bottom: 6, right: 6,
                    background: 'rgba(0,0,0,0.85)', color: '#fff',
                    fontSize: 11, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                  }}>
                    {dur.formatted}
                  </span>
                )}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#e0e0e0', lineHeight: 1.4,
                  marginBottom: 8, display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {v.snippet?.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 12, color: '#555' }}>{formatNum(views)} views</div>
                  <EngBadge rate={eng} />
                </div>
                <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>{date}</div>
              </div>
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center',
            padding: '60px 0', color: '#444', fontSize: 14,
          }}>
            No videos match your filter.
          </div>
        )}
      </div>
    </div>
  );
}
