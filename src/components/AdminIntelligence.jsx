import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { ROUTES } from '../config';
import SemanticIntelligenceTab  from './SemanticIntelligenceTab';
import StrategyIntelligenceTab from './StrategyIntelligenceTab';
import { spring } from '../motion/spring';
import { NICHES } from '../utils/constants';

const FORMAT_TYPES    = ['tutorial','vlog','review','documentary','interview','podcast','livestream','compilation','essay','shorts','other'];
const AUDIENCE_STYLES = ['general','beginner','intermediate','expert','children','teens','professional'];
const BEHAVIOR_TAGS   = [
  'storytelling','comparison','review_based','analytical','educational',
  'personality_driven','debate','news_reaction','motivational','authority_driven',
  'commentary','case_study','deep_dive','explainer','viral_short_form',
  'cinematic','satirical','listicle','reaction_based','live_stream_style','opinion_based',
];
const ARCHETYPES = [
  'authority_educator','storyteller','analyst','reviewer',
  'entertainer','commentator','debater','interviewer',
  'personality_host','investigative_creator',
];
const TABS   = ['Channels', 'Auto-Ingested', 'Ingest Status', 'Quota', 'Cron Health', 'Patterns', 'Controls', 'Evolution', 'Discovery', 'Learning', 'Semantic', 'Strategy', 'Corpus', 'Communities'];
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

function maintenanceColor(status) {
  if (status === 'due') return { bg: '#1f0a0a', border: '#4a1a1a', color: '#f87171', label: 'due' };
  if (status === 'warning') return { bg: '#1f1a0a', border: '#4a3a1a', color: '#facc15', label: 'soon' };
  return { bg: '#0a1f0a', border: '#1a4a1a', color: '#4ade80', label: 'ok' };
}

function MaintenancePill({ status, count, title }) {
  if (!status) return null;
  const c = maintenanceColor(status);
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 16,
        padding: '0 5px',
        marginLeft: 6,
        borderRadius: 4,
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.color,
        fontSize: '0.55rem',
        lineHeight: 1,
        textTransform: 'uppercase',
      }}
    >
      {count && count > 1 ? count : c.label}
    </span>
  );
}

function tabMaintenance(tabName, maintenance) {
  const byKey = maintenance?.by_key || {};
  const groups = {
    'Ingest Status': ['historical_ingest'],
    'Cron Health': ['historical_ingest', 'snapshot_refresh', 'patterns', 'calibration'],
    Patterns: ['patterns'],
    Controls: ['historical_ingest', 'snapshot_refresh', 'patterns', 'calibration', 'louvain', 'community_backfill'],
    Evolution: ['calibration'],
    Learning: ['calibration'],
    Corpus: ['historical_ingest', 'louvain', 'community_backfill'],
    Communities: ['louvain', 'community_backfill'],
  };
  const keys = groups[tabName];
  if (!keys) return null;
  const items = keys.map(k => byKey[k]).filter(Boolean);
  if (!items.length) return null;
  const due = items.filter(i => i.status === 'due');
  const warning = items.filter(i => i.status === 'warning');
  const active = due.length ? due : warning;
  const status = due.length ? 'due' : warning.length ? 'warning' : 'ok';
  const title = items.map(i => `${i.label}: ${i.status}${i.age_hours == null ? '' : ` (${i.age_hours}h old)`}`).join('\n');
  return { status, count: active.length, title };
}

