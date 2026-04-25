import TITooltip from './Tooltip';
import { HOOK_TIPS } from './VideoAnalysisConstants';
import { SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

const PHASE_COLORS = {
  Hook: '#ff0000', Context: '#ff9100', Problem: '#ff6d00',
  Escalation: '#ff9100', Climax: '#00c853', Resolution: '#2196f3', CTA: '#7c4dff',
};

export default function VideoAnalysisHookTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade, videoType }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Hook & Structure" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={3} /></>;

  if (videoType === 'LEGACY_VIRAL' && aiData.intelligence) {
    const vbf = aiData.intelligence.viewerBehaviorFlow || {};
    return (
      <>
        <div className="chart-card" style={{ borderTop: '3px solid #7c3aed' }}>
          {vbf.entryTriggerType && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#c084fc', fontWeight: 700 }}>
                Entry Trigger: {vbf.entryTriggerType}
              </span>
            </div>
          )}
          <h3 className="chart-title" style={{ marginBottom: 14 }}>Viewer Entry Analysis</h3>
          {vbf.firstImpressionAnalysis && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>First 30 Seconds</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{vbf.firstImpressionAnalysis}</div>
            </div>
          )}
          {vbf.behavioralFlow && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Emotional Journey</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{vbf.behavioralFlow}</div>
            </div>
          )}
          {vbf.viralEntryMechanism && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Viral Share Trigger</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{vbf.viralEntryMechanism}</div>
            </div>
          )}
          {vbf.culturalTrigger && (
            <div style={{ padding: '12px 14px', background: '#0a0a1a', border: '1px solid #2a1060', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c084fc', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Cultural Dynamic</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{vbf.culturalTrigger}</div>
            </div>
          )}
        </div>
      </>
    );
  }

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
          <strong style={{ color: '#9aba8a' }}>How this works:</strong> Claude analyses the video <strong style={{ color: '#9aba8a' }}>title, stats, tags, and top comments</strong> — it cannot watch the video. Retention numbers are <strong style={{ color: '#9aba8a' }}>predictions</strong> based on engagement signals — not real YouTube Analytics data.
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
