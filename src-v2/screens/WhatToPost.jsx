import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

const SCORING_URL = 'http://localhost:3002';

const fmtV = (n) => {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

// ── Trend config ──────────────────────────────────────────────────────────────

const TREND = {
  rising:    { color: T.success, bg: T.successDim,  border: `${T.success}40`,  label: '↑ Rising',    pulse: true  },
  peaking:   { color: T.warning, bg: T.warningDim,  border: `${T.warning}40`,  label: '◆ Peaking',   pulse: false },
  evergreen: { color: T.accent,  bg: T.accentGlow,  border: T.accentBorder,    label: '◎ Evergreen', pulse: false },
  fading:    { color: T.danger,  bg: T.dangerDim,   border: `${T.danger}40`,   label: '↓ Fading',    pulse: false },
  dormant:   { color: T.muted,   bg: 'rgba(255,255,255,0.03)', border: T.border, label: '· Quiet',   pulse: false },
};

const SAT = {
  low:    { color: T.success, label: 'Low' },
  medium: { color: T.warning, label: 'Medium' },
  high:   { color: T.danger,  label: 'High' },
};

const VEL = {
  fast:    { color: T.success, label: 'Growing fast ↑↑' },
  growing: { color: T.accent,  label: 'Still growing ↑'  },
  peaked:  { color: T.muted,   label: 'Peaked →'         },
};

// ── Source colors ─────────────────────────────────────────────────────────────

const SOURCE = {
  adjacent: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.25)', icon: '↔', label: 'Adjacent Niche' },
  global:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)',  icon: '🌐', label: 'Global Signal' },
  trends:   { color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)',  icon: '📈', label: 'Trending in India' },
};

const FILTERS = [
  { id: 'all',       label: 'All ideas'      },
  { id: 'act_now',  label: '⚡ Act Now'      },
  { id: 'rising',   label: '↑ Rising'        },
  { id: 'evergreen',label: '◎ Evergreen'     },
  { id: 'unexplored',label: '◇ Unexplored'  },
  { id: 'saturated', label: '⬛ Saturated'   },
];

// ── Score arc ─────────────────────────────────────────────────────────────────

function ScoreArc({ score, size = 58 }) {
  const R   = (size / 2) - 5;
  const C   = 2 * Math.PI * R;
  const pct = score / 100;
  const col = score >= 80 ? T.success : score >= 60 ? T.warning : T.muted;

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={R} fill="none" stroke={T.border} strokeWidth="4" />
        <motion.circle
          cx={size/2} cy={size/2} r={R}
          fill="none" stroke={col} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C - pct * C }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
          style={{ filter: `drop-shadow(0 0 5px ${col}66)` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 900, color: col, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: '0.4rem', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>score</span>
      </div>
    </div>
  );
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <motion.div
      animate={{ opacity: [0.4, 0.65, 0.4] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      style={{ ...T.glassCard, borderRadius: 16, padding: '22px', height: 240 }}
    />
  );
}

// ── Trend badge ───────────────────────────────────────────────────────────────

function TrendBadge({ status }) {
  const cfg = TREND[status] || TREND.dormant;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      {cfg.pulse && (
        <motion.div
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          style={{ width: 5, height: 5, borderRadius: '50%', background: cfg.color, flexShrink: 0 }}
        />
      )}
      <span style={{
        fontSize: '0.58rem', fontWeight: 700, color: cfg.color,
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        borderRadius: 5, padding: '2px 7px',
      }}>
        {cfg.label}
      </span>
    </div>
  );
}

// ── Saturation pill ───────────────────────────────────────────────────────────

function SatPill({ level, pct, channelCount, total }) {
  const cfg = SAT[level] || SAT.medium;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 56, height: 3, borderRadius: 99, background: T.border, flexShrink: 0, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
          style={{ height: '100%', background: cfg.color, borderRadius: 99 }}
        />
      </div>
      <span style={{ fontSize: '0.65rem', color: T.muted }}>
        <span style={{ color: T.text, fontWeight: 600 }}>{channelCount}</span>
        {total ? ` of ${total}` : ''} channels
        {' · '}
        <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
      </span>
    </div>
  );
}

// ── Act Now banner ────────────────────────────────────────────────────────────

