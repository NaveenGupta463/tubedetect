import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from './tokens';
import HomeScreen         from './screens/HomeScreen';
import CommunityDashboard from './screens/CommunityDashboard';
import PlaceholderScreen  from './screens/PlaceholderScreen';

// ── Icons (inline SVG, 20×20) ─────────────────────────────────────────────────

const IconChannel = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="7" r="3.5" stroke={color} strokeWidth="1.5"/>
    <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconPost = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 2.5l1.545 4.755H16.5l-4.045 2.94 1.545 4.755L10 12.01l-4 2.94 1.545-4.755L3.5 7.255h4.955L10 2.5z" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

const IconPublish = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4 14v1.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V14" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconCompete = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.5"/>
    <circle cx="10" cy="10" r="4"   stroke={color} strokeWidth="1.5"/>
    <circle cx="10" cy="10" r="1.5" fill={color}/>
  </svg>
);

const IconBlueprint = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <rect x="3.5" y="3.5" width="13" height="13" rx="2" stroke={color} strokeWidth="1.5"/>
    <path d="M7 7h6M7 10h6M7 13h4" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconSearch = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <circle cx="7" cy="7" r="4.5" stroke={color} strokeWidth="1.4"/>
    <path d="M10.5 10.5L13 13" stroke={color} strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV = [
  { id: 'channel',   label: 'My Channel',   Icon: IconChannel,   badge: null  },
  { id: 'post',      label: 'What to Post',  Icon: IconPost,      badge: 'new' },
  { id: 'publish',   label: 'Pre-Publish',   Icon: IconPublish,   badge: null  },
  { id: 'compete',   label: 'Compete',       Icon: IconCompete,   badge: null  },
  { id: 'blueprint', label: 'Blueprint',     Icon: IconBlueprint, badge: null  },
];

const PLACEHOLDER_META = {
  post:      { icon: IconPost,      title: 'What to Post',  sub: 'Content gap analysis + AI-powered video ideas tailored to your community.' },
  publish:   { icon: IconPublish,   title: 'Pre-Publish',   sub: 'Score your title and thumbnail against your peer community before you upload.' },
  compete:   { icon: IconCompete,   title: 'Compete',       sub: 'Auto-loaded competitors from your community. No manual searching.' },
  blueprint: { icon: IconBlueprint, title: 'Blueprint',     sub: 'Start a new channel or reverse-engineer a successful one in your niche.' },
};

// ── Command bar suggestions (mock — will query corpus later) ──────────────────

