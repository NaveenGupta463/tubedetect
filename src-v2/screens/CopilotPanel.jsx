import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { T, spring, ease } from '../tokens';

function genId() { return crypto.randomUUID(); }

function getClientId() {
  let id = localStorage.getItem('ti_client_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ti_client_id', id); }
  return id;
}

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
  "How has my channel changed in the last 30 days?",
  "What topics am I missing?",
  "Who are my top peers?",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtViews(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return String(n);
}

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

function OpportunityCard({ data, onAction }) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      background: T.successDim,
      border: `1px solid rgba(18,217,138,0.25)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: '0.78rem', marginTop: 1 }}>💡</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.text, marginBottom: 3 }}>{data.topic}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: onAction ? 8 : 0 }}>
            {data.peer_count && <span style={{ fontSize: '0.71rem', color: T.muted }}>{data.peer_count} peers making this</span>}
            {data.avg_views  && <span style={{ fontSize: '0.71rem', color: T.success }}>{data.avg_views} avg views</span>}
            {data.gap        && <span style={{ fontSize: '0.71rem', color: T.warning }}>{data.gap}</span>}
          </div>
          {onAction && (
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={() => onAction({ type: 'draft_outline', label: 'Draft video outline', payload: { topic: data.topic } })}
                style={{
                  padding: '3px 9px', borderRadius: 5, cursor: 'pointer', border: 'none',
                  background: 'rgba(157,111,255,0.15)', color: T.accent,
                  fontSize: '0.68rem', fontWeight: 600,
                }}
              >Draft this</button>
              <button
                onClick={() => onAction({ type: 'save_idea', label: 'Save this idea', payload: { topic: data.topic } })}
                style={{
                  padding: '3px 9px', borderRadius: 5, cursor: 'pointer', border: 'none',
                  background: 'rgba(255,255,255,0.06)', color: T.muted,
                  fontSize: '0.68rem', fontWeight: 500,
                }}
              >Save idea</button>
            </div>
          )}
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

function OutlineCard({ data, placeholders }) {
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
          }}>
            <ScriptTextWithPlaceholders text={data.hook} placeholders={placeholders} />
          </div>
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
                {s.brief && (
                  <div style={{ fontSize: '0.72rem', color: T.muted, marginTop: 2 }}>
                    <ScriptTextWithPlaceholders text={s.brief} placeholders={placeholders} />
                  </div>
                )}
                {s.why && (
                  <div style={{ fontSize: '0.67rem', color: T.subtle, marginTop: 3, fontStyle: 'italic' }}>{s.why}</div>
                )}
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

// ── Inline placeholder rendering ──────────────────────────────────────────────

const PH_CHIP = {
  story:      { bg: 'rgba(79,130,255,0.12)',  border: 'rgba(79,130,255,0.3)',   text: '#5B9AFF' },
  experience: { bg: 'rgba(79,130,255,0.12)',  border: 'rgba(79,130,255,0.3)',   text: '#5B9AFF' },
  example:    { bg: 'rgba(180,180,180,0.09)', border: 'rgba(180,180,180,0.22)', text: '#aaa'    },
  stat:       { bg: 'rgba(255,179,0,0.1)',    border: 'rgba(255,179,0,0.28)',   text: '#FFBA00' },
  source:     { bg: 'rgba(255,179,0,0.1)',    border: 'rgba(255,179,0,0.28)',   text: '#FFBA00' },
  override:   { bg: 'rgba(255,140,0,0.1)',    border: 'rgba(255,140,0,0.28)',   text: '#FFA040' },
  medical:    { bg: 'rgba(255,80,80,0.1)',    border: 'rgba(255,80,80,0.28)',   text: '#FF6B6B' },
};
const EXPANDABLE_PH = new Set(['story', 'experience', 'example']);
const PH_RE = /\[([A-Z][A-Z_\s]*[A-Z])(?::\s*([^\]]*))?\]/g;

function parseScriptText(text) {
  const segs = [];
  let last = 0;
  PH_RE.lastIndex = 0;
  let m;
  while ((m = PH_RE.exec(text)) !== null) {
    if (m.index > last) segs.push({ kind: 'text', content: text.slice(last, m.index) });
    const label = m[1].trim();
    const desc  = (m[2] || '').trim();
    const phType = /STORY|ANECDOTE/.test(label) ? 'story'
      : /EXPERIENCE/.test(label)               ? 'experience'
      : /EXAMPLE/.test(label)                  ? 'example'
      : /VERIFY|STAT/.test(label)              ? 'stat'
      : /SOURCE/.test(label)                   ? 'source'
      : /OVERRIDE/.test(label)                 ? 'override'
      : /MEDICAL/.test(label)                  ? 'medical'
      : 'example';
    segs.push({ kind: 'ph', label, desc, phType });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: 'text', content: text.slice(last) });
  return segs;
}

function ScriptTextWithPlaceholders({ text, placeholders }) {
  const [open, setOpen] = useState({});
  const segs = parseScriptText(text);
  return (
    <>
      {segs.map((seg, i) => {
        if (seg.kind === 'text') return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{seg.content}</span>;

        const ph = (placeholders || []).find(p => {
          if (!p.description || !seg.desc) return false;
          if (p.description === seg.desc) return true;
          const a = p.description.toLowerCase().slice(0, 30);
          const b = seg.desc.toLowerCase().slice(0, 30);
          return a === b || a.startsWith(b.slice(0, 18)) || b.startsWith(a.slice(0, 18));
        });
        const canExpand = EXPANDABLE_PH.has(seg.phType) && ph?.example;
        const isOpen    = open[i];
        const c = PH_CHIP[seg.phType] || PH_CHIP.example;

        return (
          <span key={i}>
            <span
              onClick={canExpand ? () => setOpen(s => ({ ...s, [i]: !s[i] })) : undefined}
              title={canExpand ? 'Click to see an example' : undefined}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 5, margin: '1px 2px',
                background: c.bg, border: `1px solid ${c.border}`,
                color: c.text, fontSize: '0.71rem',
                cursor: canExpand ? 'pointer' : 'default',
                userSelect: 'none', verticalAlign: 'middle',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: '0.6rem', letterSpacing: '0.05em' }}>
                {seg.label}
              </span>
              {seg.desc && (
                <span style={{ opacity: 0.78, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {seg.desc}
                </span>
              )}
              {canExpand && (
                <span style={{ fontSize: '0.58rem', opacity: 0.6, flexShrink: 0 }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              )}
            </span>
            {isOpen && ph?.example && (
              <span style={{
                display: 'block', margin: '6px 0 8px',
                padding: '10px 13px', borderRadius: 8,
                background: 'rgba(79,130,255,0.07)', border: '1px solid rgba(79,130,255,0.22)',
              }}>
                <span style={{
                  display: 'block', fontSize: '0.59rem', fontWeight: 800,
                  color: '#5B9AFF', letterSpacing: '0.07em', marginBottom: 5,
                }}>EXAMPLE — replace with your actual story</span>
                <span style={{
                  display: 'block', fontSize: '0.77rem', color: T.text,
                  lineHeight: 1.6, fontStyle: 'italic',
                }}>{ph.example}</span>
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

function ScriptCard({ data, overrideCount, placeholders }) {
  const partLabel  = data.part === 'ending' ? 'Ending & CTA' : 'Body Script';
  const hasOverride = overrideCount > 0;
  const partColor  = hasOverride ? 'rgba(255,179,0,0.06)'
    : data.part === 'ending' ? 'rgba(18,217,138,0.08)' : 'rgba(157,111,255,0.08)';
  const partBorder = hasOverride ? 'rgba(255,179,0,0.45)'
    : data.part === 'ending' ? 'rgba(18,217,138,0.2)' : T.accentBorder;

  return (
    <div style={{
      padding: '14px 16px', borderRadius: 12, marginBottom: 6,
      background: `linear-gradient(160deg, ${partColor} 0%, rgba(14,14,16,0.4))`,
      border: `1px solid ${partBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: '0.78rem' }}>{data.part === 'ending' ? '🎯' : '📝'}</span>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: T.accent }}>{data.topic}</span>
        <span style={{
          fontSize: '0.65rem', fontWeight: 600,
          background: hasOverride ? 'rgba(255,179,0,0.12)' : data.part === 'ending' ? 'rgba(18,217,138,0.12)' : T.accentGlow,
          border: `1px solid ${partBorder}`,
          borderRadius: 5, padding: '2px 7px',
          color: hasOverride ? '#FFBA00' : data.part === 'ending' ? T.success : T.accent,
        }}>{partLabel}</span>
        {hasOverride && (
          <span style={{
            fontSize: '0.62rem', fontWeight: 700, color: '#FFBA00',
            background: 'rgba(255,179,0,0.1)', border: '1px solid rgba(255,179,0,0.3)',
            borderRadius: 4, padding: '1px 6px',
          }}>{overrideCount} override{overrideCount > 1 ? 's' : ''} to replace</span>
        )}
      </div>

      {data.sections?.map((s, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          {s.title && (
            <div style={{
              fontSize: '0.7rem', fontWeight: 700, color: T.muted,
              letterSpacing: '0.05em', marginBottom: 6, textTransform: 'uppercase',
            }}>{s.title}</div>
          )}
          <div style={{
            fontSize: '0.8rem', color: T.text, lineHeight: 1.65,
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid ${T.border}`,
          }}>
            <ScriptTextWithPlaceholders text={s.script} placeholders={placeholders} />
          </div>
        </div>
      ))}

      {data.cta && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: T.muted, letterSpacing: '0.06em', marginBottom: 4 }}>CTA</div>
          <div style={{ fontSize: '0.76rem', color: data.part === 'ending' ? T.success : T.muted, lineHeight: 1.5 }}>{data.cta}</div>
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

function EvolutionCard({ data, onAction }) {
  const pct     = data.view_change_pct;
  const isUp    = pct > 0;
  const isDown  = pct < 0;
  const pctColor = isUp ? T.success : isDown ? '#f87171' : T.muted;
  const pctLabel = pct == null ? 'No prior baseline'
    : `${isUp ? '+' : ''}${pct}% views vs prior period`;
  const uploadLabel = data.upload_delta == null ? null
    : data.upload_delta > 0 ? `+${data.upload_delta} uploads/wk`
    : data.upload_delta < 0 ? `${data.upload_delta} uploads/wk`
    : 'Same upload pace';

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginBottom: 6,
      background: 'rgba(124,58,237,0.08)',
      border: `1px solid ${T.accentBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Channel Evolution · {data.period}
        </span>
        {data.data_stale && (
          <span style={{ fontSize: '0.65rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 6px', borderRadius: 4 }}>stale data</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: pctColor }}>{pctLabel}</div>
          <div style={{ fontSize: '0.68rem', color: T.muted }}>avg {fmtViews(data.avg_views)} views · {data.video_count} videos</div>
        </div>
        {uploadLabel && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: T.text }}>{uploadLabel}</div>
            <div style={{ fontSize: '0.68rem', color: T.muted }}>upload frequency</div>
          </div>
        )}
      </div>
      {data.notable_event && (
        <div style={{ marginBottom: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.12)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: '0.75rem' }}>⚡</span>
          <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600 }}>
            Viral spike — {data.notable_event.magnitude}× normal views
          </span>
        </div>
      )}
      {data.topics?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {data.topics.slice(0, 8).map((t, i) => (
            <span key={i} style={{ fontSize: '0.65rem', color: T.muted, background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4 }}>{t}</span>
          ))}
        </div>
      )}
      {onAction && (
        <button
          onClick={() => onAction({ type: 'find_opportunity', label: 'Find content opportunities', payload: {} })}
          style={{
            marginTop: 4, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
            background: 'rgba(157,111,255,0.15)', border: `1px solid ${T.accentBorder}`,
            color: T.accent, fontSize: '0.73rem', fontWeight: 600,
          }}
        >
          Find content opportunities
        </button>
      )}
    </div>
  );
}

