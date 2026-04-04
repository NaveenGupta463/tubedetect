import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatNum } from '../utils/analysis';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function BestTimeToPost({ videos }) {
  const { dayData, hourData, heatmap, bestDay, bestHour, bestDayIdx, bestHourIdx } = useMemo(() => {
    const dayBuckets  = Array.from({ length: 7  }, () => ({ views: 0, count: 0 }));
    const hourBuckets = Array.from({ length: 24 }, () => ({ views: 0, count: 0 }));
    const matrix      = Array.from({ length: 7  }, () => Array.from({ length: 24 }, () => ({ views: 0, count: 0 })));

    videos.forEach(v => {
      const d = new Date(v.snippet?.publishedAt);
      if (isNaN(d)) return;
      const day  = d.getUTCDay();
      const hour = d.getUTCHours();
      const views = parseInt(v.statistics?.viewCount || 0);
      dayBuckets[day].views  += views; dayBuckets[day].count++;
      hourBuckets[hour].views += views; hourBuckets[hour].count++;
      matrix[day][hour].views += views; matrix[day][hour].count++;
    });

    const avg = b => b.count > 0 ? b.views / b.count : 0;

    const dayData  = DAYS.map((name, i) => ({ name, avgViews: Math.round(avg(dayBuckets[i])), count: dayBuckets[i].count }));
    const hourData = Array.from({ length: 24 }, (_, h) => ({
      name: `${h.toString().padStart(2,'0')}:00`,
      avgViews: Math.round(avg(hourBuckets[h])),
      count: hourBuckets[h].count,
    }));
    const heatmap = matrix.map((row, d) => row.map((cell, h) => ({ day: d, hour: h, avgViews: Math.round(avg(cell)), count: cell.count })));

    const bestDayIdx  = dayData.reduce((bi, d, i, a) => d.avgViews > a[bi].avgViews ? i : bi, 0);
    const bestHourIdx = hourData.reduce((bi, d, i, a) => d.avgViews > a[bi].avgViews ? i : bi, 0);
    const bestDay     = DAYS[bestDayIdx];
    const bestHour    = `${bestHourIdx.toString().padStart(2, '0')}:00 UTC`;

    return { dayData, hourData, heatmap, bestDay, bestHour, bestDayIdx, bestHourIdx };
  }, [videos]);

  const maxHeatVal = Math.max(...heatmap.flat().map(c => c.avgViews), 1);

  const Tip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-label">{label}</div>
        <div className="chart-tooltip-row"><span>Avg Views:</span><span>{formatNum(payload[0].value)}</span></div>
        <div className="chart-tooltip-row"><span>Videos:</span><span>{payload[0]?.payload?.count || 0}</span></div>
      </div>
    );
  };

  if (!videos.length) {
    return <div className="empty-state">Load a channel first to see timing data.</div>;
  }

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">⏰ Best Time to Post</h2>
        <p className="feature-desc">
          Average views by publish day and hour across your last {videos.length} videos.
          <span className="tip-badge">Times in UTC</span>
        </p>
      </div>

      {/* Best Time Summary */}
      <div className="insight-summary-row">
        <div className="insight-summary-card" style={{ borderColor: '#00c853' }}>
          <div className="iscard-icon">📅</div>
          <div>
            <div className="iscard-label">Best Day</div>
            <div className="iscard-value" style={{ color: '#00c853' }}>{bestDay}</div>
            <div className="iscard-sub">{formatNum(dayData[bestDayIdx]?.avgViews)} avg views</div>
          </div>
        </div>
        <div className="insight-summary-card" style={{ borderColor: '#2196f3' }}>
          <div className="iscard-icon">🕐</div>
          <div>
            <div className="iscard-label">Best Hour (UTC)</div>
            <div className="iscard-value" style={{ color: '#2196f3' }}>{bestHour}</div>
            <div className="iscard-sub">{formatNum(hourData[bestHourIdx]?.avgViews)} avg views</div>
          </div>
        </div>
        <div className="insight-summary-card" style={{ borderColor: '#ff9100' }}>
          <div className="iscard-icon">🎯</div>
          <div>
            <div className="iscard-label">Sweet Spot</div>
            <div className="iscard-value" style={{ color: '#ff9100' }}>{bestDay} {bestHour}</div>
            <div className="iscard-sub">Recommended upload window</div>
          </div>
        </div>
      </div>

      {/* Day Chart */}
      <div className="chart-card">
        <h3 className="chart-title">Avg Views by Day of Week</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dayData} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis dataKey="name" tick={{ fill: '#aaa', fontSize: 12 }} />
            <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 11 }} width={55} />
            <Tooltip content={<Tip />} />
            <Bar dataKey="avgViews" radius={[4,4,0,0]}>
              {dayData.map((_, i) => (
                <Cell key={i} fill={i === bestDayIdx ? '#00c853' : '#cc3333'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Hour Chart */}
      <div className="chart-card">
        <h3 className="chart-title">Avg Views by Hour (UTC)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hourData} margin={{ top: 8, right: 16, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
            <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 9 }} interval={1} angle={-45} textAnchor="end" height={40} />
            <YAxis tickFormatter={v => formatNum(v)} tick={{ fill: '#888', fontSize: 11 }} width={55} />
            <Tooltip content={<Tip />} />
            <Bar dataKey="avgViews" radius={[3,3,0,0]}>
              {hourData.map((_, i) => (
                <Cell key={i} fill={i === bestHourIdx ? '#2196f3' : '#333'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Heatmap */}
      <div className="chart-card">
        <h3 className="chart-title">Day × Hour Heatmap</h3>
        <p className="chart-subtitle">Darker red = higher avg views. White = no uploads at that time.</p>
        <div className="heatmap-wrap">
          {/* Hour labels */}
          <div className="heatmap-hour-row">
            <div className="heatmap-day-label" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="heatmap-hour-label">
                {h % 3 === 0 ? `${h}h` : ''}
              </div>
            ))}
          </div>
          {heatmap.map((row, d) => (
            <div key={d} className="heatmap-row">
              <div className="heatmap-day-label">{DAYS[d]}</div>
              {row.map((cell, h) => {
                const opacity = cell.count > 0 ? 0.15 + (cell.avgViews / maxHeatVal) * 0.85 : 0;
                const isBest = d === bestDayIdx && h === bestHourIdx;
                return (
                  <div
                    key={h}
                    className={`heatmap-cell ${isBest ? 'heatmap-cell-best' : ''}`}
                    style={{ background: cell.count > 0 ? `rgba(255,0,0,${opacity})` : 'transparent' }}
                    title={cell.count > 0 ? `${DAYS[d]} ${h}:00 UTC — ${formatNum(cell.avgViews)} avg views (${cell.count} video${cell.count > 1 ? 's' : ''})` : ''}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