const SUGGESTIONS = [
  { handle: '@FitWithRohit',   name: 'Fit With Rohit',     subs: '420K', community: 'Hindi Fitness'  },
  { handle: '@TechBurner',     name: 'Tech Burner',         subs: '8.2M', community: 'Hindi Tech'     },
  { handle: '@WaghmaareHain',  name: 'Waghmaare Hain',     subs: '2.1M', community: 'Hindi Lifestyle' },
  { handle: '@YogaWithAnu',    name: 'Yoga With Anu',      subs: '890K', community: 'Hindi Fitness'   },
  { handle: '@CookingShooking',name: 'Cooking Shooking',   subs: '5.4M', community: 'Hindi Food'      },
];

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeNav,      setActiveNav]      = useState('channel');
  const [channel,        setChannel]        = useState(null);
  const [cmdOpen,        setCmdOpen]        = useState(false);
  const [cmdQuery,       setCmdQuery]       = useState('');
  const [cmdSelected,    setCmdSelected]    = useState(0);
  const [navTooltip,     setNavTooltip]     = useState(null);
  const cmdInputRef = useRef(null);

  const filtered = cmdQuery.trim()
    ? SUGGESTIONS.filter(s =>
        s.handle.toLowerCase().includes(cmdQuery.toLowerCase()) ||
        s.name.toLowerCase().includes(cmdQuery.toLowerCase())
      )
    : SUGGESTIONS;

  // Cmd+K listener
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
        setCmdQuery('');
        setCmdSelected(0);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when command bar opens
  useEffect(() => {
    if (cmdOpen) setTimeout(() => cmdInputRef.current?.focus(), 50);
  }, [cmdOpen]);

  // Arrow key navigation in command bar
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

  const selectChannel = (suggestion) => {
    setChannel(suggestion);
    setCmdOpen(false);
    setCmdQuery('');
    setActiveNav('channel');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: T.bg, overflow: 'hidden' }}>

      {/* ── Icon Rail ────────────────────────────────────────────────────── */}
      <div style={{
        width: 56, flexShrink: 0,
        background: T.surface,
        borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 16, paddingBottom: 16,
        gap: 2, position: 'relative', zIndex: 10,
      }}>
        {/* Logo mark */}
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 20, flexShrink: 0,
          boxShadow: '0 0 16px rgba(124,58,237,0.3)',
        }}>
          <span style={{ color: '#fff', fontWeight: 900, fontSize: '0.75rem', letterSpacing: '-0.02em' }}>TI</span>
        </div>

        {NAV.map((item) => {
          const active = activeNav === item.id;
          return (
            <div
              key={item.id}
              style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}
              onMouseEnter={() => setNavTooltip(item.id)}
              onMouseLeave={() => setNavTooltip(null)}
            >
              <motion.button
                onClick={() => setActiveNav(item.id)}
                whileTap={{ scale: 0.9 }}
                style={{
                  width: 36, height: 36, borderRadius: 9,
                  border: 'none', cursor: 'pointer',
                  background: active ? T.accentGlow : 'transparent',
                  color: active ? T.accent : T.subtle,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative', transition: 'background 0.15s, color 0.15s',
                }}
              >
                <item.Icon size={18} color="currentColor" />
                {active && (
                  <motion.div
                    layoutId="activeIndicator"
                    style={{
                      position: 'absolute', left: -10, top: '50%',
                      width: 3, height: 16, borderRadius: 2,
                      background: T.accent,
                      transform: 'translateY(-50%)',
                    }}
                    transition={spring.snappy}
                  />
                )}
                {item.badge && (
                  <div style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 6, height: 6, borderRadius: '50%',
                    background: T.accent,
                  }} />
                )}
              </motion.button>

              {/* Tooltip */}
              <AnimatePresence>
                {navTooltip === item.id && (
                  <motion.div
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -6 }}
                    transition={spring.snappy}
                    style={{
                      position: 'absolute', left: 48, top: '50%',
                      transform: 'translateY(-50%)',
                      background: '#27272A',
                      border: `1px solid ${T.border}`,
                      borderRadius: 7, padding: '5px 10px',
                      fontSize: '0.75rem', fontWeight: 600, color: T.text,
                      whiteSpace: 'nowrap', pointerEvents: 'none',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                      zIndex: 50,
                    }}
                  >
                    {item.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <div style={{
          height: 52, flexShrink: 0,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center',
          paddingLeft: 28, paddingRight: 24, gap: 12,
          background: T.surface,
        }}>
          <div style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: T.muted }}>
            {channel
              ? <span style={{ color: T.text }}>{channel.name} <span style={{ color: T.muted, fontWeight: 400 }}>· {channel.community}</span></span>
              : <span>No channel selected</span>
            }
          </div>

          {/* Cmd+K trigger */}
          <motion.button
            onClick={() => { setCmdOpen(true); setCmdQuery(''); }}
            whileHover={{ borderColor: T.borderHover }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 8,
              background: T.card, border: `1px solid ${T.border}`,
              color: T.muted, fontSize: '0.78rem', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <IconSearch size={13} color="currentColor" />
            <span>Search channel</span>
            <kbd style={{
              background: '#2A2A2E', border: `1px solid ${T.border}`,
              borderRadius: 4, padding: '1px 5px',
              fontSize: '0.65rem', color: T.subtle, fontFamily: 'inherit',
            }}>⌘K</kbd>
          </motion.button>
        </div>

        {/* Page content with transitions */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <AnimatePresence mode="wait">
            {!channel ? (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease }}
                style={{ height: '100%' }}
              >
                <HomeScreen onSearch={() => { setCmdOpen(true); setCmdQuery(''); }} />
              </motion.div>
            ) : (
              <motion.div
                key={activeNav}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease }}
                style={{ height: '100%' }}
              >
                {activeNav === 'channel'
                  ? <CommunityDashboard channel={channel} />
                  : <PlaceholderScreen meta={PLACEHOLDER_META[activeNav]} />
                }
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Command Bar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {cmdOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setCmdOpen(false)}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(6px)',
                zIndex: 100,
              }}
            />

            <motion.div
              key="cmdbar"
              initial={{ opacity: 0, scale: 0.96, y: -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -12 }}
              transition={spring.smooth}
              style={{
                position: 'fixed',
                top: '18%', left: '50%', transform: 'translateX(-50%)',
                width: 560, zIndex: 101,
                background: 'rgba(24,24,27,0.88)',
                backdropFilter: 'blur(28px) saturate(1.8)',
                border: `1px solid rgba(255,255,255,0.1)`,
                borderRadius: 16,
                boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset',
                overflow: 'hidden',
              }}
            >
              {/* Search input */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 18px',
                borderBottom: `1px solid ${T.border}`,
              }}>
                <IconSearch size={16} color={T.muted} />
                <input
                  ref={cmdInputRef}
                  value={cmdQuery}
                  onChange={e => { setCmdQuery(e.target.value); setCmdSelected(0); }}
                  placeholder="Search your channel or paste URL..."
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    color: T.text, fontSize: '0.92rem', fontFamily: 'inherit',
                  }}
                />
                <kbd style={{
                  background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`,
                  borderRadius: 5, padding: '2px 7px',
                  fontSize: '0.65rem', color: T.subtle, fontFamily: 'inherit',
                }}>ESC</kbd>
              </div>

              {/* Results */}
              <div style={{ padding: '8px 0', maxHeight: 320, overflowY: 'auto' }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>
                    No channels found
                  </div>
                ) : (
                  filtered.map((s, i) => (
                    <motion.div
                      key={s.handle}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.18, ease }}
                      onClick={() => selectChannel(s)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 18px', cursor: 'pointer',
                        background: cmdSelected === i ? 'rgba(139,92,246,0.1)' : 'transparent',
                        borderLeft: cmdSelected === i ? `2px solid ${T.accent}` : '2px solid transparent',
                        transition: 'background 0.1s, border-color 0.1s',
                      }}
                      onMouseEnter={() => setCmdSelected(i)}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: `hsl(${i * 47}, 60%, 25%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0,
                      }}>
                        {s.name.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: T.text }}>{s.name}</div>
                        <div style={{ fontSize: '0.72rem', color: T.muted }}>{s.handle} · {s.subs} subscribers</div>
                      </div>
                      <div style={{
                        fontSize: '0.67rem', fontWeight: 600,
                        color: T.accent, background: T.accentGlow,
                        border: `1px solid ${T.accentBorder}`,
                        borderRadius: 5, padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}>
                        {s.community}
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              <div style={{
                padding: '8px 18px', borderTop: `1px solid ${T.border}`,
                display: 'flex', gap: 16,
                fontSize: '0.65rem', color: T.subtle,
              }}>
                <span>↑↓ navigate</span>
                <span>↵ select</span>
                <span>esc close</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
