const BUCKETS  = ['high', 'medium', 'low', 'degraded', 'unknown'];
const LABELS   = { high: 'High', medium: 'Medium', low: 'Low', degraded: 'Degraded', unknown: 'Unknown' };

function accColor(pct) {
  if (pct == null) return '#555';
  if (pct >= 70)   return '#22c55e';
  if (pct >= 40)   return '#f59e0b';
  return '#ef4444';
}

function driftColor(rate) {
  if (rate == null) return '#555';
  if (rate > 60)    return '#ef4444';
  if (rate > 30)    return '#f59e0b';
  return '#22c55e';
}

export default function ConfidenceMatrix({ data }) {
  const hasData = data && BUCKETS.some(b => data[b]?.total > 0);

  return (
    <div style={{
      background: '#111', border: '1px solid #222', borderRadius: 8,
      padding: '14px 16px', marginBottom: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
        Confidence Reliability Matrix
      </div>

      {!hasData ? (
        <div style={{ color: '#444', fontSize: 13 }}>Not enough outcome data yet.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: '#555', borderBottom: '1px solid #222' }}>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'left' }}>Confidence</th>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'right' }}>Predictions</th>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'right' }}>Accuracy</th>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'right' }}>MAE</th>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'right' }}>Avg Actual</th>
                <th style={{ padding: '4px 10px', fontWeight: 600, textAlign: 'right' }}>Drift Rate</th>
              </tr>
            </thead>
            <tbody>
              {BUCKETS.map(b => {
                const row      = data[b] ?? {};
                const isActive = row.total > 0;
                return (
                  <tr key={b} style={{ borderBottom: '1px solid #1a1a1a', opacity: isActive ? 1 : 0.3 }}>
                    <td style={{ padding: '6px 10px', color: '#bbb', fontWeight: 600 }}>{LABELS[b]}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', color: '#888', fontFamily: 'monospace' }}>{row.total ?? 0}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: accColor(row.accurate_pct) }}>
                      {row.accurate_pct != null ? `${row.accurate_pct}%` : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: row.mae > 20 ? '#ef4444' : '#aaa' }}>
                      {row.mae != null ? row.mae.toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#666' }}>
                      {row.avg_actual != null ? row.avg_actual.toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', color: driftColor(row.drift_rate) }}>
                      {row.drift_rate != null ? `${row.drift_rate}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
