import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { fetchChannel, fetchChannelVideos, searchChannels } from '../api/youtube';
import { formatNum, calcEngagement, parseDuration } from '../utils/analysis';
import ProGate from './ProGate';

const COLORS = ['#ff0000', '#2196f3', '#00c853', '#ff9100'];

function buildMetrics(channel, videos) {
  const stats = channel?.statistics || {};
  const totalViews = videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0);
  const avgViews   = videos.length ? totalViews / videos.length : 0;
  const avgEng     = videos.length ? videos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / videos.length : 0;

  let uploadsPerWeek = 0;
  if (videos.length >= 2) {
    const sorted = [...videos].sort((a, b) => new Date(a.snippet?.publishedAt) - new Date(b.snippet?.publishedAt));
    const spanMs = new Date(sorted[sorted.length - 1].snippet?.publishedAt) - new Date(sorted[0].snippet?.publishedAt);
    const spanWeeks = spanMs / (7 * 24 * 3600 * 1000);
    uploadsPerWeek = spanWeeks > 0 ? parseFloat((videos.length / spanWeeks).toFixed(1)) : 0;
  }

  const avgDuration = videos.length
    ? videos.reduce((s, v) => s + parseDuration(v.contentDetails?.duration).total, 0) / videos.length / 60
    : 0;

  return {
    subscribers:    parseInt(stats.subscriberCount || 0),
    totalViews:     parseInt(stats.viewCount || 0),
    avgViews:       Math.round(avgViews),
    engagementRate: parseFloat(avgEng.toFixed(3)),
    uploadsPerWeek,
    avgDurationMin: parseFloat(avgDuration.toFixed(1)),
  };
}

const METRICS_CONFIG = [
  { key: 'subscribers',    label: 'Subscribers',        fmt: formatNum },
  { key: 'avgViews',       label: 'Avg Views/Video',    fmt: formatNum },
  { key: 'engagementRate', label: 'Engagement Rate (%)', fmt: v => v + '%' },
  { key: 'uploadsPerWeek', label: 'Uploads / Week',      fmt: v => v + 'x' },
  { key: 'avgDurationMin', label: 'Avg Video Length',    fmt: v => v + ' min' },
];

const Tip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span style={{ color: p.fill }}>{p.dataKey}:</span>
          <span>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Per-slot input with live dropdown ────────────────────────────────────────
