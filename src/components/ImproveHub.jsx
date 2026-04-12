import { useState, useEffect } from 'react';
import { generateVideoImprovements } from '../api/claude';
import { ScoreRing } from './VideoAnalysisPrimitives';

const IMPROVE_KEY = 'tubeintel_improve_';

const CHECKLIST_KEYS = ['title', 'hook', 'thumbnail', 'cta'];
const CHECKLIST_META = {
  title:     { icon: '🎯', label: 'Title',     sublabel: 'CTR' },
  hook:      { icon: '🎣', label: 'Hook',       sublabel: 'Retention' },
  thumbnail: { icon: '🖼️', label: 'Thumbnail',  sublabel: 'CTR boost' },
  cta:       { icon: '📢', label: 'CTA',         sublabel: 'Comments' },
};


// ── Empty state card ──────────────────────────────────────────────────────────
function EmptyCard({ emoji, title, sub, cta, onCta }) {
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 16,
      padding: '48px 32px', textAlign: 'center', maxWidth: 480, margin: '0 auto',
    }}>
      <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>{emoji}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#e0e0e0', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: '0.85rem', color: '#555', lineHeight: 1.7, marginBottom: 24 }}>{sub}</div>
      <button onClick={onCta} style={{
        background: 'linear-gradient(135deg, #1e1040 0%, #3b0f8c 100%)',
        color: '#f3e8ff', border: '1px solid #9d6efd99',
        borderRadius: 10, padding: '12px 28px',
        fontWeight: 800, fontSize: '0.88rem', cursor: 'pointer',
        boxShadow: '0 0 16px rgba(124,58,237,0.25)',
      }}>{cta}</button>
    </div>
  );
}

