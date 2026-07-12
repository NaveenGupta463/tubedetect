import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

const API = 'http://localhost:3002';

function getClientId() {
  let id = localStorage.getItem('ti_client_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ti_client_id', id); }
  return id;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Card type badges ──────────────────────────────────────────────────────────

const CARD_BADGE = {
  outline: { label: 'Outline',  bg: 'rgba(157,111,255,0.12)', border: 'rgba(157,111,255,0.3)', color: '#9D6FFF' },
  script:  { label: 'Script',   bg: 'rgba(79,130,255,0.12)',  border: 'rgba(79,130,255,0.3)',  color: '#5B9AFF' },
  note:    { label: 'Draft',    bg: 'rgba(18,217,138,0.10)',  border: 'rgba(18,217,138,0.25)', color: '#12D98A' },
};

function CardBadge({ type, part }) {
  const b = CARD_BADGE[type] || CARD_BADGE.script;
  const label = type === 'script'
    ? (part === 'ending' ? 'Ending' : 'Body Script')
    : b.label;
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 5, fontSize: '0.63rem', fontWeight: 700,
      background: b.bg, border: `1px solid ${b.border}`, color: b.color,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// ── Expanded script/outline viewer ───────────────────────────────────────────

function DraftViewer({ cards }) {
  return (
    <div style={{ marginTop: 12 }}>
      {cards.map((card, i) => {
        if (card.type === 'outline') return <OutlineView key={i} data={card.data} />;
        if (card.type === 'script')  return <ScriptView  key={i} data={card.data} />;
        if (card.type === 'note')    return <NoteView    key={i} data={card.data} />;
        return null;
      })}
    </div>
  );
}

function NoteView({ data }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 10,
      background: 'linear-gradient(160deg, rgba(18,217,138,0.06) 0%, rgba(14,14,16,0.4))',
      border: '1px solid rgba(18,217,138,0.2)',
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: T.success, letterSpacing: '0.06em', marginBottom: 8, textTransform: 'uppercase' }}>
        {data.section || data.title || 'Draft Note'}
      </div>
      <div style={{
        fontSize: '0.78rem', color: T.text, lineHeight: 1.65, whiteSpace: 'pre-wrap',
        padding: '10px 12px', borderRadius: 8,
        background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
      }}>
        {data.content}
      </div>
    </div>
  );
}

