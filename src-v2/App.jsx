import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from './tokens';

const HomeScreen         = lazy(() => import('./screens/HomeScreen'));
const CommunityDashboard = lazy(() => import('./screens/CommunityDashboard'));
const WhatToPost         = lazy(() => import('./screens/WhatToPost'));
const TrendDetection     = lazy(() => import('./screens/TrendDetection'));
const PlaceholderScreen  = lazy(() => import('./screens/PlaceholderScreen'));
const CopilotPanel       = lazy(() => import('./screens/CopilotPanel'));
const ContentHub         = lazy(() => import('./screens/ContentHub'));
const PrePublish         = lazy(() => import('./screens/PrePublish'));
const VideoRepair        = lazy(() => import('./screens/VideoRepair'));
const AdminIntelligence  = lazy(() => import('../src/components/AdminIntelligence'));

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

const IconRepair = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M3 10a7 7 0 0114 0" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17 10a7 7 0 01-14 0" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 3"/>
    <path d="M10 6v4l2.5 2.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconHub = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M3.5 6.5V4a.5.5 0 01.5-.5h4.5V6.5m0 0H3.5m5 0V14m0 0H5a1.5 1.5 0 01-1.5-1.5V6.5M8.5 14h3M8.5 14v2m3-2v2m0-2h3.5a1 1 0 001-1V8.5h-4.5M8.5 6.5h8V8.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconTrend = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M3 14l4.5-5 3.5 3 4-5.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14.5 6.5H17V9" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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

const TWINKLE_NAMES = ['twinkle-a', 'twinkle-b', 'twinkle-c'];

const STARS = (() => {
  const rand  = mkRand(8312); // positions — do not change seed
  const twRnd = mkRand(5519); // twinkle — separate so positions are unaffected
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
    const dist = bandDist(x, y);
    const near = dist < 12;
    const r    = rand();
    const size = near
      ? (r < 0.08 ? 2.4 : r < 0.25 ? 1.6 : r < 0.55 ? 1.0 : 0.5)
      : (r < 0.05 ? 1.6 : r < 0.18 ? 0.9 : 0.4);
    const op   = near ? 0.45 + rand() * 0.50 : 0.12 + rand() * 0.25;

    // Twinkle: only on bright stars
    const tw      = size >= 1.5 ? TWINKLE_NAMES[Math.floor(twRnd() * 3)] : null;
    const twDur   = 2.4 + twRnd() * 3.2;
    const twDelay = twRnd() * 5.5;

    stars.push({ x, y, size, op, near, tw, twDur, twDelay });
  }
  return stars;
})();

function StarField() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {STARS.map((s, i) => (
        <div key={i} style={{
          '--op': s.op,
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
          animation: s.tw ? `${s.tw} ${s.twDur.toFixed(1)}s ${s.twDelay.toFixed(1)}s ease-in-out infinite` : 'none',
        }} />
      ))}
    </div>
  );
}