function TopicDriftCard({ data }) {
  const trend = data.velocity_trend || 'stable';
  const trendColor = trend === 'rising' ? T.success : trend === 'falling' ? '#f87171' : T.muted;
  const trendLabel = trend === 'rising' ? 'Rising ↑' : trend === 'falling' ? 'Falling ↓' : 'Stable →';

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, marginBottom: 6,
      background: trend === 'rising' ? 'rgba(18,217,138,0.07)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${trend === 'rising' ? 'rgba(18,217,138,0.25)' : T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Community Topic
        </span>
        {data.data_stale && (
          <span style={{ fontSize: '0.65rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 6px', borderRadius: 4 }}>stale data</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: T.text }}>{data.topic}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: trendColor }}>{trendLabel}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: T.muted }}>{data.channel_count} channels posting</span>
        {data.avg_views > 0 && (
          <span style={{ fontSize: '0.72rem', color: T.success }}>{fmtViews(data.avg_views)} avg views</span>
        )}
        <span style={{ fontSize: '0.65rem', color: T.muted }}>· {data.period} window</span>
      </div>
    </div>
  );
}

function renderCard(card, idx, onAction, placeholders) {
  if (card.type === 'script') {
    const count = (placeholders || []).filter(p => p.type === 'override').length;
    return <ScriptCard key={idx} data={card.data} overrideCount={count} placeholders={placeholders} />;
  }
  switch (card.type) {
    case 'topic':      return <TopicCard       key={idx} data={card.data} />;
    case 'channel':    return <ChannelCard     key={idx} data={card.data} />;
    case 'opportunity':return <OpportunityCard key={idx} data={card.data} onAction={onAction} />;
    case 'video':      return <VideoCard       key={idx} data={card.data} />;
    case 'comparison':  return <ComparisonCard  key={idx} data={card.data} />;
    case 'outline':     return <OutlineCard     key={idx} data={card.data} placeholders={placeholders} />;
    case 'evolution':   return <EvolutionCard   key={idx} data={card.data} onAction={onAction} />;
    case 'topic_drift': return <TopicDriftCard  key={idx} data={card.data} />;
    default:            return null;
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
          {a.type === 'track_niche'       && <IconTrend   size={11} />}
          {a.type === 'save_idea'         && <IconPin     size={11} />}
          {a.type === 'draft_outline'     && <IconSparkle size={11} />}
          {a.type === 'write_hook'        && <IconSend    size={11} />}
          {a.type === 'write_body'        && <IconSend    size={11} />}
          {a.type === 'write_ending'      && <IconSend    size={11} />}
          {a.type === 'podcast_episode_plan' && <IconSparkle size={11} />}
          {a.type === 'podcast_questions'    && <IconSend    size={11} />}
          {a.type === 'podcast_pushback'     && <IconSparkle size={11} />}
          {a.type === 'podcast_clips'        && <IconSend    size={11} />}
          {a.type === 'new_draft'         && <IconSparkle size={11} />}
          {a.type === 'regenerate_ideas'  && <IconSparkle size={11} />}
          {a.label}
        </motion.button>
      ))}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

const IconSave = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path d="M2 3a1 1 0 011-1h7.5L13 4.5V13a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M5 14V9h6v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M5 2v3.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

function getMsgPartKeys(msg) {
  return (msg.cards || [])
    .filter(c => c.type === 'outline' || c.type === 'script')
    .map(c => c.type === 'script' ? `script:${c.data?.part || 'body'}` : 'outline');
}

function podcastThemeLine(payload = {}) {
  const title = payload.title || payload.theme || 'this podcast episode';
  const guest = payload.guest || 'a credible guest';
  const evidence = payload.evidence ? `Peer evidence: ${payload.evidence}. ` : '';
  const angle = payload.angle ? `Angle: ${payload.angle}` : '';
  const text = `${title} ${guest} ${payload.evidence || ''} ${payload.angle || ''}`.toLowerCase();
  const themeKind = /\b(money|wealth|finance|financial|invest|saving|income|salary|real estate|stock|market|economy|inflation|petrol|diesel|oil)\b/.test(text)
    ? 'finance'
    : 'general';
  return { title, guest, context: `${evidence}${angle}`.trim(), themeKind };
}