function ActNowBanner({ ideas, onJump }) {
  const actNow = ideas.filter(i => i.act_now).slice(0, 3);
  if (!actNow.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      style={{
        ...T.glassCard,
        borderRadius: 14, padding: '14px 18px',
        marginBottom: 20,
        border: `1px solid ${T.success}30`,
        background: `linear-gradient(120deg, rgba(18,217,138,0.07) 0%, rgba(14,14,16,0.5) 60%)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <motion.span
          animate={{ scale: [1, 1.18, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1 }}
          style={{ fontSize: '1rem' }}
        >⚡</motion.span>
        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: T.success }}>
          {actNow.length} window{actNow.length > 1 ? 's are' : ' is'} open this week
        </span>
        <span style={{ fontSize: '0.72rem', color: T.muted }}>
          — rising trend, low saturation, act now
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actNow.map((idea) => (
          <motion.button
            key={idea.topic}
            onClick={() => onJump(idea.topic)}
            whileHover={{ y: -2, boxShadow: `0 4px 20px ${T.success}22` }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 12px', borderRadius: 9,
              background: T.successDim, border: `1px solid ${T.success}30`,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: T.success }}>{idea.topic}</span>
            <span style={{ fontSize: '0.68rem', color: T.muted }}>
              {idea.channel_count} ch · {fmtV(idea.avg_views)} avg
            </span>
            <span style={{ fontSize: '0.65rem', color: T.success, opacity: 0.7 }}>→</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Idea card ─────────────────────────────────────────────────────────────────

function IdeaCard({ idea, index, saved, onSave, highlighted, communitySize }) {
  const [expanded, setExpanded] = useState(false);
  const velCfg = idea.velocity ? (VEL[idea.velocity.status] || VEL.peaked) : null;

  return (
    <motion.div
      id={`idea-${idea.topic.replace(/\s+/g, '-')}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease }}
      whileHover={{ y: -4, boxShadow: '0 16px 48px rgba(0,0,0,0.55)' }}
      style={{
        ...T.glassCard,
        borderRadius: 16, padding: '20px',
        outline: highlighted ? `1.5px solid ${T.success}60` : 'none',
        transition: 'box-shadow 0.2s, outline 0.2s',
      }}
    >
      {/* ── Row 1: score + topic + trend badge ── */}
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start', marginBottom: 12 }}>
        <ScoreArc score={idea.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: T.text, lineHeight: 1.25, letterSpacing: '-0.01em' }}>
              {idea.topic}
            </span>
            <TrendBadge status={idea.trend_status} />
            {idea.act_now && (
              <span style={{
                fontSize: '0.55rem', fontWeight: 800, color: '#fff',
                background: T.success, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em',
              }}>
                ACT NOW
              </span>
            )}
            {idea.recommendation_type === 'context_gap' && (
              <span style={{
                fontSize: '0.55rem', fontWeight: 700, color: T.accent,
                background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
                borderRadius: 4, padding: '2px 6px', letterSpacing: '0.03em',
              }}>
                ◈ Your angle
              </span>
            )}
            {idea.recommendation_type === 'long_form_opportunity' && (
              <span style={{
                fontSize: '0.55rem', fontWeight: 700, color: '#a78bfa',
                background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)',
                borderRadius: 4, padding: '2px 6px', letterSpacing: '0.03em',
              }}>
                📽 Long-Form
              </span>
            )}
          </div>

          {/* ── Saturation ── */}
          <SatPill
            level={idea.saturation_level}
            pct={idea.saturation_pct}
            channelCount={idea.channel_count}
            total={communitySize}
          />
        </div>
      </div>

      {/* ── Row 2: format + velocity chips ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: '0.65rem', color: T.muted }}>avg <span style={{ color: T.text, fontWeight: 700 }}>{fmtV(idea.avg_views)}</span> views</span>

        {idea.format_winner && (
          <span style={{
            fontSize: '0.63rem', color: T.accent, fontWeight: 600,
            background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
            borderRadius: 5, padding: '2px 7px',
          }}>
            {idea.format_winner.label} wins · {idea.format_winner.pct}%
          </span>
        )}

        {velCfg && (
          <span style={{
            fontSize: '0.63rem', fontWeight: 600, color: velCfg.color,
            background: `${velCfg.color}18`, border: `1px solid ${velCfg.color}35`,
            borderRadius: 5, padding: '2px 7px',
          }}>
            {velCfg.label}
          </span>
        )}
      </div>

      {/* ── Example videos ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
        {idea.examples.map((ex, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            ...T.glassSurface, borderRadius: 8, padding: '7px 10px',
          }}>
            <div style={{
              width: 3, height: 3, borderRadius: '50%', flexShrink: 0,
              background: idea.score >= 80 ? T.success : idea.score >= 60 ? T.warning : T.muted,
            }} />
            <span style={{ flex: 1, fontSize: '0.66rem', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ex.title}
            </span>
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: T.text, flexShrink: 0 }}>
              {fmtV(ex.views)}
            </span>
          </div>
        ))}
      </div>

      {/* ── Expected views ── */}
      {idea.expected_low != null && (
        <div style={{
          ...T.glassSurface, borderRadius: 8, padding: '8px 12px',
          marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: '0.62rem', color: T.muted, flexShrink: 0 }}>Your estimate</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: T.accent }}>
            {fmtV(idea.expected_low)}–{fmtV(idea.expected_high)}
          </span>
          <span style={{ fontSize: '0.6rem', color: T.muted }}>views in 30 days</span>
        </div>
      )}

      {/* ── Why expanded ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 10 }}
          >
            <p style={{ fontSize: '0.72rem', color: T.muted, lineHeight: 1.65, margin: 0, padding: '6px 0' }}>
              {idea.why}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <motion.button
          onClick={() => onSave(idea.topic)}
          whileTap={{ scale: 0.95 }}
          style={{
            padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
            fontSize: '0.72rem', fontWeight: 700,
            background: saved ? T.successDim : T.accentGlow,
            color:      saved ? T.success    : T.accent,
            border:     `1px solid ${saved ? T.success + '35' : T.accentBorder}`,
            transition: 'all 0.15s',
          }}
        >
          {saved ? '✓ Saved'
            : idea.recommendation_type === 'context_gap'          ? 'Save prompt'
            : idea.recommendation_type === 'long_form_opportunity' ? 'Save topic'
            : 'Save idea'}
        </motion.button>

        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            padding: '6px 10px', borderRadius: 8,
            background: 'transparent', border: `1px solid ${T.border}`,
            color: T.muted, fontSize: '0.72rem', cursor: 'pointer',
          }}
        >
          {expanded ? 'Less' : 'Why?'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Source section header ─────────────────────────────────────────────────────

function SectionHeader({ src, subtitle, count }) {
  const cfg = SOURCE[src];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <span style={{
        fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em',
        color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
        borderRadius: 5, padding: '3px 9px', flexShrink: 0,
      }}>
        {cfg.icon} {cfg.label.toUpperCase()}
      </span>
      <span style={{ fontSize: '0.73rem', color: T.muted }}>{subtitle}</span>
      {count > 0 && (
        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: T.muted, flexShrink: 0 }}>
          {count} idea{count !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

// ── Compact idea card (used for adjacent / global / trends sections) ──────────

function CompactIdeaCard({ idea, src, saved, onSave }) {
  const cfg   = SOURCE[src];
  const score = idea.score;
  const col   = score >= 80 ? T.success : score >= 60 ? T.warning : T.muted;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      whileHover={{ y: -3, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
      style={{
        ...T.glassCard,
        borderRadius: 13, padding: '14px 16px',
        border: `1px solid ${idea.act_now ? cfg.color + '45' : T.border}`,
      }}
    >
      {/* score ring + topic */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 9 }}>
        <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
          <svg width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="20" cy="20" r="15" fill="none" stroke={T.border} strokeWidth="3" />
            <motion.circle
              cx="20" cy="20" r="15" fill="none" stroke={col} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={94.2}
              initial={{ strokeDashoffset: 94.2 }}
              animate={{ strokeDashoffset: 94.2 - (score / 100) * 94.2 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              style={{ filter: `drop-shadow(0 0 4px ${col}66)` }}
            />
          </svg>
          <span style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem', fontWeight: 900, color: col,
          }}>{score}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: T.text, lineHeight: 1.25 }}>
              {idea.topic}
            </span>
            <TrendBadge status={idea.trend_status} />
            {idea.act_now && (
              <span style={{
                fontSize: '0.5rem', fontWeight: 800, color: '#fff',
                background: T.success, borderRadius: 4, padding: '2px 5px', letterSpacing: '0.04em',
              }}>ACT NOW</span>
            )}
          </div>
          <SatPill level={idea.saturation_level} pct={idea.saturation_pct} channelCount={idea.channel_count} />
        </div>
      </div>

      {/* avg views */}
      <div style={{ fontSize: '0.63rem', color: T.muted, marginBottom: 8 }}>
        avg <span style={{ color: T.text, fontWeight: 700 }}>{fmtV(idea.avg_views)}</span> views
        {idea.format_winner && (
          <span style={{ marginLeft: 8, color: cfg.color, fontWeight: 600 }}>
            · {idea.format_winner.label} wins
          </span>
        )}
      </div>

      {/* top example */}
      {idea.examples?.[0] && (
        <div style={{
          ...T.glassSurface, borderRadius: 7, padding: '5px 9px',
          fontSize: '0.62rem', color: T.muted, marginBottom: 10,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {idea.examples[0].title}
        </div>
      )}

      <button
        onClick={() => onSave(idea.topic)}
        style={{
          padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
          fontSize: '0.68rem', fontWeight: 700,
          background: saved ? T.successDim : cfg.bg,
          color:      saved ? T.success    : cfg.color,
          border:     `1px solid ${saved ? T.success + '35' : cfg.border}`,
          transition: 'all 0.15s',
        }}
      >
        {saved ? '✓ Saved' : 'Save idea'}
      </button>
    </motion.div>
  );
}

