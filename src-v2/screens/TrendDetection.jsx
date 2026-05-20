import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

const SCORING_URL = 'http://localhost:3002';

const NICHES = [
  'all', 'geopolitics', 'defence', 'politics', 'selfimprovement', 'education',
  'technology', 'finance', 'business', 'entertainment', 'gaming', 'lifestyle',
  'health', 'fitness', 'food', 'travel', 'music', 'comedy', 'news', 'science',
  'philosophy', 'sports',
];

function growthRate(thisWeek, lastWeek) {
  if (!lastWeek && !thisWeek) return 0;
  if (!lastWeek) return 100;
  return Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
}

function growthLabel(rate) {
  if (rate >= 100) return { label: `+${rate}% new`, color: T.success };
  if (rate >= 30)  return { label: `+${rate}%`,     color: T.success };
  if (rate >= 0)   return { label: `+${rate}%`,     color: T.accent  };
  return               { label: `${rate}%`,         color: T.muted   };
}

function NicheTag({ niche, count }) {
  return (
    <span style={{
      fontSize: '0.62rem', padding: '2px 7px', borderRadius: 20,
      background: 'rgba(157,111,255,0.12)', border: '1px solid rgba(157,111,255,0.25)',
      color: T.accent, whiteSpace: 'nowrap',
    }}>
      {niche} · {count}
    </span>
  );
}

function TopicCard({ topic, index }) {
  const [open, setOpen] = useState(false);
  const rate    = growthRate(topic.added_this_week, topic.added_last_week);
  const growth  = growthLabel(rate);
  const isNew   = topic.added_last_week === 0 && topic.added_this_week > 0;
  const isCross = topic.niches && topic.niches.length > 1;

  const badge = isNew
    ? { label: 'NEW THIS WEEK', color: T.success, bg: T.successDim }
    : isCross
    ? { label: 'CROSS-NICHE',   color: T.accent,  bg: T.accentGlow }
    : topic.added_this_week > 3
    ? { label: 'FAST MOVING',   color: T.warning, bg: T.warningDim }
    : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25, ease }}
      onClick={() => setOpen(o => !o)}
      style={{
        ...T.glassCard,
        borderRadius: 14, padding: '14px 16px',
        cursor: 'pointer', userSelect: 'none',
        borderColor: open ? 'rgba(157,111,255,0.4)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* rank */}
        <span style={{ fontSize: '0.65rem', color: T.subtle, width: 22, flexShrink: 0, textAlign: 'right' }}>
          #{index + 1}
        </span>

        {/* topic name */}
        <span style={{ flex: 1, fontSize: '0.9rem', color: T.text, fontWeight: 500, textTransform: 'capitalize' }}>
          {topic.topic}
        </span>

        {/* badge */}
        {badge && (
          <span style={{
            fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em',
            padding: '2px 7px', borderRadius: 20,
            color: badge.color, background: badge.bg,
            border: `1px solid ${badge.color}40`,
          }}>
            {badge.label}
          </span>
        )}

        {/* growth */}
        <span style={{ fontSize: '0.75rem', color: growth.color, fontWeight: 600, minWidth: 48, textAlign: 'right' }}>
          {growth.label}
        </span>

        {/* stats */}
        <span style={{ fontSize: '0.68rem', color: T.muted, minWidth: 80, textAlign: 'right' }}>
          {topic.total_channels} channels
        </span>

        {/* chevron */}
        <span style={{ color: T.subtle, fontSize: '0.8rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ paddingTop: 12, borderTop: `1px solid rgba(255,255,255,0.08)`, marginTop: 12 }}>
              {/* weekly breakdown */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
                {[
                  { label: 'This week',  val: topic.added_this_week },
                  { label: 'Last week',  val: topic.added_last_week },
                  { label: 'This month', val: topic.added_this_month },
                  { label: 'Total',      val: topic.total_channels  },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: T.text }}>{s.val}</div>
                    <div style={{ fontSize: '0.62rem', color: T.muted }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* niche spread */}
              {topic.niches && topic.niches.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: T.muted, marginBottom: 5 }}>
                    {isCross ? `Spreading across ${topic.niches.length} niches:` : 'Niche:'}
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {topic.niches.map(n => (
                      <NicheTag key={n.niche} niche={n.niche} count={n.channels} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function TrendDetection({ channel }) {
  const [topics,      setTopics]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [niche,       setNiche]       = useState('all');
  const [tab,         setTab]         = useState('velocity'); // velocity | cross_niche | new_this_week

  const defaultNiche = channel?.niche || 'all';

  useEffect(() => {
    if (channel?.niche && niche === 'all') setNiche(channel.niche);
  }, [channel]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '80' });
    if (niche && niche !== 'all') params.set('niche', niche);
    fetch(`${SCORING_URL}/api/intel/trends/topics?${params}`)
      .then(r => r.json())
      .then(d => { setTopics(d.topics || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [niche]);

  const filtered = tab === 'velocity'
    ? [...topics].sort((a, b) => b.added_this_week - a.added_this_week)
    : tab === 'new_this_week'
    ? topics.filter(t => t.added_last_week === 0 && t.added_this_week > 0)
    : topics.filter(t => t.niches && t.niches.length > 1)
        .sort((a, b) => b.niches.length - a.niches.length);

  const tabs = [
    { id: 'velocity',     label: '⚡ Fastest growing' },
    { id: 'new_this_week',label: '✨ New this week'   },
    { id: 'cross_niche',  label: '↔ Cross-niche'     },
  ];

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 16px 48px' }}>

      {/* header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: T.text, margin: 0 }}>
          Trend Detection
        </h2>
        <p style={{ fontSize: '0.8rem', color: T.muted, marginTop: 4 }}>
          Topics gaining momentum across channels in your space — spotted before they go mainstream.
        </p>
      </div>

      {/* niche picker */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {NICHES.map(n => (
          <button
            key={n}
            onClick={() => setNiche(n)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: '0.72rem', cursor: 'pointer',
              border: niche === n ? `1px solid ${T.accent}` : `1px solid rgba(255,255,255,0.12)`,
              background: niche === n ? T.accentGlow : 'rgba(255,255,255,0.04)',
              color: niche === n ? T.accent : T.muted,
              fontWeight: niche === n ? 600 : 400,
              textTransform: 'capitalize',
              transition: 'all 0.15s',
            }}
          >
            {n === 'all' ? 'All niches' : n}
          </button>
        ))}
      </div>

      {/* sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, ...T.glassSurface, borderRadius: 10, padding: 4 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '7px 12px', borderRadius: 7, fontSize: '0.75rem',
              cursor: 'pointer', border: 'none',
              background: tab === t.id ? 'rgba(157,111,255,0.18)' : 'transparent',
              color: tab === t.id ? T.accent : T.muted,
              fontWeight: tab === t.id ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* content */}
      {loading && (
        <div style={{ textAlign: 'center', color: T.muted, padding: 60, fontSize: '0.85rem' }}>
          Loading trends…
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', color: T.danger, padding: 40, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: T.muted, padding: 60, fontSize: '0.85rem' }}>
          {tab === 'new_this_week'
            ? 'No brand-new topics spotted this week yet — check back after more channels are detected.'
            : tab === 'cross_niche'
            ? 'No cross-niche topics found for this filter.'
            : 'No trend data yet. Run the country detection job to populate topics.'}
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: '0.7rem', color: T.subtle, marginBottom: 4 }}>
            {filtered.length} topics · click to expand
          </div>
          {filtered.map((topic, i) => (
            <TopicCard key={topic.topic} topic={topic} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
