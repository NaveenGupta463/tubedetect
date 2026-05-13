import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts';
import { ROUTES } from '../config';

const SECTION_TABS = [
  'Top Recommendations', 'Opportunity Radar', 'Rising Strategies',
  'Semantic Map', 'Hook Matrix', 'Confidence Dist.',
  'Impact Dist.', 'Strategy Timeline', 'Success Tracking', 'Experiment Queue',
];

const CATEGORY_LABELS = {
  hook_strategy: 'Hook',
  upload_timing: 'Timing',
  semantic_opportunity: 'Semantic',
  niche_positioning: 'Niche',
  content_pattern: 'Pattern',
  experiment_suggestion: 'Experiment',
};

const CATEGORY_COLORS = {
  hook_strategy: '#8888ff',
  upload_timing: '#4ade80',
  semantic_opportunity: '#60a5fa',
  niche_positioning: '#facc15',
  content_pattern: '#fb923c',
  experiment_suggestion: '#a78bfa',
};

const RISK_COLORS = { low: '#4ade80', medium: '#facc15', high: '#f87171' };

const FEEDBACK_OPTS = [
  { key: 'useful',      label: '✓ Useful',    color: '#4ade80' },
  { key: 'successful',  label: '★ Worked',    color: '#60a5fa' },
  { key: 'failed',      label: '✗ Failed',    color: '#f87171' },
  { key: 'irrelevant',  label: '— Skip',      color: '#555' },
  { key: 'risky',       label: '⚠ Risky',    color: '#facc15' },
];

const S = {
  card:   { background: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: 10, padding: '16px 18px', marginBottom: 14 },
  label:  { fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', marginBottom: 4, display: 'block' },
  btn:    { background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: 6, color: '#8888ff', padding: '7px 14px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, fontFamily: 'monospace' },
  btnGrn: { background: '#0a1f0a', border: '1px solid #1a4a1a', borderRadius: 6, color: '#4ade80', padding: '7px 14px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, fontFamily: 'monospace' },
  table:  { width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' },
  th:     { borderBottom: '1px solid #1a1a2e', padding: '6px 9px', textAlign: 'left', color: '#444', fontWeight: 700, fontSize: '0.62rem', letterSpacing: '0.08em', textTransform: 'uppercase' },
  td:     { borderBottom: '1px solid #111', padding: '7px 9px', color: '#999', verticalAlign: 'middle' },
  input:  { background: '#111', border: '1px solid #222', borderRadius: 6, color: '#ccc', padding: '7px 11px', fontSize: '0.8rem', fontFamily: 'monospace' },
  select: { background: '#111', border: '1px solid #222', borderRadius: 6, color: '#ccc', padding: '7px 11px', fontSize: '0.8rem', fontFamily: 'monospace' },
  row:    { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  err:    { fontSize: '0.74rem', color: '#f87171', marginTop: 6 },
  muted:  { fontSize: '0.68rem', color: '#444', fontStyle: 'italic', lineHeight: 1.5 },
};

function clamp(x) { return Math.max(0, Math.min(1, x ?? 0)); }

function HelpTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', marginLeft: 4, display: 'inline-block' }}>
      <span style={{ cursor: 'help', color: '#444', fontSize: '0.66rem' }}
        onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>ⓘ</span>
      {show && (
        <div style={{ position: 'absolute', left: 0, top: 18, background: '#0d0d18', border: '1px solid #2a2a4e', borderRadius: 6, padding: '8px 10px', fontSize: '0.68rem', color: '#888', width: 230, zIndex: 20, lineHeight: 1.5 }}>
          {text}
        </div>
      )}
    </span>
  );
}

function ConfBar({ value, color = '#8888ff', width = 80 }) {
  const pct = Math.round(clamp(value) * 100);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width, height: 5, background: '#1a1a2e', borderRadius: 3, display: 'inline-block', overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontSize: '0.66rem', color: '#555', minWidth: 28 }}>{pct}%</span>
    </span>
  );
}

