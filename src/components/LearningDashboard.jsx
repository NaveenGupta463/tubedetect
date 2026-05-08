import { useState, useEffect, useCallback } from 'react';
import { ROUTES } from '../config';

const REFRESH_MS = 60_000;

const HEALTH_COLOR = {
  stable:            '#22c55e',
  learning:          '#60a5fa',
  warning:           '#f59e0b',
  insufficient_data: '#555',
};

const SEV_COLOR = { critical: '#ef4444', warning: '#f59e0b', low: '#60a5fa' };

const ISSUE_LABELS = {
  systematic_overprediction:  'Overprediction Bias',
  systematic_underprediction: 'Underprediction Bias',
  persistent_overprediction:  'Persistent Overprediction',
  persistent_underprediction: 'Persistent Underprediction',
  volatile:                   'Volatile Predictions',
  unstable_accuracy:          'Unstable Accuracy',
  confidence_mismatch:        'Confidence Mismatch',
  degraded_mode_failures:     'Degraded Mode Failures',
  systematic_overprediction_pattern: 'Systematic Overprediction',
  high_confidence_misses:     'High-Confidence Misses',
  hook_type_overrated:        'Hook Type Overrated',
  hook_type_underrated:       'Hook Type Underrated',
};

const CONF_LABELS = {
  high: 'High', medium: 'Medium', low: 'Low', degraded: 'Degraded', unknown: 'Unknown',
};
const EXPECTED = { high: '80%', medium: '60%', low: '40%', degraded: '30%', unknown: '—' };

// ── Sub-components ─────────────────────────────────────────────────────────────

function AdvisoryBadge() {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
      background: '#78350f33', color: '#fbbf24', border: '1px solid #78350f66',
    }}>
      SUGGESTED — NOT APPLIED
    </span>
  );
}

function SevBadge({ severity }) {
  const c = SEV_COLOR[severity] ?? '#666';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
      background: c + '22', color: c, border: `1px solid ${c}44`,
    }}>{severity}</span>
  );
}

function ConfBar({ value }) {
  const pct = value != null ? Math.round(value * 100) : 0;
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', minWidth: 30 }}>{pct}%</span>
    </div>
  );
}

function RecCard({ rec }) {
  const issueLabel = ISSUE_LABELS[rec.issue ?? rec.pattern] ?? (rec.issue ?? rec.pattern ?? rec.type);
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 8,
      padding: '12px 16px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {rec.niche && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', background: '#a78bfa11', border: '1px solid #a78bfa33', borderRadius: 4, padding: '1px 7px' }}>
              {rec.niche}
            </span>
          )}
          {rec.hook_type && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', background: '#60a5fa11', border: '1px solid #60a5fa33', borderRadius: 4, padding: '1px 7px' }}>
              {rec.hook_type}
            </span>
          )}
          <span style={{ fontSize: 11, color: '#555' }}>{issueLabel}</span>
        </div>
        <AdvisoryBadge />
      </div>

      <div style={{ fontSize: 13, color: '#ccc', marginBottom: 6, fontWeight: 600 }}>
        {rec.recommendation}
      </div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 10, lineHeight: 1.5 }}>
        {rec.rationale}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#555', marginBottom: 8 }}>
        {rec.average_error  != null && <span>Avg error: <span style={{ color: rec.average_error > 0 ? '#f59e0b' : '#60a5fa', fontFamily: 'monospace' }}>{rec.average_error > 0 ? '+' : ''}{rec.average_error}</span></span>}
        {rec.suggested_adjustment != null && <span>Suggested adj: <span style={{ color: '#a78bfa', fontFamily: 'monospace' }}>{rec.suggested_adjustment > 0 ? '+' : ''}{rec.suggested_adjustment}</span></span>}
        {rec.mae            != null && <span>MAE: <span style={{ fontFamily: 'monospace', color: '#888' }}>{rec.mae.toFixed(1)}</span></span>}
        {rec.occurrences    != null && <span>Occurrences: <span style={{ fontFamily: 'monospace', color: '#888' }}>{rec.occurrences}</span></span>}
        {rec.failure_rate   != null && <span>Failure rate: <span style={{ fontFamily: 'monospace', color: '#888' }}>{(rec.failure_rate * 100).toFixed(0)}%</span></span>}
        <span>Samples: <span style={{ fontFamily: 'monospace', color: '#888' }}>{rec.sample_size}</span></span>
        {rec.severity && <SevBadge severity={rec.severity} />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.5 }}>Confidence</span>
        <div style={{ flex: 1, maxWidth: 140 }}>
          <ConfBar value={rec.confidence} />
        </div>
        <span style={{ fontSize: 10, color: '#333' }}>Status: <span style={{ color: '#555' }}>{rec.status}</span></span>
      </div>
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</span>
      {count != null && (
        <span style={{ fontSize: 11, color: '#444', background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '1px 8px' }}>{count}</span>
      )}
    </div>
  );
}

