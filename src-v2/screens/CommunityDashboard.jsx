import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';
import { useCountUp } from '../hooks/useCountUp';

// ── Mock data (replace with API calls later) ──────────────────────────────────

const MOCK = {
  community: 'Hindi Tech',
  total_channels: 847,
  rank: 23,
  percentile: 97.3,
  metrics: [
    { label: 'Avg Views / Video', you: 284000, avg: 45200,  fmt: n => n >= 1000 ? `${(n/1000).toFixed(0)}K` : n,  winner: 'you'  },
    { label: 'Monthly Growth %',  you: 4.2,    avg: 1.8,    fmt: n => `${n}%`,                                    winner: 'you'  },
    { label: 'Videos / Week',     you: 3.1,    avg: 2.4,    fmt: n => `${n}`,                                     winner: 'you'  },
    { label: 'Engagement Rate',   you: 7.8,    avg: 3.2,    fmt: n => `${n}%`,                                    winner: 'you'  },
  ],
  topChannels: [
    { name: 'Technical Guruji', subs: 23000000, isYou: false },
    { name: 'Trakin Tech',      subs: 12000000, isYou: false },
    { name: 'Tech Burner',      subs: 8200000,  isYou: false },
    { name: 'Gaurav Chaudhary', subs: 4800000,  isYou: false },
    { name: 'Your Channel',     subs: 420000,   isYou: true  },
  ],
  nextToStudy: [
    { name: 'Technical Guruji', subs: '23M', gap: 'Uploads 2× more than you. Check cadence strategy.' },
    { name: 'Tech Burner',      subs: '8.2M', gap: 'Higher engagement despite fewer subs. Study hook style.' },
    { name: 'Gaurav Chaudhary', subs: '4.8M', gap: 'Similar sub count, growing 3× faster — check recent uploads.' },
  ],
  insights: [
    { tag: 'Hook',       color: T.accent,   text: '91% of top videos open with price reveal or spec comparison in first 8 seconds.' },
    { tag: 'Length',     color: T.success,  text: 'Sweet spot 12–18 min. Videos under 10 min get 40% fewer recommendations.' },
    { tag: 'Thumbnail',  color: T.warning,  text: 'Red/orange bg + shocked expression gets 2.3× more CTR in this niche.' },
  ],
};

const fmtSubs = n => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(0)}K` : n;

// ── Rank ring ─────────────────────────────────────────────────────────────────

function RankRing({ percentile, rank, total }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const filled = (percentile / 100) * C;

  const rankDisplay = useCountUp(rank, 800, 200);
  const pctDisplay  = useCountUp(Math.round(percentile * 10), 900, 300);

  return (
    <div style={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
      <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="70" cy="70" r={R} fill="none" stroke={T.border} strokeWidth="8" />
        <motion.circle
          cx="70" cy="70" r={R}
          fill="none"
          stroke={T.accent}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C - filled }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          style={{ filter: 'drop-shadow(0 0 8px rgba(139,92,246,0.6))' }}
        />
      </svg>

      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: '0.6rem', fontWeight: 600, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Rank</div>
        <div style={{ fontSize: '1.9rem', fontWeight: 800, color: T.text, lineHeight: 1.1 }}>#{rankDisplay}</div>
        <div style={{ fontSize: '0.63rem', color: T.muted }}>of {total.toLocaleString()}</div>
        <div style={{ fontSize: '0.67rem', fontWeight: 700, color: T.accent, marginTop: 2 }}>
          top {(100 - pctDisplay / 10).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, you, avg, fmt, winner, delay }) {
  const maxVal = Math.max(you, avg);
  const youPct = (you / maxVal) * 100;
  const avgPct = (avg / maxVal) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.32, ease }}
      whileHover={{ y: -4, boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${T.borderHover}` }}
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        padding: '20px 22px',
        flex: 1, minWidth: 0,
        transition: 'box-shadow 0.2s',
      }}
    >
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: T.muted, marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: '1.6rem', fontWeight: 800, color: T.text }}>{fmt(you)}</span>
        <span style={{ fontSize: '0.72rem', color: T.success, fontWeight: 600 }}>you</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Bar label="You" pct={youPct} color={T.accent} value={fmt(you)} />
        <Bar label="Avg" pct={avgPct} color={T.subtle}  value={fmt(avg)} />
      </div>
    </motion.div>
  );
}

function Bar({ label, pct, color, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 22, fontSize: '0.65rem', color: T.muted, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: T.border, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: 0.5 }}
          style={{ height: '100%', background: color, borderRadius: 3 }}
        />
      </div>
      <span style={{ width: 32, fontSize: '0.65rem', color: T.muted, textAlign: 'right', flexShrink: 0 }}>{value}</span>
    </div>
  );
}

// ── Channel bar (top performers) ──────────────────────────────────────────────