function CatTag({ cat }) {
  const color = CATEGORY_COLORS[cat] ?? '#555';
  return (
    <span style={{ background: `${color}18`, border: `1px solid ${color}44`, borderRadius: 4, padding: '1px 7px', fontSize: '0.64rem', color, fontWeight: 600 }}>
      {CATEGORY_LABELS[cat] ?? cat}
    </span>
  );
}

function RiskTag({ risk }) {
  const color = RISK_COLORS[risk] ?? '#888';
  return <span style={{ fontSize: '0.64rem', color, fontWeight: 600 }}>{(risk ?? '—').toUpperCase()}</span>;
}

function UpliftBadge({ value }) {
  if (value == null) return <span style={{ color: '#333' }}>—</span>;
  const color = value >= 20 ? '#4ade80' : value >= 10 ? '#facc15' : '#888';
  return <span style={{ color, fontWeight: 600 }}>+{value}%</span>;
}

function FeedbackButtons({ recId, current, onFeedback }) {
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {FEEDBACK_OPTS.map(f => (
        <button key={f.key}
          onClick={() => onFeedback(recId, f.key)}
          style={{
            background: current === f.key ? `${f.color}22` : 'transparent',
            border: `1px solid ${current === f.key ? f.color : '#1a1a2e'}`,
            borderRadius: 4, color: current === f.key ? f.color : '#333',
            padding: '2px 7px', cursor: 'pointer', fontSize: '0.62rem', fontFamily: 'monospace',
          }}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

function SectionHeader({ title, tip }) {
  return (
    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8888ff', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
      {title}{tip && <HelpTip text={tip} />}
    </div>
  );
}

// ── Section 0: Top Recommendations ───────────────────────────────────────────
function TopRecsSection({ recs, feedbackMap, onFeedback }) {
  if (!recs.length) return <p style={S.muted}>No recommendations loaded. Select a niche and click Generate.</p>;
  return (
    <>
      <SectionHeader title="Top Recommendations"
        tip="Ranked by priority = impact × confidence × reliability. Low risk + high confidence = act now. High risk or low confidence = test first." />
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['#', 'Category', 'Title', 'Confidence', 'Priority', 'Risk', 'Horizon', 'Est. Uplift', 'Feedback'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recs.slice(0, 15).map(r => (
              <tr key={r.id ?? r.recommendation_id}>
                <td style={{ ...S.td, color: '#555', minWidth: 24 }}>{r.rank ?? '—'}</td>
                <td style={S.td}><CatTag cat={r.category} /></td>
                <td style={{ ...S.td, maxWidth: 320 }}>
                  <div style={{ color: '#ccc', fontSize: '0.73rem', lineHeight: 1.4 }}>{r.title}</div>
                  <div style={{ ...S.muted, marginTop: 3 }}>{r.reasoning?.slice(0, 100)}…</div>
                </td>
                <td style={S.td}><ConfBar value={r.confidence} /></td>
                <td style={S.td}><ConfBar value={r.priority_score ?? r.priority} color="#a78bfa" /></td>
                <td style={S.td}><RiskTag risk={r.risk_level} /></td>
                <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: '0.68rem', color: '#666' }}>{r.time_horizon ?? '—'}</td>
                <td style={S.td}><UpliftBadge value={r.estimated_uplift} /></td>
                <td style={S.td}>
                  <FeedbackButtons recId={r.id ?? r.recommendation_id} current={feedbackMap[r.id ?? r.recommendation_id]} onFeedback={onFeedback} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Section 1: Opportunity Radar ──────────────────────────────────────────────
function OpportunityRadar({ opportunities }) {
  if (!opportunities.length) return <p style={S.muted}>No opportunities detected. Generate recommendations first.</p>;
  const types = [...new Set(opportunities.map(o => o.type))];
  return (
    <>
      <SectionHeader title="Opportunity Radar"
        tip="Opportunities are detected from benchmark anomalies, underexploited hooks, rising archetypes, and accelerating niches. Strength = normalized signal intensity (0–1)." />
      {types.map(type => {
        const group = opportunities.filter(o => o.type === type);
        const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return (
          <div key={type} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.67rem', color: '#555', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {group.map((o, i) => (
                <div key={i} style={{ background: '#0d0d18', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px', minWidth: 200, maxWidth: 260 }}>
                  <div style={{ color: '#ccc', fontSize: '0.76rem', fontWeight: 600, marginBottom: 4 }}>{o.label}</div>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ fontSize: '0.62rem', color: '#444' }}>Strength </span>
                    <ConfBar value={o.strength} color="#60a5fa" width={60} />
                  </div>
                  {o.avg_vph != null && <div style={{ fontSize: '0.66rem', color: '#555' }}>{o.avg_vph.toFixed(1)} avg VPH</div>}
                  <div style={{ ...S.muted, marginTop: 4 }}>{o.evidence}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── Section 2: Rising Strategies ─────────────────────────────────────────────
function RisingStrategies({ recs }) {
  const rising = recs.filter(r => r.time_horizon === 'immediate' || r.time_horizon === '1-2 weeks');
  if (!rising.length) return <p style={S.muted}>No short-term rising strategies found in current recommendations.</p>;
  return (
    <>
      <SectionHeader title="Rising Strategies"
        tip="Strategies with immediate or 1-2 week time horizons, sorted by priority. These have the highest expected short-term impact given current data." />
      {rising.slice(0, 8).map(r => (
        <div key={r.id ?? r.recommendation_id} style={{ ...S.card, borderLeft: `3px solid ${CATEGORY_COLORS[r.category] ?? '#333'}` }}>
          <div style={S.row}>
            <CatTag cat={r.category} />
            <RiskTag risk={r.risk_level} />
            <span style={{ fontSize: '0.66rem', color: '#555' }}>{r.time_horizon}</span>
            <span style={{ marginLeft: 'auto' }}><UpliftBadge value={r.estimated_uplift} /></span>
          </div>
          <div style={{ color: '#ccc', fontSize: '0.8rem', fontWeight: 600, margin: '8px 0 4px' }}>{r.title}</div>
          <div style={S.muted}>{r.reasoning}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 20 }}>
            <span style={{ fontSize: '0.66rem', color: '#555' }}>Confidence <ConfBar value={r.confidence} width={60} /></span>
            <span style={{ fontSize: '0.66rem', color: '#555' }}>Priority <ConfBar value={r.priority_score ?? r.priority} color="#a78bfa" width={60} /></span>
          </div>
          {r.supporting_evidence && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: '0.65rem', color: '#444', cursor: 'pointer' }}>Evidence</summary>
              <pre style={{ fontSize: '0.62rem', color: '#555', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(r.supporting_evidence, null, 2)}
              </pre>
            </details>
          )}
        </div>
      ))}
    </>
  );
}

// ── Section 3: Semantic Opportunity Map ───────────────────────────────────────
function SemanticMap({ token }) {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(ROUTES.semanticClusters)
      .then(r => r.json())
      .then(d => setClusters(d.clusters ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={S.muted}>Loading clusters…</p>;
  if (!clusters.length) return <p style={S.muted}>No semantic clusters. Run an embedding ingest and cluster cycle first.</p>;

  return (
    <>
      <SectionHeader title="Semantic Opportunity Map"
        tip="Semantic clusters group titles by structural similarity. High avg VPH + rising trend = adopt. High VPH + stable = proven. Rising but low sample = emerging, test first." />
      <table style={S.table}>
        <thead>
          <tr>
            {['Cluster', 'Avg VPH', 'Confidence', 'Sample Size', 'Trend', 'Niches'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {clusters.sort((a, b) => (b.avg_vph ?? 0) - (a.avg_vph ?? 0)).map(c => {
            const trendColor = c.trend_direction === 'rising' ? '#4ade80' : c.trend_direction === 'declining' ? '#f87171' : '#555';
            const niches = Array.isArray(c.niches_present) ? c.niches_present : [];
            return (
              <tr key={c.cluster_name}>
                <td style={{ ...S.td, color: '#ccc', fontWeight: 600 }}>{c.cluster_name}</td>
                <td style={{ ...S.td, color: '#8888ff' }}>{c.avg_vph?.toFixed(1) ?? '—'}</td>
                <td style={S.td}><ConfBar value={c.confidence} /></td>
                <td style={{ ...S.td, color: '#666' }}>{c.sample_size ?? 0}</td>
                <td style={{ ...S.td, color: trendColor, fontWeight: 600 }}>{c.trend_direction ?? 'stable'}</td>
                <td style={{ ...S.td, fontSize: '0.65rem', color: '#555' }}>{niches.slice(0, 3).join(', ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ── Section 4: Hook Opportunity Matrix ────────────────────────────────────────
function HookMatrix({ hookMatrix }) {
  const [filter, setFilter] = useState('');
  if (!hookMatrix?.length) return <p style={S.muted}>No hook matrix data. Run recommendation analytics first.</p>;

  const niches   = [...new Set(hookMatrix.map(r => r.niche))].sort();
  const filtered = filter ? hookMatrix.filter(r => r.niche === filter) : hookMatrix;

  return (
    <>
      <SectionHeader title="Hook Opportunity Matrix"
        tip="Hook score = weighted composite of VPH, consistency, and momentum. Higher = better. Trend shows recent direction. Low sample_count + high hook_score = underexploited." />
      <div style={S.row}>
        <span style={S.label}>Filter niche</span>
        <select style={S.select} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All niches</option>
          {niches.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Niche', 'Hook Type', 'Median VPH', 'Hook Score', 'Confidence', 'Sample Count', 'Trend'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 60).map((r, i) => {
              const trendColor = r.trend_direction === 'rising' ? '#4ade80' : r.trend_direction === 'declining' ? '#f87171' : '#555';
              return (
                <tr key={i}>
                  <td style={{ ...S.td, color: '#666' }}>{r.niche}</td>
                  <td style={{ ...S.td, color: '#ccc' }}>{r.hook_type?.replace(/_/g, ' ')}</td>
                  <td style={{ ...S.td, color: '#8888ff' }}>{r.median_vph?.toFixed(1) ?? '—'}</td>
                  <td style={S.td}><ConfBar value={r.hook_score} color="#a78bfa" /></td>
                  <td style={S.td}><ConfBar value={r.confidence_score} /></td>
                  <td style={{ ...S.td, color: (r.sample_count ?? 0) < 10 ? '#facc15' : '#666' }}>{r.sample_count ?? 0}</td>
                  <td style={{ ...S.td, color: trendColor, fontWeight: 600 }}>{r.trend_direction ?? 'stable'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Section 5: Confidence Distribution ───────────────────────────────────────
function ConfidenceDist({ recs }) {
  const buckets = [
    { label: '0–30%',  min: 0,    max: 0.30 },
    { label: '30–60%', min: 0.30, max: 0.60 },
    { label: '60–80%', min: 0.60, max: 0.80 },
    { label: '80%+',   min: 0.80, max: 1.01 },
  ].map(b => ({ ...b, count: recs.filter(r => (r.confidence ?? 0) >= b.min && (r.confidence ?? 0) < b.max).length }));

  return (
    <>
      <SectionHeader title="Recommendation Confidence Distribution"
        tip="Confidence reflects data depth: sample size, recency, and benchmark reliability. High confidence = act. Medium = validate. Low confidence = experiment only." />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={buckets} margin={{ left: 0, right: 10, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
          <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 11 }} />
          <YAxis tick={{ fill: '#555', fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #1a1a2e', fontSize: 12 }} />
          <Bar dataKey="count" name="Recommendations" radius={[4, 4, 0, 0]}>
            {buckets.map((b, i) => (
              <Cell key={i} fill={i < 2 ? '#f87171' : i === 2 ? '#facc15' : '#4ade80'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p style={S.muted}>Lower confidence bins signal areas needing more data before acting. High confidence (60%+) recommendations are benchmark-grounded with sufficient sample depth.</p>
    </>
  );
}

// ── Section 6: Impact Distribution ───────────────────────────────────────────
function ImpactDist({ recs }) {
  const withUplift = recs.filter(r => r.estimated_uplift != null);
  const buckets = [
    { label: '0–10%',   min: 0,   max: 10  },
    { label: '10–25%',  min: 10,  max: 25  },
    { label: '25–50%',  min: 25,  max: 50  },
    { label: '50%+',    min: 50,  max: 9999 },
  ].map(b => ({ ...b, count: withUplift.filter(r => r.estimated_uplift >= b.min && r.estimated_uplift < b.max).length }));

  const median = withUplift.length
    ? [...withUplift].sort((a, b) => a.estimated_uplift - b.estimated_uplift)[Math.floor(withUplift.length / 2)]?.estimated_uplift
    : null;

  return (
    <>
      <SectionHeader title="Predicted Impact Distribution"
        tip="Estimated uplift = expected VPH improvement vs current niche median. These are forward-looking estimates derived from benchmark comparisons — not guaranteed outcomes. Verify with experiments." />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={buckets} margin={{ left: 0, right: 10, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
          <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 11 }} />
          <YAxis tick={{ fill: '#555', fontSize: 11 }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #1a1a2e', fontSize: 12 }} />
          <Bar dataKey="count" name="Recommendations" fill="#8888ff" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {median != null && <p style={S.muted}>Median estimated uplift: +{median}% VPH. {withUplift.length}/{recs.length} recommendations include uplift estimates. Estimates without uplift are qualitative (e.g. semantic positioning).</p>}
    </>
  );
}

// ── Section 7: Strategy Timeline ──────────────────────────────────────────────
function StrategyTimeline({ recs }) {
  const groups = [
    { label: 'Immediate', key: 'immediate', color: '#4ade80' },
    { label: '1–2 Weeks', key: '1-2 weeks', color: '#8888ff' },
    { label: '1–3 Months', key: '1-3 months', color: '#facc15' },
    { label: '3+ Months', key: '3+ months', color: '#f87171' },
  ];
  return (
    <>
      <SectionHeader title="Strategy Timeline"
        tip="Group recommendations by action horizon. Immediate = zero-friction changes (timing, title length). 1-2 weeks = hook/pattern shifts. 1-3 months = niche repositioning." />
      {groups.map(g => {
        const items = recs.filter(r => r.time_horizon === g.key);
        return (
          <div key={g.key} style={{ marginBottom: 16, borderLeft: `3px solid ${g.color}44`, paddingLeft: 14 }}>
            <div style={{ color: g.color, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              {g.label} <span style={{ color: '#333', marginLeft: 6 }}>({items.length})</span>
            </div>
            {!items.length && <p style={S.muted}>No recommendations in this window.</p>}
            {items.slice(0, 4).map(r => (
              <div key={r.id ?? r.recommendation_id} style={{ marginBottom: 8, background: '#0d0d12', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <CatTag cat={r.category} />
                  <RiskTag risk={r.risk_level} />
                  <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: '#555' }}>priority: {((r.priority_score ?? r.priority ?? 0) * 100).toFixed(0)}</span>
                </div>
                <div style={{ fontSize: '0.76rem', color: '#ccc', lineHeight: 1.4 }}>{r.title}</div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ── Section 8: Success Tracking ───────────────────────────────────────────────
function SuccessTracking({ feedbackStats }) {
  if (!feedbackStats) return <p style={S.muted}>Loading feedback data…</p>;
  const byType = feedbackStats.by_type ?? [];
  const total  = feedbackStats.total ?? 0;
  const hitRate = feedbackStats.hit_rate;

  return (
    <>
      <SectionHeader title="Recommendation Success Tracking"
        tip="Track which recommendations were marked as successful, failed, or irrelevant. Hit rate = successful / (successful + failed). Feedback improves future recommendation weighting." />
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 16px', minWidth: 110 }}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Total Feedback</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#8888ff' }}>{total}</div>
        </div>
        <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 16px', minWidth: 110 }}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Hit Rate</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, color: hitRate != null ? (hitRate >= 60 ? '#4ade80' : hitRate >= 40 ? '#facc15' : '#f87171') : '#333' }}>
            {hitRate != null ? `${hitRate}%` : 'N/A'}
          </div>
          <div style={{ fontSize: '0.6rem', color: '#333' }}>successful / (succ+failed)</div>
        </div>
      </div>
      {byType.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={byType} margin={{ left: 0, right: 10, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a2e" />
            <XAxis dataKey="feedback_type" tick={{ fill: '#555', fontSize: 11 }} />
            <YAxis tick={{ fill: '#555', fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #1a1a2e', fontSize: 12 }} />
            <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
              {byType.map((d, i) => {
                const color = d.feedback_type === 'successful' ? '#4ade80' : d.feedback_type === 'failed' ? '#f87171' : d.feedback_type === 'useful' ? '#60a5fa' : d.feedback_type === 'risky' ? '#facc15' : '#555';
                return <Cell key={i} fill={color} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {feedbackStats.recent?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: '0.66rem', color: '#444', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>Recent Feedback</div>
          <table style={S.table}>
            <thead><tr>{['Recommendation', 'Feedback', 'Date'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {feedbackStats.recent.slice(0, 10).map((f, i) => {
                const fbColor = FEEDBACK_OPTS.find(o => o.key === f.feedback_type)?.color ?? '#555';
                return (
                  <tr key={i}>
                    <td style={{ ...S.td, maxWidth: 280, fontSize: '0.71rem', color: '#888' }}>{f.title ?? f.recommendation_id}</td>
                    <td style={{ ...S.td, color: fbColor, fontWeight: 600, fontSize: '0.71rem' }}>{f.feedback_type}</td>
                    <td style={{ ...S.td, color: '#444', fontSize: '0.68rem' }}>{f.created_at?.slice(0, 16)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Section 9: Experiment Queue ────────────────────────────────────────────────
function ExperimentQueue({ experiments, feedbackMap, onFeedback }) {
  if (!experiments.length) return <p style={S.muted}>No experiment recommendations. Generate recommendations to populate the queue.</p>;
  return (
    <>
      <SectionHeader title="Experiment Queue"
        tip="Low-risk controlled tests. Experiments validate promising patterns before full commitment. Test size and measurement criteria are included in reasoning." />
      {experiments.map(r => {
        const ev = r.supporting_evidence ?? {};
        const evParsed = typeof ev === 'string' ? (() => { try { return JSON.parse(ev); } catch { return {}; } })() : ev;
        return (
          <div key={r.id ?? r.recommendation_id} style={{ ...S.card, borderLeft: '3px solid #a78bfa' }}>
            <div style={S.row}>
              <span style={{ background: '#1a0a3a', border: '1px solid #3a1a6a', borderRadius: 4, padding: '1px 8px', fontSize: '0.64rem', color: '#a78bfa', fontWeight: 600 }}>EXPERIMENT</span>
              <RiskTag risk={r.risk_level} />
              <span style={{ fontSize: '0.66rem', color: '#555' }}>{r.time_horizon}</span>
              {r.estimated_uplift != null && <UpliftBadge value={r.estimated_uplift} />}
            </div>
            <div style={{ color: '#ccc', fontSize: '0.8rem', fontWeight: 600, margin: '8px 0 4px' }}>{r.title}</div>
            <div style={S.muted}>{r.reasoning}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {evParsed.suggested_test_size && (
                <span style={{ fontSize: '0.66rem', color: '#555' }}>Test size: <span style={{ color: '#8888ff' }}>{evParsed.suggested_test_size} videos</span></span>
              )}
              {evParsed.measurement && (
                <span style={{ fontSize: '0.66rem', color: '#555' }}>Measure: <span style={{ color: '#60a5fa' }}>{evParsed.measurement}</span></span>
              )}
              {evParsed.duration && (
                <span style={{ fontSize: '0.66rem', color: '#555' }}>Duration: <span style={{ color: '#facc15' }}>{evParsed.duration}</span></span>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <FeedbackButtons recId={r.id ?? r.recommendation_id} current={feedbackMap[r.id ?? r.recommendation_id]} onFeedback={onFeedback} />
            </div>
          </div>
        );
      })}
    </>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function StrategyIntelligenceTab({ token }) {
  const [sectionTab,    setSectionTab]    = useState(0);
  const [niche,         setNiche]         = useState('');
  const [recs,          setRecs]          = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [analytics,     setAnalytics]     = useState(null);
  const [feedbackStats, setFeedbackStats] = useState(null);
  const [experiments,   setExperiments]   = useState([]);
  const [feedbackMap,   setFeedbackMap]   = useState({});
  const [generating,    setGenerating]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);

  const loadAnalytics = useCallback(async () => {
    try {
      const [analyticsRes, histRes, expRes] = await Promise.all([
        fetch(ROUTES.strategyAnalytics).then(r => r.json()),
        fetch(ROUTES.strategyHistory).then(r => r.json()),
        fetch(ROUTES.strategyExperimentQueue).then(r => r.json()),
      ]);
      if (analyticsRes.ok)  setAnalytics(analyticsRes);
      if (histRes.ok)       setFeedbackStats(histRes.feedback_stats);
      if (expRes.ok)        setExperiments(expRes.experiments ?? []);
    } catch (e) { console.warn('[strategy] analytics load failed:', e.message); }
  }, []);

  const loadSavedRecs = useCallback(async (n) => {
    setLoading(true);
    setError(null);
    try {
      const params = n ? `?niche=${encodeURIComponent(n)}` : '';
      const [recsRes, oppsRes] = await Promise.all([
        fetch(`${ROUTES.strategyRecommendations}${params}`).then(r => r.json()),
        fetch(ROUTES.strategyOpportunities, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ niche: n || null }) }).then(r => r.json()),
      ]);
      if (recsRes.ok)  setRecs(recsRes.recommendations ?? []);
      if (oppsRes.ok)  setOpportunities(oppsRes.opportunities ?? []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAnalytics();
    loadSavedRecs('');
  }, [loadAnalytics, loadSavedRecs]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(ROUTES.strategyGenerate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: niche || null, limit: 25 }),
      }).then(r => r.json());
      if (!res.ok) throw new Error(res.error ?? 'Generate failed');
      setRecs(res.recommendations ?? []);

      const oppsRes = await fetch(ROUTES.strategyOpportunities, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ niche: niche || null }),
      }).then(r => r.json());
      if (oppsRes.ok) setOpportunities(oppsRes.opportunities ?? []);

      const expRes = await fetch(ROUTES.strategyExperimentQueue).then(r => r.json());
      if (expRes.ok) setExperiments(expRes.experiments ?? []);

      await loadAnalytics();
    } catch (e) { setError(e.message); }
    setGenerating(false);
  };

  const handleFeedback = async (recId, feedbackType) => {
    setFeedbackMap(prev => ({ ...prev, [recId]: feedbackType }));
    try {
      await fetch(ROUTES.strategyFeedback(recId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_type: feedbackType }),
      });
      setTimeout(loadAnalytics, 500);
    } catch { /* non-fatal */ }
  };

  const hookMatrix = analytics?.hook_matrix ?? [];
  const niches     = analytics?.niches ?? [];

  const SECTIONS = [
    <TopRecsSection    recs={recs} feedbackMap={feedbackMap} onFeedback={handleFeedback} />,
    <OpportunityRadar  opportunities={opportunities} />,
    <RisingStrategies  recs={recs} />,
    <SemanticMap       token={token} />,
    <HookMatrix        hookMatrix={hookMatrix} />,
    <ConfidenceDist    recs={recs} />,
    <ImpactDist        recs={recs} />,
    <StrategyTimeline  recs={recs} />,
    <SuccessTracking   feedbackStats={feedbackStats} />,
    <ExperimentQueue   experiments={experiments} feedbackMap={feedbackMap} onFeedback={handleFeedback} />,
  ];

  return (
    <div style={{ fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#555', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>
          Phase H — Strategy Intelligence
        </div>
        <div style={{ fontSize: '0.65rem', color: '#2a2a3e' }}>
          Deterministic · Benchmark-backed · Confidence-aware · Explainable
        </div>
      </div>

      {/* Controls */}
      <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <span style={S.label}>Niche</span>
          <select style={S.select} value={niche} onChange={e => setNiche(e.target.value)}>
            <option value="">All niches</option>
            {niches.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <button style={generating ? { ...S.btnGrn, opacity: 0.6 } : S.btnGrn}
          onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate Recommendations'}
        </button>
        <button style={S.btn} onClick={() => loadSavedRecs(niche)}>Load Saved</button>
        {error && <span style={S.err}>{error}</span>}
        {loading && <span style={{ fontSize: '0.72rem', color: '#555' }}>Loading…</span>}

        {/* Quick stats */}
        {analytics && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.6rem', color: '#333', textTransform: 'uppercase' }}>Recommendations</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#8888ff' }}>{analytics.recommendations?.total ?? 0}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.6rem', color: '#333', textTransform: 'uppercase' }}>Autonomous %</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#4ade80' }}>{analytics.routing?.autonomous_pct ?? 0}%</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.6rem', color: '#333', textTransform: 'uppercase' }}>Tokens Saved</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#60a5fa' }}>{(analytics.routing?.tokens_saved ?? 0).toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      {/* Cost Reduction Banner */}
      {analytics?.cost_reduction && (
        <div style={{ ...S.card, display: 'flex', gap: 20, flexWrap: 'wrap', background: '#0a0f0a', borderColor: '#1a3a1a' }}>
          {[
            { label: 'Recs Served', value: analytics.cost_reduction.recommendations_served, color: '#4ade80' },
            { label: 'Claude Calls Avoided', value: analytics.cost_reduction.claude_calls_avoided, color: '#4ade80' },
            { label: 'Autonomous %', value: `${analytics.cost_reduction.autonomous_pct}%`, color: '#60a5fa' },
            { label: 'Semantic Cache Reuses', value: analytics.cost_reduction.semantic_cache_reuse, color: '#a78bfa' },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: '0.6rem', color: '#2a4a2a', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: s.color }}>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</div>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#1a3a1a', alignSelf: 'center' }}>H13 Cost Reduction Analytics</div>
        </div>
      )}

      {/* Section Tabs */}
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid #1a1a2e', paddingBottom: 0 }}>
        {SECTION_TABS.map((t, i) => (
          <button key={t} onClick={() => setSectionTab(i)} style={{
            background: 'none', border: 'none',
            borderBottom: sectionTab === i ? '2px solid #8888ff' : '2px solid transparent',
            color: sectionTab === i ? '#8888ff' : '#333',
            padding: '6px 12px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace',
          }}>{t}</button>
        ))}
      </div>

      {/* Active Section */}
      <div style={S.card}>
        {SECTIONS[sectionTab]}
      </div>

      {/* Analytics footnote */}
      <div style={{ ...S.muted, textAlign: 'center', marginTop: 12 }}>
        All recommendations are observational and benchmark-grounded. Confidence scores reflect data depth, not predictive certainty.
        Estimated uplift values are forward-looking and should be validated through controlled experiments before full commitment.
      </div>
    </div>
  );
}
