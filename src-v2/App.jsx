import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from './tokens';
import HomeScreen         from './screens/HomeScreen';
import CommunityDashboard from './screens/CommunityDashboard';
import WhatToPost         from './screens/WhatToPost';
import PlaceholderScreen  from './screens/PlaceholderScreen';

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconChannel = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="7" r="3.5" stroke={color} strokeWidth="1.5"/>
    <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconPost = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 2.5l1.545 4.755H16.5l-4.045 2.94 1.545 4.755L10 12.01l-4 2.94 1.545-4.755L3.5 7.255h4.955L10 2.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

const IconPublish = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 14v1.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconCompete = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.5"/>
    <circle cx="10" cy="10" r="4"   stroke={color} strokeWidth="1.5"/>
    <circle cx="10" cy="10" r="1.5" fill={color}/>
  </svg>
);

const IconBlueprint = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="3.5" y="3.5" width="13" height="13" rx="2" stroke={color} strokeWidth="1.5"/>
    <path d="M7 7h6M7 10h6M7 13h4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconSearch = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.5" stroke={color} strokeWidth="1.4"/>
    <path d="M10.5 10.5L13 13" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

// ── Milky Way star field ──────────────────────────────────────────────────────

// Seeded deterministic random — no flicker on re-render
function mkRand(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// Distance from the Milky Way band diagonal (top-right → bottom-left)
// Band line: from (95%, 10%) to (5%, 88%)
function bandDist(x, y) {
  const dx = 90, dy = -78;
  const len = Math.sqrt(dx * dx + dy * dy);
  return Math.abs(dy * x - dx * y + 95 * 78 - 88 * (-dx)) / (len * 10);
}

const STARS = (() => {
  const rand = mkRand(8312);
  const stars = [];
  for (let i = 0; i < 280; i++) {
    const inBand = rand() < 0.62;
    let x, y;
    if (inBand) {
      const t  = rand();
      const bx = 95 - t * 90;
      const by = 10 + t * 78;
      x = Math.max(0, Math.min(100, bx + (rand() - 0.5) * 22));
      y = Math.max(0, Math.min(100, by + (rand() - 0.5) * 18));
    } else {
      x = rand() * 100;
      y = rand() * 100;
    }
    const dist   = bandDist(x, y);
    const near   = dist < 12;
    const r      = rand();
    const size   = near
      ? (r < 0.08 ? 2.4 : r < 0.25 ? 1.6 : r < 0.55 ? 1.0 : 0.5)
      : (r < 0.05 ? 1.6 : r < 0.18 ? 0.9 : 0.4);
    const op     = near ? 0.45 + rand() * 0.50 : 0.12 + rand() * 0.25;
    stars.push({ x, y, size, op, near });
  }
  return stars;
})();

function StarField() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {STARS.map((s, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: '50%',
          background: `rgba(255,255,255,${s.op})`,
          boxShadow: s.size >= 1.5
            ? `0 0 ${s.size * 3}px rgba(255,255,255,${s.op * 0.7}), 0 0 ${s.size * 6}px rgba(200,210,255,${s.op * 0.3})`
            : s.size >= 1
            ? `0 0 ${s.size * 2}px rgba(255,255,255,${s.op * 0.5})`
            : 'none',
        }} />
      ))}
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV = [
  { id: 'channel',   label: 'My Channel',  Icon: IconChannel,   badge: null  },
  { id: 'post',      label: 'What to Post', Icon: IconPost,      badge: 'new' },
  { id: 'publish',   label: 'Pre-Publish',  Icon: IconPublish,   badge: null  },
  { id: 'compete',   label: 'Compete',      Icon: IconCompete,   badge: null  },
  { id: 'blueprint', label: 'Blueprint',    Icon: IconBlueprint, badge: null  },
];

const PLACEHOLDER_META = {
  publish:   { icon: IconPublish,   title: 'Pre-Publish',  sub: 'Score your title and thumbnail against your peer community before you upload.' },
  compete:   { icon: IconCompete,   title: 'Compete',      sub: 'Auto-loaded competitors from your community. No manual searching.' },
  blueprint: { icon: IconBlueprint, title: 'Blueprint',    sub: 'Start a new channel or reverse-engineer a successful one in your niche.' },
};