function OutlineView({ data }) {
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 10,
      background: 'linear-gradient(160deg, rgba(157,111,255,0.07) 0%, rgba(14,14,16,0.4))',
      border: `1px solid rgba(157,111,255,0.25)`,
    }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9D6FFF', letterSpacing: '0.06em', marginBottom: 8 }}>OUTLINE</div>
      {data.hook && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.62rem', color: T.muted, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 4 }}>HOOK</div>
          <div style={{ fontSize: '0.78rem', color: T.text, lineHeight: 1.55, fontStyle: 'italic' }}>{data.hook}</div>
        </div>
      )}
      {data.sections?.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 20, height: 20, borderRadius: 5, flexShrink: 0,
            background: 'rgba(157,111,255,0.15)', border: '1px solid rgba(157,111,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.62rem', fontWeight: 700, color: '#9D6FFF',
          }}>{i + 1}</div>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: T.text }}>{s.title}</div>
            {s.brief && <div style={{ fontSize: '0.71rem', color: T.muted, marginTop: 2, lineHeight: 1.45 }}>{s.brief}</div>}
            {s.why && <div style={{ fontSize: '0.67rem', color: 'rgba(255,255,255,0.28)', marginTop: 3, fontStyle: 'italic' }}>{s.why}</div>}
          </div>
        </div>
      ))}
      {data.titles?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: '0.62rem', color: T.muted, fontWeight: 700, letterSpacing: '0.05em', marginBottom: 5 }}>TITLE OPTIONS</div>
          {data.titles.map((t, i) => (
            <div key={i} style={{
              fontSize: '0.77rem', color: i === 0 ? T.text : T.muted,
              padding: '4px 8px', borderRadius: 6, marginBottom: 3,
              background: i === 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: `1px solid ${i === 0 ? T.border : 'transparent'}`,
            }}>
              {i === 0 && <span style={{ fontSize: '0.58rem', color: T.success, marginRight: 6, fontWeight: 700 }}>BEST</span>}
              {t}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptView({ data }) {
  const isEnding = data.part === 'ending';
  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 10,
      background: isEnding
        ? 'linear-gradient(160deg, rgba(18,217,138,0.07) 0%, rgba(14,14,16,0.4))'
        : 'linear-gradient(160deg, rgba(79,130,255,0.07) 0%, rgba(14,14,16,0.4))',
      border: `1px solid ${isEnding ? 'rgba(18,217,138,0.2)' : 'rgba(79,130,255,0.25)'}`,
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', marginBottom: 10,
        color: isEnding ? T.success : '#5B9AFF',
      }}>
        {isEnding ? 'ENDING & CTA' : 'BODY SCRIPT'}
      </div>
      {data.sections?.map((s, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          {s.title && (
            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: T.muted, letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase' }}>
              {s.title}
            </div>
          )}
          <div style={{
            fontSize: '0.78rem', color: T.text, lineHeight: 1.65, whiteSpace: 'pre-wrap',
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
          }}>
            {s.script}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Draft card ────────────────────────────────────────────────────────────────

function DraftCard({ draft, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    await fetch(`${API}/api/drafts/${draft.id}?client_id=${encodeURIComponent(getClientId())}`, {
      method: 'DELETE',
    }).catch(() => {});
    onDelete(draft.id);
  };

  const cardTypes = draft.cards?.map(c => c.type) || [];
  const hasOutline = cardTypes.includes('outline');
  const noteCards  = draft.cards?.filter(c => c.type === 'note') || [];
  const bodyCard   = draft.cards?.find(c => c.type === 'script' && c.data?.part !== 'ending');
  const endCard    = draft.cards?.find(c => c.type === 'script' && c.data?.part === 'ending');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2, ease }}
      style={{
        borderRadius: 14, marginBottom: 10,
        background: 'linear-gradient(160deg, rgba(255,255,255,0.04) 0%, transparent 60%), rgba(14,14,18,0.7)',
        border: `1px solid ${T.border}`,
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div style={{
        padding: '14px 16px',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        {/* Topic + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '0.88rem', fontWeight: 700, color: T.text,
            marginBottom: 5, lineHeight: 1.3,
          }}>
            {draft.topic || 'Untitled Script'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.65rem', color: T.subtle }}>{fmtDate(draft.created_at)}</span>
            {draft.channel_id && (
              <span style={{ fontSize: '0.65rem', color: T.muted }}>· {draft.channel_id}</span>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {hasOutline && <CardBadge type="outline" />}
              {bodyCard   && <CardBadge type="script" part="body" />}
              {endCard    && <CardBadge type="script" part="ending" />}
              {noteCards.length > 0 && <CardBadge type="note" />}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <motion.button
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}
            onClick={() => setExpanded(e => !e)}
            style={{
              padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
              background: expanded ? T.accentGlow : 'rgba(255,255,255,0.05)',
              border: `1px solid ${expanded ? T.accentBorder : T.border}`,
              color: expanded ? T.accent : T.muted,
              fontSize: '0.7rem', fontWeight: 600,
            }}
          >
            {expanded ? 'Collapse' : 'View'}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }}
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
              background: 'rgba(255,80,80,0.07)', border: '1px solid rgba(255,80,80,0.18)',
              color: '#ff7070', fontSize: '0.7rem', fontWeight: 600,
            }}
          >
            {deleting ? '…' : 'Delete'}
          </motion.button>
        </div>
      </div>

      {/* Expanded viewer */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            style={{ overflow: 'hidden', borderTop: `1px solid ${T.border}` }}
          >
            <div style={{ padding: '12px 16px 16px' }}>
              <DraftViewer cards={draft.cards} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ContentHub() {
  const [drafts,  setDrafts]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all'); // 'all' | 'outline' | 'script' | 'note'

  useEffect(() => {
    const cid = getClientId();
    fetch(`${API}/api/drafts?client_id=${encodeURIComponent(cid)}`)
      .then(r => r.json())
      .then(data => { setDrafts(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = (id) => setDrafts(prev => prev.filter(d => d.id !== id));

  const filtered = drafts.filter(d => {
    if (filter === 'all') return true;
    return d.cards?.some(c => c.type === filter);
  });

  const counts = {
    all:     drafts.length,
    outline: drafts.filter(d => d.cards?.some(c => c.type === 'outline')).length,
    script:  drafts.filter(d => d.cards?.some(c => c.type === 'script')).length,
    note:    drafts.filter(d => d.cards?.some(c => c.type === 'note')).length,
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px 80px' }}>

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: T.text, letterSpacing: '-0.02em', marginBottom: 4 }}>
          Content Hub
        </div>
        <div style={{ fontSize: '0.8rem', color: T.muted }}>
          Your saved scripts and outlines from Copilot
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 20,
        padding: '3px', borderRadius: 10,
        background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
        width: 'fit-content',
      }}>
        {[
          { key: 'all',     label: 'All'      },
          { key: 'note',    label: 'Drafts'   },
          { key: 'outline', label: 'Outlines' },
          { key: 'script',  label: 'Scripts'  },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
              background: filter === key ? T.accentGlow : 'transparent',
              border: `1px solid ${filter === key ? T.accentBorder : 'transparent'}`,
              color: filter === key ? T.accent : T.muted,
              fontSize: '0.75rem', fontWeight: filter === key ? 700 : 500,
              transition: 'all 0.15s',
            }}
          >
            {label}
            <span style={{
              marginLeft: 5, fontSize: '0.62rem', fontWeight: 700,
              padding: '1px 5px', borderRadius: 4,
              background: filter === key ? 'rgba(157,111,255,0.2)' : 'rgba(255,255,255,0.07)',
              color: filter === key ? T.accent : T.subtle,
            }}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: T.muted, fontSize: '0.83rem' }}>
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          borderRadius: 16, border: `1px dashed ${T.border}`,
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 12, opacity: 0.4 }}>📁</div>
          <div style={{ fontSize: '0.88rem', fontWeight: 600, color: T.muted, marginBottom: 6 }}>
            No saved {filter === 'all' ? 'drafts' : filter + 's'} yet
          </div>
          <div style={{ fontSize: '0.75rem', color: T.subtle }}>
            Generate a script in Copilot and click "Save to Hub" to store it here
          </div>
        </div>
      ) : (
        <AnimatePresence>
          {filtered.map(draft => (
            <DraftCard key={draft.id} draft={draft} onDelete={handleDelete} />
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
