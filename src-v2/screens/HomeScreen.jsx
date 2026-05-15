import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';
import { useCountUp } from '../hooks/useCountUp';

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE_DURATION = 4200;

const STATS = [
  { end: 100,  suffix: 'K+', label: 'Videos Tracked'  },
  { end: 150,  suffix: 'K+', label: 'Video Snapshots'  },
  { end: 587,  suffix: '',   label: 'Communities'      },
  { end: 23,   suffix: 'M+', label: 'Data Points'      },
];

const PHASES = [
  {
    id:    'mining',
    step:  '01',
    title: 'We never stop watching',
    body:  '100,000+ videos tracked. Every upload, every view spike, every engagement pattern — captured continuously across 15,000 channels.',
    color: T.accent,
  },
  {
    id:    'community',
    step:  '02',
    title: 'Your community, found automatically',
    body:  '587 peer communities built by behaviour, not category tags. Channels that share your audience, upload style, and growth trajectory.',
    color: T.success,
  },
  {
    id:    'patterns',
    step:  '03',
    title: 'Patterns that print views',
    body:  'Not generic advice. What hook style, video length, and thumbnail formula is working in your niche — right now, this month.',
    color: T.warning,
  },
  {
    id:    'edge',
    step:  '04',
    title: 'Your unfair advantage',
    body:  'See your community rank, who to study, and exactly what to post next — all pulled from live data across your 847-channel peer group.',
    color: '#A78BFA',
  },
];

// ── Phase mockups ─────────────────────────────────────────────────────────────

const VIDEOS = [
  { title: 'iPhone 16 Pro — 3 Months Later',    views: '2.4M', w: 88 },
  { title: 'Cheap vs Expensive Earphones',       views: '847K', w: 62 },
  { title: 'Best Budget Phones Under ₹15K',      views: '1.2M', w: 74 },
  { title: 'OnePlus vs Samsung Camera Test',      views: '443K', w: 41 },
  { title: 'Galaxy S25 Ultra Unboxing',          views: '3.1M', w: 96 },
];

