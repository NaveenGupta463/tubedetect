import TITooltip from './Tooltip';
import { TITLE_SCORE_TIPS } from './VideoAnalysisConstants';
import { SkeletonCard, AiRunPrompt } from './VideoAnalysisPrimitives';

export default function VideoAnalysisTitleTab({ aiData, aiLoading, handleDeepAnalysis, canUseAI, onUpgrade, videoType }) {
  if (!aiData) return <AiRunPrompt onRun={handleDeepAnalysis} loading={aiLoading} noAI={!canUseAI?.()} onUpgrade={onUpgrade} tabLabel="Thumbnail & Title" />;
  if (aiLoading) return <><SkeletonCard lines={4} /><SkeletonCard lines={5} /><SkeletonCard lines={3} /></>;

  if (videoType === 'LEGACY_VIRAL' && aiData.intelligence) {
    const ti = aiData.intelligence.titleIntelligence || {};
    return (
      <>
        <div className="chart-card" style={{ borderTop: '3px solid #7c3aed' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ background: '#7c3aed22', border: '1px solid #7c3aed44', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#c084fc', fontWeight: 700 }}>
              {ti.formulaType || 'Pattern Analysis'}
            </span>
          </div>
          <h3 className="chart-title" style={{ marginBottom: 14 }}>Why This Title Worked</h3>
          {ti.psychologicalHook && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Psychological Hook</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{ti.psychologicalHook}</div>
            </div>
          )}
          {ti.whyItWorked && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#a855f7', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Mass Click Behaviour</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{ti.whyItWorked}</div>
            </div>
          )}
          {ti.culturalContext && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Cultural Context</div>
              <div className="ai-text-block" style={{ marginTop: 0 }}>{ti.culturalContext}</div>
            </div>
          )}
          {ti.replicableFormula && (
            <div style={{ padding: '12px 14px', background: '#1e0a3c', border: '1px solid #6d28d9', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c084fc', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Replicable Formula</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e9d5ff', lineHeight: 1.5, fontStyle: 'italic' }}>{ti.replicableFormula}</div>
            </div>
          )}
        </div>
      </>
    );
  }

  const tt = aiData.titleThumbnail || {};
  const scores4 = [
    { label: 'Curiosity',       value: tt.curiosityScore ?? 0 },
    { label: 'Emotional',       value: tt.emotionalScore ?? 0 },
    { label: 'Clarity',         value: tt.clarityScore ?? 0 },
    { label: 'Scroll-Stopping', value: tt.scrollStoppingScore ?? 0 },
  ];
  return (
    <>
      {/* 4-score bars */}
      <div className="chart-card">
        <h3 className="chart-title">Title Performance Scores</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {scores4.map(s => {
            const color = s.value >= 75 ? '#00c853' : s.value >= 55 ? '#ff9100' : '#ff1744';
            return (
              <TITooltip key={s.label} title={s.label} desc={TITLE_SCORE_TIPS[s.label]} placement="right">
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13, color: '#aaa' }}>
                    <span>{s.label}</span>
                    <span style={{ color, fontWeight: 700 }}>{s.value}/100</span>
                  </div>
                  <div style={{ height: 8, background: '#1a1a1a', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.value}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
                  </div>
                </div>
              </TITooltip>
            );
          })}
        </div>
      </div>

      {/* Analysis + Triggers */}
      <div className="chart-card">
        <h3 className="chart-title">Title Analysis</h3>
        {tt.analysis && <div className="ai-text-block" style={{ marginBottom: 16 }}>{tt.analysis}</div>}
        {tt.triggers?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Psychological Triggers Detected
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tt.triggers.map((t, i) => (
                <span key={i} style={{ background: '#7c4dff22', border: '1px solid #7c4dff44', borderRadius: 6, padding: '3px 10px', fontSize: 12, color: '#b39ddb' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {tt.seoNote && (
          <div style={{ padding: '10px 14px', background: '#0f0f0f', borderRadius: 8, border: '1px solid #1e1e1e', fontSize: 13, color: '#888' }}>
            🔍 <strong style={{ color: '#aaa' }}>SEO:</strong> {tt.seoNote}
          </div>
        )}
      </div>

      {/* Improved Titles */}
      {tt.improvedTitles?.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">3 Improved Title Alternatives</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {tt.improvedTitles.map((t, i) => (
              <div key={i} style={{ background: '#0f0f0f', borderRadius: 8, padding: '12px 14px', border: '1px solid #1e1e1e' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#7c4dff', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t.type}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8e8', marginBottom: 6, lineHeight: 1.4 }}>"{t.title}"</div>
                <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>{t.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thumbnail tips */}
      {tt.thumbnailTips?.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">Thumbnail Recommendations</h3>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tt.thumbnailTips.map((tip, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>
                <span style={{ color: '#7c4dff', flexShrink: 0, fontWeight: 700 }}>#{i + 1}</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
