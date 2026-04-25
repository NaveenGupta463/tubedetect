import { useState, useEffect, useMemo, useRef } from 'react';
import { generateVideoImprovements } from '../api/claude';
import { ScoreRing } from './VideoAnalysisPrimitives';

const IMPROVE_KEY = 'tubeintel_improve_v2_';

const CHECKLIST_KEYS = ['title', 'thumbnail', 'seo', 'cta'];
const CHECKLIST_META = {
  title:     { icon: '🎯', label: 'Title',     sublabel: 'Packaging' },
  thumbnail: { icon: '🖼️', label: 'Thumbnail',  sublabel: 'Packaging' },
  seo:       { icon: '🔍', label: 'SEO',        sublabel: 'Discoverability' },
  cta:       { icon: '📢', label: 'CTA',         sublabel: 'Engagement' },
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
  { key: 'packaging',  label: 'Packaging' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'seo',        label: 'SEO' },
  { key: 'velocity',   label: 'Velocity' },
];

const MILESTONES = [
  { min: 0,  max: 49,  label: 'Needs Work',     next: 'Average',         nextScore: 50 },
  { min: 50, max: 59,  label: 'Average',         next: 'Improving',       nextScore: 60 },
  { min: 60, max: 74,  label: 'Improving',       next: 'High Performer',  nextScore: 75 },
  { min: 75, max: 89,  label: 'High Performer',  next: 'Viral Potential', nextScore: 90 },
  { min: 90, max: 100, label: 'Viral Potential', next: null,              nextScore: null },
];

function getMilestone(score) {
  const m = MILESTONES.find(m => score >= m.min && score <= m.max) || MILESTONES[0];
  return { next: m.next, nextScore: m.nextScore };
}

const DIM_WEIGHTS_LOCAL = {
  packaging:  0.40,
  engagement: 0.30,
  seo:        0.15,
  velocity:   0.15,
};

function DimensionPanel({ aiData, improvements, selectedTitle, selectedThumbnail, selectedFixes }) {
  const bp = aiData?.blueprint || {};
  const baseScores = bp.scores || {};
  const baseOverall = bp.viralScore ?? 0;

  const anyActive = selectedTitle !== null || selectedThumbnail !== null || selectedFixes.seo;

  // Merge all active items' pre-spread projected dims using Math.max per dimension
  const projDims = { ...baseScores };

  const activeItems = [
    selectedTitle     !== null && improvements?.titles?.[selectedTitle],
    selectedThumbnail !== null && improvements?.thumbnails?.[selectedThumbnail],
    selectedFixes.seo          && improvements?.seo_improvements,
  ].filter(Boolean);

  for (const item of activeItems) {
    if (!item.projectedDimensions) continue;
    for (const key of Object.keys(DIM_WEIGHTS_LOCAL)) {
      if (item.projectedDimensions[key] != null)
        projDims[key] = Math.max(projDims[key] ?? 0, item.projectedDimensions[key]);
    }
  }

  const projOverall = anyActive
    ? Math.max(
        baseOverall,
        Math.min(
          Math.round(Object.entries(DIM_WEIGHTS_LOCAL).reduce((s, [k, w]) => {
            const val = Number(projDims?.[k] ?? baseScores?.[k] ?? 0);
            return s + (val * w);
          }, 0)),
          baseOverall + 15
        )
      )
    : baseOverall;
  const overallDelta = projOverall - baseOverall;

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
          <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2, color: anyActive && overallDelta > 0 ? '#22c55e' : '#444' }}>
            {anyActive && overallDelta > 0 ? 'Optimized Potential' : 'Overall'}
          </div>
          {anyActive && overallDelta > 0 ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1, color: '#555' }}>{baseOverall}</span>
              <span style={{ fontSize: '0.9rem', color: '#555', margin: '0 2px' }}>→</span>
              <span style={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1, color: '#22c55e', transition: 'color 0.4s' }}>{projOverall}</span>
              <span style={{ fontSize: '0.62rem', color: '#22c55e', fontWeight: 600, alignSelf: 'flex-end', paddingBottom: 2 }}>potential</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: '1.6rem', fontWeight: 900, lineHeight: 1, color: projOverall >= 75 ? '#00c853' : projOverall >= 55 ? '#ff9100' : '#ff1744' }}>
                {projOverall}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#444' }}>/100</span>
            </div>
          )}
          {anyActive && overallDelta > 0 && (
            <div style={{ fontSize: '0.58rem', color: '#555', marginTop: 3 }}>Based on selected improvements</div>
          )}
        </div>
      </div>
      <div style={{ fontSize: '0.65rem', color: '#2a2a2a', marginBottom: 14, lineHeight: 1.5 }}>
        Scores reflect content quality signals. Actual YouTube performance depends on posting time, niche competition, and algorithm factors beyond these metrics.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, justifyItems: 'center' }}>
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
      {anyActive && overallDelta > 0 && (() => {
        const ms = getMilestone(projOverall);
        const feedbackText = ms.next
          ? `Getting closer to ${ms.next} (${ms.nextScore})`
          : "You've reached Viral Potential!";
        return (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#0b1a0b', border: '1px solid #22c55e22', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: '0.85rem', flexShrink: 0 }}>✅</span>
            <span style={{ fontSize: '0.7rem', color: '#86efac' }}>
              +{Math.round(overallDelta)} improvement applied · {feedbackText}
            </span>
          </div>
        );
      })()}
    </div>
  );
}