// ── Source section wrapper ────────────────────────────────────────────────────

function SourceSection({ src, subtitle, ideas, saved, onSave, loading, empty }) {
  if (loading) {
    return (
      <div style={{ marginTop: 40 }}>
        <SectionHeader src={src} subtitle={subtitle} count={0} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {[1, 2, 3].map(i => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 0.55, 0.3] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }}
              style={{ ...T.glassCard, borderRadius: 13, height: 160 }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!ideas || ideas.length === 0) {
    if (empty) return (
      <div style={{ marginTop: 40 }}>
        <SectionHeader src={src} subtitle={subtitle} count={0} />
        <div style={{ ...T.glassSurface, borderRadius: 10, padding: '20px', fontSize: '0.74rem', color: T.muted, textAlign: 'center' }}>
          {empty}
        </div>
      </div>
    );
    return null;
  }

  return (
    <div style={{ marginTop: 40 }}>
      <SectionHeader src={src} subtitle={subtitle} count={ideas.length} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {ideas.map(idea => (
          <CompactIdeaCard
            key={idea.topic}
            idea={idea}
            src={src}
            saved={saved.has(idea.topic)}
            onSave={onSave}
          />
        ))}
      </div>
    </div>
  );
}

// ── Community Hot Section ─────────────────────────────────────────────────────

function CommunityHotSection({ data, loading }) {
  if (!loading && (!data || !data.items?.length)) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginTop: 48 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '1rem' }}>🔥</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>
          Hot in Your Community
        </h3>
        {data?.peer_count > 0 && (
          <span style={{ fontSize: '0.68rem', color: T.muted, marginLeft: 2 }}>
            {data.peer_count} peer channels · last 60 days
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '0.75rem', color: T.muted, lineHeight: 1.5 }}>
        Topics your peers are getting views on right now that you haven't covered
      </p>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => (
            <motion.div key={i} animate={{ opacity: [0.4,0.7,0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
              style={{ ...T.glassCard, borderRadius: 12, height: 90, border: `1px solid ${T.border}` }} />
          ))}
        </div>
      )}

      {!loading && data?.items?.map((item, i) => (
        <motion.div
          key={item.topic}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
          style={{
            ...T.glassCard, borderRadius: 12,
            border: `1px solid ${T.border}`,
            padding: '14px 16px', marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: T.text, textTransform: 'capitalize' }}>
                {item.topic}
              </span>
              <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.68rem', color: T.success, fontWeight: 600 }}>
                  {fmtV(item.total_views)} total views
                </span>
                <span style={{ fontSize: '0.68rem', color: T.muted }}>
                  {item.channel_count} of {item.peer_count} channels
                </span>
              </div>
            </div>
            <span style={{
              fontSize: '0.62rem', fontWeight: 700, padding: '3px 9px', borderRadius: 6,
              background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)',
              flexShrink: 0,
            }}>
              HOT NOW
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(item.channels || []).map((c, j) => (
              <div key={j} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8, padding: '6px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
              }}>
                <span style={{ fontSize: '0.73rem', color: T.text, flex: 1, lineHeight: 1.3, fontWeight: 500 }}>
                  {c.channel_name}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: T.success, flexShrink: 0 }}>
                  {fmtV(c.views)}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ── World Signals Section ─────────────────────────────────────────────────────

