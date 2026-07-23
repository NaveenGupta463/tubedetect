import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, ease } from '../tokens';
import LoadingShowcase from '../components/LoadingShowcase';

const API = 'http://localhost:3002';

const NICHES = [
  'all','politics','news','entertainment','education','technology','finance',
  'business','sports','music','lifestyle','gaming','health','fitness',
  'food','travel','comedy','science','philosophy','general',
];

const TIER_CONF = {
  rising:   { label: 'RISING',   color: T.success,  bg: 'rgba(18,217,138,0.1)',  border: 'rgba(18,217,138,0.3)'  },
  emerging: { label: 'EMERGING', color: '#f59e0b',   bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)'  },
  stable:   { label: 'STABLE',   color: T.muted,     bg: 'rgba(255,255,255,0.04)', border: T.border              },
  peaking:  { label: 'PEAKING',  color: '#f87171',   bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)'},
  noise:    { label: 'NOISE',    color: T.subtle,    bg: 'rgba(255,255,255,0.02)', border: T.border               },
};

function fmtViews(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function signalCount(bd) {
  if (!bd) return 0;
  let n = 0;
  if ((bd.outperformance?.pts || 0) > 0)          n++;
  if ((bd.adoption?.pts       || 0) > 0)          n++;
  if (bd.trajectory?.direction === 'rising')      n++;
  if ((bd.foreign?.pts        || 0) > 0)          n++;
  return n;
}

function ConfidenceBadge({ bd }) {
  const n = signalCount(bd);
  const conf = n >= 3 ? { label: 'STRONG SIGNAL', color: T.success,  bg: 'rgba(18,217,138,0.12)'  }
             : n === 2 ? { label: 'EARLY SIGNAL',  color: '#f59e0b',   bg: 'rgba(245,158,11,0.12)'  }
             :           { label: 'WEAK SIGNAL',   color: T.subtle,    bg: 'rgba(255,255,255,0.06)' };
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.06em',
      padding: '2px 7px', borderRadius: 4,
      color: conf.color, background: conf.bg,
    }}>
      {conf.label} · {n} signal{n !== 1 ? 's' : ''}
    </span>
  );
}

