import { useState } from 'react';
import { ScoreRing } from './VideoAnalysisPrimitives';

// ── UpgradeModal ──────────────────────────────────────────────────────────────
export function UpgradeModal({ onUpgrade, onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div style={{
        background: '#0f0f0f', border: '1px solid #2a2a2a',
        borderRadius: 16, padding: '32px 28px', maxWidth: 400, width: '100%',
        boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
        textAlign: 'center',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 48, marginBottom: 12, animation: 'lockBounce 0.5s ease' }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
          This is a Pro Feature
        </div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 22, lineHeight: 1.7 }}>
          Upgrade to Pro to unlock the complete 6-tab deep video analysis.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, textAlign: 'left' }}>
          {[
            '🎯 Thumbnail psychology score + 3 improved title alternatives',
            '🪝 Hook strength analysis + 7-phase structure timeline',
            '🧠 8 psychological trigger detection + retention prediction',
            '⚡ 5 virality factors + algorithm performance score',
            '🏆 Content DNA blueprint + replication steps + overall score',
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#aaa', alignItems: 'flex-start' }}>
              <span style={{ color: '#00c853', flexShrink: 0, marginTop: 1 }}>✓</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 18 }}>
          Starting at <span style={{ color: '#7c4dff', fontWeight: 700 }}>₹999/month</span> or <span style={{ color: '#7c4dff', fontWeight: 700 }}>$12/month</span>
        </div>
        <button
          onClick={() => { onClose(); onUpgrade(); }}
          style={{
            width: '100%', background: '#ff0000', border: 'none',
            borderRadius: 8, padding: '13px 0',
            fontSize: 14, fontWeight: 800, color: '#fff', cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          Upgrade to Pro →
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', fontSize: 13, color: '#444', cursor: 'pointer' }}
        >
          Maybe Later
        </button>
      </div>
    </div>
  );
}

// ── LockedTabContent ──────────────────────────────────────────────────────────
export function LockedTabContent({ tabLabel, onUpgrade }) {
  const fakeRows = [4, 3, 5, 3, 4];
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ filter: 'blur(6px)', pointerEvents: 'none', userSelect: 'none', opacity: 0.35 }}>
        {fakeRows.map((lines, i) => (
          <div key={i} className="chart-card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Array.from({ length: lines }).map((_, j) => (
                <div key={j} className="skeleton-line" style={{ width: `${95 - j * 10}%`, height: j === 0 ? 18 : 13 }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: 'rgba(8,8,8,0.92)', border: '1px solid #2a2a2a',
          borderRadius: 16, padding: '32px 28px', maxWidth: 380, width: '100%',
          textAlign: 'center', boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
            {tabLabel} — Pro Feature
          </div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 20, lineHeight: 1.7 }}>
            Unlock AI-powered deep analysis for every video. Get actionable insights that help you create better content.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20, textAlign: 'left' }}>
            {[
              'Thumbnail psychology scores + improved title alternatives',
              'Hook strength + full video structure timeline',
              'Algorithm virality factors + content DNA blueprint',
            ].map((item, i) => (
              <div key={i} style={{ fontSize: 12, color: '#888', display: 'flex', gap: 8 }}>
                <span style={{ color: '#7c4dff' }}>→</span><span>{item}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onUpgrade}
            style={{
              width: '100%', background: 'linear-gradient(135deg, #ff0000, #cc0000)',
              border: 'none', borderRadius: 8, padding: '12px 0',
              fontSize: 13, fontWeight: 800, color: '#fff', cursor: 'pointer',
            }}
          >
            🔓 Unlock Deep Video Analysis — Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ProTeaserCard ─────────────────────────────────────────────────────────────
export function ProTeaserCard({ score, onUpgrade }) {
  const fakeScores = [
    { label: 'Thumbnail', value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.4) * 20))) },
    { label: 'Hook',      value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.5) * 25))) },
    { label: 'Algorithm', value: Math.max(20, Math.min(95, score + Math.round((Math.random() - 0.3) * 18))) },
  ];
  return (
    <div className="chart-card" style={{ border: '1px solid #7c4dff33', background: 'linear-gradient(135deg, #0d0d0d, #100d18)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="chart-title" style={{ marginBottom: 2 }}>🔒 Deep Analysis Preview</h3>
          <p className="chart-subtitle">Pro users get a full breakdown across 5 AI dimensions</p>
        </div>
        <span style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#b39ddb' }}>
          Pro Feature
        </span>
      </div>

      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 18, filter: 'blur(3px)', userSelect: 'none', pointerEvents: 'none' }}>
        {fakeScores.map(s => (
          <ScoreRing key={s.label} score={s.value} label={s.label} size={72} />
        ))}
      </div>

      <div style={{ fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16, lineHeight: 1.7 }}>
        Your video scored in <strong style={{ color: '#b39ddb' }}>Thumbnail</strong>, <strong style={{ color: '#b39ddb' }}>Hook</strong>, and <strong style={{ color: '#b39ddb' }}>Algorithm</strong> dimensions — upgrade to see the full breakdown and actionable blueprint.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 18 }}>
        {['Thumbnail Psychology', 'Hook Strength', 'Retention Curve', 'Virality Factors', 'Content DNA', 'Blueprint'].map(tag => (
          <span key={tag} style={{ background: '#111', border: '1px solid #222', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#444' }}>
            {tag}
          </span>
        ))}
      </div>

      <button
        onClick={onUpgrade}
        className="run-analysis-glow-btn"
        style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 13 }}
      >
        🧠 Run Deep Analysis — Upgrade to Pro
      </button>
    </div>
  );
}