function buildPodcastActionMessage(type, payload = {}) {
  const { title, guest, context, themeKind } = podcastThemeLine(payload);
  const ctx = context ? `\n\n${context}` : '';

  if (type === 'podcast_episode_plan') {
    if (themeKind !== 'finance') {
      return `Episode arc for "${title}"${ctx}

1. Cold open: Start with the most relatable contradiction in the theme. Make the viewer feel the topic affects their life, work, family, or future.
2. Guest credibility: Establish why the ${guest} has first-hand or expert pattern recognition.
3. Stakes: Translate the theme into consequences for the viewer. What changes if they ignore it?
4. Friction: Bring in the uncomfortable tradeoff, disagreement, or misconception.
5. Story layer: Ask for one real case, failure, turning point, or behind-the-scenes moment.
6. Practical reset: Convert the discussion into 3 decisions, signals, or questions the viewer can use.
7. Ending: Close with one memorable rule, warning, or question the audience can repeat.

Host stance: Be curious but not passive. Keep asking "what does this mean for the viewer tomorrow?"`;
    }
    return `Episode arc for "${title}"${ctx}

1. Cold open: Start with the uncomfortable contradiction behind the topic. Make the viewer feel, "This is about me, not just finance."
2. Guest credibility: Establish why the ${guest} has seen this pattern repeatedly.
3. Personal mirror: Move from advice to behavior. Ask why smart people still make poor money decisions.
4. Status pressure: Bring in family, lifestyle inflation, social comparison, and the need to look successful.
5. Practical reset: Turn the debate into 3-4 decisions viewers can actually make this month.
6. Climax question: "Is wealth mostly about earning more, or about escaping the pressure to spend more?"
7. Ending: Close with one memorable rule the audience can repeat, then ask viewers which money behavior they are trying to fix.

Host stance: Be empathetic but skeptical. Don't let the conversation become generic motivation; keep pulling it back to real Indian household choices.`;
  }

  if (type === 'podcast_questions') {
    if (themeKind !== 'finance') {
      return `Questions for "${title}"${ctx}

1. What is the most misunderstood part of this topic?
2. What changed recently that makes this worth discussing now?
3. Who is most affected by this, and who is pretending it does not matter?
4. What is one story that captures the whole issue?
5. What do outsiders get wrong when they talk about it?
6. Where do you disagree with the popular narrative?
7. What should viewers stop assuming?
8. What signal should people watch over the next 6-12 months?
9. What is the uncomfortable tradeoff nobody wants to say out loud?
10. If you had to simplify this for a 20-year-old viewer, what would you say?
11. What is one practical decision this should change?
12. What is the one question viewers should ask themselves after this episode?

Follow-up style: After every broad answer, ask for a real example. After every expert answer, ask what it means for ordinary viewers.`;
    }
    return `Questions for "${title}"${ctx}

1. What money belief did you have to unlearn personally?
2. Why do people who earn well still feel financially insecure?
3. Where does status pressure quietly enter money decisions?
4. What is one common money habit that looks responsible but is actually harmful?
5. How should a young Indian decide between saving, investing, and upgrading lifestyle?
6. What do most people misunderstand about becoming wealthy?
7. When does ambition become financial self-sabotage?
8. What role does family expectation play in money anxiety?
9. What is the most overrated piece of finance advice online?
10. If someone has only 10 minutes this week, what should they check in their finances?
11. What would you tell someone earning more but saving less than before?
12. What is one rule you wish every viewer would follow for the next 12 months?

Follow-up style: Ask "why does this happen?" after every advice answer, and "what does this look like in real life?" after every abstract answer.`;
  }

  if (type === 'podcast_pushback') {
    if (themeKind !== 'finance') {
      return `Tension map for "${title}"${ctx}

Central debate: Is the mainstream explanation of this issue too simple, or is the real problem hidden in incentives, tradeoffs, and human behavior?

Pushback points:
1. What is the strongest argument against your view?
2. Who benefits if viewers misunderstand this?
3. Are we overreacting, or underreacting?
4. What does the popular narrative leave out?
5. What would make your prediction wrong?
6. What should ordinary people do differently after hearing this?

Where to challenge the guest:
- When they make a big claim, ask for the mechanism.
- When they use expert language, ask for a viewer-level example.
- When they blame one side, ask what the other side gets right.

Tone: Respectful pressure. The host should make the guest clarify, not just agree.`;
    }
    return `Tension map for "${title}"${ctx}

Central debate: Is financial growth mainly about better knowledge, or better behavior under social pressure?

Pushback points:
1. If the advice is so simple, why do educated people still fail at it?
2. Are finance creators underestimating how much family pressure shapes spending?
3. Is "invest early" useless advice for people with unstable income?
4. Does personal finance advice blame individuals for structural problems?
5. When does saving become fear instead of discipline?
6. Are people chasing wealth, or just trying not to feel behind?

Where to challenge the guest:
- When they give a rule, ask for the exception.
- When they blame mindset, ask what role income and family obligations play.
- When they suggest investing, ask what the viewer should stop doing first.

Tone: Sharp, not hostile. The host should protect the viewer from oversimplified advice.`;
  }

  if (type === 'podcast_clips') {
    if (themeKind !== 'finance') {
      return `Shorts/Reels plan for "${title}"${ctx}

1. Hook: "Most people are looking at this the wrong way." Payoff: reveal the hidden frame.
2. Hook: "This is not just a headline. It affects you because..." Payoff: personal consequence.
3. Hook: "The expert disagrees with the popular narrative." Payoff: contrarian moment.
4. Hook: "Here is the one signal to watch next." Payoff: future-facing takeaway.
5. Hook: "Nobody talks about this tradeoff." Payoff: uncomfortable truth.
6. Hook: "If you are young in India, this matters because..." Payoff: youth relevance.
7. Hook: "The biggest myth about this topic is..." Payoff: myth-busting answer.
8. Hook: "This one question changed the whole conversation." Payoff: best host challenge.

Clip style: Open with tension, cut to the guest's clearest answer, then end with the host reframing the takeaway.`;
    }
    return `Shorts/Reels plan for "${title}"${ctx}

1. Hook: "Why do people earn more but stay broke?" Payoff: lifestyle inflation.
2. Hook: "The biggest money trap is not spending. It is proving." Payoff: status pressure.
3. Hook: "Your salary is not your wealth." Payoff: income vs retained money.
4. Hook: "Middle-class families don't teach finance, they teach fear." Payoff: inherited money behavior.
5. Hook: "This one habit quietly kills wealth." Payoff: upgrading every time income rises.
6. Hook: "Should you invest or fix your spending first?" Payoff: order of operations.
7. Hook: "The finance advice nobody gives beginners." Payoff: build margin before chasing returns.
8. Hook: "Why rich-looking people are often financially fragile." Payoff: visible success vs actual security.

Clip style: Use guest's strongest one-line answer first, then cut to the host reframing it in plain language.`;
  }

  return null;
}

function normalizeDraftTopic(topic) {
  return String(topic || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120) || 'untitled';
}

function isDraftableMessage(msg) {
  if (!msg || msg.role === 'user' || msg.saved) return false;
  if (msg.draftable) return true;
  if (msg.cards?.some(c => ['outline', 'script', 'note'].includes(c.type))) return true;
  const text = String(msg.content || '').toLowerCase();
  return /\b(outline|script|episode arc|questions for|tension map|shorts\/reels plan|content plan|calendar|brief|hook ideas|title options|thumbnail ideas)\b/.test(text);
}

function noteSectionFromMessage(msg) {
  if (msg.draft_section) return msg.draft_section;
  const first = String(msg.content || '').split('\n')[0].toLowerCase();
  if (first.includes('episode arc')) return 'Episode Arc';
  if (first.includes('questions')) return 'Questions';
  if (first.includes('tension')) return 'Tension';
  if (first.includes('shorts') || first.includes('reels') || first.includes('clips')) return 'Clips';
  if (first.includes('title')) return 'Titles';
  if (first.includes('thumbnail')) return 'Thumbnail Ideas';
  if (first.includes('calendar')) return 'Calendar';
  if (first.includes('brief')) return 'Brief';
  return 'Note';
}

