import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import { formatNum } from '../utils/analysis';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDay(d, opts) {
  return d.toLocaleDateString('en-US', opts);
}

function dayKey(d) {
  // "YYYY-MM-DD" key in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// ── Tooltip: Upload Frequency ─────────────────────────────────────────────────
function FreqTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 270 }}>
      <div className="chart-tooltip-label">{d.dateLabel}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#ff6666' }}>Videos uploaded:</span>
        <span style={{ fontWeight: 700 }}>{d.videosUploaded}</span>
      </div>
      {d.videoTitles.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#888', lineHeight: 1.65 }}>
          {d.videoTitles.slice(0, 3).map((t, i) => (
            <div key={i}>• {t.length > 54 ? t.slice(0, 54) + '…' : t}</div>
          ))}
          {d.videoTitles.length > 3 && (
            <div style={{ color: '#555' }}>+{d.videoTitles.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tooltip: Avg Views ────────────────────────────────────────────────────────
function ViewsTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d || d.videosUploaded === 0) return null;
  return (
    <div className="chart-tooltip" style={{ maxWidth: 270 }}>
      <div className="chart-tooltip-label">{d.dateLabel}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#ff9100' }}>Avg views:</span>
        <span style={{ fontWeight: 700 }}>{formatNum(d.avgViews)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#aaa' }}>Videos:</span>
        <span>{d.videosUploaded}</span>
      </div>
      {d.videoTitles.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#888', lineHeight: 1.65 }}>
          {d.videoTitles.slice(0, 3).map((t, i) => (
            <div key={i}>• {t.length > 54 ? t.slice(0, 54) + '…' : t}</div>
          ))}
          {d.videoTitles.length > 3 && (
            <div style={{ color: '#555' }}>+{d.videoTitles.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Video Dot Markers ────────────────────────────────────────────────────────
function VideoMarkers({ days, showThumbs }) {
  const [hovered, setHovered] = useState(null);
  const total = days.length;
  const hasAny = days.some(d => d.videosUploaded > 0);
  if (!hasAny) return null;

  return (
    <div style={{ position: 'relative', height: showThumbs ? 48 : 20, marginTop: 2, marginLeft: 30 }}>
      <div style={{ position: 'absolute', top: showThumbs ? 12 : 9, left: 0, right: 8, height: 1, background: '#1a1a1a' }} />
      {days.map((day, i) => {
        if (!day.videosUploaded) return null;
        const leftPct = ((i) / (total - 1)) * 100;
        const isHov = hovered === i;

        if (showThumbs && day.thumbnails?.length) {
          return (
            <div
              key={i}
              style={{ position: 'absolute', left: `${leftPct}%`, transform: 'translateX(-50%)', top: 0, zIndex: isHov ? 30 : 10 }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{
                width: 26, height: 18, borderRadius: 3, overflow: 'hidden',
                border: `2px solid ${day.videosUploaded > 1 ? '#ff0000' : '#660000'}`,
                cursor: 'default',
                transform: isHov ? 'scale(1.3) translateY(-3px)' : 'scale(1)',
                transition: 'transform 0.15s ease',
              }}>
                <img src={day.thumbnails[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
              {isHov && (
                <div style={{
                  position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)',
                  background: '#111', border: '1px solid #2a2a2a', borderRadius: 8,
                  padding: '8px 10px', width: 210,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.7)', pointerEvents: 'none', zIndex: 40,
                }}>
                  {day.thumbnails.slice(0, 2).map((t, ti) => (
                    <div key={ti} style={{ display: 'flex', gap: 7, marginBottom: ti < Math.min(day.thumbnails.length, 2) - 1 ? 7 : 0 }}>
                      <img src={t.url} alt="" style={{ width: 38, height: 26, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: '#ddd', fontWeight: 600, lineHeight: 1.3, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(t.title || '').slice(0, 36)}{(t.title?.length ?? 0) > 36 ? '…' : ''}
                        </div>
                        <div style={{ fontSize: 10, color: '#666' }}>{formatNum(t.views)} views</div>
                      </div>
                    </div>
                  ))}
                  {day.thumbnails.length > 2 && (
                    <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>+{day.thumbnails.length - 2} more</div>
                  )}
                  <div style={{ fontSize: 10, color: '#444', marginTop: 5, borderTop: '1px solid #1a1a1a', paddingTop: 4 }}>
                    {day.dateLabel}
                  </div>
                </div>
              )}
            </div>
          );
        }

        // Dot fallback
        return (
          <div
            key={i}
            title={`${day.dateLabel} — ${day.videosUploaded} video${day.videosUploaded > 1 ? 's' : ''}`}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              transform: 'translateX(-50%)',
              top: 4,
              width: day.videosUploaded > 1 ? 9 : 6,
              height: day.videosUploaded > 1 ? 9 : 6,
              borderRadius: '50%',
              background: day.videosUploaded > 1 ? '#ff0000' : '#660000',
            }}
          />
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function UploadCadenceTracker({ videos }) {
  const { days, stats, insight, overallAvgViews } = useMemo(() => {
    const empty = { days: [], stats: null, insight: null, overallAvgViews: 0 };
    if (!videos?.length) return empty;

    // ── Build exactly 60 daily buckets: day[0] = today-59, day[59] = today ──
    const today = startOfDay(new Date());
    const MS_DAY = 24 * 3600 * 1000;

    const buckets = Array.from({ length: 60 }, (_, i) => {
      const date = new Date(today.getTime() - (59 - i) * MS_DAY);
      return {
        date,
        dateKey:       dayKey(date),
        dateLabel:     fmtDay(date, { month: 'short', day: 'numeric', year: 'numeric' }),
        // X-axis label: show on day 0, every 10th day, and day 59
        xLabel:        (i === 0 || i % 10 === 0 || i === 59)
                         ? fmtDay(date, { month: 'short', day: 'numeric' })
                         : '',
        videosUploaded: 0,
        videoTitles:    [],
        totalViews:     0,
        avgViews:       0,
        thumbnails:     [],
      };
    });

    // Index buckets by dateKey for O(1) lookup
    const bucketMap = {};
    buckets.forEach((b, i) => { bucketMap[b.dateKey] = i; });

    // Place each video in its bucket
    videos.forEach(v => {
      const pub = v.snippet?.publishedAt;
      if (!pub) return;
      const d  = startOfDay(new Date(pub));
      const key = dayKey(d);
      const idx = bucketMap[key];
      if (idx == null) return; // outside the 60-day window

      const b = buckets[idx];
      b.videosUploaded++;
      const views = parseInt(v.statistics?.viewCount || 0);
      b.totalViews += views;
      b.videoTitles.push(v.snippet.title || 'Untitled');

      const thumbUrl = v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url;
      if (thumbUrl) {
        b.thumbnails.push({ url: thumbUrl, title: v.snippet.title || 'Untitled', views });
      }
    });

    // Compute avgViews per day
    buckets.forEach(b => {
      b.avgViews = b.videosUploaded > 0 ? Math.round(b.totalViews / b.videosUploaded) : 0;
    });

    // Overall avg views (active days only)
    const activeDays = buckets.filter(b => b.videosUploaded > 0);
    const overallAvgViews = activeDays.length
      ? Math.round(activeDays.reduce((s, b) => s + b.avgViews, 0) / activeDays.length)
      : 0;

    // ── Stats ─────────────────────────────────────────────────────────────────
    const totalUploads  = buckets.reduce((s, b) => s + b.videosUploaded, 0);
    const uploadedDays  = activeDays.length;
    const avgPerWeek    = ((totalUploads / 60) * 7).toFixed(1);

    // Current streak (consecutive days with uploads from today backwards)
    let currentStreak = 0;
    for (let i = 59; i >= 0; i--) {
      if (buckets[i].videosUploaded > 0) currentStreak++;
      else break;
    }

    // Longest streak
    let longestStreak = 0, tempStreak = 0;
    buckets.forEach(b => {
      if (b.videosUploaded > 0) { tempStreak++; if (tempStreak > longestStreak) longestStreak = tempStreak; }
      else tempStreak = 0;
    });

    // Days since last upload
    let daysSinceLast = null;
    for (let i = 59; i >= 0; i--) {
      if (buckets[i].videosUploaded > 0) {
        daysSinceLast = 59 - i;
        break;
      }
    }

    const stats = { avgPerWeek, totalUploads, uploadedDays, currentStreak, longestStreak, daysSinceLast };

    // ── Frequency correlation ─────────────────────────────────────────────────
    const single = activeDays.filter(b => b.videosUploaded === 1);
    const multi  = activeDays.filter(b => b.videosUploaded >= 2);
    const avg1x  = single.length ? Math.round(single.reduce((s, b) => s + b.avgViews, 0) / single.length) : 0;
    const avg2x  = multi.length  ? Math.round(multi.reduce((s,  b) => s + b.avgViews, 0) / multi.length)  : 0;

    let freqInsight = null;
    if (avg1x > 0 && avg2x > 0) {
      const pct = Math.round((Math.abs(avg2x - avg1x) / avg1x) * 100);
      freqInsight = avg2x > avg1x
        ? `Videos perform ${pct}% better on days you upload 2+ videos vs 1.`
        : `Single-upload days get ${pct}% more views on average — quality over quantity is working.`;
    } else if (avg1x > 0 && multi.length === 0) {
      freqInsight = 'No days with 2+ uploads in this period. Try doubling up to compare performance.';
    }

    const insight = { freqInsight, avg1x, avg2x };

    return { days: buckets, stats, insight, overallAvgViews };
  }, [videos]);

  if (!videos?.length) return <div className="empty-state">Load a channel first.</div>;

  const showThumbs = videos.length <= 20;

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">📅 Upload Cadence Tracker</h2>
        <p className="feature-desc">Last 60 days — daily upload frequency and view performance.</p>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="insight-summary-row">
          {[
            { label: 'Uploads (60d)',    value: stats.totalUploads,       color: '#ff9100' },
            { label: 'Avg / Week',       value: stats.avgPerWeek + 'x',   color: '#ff9100' },
            { label: 'Current Streak',   value: `${stats.currentStreak}d`, color: '#00c853' },
            {
              label: 'Days Since Upload',
              value: stats.daysSinceLast == null ? 'None'
                   : stats.daysSinceLast === 0   ? 'Today'
                   : stats.daysSinceLast === 1   ? '1 day'
                   : `${stats.daysSinceLast}d`,
              color: stats.daysSinceLast == null || stats.daysSinceLast > 14 ? '#ff1744'
                   : stats.daysSinceLast > 7 ? '#ff9100' : '#00c853',
            },
          ].map(s => (
            <div key={s.label} className="insight-summary-card" style={{ borderColor: s.color }}>
              <div className="iscard-value" style={{ color: s.color }}>{s.value}</div>
              <div className="iscard-label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart 1: Upload Frequency ── */}
      <div className="chart-card">
        <h3 className="chart-title">Uploads Per Day — Last 60 Days</h3>
        <p className="chart-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#1e1e1e', border: '1px solid #333', borderRadius: 2 }} />
            No upload
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#660000', borderRadius: 2 }} />
            1 upload
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ff0000', borderRadius: 2 }} />
            2+ uploads
          </span>
        </p>

        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="8%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="xLabel"
              tick={{ fill: '#666', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tick={{ fill: '#666', fontSize: 10 }}
              width={22}
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<FreqTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar dataKey="videosUploaded" radius={[2, 2, 0, 0]} minPointSize={2}>
              {days.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.videosUploaded === 0 ? '#1a1a1a' : d.videosUploaded === 1 ? '#660000' : '#ff0000'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <VideoMarkers days={days} showThumbs={showThumbs} />
      </div>

      {/* ── Chart 2: Avg Views Per Day ── */}
      <div className="chart-card">
        <h3 className="chart-title">Avg Views Per Video by Day — Last 60 Days</h3>
        <p className="chart-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#00c853', borderRadius: 2 }} />
            Above channel avg
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ff9100', borderRadius: 2 }} />
            Below channel avg
          </span>
          {overallAvgViews > 0 && (
            <span style={{ color: '#444', fontSize: 11 }}>
              · 60-day avg: <strong style={{ color: '#555' }}>{formatNum(overallAvgViews)}</strong> views/video
            </span>
          )}
        </p>

        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="8%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="xLabel"
              tick={{ fill: '#666', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <YAxis
              tickFormatter={v => formatNum(v)}
              tick={{ fill: '#666', fontSize: 10 }}
              width={48}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<ViewsTip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            {overallAvgViews > 0 && (
              <ReferenceLine
                y={overallAvgViews}
                stroke="#2a2a2a"
                strokeDasharray="5 4"
                label={{ value: 'avg', position: 'insideTopRight', fill: '#444', fontSize: 10 }}
              />
            )}
            <Bar dataKey="avgViews" radius={[2, 2, 0, 0]} minPointSize={0}>
              {days.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.videosUploaded === 0 ? 'transparent' : d.avgViews >= overallAvgViews ? '#00c853' : '#ff9100'}
                  fillOpacity={d.videosUploaded === 0 ? 0 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Insights ── */}
      <div className="chart-card">
        <h3 className="chart-title">Cadence Insights</h3>
        <div className="cadence-insights">

          {insight?.freqInsight && (
            <div className="cadence-insight-row" style={{ color: '#aaa' }}>
              <span>📊</span>
              <span>{insight.freqInsight}</span>
            </div>
          )}

          {stats?.longestStreak > 0 && (
            <div className="cadence-insight-row" style={{ color: '#aaa' }}>
              <span>🏆</span>
              <span>
                Longest consecutive upload streak in the last 60 days:{' '}
                <strong style={{ color: '#2196f3' }}>{stats.longestStreak} day{stats.longestStreak > 1 ? 's' : ''}</strong>.
              </span>
            </div>
          )}

          {(stats?.currentStreak ?? 0) > 0 ? (
            <div className="cadence-insight-row good">
              <span>🔥</span>
              <span>
                Current streak: <strong style={{ color: '#00c853' }}>{stats.currentStreak} day{stats.currentStreak > 1 ? 's' : ''}</strong> — keep it going!
              </span>
            </div>
          ) : (
            <div className="cadence-insight-row bad">
              <span>⚠️</span>
              <span>No active upload streak. Post a video today to start one!</span>
            </div>
          )}

          {stats?.daysSinceLast != null && (
            <div className={`cadence-insight-row ${stats.daysSinceLast > 14 ? 'bad' : stats.daysSinceLast > 7 ? 'warn' : 'good'}`}>
              <span>{stats.daysSinceLast > 14 ? '🔴' : stats.daysSinceLast > 7 ? '⚠️' : '✅'}</span>
              <span>
                Last upload was{' '}
                <strong>
                  {stats.daysSinceLast === 0 ? 'today'
                   : stats.daysSinceLast === 1 ? 'yesterday'
                   : `${stats.daysSinceLast} days ago`}
                </strong>.
                {stats.daysSinceLast > 14 ? ' Long gaps hurt subscriber retention and algorithm visibility.' : ''}
              </span>
            </div>
          )}

          {stats?.daysSinceLast == null && (
            <div className="cadence-insight-row bad">
              <span>📭</span>
              <span>No uploads in the last 60 days. Start uploading to build momentum!</span>
            </div>
          )}

          {parseFloat(stats?.avgPerWeek ?? 0) >= 3 && (
            <div className="cadence-insight-row good">
              <span>✅</span>
              <span>
                <strong style={{ color: '#00c853' }}>{stats.avgPerWeek}x/week</strong> — excellent cadence. The algorithm strongly rewards active channels.
              </span>
            </div>
          )}

          {parseFloat(stats?.avgPerWeek ?? 0) < 0.5 && stats?.daysSinceLast != null && (
            <div className="cadence-insight-row bad">
              <span>📉</span>
              <span>
                Only <strong>{stats.avgPerWeek}</strong> uploads/week over the last 60 days. Consistent uploading is the #1 driver of channel growth.
              </span>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
