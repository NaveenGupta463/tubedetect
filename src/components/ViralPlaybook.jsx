import { meetsRequirement } from '../utils/tierConfig';

function Row({ icon, label, value, accent }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 0',
      borderBottom: '1px solid #131313', alignItems: 'flex-start',
    }}>
      <div style={{ fontSize: '1.2rem', flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.57rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.55, fontWeight: 500 }}>{value}</div>
      </div>
      <div style={{ width: 3, background: `${accent}44`, borderRadius: 2, alignSelf: 'stretch', flexShrink: 0 }} />
    </div>
  );
}

export default function ViralPlaybook({ video, improvements, tier, onUpgrade }) {
  const isStarter = meetsRequirement(tier, 'starter');
  const playbook  = improvements?.viral_playbook;

  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid #1e1e1e',
      borderRadius: 16, padding: '24px 24px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, transparent, #a855f788, #a855f7, #a855f788, transparent)',
        borderRadius: '16px 16px 0 0',
      }} />

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#e9d5ff', marginBottom: 4 }}>📈 Viral Playbook</div>
        <div style={{ fontSize: '0.78rem', color: '#4a4a5a', lineHeight: 1.5 }}>
          Exactly what makes this video's format work — decoded so you can replicate it
        </div>
      </div>

      {/* No improvements yet */}
      {!improvements && (
        <div style={{ padding: '12px 0', color: '#444', fontSize: '0.82rem', lineHeight: 1.7 }}>
          Generate AI Improvements above to unlock the viral playbook for this video.
        </div>
      )}

      {/* Locked (non-starter) */}
      {improvements && !isStarter && (
        <div style={{ textAlign: 'center', padding: '24px 0 8px' }}>
          <div style={{ fontSize: '1.6rem', marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#a78bfa', marginBottom: 6 }}>Starter Feature</div>
          <div style={{ fontSize: '0.76rem', color: '#4a4a5a', marginBottom: 16, lineHeight: 1.65, maxWidth: 280, margin: '0 auto 16px' }}>
            Unlock the full viral playbook — hook pattern, structure breakdown, emotional trigger analysis, and step-by-step replication guide
          </div>
          <button
            onClick={onUpgrade}
            style={{
              background: 'linear-gradient(135deg, #4c1d95, #7c3aed)',
              color: '#f3e8ff', border: 'none', borderRadius: 8,
              padding: '10px 24px', fontWeight: 800, fontSize: '0.84rem', cursor: 'pointer',
              boxShadow: '0 0 16px rgba(124,58,237,0.3)',
            }}
          >
            Upgrade to Starter →
          </button>
        </div>
      )}

      {/* Content */}
      {improvements && isStarter && playbook && (
        <>
          <Row icon="🎣" label="Hook Pattern"      value={playbook.hook_pattern}      accent="#22c55e" />
          <Row icon="🏗️"  label="Video Structure"  value={playbook.video_structure}    accent="#eab308" />
          <Row icon="💥" label="Emotional Trigger" value={playbook.emotional_trigger}  accent="#f97316" />
          <Row icon="📢" label="CTA Pattern"       value={playbook.cta_pattern}        accent="#a855f7" />

          {/* Replication steps */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#3a3a4a', marginBottom: 12 }}>
              Step-by-step Replication Guide
            </div>
            {(playbook.replication_steps || []).map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: '0.79rem', color: '#888', lineHeight: 1.55, marginBottom: 10 }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20,
                  background: '#a855f71a', border: '1px solid #a855f733',
                  borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.65rem', fontWeight: 800, color: '#a855f7', marginTop: 1,
                }}>
                  {i + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
