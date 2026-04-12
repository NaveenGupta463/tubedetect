import { useState, useRef, useEffect } from 'react';
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Line, ReferenceLine,
} from 'recharts';
import { formatNum, calcEngagement, parseDuration } from '../utils/analysis';
import { fetchChannel, fetchChannelVideos, searchChannels } from '../api/youtube';
import VideoList from './VideoList';
import TITooltip from './Tooltip';

const STAT_TIPS = {
  'Subscribers':      'Total number of people subscribed to this channel.',
  'Total Views':      'Cumulative views across all videos ever uploaded.',
  'Videos':           'Total number of public videos on this channel.',
  'Avg Views/Video':  'Total views divided by number of videos — shows the typical reach per upload.',
  'Avg Engagement':   'Average of (likes + comments) ÷ views across the top 5 videos, expressed as a percentage. Above 3% is strong.',
  'Avg Like Rate':    'Average likes ÷ views across top videos. Shows how much the audience appreciates the content.',
  'Upload Frequency': 'How often this channel posts, calculated from recent video publish dates.',
  'Channel Age':      'How long this channel has been active since its first video.',
};

function StatCard({ label, value, sub, color }) {
  const tip = STAT_TIPS[label];
  const card = (
    <div className="stat-card" style={tip ? { cursor: 'default' } : {}}>
      <div className="stat-value" style={color ? { color } : {}}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
  if (!tip) return card;
  return (
    <TITooltip title={label} desc={tip} placement="top">
      {card}
    </TITooltip>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        {payload.map(p => (
          <div key={p.name} className="chart-tooltip-row">
            <span style={{ color: p.fill || p.color }}>{p.name}:</span>
            <span>{p.value?.toLocaleString()}{p.name === 'Engagement %' ? '%' : ''}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

function EngagementTrendChart({ sortedByDate, avgEngagement, avgDaysBetween, cadenceLabel, onVideoSelect, competitors }) {
  const [range, setRange]               = useState('20');
  const [showComp, setShowComp]         = useState(false);
  const [compInput, setCompInput]       = useState('');
  const [compLoading, setCompLoading]   = useState(false);
  const [compError, setCompError]       = useState('');
  const [localComp, setLocalComp]       = useState(null); // { channel, videos }
  const [compSugs, setCompSugs]         = useState([]);
  const [compSugLoading, setCompSugLoading] = useState(false);
  const [showCompDrop, setShowCompDrop] = useState(false);
  const compDebounce  = useRef(null);
  const compContainer = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (compContainer.current && !compContainer.current.contains(e.target)) {
        setShowCompDrop(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Debounced autocomplete
  useEffect(() => {
    if (compDebounce.current) clearTimeout(compDebounce.current);
    const q = compInput.trim();
    if (q.length < 4) { setCompSugs([]); setCompSugLoading(false); return; }
    setCompSugLoading(true);
    compDebounce.current = setTimeout(async () => {
      const results = await searchChannels(q, 5);
      setCompSugs(results);
      setCompSugLoading(false);
      if (results.length > 0) setShowCompDrop(true);
    }, 800);
    return () => clearTimeout(compDebounce.current);
  }, [compInput]);

  const maxRange    = range === 'all' ? sortedByDate.length : parseInt(range);
  const sourceVids  = sortedByDate.slice(0, Math.min(maxRange, sortedByDate.length)).reverse();

  const chartData = sourceVids.map((v, i) => {
    const prev    = sourceVids[i - 1];
    const gapDays = (prev && v.snippet?.publishedAt && prev.snippet?.publishedAt)
      ? Math.abs(new Date(v.snippet.publishedAt) - new Date(prev.snippet.publishedAt)) / 86400000
      : 0;
    const eng = parseFloat(calcEngagement(v.statistics).toFixed(2));
    return {
      name:        `#${i + 1}`,
      eng,
      views:       parseInt(v.statistics?.viewCount  || 0),

      gap:         gapDays,
      aboveAvg:    eng >= avgEngagement,
      video:       v,
    };
  });

  // Use prop competitor first, fall back to locally added one
  const activeComp   = competitors?.[0] || localComp;
  const compVideos   = activeComp?.videos;
  const compTrend    = compVideos
    ? [...compVideos]
        .sort((a, b) => new Date(a.snippet?.publishedAt || 0) - new Date(b.snippet?.publishedAt || 0))
        .slice(-maxRange)
        .map(v => parseFloat(calcEngagement(v.statistics).toFixed(2)))
    : [];
  const mergedData = chartData.map((d, i) => ({
    ...d,
    compEng: compTrend[i] ?? null,
  }));

  const loadCompetitor = async (query) => {
    setCompLoading(true);
    setCompError('');
    setShowCompDrop(false);
    try {
      const ch   = await fetchChannel(query);
      const vids = await fetchChannelVideos(ch.id, 30);
      setLocalComp({ channel: ch, videos: vids });
      setCompInput('');
      setCompSugs([]);
    } catch {
      setCompError(`Can't find that channel. Try the exact @handle.`);
    } finally {
      setCompLoading(false);
    }
  };

  const handleAddCompetitor = () => {
    const q = compInput.trim();
    if (q) loadCompetitor(q);
  };

  // Annotations
  let maxIdx = 0, minIdx = 0;
  chartData.forEach((d, i) => {
    if (d.eng > chartData[maxIdx].eng) maxIdx = i;
    if (d.eng < chartData[minIdx].eng) minIdx = i;
  });
  const gapPoints  = chartData.filter((d, i) => i > 0 && d.gap > 14);

  // Custom dot per point
  const renderDot = (props) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const color  = payload.aboveAvg ? '#00c853' : '#ff1744';
    const isMax  = index === maxIdx;
    const isMin  = index === minIdx && chartData.length > 1;
    const r      = isMax || isMin ? 6 : 4;
    return (
      <g key={`dot-${index}`} style={{ cursor: 'pointer' }}>
        <circle cx={cx} cy={cy} r={r} fill={color} stroke="#0d0d0d" strokeWidth={1.5} />
        {isMax && <text x={cx} y={cy - 14} textAnchor="middle" fontSize={13}>🔥</text>}
        {isMin && !isMax && <text x={cx} y={cy - 14} textAnchor="middle" fontSize={13}>⚠️</text>}
      </g>
    );
  };

  // Rich tooltip
  const EngTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d?.video) return null;
    const v       = d.video;
    const thumb   = v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url;
    const title   = v.snippet?.title || '';
    const dur     = parseDuration(v.contentDetails?.duration).formatted;
    const dateStr = v.snippet?.publishedAt
      ? new Date(v.snippet.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const engColor = d.eng >= 4 ? '#00c853' : d.eng >= 2 ? '#ff9100' : '#ff1744';
    return (
      <div style={{
        background: '#111', border: '1px solid #2a2a2a', borderRadius: 10,
        padding: 12, width: 230, boxShadow: '0 8px 28px rgba(0,0,0,0.8)', pointerEvents: 'none',
      }}>
        {thumb && (
          <img src={thumb} alt="" style={{ width: '100%', height: 52, objectFit: 'cover', borderRadius: 6, marginBottom: 8, display: 'block' }} />
        )}
        <div style={{
          fontSize: 12, fontWeight: 600, color: '#ddd', lineHeight: 1.4, marginBottom: 8,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{title}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: '#555' }}>Engagement</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: engColor }}>{d.eng}%</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: '#555' }}>Views</span>
          <span style={{ fontSize: 12, color: '#aaa' }}>{formatNum(d.views)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: '#555' }}>Duration</span>
          <span style={{ fontSize: 12, color: '#aaa' }}>{dur}</span>
        </div>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>{dateStr}</div>
        <div style={{ fontSize: 10, color: '#444', textAlign: 'center', borderTop: '1px solid #1a1a1a', paddingTop: 6 }}>
          Click point to analyze this video
        </div>
      </div>
    );
  };

  const hasCompData  = compTrend.length > 0;
  const compName     = activeComp?.channel?.snippet?.title || 'Competitor';
  const compAvgEng   = hasCompData
    ? parseFloat((compTrend.reduce((s, v) => s + v, 0) / compTrend.length).toFixed(2))
    : null;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: '#555', marginRight: 2 }}>Range:</span>
        {[['5','Last 5'],['10','Last 10'],['20','Last 20'],['all','All']].map(([v, lbl]) => (
          <button key={v} onClick={() => setRange(v)} style={{
            background: range === v ? '#7c4dff22' : 'none',
            border: `1px solid ${range === v ? '#7c4dff' : '#2a2a2a'}`,
            borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700,
            color: range === v ? '#7c4dff' : '#555', cursor: 'pointer', transition: 'all 0.15s',
          }}>{lbl}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>

          <button
            onClick={() => setShowComp(s => !s)}
            style={{
              background: showComp ? '#2196f322' : 'none',
              border: `1px solid ${showComp ? '#2196f3' : '#2a2a2a'}`,
              borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700,
              color: showComp ? '#2196f3' : '#555', cursor: 'pointer',
            }}
          >
            {showComp ? '✓ ' : ''}vs Competitor {hasCompData ? `(${compName})` : ''}
          </button>
          {showComp && hasCompData && (
            <button
              onClick={() => { setLocalComp(null); }}
              style={{
                background: 'none', border: '1px solid #2a2a2a',
                borderRadius: 6, padding: '3px 9px', fontSize: 11,
                color: '#555', cursor: 'pointer',
              }}
            >✕ Remove</button>
          )}
        </div>
      </div>

      {/* Competitor search panel */}
      {showComp && !hasCompData && (
        <div style={{ background: '#0d0d0d', border: '1px solid #2196f333', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2196f3', marginBottom: 8 }}>Add a competitor channel to compare engagement</div>
          <div ref={compContainer} style={{ position: 'relative', display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                value={compInput}
                onChange={e => { setCompInput(e.target.value); setCompError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAddCompetitor()}
                onFocus={() => { if (compSugs.length > 0) setShowCompDrop(true); }}
                placeholder="@handle or channel name…"
                autoComplete="off"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#111', border: '1px solid #2a2a2a', borderRadius: 6,
                  padding: '6px 10px', fontSize: 12, color: '#ddd', outline: 'none',
                }}
              />
              {/* Autocomplete dropdown */}
              {showCompDrop && (compSugLoading || compSugs.length > 0) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                  background: '#161616', border: '1px solid #2a2a2a', borderRadius: 8,
                  marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                }}>
                  {compSugLoading ? (
                    <div style={{ padding: '10px 14px', fontSize: 12, color: '#555' }}>Searching…</div>
                  ) : compSugs.map(sug => (
                    <div
                      key={sug.id}
                      onMouseDown={e => { e.preventDefault(); setCompInput(sug.title); loadCompetitor(sug.id); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1e1e1e'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {sug.thumbnail
                        ? <img src={sug.thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sug.title}</div>
                        <div style={{ fontSize: 11, color: '#555' }}>
                          {sug.statistics?.subscriberCount ? formatNum(sug.statistics.subscriberCount) + ' subs' : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleAddCompetitor}
              disabled={compLoading || !compInput.trim()}
              style={{
                background: '#2196f3', border: 'none', borderRadius: 6,
                padding: '6px 14px', fontSize: 12, fontWeight: 700,
                color: '#fff', cursor: compLoading ? 'wait' : 'pointer',
                opacity: !compInput.trim() ? 0.5 : 1, flexShrink: 0,
              }}
            >
              {compLoading ? '…' : 'Add'}
            </button>
          </div>
          {compError && <div style={{ fontSize: 11, color: '#ff1744', marginTop: 6 }}>{compError}</div>}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#555', marginBottom: 8, flexWrap: 'wrap' }}>
        <span>🔥 Highest eng.</span>
        <span>⚠️ Lowest eng.</span>
        <span style={{ color: '#00c853' }}>● Above avg</span>
        <span style={{ color: '#ff1744' }}>● Below avg</span>
        {gapPoints.length > 0 && <span>┊ Upload gap &gt;2wk</span>}
        {showComp && hasCompData && <span style={{ color: '#2196f3' }}>– – {compName}</span>}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart
          data={mergedData}
          margin={{ top: 18, right: 58, left: 0, bottom: 0 }}
          style={{ cursor: 'crosshair' }}
          onClick={e => {
            const v = e?.activePayload?.[0]?.payload?.video;
            if (v && onVideoSelect) onVideoSelect(v);
          }}
        >
          <defs>
            <linearGradient id="viewsBg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c4dff" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#7c4dff" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
          <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 12 }} />

          {/* Left axis: engagement */}
          <YAxis
            yAxisId="eng"
            tickFormatter={v => v + '%'}
            tick={{ fill: '#888', fontSize: 12 }}
            width={42}
            label={{ value: 'Eng %', angle: -90, position: 'insideLeft', fill: '#666', fontSize: 11, dy: 24 }}
          />
          {/* Right axis: views */}
          <YAxis
            yAxisId="views"
            orientation="right"
            tickFormatter={v => formatNum(v)}
            tick={{ fill: '#888', fontSize: 12 }}
            width={52}
            label={{ value: 'Views', angle: 90, position: 'insideRight', fill: '#666', fontSize: 11, dy: -20 }}
          />


          {/* Views bars (background) */}
          <Bar yAxisId="views" dataKey="views" fill="url(#viewsBg)" stroke="#7c4dff18" radius={[2, 2, 0, 0]} isAnimationActive={false} />


          {/* Upload gap markers */}
          {gapPoints.map((d, i) => (
            <ReferenceLine key={`gap-${i}`} yAxisId="eng" x={d.name}
              stroke="#2a2a2a" strokeDasharray="4 4"
              label={{ value: 'Gap', position: 'insideTopLeft', fill: '#444', fontSize: 8 }}
            />
          ))}

          {/* Channel average line */}
          <ReferenceLine
            yAxisId="eng"
            y={parseFloat(avgEngagement.toFixed(2))}
            stroke="#ff9100"
            strokeDasharray="6 3"
            strokeWidth={1.5}
            label={{ value: `Avg ${avgEngagement.toFixed(2)}%`, position: 'right', fill: '#ff9100', fontSize: 9, dx: 4 }}
          />

          {/* Competitor average line */}
          {showComp && compAvgEng !== null && (
            <ReferenceLine
              yAxisId="eng"
              y={compAvgEng}
              stroke="#2196f3"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `${compName.split(' ')[0]} avg ${compAvgEng}%`, position: 'right', fill: '#2196f3', fontSize: 9, dx: 4 }}
            />
          )}

          {/* Engagement line */}
          <Line
            yAxisId="eng"
            type="monotone"
            dataKey="eng"
            stroke="#666"
            strokeWidth={2}
            dot={renderDot}
            activeDot={{ r: 7, fill: '#7c4dff', stroke: '#111', strokeWidth: 2, cursor: 'pointer' }}
            isAnimationActive={true}
          />

          {/* Competitor overlay */}
          {showComp && hasCompData && (
            <Line
              yAxisId="eng"
              type="monotone"
              dataKey="compEng"
              stroke="#2196f3"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

          <Tooltip content={<EngTooltip />} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Avg engagement comparison row */}
      {showComp && compAvgEng !== null && (
        <div style={{
          marginTop: 10, background: '#0c0c0c', border: '1px solid #1a1a1a',
          borderRadius: 8, padding: '10px 16px', display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>⚡ Avg Engagement</span>
          <span style={{ fontSize: 13, color: '#888' }}>
            This channel: <strong style={{ color: '#ff9100', fontSize: 15 }}>{avgEngagement.toFixed(2)}%</strong>
          </span>
          <span style={{ fontSize: 13, color: '#888' }}>
            {compName}: <strong style={{ color: '#2196f3', fontSize: 15 }}>{compAvgEng}%</strong>
          </span>
          <span style={{ fontSize: 12, color: compAvgEng > avgEngagement ? '#ff1744' : '#00c853', flex: 1 }}>
            {compAvgEng > avgEngagement
              ? `${compName.split(' ')[0]} has ${(compAvgEng - avgEngagement).toFixed(2)}% higher engagement`
              : `You lead by ${(avgEngagement - compAvgEng).toFixed(2)}%`}
          </span>
        </div>
      )}

      {/* Upload gap insight */}
      {avgDaysBetween > 0 && (
        <div style={{
          marginTop: 10, background: '#0c0c0c', border: '1px solid #1a1a1a',
          borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <div>
            <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>📅 Upload Insight</span>
          </div>
          <span style={{ fontSize: 12, color: '#888' }}>
            Avg gap: <strong style={{ color: '#fff' }}>{Math.round(avgDaysBetween)}d</strong>
          </span>
          <span style={{ fontSize: 12, color: '#888' }}>
            Cadence: <strong style={{ color: '#fff' }}>{cadenceLabel}</strong>
          </span>
          <span style={{ fontSize: 12, color: '#666', flex: 1 }}>
            {avgDaysBetween > 21
              ? 'Longer gaps tend to hurt algorithmic momentum — try uploading at least bi-weekly'
              : avgDaysBetween < 4
              ? 'Very high frequency — monitor engagement quality vs quantity trade-off'
              : 'Solid cadence — consistency compounds over time, keep this rhythm'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function ChannelOverview({ channel, videos, onVideoSelect, competitors }) {
  const [selectedPattern, setSelectedPattern] = useState(null);
  const stats = channel?.statistics || {};
  const snippet = channel?.snippet || {};

  const totalViews = videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0);
  const avgEngagement = videos.length
    ? videos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / videos.length
    : 0;

  const top10 = [...videos]
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, 10);

  const viewsChartData = top10.map((v, i) => ({
    name: `#${i + 1}`,
    title: v.snippet?.title || '',
    Views: parseInt(v.statistics?.viewCount || 0),
    video: v,
  }));

  const engChartData = top10.map((v, i) => ({
    name: `#${i + 1}`,
    title: v.snippet?.title || '',
    'Engagement %': parseFloat(calcEngagement(v.statistics).toFixed(3)),
    video: v,
  }));

  // Custom label rendered inside each bar — rotated title text
  const renderBarLabel = ({ x, y, width, height, value }) => {
    if (!value || height < 24) return null;
    const truncated = value.length > 40 ? value.slice(0, 38) + '…' : value;
    const cx = x + width / 2;
    const cy = y + height - 8;
    return (
      <text
        x={cx} y={cy}
        transform={`rotate(-90, ${cx}, ${cy})`}
        textAnchor="start"
        fontSize={9}
        fill="rgba(255,255,255,0.55)"
        style={{ pointerEvents: 'none' }}
      >
        {truncated}
      </text>
    );
  };

  const engBarColors = engChartData.map(d =>
    d['Engagement %'] > 4 ? '#00c853' :
    d['Engagement %'] > 2 ? '#ff9100' : '#ff1744'
  );

  // Channel Health Dashboard data
  const sortedByDate = [...videos].sort((a, b) => new Date(b.snippet?.publishedAt || 0) - new Date(a.snippet?.publishedAt || 0));
  const recent10 = sortedByDate.slice(0, Math.min(10, sortedByDate.length));
  const prev10   = sortedByDate.slice(Math.min(10, sortedByDate.length), Math.min(20, sortedByDate.length));
  const recentAvg = recent10.length ? recent10.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0) / recent10.length : 0;
  const prevAvg   = prev10.length   ? prev10.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0) / prev10.length   : 0;
  const growthPct = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100) : 0;
  const momentum  = growthPct > 10 ? 'Growing' : growthPct > -10 ? 'Plateauing' : 'Declining';
  const momentumColor = momentum === 'Growing' ? '#00c853' : momentum === 'Plateauing' ? '#ff9100' : '#ff1744';
  const momentumIcon  = momentum === 'Growing' ? '📈' : momentum === 'Plateauing' ? '➡️' : '📉';

  const sortedByViews = [...videos].sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0));
  const bestVideo  = sortedByViews[0];
  const worstVideo = sortedByViews[sortedByViews.length - 1];

  let avgDaysBetween = 0;
  if (sortedByDate.length >= 2) {
    let totalGap = 0;
    for (let i = 0; i < sortedByDate.length - 1; i++) {
      const d1 = new Date(sortedByDate[i].snippet?.publishedAt || 0);
      const d2 = new Date(sortedByDate[i + 1].snippet?.publishedAt || 0);
      totalGap += Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
    }
    avgDaysBetween = totalGap / (sortedByDate.length - 1);
  }
  const cadenceLabel = avgDaysBetween < 4 ? 'Daily+' : avgDaysBetween < 9 ? 'Weekly' : avgDaysBetween < 18 ? 'Bi-weekly' : avgDaysBetween < 35 ? 'Monthly' : 'Infrequent';

  // (engTrend is now handled inside EngagementTrendChart)

  // Title Pattern & Upload Day analysis
  function categorizeTitle(t) {
    if (!t) return 'Other';
    if (/\?/.test(t)) return 'Question';
    if (/^(how|why|what|when|where|who)\b/i.test(t)) return 'How-to';
    if (/\b\d+\s*(ways|tips|things|tricks|steps|reasons|mistakes|facts)\b/i.test(t) || /^\d+[\s\W]/.test(t)) return 'List';
    if (/\b(never|secret|shocking|surprising|exposed|truth|brutally|unbelievable|incredible)\b/i.test(t)) return 'Shock';
    return 'Other';
  }
  const patternMap = {};
  videos.forEach(v => {
    const cat = categorizeTitle(v.snippet?.title);
    if (!patternMap[cat]) patternMap[cat] = { count: 0, total: 0 };
    patternMap[cat].count++;
    patternMap[cat].total += parseInt(v.statistics?.viewCount || 0);
  });
  const patternData = Object.entries(patternMap)
    .map(([name, d]) => ({ name, avgViews: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avgViews - a.avgViews);
  const patternColors = { Question: '#7c4dff', 'How-to': '#2196f3', List: '#ff9100', Shock: '#ff1744', Other: '#555' };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayStats = {};
  videos.forEach(v => {
    if (!v.snippet?.publishedAt) return;
    const day = new Date(v.snippet.publishedAt).getDay();
    if (!dayStats[day]) dayStats[day] = { total: 0, count: 0 };
    dayStats[day].total += parseInt(v.statistics?.viewCount || 0);
    dayStats[day].count++;
  });
  const uploadDayData = dayNames.map((name, i) => ({
    name,
    avgViews: dayStats[i] ? Math.round(dayStats[i].total / dayStats[i].count) : 0,
    uploads: dayStats[i]?.count || 0,
  }));
  const maxDayViews = Math.max(...uploadDayData.map(d => d.avgViews), 1);

  return (
    <div className="overview-page">
      {/* Channel Header */}
      <div className="channel-header">
        {snippet.thumbnails?.high?.url && (
          <img src={snippet.thumbnails.high.url} alt={snippet.title} className="channel-avatar" />
        )}
        <div className="channel-info">
          <h2 className="channel-name">{snippet.title}</h2>
          {snippet.customUrl && (
            <a
              href={`https://youtube.com/${snippet.customUrl}`}
              target="_blank"
              rel="noreferrer"
              className="channel-handle"
            >
              {snippet.customUrl}
            </a>
          )}
          <p className="channel-desc">
            {snippet.description?.slice(0, 160)}{snippet.description?.length > 160 ? '…' : ''}
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-row">
        <StatCard
          label="Subscribers"
          value={stats.hiddenSubscriberCount ? 'Hidden' : formatNum(stats.subscriberCount)}
          sub="total"
        />
        <StatCard
          label="Total Views (loaded)"
          value={formatNum(totalViews)}
          sub={`across ${videos.length} videos`}
        />
        <StatCard
          label="Videos Loaded"
          value={videos.length}
          sub={`of ${formatNum(stats.videoCount)} total`}
        />
        <StatCard
          label="Avg Engagement"
          value={avgEngagement.toFixed(2) + '%'}
          sub="likes + comments / views"
          color={avgEngagement > 3 ? '#00c853' : avgEngagement > 1.5 ? '#ff9100' : '#ff1744'}
        />
      </div>

      {/* Channel Health Dashboard */}
      <div className="chart-card">
        <div className="chart-title-row">
          <h3 className="chart-title">🏥 Channel Health Dashboard</h3>
          <span style={{
            fontSize: 13, fontWeight: 700, padding: '4px 14px', borderRadius: 20,
            background: momentumColor + '22', color: momentumColor, border: `1px solid ${momentumColor}44`,
          }}>
            {momentumIcon} {momentum}
          </span>
        </div>
        <p className="chart-subtitle">Based on last {recent10.length} vs previous {prev10.length} videos</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '14px 0' }}>
          {/* Views Trend card */}
          <TITooltip
            title="Views Trend"
            desc={`Compares average views of your last ${recent10.length} videos (${formatNum(Math.round(recentAvg))}/video) vs the ${prev10.length} before that (${formatNum(Math.round(prevAvg))}/video). Positive = your recent videos are performing better.`}
            placement="bottom"
          >
            <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center', border: `1px solid ${momentumColor}33`, cursor: 'default' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: momentumColor }}>
                {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Views Trend</div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 10, color: '#555' }}>Last {recent10.length}: <span style={{ color: '#bbb' }}>{formatNum(Math.round(recentAvg))}</span></span>
                <span style={{ fontSize: 10, color: '#333' }}>|</span>
                <span style={{ fontSize: 10, color: '#555' }}>Prev {prev10.length}: <span style={{ color: '#bbb' }}>{formatNum(Math.round(prevAvg))}</span></span>
              </div>
            </div>
          </TITooltip>

          {/* Upload Cadence card */}
          <TITooltip
            title="Upload Cadence"
            desc={`Daily+ = posting every 1–3 days. Weekly = every 4–8 days. Bi-weekly = every 9–17 days. Monthly = every 18–34 days. Infrequent = 35+ days between uploads. Consistent cadence signals the algorithm to recommend your content more.`}
            placement="bottom"
          >
            <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center', cursor: 'default' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{cadenceLabel}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Upload Cadence</div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>~{Math.round(avgDaysBetween)}d avg between videos</div>
            </div>
          </TITooltip>

          {/* Avg Engagement card */}
          <TITooltip
            title="Avg Engagement Rate"
            desc="(Likes + Comments) ÷ Views × 100, averaged across all loaded videos. Above 3% is strong. Industry average is 1–2%."
            placement="bottom"
          >
            <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center', cursor: 'default' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#ff9100' }}>{avgEngagement.toFixed(2)}%</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Avg Engagement Rate</div>
              <div style={{ fontSize: 10, color: avgEngagement > 3 ? '#00c853' : avgEngagement > 1.5 ? '#ff9100' : '#ff1744', marginTop: 6 }}>
                {avgEngagement > 3 ? 'Excellent' : avgEngagement > 1.5 ? 'Average' : 'Below average'}
              </div>
            </div>
          </TITooltip>
        </div>

        <div className="two-col-grid" style={{ marginTop: 0 }}>
          {bestVideo && (
            <div
              onClick={() => onVideoSelect(bestVideo)}
              style={{ background: '#0a1a0a', border: '1px solid #00c85333', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#00c853aa'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#00c85333'}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🏆 Best Performer — click to analyze</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.4, marginBottom: 4 }}>
                {bestVideo.snippet?.title?.slice(0, 60)}{bestVideo.snippet?.title?.length > 60 ? '…' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#00c853' }}>{formatNum(bestVideo.statistics?.viewCount)} views</div>
            </div>
          )}
          {worstVideo && worstVideo !== bestVideo && (
            <div
              onClick={() => onVideoSelect(worstVideo)}
              style={{ background: '#1a0a0a', border: '1px solid #ff174433', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#ff1744aa'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#ff174433'}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ff1744', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>📉 Needs Work — click to analyze</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.4, marginBottom: 4 }}>
                {worstVideo.snippet?.title?.slice(0, 60)}{worstVideo.snippet?.title?.length > 60 ? '…' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#ff1744' }}>{formatNum(worstVideo.statistics?.viewCount)} views</div>
            </div>
          )}
        </div>

        {sortedByDate.length > 3 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#bbb', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              📈 Engagement Trend
              <span style={{ fontSize: 11, fontWeight: 400, color: '#555' }}>— click any point to open video analysis</span>
            </div>
            <EngagementTrendChart
              sortedByDate={sortedByDate}
              avgEngagement={avgEngagement}
              avgDaysBetween={avgDaysBetween}
              cadenceLabel={cadenceLabel}
              onVideoSelect={onVideoSelect}
              competitors={competitors}
            />
          </div>
        )}
      </div>

      {/* Charts Section */}
      <div className="charts-section">
        <div className="chart-card">
          <h3 className="chart-title">Top 10 Videos by Views</h3>
          <p className="chart-subtitle">Click any bar to open video analysis</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={viewsChartData}
              margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              style={{ cursor: 'pointer' }}
              onClick={e => {
                const v = e?.activePayload?.[0]?.payload?.video;
                if (v && onVideoSelect) onVideoSelect(v);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
              <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 13 }} />
              <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 12 }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Views" radius={[4, 4, 0, 0]} label={{ content: props => renderBarLabel({ ...props, value: viewsChartData[props.index]?.title }) }}>
                {viewsChartData.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#ff0000' : '#cc3333'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Engagement Rate — Top 10 Videos</h3>
          <p className="chart-subtitle">Green &gt;4% · Orange 2–4% · Red &lt;2% · Click any bar to analyze</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={engChartData}
              margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
              style={{ cursor: 'pointer' }}
              onClick={e => {
                const v = e?.activePayload?.[0]?.payload?.video;
                if (v && onVideoSelect) onVideoSelect(v);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
              <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 13 }} />
              <YAxis tickFormatter={v => v + '%'} tick={{ fill: '#888', fontSize: 12 }} width={50} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Engagement %" radius={[4, 4, 0, 0]} label={{ content: props => renderBarLabel({ ...props, value: engChartData[props.index]?.title }) }}>
                {engChartData.map((_, i) => (
                  <Cell key={i} fill={engBarColors[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Title & Upload Pattern Tracker */}
      <div className="two-col-grid">
        <div className="chart-card">
          <TITooltip
            title="Title Pattern Performance"
            desc="Videos are grouped by their title style — Question (ends with ?), How-to (starts with How/Why/What), List (starts with a number), Shock (uses dramatic words), or Other. The bar shows the average views for each group, so you can see which title style performs best on this channel."
            placement="top"
          >
            <h3 className="chart-title" style={{ cursor: 'default' }}>✍️ Title Pattern Performance</h3>
          </TITooltip>
          <p className="chart-subtitle">Avg views by title style — click a tab to browse its videos</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={patternData} layout="vertical" margin={{ top: 4, right: 16, left: 55, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" horizontal={false} />
              <XAxis type="number" tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#aaa', fontSize: 12 }} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="avgViews" name="Avg Views" radius={[0, 4, 4, 0]}>
                {patternData.map((entry, i) => (
                  <Cell key={i} fill={patternColors[entry.name] || '#555'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Clickable category tabs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {patternData.map(d => {
              const color = patternColors[d.name] || '#555';
              const active = selectedPattern === d.name;
              return (
                <button
                  key={d.name}
                  onClick={() => setSelectedPattern(active ? null : d.name)}
                  style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 4, border: 'none',
                    cursor: 'pointer', color: active ? '#fff' : color,
                    background: active ? color : color + '22',
                    fontWeight: active ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {d.name} ({d.count} videos)
                </button>
              );
            })}
          </div>

          {/* Video list for selected pattern */}
          {selectedPattern && (() => {
            const filtered = videos.filter(v => categorizeTitle(v.snippet?.title) === selectedPattern);
            const color = patternColors[selectedPattern] || '#555';
            return (
              <div style={{ marginTop: 12, border: `1px solid ${color}33`, borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ background: color + '18', padding: '6px 12px', fontSize: 11, fontWeight: 700, color, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{selectedPattern} — {filtered.length} videos</span>
                  <button onClick={() => setSelectedPattern(null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {filtered.map(v => (
                    <div
                      key={v.id}
                      onClick={() => onVideoSelect(v)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', cursor: 'pointer',
                        borderBottom: '1px solid #1a1a1a',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#1a1a1a'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {v.snippet?.thumbnails?.default?.url && (
                        <img src={v.snippet.thumbnails.default.url} alt="" style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {v.snippet?.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                          {formatNum(v.statistics?.viewCount || 0)} views
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="chart-card">
          <h3 className="chart-title">📅 Best Upload Day</h3>
          <p className="chart-subtitle">Avg views by publish day of week</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={uploadDayData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 12 }} />
              <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 10 }} width={45} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="avgViews" name="Avg Views" radius={[4, 4, 0, 0]}>
                {uploadDayData.map((entry, i) => (
                  <Cell key={i} fill={entry.avgViews === maxDayViews && entry.uploads > 0 ? '#00c853' : entry.uploads > 0 ? '#444' : '#222'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
            Green = best performing day · Grey = days with uploads · Dark = no uploads yet
          </div>
        </div>
      </div>

      {/* Video Table */}
      <div className="section">
        <h3 className="section-title">All Videos — Click any row to analyze</h3>
        <VideoList videos={videos} onVideoSelect={onVideoSelect} />
      </div>
    </div>
  );
}
