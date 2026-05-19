import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

const API = 'http://localhost:3002';

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconSparkle = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M10 2.5l1.2 5.8 5.8 1.2-5.8 1.2L10 16.5l-1.2-5.8-5.8-1.2 5.8-1.2L10 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>
);

const IconSend = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
    <path d="M17 3L10 17l-2.5-6L2 8.5 17 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
  </svg>
);

const IconX = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconPin = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M10.5 2.5l3 3-5 4.5-1 3.5-2-2-4 4-1.5-1.5 4-4-2-2 3.5-1 5-4.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
  </svg>
);

const IconTrend = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M2 12l3.5-4.5 3 2.5 4-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M11 5h2.5V7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

// ── Starter prompts ───────────────────────────────────────────────────────────

const STARTERS = [
  "What should I post this week?",
  "Draft a video outline for my best opportunity",
  "What topics am I missing?",
  "Who are my top peers?",
];

// ── Card renderers ────────────────────────────────────────────────────────────

function TopicCard({ data }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      background: data.already_covered ? 'rgba(255,255,255,0.03)' : T.accentGlow,
      border: `1px solid ${data.already_covered ? T.border : T.accentBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: T.text }}>{data.topic}</span>
        {data.already_covered && (
          <span style={{ fontSize: '0.65rem', color: T.muted, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>covered</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 14 }}>
        {data.peer_count && <span style={{ fontSize: '0.72rem', color: T.muted }}>{data.peer_count} peers covering</span>}
        {data.avg_views  && <span style={{ fontSize: '0.72rem', color: T.success }}>{data.avg_views} avg views</span>}
      </div>
    </div>
  );
}

function ChannelCard({ data }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      ...T.glassSurface,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(79,70,229,0.2))',
          border: `1px solid ${T.accentBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.75rem', fontWeight: 800, color: T.accent,
        }}>
          {(data.channel_name || data.name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {data.channel_name || data.name}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {data.subs  && <span style={{ fontSize: '0.7rem', color: T.accent }}>{data.subs}</span>}
            {data.niche && <span style={{ fontSize: '0.7rem', color: T.muted }}>{data.niche}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({ data }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      background: T.successDim,
      border: `1px solid rgba(18,217,138,0.25)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: '0.78rem', marginTop: 1 }}>💡</span>
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.text, marginBottom: 3 }}>{data.topic}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {data.peer_count && <span style={{ fontSize: '0.71rem', color: T.muted }}>{data.peer_count} peers making this</span>}
            {data.avg_views  && <span style={{ fontSize: '0.71rem', color: T.success }}>{data.avg_views} avg views</span>}
            {data.gap        && <span style={{ fontSize: '0.71rem', color: T.warning }}>{data.gap}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function VideoCard({ data }) {
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 9, marginBottom: 5,
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
    }}>
      <div style={{ fontSize: '0.8rem', color: T.text, marginBottom: 3, lineHeight: 1.35 }}>{data.title}</div>
      <div style={{ display: 'flex', gap: 12 }}>
        <span style={{ fontSize: '0.7rem', color: T.accent }}>{data.views} views</span>
        {data.channel_name && <span style={{ fontSize: '0.7rem', color: T.muted }}>{data.channel_name}</span>}
        {data.date && <span style={{ fontSize: '0.7rem', color: T.subtle }}>{data.date}</span>}
      </div>
    </div>
  );
}

function OutlineCard({ data }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 6,
      background: 'linear-gradient(160deg, rgba(157,111,255,0.08) 0%, rgba(14,14,16,0.4))',
      border: `1px solid ${T.accentBorder}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '0.78rem' }}>🎬</span>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: T.accent }}>{data.topic}</span>
        {data.format && (
          <span style={{
            fontSize: '0.65rem', fontWeight: 600,
            background: 'rgba(157,111,255,0.15)', border: `1px solid ${T.accentBorder}`,
            borderRadius: 5, padding: '2px 7px', color: T.accent,
          }}>{data.format}</span>
        )}
      </div>

      {/* Hook */}
      {data.hook && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, letterSpacing: '0.06em', marginBottom: 4 }}>HOOK</div>
          <div style={{
            fontSize: '0.8rem', color: T.text, lineHeight: 1.5,
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
            fontStyle: 'italic',
          }}>{data.hook}</div>
        </div>
      )}

      {/* Sections */}
      {data.sections?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, letterSpacing: '0.06em', marginBottom: 6 }}>STRUCTURE</div>
          {data.sections.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.65rem', fontWeight: 700, color: T.accent,
              }}>{i + 1}</div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: T.text }}>{s.title}</div>
                {s.brief && <div style={{ fontSize: '0.72rem', color: T.muted, marginTop: 2 }}>{s.brief}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Title options */}
      {data.titles?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, letterSpacing: '0.06em', marginBottom: 6 }}>TITLE OPTIONS</div>
          {data.titles.map((t, i) => (
            <div key={i} style={{
              fontSize: '0.78rem', color: i === 0 ? T.text : T.muted,
              padding: '5px 10px', borderRadius: 7, marginBottom: 4,
              background: i === 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: `1px solid ${i === 0 ? T.border : 'transparent'}`,
            }}>
              {i === 0 && <span style={{ fontSize: '0.62rem', color: T.success, marginRight: 6, fontWeight: 700 }}>BEST</span>}
              {t}
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      {data.cta && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, letterSpacing: '0.06em', marginBottom: 4 }}>CTA</div>
          <div style={{ fontSize: '0.76rem', color: T.muted }}>{data.cta}</div>
        </div>
      )}
    </div>
  );
}