const API = 'http://localhost:3002';

function fmtSubsNum(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeNav,   setActiveNav]   = useState('channel');
  const [channel,     setChannel]     = useState(null);
  const [cmdOpen,     setCmdOpen]     = useState(false);
  const [cmdQuery,    setCmdQuery]    = useState('');
  const [cmdSelected, setCmdSelected] = useState(0);
  const [cmdResults,  setCmdResults]  = useState([]);
  const [cmdLoading,  setCmdLoading]  = useState(false);
  const cmdInputRef   = useRef(null);
  const searchTimer   = useRef(null);

  const filtered = cmdResults;

  // Debounced search — DB + YouTube fire in parallel; DB results show first, YouTube fills in
  const runSearch = (q) => {
    clearTimeout(searchTimer.current);
    if (!q.trim()) { setCmdResults([]); setCmdLoading(false); return; }
    setCmdLoading(true);
    searchTimer.current = setTimeout(() => {
      const mapResult = (ch) => ({
        channel_id:   ch.channel_id,
        handle:       `@${ch.name.replace(/\s+/g, '')}`,
        name:         ch.name,
        subs:         fmtSubsNum(ch.subs),
        subsRaw:      ch.subs || 0,
        niche:        ch.niche || 'other',
        community:    ch.community_id || ch.niche || '—',
        language:     ch.language || null,
        thumbnail:    ch.thumbnail || null,
        source:       ch.source || 'corpus',
      });

      const enc = encodeURIComponent(q);

      // Fire both in parallel — DB is instant, YouTube takes ~1s
      const dbPromise = fetch(`${API}/api/channel-cache/search?q=${enc}&limit=8`)
        .then(r => r.json()).then(({ results = [] }) => results.map(mapResult)).catch(() => []);

      const ytPromise = fetch(`${API}/api/channel-cache/search-youtube?q=${enc}&limit=5`)
        .then(r => r.json()).then(({ results = [] }) => results.map(mapResult)).catch(() => []);

      // Show DB results as soon as they arrive
      dbPromise.then(dbResults => {
        setCmdResults(dbResults);
        setCmdLoading(false);
      });

      // When YouTube arrives, merge — add new channels + fill in missing thumbnails
      Promise.all([dbPromise, ytPromise]).then(([dbResults, ytResults]) => {
        const knownIds = new Set(dbResults.map(r => r.channel_id));
        const newLive  = ytResults.filter(r => !knownIds.has(r.channel_id));
        if (newLive.length) {
          setCmdResults(prev => {
            // Also update thumbnails on existing results that were missing one
            const thumbMap = {};
            for (const r of ytResults) if (r.thumbnail) thumbMap[r.channel_id] = r.thumbnail;
            const patched = prev.map(r => (!r.thumbnail && thumbMap[r.channel_id])
              ? { ...r, thumbnail: thumbMap[r.channel_id] } : r);
            return [...patched, ...newLive];
          });
        }
      });
    }, 220);
  };

  const openCmd = () => { setCmdOpen(true); setCmdQuery(''); setCmdSelected(0); setCmdResults([]); };

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(o => !o); setCmdQuery(''); setCmdSelected(0); }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (cmdOpen) setTimeout(() => cmdInputRef.current?.focus(), 50);
  }, [cmdOpen]);

  useEffect(() => {
    if (!cmdOpen) return;
    const handler = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCmdSelected(s => Math.min(s + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setCmdSelected(s => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && filtered[cmdSelected]) selectChannel(filtered[cmdSelected]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cmdOpen, cmdSelected, filtered]);

  const selectChannel = (s) => {
    setChannel(s);
    setCmdOpen(false);
    setCmdQuery('');
    setCmdResults([]);
    setActiveNav('channel');
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>

      <StarField />

      {/* ── Floating top bar ─────────────────────────────────────────────── */}
      <motion.div
        animate={{
          height:       channel ? 48  : 76,
          top:          channel ? 10  : 20,
          borderRadius: channel ? 14  : 18,
        }}
        transition={spring.smooth}
        style={{
          position: 'fixed', left: 14, right: 14, zIndex: 20,
          display: 'flex', alignItems: 'center',
          padding: '0 14px', gap: 4,
          background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, transparent 50%), rgba(12,12,14,0.85)',
          backdropFilter: 'blur(0.5px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(0.5px) saturate(1.3)',
          border: '1px solid rgba(255,255,255,0.22)',
          boxShadow: [
            '0 0 30px rgba(255,255,255,0.10)',
            '0 0 80px rgba(255,255,255,0.05)',
            '0 8px 32px rgba(0,0,0,0.9)',
            'inset 0 1.5px 0 rgba(255,255,255,0.55)',
            'inset 0 -1px 0 rgba(255,255,255,0.06)',
            'inset 1px 0 0 rgba(255,255,255,0.14)',
            'inset -1px 0 0 rgba(255,255,255,0.06)',
          ].join(', '),
        }}
      >

        {/* Logo — click to go home */}
        <motion.div
          onClick={() => { setChannel(null); setActiveNav('channel'); }}
          whileHover={{ scale: 1.08, boxShadow: '0 0 20px rgba(124,58,237,0.55)' }}
          whileTap={{ scale: 0.93 }}
          style={{
            width: 28, height: 28, borderRadius: 7, flexShrink: 0,
            background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(124,58,237,0.35)',
            marginRight: 12, cursor: 'pointer',
          }}
        >
          <span style={{ color: '#fff', fontWeight: 900, fontSize: '0.65rem', letterSpacing: '-0.02em' }}>TI</span>
        </motion.div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: T.border, marginRight: 8, flexShrink: 0 }} />

        {/* Nav pills */}
        {NAV.map((item) => {
          const active = channel && activeNav === item.id;
          return (
            <div key={item.id} style={{ position: 'relative', flexShrink: 0 }}>
              {active && (
                <motion.div
                  layoutId="navPill"
                  transition={spring.snappy}
                  style={{
                    position: 'absolute', inset: 0,
                    background: T.accentGlow,
                    border: `1px solid ${T.accentBorder}`,
                    borderRadius: 8,
                  }}
                />
              )}
              <motion.button
                onClick={() => setActiveNav(item.id)}
                whileHover={{ scale: 1.07, y: -1 }}
                whileTap={{ scale: 0.95 }}
                style={{
                  position: 'relative', zIndex: 1,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 11px', borderRadius: 8,
                  border: 'none', cursor: 'pointer',
                  background: 'transparent',
                  color: active ? T.accent : 'rgba(255,255,255,0.82)',
                  fontSize: '0.78rem', fontWeight: active ? 700 : 500,
                  whiteSpace: 'nowrap', letterSpacing: '-0.01em',
                  transition: 'color 0.15s',
                }}
              >
                <item.Icon size={14} color="currentColor" />
                {item.label}
                {item.badge && (
                  <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                    style={{ width: 5, height: 5, borderRadius: '50%', background: T.accent }}
                  />
                )}
              </motion.button>
            </div>
          );
        })}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Channel chip */}
        <AnimatePresence>
          {channel && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={spring.snappy}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px 4px 6px',
                background: T.card, border: `1px solid ${T.border}`,
                borderRadius: 8, marginRight: 8, cursor: 'pointer',
              }}
              onClick={openCmd}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                background: 'linear-gradient(135deg, #7C3AED33, #4F46E533)',
                border: `1px solid ${T.accentBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', fontWeight: 800, color: T.accent,
              }}>
                {channel.name.charAt(0)}
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: T.text }}>{channel.name}</span>
              <span style={{ fontSize: '0.7rem', color: T.muted }}>·</span>
              <span style={{ fontSize: '0.72rem', color: T.accent, fontWeight: 500 }}>{channel.niche || channel.community}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cmd+K button */}
        <motion.button
          onClick={openCmd}
          whileHover={{ borderColor: T.borderHover }}
          whileTap={{ scale: 0.97 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '5px 11px', borderRadius: 8,
            background: T.card, border: `1px solid ${T.border}`,
            color: T.muted, fontSize: '0.75rem', cursor: 'pointer',
            transition: 'border-color 0.15s', flexShrink: 0,
          }}
        >
          <IconSearch size={13} color="currentColor" />
          <span>Search</span>
          <kbd style={{
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`,
            borderRadius: 4, padding: '1px 5px',
            fontSize: '0.62rem', color: T.subtle, fontFamily: 'inherit',
          }}>⌘K</kbd>
        </motion.button>
      </motion.div>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <motion.div
        animate={{ paddingTop: channel ? 70 : 114 }}
        transition={spring.smooth}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={!channel ? 'home' : activeNav} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
            {activeNav === 'post' ? (
              <WhatToPost channel={channel} onSearch={openCmd} />
            ) : !channel ? (
              <HomeScreen onSearch={openCmd} />
            ) : activeNav === 'channel' ? (
              <CommunityDashboard channel={channel} onChannelUpdate={setChannel} />
            ) : (
              <PlaceholderScreen meta={PLACEHOLDER_META[activeNav]} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* ── Command bar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {cmdOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setCmdOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 100 }}
            />

            <motion.div
              key="cmdbar"
              initial={{ opacity: 0, scale: 0.96, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -12 }}
              transition={spring.smooth}
              style={{
                position: 'fixed', top: '16%', left: '50%', transform: 'translateX(-50%)',
                width: 560, zIndex: 101,
                background: 'rgba(24,24,27,0.9)',
                backdropFilter: 'blur(28px) saturate(1.8)',
                border: `1px solid rgba(255,255,255,0.1)`,
                borderRadius: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${T.border}` }}>
                <IconSearch size={16} color={T.muted} />
                <input
                  ref={cmdInputRef}
                  value={cmdQuery}
                  onChange={e => { const v = e.target.value; setCmdQuery(v); setCmdSelected(0); runSearch(v); }}
                  placeholder="Search channels in your community..."
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: '0.92rem', fontFamily: 'inherit' }}
                />
                <kbd style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`, borderRadius: 5, padding: '2px 7px', fontSize: '0.65rem', color: T.subtle, fontFamily: 'inherit' }}>ESC</kbd>
              </div>

              <div style={{ padding: '8px 0', maxHeight: 320, overflowY: 'auto' }}>
                {cmdLoading ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>Searching…</div>
                ) : !cmdQuery.trim() ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>Search any YouTube channel — known or new</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>No results for "{cmdQuery}"</div>
                ) : (
                  filtered.map((s, i) => (
                    <motion.div
                      key={s.channel_id || s.name + i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.15, ease }}
                      onClick={() => selectChannel(s)}
                      onMouseEnter={() => setCmdSelected(i)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 18px', cursor: 'pointer',
                        background: cmdSelected === i ? 'rgba(139,92,246,0.1)' : 'transparent',
                        borderLeft: cmdSelected === i ? `2px solid ${T.accent}` : '2px solid transparent',
                        transition: 'background 0.1s, border-color 0.1s',
                      }}
                    >
                      {s.thumbnail ? (
                        <img
                          src={s.thumbnail}
                          alt={s.name}
                          style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        />
                      ) : null}
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: `hsl(${i * 47}, 55%, 22%)`, display: s.thumbnail ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                        {s.name.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: T.text }}>{s.name}</div>
                        <div style={{ fontSize: '0.72rem', color: T.muted }}>{s.subs} subscribers · {s.niche || 'detecting…'}</div>
                      </div>
                      {s.source === 'youtube' ? (
                        <div style={{ fontSize: '0.63rem', fontWeight: 600, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                          new
                        </div>
                      ) : s.community && s.community !== '—' ? (
                        <div style={{ fontSize: '0.67rem', fontWeight: 600, color: T.accent, background: T.accentGlow, border: `1px solid ${T.accentBorder}`, borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                          {s.community}
                        </div>
                      ) : null}
                    </motion.div>
                  ))
                )}
              </div>

              <div style={{ padding: '8px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 16, fontSize: '0.65rem', color: T.subtle }}>
                <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
