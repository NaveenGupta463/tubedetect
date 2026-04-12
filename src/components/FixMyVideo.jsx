import { useState } from 'react';
import { meetsRequirement } from '../utils/tierConfig';

// ── CopyRow component ─────────────────────────────────────────────────────────
function CopyRow({ label, content, reason, locked, onUnlock }) {
  const [copied,  setCopied]  = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #141414' }}>
      <div style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#444', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: '0.83rem',
        color: locked ? 'transparent' : '#e0e0e0',
        lineHeight: 1.6,
        marginBottom: 9,
        fontStyle: 'italic',
        textShadow: locked ? '0 0 8px #333' : 'none',
        userSelect: locked ? 'none' : 'auto',
        background: locked ? 'repeating-linear-gradient(90deg, #222 0px, #2a2a2a 4px, #222 8px)' : 'none',
        borderRadius: locked ? 4 : 0,
        padding: locked ? '2px 4px' : 0,
      }}>
        {locked ? content.replace(/./g, '█').slice(0, Math.min(content.length, 80)) : content}
      </div>
      {locked ? (
        <button
          onClick={onUnlock}
          style={{
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #7c3aed55', background: '#110a20',
            color: '#a78bfa', fontSize: '0.72rem', fontWeight: 700,
          }}
        >
          🔒 Upgrade to Unlock
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={copy}
            style={{
              padding: '4px 14px', borderRadius: 6, cursor: 'pointer',
              border:     copied ? '1px solid #22c55e55' : '1px solid #2a2a2a',
              background: copied ? '#0b1f0e'             : '#1a1a1a',
              color:      copied ? '#22c55e'             : '#888',
              fontSize: '0.72rem', fontWeight: 700, transition: 'all 0.15s',
            }}
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
          {reason && (
            <button
              onClick={() => setShowWhy(v => !v)}
              style={{
                padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                background: 'none', border: '1px solid #1e1e1e',
                color: '#555', fontSize: '0.7rem', fontWeight: 600,
              }}
            >
              {showWhy ? '▲ Hide' : '💡 Why this works'}
            </button>
          )}
        </div>
      )}
      {showWhy && !locked && reason && (
        <div style={{
          marginTop: 8, background: '#0a0a14', border: '1px solid #1e1e2e',
          borderRadius: 8, padding: '9px 12px',
          fontSize: '0.75rem', color: '#777', lineHeight: 1.6,
        }}>
          {reason}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FixMyVideo({ video, improvements, generating, tier, onUpgrade }) {
  const isPro = meetsRequirement(tier, 'pro');

  return (
    <div style={{
      background: '#09090f', border: '1px solid #1e1e2e',
      borderRadius: 16, padding: '24px 24px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, transparent, #7c3aed88, #7c3aed, #7c3aed88, transparent)',
        borderRadius: '16px 16px 0 0',
      }} />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#e9d5ff', marginBottom: 4 }}>✨ Fix My Video</div>
        <div style={{ fontSize: '0.78rem', color: '#4a4a5a', lineHeight: 1.5 }}>
          AI-generated improvements written specifically for this video — copy and use directly
        </div>
      </div>

      {/* Generating state */}
      {generating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '24px 0', color: '#666', fontSize: '0.84rem' }}>
          <span className="btn-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
          Writing precision improvements…
        </div>
      )}

      {/* No improvements yet */}
      {!generating && !improvements && (
        <div style={{ padding: '20px 0', color: '#444', fontSize: '0.82rem', lineHeight: 1.7 }}>
          Click <strong style={{ color: '#a78bfa' }}>Generate AI Improvements</strong> above to get titles, hook script, and CTA written specifically for this video.
        </div>
      )}

      {/* Content */}
      {!generating && improvements && (
        <>
          {/* Titles */}
          <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: 10 }}>
            🎯 Improved Titles (CTR Optimized)
          </div>
          {(improvements.titles || []).map((t, i) => (
            <CopyRow
              key={i}
              label={`Title ${i + 1} — ${t.angle}`}
              content={t.text}
              reason={t.reason}
              locked={!isPro && i > 0}
              onUnlock={onUpgrade}
            />
          ))}

          {/* Hook */}
          <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: 10, marginTop: 6 }}>
            🎣 Hook Script (First 30 Seconds)
          </div>
          <CopyRow
            label="Hook Script"
            content={improvements.hook?.text || ''}
            reason={improvements.hook?.reason}
            locked={!isPro}
            onUnlock={onUpgrade}
          />

          {/* CTA */}
          <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#7c3aed', marginBottom: 10, marginTop: 6 }}>
            📢 Call to Action
          </div>
          <CopyRow
            label="CTA Script"
            content={improvements.cta?.text || ''}
            reason={improvements.cta?.reason}
            locked={!isPro}
            onUnlock={onUpgrade}
          />

          {/* Pro upsell */}
          {!isPro && (
            <div style={{
              marginTop: 4, background: '#0d0920', border: '1px solid #2d1060',
              borderRadius: 10, padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '0.82rem', color: '#a78bfa', fontWeight: 800, marginBottom: 4 }}>🔒 Pro Feature</div>
              <div style={{ fontSize: '0.74rem', color: '#4a4a5a', marginBottom: 12, lineHeight: 1.6 }}>
                Unlock all 3 titles, hook script, and CTA with full reasoning explanations
              </div>
              <button
                onClick={onUpgrade}
                style={{
                  background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
                  color: '#f3e8ff', border: 'none', borderRadius: 8,
                  padding: '9px 24px', fontWeight: 800, fontSize: '0.84rem', cursor: 'pointer',
                  boxShadow: '0 0 16px rgba(124,58,237,0.3)',
                }}
              >
                Upgrade to Pro →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
