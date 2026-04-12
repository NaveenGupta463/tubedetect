import TITooltip from './Tooltip';
import { HOOK_TIPS } from './VideoAnalysisConstants';
import { SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

const PHASE_COLORS = {
  Hook: '#ff0000', Context: '#ff9100', Problem: '#ff6d00',
  Escalation: '#ff9100', Climax: '#00c853', Resolution: '#2196f3', CTA: '#7c4dff',
};

export default function VideoAnalysisHookTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Hook & Structure" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={3} /></>;
  const hs = aiData.hookStructure || {};
  return (
    <>
      {/* Transparency disclaimer */}
      <div style={{
        background: '#111a0d', border: '1px solid #2a4a1a', borderRadius: 10,
        padding: '10px 14px', marginBottom: 4,
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
        <div style={{ fontSize: 12, color: '#7a9a6a', lineHeight: 1.6 }}>
          <strong style={{ color: '#9aba8a' }}>How this works:</strong> Claude analyses the video <strong style={{ color: '#9aba8a' }}>title, stats, tags, and top comments</strong> — it cannot watch the video. The structure timeline is a <strong style={{ color: '#9aba8a' }}>recommended framework</strong> for this type of content, and retention numbers are <strong style={{ color: '#9aba8a' }}>predictions</strong> based on engagement signals — not real YouTube Analytics data.
        </div>
      </div>

      {/* Hook Strength */}
      <div className="chart-card">
        <div className="chart-title-row">
          <h3 className="chart-title">Hook Analysis</h3>
          {hs.hookType && (
            <span style={{ background: '#ff000022', border: '1px solid #ff000044', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#ff6666', fontWeight: 700 }}>
              {hs.hookType.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        {hs.hookStrength != null && (
          <TITooltip title="Hook Strength" desc={HOOK_TIPS.hookStrength} placement="right">
            <div style={{ marginBottom: 14, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                <span>Hook Strength</span>
                <span style={{ fontWeight: 700, color: hs.hookStrength >= 70 ? '#00c853' : hs.hookStrength >= 50 ? '#ff9100' : '#ff1744' }}>{hs.hookStrength}/100</span>
              </div>
              <div style={{ height: 10, background: '#1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${hs.hookStrength}%`, background: hs.hookStrength >= 70 ? '#00c853' : hs.hookStrength >= 50 ? '#ff9100' : '#ff1744', borderRadius: 5, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          </TITooltip>
        )}
        {hs.hookAnalysis && <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.hookAnalysis}</div>}
      </div>

      {/* Structure Timeline */}
      {hs.timeline?.length > 0 && (
        <div className="chart-card">
          <TITooltip title="Recommended Video Structure" desc={HOOK_TIPS.timeline} placement="top">
            <h3 className="chart-title" style={{ cursor: 'default' }}>Recommended Video Structure</h3>
          </TITooltip>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {hs.timeline.map((phase, i) => {
              const phaseColor = PHASE_COLORS[phase.phase] || '#7c4dff';
              const str = phase.strength ?? 0;
              return (
                <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flexShrink: 0, width: 90 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: phaseColor }}>{phase.phase}</div>
                    <div style={{ fontSize: 10, color: '#444' }}>{phase.time}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                      <div style={{ height: '100%', width: `${str}%`, background: phaseColor, borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>{phase.desc}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: phaseColor, flexShrink: 0 }}>{str}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Retention Prediction */}
      {hs.retention?.length > 0 && (
        <div className="chart-card">
          <TITooltip title="Estimated Retention Curve" desc={HOOK_TIPS.retention} placement="top">
            <h3 className="chart-title" style={{ cursor: 'default' }}>Estimated Retention Curve</h3>
          </TITooltip>
          <p className="chart-subtitle">Predicted from engagement signals — not real retention data. Connect Google account on My Channel for actual curves.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 14 }}>
            {hs.retention.map((seg, i) => {
              const color = seg.rate >= 70 ? '#00c853' : seg.rate >= 50 ? '#ff9100' : '#ff1744';
              return (
                <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px', textAlign: 'center', border: `1px solid ${color}33` }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 2 }}>{seg.rate}%</div>
                  <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>{seg.segment}</div>
                  <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{seg.note}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pattern Interrupts + Curiosity Loops */}
      {(hs.patternInterrupts || hs.curiosityLoops) && (
        <div className="chart-card">
          {hs.patternInterrupts && (
            <div style={{ marginBottom: hs.curiosityLoops ? 16 : 0 }}>
              <TITooltip title="Pattern Interrupts" desc={HOOK_TIPS.patternInterrupts} placement="top">
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Pattern Interrupts</div>
              </TITooltip>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.patternInterrupts}</div>
            </div>
          )}
          {hs.curiosityLoops && (
            <div>
              <TITooltip title="Curiosity Loops" desc={HOOK_TIPS.curiosityLoops} placement="top">
                <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Curiosity Loops</div>
              </TITooltip>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{hs.curiosityLoops}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
