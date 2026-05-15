import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTip, ResponsiveContainer, Cell } from 'recharts';
import { ROUTES } from '../config';
import { NICHES } from '../utils/constants';

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  card:     { background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: 16, marginBottom: 12 },
  label:    { fontSize: '0.6rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 },
  val:      { fontSize: '0.85rem', color: '#e8e8e8', fontWeight: 600 },
  empty:    { color: '#333', fontSize: '0.75rem', padding: '32px 0', textAlign: 'center' },
  grid2:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 },
  grid3:    { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 },
  tag:      (color) => ({ fontSize: '0.6rem', background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 3, padding: '2px 7px', fontFamily: 'monospace' }),
  sectionHd: { fontSize: '0.65rem', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, marginTop: 20, borderBottom: '1px solid #1a1a1a', paddingBottom: 5 },
  tooltip: { background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc', padding: '6px 10px', borderRadius: 4 },
  select: { background: '#111', border: '1px solid #2a2a2a', color: '#aaa', borderRadius: 4, padding: '5px 10px', fontSize: '0.72rem', fontFamily: 'monospace', cursor: 'pointer' },
  btn: { background: '#111', border: '1px solid #2a2a2a', color: '#aaa', borderRadius: 4, padding: '5px 14px', fontSize: '0.72rem', fontFamily: 'monospace', cursor: 'pointer' },
};

const HOOK_COLORS = {
  curiosity:      '#a78bfa',
  tutorial:       '#60a5fa',
  fear:           '#f87171',
  list:           '#fbbf24',
  transformation: '#4ade80',
  authority:      '#38bdf8',
  challenge:      '#fb923c',
  urgency:        '#f43f5e',
  controversy:    '#e879f9',
  mistake:        '#facc15',
  comparison:     '#34d399',
  secret:         '#c084fc',
  myth:           '#f97316',
  reaction:       '#94a3b8',
};

const TREND_COLORS = { rising: '#4ade80', stable: '#888', declining: '#f87171' };
const TREND_ARROWS = { rising: '↑', stable: '→', declining: '↓' };

async function apiFetch(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || r.statusText); }
  return r.json();
}

function fmtVph(v) {
  if (v == null) return '—';
  return parseFloat(v).toFixed(1) + ' vph';
}

function fmtPct(v) {
  if (v == null) return '—';
  return (v * 100).toFixed(0) + '%';
}

function ConfidenceBadge({ value }) {
  if (value == null) return null;
  const pct = Math.round(value);
  const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171';
  return (
    <span style={{ fontSize: '0.58rem', color, border: `1px solid ${color}44`, borderRadius: 10, padding: '1px 6px', background: color + '11' }}>
      {pct}% conf
    </span>
  );
}

function AmbiguityBadge({ score }) {
  if (score == null || score < 0.25) return null;
  const color = score > 0.4 ? '#f87171' : '#fbbf24';
  return (
    <span style={{ fontSize: '0.58rem', color, border: `1px solid ${color}44`, borderRadius: 10, padding: '1px 6px', background: color + '11' }}>
      ⚠ ambiguous
    </span>
  );
}

function TrendPill({ dir }) {
  const color = TREND_COLORS[dir] ?? '#888';
  const arrow = TREND_ARROWS[dir] ?? '→';
  return <span style={S.tag(color)}>{arrow} {dir}</span>;
}

function HelpTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: 4 }}>
      <span
        style={{ fontSize: '0.6rem', color: '#555', cursor: 'help', border: '1px solid #333', borderRadius: '50%', padding: '0 4px', lineHeight: '14px', display: 'inline-block' }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >?</span>
      {show && (
        <div style={{ ...S.tooltip, position: 'absolute', bottom: '120%', left: 0, zIndex: 100, whiteSpace: 'pre-wrap', maxWidth: 280, minWidth: 180 }}>
          {text}
        </div>
      )}
    </span>
  );
}