function EvidenceRow({ icon, label, value, sub, valueColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <span style={{ fontSize: '0.8rem', width: 18, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.7rem', color: T.muted, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: valueColor || T.text }}>{value}</div>
        {sub && <div style={{ fontSize: '0.68rem', color: T.subtle, marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function VideoList({ topic, niche, samples }) {
  // Video-grounded signals carry their example videos inline (they're guaranteed to match the
  // topic, since the topic is a phrase from the title). Use them directly; only fall back to a
  // fetch if none were provided.
  const [videos, setVideos] = useState(Array.isArray(samples) ? samples : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (videos !== null) return;
    setLoading(true);
    const p = new URLSearchParams({ topic });
    if (niche) p.set('niche', niche);
    fetch(`${API}/api/intel/signals/videos?${p}`)
      .then(r => r.json())
      .then(d => { setVideos(d.videos || []); setLoading(false); })
      .catch(() => { setVideos([]); setLoading(false); });
  }, []);

  if (loading) return <div style={{ fontSize: '0.72rem', color: T.muted, padding: '8px 0' }}>Loading videos…</div>;
  if (!videos?.length) return <div style={{ fontSize: '0.72rem', color: T.muted, padding: '8px 0' }}>No recent videos found.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      {videos.map((v, i) => (
        <div key={i} style={{
          padding: '7px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: '0.78rem', color: T.text, marginBottom: 3, lineHeight: 1.35 }}>{v.title}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <span style={{ fontSize: '0.68rem', color: T.accent, fontWeight: 600 }}>{fmtViews(v.views)} views</span>
            <span style={{ fontSize: '0.68rem', color: T.muted }}>{v.channel_name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// "Act on it" — sends the topic (with why-it's-trending context) to Copilot, which auto-generates
// angle ideas tailored to the creator's channel (niche/format/voice), reusing the existing
// `copilot:open` prompt path so personalization happens through the same DNA-aware chat pipeline.
// Without a loaded channel there's no DNA to personalize against, so it prompts the user to load one
// instead of opening a generic chat.
function ActOnItButton({ prompt, channel, style }) {
  const [hint, setHint] = useState(false);
  const handleClick = (e) => {
    e.stopPropagation();
    if (!channel?.channel_id) {
      setHint(true);
      setTimeout(() => setHint(false), 2600);
      return;
    }
    window.dispatchEvent(new CustomEvent('copilot:open', { detail: { prompt } }));
  };
  return (
    <div style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, ...style }}>
      <button
        onClick={handleClick}
        style={{
          padding: '4px 11px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
          background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
          color: T.accent, fontSize: '0.7rem', fontWeight: 600,
        }}
      >
        ⚡ Act on it
      </button>
      {hint && (
        <div style={{
          position: 'absolute', bottom: '120%', right: 0, whiteSpace: 'nowrap', zIndex: 5,
          padding: '5px 10px', borderRadius: 7, fontSize: '0.68rem', fontWeight: 500,
          background: '#1c1c22', border: `1px solid ${T.border}`, color: T.muted,
        }}>
          Open a channel first to get personalized ideas
        </div>
      )}
    </div>
  );
}

function SignalCard({ signal, index, activeNiche, channel }) {
  const [open, setOpen]         = useState(false);
  const [showVideos, setShowVideos] = useState(false);

  const tier = TIER_CONF[signal.signal_tier] || TIER_CONF.noise;
  const bd   = signal.score_breakdown;
  const dir  = signal.vph_direction || 'stable';
  const dirIcon  = dir === 'rising' ? '↑' : dir === 'falling' ? '↓' : '→';
  const actPrompt = `"${signal.topic}" is trending in ${signal.niche}` +
    (signal.channel_count_30d ? ` — ${signal.channel_count_30d} channels are posting about it this month` : '') +
    (dir === 'rising' ? ' and it\'s still accelerating' : '') + `.` +
    ` Give me 3 different video angle ideas for how I could cover this on my channel, tailored to my niche and the type of content I usually make.`;
  const dirColor = dir === 'rising' ? T.success : dir === 'falling' ? '#f87171' : T.muted;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02, duration: 0.22, ease }}
      style={{
        borderRadius: 14, overflow: 'hidden',
        border: `1px solid ${open ? tier.border : T.border}`,
        background: open ? tier.bg : 'rgba(255,255,255,0.03)',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* ── Collapsed row ── */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '13px 16px', cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        {/* tier dot + label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: tier.color, display: 'inline-block', flexShrink: 0 }} />
          <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: tier.color, width: 60 }}>
            {tier.label}
          </span>
        </div>

        {/* topic name */}
        <span style={{ fontSize: '0.88rem', color: T.text, fontWeight: 500, textTransform: 'capitalize', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {signal.topic}
        </span>
        {/* region chip — flags trends that are NOT primarily India (e.g. MENA "arabic drama series") */}
        {signal.region && signal.region !== 'IN' && (
          <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>
            🌍 {signal.region}
          </span>
        )}
        <span style={{ flex: 1 }} />

        {/* stats strip */}
        <div style={{ display: 'flex', gap: 14, flexShrink: 0, alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: T.muted }}>
            {signal.channel_count_30d} ch
          </span>
          {signal.avg_outperformance_ratio > 0 && (
            <span style={{ fontSize: '0.72rem', color: T.accent, fontWeight: 600 }}>
              {signal.avg_outperformance_ratio.toFixed(1)}×
            </span>
          )}
          <span style={{ fontSize: '0.8rem', color: dirColor, fontWeight: 700 }}>{dirIcon}</span>
          <span style={{ fontSize: '0.72rem', color: T.subtle, width: 28, textAlign: 'right' }}>
            {signal.signal_score}
          </span>
        </div>

        <ActOnItButton prompt={actPrompt} channel={channel} />

        <span style={{
          color: T.subtle, fontSize: '0.75rem', flexShrink: 0,
          transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s',
        }}>▾</span>
      </div>

      {/* ── Expanded evidence panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '14px 16px 16px',
              borderTop: `1px solid rgba(255,255,255,0.07)`,
            }}>

              {/* confidence + niche */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <ConfidenceBadge bd={bd} />
                <span style={{ fontSize: '0.68rem', color: T.muted, background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4 }}>
                  {signal.niche}
                </span>
              </div>

              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.08em', marginBottom: 10 }}>
                WHY WE'RE SAYING THIS
              </div>

              {/* Signal 1 — View performance */}
              {bd?.outperformance && (
                <EvidenceRow
                  icon="👁"
                  label="View performance"
                  value={`${signal.channel_count_30d} channels posting · ${bd.outperformance.ratio}× their normal views`}
                  sub={bd.outperformance.pct_beating > 0
                    ? `${bd.outperformance.pct_beating}% of videos beat their channel baseline`
                    : null}
                  valueColor={bd.outperformance.pts > 0 ? T.success : T.text}
                />
              )}

              {/* Signal 3 — Trend direction */}
              {bd?.trajectory && (
                <EvidenceRow
                  icon="📈"
                  label="Trend direction"
                  value={
                    dir === 'rising'  ? 'Views accelerating — still climbing'  :
                    dir === 'falling' ? 'Views declining — may have peaked'    :
                    'View pace is holding steady'
                  }
                  sub={bd.trajectory.vpd_now > 0 && bd.trajectory.vpd_prior > 0
                    ? `${fmtViews(bd.trajectory.vpd_prior)} → ${fmtViews(bd.trajectory.vpd_now)} avg views/day`
                    : null}
                  valueColor={dir === 'rising' ? T.success : dir === 'falling' ? '#f87171' : T.muted}
                />
              )}

              {/* Signal 2 — Adoption */}
              {bd?.adoption && (
                <EvidenceRow
                  icon="📡"
                  label="Creator adoption"
                  value={`${bd.adoption.channels_now} channels posted this month`}
                  sub={bd.adoption.channels_prior > 0
                    ? `vs ${bd.adoption.channels_prior} last month (${bd.adoption.acceleration > 0 ? '+' : ''}${Math.round(bd.adoption.acceleration * 100)}% change)`
                    : 'First month of tracking'}
                  valueColor={bd.adoption.pts > 0 ? T.accent : T.muted}
                />
              )}

              {/* Signal 4 — Foreign signal */}
              {signal.foreign_channel_count_30d > 0 && (
                <EvidenceRow
                  icon="🌍"
                  label="Foreign signal"
                  value={
                    signal.foreign_lead_days > 0
                      ? `US/UK creators picked this up ${signal.foreign_lead_days} days before Indian creators`
                      : `${signal.foreign_channel_count_30d} US/UK/AU channels posting on this topic`
                  }
                  sub={signal.foreign_lead_days == null ? 'Lead days tracking starts ~July 2026' : null}
                  valueColor={T.accent}
                />
              )}

              {/* Example videos toggle */}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={e => { e.stopPropagation(); setShowVideos(v => !v); }}
                  style={{
                    padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`,
                    color: T.muted, fontSize: '0.72rem', fontWeight: 500,
                  }}
                >
                  {showVideos ? 'Hide videos' : 'See example videos →'}
                </button>
              </div>

              {showVideos && (
                <VideoList topic={signal.topic} niche={signal.niche} samples={signal.samples} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Breaking Right Now — same-day dominant stories, independent of the tier tabs below ──────────
// video_trend_signals (the tabs below) needs weeks of accumulated corpus coverage before a topic
// registers — the wrong tool for "this broke this morning". This pulls the live current-events
// feed instead (multi-outlet corroboration, ≤12-day window), which already exists for news
// creators and is now shown to every creator — in-beat stories framed as "your beat", everything
// else framed as a clearly-labelled cross-over so it never reads as a core recommendation.
function buildBreakingEventPrompt(ev, inBeat) {
  const sample = ev.sample_titles?.[0]?.title;
  return `"${ev.topic}" is dominating the news right now — ${ev.channel_count} channels are covering it` +
    (sample ? ` (e.g. "${sample}")` : '') + `.` +
    (inBeat
      ? ` Give me 3 different video angle ideas for how I could cover this on my channel, tailored to my niche and content style.`
      : ` It's outside my usual niche, but give me 2-3 honest ideas for whether and how I could angle this into something that fits my channel — or tell me if it genuinely doesn't fit.`);
}

function BreakingRightNowSection({ data, loading, channel }) {
  const events = data?.events || [];
  if (!loading && !events.length) return null;
  const inBeat = data?.in_beat !== false;
  const accent = inBeat ? '#ef4444' : '#38bdf8';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease }}
      style={{
        marginBottom: 18, borderRadius: 12, padding: '14px 16px',
        background: `${accent}0d`, border: `1px solid ${accent}38`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.95rem' }}>{inBeat ? '📰' : '🔥'}</span>
        <h3 style={{ margin: 0, fontSize: '0.88rem', fontWeight: 800, color: T.text }}>
          {inBeat ? 'Breaking On Your Beat' : 'Dominating The News Today'}
        </h3>
        {loading && (
          <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} style={{ fontSize: '0.62rem', color: T.muted }}>
            loading…
          </motion.span>
        )}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: '0.7rem', color: T.muted, lineHeight: 1.4 }}>
        {inBeat
          ? "What's actually breaking right now, not what's been slowly building for weeks — video_trend_signals below needs time to accumulate, this doesn't."
          : "Outside your niche, but this is what's dominating every platform right now — worth knowing even if you don't cover it."}
      </p>
      {events.slice(0, 5).map(ev => (
        <div key={ev.topic} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 10px', borderRadius: 8, marginBottom: 5,
          background: 'rgba(255,255,255,0.03)',
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: T.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.topic}
          </span>
          <span style={{ fontSize: '0.62rem', color: accent, fontWeight: 700, flexShrink: 0 }}>
            {ev.channel_count} channels
          </span>
          <ActOnItButton prompt={buildBreakingEventPrompt(ev, inBeat)} channel={channel} />
        </div>
      ))}
    </motion.div>
  );
}

export default function TrendDetection({ channel }) {
  const [signals,   setSignals]   = useState([]);
  const [coming,    setComing]    = useState([]);
  const [forYou,    setForYou]    = useState({ direct: [], crossover: [], headstart: [] });
  const [tierCounts, setTierCounts] = useState({});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [stale,     setStale]     = useState(false);
  const [niche,     setNiche]     = useState('all');
  const [activeTier, setActiveTier] = useState('rising');
  const [sort,      setSort]      = useState('score');
  const [breaking,        setBreaking]        = useState(null);
  const [loadingBreaking, setLoadingBreaking]  = useState(false);

  // Independent of the tier tabs — same-day breaking stories, not month-over-month corpus growth.
  useEffect(() => {
    if (!channel?.channel_id) { setBreaking(null); return; }
    setLoadingBreaking(true);
    fetch(`${API}/api/intel/current-events?channel_id=${encodeURIComponent(channel.channel_id)}`)
      .then(r => r.json())
      .then(d => { setBreaking(d.ok ? d : null); setLoadingBreaking(false); })
      .catch(() => setLoadingBreaking(false));
  }, [channel?.channel_id]);

  useEffect(() => {
    if (channel?.niche && niche === 'all') {
      let n = channel.niche.toLowerCase().replace(/\s+/g, '');
      // 'business' maps to 'finance' — business topics score as stable but finance has signal
      if (n === 'business') n = 'finance';
      if (NICHES.includes(n)) setNiche(n);
    }
  }, [channel]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSignals([]);
    setComing([]);
    setForYou({ direct: [], crossover: [], headstart: [] });
    // "For You" — personalized: DIRECT trends in the channel's niche + CROSS-OVER trends angled in.
    if (activeTier === 'foryou') {
      if (!channel?.channel_id) { setError('Open a channel to see personalized trends'); setLoading(false); return; }
      fetch(`${API}/api/intel/trends/for-you?channel_id=${encodeURIComponent(channel.channel_id)}`)
        .then(r => r.json())
        .then(d => { setForYou({ direct: d.direct || [], crossover: d.crossover || [], headstart: d.headstart || [] }); setLoading(false); })
        .catch(e => { setError(e.message); setLoading(false); });
      return;
    }
    // "Coming to India" is a separate precomputed feed (foreign-led topics not yet domestic).
    if (activeTier === 'coming') {
      const p = new URLSearchParams({ limit: '40' });
      if (niche !== 'all') p.set('niche', niche);
      fetch(`${API}/api/intel/trends/coming-to-india?${p}`)
        .then(r => r.json())
        .then(d => { setComing(d.topics || []); setStale(d.data_stale || false); setLoading(false); })
        .catch(e => { setError(e.message); setLoading(false); });
      return;
    }
    const p = new URLSearchParams({ tier: activeTier, sort, limit: '80' });
    if (niche !== 'all') p.set('niche', niche);
    // Video-grounded trends (specific title-phrases; examples always match). Replaces the old
    // channel-topic /signals feed whose example videos didn't match the topic.
    fetch(`${API}/api/intel/trends/video-signals?${p}`)
      .then(r => r.json())
      .then(d => {
        setTierCounts(d.tier_counts || {});
        setStale(d.data_stale || false);
        setSignals(d.signals || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [niche, activeTier, sort, channel?.channel_id]);

  useEffect(() => { load(); }, [load]);

  const TIERS = [
    { id: 'foryou',   label: '🎯 For You' },
    { id: 'rising',   label: 'Rising' },
    { id: 'emerging', label: 'Emerging' },
    { id: 'stable',   label: 'Stable' },
    { id: 'all',      label: 'All' },
    { id: 'coming',   label: '🌍 Coming to India' },
  ];

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 16px 60px' }}>

      {/* header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: T.text, margin: 0 }}>
            Trend Detection
          </h2>
          {stale && (
            <span style={{ fontSize: '0.65rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: 4 }}>
              data stale — run pipeline to refresh
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.78rem', color: T.muted, marginTop: 4, marginBottom: 0 }}>
          Topics gaining momentum in your community — scored from view outperformance, creator adoption, and VPH trajectory.
        </p>
      </div>

      <BreakingRightNowSection data={breaking} loading={loadingBreaking} channel={channel} />

      {/* tier tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 4, border: `1px solid ${T.border}` }}>
        {TIERS.map(t => {
          const count = t.id === 'all'
            ? Object.values(tierCounts).reduce((a, b) => a + b, 0)
            : (tierCounts[t.id] || 0);
          const tc = TIER_CONF[t.id] || {};
          return (
            <button
              key={t.id}
              onClick={() => setActiveTier(t.id)}
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: '0.75rem',
                cursor: 'pointer', border: 'none', transition: 'all 0.15s',
                background: activeTier === t.id ? 'rgba(157,111,255,0.18)' : 'transparent',
                color: activeTier === t.id ? (tc.color || T.accent) : T.muted,
                fontWeight: activeTier === t.id ? 700 : 400,
              }}
            >
              {t.label} {count > 0 && <span style={{ opacity: 0.6, fontSize: '0.68rem' }}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* niche + sort row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {NICHES.map(n => (
          <button
            key={n}
            onClick={() => setNiche(n)}
            style={{
              padding: '4px 11px', borderRadius: 20, fontSize: '0.7rem', cursor: 'pointer',
              border: niche === n ? `1px solid ${T.accent}` : `1px solid rgba(255,255,255,0.1)`,
              background: niche === n ? T.accentGlow : 'rgba(255,255,255,0.03)',
              color: niche === n ? T.accent : T.muted,
              fontWeight: niche === n ? 600 : 400,
              textTransform: 'capitalize', transition: 'all 0.15s',
            }}
          >
            {n === 'all' ? 'All niches' : n}
          </button>
        ))}

        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: 8, fontSize: '0.72rem',
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`,
            color: T.muted, cursor: 'pointer',
          }}
        >
          <option value="score">Sort: Score</option>
          <option value="channels">Sort: Channels</option>
          <option value="ratio">Sort: Ratio</option>
        </select>
      </div>

      {/* content */}
      {loading && (
        <LoadingShowcase exclude={['trends']} />
      )}

      {error && (
        <div style={{ textAlign: 'center', color: '#f87171', padding: 40, fontSize: '0.85rem' }}>
          Could not load signals — make sure the server is running.
        </div>
      )}

      {!loading && !error && !['coming', 'foryou'].includes(activeTier) && signals.length === 0 && (
        <div style={{ textAlign: 'center', color: T.muted, padding: 60, fontSize: '0.85rem' }}>
          {activeTier === 'rising'
            ? 'No rising topics found for this filter. Try "All niches" or run the pipeline to refresh signal data.'
            : 'No topics found for this filter.'}
        </div>
      )}

      {/* For You — personalized: direct (in-niche) + cross-over (angled) trend ideas */}
      {!loading && !error && activeTier === 'foryou' && (() => {
        // Head-start FIRST (highest upside: hot on TikTok/Instagram, not on YouTube yet), then in-niche, then cross-over.
        const both = [
          ...forYou.headstart.map(x => ({ ...x, mode: 'headstart' })),
          ...forYou.direct.map(x => ({ ...x, mode: 'direct' })),
          ...forYou.crossover.map(x => ({ ...x, mode: 'crossover' })),
        ];
        if (both.length === 0) return (
          <div style={{ textAlign: 'center', color: T.muted, padding: 60, fontSize: '0.85rem' }}>
            No personalized trend ideas yet — run the pipeline to refresh, or the channel may have no matching live trends.
          </div>
        );
        const srcLabel = it => it.status === 'coming_from_tiktok' ? 'US/UK TikTok' : it.status === 'coming_from_tiktok_and_ig' ? 'TikTok + Instagram' : 'Instagram';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: '0.68rem', color: T.subtle, marginBottom: 4 }}>
              Trending right now that YOU should make — {forYou.headstart.length ? `${forYou.headstart.length} early (before YouTube), ` : ''}{forYou.direct.length} in your niche, {forYou.crossover.length} cross-over angles.
            </div>
            {both.map((it, i) => {
              const isHead = it.mode === 'headstart';
              const accent = isHead ? '#34d399' : it.mode === 'crossover' ? '#38bdf8' : T.accent;
              const border = isHead ? 'rgba(52,211,153,0.3)' : it.mode === 'crossover' ? 'rgba(56,189,248,0.25)' : 'rgba(157,111,255,0.25)';
              const actPrompt = `I want to build on this idea: "${it.title}" (riding the "${it.trend}" trend` +
                (isHead ? `, which is trending on ${srcLabel(it)} but not yet on YouTube — a first-mover play` :
                 it.mode === 'crossover' && it.trend_niche ? `, a cross-over from ${it.trend_niche}` : '') + `).` +
                (it.why ? ` ${it.why}` : '') +
                ` Give me a few different ways I could angle or open this video, tailored to my channel.`;
              return (
                <div key={i} style={{ ...T.glassCard, borderRadius: 12, padding: '12px 14px', border: `1px solid ${border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: accent }}>
                      {isHead ? '🚀 EARLY · BEFORE YOUTUBE' : it.mode === 'crossover' ? '🔀 CROSS-OVER' : '🎯 IN YOUR NICHE'}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: T.subtle }}>
                      {isHead ? `trending on ${srcLabel(it)} · ${it.trend}` : `riding: ${it.trend}${it.mode === 'crossover' && it.trend_niche ? ` · trending in ${it.trend_niche}` : ''}`}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: T.text, lineHeight: 1.35 }}>{it.title}</div>
                  {it.why && <div style={{ fontSize: '0.7rem', color: T.muted, marginTop: 4, lineHeight: 1.4 }}>{it.why}</div>}
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <ActOnItButton prompt={actPrompt} channel={channel} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {!loading && !error && signals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: '0.68rem', color: T.subtle, marginBottom: 4 }}>
            {signals.length} topics · click any row to see why
          </div>
          {signals.map((s, i) => (
            <SignalCard key={`${s.topic}-${s.niche}`} signal={s} index={i} activeNiche={niche} channel={channel} />
          ))}
        </div>
      )}

      {/* Coming to India — foreign-led topics not yet domestic */}
      {!loading && !error && activeTier === 'coming' && (
        coming.length === 0 ? (
          <div style={{ textAlign: 'center', color: T.muted, padding: 60, fontSize: '0.85rem' }}>
            No foreign-led topics for this filter yet — run the pipeline to refresh, or try “All niches”.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: '0.68rem', color: T.subtle, marginBottom: 4 }}>
              {coming.length} topics surging in US/UK with little coverage in India yet — a head start.
            </div>
            {coming.map((c, i) => {
              const actPrompt = `"${c.topic}" is trending abroad (US/UK) but has barely reached India yet — ` +
                `${c.foreign_ch} foreign channels vs only ${c.domestic_ch} Indian channels covering it` +
                (c.lead_days > 0 ? `, a ~${c.lead_days} day head start for early movers` : '') + `.` +
                ` Give me 3 different video angle ideas for how I could be among the first to cover this on my channel, tailored to my niche and content style.`;
              return (
                <div key={c.topic} style={{
                  ...T.glassCard, borderRadius: 12, padding: '12px 14px',
                  border: '1px solid rgba(56,189,248,0.22)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: T.text, textTransform: 'capitalize' }}>{c.topic}</span>
                    <span style={{ fontSize: '0.62rem', color: '#38bdf8', fontWeight: 700, textTransform: 'capitalize', flexShrink: 0 }}>{c.niche}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: T.muted, marginBottom: c.sample_title ? 6 : 0 }}>
                    <b style={{ color: T.text }}>{c.foreign_ch}</b> US/UK channels
                    {' · '}only <b style={{ color: T.text }}>{c.domestic_ch}</b> in India
                    {c.lead_days > 0 ? ` · ${c.lead_days}d head start` : ''}
                  </div>
                  {c.sample_title && (
                    <div style={{ fontSize: '0.7rem', color: T.subtle, fontStyle: 'italic' }}>e.g. “{c.sample_title}”</div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <ActOnItButton prompt={actPrompt} channel={channel} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