function EmptyState({ msg }) {
  return <div style={{ color: '#444', fontSize: 13, padding: '12px 0' }}>{msg}</div>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LearningDashboard() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(ROUTES.learningReport, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`${res.status}`);
      setReport(await res.json());
      setError('');
    } catch (e) {
      if (e.name !== 'AbortError') setError('Could not load learning report — scoring server may be offline.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
    const id = setInterval(fetchReport, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchReport]);

  const h = report?.learningHealth ?? {};
  const statusColor = HEALTH_COLOR[h.status] ?? '#555';

  return (
    <div className="feature-page">
      <div className="feature-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="feature-title">Learning Intelligence</h2>
          <p className="feature-desc">Advisory recommendations from historical prediction analysis — nothing is applied automatically.</p>
        </div>
        <button className="btn-small btn-primary" onClick={fetchReport} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Advisory disclaimer */}
      <div style={{
        background: '#1a1200', border: '1px solid #78350f44', borderRadius: 8,
        padding: '10px 16px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center',
      }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span style={{ fontSize: 12, color: '#d97706', lineHeight: 1.5 }}>
          All items below are <strong>advisory only</strong>. No changes have been made to scoring, thresholds, or model behavior. Human approval is required before any recommendation can be applied.
        </span>
      </div>

      {/* Learning Health */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Learning Health" />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Status',         value: h.status ?? '—',             color: statusColor },
            { label: 'Data Points',    value: h.dataPoints ?? 0,            color: '#888' },
            { label: 'Recommendations',value: h.recommendationCount ?? 0,   color: '#888' },
            { label: 'Avg Confidence', value: h.avgConfidence != null ? `${Math.round(h.avgConfidence * 100)}%` : '—', color: '#888' },
            { label: 'Top Drift Niche',value: h.topDriftNiche ?? 'none',    color: '#a78bfa' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 7, padding: '8px 14px', flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: 'monospace', marginTop: 3 }}>{String(value)}</div>
            </div>
          ))}
        </div>
        {h.lastAnalyzed && (
          <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>
            Last analyzed: {new Date(h.lastAnalyzed).toLocaleString()}
          </div>
        )}
      </div>

      {/* Calibration Recommendations */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Calibration Recommendations" count={report?.calibrationRecommendations?.length} />
        {!report?.calibrationRecommendations?.length
          ? <EmptyState msg="No calibration biases detected — predictions are well-calibrated across all niches." />
          : report.calibrationRecommendations.map(r => <RecCard key={r.id} rec={r} />)
        }
      </div>

      {/* Confidence Reliability */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Confidence Reliability" />
        {!report?.confidenceReliability || !Object.keys(report.confidenceReliability).length
          ? <EmptyState msg="Not enough outcome data yet to assess confidence reliability." />
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#555', borderBottom: '1px solid #1e1e1e' }}>
                    <th style={{ padding: '4px 10px', textAlign: 'left',  fontWeight: 600 }}>Confidence</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>Expected</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>Actual</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>Gap</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 600 }}>Samples</th>
                    <th style={{ padding: '4px 10px', textAlign: 'left',  fontWeight: 600 }}>Reliability</th>
                  </tr>
                </thead>
                <tbody>
                  {['high', 'medium', 'low', 'degraded', 'unknown'].map(key => {
                    const row = report.confidenceReliability[key];
                    if (!row) return (
                      <tr key={key} style={{ borderBottom: '1px solid #1a1a1a', opacity: 0.3 }}>
                        <td style={{ padding: '5px 10px', color: '#666', fontWeight: 600 }}>{CONF_LABELS[key]}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#333' }}>{EXPECTED[key]}</td>
                        <td colSpan={4} style={{ padding: '5px 10px', color: '#333' }}>No data</td>
                      </tr>
                    );
                    const gap      = row.reliability_gap;
                    const gapColor = gap == null ? '#555' : gap >= 0 ? '#22c55e' : gap > -0.2 ? '#f59e0b' : '#ef4444';
                    const actual   = Math.round((row.actual_accuracy ?? 0) * 100);
                    const actColor = actual >= 70 ? '#22c55e' : actual >= 40 ? '#f59e0b' : '#ef4444';
                    return (
                      <tr key={key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: '5px 10px', color: '#bbb', fontWeight: 600 }}>{CONF_LABELS[key]}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#555', fontFamily: 'monospace' }}>{EXPECTED[key]}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: actColor, fontFamily: 'monospace' }}>{actual}%</td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: gapColor, fontFamily: 'monospace' }}>
                          {gap != null ? `${gap > 0 ? '+' : ''}${Math.round(gap * 100)}%` : '—'}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#666', fontFamily: 'monospace' }}>{row.sample_size}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <div style={{ maxWidth: 100 }}><ConfBar value={row.actual_accuracy} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* Niche Intelligence */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Niche Intelligence" count={report?.nicheLearning?.length} />
        {!report?.nicheLearning?.length
          ? <EmptyState msg="No niche-specific learning signals detected yet." />
          : report.nicheLearning.map(r => <RecCard key={r.id} rec={r} />)
        }
      </div>

      {/* Failure Patterns */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Failure Patterns" count={report?.patternFailures?.length} />
        {!report?.patternFailures?.length
          ? <EmptyState msg="No recurring failure patterns detected — system is performing as expected." />
          : report.patternFailures.map(r => <RecCard key={r.id} rec={r} />)
        }
      </div>
    </div>
  );
}