function StatBox({ label, value, tooltip }) {
  return (
    <div style={{ background: '#0a0a0f', border: '1px solid #1a1a1a', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
        {label}{tooltip && <HelpTip text={tooltip} />}
      </div>
      <div style={S.val}>{value ?? '—'}</div>
    </div>
  );
}

// Phase 5: Probabilistic confidence bar for a single predicted hook
function HookConfidenceBar({ hook, isTop }) {
  const color  = HOOK_COLORS[hook.type] ?? '#888';
  const pct    = Math.round((hook.confidence ?? 0) * 100);
  const signals = hook.signals ?? [];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.72rem', color: isTop ? color : '#666', fontWeight: isTop ? 700 : 400, minWidth: 110 }}>
          {hook.type}
        </span>
        <div style={{ flex: 1, height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: '0.65rem', color: isTop ? color : '#444', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
      </div>
      {signals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 118 }}>
          {signals.slice(0, 4).map(sig => (
            <span key={sig} style={{ fontSize: '0.55rem', color: '#555', background: '#0a0a0f', border: '1px solid #222', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
              {sig.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HookRow({ row, rank }) {
  const color = HOOK_COLORS[row.hook_type] ?? '#888';
  const [open, setOpen] = useState(false);
  const topSignals = (() => {
    try { return row.top_signals_json ? JSON.parse(row.top_signals_json) : []; }
    catch { return []; }
  })();
  return (
    <div style={{ ...S.card, marginBottom: 8, cursor: 'pointer', borderColor: open ? color + '55' : '#1e1e1e' }} onClick={() => setOpen(o => !o)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 22, fontSize: '0.7rem', color: '#333', textAlign: 'right' }}>#{rank}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: '0.75rem', color, fontWeight: 700 }}>{row.hook_type}</span>
            <TrendPill dir={row.trend_direction} />
            <ConfidenceBadge value={row.confidence_score} />
            {row.avg_ambiguity_score != null && row.avg_ambiguity_score > 0.25 && (
              <AmbiguityBadge score={row.avg_ambiguity_score} />
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: '#aaa' }}>Score: <b style={{ color: '#e8e8e8' }}>{row.hook_score?.toFixed(1)}</b></span>
            <span style={{ fontSize: '0.7rem', color: '#aaa' }}>Avg VPH: <b style={{ color: '#e8e8e8' }}>{fmtVph(row.avg_vph)}</b></span>
            <span style={{ fontSize: '0.7rem', color: '#aaa' }}>n={row.sample_count}</span>
            {row.primary_hook_confidence != null && (
              <span style={{ fontSize: '0.65rem', color: '#555' }}>
                pattern conf: {fmtPct(row.primary_hook_confidence)}
              </span>
            )}
            {row.duration_bucket && row.duration_bucket !== 'all' && (
              <span style={{ fontSize: '0.65rem', color: '#555' }}>{row.duration_bucket}</span>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.65rem', color: '#333' }}>{open ? '▲' : '▼'}</div>
      </div>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1a1a1a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
            <StatBox label="Median VPH" value={fmtVph(row.median_vph)}
              tooltip="Median views-per-hour across all videos with this hook type. More robust than average — ignores outliers." />
            <StatBox label="P75 VPH" value={fmtVph(row.p75_vph)}
              tooltip="75th percentile VPH. A high p75 means even the 'good' videos in this category are fast." />
            <StatBox label="Consistency" value={row.consistency_score != null ? `${row.consistency_score.toFixed(0)}/100` : '—'}
              tooltip="100 = very consistent results. Low values mean high variance — some videos fly, others flop. Lower consistency = riskier hook to use." />
            <StatBox label="Momentum" value={row.momentum_score != null ? `${row.momentum_score > 0 ? '+' : ''}${row.momentum_score.toFixed(1)}%` : '—'}
              tooltip="Compares recent 14-day niche VPH vs the 90-day historical baseline. Positive = niche is growing. This is a niche-level signal." />
          </div>
          {topSignals.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={S.label}>Top Inferred Signals (across all videos in group)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {topSignals.map(({ sig, cnt }) => (
                  <span key={sig} style={{ fontSize: '0.58rem', color: '#555', background: '#0a0a0f', border: '1px solid #1e1e1e', borderRadius: 3, padding: '2px 6px', fontFamily: 'monospace' }}>
                    {sig.replace(/_/g, ' ')} ×{cnt}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(row.example_titles ?? []).length > 0 && (
            <div>
              <div style={S.label}>Example Titles</div>
              {row.example_titles.map((t, i) => (
                <div key={i} style={{ fontSize: '0.68rem', color: '#666', marginBottom: 3, paddingLeft: 8, borderLeft: `2px solid ${color}44` }}>
                  {t}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HookIntelligenceTab() {
  const [niche,       setNiche]       = useState('');
  const [topHooks,    setTopHooks]    = useState(null);
  const [rising,      setRising]      = useState(null);
  const [declining,   setDeclining]   = useState(null);
  const [stats,       setStats]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [aggregating, setAggregating] = useState(false);
  const [aggMsg,      setAggMsg]      = useState('');
  const [error,       setError]       = useState('');
  const [titleInput,  setTitleInput]  = useState('');
  const [classified,  setClassified]  = useState(null);
  const [classifying, setClassifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = niche ? `?niche=${encodeURIComponent(niche)}&limit=30` : '?limit=30';
      const [t, r, d, s] = await Promise.all([
        apiFetch(`${ROUTES.hooksTop}${qs}`).catch(() => ({ rows: [] })),
        apiFetch(`${ROUTES.hooksRising}${qs}`).catch(() => ({ rows: [] })),
        apiFetch(`${ROUTES.hooksDeclining}${qs}`).catch(() => ({ rows: [] })),
        apiFetch(ROUTES.hooksStats).catch(() => null),
      ]);
      setTopHooks(t.rows ?? []);
      setRising(r.rows ?? []);
      setDeclining(d.rows ?? []);
      setStats(s);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [niche]);

  useEffect(() => { load(); }, [load]);

  async function triggerAggregate() {
    setAggregating(true); setAggMsg('');
    try {
      const r = await apiFetch(ROUTES.hooksAggregate, { method: 'POST' });
      setAggMsg(r.skipped
        ? 'No VPH data — ingest videos with growth snapshots first'
        : `Done: ${r.videos_processed} videos → ${r.upserted} hook rows in ${r.ms}ms`);
      load();
    } catch (e) { setAggMsg(`Error: ${e.message}`); }
    setAggregating(false);
  }

  // Phase 5: classify via direct probabilistic endpoint (bypass routing layer)
  async function classifyTitle() {
    if (!titleInput.trim()) return;
    setClassifying(true);
    try {
      const r = await apiFetch(ROUTES.hooksClassify, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput.trim() }),
      });
      setClassified({ title: titleInput.trim(), ...r });
    } catch (e) { setClassified({ error: e.message }); }
    setClassifying(false);
  }

  // Bar chart data: top hooks by score
  const barData = (topHooks ?? []).slice(0, 14).map(h => ({
    hook: h.hook_type,
    score: h.hook_score,
    vph: h.avg_vph,
    color: HOOK_COLORS[h.hook_type] ?? '#888',
  }));

  const isEmpty = !loading && stats?.total_rows === 0;

  return (
    <div>
      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select style={S.select} value={niche} onChange={e => setNiche(e.target.value)}>
            <option value="">All niches</option>
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button style={S.btn} onClick={load}>Refresh</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={{ ...S.btn, color: '#4ade80', borderColor: '#4ade8033' }} onClick={triggerAggregate} disabled={aggregating}>
            {aggregating ? 'Aggregating…' : '⚡ Re-aggregate'}
          </button>
        </div>
      </div>
      {aggMsg && <div style={{ fontSize: '0.68rem', color: '#4ade80', marginBottom: 10, padding: '6px 10px', background: '#0d1a0d', border: '1px solid #1a3a1a', borderRadius: 4 }}>{aggMsg}</div>}
      {error  && <div style={{ fontSize: '0.68rem', color: '#f87171', marginBottom: 10 }}>{error}</div>}

      {/* Summary stats strip */}
      {stats && (
        <div style={{ ...S.grid3, marginBottom: 16 }}>
          <StatBox label="Hook Types Tracked" value={stats.hook_types_covered}
            tooltip="Number of distinct hook types with enough data to rank. Max 14 (the full taxonomy)." />
          <StatBox label="Niches Covered" value={stats.niches_covered}
            tooltip="Number of niches with hook performance data aggregated. More niches = more generalizable insights." />
          <StatBox label="Rising / Declining" value={`${stats.rising} / ${stats.declining}`}
            tooltip="Rising: hooks where recent 14d niche VPH exceeds 90d baseline by >10%. Declining: reverse." />
        </div>
      )}

      {loading && <div style={S.empty}>Loading hook intelligence…</div>}

      {isEmpty && (
        <div style={{ ...S.card, textAlign: 'center', padding: '32px 24px' }}>
          <div style={{ color: '#555', fontSize: '0.78rem', marginBottom: 12 }}>No hook performance data yet.</div>
          <div style={{ color: '#333', fontSize: '0.68rem', marginBottom: 16 }}>
            This requires ingested videos with growth snapshot VPH data.<br />
            Click Re-aggregate to process existing videos, or ingest more channels first.
          </div>
          <button style={{ ...S.btn, color: '#4ade80', borderColor: '#4ade8033' }} onClick={triggerAggregate} disabled={aggregating}>
            {aggregating ? 'Aggregating…' : '⚡ Run Aggregation Now'}
          </button>
        </div>
      )}

      {!loading && !isEmpty && (
        <>
          {/* Section 1: Top hooks bar chart */}
          {barData.length > 0 && (
            <div style={S.card}>
              <div style={S.sectionHd}>
                Top Hooks by Score{niche ? ` — ${niche}` : ' — all niches'}
                <HelpTip text="Hook Score = avg_vph_percentile×0.40 + sample_depth×0.25 + recency×0.20 + consistency×0.15. Normalized 0–100. Higher = better expected performance." />
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={barData} margin={{ top: 4, right: 8, left: -24, bottom: 20 }}>
                  <XAxis dataKey="hook" tick={{ fontSize: 8, fill: '#555' }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#555' }} tickFormatter={v => `${v}`} />
                  <RechartsTip
                    contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }}
                    formatter={(v, n, p) => [`${v?.toFixed(1)} (${fmtVph(p.payload.vph)})`, 'hook score (avg vph)']}
                  />
                  <Bar dataKey="score" radius={[2, 2, 0, 0]}>
                    {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Section 2: Rising & Declining side-by-side */}
          <div style={S.grid2}>
            <div>
              <div style={S.sectionHd}>
                Rising Hook Types
                <HelpTip text="Rising = recent 14-day niche VPH is >10% above the 90-day historical baseline. These hooks are benefiting from a growing niche or renewed audience interest." />
              </div>
              {(rising ?? []).length === 0
                ? <div style={S.empty}>No rising hooks with sufficient data</div>
                : (rising ?? []).map((r, i) => <HookRow key={`r-${r.hook_type}-${r.niche}-${i}`} row={r} rank={i + 1} />)
              }
            </div>
            <div>
              <div style={S.sectionHd}>
                Declining Hook Types
                <HelpTip text="Declining = recent 14-day niche VPH is >10% below the 90-day historical baseline. Using these hooks now means fighting a headwind." />
              </div>
              {(declining ?? []).length === 0
                ? <div style={S.empty}>No declining hooks with sufficient data</div>
                : (declining ?? []).map((r, i) => <HookRow key={`d-${r.hook_type}-${r.niche}-${i}`} row={r} rank={i + 1} />)
              }
            </div>
          </div>

          {/* Section 3: Full ranked list */}
          <div style={S.sectionHd}>
            Hook Consistency Rankings
            <HelpTip text="Consistency score = 0–100. Derived from coefficient of variation in VPH distribution. 100 = very stable results across all videos with this hook. Low consistency = high risk/reward." />
          </div>
          {(topHooks ?? []).length === 0
            ? <div style={S.empty}>No hook data for selected filter</div>
            : [...(topHooks ?? [])]
                .sort((a, b) => (b.consistency_score ?? 0) - (a.consistency_score ?? 0))
                .slice(0, 10)
                .map((row, i) => (
                  <div key={`cons-${row.hook_type}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, padding: '6px 10px', background: '#0a0a0f', borderRadius: 4, border: '1px solid #151515' }}>
                    <div style={{ minWidth: 22, fontSize: '0.68rem', color: '#333' }}>#{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.72rem', color: HOOK_COLORS[row.hook_type] ?? '#888', fontWeight: 600 }}>{row.hook_type}</span>
                      {row.niche && <span style={{ fontSize: '0.6rem', color: '#444', marginLeft: 6 }}>{row.niche}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.68rem', color: '#aaa' }}>consistency: <b style={{ color: '#e8e8e8' }}>{row.consistency_score?.toFixed(0) ?? '—'}</b>/100</span>
                      <span style={{ fontSize: '0.68rem', color: '#aaa' }}>n={row.sample_count}</span>
                      <TrendPill dir={row.trend_direction} />
                    </div>
                  </div>
                ))
          }

          {/* Section 4: All top hooks ranked list */}
          <div style={S.sectionHd}>
            Full Hook Rankings by Score
          </div>
          {(topHooks ?? []).map((row, i) => <HookRow key={`top-${row.hook_type}-${row.niche}-${i}`} row={row} rank={i + 1} />)}

          {/* Section 5: Persuasion Pattern Explorer (Phase 5 — probabilistic multi-hook) */}
          <div style={{ ...S.card, marginTop: 8 }}>
            <div style={S.sectionHd}>
              Persuasion Pattern Explorer
              <HelpTip text="Probabilistic inference: shows all likely persuasion patterns with confidence weights. A title may activate multiple patterns simultaneously. Confidence = share of pattern signal mass — not a behavioral prediction." />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                style={{ flex: 1, background: '#0a0a0f', border: '1px solid #2a2a2a', color: '#ccc', borderRadius: 4, padding: '7px 10px', fontSize: '0.75rem', fontFamily: 'monospace' }}
                placeholder="Paste a YouTube title to analyze persuasion patterns…"
                value={titleInput}
                onChange={e => setTitleInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && classifyTitle()}
              />
              <button style={{ ...S.btn, whiteSpace: 'nowrap' }} onClick={classifyTitle} disabled={classifying}>
                {classifying ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>

            {classified && !classified.error && (
              <div style={{ padding: '12px 14px', background: '#0a0a0f', border: '1px solid #1a1a1a', borderRadius: 4 }}>
                <div style={{ fontSize: '0.68rem', color: '#555', marginBottom: 10, fontStyle: 'italic' }}>
                  "{classified.title}"
                </div>

                {/* Primary pattern */}
                {classified.primary_hook && classified.primary_hook !== 'unknown' && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={S.label}>Likely persuasion patterns</div>
                      <AmbiguityBadge score={classified.ambiguity_score} />
                    </div>
                    {(classified.predicted_hooks ?? []).map((hook, i) => (
                      <HookConfidenceBar key={hook.type} hook={hook} isTop={i === 0} />
                    ))}
                  </div>
                )}

                {classified.primary_hook === 'unknown' && (
                  <div style={{ fontSize: '0.7rem', color: '#555', marginBottom: 8 }}>
                    No strong persuasion patterns detected in this title.
                  </div>
                )}

                {/* Metadata row */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8, paddingTop: 8, borderTop: '1px solid #1a1a1a' }}>
                  {classified.semantic_confidence != null && (
                    <span style={{ fontSize: '0.62rem', color: '#444' }}>
                      semantic confidence: <b style={{ color: '#666' }}>{fmtPct(classified.semantic_confidence)}</b>
                    </span>
                  )}
                  {classified.ambiguity_score != null && (
                    <span style={{ fontSize: '0.62rem', color: '#444' }}>
                      ambiguity: <b style={{ color: '#666' }}>{fmtPct(classified.ambiguity_score)}</b>
                    </span>
                  )}
                  {classified.inference_version && (
                    <span style={{ fontSize: '0.62rem', color: '#333' }}>v{classified.inference_version}</span>
                  )}
                </div>

                <div style={{ fontSize: '0.58rem', color: '#2a2a2a', fontStyle: 'italic', lineHeight: 1.5 }}>
                  {classified.analytics_note}
                </div>
              </div>
            )}

            {classified?.error && (
              <div style={{ color: '#f87171', fontSize: '0.68rem' }}>{classified.error}</div>
            )}

            <div style={{ fontSize: '0.58rem', color: '#252525', marginTop: 8 }}>
              Probabilistic rule-based inference · v2.0 classifier · No LLM · Confidence = normalized pattern signal mass
            </div>
          </div>
        </>
      )}
    </div>
  );
}