function ComparisonCard({ data }) {
  const a = data.channel_a;
  const b = data.channel_b;
  if (!a || !b) return null;
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginBottom: 6,
      ...T.glassSurface,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[a, b].map((ch, i) => (
          <div key={i}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: T.accent, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {ch.channel_name}
            </div>
            <div style={{ fontSize: '0.72rem', color: T.muted, lineHeight: 1.6 }}>
              <div>{ch.subs} subs</div>
              <div>{ch.avg_views} avg views</div>
              <div>{ch.uploads_30d} uploads/30d</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderCard(card, idx) {
  switch (card.type) {
    case 'topic':      return <TopicCard       key={idx} data={card.data} />;
    case 'channel':    return <ChannelCard     key={idx} data={card.data} />;
    case 'opportunity':return <OpportunityCard key={idx} data={card.data} />;
    case 'video':      return <VideoCard       key={idx} data={card.data} />;
    case 'comparison': return <ComparisonCard  key={idx} data={card.data} />;
    case 'outline':    return <OutlineCard     key={idx} data={card.data} />;
    default:           return null;
  }
}

// ── Action buttons ────────────────────────────────────────────────────────────

function ActionButtons({ actions, onAction }) {
  if (!actions?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {actions.map((a, i) => (
        <motion.button
          key={i}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onAction(a)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 11px', borderRadius: 7,
            background: 'rgba(157,111,255,0.1)', border: `1px solid ${T.accentBorder}`,
            color: T.accent, fontSize: '0.73rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          {a.type === 'track_niche'    && <IconTrend   size={11} />}
          {a.type === 'save_idea'      && <IconPin     size={11} />}
          {a.type === 'draft_outline'  && <IconSparkle size={11} />}
          {a.type === 'write_hook'     && <IconSend    size={11} />}
          {a.type === 'new_draft'      && <IconSparkle size={11} />}
          {a.label}
        </motion.button>
      ))}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, onAction }) {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease }}
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 8, marginBottom: 16,
        alignItems: 'flex-start',
      }}
    >
      {/* Avatar */}
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 10px rgba(124,58,237,0.35)',
        }}>
          <IconSparkle size={13} />
        </div>
      )}

      <div style={{ maxWidth: '85%' }}>
        {/* Text bubble */}
        <div style={{
          padding: '10px 14px', borderRadius: isUser ? '12px 12px 4px 12px' : '4px 12px 12px 12px',
          background: isUser ? 'rgba(157,111,255,0.15)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isUser ? T.accentBorder : T.border}`,
          fontSize: '0.83rem', color: T.text, lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}>
          {msg.content}
        </div>

        {/* Cards */}
        {msg.cards?.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {msg.cards.map((card, i) => renderCard(card, i))}
          </div>
        )}

        {/* Actions */}
        {msg.actions?.length > 0 && (
          <ActionButtons actions={msg.actions} onAction={onAction} />
        )}
      </div>
    </motion.div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <IconSparkle size={13} />
      </div>
      <div style={{
        padding: '10px 16px', borderRadius: '4px 12px 12px 12px',
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
        display: 'flex', gap: 5,
      }}>
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
            style={{ width: 5, height: 5, borderRadius: '50%', background: T.muted }}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function CopilotPanel({ channel }) {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lang,    setLang]    = useState(null); // null = auto-detect from channel
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  const channelId   = channel?.channel_id || null;
  // Auto-detect: use override if set, otherwise fall back to channel's primary_language
  const activeLang  = lang || channel?.language || 'en';
  const isHinglish  = activeLang === 'hi';

  useEffect(() => {
    if (!open) return;
    setMessages([{
      role: 'assistant',
      content: channel
        ? `Hi! I'm your TubeIntel Copilot. I know your channel, your peer community, and what's working in your niche. What do you want to figure out?`
        : `Hi! I'm TubeIntel Copilot. Search for a channel first and I can give you specific insights about peers, topics, and opportunities.`,
      cards: [],
      actions: [],
    }]);
  }, [open, channel?.channel_id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Build history as plain {role, content} for the server
    // Skip the greeting (index 0 is always an assistant-initiated message, not a real turn).
    // Anthropic requires messages to start with 'user' — sending assistant-first causes errors.
    const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${API}/api/copilot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, channel_id: channelId, history, lang: activeLang }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Something went wrong: ${data.error}`,
          cards: [], actions: [],
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.answer,
          cards: data.cards || [],
          actions: data.actions || [],
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Could not reach the server. Make sure the backend is running.',
        cards: [], actions: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = (action) => {
    const t = action.payload?.topic || '';
    const n = action.payload?.niche  || '';
    switch (action.type) {
      case 'track_niche':    return send(`Track the "${n}" topic for me`);
      case 'compare_channel':return send(`Compare me with channel ${action.payload?.channel_id}`);
      case 'save_idea':      return send(`Save "${t}" as a content idea`);
      case 'draft_outline':  return send(`Draft a full video outline for "${t}"`);
      case 'write_hook':     return send(`Write the opening 60-second script for "${t}"`);
      case 'new_draft':      return send(`Give me a different angle for the "${t}" video outline`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const reset = () => setMessages([]);

  return (
    <>
      {/* ── Floating trigger button ─────────────────────────────────────────── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="trigger"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.08, boxShadow: '0 0 28px rgba(124,58,237,0.6)' }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setOpen(true)}
            transition={spring.snappy}
            style={{
              position: 'fixed', bottom: 28, right: 28, zIndex: 200,
              width: 52, height: 52, borderRadius: 16,
              background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
              border: '1px solid rgba(255,255,255,0.2)',
              boxShadow: '0 0 18px rgba(124,58,237,0.45), 0 8px 32px rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
            }}
          >
            <IconSparkle size={22} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat panel ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.95 }}
            transition={spring.smooth}
            style={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 200,
              width: 420, height: 620,
              display: 'flex', flexDirection: 'column',
              borderRadius: 20,
              background: 'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, transparent 50%), rgba(12,12,16,0.94)',
              backdropFilter: 'blur(24px) saturate(1.5)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
              border: '1px solid rgba(255,255,255,0.22)',
              boxShadow: [
                '0 0 40px rgba(124,58,237,0.15)',
                '0 24px 80px rgba(0,0,0,0.8)',
                'inset 0 1.5px 0 rgba(255,255,255,0.5)',
                'inset 0 -1px 0 rgba(255,255,255,0.05)',
              ].join(', '),
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 16px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 12px rgba(124,58,237,0.4)', flexShrink: 0,
              }}>
                <IconSparkle size={15} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>TubeIntel Copilot</div>
                {channel && (
                  <div style={{ fontSize: '0.7rem', color: T.accent }}>{channel.name}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Language toggle — only show for Hindi channels or when manually overridden */}
                <motion.button
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  onClick={() => setLang(isHinglish ? 'en' : 'hi')}
                  title={isHinglish ? 'Switch to English' : 'Switch to Hinglish'}
                  style={{
                    padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                    background: isHinglish ? T.accentGlow : 'transparent',
                    border: `1px solid ${isHinglish ? T.accentBorder : T.border}`,
                    color: isHinglish ? T.accent : T.muted,
                    fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.04em',
                  }}
                >
                  {isHinglish ? 'HI' : 'EN'}
                </motion.button>

                <div style={{ display: 'flex', gap: 4 }}>
                {messages.length > 1 && (
                  <motion.button
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={reset}
                    title="New chat"
                    style={{
                      width: 28, height: 28, borderRadius: 7,
                      background: 'transparent', border: `1px solid ${T.border}`,
                      color: T.muted, cursor: 'pointer', fontSize: '0.65rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ↺
                  </motion.button>
                )}
                <motion.button
                  whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                  onClick={() => setOpen(false)}
                  style={{
                    width: 28, height: 28, borderRadius: 7,
                    background: 'transparent', border: `1px solid ${T.border}`,
                    color: T.muted, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <IconX size={13} />
                </motion.button>
              </div>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              style={{
                flex: 1, overflowY: 'auto', padding: '16px 14px 8px',
                scrollbarWidth: 'thin', scrollbarColor: `${T.subtle} transparent`,
              }}
            >
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} onAction={handleAction} />
              ))}

              <AnimatePresence>
                {loading && <TypingDots />}
              </AnimatePresence>

              {/* Starter prompts — show when only greeting is present */}
              {messages.length === 1 && !loading && (
                <div style={{ marginTop: 8 }}>
                  {STARTERS.map((s, i) => (
                    <motion.button
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.18, ease }}
                      whileHover={{ x: 3 }}
                      onClick={() => send(s)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', marginBottom: 6, borderRadius: 9,
                        background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
                        color: T.muted, fontSize: '0.78rem', cursor: 'pointer',
                        transition: 'border-color 0.15s, color 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = T.accentBorder; e.currentTarget.style.color = T.text; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.muted; }}
                    >
                      {s}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* Input area */}
            <div style={{
              padding: '10px 12px 14px', borderTop: `1px solid ${T.border}`, flexShrink: 0,
            }}>
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 8,
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
                borderRadius: 12, padding: '8px 10px',
                transition: 'border-color 0.15s',
              }}
                onFocus={e => e.currentTarget.style.borderColor = T.accentBorder}
                onBlur={e => e.currentTarget.style.borderColor = T.border}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything about your channel, peers, or content…"
                  rows={1}
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    color: T.text, fontSize: '0.83rem', fontFamily: 'inherit',
                    resize: 'none', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto',
                    scrollbarWidth: 'none',
                  }}
                  onInput={e => {
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
                  }}
                />
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: input.trim() && !loading
                      ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
                      : 'rgba(255,255,255,0.06)',
                    border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: input.trim() && !loading ? '#fff' : T.subtle,
                    transition: 'background 0.2s, color 0.2s',
                    boxShadow: input.trim() && !loading ? '0 0 10px rgba(124,58,237,0.4)' : 'none',
                  }}
                >
                  <IconSend size={14} />
                </motion.button>
              </div>
              <div style={{ textAlign: 'center', marginTop: 6, fontSize: '0.65rem', color: T.subtle }}>
                Enter to send · Shift+Enter for new line
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