// ── CopyButton ────────────────────────────────────────────────────────────────
function CopyButton({ text, small, onCopied }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} style={{
      padding: small ? '3px 10px' : '5px 14px',
      borderRadius: 6, cursor: 'pointer', flexShrink: 0,
      border: copied ? '1px solid #22c55e55' : '1px solid #2a2a2a',
      background: copied ? '#0b1f0e' : '#1a1a1a',
      color: copied ? '#22c55e' : '#888',
      fontSize: small ? '0.68rem' : '0.72rem', fontWeight: 700,
      transition: 'all 0.15s',
    }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// ── ScoreBar ──────────────────────────────────────────────────────────────────
function ScoreBar({ label, baseline, projected, active }) {
  const displayed = active ? projected : baseline;
  const delta = projected - baseline;
  const color = displayed >= 75 ? '#00c853' : displayed >= 55 ? '#ff9100' : '#ff1744';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: '0.7rem' }}>
        <span style={{ color: '#555' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {active && delta > 0 && (
            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#22c55e', background: '#0b1f0e', border: '1px solid #22c55e33', borderRadius: 4, padding: '1px 5px' }}>
              +{delta}
            </span>
          )}
          <span style={{ color, fontWeight: 700 }}>{displayed}</span>
        </div>
      </div>
      <div style={{ height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${displayed}%`,
          background: active ? `linear-gradient(90deg, ${color}, ${color}99)` : color,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
          boxShadow: active ? `0 0 8px ${color}66` : 'none',
        }} />
      </div>
    </div>
  );
}

// ── DimensionPanel ────────────────────────────────────────────────────────────
const DIM_LABELS = [
  { key: 'titleThumbnail',     label: 'Title & Thumb' },
  { key: 'hookRetention',      label: 'Hook & Retention' },
  { key: 'contentStructure',   label: 'Content Structure' },
  { key: 'engagement',         label: 'Engagement' },
  { key: 'algorithm',          label: 'Algorithm' },
  { key: 'seoDiscoverability', label: 'SEO' },
  { key: 'emotionalImpact',    label: 'Emotional Impact' },
  { key: 'valueDelivery',      label: 'Value Delivery' },
];

function DimensionPanel({ aiData, improvements, selectedTitle, selectedThumbnail, selectedFixes }) {
  const bp = aiData?.blueprint || {};
  const baseScores = bp.scores || {};
  const baseOverall = bp.overallScore ?? 0;

  // Merge projected dims from all active selections
  const projDims = { ...baseScores };
  let overallDelta = 0;

  if (selectedTitle !== null) {
    const t = improvements?.titles?.[selectedTitle];
    if (t) {
      if (t.projectedDimensions?.titleThumbnail != null)
        projDims.titleThumbnail = t.projectedDimensions.titleThumbnail;
      if (t.projectedOverall != null) overallDelta += t.projectedOverall - baseOverall;
    }
  }
  if (selectedThumbnail !== null) {
    const th = improvements?.thumbnails?.[selectedThumbnail];
    if (th) {
      if (th.projectedDimensions?.titleThumbnail != null)
        projDims.titleThumbnail = Math.max(projDims.titleThumbnail ?? 0, th.projectedDimensions.titleThumbnail);
      if (th.projectedOverall != null) overallDelta += th.projectedOverall - baseOverall;
    }
  }
  if (selectedFixes.hook) {
    const h = improvements?.hook;
    if (h?.projectedDimensions?.hookRetention != null) projDims.hookRetention = h.projectedDimensions.hookRetention;
    if (h?.projectedOverall != null) overallDelta += h.projectedOverall - baseOverall;
  }
  if (selectedFixes.cta) {
    const c = improvements?.cta;
    if (c?.projectedDimensions?.engagement != null) projDims.engagement = c.projectedDimensions.engagement;
    if (c?.projectedOverall != null) overallDelta += c.projectedOverall - baseOverall;
  }

  const projOverall = Math.min(100, Math.max(0, Math.round(baseOverall + overallDelta)));
  const anyActive = selectedTitle !== null || selectedThumbnail !== null || selectedFixes.hook || selectedFixes.cta;

  return (
    <div style={{ background: '#09090f', border: `1px solid ${anyActive ? '#7c3aed44' : '#1e1e2e'}`, borderRadius: 14, padding: '16px 18px', transition: 'border-color 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: anyActive ? '#7c3aed' : '#444' }}>
            📊 Estimated Creative Impact
          </div>
          <div style={{ fontSize: '0.68rem', color: '#333', marginTop: 3 }}>
            {anyActive ? 'Showing projected scores with selected fixes' : 'Select fixes below to simulate their impact'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.6rem', color: '#444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Overall</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1, color: projOverall >= 75 ? '#00c853' : projOverall >= 55 ? '#ff9100' : '#ff1744', transition: 'color 0.4s' }}>
              {projOverall}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#444' }}>/100</span>
            {anyActive && overallDelta > 0 && (
              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#22c55e', background: '#0b1f0e', border: '1px solid #22c55e33', borderRadius: 4, padding: '1px 6px', marginLeft: 4 }}>
                +{Math.round(overallDelta)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div style={{ fontSize: '0.65rem', color: '#2a2a2a', marginBottom: 14, lineHeight: 1.5 }}>
        Scores reflect content quality signals. Actual YouTube performance depends on posting time, niche competition, and algorithm factors beyond these metrics.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8, justifyItems: 'center' }}>
        {DIM_LABELS.map(({ key, label }) => {
          const base = baseScores[key] ?? 0;
          const proj = projDims[key] ?? base;
          const delta = Math.round(proj - base);
          const changed = anyActive && delta !== 0;
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <ScoreRing score={proj} label={label} size={68} />
              {changed && delta > 0 && (
                <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#22c55e', background: '#0b1f0e', border: '1px solid #22c55e33', borderRadius: 4, padding: '1px 5px' }}>
                  +{delta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FixChecklist ──────────────────────────────────────────────────────────────
function FixChecklist({ improvements, done, onMark, aiData, bestCombo, onBestFix }) {
  const getText = key => {
    if (key === 'title')     return improvements?.titles?.[0]?.text || '';
    if (key === 'hook')      return improvements?.hook?.text || '';
    if (key === 'cta')       return improvements?.cta?.text || '';
    if (key === 'thumbnail') return aiData?.titleThumbnail?.thumbnailTips?.[0] || '';
    return '';
  };

  const completed = CHECKLIST_KEYS.filter(k => done[k]).length;

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #7c3aed22', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a78bfa' }}>
          ✨ Best Fix for Your Video
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: '0.72rem', color: completed === 4 ? '#22c55e' : '#555', fontWeight: 700 }}>
            {completed}/4 done
          </div>
          <button
            onClick={onBestFix}
            style={{
              padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 800,
              border: bestCombo ? '1px solid #22c55e66' : '1px solid #ef444466',
              background: bestCombo ? 'linear-gradient(135deg, #0b1a0b, #0f2e0f)' : 'linear-gradient(135deg, #1f0808, #3f0f0f)',
              color: bestCombo ? '#4ade80' : '#fca5a5', letterSpacing: '0.04em',
              boxShadow: bestCombo ? '0 0 10px #22c55e22' : '0 0 10px #ef444422', transition: 'all 0.2s',
            }}
          >
            ⚡ Best Fix
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, borderRadius: 99, background: '#1a1a1a', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          height: '100%', borderRadius: 99,
          width: `${(completed / 4) * 100}%`,
          background: completed === 4 ? '#22c55e' : 'linear-gradient(90deg, #7c3aed, #a78bfa)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHECKLIST_KEYS.map(key => {
          const { icon, label, sublabel } = CHECKLIST_META[key];
          const text = getText(key);
          const isDone = !!done[key];
          const isRecommended = bestCombo?.includes(key);
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: isDone ? '#0b1a0b' : isRecommended ? '#110d1f' : '#111',
              border: `1px solid ${isDone ? '#22c55e22' : isRecommended ? '#7c3aed55' : '#1a1a1a'}`,
              borderRadius: 8, padding: '9px 12px',
              opacity: isDone ? 0.7 : 1,
              transition: 'all 0.4s ease',
              boxShadow: isRecommended && !isDone ? '0 0 10px #7c3aed18' : 'none',
            }}>
              {/* Checkbox */}
              <div
                onClick={() => onMark(key)}
                style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${isDone ? '#22c55e' : isRecommended ? '#7c3aed' : '#333'}`,
                  background: isDone ? '#22c55e22' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', fontSize: '0.65rem', color: '#22c55e',
                }}
              >
                {isDone ? '✓' : ''}
              </div>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isDone ? '#4ade80' : isRecommended ? '#c4b5fd' : '#555', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
                  <span style={{ fontSize: '0.62rem', background: '#1a1a1a', border: '1px solid #222', borderRadius: 4, padding: '1px 6px', color: '#444', fontWeight: 600 }}>{sublabel}</span>
                  {isRecommended && !isDone && (
                    <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#a78bfa', background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 4, padding: '1px 6px' }}>
                      ★ Recommended
                    </span>
                  )}
                </div>
                {text && (
                  <div style={{ fontSize: '0.78rem', color: isDone ? '#555' : isRecommended ? '#ccc' : '#bbb', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
                    {text}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {text && <CopyButton text={text} small onCopied={() => onMark(key)} />}
                <button
                  onClick={() => onMark(key)}
                  style={{
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                    border: isDone ? '1px solid #22c55e44' : '1px solid #2a2a2a',
                    background: isDone ? '#0b1f0e' : '#1a1a1a',
                    color: isDone ? '#22c55e' : '#555',
                    fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
                  }}
                >
                  {isDone ? '✓ Done' : 'Mark Done'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TitlesSection ─────────────────────────────────────────────────────────────
function TitlesSection({ titles, selectedTitle, onSelectTitle, aiData }) {
  const [showWhy, setShowWhy] = useState({});
  if (!titles?.length) return null;

  const tt = aiData?.titleThumbnail || {};
  const baseSubScores = {
    curiosity:      tt.curiosityScore      ?? 0,
    emotional:      tt.emotionalScore      ?? 0,
    clarity:        tt.clarityScore        ?? 0,
    scrollStopping: tt.scrollStoppingScore ?? 0,
  };
  const selProj = selectedTitle !== null ? (titles[selectedTitle]?.projectedTitleSubScores || {}) : {};

  return (
    <div style={{ background: '#09090f', border: '1px solid #1e1e2e', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: 12 }}>
        🎯 Titles — pick one to simulate
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {titles.map((t, i) => {
          const isSelected = selectedTitle === i;
          return (
            <div
              key={i}
              onClick={() => onSelectTitle(isSelected ? null : i)}
              style={{
                background: isSelected ? '#110d1f' : '#111',
                borderRadius: 8, padding: '10px 12px',
                border: `1px solid ${isSelected ? '#7c3aed66' : '#1a1a1a'}`,
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: isSelected ? '0 0 12px #7c3aed22' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {/* Radio indicator */}
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${isSelected ? '#7c3aed' : '#333'}`,
                  background: isSelected ? '#7c3aed' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {t.angle && (
                      <span style={{ fontSize: '0.6rem', color: isSelected ? '#a78bfa' : '#444', fontStyle: 'italic', textTransform: 'capitalize', fontWeight: isSelected ? 700 : 400 }}>{t.angle}</span>
                    )}
                    {isSelected && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#7c3aed', background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 4, padding: '1px 6px' }}>
                        ● Simulating
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#e0e0e0', lineHeight: 1.5, fontWeight: 600 }}>
                    {t.text}
                  </div>
                </div>
                <CopyButton text={t.text} small onCopied={e => e?.stopPropagation?.()} />
              </div>
              {t.reason && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); setShowWhy(p => ({ ...p, [i]: !p[i] })); }}
                    style={{ marginTop: 6, background: 'none', border: 'none', color: '#444', fontSize: '0.68rem', cursor: 'pointer', padding: 0 }}
                  >
                    {showWhy[i] ? '▲ Hide' : '💡 Why this works'}
                  </button>
                  {showWhy[i] && (
                    <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#666', lineHeight: 1.6, background: '#0a0a14', borderRadius: 6, padding: '7px 10px' }}>
                      {t.reason}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Local title sub-score bars */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #131323' }}>
        <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 8 }}>Title Sub-Scores</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <ScoreBar label="Curiosity"       baseline={baseSubScores.curiosity}      projected={selProj.curiosity      ?? baseSubScores.curiosity}      active={selectedTitle !== null} />
          <ScoreBar label="Emotional"       baseline={baseSubScores.emotional}      projected={selProj.emotional      ?? baseSubScores.emotional}      active={selectedTitle !== null} />
          <ScoreBar label="Clarity"         baseline={baseSubScores.clarity}        projected={selProj.clarity        ?? baseSubScores.clarity}        active={selectedTitle !== null} />
          <ScoreBar label="Scroll-Stopping" baseline={baseSubScores.scrollStopping} projected={selProj.scrollStopping ?? baseSubScores.scrollStopping} active={selectedTitle !== null} />
        </div>
      </div>
    </div>
  );
}

// ── HookSection ───────────────────────────────────────────────────────────────
function HookSection({ hook, selected, onToggle, hookBaseline }) {
  const [showWhy, setShowWhy] = useState(false);
  if (!hook?.text) return null;

  const raw = hook.text.trim();
  const steps = raw.split(/(?<=[.!?])\s+(?=[A-Z"'])|(?:\n)+/).filter(Boolean).slice(0, 4);
  const displaySteps = steps.length >= 2 ? steps : [raw];

  return (
    <div style={{ background: '#09090f', border: `1px solid ${selected ? '#7c3aed66' : '#1e1e2e'}`, borderRadius: 14, padding: '16px 18px', transition: 'border-color 0.2s', boxShadow: selected ? '0 0 12px #7c3aed22' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed' }}>
          🎣 Hook Script
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onToggle}
            style={{
              padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700,
              border: selected ? '1px solid #7c3aed66' : '1px solid #2a2a2a',
              background: selected ? '#7c3aed22' : '#1a1a1a',
              color: selected ? '#a78bfa' : '#555',
              transition: 'all 0.2s',
            }}
          >
            {selected ? '● Simulating' : 'Simulate fix'}
          </button>
          <CopyButton text={hook.text} small />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {displaySteps.map((line, i) => (
          <div key={i} style={{ background: '#111', borderRadius: 8, padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              flexShrink: 0, minWidth: 44,
              fontSize: '0.58rem', fontWeight: 800, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2,
            }}>
              Step {i + 1}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.55, flex: 1 }}>{line.trim()}</span>
              <CopyButton text={line.trim()} small />
            </div>
          </div>
        ))}
      </div>
      {hook.reason && (
        <>
          <button
            onClick={() => setShowWhy(v => !v)}
            style={{ marginTop: 10, background: 'none', border: 'none', color: '#444', fontSize: '0.68rem', cursor: 'pointer', padding: 0 }}
          >
            {showWhy ? '▲ Hide explanation' : '💡 Why this works'}
          </button>
          {showWhy && (
            <div style={{ marginTop: 8, fontSize: '0.74rem', color: '#666', lineHeight: 1.6, background: '#0a0a14', borderRadius: 6, padding: '8px 10px' }}>
              {hook.reason}
            </div>
          )}
        </>
      )}

      {/* Local hook strength bar */}
      {hookBaseline > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #131323' }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 8 }}>Hook Strength</div>
          <ScoreBar
            label="Strength"
            baseline={hookBaseline}
            projected={hook.projectedHookStrength ?? hookBaseline}
            active={selected}
          />
        </div>
      )}
    </div>
  );
}

// ── ThumbnailSection ──────────────────────────────────────────────────────────
function ThumbnailSection({ aiData, improvements, selectedThumbnail, onSelectThumbnail }) {
  const concepts = aiData?.titleThumbnail?.thumbnailTips || [];
  if (!concepts.length) return null;

  const baseScore = aiData?.blueprint?.scores?.titleThumbnail ?? 0;
  const projScore = selectedThumbnail !== null
    ? (improvements?.thumbnails?.[selectedThumbnail]?.projectedDimensions?.titleThumbnail ?? baseScore)
    : baseScore;

  return (
    <div style={{ background: '#09090f', border: '1px solid #1e1e2e', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: 12 }}>
        🖼️ Thumbnails — pick one to simulate
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {concepts.map((concept, i) => {
          const isSelected = selectedThumbnail === i;
          return (
            <div
              key={i}
              onClick={() => onSelectThumbnail(isSelected ? null : i)}
              style={{
                background: isSelected ? '#110d1f' : '#111',
                borderRadius: 8, padding: '10px 12px',
                border: `1px solid ${isSelected ? '#7c3aed66' : '#1a1a1a'}`,
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: isSelected ? '0 0 12px #7c3aed22' : 'none',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}
            >
              {/* Radio indicator */}
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                border: `2px solid ${isSelected ? '#7c3aed' : '#333'}`,
                background: isSelected ? '#7c3aed' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {isSelected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isSelected && (
                  <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#7c3aed', background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 4, padding: '1px 6px', display: 'inline-block', marginBottom: 4 }}>
                    ● Simulating
                  </span>
                )}
                <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.55 }}>{concept}</div>
              </div>
              <CopyButton text={concept} small onCopied={e => e?.stopPropagation?.()} />
            </div>
          );
        })}
      </div>

      {/* Estimated impact bar */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #131323' }}>
        <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 8 }}>Estimated Impact on Title & Thumb</div>
        <ScoreBar label="Title & Thumb" baseline={baseScore} projected={projScore} active={selectedThumbnail !== null} />
      </div>
    </div>
  );
}

// ── CTASection ────────────────────────────────────────────────────────────────
function CTASection({ cta, selected, onToggle }) {
  const [showWhy, setShowWhy] = useState(false);
  if (!cta?.text) return null;

  return (
    <div style={{ background: '#09090f', border: `1px solid ${selected ? '#7c3aed66' : '#1e1e2e'}`, borderRadius: 14, padding: '16px 18px', transition: 'border-color 0.2s', boxShadow: selected ? '0 0 12px #7c3aed22' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed' }}>
          📢 Call to Action
        </div>
        <button
          onClick={onToggle}
          style={{
            padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700,
            border: selected ? '1px solid #7c3aed66' : '1px solid #2a2a2a',
            background: selected ? '#7c3aed22' : '#1a1a1a',
            color: selected ? '#a78bfa' : '#555',
            transition: 'all 0.2s',
          }}
        >
          {selected ? '● Simulating' : 'Simulate fix'}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, fontSize: '0.85rem', color: '#e0e0e0', lineHeight: 1.55, fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {cta.text}
        </div>
        <CopyButton text={cta.text} small />
      </div>
      {cta.reason && (
        <>
          <button
            onClick={() => setShowWhy(v => !v)}
            style={{ marginTop: 8, background: 'none', border: 'none', color: '#444', fontSize: '0.68rem', cursor: 'pointer', padding: 0 }}
          >
            {showWhy ? '▲ Hide explanation' : '💡 Why this works'}
          </button>
          {showWhy && (
            <div style={{ marginTop: 8, fontSize: '0.74rem', color: '#666', lineHeight: 1.6, background: '#0a0a14', borderRadius: 6, padding: '8px 10px' }}>
              {cta.reason}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── ViralPlaybookSection ──────────────────────────────────────────────────────
function ViralPlaybookSection({ playbook }) {
  const [open, setOpen] = useState(false);
  if (!playbook) return null;

  return (
    <div style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 14, overflow: 'hidden' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', cursor: 'pointer' }}
        onClick={() => setOpen(v => !v)}
      >
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a855f7' }}>
          📈 Viral Playbook
        </div>
        <span style={{ color: '#555', fontSize: '0.75rem' }}>{open ? '▲ Collapse' : '▼ Expand'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 18px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: '🎣', label: 'Hook Pattern',     value: playbook.hook_pattern },
            { icon: '🏗️', label: 'Video Structure',  value: playbook.video_structure },
            { icon: '💥', label: 'Emotional Trigger', value: playbook.emotional_trigger },
            { icon: '📢', label: 'CTA Pattern',       value: playbook.cta_pattern },
          ].filter(r => r.value).map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, paddingTop: 10, borderTop: '1px solid #131313' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>{row.icon}</span>
              <div>
                <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 3 }}>{row.label}</div>
                <div style={{ fontSize: '0.8rem', color: '#ccc', lineHeight: 1.5 }}>{row.value}</div>
              </div>
            </div>
          ))}
          {playbook.replication_steps?.length > 0 && (
            <div style={{ paddingTop: 10, borderTop: '1px solid #131313' }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 8 }}>Replication Steps</div>
              {playbook.replication_steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.78rem', color: '#888', lineHeight: 1.5, marginBottom: 6 }}>
                  <span style={{ flexShrink: 0, color: '#a855f7', fontWeight: 700 }}>{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ImproveHub({ video, aiData, onUpgrade, onNavigate, onGoToVideo, canUseAI, consumeAICall }) {
  const [improvements,      setImprovements]      = useState(null);
  const [improving,         setImproving]         = useState(false);
  const [improveError,      setImproveError]      = useState('');
  const [checkDone,         setCheckDone]         = useState({});
  const [selectedTitle,     setSelectedTitle]     = useState(null);
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);
  const [selectedFixes,     setSelectedFixes]     = useState({ hook: false, cta: false });
  const [bestCombo,         setBestCombo]         = useState(null);

  const autoSelectBest = (impr) => {
    setBestCombo(null);
    if (!impr) {
      setSelectedTitle(null);
      setSelectedThumbnail(null);
      setSelectedFixes({ hook: false, cta: false });
      return;
    }
    const tt          = aiData?.titleThumbnail || {};
    const baseOverall = aiData?.blueprint?.overallScore ?? 0;
    const baseThumbDim = aiData?.blueprint?.scores?.titleThumbnail ?? 0;
    const baseSub = {
      curiosity:      tt.curiosityScore      ?? 0,
      emotional:      tt.emotionalScore      ?? 0,
      clarity:        tt.clarityScore        ?? 0,
      scrollStopping: tt.scrollStoppingScore ?? 0,
    };
    const titleBoost = t => {
      const sub = t.projectedTitleSubScores || {};
      return ['curiosity', 'emotional', 'clarity', 'scrollStopping']
        .reduce((s, k) => s + ((sub[k] ?? baseSub[k]) - baseSub[k]), 0)
        + ((t.projectedOverall ?? baseOverall) - baseOverall);
    };
    const thumbBoost = t =>
      (t.projectedDimensions?.titleThumbnail ?? baseThumbDim) - baseThumbDim;

    const titles = impr.titles || [];
    if (titles.length > 0) {
      const bestIdx = titles.reduce((best, t, i) =>
        titleBoost(t) > titleBoost(titles[best]) ? i : best, 0);
      setSelectedTitle(bestIdx);
    } else {
      setSelectedTitle(null);
    }
    setSelectedFixes({ hook: !!(impr.hook?.text), cta: !!(impr.cta?.text) });
    const thumbs = impr.thumbnails || [];
    if (thumbs.length > 0) {
      const bestIdx = thumbs.reduce((best, t, i) =>
        thumbBoost(t) > thumbBoost(thumbs[best]) ? i : best, 0);
      setSelectedThumbnail(bestIdx);
    } else {
      setSelectedThumbnail(null);
    }
  };

  const handleBestFix = () => {
    if (!improvements) return;
    if (bestCombo !== null) {
      setSelectedTitle(null);
      setSelectedThumbnail(null);
      setSelectedFixes({ hook: false, cta: false });
      setBestCombo(null);
      setCheckDone({});
      return;
    }
    const tt           = aiData?.titleThumbnail || {};
    const baseOverall  = aiData?.blueprint?.overallScore ?? 0;
    const baseThumbDim = aiData?.blueprint?.scores?.titleThumbnail ?? 0;
    const baseSub = {
      curiosity:      tt.curiosityScore      ?? 0,
      emotional:      tt.emotionalScore      ?? 0,
      clarity:        tt.clarityScore        ?? 0,
      scrollStopping: tt.scrollStoppingScore ?? 0,
    };
    const titleBoost = t => {
      const sub = t.projectedTitleSubScores || {};
      return ['curiosity', 'emotional', 'clarity', 'scrollStopping']
        .reduce((s, k) => s + ((sub[k] ?? baseSub[k]) - baseSub[k]), 0)
        + ((t.projectedOverall ?? baseOverall) - baseOverall);
    };
    const thumbBoost = t =>
      (t.projectedDimensions?.titleThumbnail ?? baseThumbDim) - baseThumbDim;

    const bestTitleIdx = (improvements.titles || []).reduce((best, t, i) =>
      titleBoost(t) > titleBoost(improvements.titles[best]) ? i : best, 0);

    const bestThumbIdx = (improvements.thumbnails || []).reduce((best, t, i) =>
      thumbBoost(t) > thumbBoost(improvements.thumbnails[best]) ? i : best, 0);

    const includeHook = ((improvements.hook?.projectedOverall ?? baseOverall) - baseOverall) > 0;
    const includeCTA  = ((improvements.cta?.projectedOverall  ?? baseOverall) - baseOverall) > 0;

    // Build checklist keys that are recommended
    const combo = ['title', 'thumbnail'];
    if (includeHook) combo.push('hook');
    if (includeCTA)  combo.push('cta');
    setBestCombo(combo);

    // Staggered apply — each step 400ms apart
    setTimeout(() => setSelectedTitle(bestTitleIdx),              0);
    setTimeout(() => setSelectedThumbnail(bestThumbIdx),        400);
    setTimeout(() => { if (includeHook) setSelectedFixes(p => ({ ...p, hook: true })); }, 800);
    setTimeout(() => { if (includeCTA)  setSelectedFixes(p => ({ ...p, cta: true }));  }, 1200);
  };

  useEffect(() => {
    if (!video?.id) { setImprovements(null); autoSelectBest(null); return; }
    let parsed = null;
    try {
      const raw = localStorage.getItem(IMPROVE_KEY + video.id);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {}
    setImprovements(parsed);
    autoSelectBest(parsed);
    setImproveError('');
    setCheckDone({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  const hasAnalysis = !!aiData;
  const hasImprovements = !!(improvements?.titles?.length);

  const handleMark = key => setCheckDone(p => ({ ...p, [key]: !p[key] }));

  const handleGenerate = async () => {
    if (canUseAI && !canUseAI()) { onUpgrade?.(); return; }
    setImproving(true);
    setImproveError('');
    try {
      const stats = video?.statistics || {};
      const vws   = parseInt(stats.viewCount   || 0);
      const lks   = parseInt(stats.likeCount   || 0);
      const cms   = parseInt(stats.commentCount || 0);
      const videoData = {
        title:          video?.snippet?.title || '',
        description:    (video?.snippet?.description || '').slice(0, 600),
        tags:           (video?.snippet?.tags || []).slice(0, 15).join(', ') || 'none',
        views:          vws.toLocaleString(),
        likes:          lks.toLocaleString(),
        comments:       cms.toLocaleString(),
        engagementRate: vws > 0 ? ((lks + cms) / vws * 100).toFixed(2) : '0',
      };
      const bp  = aiData?.blueprint  || {};
      const hs  = aiData?.hookStructure || {};
      const tt  = aiData?.titleThumbnail || {};
      const analysisData = {
        overallScore:     bp.overallScore ?? null,
        grade:            bp.grade        ?? null,
        contentDNA:       bp.contentDNA   || 'Not available',
        strengths:        bp.strengths    || '',
        weaknesses:       bp.improvements || '',
        hookType:         hs.hookType     || 'unknown',
        hookAnalysis:     hs.hookAnalysis || '',
        hookStrength:     hs.hookStrength ?? null,
        dimensionScores: {
          titleThumbnail:     bp.scores?.titleThumbnail     ?? null,
          hookRetention:      bp.scores?.hookRetention      ?? null,
          contentStructure:   bp.scores?.contentStructure   ?? null,
          engagement:         bp.scores?.engagement         ?? null,
          algorithm:          bp.scores?.algorithm          ?? null,
          seoDiscoverability: bp.scores?.seoDiscoverability ?? null,
          emotionalImpact:    bp.scores?.emotionalImpact    ?? null,
          valueDelivery:      bp.scores?.valueDelivery      ?? null,
        },
        titleScores: {
          curiosity:      tt.curiosityScore      ?? null,
          emotional:      tt.emotionalScore      ?? null,
          clarity:        tt.clarityScore        ?? null,
          scrollStopping: tt.scrollStoppingScore ?? null,
        },
        thumbnailConcepts: tt.thumbnailTips || [],
      };
      const result = await generateVideoImprovements(videoData, analysisData);
      if (result) {
        consumeAICall?.();
        setImprovements(result);
        setCheckDone({});
        autoSelectBest(result);
        try { localStorage.setItem(IMPROVE_KEY + video.id, JSON.stringify(result)); } catch {}
      } else {
        setImproveError('AI returned an unexpected format. Please try again.');
      }
    } catch (e) {
      setImproveError(e.message);
    } finally {
      setImproving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Page header */}
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.35rem', fontWeight: 900, color: '#e9d5ff' }}>✨ Fix My Video</h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#555', lineHeight: 1.6 }}>
          AI-generated title rewrites, hook scripts, CTAs, and a full viral playbook — written specifically for your video.
        </p>
      </div>

      {hasAnalysis && (
        <DimensionPanel
          aiData={aiData}
          improvements={improvements}
          selectedTitle={selectedTitle}
          selectedThumbnail={selectedThumbnail}
          selectedFixes={selectedFixes}
        />
      )}

      {!video && (
        <EmptyCard emoji="🎬" title="Pick a video first"
          sub="Go to Analyze, browse the channel's videos, click one, then run Deep Analysis. Once done, come back here for your personalised fix plan."
          cta="→ Go to Analyze" onCta={() => onNavigate('analyze')} />
      )}

      {video && !hasAnalysis && (
        <EmptyCard emoji="🧠"
          title={`"${(video.snippet?.title ?? 'This video').slice(0, 55)}${(video.snippet?.title?.length ?? 0) > 55 ? '…' : ''}" hasn't been analyzed yet`}
          sub="Open this video in the Analyze tab and click 'Unlock Full Viral Breakdown'. The AI analysis takes 15–30 seconds, then come back here."
          cta="→ Analyze This Video" onCta={() => onGoToVideo ? onGoToVideo() : onNavigate('analyze')} />
      )}

      {video && hasAnalysis && (
        <>
          {/* Video context chip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0a0a12', border: '1px solid #1e1e2e', borderRadius: 10, padding: '10px 14px' }}>
            {video.snippet?.thumbnails?.default?.url && (
              <img src={video.snippet.thumbnails.default.url} alt="" style={{ width: 56, height: 38, borderRadius: 5, objectFit: 'cover', flexShrink: 0, border: '1px solid #2a2a2a' }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: '#444', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>Currently improving</div>
              <div style={{ fontSize: '0.85rem', color: '#ccc', fontWeight: 600, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {video.snippet?.title ?? 'Unknown video'}
              </div>
            </div>
            {hasImprovements && <div style={{ fontSize: '1.3rem', color: '#22c55e', flexShrink: 0 }}>✓</div>}
          </div>

          {/* Generate button */}
          {!hasImprovements && !improving && (
            <div style={{ background: 'linear-gradient(135deg, #0d0920 0%, #14082a 100%)', border: '1px solid #2d1060', borderRadius: 14, padding: '24px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>🔥</div>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#e9d5ff', marginBottom: 8 }}>Ready to generate your improvements</div>
              <div style={{ fontSize: '0.78rem', color: '#5a4a7a', lineHeight: 1.7, marginBottom: 20, maxWidth: 380, margin: '0 auto 20px' }}>
                Claude will write 3 precision-optimized titles, a hook script, and a CTA — all derived from this video's deep analysis. Uses 1 AI call.
              </div>
              <button onClick={handleGenerate} style={{ background: 'linear-gradient(135deg, #4c1d95, #7c3aed)', color: '#f3e8ff', border: 'none', borderRadius: 10, padding: '14px 32px', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 0 24px rgba(124,58,237,0.4)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                ✨ Generate AI Improvements
              </button>
              {improveError && <div style={{ marginTop: 12, fontSize: '0.78rem', color: '#ef4444' }}>{improveError}</div>}
            </div>
          )}

          {/* Generating state */}
          {improving && (
            <div style={{ background: '#0d0d0d', border: '1px solid #1e1e1e', borderRadius: 14, padding: '32px', textAlign: 'center' }}>
              <span className="btn-spinner" style={{ width: 28, height: 28, borderWidth: 2, display: 'inline-block', marginBottom: 16 }} />
              <div style={{ fontSize: '0.85rem', color: '#666', fontWeight: 600 }}>Writing precision improvements for this video…</div>
              <div style={{ fontSize: '0.74rem', color: '#444', marginTop: 6 }}>This takes 10–20 seconds</div>
            </div>
          )}

          {/* Re-generate */}
          {hasImprovements && !improving && (
            <div style={{ textAlign: 'right' }}>
              <button onClick={handleGenerate} style={{ background: 'none', border: '1px solid #1e1e1e', color: '#444', borderRadius: 8, padding: '6px 14px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                ↻ Regenerate
              </button>
              {improveError && <div style={{ marginTop: 6, fontSize: '0.78rem', color: '#ef4444' }}>{improveError}</div>}
            </div>
          )}

          {/* Actionable output */}
          {hasImprovements && (
            <>
              <FixChecklist improvements={improvements} done={checkDone} onMark={handleMark} aiData={aiData} bestCombo={bestCombo} onBestFix={handleBestFix} />
              <TitlesSection
                titles={improvements?.titles}
                selectedTitle={selectedTitle}
                onSelectTitle={setSelectedTitle}
                aiData={aiData}
              />
              <HookSection
                hook={improvements?.hook}
                selected={selectedFixes.hook}
                onToggle={() => setSelectedFixes(p => ({ ...p, hook: !p.hook }))}
                hookBaseline={aiData?.hookStructure?.hookStrength ?? 0}
              />
              <ThumbnailSection
                aiData={aiData}
                improvements={improvements}
                selectedThumbnail={selectedThumbnail}
                onSelectThumbnail={setSelectedThumbnail}
              />
              <CTASection
                cta={improvements?.cta}
                selected={selectedFixes.cta}
                onToggle={() => setSelectedFixes(p => ({ ...p, cta: !p.cta }))}
              />
              <ViralPlaybookSection playbook={improvements?.viral_playbook} />
            </>
          )}
        </>
      )}
    </div>
  );
}
