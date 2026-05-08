import { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell, Legend,
} from 'recharts';

const EMPTY = 'Not enough outcome data yet.';

const BAND_META = {
  accurate:               { label: 'Accurate',     color: '#22c55e' },
  slight_overprediction:  { label: 'Slight Over',  color: '#f59e0b' },
  large_overprediction:   { label: 'Large Over',   color: '#ef4444' },
  slight_underprediction: { label: 'Slight Under', color: '#60a5fa' },
  large_underprediction:  { label: 'Large Under',  color: '#a78bfa' },
};

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 8,
      padding: '12px 16px', flex: 1, minWidth: 110,
    }}>
      <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color || '#ccc', fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

const ttStyle = { background: '#111', border: '1px solid #333', borderRadius: 6, fontSize: 12 };

export default function CalibrationDashboard({ calibrationData, health }) {
  const [timeWindow, setTimeWindow] = useState('30d');

  const hasTimeline = calibrationData?.timeline?.length > 0;
  const hasDist     = calibrationData?.distribution?.total > 0;
  const hasErrors   = calibrationData?.recentErrors?.length > 0;

  const days = timeWindow === '7d' ? 7 : timeWindow === '30d' ? 30 : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filteredTimeline = hasTimeline
    ? calibrationData.timeline.filter(r => r.date >= cutoffStr)
    : [];

  const distData = Object.entries(BAND_META).map(([k, m]) => ({
    band: m.label, count: calibrationData?.distribution?.[k] ?? 0, color: m.color,
  })).filter(d => d.count > 0);

  const statusColor = health?.status === 'critical' ? '#ef4444'
    : health?.status === 'warning' ? '#f59e0b' : '#22c55e';
  const biasColor   = health?.biasDirection === 'overprediction' ? '#f59e0b'
    : health?.biasDirection === 'underprediction' ? '#60a5fa' : '#22c55e';

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
        Calibration Dashboard
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <StatCard label="System Health"  value={health?.status       ?? '—'}                                  color={statusColor} />
        <StatCard label="MAE"            value={health?.mae          != null ? health.mae.toFixed(1)          : '—'} color={health?.mae > 20 ? '#ef4444' : '#ccc'} />
        <StatCard label="Accurate Rate"  value={health?.accurateRate != null ? `${health.accurateRate}%`      : '—'} color={health?.accurateRate >= 70 ? '#22c55e' : '#f59e0b'} />
        <StatCard label="Bias"           value={health?.biasDirection ?? '—'}                                  color={biasColor} />
        <StatCard label="Data Points"    value={health?.datapoints   ?? 0}                                    color="#666" />
      </div>

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8 }}>MAE &amp; Accuracy Timeline</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {['7d', '30d', '90d'].map(w => (
              <button key={w} onClick={() => setTimeWindow(w)} style={{
                padding: '2px 10px', borderRadius: 4, border: '1px solid',
                borderColor: timeWindow === w ? '#7c4dff' : '#2a2a2a',
                background:  timeWindow === w ? '#7c4dff22' : 'transparent',
                color:       timeWindow === w ? '#a78bfa' : '#555',
                fontSize: 11, cursor: 'pointer',
              }}>{w}</button>
            ))}
          </div>
        </div>
        {filteredTimeline.length === 0 ? (
          <div style={{ color: '#444', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>{EMPTY}</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={filteredTimeline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#555' }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: '#555' }} domain={[0, 'auto']} />
              <Tooltip contentStyle={ttStyle} labelStyle={{ color: '#888' }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              <Line type="monotone" dataKey="mae"          name="MAE"        stroke="#ef4444" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="accurate_pct" name="Accurate %" stroke="#22c55e" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Calibration Distribution</div>
        {!hasDist ? (
          <div style={{ color: '#444', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>{EMPTY}</div>
        ) : (
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={distData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
              <XAxis dataKey="band" tick={{ fontSize: 10, fill: '#555' }} />
              <YAxis tick={{ fontSize: 10, fill: '#555' }} allowDecimals={false} />
              <Tooltip contentStyle={ttStyle} />
              <Bar dataKey="count" name="Predictions">
                {distData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Recent Prediction Errors</div>
        {!hasErrors ? (
          <div style={{ color: '#444', fontSize: 13 }}>{EMPTY}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#555', borderBottom: '1px solid #222' }}>
                  {['Title', 'Niche', 'Error', 'Band', 'Pred', 'Actual'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', fontWeight: 600, textAlign: h === 'Title' || h === 'Niche' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calibrationData.recentErrors.map((e, i) => {
                  const ec = e.calibration_band?.includes('large') ? '#ef4444'
                    : e.calibration_band?.includes('slight') ? '#f59e0b' : '#22c55e';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a', color: '#aaa' }}>
                      <td style={{ padding: '5px 8px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.title}>{e.title ?? '—'}</td>
                      <td style={{ padding: '5px 8px', color: '#666' }}>{e.niche}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: ec, fontFamily: 'monospace' }}>{e.calibration_error?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555', fontSize: 11 }}>{e.calibration_band ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{e.predicted_score?.toFixed(1) ?? '—'}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{e.actual_performance_score?.toFixed(1) ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
