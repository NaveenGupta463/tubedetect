import TITooltip from './Tooltip';
import { PSYCH_TRIGGER_TIPS } from './VideoAnalysisConstants';
import { SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

export default function VideoAnalysisPsychTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Psychology & Retention" />;
  if (aiLoading) return <><SkeletonCard lines={5} /><SkeletonCard lines={4} /></>;
  const psy = aiData.psychology || {};
  return (
    <>
      {/* 8 Psychological Triggers */}
      {psy.triggers?.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">8 Psychological Triggers</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 14 }}>
            {psy.triggers.map((trig, i) => {
              const color = trig.present ? (trig.strength >= 70 ? '#00c853' : trig.strength >= 40 ? '#ff9100' : '#ff6d00') : '#333';
              const textColor = trig.present ? (trig.strength >= 70 ? '#00c853' : trig.strength >= 40 ? '#ff9100' : '#ff6d00') : '#444';
              return (
                <div key={i} style={{ background: '#0f0f0f', borderRadius: 10, padding: '12px 14px', border: `1px solid ${color}44` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <TITooltip title={trig.name} desc={PSYCH_TRIGGER_TIPS[trig.name]} placement="top">
                      <span style={{ fontSize: 13, fontWeight: 700, color: trig.present ? '#e0e0e0' : '#444', cursor: 'default' }}>{trig.name}</span>
                    </TITooltip>
                    <span style={{ fontSize: 11, fontWeight: 700, color: textColor, background: color + '22', padding: '2px 7px', borderRadius: 4 }}>
                      {trig.present ? `${trig.strength}%` : 'Absent'}
                    </span>
                  </div>
                  {trig.present && trig.strength > 0 && (
                    <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{ height: '100%', width: `${trig.strength}%`, background: color, borderRadius: 2 }} />
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{trig.note}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pacing + Engagement Tips */}
      <div className="chart-card">
        {psy.pacing && (
          <div style={{ marginBottom: 16 }}>
            <TITooltip title="Pacing Analysis" desc="How well the video controls its speed of information delivery. Good pacing mixes fast-moving moments with breathing room — neither too dense nor too slow." placement="top">
              <div style={{ fontSize: 12, fontWeight: 700, color: '#ff9100', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Pacing Analysis</div>
            </TITooltip>
            <div className="ai-text-block" style={{ marginTop: 0 }}>{psy.pacing}</div>
          </div>
        )}
        {psy.engagementTips?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#00c853', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Engagement Strategy</div>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {psy.engagementTips.map((tip, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>
                  <span style={{ color: '#00c853', flexShrink: 0 }}>✓</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {psy.density != null && (
          <div>
            <TITooltip title="Information Density" desc="How much valuable information is packed per minute of video. 100 = extremely dense (like a tutorial). Low scores mean lots of filler. Optimal range is 50-75 depending on content type." placement="top">
              <div style={{ fontSize: 12, fontWeight: 700, color: '#2196f3', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, cursor: 'default' }}>Information Density</div>
            </TITooltip>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ flex: 1, height: 10, background: '#1a1a1a', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${psy.density}%`, background: '#2196f3', borderRadius: 5, transition: 'width 0.8s ease' }} />
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#2196f3', flexShrink: 0 }}>{psy.density}/100</span>
            </div>
            {psy.densityNote && <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>{psy.densityNote}</div>}
          </div>
        )}
      </div>
    </>
  );
}