// ── AgencyBulkPanel ───────────────────────────────────────────────────────────
export function AgencyBulkPanel({ videos, currentVideoId, bulkQueue, setBulkQueue, onVideoSelect }) {
  const [open, setOpen] = useState(false);
  const remaining = videos.filter(v => v.id !== currentVideoId).slice(0, 10);

  const toggleVideo = (id) => {
    setBulkQueue(q => q.includes(id) ? q.filter(x => x !== id) : [...q, id].slice(0, 10));
  };

  return (
    <div className="chart-card" style={{ marginTop: 16, border: '1px solid #ff990033', background: 'linear-gradient(135deg,#0d0d0d,#0f0d0a)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div>
          <h3 className="chart-title" style={{ marginBottom: 2 }}>⚡ Agency Bulk Analyze</h3>
          <p className="chart-subtitle">Analyze up to 10 videos at once — Agency tier exclusive</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#ff990022', border: '1px solid #ff990044', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#ffb74d' }}>
            Agency
          </span>
          <span style={{ color: '#555', fontSize: 14 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
            Select videos to add to your analysis queue. Click any queued video to jump directly to its analysis.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
            {remaining.map(v => {
              const inQueue = bulkQueue.includes(v.id);
              const thumb = v.snippet?.thumbnails?.default?.url;
              return (
                <div
                  key={v.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: inQueue ? '#ff990011' : '#0f0f0f',
                    border: `1px solid ${inQueue ? '#ff990033' : '#1a1a1a'}`,
                    borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                  }}
                  onClick={() => toggleVideo(v.id)}
                >
                  {thumb && <img src={thumb} alt="" style={{ width: 40, height: 28, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.snippet?.title}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: inQueue ? '#ffb74d' : '#333', flexShrink: 0 }}>
                    {inQueue ? '✓ Queued' : '+ Add'}
                  </span>
                </div>
              );
            })}
          </div>
          {bulkQueue.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                {bulkQueue.length} video{bulkQueue.length > 1 ? 's' : ''} queued — click to analyze each:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bulkQueue.map(id => {
                  const v = videos.find(v => v.id === id);
                  return v ? (
                    <button
                      key={id}
                      onClick={() => onVideoSelect(v)}
                      style={{
                        background: '#ff990022', border: '1px solid #ff990044',
                        borderRadius: 6, padding: '4px 12px', fontSize: 11,
                        fontWeight: 600, color: '#ffb74d', cursor: 'pointer',
                        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {v.snippet?.title?.slice(0, 30)}…
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