function MessageBubble({ msg, onAction, onSave, onSelectVersion }) {
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

        {/* Merge warning banner */}
        {msg.thread_state?.merge_warning && (
          <div style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 7,
            background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.25)',
            fontSize: '0.72rem', color: '#FFBA00', lineHeight: 1.45,
          }}>
            {msg.thread_state.merge_warning}
          </div>
        )}

        {/* Cards */}
        {msg.cards?.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {msg.cards.map((card, i) => renderCard(card, i, onAction, msg.placeholders))}
          </div>
        )}

        {/* Placeholder task list */}
        {msg.placeholders?.length > 0 && (
          <PlaceholderPanel placeholders={msg.placeholders} />
        )}

        {/* Evidence claims panel */}
        {msg.evidence?.length > 0 && (
          <EvidencePanel evidence={msg.evidence} />
        )}

        {/* Actions */}
        {msg.actions?.length > 0 && (
          <ActionButtons actions={msg.actions} onAction={onAction} />
        )}

        {/* Credit deduction feedback */}
        {msg.credits?.deducted > 0 && (
          <div style={{ fontSize: '0.63rem', color: T.subtle, marginTop: 5, textAlign: 'right' }}>
            −{msg.credits.deducted} credits · {msg.credits.balance} remaining
          </div>
        )}

        {/* Version selector + Save */}
        {isDraftableMessage(msg) && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {onSelectVersion && msg.cards?.some(c => ['outline', 'script'].includes(c.type)) && (
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => onSelectVersion(msg)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                  background: msg.preferred ? 'rgba(157,111,255,0.18)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${msg.preferred ? T.accentBorder : T.border}`,
                  color: msg.preferred ? T.accent : T.muted,
                  fontSize: '0.68rem', fontWeight: 600, transition: 'all 0.15s',
                }}
              >
                {msg.preferred ? '✓ Using this version' : 'Use this version'}
              </motion.button>
            )}
            {onSave && (
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => onSave(msg)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 7, cursor: 'pointer',
                  background: 'rgba(18,217,138,0.08)', border: '1px solid rgba(18,217,138,0.22)',
                  color: T.success, fontSize: '0.68rem', fontWeight: 600,
                }}
              >
                <IconSave size={12} />
                Save to Draft
              </motion.button>
            )}
          </div>
        )}
        {msg.saved && (
          <div style={{ marginTop: 6, textAlign: 'right', fontSize: '0.63rem', color: T.success }}>
            Saved to Hub
          </div>
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

// ── Placeholder panel — shows creator task list after script generation ────────

const PLACEHOLDER_COLORS = {
  story:      { bg: 'rgba(79,130,255,0.08)', border: 'rgba(79,130,255,0.25)', label: '#5B9AFF' },
  experience: { bg: 'rgba(79,130,255,0.08)', border: 'rgba(79,130,255,0.25)', label: '#5B9AFF' },
  stat:       { bg: 'rgba(255,179,0,0.08)',  border: 'rgba(255,179,0,0.25)',  label: '#FFBA00' },
  source:     { bg: 'rgba(255,179,0,0.08)',  border: 'rgba(255,179,0,0.25)',  label: '#FFBA00' },
  example:    { bg: 'rgba(180,180,180,0.06)', border: 'rgba(180,180,180,0.18)', label: T.muted },
  medical:    { bg: 'rgba(255,80,80,0.08)',  border: 'rgba(255,80,80,0.25)',  label: '#FF6B6B' },
  case_study: { bg: 'rgba(180,180,180,0.06)', border: 'rgba(180,180,180,0.18)', label: T.muted },
  override:   { bg: 'rgba(255,179,0,0.08)',  border: 'rgba(255,140,0,0.3)',   label: '#FFBA00' },
};

const PLACEHOLDER_TYPE_LABELS = {
  story:      'YOUR STORY',
  experience: 'YOUR EXPERIENCE',
  stat:       'VERIFY',
  source:     'SOURCE NEEDED',
  example:    'EXAMPLE NEEDED',
  medical:    'MEDICAL CLAIM',
  case_study: 'CASE STUDY NEEDED',
  override:   'OVERRIDE ⚠',
};

function PlaceholderPanel({ placeholders }) {
  if (!placeholders?.length) return null;
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 10,
      background: 'rgba(255,255,255,0.03)', border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontSize: '0.63rem', fontWeight: 700, color: T.muted,
        letterSpacing: '0.07em', marginBottom: 8,
      }}>CREATOR TASKS — fill these before filming</div>
      {placeholders.map((ph, i) => {
        const colors = PLACEHOLDER_COLORS[ph.type] || PLACEHOLDER_COLORS.example;
        return (
          <div key={ph.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5,
            padding: '6px 10px', borderRadius: 7,
            background: colors.bg, border: `1px solid ${colors.border}`,
          }}>
            <div style={{
              fontSize: '0.58rem', fontWeight: 800, color: colors.label,
              letterSpacing: '0.05em', flexShrink: 0, marginTop: 2, minWidth: 60,
            }}>
              {PLACEHOLDER_TYPE_LABELS[ph.type] || ph.type.toUpperCase()}
            </div>
            <div style={{ fontSize: '0.74rem', color: T.text, lineHeight: 1.45 }}>
              {ph.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Evidence panel ────────────────────────────────────────────────────────────

const EVIDENCE_STATUS_STYLE = {
  PLACEHOLDER: { bg: 'rgba(255,179,0,0.07)',  border: 'rgba(255,179,0,0.22)',  label: '#FFBA00', text: 'NEEDS VERIFICATION' },
  UNVERIFIED:  { bg: 'rgba(255,100,100,0.06)', border: 'rgba(255,100,100,0.2)', label: '#FF7070', text: 'UNVERIFIED'          },
  VERIFIED_WEB:{ bg: 'rgba(18,217,138,0.06)', border: 'rgba(18,217,138,0.2)', label: T.success, text: 'VERIFIED'             },
};

function EvidencePanel({ evidence }) {
  if (!evidence?.length) return null;
  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 10,
      background: 'rgba(255,255,255,0.02)', border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontSize: '0.63rem', fontWeight: 700, color: T.muted,
        letterSpacing: '0.07em', marginBottom: 8,
      }}>CLAIMS — verify before publishing</div>
      {evidence.map((ev, i) => {
        const style = EVIDENCE_STATUS_STYLE[ev.status] || EVIDENCE_STATUS_STYLE.UNVERIFIED;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5,
            padding: '6px 10px', borderRadius: 7,
            background: style.bg, border: `1px solid ${style.border}`,
          }}>
            <div style={{
              fontSize: '0.58rem', fontWeight: 800, color: style.label,
              letterSpacing: '0.04em', flexShrink: 0, marginTop: 2, minWidth: 56,
            }}>{style.text}</div>
            <div style={{ fontSize: '0.74rem', color: T.text, lineHeight: 1.4, flex: 1 }}>
              {ev.claim}
              {ev.source && (
                <span style={{ marginLeft: 6, fontSize: '0.65rem', color: T.accent }}>
                  — {ev.source}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Credits panel ─────────────────────────────────────────────────────────────

const PLAN_LABELS = {
  free:           'Free',
  starter:        'Starter',
  creator_pro:    'Creator Pro',
  pro:            'Pro',
  agency_starter: 'Agency Starter',
  agency_pro:     'Agency Pro',
};
const PLAN_CR = { free: 50, starter: 300, creator_pro: 500, pro: 1000, agency_starter: 3000, agency_pro: 10000 };

function CreditPanel({ detail, onSetPlan, onClose }) {
  return (
    <div style={{
      position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40,
      background: 'rgba(14,14,18,0.98)', border: `1px solid ${T.border}`,
      borderRadius: 10, padding: '12px 14px', minWidth: 210,
      boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    }}>
      {/* Plan row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 800, color: T.accent,
          letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          {PLAN_LABELS[detail.plan] || detail.plan}
        </span>
        <span style={{ fontSize: '0.72rem', color: T.text, fontWeight: 700 }}>
          {detail.balance} credits
        </span>
      </div>

      {/* Breakdown */}
      <div style={{
        fontSize: '0.64rem', color: T.muted, lineHeight: 1.9,
        padding: '6px 8px', borderRadius: 6,
        background: 'rgba(255,255,255,0.03)', marginBottom: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Monthly credits</span><span style={{ color: T.text }}>{detail.credits}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Rollover</span><span style={{ color: detail.rollover > 0 ? T.success : T.subtle }}>{detail.rollover}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Top-up</span><span style={{ color: detail.topup > 0 ? T.success : T.subtle }}>{detail.topup}</span>
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${T.border}`, margin: '0 -14px 10px' }} />

      <div style={{
        fontSize: '0.59rem', fontWeight: 800, color: T.muted,
        letterSpacing: '0.07em', marginBottom: 6,
      }}>CHANGE PLAN</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {Object.entries(PLAN_LABELS).map(([key, label]) => {
          const active = key === detail.plan;
          return (
            <button
              key={key}
              onClick={() => { onSetPlan(key); onClose(); }}
              style={{
                padding: '6px 8px', borderRadius: 7, cursor: 'pointer',
                background: active ? 'rgba(157,111,255,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? T.accentBorder : 'rgba(255,255,255,0.07)'}`,
                color: active ? T.accent : T.muted,
                textAlign: 'left', transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
            >
              <div style={{ fontSize: '0.67rem', fontWeight: active ? 700 : 500 }}>{label}</div>
              <div style={{ fontSize: '0.58rem', opacity: 0.65 }}>{PLAN_CR[key].toLocaleString()} cr</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Brief collection modal ────────────────────────────────────────────────────

const BRIEF_FIELD_LABELS = {
  topic:              'What is the video topic?',
  angle:              'What angle or perspective are you taking?',
  audience_level:     'Who is your audience?',
  destination:        'What destination does this video cover?',
  trip_duration:      'How long was the trip?',
  best_moments:       'Your 3 best moments from the footage?',
  challenge_or_surprise: 'Biggest challenge or surprise?',
  mood_vibe:          'What is the mood/vibe?',
  duration:           'How long is the video?',
  travel_style:       'Travel style? (budget / luxury / adventure)',
  audience_type:      'Who is this for?',
  target_audience:    'Target audience?',
  depth_level:        'Depth level? (intro / intermediate / expert)',
  time_period:        'What time period does this cover?',
  narrative_angle:    'Narrative angle?',
  premise:            'Core premise or concept?',
  tone:               'What tone are you going for?',
};

function BriefModal({ fields, threadId, niche, onSubmit, onSkip }) {
  const [values, setValues] = useState({});

  const set = (f, v) => setValues(prev => ({ ...prev, [f]: v }));
  const filled = fields.filter(f => values[f]?.trim()).length;
  const canSubmit = filled >= Math.min(2, fields.length);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      await fetch(`${API}/api/copilot/thread/${threadId}/brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: values }),
      });
    } catch (_) {}
    onSubmit(values);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(10,10,14,0.96)', backdropFilter: 'blur(10px)',
        display: 'flex', flexDirection: 'column', padding: '24px 20px 20px',
        overflowY: 'auto',
      }}
    >
      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: T.text, marginBottom: 4 }}>
        Tell me about your video
      </div>
      <div style={{ fontSize: '0.72rem', color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
        {niche ? `${niche.replace(/_/g, ' ')} — ` : ''}Fill in what you can. I'll write around any blanks.
      </div>

      <div style={{ flex: 1 }}>
        {fields.map(f => (
          <div key={f} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: T.muted, marginBottom: 5 }}>
              {BRIEF_FIELD_LABELS[f] || f}
            </div>
            <textarea
              rows={2}
              value={values[f] || ''}
              onChange={e => set(f, e.target.value)}
              placeholder={`Your answer…`}
              style={{
                width: '100%', resize: 'none', borderRadius: 8, padding: '7px 10px',
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
                color: T.text, fontSize: '0.78rem', fontFamily: 'inherit', lineHeight: 1.5,
                outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = T.accentBorder}
              onBlur={e => e.target.style.borderColor = T.border}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '10px', borderRadius: 9, border: 'none',
            cursor: canSubmit ? 'pointer' : 'default',
            background: canSubmit
              ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
              : 'rgba(255,255,255,0.06)',
            color: canSubmit ? '#fff' : T.subtle,
            fontSize: '0.8rem', fontWeight: 600,
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          Generate script
        </motion.button>
        <button
          onClick={onSkip}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.subtle, fontSize: '0.7rem', padding: '4px', lineHeight: 1.5,
          }}
        >
          Skip — write with general structure only
        </button>
      </div>
    </motion.div>
  );
}

// ── Voice setup modal ─────────────────────────────────────────────────────────

function VoiceSetupModal({ channelId, onComplete, onSkip, onDismiss }) {
  const [scripts,   setScripts]   = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [skipping,  setSkipping]  = useState(false);
  const [error,     setError]     = useState(null);

  const handleAnalyze = async () => {
    if (!scripts.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res  = await fetch(`${API}/api/copilot/voice/${channelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scripts: scripts.trim() }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setAnalyzing(false); return; }
      onComplete(data);
    } catch (_) {
      setError('Analysis failed. Check your connection and try again.');
      setAnalyzing(false);
    }
  };

  const handleSkip = async (e) => {
    e.stopPropagation();
    if (skipping) return;
    setSkipping(true);
    await onSkip();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'rgba(10,10,14,0.96)',
        backdropFilter: 'blur(10px)',
        display: 'flex', flexDirection: 'column',
        padding: '22px 22px 22px',
      }}
    >
      {/* Header row with close button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: T.text, lineHeight: 1.3 }}>
          Help Copilot sound like you
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDismiss(); }}
          style={{
            width: 26, height: 26, borderRadius: 6, flexShrink: 0, marginLeft: 8,
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${T.border}`,
            color: T.muted, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <IconX size={12} />
        </button>
      </div>
      <div style={{ fontSize: '0.74rem', color: T.muted, marginBottom: 16, lineHeight: 1.55 }}>
        Paste 2–3 of your recent video scripts. Copilot will learn your tone, language, and style — all future hooks, outlines, and scripts will match your voice.
      </div>
      <textarea
        value={scripts}
        onChange={e => setScripts(e.target.value)}
        placeholder="Paste your video scripts here — the more detail, the better your voice profile…"
        style={{
          flex: 1, resize: 'none', borderRadius: 10, padding: '10px 12px',
          background: 'rgba(255,255,255,0.04)', border: `1px solid ${T.border}`,
          color: T.text, fontSize: '0.78rem', fontFamily: 'inherit', lineHeight: 1.55,
          outline: 'none',
        }}
        onFocus={e => e.target.style.borderColor = T.accentBorder}
        onBlur={e => e.target.style.borderColor = T.border}
      />
      {error && (
        <div style={{ fontSize: '0.72rem', color: '#ff6b6b', marginTop: 8 }}>{error}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={handleAnalyze}
          disabled={!scripts.trim() || analyzing}
          style={{
            padding: '10px', borderRadius: 9, border: 'none',
            cursor: scripts.trim() && !analyzing ? 'pointer' : 'default',
            background: scripts.trim() && !analyzing
              ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
              : 'rgba(255,255,255,0.06)',
            color: scripts.trim() && !analyzing ? '#fff' : T.subtle,
            fontSize: '0.8rem', fontWeight: 600,
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {analyzing ? 'Analyzing your voice…' : 'Analyze & Save'}
        </motion.button>
        <button
          onClick={handleSkip}
          disabled={skipping}
          style={{
            background: 'none', border: 'none', cursor: skipping ? 'default' : 'pointer',
            color: T.subtle, fontSize: '0.7rem', padding: '4px',
            lineHeight: 1.5, opacity: skipping ? 0.5 : 1,
          }}
        >
          {skipping ? 'Skipping…' : 'Skip for now — scripts may not feel like your content'}
        </button>
      </div>
    </motion.div>
  );
}

// ── Settings overflow menu ────────────────────────────────────────────────────

function SettingsMenu({ format, setFormat, isHinglish, setLang, channelId, voiceReady, voiceSkipped, onVoiceModal, onVoiceDelete, canReset, onReset }) {
  const row = {
    display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left',
    padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
    background: 'none', border: 'none', color: T.muted, fontSize: '0.73rem', fontWeight: 500,
  };
  const label = {
    fontSize: '0.58rem', fontWeight: 700, color: T.subtle,
    letterSpacing: '0.1em', marginBottom: 5, paddingLeft: 1,
  };
  const seg = (active) => ({
    flex: 1, padding: '5px 4px', cursor: 'pointer', border: 'none',
    background: active ? '#7C3AED' : 'transparent',
    color: active ? '#fff' : T.muted,
    fontSize: '0.68rem', fontWeight: 600, transition: 'all 0.12s',
  });
  const divider = { height: 1, background: T.border, margin: '8px -10px' };

  return (
    <div style={{
      position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40,
      background: 'rgba(12,12,18,0.99)', border: `1px solid rgba(255,255,255,0.1)`,
      borderRadius: 12, padding: 10, minWidth: 214,
      boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
      backdropFilter: 'blur(24px)',
    }}>
      <div style={{ marginBottom: 10 }}>
        <div style={label}>FORMAT</div>
        <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          {[{ val: 'long', label: 'Long-form' }, { val: 'short', label: 'Shorts' }, { val: 'mixed', label: 'Both' }].map(({ val, label: l }) => (
            <button key={val} onClick={() => setFormat(val)} style={seg(format === val)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 2 }}>
        <div style={label}>LANGUAGE</div>
        <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          {[{ val: 'en', l: 'English' }, { val: 'hi', l: 'Hinglish' }].map(({ val, l }) => (
            <button key={val} onClick={() => setLang(val)} style={seg(val === 'hi' ? isHinglish : !isHinglish)}>{l}</button>
          ))}
        </div>
      </div>

      {channelId && (
        <>
          <div style={divider} />
          <div style={{ ...label, marginTop: 8, marginBottom: 6 }}>VOICE PROFILE</div>
          {voiceReady ? (
            <div style={{ display: 'flex', gap: 5 }}>
              <button onClick={onVoiceModal} style={{ ...row, flex: 1, justifyContent: 'center', background: 'rgba(18,217,138,0.08)', border: '1px solid rgba(18,217,138,0.18)', color: T.success, fontSize: '0.7rem', fontWeight: 600 }}>
                Voice ✓ · Update
              </button>
              <button onClick={onVoiceDelete} style={{ ...row, padding: '7px 10px', background: 'rgba(255,80,80,0.07)', border: '1px solid rgba(255,80,80,0.15)', color: '#ff7070', fontSize: '0.7rem', fontWeight: 600 }}>
                Delete
              </button>
            </div>
          ) : (
            <button onClick={onVoiceModal} style={{ ...row }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {voiceSkipped ? '+ Set voice profile' : '+ Add voice profile'}
            </button>
          )}
        </>
      )}

      {canReset && (
        <>
          <div style={divider} />
          <button onClick={onReset} style={{ ...row, marginTop: 2 }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            ↺ New chat
          </button>
        </>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function CopilotPanel({ channel }) {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lang,    setLang]    = useState(null); // null = auto from channel
  const [format,  setFormat]  = useState('long'); // 'long' | 'short' | 'mixed'
  const [voiceProfile,       setVoiceProfile]       = useState(undefined); // undefined=loading, null=none
  const [showVoiceModal,     setShowVoiceModal]     = useState(false);
  const [showVoiceManage,    setShowVoiceManage]    = useState(false);
  const [pendingScriptAction, setPendingScriptAction] = useState(null);
  const [creditBalance,       setCreditBalance]       = useState(null);
  const [creditDetail,        setCreditDetail]        = useState(null);
  const [showCreditPanel,     setShowCreditPanel]     = useState(false);
  const [showSettingsMenu,    setShowSettingsMenu]    = useState(false);
  // Thread state
  const threadIdRef   = useRef(genId());  // stable across re-renders, reset on new chat
  const [threadState, setThreadState]   = useState(null);
  const [showBriefModal, setShowBriefModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState(null); // message to resend after brief
  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const sendRef   = useRef(null);

  const channelId  = channel?.channel_id || null;
  const activeLang = lang || channel?.language || 'en';
  const isHinglish = activeLang === 'hi';
  const voiceLoaded  = voiceProfile !== undefined;
  const voiceReady   = voiceProfile?.voice_analysis != null;
  const voiceSkipped = voiceProfile != null && !voiceReady && voiceProfile.skipped_at != null;

  useEffect(() => {
    if (!channelId) { setVoiceProfile(null); return; }
    fetch(`${API}/api/copilot/voice/${channelId}`)
      .then(r => r.json())
      .then(data => setVoiceProfile(data))
      .catch(() => setVoiceProfile(null));
  }, [channelId]);

  const storageKey  = `copilot_draft_${channelId || 'none'}`;
  const langPrefKey = `copilot_lang_pref_${channelId || 'none'}`;

  const greeting = {
    role: 'assistant',
    content: channel
      ? `Hi! I'm your TubeIntel Copilot. I know your channel, your peer community, and what's working in your niche. What do you want to figure out?`
      : `Hi! I'm TubeIntel Copilot. Search for a channel first and I can give you specific insights about peers, topics, and opportunities.`,
    cards: [], actions: [], placeholders: [],
  };

  // Load draft from localStorage when channel changes; auto-load evolution snapshot on fresh start
  useEffect(() => {
    // Restore lang preference from its own key first (survives draft resets/expiry)
    try {
      const savedLang = localStorage.getItem(langPrefKey);
      if (savedLang === 'en' || savedLang === 'hi') setLang(savedLang);
    } catch (_) {}

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        const age = Date.now() - (saved.savedAt || 0);
        if (age < 7 * 24 * 60 * 60 * 1000 && Array.isArray(saved.messages) && saved.messages.length > 1) {
          setMessages(saved.messages);
          if (saved.threadState) setThreadState(saved.threadState);
          if (saved.lang) setLang(saved.lang); // draft lang overrides pref if explicitly set
          return;
        }
      }
    } catch (_) {}

    // Fresh conversation — show greeting then auto-inject evolution snapshot if data exists
    if (!channelId) {
      setMessages([greeting]);
      setThreadState(null);
      return;
    }
    setMessages([greeting]);
    setThreadState(null);
    fetch(`${API}/api/intel/evolution/${channelId}?period=30d`)
      .then(r => r.json())
      .then(data => {
        if (!data.ok || data.no_data) return;
        setMessages(prev => {
          if (prev.length > 1) return prev; // user already started typing — don't inject
          const evoMsg = {
            role: 'assistant',
            content: buildEvoSummary(data),
            cards: [{ type: 'evolution', data }],
            actions: [],
            placeholders: [],
          };
          return [...prev, evoMsg];
        });
      })
      .catch(() => {});
  }, [channelId]);

  function buildEvoSummary(d) {
    const parts = [];
    if (d.view_change_pct != null) {
      parts.push(d.view_change_pct > 0
        ? `Your views are up ${d.view_change_pct}% vs the prior 30 days.`
        : d.view_change_pct < 0
        ? `Your views are down ${Math.abs(d.view_change_pct)}% vs the prior 30 days.`
        : 'Your view count is holding steady.');
    }
    if (d.notable_event) parts.push(`You had a viral spike — one video hit ${d.notable_event.magnitude}× your normal views.`);
    if (d.upload_delta > 0.5) parts.push(`You're uploading more frequently than usual.`);
    else if (d.upload_delta < -0.5) parts.push(`Your upload pace has slowed.`);
    parts.push('Here\'s your 30-day snapshot. Ask me anything.');
    return parts.join(' ');
  }

  // Persist lang preference to its own key so it survives draft resets
  useEffect(() => {
    if (lang === null) return;
    try { localStorage.setItem(langPrefKey, lang); } catch (_) {}
  }, [lang, langPrefKey]);

  // Save draft + language preference to localStorage whenever messages change
  useEffect(() => {
    if (messages.length <= 1) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ messages, threadState, lang, savedAt: Date.now() }));
    } catch (_) {}
  }, [messages, threadState, lang]);

  // Fetch credit balance when panel opens
  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/credits/balance?client_id=${encodeURIComponent(getClientId())}`)
      .then(r => r.json())
      .then(d => { if (d.balance != null) setCreditBalance(d.balance); })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    const handler = (e) => {
      const { prompt, idea, podcastTheme } = e.detail || {};
      setOpen(true);

      if (podcastTheme) {
        const title = podcastTheme.title || 'this podcast theme';
        const ctxParts = [];
        if (podcastTheme.evidence) ctxParts.push(`peer evidence: ${podcastTheme.evidence}`);
        if (podcastTheme.guest) ctxParts.push(`guest type: ${podcastTheme.guest}`);
        if (podcastTheme.peer_count) ctxParts.push(`${podcastTheme.peer_count} peer${podcastTheme.peer_count === 1 ? '' : 's'}`);
        if (podcastTheme.avg_views > 0) ctxParts.push(`${podcastTheme.avg_views >= 1000 ? `${(podcastTheme.avg_views / 1000).toFixed(0)}K` : podcastTheme.avg_views} avg views`);
        const ctxLine = ctxParts.length ? `\n\nContext: ${ctxParts.join(' · ')}.` : '';
        const angleLine = podcastTheme.angle ? `\n\nCurrent angle: ${podcastTheme.angle}` : '';

        const userMsg = { role: 'user', content: `I want to build a podcast episode around "${title}".` };
        const assistantMsg = {
          role: 'assistant',
          content: `Good theme. I can help shape this into a watchable conversation instead of just a topic.${ctxLine}${angleLine}\n\nWhat should we build first?`,
          draftable: false,
          draft_topic: title,
          cards: [],
          actions: [
            { type: 'podcast_episode_plan', label: 'Build episode arc', payload: podcastTheme },
            { type: 'podcast_questions',    label: 'Draft questions',   payload: podcastTheme },
            { type: 'podcast_pushback',     label: 'Find tension',      payload: podcastTheme },
            { type: 'podcast_clips',        label: 'Plan clips',        payload: podcastTheme },
          ],
          placeholders: [],
        };
        setMessages(prev => [...prev, userMsg, assistantMsg]);
        return;
      }

      if (idea) {
        // Inject user message + instant assistant reply with action buttons (no API call)
        const topic = idea.topic;
        const ctxParts = [];
        if (idea.avg_views > 0) ctxParts.push(`averages ${idea.avg_views >= 1000 ? `${(idea.avg_views / 1000).toFixed(0)}K` : idea.avg_views} views in your community`);
        if (idea.format_winner) ctxParts.push(`${idea.format_winner.label} format wins at ${idea.format_winner.pct}%`);
        if (idea.score >= 80) ctxParts.push(`opportunity score ${idea.score}/100`);
        const ctxLine = ctxParts.length ? ` This topic ${ctxParts.join(', ')}.` : '';

        const userMsg = { role: 'user', content: `I want to create a video on "${topic}".` };
        const assistantMsg = {
          role: 'assistant',
          content: `Good choice.${ctxLine} What do you want to build first?`,
          cards: [],
          actions: [
            { type: 'draft_outline', label: 'Draft outline',      payload: { topic } },
            { type: 'write_hook',    label: 'Write hook script',  payload: { topic } },
            { type: 'write_body',    label: 'Write body script',  payload: { topic } },
            { type: 'write_ending',  label: 'Write ending & CTA', payload: { topic } },
          ],
          placeholders: [],
        };
        setMessages(prev => [...prev, userMsg, assistantMsg]);
        return;
      }

      if (prompt) {
        setTimeout(() => sendRef.current?.(prompt), 320);
      }
    };
    window.addEventListener('copilot:open', handler);
    return () => window.removeEventListener('copilot:open', handler);
  }, []);

  const handleSave = async (msg) => {
    // Preferred version wins per part; if none marked, latest wins
    const partMap = new Map(); // key → { card, msgIndex, preferred }
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      for (const c of (m.cards || [])) {
        if (c.type !== 'outline' && c.type !== 'script') continue;
        const key = c.type === 'script' ? `script:${c.data?.part || 'body'}` : 'outline';
        const existing = partMap.get(key);
        if (!existing) {
          partMap.set(key, { card: c, msgIndex: i, preferred: !!m.preferred });
        } else if (m.preferred && !existing.preferred) {
          partMap.set(key, { card: c, msgIndex: i, preferred: true });
        } else if (!m.preferred && !existing.preferred) {
          partMap.set(key, { card: c, msgIndex: i, preferred: false });
        }
      }
    }
    const allCards = [...partMap.values()].sort((a, b) => a.msgIndex - b.msgIndex).map(v => v.card);
    const msgHasScriptDraftCards = msg.cards?.some(c => ['outline', 'script'].includes(c.type));
    let cardsToSave = msgHasScriptDraftCards && allCards.length > 0 ? allCards : (msg.cards || []);
    const topic = msg.draft_topic
      || cardsToSave.find(c => c.data?.topic)?.data?.topic
      || cardsToSave.find(c => c.data?.title)?.data?.title
      || threadState?.topic
      || null;

    if (cardsToSave.length === 0 && msg.content) {
      cardsToSave = [{
        type: 'note',
        data: {
          topic,
          title: topic || noteSectionFromMessage(msg),
          section: noteSectionFromMessage(msg),
          content: msg.content,
          saved_at: new Date().toISOString(),
        },
      }];
    }

    if (!cardsToSave.length) return;

    const draftKey = [
      getClientId(),
      channelId || 'no-channel',
      normalizeDraftTopic(topic),
      threadIdRef.current || 'default',
    ].join(':');

    try {
      await fetch(`${API}/api/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:  getClientId(),
          channel_id: channelId,
          topic,
          thread_id:  threadIdRef.current,
          draft_key:  draftKey,
          cards:      cardsToSave,
        }),
      });
      // Mark this saved; for full scripts/outlines, mark related card versions too.
      setMessages(prev => prev.map(m =>
        m === msg ? { ...m, saved: true }
          : (m.cards?.some(c => ['outline', 'script'].includes(c.type)) && cardsToSave.some(c => ['outline', 'script'].includes(c.type)))
            ? { ...m, saved: true }
            : m
      ));
    } catch (_) {}
  };

  const openCreditPanel = () => {
    fetch(`${API}/api/credits/balance?client_id=${encodeURIComponent(getClientId())}`)
      .then(r => r.json())
      .then(d => { setCreditDetail(d); setShowCreditPanel(true); })
      .catch(() => {});
  };

  const handleSetPlan = async (plan) => {
    const res = await fetch(`${API}/api/credits/set-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: getClientId(), plan }),
    }).then(r => r.json()).catch(() => null);
    if (res?.balance != null) {
      setCreditBalance(res.balance);
      setCreditDetail(d => d ? { ...d, plan, balance: res.balance, credits: res.credits, rollover: 0 } : null);
    }
  };

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');

    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${API}/api/copilot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:    msg,
          channel_id: channelId,
          history,
          lang:       activeLang,
          format,
          thread_id:  threadIdRef.current,
          client_id:  getClientId(),
        }),
      });
      const data = await res.json();

      if (data.credits?.balance != null) setCreditBalance(data.credits.balance);

      if (data.error === 'insufficient_credits') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message || 'Not enough credits for this action.',
          cards: [], actions: [], placeholders: [],
        }]);
      } else if (data.error) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Something went wrong: ${data.error}`,
          cards: [], actions: [], placeholders: [],
        }]);
      } else {
        // Update thread state
        if (data.thread_state) setThreadState(data.thread_state);

        setMessages(prev => [...prev, {
          role:         'assistant',
          content:      data.answer,
          cards:        data.cards        || [],
          actions:      data.actions      || [],
          placeholders: data.placeholders || [],
          evidence:     data.evidence     || [],
          thread_state: data.thread_state || null,
          credits:      data.credits      || null,
        }]);
      }
    } catch (_) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Could not reach the server. Make sure the backend is running.',
        cards: [], actions: [], placeholders: [],
      }]);
    } finally {
      setLoading(false);
    }
  };

  const executeAction = (action) => {
    const t = action.payload?.topic || '';
    const n = action.payload?.niche  || '';
    if (action.type?.startsWith('podcast_')) {
      const answer = buildPodcastActionMessage(action.type, action.payload);
      if (answer) {
        setMessages(prev => [
          ...prev,
          { role: 'user', content: action.label || 'Build this podcast idea' },
          {
            role: 'assistant',
            content: answer,
            draftable: true,
            draft_topic: action.payload?.title || action.payload?.theme || null,
            draft_section: noteSectionFromMessage({ content: answer }),
            cards: [],
            actions: [
              { type: 'podcast_episode_plan', label: 'Build episode arc', payload: action.payload },
              { type: 'podcast_questions',    label: 'Draft questions',   payload: action.payload },
              { type: 'podcast_pushback',     label: 'Find tension',      payload: action.payload },
              { type: 'podcast_clips',        label: 'Plan clips',        payload: action.payload },
            ].filter(a => a.type !== action.type),
            placeholders: [],
          },
        ]);
        return;
      }
    }
    const podcastTitle = action.payload?.title || action.payload?.theme || 'this podcast episode';
    const podcastGuest = action.payload?.guest ? ` Guest type: ${action.payload.guest}.` : '';
    const podcastEvidence = action.payload?.evidence ? ` Peer evidence: ${action.payload.evidence}.` : '';
    const podcastAngle = action.payload?.angle ? ` Current angle: ${action.payload.angle}` : '';
    switch (action.type) {
      case 'track_niche':      return send(`Track the "${n}" topic for me`);
      case 'compare_channel':  return send(`Compare me with channel ${action.payload?.channel_id}`);
      case 'save_idea':        return send(`Save "${t}" as a content idea`);
      case 'draft_outline':    return send(`Draft a full video outline for "${t}"`);
      case 'write_hook':       return send(`Write the opening 60-second script for "${t}"`);
      case 'write_body':       return send(`Write the full detailed body script for "${t}"`);
      case 'write_ending':     return send(`Write the ending and CTA for "${t}"`);
      case 'podcast_episode_plan':
        return send(`Build a strong podcast episode arc for "${podcastTitle}".${podcastGuest}${podcastEvidence}${podcastAngle} Give me: opening hook, central tension, 5-part conversation structure, climax, ending, and the exact host stance.`);
      case 'podcast_questions':
        return send(`Draft the first 12 podcast questions for "${podcastTitle}".${podcastGuest}${podcastEvidence}${podcastAngle} Make them conversational, increasingly deep, and include follow-up probes.`);
      case 'podcast_pushback':
        return send(`Find the strongest debate tension for a podcast episode on "${podcastTitle}".${podcastGuest}${podcastEvidence}${podcastAngle} Give me disagreement points, where the host should challenge the guest, and how to keep it respectful but sharp.`);
      case 'podcast_clips':
        return send(`Plan 8 Shorts/Reels clips from a podcast episode on "${podcastTitle}".${podcastGuest}${podcastEvidence}${podcastAngle} For each clip give hook, setup, payoff, and title.`);
      case 'new_draft':        return send(`Give me a different angle for the "${t}" video outline`);
      case 'regenerate_ideas':  return send('Show me different content opportunities');
      case 'find_opportunity':  return send('What content opportunities am I missing? Find the content gaps I can fill to recover and grow my views.');
    }
  };

  const handleSelectVersion = (msg) => {
    const selectedKeys = new Set(getMsgPartKeys(msg));
    setMessages(prev => prev.map(m => {
      const mKeys = getMsgPartKeys(m);
      const sharesKey = mKeys.some(k => selectedKeys.has(k));
      if (m === msg) return { ...m, preferred: !m.preferred };
      if (sharesKey) return { ...m, preferred: false };
      return m;
    }));
  };

  const handleAction = (action) => {
    const SCRIPT_TYPES = ['write_hook', 'write_body', 'write_ending'];
    if (SCRIPT_TYPES.includes(action.type) && channelId && voiceLoaded && !voiceReady && !voiceSkipped) {
      setPendingScriptAction(action);
      setShowVoiceModal(true);
      return;
    }
    executeAction(action);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const reset = () => {
    try { localStorage.removeItem(storageKey); } catch (_) {}
    threadIdRef.current = genId();
    setThreadState(null);
    setShowBriefModal(false);
    setPendingMessage(null);
    setMessages([greeting]);
  };

  const handleBriefSubmit = (values) => {
    setShowBriefModal(false);
    const msg = pendingMessage;
    setPendingMessage(null);
    if (msg) send(msg);
  };

  const handleBriefSkip = () => {
    setShowBriefModal(false);
    const msg = pendingMessage;
    setPendingMessage(null);
    if (msg) send(msg);
  };

  const handleVoiceComplete = (data) => {
    setVoiceProfile({ voice_analysis: JSON.stringify(data.analysis), sample_sentences: JSON.stringify(data.sample_sentences) });
    setShowVoiceModal(false);
    if (pendingScriptAction) { executeAction(pendingScriptAction); setPendingScriptAction(null); }
  };

  const handleVoiceSkip = async () => {
    if (channelId) {
      await fetch(`${API}/api/copilot/voice/${channelId}/skip`, { method: 'POST' }).catch(() => {});
    }
    setVoiceProfile({ skipped_at: new Date().toISOString() });
    setShowVoiceModal(false);
    if (pendingScriptAction) { executeAction(pendingScriptAction); setPendingScriptAction(null); }
  };

  const handleVoiceDelete = async () => {
    await fetch(`${API}/api/copilot/voice/${channelId}`, { method: 'DELETE' }).catch(() => {});
    setVoiceProfile(null);
    setShowVoiceManage(false);
  };

  sendRef.current = send;

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
          <>
          {/* Backdrop — clicking outside closes the panel */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
          />
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
              padding: '12px 14px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                background: 'linear-gradient(135deg, #7C3AED, #4F46E5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 12px rgba(124,58,237,0.4)',
              }}>
                <IconSparkle size={14} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.83rem', fontWeight: 700, color: T.text, letterSpacing: '-0.01em', lineHeight: 1 }}>
                  Copilot
                </div>
                {channel && (
                  <div style={{ fontSize: '0.67rem', color: T.accent, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel.channel_name || channel.name}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {/* Credits pill */}
                {creditBalance !== null && (
                  <div style={{ position: 'relative' }}>
                    <motion.button
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
                      onClick={() => showCreditPanel ? setShowCreditPanel(false) : openCreditPanel()}
                      style={{
                        padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                        background: showCreditPanel ? 'rgba(157,111,255,0.15)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${showCreditPanel ? T.accentBorder : T.border}`,
                        fontSize: '0.7rem', fontWeight: 700,
                        color: showCreditPanel ? T.accent : T.muted,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {creditBalance} cr
                    </motion.button>
                    {showCreditPanel && creditDetail && (
                      <CreditPanel detail={creditDetail} onSetPlan={handleSetPlan} onClose={() => setShowCreditPanel(false)} />
                    )}
                  </div>
                )}

                {/* Settings overflow */}
                <div style={{ position: 'relative' }}>
                  <motion.button
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                    onClick={() => setShowSettingsMenu(v => !v)}
                    title="Settings"
                    style={{
                      width: 28, height: 28, borderRadius: 7,
                      background: showSettingsMenu ? 'rgba(255,255,255,0.08)' : 'transparent',
                      border: `1px solid ${showSettingsMenu ? T.border : 'transparent'}`,
                      color: T.muted, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.05rem', letterSpacing: '0.04em', lineHeight: 1,
                    }}
                  >
                    ···
                  </motion.button>
                  {showSettingsMenu && (
                    <SettingsMenu
                      format={format} setFormat={setFormat}
                      isHinglish={isHinglish} setLang={setLang}
                      channelId={channelId}
                      voiceReady={voiceReady} voiceSkipped={voiceSkipped}
                      onVoiceModal={() => { setShowVoiceModal(true); setShowSettingsMenu(false); }}
                      onVoiceDelete={() => { handleVoiceDelete(); setShowSettingsMenu(false); }}
                      canReset={messages.length > 1}
                      onReset={() => { reset(); setShowSettingsMenu(false); }}
                    />
                  )}
                </div>

                {/* Close */}
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

            {/* Messages */}
            <div
              ref={scrollRef}
              style={{
                flex: 1, overflowY: 'auto', padding: '16px 14px 8px',
                scrollbarWidth: 'thin', scrollbarColor: `${T.subtle} transparent`,
              }}
            >
              {messages.map((m, i) => (
                <MessageBubble key={i} msg={m} onAction={handleAction} onSave={handleSave} onSelectVersion={handleSelectVersion} />
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

            {/* Brief collection modal */}
            <AnimatePresence>
              {showBriefModal && threadState?.brief_fields && (
                <BriefModal
                  fields={threadState.brief_fields}
                  threadId={threadIdRef.current}
                  niche={threadState.niche}
                  onSubmit={handleBriefSubmit}
                  onSkip={handleBriefSkip}
                />
              )}
            </AnimatePresence>

            {/* Voice setup modal — overlays message+input area */}
            <AnimatePresence>
              {showVoiceModal && channelId && (
                <VoiceSetupModal
                  channelId={channelId}
                  onComplete={handleVoiceComplete}
                  onSkip={handleVoiceSkip}
                  onDismiss={() => setShowVoiceModal(false)}
                />
              )}
            </AnimatePresence>

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
                <button
                  onClick={() => setLang(isHinglish ? 'en' : 'hi')}
                  title={isHinglish ? 'Generating in Hinglish — click to switch to English' : 'Generating in English — click to switch to Hinglish'}
                  style={{
                    padding: '3px 7px', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
                    background: isHinglish ? 'rgba(255,179,0,0.1)' : 'rgba(79,130,255,0.1)',
                    border: `1px solid ${isHinglish ? 'rgba(255,179,0,0.28)' : 'rgba(79,130,255,0.28)'}`,
                    color: isHinglish ? '#FFBA00' : '#5B9AFF',
                    fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.04em',
                  }}
                >
                  {isHinglish ? 'HI' : 'EN'}
                </button>
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
          </>
        )}
      </AnimatePresence>
    </>
  );
}