function ChannelBar({ name, subs, isYou, maxSubs, index }) {
  const pct = (subs / maxSubs) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 * index + 0.6, duration: 0.28, ease }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 0',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: isYou ? T.accentGlow : '#27272A',
        border: isYou ? `1px solid ${T.accentBorder}` : `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.67rem', fontWeight: 700,
        color: isYou ? T.accent : T.muted,
      }}>
        {name.charAt(0)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: isYou ? T.accent : T.text, lineHeight: 1 }}>{name}</span>
          {isYou && <span style={{ fontSize: '0.58rem', fontWeight: 700, color: T.accent, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, borderRadius: 4, padding: '1px 5px' }}>you</span>}
        </div>
        <div style={{ height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.12 * index + 0.6 }}
            style={{ height: '100%', borderRadius: 2, background: isYou ? T.accent : T.subtle }}
          />
        </div>
      </div>

      <span style={{ fontSize: '0.72rem', color: T.muted, flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
        {fmtSubs(subs)}
      </span>
    </motion.div>
  );
}

// ── Insight tile ──────────────────────────────────────────────────────────────

function InsightTile({ tag, color, text, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index + 0.8, duration: 0.28, ease }}
      whileHover={{ y: -3, boxShadow: `0 6px 24px rgba(0,0,0,0.35)` }}
      style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: '14px 16px',
        flex: 1, minWidth: 0,
        transition: 'box-shadow 0.2s',
      }}
    >
      <div style={{
        display: 'inline-block', marginBottom: 10,
        fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em',
        color, background: `${color}18`, border: `1px solid ${color}30`,
        borderRadius: 5, padding: '2px 8px',
      }}>
        {tag}
      </div>
      <p style={{ fontSize: '0.78rem', color: T.muted, lineHeight: 1.55, margin: 0 }}>{text}</p>
    </motion.div>
  );
}

// ── Study card ────────────────────────────────────────────────────────────────

function StudyCard({ name, subs, gap, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index + 0.7, duration: 0.28, ease }}
      whileHover={{ y: -3, borderColor: T.borderHover }}
      style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 12, padding: '14px 16px',
        flex: 1, minWidth: 200,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: '#27272A', border: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 700, color: T.muted,
        }}>
          {name.charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: T.text }}>{name}</div>
          <div style={{ fontSize: '0.65rem', color: T.muted }}>{subs} subs</div>
        </div>
      </div>
      <p style={{ fontSize: '0.74rem', color: T.muted, lineHeight: 1.5, margin: 0 }}>{gap}</p>
    </motion.div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        color: T.muted,
      }}
    >
      <div style={{
        width: 60, height: 60, borderRadius: 16,
        background: T.card, border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.6rem',
      }}>
        📡
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: T.text, marginBottom: 6 }}>No channel selected</div>
        <div style={{ fontSize: '0.82rem', color: T.muted }}>Press <kbd style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', fontFamily: 'inherit', fontSize: '0.75rem', color: T.subtle }}>⌘K</kbd> to search for a channel</div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommunityDashboard({ channel }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(false);
    const t = setTimeout(() => setMounted(true), 10);
    return () => clearTimeout(t);
  }, [channel?.handle]);

  if (!channel) return <EmptyState />;

  const d = MOCK;
  const maxSubs = Math.max(...d.topChannels.map(c => c.subs));

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%' }}>

      {/* ── Hero row ──────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        style={{
          display: 'flex', alignItems: 'center', gap: 28,
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 18, padding: '24px 28px', marginBottom: 24,
        }}
      >
        {/* Channel avatar placeholder */}
        <div style={{
          width: 56, height: 56, borderRadius: 14, flexShrink: 0,
          background: 'linear-gradient(135deg, #7C3AED22, #4F46E522)',
          border: `1px solid ${T.accentBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.3rem', fontWeight: 800, color: T.accent,
        }}>
          {channel.name.charAt(0)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: T.text, marginBottom: 4 }}>{channel.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: '0.7rem', fontWeight: 600, color: T.accent,
              background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
              borderRadius: 5, padding: '2px 8px',
            }}>{d.community}</span>
            <span style={{ fontSize: '0.72rem', color: T.muted }}>{channel.subs} subscribers · {d.total_channels.toLocaleString()} channels in community</span>
          </div>
        </div>

        {mounted && <RankRing percentile={d.percentile} rank={d.rank} total={d.total_channels} />}
      </motion.div>

      {/* ── Metric cards ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {d.metrics.map((m, i) => (
          <MetricCard key={m.label} {...m} delay={i * 0.06 + 0.1} />
        ))}
      </div>

      {/* ── Bottom section: top performers + insights ─────────────────────── */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Top performers */}
        <div style={{
          flex: '0 0 280px', background: T.card, border: `1px solid ${T.border}`,
          borderRadius: 14, padding: '18px 20px',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            Community Rankings
          </div>
          {d.topChannels.map((ch, i) => (
            <ChannelBar key={ch.name} {...ch} maxSubs={maxSubs} index={i} />
          ))}
        </div>

        {/* What's working */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            What's Working in Your Community
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {d.insights.map((ins, i) => (
              <InsightTile key={ins.tag} {...ins} index={i} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Channels to study ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
          Next Channels to Study
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {d.nextToStudy.map((ch, i) => (
            <StudyCard key={ch.name} {...ch} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
