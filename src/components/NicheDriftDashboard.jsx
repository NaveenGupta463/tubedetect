import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

const SEV_COLOR = { healthy: '#22c55e', warning: '#f59e0b', critical: '#ef4444' };
const DIR_COLOR = { overprediction: '#f59e0b', underprediction: '#60a5fa', neutral: '#555' };

function SevBadge({ severity }) {
  const c = SEV_COLOR[severity] ?? '#555';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
      background: c + '22', color: c, border: `1px solid ${c}44`,
    }}>{severity}</span>
  );
}

const ttStyle = { background: '#111', border: '1px solid #333', borderRadius: 6, fontSize: 12 };

export default function NicheDriftDashboard({ data }) {
  const hasNiches = data?.niches?.length > 0;
  const s = data?.summary ?? {};

  const chartData = hasNiches
    ? data.niches.slice(0, 10).map(n => ({ niche: n.niche, mae: n.mae, sev: n.severity }))
    : [];

  const summaryItems = [
    { label: 'Niches Tracked',   value: s.totalNiches   ?? 0 },
    { label: 'Stability',        value: s.calibrationStability      != null ? `${s.calibrationStability}%`      : '—' },
    { label: 'Volatility Index', value: s.volatilityIndex           != null ? s.volatilityIndex.toFixed(1)       : '—' },
    { label: 'Over Rate',        value: s.overpredictionRatio       != null ? `${s.overpredictionRatio}%`       : '—' },
    { label: 'Under Rate',       value: s.underpredictionRatio      != null ? `${s.underpredictionRatio}%`      : '—' },
    { label: 'Degradation Rate', value: s.confidenceDegradationRate != null ? `${s.confidenceDegradationRate}%` : '—' },
  ];

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
        Niche Drift Dashboard
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {summaryItems.map(({ label, value }) => (
          <div key={label} style={{
            background: '#111', border: '1px solid #222', borderRadius: 7,
            padding: '8px 12px', flex: 1, minWidth: 100,
          }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ccc', fontFamily: 'monospace', marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {!hasNiches ? (
        <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '24px 16px', color: '#444', fontSize: 13, textAlign: 'center' }}>
          Not enough outcome data yet.
        </div>
      ) : (
        <>
          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>MAE by Niche (top 10)</div>
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 28)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#555' }} domain={[0, 'auto']} />
                <YAxis type="category" dataKey="niche" tick={{ fontSize: 10, fill: '#666' }} width={88} />
                <Tooltip contentStyle={ttStyle} formatter={v => [v.toFixed(1), 'MAE']} />
                <Bar dataKey="mae" name="MAE">
                  {chartData.map((d, i) => <Cell key={i} fill={SEV_COLOR[d.sev] ?? '#7c4dff'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>Niche Detail</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#555', borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'left' }}>Niche</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Preds</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>MAE</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Avg Error</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Direction</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.niches.map((n, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ padding: '5px 8px', color: '#aaa', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.niche}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{n.count}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: SEV_COLOR[n.severity] ?? '#ccc' }}>{n.mae.toFixed(1)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: 'monospace', color: n.avg_error > 0 ? '#f59e0b' : n.avg_error < 0 ? '#60a5fa' : '#555' }}>
                        {n.avg_error > 0 ? '+' : ''}{n.avg_error.toFixed(1)}
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontSize: 11, color: DIR_COLOR[n.drift_direction] ?? '#555' }}>{n.drift_direction}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right' }}><SevBadge severity={n.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