// ── FixChecklist ──────────────────────────────────────────────────────────────
function FixChecklist({ improvements, done, onMark, aiData, bestCombo, onBestFix }) {
  const gains = useMemo(() => {
    const baseOverall      = aiData?.blueprint?.viralScore ?? 0;
    const basePackagingDim = aiData?.blueprint?.scores?.packaging ?? 0;
    return {
      title: improvements?.titles?.length > 0
        ? Math.max(...improvements.titles.map(t => (t.projectedOverall ?? baseOverall) - baseOverall))
        : 0,
      thumbnail: improvements?.thumbnails?.length > 0
        ? Math.max(0, ...improvements.thumbnails.map(t =>
            ((t.projectedDimensions?.packaging ?? basePackagingDim) - basePackagingDim) * DIM_WEIGHTS_LOCAL.packaging
          ))
        : 0,
      seo: Math.max(0, (improvements?.seo_improvements?.projectedOverall ?? baseOverall) - baseOverall),
      cta: 0,
    };
  }, [improvements, aiData]);

  const sortedGains       = Object.entries(gains).filter(([, g]) => g > 0).sort(([, a], [, b]) => b - a);
  const highestImpactKey  = sortedGains[0]?.[0] ?? null;
  const highestImpactGain = sortedGains[0]?.[1] ?? 0;

  const [orderedKeys, setOrderedKeys] = useState(CHECKLIST_KEYS);
  const prevDoneRef = useRef({});

  const sortKeys = (currentDone) => {
    const active    = CHECKLIST_KEYS.filter(k => !currentDone[k]).sort((a, b) => (gains[b] ?? 0) - (gains[a] ?? 0));
    const completed = CHECKLIST_KEYS.filter(k =>  currentDone[k]);
    return [...active, ...completed];
  };

  useEffect(() => {
    setOrderedKeys(sortKeys(done));
  }, [improvements]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const changed = CHECKLIST_KEYS.some(k => !!done[k] !== !!prevDoneRef.current[k]);
    prevDoneRef.current = { ...done };
    if (!changed) return;
    setOrderedKeys(sortKeys(done));
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeKeys = orderedKeys.filter(k => !done[k]);
  const doneKeys   = orderedKeys.filter(k =>  done[k]);

  const getText = key => {
    if (key === 'title')     return improvements?.titles?.[0]?.text || '';
    if (key === 'thumbnail') return aiData?.titleThumbnail?.thumbnailTips?.[0] || '';
    if (key === 'seo')       return improvements?.seo_improvements?.title_suggestion || '';
    if (key === 'cta')       return improvements?.cta?.text || '';
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

      <style>{`@keyframes fix-rise { from { opacity: 0.6; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* Active items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {activeKeys.map((key, idx) => {
          const { icon, label, sublabel } = CHECKLIST_META[key];
          const text = getText(key);
          const isRecommended = bestCombo?.includes(key);
          const isHighest = key === highestImpactKey && highestImpactGain > 0;
          return (
            <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4, animation: idx === 0 ? 'fix-rise 0.2s ease' : 'none' }}>
              {isHighest && (
                <div style={{
                  fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em',
                  textTransform: 'uppercase', display: 'flex', alignItems: 'center',
                  gap: 6, paddingLeft: 4,
                }}>
                  <span style={{ color: '#fbbf24' }}>▶ Start here</span>
                  <span style={{ color: '#d97706', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>→ +{Math.round(highestImpactGain)} pts</span>
                </div>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: isHighest ? '#1a1200' : isRecommended ? '#110d1f' : '#111',
                border: `1px solid ${isHighest ? '#fbbf2466' : isRecommended ? '#7c3aed55' : '#1a1a1a'}`,
                borderRadius: 8, padding: '9px 12px',
                transition: 'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                boxShadow: isHighest
                  ? '0 0 20px #fbbf2428, inset 0 1px 0 #fbbf2418'
                  : isRecommended ? '0 0 10px #7c3aed18' : 'none',
              }}>
                <div onClick={() => onMark(key)} style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${isHighest ? '#fbbf24' : isRecommended ? '#7c3aed' : '#333'}`,
                  background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', fontSize: '0.65rem', color: '#22c55e',
                }} />
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: isHighest ? '#fde68a' : isRecommended ? '#c4b5fd' : '#555', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
                    <span style={{ fontSize: '0.62rem', background: '#1a1a1a', border: '1px solid #222', borderRadius: 4, padding: '1px 6px', color: '#444', fontWeight: 600 }}>{sublabel}</span>
                    {isHighest && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#fbbf24', background: '#1a1200', border: '1px solid #fbbf2433', borderRadius: 4, padding: '1px 6px' }}>
                        🏆 Biggest Impact
                      </span>
                    )}
                    {isRecommended && !isHighest && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#a78bfa', background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 4, padding: '1px 6px' }}>
                        ★ Recommended
                      </span>
                    )}
                  </div>
                  {text && (
                    <div style={{ fontSize: '0.78rem', color: isHighest ? '#e5c97e' : isRecommended ? '#ccc' : '#bbb', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {text}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {text && <CopyButton text={text} small onCopied={() => onMark(key)} />}
                  <button onClick={() => onMark(key)} style={{
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                    border: '1px solid #2a2a2a', background: '#1a1a1a', color: '#555',
                    fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
                  }}>
                    Mark Done
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completed section */}
      {doneKeys.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#2a2a2a', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6, paddingLeft: 2 }}>
            Completed ({doneKeys.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {doneKeys.map(key => {
              const { icon, label, sublabel } = CHECKLIST_META[key];
              const text = getText(key);
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: '#0b1a0b', border: '1px solid #22c55e22',
                  borderRadius: 8, padding: '9px 12px',
                  opacity: 0.55, transition: 'opacity 0.2s ease',
                }}>
                  <div onClick={() => onMark(key)} style={{
                    width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                    border: '2px solid #22c55e', background: '#22c55e22',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: '0.65rem', color: '#22c55e',
                  }}>✓</div>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.1em', textDecoration: 'line-through' }}>{label}</span>
                      <span style={{ fontSize: '0.62rem', background: '#1a1a1a', border: '1px solid #222', borderRadius: 4, padding: '1px 6px', color: '#444', fontWeight: 600 }}>{sublabel}</span>
                    </div>
                    {text && (
                      <div style={{ fontSize: '0.78rem', color: '#555', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' }}>
                        {text}
                      </div>
                    )}
                  </div>
                  <button onClick={() => onMark(key)} style={{
                    padding: '3px 8px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                    border: '1px solid #22c55e44', background: '#0b1f0e', color: '#22c55e',
                    fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap',
                  }}>
                    ✓ Done
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
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

// ── SEOSection ────────────────────────────────────────────────────────────────
function SEOSection({ seoImprovements, selected, onToggle, baseScore }) {
  if (!seoImprovements?.title_suggestion && !seoImprovements?.description_keywords?.length) return null;
  const projScore = seoImprovements?.projectedDimensions?.seo ?? baseScore;

  return (
    <div style={{ background: '#09090f', border: `1px solid ${selected ? '#7c3aed66' : '#1e1e2e'}`, borderRadius: 14, padding: '16px 18px', transition: 'border-color 0.2s', boxShadow: selected ? '0 0 12px #7c3aed22' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed' }}>
          🔍 SEO Improvements
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
      {seoImprovements.title_suggestion && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 5 }}>SEO Title Suggestion</div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#111', borderRadius: 8, padding: '9px 12px' }}>
            <span style={{ fontSize: '0.82rem', color: '#e0e0e0', lineHeight: 1.55, flex: 1, fontWeight: 600 }}>{seoImprovements.title_suggestion}</span>
            <CopyButton text={seoImprovements.title_suggestion} small />
          </div>
        </div>
      )}
      {seoImprovements.description_keywords?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 5 }}>Description Keywords</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {seoImprovements.description_keywords.map((kw, i) => (
              <span key={i} style={{ fontSize: '0.72rem', background: '#111', border: '1px solid #2a2a2a', borderRadius: 5, padding: '3px 8px', color: '#888' }}>{kw}</span>
            ))}
          </div>
        </div>
      )}
      {seoImprovements.tags?.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 5 }}>Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {seoImprovements.tags.map((tag, i) => (
              <span key={i} style={{ fontSize: '0.72rem', background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 5, padding: '3px 8px', color: '#7c3aed' }}>{tag}</span>
            ))}
          </div>
        </div>
      )}
      {baseScore > 0 && (
        <div style={{ paddingTop: 10, borderTop: '1px solid #131323' }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 6 }}>SEO Score Impact</div>
          <ScoreBar label="SEO" baseline={baseScore} projected={projScore} active={selected} />
        </div>
      )}
    </div>
  );
}

// ── ThumbnailSection ──────────────────────────────────────────────────────────
function ThumbnailSection({ aiData, improvements, selectedThumbnail, onSelectThumbnail }) {
  const concepts = aiData?.titleThumbnail?.thumbnailTips || [];
  if (!concepts.length) return null;

  const baseScore = aiData?.blueprint?.scores?.packaging ?? 0;
  const projScore = selectedThumbnail !== null
    ? (improvements?.thumbnails?.[selectedThumbnail]?.projectedDimensions?.packaging ?? baseScore)
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
        <div style={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#2a2a2a', marginBottom: 8 }}>Estimated Impact on Packaging</div>
        <ScoreBar label="Packaging" baseline={baseScore} projected={projScore} active={selectedThumbnail !== null} />
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

// ── DiagnosticBreakdown (DIAGNOSE + CONTEXT modes) ───────────────────────────
function DiagnosticBreakdown({ video, aiData, onGoToVideo, onNavigate, insightMode }) {
  const bp = aiData?.blueprint || {};
  const getMessage = (f) => !f ? '' : (typeof f === 'string' ? f : f.message ?? '');

  const isContext = insightMode === 'CONTEXT';
  const isEarly   = bp.videoType === 'EARLY';

  const videoTypeLabel =
    bp.videoType === 'LEGACY_VIRAL' ? 'Legacy Viral'
    : bp.videoType === 'EARLY'      ? 'Early Phase'
    : bp.videoType === 'DORMANT'    ? 'Dormant'
    : 'Inactive';

  const accentColor = isEarly ? '#3b82f6' : isContext ? '#7c3aed' : '#6b7280';

  const headerTitle = isEarly
    ? '🕐 Early Distribution Phase'
    : isContext
    ? '📖 Historical Context'
    : '📊 Diagnostic Report';

  const headerSub = isEarly
    ? 'This video is still in early distribution — signals are not yet stable enough for optimization advice.'
    : isContext
    ? 'This video has reached peak distribution — optimization tools are not applicable to legacy viral content.'
    : `This video is classified as ${videoTypeLabel} — optimization tools are not applicable. This is a read-only performance record.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Header */}
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.35rem', fontWeight: 900, color: accentColor }}>
          {headerTitle}
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#555', lineHeight: 1.6 }}>
          {headerSub}
        </p>
      </div>

      {/* Video chip */}
      {video && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: 10, padding: '10px 14px' }}>
          {video.snippet?.thumbnails?.default?.url && (
            <img src={video.snippet.thumbnails.default.url} alt="" style={{ width: 56, height: 38, borderRadius: 5, objectFit: 'cover', flexShrink: 0, border: '1px solid #2a2a2a' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: '#444', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>Analyzing</div>
            <div style={{ fontSize: '0.85rem', color: '#ccc', fontWeight: 600, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {video.snippet?.title ?? 'Unknown video'}
            </div>
          </div>
          <div style={{ fontSize: '0.7rem', color: accentColor, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
            {videoTypeLabel}
          </div>
        </div>
      )}

      {/* Primary finding */}
      {getMessage(bp.primaryIssue) && (
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Primary Finding</div>
          <div style={{ fontSize: '0.9rem', color: '#d1d5db', lineHeight: 1.6 }}>{getMessage(bp.primaryIssue)}</div>
        </div>
      )}

      {/* Diagnostics list */}
      {bp.diagnostics?.length > 0 && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#6b7280', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Analysis Notes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bp.diagnostics.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ color: '#374151', fontSize: '0.85rem', flexShrink: 0, marginTop: 2 }}>—</span>
                <span style={{ fontSize: '0.85rem', color: '#9ca3af', lineHeight: 1.55 }}>
                  {typeof d === 'string' ? d : d.message ?? ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths / Weaknesses */}
      {(bp.strengths || bp.weaknesses) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ background: '#0d1f13', border: '1px solid #1a3d22', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#4ade80', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Strengths</div>
            <p style={{ margin: 0, fontSize: '0.83rem', color: '#86efac', lineHeight: 1.55 }}>
              {bp.strengths || 'None identified'}
            </p>
          </div>
          <div style={{ background: '#1a0d0d', border: '1px solid #3d1a1a', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#f87171', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Weaknesses</div>
            <p style={{ margin: 0, fontSize: '0.83rem', color: '#fca5a5', lineHeight: 1.55 }}>
              {bp.weaknesses || 'None identified'}
            </p>
          </div>
        </div>
      )}

      {/* Score row */}
      {bp.viralScore != null && (
        <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', fontWeight: 900, color: '#6b7280', lineHeight: 1 }}>{bp.viralScore}</div>
            <div style={{ fontSize: '0.58rem', color: '#4b5563', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 3 }}>Score</div>
          </div>
          <div style={{ width: 1, height: 40, background: '#1e1e1e', flexShrink: 0 }} />
          <div style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.55 }}>
            {isEarly
              ? 'Preliminary score — will stabilize as the algorithm completes its distribution test.'
              : isContext
              ? 'Historical performance score — reflects peak distribution state, not current optimization potential.'
              : 'Historical performance score — reflects the video\'s final distribution state, not current optimization potential.'}
          </div>
        </div>
      )}

      {/* Back link */}
      <div style={{ textAlign: 'center' }}>
        <button
          onClick={() => onGoToVideo ? onGoToVideo() : onNavigate?.('video')}
          style={{
            background: 'none', border: '1px solid #2a2a2a', borderRadius: 8,
            padding: '10px 24px', color: '#6b7280', fontSize: '0.85rem',
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          ← Back to Video Analysis
        </button>
      </div>

    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ImproveHub({ video, aiData, onUpgrade, onNavigate, onGoToVideo, canUseAI, consumeAICall, actionType, insightMode, videoType }) {
  const [improvements,      setImprovements]      = useState(null);
  const [improving,         setImproving]         = useState(false);
  const [improveError,      setImproveError]      = useState('');
  const [checkDone,         setCheckDone]         = useState({});
  const [selectedTitle,     setSelectedTitle]     = useState(null);
  const [selectedThumbnail, setSelectedThumbnail] = useState(null);
  const [selectedFixes,     setSelectedFixes]     = useState({ seo: false, cta: false });
  const [bestCombo,         setBestCombo]         = useState(null);

  const autoSelectBest = (impr) => {
    setBestCombo(null);
    if (!impr) {
      setSelectedTitle(null);
      setSelectedThumbnail(null);
      setSelectedFixes({ seo: false, cta: false });
      return;
    }
    const baseOverall      = aiData?.blueprint?.viralScore ?? 0;
    const basePackagingDim = aiData?.blueprint?.scores?.packaging ?? 0;

    const titleBoost = t => (t.projectedOverall ?? baseOverall) - baseOverall;
    const thumbBoost = t => (t.projectedDimensions?.packaging ?? basePackagingDim) - basePackagingDim;

    const titles = impr.titles || [];
    if (titles.length > 0) {
      const bestIdx = titles.reduce((best, t, i) =>
        titleBoost(t) > titleBoost(titles[best]) ? i : best, 0);
      setSelectedTitle(bestIdx);
    } else {
      setSelectedTitle(null);
    }

    const hasSeo = !!(impr.seo_improvements?.title_suggestion);
    setSelectedFixes({ seo: hasSeo, cta: !!(impr.cta?.text) });

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
      setSelectedFixes({ seo: false, cta: false });
      setBestCombo(null);
      setCheckDone({});
      return;
    }
    const baseOverall      = aiData?.blueprint?.viralScore ?? 0;
    const basePackagingDim = aiData?.blueprint?.scores?.packaging ?? 0;

    const titleBoost = t => (t.projectedOverall ?? baseOverall) - baseOverall;
    const thumbBoost = t => (t.projectedDimensions?.packaging ?? basePackagingDim) - basePackagingDim;

    const bestTitleIdx = (improvements.titles || []).reduce((best, t, i) =>
      titleBoost(t) > titleBoost(improvements.titles[best]) ? i : best, 0);

    const bestThumbIdx = (improvements.thumbnails || []).reduce((best, t, i) =>
      thumbBoost(t) > thumbBoost(improvements.thumbnails[best]) ? i : best, 0);

    const includeSeo = !!(improvements.seo_improvements?.title_suggestion);

    const combo = ['title', 'thumbnail'];
    if (includeSeo) combo.push('seo');
    setBestCombo(combo);

    setTimeout(() => setSelectedTitle(bestTitleIdx),                             0);
    setTimeout(() => setSelectedThumbnail(bestThumbIdx),                       400);
    setTimeout(() => { if (includeSeo) setSelectedFixes(p => ({ ...p, seo: true })); }, 800);
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
    setImprovements(null);
    setSelectedTitle(null);
    setSelectedThumbnail(null);
    setSelectedFixes({ seo: false, cta: false });
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
      const bp = aiData?.blueprint    || {};
      const tt = aiData?.titleThumbnail || {};
      const analysisData = {
        viralScore:       bp.viralScore ?? 0,
        grade:            bp.grade      ?? null,
        contentDNA:       bp.contentDNA || 'Not available',
        strengths:        bp.strengths  || '',
        weaknesses:       bp.improvements || '',
        dimensionScores: {
          packaging:  bp.scores?.packaging  ?? null,
          engagement: bp.scores?.engagement ?? null,
          seo:        bp.scores?.seo        ?? null,
          velocity:   bp.scores?.velocity   ?? null,
        },
        titleScores: {
          curiosity:      tt.curiosityScore      ?? null,
          emotional:      tt.emotionalScore      ?? null,
          clarity:        tt.clarityScore        ?? null,
          scrollStopping: tt.scrollStoppingScore ?? null,
        },
        thumbnailConcepts: tt.thumbnailTips || [],
      };
      const result = await generateVideoImprovements(videoData, {
        ...analysisData,
        actionType: actionType || null,
      });
      if (result) {
        consumeAICall?.();
        setImprovements(result);
        setCheckDone({});
        autoSelectBest(result);
        if (actionType === 'TITLE_REWRITE' && result.titles?.length > 0) {
          setSelectedTitle(0);
        }
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

  if (insightMode === 'DIAGNOSE' || insightMode === 'CONTEXT') {
    return <DiagnosticBreakdown video={video} aiData={aiData} onGoToVideo={onGoToVideo} onNavigate={onNavigate} insightMode={insightMode} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Page header */}
      <div>
        <h2 style={{ margin: '0 0 6px', fontSize: '1.35rem', fontWeight: 900, color: '#e9d5ff' }}>✨ Fix My Video</h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#555', lineHeight: 1.6 }}>
          AI-generated title rewrites, hook scripts, CTAs, and a full viral playbook — written specifically for your video.
        </p>
      </div>

      {aiData?.blueprint?.scores && Object.keys(aiData.blueprint.scores).length > 0 && (
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
              <SEOSection
                seoImprovements={improvements?.seo_improvements}
                selected={selectedFixes.seo}
                onToggle={() => setSelectedFixes(p => ({ ...p, seo: !p.seo }))}
                baseScore={aiData?.blueprint?.scores?.seo ?? 0}
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