function RssSweepControl({ token }) {
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [status, setStatus] = useState(null);

  const fetchStatus = async () => {
    try {
      const s = await apiFetch(ROUTES.adminIntelRssSweepStatus, token);
      setStatus(s);
      return s;
    } catch (_) {}
  };

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(async () => {
      const s = await fetchStatus();
      if (!s?.running) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [status?.running]);

  async function trigger() {
    setBusy(true); setErr('');
    try {
      await apiFetch(ROUTES.adminIntelRssSweepTrigger, token, { method: 'POST' });
      await fetchStatus();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const pct = status?.total > 0 ? Math.round((status.checked / status.total) * 100) : 0;

  return (
    <div style={S.card}>
      <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 10 }}>
        Check every channel's RSS feed for new videos — zero quota cost. Only YouTube API is called for genuinely new video IDs found.
      </div>
      <button onClick={trigger} disabled={busy || status?.running} style={S.btnGreen}>
        {status?.running ? `Sweeping… ${pct}%` : busy ? 'Starting…' : 'Run RSS Sweep'}
      </button>
      {err && <div style={S.err}>{err}</div>}
      {status && (
        <div style={{ marginTop: 10 }}>
          {status.running && (
            <div style={{ background: '#1a1a1a', borderRadius: 4, height: 6, marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#4ade80', transition: 'width 0.4s ease' }} />
            </div>
          )}
          <div style={{ fontSize: '0.68rem', color: '#888', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>Channels: <b style={{ color: '#ccc' }}>{status.checked.toLocaleString()} / {status.total.toLocaleString()}</b></span>
            <span>New videos: <b style={{ color: '#4ade80' }}>{status.new_videos.toLocaleString()}</b></span>
            {status.running && status.started_at && (
              <span>Started: <b style={{ color: '#ccc' }}>{new Date(status.started_at).toLocaleTimeString()}</b></span>
            )}
            {!status.running && status.last_completed_at && (
              <span>Last run: <b style={{ color: '#ccc' }}>{new Date(status.last_completed_at).toLocaleString()}</b></span>
            )}
          </div>
        </div>
      )}
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
// ── Identity display helpers ──────────────────────────────────────────────────

function identityStrengthLabel(strength) {
  if (strength == null) return null;
  if (strength >= 0.7) return { label: 'Strong Identity', color: '#4ade80' };
  if (strength >= 0.4) return { label: 'Mixed Identity',  color: '#facc15' };
  return                      { label: 'Hybrid Identity', color: '#f97316' };
}

function parseJsonArr(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

// Badge colors per semantic layer
const B = {
  niche:    { bg: '#0d1526', border: '#1a3060', color: '#7aadff' },
  topic:    { bg: '#041a1a', border: '#0a3030', color: '#2dd4bf' },
  behavior: { bg: '#140d26', border: '#2a1a50', color: '#a78bfa' },
  archetype:{ bg: '#1a1200', border: '#3a2800', color: '#fbbf24' },
};

function LayerBadge({ text, layer, style }) {
  const c = B[layer] ?? B.niche;
  return (
    <span style={{ ...S.tag, background: c.bg, borderColor: c.border, color: c.color, ...style }}>
      {text}
    </span>
  );
}

function IdentityBadges({ ch }) {
  const behaviorTags  = parseJsonArr(ch.behavior_tags);
  const inferredTopics = parseJsonArr(ch.inferred_topics);
  const sl   = identityStrengthLabel(ch.identity_strength);
  const conf = ch.identity_confidence != null ? `${Math.round(ch.identity_confidence * 100)}%` : null;

  const tooltipLines = [
    sl   ? sl.label                         : null,
    conf ? `Confidence: ${conf}`            : null,
    ch.content_archetype ? `Archetype: ${ch.content_archetype}` : null,
    ch.identity_source   ? `Source: ${ch.identity_source}`     : null,
    ch.identity_reasoning ? ch.identity_reasoning               : null,
  ].filter(Boolean).join('\n');

  if (!ch.primary_niche) {
    return <span style={{ color: '#2a2a3a', fontSize: '0.65rem' }}>no identity</span>;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }} title={tooltipLines}>
      {/* Layer 1 — benchmark niche (blue) */}
      <LayerBadge text={ch.primary_niche} layer="niche" />
      {ch.secondary_niche && (
        <LayerBadge text={ch.secondary_niche} layer="niche" style={{ opacity: 0.65 }} />
      )}

      {/* Layer 2 — inferred topics (teal), max 2 shown */}
      {inferredTopics.slice(0, 2).map(t => (
        <LayerBadge key={t} text={t} layer="topic" />
      ))}
      {inferredTopics.length > 2 && (
        <span style={{ ...S.tag, color: '#2dd4bf44', borderColor: '#0a3030' }}>+{inferredTopics.length - 2}</span>
      )}

      {/* Layer 3 — behavior tags (purple), max 2 shown */}
      {behaviorTags.slice(0, 2).map(t => (
        <LayerBadge key={t} text={t} layer="behavior" />
      ))}
      {behaviorTags.length > 2 && (
        <span style={{ ...S.tag, color: '#a78bfa44', borderColor: '#2a1a50' }}>+{behaviorTags.length - 2}</span>
      )}

      {/* Layer 4 — archetype (amber) */}
      {ch.content_archetype && (
        <LayerBadge text={ch.content_archetype} layer="archetype" />
      )}

      {/* Confidence pill */}
      {sl && conf && (
        <span style={{ ...S.tag, color: sl.color, borderColor: sl.color + '44', background: 'transparent' }}>
          {conf}
        </span>
      )}
    </div>
  );
}

// ── Free-form chip input for inferred_topics ──────────────────────────────────

function TopicChipInput({ topics, onChange }) {
  const [draft, setDraft] = useState('');

  function addTopic() {
    const val = draft.toLowerCase().trim();
    if (!val || topics.includes(val) || topics.length >= 6) return;
    onChange([...topics, val]);
    setDraft('');
  }

  function removeTopic(t) {
    onChange(topics.filter(x => x !== t));
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {topics.map(t => (
          <span
            key={t}
            style={{ ...S.tag, background: B.topic.bg, borderColor: B.topic.border, color: B.topic.color, cursor: 'default' }}
          >
            {t}
            <span
              onClick={() => removeTopic(t)}
              style={{ marginLeft: 5, cursor: 'pointer', opacity: 0.6, fontSize: '0.75rem' }}
            >×</span>
          </span>
        ))}
        {topics.length === 0 && (
          <span style={{ color: '#2a2a3a', fontSize: '0.68rem' }}>none yet</span>
        )}
      </div>
      {topics.length < 6 && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            style={{ ...S.input, flex: 1, padding: '5px 8px', fontSize: '0.72rem' }}
            placeholder="type topic, press Enter"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
          />
          <button
            style={{ ...S.btn, padding: '5px 10px', fontSize: '0.68rem' }}
            onClick={addTopic}
            disabled={!draft.trim()}
          >+</button>
        </div>
      )}
      <div style={{ fontSize: '0.6rem', color: '#333', marginTop: 3 }}>
        What the content discusses · free-form · max 6
      </div>
    </div>
  );
}

// ── Identity Panel ────────────────────────────────────────────────────────────

function IdentityPanel({ ch, token, onSaved }) {
  const [result,    setResult]    = useState(null);
  const [detecting, setDetecting] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');
  const [edited,    setEdited]    = useState(null);

  const data = edited ?? result;
  const sl   = data ? identityStrengthLabel(data.identity_strength) : null;

  async function detect() {
    setDetecting(true); setErr(''); setResult(null); setEdited(null);
    try {
      const r = await apiFetch(ROUTES.adminIntelDetectIdentity(ch.id), token, { method: 'POST' });
      const normalized = {
        ...r,
        inferred_topics: parseJsonArr(r.inferred_topics),
        behavior_tags:   parseJsonArr(r.behavior_tags),
      };
      setResult(normalized);
      setEdited({ ...normalized });
    } catch (e) { setErr(e.message); }
    finally { setDetecting(false); }
  }

  async function save(source) {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      const url = source === 'manual'
        ? ROUTES.adminIntelSaveIdentityManual(ch.id)
        : ROUTES.adminIntelSaveIdentity(ch.id);
      await apiFetch(url, token, { method: 'POST', body: JSON.stringify(data) });
      onSaved?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  function toggleBehaviorTag(tag) {
    if (!edited) return;
    const tags = edited.behavior_tags ?? [];
    setEdited(p => ({
      ...p,
      behavior_tags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag],
    }));
  }

  function sectionLabel(text, tooltip) {
    return (
      <div style={{ ...S.label, cursor: 'help' }} title={tooltip}>{text}</div>
    );
  }

  return (
    <div style={{ background: '#08080f', border: '1px solid #1a1a30', borderRadius: 8, padding: 14, marginTop: 8 }}>
      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button style={{ ...S.btn, fontSize: '0.72rem', padding: '5px 12px' }} onClick={detect} disabled={detecting}>
          {detecting ? 'Detecting…' : 'Detect with AI'}
        </button>
        {data && (
          <>
            <button style={{ ...S.btnGreen, fontSize: '0.72rem', padding: '5px 12px' }} onClick={() => save('ai')} disabled={saving}>
              {saving ? 'Saving…' : 'Save (AI detected)'}
            </button>
            <button style={{ ...S.btn, fontSize: '0.72rem', padding: '5px 12px' }} onClick={() => save('manual')} disabled={saving}>
              Save as manual
            </button>
          </>
        )}
      </div>
      {err && <div style={S.err}>{err}</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Strength indicator */}
          {sl && (
            <div style={{ fontSize: '0.7rem', color: sl.color, fontWeight: 700 }}>
              {sl.label} · {Math.round((data.identity_confidence ?? 0) * 100)}% confidence
            </div>
          )}

          {/* Layer 1 — benchmark niches */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid #111' }}>
            <div>
              {sectionLabel('Primary Niche (blue — benchmark bucket)', 'Umbrella category used for benchmark routing and scoring')}
              <select
                style={{ ...S.select, fontSize: '0.72rem', padding: '5px 8px' }}
                value={edited?.primary_niche ?? ''}
                onChange={e => setEdited(p => ({ ...p, primary_niche: e.target.value }))}
              >
                {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              {sectionLabel('Secondary Niche', 'Optional secondary benchmark bucket')}
              <select
                style={{ ...S.select, fontSize: '0.72rem', padding: '5px 8px' }}
                value={edited?.secondary_niche ?? ''}
                onChange={e => setEdited(p => ({ ...p, secondary_niche: e.target.value || null }))}
              >
                <option value="">none</option>
                {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              {sectionLabel('Format Type', 'Primary structural shell of the video format')}
              <select
                style={{ ...S.select, fontSize: '0.72rem', padding: '5px 8px' }}
                value={edited?.format_type ?? ''}
                onChange={e => setEdited(p => ({ ...p, format_type: e.target.value || null }))}
              >
                <option value="">—</option>
                {FORMAT_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              {sectionLabel('Audience', 'Target audience sophistication')}
              <select
                style={{ ...S.select, fontSize: '0.72rem', padding: '5px 8px' }}
                value={edited?.audience_style ?? ''}
                onChange={e => setEdited(p => ({ ...p, audience_style: e.target.value || null }))}
              >
                <option value="">—</option>
                {AUDIENCE_STYLES.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Layer 2 — inferred topics (teal, free-form) */}
          <div style={{ paddingBottom: 10, borderBottom: '1px solid #111' }}>
            {sectionLabel('Inferred Topics (teal) — What the content discusses', 'Free-form semantic descriptors. Powers future clustering and embedding similarity.')}
            <TopicChipInput
              topics={edited?.inferred_topics ?? []}
              onChange={topics => setEdited(p => ({ ...p, inferred_topics: topics }))}
            />
          </div>

          {/* Layer 3 — behavior tags (purple, controlled) */}
          <div style={{ paddingBottom: 10, borderBottom: '1px solid #111' }}>
            {sectionLabel('Behavior Tags (purple) — How content is packaged', 'Structural mechanics and production patterns. Controlled vocabulary.')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {BEHAVIOR_TAGS.map(tag => {
                const active = (edited?.behavior_tags ?? []).includes(tag);
                return (
                  <span
                    key={tag}
                    onClick={() => toggleBehaviorTag(tag)}
                    style={{
                      ...S.tag,
                      cursor: 'pointer',
                      ...(active
                        ? { background: B.behavior.bg, borderColor: B.behavior.border, color: B.behavior.color }
                        : {}),
                    }}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Layer 4 — creator archetype (amber) */}
          <div>
            {sectionLabel('Creator Archetype (amber) — Psychological content persona', "The creator's communication style and psychological identity")}
            <select
              style={{ ...S.select, fontSize: '0.72rem', padding: '5px 8px' }}
              value={edited?.content_archetype ?? ''}
              onChange={e => setEdited(p => ({ ...p, content_archetype: e.target.value || null }))}
            >
              <option value="">—</option>
              {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Reasoning */}
          {data.identity_reasoning && (
            <div style={{ fontSize: '0.7rem', color: '#556', fontStyle: 'italic', borderLeft: '2px solid #1a1a30', paddingLeft: 8, marginTop: 2 }}>
              {data.identity_reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChannelsTab({ token, onRefresh }) {
  const [channels,   setChannels]   = useState([]);
  const [total,      setTotal]      = useState(0);
  const [offset,     setOffset]     = useState(0);
  const [search,     setSearch]     = useState('');
  const [searchInput,setSearchInput]= useState('');
  const LIMIT = 100;

  const fetchPage = useCallback(async (off, q) => {
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (q) params.set('q', q);
      const d = await apiFetch(`${ROUTES.adminIntelChannels}?${params}`, token);
      setChannels(d.channels ?? []);
      setTotal(d.total ?? 0);
      setOffset(off);
    } catch (_) {}
  }, [token]);

  useEffect(() => { fetchPage(0, ''); }, [fetchPage]);

  function doSearch() {
    setSearch(searchInput);
    fetchPage(0, searchInput);
  }


  const [singleRaw,     setSingleRaw]     = useState('');
  const [singleNiche,   setSingleNiche]   = useState('technology');
  const [bulkText,      setBulkText]      = useState('');
  const [bulkNiche,     setBulkNiche]     = useState('technology');
  const [msg,           setMsg]           = useState('');
  const [err,           setErr]           = useState('');
  const [busy,          setBusy]          = useState(false);
  const [detectBusy,    setDetectBusy]    = useState(false);
  const [detectResult,  setDetectResult]  = useState(null);
  const [detectProgress, setDetectProgress] = useState(null);
  const detectPollRef = useRef(null);
  const [editingNiche,  setEditingNiche]  = useState({});
  const [identityOpen,  setIdentityOpen]  = useState({});
  const [classStats,    setClassStats]    = useState(null);

  useEffect(() => {
    apiFetch(ROUTES.adminIntelClassificationStats, token)
      .then(d => setClassStats(d))
      .catch(() => {});
  }, [token, channels]);

  const classifiableNow = classStats?.classifiable_now ?? 0;

  async function runBulkDetect() {
    setDetectBusy(true);
    setDetectResult(null);
    setDetectProgress(null);
    try {
      const data = await apiFetch(ROUTES.adminIntelBulkDetectIdentity, token, { method: 'POST', body: '{}' });
      if (data.already_running || data.started) {
        // Poll for progress every 3 seconds
        detectPollRef.current = setInterval(async () => {
          try {
            const prog = await apiFetch(ROUTES.adminIntelBulkDetectIdentityProgress, token);
            setDetectProgress(prog);
            if (!prog.running) {
              clearInterval(detectPollRef.current);
              setDetectBusy(false);
              setDetectResult({ ok: true, detected: prog.detected, failed: prog.failed });
              onRefresh();
            }
          } catch (e) {
            clearInterval(detectPollRef.current);
            setDetectBusy(false);
            setDetectResult({ ok: false, error: 'Server unreachable — detection may still be running in background' });
          }
        }, 3000);
      } else {
        setDetectResult(data);
        setDetectBusy(false);
      }
    } catch (e) {
      setDetectResult({ ok: false, error: e.message });
      setDetectBusy(false);
    }
  }

  useEffect(() => () => clearInterval(detectPollRef.current), []);

  function clearFeedback() { setMsg(''); setErr(''); }

  async function addSingle() {
    if (!singleRaw.trim()) return;
    setBusy(true); clearFeedback();
    try {
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

  async function saveNiche(ch) {
    const niche = editingNiche[ch.id];
    if (!niche || niche === ch.niche) { setEditingNiche(p => ({ ...p, [ch.id]: undefined })); return; }
    try {
      await apiFetch(ROUTES.adminIntelChannelPatch(ch.id), token, {
        method: 'PATCH', body: JSON.stringify({ niche }),
      });
      setEditingNiche(p => ({ ...p, [ch.id]: undefined }));
      onRefresh();
    } catch (e) { setErr(e.message); }
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

  async function deleteChannel(ch) {
    if (!window.confirm(`Delete "${ch.channel_name || ch.channel_id}"? This cannot be undone.`)) return;
    try {
      await apiFetch(ROUTES.adminIntelChannelDelete(ch.id), token, { method: 'DELETE' });
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

      {/* Auto Bulk Niche Detection */}
      <div style={S.card}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', marginBottom: 6 }}>Auto Bulk Niche Detection</div>
        <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: 12 }}>
          Uses AI (OpenAI) to auto-detect niche, format, and identity for channels that have never been detected.
          Only runs on new channels — already-detected channels are skipped. Does not call the YouTube API.
          Channels with no locally ingested titles yet will be skipped (run ingest first).
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            style={classifiableNow > 0 ? S.btnGreen : { ...S.btn, opacity: 0.5, cursor: 'default' }}
            onClick={classifiableNow > 0 ? runBulkDetect : undefined}
            disabled={detectBusy || classifiableNow === 0}
          >
            {detectBusy
              ? 'Detecting…'
              : classifiableNow > 0
                ? `Auto-Detect ${classifiableNow} Classifiable Now`
                : 'All Channels Detected'}
          </button>
          {detectBusy && detectProgress && (
            <span style={{ fontSize: '0.68rem', color: '#fbbf24' }}>
              {detectProgress.done} / {detectProgress.total} · {detectProgress.detected} detected · {detectProgress.skipped ?? 0} skipped · {detectProgress.failed} failed
            </span>
          )}
          {detectBusy && !detectProgress && (
            <span style={{ fontSize: '0.68rem', color: '#fbbf24' }}>Starting…</span>
          )}
          {classStats && (
            <span style={{ fontSize: '0.68rem', color: '#555' }}>
              {classStats.classifiable_now} classifiable now · {classStats.awaiting_ingest} awaiting ingest · {classStats.never_detected} total undetected
            </span>
          )}
        </div>
        {detectResult && (
          <div style={{ marginTop: 10 }}>
            {detectResult.ok === false ? (
              <div style={S.err}>Error: {detectResult.error}</div>
            ) : (
              <div style={{ fontSize: '0.72rem', color: '#4ade80' }}>
                Done — {detectResult.detected} detected, {detectResult.failed} failed
                {detectResult.message ? ` · ${detectResult.message}` : ''}
              </div>
            )}
            {(detectResult.errors ?? []).length > 0 && (
              <div style={{ marginTop: 6 }}>
                {detectResult.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: '0.65rem', color: '#f87171', marginTop: 2 }}>
                    {e.channel_name || e.channel_id}: {e.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Channel list */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#666', flex: 1 }}>
            Seeded Channels ({total.toLocaleString()}) — showing {offset + 1}–{Math.min(offset + LIMIT, total)}
          </div>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Search name or ID…"
            style={{ ...S.input, width: 180, padding: '4px 8px', fontSize: '0.72rem' }}
          />
          <button style={{ ...S.btn, padding: '4px 10px', fontSize: '0.72rem' }} onClick={doSearch}>Search</button>
          {search && <button style={{ ...S.btn, padding: '4px 8px', fontSize: '0.68rem' }} onClick={() => { setSearchInput(''); setSearch(''); fetchPage(0, ''); }}>✕ Clear</button>}
        </div>
        {!channels.length ? (
          <div style={{ color: '#333', fontSize: '0.78rem' }}>No channels found.</div>
        ) : (
          <div>
            {channels.map(ch => (
              <div key={ch.channel_id} style={{ borderBottom: '1px solid #111', paddingBottom: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  {/* Channel name */}
                  <div style={{ minWidth: 180, flex: 2 }}>
                    <div style={{ color: '#ccc', fontWeight: 600, fontSize: '0.8rem' }}>{ch.channel_name || ch.channel_id}</div>
                    <div style={{ fontSize: '0.62rem', color: '#333' }}>{ch.channel_id}</div>
                    <div style={{ marginTop: 5 }}>
                      <IdentityBadges ch={ch} />
                    </div>
                  </div>

                  {/* Niche editor */}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    {editingNiche[ch.id] !== undefined ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <select
                          style={{ ...S.select, fontSize: '0.7rem', padding: '4px 8px' }}
                          value={editingNiche[ch.id]}
                          onChange={e => setEditingNiche(p => ({ ...p, [ch.id]: e.target.value }))}
                        >
                          {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <button style={{ ...S.btnGreen, padding: '3px 8px', fontSize: '0.68rem' }} onClick={() => saveNiche(ch)}>✓</button>
                        <button style={{ ...S.btn, padding: '3px 8px', fontSize: '0.68rem' }} onClick={() => setEditingNiche(p => ({ ...p, [ch.id]: undefined }))}>✕</button>
                      </div>
                    ) : (
                      <span
                        style={{ ...S.tag, cursor: 'pointer' }}
                        title="Click to change benchmark niche"
                        onClick={() => setEditingNiche(p => ({ ...p, [ch.id]: ch.niche }))}
                      >
                        {ch.niche} ✎
                      </span>
                    )}
                    <div style={{ fontSize: '0.6rem', color: '#2a2a3a', marginTop: 3 }}>
                      {ch.last_ingested_at ? ch.last_ingested_at.slice(0, 10) : 'never ingested'}
                    </div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
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
                    <button
                      style={{ ...S.btn, fontSize: '0.68rem', padding: '3px 8px' }}
                      onClick={() => setIdentityOpen(p => ({ ...p, [ch.id]: !p[ch.id] }))}
                    >
                      {identityOpen[ch.id] ? 'close identity' : 'identity'}
                    </button>
                    <button
                      onClick={() => deleteChannel(ch)}
                      style={{ background: 'none', border: '1px solid #3a1a1a', borderRadius: 4, color: '#f87171', padding: '3px 8px', cursor: 'pointer', fontSize: '0.68rem', fontFamily: 'monospace' }}
                    >
                      delete
                    </button>
                  </div>
                </div>

                {identityOpen[ch.id] && (
                  <IdentityPanel
                    ch={ch}
                    token={token}
                    onSaved={() => { onRefresh(); setIdentityOpen(p => ({ ...p, [ch.id]: false })); }}
                  />
                )}
              </div>
            ))}
            {/* Pagination */}
            {total > LIMIT && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, justifyContent: 'center' }}>
                <button
                  style={{ ...S.btn, padding: '4px 12px', fontSize: '0.72rem' }}
                  disabled={offset === 0}
                  onClick={() => fetchPage(Math.max(0, offset - LIMIT), search)}
                >← Prev</button>
                <span style={{ fontSize: '0.7rem', color: '#555' }}>
                  Page {Math.floor(offset / LIMIT) + 1} of {Math.ceil(total / LIMIT)}
                </span>
                <button
                  style={{ ...S.btn, padding: '4px 12px', fontSize: '0.72rem' }}
                  disabled={offset + LIMIT >= total}
                  onClick={() => fetchPage(offset + LIMIT, search)}
                >Next →</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Auto-Ingested ────────────────────────────────────────────────────────
function AutoIngestedTab({
  token,
  discoverRunning,   discoverResult,   discoverErr,   onDiscover,
  promoteRunning,    promoteResult,    promoteErr,    onPromote,
  ingestOnlyRunning, ingestOnlyResult, ingestOnlyErr, onIngestOnly,
}) {
  const [channels, setChannels] = useState(null);
  const [err, setErr]           = useState('');
  const [corpusStats, setCorpusStats] = useState(null);

  function load() {
    apiFetch(ROUTES.adminIntelAutoPromoted, token)
      .then(d => setChannels(d.channels ?? []))
      .catch(e => setErr(e.message));
    apiFetch(ROUTES.corpusStats, token)
      .then(d => { if (d.ok) setCorpusStats(d.stats); })
      .catch(() => {});
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => { if (!promoteRunning && promoteResult) load(); }, [promoteRunning]);

  const byNiche = channels
    ? channels.reduce((acc, ch) => {
        const n = ch.niche || 'unknown';
        acc[n] = (acc[n] || 0) + 1;
        return acc;
      }, {})
    : {};

  function RunResultPanel({ result, accentColor }) {
    if (!result) return null;
    const ingestLog    = result.log?.find(e => e.step === 'light_ingest')?.data;
    const promoteLog   = result.log?.find(e => e.step === 'auto_promote')?.data;
    const searchLog    = result.log?.find(e => e.step === 'discovery_search')?.data;
    const classifyLog  = result.log?.find(e => e.step === 'niche_classify')?.data;
    const evalLog      = result.log?.find(e => e.step === 'quality_eval')?.data;
    const trainingLog  = result.log?.find(e => e.step === 'training_gate')?.data;
    const ingestedChs  = ingestLog?.channels ?? [];
    const byNicheRun   = ingestedChs.reduce((a, c) => { a[c.niche || 'unknown'] = (a[c.niche || 'unknown'] || 0) + 1; return a; }, {});
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ background: '#0a0f0a', border: `1px solid ${accentColor}33`, borderRadius: 6, padding: '10px 14px', marginBottom: 10, fontSize: '0.7rem', color: accentColor, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {result._ran_at && <span style={{ color: '#555' }}>Last run: {new Date(result._ran_at).toLocaleString()}</span>}
          <span>Quota: <strong>{result.quota_used}</strong></span>
          <span>Duration: <strong>{((result.duration_ms ?? 0) / 1000).toFixed(1)}s</strong></span>
          {ingestLog  && <span>Ingested: <strong>{ingestLog.ok ?? 0}</strong></span>}
          {searchLog  && <span>Discovered: <strong>{searchLog.search_discovered ?? 0}</strong></span>}
          {classifyLog && classifyLog.attempted > 0 && <span>Classified: <strong>{classifyLog.classified ?? 0}</strong> / {classifyLog.attempted}</span>}
          {evalLog    && <span>Evaluated: <strong>{evalLog.evaluated ?? 0}</strong></span>}
          {trainingLog && (trainingLog.promoted > 0
            ? <span>Newly eligible: <strong style={{ color: '#4ade80' }}>+{trainingLog.promoted}</strong></span>
            : evalLog?.evaluated > 0
              ? <span style={{ color: '#555' }}>Confirmed: <strong>{trainingLog.unchanged ?? evalLog.evaluated}</strong></span>
              : null
          )}
          {trainingLog && trainingLog.demoted > 0 && <span style={{ color: '#f87171' }}>Demoted: <strong>{trainingLog.demoted}</strong></span>}
          {promoteLog && promoteLog.candidates > 0 && <span>Added to DB: <strong>{promoteLog.promoted ?? 0}</strong> / {promoteLog.candidates}</span>}
        </div>
        {Object.keys(byNicheRun).length > 0 && (
          <div style={{ ...S.row, marginBottom: 10, flexWrap: 'wrap' }}>
            {Object.entries(byNicheRun).map(([niche, count]) => (
              <span key={niche} style={{ ...S.tag, color: '#8888ff', borderColor: '#2a2a4e' }}>{niche}: {count}</span>
            ))}
          </div>
        )}
        {ingestedChs.length > 0 && (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Channel</th>
                <th style={S.th}>Niche</th>
                <th style={S.th}>Subscribers</th>
                <th style={S.th}>Videos</th>
                <th style={S.th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {ingestedChs.map((ch, i) => (
                <tr key={i}>
                  <td style={S.td}>
                    <div style={{ color: '#ccc', fontWeight: 600 }}>{ch.title}</div>
                    {ch.handle && <div style={{ fontSize: '0.62rem', color: '#555' }}>@{ch.handle}</div>}
                    <div style={{ fontSize: '0.6rem', color: '#444' }}>{ch.channel_id}</div>
                  </td>
                  <td style={S.td}><span style={S.tag}>{ch.niche || '—'}</span></td>
                  <td style={{ ...S.td, color: '#888' }}>{ch.subscriber_count ? ch.subscriber_count.toLocaleString() : '—'}</td>
                  <td style={{ ...S.td, color: '#4ade80', fontWeight: 600 }}>{ch.videos_ingested}</td>
                  <td style={{ ...S.td, color: '#555', fontSize: '0.68rem' }}>{ch.discovery_source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* ── Corpus health bar ─────────────────────────────────────────────── */}
      {corpusStats && (
        <div style={{ background: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: '0.68rem', color: '#555', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span style={{ color: '#333', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '0.6rem' }}>Corpus</span>
          <span><strong style={{ color: '#888' }}>{corpusStats.channels?.toLocaleString()}</strong> channels</span>
          <span><strong style={{ color: '#4ade80' }}>{corpusStats.training?.toLocaleString()}</strong> training-eligible
            {corpusStats.channels > 0 && <span style={{ color: '#333' }}> ({Math.round(corpusStats.training / corpusStats.channels * 100)}%)</span>}
          </span>
          <span><strong style={{ color: '#888' }}>{corpusStats.videos?.toLocaleString()}</strong> videos</span>
          {corpusStats.pendingQuality > 0 && <span style={{ color: '#f59e0b' }}>{corpusStats.pendingQuality} unscored</span>}
        </div>
      )}
      {/* ── Action buttons ──────────────────────────────────────────────────── */}
      <div style={{ ...S.row, gap: 12, marginBottom: 16 }}>
        {/* Discover & Ingest */}
        <div style={{ ...S.card, flex: 1 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#8888ff' }}>Discover &amp; Ingest</div>
              <div style={{ fontSize: '0.65rem', color: '#444', marginTop: 2 }}>
                Find new channels in underrepresented niches via YouTube search + AI discovery, then light-ingest them into the corpus. (up to 5,000 quota)
              </div>
            </div>
            <button
              style={discoverRunning ? { ...S.btnGreen, opacity: 0.6, cursor: 'default', whiteSpace: 'nowrap' } : { ...S.btnGreen, whiteSpace: 'nowrap' }}
              onClick={discoverRunning ? undefined : onDiscover}
              disabled={discoverRunning}
            >
              {discoverRunning ? 'Running…' : 'Discover & Ingest'}
            </button>
          </div>
          {discoverErr && <div style={S.err}>{discoverErr}</div>}
          <RunResultPanel result={discoverResult} accentColor="#8888ff" />
        </div>

        {/* Ingest Only */}
        <div style={{ ...S.card, flex: 1 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b' }}>Ingest Only</div>
              <div style={{ fontSize: '0.65rem', color: '#444', marginTop: 2 }}>
                Light-ingest queued channels without running new searches. Use this to process the backlog of discovered channels. (up to 8,000 quota)
              </div>
            </div>
            <button
              style={ingestOnlyRunning ? { ...S.btnGreen, opacity: 0.6, cursor: 'default', whiteSpace: 'nowrap', background: '#78350f', borderColor: '#92400e' } : { ...S.btnGreen, whiteSpace: 'nowrap', background: '#78350f', borderColor: '#92400e' }}
              onClick={ingestOnlyRunning ? undefined : onIngestOnly}
              disabled={ingestOnlyRunning}
            >
              {ingestOnlyRunning ? 'Running…' : 'Ingest Only'}
            </button>
          </div>
          {ingestOnlyErr && <div style={S.err}>{ingestOnlyErr}</div>}
          <RunResultPanel result={ingestOnlyResult} accentColor="#f59e0b" />
        </div>

        {/* Evaluate & Promote */}
        <div style={{ ...S.card, flex: 1 }}>
          <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80' }}>Evaluate &amp; Promote</div>
              <div style={{ fontSize: '0.65rem', color: '#444', marginTop: 2 }}>
                Run quality evaluation on corpus channels, then auto-promote those passing the gate (quality_score≥60) into your channel database.
              </div>
            </div>
            <button
              style={promoteRunning ? { ...S.btnGreen, opacity: 0.6, cursor: 'default', whiteSpace: 'nowrap' } : { ...S.btnGreen, whiteSpace: 'nowrap' }}
              onClick={promoteRunning ? undefined : onPromote}
              disabled={promoteRunning}
            >
              {promoteRunning ? 'Running…' : 'Evaluate & Promote'}
            </button>
          </div>
          {promoteErr && <div style={S.err}>{promoteErr}</div>}
          <RunResultPanel result={promoteResult} accentColor="#4ade80" />
        </div>
      </div>

      {/* ── Promoted channels list ────────────────────────────────────────────── */}
      <div style={S.card}>
        {err && <div style={S.err}>{err}</div>}
        {!channels && !err && <div style={{ fontSize: '0.72rem', color: '#444' }}>Loading…</div>}
        {channels && (
          <>
            <div style={{ ...S.row, marginBottom: 16 }}>
              <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 18px' }}>
                <div style={{ fontSize: '0.6rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Total Auto-Ingested</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#8888ff' }}>{channels.length}</div>
              </div>
              {Object.entries(byNiche).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([niche, count]) => (
                <div key={niche} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 18px' }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{niche}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#4ade80' }}>{count}</div>
                </div>
              ))}
            </div>
            {channels.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: '#444', padding: '20px 0' }}>
                No auto-promoted channels yet. The corpus scheduler promotes channels once they pass quality evaluation (usually takes a few daily cycles after ingestion).
              </div>
            ) : (
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Channel</th>
                    <th style={S.th}>Niche</th>
                    <th style={S.th}>Subscribers</th>
                    <th style={S.th}>Notes</th>
                    <th style={S.th}>Promoted At</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map(ch => (
                    <tr key={ch.channel_id}>
                      <td style={S.td}>
                        <div style={{ color: '#ccc', fontWeight: 600 }}>{ch.channel_name || ch.channel_id}</div>
                        <div style={{ fontSize: '0.62rem', color: '#555', marginTop: 2 }}>{ch.channel_id}</div>
                      </td>
                      <td style={S.td}>
                        <span style={S.tag}>{ch.niche}</span>
                      </td>
                      <td style={{ ...S.td, color: '#888' }}>
                        {ch.channel_subscribers ? ch.channel_subscribers.toLocaleString() : '—'}
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: '0.65rem', color: '#555' }}>{ch.notes || '—'}</span>
                      </td>
                      <td style={{ ...S.td, color: '#555', fontSize: '0.68rem' }}>
                        {ch.added_at ? new Date(ch.added_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab: Ingest Status ────────────────────────────────────────────────────────
function IngestStatusTab({ status }) {
  const snapshots  = status?.snapshots?.by_bucket ?? [];
  const totalSnaps = snapshots.reduce((s, r) => s + (r.n ?? 0), 0);
  const never      = status?.channels?.never_ingested ?? '—';
  const enabled    = status?.channels?.enabled ?? '—';
  const total      = status?.channels?.total   ?? '?';

  return (
    <div>
      <div style={{ ...S.row, marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <StatBox label="Ingested Videos"    value={status?.videos?.ingested?.toLocaleString() ?? '—'} />
        <StatBox label="Total Snapshots"    value={totalSnaps.toLocaleString()} />
        <StatBox label="Channels Enabled"   value={enabled} sub={`of ${total} total`} />
        <StatBox label="Pending Ingest"     value={never}   sub="last_ingested_at IS NULL" />
      </div>

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

      <div style={{ ...S.card, fontSize: '0.72rem', color: '#555' }}>
        Per-channel ingest details available in the <b style={{ color: '#888' }}>Channels</b> tab — search by name or ID.
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
function fmtTs(iso) {
  if (!iso) return null;
  return iso.slice(0, 19).replace('T', ' ') + ' UTC';
}

function hoursAgo(iso) {
  if (!iso) return null;
  const diff = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (diff < 1)    return `${Math.round(diff * 60)}m ago`;
  if (diff < 24)   return `${Math.round(diff)}h ago`;
  return `${Math.round(diff / 24)}d ago`;
}

function CronHealthTab({ status }) {
  const ts  = status?.job_last_run ?? {};

  const rows = [
    {
      job:      'Historical Ingest',
      schedule: 'Daily 03:00 UTC',
      ts:       ts.historical_ingest,
      note:     'Fetches new videos from ingested channels',
    },
    {
      job:      'Snapshot Refresh',
      schedule: 'Daily 04:00 UTC',
      ts:       ts.snapshot_refresh,
      note:     'Captures view/like growth snapshots (7d, 30d…)',
    },
    {
      job:      'Recompute Patterns',
      schedule: 'After snapshot',
      ts:       ts.recompute_patterns,
      note:     'Rebuilds niche VPH benchmarks from snapshots',
    },
    {
      job:      'Auto Calibrate',
      schedule: 'On demand / trigger',
      ts:       ts.auto_calibrate,
      note:     'Applies niche bias corrections from calibration data',
    },
  ];

  return (
    <div style={S.card}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#aaa', marginBottom: 16 }}>
        Job Last Run
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            {['Job', 'Schedule', 'Last Run (UTC)', 'Age', 'Purpose'].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const ago   = hoursAgo(r.ts);
            const stale = r.ts ? (Date.now() - new Date(r.ts).getTime()) / 3_600_000 > 48 : true;
            return (
              <tr key={r.job}>
                <td style={{ ...S.td, color: '#ccc', fontWeight: 600 }}>{r.job}</td>
                <td style={{ ...S.td, color: '#555', fontSize: '0.68rem' }}>{r.schedule}</td>
                <td style={S.td}>
                  {r.ts
                    ? <span style={{ color: stale ? '#f97316' : '#4ade80', fontFamily: 'monospace', fontSize: '0.72rem' }}>{fmtTs(r.ts)}</span>
                    : <span style={{ color: '#444', fontSize: '0.72rem' }}>never run</span>}
                </td>
                <td style={{ ...S.td, color: stale ? '#f97316' : '#888', fontSize: '0.72rem' }}>
                  {ago ?? '—'}
                </td>
                <td style={{ ...S.td, color: '#444', fontSize: '0.68rem' }}>{r.note}</td>
              </tr>
            );
          })}
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

// ── Tab: Communities ──────────────────────────────────────────────────────────
const NICHE_COLORS = {
  technology: '#60a5fa', finance: '#4ade80', education: '#a78bfa', gaming: '#f472b6',
  music: '#fb923c', travel: '#34d399', food: '#fbbf24', health: '#f87171',
  fitness: '#86efac', entertainment: '#c084fc', lifestyle: '#67e8f9', sports: '#fcd34d',
  news: '#94a3b8', business: '#6ee7b7', beauty: '#f9a8d4', comedy: '#fde68a',
  science: '#93c5fd', philosophy: '#d8b4fe', productivity: '#bbf7d0', other: '#6b7280',
};

function CommunitiesTab({ token }) {
  const [data, setData]   = useState(null);
  const [err, setErr]     = useState('');
  const [search, setSearch] = useState('');
  const [minSize, setMinSize] = useState(20);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    apiFetch(ROUTES.adminIntelCommunities, token)
      .then(d => { if (d.ok) setData(d); })
      .catch(e => setErr(e.message));
  }, [token]);

  if (err) return <div style={S.err}>{err}</div>;
  if (!data) return <div style={{ fontSize: '0.72rem', color: '#444' }}>Loading…</div>;

  if (data.total_communities === 0) {
    return (
      <div style={{ ...S.card, textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: '0.8rem', color: '#555', marginBottom: 8 }}>No communities detected yet.</div>
        <div style={{ fontSize: '0.68rem', color: '#333' }}>Go to Controls → Run Louvain Clustering to detect communities.</div>
      </div>
    );
  }

  const filtered = data.communities.filter(c =>
    c.size >= minSize &&
    (!search || c.top_niche.includes(search.toLowerCase()) ||
     c.community_id.includes(search) ||
     c.top_channels.some(ch => ch.title?.toLowerCase().includes(search.toLowerCase())))
  );

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Communities',      value: data.total_communities, color: '#8888ff' },
          { label: 'Assigned Channels', value: data.total_assigned.toLocaleString(), color: '#4ade80' },
          { label: 'Avg Size',         value: Math.round(data.total_assigned / data.total_communities), color: '#f59e0b' },
          { label: 'Largest',          value: data.communities[0]?.size ?? 0, color: '#f472b6' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
            <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <input
          style={{ ...S.input, flex: 1 }}
          placeholder="Search by niche, community ID, or channel name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: '0.65rem', color: '#555', whiteSpace: 'nowrap' }}>Min size</span>
          <input
            type="number"
            min={1}
            style={{ ...S.input, width: 64, textAlign: 'center' }}
            value={minSize}
            onChange={e => setMinSize(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <span style={{ fontSize: '0.65rem', color: '#444' }}>({filtered.length} shown)</span>
        </div>
      </div>

      {/* Community cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {filtered.map(c => {
          const isExpanded = expanded === c.community_id;
          const totalInComm = Object.values(c.niches).reduce((a, b) => a + b, 0);
          const nicheEntries = Object.entries(c.niches).sort((a, b) => b[1] - a[1]);

          return (
            <div
              key={c.community_id}
              style={{ ...S.card, cursor: 'pointer', borderColor: isExpanded ? '#8888ff44' : '#1a1a2e' }}
              onClick={() => setExpanded(isExpanded ? null : c.community_id)}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: '0.6rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Community {c.community_id}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: NICHE_COLORS[c.top_niche] ?? '#888', marginTop: 2 }}>{c.top_niche}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#ccc' }}>{c.size}</div>
                  <div style={{ fontSize: '0.58rem', color: '#444' }}>channels</div>
                </div>
              </div>

              {/* Niche bar */}
              <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                {nicheEntries.slice(0, 8).map(([niche, count]) => (
                  <div
                    key={niche}
                    style={{ width: `${(count / totalInComm) * 100}%`, background: NICHE_COLORS[niche] ?? '#444', minWidth: 2 }}
                  />
                ))}
              </div>

              {/* Niche tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: isExpanded ? 10 : 0 }}>
                {nicheEntries.slice(0, 5).map(([niche, count]) => (
                  <span key={niche} style={{ ...S.tag, color: NICHE_COLORS[niche] ?? '#888', borderColor: (NICHE_COLORS[niche] ?? '#888') + '33', fontSize: '0.6rem' }}>
                    {niche} {count}
                  </span>
                ))}
                {nicheEntries.length > 5 && (
                  <span style={{ ...S.tag, fontSize: '0.6rem', color: '#444' }}>+{nicheEntries.length - 5} more</span>
                )}
              </div>

              {/* Expanded: top channels */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid #1a1a2e', paddingTop: 8 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Top Channels</div>
                  {c.top_channels.map((ch, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #0d0d12' }}>
                      <div style={{ fontSize: '0.68rem', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{ch.title ?? '—'}</div>
                      <div style={{ fontSize: '0.6rem', color: '#555', flexShrink: 0 }}>
                        {ch.subscriber_count ? (ch.subscriber_count >= 1_000_000 ? `${(ch.subscriber_count / 1_000_000).toFixed(1)}M` : `${(ch.subscriber_count / 1000).toFixed(0)}K`) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: Controls ─────────────────────────────────────────────────────────────
function ControlsTab({ token, onRefresh }) {
  const triggers = [
    { label: 'Run Historical Ingest', url: ROUTES.adminIntelIngestTrigger, style: S.btnGreen, note: 'Fetch latest uploads from all enabled channels (quota-guarded)' },
    { label: 'Run Snapshot Refresh',         url: ROUTES.adminIntelSnapshotTrigger,       style: S.btnGreen, note: 'Refresh video stats for ALL ingested videos + fill newly eligible buckets + recompute patterns' },
    { label: 'Snapshot — New Videos Only',   url: ROUTES.adminIntelSnapshotRecentTrigger, style: S.btnGreen, note: 'Only refreshes videos that have never been snapshotted — use this after each hourly ingest to avoid wasting quota on already-refreshed videos' },
    { label: 'Recompute Patterns',     url: ROUTES.adminIntelPatternsRecompute,style: S.btn,      note: 'Rebuild niche_benchmarks from existing snapshots without API calls' },
    { label: 'Run Auto-Calibration',   url: ROUTES.adminIntelCalibrateTrigger, style: S.btn,      note: 'Apply observational + prediction signals to niche_bias scoring version' },
    { label: 'Run Louvain Clustering', url: ROUTES.adminIntelLouvainRun,        style: S.btn, note: 'Detect communities in the corpus graph and assign community_id to every channel. Takes 5–30s. Run once corpus has 5,000+ channels.' },
    { label: 'Backfill Community IDs', url: ROUTES.adminIntelCommunityBackfill, style: S.btn, note: 'Copy community_id from corpus → ingested_channels. Run after Louvain to assign communities to all saved channels, including ones added before corpus existed.' },
    { label: 'Run Country Detection (Full Batch)', url: ROUTES.adminIntelCountryDetectTrigger, style: S.btn, note: 'Tag region for all untagged channels in one pass. Fast paths (bio, script, Hinglish) run instantly; comment-based detection paced at 100ms/channel. Runs in background.' },
  ];

  return (
    <div style={{ ...S.col, gap: 12 }}>
      <RssSweepControl token={token} />
      {triggers.map(t => (
        <div key={t.label} style={S.card}>
          <div style={{ fontSize: '0.7rem', color: '#444', marginBottom: 10 }}>{t.note}</div>
          <TriggerButton label={t.label} url={t.url} token={token} style={t.style} onDone={onRefresh} />
        </div>
      ))}
    </div>
  );
}

// ── Evolution helpers ─────────────────────────────────────────────────────────

const VEL_COLOR = { Stable: '#4ade80', Improving: '#60a5fa', Volatile: '#f87171', Drifting: '#fbbf24' };
const WARN_COLOR = { red: '#f87171', amber: '#fbbf24', none: '#444' };

function EvoSection({ title, children, right }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a1a2e', paddingBottom: 6, marginBottom: 14 }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#555', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function InsufficientData({ msg }) {
  return (
    <div style={{ fontSize: '0.72rem', color: '#444', fontStyle: 'italic', padding: '12px 0' }}>
      {msg ?? 'Accumulating intelligence data — insufficient historical prediction samples'}
    </div>
  );
}

function DeltaIndicator({ value, unit = '%', invert = false }) {
  if (value == null) return <span style={{ color: '#333' }}>—</span>;
  const isPositive = invert ? value < 0 : value > 0;
  const color = isPositive ? '#4ade80' : value === 0 ? '#555' : '#f87171';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '–';
  return <span style={{ color, fontWeight: 700 }}>{arrow} {Math.abs(value).toFixed(1)}{unit}</span>;
}

function WarnBadge({ level, children }) {
  const c = { red: '#f87171', amber: '#fbbf24', none: '#444' };
  const bg = { red: '#1f0a0a', amber: '#1f1700', none: '#0d0d12' };
  const bd = { red: '#4a1a1a', amber: '#3a2800', none: '#1a1a2e' };
  return (
    <span style={{ display: 'inline-block', background: bg[level] ?? bg.none, border: `1px solid ${bd[level] ?? bd.none}`, borderRadius: 4, padding: '2px 8px', fontSize: '0.68rem', color: c[level] ?? c.none }}>
      {children}
    </span>
  );
}

// ── Evolution: Health Score ───────────────────────────────────────────────────
function HealthSection({ data }) {
  if (!data) return <InsufficientData />;
  const { health_score, components, learning_velocity, velocity_inputs, history } = data;
  const velColor = VEL_COLOR[learning_velocity] ?? '#888';

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        {/* Big score */}
        <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 10, padding: '20px 28px', minWidth: 160 }}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Intelligence Health</div>
          <div style={{ fontSize: '2.6rem', fontWeight: 700, color: health_score >= 70 ? '#4ade80' : health_score >= 40 ? '#fbbf24' : '#f87171', lineHeight: 1 }}>
            {health_score}
          </div>
          <div style={{ fontSize: '0.65rem', color: '#333', marginTop: 4 }}>/ 100</div>
        </div>
        {/* Velocity */}
        <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 10, padding: '20px 24px' }}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Learning Velocity</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: velColor }}>{learning_velocity ?? '—'}</div>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {velocity_inputs && Object.entries(velocity_inputs).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, fontSize: '0.65rem' }}>
                <span style={{ color: '#333', width: 130 }}>{k.replace(/_/g, ' ')}</span>
                <span style={{ color: '#666' }}>{typeof v === 'number' ? v.toFixed(4) : v}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Component breakdown */}
        <div style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 10, padding: '16px 20px', minWidth: 200 }}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Score Components</div>
          {components && [
            ['Accuracy ×0.40',    components.accuracy_score],
            ['Calibration ×0.20', components.calibration_score],
            ['Stability ×0.25',   components.stability_score],
            ['Drift ×0.15',       components.drift_score],
          ].map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, gap: 12 }}>
              <span style={{ fontSize: '0.7rem', color: '#555' }}>{label}</span>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: val >= 70 ? '#4ade80' : val >= 40 ? '#fbbf24' : '#f87171' }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Health score history */}
      {history?.length >= 2 && (
        <div style={{ height: 100 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#111" />
              <XAxis dataKey="created_at" hide />
              <YAxis domain={[0, 100]} tick={{ fill: '#333', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem' }} formatter={v => [v, 'health']} labelFormatter={() => ''} />
              <Line type="monotone" dataKey="health_score" stroke="#8888ff" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Evolution: Prediction Accuracy ────────────────────────────────────────────
function AccuracySection({ data }) {
  if (!data || data.insufficient_data) return <InsufficientData msg={data?.message} />;
  const { rolling_7d, rolling_30d, weekly } = data;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          ['7d Accuracy',    rolling_7d?.accurate_pct,  '%'],
          ['30d Accuracy',   rolling_30d?.accurate_pct, '%'],
          ['7d FP Rate',     rolling_7d?.fp_rate,       '%'],
          ['7d FN Rate',     rolling_7d?.fn_rate,       '%'],
          ['30d FP Count',   rolling_30d?.fp_count,     ''],
          ['30d FN Count',   rolling_30d?.fn_count,     ''],
        ].map(([label, val, unit]) => (
          <div key={label} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px', minWidth: 100 }}>
            <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#8888ff' }}>{val != null ? `${val}${unit}` : '—'}</div>
          </div>
        ))}
      </div>
      {weekly?.length >= 2 && (
        <div style={{ height: 130 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekly} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#111" />
              <XAxis dataKey="week" tick={{ fill: '#333', fontSize: 9 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#333', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem' }} />
              <Line type="monotone" dataKey="accurate_pct" name="Accuracy %" stroke="#4ade80" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="fp" name="FP" stroke="#f87171" dot={false} strokeWidth={1} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="fn" name="FN" stroke="#fbbf24" dot={false} strokeWidth={1} strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Evolution: Score Distribution ─────────────────────────────────────────────
function ScoreDistSection({ data }) {
  if (!data || data.no_calibration) return <InsufficientData msg={data?.message ?? 'No calibration comparison available yet'} />;
  const { before, after, weekly } = data;
  const bands = ['weak', 'average', 'strong'];
  const bandColors = { weak: '#f87171', average: '#fbbf24', strong: '#4ade80' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['Before Calibration', before], ['After Calibration', after]].map(([label, d]) => (
          <div key={label} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 16px', minWidth: 200 }}>
            <div style={{ fontSize: '0.65rem', color: '#444', marginBottom: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
            {d ? bands.map(b => (
              <div key={b} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.7rem', color: bandColors[b] }}>{b}</span>
                <span style={{ fontSize: '0.7rem', color: '#666' }}>{d[b] ?? 0} <span style={{ color: '#333' }}>({d.total > 0 ? Math.round(d[b] / d.total * 100) : 0}%)</span></span>
              </div>
            )) : <span style={{ color: '#333', fontSize: '0.7rem' }}>no data</span>}
          </div>
        ))}
      </div>
      {weekly?.length >= 2 && (
        <div style={{ height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#111" />
              <XAxis dataKey="week" tick={{ fill: '#333', fontSize: 9 }} />
              <YAxis tick={{ fill: '#333', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem' }} />
              {bands.map(b => <Bar key={b} dataKey={b} stackId="a" fill={bandColors[b]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Evolution: Benchmark Drift ────────────────────────────────────────────────
function DriftSection({ data }) {
  if (!data || data.insufficient_history) return <InsufficientData msg={data?.message} />;
  const { drift, heatmap, warnings, batches } = data;
  const niches   = [...new Set(heatmap?.map(h => h.niche) ?? [])].sort();
  const durBucks = ['short', 'medium', 'long', 'unknown'];

  return (
    <div>
      {warnings?.map((w, i) => (
        <div key={i} style={{ background: w.severity === 'red' ? '#1f0a0a' : '#1f1700', border: `1px solid ${w.severity === 'red' ? '#4a1a1a' : '#3a2800'}`, borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: '0.72rem', color: w.severity === 'red' ? '#f87171' : '#fbbf24' }}>
          {w.severity === 'red' ? '⚠ ' : '△ '}{w.message}
        </div>
      ))}
      <div style={{ fontSize: '0.65rem', color: '#333', marginBottom: 10 }}>
        {batches?.current?.snapshot_at?.slice(0, 16)} vs {batches?.previous?.snapshot_at?.slice(0, 16)}
      </div>

      {/* Heatmap */}
      {niches.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '0.65rem', color: '#444', marginBottom: 8, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Stability Heatmap</div>
          <div style={{ display: 'grid', gridTemplateColumns: `120px repeat(${durBucks.length}, 1fr)`, gap: 2, fontSize: '0.65rem' }}>
            <div style={{ color: '#333' }} />
            {durBucks.map(d => <div key={d} style={{ color: '#444', textAlign: 'center', padding: '2px 0' }}>{d}</div>)}
            {niches.map(niche => (
              <>
                <div key={niche} style={{ color: '#666', display: 'flex', alignItems: 'center' }}>{niche}</div>
                {durBucks.map(d => {
                  const cell = heatmap?.find(h => h.niche === niche && h.duration_bucket === d);
                  const drift = cell?.max_drift ?? 0;
                  const bg = drift > 40 ? '#2a0a0a' : drift > 20 ? '#1f1700' : drift > 5 ? '#0a1a0a' : '#0d0d12';
                  const color = drift > 40 ? '#f87171' : drift > 20 ? '#fbbf24' : drift > 5 ? '#4ade80' : '#333';
                  return (
                    <div key={d} style={{ background: bg, borderRadius: 4, padding: '6px 4px', textAlign: 'center', color, fontWeight: drift > 20 ? 700 : 400 }}>
                      {cell ? `${drift.toFixed(0)}%` : '—'}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      )}

      {/* Drift table */}
      {drift?.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              {['Niche', 'Bucket', 'Dur', 'Prev VPH', 'Curr VPH', 'Delta', 'Sample Δ', 'Status'].map(h => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {drift.filter(d => d.warning_level !== 'none').concat(drift.filter(d => d.warning_level === 'none')).map((d, i) => (
                <tr key={i}>
                  <td style={S.td}><span style={S.tag}>{d.niche}</span></td>
                  <td style={S.td}>{d.bucket}</td>
                  <td style={S.td}>{d.duration_bucket}</td>
                  <td style={S.td}>{d.prev_median_vph?.toFixed(2) ?? '—'}</td>
                  <td style={S.td}>{d.curr_median_vph?.toFixed(2) ?? '—'}</td>
                  <td style={S.td}><DeltaIndicator value={d.delta_pct} /></td>
                  <td style={S.td}><DeltaIndicator value={d.sample_change} unit="" /></td>
                  <td style={S.td}><WarnBadge level={d.warning_level}>{d.warning_level}</WarnBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Evolution: Signal Weights ─────────────────────────────────────────────────
function SignalWeightsSection({ data }) {
  if (!data?.versions?.length) return <InsufficientData msg="No scoring versions recorded yet" />;
  const niches = [...new Set(data.versions.flatMap(v => Object.keys(v.weights ?? {})))].sort();
  if (!niches.length) return <InsufficientData msg="No niche bias weights recorded" />;

  const chartData = data.versions
    .filter(v => v.version_type === 'niche_bias')
    .map(v => ({ label: v.created_at?.slice(0, 10), ...v.weights }));

  const LINE_COLORS = ['#8888ff', '#4ade80', '#f87171', '#fbbf24', '#60a5fa', '#a78bfa'];

  return (
    <div>
      {chartData.length >= 2 ? (
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#111" />
              <XAxis dataKey="label" tick={{ fill: '#333', fontSize: 9 }} />
              <YAxis tick={{ fill: '#333', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.65rem', color: '#555' }} />
              {niches.map((n, i) => (
                <Line key={n} type="monotone" dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} dot={{ r: 2 }} strokeWidth={1.5} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <InsufficientData msg="Needs at least 2 calibration events for trend chart" />}
    </div>
  );
}

// ── Evolution: Confidence Reliability ────────────────────────────────────────
function ConfidenceSection({ data }) {
  if (!data || data.insufficient_data) return <InsufficientData msg={data?.message} />;
  const { bins } = data;
  if (!bins?.length) return <InsufficientData />;

  return (
    <div>
      <div style={{ height: 130, marginBottom: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 4, right: 8, left: -30, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#111" />
            <XAxis dataKey="confidence_bucket" tick={{ fill: '#444', fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fill: '#333', fontSize: 10 }} />
            <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem' }} formatter={(v, n) => [`${v}%`, n]} />
            <Bar dataKey="accurate_pct" name="Accurate %" fill="#4ade80">
              {bins.map((b, i) => <Cell key={i} fillOpacity={b.sparse ? 0.35 : 1} fill={b.sparse ? '#4ade80' : '#4ade80'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table style={S.table}>
        <thead><tr>
          {['Confidence', 'Total', 'Accurate %', 'MAE', 'FP', 'FN', 'Note'].map(h => <th key={h} style={S.th}>{h}</th>)}
        </tr></thead>
        <tbody>
          {bins.map((b, i) => (
            <tr key={i} style={{ opacity: b.sparse ? 0.5 : 1 }}>
              <td style={S.td}><span style={S.tag}>{b.confidence_bucket}</span></td>
              <td style={S.td}>{b.total}</td>
              <td style={{ ...S.td, color: b.accurate_pct >= 70 ? '#4ade80' : b.accurate_pct >= 40 ? '#fbbf24' : '#f87171' }}>{b.accurate_pct ?? '—'}%</td>
              <td style={S.td}>{b.mae?.toFixed(2) ?? '—'}</td>
              <td style={S.td}>{b.fp_count}</td>
              <td style={S.td}>{b.fn_count}</td>
              <td style={S.td}>{b.sparse ? <WarnBadge level="amber">sparse &lt;10</WarnBadge> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Evolution: Calibration History ────────────────────────────────────────────
function CalibrationHistorySection({ data }) {
  if (!data?.versions?.length) return <InsufficientData msg="No calibration events recorded yet" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.versions.map(v => {
        const changed = v.changed_weights ?? {};
        const keys    = Object.keys(changed);
        const triggerColor = v.trigger === 'rollback' ? '#f87171' : v.trigger === 'auto' ? '#4ade80' : '#8888ff';
        return (
          <div key={v.id} style={{ background: '#0a0a0f', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.65rem', color: triggerColor, border: `1px solid ${triggerColor}33`, borderRadius: 4, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{v.trigger}</span>
                {v.health_score != null && <span style={{ fontSize: '0.65rem', color: '#555' }}>health: <span style={{ color: v.health_score >= 70 ? '#4ade80' : v.health_score >= 40 ? '#fbbf24' : '#f87171' }}>{v.health_score}</span></span>}
                {v.learning_velocity && <span style={{ fontSize: '0.65rem', color: VEL_COLOR[v.learning_velocity] ?? '#555' }}>{v.learning_velocity}</span>}
              </div>
              <span style={{ fontSize: '0.65rem', color: '#333' }}>{v.created_at?.slice(0, 19).replace('T', ' ')}</span>
            </div>
            {keys.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                {keys.map(k => (
                  <span key={k} style={{ fontSize: '0.68rem', background: '#111', border: '1px solid #222', borderRadius: 4, padding: '2px 8px', color: changed[k] > 0 ? '#4ade80' : '#f87171' }}>
                    {k} {changed[k] > 0 ? '+' : ''}{changed[k]}
                  </span>
                ))}
              </div>
            )}
            {v.notes && <div style={{ fontSize: '0.68rem', color: '#444', fontStyle: 'italic' }}>{v.notes}</div>}
            {v.rollback_tag && <div style={{ fontSize: '0.65rem', color: '#f87171', marginTop: 4 }}>tag: {v.rollback_tag}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Evolution: Timeline Playback ──────────────────────────────────────────────
function TimelinePlayback({ data }) {
  const [selA, setSelA] = useState(null);
  const [selB, setSelB] = useState(null);
  if (!data?.versions?.length) return <InsufficientData msg="No intelligence versions to compare" />;
  const versions = data.versions;

  const A = versions.find(v => v.id === selA);
  const B = versions.find(v => v.id === selB);

  function WeightsCard({ v, label }) {
    if (!v) return <div style={{ flex: 1, background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 14px', minWidth: 200 }}><span style={{ color: '#333', fontSize: '0.72rem' }}>Select a version</span></div>;
    const weights = v.new_weights ?? {};
    return (
      <div style={{ flex: 1, background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '12px 14px', minWidth: 200 }}>
        <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: '0.68rem', color: '#666', marginBottom: 6 }}>{v.created_at?.slice(0, 19).replace('T', ' ')} · <span style={{ color: VEL_COLOR[v.learning_velocity] ?? '#555' }}>{v.learning_velocity}</span></div>
        {Object.keys(weights).length ? Object.entries(weights).map(([k, val]) => {
          const other = label === 'Version A' ? (B?.new_weights?.[k] ?? null) : (A?.new_weights?.[k] ?? null);
          const diff = other != null ? val - other : null;
          return (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.7rem', color: '#555' }}>{k}</span>
              <span style={{ fontSize: '0.7rem', color: '#8888ff' }}>
                {val} {diff != null && <span style={{ color: diff > 0 ? '#4ade80' : diff < 0 ? '#f87171' : '#333', fontSize: '0.65rem' }}>({diff > 0 ? '+' : ''}{diff.toFixed(2)})</span>}
              </span>
            </div>
          );
        }) : <span style={{ color: '#333', fontSize: '0.7rem' }}>no weights</span>}
        {v.health_score != null && <div style={{ marginTop: 8, fontSize: '0.68rem', color: '#444' }}>health: <span style={{ color: '#8888ff' }}>{v.health_score}</span></div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['Version A', selA, setSelA], ['Version B', selB, setSelB]].map(([label, sel, setSel]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.65rem', color: '#444' }}>{label}</span>
            <select style={S.select} value={sel ?? ''} onChange={e => setSel(e.target.value || null)}>
              <option value="">— select —</option>
              {versions.map(v => (
                <option key={v.id} value={v.id}>
                  {v.created_at?.slice(0, 16).replace('T', ' ')} · {v.trigger} · {v.learning_velocity ?? '?'}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <WeightsCard v={A} label="Version A" />
        <WeightsCard v={B} label="Version B" />
      </div>
    </div>
  );
}

// ── Evolution: Snapshot Timeline ─────────────────────────────────────────────
function SnapshotTimeline({ token }) {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [niche,    setNiche]    = useState('');
  const [bucket,   setBucket]   = useState('30d');
  const [durBuck,  setDurBuck]  = useState('');

  async function load() {
    setLoading(true);
    try {
      let url = ROUTES.adminEvolutionBenchmarkTimeline;
      const params = [];
      if (niche)   params.push(`niche=${encodeURIComponent(niche)}`);
      if (bucket)  params.push(`bucket=${encodeURIComponent(bucket)}`);
      if (durBuck) params.push(`duration_bucket=${encodeURIComponent(durBuck)}`);
      if (params.length) url += '?' + params.join('&');
      const data = await apiFetch(url, token);
      setRows(data.rows ?? []);
    } catch (_) {}
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select style={S.select} value={niche} onChange={e => setNiche(e.target.value)}>
          <option value="">All niches</option>
          {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select style={S.select} value={bucket} onChange={e => setBucket(e.target.value)}>
          <option value="">All buckets</option>
          {['1d','3d','7d','14d','30d','90d','365d'].map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select style={S.select} value={durBuck} onChange={e => setDurBuck(e.target.value)}>
          <option value="">All durations</option>
          {['short','medium','long'].map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button style={S.btn} onClick={load}>{loading ? 'Loading…' : 'Apply'}</button>
      </div>
      {!rows.length ? (
        <div style={{ color: '#333', fontSize: '0.75rem' }}>No benchmark history yet — runs after second patternMiner execution.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead><tr>
              {['Snapshot', 'Niche', 'Bucket', 'Dur', 'N', 'Med VPH', 'P90 VPH', 'Med SAV', 'Med VSR'].map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...S.td, fontSize: '0.65rem', color: '#333' }}>{r.snapshot_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td style={S.td}><span style={S.tag}>{r.niche}</span></td>
                  <td style={S.td}>{r.bucket}</td>
                  <td style={S.td}>{r.duration_bucket}</td>
                  <td style={{ ...S.td, color: '#8888ff' }}>{r.sample_size}</td>
                  <td style={S.td}>{r.median_vph?.toFixed(3) ?? '—'}</td>
                  <td style={S.td}>{r.p90_vph?.toFixed(3) ?? '—'}</td>
                  <td style={S.td}>{r.median_sav?.toFixed(4) ?? '—'}</td>
                  <td style={S.td}>{r.median_vsr?.toFixed(4) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Evolution: Rollback Panel ─────────────────────────────────────────────────
function RollbackPanel({ token, onDone }) {
  const [versions, setVersions]   = useState([]);
  const [selId,    setSelId]      = useState('');
  const [reason,   setReason]     = useState('');
  const [tag,      setTag]        = useState('');
  const [type,     setType]       = useState('niche_bias');
  const [busy,     setBusy]       = useState(false);
  const [msg,      setMsg]        = useState('');
  const [err,      setErr]        = useState('');

  useEffect(() => {
    apiFetch(ROUTES.adminScoringVersions, token).then(d => setVersions(d.versions ?? [])).catch(() => {});
  }, [token]);

  async function doRollback() {
    if (!selId)       return setErr('Select a target version');
    if (!reason.trim()) return setErr('Reason is required');
    setBusy(true); setMsg(''); setErr('');
    try {
      const data = await apiFetch(ROUTES.adminScoringRollback, token, {
        method: 'POST',
        body: JSON.stringify({ version_type: type, version_id: selId, reason: reason.trim(), rollback_tag: tag.trim() || null, applied_by: 'operator' }),
      });
      setMsg(`Rolled back to ${selId.slice(0, 8)}… — audit: ${data.audit_id?.slice(0, 8)}…`);
      setSelId(''); setReason(''); setTag('');
      onDone?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const filtered = versions.filter(v => v.version_type === type);

  return (
    <div style={{ background: '#0a0505', border: '1px solid #3a1a1a', borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f87171', marginBottom: 4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Rollback Scoring Weights Only</div>
      <div style={{ fontSize: '0.68rem', color: '#555', marginBottom: 14 }}>
        Benchmark history is immutable and will not be reverted. This action is logged permanently.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.65rem', color: '#555' }}>Version type</span>
            <select style={S.select} value={type} onChange={e => setType(e.target.value)}>
              <option value="niche_bias">niche_bias</option>
              <option value="ensemble_weights">ensemble_weights</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2 }}>
            <span style={{ fontSize: '0.65rem', color: '#555' }}>Target version</span>
            <select style={{ ...S.select, width: '100%' }} value={selId} onChange={e => setSelId(e.target.value)}>
              <option value="">— select version to restore —</option>
              {filtered.map(v => (
                <option key={v.id} value={v.id}>
                  {v.version_name} · {v.created_at?.slice(0, 10)} {v.active ? '(active)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.65rem', color: '#f87171' }}>Reason (required)</span>
          <input style={S.input} placeholder="Why are you rolling back? Be specific." value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.65rem', color: '#555' }}>Tag (optional)</span>
          <input style={S.input} placeholder="e.g. emergency, post-incident, scheduled" value={tag} onChange={e => setTag(e.target.value)} />
        </div>
        <button
          style={{ ...S.btnRed, alignSelf: 'flex-start', opacity: busy || !selId || !reason.trim() ? 0.4 : 1 }}
          disabled={busy || !selId || !reason.trim()}
          onClick={doRollback}
        >
          {busy ? 'Rolling back…' : 'Confirm Rollback'}
        </button>
        {msg && <div style={S.ok}>{msg}</div>}
        {err && <div style={S.err}>{err}</div>}
      </div>
    </div>
  );
}

// ── Tab: Evolution ────────────────────────────────────────────────────────────
function EvolutionTab({ token }) {
  const [health,     setHealth]     = useState(null);
  const [accuracy,   setAccuracy]   = useState(null);
  const [scoreDist,  setScoreDist]  = useState(null);
  const [weights,    setWeights]    = useState(null);
  const [drift,      setDrift]      = useState(null);
  const [calibHist,  setCalibHist]  = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [versions,   setVersions]   = useState(null);
  const [loading,    setLoading]    = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const safe = async (url) => { try { return await apiFetch(url, token); } catch { return null; } };
    const [h, a, sd, w, d, ch, cf, v] = await Promise.all([
      safe(ROUTES.adminEvolutionHealthScore),
      safe(ROUTES.adminEvolutionPredictionAccuracy),
      safe(ROUTES.adminEvolutionScoreDistribution),
      safe(ROUTES.adminEvolutionSignalWeights),
      safe(ROUTES.adminEvolutionBenchmarkDrift),
      safe(ROUTES.adminEvolutionCalibrationHistory),
      safe(ROUTES.adminEvolutionConfidence),
      safe(ROUTES.adminEvolutionVersions),
    ]);
    setHealth(h); setAccuracy(a); setScoreDist(sd); setWeights(w);
    setDrift(d); setCalibHist(ch); setConfidence(cf); setVersions(v);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: '#333', fontSize: '0.78rem', padding: '20px 0' }}>Loading intelligence data…</div>;

  const globalWarnings = drift?.warnings ?? [];

  return (
    <div>
      {/* Global warning banners */}
      {globalWarnings.filter(w => w.severity === 'red').map((w, i) => (
        <div key={i} style={{ background: '#1f0a0a', border: '1px solid #4a1a1a', borderRadius: 6, padding: '10px 14px', marginBottom: 8, fontSize: '0.75rem', color: '#f87171', fontWeight: 600 }}>
          ⚠ {w.message} — <span style={{ fontWeight: 400 }}>Possible benchmark instability</span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button style={S.btn} onClick={load}>Refresh All</button>
      </div>

      <EvoSection title="Intelligence Health Score">
        <HealthSection data={health} />
      </EvoSection>

      <EvoSection title="Benchmark Drift Detection">
        <DriftSection data={drift} />
      </EvoSection>

      <EvoSection title="Prediction Accuracy Tracking">
        <AccuracySection data={accuracy} />
      </EvoSection>

      <EvoSection title="Score Distribution Evolution">
        <ScoreDistSection data={scoreDist} />
      </EvoSection>

      <EvoSection title="Signal Importance Evolution">
        <SignalWeightsSection data={weights} />
      </EvoSection>

      <EvoSection title="Confidence Reliability">
        <ConfidenceSection data={confidence} />
      </EvoSection>

      <EvoSection title="Calibration History">
        <CalibrationHistorySection data={calibHist} />
      </EvoSection>

      <EvoSection title="Intelligence Timeline Playback">
        <TimelinePlayback data={versions} />
      </EvoSection>

      <EvoSection title="Snapshot Timeline Viewer">
        <SnapshotTimeline token={token} />
      </EvoSection>

      <EvoSection title="Rollback — Scoring Weights Only">
        <RollbackPanel token={token} onDone={load} />
      </EvoSection>
    </div>
  );
}

// ── Tab: Learning Intelligence Dashboard ──────────────────────────────────────

const MAE_STATUS  = (v) => v == null ? '#555' : v < 15 ? '#4ade80' : v < 30 ? '#fbbf24' : '#f87171';
const TRUST_COLOR = (v) => v == null ? '#555' : v >= 70 ? '#4ade80' : v >= 40 ? '#fbbf24' : '#f87171';
const SYNTH_COLOR = (v) => v == null ? '#555' : v < 0.5 ? '#4ade80' : v < 0.9 ? '#fbbf24' : '#f87171';
const SEV_STYLE   = { red: { background: '#1f0808', border: '1px solid #5a1a1a', color: '#f87171' }, yellow: { background: '#1f1808', border: '1px solid #5a3a0a', color: '#fbbf24' }, info: { background: '#080f1f', border: '1px solid #1a2a5a', color: '#60a5fa' } };
const BAND_COLOR  = { large_overprediction: '#f87171', slight_overprediction: '#fbbf24', accurate: '#4ade80', slight_underprediction: '#fbbf24', large_underprediction: '#f87171' };

function DeltaPill({ value, lowerBetter = true }) {
  if (value == null) return <span style={{ fontSize: '0.6rem', color: '#333' }}>—</span>;
  const good = lowerBetter ? value <= 0 : value >= 0;
  const color = good ? '#4ade80' : '#f87171';
  const arrow = value > 0 ? '↑' : value < 0 ? '↓' : '→';
  return (
    <span style={{ fontSize: '0.6rem', color, marginLeft: 4 }}>
      {arrow} {value > 0 ? '+' : ''}{value}
    </span>
  );
}

function KpiCard({ title, value, unit, delta24h, delta7d, color, lowerBetter, tooltip, sub }) {
  return (
    <div title={tooltip} style={{ background: '#08080f', border: `1px solid #1a1a2e`, borderRadius: 10, padding: '16px 18px', minWidth: 170, flex: '1 1 170px', cursor: 'help' }}>
      <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: color ?? '#8888ff', lineHeight: 1.1 }}>
        {value ?? '—'}{unit && <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#555', marginLeft: 2 }}>{unit}</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {delta24h !== undefined && <span style={{ fontSize: '0.6rem', color: '#333' }}>24h: <DeltaPill value={delta24h} lowerBetter={lowerBetter} /></span>}
        {delta7d  !== undefined && <span style={{ fontSize: '0.6rem', color: '#333' }}>7d: <DeltaPill value={delta7d}  lowerBetter={lowerBetter} /></span>}
      </div>
      {sub && <div style={{ fontSize: '0.6rem', color: '#333', marginTop: 4 }}>{sub}</div>}
      <div style={{ fontSize: '0.55rem', color: '#2a2a3a', marginTop: 4 }}>{lowerBetter ? 'Lower is better' : 'Higher is better'}</div>
    </div>
  );
}

function AlertBanners({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {alerts.map((a, i) => (
        <div key={i} style={{ ...SEV_STYLE[a.severity] ?? SEV_STYLE.info, borderRadius: 7, padding: '10px 14px', marginBottom: 6, fontSize: '0.75rem' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{a.severity === 'red' ? '⚠ ALERT' : '● WARNING'} — {a.message}</div>
          {a.action && <div style={{ opacity: 0.75, fontWeight: 400 }}>Action: {a.action}</div>}
        </div>
      ))}
    </div>
  );
}

function LSection({ title, children, collapsed, onToggle }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid #1a1a2e', paddingBottom: 7, marginBottom: collapsed ? 0 : 14 }}
      >
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#555', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{title}</div>
        <span style={{ fontSize: '0.65rem', color: '#333' }}>{collapsed ? '▶ expand' : '▼ collapse'}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}

function SparkChart({ data, dataKey, color = '#8888ff', label }) {
  if (!data?.length || data.length < 2) {
    return <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Accumulating history — check back after daily snapshot cron fires</div>;
  }
  return (
    <div>
      {label && <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>}
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#111" />
          <XAxis dataKey="snapshot_date" tick={{ fontSize: 9, fill: '#444' }} tickFormatter={v => v?.slice(5)} />
          <YAxis tick={{ fontSize: 9, fill: '#444' }} />
          <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }} />
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HistChart({ data, xKey, yKey, color = '#8888ff', label, tooltip: tipText }) {
  if (!data?.length) return <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '12px 0' }}>No data</div>;
  return (
    <div title={tipText}>
      {label && <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>}
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#111" />
          <XAxis dataKey={xKey} tick={{ fontSize: 9, fill: '#444' }} />
          <YAxis tick={{ fontSize: 9, fill: '#444' }} />
          <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }} />
          <Bar dataKey={yKey} fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function NicheRow({ r, rank }) {
  const errColor = Math.abs(r.avg_error ?? 0) <= 10 ? '#4ade80' : Math.abs(r.avg_error ?? 0) <= 25 ? '#fbbf24' : '#f87171';
  const maeColor = MAE_STATUS(r.mae);
  const trendLabel = r.trend === 'over' ? { label: '↑ over', color: '#fbbf24' } : r.trend === 'under' ? { label: '↓ under', color: '#60a5fa' } : { label: '✓ cal.', color: '#4ade80' };
  const freshDays = r.last_refreshed ? Math.floor((Date.now() - new Date(r.last_refreshed)) / 86400000) : null;
  return (
    <tr>
      <td style={S.td}><span style={{ color: '#333', fontSize: '0.65rem' }}>{rank}</span></td>
      <td style={S.td}><span style={{ color: '#7aadff', fontSize: '0.75rem' }}>{r.niche}</span></td>
      <td style={S.td}>{r.sample_count}</td>
      <td style={{ ...S.td, color: errColor }} title="Positive = over-predicts this niche. Negative = under-predicts.">{r.avg_error > 0 ? '+' : ''}{r.avg_error ?? '—'}</td>
      <td style={S.td}>{r.avg_actual ?? '—'}</td>
      <td style={{ ...S.td, color: maeColor }} title="Mean Absolute Error for this niche">{r.mae ?? '—'}</td>
      <td style={S.td}><span style={{ color: trendLabel.color, fontSize: '0.7rem' }}>{trendLabel.label}</span></td>
      <td style={S.td}><span style={{ color: '#333', fontSize: '0.65rem' }}>{r.real_count > 0 ? <span style={{ color: '#4ade80' }}>{r.real_count}R</span> : null}{r.synthetic_count > 0 ? <span style={{ color: '#555', marginLeft: r.real_count > 0 ? 4 : 0 }}>{r.synthetic_count}S</span> : null}</span></td>
      <td style={S.td}><span style={{ color: freshDays == null ? '#333' : freshDays > 7 ? '#f87171' : '#444', fontSize: '0.65rem' }}>{freshDays != null ? `${freshDays}d ago` : '—'}</span></td>
    </tr>
  );
}

function EventRow({ ev }) {
  const sev  = ev.severity ?? 'info';
  const dot  = { red: '#f87171', yellow: '#fbbf24', info: '#60a5fa' }[sev] ?? '#555';
  const ts   = ev.created_at ? new Date(ev.created_at).toLocaleString() : '—';
  const typeLabel = { calibration: 'Calibration', synthetic_run: 'Synthetic Run' }[ev.type] ?? ev.type;

  return (
    <div style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #0d0d12' }}>
      <div style={{ paddingTop: 3 }}><div style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: '#555', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{typeLabel}</span>
          {ev.trigger && <span style={{ ...S.tag }}>{ev.trigger}</span>}
          {ev.health_score != null && <span style={{ fontSize: '0.65rem', color: ev.health_score < 40 ? '#f87171' : '#4ade80' }}>health {ev.health_score}</span>}
          {ev.velocity && <span style={{ fontSize: '0.65rem', color: VEL_COLOR[ev.velocity] ?? '#555' }}>{ev.velocity}</span>}
          {ev.weight_delta > 0 && <span style={{ fontSize: '0.65rem', color: '#fbbf24' }}>Δw {ev.weight_delta}</span>}
          {ev.rows_inserted != null && <span style={{ fontSize: '0.65rem', color: '#60a5fa' }}>{ev.rows_inserted} rows</span>}
          {ev.mae != null && <span style={{ fontSize: '0.65rem', color: MAE_STATUS(ev.mae) }}>MAE {ev.mae}</span>}
        </div>
        <div style={{ fontSize: '0.6rem', color: '#2a2a3a', marginTop: 2 }}>{ts}</div>
        {ev.notes && <div style={{ fontSize: '0.65rem', color: '#444', marginTop: 2 }}>{ev.notes}</div>}
      </div>
    </div>
  );
}

const FEAT_COLORS = {
  niche_research: '#60a5fa', viral_formula: '#f472b6', pattern_ranking: '#34d399',
  title_generation: '#fbbf24', upload_timing: '#a78bfa',
  hook_intelligence: '#fb923c', channel_classification: '#22d3ee',
};

function DeltaCard({ label, d, lowerBetter }) {
  if (!d || d.current == null) return null;
  return (
    <div style={{ ...S.card, margin: 0, padding: '8px 14px', minWidth: 160 }}>
      <div style={{ fontSize: '0.58rem', color: '#333', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: '#ccc', fontWeight: 600, marginBottom: 6 }}>{typeof d.current === 'number' ? d.current.toFixed(1) : d.current}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: '0.58rem', color: '#444' }}>
        {d.vs_yesterday != null && <span>1d<DeltaPill value={d.vs_yesterday} lowerBetter={lowerBetter} /></span>}
        {d.vs_7d_avg    != null && <span>7d avg<DeltaPill value={d.vs_7d_avg} lowerBetter={lowerBetter} /></span>}
        {d.vs_30d_avg   != null && <span>30d avg<DeltaPill value={d.vs_30d_avg} lowerBetter={lowerBetter} /></span>}
      </div>
    </div>
  );
}

function HistorySubtab({ token }) {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [days,        setDays]        = useState(30);
  const [snapping,    setSnapping]    = useState(false);
  const [snapMsg,     setSnapMsg]     = useState('');
  const [correctness,  setCorrectness]  = useState(null);
  const [routingStats, setRoutingStats] = useState(null);
  const [reliability,  setReliability]  = useState(null);
  const [cohorts,      setCohorts]      = useState(null);
  const [decayData,    setDecayData]    = useState(null);
  const [disagStats,   setDisagStats]   = useState(null);
  const [synthTrans,   setSynthTrans]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const safe = async (url) => { try { return await apiFetch(url, token); } catch { return null; } };
    const [r, c, rt, rel, coh, dec, dis, syn] = await Promise.all([
      safe(`${ROUTES.adminLearningHistoryDashboard}?days=${days}`),
      safe(ROUTES.adminConfidenceCorrectness),
      safe(`${ROUTES.adminRoutingAnalytics}?days=${days}`),
      safe(ROUTES.adminLearningNicheReliability),
      safe(`${ROUTES.adminLearningCohortAnalysis}?days=${days}`),
      safe(ROUTES.adminLearningDecayAnalysis),
      safe(`${ROUTES.adminLearningDisagreementStats}?days=${days}`),
      safe(ROUTES.adminLearningSyntheticTransition),
    ]);
    setData(r); setCorrectness(c); setRoutingStats(rt);
    setReliability(rel); setCohorts(coh); setDecayData(dec);
    setDisagStats(dis); setSynthTrans(syn);
    setLoading(false);
  }, [token, days]);

  useEffect(() => { load(); }, [load]);

  async function snap() {
    setSnapping(true); setSnapMsg('');
    try {
      const r = await apiFetch(ROUTES.adminConfidenceSnapshot, token, { method: 'POST' });
      setSnapMsg(`Snapshot: ${r.date} — ${r.niches_scored} niches scored`);
      load();
    } catch (e) { setSnapMsg(`Error: ${e.message}`); }
    setSnapping(false);
  }

  if (loading) return <div style={{ color: '#333', fontSize: '0.78rem', padding: '20px 0' }}>Loading intelligence history…</div>;
  if (!data)   return <div style={{ color: '#f87171', fontSize: '0.75rem', padding: '20px 0' }}>Failed to load history data</div>;

  const health  = data.health_timeline     ?? [];
  const routing = data.routing_timeline    ?? [];
  const conf    = data.confidence_timeline ?? [];
  const deltas  = data.deltas ?? {};
  const { top: topN = [], worst: worstN = [] } = data.niche_rankings ?? {};
  const features = [...new Set(conf.map(r => r.feature))];

  const confByDate = {};
  for (const r of conf) {
    confByDate[r.snapshot_date] ??= { snapshot_date: r.snapshot_date };
    confByDate[r.snapshot_date][r.feature] = r.avg_confidence;
  }
  const confTimeline = Object.values(confByDate).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: '#333' }}>Range:</span>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{ ...S.btn, padding: '4px 10px', fontSize: '0.65rem', borderColor: days === d ? '#8888ff' : '#222', color: days === d ? '#8888ff' : '#444' }}>{d}d</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn} onClick={snap} disabled={snapping}>{snapping ? 'Saving…' : 'Confidence Snapshot'}</button>
          <button style={S.btn} onClick={load}>Refresh</button>
        </div>
      </div>
      {snapMsg && <div style={{ ...S.ok, marginBottom: 10, fontSize: '0.68rem' }}>{snapMsg}</div>}

      {/* Delta summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
        <DeltaCard label="MAE" d={deltas.mae} lowerBetter />
        <DeltaCard label="Calibration Trust" d={deltas.calibration_trust} lowerBetter={false} />
        <DeltaCard label="Avg Confidence" d={deltas.avg_confidence} lowerBetter={false} />
        <DeltaCard label="Fallback Rate" d={deltas.fallback_rate} lowerBetter />
      </div>

      {/* Charts 1+2: Health timeline */}
      <LSection title="Intelligence Health Timeline" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={health} dataKey="mae" color="#f87171" label="MAE — lower is better" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Downward trend = improving prediction accuracy.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={health} dataKey="calibration_trust_score" color="#4ade80" label="Calibration Trust Score" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Rising trust = system accumulating reliable real-world signal.</div>
          </div>
        </div>
      </LSection>

      {/* Charts 3+4: Confidence growth + routing distribution */}
      <LSection title="Confidence Growth & Routing Distribution" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            {confTimeline.length >= 2 ? (
              <div>
                <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Confidence by Feature Over Time</div>
                <ResponsiveContainer width="100%" height={130}>
                  <LineChart data={confTimeline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                    <XAxis dataKey="snapshot_date" tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => v?.slice(5)} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#444' }} />
                    <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={(v, n) => [v?.toFixed(1), n?.replace(/_/g, ' ')]} labelFormatter={v => `Date: ${v}`} />
                    {features.map(f => <Line key={f} dataKey={f} stroke={FEAT_COLORS[f] ?? '#888'} dot={false} strokeWidth={1.5} name={f} />)}
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {features.map(f => <span key={f} style={{ fontSize: '0.57rem', color: FEAT_COLORS[f] ?? '#888' }}>● {f.replace(/_/g, ' ')}</span>)}
                </div>
              </div>
            ) : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Accumulating — confidence snapshot runs daily at 03:00 UTC</div>}
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            {routing.length >= 2 ? (
              <div>
                <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Routing Distribution Over Time</div>
                <ResponsiveContainer width="100%" height={130}>
                  <AreaChart data={routing} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                    <XAxis dataKey="snapshot_date" tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => v?.slice(5)} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={v => [`${v?.toFixed(1)}%`]} labelFormatter={v => `Date: ${v}`} />
                    <Area type="monotone" dataKey="autonomous_pct"       stackId="1" stroke="#4ade80" fill="#4ade8022" strokeWidth={1.5} name="Autonomous" />
                    <Area type="monotone" dataKey="local_first_pct"      stackId="1" stroke="#8888ff" fill="#8888ff22" strokeWidth={1.5} name="Local First" />
                    <Area type="monotone" dataKey="hybrid_pct"           stackId="1" stroke="#fbbf24" fill="#fbbf2422" strokeWidth={1.5} name="Hybrid" />
                    <Area type="monotone" dataKey="mandatory_claude_pct" stackId="1" stroke="#f87171" fill="#f8717122" strokeWidth={1.5} name="Claude Required" />
                  </AreaChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {[['Autonomous', '#4ade80'], ['Local First', '#8888ff'], ['Hybrid', '#fbbf24'], ['Claude Required', '#f87171']].map(([n, c]) => (
                    <span key={n} style={{ fontSize: '0.57rem', color: c }}>● {n}</span>
                  ))}
                </div>
              </div>
            ) : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Accumulating — confidence snapshot runs daily at 03:00 UTC</div>}
          </div>
        </div>
      </LSection>

      {/* Charts 5+6: Claude dependency reduction */}
      <LSection title="Claude Dependency Reduction" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={routing} dataKey="fallback_rate" color="#f87171" label="System Fallback Rate — lower = more autonomous" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>% of decisions routed to Claude. Target: trend toward 0%.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={health} dataKey="synthetic_ratio" color="#fbbf24" label="Synthetic Data Ratio — lower = more real signal" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>As real creator data grows, synthetic ratio should fall. Target: &lt;50%.</div>
          </div>
        </div>
      </LSection>

      {/* Chart 7: Benchmark drift */}
      <LSection title="Benchmark Drift" collapsed={false} onToggle={() => {}}>
        <div style={{ ...S.card }}>
          <SparkChart data={health} dataKey="benchmark_drift" color="#fbbf24" label="Benchmark Drift Over Time" />
          <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Gradual drift is healthy (markets shift). Sudden spikes = benchmark instability.</div>
        </div>
      </LSection>

      {/* Charts 8+9: Niche rankings */}
      <LSection title="Niche Confidence Rankings (Latest Snapshot)" collapsed={false} onToggle={() => {}}>
        {topN.length === 0
          ? <div style={{ color: '#333', fontSize: '0.75rem' }}>No niche confidence snapshot yet — runs daily at 03:00 UTC</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ ...S.card, margin: 0 }}>
                <div style={{ fontSize: '0.6rem', color: '#4ade80', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Top Niches — Highest Confidence</div>
                {topN.map((r, i) => (
                  <div key={r.niche} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid #0d0d12' }}>
                    <span style={{ fontSize: '0.68rem', color: '#666' }}>#{i + 1} {r.niche}</span>
                    <span style={{ fontSize: '0.7rem', color: r.avg_confidence >= 80 ? '#4ade80' : r.avg_confidence >= 60 ? '#8888ff' : '#fbbf24', fontWeight: 600 }}>{r.avg_confidence?.toFixed(1)}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...S.card, margin: 0 }}>
                <div style={{ fontSize: '0.6rem', color: '#f87171', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Worst Niches — Lowest Confidence</div>
                {worstN.map((r, i) => (
                  <div key={r.niche} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid #0d0d12' }}>
                    <span style={{ fontSize: '0.68rem', color: '#666' }}>#{i + 1} {r.niche}</span>
                    <span style={{ fontSize: '0.7rem', color: r.avg_confidence >= 80 ? '#4ade80' : r.avg_confidence >= 60 ? '#8888ff' : '#fbbf24', fontWeight: 600 }}>{r.avg_confidence?.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        }
      </LSection>

      {/* Chart 10: Signal-level placeholders */}
      <LSection title="Signal-Level Intelligence (Phase D/F)" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0, opacity: 0.45 }}>
            <div style={{ fontSize: '0.6rem', color: '#fb923c', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Hook Intelligence Momentum</div>
            <div style={{ color: '#2a2a2a', fontSize: '0.72rem' }}>Phase D (hook extraction) not yet built. Hook-level confidence trending will appear here after Phase D is complete.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <div style={{ fontSize: '0.6rem', color: '#a78bfa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Upload Timing Stability</div>
            {conf.filter(r => r.feature === 'upload_timing').length >= 2
              ? (
                <div>
                  <SparkChart data={conf.filter(r => r.feature === 'upload_timing')} dataKey="avg_confidence" color="#a78bfa" label="Upload Timing — confidence over time" />
                  <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Upload timing is the highest-confidence autonomous signal (~92). Should remain stable.</div>
                </div>
              )
              : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Accumulating — snapshot runs daily at 03:00 UTC</div>
            }
          </div>
        </div>
      </LSection>

      {/* Confidence Correctness (Phase C Pre-req) */}
      <LSection title="Confidence Correctness Validation" collapsed={false} onToggle={() => {}}>
        {!correctness
          ? <div style={{ color: '#333', fontSize: '0.72rem' }}>No correctness data — requires video_outcomes with calibration_error populated</div>
          : (
            <div>
              {(correctness.alerts ?? []).map((a, i) => (
                <div key={i} style={{ ...S.card, margin: '0 0 8px', borderColor: a.severity === 'red' ? '#f87171' : '#fbbf24', background: a.severity === 'red' ? '#1a0505' : '#181205' }}>
                  <div style={{ fontSize: '0.65rem', color: a.severity === 'red' ? '#f87171' : '#fbbf24', fontWeight: 600 }}>{a.type.replace(/_/g, ' ').toUpperCase()}</div>
                  <div style={{ fontSize: '0.65rem', color: '#aaa', marginTop: 2 }}>{a.message}</div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 8 }}>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Confidence–MAE Correlation</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: correctness.correlation == null ? '#444' : correctness.correlation < -0.3 ? '#4ade80' : correctness.correlation < 0 ? '#fbbf24' : '#f87171' }}>
                      {correctness.correlation != null ? correctness.correlation.toFixed(3) : 'N/A'}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.6rem', color: '#555', marginBottom: 2 }}>Routing Accuracy Score</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600, color: (correctness.routing_accuracy_score ?? 0) >= 70 ? '#4ade80' : (correctness.routing_accuracy_score ?? 0) >= 40 ? '#fbbf24' : '#f87171' }}>
                        {correctness.routing_accuracy_score ?? 0}/100
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 6 }}>
                    Negative = healthy (high confidence → low MAE). Data points: {correctness.data_points ?? 0}. Validated: {correctness.validated ? '✓' : '✗ (need ≥5 niches, ≥2 tiers, valid r)'}
                  </div>
                </div>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>MAE by Confidence Tier</div>
                  {Object.values(correctness.bucketed_mae ?? {}).some(v => v != null) ? (
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={[
                        { tier: 'low',        mae: correctness.bucketed_mae?.low        ?? 0, n: correctness.tier_counts?.low        ?? 0 },
                        { tier: 'medium',     mae: correctness.bucketed_mae?.medium     ?? 0, n: correctness.tier_counts?.medium     ?? 0 },
                        { tier: 'high',       mae: correctness.bucketed_mae?.high       ?? 0, n: correctness.tier_counts?.high       ?? 0 },
                        { tier: 'autonomous', mae: correctness.bucketed_mae?.autonomous ?? 0, n: correctness.tier_counts?.autonomous ?? 0 },
                      ]} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                        <XAxis dataKey="tier" tick={{ fontSize: 8, fill: '#444' }} />
                        <YAxis tick={{ fontSize: 8, fill: '#444' }} />
                        <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={(v, n, p) => [v?.toFixed(2), `MAE (n=${p.payload?.n})`]} />
                        <Bar dataKey="mae" radius={[2, 2, 0, 0]}>
                          {['#f87171','#fbbf24','#8888ff','#4ade80'].map((c, i) => <Cell key={i} fill={c} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Insufficient MAE data — need ≥5 video_outcomes per niche</div>}
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 4 }}>Healthy: autonomous MAE &lt; high &lt; medium &lt; low</div>
                </div>
              </div>
            </div>
          )}
      </LSection>

      {/* Routing Analytics (Phase C) */}
      <LSection title="Autonomous Routing Analytics" collapsed={false} onToggle={() => {}}>
        {!routingStats || (routingStats.total ?? 0) === 0
          ? <div style={{ color: '#333', fontSize: '0.72rem' }}>No routing data yet — log populates when /api/intelligence/query is called</div>
          : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Route Distribution ({days}d)</div>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={(routingStats.dist ?? []).map(d => ({ route: d.route_type, pct: routingStats.total > 0 ? d.n / routingStats.total * 100 : 0, n: d.n }))} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="route" tick={{ fontSize: 7, fill: '#444' }} tickFormatter={v => v?.replace('_', ' ')} />
                      <YAxis tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => `${v.toFixed(0)}%`} />
                      <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={(v, n, p) => [`${v?.toFixed(1)}% (${p.payload?.n})`, 'requests']} />
                      <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                        {(routingStats.dist ?? []).map((d, i) => (
                          <Cell key={i} fill={d.route_type === 'autonomous' ? '#4ade80' : d.route_type === 'hybrid' ? '#fbbf24' : d.route_type === 'mandatory_claude' ? '#f87171' : '#8888ff'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 4 }}>
                    Total: {routingStats.total ?? 0} requests | Est. tokens saved: {(routingStats.total_tokens_saved ?? 0).toLocaleString()}
                  </div>
                </div>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Avg Latency by Route (ms)</div>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={(routingStats.dist ?? []).map(d => ({ route: d.route_type, ms: d.avg_latency ?? 0 }))} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <XAxis dataKey="route" tick={{ fontSize: 7, fill: '#444' }} tickFormatter={v => v?.replace('_', ' ')} />
                      <YAxis tick={{ fontSize: 8, fill: '#444' }} />
                      <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={v => [`${v?.toFixed(0)}ms`, 'avg latency']} />
                      <Bar dataKey="ms" radius={[2, 2, 0, 0]}>
                        {(routingStats.dist ?? []).map((d, i) => (
                          <Cell key={i} fill={d.route_type === 'autonomous' ? '#4ade80' : d.route_type === 'hybrid' ? '#fbbf24' : d.route_type === 'mandatory_claude' ? '#f87171' : '#8888ff'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 4 }}>Autonomous: no API call. Claude routes: 500–2000ms.</div>
                </div>
              </div>
              {(routingStats.fallbacks ?? []).length > 0 && (
                <div style={{ ...S.card }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Top Fallback Reasons</div>
                  {routingStats.fallbacks.slice(0, 5).map((f, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, paddingBottom: 4, borderBottom: '1px solid #0d0d12' }}>
                      <span style={{ fontSize: '0.63rem', color: '#555', flex: 1, marginRight: 8 }}>{f.fallback_reason}</span>
                      <span style={{ fontSize: '0.65rem', color: '#fbbf24', fontWeight: 600, flexShrink: 0 }}>{f.n}×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
      </LSection>

      {/* Phase E: Niche Reliability Heatmap */}
      <LSection title="Niche Reliability Heatmap (Phase E)" collapsed={false} onToggle={() => {}}>
        {!(reliability?.niches?.length)
          ? <div style={{ color: '#333', fontSize: '0.72rem' }}>No reliability data yet — populated daily by snapshot cron at 02:00 UTC</div>
          : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Reliability Score by Niche</div>
                  <ResponsiveContainer width="100%" height={Math.min(220, reliability.niches.length * 22 + 20)}>
                    <BarChart layout="vertical" data={reliability.niches.slice(0, 12).map(r => ({ niche: r.niche, score: r.reliability_score ?? 0 }))} margin={{ top: 0, right: 16, left: 60, bottom: 0 }}>
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 8, fill: '#444' }} />
                      <YAxis type="category" dataKey="niche" tick={{ fontSize: 8, fill: '#555' }} width={58} />
                      <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={v => [v?.toFixed(1), 'reliability']} />
                      <Bar dataKey="score" radius={[0, 2, 2, 0]}>
                        {reliability.niches.slice(0, 12).map((r, i) => (
                          <Cell key={i} fill={r.reliability_score >= 70 ? '#4ade80' : r.reliability_score >= 45 ? '#fbbf24' : '#f87171'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>≥70 = reliable, 45–70 = accumulating, &lt;45 = insufficient real data</div>
                </div>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Trust Weight × MAE Breakdown</div>
                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>Niche</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>MAE 30d</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Trust</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Real</th>
                    </tr></thead>
                    <tbody>
                      {reliability.niches.slice(0, 10).map(r => (
                        <tr key={r.niche}>
                          <td style={{ ...S.td, color: '#666', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.niche}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: r.mae_30d == null ? '#2a2a3a' : r.mae_30d <= 10 ? '#4ade80' : r.mae_30d <= 20 ? '#fbbf24' : '#f87171' }}>
                            {r.mae_30d != null ? r.mae_30d.toFixed(1) : '–'}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#8888ff' }}>{r.trust_weight?.toFixed(2) ?? '–'}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#666' }}>{r.real_outcome_count ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
      </LSection>

      {/* Phase E: Temporal Cohort MAE Comparison */}
      <LSection title="Temporal Cohort Analysis (Phase E)" collapsed={false} onToggle={() => {}}>
        {!(cohorts?.snapshots?.length)
          ? <div style={{ color: '#333', fontSize: '0.72rem' }}>No cohort snapshots yet — populated daily at 03:00 UTC</div>
          : (() => {
            const allSnaps = cohorts.snapshots.filter(s => s.niche === '__all__');
            const by7d  = allSnaps.filter(s => s.cohort_window === '7d');
            const by30d = allSnaps.filter(s => s.cohort_window === '30d');
            const by90d = allSnaps.filter(s => s.cohort_window === '90d');
            const dates = [...new Set(allSnaps.map(s => s.snapshot_date))].sort();
            const chartData = dates.map(d => {
              const snap7  = by7d.find(s => s.snapshot_date === d);
              const snap30 = by30d.find(s => s.snapshot_date === d);
              const snap90 = by90d.find(s => s.snapshot_date === d);
              return {
                date: d,
                mae_7d:  snap7?.mae  ?? null,
                mae_30d: snap30?.mae ?? null,
                mae_90d: snap90?.mae ?? null,
              };
            });
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>MAE by Window (7d / 30d / 90d)</div>
                  {chartData.length >= 2 ? (
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#111" />
                        <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => v?.slice(5)} />
                        <YAxis tick={{ fontSize: 8, fill: '#444' }} />
                        <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={v => [v?.toFixed(2), 'MAE']} labelFormatter={v => `Date: ${v}`} />
                        <Line dataKey="mae_7d"  stroke="#f87171" dot={false} strokeWidth={1.5} name="7d window" />
                        <Line dataKey="mae_30d" stroke="#fbbf24" dot={false} strokeWidth={1.5} name="30d window" />
                        <Line dataKey="mae_90d" stroke="#8888ff" dot={false} strokeWidth={1.5} name="90d window" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>Accumulating snapshots…</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                    {[['7d', '#f87171'], ['30d', '#fbbf24'], ['90d', '#8888ff']].map(([w, c]) => (
                      <span key={w} style={{ fontSize: '0.57rem', color: c }}>● {w} window</span>
                    ))}
                  </div>
                </div>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Latest Cohort Stats</div>
                  {['7d', '30d', '90d'].map(w => {
                    const latest = cohorts.snapshots.filter(s => s.cohort_window === w && s.niche === '__all__').sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))[0];
                    if (!latest) return null;
                    return (
                      <div key={w} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 7, borderBottom: '1px solid #0d0d12' }}>
                        <span style={{ fontSize: '0.68rem', color: '#555', fontWeight: 600 }}>{w}</span>
                        <div style={{ display: 'flex', gap: 14 }}>
                          <span style={{ fontSize: '0.65rem', color: '#888' }}>MAE <span style={{ color: latest.mae <= 10 ? '#4ade80' : latest.mae <= 20 ? '#fbbf24' : '#f87171' }}>{latest.mae?.toFixed(1) ?? '–'}</span></span>
                          <span style={{ fontSize: '0.65rem', color: '#888' }}>Acc <span style={{ color: '#8888ff' }}>{latest.accuracy_rate != null ? (latest.accuracy_rate * 100).toFixed(0) + '%' : '–'}</span></span>
                          <span style={{ fontSize: '0.65rem', color: '#888' }}>n={latest.total_outcomes ?? 0}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
      </LSection>

      {/* Phase E: Freshness Decay Analysis */}
      <LSection title="Freshness Decay & Disagreement (Phase E)" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Outcome Freshness Distribution</div>
            {(decayData?.buckets ?? []).length > 0 ? (
              <ResponsiveContainer width="100%" height={110}>
                <BarChart data={decayData.buckets} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 7, fill: '#444' }} tickFormatter={v => v?.split(' ')[0]} />
                  <YAxis tick={{ fontSize: 8, fill: '#444' }} />
                  <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} formatter={(v, n, p) => [n === 'count' ? v : v?.toFixed(2), n === 'count' ? 'outcomes' : 'avg MAE']} />
                  <Bar dataKey="count" fill="#8888ff44" name="count" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="avg_mae" fill="#f8717166" name="avg_mae" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>No freshness data — outcomes need last_refreshed_at populated</div>}
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Fresh outcomes (weight≥0.9) should have lowest MAE. Stale ones weighted down.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Human Disagreement by Niche ({days}d)</div>
            {!(disagStats?.niches?.length)
              ? <div style={{ fontSize: '0.68rem', color: '#2a2a3a', padding: '20px 0', textAlign: 'center' }}>No feedback with score_override yet — appears when users submit corrected scores</div>
              : (
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Niche</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Overrides</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Avg Δ</th>
                  </tr></thead>
                  <tbody>
                    {disagStats.niches.filter(r => r.overrides > 0).slice(0, 8).map(r => (
                      <tr key={r.niche}>
                        <td style={{ ...S.td, color: '#666' }}>{r.niche ?? 'unknown'}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#fbbf24' }}>{r.overrides}/{r.total_feedback}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: r.avg_disagreement > 20 ? '#f87171' : r.avg_disagreement > 10 ? '#fbbf24' : '#4ade80' }}>
                          {r.avg_disagreement != null ? r.avg_disagreement.toFixed(1) : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      </LSection>

      {/* Phase E: Synthetic Transition Progress */}
      <LSection title="Synthetic → Real Transition Progress (Phase E)" collapsed={false} onToggle={() => {}}>
        {!(synthTrans?.niches?.length)
          ? <div style={{ color: '#333', fontSize: '0.72rem' }}>No transition data — populates once video_outcomes exist</div>
          : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Real vs. Synthetic Budget</div>
                  <ResponsiveContainer width="100%" height={Math.min(200, synthTrans.niches.length * 22 + 20)}>
                    <BarChart layout="vertical" data={synthTrans.niches.map(r => ({ niche: r.niche, real: r.real_count, live_synth: r.live_synthetic, expired: r.expired_count }))} margin={{ top: 0, right: 16, left: 60, bottom: 0 }}>
                      <XAxis type="number" tick={{ fontSize: 8, fill: '#444' }} />
                      <YAxis type="category" dataKey="niche" tick={{ fontSize: 8, fill: '#555' }} width={58} />
                      <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.65rem', color: '#ccc' }} />
                      <Bar dataKey="real"       stackId="a" fill="#4ade8088" name="real" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="live_synth" stackId="a" fill="#fbbf2466" name="synthetic" radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                    <span style={{ fontSize: '0.57rem', color: '#4ade80' }}>● real outcomes</span>
                    <span style={{ fontSize: '0.57rem', color: '#fbbf24' }}>● synthetic (live)</span>
                  </div>
                </div>
                <div style={{ ...S.card, margin: 0 }}>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Transition Status</div>
                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>Niche</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Budget</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Done</th>
                    </tr></thead>
                    <tbody>
                      {synthTrans.niches.slice(0, 10).map(r => (
                        <tr key={r.niche}>
                          <td style={{ ...S.td, color: '#666', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.niche}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#555' }}>{r.budget_pct}% synth</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>
                            <span style={{ fontSize: '0.65rem', color: r.transition_complete ? '#4ade80' : '#fbbf24' }}>{r.transition_complete ? '✓' : `${r.live_synthetic}→${r.allowed_synthetic}`}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
      </LSection>
    </div>
  );
}

const SORT_KEYS = ['sample_count', 'mae', 'avg_error', 'avg_actual', 'real_count'];

function LearningTab({ token }) {
  const [kpis,   setKpis]   = useState(null);
  const [hist,   setHist]   = useState(null);
  const [niches, setNiches] = useState(null);
  const [dist,   setDist]   = useState(null);
  const [events, setEvents] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [histDays, setHistDays] = useState(30);
  const [sortKey, setSortKey]   = useState('sample_count');
  const [sortDir, setSortDir]   = useState('desc');
  const [collapsed, setCollapsed] = useState({ trends: false, niches: false, dist: false, events: true });
  const [snapping, setSnapping]   = useState(false);
  const [snapMsg,  setSnapMsg]    = useState('');
  const [activeSubTab, setActiveSubTab] = useState(0);

  const toggle = (k) => setCollapsed(p => ({ ...p, [k]: !p[k] }));

  const load = useCallback(async () => {
    setLoading(true);
    const safe = async (url) => { try { return await apiFetch(url, token); } catch { return null; } };
    const [k, h, n, d, e] = await Promise.all([
      safe(ROUTES.adminLearningKpis),
      safe(`${ROUTES.adminLearningHistory}?days=${histDays}`),
      safe(ROUTES.adminLearningNicheIntel),
      safe(ROUTES.adminLearningDistributions),
      safe(ROUTES.adminLearningEvents),
    ]);
    setKpis(k); setHist(h); setNiches(n); setDist(d); setEvents(e);
    setLoading(false);
  }, [token, histDays]);

  useEffect(() => { load(); }, [load]);

  async function triggerSnapshot() {
    setSnapping(true); setSnapMsg('');
    try {
      const r = await apiFetch(ROUTES.adminLearningSnapshot, token, { method: 'POST' });
      setSnapMsg(r.skipped ? `Snapshot already exists for today` : `Snapshot saved for ${r.snapshot?.snapshot_date}`);
      load();
    } catch (e) { setSnapMsg(`Error: ${e.message}`); }
    finally { setSnapping(false); }
  }

  if (loading) return <div style={{ color: '#333', fontSize: '0.78rem', padding: '20px 0' }}>Loading learning intelligence data…</div>;

  const k   = kpis?.kpis ?? {};
  const mae = k.mae?.current;
  const trust = k.calibration_trust?.current;
  const synthRatio = k.synthetic_ratio?.current;
  const histRows = hist?.rows ?? [];
  const nicheRows = [...(niches?.niches ?? [])].sort((a, b) => {
    const diff = (a[sortKey] ?? 0) - (b[sortKey] ?? 0);
    return sortDir === 'asc' ? diff : -diff;
  });

  function SortTh({ col, label, tip }) {
    return (
      <th style={{ ...S.th, cursor: 'pointer', userSelect: 'none' }} title={tip} onClick={() => { if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(col); setSortDir('desc'); } }}>
        {label}{sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
        {['Overview', 'Intelligence History'].map((label, i) => (
          <button key={i} onClick={() => setActiveSubTab(i)} style={{ ...S.btn, padding: '4px 14px', fontSize: '0.65rem', borderColor: activeSubTab === i ? '#8888ff' : '#222', color: activeSubTab === i ? '#8888ff' : '#444' }}>{label}</button>
        ))}
      </div>
      {activeSubTab === 0 && (
      <div>
      {/* Alert banners */}
      <AlertBanners alerts={kpis?.alerts ?? []} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: '0.65rem', color: '#333' }}>
          Source: <span style={{ color: '#555' }}>{hist?.source === 'snapshots' ? 'daily snapshots' : 'live-derived (snapshots accumulating)'}</span>
          {' · '}{kpis?.totals?.total ?? 0} calibration rows · {kpis?.totals?.real ?? 0} real · {kpis?.totals?.synthetic ?? 0} synthetic
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btn} onClick={triggerSnapshot} disabled={snapping}>{snapping ? 'Saving…' : 'Save Snapshot'}</button>
          <button style={S.btn} onClick={load}>Refresh</button>
        </div>
      </div>
      {snapMsg && <div style={{ ...S.ok, marginBottom: 10, fontSize: '0.68rem' }}>{snapMsg}</div>}

      {/* Section 1 — KPI Cards */}
      <LSection title="Learning Health KPIs" collapsed={false} onToggle={() => {}}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>

          <KpiCard
            title="MAE — Mean Absolute Error"
            value={mae ?? '—'}
            color={MAE_STATUS(mae)}
            delta24h={k.mae?.delta_24h}
            delta7d={k.mae?.delta_7d}
            lowerBetter
            tooltip="Measures average prediction error. Lower is better. Falling MAE means TubeIntel predictions are becoming more accurate over time. Green < 15 · Yellow 15–30 · Red > 30"
            sub={mae < 15 ? 'Excellent' : mae < 30 ? 'Acceptable' : mae != null ? 'Needs attention' : ''}
          />

          <KpiCard
            title="Calibration Trust Score"
            value={trust ?? '—'}
            unit="/100"
            color={TRUST_COLOR(trust)}
            delta24h={k.calibration_trust?.delta_24h}
            delta7d={k.calibration_trust?.delta_7d}
            lowerBetter={false}
            tooltip="Composite score based on sample count (20%), real vs synthetic ratio (35%), freshness (20%), benchmark health (15%), MAE quality (10%). Higher is better."
            sub={trust >= 70 ? 'Trustworthy' : trust >= 40 ? 'Developing' : trust != null ? 'Low confidence' : ''}
          />

          <KpiCard
            title="Learning Velocity"
            value={k.learning_velocity?.label ?? '—'}
            color={VEL_COLOR[k.learning_velocity?.label] ?? '#555'}
            lowerBetter={false}
            tooltip="Stable: consistent accuracy. Improving: MAE declining and weights stable. Volatile: rapid weight changes or high calibration frequency. Drifting: benchmark shift with weight changes."
          />

          <KpiCard
            title="Synthetic vs Real Ratio"
            value={synthRatio != null ? `${Math.round(synthRatio * 100)}%` : '—'}
            color={SYNTH_COLOR(synthRatio)}
            lowerBetter
            tooltip="Tracks reliance on synthetic market learning vs real creator outcome data. Healthy early on, but should decline as real creator feedback grows. Green < 50% · Yellow 50–90% · Red > 90%"
            sub={`${k.synthetic_ratio?.real_rows ?? 0} real · ${k.synthetic_ratio?.synthetic_rows ?? 0} synthetic`}
          />

          <KpiCard
            title="Benchmark Health"
            value={k.benchmark_health?.score ?? '—'}
            unit="/100"
            color={k.benchmark_health?.score >= 80 ? '#4ade80' : k.benchmark_health?.score >= 50 ? '#fbbf24' : '#f87171'}
            lowerBetter={false}
            tooltip="Percentage of niche/duration combinations with valid (non-zero) benchmark VPH data. 100 = all benchmarks healthy. Lower = gaps in niche coverage."
            sub={`${k.benchmark_health?.zero_count ?? 0} zero-benchmark niches · ${k.benchmark_health?.coverage_niches ?? 0} covered`}
          />

          <KpiCard
            title="Stale Outcomes"
            value={k.stale_outcomes?.count_30d ?? '—'}
            color={k.stale_outcomes?.count_30d > 0 ? '#fbbf24' : '#4ade80'}
            lowerBetter
            tooltip="Rows where last_refreshed_at is older than the threshold. High stale counts mean the learning engine is operating on outdated signals."
            sub={`>1d: ${k.stale_outcomes?.count_1d ?? 0}  ·  >7d: ${k.stale_outcomes?.count_7d ?? 0}  ·  >30d: ${k.stale_outcomes?.count_30d ?? 0}`}
          />
        </div>
      </LSection>

      {/* Section 2 — Historical Trends */}
      <LSection title="Historical Learning Trends" collapsed={collapsed.trends} onToggle={() => toggle('trends')}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
          <span style={{ fontSize: '0.65rem', color: '#444' }}>Range:</span>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setHistDays(d)} style={{ ...S.btn, padding: '4px 10px', fontSize: '0.65rem', borderColor: histDays === d ? '#8888ff' : '#222', color: histDays === d ? '#8888ff' : '#444' }}>{d}d</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="mae" color={MAE_STATUS(mae)} label="MAE Trend — lower = improving accuracy" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Downward trend is healthy. Sudden spikes may indicate benchmark corruption or calibration instability.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="total_calibration_rows" color="#60a5fa" label="Calibration Sample Growth" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Growing sample count increases calibration confidence over time.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="synthetic_rows" color="#8888ff" label="Synthetic Rows Accumulated" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Synthetic data bootstraps learning. Real rows (from creator predictions) should grow to dominate over time.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="calibration_trust_score" color={TRUST_COLOR(trust)} label="Calibration Trust Score Trend" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Rising trust score means the system is accumulating reliable real-world calibration signal.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="benchmark_drift" color="#fbbf24" label="Benchmark Drift" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Small gradual drift is healthy (market changes). Large spikes may indicate benchmark instability or data quality issues.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <SparkChart data={histRows} dataKey="stale_outcomes" color="#f87171" label="Stale Outcomes Count" />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Should trend toward zero as the snapshot refresh cron runs. Rising count = learning on outdated data.</div>
          </div>
        </div>
      </LSection>

      {/* Section 3 — Niche Intelligence Panel */}
      <LSection title="Niche Intelligence Panel" collapsed={collapsed.niches} onToggle={() => toggle('niches')}>
        {nicheRows.length === 0
          ? <div style={{ color: '#333', fontSize: '0.75rem' }}>No niche data available yet</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>#</th>
                    <SortTh col="niche"        label="Niche" />
                    <SortTh col="sample_count" label="Samples"  tip="Total calibration rows for this niche" />
                    <SortTh col="avg_error"    label="Avg Error" tip="Positive = TubeIntel over-predicts this niche. Negative = under-predicts. Target: near 0." />
                    <SortTh col="avg_actual"   label="Avg Actual" tip="Average actual performance score (0-100) for this niche based on VPH vs benchmarks" />
                    <SortTh col="mae"          label="MAE"    tip="Mean Absolute Error — average magnitude of prediction error regardless of direction" />
                    <th style={S.th} title="Whether the niche is systematically over-predicted, under-predicted, or well-calibrated">Trend</th>
                    <SortTh col="real_count"   label="R/S"    tip="Real vs Synthetic row count. R = real creator predictions (high quality). S = synthetic market data (half weight)." />
                    <th style={S.th} title="How recently this niche had a calibration outcome updated">Freshness</th>
                  </tr>
                </thead>
                <tbody>
                  {nicheRows.map((r, i) => <NicheRow key={r.niche} r={r} rank={i + 1} />)}
                </tbody>
              </table>
            </div>
          )
        }
      </LSection>

      {/* Section 4 — Calibration Distribution Analysis */}
      <LSection title="Calibration Distribution Analysis" collapsed={collapsed.dist} onToggle={() => toggle('dist')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div style={{ ...S.card, margin: 0 }}>
            <HistChart
              data={dist?.actual ?? []} xKey="bucket" yKey="n" color="#60a5fa"
              label="Actual Performance Score Distribution"
              tooltip="Healthy: broad distribution across all buckets. If scores cluster near 100, VPH formula or percentile normalization may be corrupted."
            />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Healthy distribution spans 0–100 with no extreme clustering at either end.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            <HistChart
              data={dist?.error ?? []} xKey="bucket" yKey="n" color="#fbbf24"
              label="Calibration Error Distribution"
              tooltip="Centered near 0 = well-calibrated. Skewed right = systematic over-prediction. Skewed left = systematic under-prediction."
            />
            <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 4 }}>Should be roughly bell-curved around 0. Asymmetry reveals systematic prediction bias.</div>
          </div>
          <div style={{ ...S.card, margin: 0 }}>
            {dist?.bands?.length
              ? (
                <div>
                  <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Calibration Band Breakdown</div>
                  {(dist.bands ?? []).map(b => {
                    const total = b.total ?? 0;
                    const pct = kpis?.totals?.total > 0 ? Math.round((total / kpis.totals.total) * 100) : 0;
                    return (
                      <div key={b.calibration_band} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: '0.68rem', color: BAND_COLOR[b.calibration_band] ?? '#555' }}>{b.calibration_band?.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: '0.65rem', color: '#555' }}>{total} ({pct}%)</span>
                        </div>
                        <div style={{ height: 4, background: '#111', borderRadius: 2 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: BAND_COLOR[b.calibration_band] ?? '#555', borderRadius: 2, opacity: 0.7 }} />
                        </div>
                        <div style={{ fontSize: '0.57rem', color: '#2a2a3a', marginTop: 1 }}>
                          {b.real > 0 ? `${b.real} real` : ''}{b.real > 0 && b.synthetic > 0 ? ' · ' : ''}{b.synthetic > 0 ? `${b.synthetic} synthetic` : ''}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: '0.58rem', color: '#222', marginTop: 8 }}>Accurate = |error| ≤ 10. Slight = 10–25. Large = &gt;25. Synthetic rows have 0.5× calibration weight.</div>
                </div>
              )
              : <div style={{ color: '#333', fontSize: '0.75rem' }}>No distribution data</div>
            }
          </div>
        </div>
      </LSection>

      {/* Section 5 — Learning Event Timeline */}
      <LSection title="Learning Event Timeline" collapsed={collapsed.events} onToggle={() => toggle('events')}>
        {!(events?.events?.length)
          ? <div style={{ color: '#333', fontSize: '0.75rem' }}>No learning events recorded yet</div>
          : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {(events.events ?? []).map((ev, i) => <EventRow key={ev.id ?? i} ev={ev} />)}
            </div>
          )
        }
      </LSection>
      </div>
      )}
      {activeSubTab === 1 && <HistorySubtab token={token} />}
    </div>
  );
}

// ── Discovery Tab ─────────────────────────────────────────────────────────────

const SOURCE_LABEL = {
  featured_channels: 'Featured',
  topic_search:      'Topic Search',
  video_search:      'Video Search',
  unknown:           'Unknown',
};

const DUP_COLOR = { none: '#4ade80', medium: '#fbbf24', high: '#f87171' };
const DUP_LABEL = { none: 'New', medium: 'Seen Before', high: 'Already Ingested' };

function DiscoveryBadge({ label, color, bg, border }) {
  return (
    <span style={{
      display: 'inline-block', background: bg, border: `1px solid ${border}`,
      borderRadius: 4, padding: '1px 7px', fontSize: '0.62rem', color, fontWeight: 600,
      letterSpacing: '0.04em', marginRight: 3, marginBottom: 3,
    }}>{label}</span>
  );
}

function DiversityBar({ score }) {
  const pct   = Math.round((score ?? 0) * 100);
  const color = pct >= 60 ? '#4ade80' : pct >= 35 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: '#1a1a2e', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: '0.65rem', color, minWidth: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function CandidateCard({ candidate, onAction, selected, onSelect }) {
  const {
    id, title, handle, thumbnail_url, subscriber_count, video_count,
    primary_niche, content_archetype, inferred_topics, behavior_tags,
    discovery_source, discovery_confidence, diversity_score, duplicate_risk,
    identity_confidence, approval_status,
  } = candidate;

  const topics   = Array.isArray(inferred_topics) ? inferred_topics : [];
  const tags     = Array.isArray(behavior_tags)   ? behavior_tags   : [];
  const conf     = Math.round((discovery_confidence ?? 0) * 100);
  const isActioned = approval_status !== 'pending';

  return (
    <div style={{
      background: isActioned ? '#0a0a10' : '#0d0d18',
      border: `1px solid ${selected ? '#4444aa' : isActioned ? '#111' : '#1a1a2e'}`,
      borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 14,
      opacity: isActioned ? 0.55 : 1,
    }}>
      {/* Select checkbox */}
      <div style={{ paddingTop: 2 }}>
        <input type="checkbox" checked={selected} onChange={() => onSelect(id)}
          style={{ accentColor: '#8888ff', cursor: 'pointer' }} />
      </div>

      {/* Thumbnail */}
      {thumbnail_url
        ? <img src={thumbnail_url} alt="" style={{ width: 52, height: 52, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: 52, height: 52, borderRadius: 6, background: '#1a1a2e', flexShrink: 0 }} />}

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ccc', marginBottom: 1 }}>
              {title ?? 'Unknown Channel'}
            </div>
            <div style={{ fontSize: '0.65rem', color: '#444' }}>
              {handle ? `${handle} · ` : ''}{subscriber_count != null ? `${(subscriber_count / 1000).toFixed(0)}K subs` : ''}{video_count ? ` · ${video_count} videos` : ''}
            </div>
          </div>
          {/* Status badge if actioned */}
          {isActioned && (
            <span style={{ fontSize: '0.62rem', fontWeight: 700, color: approval_status === 'approved' ? '#4ade80' : '#f87171', letterSpacing: '0.08em' }}>
              {approval_status.toUpperCase()}
            </span>
          )}
        </div>

        {/* Semantic badges */}
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap' }}>
          {primary_niche && <DiscoveryBadge label={primary_niche} color="#7aadff" bg="#0d1526" border="#1a3060" />}
          {content_archetype && <DiscoveryBadge label={content_archetype} color="#fbbf24" bg="#1a1200" border="#3a2800" />}
          {topics.slice(0, 3).map(t => <DiscoveryBadge key={t} label={t} color="#2dd4bf" bg="#041a1a" border="#0a3030" />)}
          {tags.slice(0, 2).map(t => <DiscoveryBadge key={t} label={t} color="#a78bfa" bg="#140d26" border="#2a1a50" />)}
        </div>

        {/* Metrics row */}
        <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: '0.65rem', color: '#555' }}>
            Source: <span style={{ color: '#888' }}>{SOURCE_LABEL[discovery_source] ?? discovery_source}</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: '#555' }}>
            Confidence: <span style={{ color: '#888' }}>{conf}%</span>
          </div>
          <div style={{ fontSize: '0.65rem', color: DUP_COLOR[duplicate_risk ?? 'none'] }}>
            {DUP_LABEL[duplicate_risk ?? 'none']}
          </div>
        </div>

        {/* Diversity bar */}
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: '0.6rem', color: '#333', marginBottom: 3 }}>Dataset diversity</div>
          <DiversityBar score={diversity_score} />
        </div>
      </div>

      {/* Action buttons */}
      {!isActioned && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <button onClick={() => onAction(id, 'approved')}
            style={{ background: '#0f2a1a', border: '1px solid #1a4a2a', borderRadius: 6, color: '#4ade80', padding: '5px 12px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
            Approve
          </button>
          <button onClick={() => onAction(id, 'rejected')}
            style={{ background: '#1a0f0f', border: '1px solid #3a1a1a', borderRadius: 6, color: '#f87171', padding: '5px 12px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
            Reject
          </button>
          <button onClick={() => onAction(id, 'ignored')}
            style={{ background: '#111', border: '1px solid #222', borderRadius: 6, color: '#444', padding: '5px 10px', cursor: 'pointer', fontSize: '0.68rem' }}>
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}

// ── Tab: Corpus Composition Dashboard ────────────────────────────────────────

const LANG_LABELS = {
  en: 'English', 'en-GB': 'English', 'en-US': 'English', 'en-IN': 'English',
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
  es: 'Spanish', pt: 'Portuguese', id: 'Indonesian', ar: 'Arabic',
  fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean',
  zh: 'Chinese', ru: 'Russian', tr: 'Turkish',
  und: 'Undetermined', unknown: 'Unknown',
};

function normLang(code) {
  if (!code) return 'Unknown';
  const base = code.split('-')[0].toLowerCase();
  return LANG_LABELS[code] ?? LANG_LABELS[base] ?? code.toUpperCase();
}

function CorpusTab({ token }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const d = await apiFetch(ROUTES.corpusComposition, token);
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div style={{ color: '#333', fontSize: '0.78rem', padding: '20px 0' }}>Loading corpus data…</div>;
  if (err)     return <div style={{ color: '#f87171', fontSize: '0.78rem', padding: '20px 0' }}>{err}</div>;

  const { summary, languages, niches, qualityDist, growth } = data ?? {};
  const s = summary ?? {};

  // Normalize + merge language variants (e.g. en, en-GB, en-US → English)
  const langMerged = Object.values(
    (languages ?? []).reduce((acc, row) => {
      const label = normLang(row.lang);
      if (!acc[label]) acc[label] = { lang: label, total: 0, eligible: 0 };
      acc[label].total    += row.total ?? 0;
      acc[label].eligible += row.eligible ?? 0;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);

  const QUAL_COLORS = { 'unscored': '#333', '0-19': '#f87171', '20-39': '#fb923c', '40-59': '#fbbf24', '60-79': '#a3e635', '80-100': '#4ade80' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button style={S.btn} onClick={load}>Refresh</button>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        {[
          { label: 'Total Channels',      value: s.total_channels?.toLocaleString() },
          { label: 'Training Eligible',   value: s.training_eligible?.toLocaleString(), sub: `${s.total_channels ? Math.round((s.training_eligible / s.total_channels) * 100) : 0}% of corpus` },
          { label: 'Videos Ingested',     value: s.video_count?.toLocaleString() },
          { label: 'Graph Edges',         value: s.graph_edges?.toLocaleString(), sub: 'need 10K for Louvain' },
          { label: 'Ingested (w/ videos)',value: s.ingested?.toLocaleString() },
          { label: 'Avg Quality Score',   value: s.avg_quality ?? '—', sub: 'training gate: 60' },
        ].map(({ label, value, sub }) => (
          <StatBox key={label} label={label} value={value} sub={sub} />
        ))}
      </div>

      {/* Progress bars toward milestones */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Corpus Growth Targets</div>
        {[
          { label: 'Channels (target: 5,000 for Louvain)', current: s.total_channels ?? 0, target: 5000 },
          { label: 'Graph Edges (target: 10,000)',         current: s.graph_edges ?? 0,    target: 10000 },
        ].map(({ label, current, target }) => {
          const pct = Math.min(100, Math.round((current / target) * 100));
          return (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.68rem', color: '#555' }}>{label}</span>
                <span style={{ fontSize: '0.68rem', color: '#8888ff' }}>{current.toLocaleString()} / {target.toLocaleString()} ({pct}%)</span>
              </div>
              <div style={{ background: '#111', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#8888ff', borderRadius: 4, transition: 'width 0.4s' }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>

        {/* Language breakdown */}
        <div style={S.card}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Channels by Language</div>
          <ResponsiveContainer width="100%" height={Math.min(260, langMerged.length * 26 + 20)}>
            <BarChart layout="vertical" data={langMerged.slice(0, 12)} margin={{ top: 0, right: 40, left: 70, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 8, fill: '#444' }} />
              <YAxis type="category" dataKey="lang" tick={{ fontSize: 9, fill: '#666' }} width={68} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }}
                formatter={(v, name) => [v, name === 'total' ? 'total' : 'eligible']} />
              <Bar dataKey="total"    fill="#8888ff44" name="total"    radius={[0, 2, 2, 0]} />
              <Bar dataKey="eligible" fill="#4ade8088" name="eligible" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            <span style={{ fontSize: '0.57rem', color: '#8888ff' }}>■ total</span>
            <span style={{ fontSize: '0.57rem', color: '#4ade80' }}>■ training-eligible</span>
          </div>
        </div>

        {/* Quality distribution */}
        <div style={S.card}>
          <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Quality Score Distribution</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={qualityDist ?? []} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="bucket" tick={{ fontSize: 8, fill: '#444' }} />
              <YAxis tick={{ fontSize: 8, fill: '#444' }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }}
                formatter={(v, name) => [v, name === 'n' ? 'channels' : 'eligible']} />
              <Bar dataKey="n" name="n" radius={[2, 2, 0, 0]}>
                {(qualityDist ?? []).map((d, i) => (
                  <Cell key={i} fill={QUAL_COLORS[d.bucket] ?? '#8888ff'} />
                ))}
              </Bar>
              <Bar dataKey="eligible" name="eligible" fill="#4ade8066" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: '0.58rem', color: '#333', marginTop: 4 }}>Green bars = training-eligible overlay. Training gate: score ≥ 60.</div>
        </div>
      </div>

      {/* Corpus growth (last 30 days) */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Corpus Growth — Last 30 Days</div>
        {(growth ?? []).length < 2 ? (
          <div style={{ color: '#333', fontSize: '0.72rem' }}>Not enough data yet — check back after more discovery runs.</div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={growth} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="corpusGrowthGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8888ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8888ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#111" />
              <XAxis dataKey="day" tick={{ fontSize: 8, fill: '#444' }} tickFormatter={v => v?.slice(5)} />
              <YAxis tick={{ fontSize: 8, fill: '#444' }} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }}
                formatter={v => [v, 'new channels']} labelFormatter={v => `Date: ${v}`} />
              <Area type="monotone" dataKey="new_channels" stroke="#8888ff" fill="url(#corpusGrowthGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Niche breakdown table + chart */}
      <div style={S.card}>
        <div style={{ fontSize: '0.6rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Channels by Niche</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <ResponsiveContainer width="100%" height={Math.min(340, (niches?.length ?? 0) * 22 + 20)}>
            <BarChart layout="vertical" data={niches ?? []} margin={{ top: 0, right: 40, left: 80, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 8, fill: '#444' }} />
              <YAxis type="category" dataKey="niche" tick={{ fontSize: 9, fill: '#666' }} width={78} />
              <Tooltip contentStyle={{ background: '#0a0a0f', border: '1px solid #222', fontSize: '0.7rem', color: '#ccc' }} />
              <Bar dataKey="total"    fill="#8888ff44" name="total"    radius={[0, 2, 2, 0]} />
              <Bar dataKey="eligible" fill="#4ade8088" name="eligible" radius={[0, 2, 2, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Niche</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Eligible</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Avg Q</th>
              </tr></thead>
              <tbody>
                {(niches ?? []).map(r => (
                  <tr key={r.niche}>
                    <td style={S.td}>{r.niche}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: '#8888ff' }}>{r.total}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: '#4ade80' }}>{r.eligible}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: (r.avg_quality ?? 0) >= 60 ? '#4ade80' : (r.avg_quality ?? 0) >= 40 ? '#fbbf24' : '#f87171' }}>
                      {r.avg_quality ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscoveryTab({ token }) {
  const [seedInput,   setSeedInput]   = useState('');
  const [jobId,       setJobId]       = useState(null);
  const [job,         setJob]         = useState(null);
  const [candidates,  setCandidates]  = useState([]);
  const [stats,       setStats]       = useState(null);
  const [filter,      setFilter]      = useState('pending');
  const [selected,    setSelected]    = useState(new Set());
  const [err,         setErr]         = useState('');
  const [polling,     setPolling]     = useState(false);

  const headers = token ? { 'Content-Type': 'application/json', 'x-admin-token': token } : { 'Content-Type': 'application/json' };

  async function fetchCandidates() {
    try {
      const url = filter ? `${ROUTES.adminDiscoveryCandidates}?status=${filter}` : ROUTES.adminDiscoveryCandidates;
      const r   = await fetch(url, { headers });
      const d   = await r.json();
      setCandidates(d.candidates ?? []);
    } catch (_) {}
  }

  async function fetchStats() {
    try {
      const r = await fetch(ROUTES.adminDiscoveryStats, { headers });
      const d = await r.json();
      setStats(d);
    } catch (_) {}
  }

  useEffect(() => { fetchCandidates(); fetchStats(); }, [filter]);

  // Poll job status while running
  useEffect(() => {
    if (!jobId || !polling) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(ROUTES.adminDiscoveryJob(jobId), { headers });
        const d = await r.json();
        setJob(d);
        if (d.status === 'complete' || d.status === 'error') {
          setPolling(false);
          fetchCandidates();
          fetchStats();
        }
      } catch (_) { setPolling(false); }
    }, 1500);
    return () => clearInterval(iv);
  }, [jobId, polling]);

  async function startDiscovery() {
    if (!seedInput.trim()) return;
    setErr(''); setJob(null);
    try {
      const r = await fetch(ROUTES.adminDiscoveryRun, {
        method: 'POST', headers, body: JSON.stringify({ seed_input: seedInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Failed to start discovery'); return; }
      setJobId(d.job_id);
      setPolling(true);
    } catch (e) { setErr(e.message); }
  }

  async function handleAction(id, status) {
    try {
      await fetch(ROUTES.adminDiscoveryCandidate(id), {
        method: 'PATCH', headers, body: JSON.stringify({ status }),
      });
      setCandidates(prev => prev.map(c => c.id === id ? { ...c, approval_status: status } : c));
      fetchStats();
    } catch (_) {}
  }

  async function bulkAction(status) {
    if (!selected.size) return;
    try {
      await fetch(ROUTES.adminDiscoveryBulk, {
        method: 'POST', headers, body: JSON.stringify({ ids: [...selected], status }),
      });
      setSelected(new Set());
      fetchCandidates();
      fetchStats();
    } catch (_) {}
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function selectAll() {
    const pendingIds = candidates.filter(c => c.approval_status === 'pending').map(c => c.id);
    setSelected(new Set(pendingIds));
  }

  const jobRunning  = job?.status === 'running' || job?.status === 'queued';
  const jobComplete = job?.status === 'complete';
  const jobError    = job?.status === 'error';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Total Found',    value: stats.total },
            { label: 'Pending',        value: stats.pending },
            { label: 'Approved',       value: stats.approved },
            { label: 'Rejected',       value: stats.rejected },
            { label: 'Duplicate Risk', value: stats.duplicates },
          ].map(s => (
            <div key={s.label} style={{ background: '#0d0d12', border: '1px solid #1a1a2e', borderRadius: 8, padding: '10px 14px', minWidth: 100 }}>
              <div style={{ fontSize: '0.58rem', color: '#444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#8888ff' }}>{s.value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {/* Seed input */}
      <div style={{ background: '#0d0d18', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Seed Channel Discovery
        </div>
        <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: 10 }}>
          Enter a YouTube channel URL or @handle. The system will discover related channels via featured channels, topic search, and video adjacency.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={seedInput}
            onChange={e => setSeedInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && startDiscovery()}
            placeholder="@ThinkSchool or https://youtube.com/@MrBeast"
            style={{ flex: 1, background: '#070710', border: '1px solid #2a2a50', borderRadius: 6, color: '#ccc', padding: '8px 12px', fontSize: '0.78rem', outline: 'none' }}
          />
          <button
            onClick={startDiscovery}
            disabled={jobRunning || !seedInput.trim()}
            style={{ background: jobRunning ? '#1a1a2e' : '#1a1a4a', border: '1px solid #3a3a8a', borderRadius: 6, color: jobRunning ? '#555' : '#8888ff', padding: '8px 18px', cursor: jobRunning ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {jobRunning ? 'Discovering…' : 'Discover Related Channels'}
          </button>
        </div>
        {err && <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#f87171' }}>{err}</div>}

        {/* Job status */}
        {job && (
          <div style={{ marginTop: 12, background: '#070710', border: `1px solid ${jobError ? '#4a1a1a' : jobComplete ? '#0a3020' : '#1a2a4a'}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: jobError ? '#f87171' : jobComplete ? '#4ade80' : '#8888ff' }}>
                {jobError ? `Error: ${job.error}` : jobComplete ? `Complete — ${job.result?.saved ?? 0} new candidates saved` : `${job.progress?.stage ?? 'running'}…`}
              </span>
              {jobRunning && (
                <span style={{ fontSize: '0.65rem', color: '#444' }}>
                  Found {job.progress?.found ?? 0} · Classified {job.progress?.classified ?? 0} · Saved {job.progress?.saved ?? 0}
                </span>
              )}
              {jobComplete && job.result && (
                <span style={{ fontSize: '0.65rem', color: '#333' }}>
                  Topics: {(job.result.topics_used ?? []).join(', ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filter + bulk actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['pending', 'approved', 'rejected', 'ignored', ''].map(s => (
            <button key={s || 'all'} onClick={() => { setFilter(s); setSelected(new Set()); }}
              style={{ background: filter === s ? '#1a1a3a' : 'transparent', border: `1px solid ${filter === s ? '#3a3a6a' : '#1a1a2e'}`, borderRadius: 6, color: filter === s ? '#8888ff' : '#444', padding: '4px 12px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 600 }}>
              {s || 'All'}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.65rem', color: '#555' }}>{selected.size} selected</span>
            <button onClick={() => bulkAction('approved')}
              style={{ background: '#0f2a1a', border: '1px solid #1a4a2a', borderRadius: 6, color: '#4ade80', padding: '4px 12px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700 }}>
              Bulk Approve
            </button>
            <button onClick={() => bulkAction('rejected')}
              style={{ background: '#1a0f0f', border: '1px solid #3a1a1a', borderRadius: 6, color: '#f87171', padding: '4px 12px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700 }}>
              Bulk Reject
            </button>
            <button onClick={() => setSelected(new Set())}
              style={{ background: 'transparent', border: '1px solid #222', borderRadius: 6, color: '#333', padding: '4px 10px', cursor: 'pointer', fontSize: '0.65rem' }}>
              Clear
            </button>
          </div>
        )}

        {candidates.some(c => c.approval_status === 'pending') && selected.size === 0 && (
          <button onClick={selectAll}
            style={{ background: 'transparent', border: '1px solid #1a1a2e', borderRadius: 6, color: '#444', padding: '4px 12px', cursor: 'pointer', fontSize: '0.68rem' }}>
            Select All Pending
          </button>
        )}
      </div>

      {/* Candidate list */}
      {candidates.length === 0 ? (
        <div style={{ color: '#333', fontSize: '0.78rem', padding: '24px 0', textAlign: 'center' }}>
          {filter === 'pending' ? 'No pending candidates — run a discovery to populate.' : `No ${filter || ''} candidates.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.map(c => (
            <CandidateCard
              key={c.id}
              candidate={c}
              onAction={handleAction}
              selected={selected.has(c.id)}
              onSelect={toggleSelect}
            />
          ))}
        </div>
      )}
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
  const [loadErr,   setLoadErr]   = useState('');

  const [discoverRunning, setDiscoverRunning] = useState(false);
  const [discoverResult,  setDiscoverResult]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('yta_corpus_discover_result') ?? 'null'); } catch { return null; }
  });
  const [discoverErr, setDiscoverErr] = useState('');

  const [promoteRunning, setPromoteRunning] = useState(false);
  const [promoteResult,  setPromoteResult]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('yta_corpus_promote_result') ?? 'null'); } catch { return null; }
  });
  const [promoteErr, setPromoteErr] = useState('');

  const [ingestOnlyRunning, setIngestOnlyRunning] = useState(false);
  const [ingestOnlyResult,  setIngestOnlyResult]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('yta_corpus_ingest_only_result') ?? 'null'); } catch { return null; }
  });
  const [ingestOnlyErr, setIngestOnlyErr] = useState('');

  function slimResult(raw) {
    const KEEP = ['light_ingest', 'auto_promote', 'discovery_search', 'niche_classify', 'quality_eval', 'training_gate'];
    return {
      quota_used:  raw.quota_used,
      duration_ms: raw.duration_ms,
      _ran_at:     new Date().toISOString(),
      log: (raw.log ?? []).filter(e => KEEP.includes(e.step)),
    };
  }

  async function triggerDiscover() {
    setDiscoverRunning(true);
    setDiscoverErr('');
    try {
      const data   = await apiFetch(ROUTES.corpusSchedulerRun, token, {
        method: 'POST',
        body: JSON.stringify({
          allow_search: true, allow_ai_discovery: true, allow_video_search: true,
          allow_hindi_search: true, allow_tamil_search: true, allow_telugu_search: true,
          allow_bengali_search: true, allow_kannada_search: true, allow_malayalam_search: true,
          allow_spanish_search: true, allow_portuguese_search: true, allow_indonesian_search: true,
          allow_arabic_search: true, allow_punjabi_search: true,
          quota_budget: 5000, mode: 'discover',
        }),
      });
      const result = slimResult(data.result);
      setDiscoverResult(result);
      try { localStorage.setItem('yta_corpus_discover_result', JSON.stringify(result)); } catch (_) {}
    } catch (e) {
      setDiscoverErr(e.message);
    } finally {
      setDiscoverRunning(false);
    }
  }

  async function triggerPromote() {
    setPromoteRunning(true);
    setPromoteErr('');
    try {
      const data   = await apiFetch(ROUTES.corpusSchedulerRun, token, {
        method: 'POST',
        body: JSON.stringify({ quota_budget: 4000, mode: 'promote' }),
      });
      const result = slimResult(data.result);
      setPromoteResult(result);
      try { localStorage.setItem('yta_corpus_promote_result', JSON.stringify(result)); } catch (_) {}
    } catch (e) {
      setPromoteErr(e.message);
    } finally {
      setPromoteRunning(false);
    }
  }

  async function triggerIngestOnly() {
    setIngestOnlyRunning(true);
    setIngestOnlyErr('');
    try {
      const data   = await apiFetch(ROUTES.corpusSchedulerRun, token, {
        method: 'POST',
        body: JSON.stringify({ quota_budget: 8000, mode: 'full' }),
      });
      const result = slimResult(data.result);
      setIngestOnlyResult(result);
      try { localStorage.setItem('yta_corpus_ingest_only_result', JSON.stringify(result)); } catch (_) {}
    } catch (e) {
      setIngestOnlyErr(e.message);
    } finally {
      setIngestOnlyRunning(false);
    }
  }

  const load = useCallback(async (tok) => {
    const t = tok ?? token;
    setLoadErr('');
    try {
      const s = await apiFetch(ROUTES.adminIntelStatus, t);
      setStatus(s);
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
    setToken(''); setAuthed(false); setStatus(null);
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
              {status?.maintenance?.summary?.due > 0 && (
                <span style={S.tagRed}>{status.maintenance.summary.due} maintenance due</span>
              )}
              {!status?.maintenance?.summary?.due && status?.maintenance?.summary?.warning > 0 && (
                <span style={{ ...S.tag, color: '#facc15', borderColor: '#4a3a1a', background: '#1f1a0a' }}>
                  {status.maintenance.summary.warning} maintenance soon
                </span>
              )}
            </div>
            <button style={{ ...S.btn, fontSize: '0.7rem' }} onClick={clearToken}>Clear Token</button>
          </div>

          {loadErr && <div style={{ ...S.err, marginBottom: 12 }}>{loadErr}</div>}

          {/* Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, marginBottom: 20, borderBottom: '1px solid #1a1a2e' }}>
            {TABS.map((t, i) => {
              const maint = tabMaintenance(t, status?.maintenance);
              return (
                <motion.button
                  key={t}
                  onClick={() => setTab(i)}
                  whileHover={{ color: '#8888ff' }}
                  whileTap={{ scale: 0.97 }}
                  transition={spring.snappy}
                  style={{
                    position: 'relative',
                    background: tab === i ? '#0d0d1f' : 'transparent',
                    border: 'none',
                    color: tab === i ? '#8888ff' : '#444',
                    padding: '8px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                    fontFamily: 'monospace',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {t}
                  <MaintenancePill {...maint} />
                  {tab === i && (
                    <motion.span
                      layoutId="admin-tab-indicator"
                      style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        height: 2, background: '#8888ff',
                        borderRadius: '2px 2px 0 0',
                      }}
                      transition={spring.layout}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Tab content */}
          {tab === 0  && <ChannelsTab         token={token} onRefresh={() => load()} />}
          {tab === 1  && <AutoIngestedTab     token={token}
                          discoverRunning={discoverRunning}     discoverResult={discoverResult}     discoverErr={discoverErr}     onDiscover={triggerDiscover}
                          ingestOnlyRunning={ingestOnlyRunning} ingestOnlyResult={ingestOnlyResult} ingestOnlyErr={ingestOnlyErr} onIngestOnly={triggerIngestOnly}
                          promoteRunning={promoteRunning}       promoteResult={promoteResult}       promoteErr={promoteErr}       onPromote={triggerPromote} />}
          {tab === 2  && <IngestStatusTab     status={status} />}
          {tab === 3  && <QuotaTab            status={status} />}
          {tab === 4  && <CronHealthTab       status={status} />}
          {tab === 5  && <PatternsTab         token={token} />}
          {tab === 6  && <ControlsTab         token={token} onRefresh={() => load()} />}
          {tab === 7  && <EvolutionTab        token={token} />}
          {tab === 8  && <DiscoveryTab        token={token} />}
          {tab === 9  && <LearningTab         token={token} />}
          {tab === 10 && <SemanticIntelligenceTab  token={token} />}
          {tab === 11 && <StrategyIntelligenceTab  token={token} />}
          {tab === 12 && <CorpusTab               token={token} />}
          {tab === 13 && <CommunitiesTab          token={token} />}
        </>
      )}
    </div>
  );
}