function CompetitorSlotInput({ onLoad }) {
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const debounceRef  = useRef(null);
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Debounced live suggestions (triggers at 2+ chars)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = input.trim();
    if (q.length < 2) { setSuggestions([]); setSugLoading(false); return; }
    setSugLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await searchChannels(q, 5);
      setSuggestions(results);
      setSugLoading(false);
      if (results.length > 0) setShowDropdown(true);
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [input]);

  const doLoad = async (query) => {
    setLoading(true);
    setError('');
    setShowDropdown(false);
    try {
      const ch = await fetchChannel(query);
      const vids = await fetchChannelVideos(ch.id, 30);
      onLoad(ch, vids); // triggers unmount — no state updates after this
    } catch {
      setLoading(false);
      // Fuzzy fallback
      const fuzzy = await searchChannels(
        query.replace(/^@/, '').replace(/[^a-zA-Z0-9 ]/g, ' ').trim(), 3
      );
      if (fuzzy.length > 0) {
        setError(`Not found. Did you mean "${fuzzy[0].title}"?`);
        setSuggestions(fuzzy);
        setShowDropdown(true);
      } else {
        setError('Channel not found. Try @handle format.');
      }
    }
  };

  const handleSugClick = (sug) => {
    setShowDropdown(false);
    setError('');
    doLoad(sug.id);
  };

  const clearInput = () => {
    setInput('');
    setError('');
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <div className="comp-input-row">
        <input
          ref={inputRef}
          className="search-filter"
          placeholder="@handle, name, or paste URL…"
          value={input}
          onChange={e => { setInput(e.target.value); setError(''); }}
          onFocus={() => { if (input.length >= 2 && suggestions.length > 0) setShowDropdown(true); }}
          onKeyDown={e => e.key === 'Enter' && input.trim() && doLoad(input.trim())}
          disabled={loading}
          style={{ flex: 1 }}
        />
        {input && !loading && (
          <button
            type="button"
            onClick={clearInput}
            className="btn-small btn-ghost"
            style={{ padding: '0 8px', lineHeight: 1, fontSize: 13 }}
          >✕</button>
        )}
        <button
          className="btn-small btn-primary"
          onClick={() => doLoad(input.trim())}
          disabled={loading || !input.trim()}
        >
          {loading || sugLoading ? <span className="btn-spinner" /> : 'Add'}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: '#ff1744', marginTop: 5 }}>{error}</div>}

      {/* Dropdown */}
      {showDropdown && (sugLoading || suggestions.length > 0) && (
        <div className="search-dropdown" style={{ maxHeight: 240, zIndex: 300 }}>
          {sugLoading ? (
            <div style={{ padding: '10px 14px', color: '#555', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="btn-spinner" style={{ width: 14, height: 14 }} /> Searching…
            </div>
          ) : suggestions.length === 0 ? (
            <div style={{ padding: '10px 14px', color: '#555', fontSize: 13 }}>No channels found</div>
          ) : suggestions.map(sug => (
            <div key={sug.id} className="dropdown-item" onClick={() => handleSugClick(sug)}>
              {sug.thumbnail
                ? <img src={sug.thumbnail} alt="" className="dropdown-thumb" />
                : <div className="dropdown-thumb-placeholder">▶</div>
              }
              <div className="dropdown-item-info">
                <div className="dropdown-item-name">{sug.title}</div>
                <div className="dropdown-item-sub">
                  {sug.statistics?.subscriberCount ? formatNum(sug.statistics.subscriberCount) + ' subs' : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function CompetitorComparison({ primaryChannel, primaryVideos, tier, onUpgrade }) {
  const [slots, setSlots] = useState([
    { channel: null, videos: [] },
    { channel: null, videos: [] },
    { channel: null, videos: [] },
  ]);
  const [nicheSuggestions, setNicheSuggestions] = useState([]);
  const [nicheLoading, setNicheLoading]         = useState(false);
  const [nicheLabel, setNicheLabel]             = useState('');
  const [fillingId, setFillingId]               = useState(null);

  const setSlotData = (i, channel, videos) =>
    setSlots(s => s.map((sl, idx) => idx === i ? { channel, videos } : sl));
  const clearSlot = (i) =>
    setSlots(s => s.map((sl, idx) => idx === i ? { channel: null, videos: [] } : sl));
  const clearAll = () =>
    setSlots([{ channel: null, videos: [] }, { channel: null, videos: [] }, { channel: null, videos: [] }]);

  const STOP = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with','my','your','our',
    'i','me','we','you','he','she','it','this','that','is','are','was','be','have','has',
    'had','do','did','will','would','how','what','when','why','who','which','new','video',
    'videos','episode','ep','part','vs','ft','feat','full','live','vlog','channel','watch',
    'like','subscribe','get','make','got','just','first','can','now','best','top','most',
    'more','one','two','all','not','from','by','about','into','every','much','only','also',
    'very','so','then','than','their','there','here','been','were','they','them','these',
    'those','again','back','even','still','over','after','before','never','always','ever',
    'really','way','going','come','see','want','need','know','look','time','year','day',
    'people','thing','things','great','good','life','long','big','small','some','same',
    'challenge','funny','hindi','watch','reaction','official','music','song','songs','movie',
  ]);

  const LOW_QUALITY = /\b(shorts?|clips?|fan|edits?|highlights?|unofficial|best.?of|compilation|fanpage|fan.?page)\b/i;

  const isIndianChannel = (ch) => {
    const combined = (ch.title || '') + ' ' + (ch.description || '');
    if (/[\u0900-\u097F]/.test(combined)) return true;
    const lower = combined.toLowerCase();
    return /\b(india|indian|hindi|bollywood|bharat|desi|mumbai|delhi|bangalore|kolkata|hyderabad)\b/.test(lower);
  };

  const fetchNicheSuggestions = async (primaryCh, primaryVids) => {
    if (!primaryCh || !primaryVids?.length) return;

    const mainSubs = parseInt(primaryCh.statistics?.subscriberCount || 0);
    const subMin   = mainSubs * 0.3;
    const subMax   = mainSubs * 3;

    const text  = primaryVids.slice(0, 20).map(v => v.snippet?.title || '').join(' ').toLowerCase();
    const words = text.match(/\b[a-z]{4,}\b/g) || [];
    const freq  = {};
    words.forEach(w => { if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1; });
    const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
    if (!topWords.length) { setNicheLoading(false); return; }

    setNicheLabel(topWords.join(', '));
    setNicheLoading(true);
    setNicheSuggestions([]);

    // 3 parallel searches — one per top topic
    const results = await Promise.all(topWords.map(w => searchChannels(w, 8)));

    // Deduplicate
    const seen = new Set([primaryCh.id]);
    const all  = results.flat().filter(ch => {
      if (seen.has(ch.id)) return false;
      seen.add(ch.id);
      return true;
    });

    let filtered = all.filter(ch => {
      const subs = parseInt(ch.statistics?.subscriberCount || 0);
      const vids = parseInt(ch.statistics?.videoCount    || 0);
      if (vids < 5)                              return false;
      if (LOW_QUALITY.test(ch.title))            return false;
      if (mainSubs > 0 && subs < subMin)         return false;
      if (mainSubs > 0 && subs > subMax)         return false;
      return true;
    }).map(ch => ({ ...ch, isIndian: isIndianChannel(ch) }));

    // Sort: Indian first, then by closest subscriber count to main channel
    filtered.sort((a, b) => {
      if (a.isIndian !== b.isIndian) return a.isIndian ? -1 : 1;
      const mainS = mainSubs;
      const aDiff = Math.abs(parseInt(a.statistics?.subscriberCount || 0) - mainS);
      const bDiff = Math.abs(parseInt(b.statistics?.subscriberCount || 0) - mainS);
      return aDiff - bDiff;
    });

    setNicheSuggestions(filtered.slice(0, 5));
    setNicheLoading(false);
  };

  // Auto-run when primary channel changes
  useEffect(() => {
    fetchNicheSuggestions(primaryChannel, primaryVideos);
  }, [primaryChannel?.id]);

  const fillSuggestion = async (sug) => {
    const emptyIdx = slots.findIndex(s => !s.channel);
    if (emptyIdx === -1) return;
    setFillingId(sug.id);
    try {
      const ch  = await fetchChannel(sug.id);
      const vids = await fetchChannelVideos(ch.id, 30);
      setSlotData(emptyIdx, ch, vids);
    } catch { /* silent */ } finally {
      setFillingId(null);
    }
  };

  const filledCount = slots.filter(s => s.channel).length;

  const allChannels = [
    { label: primaryChannel?.snippet?.title || 'Your Channel', channel: primaryChannel, videos: primaryVideos, color: COLORS[0] },
    ...slots.filter(s => s.channel).map((s, i) => ({
      label: s.channel.snippet?.title, channel: s.channel, videos: s.videos, color: COLORS[i + 1],
    })),
  ].filter(c => c.channel);

  const tableData = allChannels.map(c => ({ ...buildMetrics(c.channel, c.videos), label: c.label, color: c.color }));

  // Radar data (normalized 0-100)
  const radarKeys   = ['subscribers', 'avgViews', 'engagementRate', 'uploadsPerWeek', 'avgDurationMin'];
  const radarLabels = ['Subscribers', 'Avg Views', 'Engagement', 'Upload Freq', 'Vid Length'];
  const radarMax = {};
  radarKeys.forEach(k => { radarMax[k] = Math.max(...tableData.map(t => t[k]), 0.01); });
  const radarData = radarLabels.map((label, li) => {
    const key = radarKeys[li];
    const row = { subject: label };
    tableData.forEach(t => { row[t.label] = parseFloat(((t[key] / radarMax[key]) * 100).toFixed(1)); });
    return row;
  });

  // Verdict
  const verdictScores = tableData.map(t => ({
    label: t.label, color: t.color,
    wins: radarKeys.filter(k => t[k] === Math.max(...tableData.map(x => x[k]))).length,
  })).sort((a, b) => b.wins - a.wins);
  const winner = verdictScores[0];

  // Steal their strategy
  const primaryMetrics = tableData.find(t => t.color === COLORS[0]);
  const bestCompetitor = tableData.filter(t => t.color !== COLORS[0]).sort((a, b) => b.avgViews - a.avgViews)[0];
  const stealTactics = bestCompetitor ? [
    bestCompetitor.engagementRate > (primaryMetrics?.engagementRate || 0)
      ? `Their engagement rate (${bestCompetitor.engagementRate}%) beats yours — study their CTAs, end screens, and how they ask questions in the video`
      : `You're winning on engagement — keep fostering conversation and responding to comments in the first hour after publishing`,
    bestCompetitor.uploadsPerWeek > (primaryMetrics?.uploadsPerWeek || 0)
      ? `They upload ${bestCompetitor.uploadsPerWeek}x/week vs your ${primaryMetrics?.uploadsPerWeek || 0}x — try batching 2–3 videos per session to increase output without burning out`
      : `Your upload frequency is stronger — focus on consistency over the next 90 days to compound the advantage`,
    bestCompetitor.avgViews > (primaryMetrics?.avgViews || 0)
      ? `Their videos average ${formatNum(bestCompetitor.avgViews)} views — reverse-engineer their 3 highest-viewed titles and replicate the thumbnail style and hook structure`
      : `You're winning on avg views per video — double down on whatever format your top 3 videos used and create a content series around it`,
  ] : [];

  return (
    <ProGate tier={tier} required="pro" onUpgrade={onUpgrade}>
      <div className="feature-page">
        <div className="feature-header">
          <h2 className="feature-title">⚔️ Competitor Comparison</h2>
          <p className="feature-desc">Add up to 3 competitor channels and compare side-by-side.</p>
        </div>

        {/* ── Channel selector card ── */}
        <div className="chart-card">
          <div className="chart-title-row" style={{ marginBottom: 16 }}>
            <h3 className="chart-title" style={{ marginBottom: 0 }}>Channels</h3>
            {filledCount > 0 && (
              <button
                onClick={clearAll}
                style={{
                  background: 'none', border: '1px solid #ff174433', borderRadius: 6,
                  padding: '4px 10px', fontSize: 12, fontWeight: 700,
                  color: '#ff1744', cursor: 'pointer',
                }}
              >
                Clear All
              </button>
            )}
          </div>

          {/* Slot row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
            {/* Your channel */}
            <div
              className="comp-slot primary-slot"
              style={{
                flex: '1 1 180px', margin: 5,
                boxShadow: `0 0 0 1px ${COLORS[0]}44, 0 0 18px ${COLORS[0]}15`,
              }}
            >
              <div className="comp-slot-label" style={{ color: COLORS[0] }}>Your Channel</div>
              {primaryChannel ? (
                <div className="comp-channel-info">
                  {primaryChannel.snippet?.thumbnails?.default?.url && (
                    <img src={primaryChannel.snippet.thumbnails.default.url} className="ws-avatar" alt="" />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {primaryChannel.snippet?.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                      {formatNum(primaryChannel.statistics?.subscriberCount)} subs
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#555' }}>No channel loaded</div>
              )}
            </div>

            {slots.map((slot, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <div className="comp-vs-badge">VS</div>
                <div
                  className="comp-slot"
                  style={{
                    flex: '1 1 180px', margin: 5,
                    ...(slot.channel
                      ? { boxShadow: `0 0 0 1px ${COLORS[i + 1]}44, 0 0 18px ${COLORS[i + 1]}15` }
                      : {}),
                  }}
                >
                  <div className="comp-slot-label" style={{ color: COLORS[i + 1] }}>
                    Competitor {i + 1}
                  </div>
                  {slot.channel ? (
                    <div className="comp-channel-info">
                      {slot.channel.snippet?.thumbnails?.default?.url && (
                        <img src={slot.channel.snippet.thumbnails.default.url} className="ws-avatar" alt="" />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {slot.channel.snippet?.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                          {formatNum(slot.channel.statistics?.subscriberCount)} subs
                        </div>
                      </div>
                      <button className="btn-small btn-ghost" onClick={() => clearSlot(i)}>×</button>
                    </div>
                  ) : (
                    <CompetitorSlotInput onLoad={(ch, vids) => setSlotData(i, ch, vids)} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Niche suggestions */}
          {(nicheLoading || nicheSuggestions.length > 0 || (primaryChannel && !nicheLoading)) && (
            <div style={{ marginTop: 18, borderTop: '1px solid #1a1a1a', paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Suggested Competitors in Your Niche
                </div>
                {nicheLabel && !nicheLoading && (
                  <span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}>· {nicheLabel}</span>
                )}
                {primaryChannel && !nicheLoading && (
                  <button
                    onClick={() => fetchNicheSuggestions(primaryChannel, primaryVideos)}
                    style={{
                      marginLeft: 'auto', background: 'none', border: '1px solid #2a2a2a',
                      borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700,
                      color: '#555', cursor: 'pointer',
                    }}
                  >
                    ↺ Refresh
                  </button>
                )}
              </div>

              {nicheLoading ? (
                <div style={{ color: '#555', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="btn-spinner" style={{ width: 14, height: 14 }} />
                  Searching for channels in your niche…
                </div>
              ) : nicheSuggestions.length === 0 ? (
                <div style={{ fontSize: 13, color: '#444', fontStyle: 'italic' }}>
                  Try searching manually for competitors in your niche using the input boxes above.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {nicheSuggestions.map(sug => {
                    const alreadyAdded = slots.some(s => s.channel?.id === sug.id) || primaryChannel?.id === sug.id;
                    const noSlot       = slots.every(s => s.channel);
                    const isFilling    = fillingId === sug.id;
                    const subs         = parseInt(sug.statistics?.subscriberCount || 0);
                    const isVerified   = subs >= 1_000_000;
                    return (
                      <button
                        key={sug.id}
                        onClick={() => !alreadyAdded && !noSlot && !isFilling && fillSuggestion(sug)}
                        disabled={alreadyAdded || noSlot || !!fillingId}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: '#0e0e0e', border: `1px solid ${alreadyAdded ? '#1e1e1e' : '#2a2a2a'}`,
                          borderRadius: 8, padding: '7px 11px',
                          cursor: alreadyAdded || noSlot ? 'default' : 'pointer',
                          opacity: alreadyAdded ? 0.4 : 1, transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (!alreadyAdded && !noSlot) e.currentTarget.style.background = '#1a1a1a'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#0e0e0e'; }}
                      >
                        {isFilling ? (
                          <span className="btn-spinner" style={{ width: 26, height: 26 }} />
                        ) : sug.thumbnail ? (
                          <img src={sug.thumbnail} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                        ) : null}
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: alreadyAdded ? '#444' : '#ddd', whiteSpace: 'nowrap' }}>
                              {sug.title}
                            </span>
                            {isVerified && <span title="1M+ subscribers" style={{ fontSize: 10, color: '#2196f3' }}>✔</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                            <span style={{ fontSize: 11, color: '#555' }}>{formatNum(subs)} subs</span>
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                              background: sug.isIndian ? '#ff910018' : '#2196f318',
                              color:      sug.isIndian ? '#ff9100'   : '#2196f3',
                            }}>
                              {sug.isIndian ? 'Indian' : 'Global'}
                            </span>
                          </div>
                        </div>
                        {alreadyAdded && <span style={{ fontSize: 11, color: '#555' }}>✓</span>}
                        {!alreadyAdded && !noSlot && <span style={{ fontSize: 14, color: '#444' }}>+</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {allChannels.length >= 2 ? (
          <>
            {/* Who Is Winning */}
            <div className="chart-card" style={{ borderTop: `3px solid ${winner?.color || '#fff'}` }}>
              <h3 className="chart-title">🏆 Who Is Winning</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                <div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: winner?.color || '#fff' }}>{winner?.label || '—'}</div>
                  <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>leads on {winner?.wins || 0} of {radarKeys.length} metrics</div>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {verdictScores.map(v => (
                    <div key={v.label} style={{ textAlign: 'center', background: '#111', borderRadius: 8, padding: '8px 14px', border: `1px solid ${v.color}33` }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: v.color }}>{v.wins}</div>
                      <div style={{ fontSize: 10, color: '#555' }}>{v.label?.slice(0, 14)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Radar Chart */}
            <div className="chart-card">
              <h3 className="chart-title">🕷️ Channel Radar</h3>
              <p className="chart-subtitle">All metrics normalized to 0–100 for fair comparison</p>
              <ResponsiveContainer width="100%" height={340}>
                <RadarChart data={radarData} margin={{ top: 16, right: 30, left: 30, bottom: 16 }}>
                  <PolarGrid stroke="#2a2a2a" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#aaa', fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#555', fontSize: 10 }} />
                  {allChannels.map(c => (
                    <Radar key={c.label} name={c.label} dataKey={c.label} stroke={c.color} fill={c.color} fillOpacity={0.15} strokeWidth={2} />
                  ))}
                  <Tooltip content={({ active, payload }) => active && payload?.length ? (
                    <div className="chart-tooltip">
                      {payload.map(p => (
                        <div key={p.name} className="chart-tooltip-row">
                          <span style={{ color: p.stroke }}>{p.name}:</span>
                          <span>{p.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Steal Their Best Strategy */}
            {stealTactics.length > 0 && (
              <div className="chart-card" style={{ borderTop: '3px solid #ff9100' }}>
                <h3 className="chart-title">🎯 Steal Their Best Strategy</h3>
                <p className="chart-subtitle">3 specific tactics from {bestCompetitor?.label}'s playbook</p>
                {stealTactics.map((tactic, i) => (
                  <div key={i} className="win-factor-item" style={{ cursor: 'default' }}>
                    <span className="win-factor-num">{i + 1}</span>
                    <span style={{ fontSize: 13 }}>{tactic}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Side-by-Side Table */}
            <div className="chart-card">
              <h3 className="chart-title">Side-by-Side Metrics</h3>
              <div className="table-wrap">
                <table className="video-table">
                  <thead>
                    <tr>
                      <th className="th-title">Metric</th>
                      {allChannels.map(c => (
                        <th key={c.label} className="th-num" style={{ color: c.color }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS_CONFIG.map(m => {
                      const vals = tableData.map(t => t[m.key]);
                      const max  = Math.max(...vals);
                      return (
                        <tr key={m.key} className="video-row">
                          <td style={{ padding: '10px 14px', color: '#aaa', fontSize: 13 }}>{m.label}</td>
                          {tableData.map((t, i) => (
                            <td key={i} className="td-num" style={{
                              color: t[m.key] === max ? '#00c853' : 'inherit',
                              fontWeight: t[m.key] === max ? 700 : 400,
                            }}>
                              {m.fmt(t[m.key])}
                              {t[m.key] === max && <span style={{ marginLeft: 4, fontSize: 10 }}>▲</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bar Charts */}
            {METRICS_CONFIG.slice(1, 4).map(m => (
              <div key={m.key} className="chart-card">
                <h3 className="chart-title">{m.label}</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={allChannels.map(c => ({ name: c.label?.slice(0, 20), value: buildMetrics(c.channel, c.videos)[m.key] }))}
                    margin={{ top: 8, right: 16, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 12 }} />
                    <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 11 }} width={55} />
                    <Tooltip content={<Tip />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {allChannels.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </>
        ) : (
          <div className="empty-state-card">
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚔️</div>
            <div>Add at least one competitor channel to start comparing.</div>
          </div>
        )}
      </div>
    </ProGate>
  );
}
