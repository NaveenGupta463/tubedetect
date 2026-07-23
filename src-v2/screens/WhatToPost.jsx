import { useState, useEffect, useRef, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';
import LoadingShowcase from '../components/LoadingShowcase';

const SCORING_URL = 'http://localhost:3002';

const fmtV = (n) => {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const SUPPORT_FETCH_TIMEOUT_MS = 8000;
const CACHE_REFRESH_POLL_DELAYS = [4000, 8000, 16000];

function fetchJsonWithTimeout(url, timeoutMs = SUPPORT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .then(r => r.json())
    .finally(() => clearTimeout(timer));
}

function formatCacheTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function cacheBadge(meta, refreshing) {
  if (!meta || meta.status === 'bypass') return null;
  if (meta.status === 'stale') {
    return {
      label: refreshing ? 'Refreshing' : 'Cached',
      color: T.warning,
      bg: 'rgba(245,158,11,0.10)',
      border: 'rgba(245,158,11,0.28)',
    };
  }
  if (meta.source === 'cache') {
    return {
      label: 'Cached',
      color: T.success,
      bg: 'rgba(16,185,129,0.10)',
      border: 'rgba(16,185,129,0.26)',
    };
  }
  return {
    label: 'Fresh',
    color: T.accent,
    bg: T.accentGlow,
    border: T.accentBorder,
  };
}

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
  original: { color: '#14b8a6', bg: 'rgba(20,184,166,0.10)', border: 'rgba(20,184,166,0.28)', icon: 'DNA', label: 'Original Bets' },
  adjacent: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.25)', icon: '↔', label: 'Adjacent Niche' },
  global:   { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.25)',  icon: '🌐', label: 'Global Signal' },
  trends:   { color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)',  icon: '📈', label: 'Trending in India' },
};

// ── Engine tag badges (exam_demand) ──────────────────────────────────────────

const ENGINE_TAG = {
  syllabus_topic:  { label: 'Syllabus',       color: '#6366f1', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.3)'  },
  current_affairs: { label: 'Current Affairs', color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.3)'  },
  strategy:        { label: 'Strategy',        color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
  paper_analysis:  { label: 'Paper Analysis',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  exam_update:     { label: 'Exam Update',     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)'  },
};

// Filter IDs that map to engine_tag values (used for exam_demand filter routing).
const EXAM_TAG_FILTER_IDS = new Set(['syllabus_topic', 'current_affairs', 'strategy', 'paper_analysis', 'exam_update']);

// ── Event stage config ────────────────────────────────────────────────────────

const EVENT_STAGE = {
  live_event:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.3)',  label: '🔴 LIVE EVENT'      },
  post_event:  { color: '#64748b', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', label: '⏸ POST EVENT'      },
  pre_event:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)', label: '⏳ UPCOMING EVENT'  },
  decay:       { color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.25)', label: '↘ PAST EVENT'     },
  past_event:  { color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.25)', label: '↘ PAST EVENT'    },
  revived:     { color: '#f97316', bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.25)', label: '↻ REVIVED'         },
  seasonal:    { color: '#06b6d4', bg: 'rgba(6,182,212,0.10)',   border: 'rgba(6,182,212,0.25)',  label: '◷ SEASONAL WINDOW' },
};

const FILTERS = [
  { id: 'all',        label: 'All ideas'      },
  { id: 'act_now',   label: '⚡ Act Now'      },
  { id: 'live_event',label: '🔴 Live Events'  },
  { id: 'seasonal',  label: '◷ Seasonal'      },
  { id: 'rising',    label: '↑ Rising'        },
  { id: 'evergreen', label: '◎ Evergreen'     },
  { id: 'unexplored',label: '◇ Unexplored'   },
  { id: 'saturated', label: '⬛ Saturated'    },
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

// ── Event stage badge ─────────────────────────────────────────────────────────

function EventStageBadge({ stage }) {
  const cfg = EVENT_STAGE[stage];
  if (!cfg) return null;
  return (
    <span style={{
      fontSize: '0.55rem', fontWeight: 800,
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.border}`,
      borderRadius: 4, padding: '2px 6px', letterSpacing: '0.04em', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
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

// ── Copilot handoff ───────────────────────────────────────────────────────────

function openInCopilot(idea) {
  window.dispatchEvent(new CustomEvent('copilot:open', {
    detail: {
      idea: {
        topic:        idea.topic,
        avg_views:    idea.avg_views || 0,
        format_winner: idea.format_winner || null,
        score:        idea.score || 0,
        why:          idea.why  || '',
      },
    },
  }));
}

function openForYouTrendInCopilot(item) {
  const prompt = `I want to build on this idea: "${item.title}" (riding the "${item.trend}" trend` +
    (item.mode === 'crossover' && item.trend_niche ? `, a cross-over from ${item.trend_niche}` : '') + `).` +
    (item.why ? ` ${item.why}` : '') +
    ` Give me a few different ways I could angle or open this video, tailored to my channel.`;
  window.dispatchEvent(new CustomEvent('copilot:open', { detail: { prompt } }));
}

function openCurrentEventInCopilot(ev, inBeat) {
  const sample = ev.sample_titles?.[0]?.title;
  const prompt = `"${ev.topic}" is dominating the news right now — ${ev.channel_count} channels are covering it` +
    (sample ? ` (e.g. "${sample}")` : '') + `.` +
    (inBeat
      ? ` Give me 3 different video angle ideas for how I could cover this on my channel, tailored to my niche and content style.`
      : ` It's outside my usual niche, but give me 2-3 honest ideas for whether and how I could angle this into something that fits my channel — or tell me if it genuinely doesn't fit.`);
  window.dispatchEvent(new CustomEvent('copilot:open', { detail: { prompt } }));
}

function openPodcastThemeInCopilot(theme) {
  const title = theme.angle_title || theme.theme || 'this podcast theme';
  const evidence = theme.theme && theme.angle_title ? theme.theme : '';
  const guest = theme.guest_archetype || 'a credible guest';

  window.dispatchEvent(new CustomEvent('copilot:open', {
    detail: {
      podcastTheme: {
        title,
        evidence,
        guest,
        angle: theme.episode_prompt || '',
        peer_count: theme.peer_count || 0,
        avg_views: theme.avg_views || 0,
        country: theme.content_country || null,
      },
    },
  }));
}

// ── Idea card ─────────────────────────────────────────────────────────────────

function communityHotToIdea(item) {
  const avgViews = item.avg_views || Math.round((item.total_views || 0) / Math.max(1, item.video_count || item.channel_count || 1));
  const score = Math.max(55, Math.min(96, Math.round(
    48
    + Math.min(24, Math.log10((item.total_views || 0) + 1) * 3)
    + Math.min(16, (item.channel_count || 0) * 2)
    + Math.min(8, item.recent_count || 0),
  )));
  return {
    topic: item.topic,
    avg_views: avgViews,
    score,
    why: item.why || '',
    source: 'community_hot',
  };
}

function openCommunityHotInCopilot(item) {
  openInCopilot(communityHotToIdea(item));
}

const IdeaCard = forwardRef(function IdeaCard({ idea, index, saved, onSave, highlighted, communitySize, onValidate, onDismiss }, ref) {
  const [expanded, setExpanded] = useState(false);
  const velCfg = idea.velocity ? (VEL[idea.velocity.status] || VEL.peaked) : null;

  return (
    <motion.div
      ref={ref}
      layout
      id={`idea-${idea.topic.replace(/\s+/g, '-')}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ delay: index * 0.04, duration: 0.28, ease }}
      whileHover={{ y: -4, boxShadow: '0 16px 48px rgba(0,0,0,0.55)' }}
      style={{
        ...T.glassCard,
        borderRadius: 16, padding: '20px',
        position: 'relative',
        outline: highlighted ? `1.5px solid ${T.success}60` : 'none',
        transition: 'box-shadow 0.2s, outline 0.2s',
      }}
    >
      {onDismiss && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          title="Not for me — show next"
          style={{
            position: 'absolute', top: 10, right: 12,
            background: 'transparent', border: 'none',
            color: T.muted, fontSize: '1.1rem', cursor: 'pointer',
            lineHeight: 1, padding: 2, opacity: 0.5,
          }}
        >×</button>
      )}
      {/* ── Row 1: score + topic + trend badge ── */}
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start', marginBottom: 12 }}>
        <ScoreArc score={idea.score} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 800, color: T.text, lineHeight: 1.25, letterSpacing: '-0.01em' }}>
              {idea.topic}
            </span>
            <TrendBadge status={idea.trend_status} />
            <EventStageBadge stage={idea.event_stage} />
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
            {idea.is_angle && idea.recommendation_type === 'angle_gap' && (
              <span style={{
                fontSize: '0.55rem', fontWeight: 700, color: '#34d399',
                background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)',
                borderRadius: 4, padding: '2px 6px', letterSpacing: '0.03em',
              }}>
                ⟂ Angle
              </span>
            )}
            {idea.engine_tag && ENGINE_TAG[idea.engine_tag] && (() => {
              const ec = ENGINE_TAG[idea.engine_tag];
              return (
                <span style={{
                  fontSize: '0.55rem', fontWeight: 700, color: ec.color,
                  background: ec.bg, border: `1px solid ${ec.border}`,
                  borderRadius: 4, padding: '2px 6px', letterSpacing: '0.03em',
                }}>
                  {ec.label}
                </span>
              );
            })()}
          </div>

          {/* ── Angle context breadcrumb ── */}
          {idea.is_angle && idea.anchor_topic && (
            <div style={{ fontSize: '0.6rem', color: T.muted, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: T.muted }}>on</span>
              <span style={{ color: T.accent, fontWeight: 600 }}>{idea.anchor_topic}</span>
            </div>
          )}

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
          onClick={() => onSave(idea.topic, idea)}
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

        <motion.button
          onClick={() => openInCopilot(idea)}
          whileTap={{ scale: 0.95 }}
          whileHover={{ background: 'rgba(157,111,255,0.16)' }}
          style={{
            marginLeft: 'auto',
            padding: '6px 13px', borderRadius: 8, cursor: 'pointer',
            fontSize: '0.72rem', fontWeight: 700,
            background: 'rgba(157,111,255,0.10)',
            color: T.accent,
            border: `1px solid ${T.accentBorder}`,
            transition: 'all 0.15s',
          }}
        >
          ✦ Act on this
        </motion.button>

        {onValidate && (
          <motion.button
            onClick={() => onValidate({
              title:    (idea.examples?.[0]?.title) || idea.topic,
              hook:     '',
              midVideo: '',
              ending:   '',
            })}
            whileTap={{ scale: 0.95 }}
            style={{
              padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
              fontSize: '0.72rem', fontWeight: 600,
              background: 'rgba(18,217,138,0.08)',
              color: '#12D98A',
              border: '1px solid rgba(18,217,138,0.25)',
              transition: 'all 0.15s',
            }}
          >
            Validate
          </motion.button>
        )}
      </div>
    </motion.div>
  );
});

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

