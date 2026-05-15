import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { fetchChannel, fetchChannelVideos } from '../api/youtube';
import * as storage from '../utils/storage';
import HookIntelligenceTab from './HookIntelligenceTab';

const PLAN_KEY = 'tubeintel_plan_v1';

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page:    { background: '#0a0a0a', minHeight: '100vh', color: '#e8e8e8', fontFamily: 'monospace', padding: '24px 32px' },
  header:  { fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginBottom: 4 },
  sub:     { fontSize: '0.7rem', color: '#666', marginBottom: 24 },
  tabs:    { display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid #222' },
  tab:     (active) => ({ padding: '8px 20px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, border: 'none', background: 'none', color: active ? '#7c4dff' : '#666', borderBottom: active ? '2px solid #7c4dff' : '2px solid transparent', fontFamily: 'monospace', transition: 'color 0.15s' }),
  card:    { background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: 16, marginBottom: 12 },
  row:     { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  label:   { fontSize: '0.65rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' },
  val:     { fontSize: '0.85rem', color: '#e8e8e8', fontWeight: 600 },
  tag:     { fontSize: '0.62rem', background: '#1a1a2e', color: '#7c4dff', border: '1px solid #2a2a4a', borderRadius: 3, padding: '2px 6px' },
  tagGreen:{ fontSize: '0.62rem', background: '#0d2818', color: '#4ade80', border: '1px solid #1a4a30', borderRadius: 3, padding: '2px 6px' },
  tagBlue: { fontSize: '0.62rem', background: '#0d1f3c', color: '#60a5fa', border: '1px solid #1a3060', borderRadius: 3, padding: '2px 6px' },
  tagAmber:{ fontSize: '0.62rem', background: '#2a1a00', color: '#fbbf24', border: '1px solid #4a3000', borderRadius: 3, padding: '2px 6px' },
  select:  { background: '#1a1a1a', border: '1px solid #333', color: '#ccc', borderRadius: 4, padding: '5px 10px', fontSize: '0.75rem', fontFamily: 'monospace', cursor: 'pointer' },
  grid:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 },
  grid4:   { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 },
  statBox: { background: '#111', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px 18px' },
  err:     { color: '#f87171', fontSize: '0.75rem', marginBottom: 12 },
  empty:   { color: '#444', fontSize: '0.75rem', padding: '32px 0', textAlign: 'center' },
  section: { marginBottom: 28 },
  sectionHd: { fontSize: '0.7rem', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12, borderBottom: '1px solid #1a1a1a', paddingBottom: 6 },
};

const SCORING_URL = import.meta.env.VITE_SCORING_URL || 'http://localhost:3002';

import { NICHES as ALL_NICHES } from '../utils/constants';

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.statusText); }
  return res.json();
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function fmtVph(v) {
  if (v == null) return '—';
  return parseFloat(v).toFixed(1) + ' vph';
}

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), s = parseInt(m[3] || 0);
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

function computeCadence(videos) {
  if (!videos || videos.length < 2) return null;
  const dates = videos
    .map(v => new Date(v.snippet?.publishedAt).getTime())
    .filter(d => !isNaN(d))
    .sort((a, b) => b - a);
  if (dates.length < 2) return null;
  const spanDays = (dates[0] - dates[dates.length - 1]) / 86400000;
  if (spanDays < 1) return null;
  return ((dates.length - 1) / spanDays * 7).toFixed(1);
}

