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

const EXP_STATUS_COLOR = {
  draft: '#555', running: '#60a5fa', completed: '#22c55e', aborted: '#ef4444',
};

const ACTION_STATUS_COLOR = {
  approved: '#22c55e', rejected: '#ef4444', pending: '#f59e0b',
};

const WEIGHTS_PLACEHOLDER = {
  niche_bias:       '{"gaming": 5, "finance": -3, "tech": 2}',
  ensemble_weights: '{"ml": 0.65, "peer_context": 0.35}',
};

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

function StatusBadge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
      background: (color ?? '#555') + '22', color: color ?? '#555',
      border: `1px solid ${color ?? '#555'}44`,
    }}>{label}</span>
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

function WinnerBadge({ winner }) {
  if (!winner) return null;
  const colors = { candidate: '#22c55e', baseline: '#60a5fa', inconclusive: '#555' };
  const labels = { candidate: 'Candidate Wins', baseline: 'Baseline Wins', inconclusive: 'Inconclusive' };
  const c = colors[winner] ?? '#555';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 4,
      fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
      background: c + '22', color: c, border: `1px solid ${c}44`,
    }}>
      {labels[winner] ?? winner}
    </span>
  );
}

function MetricPair({ label, baseline, candidate, lower_is_better }) {
  const bv = baseline != null ? parseFloat(baseline.toFixed(2)) : null;
  const cv = candidate != null ? parseFloat(candidate.toFixed(2)) : null;
  const better = cv != null && bv != null
    ? (lower_is_better ? cv < bv : cv > bv)
    : null;
  const cColor = better === true ? '#22c55e' : better === false ? '#ef4444' : '#888';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1a1a1a' }}>
      <span style={{ fontSize: 12, color: '#555' }}>{label}</span>
      <div style={{ display: 'flex', gap: 16 }}>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#666' }}>{bv ?? '—'}</span>
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: cColor, fontWeight: 700 }}>{cv ?? '—'}</span>
      </div>
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

  const [expData,   setExpData]   = useState(null);
  const [actions,   setActions]   = useState([]);
  const [expError,  setExpError]  = useState('');
  const [runningId, setRunningId] = useState(null);
  const [actionPending, setActionPending] = useState({});

  const [creating,    setCreating]    = useState(false);
  const [newExp,      setNewExp]      = useState({ name: '', experiment_type: 'niche_bias', weights: '' });
  const [createError, setCreateError] = useState('');
  const [creating2,   setCreating2]   = useState(false);

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

  const fetchExperiments = useCallback(async () => {
    try {
      const [expRes, actRes] = await Promise.all([
        fetch(ROUTES.experiments, { signal: AbortSignal.timeout(6000) }),
        fetch(ROUTES.recommendationActions, { signal: AbortSignal.timeout(6000) }),
      ]);
      if (!expRes.ok || !actRes.ok) throw new Error('fetch failed');
      const expJson = await expRes.json();
      const actJson = await actRes.json();
      setExpData(expJson);
      setActions(actJson.actions ?? []);
      setExpError('');
    } catch {
      setExpError('Could not load experiment data.');
    }
  }, []);

  useEffect(() => {
    fetchReport();
    fetchExperiments();
    const id = setInterval(() => { fetchReport(); fetchExperiments(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchReport, fetchExperiments]);

  const handleApprove = async (rec) => {
    setActionPending(p => ({ ...p, [rec.id]: 'approving' }));
    try {
      await fetch(ROUTES.recommendationApprove(rec.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendation_type:     rec.type ?? rec.issue ?? 'learning',
          recommendation_snapshot: rec,
        }),
      });
      await fetchExperiments();
    } finally {
      setActionPending(p => ({ ...p, [rec.id]: undefined }));
    }
  };

  const handleReject = async (rec) => {
    setActionPending(p => ({ ...p, [rec.id]: 'rejecting' }));
    try {
      await fetch(ROUTES.recommendationReject(rec.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendation_type: rec.type ?? rec.issue ?? 'learning',
          rejected_reason: 'User rejected',
        }),
      });
      await fetchExperiments();
    } finally {
      setActionPending(p => ({ ...p, [rec.id]: undefined }));
    }
  };

  const handleRunExperiment = async (expId) => {
    setRunningId(expId);
    try {
      await fetch(ROUTES.experimentsRun, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ experiment_id: expId }),
      });
      await fetchExperiments();
    } finally {
      setRunningId(null);
    }
  };

  const handleCreateExperiment = async () => {
    setCreateError('');
    let weights;
    try {
      weights = JSON.parse(newExp.weights || '{}');
    } catch {
      setCreateError('Invalid JSON in weights field.');
      return;
    }
    setCreating2(true);
    try {
      const res = await fetch(ROUTES.experimentsCreate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newExp.name.trim(),
          experiment_type: newExp.experiment_type,
          candidate_config: { weights },
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? 'Failed to create experiment.'); return; }
      setCreating(false);
      setNewExp({ name: '', experiment_type: 'niche_bias', weights: '' });
      await fetchExperiments();
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreating2(false);
    }
  };

  const h = report?.learningHealth ?? {};
  const statusColor = HEALTH_COLOR[h.status] ?? '#555';

  const allRecs = [
    ...(report?.calibrationRecommendations ?? []),
    ...(report?.nicheLearning ?? []),
    ...(report?.patternFailures ?? []),
  ];
  const actionedIds  = new Set((actions ?? []).map(a => a.recommendation_id));
  const pendingRecs  = allRecs.filter(r => !actionedIds.has(r.id));
  const allExps      = expData?.experiments ?? [];
  const activeExps   = allExps.filter(e => e.status === 'draft' || e.status === 'running');
  const completedExps = allExps.filter(e => e.status === 'completed' || e.status === 'aborted');

  return (
    <div className="feature-page">
      <div className="feature-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="feature-title">Learning Intelligence</h2>
          <p className="feature-desc">Advisory recommendations from historical prediction analysis — nothing is applied automatically.</p>
        </div>
        <button className="btn-small btn-primary" onClick={() => { fetchReport(); fetchExperiments(); }} disabled={loading}>
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

      {/* ── APPROVAL QUEUE ─────────────────────────────────────────────────────── */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Approval Queue" count={pendingRecs.length} />
        {expError && (
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{expError}</div>
        )}
        {!pendingRecs.length
          ? <EmptyState msg="No unreviewed recommendations — all suggestions have been actioned." />
          : pendingRecs.map(rec => {
              const pending = actionPending[rec.id];
              const issueLabel = ISSUE_LABELS[rec.issue ?? rec.pattern] ?? (rec.issue ?? rec.pattern ?? rec.type ?? 'suggestion');
              return (
                <div key={rec.id} style={{
                  background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 8,
                  padding: '12px 16px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {rec.niche && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', background: '#a78bfa11', border: '1px solid #a78bfa33', borderRadius: 4, padding: '1px 7px' }}>
                          {rec.niche}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#555' }}>{issueLabel}</span>
                      {rec.severity && <SevBadge severity={rec.severity} />}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleApprove(rec)}
                        disabled={!!pending}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 4, border: 'none',
                          background: pending === 'approving' ? '#164' : '#15803d', color: '#fff', cursor: 'pointer',
                          opacity: pending ? 0.7 : 1,
                        }}
                      >
                        {pending === 'approving' ? '…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(rec)}
                        disabled={!!pending}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 4, border: 'none',
                          background: pending === 'rejecting' ? '#400' : '#7f1d1d', color: '#fff', cursor: 'pointer',
                          opacity: pending ? 0.7 : 1,
                        }}
                      >
                        {pending === 'rejecting' ? '…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#ccc', fontWeight: 600, marginBottom: 4 }}>{rec.recommendation}</div>
                  <div style={{ fontSize: 12, color: '#555', lineHeight: 1.5 }}>{rec.rationale}</div>
                </div>
              );
            })
        }
      </div>

      {/* ── ACTIVE EXPERIMENTS ─────────────────────────────────────────────────── */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1 }}>
            Active Experiments
            <span style={{ fontSize: 11, color: '#444', background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '1px 8px', marginLeft: 8 }}>{activeExps.length}</span>
          </span>
          <button
            onClick={() => { setCreating(c => !c); setCreateError(''); }}
            style={{
              fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 4, border: '1px solid #333',
              background: '#1a1a1a', color: '#888', cursor: 'pointer',
            }}
          >
            {creating ? 'Cancel' : '+ New Experiment'}
          </button>
        </div>

        {creating && (
          <div style={{ background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
              New Experiment
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <input
                type="text"
                placeholder="Experiment name"
                value={newExp.name}
                onChange={e => setNewExp(n => ({ ...n, name: e.target.value }))}
                style={{
                  flex: 2, minWidth: 180, background: '#111', border: '1px solid #2a2a2a', borderRadius: 5,
                  color: '#ccc', fontSize: 12, padding: '6px 10px',
                }}
              />
              <select
                value={newExp.experiment_type}
                onChange={e => setNewExp(n => ({ ...n, experiment_type: e.target.value }))}
                style={{
                  flex: 1, minWidth: 160, background: '#111', border: '1px solid #2a2a2a', borderRadius: 5,
                  color: '#ccc', fontSize: 12, padding: '6px 10px',
                }}
              >
                <option value="niche_bias">niche_bias</option>
                <option value="ensemble_weights">ensemble_weights</option>
              </select>
            </div>
            <textarea
              rows={3}
              placeholder={`Candidate weights JSON\ne.g. ${WEIGHTS_PLACEHOLDER[newExp.experiment_type]}`}
              value={newExp.weights}
              onChange={e => setNewExp(n => ({ ...n, weights: e.target.value }))}
              style={{
                width: '100%', background: '#111', border: '1px solid #2a2a2a', borderRadius: 5,
                color: '#ccc', fontSize: 12, padding: '6px 10px', fontFamily: 'monospace',
                resize: 'vertical', boxSizing: 'border-box', marginBottom: 8,
              }}
            />
            {createError && (
              <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{createError}</div>
            )}
            <button
              onClick={handleCreateExperiment}
              disabled={!newExp.name.trim() || creating2}
              style={{
                fontSize: 12, fontWeight: 700, padding: '5px 16px', borderRadius: 4, border: 'none',
                background: '#1d4ed8', color: '#fff', cursor: 'pointer', opacity: creating2 ? 0.6 : 1,
              }}
            >
              {creating2 ? 'Creating…' : 'Create Experiment'}
            </button>
          </div>
        )}

        {!activeExps.length
          ? <EmptyState msg="No active experiments — create one to simulate a candidate scoring version." />
          : activeExps.map(exp => (
            <div key={exp.id} style={{
              background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 8,
              padding: '12px 16px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 13, color: '#ccc', fontWeight: 700 }}>{exp.name}</span>
                  <span style={{ fontSize: 11, color: '#555', marginLeft: 8 }}>{exp.experiment_type}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <StatusBadge label={exp.status} color={EXP_STATUS_COLOR[exp.status]} />
                  {exp.status === 'draft' && (
                    <button
                      onClick={() => handleRunExperiment(exp.id)}
                      disabled={runningId === exp.id}
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 4, border: 'none',
                        background: runningId === exp.id ? '#1e3a8a' : '#1d4ed8', color: '#fff',
                        cursor: 'pointer', opacity: runningId === exp.id ? 0.7 : 1,
                      }}
                    >
                      {runningId === exp.id ? 'Running…' : 'Run Simulation'}
                    </button>
                  )}
                </div>
              </div>
              {exp.description && (
                <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>{exp.description}</div>
              )}
              <div style={{ fontSize: 11, color: '#444' }}>
                Created {exp.created_at ? new Date(exp.created_at).toLocaleString() : '—'}
              </div>
            </div>
          ))
        }
      </div>

      {/* ── VERSION COMPARISON ─────────────────────────────────────────────────── */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Version Comparison" count={completedExps.length} />
        {!completedExps.length
          ? <EmptyState msg="No completed experiments yet — run a simulation to see comparison results." />
          : completedExps.map(exp => {
              let result = null;
              try { result = exp.result_summary ? JSON.parse(exp.result_summary) : null; } catch {}
              const comparison = result?.comparison;
              const sim        = result?.simulation;
              const baseline   = sim?.baseline_metrics;
              const candidate  = sim?.candidate_metrics;
              return (
                <div key={exp.id} style={{
                  background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 8,
                  padding: '14px 16px', marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    <div>
                      <span style={{ fontSize: 13, color: '#ccc', fontWeight: 700 }}>{exp.name}</span>
                      <span style={{ fontSize: 11, color: '#555', marginLeft: 8 }}>{exp.experiment_type}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <StatusBadge label={exp.status} color={EXP_STATUS_COLOR[exp.status]} />
                      {exp.winner && <WinnerBadge winner={exp.winner} />}
                    </div>
                  </div>

                  {result?.error && (
                    <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{result.error}</div>
                  )}

                  {baseline && candidate && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, fontSize: 11, color: '#555', marginBottom: 4 }}>
                        <span>Baseline</span>
                        <span style={{ color: '#60a5fa' }}>Candidate</span>
                      </div>
                      <MetricPair label="MAE"              baseline={baseline.mae}               candidate={candidate.mae}               lower_is_better />
                      <MetricPair label="Accurate %"       baseline={baseline.accurate_pct}       candidate={candidate.accurate_pct}       lower_is_better={false} />
                      <MetricPair label="Overprediction %" baseline={baseline.overprediction_rate} candidate={candidate.overprediction_rate} lower_is_better />
                      <MetricPair label="Underprediction %" baseline={baseline.underprediction_rate} candidate={candidate.underprediction_rate} lower_is_better />
                      <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
                        Sample size: {baseline.sample_size ?? '—'}
                        {comparison?.regression_risk && (
                          <span style={{ marginLeft: 12 }}>
                            Regression risk: <span style={{
                              color: comparison.regression_risk.risk === 'high' ? '#ef4444' : comparison.regression_risk.risk === 'medium' ? '#f59e0b' : '#22c55e',
                            }}>{comparison.regression_risk.risk}</span>
                          </span>
                        )}
                      </div>
                      {comparison?.improvement_areas?.length > 0 && (
                        <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
                          Top improvement niches: {comparison.improvement_areas.slice(0, 3).map(n => (
                            <span key={n.niche} style={{ color: '#a78bfa', marginLeft: 4 }}>{n.niche}</span>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <div style={{ fontSize: 11, color: '#333', marginTop: 6 }}>
                    Completed {exp.completed_at ? new Date(exp.completed_at).toLocaleString() : '—'}
                  </div>
                </div>
              );
            })
        }
      </div>

      {/* ── EVOLUTION TIMELINE ─────────────────────────────────────────────────── */}
      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
        <SectionHeader title="Evolution Timeline" count={actions.length} />
        {!actions.length
          ? <EmptyState msg="No actions recorded yet — approved or rejected recommendations will appear here." />
          : actions.map(action => {
              const c = ACTION_STATUS_COLOR[action.status] ?? '#555';
              const snap = action.recommendation_snapshot_json
                ? (() => { try { return JSON.parse(action.recommendation_snapshot_json); } catch { return null; } })()
                : null;
              return (
                <div key={action.id} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '8px 0', borderBottom: '1px solid #1a1a1a',
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', background: c,
                    marginTop: 5, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <StatusBadge label={action.status} color={c} />
                        {action.recommendation_type && (
                          <span style={{ fontSize: 11, color: '#555' }}>{action.recommendation_type}</span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: '#333', fontFamily: 'monospace' }}>
                        {action.created_at ? new Date(action.created_at).toLocaleString() : '—'}
                      </span>
                    </div>
                    {snap?.recommendation && (
                      <div style={{ fontSize: 12, color: '#666', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {snap.recommendation}
                      </div>
                    )}
                    {action.rejected_reason && (
                      <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Reason: {action.rejected_reason}</div>
                    )}
                    <div style={{ fontSize: 11, color: '#333', marginTop: 2 }}>by {action.approved_by ?? 'user'}</div>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}