const CompactIdeaCard = forwardRef(function CompactIdeaCard({ idea, src, saved, onSave, onAct, onDismiss }, ref) {
  const cfg   = SOURCE[src];
  const score = idea.score;
  const col   = score >= 80 ? T.success : score >= 60 ? T.warning : T.muted;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease }}
      whileHover={{ y: -3, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
      style={{
        ...T.glassCard,
        borderRadius: 13, padding: '14px 16px',
        border: `1px solid ${idea.act_now ? cfg.color + '45' : T.border}`,
        position: 'relative',
      }}
    >
      {onDismiss && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          title="Not for me — show next"
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${T.border}`,
            color: T.muted, fontSize: '0.65rem',
            cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, flexShrink: 0,
          }}
        >✕</button>
      )}
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

      {/* avg views — peer-derived signal for adjacent/trends. DNA original bets have no per-idea
          view data (they're unmade ideas), so we don't show the identical channel-median here. */}
      {src !== 'original' && (
        <div style={{ fontSize: '0.63rem', color: T.muted, marginBottom: 8 }}>
          avg <span style={{ color: T.text, fontWeight: 700 }}>{fmtV(idea.avg_views)}</span> views
          {idea.format_winner && (
            <span style={{ marginLeft: 8, color: cfg.color, fontWeight: 600 }}>
              · {idea.format_winner.label} wins
            </span>
          )}
        </div>
      )}

      {/* top example — peer evidence for adjacent/trends. Hidden for DNA bets: the loose
          best-match own video ("inspiration") confused users into thinking bets derive from it. */}
      {src !== 'original' && idea.examples?.[0] && (
        <div style={{
          ...T.glassSurface, borderRadius: 7, padding: '5px 9px',
          fontSize: '0.62rem', color: T.muted, marginBottom: 10,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {idea.examples[0].title}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onSave(idea.topic, idea)}
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
        <button
          onClick={() => {
            onAct?.(idea, 'acted');
            openInCopilot(idea);
          }}
          style={{
            padding: '5px 11px', borderRadius: 7, cursor: 'pointer',
            fontSize: '0.68rem', fontWeight: 700,
            background: 'rgba(157,111,255,0.10)',
            color: T.accent,
            border: `1px solid ${T.accentBorder}`,
            transition: 'all 0.15s',
          }}
        >
          ✦ Act on this
        </button>
      </div>
    </motion.div>
  );
});

// ── Source section wrapper ────────────────────────────────────────────────────

function SourceSection({ src, subtitle, ideas, saved, onSave, onAct, loading, empty }) {
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
            onAct={onAct}
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

      {!loading && data?.items?.map((item, i) => {
        return (
          <motion.div
            key={item.topic}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2, borderColor: 'rgba(245,158,11,0.32)' }}
            transition={{ duration: 0.25, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            style={{
              ...T.glassCard, borderRadius: 12,
              border: `1px solid ${T.border}`,
              padding: '14px 16px', marginBottom: 10,
              outline: 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
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
                  {item.avg_views > 0 && (
                    <span style={{ fontSize: '0.68rem', color: T.muted }}>
                      {fmtV(item.avg_views)} avg/video
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)',
                }}>
                  HOT NOW
                </span>
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    openCommunityHotInCopilot(item);
                  }}
                  whileTap={{ scale: 0.96 }}
                  whileHover={{ background: T.accentGlow }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    background: 'rgba(157,111,255,0.08)',
                    color: T.accent,
                    border: `1px solid ${T.accentBorder}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Act on this
                </motion.button>
              </div>
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

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontSize: '0.64rem', fontWeight: 800, color: '#f59e0b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                Why this is hot
              </div>
              <div style={{ fontSize: '0.73rem', color: T.muted, lineHeight: 1.55, marginBottom: 10 }}>
                {item.why || `${item.channel_count} peer channels are getting traction on this topic right now.`}
              </div>
              {(item.examples || []).length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {item.examples.slice(0, 3).map((ex, k) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.7rem', color: T.text, lineHeight: 1.35, flex: 1 }}>
                        {ex.title}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: T.success, fontWeight: 700, flexShrink: 0 }}>
                        {fmtV(ex.views)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ── Personalized Trends ("ride it now") ──────────────────────────────────────
function ForYouTrendsSection({ data, loading }) {
  const direct = data?.direct || [];
  const cross  = data?.crossover || [];
  const items  = [...direct.map(x => ({ ...x, mode: 'direct' })), ...cross.map(x => ({ ...x, mode: 'crossover' }))];
  if (!loading && items.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} style={{ marginTop: 48 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '1rem' }}>🔥</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>Trending — Ride It Now</h3>
        {loading && <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }} style={{ fontSize: '0.65rem', color: T.muted }}>loading…</motion.span>}
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '0.75rem', color: T.muted, lineHeight: 1.5 }}>
        What's trending right now that you should make — direct picks in your niche, plus cross-over angles on big cultural moments.
      </p>
      {loading && items.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map(i => <motion.div key={i} animate={{ opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }} style={{ ...T.glassCard, borderRadius: 12, height: 64, border: `1px solid ${T.border}` }} />)}
        </div>
      )}
      {items.map((it, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: i * 0.04 }}
          style={{ ...T.glassCard, borderRadius: 12, padding: '12px 14px', marginBottom: 8, border: `1px solid ${it.mode === 'crossover' ? 'rgba(56,189,248,0.25)' : 'rgba(157,111,255,0.25)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.58rem', fontWeight: 700, color: it.mode === 'crossover' ? '#38bdf8' : T.accent }}>
              {it.mode === 'crossover' ? '🔀 CROSS-OVER' : '🎯 YOUR NICHE'}
            </span>
            <span style={{ fontSize: '0.6rem', color: T.subtle }}>riding: {it.trend}{it.mode === 'crossover' && it.trend_niche ? ` · trending in ${it.trend_niche}` : ''}</span>
          </div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: T.text, lineHeight: 1.35 }}>{it.title}</div>
          {it.why && <div style={{ fontSize: '0.7rem', color: T.muted, marginTop: 4, lineHeight: 1.4 }}>{it.why}</div>}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <motion.button
              onClick={() => openForYouTrendInCopilot(it)}
              whileTap={{ scale: 0.95 }}
              whileHover={{ background: 'rgba(157,111,255,0.16)' }}
              style={{
                padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: '0.7rem', fontWeight: 700,
                background: 'rgba(157,111,255,0.10)',
                color: T.accent,
                border: `1px solid ${T.accentBorder}`,
                transition: 'all 0.15s',
              }}
            >
              ✦ Act on this
            </motion.button>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

// ── World Signals Section ─────────────────────────────────────────────────────

function CurrentEventsSection({ data, loading }) {
  const events = data?.events || [];
  if (!loading && !events.length) return null;
  const inBeat = data?.in_beat !== false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginTop: 48 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: '1rem' }}>{inBeat ? '📰' : '🔥'}</span>
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>
          {inBeat ? 'Breaking On Your Beat' : 'Dominating The News Today'}
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
        {inBeat
          ? `Current stories your fellow news channels are covering right now that you haven't made yet${data?.window_days ? ` — last ${data.window_days} days` : ''}`
          : `Outside your niche, but this is what's dominating every platform right now — worth knowing even if you don't cover it${data?.window_days ? ` — last ${data.window_days} days` : ''}`}
      </p>

      {loading && !events.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => (
            <motion.div key={i} animate={{ opacity: [0.4,0.7,0.4] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
              style={{ ...T.glassCard, borderRadius: 12, height: 72, border: `1px solid ${T.border}` }} />
          ))}
        </div>
      )}

      {events.map((ev, i) => {
        const accent = inBeat ? '#ef4444' : '#38bdf8';
        return (
        <motion.div
          key={ev.topic}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.22, delay: i * 0.04 }}
          style={{
            ...T.glassCard, borderRadius: 12,
            border: `1px solid ${accent}38`,
            padding: '12px 14px', marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: T.text }}>{ev.topic}</span>
            <span style={{ fontSize: '0.65rem', color: accent, fontWeight: 700, flexShrink: 0 }}>
              {ev.channel_count} channels covering
            </span>
          </div>
          {ev.sample_titles?.map((t, j) => (
            <div key={j} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '5px 8px', borderRadius: 7,
              background: `${accent}0d`, marginBottom: j < ev.sample_titles.length - 1 ? 4 : 0,
            }}>
              <span style={{ fontSize: '0.7rem', color: T.muted, flex: 1, lineHeight: 1.4 }}>{t.title}</span>
              {t.views != null && <span style={{ fontSize: '0.7rem', fontWeight: 700, color: T.text, flexShrink: 0 }}>{fmtV(t.views)}</span>}
            </div>
          ))}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
            <motion.button
              onClick={() => openCurrentEventInCopilot(ev, inBeat)}
              whileTap={{ scale: 0.95 }}
              whileHover={{ background: 'rgba(157,111,255,0.16)' }}
              style={{
                padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: '0.7rem', fontWeight: 700,
                background: 'rgba(157,111,255,0.10)',
                color: T.accent,
                border: `1px solid ${T.accentBorder}`,
                transition: 'all 0.15s',
              }}
            >
              ✦ Act on this
            </motion.button>
          </div>
        </motion.div>
        );
      })}
    </motion.div>
  );
}

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