function NicheFilter({ value, onChange }) {
  return (
    <select style={S.select} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">All niches</option>
      {ALL_NICHES.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const btnStyle = (disabled) => ({
  background: '#111', border: '1px solid #2a2a2a', color: disabled ? '#333' : '#aaa',
  borderRadius: 4, padding: '5px 14px', fontSize: '0.72rem', fontFamily: 'monospace',
  cursor: disabled ? 'not-allowed' : 'pointer',
});

function VideoTable({ rows, offset = 0, onRecreate }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>No videos yet. Ingest some channels first.</div>;
  return (
    <div>
      {rows.map((v, i) => (
        <div key={v.youtube_video_id || i} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 28, color: '#444', fontSize: '0.75rem', paddingTop: 2 }}>#{offset + i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: 4, fontWeight: 600 }}>{v.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {v.channel_name && <span style={S.tag}>{v.channel_name}</span>}
              {v.niche && <span style={S.tagAmber}>{v.niche}</span>}
              {v.duration_bucket && <span style={S.tagGreen}>{v.duration_bucket}</span>}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{fmt(v.views)} views</span>
              {v.published_at && <span style={{ fontSize: '0.7rem', color: '#555' }}>{v.published_at.slice(0, 10)}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
            <a href={`https://youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noreferrer"
              style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}>▶ watch</a>
            {onRecreate && (
              <button
                onClick={() => onRecreate(v)}
                style={{ fontSize: '0.62rem', border: '1px solid #00b89433', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', background: '#0a1a0f', color: '#00b894', whiteSpace: 'nowrap' }}
              >
                ↺ recreate
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaginatedVideoTable({ rows }) {
  const [page, setPage] = useState(0);
  const total      = rows?.length || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const slice      = (rows || []).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      <VideoTable rows={slice} offset={page * PAGE_SIZE} />
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}>
          <button style={btnStyle(page === 0)} disabled={page === 0} onClick={() => setPage(p => p - 1)}>← prev</button>
          <span style={{ fontSize: '0.72rem', color: '#555' }}>
            page {page + 1} of {totalPages} &nbsp;·&nbsp; {total} videos
          </span>
          <button style={btnStyle(page === totalPages - 1)} disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>next →</button>
        </div>
      )}
    </div>
  );
}

function VelocityTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>No velocity data yet. Snapshot refresh needed.</div>;
  return (
    <div>
      {rows.map((v, i) => (
        <div key={v.youtube_video_id || i} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 28, color: '#444', fontSize: '0.75rem', paddingTop: 2 }}>#{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: 4, fontWeight: 600 }}>{v.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {v.channel_name && <span style={S.tag}>{v.channel_name}</span>}
              {v.niche && <span style={S.tagAmber}>{v.niche}</span>}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 700 }}>{fmtVph(v.views_per_hour)}</span>
              <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{fmt(v.views)} total</span>
              {v.published_at && <span style={{ fontSize: '0.7rem', color: '#555' }}>{v.published_at.slice(0, 10)}</span>}
            </div>
          </div>
          <a href={`https://youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noreferrer"
            style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}>▶ watch</a>
        </div>
      ))}
    </div>
  );
}

function DurationBreakdown({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>No duration data yet.</div>;
  const ORDER = ['short', 'mid', 'long', 'longform'];
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.duration_bucket) - ORDER.indexOf(b.duration_bucket));
  const LABELS = { short: 'Short (<3 min)', mid: 'Mid (3–10 min)', long: 'Long (10–20 min)', longform: 'Longform (20+ min)' };
  const maxViews = Math.max(...rows.map(x => x.avg_views));

  return (
    <div>
      <div style={S.sectionHd}>Average views by video length</div>
      <div style={S.grid4}>
        {sorted.map(r => (
          <div key={r.duration_bucket} style={{ ...S.statBox, borderColor: r.avg_views === maxViews ? '#7c4dff' : '#1e1e1e' }}>
            <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: 4 }}>{LABELS[r.duration_bucket] || r.duration_bucket}</div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#e8e8e8' }}>{fmt(r.avg_views)}</div>
            <div style={{ fontSize: '0.65rem', color: '#555', marginTop: 4 }}>avg views · {r.video_count} vids</div>
            {r.avg_vph != null && <div style={{ fontSize: '0.7rem', color: '#60a5fa', marginTop: 2 }}>{fmtVph(r.avg_vph)} avg vph</div>}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={sorted} margin={{ top: 0, right: 8, left: -10, bottom: 4 }}>
          <XAxis dataKey="duration_bucket" tick={{ fill: '#555', fontSize: 11 }} />
          <YAxis tick={{ fill: '#555', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: '#111', border: '1px solid #333', fontSize: '0.72rem' }} formatter={v => fmt(v)} />
          <Bar dataKey="avg_views" fill="#7c4dff" radius={[3, 3, 0, 0]} name="avg views" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FrequencyChart({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>No upload frequency data yet.</div>;
  const data = rows.slice(0, 15).map(r => ({ name: (r.channel_name || r.channel_id).slice(0, 18), vps: r.videos_per_week }));
  return (
    <div>
      <div style={S.sectionHd}>Videos per week (last 90 days)</div>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 0, right: 8, left: -20, bottom: 60 }}>
          <XAxis dataKey="name" tick={{ fill: '#555', fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
          <YAxis tick={{ fill: '#555', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: '#111', border: '1px solid #333', fontSize: '0.72rem' }} />
          <Bar dataKey="vps" fill="#7c4dff" radius={[3, 3, 0, 0]} name="vids/week" />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 12 }}>
        {rows.map(r => (
          <div key={r.channel_id} style={{ ...S.row, marginBottom: 6 }}>
            <span style={{ minWidth: 160, fontSize: '0.75rem', color: '#bbb' }}>{r.channel_name || r.channel_id}</span>
            <span style={S.tagAmber}>{r.niche}</span>
            <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{r.videos_90d} in 90d</span>
            <span style={{ fontSize: '0.75rem', color: '#60a5fa' }}>{r.videos_per_week}/wk</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin: AI Niche Detection panel (only renders when admin_token in sessionStorage) ──
function AdminNicheDetection({ onNicheUpdated }) {
  const [token]    = useState(() => { try { return sessionStorage.getItem('admin_token'); } catch { return null; } });
  const [channels, setChannels] = useState([]);
  const [detecting, setDetecting] = useState({});
  const [results,   setResults]   = useState({});
  const [bulkJob,   setBulkJob]   = useState(null);
  const [err,       setErr]       = useState('');

  useEffect(() => {
    if (!token) return;
    fetch(`${SCORING_URL}/api/admin/intelligence/channels?admin_token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => setChannels(d.channels || []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!bulkJob || bulkJob.status !== 'running') return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${SCORING_URL}/api/intel/channels/redetect-all/${bulkJob.jobId}`);
        const d = await r.json();
        if (d.status === 'complete') { onNicheUpdated?.(); }
        setBulkJob(prev => ({ ...prev, ...d }));
      } catch {}
    }, 2500);
    return () => clearTimeout(t);
  }, [bulkJob, onNicheUpdated]);

  if (!token) return null;

  async function detectOne(ch) {
    setDetecting(p => ({ ...p, [ch.id]: true }));
    setResults(p => ({ ...p, [ch.id]: null }));
    setErr('');
    try {
      const r = await fetch(`${SCORING_URL}/api/intel/channels/${ch.id}/redetect`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setResults(p => ({ ...p, [ch.id]: d }));
      onNicheUpdated?.();
    } catch (e) { setErr(e.message); }
    finally { setDetecting(p => ({ ...p, [ch.id]: false })); }
  }

  async function detectAll(newOnly = false) {
    setErr('');
    const url = newOnly
      ? `${SCORING_URL}/api/intel/channels/redetect-all?new_only=true`
      : `${SCORING_URL}/api/intel/channels/redetect-all`;
    try {
      const r = await fetch(url, { method: 'POST' });
      const d = await r.json();
      const targetCount = newOnly ? newCount : channels.length;
      setBulkJob({ jobId: d.jobId, status: 'running', done: 0, total: targetCount, skipped: 0, errors: 0 });
    } catch (e) { setErr(e.message); }
  }

  const isRunning = bulkJob?.status === 'running';
  const newCount  = channels.filter(ch => !ch.identity_last_detected_at).length;

  return (
    <div style={{ background: '#0a0818', border: '1px solid #2a1a4a', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: channels.length ? 12 : 0 }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7c4dff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Admin · AI Niche Detection
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => detectAll(true)}
            disabled={isRunning || newCount === 0}
            style={{ background: '#0d1a0d', border: '1px solid #1a4a1a', borderRadius: 5, color: (isRunning || newCount === 0) ? '#555' : '#4ade80', fontSize: '0.72rem', fontWeight: 700, padding: '5px 12px', cursor: (isRunning || newCount === 0) ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}
          >
            {isRunning ? '…' : `Re-detect New (${newCount})`}
          </button>
          <button
            onClick={() => detectAll(false)}
            disabled={isRunning}
            style={{ background: '#1a0d3a', border: '1px solid #3a1a6a', borderRadius: 5, color: isRunning ? '#555' : '#a78bfa', fontSize: '0.72rem', fontWeight: 700, padding: '5px 12px', cursor: isRunning ? 'not-allowed' : 'pointer', fontFamily: 'monospace' }}
          >
            {isRunning ? `Re-detecting… (${bulkJob.done}/${bulkJob.total})` : 'Re-detect All'}
          </button>
        </div>
      </div>
      {err && <div style={{ fontSize: '0.72rem', color: '#f87171', marginBottom: 8 }}>{err}</div>}
      {bulkJob?.status === 'complete' && (
        <div style={{ fontSize: '0.72rem', color: '#4ade80', marginBottom: 8 }}>
          Done — {bulkJob.done} updated · {bulkJob.skipped} skipped · {bulkJob.errors} errors
        </div>
      )}
      {channels.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 240, overflowY: 'auto' }}>
          {channels.map(ch => {
            const res = results[ch.id];
            const identity = res?.identity;
            return (
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: '#080812', border: '1px solid #1a1a2a', borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.77rem', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.channel_name || ch.channel_id}
                  </div>
                  {identity ? (
                    <div style={{ fontSize: '0.65rem', color: '#a78bfa', marginTop: 2 }}>
                      → {identity.primary_niche} · {Math.round((identity.identity_confidence ?? 0) * 100)}% confidence
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.65rem', color: '#333', marginTop: 2 }}>{ch.niche}</div>
                  )}
                </div>
                <button
                  onClick={() => detectOne(ch)}
                  disabled={!!detecting[ch.id]}
                  style={{ background: 'none', border: '1px solid #2a1a4a', borderRadius: 4, color: detecting[ch.id] ? '#444' : '#7c4dff', fontSize: '0.65rem', padding: '3px 8px', cursor: detecting[ch.id] ? 'not-allowed' : 'pointer', fontFamily: 'monospace', flexShrink: 0 }}
                >
                  {detecting[ch.id] ? '…' : 'detect'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Niche Pulse Tab ──────────────────────────────────────────────────────────
function NichePulseTab() {
  const [niche, setNiche]   = useState('');
  const [subTab, setSubTab] = useState('top videos');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = niche ? `?niche=${encodeURIComponent(niche)}` : '?';
      const [durRes, vidRes, freqRes] = await Promise.all([
        apiFetch(`${SCORING_URL}/api/intel/content/durations${qs}`),
        apiFetch(`${SCORING_URL}/api/intel/competitor/top-videos${qs}&limit=200`),
        apiFetch(`${SCORING_URL}/api/intel/competitor/upload-frequency?niche=${niche}`),
      ]);
      setData({
        durations: durRes.durations,
        videos:    vidRes.videos,
        frequency: freqRes.channels,
      });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [niche]);

  useEffect(() => { load(); }, [load]);

  const SUB_TABS = ['top videos', 'duration sweet spot', 'upload cadence'];

  return (
    <div>
      <AdminNicheDetection onNicheUpdated={load} />
      <div style={{ ...S.row, marginBottom: 16 }}>
        <NicheFilter value={niche} onChange={setNiche} />
        {loading && <span style={{ color: '#555', fontSize: '0.7rem' }}>loading…</span>}
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={S.tabs}>
        {SUB_TABS.map(t => (
          <button key={t} style={S.tab(subTab === t)} onClick={() => setSubTab(t)}>{t}</button>
        ))}
      </div>

      {subTab === 'duration sweet spot' && data && <DurationBreakdown rows={data.durations} />}
      {subTab === 'top videos'        && data && <PaginatedVideoTable key={niche} rows={data.videos} />}
      {subTab === 'upload cadence'    && data && <FrequencyChart rows={data.frequency} />}
    </div>
  );
}

// ── Research a Channel Tab ───────────────────────────────────────────────────
function ResearchChannelTab() {
  const [input, setInput]     = useState('');
  const [channel, setChannel] = useState(null);
  const [videos, setVideos]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  async function search() {
    if (!input.trim()) return;
    setLoading(true); setErr(''); setChannel(null); setVideos(null);
    try {
      const ch  = await fetchChannel(input.trim());
      const vids = await fetchChannelVideos(ch.id, 25);
      setChannel(ch);
      setVideos(vids);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  function handleKey(e) {
    if (e.key === 'Enter') search();
  }

  const subs    = parseInt(channel?.statistics?.subscriberCount) || 0;
  const totalV  = parseInt(channel?.statistics?.videoCount) || 0;
  const totalVw = parseInt(channel?.statistics?.viewCount) || 0;
  const avgViews = totalV > 0 ? Math.round(totalVw / totalV) : null;
  const cadence = computeCadence(videos);

  const sortedByViews = videos
    ? [...videos].sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    : [];

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, maxWidth: 600 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="@handle, channel URL, or channel ID…"
          style={{
            flex: 1, background: '#111', border: '1px solid #333', color: '#ccc',
            borderRadius: 6, padding: '9px 14px', fontSize: '0.8rem', fontFamily: 'monospace',
            outline: 'none',
          }}
        />
        <button
          onClick={search}
          disabled={loading}
          style={{
            background: '#7c4dff', border: 'none', color: '#fff', borderRadius: 6,
            padding: '9px 20px', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 700,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'searching…' : 'Research'}
        </button>
      </div>

      {err && <div style={S.err}>{err}</div>}

      {!channel && !loading && (
        <div style={S.empty}>
          Enter any YouTube channel — @handle, URL, or channel ID — to see stats, top videos, and posting cadence.
        </div>
      )}

      {channel && (
        <div>
          {/* Channel header */}
          <div style={{ ...S.card, display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
            {channel.snippet?.thumbnails?.medium?.url && (
              <img
                src={channel.snippet.thumbnails.medium.url}
                alt=""
                style={{ width: 64, height: 64, borderRadius: '50%', border: '2px solid #2a2a2a', flexShrink: 0 }}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                {channel.snippet?.title}
              </div>
              {channel.snippet?.customUrl && (
                <div style={{ fontSize: '0.72rem', color: '#555', marginBottom: 6 }}>{channel.snippet.customUrl}</div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={S.tagBlue}>{fmt(subs)} subscribers</span>
                <span style={S.tag}>{fmt(totalV)} videos</span>
                <span style={S.tagGreen}>{fmt(totalVw)} total views</span>
              </div>
            </div>
            <a
              href={`https://youtube.com/channel/${channel.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              ↗ YouTube
            </a>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
            <div style={S.statBox}>
              <div style={S.label}>avg views / video</div>
              <div style={{ ...S.val, fontSize: '1.1rem', marginTop: 4 }}>{fmt(avgViews)}</div>
            </div>
            <div style={S.statBox}>
              <div style={S.label}>posting cadence</div>
              <div style={{ ...S.val, fontSize: '1.1rem', marginTop: 4 }}>{cadence ? `${cadence}/wk` : '—'}</div>
              <div style={{ fontSize: '0.62rem', color: '#555', marginTop: 2 }}>est. from last {videos?.length || 0} videos</div>
            </div>
            <div style={S.statBox}>
              <div style={S.label}>created</div>
              <div style={{ ...S.val, fontSize: '1.1rem', marginTop: 4 }}>
                {channel.snippet?.publishedAt ? channel.snippet.publishedAt.slice(0, 7) : '—'}
              </div>
            </div>
          </div>

          {/* Top 5 videos */}
          {sortedByViews.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionHd}>Top videos by views</div>
              {sortedByViews.slice(0, 5).map((v, i) => {
                const views = parseInt(v.statistics?.viewCount || 0);
                const likes = parseInt(v.statistics?.likeCount || 0);
                const dur   = parseDuration(v.contentDetails?.duration);
                return (
                  <div key={v.id} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 22, color: '#444', fontSize: '0.75rem', paddingTop: 2 }}>#{i + 1}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: 5, fontWeight: 600, lineHeight: 1.3 }}>
                        {v.snippet?.title}
                      </div>
                      <div style={{ display: 'flex', gap: 14 }}>
                        <span style={{ fontSize: '0.75rem', color: '#e8e8e8', fontWeight: 700 }}>{fmt(views)} views</span>
                        {likes > 0 && <span style={{ fontSize: '0.72rem', color: '#aaa' }}>{fmt(likes)} likes</span>}
                        {dur && <span style={{ fontSize: '0.72rem', color: '#555' }}>{dur}</span>}
                        {v.snippet?.publishedAt && (
                          <span style={{ fontSize: '0.7rem', color: '#444' }}>{v.snippet.publishedAt.slice(0, 10)}</span>
                        )}
                      </div>
                    </div>
                    <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}>▶ watch</a>
                  </div>
                );
              })}
            </div>
          )}

          {/* Recent videos */}
          {videos && videos.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionHd}>Recent {videos.length} videos</div>
              {videos.map((v, i) => {
                const views = parseInt(v.statistics?.viewCount || 0);
                const dur   = parseDuration(v.contentDetails?.duration);
                return (
                  <div key={v.id} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', padding: '10px 16px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', color: '#ccc', marginBottom: 4, fontWeight: 500, lineHeight: 1.3 }}>
                        {v.snippet?.title}
                      </div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        <span style={{ fontSize: '0.72rem', color: '#aaa' }}>{fmt(views)} views</span>
                        {dur && <span style={{ fontSize: '0.7rem', color: '#555' }}>{dur}</span>}
                        {v.snippet?.publishedAt && (
                          <span style={{ fontSize: '0.7rem', color: '#444' }}>{v.snippet.publishedAt.slice(0, 10)}</span>
                        )}
                      </div>
                    </div>
                    <a href={`https://youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"
                      style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}>▶ watch</a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── What To Post Tab ──────────────────────────────────────────────────────────
function WhatToPostTab({ onNavigate }) {
  const [niche, setNiche] = useState('');
  const [days, setDays]   = useState('90');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState('');
  const [subTab, setSubTab] = useState('titles');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = niche ? `?niche=${encodeURIComponent(niche)}` : '?';
      const [titlesRes, durRes, fmtRes] = await Promise.all([
        apiFetch(`${SCORING_URL}/api/intel/content/top-titles${qs}&days=${days}&limit=30`),
        apiFetch(`${SCORING_URL}/api/intel/content/durations${qs}`),
        apiFetch(`${SCORING_URL}/api/intel/content/rising-formats${qs}`),
      ]);
      setData({
        titles:  titlesRes.titles,
        durations: durRes.durations,
        formats:   fmtRes.formats,
      });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [niche, days]);

  useEffect(() => { load(); }, [load]);

  function handleRecreate(v) {
    const topic = `Inspired by: "${v.title}"${v.channel_name ? ` (from ${v.channel_name})` : ''} — ${fmt(v.views)} views. Create a similar video adapted for my channel and audience.`;
    storage.setJSON(PLAN_KEY, {
      topic,
      audience: '',
      currentStep: 1,
      completedSteps: [],
      brief: { topic: null, niche: null, patterns: null, voice: null, script: null, titles: null, seo: null, validation: null },
      savedAt: Date.now(),
    });
    onNavigate?.('plan');
  }

  const SUB_TABS = ['titles', 'duration sweet spot', 'rising formats'];

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 16 }}>
        <NicheFilter value={niche} onChange={setNiche} />
        <select style={S.select} value={days} onChange={e => setDays(e.target.value)}>
          <option value="30">Last 30 days</option>
          <option value="60">Last 60 days</option>
          <option value="90">Last 90 days</option>
        </select>
        {loading && <span style={{ color: '#555', fontSize: '0.7rem' }}>loading…</span>}
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={S.tabs}>
        {SUB_TABS.map(t => (
          <button key={t} style={S.tab(subTab === t)} onClick={() => setSubTab(t)}>{t}</button>
        ))}
      </div>

      {subTab === 'titles' && data && (
        <div>
          <div style={S.sectionHd}>Top performing titles (by views)</div>
          <VideoTable rows={data.titles} onRecreate={handleRecreate} />
        </div>
      )}

      {subTab === 'duration sweet spot' && data && (
        <DurationBreakdown rows={data.durations} />
      )}

      {subTab === 'rising formats' && data && (
        <RisingFormatsTable rows={data.formats} />
      )}
    </div>
  );
}

function RisingFormatsTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>Not enough data yet — need 60 days of ingested videos.</div>;
  return (
    <div>
      <div style={S.sectionHd}>Format activity: recent 30d vs prior 30d</div>
      {rows.map((r, i) => {
        const trend = r.recent_count > r.prior_count ? '▲' : r.recent_count < r.prior_count ? '▼' : '→';
        const color = r.recent_count > r.prior_count ? '#4ade80' : r.recent_count < r.prior_count ? '#f87171' : '#aaa';
        return (
          <div key={i} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontSize: '1rem', color, minWidth: 20 }}>{trend}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                {r.content_archetype && <span style={S.tagAmber}>{r.content_archetype}</span>}
                {r.format_type && <span style={S.tagGreen}>{r.format_type}</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.72rem', color: '#aaa' }}>
                <span>recent: <strong style={{ color: '#ccc' }}>{r.recent_count}</strong> videos</span>
                <span>prior: <strong style={{ color: '#ccc' }}>{r.prior_count}</strong> videos</span>
                {r.recent_avg_views != null && <span>avg views: <strong style={{ color: '#ccc' }}>{fmt(r.recent_avg_views)}</strong></span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Trend Detection Tab ───────────────────────────────────────────────────────
function TrendTab() {
  const [niche, setNiche]   = useState('');
  const [subTab, setSubTab] = useState('breakout');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = niche ? `?niche=${encodeURIComponent(niche)}` : '?';
      const [boRes, accRes, archRes, driftRes] = await Promise.all([
        apiFetch(`${SCORING_URL}/api/intel/trends/breakout${qs}&days=14`),
        apiFetch(`${SCORING_URL}/api/intel/trends/acceleration${qs}&limit=30`),
        apiFetch(`${SCORING_URL}/api/intel/trends/rising-archetypes${qs}`),
        apiFetch(`${SCORING_URL}/api/intel/trends/benchmark-drift${qs}`),
      ]);
      setData({
        breakout:   boRes.videos,
        spikes:     accRes.spikes,
        archetypes: archRes.archetypes,
        drift:      driftRes.history,
      });
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [niche]);

  useEffect(() => { load(); }, [load]);

  const SUB_TABS = ['breakout', 'acceleration', 'rising archetypes', 'benchmark drift'];

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 16 }}>
        <NicheFilter value={niche} onChange={setNiche} />
        {loading && <span style={{ color: '#555', fontSize: '0.7rem' }}>loading…</span>}
      </div>
      {err && <div style={S.err}>{err}</div>}

      <div style={S.tabs}>
        {SUB_TABS.map(t => (
          <button key={t} style={S.tab(subTab === t)} onClick={() => setSubTab(t)}>{t}</button>
        ))}
      </div>

      {subTab === 'breakout' && data && (
        <div>
          <div style={S.sectionHd}>Videos beating p75 benchmark — published last 14 days</div>
          <VelocityTable rows={data.breakout} />
        </div>
      )}

      {subTab === 'acceleration' && data && (
        <div>
          <div style={S.sectionHd}>Highest velocity acceleration (momentum gaining fast)</div>
          <AccelerationTable rows={data.spikes} />
        </div>
      )}

      {subTab === 'rising archetypes' && data && (
        <ArchetypeTable rows={data.archetypes} />
      )}

      {subTab === 'benchmark drift' && data && (
        <DriftChart data={data.drift} niche={niche} />
      )}
    </div>
  );
}

function AccelerationTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>No acceleration data yet. Snapshot refresh adds this over time.</div>;
  return (
    <div>
      {rows.map((v, i) => (
        <div key={v.youtube_video_id || i} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 28, color: '#444', fontSize: '0.75rem', paddingTop: 2 }}>#{i + 1}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: 4, fontWeight: 600 }}>{v.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {v.channel_name && <span style={S.tag}>{v.channel_name}</span>}
              {v.niche && <span style={S.tagAmber}>{v.niche}</span>}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <span style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 700 }}>{fmtVph(v.views_per_hour)}</span>
              <span style={{ fontSize: '0.75rem', color: '#4ade80' }}>accel: {v.velocity_acceleration?.toFixed(2) ?? '—'}</span>
              <span style={{ fontSize: '0.75rem', color: '#aaa' }}>{fmt(v.views)} total</span>
            </div>
          </div>
          <a href={`https://youtube.com/watch?v=${v.youtube_video_id}`} target="_blank" rel="noreferrer"
            style={{ fontSize: '0.65rem', color: '#7c4dff', textDecoration: 'none', whiteSpace: 'nowrap' }}>▶ watch</a>
        </div>
      ))}
    </div>
  );
}

function ArchetypeTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={S.empty}>Not enough data yet — need 60 days of ingested videos.</div>;
  return (
    <div>
      <div style={S.sectionHd}>Content archetype momentum: recent 30d vs prior 30d</div>
      {rows.map((r, i) => {
        const trend = r.recent_30d > r.prior_30d ? '▲' : r.recent_30d < r.prior_30d ? '▼' : '→';
        const color = r.recent_30d > r.prior_30d ? '#4ade80' : r.recent_30d < r.prior_30d ? '#f87171' : '#aaa';
        return (
          <div key={i} style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ fontSize: '1rem', color, minWidth: 20 }}>{trend}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                {r.content_archetype && <span style={S.tagAmber}>{r.content_archetype}</span>}
                {r.format_type && <span style={S.tagGreen}>{r.format_type}</span>}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.72rem', color: '#aaa' }}>
                <span>recent: <strong style={{ color: '#ccc' }}>{r.recent_30d}</strong></span>
                <span>prior: <strong style={{ color: '#ccc' }}>{r.prior_30d}</strong></span>
                {r.recent_avg_views != null && <span>avg: <strong style={{ color: '#ccc' }}>{fmt(r.recent_avg_views)}</strong></span>}
                {r.avg_vph != null && <span style={{ color: '#60a5fa' }}>{fmtVph(r.avg_vph)}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DriftChart({ data, niche }) {
  if (!data || data.length === 0) return <div style={S.empty}>No benchmark history yet. Drift builds up over multiple snapshot refreshes.</div>;

  const byBucket = {};
  for (const row of data) {
    const key = `${row.niche}|${row.duration_bucket}`;
    if (!byBucket[key]) byBucket[key] = [];
    if (byBucket[key].length < 8) byBucket[key].push(row);
  }

  const buckets = Object.keys(byBucket).filter(k => !niche || k.startsWith(niche));
  if (buckets.length === 0) return <div style={S.empty}>No drift data for selected niche.</div>;

  return (
    <div>
      {buckets.map(key => {
        const rows    = byBucket[key].reverse();
        const [, dur] = key.split('|');
        const chartData = rows.map(r => ({ t: r.snapshot_at.slice(0, 10), vph: r.median_vph, p75: r.p75_vph }));
        return (
          <div key={key} style={S.section}>
            <div style={S.sectionHd}>{key.replace('|', ' — ')} duration: {dur}</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 0, right: 8, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="t" tick={{ fill: '#555', fontSize: 9 }} />
                <YAxis tick={{ fill: '#555', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#111', border: '1px solid #333', fontSize: '0.72rem' }} formatter={v => v?.toFixed(2)} />
                <Legend wrapperStyle={{ fontSize: '0.68rem', color: '#666' }} />
                <Line type="monotone" dataKey="vph" stroke="#7c4dff" dot={false} name="median vph" />
                <Line type="monotone" dataKey="p75" stroke="#60a5fa" dot={false} name="p75 vph" strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
const TABS = ['Niche Pulse', 'Research a Channel', 'What To Post', 'Trends', 'Hook Intelligence'];

export default function CreatorIntelligence({ onNavigate }) {
  const [tab, setTab] = useState(0);

  return (
    <div style={S.page}>
      <div style={S.header}>Creator Intelligence</div>
      <div style={S.sub}>Niche benchmarks · Research any channel · What to post · Rising trend signals</div>

      <div style={{ ...S.tabs, marginBottom: 28 }}>
        {TABS.map((t, i) => (
          <button key={t} style={S.tab(tab === i)} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {tab === 0 && <NichePulseTab />}
      {tab === 1 && <ResearchChannelTab />}
      {tab === 2 && <WhatToPostTab onNavigate={onNavigate} />}
      {tab === 3 && <TrendTab />}
      {tab === 4 && <HookIntelligenceTab />}
    </div>
  );
}