function WorldSignalsSection({ data, loading }) {
  const hasVelocity = data?.velocity?.length > 0;
  const hasTrends   = data?.trends?.length > 0;
  const hasAny      = hasVelocity || hasTrends;

  if (!loading && !hasAny) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginTop: 48 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '1rem' }}>🌐</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>
          World Signals
        </h3>
        {loading && (
          <motion.span
            animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}
            style={{ fontSize: '0.65rem', color: T.muted }}
          >
            loading…
          </motion.span>
        )}
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '0.75rem', color: T.muted, lineHeight: 1.5 }}>
        What's accelerating globally right now that fits your channel's DNA
      </p>

      {loading && !hasAny && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => (
            <motion.div key={i} animate={{ opacity: [0.4,0.7,0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
              style={{ ...T.glassCard, borderRadius: 12, height: 72, border: `1px solid ${T.border}` }} />
          ))}
        </div>
      )}

      {/* Velocity spikes */}
      {hasVelocity && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
            ⚡ Velocity Spikes — accelerating in your niche right now
          </div>
          {data.velocity.map((item, i) => (
            <motion.div
              key={item.topic}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: i * 0.05 }}
              style={{
                ...T.glassCard, borderRadius: 12,
                border: `1px solid rgba(16,185,129,0.2)`,
                padding: '12px 14px', marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: '0.83rem', fontWeight: 700, color: T.text, textTransform: 'capitalize' }}>
                  {item.topic}
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.68rem', color: T.success, fontWeight: 700 }}>
                    {item.velocity_ratio}× velocity
                  </span>
                  <span style={{ fontSize: '0.65rem', color: T.muted }}>{fmtV(item.total_views)} views</span>
                </div>
              </div>
              {item.sample_titles?.map((t, j) => (
                <div key={j} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, padding: '5px 8px', borderRadius: 7,
                  background: 'rgba(16,185,129,0.05)', marginBottom: j < item.sample_titles.length - 1 ? 4 : 0,
                }}>
                  <span style={{ fontSize: '0.7rem', color: T.muted, flex: 1, lineHeight: 1.4 }}>{t.title}</span>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: T.text }}>{fmtV(t.views)}</div>
                    {t.channel_name && <div style={{ fontSize: '0.58rem', color: T.muted }}>{t.channel_name}</div>}
                  </div>
                </div>
              ))}
            </motion.div>
          ))}
        </div>
      )}

      {/* Google Trends */}
      {hasTrends && (
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
            📈 Google Trends — rising searches in India
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.trends.map((t, i) => (
              <motion.div
                key={t.topic}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                style={{
                  padding: '7px 14px', borderRadius: 8,
                  background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)',
                  fontSize: '0.76rem', color: '#f97316', fontWeight: 600,
                }}
              >
                {t.topic}
                {t.trend_value === 999
                  ? <span style={{ fontSize: '0.58rem', marginLeft: 6, opacity: 0.7 }}>BREAKOUT</span>
                  : <span style={{ fontSize: '0.58rem', marginLeft: 6, opacity: 0.7 }}>+{t.trend_value}%</span>
                }
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function WhatToPost({ channel, onSearch }) {
  const [ideas,         setIdeas]        = useState([]);
  const [meta,          setMeta]         = useState(null);
  const [nicheCategory, setNicheCategory]= useState(null);
  const [loading,       setLoading]      = useState(false);
  const [error,         setError]        = useState(null);

  const [adjacent,      setAdjacent]     = useState(null);
  const [loadingAdj,    setLoadingAdj]   = useState(false);
  const [foreign,       setForeign]      = useState(null);
  const [loadingFor,    setLoadingFor]   = useState(false);
  const [trends,        setTrends]       = useState(null);
  const [loadingTrends, setLoadingTrends]= useState(false);

  // New sections
  const [communityHot,     setCommunityHot]     = useState(null);
  const [loadingCommunity, setLoadingCommunity] = useState(false);
  const [worldSignals,     setWorldSignals]     = useState(null);
  const [loadingWorld,     setLoadingWorld]     = useState(false);

  const [searchQuery,   setSearchQuery]  = useState('');
  const [searchInput,   setSearchInput]  = useState('');
  const [searchResult,  setSearchResult] = useState(null);
  const [searchLoading, setSearchLoading]= useState(false);
  const [filter,   setFilter]   = useState('all');
  const [jumpTo,   setJumpTo]   = useState(null);
  const [saved,    setSaved]    = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wtp_saved') || '[]')); }
    catch { return new Set(); }
  });

  useEffect(() => {
    if (!channel) return;
    setLoading(true);
    setError(null);
    setIdeas([]);
    setMeta(null);
    setNicheCategory(null);
    setAdjacent(null);
    setForeign(null);
    setTrends(null);
    setCommunityHot(null);
    setWorldSignals(null);

    const params = new URLSearchParams();
    if (channel.channel_id) params.set('channel_id',       channel.channel_id);
    if (channel.niche)      params.set('niche',            channel.niche);
    if (channel.subsRaw)    params.set('subscriber_count', channel.subsRaw);

    const qs = params.toString();

    // Main community gap
    fetch(`${SCORING_URL}/api/intel/what-to-post?${qs}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setNicheCategory(data.niche_category || 'A');
          setIdeas(data.ideas || []);
          setMeta({ channel_count: data.channel_count, video_count: data.video_count, summary: data.summary || null });
        } else {
          setError(data.error || 'Failed to load ideas');
        }
      })
      .catch(() => setError('Could not reach server'))
      .finally(() => setLoading(false));

    // Adjacent niches (parallel)
    setLoadingAdj(true);
    fetch(`${SCORING_URL}/api/intel/adjacent-ideas?${qs}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setAdjacent(data); })
      .catch(() => {})
      .finally(() => setLoadingAdj(false));

    // Foreign signal (parallel)
    setLoadingFor(true);
    fetch(`${SCORING_URL}/api/intel/foreign-signal?${qs}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setForeign(data); })
      .catch(() => {})
      .finally(() => setLoadingFor(false));

    // Google Trends correlation (parallel)
    setLoadingTrends(true);
    fetch(`${SCORING_URL}/api/intel/trending-topics?${qs}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setTrends(data); })
      .catch(() => {})
      .finally(() => setLoadingTrends(false));

    // Community hot — what peers are getting views on right now (last 60 days)
    if (channel.channel_id) {
      setLoadingCommunity(true);
      fetch(`${SCORING_URL}/api/intel/community-hot?channel_id=${channel.channel_id}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setCommunityHot(data); })
        .catch(() => {})
        .finally(() => setLoadingCommunity(false));
    }

    // World signals — async, loads in background, shows whatever arrives
    if (channel.channel_id) {
      setLoadingWorld(true);
      fetch(`${SCORING_URL}/api/intel/world-signals?channel_id=${channel.channel_id}`)
        .then(r => r.json())
        .then(data => { if (data.ok) setWorldSignals(data); })
        .catch(() => {})
        .finally(() => setLoadingWorld(false));
    }

  }, [channel?.channel_id, channel?.niche]);

  const toggleSave = (topic) => {
    setSaved(prev => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic); else next.add(topic);
      localStorage.setItem('wtp_saved', JSON.stringify([...next]));
      return next;
    });
  };

  const handleTopicSearch = (q) => {
    if (!q.trim()) return;
    setSearchQuery(q.trim());
    setSearchResult(null);
    setSearchLoading(true);
    const params = new URLSearchParams();
    params.set('q', q.trim());
    if (channel?.channel_id) params.set('channel_id', channel.channel_id);
    if (channel?.niche)      params.set('niche', channel.niche);
    fetch(`${SCORING_URL}/api/intel/topic-search?${params}`)
      .then(r => r.json())
      .then(data => { if (data.ok) setSearchResult(data); })
      .catch(() => {})
      .finally(() => setSearchLoading(false));
  };

  const handleJump = (topic) => {
    setFilter('all');
    setJumpTo(topic);
    setTimeout(() => {
      const el = document.getElementById(`idea-${topic.replace(/\s+/g, '-')}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setJumpTo(null), 1800);
    }, 80);
  };

  const filtered = ideas.filter(idea => {
    if (filter === 'act_now')   return idea.act_now;
    if (filter === 'rising')    return idea.trend_status === 'rising';
    if (filter === 'evergreen') return idea.trend_status === 'evergreen';
    if (filter === 'unexplored')return idea.saturation_level === 'low';
    if (filter === 'saturated') return idea.saturation_level === 'high';
    return true;
  });

  // ── No channel selected ───────────────────────────────────────────────────
  if (!channel) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        minHeight: '70vh', padding: '40px 20px', textAlign: 'center',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease }}
        >
          <motion.div
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ fontSize: '2.6rem', marginBottom: 22 }}
          >🎯</motion.div>
          <h2 style={{
            fontSize: '1.2rem', fontWeight: 900, color: T.text,
            margin: '0 0 10px', letterSpacing: '-0.02em',
          }}>
            What should you post next?
          </h2>
          <p style={{
            fontSize: '0.82rem', color: T.muted,
            margin: '0 0 30px', maxWidth: 360, lineHeight: 1.65,
          }}>
            Search your channel and we'll show you exactly what topics your community is covering that you haven't — ranked by trend status, saturation, and expected views.
          </p>
          <motion.button
            onClick={onSearch}
            whileHover={{ scale: 1.04, boxShadow: `0 0 24px ${T.accent}44` }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '11px 26px', borderRadius: 11,
              background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
              color: T.accent, fontSize: '0.83rem', fontWeight: 700,
              cursor: 'pointer', letterSpacing: '-0.01em',
            }}
          >
            Search your channel
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        style={{ marginBottom: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 900, color: T.text, margin: 0, letterSpacing: '-0.02em' }}>
            What to Post
          </h2>
          {meta && (
            <span style={{ fontSize: '0.73rem', color: T.muted }}>
              Based on{' '}
              <span style={{ color: T.text, fontWeight: 600 }}>{meta.channel_count}</span> channels
              {' · '}
              <span style={{ color: T.text, fontWeight: 600 }}>{meta.video_count}</span> videos
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.77rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>
          Topics your community covers that{' '}
          <span style={{ color: T.accent, fontWeight: 600 }}>{channel.name}</span>{' '}
          hasn't made yet — ranked by opportunity.
        </p>
      </motion.div>

      {/* ── Topic search bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease, delay: 0.05 }}
        style={{ marginTop: 18, marginBottom: 6 }}
      >
        <form
          onSubmit={e => { e.preventDefault(); handleTopicSearch(searchInput); }}
          style={{ display: 'flex', gap: 8, alignItems: 'center' }}
        >
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 10,
            ...T.glassSurface, borderRadius: 10,
            border: `1px solid ${T.border}`, padding: '0 14px',
          }}>
            <span style={{ fontSize: '0.8rem', color: T.muted, flexShrink: 0 }}>🔍</span>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search a topic — e.g. geopolitics, India China border, renewable energy…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: T.text, fontSize: '0.78rem', padding: '10px 0',
              }}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setSearchQuery(''); setSearchResult(null); }}
                style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}
              >✕</button>
            )}
          </div>
          <motion.button
            type="submit"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
              background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
              color: T.accent, fontSize: '0.76rem', fontWeight: 700,
              flexShrink: 0,
            }}
          >
            Validate topic
          </motion.button>
        </form>
      </motion.div>

      {/* ── Topic search results ── */}
      <AnimatePresence>
        {(searchLoading || searchResult) && (
          <motion.div
            key="search-results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease }}
            style={{ marginBottom: 22 }}
          >
            {searchLoading && (
              <motion.div
                animate={{ opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                style={{ ...T.glassCard, borderRadius: 12, padding: '18px', height: 80 }}
              />
            )}
            {searchResult && !searchLoading && (() => {
              const c = searchResult.community;
              const g = searchResult.global;
              const hasCommunity = c && c.video_count > 0;
              const hasGlobal    = g && g.video_count > 0;
              const trendCfg     = c?.trend_status ? (TREND[c.trend_status] || TREND.dormant) : null;
              return (
                <div style={{ ...T.glassCard, borderRadius: 12, padding: '16px 18px', border: `1px solid ${T.accentBorder}` }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: T.accent, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, borderRadius: 5, padding: '2px 8px' }}>
                      🔍 SEARCH
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: T.text }}>
                      "{searchResult.query}"
                    </span>
                    {hasCommunity && trendCfg && <TrendBadge status={c.trend_status} />}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Community column */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', marginBottom: 8, textTransform: 'uppercase' }}>
                        Your community
                      </div>
                      {!hasCommunity ? (
                        <div style={{ fontSize: '0.73rem', color: T.muted }}>No videos found on this topic in your community yet. You'd be first.</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 900, color: T.text }}>{c.channel_count}</div>
                              <div style={{ fontSize: '0.6rem', color: T.muted }}>channels covered</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 900, color: T.accent }}>{fmtV(c.avg_views)}</div>
                              <div style={{ fontSize: '0.6rem', color: T.muted }}>avg views</div>
                            </div>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 900, color: c.saturation_level === 'low' ? T.success : c.saturation_level === 'high' ? T.danger : T.warning }}>{c.saturation_pct}%</div>
                              <div style={{ fontSize: '0.6rem', color: T.muted }}>saturation</div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {c.top_videos.slice(0, 4).map((v, i) => (
                              <div key={i} style={{ ...T.glassSurface, borderRadius: 7, padding: '5px 9px', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ flex: 1, fontSize: '0.62rem', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                                <span style={{ fontSize: '0.62rem', fontWeight: 700, color: T.text, flexShrink: 0 }}>{fmtV(v.views)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Global column */}
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', marginBottom: 8, textTransform: 'uppercase' }}>
                        Globally ({g?.video_count || 0} videos)
                      </div>
                      {!hasGlobal ? (
                        <div style={{ fontSize: '0.73rem', color: T.muted }}>No matching videos in the database.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {g.top_videos.slice(0, 4).map((v, i) => (
                            <div key={i} style={{ ...T.glassSurface, borderRadius: 7, padding: '5px 9px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ flex: 1, fontSize: '0.62rem', color: T.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: T.text, flexShrink: 0 }}>{fmtV(v.views)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Summary pills ── */}
      <AnimatePresence>
        {meta?.summary && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease, delay: 0.1 }}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 22, marginTop: 14 }}
          >
            {[
              { key: 'rising',    color: T.success, icon: '↑', label: `${meta.summary.rising} rising`    },
              { key: 'evergreen', color: T.accent,  icon: '◎', label: `${meta.summary.evergreen} evergreen` },
              { key: 'unexplored',color: T.muted,   icon: '◇', label: `${meta.summary.unexplored} unexplored` },
              { key: 'saturated', color: T.danger,  icon: '⬛', label: `${meta.summary.saturated} saturated`  },
            ].map(p => (
              <motion.button
                key={p.key}
                onClick={() => setFilter(f => f === p.key ? 'all' : p.key)}
                whileHover={{ y: -1 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 7,
                  background: filter === p.key ? `${p.color}18` : 'transparent',
                  border: `1px solid ${filter === p.key ? p.color + '50' : T.border}`,
                  color: filter === p.key ? p.color : T.muted,
                  fontSize: '0.68rem', fontWeight: filter === p.key ? 700 : 400,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <span style={{ color: p.color }}>{p.icon}</span>
                {p.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Act Now banner ── */}
      {!loading && ideas.length > 0 && (
        <ActNowBanner ideas={ideas} onJump={handleJump} />
      )}

      {/* ── Filter tabs ── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 22 }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <div key={f.id} style={{ position: 'relative' }}>
              {active && (
                <motion.div
                  layoutId="wtpFilterPill"
                  transition={spring.snappy}
                  style={{
                    position: 'absolute', inset: 0,
                    background: T.accentGlow,
                    border: `1px solid ${T.accentBorder}`,
                    borderRadius: 8,
                  }}
                />
              )}
              <button
                onClick={() => setFilter(f.id)}
                style={{
                  position: 'relative', zIndex: 1,
                  padding: '6px 13px', borderRadius: 8,
                  border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: active ? T.accent : T.muted,
                  fontSize: '0.74rem', fontWeight: active ? 700 : 400,
                  whiteSpace: 'nowrap', transition: 'color 0.15s',
                }}
              >
                {f.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Loading skeletons ── */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{
            ...T.glassCard, borderRadius: 14,
            textAlign: 'center', padding: '52px 20px', color: T.muted, fontSize: '0.84rem',
          }}
        >
          <div style={{ fontSize: '1.4rem', marginBottom: 12 }}>⚠️</div>
          {error}
          <div style={{ marginTop: 8, fontSize: '0.7rem', color: T.subtle }}>
            Make sure the server is running and this channel's niche is in the database.
          </div>
        </motion.div>
      )}

      {/* ── Filter empty state ── */}
      {!loading && !error && filtered.length === 0 && ideas.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ textAlign: 'center', padding: '60px 20px', color: T.muted, fontSize: '0.84rem' }}
        >
          No ideas match this filter.
        </motion.div>
      )}

      {/* ── Category B state ── */}
      {!loading && !error && nicheCategory === 'B' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease }}
          style={{
            ...T.glassCard, borderRadius: 14,
            padding: '48px 32px', textAlign: 'center',
            border: `1px solid ${T.accentBorder}`,
            background: `linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(14,14,16,0.5) 70%)`,
          }}
        >
          <motion.div
            animate={{ rotate: [0, -8, 8, -8, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 3 }}
            style={{ fontSize: '2rem', marginBottom: 18 }}
          >🎨</motion.div>
          <div style={{ fontWeight: 800, color: T.text, fontSize: '1rem', marginBottom: 8, letterSpacing: '-0.01em' }}>
            Style signals coming soon
          </div>
          <div style={{ fontSize: '0.78rem', color: T.muted, lineHeight: 1.7, maxWidth: 380, margin: '0 auto 22px' }}>
            Music and comedy channels create original work — we don't suggest copying topics.
            Instead, we're building <span style={{ color: T.accent, fontWeight: 600 }}>format and emotion signal analysis</span> that shows
            which styles and moods are resonating in your community right now.
          </div>
          <div style={{
            display: 'inline-flex', gap: 20,
            ...T.glassSurface, borderRadius: 10, padding: '12px 24px',
          }}>
            {[
              { icon: '📐', label: 'Format clusters' },
              { icon: '🎭', label: 'Emotion signals' },
              { icon: '📈', label: 'Momentum patterns' },
            ].map(({ icon, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: '0.65rem', color: T.muted, fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── No community data ── */}
      {!loading && !error && ideas.length === 0 && nicheCategory !== 'B' && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{
            ...T.glassCard, borderRadius: 14,
            textAlign: 'center', padding: '60px 20px',
          }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 14 }}>📡</div>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 6, fontSize: '0.9rem' }}>
            No community data yet
          </div>
          <div style={{ fontSize: '0.76rem', color: T.muted, lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
            This channel's community needs videos in the database to generate ideas.
            Run the pipeline to ingest more channels in this niche.
          </div>
        </motion.div>
      )}

      {/* ── Ideas grid ── */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {filtered.map((idea, i) => (
            <IdeaCard
              key={idea.topic}
              idea={idea}
              index={i}
              saved={saved.has(idea.topic)}
              onSave={toggleSave}
              highlighted={jumpTo === idea.topic}
              communitySize={meta?.channel_count}
            />
          ))}
        </div>
      )}

      {/* ── Divider ── */}
      {(loadingAdj || adjacent || loadingFor || foreign || loadingTrends || trends) && (
        <div style={{ margin: '44px 0 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{ fontSize: '0.65rem', color: T.muted, fontWeight: 600, letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            MORE SOURCES
          </span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>
      )}

      {/* ── Adjacent niches ── */}
      {loadingAdj && (
        <SourceSection src="adjacent" subtitle="What's working in niches your audience also watches" loading ideas={null} saved={saved} onSave={toggleSave} />
      )}
      {!loadingAdj && adjacent?.sources?.map(source => (
        <SourceSection
          key={source.niche}
          src="adjacent"
          subtitle={`What's performing in ${source.niche} that your audience would also watch`}
          ideas={source.ideas}
          saved={saved}
          onSave={toggleSave}
        />
      ))}

      {/* ── Foreign signal ── */}
      {loadingFor && (
        <SourceSection src="global" subtitle="Trending in US/UK channels of this niche — not yet in India" loading ideas={null} saved={saved} onSave={toggleSave} />
      )}
      {!loadingFor && foreign?.supported && (
        <SourceSection
          src="global"
          subtitle={`Topics trending in US/UK ${channel.niche || ''} channels — not in your community yet`}
          ideas={foreign.ideas || []}
          saved={saved}
          onSave={toggleSave}
          empty={foreign.channel_count < 3 ? 'No foreign channels ingested for this niche yet.' : 'No foreign-exclusive topics found right now.'}
        />
      )}

      {/* ── Google Trends correlation ── */}
      {loadingTrends && (
        <SourceSection src="trends" subtitle="Rising Google searches in India · correlated with community performance" loading ideas={null} saved={saved} onSave={toggleSave} />
      )}
      {!loadingTrends && trends && (
        <SourceSection
          src="trends"
          subtitle="Rising Google searches in India where your community has proven performance"
          ideas={trends.ideas || []}
          saved={saved}
          onSave={toggleSave}
          empty="No trending searches matched your community's video history right now."
        />
      )}

      {/* ── Community Hot ── */}
      <CommunityHotSection data={communityHot} loading={loadingCommunity} />

      {/* ── World Signals ── */}
      <WorldSignalsSection data={worldSignals} loading={loadingWorld} />

    </div>
  );
}