export default function WhatToPost({ channel, onSearch, onValidate }) {
  const [ideas,              setIdeas]             = useState([]);
  const [meta,               setMeta]              = useState(null);
  const [cacheMeta,          setCacheMeta]         = useState(null);
  const [cacheRefreshing,    setCacheRefreshing]   = useState(false);
  const [nicheCategory,      setNicheCategory]     = useState(null);
  const [aiPending,          setAiPending]         = useState(false);
  const [noActiveNarratives, setNoActiveNarratives]= useState(false);
  const [loading,       setLoading]      = useState(false);
  const [error,         setError]        = useState(null);
  // True from the moment a channel load starts until loadSupportingData() actually kicks off
  // (up to 250ms after the main fetch resolves) — closes the gap where the individual
  // loadingAdj/loadingFor/etc. flags haven't been set true yet, which would otherwise let the
  // full-page loading gate flash open for a moment before support panels start.
  const [awaitingSupportPanels, setAwaitingSupportPanels] = useState(false);

  const [adjacent,      setAdjacent]     = useState(null);
  const [loadingAdj,    setLoadingAdj]   = useState(false);
  const [foreign,       setForeign]      = useState(null);
  const [loadingFor,    setLoadingFor]   = useState(false);
  const [trends,        setTrends]       = useState(null);
  const [loadingTrends, setLoadingTrends]= useState(false);

  // New sections
  const [originalBets,     setOriginalBets]     = useState(null);
  const [dismissedBetKeys,  setDismissedBetKeys]  = useState(new Set());
  const [visibleBetCount,   setVisibleBetCount]   = useState(8);
  const [dismissedMainKeys, setDismissedMainKeys] = useState(new Set());
  const [communityHot,     setCommunityHot]     = useState(null);
  const [loadingCommunity, setLoadingCommunity] = useState(false);
  const [worldSignals,     setWorldSignals]     = useState(null);
  const [loadingWorld,     setLoadingWorld]     = useState(false);
  const [currentEvents,    setCurrentEvents]    = useState(null);
  const [loadingEvents,    setLoadingEvents]    = useState(false);
  const [forYouTrends,     setForYouTrends]     = useState(null);
  const [loadingForYou,    setLoadingForYou]    = useState(false);

  // Podcast mode
  const [podcastIntel,     setPodcastIntel]     = useState(null);
  const [guestIntelActive, setGuestIntelActive] = useState(false);
  const [creatorMode,      setCreatorMode]      = useState(null);
  const [formatProfile,    setFormatProfile]    = useState(null);
  const [podcastPeerSrc,   setPodcastPeerSrc]   = useState(null);
  const [podcastPeerCt,    setPodcastPeerCt]    = useState(null);

  // Output engine (profile-aware framing)
  const [outputEngine,     setOutputEngine]     = useState(null);

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
  const channelLoadGen = useRef(0);
  const cachePollTimers = useRef([]);
  const sessionIdRef = useRef(null);
  const skipSupportPanels = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('e2e_skip_support') === '1';

  const clearCachePollTimers = () => {
    cachePollTimers.current.forEach(timer => clearTimeout(timer));
    cachePollTimers.current = [];
  };

  useEffect(() => {
    if (!channel) return;
    const loadGen = ++channelLoadGen.current;
    const isCurrentLoad = () => channelLoadGen.current === loadGen;
    sessionIdRef.current = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    setLoading(true);
    setAwaitingSupportPanels(true);
    setError(null);
    setIdeas([]);
    setMeta(null);
    setCacheMeta(null);
    setCacheRefreshing(false);
    clearCachePollTimers();
    setNicheCategory(null);
    setNoActiveNarratives(false);
    setAdjacent(null);
    setForeign(null);
    setTrends(null);
    setOriginalBets(null);
    setDismissedBetKeys(new Set());
    setDismissedMainKeys(new Set());
    setVisibleBetCount(8);
    setCommunityHot(null);
    setWorldSignals(null);
    setCurrentEvents(null);
    setForYouTrends(null);
    setLoadingForYou(false);
    setLoadingEvents(false);
    setLoadingAdj(false);
    setLoadingFor(false);
    setLoadingTrends(false);
    setLoadingCommunity(false);
    setLoadingWorld(false);
    setPodcastIntel(null);
    setGuestIntelActive(false);
    setCreatorMode(null);
    setFormatProfile(null);
    setPodcastPeerSrc(null);
    setPodcastPeerCt(null);
    setOutputEngine(null);

    const params = new URLSearchParams();
    if (channel.channel_id) params.set('channel_id',       channel.channel_id);
    if (channel.niche)      params.set('niche',            channel.niche);
    if (channel.subsRaw)    params.set('subscriber_count', channel.subsRaw);
    params.set('use_creator_mode_peers', 'true');

    const qs = params.toString();

    function scheduleCacheRefreshPoll(queryString, previousComputedAt, attempt) {
      if (attempt >= CACHE_REFRESH_POLL_DELAYS.length) {
        setCacheRefreshing(false);
        return;
      }
      const timer = setTimeout(() => {
        if (!isCurrentLoad()) return;
        fetch(`${SCORING_URL}/api/intel/what-to-post?${queryString}`)
          .then(r => r.json())
          .then(data => {
            if (!isCurrentLoad() || !data.ok) return;
            const nextCache = data.cache || null;
            const refreshed = nextCache?.status === 'fresh'
              && (!previousComputedAt || nextCache.computed_at !== previousComputedAt);
            if (refreshed) {
              applyWtpData(data, { allowPoll: false });
              setCacheRefreshing(false);
              return;
            }
            if (nextCache?.status === 'stale' && nextCache?.queued_refresh) {
              scheduleCacheRefreshPoll(queryString, previousComputedAt, attempt + 1);
            } else {
              setCacheMeta(nextCache);
              setCacheRefreshing(false);
            }
          })
          .catch(() => {
            if (isCurrentLoad()) scheduleCacheRefreshPoll(queryString, previousComputedAt, attempt + 1);
          });
      }, CACHE_REFRESH_POLL_DELAYS[attempt]);
      cachePollTimers.current.push(timer);
    }

    // When the server returns ai_pending:true, the DNA bets + refiner are still generating in the
    // background (cold first load). Re-fetch a few times — the next response is a fast cache hit
    // with the full AI output, which we swap in seamlessly.
    const AI_PENDING_POLL_DELAYS = [4000, 6000, 9000];
    function scheduleAiPendingPoll(queryString, attempt) {
      if (attempt >= AI_PENDING_POLL_DELAYS.length) {
        // Give up waiting after ~19s — reveal whatever DNA bets already arrived rather than
        // hiding them behind "still generating" indefinitely.
        setAiPending(false);
        return;
      }
      const timer = setTimeout(() => {
        if (!isCurrentLoad()) return;
        fetch(`${SCORING_URL}/api/intel/what-to-post?${queryString}`)
          .then(r => r.json())
          .then(data => {
            if (!isCurrentLoad() || !data.ok) return;
            applyWtpData(data, { allowPoll: false });
            if (data.ai_pending) scheduleAiPendingPoll(queryString, attempt + 1);
          })
          .catch(() => { if (isCurrentLoad()) scheduleAiPendingPoll(queryString, attempt + 1); });
      }, AI_PENDING_POLL_DELAYS[attempt]);
      cachePollTimers.current.push(timer);
    }

    function applyWtpData(data, { allowPoll = true } = {}) {
      setNicheCategory(data.niche_category || 'A');
      setAiPending(!!data.ai_pending);
      setIdeas(data.ideas || []);
      setOriginalBets(data.original_bets || null);
      setNoActiveNarratives(!!data.no_active_narratives);
      setMeta({ channel_count: data.channel_count, video_count: data.video_count, summary: data.summary || null });
      setCreatorMode(data.creator_mode || null);
      setFormatProfile(data.format_profile || null);
      setOutputEngine(data.output_engine || null);
      if (data.podcast_intel) setPodcastIntel(data.podcast_intel);
      if (data.guest_intel_active) setGuestIntelActive(true);
      if (data.podcast_intel_peer_source) setPodcastPeerSrc(data.podcast_intel_peer_source);
      if (data.podcast_intel_peer_count  != null) setPodcastPeerCt(data.podcast_intel_peer_count);

      const nextCache = data.cache || null;
      setCacheMeta(nextCache);
      const shouldRefresh = nextCache?.status === 'stale' && nextCache?.queued_refresh;
      setCacheRefreshing(!!shouldRefresh);
      if (allowPoll && shouldRefresh) {
        scheduleCacheRefreshPoll(qs, nextCache?.computed_at || null, 0);
      }
    }

    const loadSupportingData = () => {
      if (!isCurrentLoad()) return;
      setAwaitingSupportPanels(false);

      setLoadingAdj(true);
      fetchJsonWithTimeout(`${SCORING_URL}/api/intel/adjacent-ideas?${qs}`)
        .then(data => { if (isCurrentLoad() && data.ok) setAdjacent(data); })
        .catch(() => {})
        .finally(() => { if (isCurrentLoad()) setLoadingAdj(false); });

      setLoadingFor(true);
      fetchJsonWithTimeout(`${SCORING_URL}/api/intel/foreign-signal?${qs}`)
        .then(data => { if (isCurrentLoad() && data.ok) setForeign(data); })
        .catch(() => {})
        .finally(() => { if (isCurrentLoad()) setLoadingFor(false); });

      setLoadingTrends(true);
      fetchJsonWithTimeout(`${SCORING_URL}/api/intel/trending-topics?${qs}`)
        .then(data => { if (isCurrentLoad() && data.ok) setTrends(data); })
        .catch(() => {})
        .finally(() => { if (isCurrentLoad()) setLoadingTrends(false); });

      setLoadingWorld(true);
      fetchJsonWithTimeout(`${SCORING_URL}/api/intel/world-signals?${qs}&enable_world_signals=1`)
        .then(data => { if (isCurrentLoad() && data.ok) setWorldSignals(data); })
        .catch(() => {})
        .finally(() => { if (isCurrentLoad()) setLoadingWorld(false); });

      if (channel.channel_id) {
        setLoadingCommunity(true);
        fetchJsonWithTimeout(`${SCORING_URL}/api/intel/community-hot?channel_id=${encodeURIComponent(channel.channel_id)}`)
          .then(data => { if (isCurrentLoad() && data.ok) setCommunityHot(data); })
          .catch(() => {})
          .finally(() => { if (isCurrentLoad()) setLoadingCommunity(false); });

        // Live current-events feed (current-affairs / news creators) — stories breaking on their
        // beat that they haven't covered. Empty/non-applicable for non-news creators.
        setLoadingEvents(true);
        fetchJsonWithTimeout(`${SCORING_URL}/api/intel/current-events?channel_id=${encodeURIComponent(channel.channel_id)}`)
          .then(data => { if (isCurrentLoad() && data.ok) setCurrentEvents(data); })
          .catch(() => {})
          .finally(() => { if (isCurrentLoad()) setLoadingEvents(false); });

        // Personalized trends — direct (in-niche) + cross-over (angled) trend ideas. AI-backed +
        // 24h-cached, so allow a longer timeout for the cold first load.
        setLoadingForYou(true);
        fetchJsonWithTimeout(`${SCORING_URL}/api/intel/trends/for-you?channel_id=${encodeURIComponent(channel.channel_id)}`, 22000)
          .then(data => { if (isCurrentLoad() && data.ok) setForYouTrends(data); })
          .catch(() => {})
          .finally(() => { if (isCurrentLoad()) setLoadingForYou(false); });
      }
    };

    // Main community gap
    fetch(`${SCORING_URL}/api/intel/what-to-post?${qs}`)
      .then(r => r.json())
      .then(data => {
        if (!isCurrentLoad()) return;
        if (data.ok) {
          applyWtpData(data);
          if (data.ai_pending) scheduleAiPendingPoll(qs, 0);
          if (channel.channel_id && (data.ideas?.length ?? 0) > 0) {
            fetch(`${SCORING_URL}/api/intel/wtp-outcomes/impression`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                channel_id: channel.channel_id,
                session_id: sessionIdRef.current,
                ideas: data.ideas.map((i, idx) => ({
                  idea_key:      i.wtp_idea_key || i.idea_key || i.topic,
                  topic:         i.topic,
                  rec_source:    i.wtp_rec_source || i.source || i.rec_source || 'peer_signal',
                  rec_type:      i.recommendation_type || null,
                  score:         i.score ?? null,
                  confidence:    i.confidence || null,
                  rank_position: idx + 1,
                })),
              }),
            }).catch(() => {});
          }
        } else {
          setError(data.error || 'Failed to load ideas');
        }
      })
      .catch(() => { if (isCurrentLoad()) setError('Could not reach server'); })
      .finally(() => {
        if (!isCurrentLoad()) return;
        setLoading(false);
        if (!skipSupportPanels) setTimeout(loadSupportingData, 250);
        else setAwaitingSupportPanels(false);
      });

    // Community hot — what peers are getting views on right now (last 60 days)

    // World signals — async, loads in background, shows whatever arrives

    return () => {
      clearCachePollTimers();
      if (isCurrentLoad()) channelLoadGen.current++;
    };
  }, [channel?.channel_id, channel?.niche, skipSupportPanels]);

  const recordOriginalBetFeedback = (idea, action = 'saved') => {
    if (!channel?.channel_id || !idea?.topic || idea.source !== 'creator_dna_original_bet') return;
    fetch(`${SCORING_URL}/api/intel/original-bets/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_id: channel.channel_id,
        idea_key: idea.idea_key,
        topic: idea.topic,
        action,
        source_version: originalBets?.source_version || 1,
        dna_snapshot_id: originalBets?.dna_snapshot_id || null,
        metadata: {
          score: idea.score,
          confidence: idea.confidence,
          recommendation_type: idea.recommendation_type,
          source: idea.source,
        },
      }),
    }).catch(() => {});
  };

  const toggleSave = (topic, idea = null) => {
    const action = saved.has(topic) ? 'dismissed' : 'saved';
    setSaved(prev => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      localStorage.setItem('wtp_saved', JSON.stringify([...next]));
      return next;
    });
    if (idea) recordOriginalBetFeedback(idea, action);
    if (action === 'saved' && channel?.channel_id) {
      fetch(`${SCORING_URL}/api/intel/wtp-outcomes/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: channel.channel_id,
          session_id: sessionIdRef.current,
          topic,
          idea_key:   (idea?.wtp_idea_key || idea?.idea_key || idea?.topic || topic),
          rec_source: (idea?.wtp_rec_source || idea?.source || idea?.rec_source || 'peer_signal'),
          rec_type:   idea?.recommendation_type || null,
          score:      idea?.score ?? null,
        }),
      }).catch(() => {});
    }
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

  const isExamDemand     = outputEngine?.engine_id === 'exam_demand';
  const activeFilterTabs = outputEngine?.filter_tabs || FILTERS;

  const filtered = ideas.filter(idea => {
    if (EXAM_TAG_FILTER_IDS.has(filter)) return idea.engine_tag === filter;
    if (filter === 'act_now')    return idea.act_now;
    if (filter === 'live_event') return idea.event_stage === 'live_event' || idea.event_stage === 'revived';
    if (filter === 'seasonal')   return idea.topic_category === 'seasonal';
    if (filter === 'rising')     return idea.trend_status === 'rising';
    if (filter === 'evergreen')  return idea.trend_status === 'evergreen';
    if (filter === 'unexplored') return idea.saturation_level === 'low';
    if (filter === 'saturated')  return idea.saturation_level === 'high';
    return true;
  });
  const visibleIdeas = filtered.length > 0 || ideas.length === 0 ? filtered : ideas;

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

  // Guest-interview mode: driven by format_profile (authoritative) OR presence of
  // computed podcast intel (fallback for channels classified before v2 backfill).
  const isPodcastMode = formatProfile === 'guest_interview' || !!podcastIntel;
  // Podcast mode normally REPLACES the generic sections (adjacent/peer/world) with guest +
  // theme panels. But when podcast_intel is empty, that left the page blank. Gate the
  // section-swap on actual podcast CONTENT — if there's none, fall back to the generic sections.
  const hasPodcastContent = isPodcastMode && !!(podcastIntel && (
    (podcastIntel.guests?.length || 0) > 0 || (podcastIntel.themes?.length || 0) > 0
  ));
  const adjacentSources = Array.isArray(adjacent?.sources) ? adjacent.sources : [];
  const originalBetPool    = Array.isArray(originalBets?.ideas) ? originalBets.ideas : [];
  const filteredBetPool    = originalBetPool.filter(idea => !dismissedBetKeys.has(idea.idea_key || idea.topic));
  const shownBets          = filteredBetPool.slice(0, visibleBetCount);
  const hasMoreBets        = filteredBetPool.length > visibleBetCount;
  const dismissOriginalBet = (idea) => {
    setDismissedBetKeys(prev => new Set([...prev, idea.idea_key || idea.topic]));
  };

  const MAIN_DECK_SIZE = 6;
  const activeDeck       = visibleIdeas.filter(i => !dismissedMainKeys.has(i.topic)).slice(0, MAIN_DECK_SIZE);
  const dismissMainIdea  = (idea) => setDismissedMainKeys(prev => new Set([...prev, idea.topic]));
  const visibleAdjacentSources = adjacentSources.filter(source => Array.isArray(source.ideas) && source.ideas.length > 0);
  const foreignIdeas = Array.isArray(foreign?.ideas) ? foreign.ideas : [];
  const trendIdeas = Array.isArray(trends?.ideas) ? trends.ideas : [];
  const hasCommunityHot = Array.isArray(communityHot?.items) && communityHot.items.length > 0;
  const showMoreSources = !hasPodcastContent && (
    loadingAdj
    || loadingFor
    || (!isExamDemand && loadingTrends)
    || loadingCommunity
    || visibleAdjacentSources.length > 0
    || foreignIdeas.length > 0
    || (!isExamDemand && trendIdeas.length > 0)
    || hasCommunityHot
  );
  const currentCacheBadge = cacheBadge(cacheMeta, cacheRefreshing);
  const cacheTime = formatCacheTime(cacheMeta?.computed_at);

  // Every section used to reveal itself the moment ITS OWN fetch finished, so support panels
  // (adjacent/global/trends/community-hot/etc.) routinely appeared 10-15s before DNA Original
  // Bets was done generating — a page that looked half-built for most of the wait. Instead,
  // hold the whole page behind one gate and reveal everything at once.
  const pageStillLoading = !error && (
    loading
    || awaitingSupportPanels
    || aiPending
    || loadingAdj
    || loadingFor
    || loadingTrends
    || loadingWorld
    || loadingCommunity
    || loadingEvents
    || loadingForYou
  );
  // First-time channel notice: onboarding did a LIGHT ingest (recent uploads) and queued a full-catalog
  // backfill in the background, so ideas from niche peers show now and the channel's own signals sharpen
  // over the next few minutes. Shown while loading AND on the loaded screen (backfill outlives the load).
  const freshChannelNotice = (channel?.fresh_onboard || channel?.backfill_queued) ? (
    <div style={{
      ...T.glassSurface, borderRadius: 10, padding: '11px 15px', marginBottom: 16,
      border: '1px solid rgba(52,211,153,0.3)', fontSize: '0.76rem', color: T.text, lineHeight: 1.5,
    }}>
      🆕 <strong>{channel.name || 'This channel'}</strong> isn’t in our database yet — we’re analyzing its
      full history in the background. Ideas from similar channels show now; recommendations tuned to this
      channel will sharpen over the next few minutes.
    </div>
  ) : null;

  if (pageStillLoading) {
    return (
      <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
        {freshChannelNotice}
        <LoadingShowcase exclude={['post']} />
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {freshChannelNotice}

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
          {meta && isPodcastMode && podcastPeerSrc ? (
            <span style={{ fontSize: '0.73rem', color: T.muted }}>
              Podcast peers:{' '}
              <span style={{ color: T.text, fontWeight: 600 }}>{podcastPeerCt ?? meta.channel_count}</span> channels
              {' · '}
              <span style={{ color: '#a78bfa', fontWeight: 600 }}>{podcastPeerSrc}</span>
            </span>
          ) : meta && (
            <span style={{ fontSize: '0.73rem', color: T.muted }}>
              Based on{' '}
              <span style={{ color: T.text, fontWeight: 600 }}>{meta.channel_count}</span> channels
              {' · '}
              <span style={{ color: T.text, fontWeight: 600 }}>{meta.video_count}</span> videos
            </span>
          )}
          {currentCacheBadge && (
            <span
              title={cacheTime ? `Computed at ${cacheTime}` : undefined}
              style={{
                fontSize: '0.62rem',
                fontWeight: 800,
                color: currentCacheBadge.color,
                background: currentCacheBadge.bg,
                border: `1px solid ${currentCacheBadge.border}`,
                borderRadius: 6,
                padding: '2px 7px',
                lineHeight: 1.2,
              }}
            >
              {currentCacheBadge.label}
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.77rem', color: T.muted, margin: 0, lineHeight: 1.5 }}>
          {outputEngine?.question
            ? <>{outputEngine.question}</>
            : isPodcastMode
              ? <>Guests and themes your peer podcasters are covering — ranked by reach.</>
              : <>Topics your community covers that{' '}
                  <span style={{ color: T.accent, fontWeight: 600 }}>{channel.name}</span>{' '}
                  hasn't made yet — ranked by opportunity.</>
          }
        </p>
        {cacheMeta?.status === 'stale' && (
          <div style={{ marginTop: 8, fontSize: '0.68rem', color: T.warning }}>
            Showing cached ideas{cacheRefreshing ? ' while fresh results are prepared' : ''}.
          </div>
        )}
      </motion.div>

      {/* ── Exam calendar note ── */}
      {outputEngine?.calendar_note && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease }}
          style={{
            marginTop: 14, padding: '10px 16px', borderRadius: 10,
            background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
            fontSize: '0.72rem', color: '#a5b4fc', lineHeight: 1.5,
          }}
        >
          📅 {outputEngine.calendar_note}
        </motion.div>
      )}

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
        {meta?.summary && !(isPodcastMode && ideas.length === 0) && !guestIntelActive && (
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
      {!loading && ideas.length > 0 && !isPodcastMode && (
        <ActNowBanner ideas={ideas} onJump={handleJump} />
      )}

      {/* ── Filter tabs ── */}
      {(!isPodcastMode || (ideas.length > 0 && !guestIntelActive)) && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 22 }}>
        {activeFilterTabs.map((f) => {
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
      </div>}

      {/* ── Loading showcase ── */}
      {loading && (
        <LoadingShowcase exclude={['post']} />
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
      {!loading && !error && filtered.length === 0 && ideas.length > 0 && visibleIdeas.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ textAlign: 'center', padding: '60px 20px', color: T.muted, fontSize: '0.84rem' }}
        >
          No ideas match this filter.
        </motion.div>
      )}

      {/* ── Category B state ── */}
      {/* nicheCategory B now served by creative opportunity engine — ideas render in main grid below */}

      {/* ── No community data ── */}
      {!loading && !error && ideas.length === 0 && originalBetPool.length === 0 && nicheCategory !== 'B' && !(isPodcastMode && (podcastIntel?.guests?.length || podcastIntel?.themes?.length)) && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{
            ...T.glassCard, borderRadius: 14,
            textAlign: 'center', padding: '60px 20px',
          }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 14 }}>{aiPending ? '⏳' : '📡'}</div>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 6, fontSize: '0.9rem' }}>
            {aiPending ? 'Generating your ideas…' : 'No community data yet'}
          </div>
          <div style={{ fontSize: '0.76rem', color: T.muted, lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
            {aiPending ? (
              "This is a fresh channel, so we're generating ideas from its upload history for the first time — this can take up to 20 seconds. It'll appear automatically, no need to refresh."
            ) : (
              <>This channel's community needs videos in the database to generate ideas.
              Run the pipeline to ingest more channels in this niche.</>
            )}
          </div>
        </motion.div>
      )}

      {/* ── DNA bets still generating — hold the partial result back so the user doesn't mistake
           the first idea to arrive for the whole list and bounce before the rest lands. ── */}
      {!loading && !error && aiPending && originalBetPool.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <SectionHeader
            src="original"
            subtitle="Still generating the full set from this creator's upload DNA — hang tight…"
            count={null}
          />
          <LoadingShowcase variant="compact" exclude={['post']} minHeight={200} />
        </div>
      )}

      {/* ── Ideas grid — hidden for guest-intel-active channels; podcast sections replace it ── */}
      {!loading && !error && !aiPending && originalBetPool.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <SectionHeader
            src="original"
            subtitle="Unique ideas from this creator's cached upload DNA, not the peer pool"
            count={filteredBetPool.length}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            <AnimatePresence mode="popLayout">
              {shownBets.map(idea => (
                <CompactIdeaCard
                  key={idea.idea_key || idea.topic}
                  idea={idea}
                  src="original"
                  saved={saved.has(idea.topic)}
                  onSave={toggleSave}
                  onAct={recordOriginalBetFeedback}
                  onDismiss={() => dismissOriginalBet(idea)}
                />
              ))}
            </AnimatePresence>
          </div>
          {hasMoreBets && (
            <motion.button
              onClick={() => setVisibleBetCount(c => c + 5)}
              whileHover={{ y: -1, background: 'rgba(20,184,166,0.14)' }}
              whileTap={{ scale: 0.97 }}
              style={{
                marginTop: 12, padding: '8px 20px', borderRadius: 9,
                background: 'rgba(20,184,166,0.08)',
                border: '1px solid rgba(20,184,166,0.25)',
                color: '#14b8a6', fontSize: '0.75rem', fontWeight: 700,
                cursor: 'pointer', transition: 'background 0.15s',
              }}
            >
              Show {Math.min(5, filteredBetPool.length - visibleBetCount)} more ideas from your DNA
            </motion.button>
          )}
        </div>
      )}

      {!loading && visibleIdeas.length > 0 && !guestIntelActive && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
            <AnimatePresence mode="popLayout">
              {activeDeck.map((idea, i) => (
                <IdeaCard
                  key={idea.topic}
                  idea={idea}
                  index={i}
                  saved={saved.has(idea.topic)}
                  onSave={toggleSave}
                  highlighted={jumpTo === idea.topic}
                  communitySize={meta?.channel_count}
                  onValidate={onValidate}
                  onDismiss={() => dismissMainIdea(idea)}
                />
              ))}
            </AnimatePresence>
          </div>
          {activeDeck.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ textAlign: 'center', padding: '48px 20px', color: T.muted }}
            >
              <div style={{ fontSize: '1.6rem', marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: '0.84rem', marginBottom: 18 }}>
                You've reviewed all {visibleIdeas.length} idea{visibleIdeas.length !== 1 ? 's' : ''}
              </div>
              <button
                onClick={() => setDismissedMainKeys(new Set())}
                style={{
                  padding: '7px 20px', borderRadius: 8, cursor: 'pointer',
                  fontSize: '0.75rem', fontWeight: 700,
                  background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
                  color: T.accent,
                }}
              >
                Show again
              </button>
            </motion.div>
          )}
        </>
      )}

      {/* ── Podcast mode sections ── */}
      {!loading && podcastIntel && (
        <>
          {podcastIntel.guests?.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              style={{ marginTop: ideas.length > 0 ? 32 : 0 }}
            >
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 2 }}>
                🎙️ Guests to invite — peers feature them, you haven't
              </div>
              <div style={{ fontSize: '0.72rem', color: T.muted, marginBottom: 12, lineHeight: 1.45 }}>
                New guests that fit your show, with a topic to discuss.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {podcastIntel.guests.map((g, i) => (
                  <motion.div
                    key={g.name}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.18, delay: i * 0.03 }}
                    style={{
                      ...T.glassCard, borderRadius: 12, padding: '12px 16px',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: T.text, fontSize: '0.84rem' }}>{g.name}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.64rem', color: T.muted }}>
                        {g.peer_count} peer{g.peer_count !== 1 ? 's' : ''}
                      </span>
                      {g.avg_views > 0 && (
                        <span style={{ fontSize: '0.64rem', color: T.muted }}>
                          · {fmtV(g.avg_views)} avg views
                        </span>
                      )}
                    </div>
                    {g.suggested_topic && (
                      <div style={{ fontSize: '0.72rem', color: T.text, marginTop: 4, lineHeight: 1.4 }}>
                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>Discuss:</span> {g.suggested_topic}
                      </div>
                    )}
                    {g.fit_reason && (
                      <div style={{ fontSize: '0.64rem', color: T.muted, lineHeight: 1.4 }}>{g.fit_reason}</div>
                    )}
                    {!g.suggested_topic && g.admission_reason && (
                      <div style={{ fontSize: '0.58rem', color: '#a78bfa', opacity: 0.8 }}>{g.admission_reason.replace(/_/g, ' ')}</div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {podcastIntel.themes?.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              style={{ marginTop: 28 }}
            >
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12 }}>
                🔥 Themes your audience is watching
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {podcastIntel.themes.map((t, i) => (
                  <motion.div
                    key={t.theme}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, delay: i * 0.03 }}
                    style={{
                      ...T.glassSurface, borderRadius: 10, padding: '10px 16px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: T.text, fontSize: '0.82rem', lineHeight: 1.3 }}>
                        {t.angle_title || t.theme}
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {t.angle_title && t.theme && (
                          <span style={{ fontSize: '0.56rem', color: T.muted, textTransform: 'capitalize' }}>
                            evidence: {t.theme}
                          </span>
                        )}
                        {t.guest_archetype && (
                          <span style={{ fontSize: '0.56rem', color: '#a78bfa' }}>
                            guest: {t.guest_archetype}
                          </span>
                        )}
                      </div>
                      {t.episode_prompt && (
                        <div style={{ marginTop: 5, fontSize: '0.62rem', color: T.muted, lineHeight: 1.35 }}>
                          {t.episode_prompt}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '0.64rem', color: T.muted }}>{t.peer_count} peers</span>
                      {t.avg_views > 0 && <span style={{ fontSize: '0.64rem', color: T.muted }}>{fmtV(t.avg_views)} avg</span>}
                      {t.already_covered && <span style={{ fontSize: '0.58rem', color: '#f97316', fontWeight: 600 }}>covered</span>}
                      <motion.button
                        onClick={() => openPodcastThemeInCopilot(t)}
                        whileTap={{ scale: 0.96 }}
                        whileHover={{ background: T.accentGlow }}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 8,
                          cursor: 'pointer',
                          fontSize: '0.64rem',
                          fontWeight: 800,
                          background: 'rgba(157,111,255,0.08)',
                          color: T.accent,
                          border: `1px solid ${T.accentBorder}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Act on this
                      </motion.button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </>
      )}

      {!loading && visibleIdeas.length === 0 && noActiveNarratives && (
        <div style={{
          ...T.glassSurface,
          borderRadius: 12,
          padding: '36px 24px',
          textAlign: 'center',
          marginTop: 8,
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>📡</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: T.text, marginBottom: 6 }}>
            No active opportunities detected
          </div>
          <div style={{ fontSize: '0.78rem', color: T.muted }}>
            Waiting for fresh narratives.
          </div>
        </div>
      )}

      {/* ── Divider + generic modules (shown unless podcast panels have content) ── */}
      {!hasPodcastContent && (
        <>
          {showMoreSources && (
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
          {!loadingAdj && visibleAdjacentSources.map(source => (
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
            <SourceSection src="global" subtitle={`Topics trending in US/UK ${channel.niche || ''} channels — not in your community yet`} loading ideas={null} saved={saved} onSave={toggleSave} />
          )}
          {!loadingFor && foreignIdeas.length > 0 && (
            <SourceSection
              src="global"
              subtitle={`Topics trending in US/UK ${channel.niche || ''} channels — not in your community yet`}
              ideas={foreignIdeas}
              saved={saved}
              onSave={toggleSave}
            />
          )}

          {/* ── Google Trends correlation (hidden for exam_demand) ── */}
          {!isExamDemand && loadingTrends && (
            <SourceSection src="trends" subtitle="Rising Google searches in India · correlated with community performance" loading ideas={null} saved={saved} onSave={toggleSave} />
          )}
          {!isExamDemand && !loadingTrends && trendIdeas.length > 0 && (
            <SourceSection
              src="trends"
              subtitle="Rising Google searches in India where your community has proven performance"
              ideas={trendIdeas}
              saved={saved}
              onSave={toggleSave}
            />
          )}

        </>
      )}

      {/* ── Current-events feed (self-hides for non-news creators / when no events) ── */}
      <ForYouTrendsSection data={forYouTrends} loading={loadingForYou} />

      <CurrentEventsSection data={currentEvents} loading={loadingEvents} />

      {/* ── Community Hot ── */}
      {!hasPodcastContent && <CommunityHotSection data={communityHot} loading={loadingCommunity} />}

      {/* ── World Signals (hidden for exam_demand / when podcast panels have content) ── */}
      {!hasPodcastContent && !isExamDemand && <WorldSignalsSection data={worldSignals} loading={loadingWorld} />}

    </div>
  );
}
