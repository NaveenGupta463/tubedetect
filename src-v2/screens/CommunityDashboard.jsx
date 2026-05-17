import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';
import { useCountUp } from '../hooks/useCountUp';

const API = 'http://localhost:3002';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSubsApprox(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function parseSubs(s) {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  const n = parseFloat(s);
  if (s.toUpperCase().endsWith('M')) return Math.round(n * 1_000_000);
  if (s.toUpperCase().endsWith('K')) return Math.round(n * 1_000);
  return parseInt(s, 10) || 0;
}

function fmtSubs(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtViews(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function capitalize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Rank ring ─────────────────────────────────────────────────────────────────

function RankRing({ rank, total }) {
  const percentile = total > 0 ? ((total - rank) / total) * 100 : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const filled = (percentile / 100) * C;

  const rankDisplay = useCountUp(rank,  900, 200);
  const pctDisplay  = useCountUp(Math.round(percentile), 1000, 300);

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
          top {pctDisplay}%
        </div>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = T.accent, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease }}
      whileHover={{ y: -4 }}
      style={{
        ...T.glassCard, borderRadius: 14, padding: '18px 20px',
        flex: 1, minWidth: 0,
        transition: 'box-shadow 0.2s',
        cursor: 'default',
      }}
    >
      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.55rem', fontWeight: 800, color, lineHeight: 1.1, marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: T.muted, lineHeight: 1.4 }}>{sub}</div>}
    </motion.div>
  );
}

// ── Bar ───────────────────────────────────────────────────────────────────────

function Bar({ pct, color, delay = 0 }) {
  return (
    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay }}
        style={{ height: '100%', background: color, borderRadius: 2 }}
      />
    </div>
  );
}

// ── Channel bar (leaderboard) ─────────────────────────────────────────────────

function ChannelBar({ name, subs, avgViews, isYou, maxVal, index, niche }) {
  const pct = maxVal > 0 ? (subs / maxVal) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 * index + 0.5, duration: 0.28, ease }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 0',
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
        background: isYou ? T.accentGlow : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isYou ? T.accentBorder : 'rgba(255,255,255,0.1)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.62rem', fontWeight: 700,
        color: isYou ? T.accent : T.muted,
      }}>
        {name.charAt(0)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 600, color: isYou ? T.accent : T.text, lineHeight: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {niche && <span style={{ fontSize: '0.52rem', fontWeight: 600, color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px', flexShrink: 0, textTransform: 'capitalize' }}>{niche}</span>}
          {isYou && <span style={{ fontSize: '0.56rem', fontWeight: 700, color: T.accent, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>you</span>}
        </div>
        <Bar pct={pct} color={isYou ? T.accent : 'rgba(255,255,255,0.25)'} delay={0.08 * index + 0.5} />
      </div>

      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: isYou ? T.accent : T.text }}>{fmtSubs(subs)}</div>
        {avgViews > 0 && <div style={{ fontSize: '0.6rem', color: T.muted }}>{fmtViews(avgViews)} avg</div>}
      </div>
    </motion.div>
  );
}

// ── Insight tile ──────────────────────────────────────────────────────────────

function InsightTile({ tag, color, text, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.07 * index + 0.6, duration: 0.28, ease }}
      whileHover={{ y: -2 }}
      style={{
        ...T.glassSurface, borderRadius: 11, padding: '13px 15px',
        transition: 'box-shadow 0.2s',
      }}
    >
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        marginBottom: 8,
        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em',
        color, background: `${color}18`, border: `1px solid ${color}30`,
        borderRadius: 5, padding: '2px 7px',
      }}>
        {tag}
      </div>
      <p style={{ fontSize: '0.76rem', color: T.muted, lineHeight: 1.55, margin: 0 }}>{text}</p>
    </motion.div>
  );
}

// ── Study card ────────────────────────────────────────────────────────────────

