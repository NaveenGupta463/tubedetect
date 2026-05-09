import { useState, useEffect, useCallback } from 'react';
import { ROUTES } from '../config';

const NICHES = ['finance', 'productivity', 'ai_tools', 'creator_growth'];
const TABS   = ['Channels', 'Ingest Status', 'Quota', 'Cron Health', 'Patterns', 'Controls'];
const BUCKET_LABELS = ['1d', '3d', '7d', '14d', '30d', '90d', '365d'];

const S = {
  page:    { minHeight: '100vh', background: '#050508', color: '#ccc', fontFamily: 'monospace', padding: '24px 28px' },
  h1:      { fontSize: '1rem', fontWeight: 700, color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 },
  sub:     { fontSize: '0.72rem', color: '#333', marginBottom: 24 },
  card:    { background: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  label:   { fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#444', marginBottom: 6, display: 'block' },
  input:   { background: '#111', border: '1px solid #222', borderRadius: 6, color: '#ccc', padding: '8px 12px', width: '100%', fontSize: '0.82rem', boxSizing: 'border-box', fontFamily: 'monospace' },
  select:  { background: '#111', border: '1px solid #222', borderRadius: 6, color: '#ccc', padding: '8px 12px', fontSize: '0.82rem', fontFamily: 'monospace' },
  btn:     { background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: 6, color: '#8888ff', padding: '8px 16px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace' },
  btnGreen:{ background: '#0a1f0a', border: '1px solid #1a4a1a', borderRadius: 6, color: '#4ade80', padding: '8px 16px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace' },
  btnRed:  { background: '#1f0a0a', border: '1px solid #4a1a1a', borderRadius: 6, color: '#f87171', padding: '8px 16px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace' },
  tag:     { display: 'inline-block', background: '#111', border: '1px solid #222', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: '#666', marginRight: 4 },
  tagGreen:{ display: 'inline-block', background: '#0a1a0a', border: '1px solid #1a3a1a', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: '#4ade80' },
  tagRed:  { display: 'inline-block', background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: '#f87171' },
  row:     { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  col:     { display: 'flex', flexDirection: 'column', gap: 8 },
  err:     { fontSize: '0.75rem', color: '#f87171', marginTop: 6 },
  ok:      { fontSize: '0.75rem', color: '#4ade80', marginTop: 6 },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' },
  th:      { borderBottom: '1px solid #1a1a2e', padding: '6px 10px', textAlign: 'left', color: '#444', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '0.65rem' },
  td:      { borderBottom: '1px solid #111', padding: '7px 10px', color: '#999', verticalAlign: 'middle' },
};

function tokenUrl(url, token) {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}admin_token=${encodeURIComponent(token)}`;
}

async function apiFetch(url, token, opts = {}) {
  const r = await fetch(tokenUrl(url, token), {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

function StatBox({ label, value, sub }) {
  return (
    <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '14px 16px', minWidth: 120 }}>
      <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#8888ff', lineHeight: 1 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: '#333', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function TriggerButton({ label, url, token, onDone, style = S.btn }) {
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr]       = useState('');

  async function run() {
    setBusy(true); setResult(null); setErr('');
    try {
      const data = await apiFetch(url, token, { method: 'POST' });
      setResult(data);
      onDone?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <button onClick={run} disabled={busy} style={style}>
        {busy ? 'Running…' : label}
      </button>
      {result && <div style={S.ok}>{JSON.stringify(result).slice(0, 200)}</div>}
      {err    && <div style={S.err}>{err}</div>}
    </div>
  );
}

// ── Tab: Channels ─────────────────────────────────────────────────────────────
function ChannelsTab({ token, channels, onRefresh }) {
  const [singleRaw,   setSingleRaw]   = useState('');
  const [singleNiche, setSingleNiche] = useState('finance');
  const [bulkText,    setBulkText]    = useState('');
  const [bulkNiche,   setBulkNiche]   = useState('finance');
  const [msg,         setMsg]         = useState('');
  const [err,         setErr]         = useState('');
  const [busy,        setBusy]        = useState(false);

  function clearFeedback() { setMsg(''); setErr(''); }

  async function addSingle() {
    if (!singleRaw.trim()) return;
    setBusy(true); clearFeedback();
    try {
      // Resolve then add
      const resolved = await apiFetch(ROUTES.adminIntelResolve, token, {
        method: 'POST', body: JSON.stringify({ inputs: [singleRaw.trim()] }),
      });
      const r = resolved.results?.[0];
      if (!r?.ok) { setErr(r?.reason || 'Failed to resolve channel'); setBusy(false); return; }
      await apiFetch(ROUTES.adminIntelChannels, token, {
        method: 'POST',
        body: JSON.stringify({ channel_id: r.channel_id, niche: singleNiche }),
      });
      setMsg(`Added: ${r.channel_name || r.channel_id} → ${singleNiche}`);
      setSingleRaw('');
      onRefresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function addBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy(true); clearFeedback();
    try {
      const data = await apiFetch(ROUTES.adminIntelChannelsBulk, token, {
        method: 'POST',
        body: JSON.stringify({ channels: lines.map(raw => ({ raw, niche: bulkNiche })) }),
      });
      const ok  = data.results?.filter(r => r.ok).length ?? 0;
      const bad = data.results?.filter(r => !r.ok) ?? [];
      setMsg(`Added ${ok}/${lines.length} channels.${bad.length ? ' Failures: ' + bad.map(b => b.raw).join(', ') : ''}`);
      setBulkText('');
      onRefresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function toggleEnabled(ch) {
    try {
      await apiFetch(ROUTES.adminIntelChannelPatch(ch.id), token, {
        method: 'PATCH', body: JSON.stringify({ ingest_enabled: !ch.ingest_enabled }),
      });
      onRefresh();
    } catch (e) { setErr(e.message); }
  }

  async function toggleIgnore(ch) {
    try {
      await apiFetch(ROUTES.adminIntelChannelPatch(ch.id), token, {
        method: 'PATCH', body: JSON.stringify({ ignore_from_benchmarks: !ch.ignore_from_benchmarks }),
      });
      onRefresh();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      {/* Add single */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>Add Channel</div>
        <div style={{ ...S.row, marginBottom: 8 }}>
          <input
            style={{ ...S.input, flex: 3 }}
            placeholder="@handle, youtube.com/@Channel, or UC... ID"
            value={singleRaw}
            onChange={e => setSingleRaw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addSingle()}
          />
          <select style={S.select} value={singleNiche} onChange={e => setSingleNiche(e.target.value)}>
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button style={S.btnGreen} onClick={addSingle} disabled={busy}>
            {busy ? '…' : 'Add'}
          </button>
        </div>
        {msg && <div style={S.ok}>{msg}</div>}
        {err && <div style={S.err}>{err}</div>}
      </div>

      {/* Bulk paste */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 8 }}>Bulk Paste</div>
        <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: 8 }}>One per line — accepts @handles, full URLs, or raw UC… IDs</div>
        <textarea
          style={{ ...S.input, minHeight: 100, resize: 'vertical', marginBottom: 8 }}
          placeholder={'@Fireship\nhttps://youtube.com/@MrBeast\nUCX6OQ3DkcsbYNE6H8uQQuVA'}
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
        />
        <div style={S.row}>
          <select style={S.select} value={bulkNiche} onChange={e => setBulkNiche(e.target.value)}>
            {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button style={S.btnGreen} onClick={addBulk} disabled={busy || !bulkText.trim()}>
            {busy ? 'Resolving…' : `Add ${bulkText.split('\n').filter(l => l.trim()).length} Channels`}
          </button>
        </div>
      </div>

      {/* Channel list */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>
          Seeded Channels ({channels.length})
        </div>
        {!channels.length ? (
          <div style={{ color: '#333', fontSize: '0.78rem' }}>No channels seeded yet.</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['Channel', 'Niche', 'Last Ingested', 'Subs', 'Status'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.id}>
                  <td style={S.td}>
                    <div style={{ color: '#ccc', fontWeight: 600 }}>{ch.channel_name || ch.channel_id}</div>
                    <div style={{ fontSize: '0.65rem', color: '#333' }}>{ch.channel_id}</div>
                  </td>
                  <td style={S.td}><span style={S.tag}>{ch.niche}</span></td>
                  <td style={S.td} title={ch.last_ingested_at}>
                    {ch.last_ingested_at ? ch.last_ingested_at.slice(0, 10) : <span style={{ color: '#333' }}>never</span>}
                  </td>
                  <td style={S.td}>{ch.channel_subscribers?.toLocaleString() ?? '—'}</td>
                  <td style={S.td}>
                    <div style={S.row}>
                      <button
                        style={ch.ingest_enabled ? S.tagGreen : S.tagRed}
                        onClick={() => toggleEnabled(ch)}
                        title="Toggle ingest"
                      >
                        {ch.ingest_enabled ? 'enabled' : 'disabled'}
                      </button>
                      <button
                        style={ch.ignore_from_benchmarks ? S.tagRed : S.tag}
                        onClick={() => toggleIgnore(ch)}
                        title="Toggle benchmark inclusion"
                      >
                        {ch.ignore_from_benchmarks ? 'excluded' : 'included'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Tab: Ingest Status ────────────────────────────────────────────────────────
function IngestStatusTab({ status, channels }) {
  const snapshots = status?.snapshots?.by_bucket ?? [];
  const totalSnaps = snapshots.reduce((s, r) => s + (r.n ?? 0), 0);

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <StatBox label="Ingested Videos"  value={status?.videos?.ingested?.toLocaleString() ?? '—'} />
        <StatBox label="Total Snapshots"  value={totalSnaps.toLocaleString()} />
        <StatBox label="Channels Enabled" value={status?.channels?.enabled ?? '—'} sub={`of ${status?.channels?.total ?? '?'} total`} />
      </div>

      {/* Snapshots by bucket */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>Snapshots by Bucket</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BUCKET_LABELS.map(b => {
            const row = snapshots.find(r => r.bucket === b);
            return (
              <div key={b} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px', minWidth: 80, textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', marginBottom: 4 }}>{b}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: row?.n ? '#8888ff' : '#222' }}>
                  {row?.n?.toLocaleString() ?? 0}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Channel status */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>Per-Channel Ingest Status</div>
        {!channels.length ? (
          <div style={{ color: '#333', fontSize: '0.78rem' }}>No channels seeded.</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['Channel', 'Niche', 'Last Ingested', 'Enabled'].map(h => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.id}>
                  <td style={S.td}>{ch.channel_name || ch.channel_id}</td>
                  <td style={S.td}><span style={S.tag}>{ch.niche}</span></td>
                  <td style={S.td}>
                    {ch.last_ingested_at
                      ? <span style={{ color: '#4ade80' }}>{ch.last_ingested_at.slice(0, 19).replace('T', ' ')}</span>
                      : <span style={{ color: '#f87171' }}>never</span>}
                  </td>
                  <td style={S.td}>
                    <span style={ch.ingest_enabled ? S.tagGreen : S.tagRed}>
                      {ch.ingest_enabled ? 'yes' : 'no'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Tab: Quota ────────────────────────────────────────────────────────────────
function QuotaTab({ status }) {
  const q = status?.quota;
  if (!q) return <div style={{ color: '#333', fontSize: '0.78rem' }}>Loading quota data…</div>;
  const pct = q.pct_used ?? 0;
  const barColor = pct > 80 ? '#f87171' : pct > 50 ? '#fbbf24' : '#4ade80';

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <StatBox label="Used Today"   value={q.used?.toLocaleString()} sub={`of ${q.cutoff?.toLocaleString()} cutoff`} />
        <StatBox label="% Used"       value={`${pct}%`} />
        <StatBox label="Available"    value={q.available ? 'YES' : 'NO'} />
        <StatBox label="Daily Limit"  value={q.limit?.toLocaleString()} />
      </div>

      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>Daily Quota Usage</div>
        <div style={{ background: '#111', borderRadius: 6, height: 14, overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: '0.7rem', color: '#444' }}>
          {q.used} / {q.limit} units · resets midnight Pacific
        </div>
      </div>

      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>Calls by Type</div>
        <div style={{ ...S.row, gap: 10, flexWrap: 'wrap' }}>
          {['refresh_calls', 'miss_calls', 'ingest_calls'].map(k => (
            <div key={k} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', marginBottom: 4 }}>{k.replace('_calls', '')}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#8888ff' }}>{q[k] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Cron Health ──────────────────────────────────────────────────────────
function CronHealthTab({ status, channels }) {
  const q = status?.quota;
  const lastIngested = channels.reduce((latest, ch) => {
    if (!ch.last_ingested_at) return latest;
    return !latest || ch.last_ingested_at > latest ? ch.last_ingested_at : latest;
  }, null);

  const snapshots     = status?.snapshots?.by_bucket ?? [];
  const hasSnapshots  = snapshots.some(r => r.n > 0);

  const rows = [
    { job: 'Historical Ingest',  schedule: 'Daily 03:00 UTC', proxy: 'last_ingested_at',  health: lastIngested, note: 'Most recent channel ingest' },
    { job: 'Snapshot Cron',      schedule: 'Daily 04:00 UTC', proxy: 'snapshot_counts',   health: hasSnapshots ? 'snapshots present' : null, note: 'Bucket fill activity' },
    { job: 'Pattern Miner',      schedule: 'After snapshot',  proxy: 'niche_benchmarks',  health: status?.videos?.ingested > 0 ? 'triggered via snapshot' : null, note: 'Runs within snapshotCron' },
    { job: 'Feedback Cron',      schedule: 'Configured',      proxy: 'n/a',               health: null, note: 'Prediction feedback collection' },
    { job: 'Outcome Refresh',    schedule: 'Configured',      proxy: 'n/a',               health: null, note: 'Reality outcome tracking' },
  ];

  return (
    <div style={S.card}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 12 }}>
        Cron Job Health (proxy view)
      </div>
      <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: 14 }}>
        Full cron persistence not yet implemented — health inferred from data activity.
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            {['Job', 'Schedule', 'Last Activity', 'Signal', 'Note'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.job}>
              <td style={{ ...S.td, color: '#ccc', fontWeight: 600 }}>{r.job}</td>
              <td style={S.td}><span style={{ color: '#555' }}>{r.schedule}</span></td>
              <td style={S.td}>
                {r.health
                  ? <span style={{ color: '#4ade80' }}>{typeof r.health === 'string' ? r.health : r.health.slice(0, 19).replace('T', ' ')}</span>
                  : <span style={{ color: '#333' }}>unknown</span>}
              </td>
              <td style={S.td}><span style={{ color: '#444', fontSize: '0.65rem' }}>{r.proxy}</span></td>
              <td style={S.td}><span style={{ color: '#333', fontSize: '0.7rem' }}>{r.note}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Patterns ─────────────────────────────────────────────────────────────
function PatternsTab({ token }) {
  const [patterns,    setPatterns]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [filterNiche, setFilterNiche] = useState('all');
  const [filterBucket,setFilterBucket]= useState('30d');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(ROUTES.adminIntelPatterns, token);
      setPatterns(data.benchmarks ?? []);
    } catch (_) {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const niches  = [...new Set(patterns.map(p => p.niche))].sort();
  const visible = patterns.filter(p =>
    (filterNiche  === 'all' || p.niche  === filterNiche) &&
    (filterBucket === 'all' || p.bucket === filterBucket),
  );

  const fmt = v => v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 14 }}>
        <select style={S.select} value={filterNiche} onChange={e => setFilterNiche(e.target.value)}>
          <option value="all">All niches</option>
          {niches.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select style={S.select} value={filterBucket} onChange={e => setFilterBucket(e.target.value)}>
          <option value="all">All buckets</option>
          {BUCKET_LABELS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <button style={S.btn} onClick={load}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      {!visible.length ? (
        <div style={{ color: '#333', fontSize: '0.78rem' }}>
          No benchmark data yet — run a snapshot cycle to populate patterns.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                {['Niche', 'Bucket', 'Duration', 'N', 'Median VPH', 'P90 VPH', 'Median SAV', 'Med VSR', 'Med Accel', 'Updated'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p, i) => (
                <tr key={i}>
                  <td style={S.td}><span style={S.tag}>{p.niche}</span></td>
                  <td style={S.td}>{p.bucket}</td>
                  <td style={S.td}>{p.duration_bucket}</td>
                  <td style={{ ...S.td, color: '#8888ff' }}>{p.sample_size}</td>
                  <td style={S.td}>{fmt(p.median_vph)}</td>
                  <td style={S.td}>{fmt(p.p90_vph)}</td>
                  <td style={S.td}>{fmt(p.median_sav)}</td>
                  <td style={S.td}>{fmt(p.median_vsr)}</td>
                  <td style={S.td}>{fmt(p.median_accel)}</td>
                  <td style={{ ...S.td, fontSize: '0.65rem', color: '#333' }}>{p.computed_at?.slice(0, 10) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab: Controls ─────────────────────────────────────────────────────────────
function ControlsTab({ token, onRefresh }) {
  const triggers = [
    { label: 'Run Historical Ingest',  url: ROUTES.adminIntelIngestTrigger,    style: S.btnGreen, note: 'Fetch latest uploads from all enabled channels (quota-guarded)' },
    { label: 'Run Snapshot Refresh',   url: ROUTES.adminIntelSnapshotTrigger,  style: S.btnGreen, note: 'Refresh video stats + fill newly eligible buckets + recompute patterns' },
    { label: 'Recompute Patterns',     url: ROUTES.adminIntelPatternsRecompute,style: S.btn,      note: 'Rebuild niche_benchmarks from existing snapshots without API calls' },
    { label: 'Run Auto-Calibration',   url: ROUTES.adminIntelCalibrateTrigger, style: S.btn,      note: 'Apply observational + prediction signals to niche_bias scoring version' },
  ];

  return (
    <div style={{ ...S.col, gap: 12 }}>
      {triggers.map(t => (
        <div key={t.label} style={S.card}>
          <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 10 }}>{t.note}</div>
          <TriggerButton label={t.label} url={t.url} token={token} style={t.style} onDone={onRefresh} />
        </div>
      ))}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function AdminIntelligence() {
  const [token,     setToken]     = useState(() => sessionStorage.getItem('admin_token') ?? '');
  const [tokenInput,setTokenInput]= useState('');
  const [authed,    setAuthed]    = useState(() => !!sessionStorage.getItem('admin_token'));
  const [tab,       setTab]       = useState(0);
  const [status,    setStatus]    = useState(null);
  const [channels,  setChannels]  = useState([]);
  const [loadErr,   setLoadErr]   = useState('');

  const load = useCallback(async (tok) => {
    const t = tok ?? token;
    setLoadErr('');
    try {
      const [s, c] = await Promise.all([
        apiFetch(ROUTES.adminIntelStatus,   t),
        apiFetch(ROUTES.adminIntelChannels, t),
      ]);
      setStatus(s);
      setChannels(c.channels ?? []);
    } catch (e) {
      setLoadErr(e.message);
    }
  }, [token]);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  function saveToken() {
    const t = tokenInput.trim();
    sessionStorage.setItem('admin_token', t);
    setToken(t);
    setAuthed(true);
    setTokenInput('');
    load(t);
  }

  function clearToken() {
    sessionStorage.removeItem('admin_token');
    setToken(''); setAuthed(false); setStatus(null); setChannels([]);
  }

  return (
    <div style={S.page}>
      <div style={S.h1}>Intelligence Control Surface</div>
      <div style={S.sub}>Operator only · not visible in public navigation</div>

      {/* Token gate */}
      {!authed ? (
        <div style={{ ...S.card, maxWidth: 420 }}>
          <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 12 }}>Enter admin token to access controls</div>
          <div style={S.row}>
            <input
              type="password"
              style={{ ...S.input, flex: 1 }}
              placeholder="ADMIN_TOKEN"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveToken()}
            />
            <button style={S.btnGreen} onClick={saveToken}>Unlock</button>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#222', marginTop: 8 }}>
            Token stored in sessionStorage · clears on tab close
          </div>
        </div>
      ) : (
        <>
          {/* Header row */}
          <div style={{ ...S.row, marginBottom: 18, justifyContent: 'space-between' }}>
            <div style={{ ...S.row, gap: 6 }}>
              <span style={S.tagGreen}>authenticated</span>
              {status?.quota?.available === false && <span style={S.tagRed}>QUOTA EXHAUSTED</span>}
            </div>
            <button style={{ ...S.btn, fontSize: '0.7rem' }} onClick={clearToken}>Clear Token</button>
          </div>

          {loadErr && <div style={{ ...S.err, marginBottom: 12 }}>{loadErr}</div>}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid #1a1a2e', paddingBottom: 0 }}>
            {TABS.map((t, i) => (
              <button
                key={t}
                onClick={() => setTab(i)}
                style={{
                  background: tab === i ? '#0d0d1f' : 'transparent',
                  border: 'none', borderBottom: tab === i ? '2px solid #8888ff' : '2px solid transparent',
                  color: tab === i ? '#8888ff' : '#444',
                  padding: '8px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                  fontFamily: 'monospace',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 0 && <ChannelsTab   token={token} channels={channels}           onRefresh={() => load()} />}
          {tab === 1 && <IngestStatusTab status={status} channels={channels} />}
          {tab === 2 && <QuotaTab      status={status} />}
          {tab === 3 && <CronHealthTab status={status} channels={channels} />}
          {tab === 4 && <PatternsTab   token={token} />}
          {tab === 5 && <ControlsTab   token={token} onRefresh={() => load()} />}
        </>
      )}
    </div>
  );
}
