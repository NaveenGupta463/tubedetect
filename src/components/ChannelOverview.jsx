import { useState } from 'react';
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Line, ReferenceLine, AreaChart, Area,
} from 'recharts';
import { formatNum, calcEngagement, parseDuration } from '../utils/analysis';
import VideoList from './VideoList';

function StatCard({ label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div className="stat-value" style={color ? { color } : {}}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
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
  const [showDuration, setShowDuration] = useState(false);
  const [showComp, setShowComp]         = useState(false);

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
      durationMin: parseFloat((parseDuration(v.contentDetails?.duration).total / 60).toFixed(1)),
      gap:         gapDays,
      aboveAvg:    eng >= avgEngagement,
      video:       v,
    };
  });

  // Competitor overlay data (aligned by position)
  const compVideos = competitors?.[0]?.videos;
  const compTrend  = compVideos
    ? [...compVideos]
        .sort((a, b) => new Date(a.snippet?.publishedAt || 0) - new Date(b.snippet?.publishedAt || 0))
        .slice(-maxRange)
        .map(v => parseFloat(calcEngagement(v.statistics).toFixed(2)))
    : [];
  const mergedData = chartData.map((d, i) => ({
    ...d,
    compEng: compTrend[i] ?? null,
  }));

  // Annotations
  let maxIdx = 0, minIdx = 0;
  chartData.forEach((d, i) => {
    if (d.eng > chartData[maxIdx].eng) maxIdx = i;
    if (d.eng < chartData[minIdx].eng) minIdx = i;
  });
  const gapPoints  = chartData.filter((d, i) => i > 0 && d.gap > 14);
  const maxDurMin  = Math.max(...chartData.map(d => d.durationMin), 1);

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

  const hasCompData = compTrend.length > 0;
  const compName    = competitors?.[0]?.channel?.snippet?.title || 'Competitor';

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
          <button onClick={() => setShowDuration(s => !s)} style={{
            background: showDuration ? '#2196f322' : 'none',
            border: `1px solid ${showDuration ? '#2196f3' : '#2a2a2a'}`,
            borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700,
            color: showDuration ? '#2196f3' : '#555', cursor: 'pointer',
          }}>
            {showDuration ? '✓ ' : ''}Duration
          </button>
          <button
            onClick={() => setShowComp(s => !s)}
            title={!hasCompData ? 'Load a saved workspace with a competitor to enable' : ''}
            style={{
              background: showComp && hasCompData ? '#2196f322' : 'none',
              border: `1px solid ${showComp && hasCompData ? '#2196f3' : '#2a2a2a'}`,
              borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700,
              color: showComp && hasCompData ? '#2196f3' : '#555',
              cursor: hasCompData ? 'pointer' : 'default', opacity: hasCompData ? 1 : 0.4,
            }}
          >
            {showComp && hasCompData ? '✓ ' : ''}vs Competitor
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#555', marginBottom: 8, flexWrap: 'wrap' }}>
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

          <CartesianGrid strokeDasharray="3 3" stroke="#181818" />
          <XAxis dataKey="name" tick={{ fill: '#444', fontSize: 10 }} />

          {/* Left axis: engagement */}
          <YAxis
            yAxisId="eng"
            tickFormatter={v => v + '%'}
            tick={{ fill: '#555', fontSize: 10 }}
            width={34}
            label={{ value: 'Eng %', angle: -90, position: 'insideLeft', fill: '#444', fontSize: 9, dy: 20 }}
          />
          {/* Right axis: views */}
          <YAxis
            yAxisId="views"
            orientation="right"
            tickFormatter={v => formatNum(v)}
            tick={{ fill: '#555', fontSize: 10 }}
            width={46}
            label={{ value: 'Views', angle: 90, position: 'insideRight', fill: '#444', fontSize: 9, dy: -16 }}
          />
          {/* Hidden axis for duration bars */}
          {showDuration && (
            <YAxis yAxisId="dur" hide domain={[0, maxDurMin * 5]} />
          )}

          {/* Views bars (background) */}
          <Bar yAxisId="views" dataKey="views" fill="url(#viewsBg)" stroke="#7c4dff18" radius={[2, 2, 0, 0]} isAnimationActive={false} />

          {/* Duration bars (optional overlay) */}
          {showDuration && (
            <Bar yAxisId="dur" dataKey="durationMin" fill="#2196f310" stroke="#2196f320" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          )}

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
  const stats = channel?.statistics || {};
  const snippet = channel?.snippet || {};

  const totalViews = videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0);
  const avgEngagement = videos.length
    ? videos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / videos.length
    : 0;

  const top10 = [...videos]
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, 10);

  const viewsChartData = top10.map(v => ({
    name: v.snippet?.title?.slice(0, 28) + (v.snippet?.title?.length > 28 ? '…' : ''),
    Views: parseInt(v.statistics?.viewCount || 0),
    id: v.id,
  }));

  const engChartData = top10.map(v => ({
    name: v.snippet?.title?.slice(0, 28) + (v.snippet?.title?.length > 28 ? '…' : ''),
    'Engagement %': parseFloat(calcEngagement(v.statistics).toFixed(3)),
    id: v.id,
  }));

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
          <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center', border: `1px solid ${momentumColor}33` }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: momentumColor }}>
              {growthPct >= 0 ? '+' : ''}{growthPct.toFixed(1)}%
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Views Trend (last 10 vs prev 10)</div>
          </div>
          <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fff' }}>{cadenceLabel}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Upload Cadence (~{Math.round(avgDaysBetween)}d avg)</div>
          </div>
          <div style={{ background: '#111', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#ff9100' }}>{avgEngagement.toFixed(2)}%</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Avg Engagement Rate</div>
          </div>
        </div>

        <div className="two-col-grid" style={{ marginTop: 0 }}>
          {bestVideo && (
            <div style={{ background: '#0a1a0a', border: '1px solid #00c85333', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>🏆 Best Performer</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.4, marginBottom: 4 }}>
                {bestVideo.snippet?.title?.slice(0, 60)}{bestVideo.snippet?.title?.length > 60 ? '…' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#00c853' }}>{formatNum(bestVideo.statistics?.viewCount)} views</div>
            </div>
          )}
          {worstVideo && worstVideo !== bestVideo && (
            <div style={{ background: '#1a0a0a', border: '1px solid #ff174433', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ff1744', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>📉 Needs Work</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', lineHeight: 1.4, marginBottom: 4 }}>
                {worstVideo.snippet?.title?.slice(0, 60)}{worstVideo.snippet?.title?.length > 60 ? '…' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#ff1744' }}>{formatNum(worstVideo.statistics?.viewCount)} views</div>
            </div>
          )}
        </div>

        {sortedByDate.length > 3 && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 2 }}>
              Engagement trend — click any point to open video analysis
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
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={viewsChartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#888', fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={v => formatNum(v)}
                tick={{ fill: '#888', fontSize: 11 }}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Views" fill="#ff0000" radius={[4, 4, 0, 0]}>
                {viewsChartData.map((entry, i) => (
                  <Cell key={i} fill={i === 0 ? '#ff0000' : '#cc3333'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Engagement Rate — Top 10 Videos</h3>
          <p className="chart-subtitle">Green &gt;4% · Orange 2–4% · Red &lt;2%</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={engChartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#888', fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis
                tickFormatter={v => v + '%'}
                tick={{ fill: '#888', fontSize: 11 }}
                width={50}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="Engagement %" radius={[4, 4, 0, 0]}>
                {engChartData.map((entry, i) => (
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
          <h3 className="chart-title">✍️ Title Pattern Performance</h3>
          <p className="chart-subtitle">Avg views by title type across all loaded videos</p>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {patternData.map(d => (
              <span key={d.name} style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 4,
                color: patternColors[d.name] || '#555',
                background: (patternColors[d.name] || '#555') + '18',
              }}>
                {d.name} ({d.count} videos)
              </span>
            ))}
          </div>
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