function ScreenFallback() {
  return (
    <div style={{ minHeight: '45vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.muted, fontSize: '0.78rem' }}>
      Loading...
    </div>
  );
}

// ── Shooting stars ────────────────────────────────────────────────────────────

// angle: CSS rotate degrees — local +X = direction of travel
// travel: px to translate (short = disappears mid-page)
// negative delay = already mid-journey when cycle starts (appears mid-page)
const SHOOTING_STARS = [
  { top: '8%',  left: '-3%',   angle: 35,  dur: 3.2,  delay:  0.0,  len: 60, travel: 1800 }, // ↘ fast
  { top: '52%', left: '-4%',   angle: 22,  dur: 10.0, delay:  6.0,  len: 54, travel: 1800 }, // ↘ slow
  { top: '12%', left: '106%',  angle: 170, dur: 3.6,  delay:  2.2,  len: 62, travel: 1800 }, // ↙ fast
  { top: '60%', left: '74%',   angle: 172, dur: 5.0,  delay: -2.5,  len: 50, travel: 520  }, // ↙ appears + disappears mid
  { top: '-2%', left: '38%',   angle: 82,  dur: 7.5,  delay:  9.0,  len: 56, travel: 1800 }, // ↓ medium
];

function ShootingStars() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {SHOOTING_STARS.map((s, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: s.top,
            left: s.left,
            transform: `rotate(${s.angle}deg)`,
            transformOrigin: 'left center',
          }}
        >
          {/* Animated wrapper — carries both tail and head */}
          <div style={{
            '--travel': `${s.travel}px`,
            position: 'relative',
            display: 'inline-block',
            animation: `shoot ${s.dur}s ${s.delay}s linear infinite`,
            opacity: 0,
          }}>
            {/* Tail */}
            <div style={{
              width: s.len,
              height: 1,
              background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.18) 72%, rgba(255,255,255,0.32) 100%)',
            }} />
            {/* Head */}
            <div style={{
              position: 'absolute',
              right: -1.5,
              top: -1,
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.55)',
              boxShadow: '0 0 3px rgba(255,255,255,0.3)',
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Drifting nebula overlay ───────────────────────────────────────────────────

function NebulaLayer() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      <div className="nebula-blob" style={{
        position: 'absolute',
        width: '58%', height: '62%',
        top: '12%', left: '32%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(110,60,210,0.055) 0%, transparent 70%)',
        filter: 'blur(55px)',
      }} />
      <div className="nebula-blob" style={{
        position: 'absolute',
        width: '42%', height: '48%',
        top: '42%', left: '8%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(50,90,200,0.045) 0%, transparent 70%)',
        filter: 'blur(50px)',
        animationDelay: '-18s',
      }} />
      <div className="nebula-blob" style={{
        position: 'absolute',
        width: '35%', height: '40%',
        top: '5%', left: '60%',
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(180,120,80,0.03) 0%, transparent 70%)',
        filter: 'blur(45px)',
        animationDelay: '-32s',
      }} />
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV = [
  { id: 'channel',   label: 'My Channel',  Icon: IconChannel,   badge: null  },
  { id: 'post',      label: 'What to Post', Icon: IconPost,      badge: 'new' },
  { id: 'trends',    label: 'Trends',       Icon: IconTrend,     badge: 'new' },
  { id: 'hub',       label: 'Content Hub',  Icon: IconHub,       badge: null  },
  { id: 'publish',   label: 'Pre-Publish',  Icon: IconPublish,   badge: null  },
  { id: 'compete',   label: 'Compete',      Icon: IconCompete,   badge: null  },
  { id: 'repair',    label: 'Repair',       Icon: IconRepair,    badge: null  },
];

const PLACEHOLDER_META = {
  publish:   { icon: IconPublish,   title: 'Pre-Publish',  sub: 'Score your title and thumbnail against your peer community before you upload.' },
  compete:   { icon: IconCompete,   title: 'Compete',      sub: 'Auto-loaded competitors from your community. No manual searching.' },
};

const API = 'http://localhost:3002';

function fmtSubsNum(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Niche clusters ────────────────────────────────────────────────────────────

const NICHE_CLUSTERS = [
  { id: 'finance',       label: 'Finance',          icon: '💰', color: '#12D98A', niches: ['finance', 'business'] },
  { id: 'tech',          label: 'Technology',        icon: '📱', color: '#5B9AFF', niches: ['technology', 'tech'] },
  { id: 'education',     label: 'Education',         icon: '📚', color: '#F59E0B', niches: ['education'] },
  { id: 'gaming',        label: 'Gaming',            icon: '🎮', color: '#A78BFA', niches: ['gaming'] },
  { id: 'health',        label: 'Health & Fitness',  icon: '💪', color: '#FF6B6B', niches: ['health', 'fitness'] },
  { id: 'lifestyle',     label: 'Lifestyle',         icon: '✈️', color: '#EC4899', niches: ['lifestyle', 'travel'] },
  { id: 'news',          label: 'News & Politics',   icon: '📰', color: '#FF9D42', niches: ['news', 'politics'] },
  { id: 'entertainment', label: 'Entertainment',     icon: '🎬', color: '#9D6FFF', niches: ['entertainment'] },
];

function NicheGrid({ onSelect }) {
  return (
    <div style={{ padding: '14px 16px 18px' }}>
      <div style={{ fontSize: '0.58rem', fontWeight: 700, color: T.subtle, letterSpacing: '0.1em', marginBottom: 10, textTransform: 'uppercase' }}>
        Browse by niche
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {NICHE_CLUSTERS.map(c => (
          <motion.button
            key={c.id}
            whileHover={{ scale: 1.04, y: -1 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onSelect(c)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 5, padding: '10px 11px', borderRadius: 10, cursor: 'pointer',
              background: `${c.color}10`, border: `1px solid ${c.color}22`,
              textAlign: 'left', transition: 'all 0.12s',
            }}
          >
            <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{c.icon}</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: T.text, lineHeight: 1.25 }}>
              {c.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeNav,        setActiveNav]        = useState('channel');
  const [channel,          setChannel]          = useState(null);
  const [prepublishPrefill, setPrepublishPrefill] = useState(null);
  const [cmdOpen,     setCmdOpen]     = useState(false);
  const [cmdQuery,    setCmdQuery]    = useState('');
  const [cmdSelected, setCmdSelected] = useState(0);
  const [cmdResults,  setCmdResults]  = useState([]);
  const [cmdLoading,      setCmdLoading]      = useState(false);
  const [cmdSearchNote,   setCmdSearchNote]   = useState('');
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [cmdSession,      setCmdSession]      = useState(0);
  const cmdInputRef    = useRef(null);
  const searchTimer    = useRef(null);

  // Hidden operator route — ?admin=1 or hash #admin-1 (mirrors src/App.jsx behaviour)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || window.location.hash === '#admin-1') {
      setActiveNav('admin');
      return;
    }

    // E2E-only entry point for UI audits. This still renders the real app and
    // real WTP screen; it only bypasses the command-search selection ceremony.
    if (params.get('e2e') === '1' && params.get('channel_id')) {
      setChannel({
        channel_id:   params.get('channel_id'),
        name:         params.get('name') || params.get('channel_id'),
        subs:         fmtSubsNum(Number(params.get('subs') || 0)),
        subsRaw:      Number(params.get('subs') || 0),
        niche:        params.get('niche') || 'other',
        community:    params.get('community_id') || params.get('niche') || '—',
        community_id: params.get('community_id') || null,
        language:     params.get('language') || null,
        thumbnail:    params.get('thumbnail') || null,
        source:       'e2e',
      });
      setActiveNav(params.get('nav') || 'post');
    }
  }, []);
  const searchGenRef   = useRef(0);

  const filtered = cmdResults;

  const mapResult = (ch) => ({
    channel_id:   ch.channel_id,
    handle:       `@${(ch.name || '').replace(/\s+/g, '')}`,
    name:         ch.name || ch.channel_id,
    subs:         fmtSubsNum(ch.subs),
    subsRaw:      ch.subs || 0,
    niche:        ch.niche || 'other',
    community:    ch.community_id || ch.niche || '—',
    community_id: ch.community_id || null,
    language:     ch.language || null,
    thumbnail:    ch.thumbnail || null,
    source:       ch.source || 'corpus',
  });

  const cancelActiveSearch = ({ invalidate = true } = {}) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = null;
    if (invalidate) ++searchGenRef.current;
  };

  const fetchJsonWithDeadline = async (url, ms) => {
    let timeoutId;
    const deadline = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('search_timeout')), ms);
    });
    try {
      const r = await Promise.race([
        fetch(url, { cache: 'no-store' }),
        deadline,
      ]);
      return await r.json();
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const closeCmd = () => {
    cancelActiveSearch();
    setCmdLoading(false);
    setCmdSearchNote('');
    setCmdOpen(false);
  };

  const browseNiche = (cluster) => {
    cancelActiveSearch({ invalidate: false });
    const gen = ++searchGenRef.current;
    setSelectedCluster(cluster);
    setCmdQuery('');
    setCmdResults([]);
    setCmdLoading(true);
    const nicheParam = encodeURIComponent(cluster.niches.join(','));
    fetch(`${API}/api/channel-cache/browse?niches=${nicheParam}&limit=20`)
      .then(r => r.json())
      .then(({ results = [] }) => {
        if (searchGenRef.current !== gen) return;
        setCmdResults(results.map(mapResult));
        setCmdLoading(false);
      })
      .catch(() => { if (searchGenRef.current === gen) setCmdLoading(false); });
  };

  const runSearch = (q) => {
    setSelectedCluster(null);
    cancelActiveSearch({ invalidate: false });
    const query = q.trim();
    if (!query) {
      ++searchGenRef.current;
      setCmdResults([]);
      setCmdLoading(false);
      return;
    }
    setCmdResults([]);
    setCmdSearchNote('');
    setCmdLoading(true);
    const gen = ++searchGenRef.current;
    searchTimer.current = setTimeout(async () => {
      const enc         = encodeURIComponent(query);
      try {
        if (query.startsWith('@')) {
          try {
            const { results: ytRaw = [], live_unavailable, reason } = await fetchJsonWithDeadline(`${API}/api/channel-cache/search-youtube?q=${enc}&limit=5&_=${gen}`, 20000);
            if (searchGenRef.current !== gen) return;
            const ytMapped = ytRaw.map(mapResult);
            setCmdResults(ytMapped);
            setCmdSearchNote(live_unavailable ? (reason || 'Live YouTube search unavailable') : '');
          } catch {
            if (searchGenRef.current === gen) setCmdSearchNote('Live YouTube search unavailable');
          } finally {
            if (searchGenRef.current === gen) setCmdLoading(false);
          }
          return;
        }

        const { results = [] } = await fetchJsonWithDeadline(`${API}/api/channel-cache/search?q=${enc}&limit=8&_=${gen}`, 60000);
        const dbResults = results.map(mapResult);
        if (searchGenRef.current !== gen) return;
        setCmdResults(dbResults);
        const hasDbResults = dbResults.length > 0;
        if (hasDbResults) setCmdLoading(false);
        // YouTube fallback — only when DB results are sparse and query is substantial
        const shouldTryLiveSearch = (dbResults.length < 3 || query.startsWith('@')) && query.length >= 3;
        if (!shouldTryLiveSearch) {
          setCmdLoading(false);
          return;
        }
        if (searchGenRef.current === gen) {
          try {
            const { results: ytRaw = [], live_unavailable, reason } = await fetchJsonWithDeadline(`${API}/api/channel-cache/search-youtube?q=${enc}&limit=5&_=${gen}`, 20000);
            const ytMapped = ytRaw.map(mapResult);
            if (searchGenRef.current !== gen) return;
            if (ytMapped.length > 0 && searchGenRef.current === gen) {
              setCmdSearchNote('');
              setCmdResults(prev => {
                const knownIds = new Set(prev.map(r => r.channel_id).filter(Boolean));
                const thumbMap = {};
                for (const r of ytMapped) if (r.thumbnail) thumbMap[r.channel_id] = r.thumbnail;
                const patched = prev.map(r => (!r.thumbnail && thumbMap[r.channel_id]) ? { ...r, thumbnail: thumbMap[r.channel_id] } : r);
                const newLive = ytMapped.filter(r => r.channel_id && !knownIds.has(r.channel_id));
                return [...patched, ...newLive];
              });
            } else if (live_unavailable && searchGenRef.current === gen) {
              setCmdSearchNote(reason || 'Live YouTube search unavailable');
            }
          } catch {
            // Live YouTube results are optional; DB results are already visible.
          } finally {
            if (searchGenRef.current === gen && !hasDbResults) setCmdLoading(false);
          }
        }
      } catch (e) {
        if (searchGenRef.current === gen) {
          setCmdResults([]);
          setCmdLoading(false);
        }
      }
    }, 300);
  };

  const openCmd = () => {
    cancelActiveSearch();
    setCmdLoading(false);
    setCmdSession(s => s + 1);
    setCmdOpen(true); setCmdQuery(''); setCmdSelected(0); setCmdResults([]); setCmdSearchNote(''); setSelectedCluster(null);
  };

  useEffect(() => {
    if (!cmdOpen) return;
    runSearch(cmdQuery);
  }, [cmdOpen, cmdQuery]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => {
          if (o) { cancelActiveSearch(); setCmdLoading(false); }
          return !o;
        });
        setCmdQuery(''); setCmdSelected(0); setCmdResults([]); setCmdSearchNote('');
      }
      if (e.key === 'Escape') {
        closeCmd();
      }
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

  const selectChannel = async (s) => {
    cancelActiveSearch();
    const selected = { ...s };

    if (selected.source === 'youtube' && selected.channel_id) {
      setCmdLoading(true);
      setCmdSearchNote('Preparing channel intelligence — first-time channels can take a few minutes...');
      try {
        const resp = await fetch(`${API}/api/intel/onboard-channel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: selected.channel_id }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          selected.name         = data.name || selected.name;
          selected.subs         = data.subs ?? selected.subs;
          selected.subsRaw      = data.subs ?? selected.subsRaw ?? selected.subs;
          selected.niche        = data.niche || selected.niche;
          selected.community_id = data.community_id || selected.community_id || null;
          selected.thumbnail    = data.thumbnail || selected.thumbnail;
          selected.source       = data.already_existed ? 'ingested' : 'youtube_onboarded';
          selected.onboarded    = true;
          selected.videos_stored = data.videos_stored || 0;
          // freshly onboarded (not previously in our corpus) + a full-catalog backfill is running in the
          // background → drives the "new channel, recommendations sharpening" notice on the WTP screen.
          selected.fresh_onboard   = !data.already_existed;
          selected.backfill_queued = !!data.backfill_queued;
        } else {
          selected.onboard_error = data.error || 'Could not prepare channel intelligence';
        }
      } catch (_) {
        selected.onboard_error = 'Could not prepare channel intelligence';
      } finally {
        setCmdLoading(false);
      }
    } else {
      setCmdLoading(false);
    }

    setChannel(selected);
    setCmdOpen(false);
    setCmdQuery('');
    setCmdResults([]);
    setCmdSearchNote('');
    setActiveNav('channel');
  };

  const handleCmdInputValue = (value) => {
    setCmdQuery(value);
    setCmdSelected(0);
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg }}>

      <NebulaLayer />
      <StarField />
      <ShootingStars />

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
        <Suspense fallback={<ScreenFallback />}>
          <AnimatePresence mode="wait">
            <motion.div key={!channel ? 'home' : activeNav} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease }}>
              {activeNav === 'admin' ? (
                <AdminIntelligence />
              ) : activeNav === 'post' ? (
                <WhatToPost
                  channel={channel}
                  onSearch={openCmd}
                  onValidate={(prefill) => { setPrepublishPrefill(prefill); setActiveNav('publish'); }}
                />
              ) : activeNav === 'trends' ? (
                <TrendDetection channel={channel} />
              ) : activeNav === 'hub' ? (
                <ContentHub />
              ) : activeNav === 'publish' ? (
                <PrePublish channel={channel} prefill={prepublishPrefill} />
              ) : activeNav === 'repair' ? (
                <VideoRepair />
              ) : !channel ? (
                <HomeScreen onSearch={openCmd} />
              ) : activeNav === 'channel' ? (
                <CommunityDashboard channel={channel} onChannelUpdate={setChannel} />
              ) : (
                <PlaceholderScreen meta={PLACEHOLDER_META[activeNav]} />
              )}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </motion.div>

      {/* ── Command bar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {cmdOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={closeCmd}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 100 }}
            />

            <motion.div
              key={`cmdbar-${cmdSession}`}
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
                  onInput={e => handleCmdInputValue(e.currentTarget.value)}
                  onChange={e => handleCmdInputValue(e.currentTarget.value)}
                  placeholder="Search channels in your community..."
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: '0.92rem', fontFamily: 'inherit' }}
                />
                <kbd style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`, borderRadius: 5, padding: '2px 7px', fontSize: '0.65rem', color: T.subtle, fontFamily: 'inherit' }}>ESC</kbd>
              </div>

              <div style={{ padding: '8px 0', maxHeight: 360, overflowY: 'auto' }}>
                {cmdLoading ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>
                    {selectedCluster ? `Finding ${selectedCluster.label} channels…` : 'Searching…'}
                  </div>
                ) : !cmdQuery.trim() && !selectedCluster ? (
                  <NicheGrid onSelect={browseNiche} />
                ) : filtered.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: T.muted, fontSize: '0.83rem' }}>
                    {selectedCluster
                      ? `No channels indexed in ${selectedCluster.label} yet — try searching by name`
                      : cmdSearchNote
                        ? `No local results for "${cmdQuery}". Live YouTube search unavailable: ${cmdSearchNote}`
                        : `No results for "${cmdQuery}"`}
                  </div>
                ) : (
                  <>
                    {selectedCluster && !cmdQuery.trim() && (
                      <div style={{
                        padding: '6px 18px 8px',
                        display: 'flex', alignItems: 'center', gap: 8,
                        borderBottom: `1px solid ${T.border}`, marginBottom: 4,
                      }}>
                        <span style={{ fontSize: '0.88rem' }}>{selectedCluster.icon}</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: selectedCluster.color }}>
                          {selectedCluster.label}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: T.subtle, marginLeft: 2 }}>
                          · {filtered.length} channels
                        </span>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => { setSelectedCluster(null); setCmdResults([]); }}
                          style={{
                            background: 'rgba(255,255,255,0.06)', border: `1px solid rgba(255,255,255,0.1)`,
                            borderRadius: 5, padding: '2px 8px', cursor: 'pointer',
                            color: T.muted, fontSize: '0.65rem', fontWeight: 600,
                          }}
                        >
                          ← All niches
                        </button>
                      </div>
                    )}
                    {filtered.map((s, i) => (
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
                          <img src={s.thumbnail} alt={s.name}
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
                    ))}
                  </>
                )}
              </div>

              <div style={{ padding: '8px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: 16, fontSize: '0.65rem', color: T.subtle }}>
                <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Copilot floating panel ────────────────────────────────────────── */}
      <Suspense fallback={null}>
        <CopilotPanel channel={channel} />
      </Suspense>

    </div>
  );
}