function MiningMockup() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        Live ingestion feed
      </div>
      {VIDEOS.map((v, i) => (
        <motion.div
          key={v.title}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1, duration: 0.3, ease }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: T.surface, borderRadius: 8, padding: '8px 12px',
            border: `1px solid ${T.border}`,
          }}
        >
          <div style={{
            width: 36, height: 22, borderRadius: 4, flexShrink: 0,
            background: `hsl(${i * 40 + 200}, 30%, 18%)`,
            border: `1px solid ${T.border}`,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: T.text, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {v.title}
            </div>
            <div style={{ height: 3, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${v.w}%` }}
                transition={{ delay: i * 0.1 + 0.25, duration: 0.7, ease: [0.16,1,0.3,1] }}
                style={{ height: '100%', background: T.accent, borderRadius: 2 }}
              />
            </div>
          </div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, flexShrink: 0 }}>{v.views}</div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: i * 0.1 + 0.5, ...spring.snappy }}
            style={{ width: 6, height: 6, borderRadius: '50%', background: T.success, flexShrink: 0 }}
          />
        </motion.div>
      ))}
    </div>
  );
}

const CLUSTERS = [
  { label: 'Hindi Tech',     count: 124, x: 22,  y: 22,  r: 56, color: T.accent  },
  { label: 'Finance',        count: 89,  x: 70,  y: 18,  r: 46, color: T.success },
  { label: 'Hindi Fitness',  count: 67,  x: 18,  y: 68,  r: 40, color: T.warning },
  { label: 'Gaming',         count: 156, x: 72,  y: 66,  r: 62, color: '#A78BFA' },
  { label: 'Food',           count: 43,  x: 48,  y: 48,  r: 32, color: '#EC4899' },
];

function CommunityMockup() {
  return (
    <div style={{ position: 'relative', height: 220 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        587 peer communities
      </div>
      <div style={{ position: 'relative', height: 190 }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {[
            [22, 22, 70, 18], [22, 22, 48, 48], [70, 18, 48, 48],
            [18, 68, 48, 48], [72, 66, 48, 48],
          ].map(([x1, y1, x2, y2], i) => (
            <motion.line
              key={i}
              x1={`${x1}%`} y1={`${y1}%`}
              x2={`${x2}%`} y2={`${y2}%`}
              stroke={T.border} strokeWidth="1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 + i * 0.1, duration: 0.4 }}
            />
          ))}
        </svg>

        {CLUSTERS.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.13, ...spring.smooth }}
            style={{
              position: 'absolute',
              left: `${c.x}%`, top: `${c.y}%`,
              transform: 'translate(-50%, -50%)',
              width: c.r, height: c.r, borderRadius: '50%',
              background: `${c.color}12`,
              border: `1.5px solid ${c.color}35`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: c.r > 50 ? '0.78rem' : '0.65rem', fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.count}</div>
            <div style={{ fontSize: '0.46rem', color: T.muted, lineHeight: 1.2, maxWidth: c.r - 12, marginTop: 2 }}>{c.label}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const PATTERNS = [
  { tag: 'Hook',      color: T.accent,  text: 'Price reveal or spec comparison in first 8 sec',  pct: 91 },
  { tag: 'Length',    color: T.success, text: 'Sweet spot 12–18 min — under 10 min gets 40% less reach', pct: 78 },
  { tag: 'Thumbnail', color: T.warning, text: 'Red / orange bg + shocked expression → 2.3× CTR', pct: 85 },
  { tag: 'Upload',    color: '#A78BFA', text: 'Tuesday 7 pm IST dominates top 10 in this niche', pct: 67 },
];

function PatternsMockup() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
        Niche signals — Hindi Tech · this month
      </div>
      {PATTERNS.map((p, i) => (
        <motion.div
          key={p.tag}
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.11, duration: 0.3, ease }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: T.surface, borderRadius: 8, padding: '9px 12px',
            border: `1px solid ${T.border}`,
          }}
        >
          <div style={{
            fontSize: '0.57rem', fontWeight: 700, color: p.color,
            background: `${p.color}14`, border: `1px solid ${p.color}28`,
            borderRadius: 4, padding: '2px 7px', flexShrink: 0,
          }}>
            {p.tag}
          </div>
          <div style={{ flex: 1, fontSize: '0.67rem', color: T.muted, lineHeight: 1.35 }}>{p.text}</div>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: p.color, flexShrink: 0 }}>{p.pct}%</div>
        </motion.div>
      ))}
    </div>
  );
}

const EDGE_SUGGESTIONS = [
  { text: 'Budget phone under ₹15K — not covered by top creators in 60 days', score: 94 },
  { text: 'Gaming phone vs normal phone camera showdown', score: 87 },
];

function EdgeMockup() {
  const R = 30;
  const C = 2 * Math.PI * R;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Rank strip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          background: T.surface, borderRadius: 12, padding: '14px 18px',
          border: `1px solid ${T.border}`,
        }}
      >
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
          <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="36" cy="36" r={R} fill="none" stroke={T.border} strokeWidth="6" />
            <motion.circle
              cx="36" cy="36" r={R} fill="none"
              stroke={T.accent} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * 0.03 }}
              transition={{ duration: 1.1, ease: [0.16,1,0.3,1], delay: 0.3 }}
              style={{ filter: 'drop-shadow(0 0 6px rgba(139,92,246,0.55))' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: '0.5rem', color: T.muted, lineHeight: 1 }}>Rank</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: T.text, lineHeight: 1.1 }}>#23</div>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.62rem', color: T.muted, marginBottom: 4 }}>Hindi Tech Community</div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: T.accent }}>Top 3%</div>
          <div style={{ fontSize: '0.6rem', color: T.muted }}>of 847 channels</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.58rem', color: T.muted }}>vs community avg</div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: T.success, marginTop: 2 }}>+284% views</div>
        </div>
      </motion.div>

      {/* What to post */}
      <div>
        <div style={{ fontSize: '0.58rem', fontWeight: 700, color: T.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
          What to post next
        </div>
        {EDGE_SUGGESTIONS.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.15, duration: 0.3, ease }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: T.surface, borderRadius: 8, padding: '9px 12px',
              border: `1px solid ${T.border}`,
              marginBottom: i === 0 ? 7 : 0,
            }}
          >
            <div style={{ flex: 1, fontSize: '0.67rem', color: T.text, lineHeight: 1.4 }}>{s.text}</div>
            <div style={{
              fontSize: '0.72rem', fontWeight: 800, color: T.success,
              background: T.successDim, borderRadius: 5, padding: '2px 7px',
              flexShrink: 0,
            }}>{s.score}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const MOCKUPS = {
  mining:    MiningMockup,
  community: CommunityMockup,
  patterns:  PatternsMockup,
  edge:      EdgeMockup,
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ end, suffix, label, delay }) {
  const val = useCountUp(end, 1400, delay);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000 + 0.2, duration: 0.35, ease }}
      style={{
        flex: 1, background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: '18px 20px', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '1.8rem', fontWeight: 900, color: T.text, lineHeight: 1, letterSpacing: '-0.03em' }}>
        {val}{suffix}
      </div>
      <div style={{ fontSize: '0.7rem', color: T.muted, marginTop: 5, fontWeight: 500 }}>{label}</div>
    </motion.div>
  );
}

// ── Live pulse indicator ──────────────────────────────────────────────────────

function LivePulse() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 20 }}>
      <motion.div
        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ width: 7, height: 7, borderRadius: '50%', background: T.success }}
      />
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: T.success }}>Live · indexing now</span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function HomeScreen({ onSearch }) {
  const [phase, setPhase]     = useState(0);
  const [ticking, setTicking] = useState(true);

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setPhase(p => (p + 1) % PHASES.length), PHASE_DURATION);
    return () => clearInterval(id);
  }, [ticking]);

  const current = PHASES[phase];
  const Mockup  = MOCKUPS[current.id];

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px 60px' }}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <LivePulse />

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
          style={{
            fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)',
            fontWeight: 900, color: T.text,
            lineHeight: 1.15, letterSpacing: '-0.03em',
            marginBottom: 14, maxWidth: 600,
          }}
        >
          Your YouTube community<br />
          is already ranked.{' '}
          <span style={{ color: T.muted, fontWeight: 700 }}>You just don't know it.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease }}
          style={{ fontSize: '0.92rem', color: T.muted, lineHeight: 1.65, maxWidth: 520, marginBottom: 36 }}
        >
          We analyse 100K+ videos across 587 peer communities to tell you
          exactly where you stand — and what to do next.
        </motion.p>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
          {STATS.map((s, i) => (
            <StatCard key={s.label} {...s} delay={i * 140} />
          ))}
        </div>

        {/* ── Story card ────────────────────────────────────────────────── */}
        <div
          style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 20, overflow: 'hidden', marginBottom: 32,
          }}
          onMouseEnter={() => setTicking(false)}
          onMouseLeave={() => setTicking(true)}
        >
          {/* Progress bar */}
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: PHASE_DURATION / 1000, ease: 'linear' }}
              style={{ height: 2, background: current.color, transformOrigin: 'left' }}
            />
          </AnimatePresence>

          <div style={{ display: 'flex', gap: 0, minHeight: 340 }}>

            {/* Left — text panel */}
            <div style={{
              width: 280, flexShrink: 0, padding: '28px 28px 28px 28px',
              borderRight: `1px solid ${T.border}`,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}>
              {/* Phase dots */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                {PHASES.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => { setPhase(i); setTicking(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    }}
                  >
                    <motion.div
                      animate={{
                        width: phase === i ? 18 : 6,
                        background: phase === i ? PHASES[i].color : T.subtle,
                      }}
                      transition={spring.snappy}
                      style={{ height: 6, borderRadius: 3 }}
                    />
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.28, ease }}
                  style={{ flex: 1 }}
                >
                  <div style={{
                    fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
                    color: current.color, textTransform: 'uppercase', marginBottom: 12,
                  }}>
                    Step {current.step}
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: T.text, lineHeight: 1.3, marginBottom: 12 }}>
                    {current.title}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: T.muted, lineHeight: 1.65 }}>
                    {current.body}
                  </div>
                </motion.div>
              </AnimatePresence>

              <div style={{ marginTop: 24, fontSize: '0.65rem', color: T.subtle }}>
                Hover to pause · click dots to jump
              </div>
            </div>

            {/* Right — animated mockup */}
            <div style={{ flex: 1, padding: '28px 28px', overflow: 'hidden' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.28, ease }}
                >
                  <Mockup />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ── CTA ───────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <motion.button
            onClick={onSearch}
            whileHover={{ y: -2, boxShadow: '0 8px 32px rgba(139,92,246,0.35)' }}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.35, ease }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: T.accent, border: 'none',
              borderRadius: 12, padding: '13px 26px',
              color: '#fff', fontSize: '0.88rem', fontWeight: 700,
              cursor: 'pointer', letterSpacing: '-0.01em',
              transition: 'box-shadow 0.2s, transform 0.2s',
            }}
          >
            Search your channel
            <kbd style={{
              background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 5, padding: '1px 7px', fontSize: '0.72rem',
              fontFamily: 'inherit', fontWeight: 600,
            }}>⌘K</kbd>
          </motion.button>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.4 }}
            style={{ fontSize: '0.72rem', color: T.muted }}
          >
            Free to start · no signup needed
          </motion.p>
        </div>
      </div>
    </div>
  );
}