function StudyCard({ name, subs, why, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.07 * index + 0.8, duration: 0.28, ease }}
      whileHover={{ y: -3 }}
      style={{
        ...T.glassSurface, borderRadius: 12, padding: '14px 16px',
        flex: '1 1 200px',
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: 'rgba(255,255,255,0.05)', border: `1px solid rgba(255,255,255,0.1)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.68rem', fontWeight: 700, color: T.muted,
        }}>
          {name.charAt(0)}
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: T.text }}>{name}</div>
          <div style={{ fontSize: '0.65rem', color: T.muted }}>{fmtSubs(subs)} subs</div>
        </div>
      </div>
      <p style={{ fontSize: '0.73rem', color: T.muted, lineHeight: 1.5, margin: 0 }}>{why}</p>
    </motion.div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ w = '100%', h = 16, r = 6 }) {
  return (
    <motion.div
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      style={{ width: w, height: h, borderRadius: r, background: 'rgba(255,255,255,0.08)' }}
    />
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
        minHeight: 'calc(100vh - 70px)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16, color: T.muted,
      }}
    >
      <div style={{
        width: 60, height: 60, borderRadius: 16,
        ...T.glassCard,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.6rem',
      }}>
        📡
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: T.text, marginBottom: 6 }}>No channel selected</div>
        <div style={{ fontSize: '0.82rem', color: T.muted }}>Press <kbd style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`, borderRadius: 4, padding: '1px 6px', fontFamily: 'inherit', fontSize: '0.75rem', color: T.subtle }}>⌘K</kbd> to search for a channel</div>
      </div>
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommunityDashboard({ channel, onChannelUpdate }) {
  const [community,   setCommunity]   = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [hooks,       setHooks]       = useState([]);
  const [patterns,    setPatterns]    = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [liveChannel, setLiveChannel] = useState(null);

  useEffect(() => {
    if (!channel) return;
    setLoading(true);
    setError(null);
    setCommunity(null);
    setCompetitors([]);
    setHooks([]);
    setPatterns([]);
    setLiveChannel(null);

    const run = async () => {
      let enriched = channel;

      // For YouTube-only channels, run the onboarding pipeline first.
      // This detects niche (OpenAI if needed), assigns community, and queues video ingest.
      if (channel.source === 'youtube') {
        try {
          const r    = await fetch(`${API}/api/intel/onboard-channel`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ channel_id: channel.channel_id }),
          });
          const data = await r.json();
          if (data.niche) {
            enriched = {
              ...channel,
              niche:        data.niche,
              community_id: data.community_id,
              subsRaw:      data.subs || channel.subsRaw,
              subs:         data.subs ? fmtSubsApprox(data.subs) : channel.subs,
              thumbnail:    data.thumbnail || channel.thumbnail || null,
              source:       'ingested',
            };
            setLiveChannel(enriched);
            onChannelUpdate?.(enriched);
          }
        } catch (e) {
          console.warn('[onboard]', e.message);
        }
      }

      const subs  = enriched.subsRaw || parseSubs(enriched.subs);
      const niche = enriched.niche || 'other';

      const compUrl = `${API}/api/intel/competitor/channels?niche=${niche}&limit=12&channel_id=${encodeURIComponent(enriched.channel_id)}`;

      const [comps, comm, hks, pats] = await Promise.all([
        fetch(compUrl).then(r => r.json()),
        fetch(`${API}/api/intel/community/infer?niche=${niche}&subscribers=${subs}`).then(r => r.json()),
        fetch(`${API}/api/intelligence/hooks/top?niche=${niche}&limit=6`).then(r => r.json()),
        fetch(`${API}/api/intel/content/patterns?niche=${niche}`).then(r => r.json()),
      ]);

      setCommunity(comm.ok ? comm : null);
      setCompetitors(comps.channels || []);
      setHooks(hks.rows || []);
      setPatterns(pats.patterns || []);
    };

    run().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [channel?.handle]);

  if (!channel) return <EmptyState />;

  // liveChannel is set after onboarding completes for YouTube-only channels
  const activeChannel = liveChannel || channel;
  const subs          = activeChannel.subsRaw || parseSubs(activeChannel.subs);
  const peerCount     = community?.peer_count  ?? 0;
  const avgSubs       = community?.avg_subscribers ?? 0;
  const communityLabel = community?.community_id ?? activeChannel.community ?? '—';

  // Leaderboard: merge competitors + the user's channel, sorted by subs desc
  const leaderboard = (() => {
    const peers = competitors.map(c => ({
      name: c.channel_name,
      subs: c.channel_subscribers || 0,
      avgViews: c.avg_views || 0,
      isYou: false,
      niche: c.niche || null,
    }));

    const youEntry = { name: activeChannel.name, subs, avgViews: 0, isYou: true, niche: activeChannel.niche || null };

    const merged = [...peers, youEntry]
      .sort((a, b) => b.subs - a.subs)
      .slice(0, 10);

    return merged;
  })();

  const userRank   = leaderboard.findIndex(c => c.isYou) + 1;
  const maxVal     = leaderboard[0]?.subs || 1;

  // Study channels: 3 channels just above user's subscriber count
  const studyList  = leaderboard
    .filter(c => !c.isYou && c.subs > subs)
    .slice(-3)
    .reverse();

  // Insights from hooks data
  const hookInsights = hooks.slice(0, 2).map((h, i) => {
    const next = hooks[i + 1];
    const mult = next && next.avg_views > 0
      ? (h.avg_views / next.avg_views).toFixed(1)
      : null;
    return {
      tag:   `Hook — ${capitalize(h.hook_type)}`,
      color: i === 0 ? T.accent : T.success,
      text:  mult
        ? `${capitalize(h.hook_type)} hooks average ${fmtViews(Math.round(h.avg_views))} views — ${mult}× more than ${capitalize(next.hook_type)} hooks in your niche.`
        : `${capitalize(h.hook_type)} hooks average ${fmtViews(Math.round(h.avg_views))} views in your niche. Top hook pattern across all measured videos.`,
    };
  });

  const patternInsight = patterns[0] ? {
    tag:   `Format — ${capitalize(patterns[0].content_archetype || patterns[0].format_type)}`,
    color: T.warning,
    text:  `${capitalize(patterns[0].content_archetype || 'Top')} format averages ${fmtViews(patterns[0].avg_views)} views across ${patterns[0].channel_count} channels in your community.`,
  } : null;

  const insights = [...hookInsights, ...(patternInsight ? [patternInsight] : [])];

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1160, margin: '0 auto' }}>

      {/* ── Hero row ────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        style={{
          ...T.glassCard,
          display: 'flex', alignItems: 'center', gap: 24,
          borderRadius: 18, padding: '22px 26px', marginBottom: 20,
        }}
      >
        {/* Avatar */}
        {activeChannel.thumbnail ? (
          <img
            src={activeChannel.thumbnail}
            alt={activeChannel.name}
            style={{ width: 54, height: 54, borderRadius: 14, objectFit: 'cover', flexShrink: 0, border: `1px solid ${T.accentBorder}` }}
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div style={{
          width: 54, height: 54, borderRadius: 14, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(79,70,229,0.15))',
          border: `1px solid ${T.accentBorder}`,
          display: activeChannel.thumbnail ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.25rem', fontWeight: 800, color: T.accent,
        }}>
          {activeChannel.name?.charAt(0)}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: T.text, marginBottom: 6 }}>
            {channel.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {loading ? (
              <Skeleton w={120} h={20} r={5} />
            ) : (
              <>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700, color: T.accent,
                  background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
                  borderRadius: 5, padding: '2px 9px',
                }}>
                  Community {communityLabel}
                </span>
                <span style={{ fontSize: '0.72rem', color: T.muted }}>
                  {channel.subs} subscribers
                </span>
                {peerCount > 0 && (
                  <span style={{ fontSize: '0.72rem', color: T.muted }}>
                    · {peerCount.toLocaleString()} channels in peer group
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {!loading && leaderboard.length > 0 && (
          <RankRing rank={userRank} total={leaderboard.length + (peerCount > leaderboard.length ? peerCount - leaderboard.length : 0)} />
        )}
        {loading && (
          <div style={{ width: 140, height: 140, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Skeleton w={140} h={140} r={70} />
          </div>
        )}
      </motion.div>

      {/* ── Stat row ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {loading ? (
          [0,1,2,3].map(i => (
            <div key={i} style={{ flex: 1, minWidth: 160 }}>
              <Skeleton h={90} r={14} />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="Your Subscribers"
              value={channel.subs}
              sub={avgSubs > 0 ? `Community avg: ${fmtSubs(avgSubs)}` : `Rank #${userRank} in leaderboard`}
              color={subs >= avgSubs ? T.success : T.text}
              delay={0.05}
            />
            <StatCard
              label="Peer Channels"
              value={peerCount > 0 ? peerCount.toLocaleString() : competitors.length.toString()}
              sub="channels in your community"
              color={T.accent}
              delay={0.1}
            />
            {hooks[0] && (
              <StatCard
                label="Top Hook Type"
                value={capitalize(hooks[0].hook_type)}
                sub={`${fmtViews(Math.round(hooks[0].avg_views))} avg views`}
                color={T.warning}
                delay={0.15}
              />
            )}
            {patterns[0] && (
              <StatCard
                label="Best Format"
                value={capitalize(patterns[0].content_archetype || patterns[0].format_type || '—')}
                sub={`${fmtViews(patterns[0].avg_views)} avg views · ${patterns[0].channel_count} channels`}
                color={T.success}
                delay={0.2}
              />
            )}
          </>
        )}
      </div>

      {/* ── Leaderboard + insights ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 18, marginBottom: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Community leaderboard */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3, ease }}
          style={{
            ...T.glassCard,
            flex: '0 0 280px', borderRadius: 14, padding: '18px 20px',
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Audience Competition
            </div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', marginTop: 3, fontStyle: 'italic' }}>
              Same viewers — different content
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0,1,2,3,4].map(i => <Skeleton key={i} h={38} r={6} />)}
            </div>
          ) : leaderboard.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: T.muted, padding: '20px 0', textAlign: 'center' }}>No community data yet</div>
          ) : (
            leaderboard.map((ch, i) => (
              <ChannelBar key={ch.name + i} {...ch} maxVal={maxVal} index={i} />
            ))
          )}
        </motion.div>

        {/* What's working */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            What's Working in Your Community
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0,1,2].map(i => <Skeleton key={i} h={72} r={11} />)}
            </div>
          ) : insights.length === 0 ? (
            <div style={{
              ...T.glassSurface, borderRadius: 11, padding: '20px',
              fontSize: '0.8rem', color: T.muted, textAlign: 'center',
            }}>
              No hook/pattern data for this niche yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {insights.map((ins, i) => (
                <InsightTile key={ins.tag} {...ins} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Channels to study ───────────────────────────────────────────────── */}
      {!loading && studyList.length > 0 && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Channels Just Ahead of You — Study These
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {studyList.map((ch, i) => (
              <StudyCard
                key={ch.name + i}
                name={ch.name}
                subs={ch.subs}
                why={
                  ch.avgViews > 0
                    ? `Averaging ${fmtViews(ch.avgViews)} views per video in your niche. Study their title formula and upload cadence.`
                    : 'A channel just ahead of yours in this community. Study their content format and hook style.'
                }
                index={i}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          ...T.glassSurface, borderRadius: 12, padding: '14px 18px',
          marginTop: 16, fontSize: '0.8rem', color: T.danger,
          border: `1px solid ${T.danger}30`,
        }}>
          Failed to load community data: {error}
        </div>
      )}

    </div>
  );
}
